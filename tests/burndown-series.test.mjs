import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { computeBurndownSeries } from "../lib/burndown-series.ts"

const SPRINT = { startDate: "2026-10-13", endDate: "2026-10-25" }
const TODAY = "2026-10-19"

const task = (key, points, doneDate, assigneeAccountId, actualPoints = null, doneBeforeStart = false, parentStatus = null) => ({
  key, summary: `Summary ${key}`, points, actualPoints, doneDate, doneBeforeStart, parentStatus,
  status: null,
  parentAssigneeDisplayName: null,
  assigneeDisplayName: `Name ${assigneeAccountId ?? "none"}`,
  assigneeAccountId,
  parentIssueType: { status: "known", name: "Story" },
})
const unestimated = (key, accountId) => ({
  key, summary: null, assigneeDisplayName: null, assigneeAccountId: accountId,
  parentIssueType: { status: "known", name: "Story" },
})

describe("computeBurndownSeries", () => {
  it("aggregates all tasks when accountIds is null", () => {
    const series = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [
        task("T-1", 5, "2026-10-15", "u-a"),
        task("T-2", 3, "2026-10-19", "u-b"),
        task("T-3", 8, null, "u-c"),
      ],
      unestimated: [],
      accountIds: null,
    })
    assert.equal(series.totalPoints, 16)
    // 含最前面的空起點格（startDate 前一天），共 1 + 13 天。
    assert.equal(series.days.length, 14)
    assert.equal(series.days[0].date, "2026-10-12")
    assert.equal(series.days[0].remainingPoints, 16)
    assert.equal(series.days[0].idealPoints, 16)
    assert.equal(series.days[0].donePoints, 0)
    const byDate = new Map(series.days.map((day) => [day.date, day]))
    assert.equal(byDate.get("2026-10-13").remainingPoints, 16)
    assert.equal(byDate.get("2026-10-16").remainingPoints, 11) // T-1(5) 已 done
    assert.equal(byDate.get("2026-10-19").remainingPoints, 8) // 16 - 5 - 3，T-3 未完成
    assert.equal(byDate.get("2026-10-19").donePoints, 3) // T-2 當天 done
    assert.equal(byDate.get("2026-10-20").remainingPoints, null) // 未來
    // 理想線：從空起點格（10-12）的 total 開始全程傾斜，到終點(10-25) = 0。
    // 第一天(10-13)已走 1/13，16 × (12/13) → 14.8。
    assert.equal(byDate.get("2026-10-13").idealPoints, 14.8)
    assert.equal(byDate.get("2026-10-25").idealPoints, 0)
  })

  it("filters by a single account", () => {
    const series = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [task("T-1", 5, "2026-10-15", "u-a"), task("T-2", 3, "2026-10-19", "u-b")],
      unestimated: [],
      accountIds: new Set(["u-a"]),
    })
    assert.equal(series.totalPoints, 5)
    const byDate = new Map(series.days.map((day) => [day.date, day]))
    assert.equal(byDate.get("2026-10-19").remainingPoints, 0)
    assert.equal(byDate.get("2026-10-15").donePoints, 5)
  })

  it("filters by multiple teams/members and prunes the unestimated list", () => {
    const series = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [
        task("T-1", 5, "2026-10-15", "u-a"),
        task("T-2", 3, null, "u-b"),
        task("T-3", 4, "2026-10-18", "u-c"),
      ],
      unestimated: [
        unestimated("U-1", "u-a"),
        unestimated("U-2", "u-c"),
        unestimated("U-3", "u-none"),
      ],
      accountIds: new Set(["u-a", "u-b"]),
    })
    assert.equal(series.totalPoints, 8) // T-1(5) + T-2(3)
    assert.deepEqual(series.unestimated.map((issue) => issue.key), ["U-1"])
    const byDate = new Map(series.days.map((day) => [day.date, day]))
    assert.equal(byDate.get("2026-10-19").remainingPoints, 8 - 5) // T-2 未完成
  })

  it("assignee-less tasks match only when no scope is applied", () => {
    const all = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [task("T-1", 2, null, null)],
      unestimated: [], accountIds: null,
    })
    assert.equal(all.totalPoints, 2)
    assert.equal(all.days[0].idealPoints, 2) // 全體時計入。
    const scoped = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [task("T-1", 2, null, null)],
      unestimated: [], accountIds: new Set(["u-a"]),
    })
    assert.equal(scoped.totalPoints, 0)
    assert.equal(scoped.days[0].idealPoints, 0) // 未指派不屬任何被選成員。
    // scoped 內無任務、也無任何完成記錄 → 實際線不畫（remaining 全 null）。
    assert.equal(scoped.days[0].remainingPoints, null)
    assert.equal(all.days[0].remainingPoints, null) // 全體也無完成記錄 → 不畫。
  })

  it("does not count future done dates toward remaining", () => {
    const series = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [
        task("T-1", 6, "2026-10-25", "u-a"), // doneDate 在未來：不計入剩餘
        task("T-2", 4, "2026-10-14", "u-a"), // 已完成的記錄 → 實際線可畫
      ],
      unestimated: [], accountIds: null,
    })
    assert.equal(series.totalPoints, 10)
    const byDate = new Map(series.days.map((day) => [day.date, day]))
    assert.equal(byDate.get("2026-10-19").remainingPoints, 6) // 10 - 4，未來 T-1 未計
    assert.equal(byDate.get("2026-10-20").remainingPoints, null)
  })

  it("returns the team-filtered tasks with summary/assignee for the bar dialog", () => {
    const series = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [
        task("T-1", 5, "2026-10-15", "u-a", 6),
        task("T-2", 3, "2026-10-19", "u-b", null),
        task("T-3", 4, null, "u-c", 4),
      ],
      unestimated: [], accountIds: new Set(["u-a", "u-b"]),
    })
    const keys = series.tasks.map((item) => item.key)
    assert.deepEqual(keys, ["T-1", "T-2"]) // u-c 被排除
    const t1 = series.tasks.find((item) => item.key === "T-1")
    assert.equal(t1.summary, "Summary T-1")
    assert.equal(t1.points, 5)
    assert.equal(t1.actualPoints, 6)
    assert.equal(t1.doneDate, "2026-10-15")
    assert.equal(t1.assigneeDisplayName, "Name u-a")
    assert.equal(t1.assigneeAccountId, "u-a")
    assert.deepEqual(JSON.parse(JSON.stringify(t1.parentIssueType)), { status: "known", name: "Story" })
    // 全體時回傳所有已估計任務。
    const all = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [task("T-1", 2, null, null)],
      unestimated: [], accountIds: null,
    })
    assert.deepEqual(all.tasks.map((item) => item.key), ["T-1"])
  })

  it("rounds the total points to one decimal to remove float error", () => {
    const series = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [
        task("T-1", 0.1, "2026-10-14", "u-a"),
        task("T-2", 0.2, null, "u-a"),
        task("T-3", 259.9, null, "u-a"),
      ],
      unestimated: [], accountIds: null,
    })
    assert.equal(series.totalPoints, 260.2) // 非 260.19999999999993
    // 有完成記錄 → 起點格 remaining = 四捨五入後的總點數。
    assert.equal(series.days[0].remainingPoints, 260.2)
    assert.equal(series.days[0].idealPoints, 260.2)
  })

  it("shows sprint-start-before Done points in the opening cell and counts them into remaining/total", () => {
    // T-1 在 sprint 開始前（doneBeforeStart）已 Done；T-2 在 sprint 內第 3 天 done。
    const series = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [
        task("T-B", 4, null, "u-a", null, true), // 開始前 Done → 綠色起點格
        task("T-1", 5, "2026-10-15", "u-a"),
        task("T-2", 3, null, "u-b"),
      ],
      unestimated: [], accountIds: null,
    })
    assert.equal(series.totalPoints, 12) // 開始前 Done 也計入總點數
    const opening = series.days[0]
    assert.equal(opening.date, "2026-10-12")
    assert.equal(opening.donePoints, 4) // 綠色長條 = 開始前 Done 的點數
    // 理想線／實際線的共同起點 = 總點數 − 開局已完成 = 12 − 4 = 8。
    assert.equal(opening.remainingPoints, 8)
    assert.equal(opening.idealPoints, 8)
    // 剩餘線自第一天起再扣掉開局已完成：T-1 於 10-15 done → 10-16 剩餘 8 − 5 = 3。
    const byDate = new Map(series.days.map((day) => [day.date, day]))
    // 10-13 當天無 done → 剩餘仍為開局起點 8（開局已完成已先扣掉）。
    assert.equal(byDate.get("2026-10-13").remainingPoints, 8)
    assert.equal(byDate.get("2026-10-16").remainingPoints, 3)
    assert.equal(byDate.get("2026-10-19").remainingPoints, 3) // T-2 未完成仍為 3
    // 理想線：從 8 起算、終點 0 的等速線。第一天(10-13)已走 1/13，8 × (12/13) → 7.4。
    assert.equal(byDate.get("2026-10-13").idealPoints, 7.4)
    assert.equal(byDate.get("2026-10-25").idealPoints, 0)
    // 開始前 Done 未經每日 doneDate 標記，獨立於一般 day 計算之外。
    assert.equal(byDate.get("2026-10-12").donePoints, 4)
    // 僅開始前 Done、無 sprint 內記錄，仍算有完成記錄 → 可畫線，起點 = 2 − 2 = 0。
    const onlyPre = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [task("T-B", 2, null, "u-a", null, true)],
      unestimated: [], accountIds: null,
    })
    assert.equal(onlyPre.days[0].remainingPoints, 0) // 2 − 2（開局全完成）
    assert.equal(onlyPre.days[0].donePoints, 2)
    assert.equal(onlyPre.days[0].idealPoints, 0)
  })

  it("re-scopes sprint-start-before Done points by the selected members", () => {
    const preAll = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [
        task("T-Ba", 4, null, "u-a", null, true),
        task("T-Bb", 3, null, "u-b", null, true),
      ],
      unestimated: [], accountIds: new Set(["u-b"]),
    })
    assert.equal(preAll.totalPoints, 3) // 只算 u-b
    // 綠色起點格 = 所選成員的開局已完成 = 3；理想/剩餘起點 = 3 − 3 = 0。
    assert.equal(preAll.days[0].donePoints, 3)
    assert.equal(preAll.days[0].remainingPoints, 0)
    assert.equal(preAll.days[0].idealPoints, 0)
  })

  it("collects parent-blocked Dev-Tasks into a dark-gray bar on the last available day only", () => {
    // T-B 開局前 Done（3）；T-P 母票受阻（5）；T-1 於 10-15 done（2）；T-2 未完成（4）。
    const blocked = new Set(["Request Info", "Pending", "Reproduce"])
    const series = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [
        task("T-B", 3, null, "u-a", null, true, null),
        task("T-P", 5, null, "u-a", null, false, "Request Info"),
        task("T-1", 2, "2026-10-15", "u-a"),
        task("T-2", 4, null, "u-b"),
      ],
      unestimated: [], accountIds: null, blockedParentStatuses: blocked,
    })
    assert.equal(series.totalPoints, 14) // 受阻仍計入總點數
    const byDate = new Map(series.days.map((day) => [day.date, day]))
    // 所有受阻點數歸到「目前最後一天」= today（2026-10-19）這個節點：deep-gray 5 點。
    assert.equal(byDate.get("2026-10-19").blockedPoints, 5)
    // 之前每一天：長條不因受阻而變、也無受阻長條；實際剩餘線不受影響。
    for (const dayKey of ["2026-10-13", "2026-10-16"]) {
      assert.equal(byDate.get(dayKey).blockedPoints, undefined)
    }
    // 剩餘：10-13 開局已扣開局前完成(3) → 14 − 3 = 11；10-16 再扣 T-1(2) → 9。
    assert.equal(byDate.get("2026-10-13").remainingPoints, 11)
    assert.equal(byDate.get("2026-10-16").remainingPoints, 9)
    // 10-19 節點：剩餘再扣受阻(5) → 9 − 5 = 4；T-2 仍未完成。
    assert.equal(byDate.get("2026-10-19").remainingPoints, 4)
    // 10-13 未受旁邊受阻滞影響，理想線照舊從開局起點 11 傾斜（四捨五入到小數第一位）。
    assert.equal(byDate.get("2026-10-13").idealPoints, 10.2)
    // 未勾選（集合 null）時，受阻照樣算未完成：10-19 無受阻長條、剩餘 = 9。
    const off = computeBurndownSeries({
      startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: TODAY,
      tasks: [
        task("T-B", 3, null, "u-a", null, true, null),
        task("T-P", 5, null, "u-a", null, false, "Request Info"),
        task("T-1", 2, "2026-10-15", "u-a"),
        task("T-2", 4, null, "u-b"),
      ],
      unestimated: [], accountIds: null,
    })
    const offByDate = new Map(off.days.map((day) => [day.date, day]))
    assert.equal(offByDate.get("2026-10-19").blockedPoints, undefined)
    assert.equal(offByDate.get("2026-10-19").remainingPoints, 9)
  })
})
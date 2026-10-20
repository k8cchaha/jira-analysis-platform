import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { computeBurndownSeries } from "../lib/burndown-series.ts"

const SPRINT = { startDate: "2026-10-13", endDate: "2026-10-25" }
const TODAY = "2026-10-19"

const task = (key, points, doneDate, assigneeAccountId) => ({
  key, summary: `Summary ${key}`, points, doneDate,
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
        task("T-1", 5, "2026-10-15", "u-a"),
        task("T-2", 3, "2026-10-19", "u-b"),
        task("T-3", 4, null, "u-c"),
      ],
      unestimated: [], accountIds: new Set(["u-a", "u-b"]),
    })
    const keys = series.tasks.map((item) => item.key)
    assert.deepEqual(keys, ["T-1", "T-2"]) // u-c 被排除
    const t1 = series.tasks.find((item) => item.key === "T-1")
    assert.equal(t1.summary, "Summary T-1")
    assert.equal(t1.points, 5)
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
})
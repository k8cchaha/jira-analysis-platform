import { test } from "node:test"
import assert from "node:assert/strict"

import {
  HEATMAP_SCALE,
  analysisCalendarDate,
  computeWorkloadHeatmap,
  computeWeeklyWorkloadHeatmap,
  computeMetricWorkloadHeatmap,
  projectWorkloadTasks,
  workloadCellTasks,
  heatmapLevel,
  resolveCompletionDate,
} from "../lib/workload-heatmap.ts"

const DAYS = ["2026-10-01", "2026-10-02", "2026-10-03"]
const TEAM_OF = { a1: "Android", a2: "Backend" }
const teamOf = (accountId) => (accountId === null ? undefined : TEAM_OF[accountId])
const teamOrder = ["Android", "Backend"]

/** 已估計、已完成於 date 的 Dev-Task（doneDate 保證落在區間內）。 */
function done(key, points, date, accountId = "a1", displayName = accountId) {
  return { key, points, doneDate: date, assigneeAccountId: accountId, assigneeDisplayName: displayName }
}
const MEMBERS = [
  { accountId: "a1", displayName: "Alice" },
  { accountId: "a2", displayName: "Bob" },
]

function build(overrides = {}) {
  return computeWorkloadHeatmap({
    from: "2026-10-01",
    to: "2026-10-03",
    days: DAYS,
    tasks: [],
    members: MEMBERS,
    teamOf,
    teamOrder,
    ...overrides,
  })
}

test("級距門檻：0 與 null 為空格，其餘依 HEATMAP_SCALE 分四級", () => {
  assert.equal(heatmapLevel(null), 0)
  assert.equal(heatmapLevel(0), 0)
  assert.equal(heatmapLevel(-1), 0)
  // 1-2 → 1 級
  assert.equal(heatmapLevel(1), 1)
  assert.equal(heatmapLevel(2.9), 1)
  // 3-5 → 2 級
  assert.equal(heatmapLevel(3), 2)
  assert.equal(heatmapLevel(5.9), 2)
  // 6-9 → 3 級
  assert.equal(heatmapLevel(6), 3)
  assert.equal(heatmapLevel(9.9), 3)
  // 10+ → 4 級
  assert.equal(heatmapLevel(10), 4)
  assert.equal(heatmapLevel(1000), 4)
  assert.equal(HEATMAP_SCALE.length + 1, 5)
})

test("逐日分桶：同一人同一天多張任務加總，不同天分開", () => {
  const heatmap = build({
    tasks: [done("A-1", 2, "2026-10-01"), done("A-2", 3, "2026-10-01"), done("A-3", 5, "2026-10-03")],
  })
  const alice = heatmap.rows.find((row) => row.accountId === "a1")
  assert.deepEqual(alice.cells, [5, null, 5])
  assert.equal(alice.totalPoints, 10)
  assert.equal(alice.activeDays, 2)
})

test("不同成員分到不同列，列順序依 teamOrder 再依名稱", () => {
  const heatmap = build({ tasks: [done("A-1", 2, "2026-10-01", "a1"), done("B-1", 4, "2026-10-02", "a2")] })
  assert.deepEqual(heatmap.rows.map((row) => row.displayName), ["Alice", "Bob"])
  assert.deepEqual(heatmap.rows.map((row) => row.teamLabel), ["Android", "Backend"])
})

test("完全沒有活動的成員仍要成列（該列全空）", () => {
  const heatmap = build({ tasks: [done("A-1", 2, "2026-10-01", "a1")] })
  const bob = heatmap.rows.find((row) => row.accountId === "a2")
  assert.deepEqual(bob.cells, [null, null, null])
  assert.equal(bob.totalPoints, 0)
  assert.equal(bob.activeDays, 0)
})

test("區間外的完成日不畫（防守資料不一致）", () => {
  const heatmap = build({ tasks: [done("A-1", 5, "2026-09-30"), done("A-2", 3, "2026-10-04")] })
  const alice = heatmap.rows.find((row) => row.accountId === "a1")
  assert.deepEqual(alice.cells, [null, null, null])
  assert.equal(alice.totalPoints, 0)
})

test("未指派的工作獨立一列，且排在最後", () => {
  const heatmap = build({ tasks: [done("A-1", 2, "2026-10-01", "a1"), done("U-1", 7, "2026-10-02", null, null)] })
  const last = heatmap.rows[heatmap.rows.length - 1]
  assert.equal(last.accountId, null)
  assert.equal(last.displayName, "未指派")
  assert.equal(last.teamLabel, "其他")
  assert.deepEqual(last.cells, [null, 7, null])
})

test("maxPoints 取全圖最大值，全空為 0；days 與 cells 同長", () => {
  const empty = build()
  assert.equal(empty.maxPoints, 0)
  const heatmap = build({ tasks: [done("A-1", 2, "2026-10-01"), done("B-1", 13.5, "2026-10-02", "a2")] })
  assert.equal(heatmap.maxPoints, 13.5)
  for (const row of heatmap.rows) assert.equal(row.cells.length, heatmap.days.length)
})

test("點數四捨五入到小數第一位，消除浮點誤差", () => {
  const heatmap = build({ tasks: [done("A-1", 0.1, "2026-10-01"), done("A-2", 0.2, "2026-10-01")] })
  assert.equal(heatmap.rows.find((row) => row.accountId === "a1").cells[0], 0.3)
})

test("完成但 0 點的任務：格子為 0（非 null），與沒有完成區分", () => {
  const heatmap = build({ tasks: [done("A-1", 0, "2026-10-01")] })
  const alice = heatmap.rows.find((row) => row.accountId === "a1")
  assert.equal(alice.cells[0], 0)
  assert.equal(alice.cells[1], null)
  assert.equal(alice.activeDays, 1)
})

test("未列在 teamOrder 的團隊排在有列者之後", () => {
  const heatmap = build({
    tasks: [done("C-1", 1, "2026-10-01", "a3")],
    members: [...MEMBERS, { accountId: "a3", displayName: "Carol" }],
    teamOf: (id) => (id === "a3" ? "Unknown" : TEAM_OF[id]),
  })
  assert.deepEqual(heatmap.rows.map((row) => row.displayName), ["Alice", "Bob", "Carol"])
  assert.equal(heatmap.rows[2].teamLabel, "Unknown")
})

test("未估計的任務原樣帶出，供資料品質註記", () => {
  const unestimated = [{ key: "A-9", assigneeDisplayName: "Alice", assigneeAccountId: "a1" }]
  const heatmap = build({ unestimated })
  assert.deepEqual(heatmap.unestimated, unestimated)
})
function weekly(overrides = {}) {
  return computeWeeklyWorkloadHeatmap({
    from: "2026-10-01", to: "2026-10-06",
    days: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"],
    tasks: [], members: MEMBERS, teamOf, teamOrder, ...overrides,
  })
}

test("每週加總：排除週一起日早於起日的週，末週保留實際取得的日期", () => {
  const result = weekly({ tasks: [done("A", 2.1, "2026-10-01"), done("B", 3, "2026-10-04"), done("C", 4, "2026-10-05")] })
  assert.deepEqual(result.weeks, [
    { start: "2026-10-05", from: "2026-10-05", to: "2026-10-06", year: "2026", dayCount: 2 },
  ])
  assert.deepEqual(result.rows[0].cells, [4])
  assert.equal(result.rows[0].totalPoints, 4)
  assert.equal(result.rows[0].activeWeeks, 1)
  assert.equal("activeDays" in result.rows[0], false)
  assert.equal(result.maxPoints, 4)
})
test("10/04～11/03 顯示五週，首日排除、末週兩日保留且雙指標明細對帳", () => {
  const days = Array.from({ length: 31 }, (_, index) => new Date(Date.UTC(2026, 9, 4 + index)).toISOString().slice(0, 10))
  const tasks = [
    { ...done("hidden", 999, "2026-10-04"), actualPoints: 999 },
    { ...done("hidden-only-member", 999, "2026-10-04", "a2"), actualPoints: 999 },
    { ...done("hidden-unassigned", 999, "2026-10-04", null), actualPoints: null },
    { ...done("first", 2, "2026-10-05"), actualPoints: 4 },
    { ...done("last-monday", 3, "2026-11-02"), actualPoints: 5 },
    { ...done("last-tuesday", 4, "2026-11-03"), actualPoints: 6 },
    { ...done("after", 999, "2026-11-04"), actualPoints: 999 },
  ]
  const input = { from: "2026-10-04", to: "2026-11-03", days, tasks, members: MEMBERS, teamOf, teamOrder }
  for (const metric of ["points", "actualPoints"]) {
    const result = computeMetricWorkloadHeatmap({ ...input, metric })
    assert.deepEqual(result.weeks.map((week) => week.start), ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"])
    assert.deepEqual(result.weeks.map((week) => week.dayCount), [7, 7, 7, 7, 2])
    assert.deepEqual(result.weeks.at(-1), { start: "2026-11-02", from: "2026-11-02", to: "2026-11-03", year: "2026", dayCount: 2 })
    assert.deepEqual(result.rows[0].cells, metric === "points" ? [2, null, null, null, 7] : [4, null, null, null, 11])
    assert.equal(result.rows[0].totalPoints, metric === "points" ? 9 : 15)
    assert.equal(result.rows[0].activeWeeks, 2)
    assert.equal(result.maxPoints, metric === "points" ? 7 : 11)
    assert.deepEqual(result.rows.map((row) => row.accountId), ["a1", "a2", null])
    for (const row of result.rows.slice(1)) {
      assert.ok(row.cells.every((value) => value === null))
      assert.equal(row.totalPoints, 0)
      assert.equal(row.activeWeeks, 0)
    }
    const selected = workloadCellTasks({ ...input, metric, week: result.weeks.at(-1), selection: { accountId: "a1", weekStart: "2026-11-02" } })
    assert.deepEqual(selected.map((task) => task.key), ["last-monday", "last-tuesday"])
    assert.equal(selected.reduce((sum, task) => sum + task[metric], 0), result.rows[0].cells.at(-1))
  }
})

test("末週受已取得日期限制，未取得週一也可顯示且不補未來日期", () => {
  const result = weekly({ from: "2026-10-04", to: "2026-11-08", days: ["2026-10-04", "2026-11-03"], tasks: [
    done("hidden", 99, "2026-10-04"), done("missing-monday", 99, "2026-11-02"),
    done("today", 2, "2026-11-03"), done("future", 99, "2026-11-04"),
  ] })
  assert.deepEqual(result.weeks, [{ start: "2026-11-02", from: "2026-11-03", to: "2026-11-03", year: "2026", dayCount: 1 }])
  assert.deepEqual(result.rows[0].cells, [2])
  assert.equal(result.rows[0].totalPoints, 2)
  assert.equal(result.rows[0].activeWeeks, 1)
})

test("週合計只在加總原始點數後取精度，不累積每日四捨五入", () => {
  const tasks = [done("A", 0.04, "2026-10-01"), done("B", 0.04, "2026-10-02")]
  const before = structuredClone(tasks)
  const result = weekly({ from: "2026-09-28", tasks })
  assert.equal(result.rows[0].cells[0], 0.1)
  assert.equal(result.rows[0].totalPoints, 0.1)
  assert.deepEqual(tasks, before)
})
test("週方格：沒有活動為 null、完成零點為 0，未指派獨立成列", () => {
  const result = weekly({ from: "2026-09-28", tasks: [done("A", 0, "2026-10-01"), done("U", 2, "2026-10-05", null)] })
  assert.deepEqual(result.rows.map((row) => row.displayName), ["Alice", "Bob", "未指派"])
  assert.deepEqual(result.rows[0].cells, [0, null])
  assert.equal(result.rows[0].activeWeeks, 1)
  assert.deepEqual(result.rows[1].cells, [null, null])
  assert.deepEqual(result.rows[2].cells, [null, 2])
})
test("週加總排除區間外及未取得日期，不因週起日提早而放寬範圍", () => {
  const result = weekly({ days: ["2026-09-30", "2026-10-01", "2026-10-05", "2026-10-07"], tasks: [
    done("before", 100, "2026-09-30"), done("missing", 100, "2026-10-02"),
    done("first", 2, "2026-10-01"), done("last", 3, "2026-10-05"), done("after", 100, "2026-10-07"),
  ] })
  assert.deepEqual(result.rows[0].cells, [3])
  assert.equal(result.rows[0].totalPoints, 3)
  assert.deepEqual(result.weeks.map((week) => week.dayCount), [1])
})
test("跨年週依週一日曆年分组，不把同一週拆成兩欄", () => {
  const result = weekly({ from: "2026-12-28", to: "2027-01-04", days: ["2026-12-31", "2027-01-01", "2027-01-03", "2027-01-04"], tasks: [
    done("A", 2, "2026-12-31"), done("B", 3, "2027-01-03"), done("C", 4, "2027-01-04"),
  ] })
  assert.deepEqual(result.weeks.map((week) => [week.start, week.year]), [["2026-12-28", "2026"], ["2027-01-04", "2027"]])
  assert.deepEqual(result.rows[0].cells, [5, 4])
})
test("週日期排序及去重；單日、空日期與未估計通知保持正確", () => {
  const result = weekly({ days: ["2026-10-05", "2026-10-01", "2026-10-05"] })
  assert.deepEqual(result.weeks.map((week) => week.start), ["2026-10-05"])
  assert.deepEqual(result.weeks.map((week) => week.dayCount), [1])
  const single = weekly({ days: ["2026-10-04"], tasks: [done("A", 1, "2026-10-04")] })
  assert.deepEqual(single.weeks, [])
  assert.deepEqual(single.rows[0].cells, [])
  assert.equal(single.rows[0].totalPoints, 0)
  assert.equal(single.maxPoints, 0)
  const monday = weekly({ from: "2026-10-05", to: "2026-10-05", days: ["2026-10-05"], tasks: [done("A", 1, "2026-10-05")] })
  assert.deepEqual(monday.rows[0].cells, [1])
  const unestimated = [{ key: "missing", assigneeAccountId: "a1", assigneeDisplayName: "Alice" }]
  const empty = weekly({ days: [], tasks: [done("A", 1, "2026-10-01")], unestimated })
  assert.deepEqual(empty.weeks, [])
  assert.ok(empty.rows.every((row) => row.cells.length === 0 && row.activeWeeks === 0 && row.totalPoints === 0))
  assert.deepEqual(empty.unestimated, unestimated)
})

test("雙指標共用週範圍，缺值不補零且 Actual-only／未指派缺值保留", () => {
  const tasks = [
    { ...done("A", null, "2026-10-01"), actualPoints: 2.04 },
    { ...done("B", 3, "2026-10-02"), actualPoints: null },
    { ...done("C", 0, "2026-10-05"), actualPoints: 0 },
    { ...done("D", null, "2026-10-01", null), actualPoints: null },
    { ...done("E", null, "2026-10-04"), actualPoints: 0.04 },
  ]
  const before = structuredClone(tasks)
  const input = { from: "2026-09-28", to: "2026-10-06", days: ["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05", "2026-10-06"], tasks, members: MEMBERS, teamOf, teamOrder,
    unestimated: [{ key: "A" }, { key: "D" }, { key: "E" }], actualUnestimated: [{ key: "B" }, { key: "D" }] }
  const sp = computeMetricWorkloadHeatmap({ ...input, metric: "points" })
  const actual = computeMetricWorkloadHeatmap({ ...input, metric: "actualPoints" })
  assert.deepEqual(sp.rows[0].cells, [3, 0])
  assert.deepEqual(actual.rows[0].cells, [2.1, 0])
  assert.deepEqual(actual.weeks, sp.weeks)
  assert.deepEqual(actual.rows.map((row) => row.accountId), ["a1", "a2", null])
  assert.deepEqual(actual.rows[2].cells, [null, null])
  assert.equal(actual.rows[0].totalPoints, 2.1)
  assert.deepEqual(sp.unestimated, input.unestimated)
  assert.deepEqual(actual.unestimated, input.actualUnestimated)
  assert.deepEqual(projectWorkloadTasks(tasks, "points").map((task) => task.key), ["B", "C"])
  assert.deepEqual(projectWorkloadTasks(tasks, "actualPoints").map((task) => task.key), ["A", "C", "E"])
  assert.deepEqual(computeMetricWorkloadHeatmap({ ...input, metric: "points" }), sp)
  assert.deepEqual(tasks, before)
})

test("週格明細只含所選成員、指標與實際日期，兩指標合計可對帳", () => {
  const task = (key, points, actualPoints, date, accountId = "a1") => ({ ...done(key, points, date, accountId), actualPoints, summary: key, status: "Done", resolution: "Fixed", parentIssueType: { status: "known", name: "Story" } })
  const tasks = [task("A", 2.04, null, "2026-12-31"), task("B", 0.04, 4, "2027-01-03"),
    task("C", null, 0, "2027-01-03"), task("D", 3, 1, "2027-01-04"),
    task("sparse", 99, 99, "2027-01-01"), task("before", 99, 99, "2026-12-27"),
    task("other", 7, 7, "2026-12-31", "a2"), task("unassigned", 0, 2, "2026-12-31", null)]
  const before = structuredClone(tasks)
  const input = { from: "2026-12-28", to: "2027-01-04", days: ["2026-12-31", "2027-01-03", "2027-01-04"], tasks, members: MEMBERS, teamOf, teamOrder }
  for (const metric of ["points", "actualPoints"]) {
    const heatmap = computeMetricWorkloadHeatmap({ ...input, metric })
    const week = heatmap.weeks[0]
    for (const accountId of ["a1", "a2", null]) {
      const selected = workloadCellTasks({ ...input, metric, week, selection: { accountId, weekStart: week.start } })
      const sum = Math.round(selected.reduce((total, value) => total + value[metric], 0) * 10) / 10
      assert.equal(sum, heatmap.rows.find((row) => row.accountId === accountId).cells[0])
      assert.ok(selected.every((value) => value.summary === value.key && value.parentIssueType.name === "Story"))
      if (accountId === "a1") assert.deepEqual(selected.map((value) => value.key), metric === "points" ? ["A", "B"] : ["B", "C"])
    }
    assert.deepEqual(workloadCellTasks({ ...input, metric, week, selection: { accountId: "a1", weekStart: "2027-01-04" } }), [])
  }
  assert.deepEqual(tasks, before)
})

// ---------------------------------------------------------------------------
// 完成日推導（`resolved` 為準）與 +0800 切日
// ---------------------------------------------------------------------------

const RANGE = { from: "2026-10-01", to: "2026-10-05" }

test("+0800 切日：UTC 深夜的完成時間算在隔天，不能直接切字串", () => {
  // 2026-11-03T16:30Z = +0800 的 2026-11-04 00:30。
  assert.equal(analysisCalendarDate("2026-11-03T16:30:00.000+0000"), "2026-11-04")
  // 這正是直接 slice(0, 10) 會出錯的地方：UTC 日期是 11-03。
  assert.equal("2026-11-03T16:30:00.000+0000".slice(0, 10), "2026-11-03")
})

test("+0800 切日：UTC 白天仍落在同一天", () => {
  assert.equal(analysisCalendarDate("2026-11-03T02:00:00.000+0000"), "2026-11-03")
  assert.equal(analysisCalendarDate("2026-11-03T15:59:59.000+0000"), "2026-11-03")
})

test("+0800 切日：Jira 若回傳帶 +0800 位移的字串，結果一致", () => {
  assert.equal(analysisCalendarDate("2026-11-04T00:30:00.000+0800"), "2026-11-04")
})

test("+0800 切日：無法辨識的值回 null，不臆測", () => {
  for (const bad of [null, undefined, "", "   ", "not-a-date", 12345, {}]) {
    assert.equal(analysisCalendarDate(bad), null, String(bad))
  }
})

test("完成日：resolved 在區間內直接用", () => {
  assert.equal(resolveCompletionDate({ resolved: "2026-10-03T12:00:00.000+0000", updated: null, range: RANGE }), "2026-10-03")
})

test("完成日：resolved 早於區間 → 整張丟棄（回 null）", () => {
  assert.equal(resolveCompletionDate({ resolved: "2026-09-30T12:00:00.000+0000", updated: "2026-10-02T12:00:00.000+0000", range: RANGE }), null)
})

test("完成日：resolved 晚於區間 → 夾到區間最後一天", () => {
  assert.equal(resolveCompletionDate({ resolved: "2026-10-20T12:00:00.000+0000", updated: null, range: RANGE }), "2026-10-05")
})

test("完成日：早於丟棄、晚於夾到末日，這個不對稱是刻意的", () => {
  const early = resolveCompletionDate({ resolved: "2026-09-01T00:00:00.000+0000", updated: null, range: RANGE })
  const late = resolveCompletionDate({ resolved: "2026-12-01T00:00:00.000+0000", updated: null, range: RANGE })
  assert.equal(early, null)
  assert.equal(late, RANGE.to)
})

test("完成日：resolved 為空時改用 updated", () => {
  assert.equal(resolveCompletionDate({ resolved: null, updated: "2026-10-02T12:00:00.000+0000", range: RANGE }), "2026-10-02")
})

test("完成日：resolved 為空且 updated 早於區間 → 同樣丟棄", () => {
  assert.equal(resolveCompletionDate({ resolved: null, updated: "2026-09-01T00:00:00.000+0000", range: RANGE }), null)
})

test("完成日：resolved 為空且 updated 晚於區間 → 同樣夾到末日", () => {
  assert.equal(resolveCompletionDate({ resolved: null, updated: "2026-11-01T00:00:00.000+0000", range: RANGE }), RANGE.to)
})

test("完成日：兩個欄位都無法解析 → 仍算在區間內完成（夾到末日），不靜默丟點", () => {
  assert.equal(resolveCompletionDate({ resolved: null, updated: null, range: RANGE }), RANGE.to)
  assert.equal(resolveCompletionDate({ resolved: "garbage", updated: "", range: RANGE }), RANGE.to)
})

test("完成日：單日查詢（ON）——resolved 早於該日丟棄、晚於該日夾到該日", () => {
  const single = { from: "2026-10-05", to: "2026-10-05" }
  assert.equal(resolveCompletionDate({ resolved: "2026-10-05T12:00:00.000+0000", updated: null, range: single }), "2026-10-05")
  assert.equal(resolveCompletionDate({ resolved: "2026-10-04T12:00:00.000+0000", updated: null, range: single }), null)
  // resolved 更晚者夾到那天：因為「那天它在動」。
  assert.equal(resolveCompletionDate({ resolved: "2026-10-09T12:00:00.000+0000", updated: null, range: single }), "2026-10-05")
})

test("完成日：+0800 邊界會改變落在哪一天，進而改變是否被丟棄", () => {
  // 2026-09-30T16:30Z = +0800 的 10-01，屬於區間（UTC 日期 09-30 則會被丟棄）。
  assert.equal(resolveCompletionDate({ resolved: "2026-09-30T16:30:00.000+0000", updated: null, range: RANGE }), "2026-10-01")
  assert.equal(resolveCompletionDate({ resolved: "2026-09-30T15:30:00.000+0000", updated: null, range: RANGE }), null)
})

import { test } from "node:test"
import assert from "node:assert/strict"

import { workloadDevTasksJql, workloadDoneDuringJql } from "../lib/jira-jql.ts"

/** 已解析、已驗證的 team-project scope（server 端 resolveDashboardScope 的輸出形狀）。 */
function scope(overrides = {}) {
  return { mode: "team-project", accountIds: ["acc-2", "acc-1"], projects: [], days: 30, ...overrides }
}

test("單日區間用 ON（DURING 需要兩個不同端點才有間隔）", () => {
  assert.equal(
    workloadDoneDuringJql({ from: "2026-10-05", to: "2026-10-05" }),
    'status CHANGED TO "Done" ON "2026-10-05"'
  )
})

test("多日區間用 DURING，且 to 不加一", () => {
  assert.equal(
    workloadDoneDuringJql({ from: "2026-10-01", to: "2026-10-05" }),
    'status CHANGED TO "Done" DURING ("2026-10-01", "2026-10-05")'
  )
})

test("區間恰好兩天仍走 DURING（端點不同）", () => {
  assert.equal(
    workloadDoneDuringJql({ from: "2026-10-01", to: "2026-10-02" }),
    'status CHANGED TO "Done" DURING ("2026-10-01", "2026-10-02")'
  )
})

test("完整查詢：精確字串，accountIds 去重、排序並加引號", () => {
  assert.equal(
    workloadDevTasksJql(scope({ accountIds: ["acc-2", "acc-1", "acc-2"] }), { from: "2026-10-01", to: "2026-10-05" }),
    'issuetype = "Dev-Task" AND status CHANGED TO "Done" DURING ("2026-10-01", "2026-10-05") AND assignee in ("acc-1", "acc-2") ORDER BY key ASC'
  )
})

test("單一成員用 assignee = 而非 in (...)", () => {
  assert.equal(
    workloadDevTasksJql(scope({ accountIds: ["acc-1"] }), { from: "2026-10-19", to: "2026-10-19" }),
    'issuetype = "Dev-Task" AND status CHANGED TO "Done" ON "2026-10-19" AND assignee = "acc-1" ORDER BY key ASC'
  )
})

test("選了專案才加 project in (...)，並排序去重", () => {
  assert.equal(
    workloadDevTasksJql(scope({ accountIds: ["acc-1"], projects: ["tkk", "sun", "tkk"] }), { from: "2026-10-01", to: "2026-10-01" }),
    'issuetype = "Dev-Task" AND status CHANGED TO "Done" ON "2026-10-01" AND assignee = "acc-1" AND project in (sun, tkk) ORDER BY key ASC'
  )
})

test("未選專案時不帶 project 條件（選填）", () => {
  assert.equal(
    workloadDevTasksJql(scope({ accountIds: ["acc-1"], projects: [] }), { from: "2026-10-01", to: "2026-10-02" }).includes("project"),
    false
  )
})

test("查詢一律不加 CHANGED FROM：加了會讓 Done→Done 的票在兩個區間都落空", () => {
  const jql = workloadDevTasksJql(scope({ accountIds: ["acc-1"] }), { from: "2026-10-01", to: "2026-10-05" })
  assert.equal(jql.includes("CHANGED FROM"), false)
})

test("查詢不使用 resolved 夾擊（撈票只看 CHANGED，resolved 僅用於判斷完成日）", () => {
  const jql = workloadDevTasksJql(scope({ accountIds: ["acc-1"] }), { from: "2026-10-01", to: "2026-10-05" })
  assert.equal(jql.includes("resolved"), false)
})

test("self 模式沒有成員範圍，一律拒絕（不退回 self 或放大查詢）", () => {
  assert.throws(
    () => workloadDevTasksJql({ mode: "self" }, { from: "2026-10-19", to: "2026-10-19" }),
    /至少選擇一個團隊/
  )
})

test("空成員名單被拒絕", () => {
  assert.throws(() => workloadDevTasksJql(scope({ accountIds: [] }), { from: "2026-10-19", to: "2026-10-19" }))
})

test("非法 accountId 被拒絕，不會進 JQL", () => {
  for (const bad of ['acc"1', "acc 1", "acc(1)", "", "a".repeat(200)]) {
    assert.throws(
      () => workloadDevTasksJql(scope({ accountIds: [bad] }), { from: "2026-10-19", to: "2026-10-19" }),
      undefined,
      bad
    )
  }
})

test("非白名單專案被拒絕", () => {
  assert.throws(() =>
    workloadDevTasksJql(scope({ accountIds: ["acc-1"], projects: ["nope"] }), { from: "2026-10-19", to: "2026-10-19" })
  )
})

test("非法日期被拒絕", () => {
  for (const bad of ["2026-02-30", "2026-1-1", "26-10-01", "", "2026-13-01"]) {
    assert.throws(() => workloadDevTasksJql(scope({ accountIds: ["acc-1"] }), { from: bad, to: bad }), undefined, bad)
  }
})

test("超過 DASHBOARD_JQL_LIMIT 的查詢被拒絕", () => {
  // 32,000 上限：以大量合規的 accountId 撐爆字串長度。
  const ids = Array.from({ length: 1000 }, (_, index) => `acc-${String(index).padStart(6, "0")}-${"x".repeat(110)}`)
  assert.throws(
    () => workloadDevTasksJql(scope({ accountIds: ids }), { from: "2026-10-19", to: "2026-10-19" }),
    /過大/
  )
})

test("區間顛倒仍先被日期驗證擋下", () => {
  assert.throws(
    () => workloadDevTasksJql(scope({ accountIds: ["acc-1"] }), { from: "2026-11-30", to: "2026-10-01" }),
    /分析區間無效/
  )
})

test("長區間不再有 60 天上限：查詢次數與天數脫鉤", () => {
  // 區間改為單次查詢後，天數只影響回應筆數，不影響請求數，因此不再設上限
  // （僅受 date-range 的畸形輸入上限 DATE_RANGE_MAX_DAYS 約束）。
  assert.match(
    workloadDevTasksJql(scope({ accountIds: ["acc-1"] }), { from: "2026-01-01", to: "2026-12-31" }),
    /DURING \("2026-01-01", "2026-12-31"\)/
  )
})
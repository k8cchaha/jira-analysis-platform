import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { chartCategoryOf, memberAnalysisDevType, summarizeMemberAnalysis, summarizeMemberAnalysisTotal } from "../lib/member-analysis.ts"
import { memberAnalysisWorkdays, pointsPerWorkday } from "../lib/member-analysis-calendar.ts"
import { memberAnalysisDevTasksJql } from "../lib/jira-jql.ts"

const issue = (overrides) => ({ key: "SUN-1", assigneeAccountId: "acc-a", assigneeDisplayName: "Ann", devType: "Dev", points: 3, actualPoints: 2, resolvedDate: "2026-11-01", ...overrides })
const groups = (row) => Object.fromEntries(row.devTypes.map((group) => [group.label, group.count]))

describe("member analysis JQL", () => {
  it("uses assignee, Dev-Task and the resolved window only", () => {
    const jql = memberAnalysisDevTasksJql({ mode: "team-project", accountIds: ["acc-b", "acc-a"], projects: [], days: 30 }, { from: "2026-01-01", to: "2026-11-03" })
    assert.equal(jql, 'assignee in ("acc-a", "acc-b") AND issuetype = "Dev-Task" AND ((resolved >= "2026-01-01" AND resolved <= "2026-11-03") OR (created >= "2026-01-01" AND created <= "2026-11-03")) ORDER BY key ASC')
    assert.doesNotMatch(jql, /project in|currentUser/)
  })
  it("adds the project restriction only when projects were selected and refuses an empty scope", () => {
    const scoped = memberAnalysisDevTasksJql({ mode: "team-project", accountIds: ["acc-a"], projects: ["sun", "tkk"], days: 30 }, { from: "2026-01-01", to: "2026-02-01" })
    assert.equal(scoped, 'assignee = "acc-a" AND issuetype = "Dev-Task" AND ((resolved >= "2026-01-01" AND resolved <= "2026-02-01") OR (created >= "2026-01-01" AND created <= "2026-02-01")) AND project in (sun, tkk) ORDER BY key ASC')
    assert.throws(() => memberAnalysisDevTasksJql({ mode: "team-project", accountIds: [], projects: [], days: 30 }, { from: "2026-01-01", to: "2026-02-01" }), /團隊/)
  })
})

describe("member analysis summary", () => {
  it("groups Dev Type values case-insensitively and keeps unknown values as 未分類", () => {
    assert.equal(memberAnalysisDevType("dev"), "Dev")
    assert.equal(memberAnalysisDevType(" Spike "), "Spike")
    assert.equal(memberAnalysisDevType("Ops"), "未分類")
    assert.equal(memberAnalysisDevType(null), "未分類")
  })
  it("aggregates per member with counts, point sums and Dev Type shares", () => {
    const rows = summarizeMemberAnalysis([
      issue({ key: "A", devType: "Dev", points: 5, actualPoints: 2 }),
      issue({ key: "B", devType: "bug", points: 2, actualPoints: 6 }),
      issue({ key: "C", assigneeAccountId: "acc-b", assigneeDisplayName: "Bob", devType: "Dev", points: 3, actualPoints: 3 }),
    ])
    assert.deepEqual(rows.map((row) => [row.displayName, row.count, row.points, row.actualPoints]), [["Ann", 2, 7, 8], ["Bob", 1, 3, 3]])
    assert.deepEqual(groups(rows[0]), { "Pre-Spike": 0, Spike: 0, Dev: 1, Bug: 1, "OP-Task": 0, "OP-Bug": 0, "未分類": 0 })
  })
  it("keeps missing points unknown instead of zero and lists 未指派 last", () => {
    const rows = summarizeMemberAnalysis([
      issue({ key: "A", assigneeAccountId: null, assigneeDisplayName: null, points: 4 }),
      issue({ key: "B", points: null, actualPoints: null }),
      issue({ key: "C", points: null, actualPoints: 1 }),
    ])
    assert.deepEqual(rows.map((row) => row.displayName), ["Ann", "未指派"])
    assert.equal(rows[0].points, null, "all missing SP stays unknown")
    assert.equal(rows[0].actualPoints, 1)
    assert.deepEqual(summarizeMemberAnalysis([]), [])
  })
  it("summarises the total row from the same issues", () => {
    const issues = [issue({ key: "A", points: 5, actualPoints: 2 }), issue({ key: "B", devType: "Bug", points: 2 })]
    const total = summarizeMemberAnalysisTotal(issues)
    // Only known values are summed: the second task has no Actual SP, so the total adds just the 2.
    assert.deepEqual([total.displayName, total.count, total.points, total.actualPoints], ["合計", 2, 7, 4])
    assert.deepEqual(groups(total), { "Pre-Spike": 0, Spike: 0, Dev: 1, Bug: 1, "OP-Task": 0, "OP-Bug": 0, "未分類": 0 })
    assert.equal(summarizeMemberAnalysisTotal([]), null)
  })
})

describe("member analysis chart categories and workdays", () => {
  it("merges Dev Types into Spike / Dev / OP / Bug and sums their SP", () => {
    const rows = summarizeMemberAnalysis([
      { key: "A", assigneeAccountId: "acc-a", assigneeDisplayName: "Ann", devType: "Pre-Spike", points: 2, actualPoints: 1, resolvedDate: "2026-11-01" },
      { key: "B", assigneeAccountId: "acc-a", assigneeDisplayName: "Ann", devType: "Spike", points: 3, actualPoints: 3, resolvedDate: "2026-11-01" },
      { key: "C", assigneeAccountId: "acc-a", assigneeDisplayName: "Ann", devType: "OP-Task", points: 5, actualPoints: 5, resolvedDate: "2026-11-01" },
      { key: "D", assigneeAccountId: "acc-a", assigneeDisplayName: "Ann", devType: "OP-Bug", points: 1, actualPoints: 1, resolvedDate: "2026-11-01" },
      { key: "E", assigneeAccountId: "acc-a", assigneeDisplayName: "Ann", devType: "Bug", points: 4, actualPoints: 4, resolvedDate: "2026-11-01" },
      { key: "F", assigneeAccountId: "acc-a", assigneeDisplayName: "Ann", devType: null, points: 7, actualPoints: 7, resolvedDate: null },
    ])
    assert.deepEqual(rows[0].categories, [{ id: "spike", points: 5 }, { id: "dev", points: 0 }, { id: "op", points: 6 }, { id: "bug", points: 4 }], "未分類不畫")
    assert.equal(rows[0].points, 22)
    assert.equal(chartCategoryOf("pre-spike"), "spike")
    assert.equal(chartCategoryOf("op-bug"), "op")
    assert.equal(chartCategoryOf("Dev"), "dev")
    assert.equal(chartCategoryOf("Ops"), null)
  })

  it("counts workdays without weekends and listed holidays", () => {
    // 2026-11-02 (Mon) .. 2026-11-08 (Sun): 5 workdays.
    assert.equal(memberAnalysisWorkdays({ from: "2026-11-02", to: "2026-11-08" }), 5)
    // 2026-10-09 (Fri) .. 2026-10-12 (Mon): 10/10 is a holiday → 2 workdays.
    assert.equal(memberAnalysisWorkdays({ from: "2026-10-09", to: "2026-10-12" }), 2)
    // Chinese New Year week 2026-02-16..2026-02-20 all holidays → 0 workdays in that block.
    assert.equal(memberAnalysisWorkdays({ from: "2026-02-16", to: "2026-02-20" }), 0)
    assert.equal(memberAnalysisWorkdays({ from: "2026-11-08", to: "2026-11-02" }), 0)
    assert.equal(pointsPerWorkday(20, 4), 5)
    assert.equal(pointsPerWorkday(null, 4), null)
    assert.equal(pointsPerWorkday(20, 0), null)
  })
})

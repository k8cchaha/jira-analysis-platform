import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { harness } from "./helpers/projects-analysis-server-harness.mjs"

describe("exact numeric issue-set Jira drilldown JQL", () => {
  it("returns null for empty selection and deduplicates/sorts deterministically without mutating input", (t) => {
    const { projectsAnalysisIssueIdsJql } = harness(t).load("lib/jira-jql.ts")
    const ids = Object.freeze(["2", "10", "1", "2", "999999999999999999999999999999"])
    assert.equal(projectsAnalysisIssueIdsJql([]), null)
    assert.equal(projectsAnalysisIssueIdsJql(ids), "id in (1, 10, 2, 999999999999999999999999999999) ORDER BY key ASC")
    assert.equal(projectsAnalysisIssueIdsJql([...ids].reverse()), projectsAnalysisIssueIdsJql(ids))
    assert.equal(projectsAnalysisIssueIdsJql(["1"]), "id in (1) ORDER BY key ASC")
    assert.deepEqual(ids, ["2", "10", "1", "2", "999999999999999999999999999999"])
  })
  it("rejects every invalid ID before deduplication instead of filtering or coercing it", (t) => {
    const h = harness(t)
    const { projectsAnalysisIssueIdsJql } = h.load("lib/jira-jql.ts")
    const { DashboardFilterError } = h.load("lib/jira-dashboard-filter.ts")
    const invalid = ["", "0", "00", "01", "-1", "+1", "1.5", "1e2", " 1", "1 ", "1\n", "１", "SUN-1", "1) OR assignee is EMPTY", "1, 2", '1"', "9".repeat(31), 1, null, undefined, {}]
    for (const id of invalid) assert.throws(() => projectsAnalysisIssueIdsJql(["1", "1", id]), DashboardFilterError)
    for (const ids of [null, undefined, "1", {}, new Set(["1"]), Array(1)]) assert.throws(() => projectsAnalysisIssueIdsJql(ids), DashboardFilterError)
    assert.throws(() => projectsAnalysisIssueIdsJql([...Array(5001).fill("1"), "invalid"]), DashboardFilterError)
  })
  it("permits more than 2,000 valid short IDs and applies length to the deduplicated query", (t) => {
    const { projectsAnalysisIssueIdsJql } = harness(t).load("lib/jira-jql.ts")
    const ids = Array.from({ length: 5000 }, (_, i) => String(i + 1))
    const query = projectsAnalysisIssueIdsJql(ids)
    assert.equal(query, `id in (${[...ids].sort().join(", ")}) ORDER BY key ASC`)
    assert.ok(query.length < 32000)
    assert.equal(projectsAnalysisIssueIdsJql(Array(5001).fill("1")), "id in (1) ORDER BY key ASC")
  })
  it("accepts raw JQL lengths below/at 32,000 and rejects even one character above", (t) => {
    const h = harness(t)
    const { projectsAnalysisIssueIdsJql } = h.load("lib/jira-jql.ts")
    const { DashboardFilterError } = h.load("lib/jira-dashboard-filter.ts")
    const longIds = Array.from({ length: 999 }, (_, i) => String(10n ** 29n + BigInt(i)))
    assert.equal(projectsAnalysisIssueIdsJql(["123456", ...longIds]).length, 31999)
    assert.equal(projectsAnalysisIssueIdsJql(["1234567", ...longIds]).length, 32000)
    assert.throws(() => projectsAnalysisIssueIdsJql(["12345678", ...longIds]), DashboardFilterError)
    assert.throws(() => projectsAnalysisIssueIdsJql([...longIds, String(10n ** 29n + 999n)]), DashboardFilterError)
  })
})

describe("central guarded Sprint analytics JQL", () => {
  it("intersects parent Project+Sprint and leaves original builders unchanged", (t) => {
    const jql = harness(t).load("lib/jira-jql.ts")
    assert.equal(jql.projectsAnalysisParentIssuesJql("SUN", 7517), "project = SUN AND sprint = 7517 AND issuetype in (story, task, bug) ORDER BY key ASC")
    assert.equal(jql.sprintParentIssuesJql(7517), "sprint = 7517 AND issuetype in (story, task, bug)")
    for (const [project, id] of [["ALL", 1], ["SUN OR 1=1", 1], ["SUN", 0], ["SUN", -1], ["SUN", "1"], ["SUN", 1.5], ["SUN", Infinity]]) assert.throws(() => jql.projectsAnalysisParentIssuesJql(project, id))
  })
  it("uses numeric parent/type IDs and omits self/completion/date predicates", (t) => {
    const jql = harness(t).load("lib/jira-jql.ts")
    assert.deepEqual(Array.from(jql.projectsAnalysisChildQueries(["2", "1", "1"], ["21", "20"], null)), ["parent in (1, 2) AND issuetype in (20, 21) ORDER BY key ASC"])
    assert.equal(jql.projectsAnalysisChildQueries(["1"], ["20", "21"], ["u-b", "u-a", "u-a"])[0], 'parent in (1) AND issuetype in (20, 21) AND assignee in ("u-a", "u-b") ORDER BY key ASC')
  })
  it("rejects empty sets, injection, unverified identities and member overflow", (t) => {
    const jql = harness(t).load("lib/jira-jql.ts")
    for (const args of [[[], ["20", "21"], null], [["1 OR 1=1"], ["20", "21"], null], [["SUN-1"], ["20", "21"], null], [["1"], [], null], [["1"], ["20", "20"], null], [["1"], ["20", "21"], []], [["1"], ["20", "21"], ['a" OR assignee is EMPTY']], [["1"], ["20", "21"], Array(1001).fill("user")]]) assert.throws(() => jql.projectsAnalysisChildQueries(...args))
  })
  it("batches parents and strictly enforces 32,000 characters without truncation", (t) => {
    const jql = harness(t).load("lib/jira-jql.ts")
    assert.equal(jql.projectsAnalysisChildQueries(Array.from({ length: 201 }, (_, i) => String(i + 1)), ["20", "21"], null).length, 3)
    const accounts = Array.from({ length: 240 }, (_, i) => `${"a".repeat(120)}-${i}`)
    const queries = jql.projectsAnalysisChildQueries(Array.from({ length: 201 }, (_, i) => String(i + 1)), ["20", "21"], accounts)
    assert.ok(queries.every((query) => query.length <= 32000))
    assert.throws(() => jql.projectsAnalysisChildQueries(["1"], ["20", "21"], Array.from({ length: 300 }, (_, i) => `${"a".repeat(120)}-${i}`)))
  })
})

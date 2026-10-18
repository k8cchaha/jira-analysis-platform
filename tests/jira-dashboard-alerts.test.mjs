import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DASHBOARD_ALERT_JQL, DASHBOARD_ALERT_KEYS, dashboardAlertJql, parseDashboardAlertResult } from "../lib/jira-dashboard-alerts.ts"
import { DashboardFilterError } from "../lib/jira-dashboard-filter.ts"

const literalQueries = {
  s0s1: 'project in (sun, tkk, jiratry, pride) and issuetype = "Bug" AND priority IN ("Critical (P0)", "High (P1)") AND (statusCategory = "To Do" or status = "In Progress")',
  s2: 'project in (sun, tkk, jiratry, pride) and issuetype = "Bug" AND priority IN ("Medium (P2)") AND (statusCategory = "To Do" or status = "In Progress") and updated < -10d',
  inReview: 'issuetype in (DEV-Task, QA-Task) and status = "In Review"',
  requestInfo: 'status = "Request Info"',
  overdue: 'duedate < startOfDay()',
  upcoming: 'duedate >= startOfDay() AND duedate < startOfDay("+3d")',
}
const bugs = { status: "success", kind: "bugs", counts: { s0s1: 0, s2: 5 } }
const pending = { status: "success", kind: "pending", counts: { inReview: 10, requestInfo: 0 } }

describe("dashboard alert JQL contract", () => {
  it("preserves the six active base queries independently", () => {
    assert.deepEqual(DASHBOARD_ALERT_JQL, literalQueries)
    assert.deepEqual(DASHBOARD_ALERT_KEYS, { bugs: ["s0s1", "s2"], pending: ["inReview", "requestInfo"], due: ["overdue", "upcoming"] })
  })
  for (const [key, base] of Object.entries(literalQueries)) {
    it(`${key}: adds self assignee without extra date restrictions`, () => {
      assert.equal(dashboardAlertJql(key, { mode: "self" }), `(${base}) AND assignee = currentUser() ORDER BY key ASC`)
    })
    it(`${key}: adds one verified account and ignores selected days`, () => {
      const scope = { mode: "person", accountIds: ["712020:fixture-user"], projects: [], days: 1 }
      const expected = `(${base}) AND assignee = "712020:fixture-user" ORDER BY key ASC`
      assert.equal(dashboardAlertJql(key, scope), expected)
      assert.equal(dashboardAlertJql(key, { ...scope, days: 365 }), expected)
    })
    it(`${key}: adds sorted deduplicated team and selected-project intersection`, () => {
      assert.equal(dashboardAlertJql(key, { mode: "team-project", accountIds: ["b", "a", "b"], projects: ["pride", "sun", "sun"], days: 7 }), `(${base}) AND assignee in ("a", "b") AND project in (pride, sun) ORDER BY key ASC`)
    })
  }
  it("does not restrict projects when none are selected", () => {
    assert.equal(dashboardAlertJql("requestInfo", { mode: "team-project", accountIds: ["a"], projects: [], days: 30 }), '(status = "Request Info") AND assignee in ("a") ORDER BY key ASC')
  })
  for (const scope of [
    { mode: "team-project", accountIds: [], projects: [], days: 30 },
    { mode: "person", accountIds: ["a", "b"], projects: [], days: 30 },
    { mode: "person", accountIds: ["a"], projects: ["sun"], days: 30 },
    { mode: "team-project", accountIds: ['a" OR 1=1'], projects: [], days: 30 },
    { mode: "team-project", accountIds: ["a"], projects: ["unknown"], days: 30 },
    { mode: "team-project", accountIds: Array.from({ length: 1001 }, (_, i) => String(i)), projects: [], days: 30 },
    { mode: "team-project", accountIds: Array.from({ length: 400 }, (_, i) => String(i) + "a".repeat(120)), projects: [], days: 30 },
  ]) it("rejects invalid or oversized resolved populations", () => assert.throws(() => dashboardAlertJql("s0s1", scope), DashboardFilterError))
  it("rejects unknown query keys rather than accepting caller JQL", () => assert.throws(() => dashboardAlertJql('arbitrary JQL', { mode: "self" }), DashboardFilterError))
})

describe("safe alert response projection", () => {
  it("accepts both complete groups including exact zero and cap counts", () => {
    assert.deepEqual(parseDashboardAlertResult("bugs", bugs), bugs)
    assert.deepEqual(parseDashboardAlertResult("pending", pending), pending)
    assert.deepEqual(parseDashboardAlertResult("bugs", { ...bugs, counts: { s0s1: 5000, s2: 5000 } }).counts, { s0s1: 5000, s2: 5000 })
  })
  it("projects only safe counts and public error fields", () => {
    assert.deepEqual(parseDashboardAlertResult("bugs", { ...bugs, accessToken: "not-real", counts: { ...bugs.counts, privateIssue: "fixture" } }), bugs)
    assert.deepEqual(parseDashboardAlertResult("pending", { status: "error", error: { code: "forbidden", message: "Fixture error", accessToken: "not-real" } }), { status: "error", error: { code: "forbidden", message: "Fixture error" } })
  })
  for (const value of [undefined, null, NaN, Infinity, -1, 0.5, "0", false, 5001, Number.MAX_SAFE_INTEGER + 1]) {
    it(`rejects invalid counts ${String(value)}`, () => assert.throws(() => parseDashboardAlertResult("bugs", { ...bugs, counts: { s0s1: value, s2: 0 } })))
  }
  for (const value of [null, [], {}, { status: "loading" }, { ...bugs, kind: "pending" }, { ...bugs, counts: [] }, { status: "error", error: { code: "unknown", message: "Fixture" } }, { status: "error", error: { code: "retry", message: "" } }]) {
    it("rejects malformed or wrong-group responses", () => assert.throws(() => parseDashboardAlertResult("bugs", value)))
  }
  it("rejects malformed pending totals", () => {
    assert.throws(() => parseDashboardAlertResult("pending", { ...pending, counts: { ...pending.counts, inReview: -1 } }))
    assert.throws(() => parseDashboardAlertResult("pending", { ...pending, counts: { ...pending.counts, requestInfo: "0" } }))
  })
})

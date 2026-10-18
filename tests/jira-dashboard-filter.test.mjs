import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  DASHBOARD_TEAMS, DASHBOARD_PROJECTS, DashboardFilterError, dashboardDays,
  parseDashboardFilter, serializeDashboardFilter, dashboardHref, dashboardReturnPath,
  dashboardFilterResult, dashboardSearchParams, includedDashboardMembers,
} from "../lib/jira-dashboard-filter.ts"
import { missingDataJql, missingDataReadJql } from "../lib/jira-missing-data.ts"

const person = { mode: "person", accountId: "712020:fixture-user", name: "Fixture User", days: 30 }
const team = { mode: "team-project", groups: ["ent-web", "ent-be1"], projects: ["tkk", "sun"], days: 7, exclusions: { "ent-web": ["user-b", "user-a", "user-a"] } }
const user = (accountId) => ({ accountId, displayName: accountId })

describe("dashboard filter model", () => {
  it("uses self and omits default parameters", () => {
    assert.deepEqual(parseDashboardFilter(new URLSearchParams()), { mode: "self" })
    assert.equal(dashboardHref({ mode: "self" }), "/dashboard")
    assert.equal(serializeDashboardFilter(person), "mode=person&accountId=712020%3Afixture-user&name=Fixture+User")
    assert.equal(parseDashboardFilter(new URLSearchParams("mode=person&accountId=user")).days, 30)
  })
  it("preserves all reference groups and projects", () => {
    assert.deepEqual(DASHBOARD_TEAMS.map(({ label, group }) => [label, group]), [
      ["Web", "ent-web"], ["BE1", "ent-be1"], ["BE2", "ent-be2"], ["Android", "ent-android"],
      ["Design", "ent-design"], ["EP", "ent-ep"], ["iOS", "ent-ios"], ["SDET", "ent-sdet"],
      ["SRE", "ent-sre"], ["Pride", "ent-pride"], ["QA", "ent-qa"],
    ])
    assert.deepEqual(DASHBOARD_PROJECTS.map(({ label, key }) => [label, key]), [["Saku", "sun"], ["Telasa", "tkk"], ["Pride", "pride"]])
  })
  it("canonicalizes repeated params and round trips the selected scope", () => {
    const query = serializeDashboardFilter(team)
    assert.equal(query, "mode=team-project&group=ent-be1&group=ent-web&exclude=ent-web%7Cuser-a&exclude=ent-web%7Cuser-b&project=sun&project=tkk&days=7")
    const parsed = parseDashboardFilter(new URLSearchParams(query))
    assert.equal(serializeDashboardFilter(parsed), query)
    assert.deepEqual(parsed.exclusions, { "ent-web": ["user-a", "user-b"] })
    assert.deepEqual(dashboardSearchParams({ group: ["ent-web", "ent-be1"], empty: undefined }).getAll("group"), ["ent-web", "ent-be1"])
  })
  it("discards irrelevant mode parameters, never restores remembered mode", () => {
    assert.deepEqual(parseDashboardFilter(new URLSearchParams("mode=self&days=broken&group=unknown")), { mode: "self" })
    assert.equal(serializeDashboardFilter(parseDashboardFilter(new URLSearchParams("mode=person&accountId=user&group=ent-web&project=pride"))), "mode=person&accountId=user")
  })
  for (const days of ["0", "-1", "1.5", "1e2", "1abc", "", " 3 ", "9007199254740992", "Infinity"]) {
    it(`rejects invalid days ${JSON.stringify(days)}`, () => assert.throws(() => dashboardDays(days), DashboardFilterError))
  }
  it("allows positive safe integer days without silent truncation", () => {
    assert.equal(dashboardDays("1"), 1)
    assert.equal(dashboardDays("3650"), 3650)
  })
  for (const query of [
    "mode=unknown", "mode=self&mode=person", "mode=person", "mode=person&accountId=evil%22%20OR%201%3D1",
    "mode=person&accountId=a&accountId=b", "mode=person&accountId=a&days=1&days=2", "mode=team-project&project=sun",
    "mode=team-project&group=unknown", "mode=team-project&group=ent-web&project=unknown",
    "mode=team-project&group=ent-web&exclude=ent-be1%7Cuser", "mode=team-project&group=ent-web&exclude=user",
    "jql=assignee%20is%20not%20empty",
  ]) it(`rejects malformed or broadening input ${query}`, () => assert.throws(() => parseDashboardFilter(new URLSearchParams(query)), DashboardFilterError))
  it("reports invalid URL instead of defaulting to self", () => {
    assert.equal(dashboardFilterResult(new URLSearchParams("mode=person")).filter, null)
  })
  it("allows API extras without applying filter-size limits to encrypted cursors", () => {
    const params = new URLSearchParams("mode=person&accountId=user&kind=points&view=page")
    params.set("pageToken", "a".repeat(100_000))
    assert.equal(parseDashboardFilter(params, ["kind", "view", "pageToken"]).mode, "person")
    assert.throws(() => parseDashboardFilter(new URLSearchParams(`mode=person&accountId=user&name=${"a".repeat(16_500)}`)), DashboardFilterError)
  })
  it("only accepts canonical dashboard reauthorization destinations", () => {
    assert.equal(dashboardReturnPath("/dashboard?mode=person&accountId=user&days=30"), "/dashboard?mode=person&accountId=user")
    for (const path of ["https://evil.invalid/dashboard", "//evil.invalid/dashboard", "javascript:alert(1)", "/issues", "/dashboard#hash", "/dashboard?mode=person"]) assert.throws(() => dashboardReturnPath(path), DashboardFilterError)
  })
  it("unions each group's included users independently", () => {
    const members = { "ent-web": [user("a"), user("b")], "ent-be1": [user("a"), user("c")] }
    assert.deepEqual(includedDashboardMembers(["ent-web", "ent-be1"], { "ent-web": ["a"] }, members), ["a", "b", "c"])
    assert.deepEqual(includedDashboardMembers(["ent-web", "ent-be1"], { "ent-web": ["a"], "ent-be1": ["a", "c"] }, members), ["b"])
    assert.throws(() => includedDashboardMembers(["ent-web"], {}, {}), DashboardFilterError)
    assert.throws(() => includedDashboardMembers(["ent-web"], { "ent-web": ["a", "b"] }, members), DashboardFilterError)
    assert.throws(() => includedDashboardMembers(["ent-web"], {}, { "ent-web": Array.from({ length: 1001 }, (_, i) => user(`u${i}`)) }), DashboardFilterError)
  })
})

describe("scoped missing-data JQL", () => {
  it("leaves both self queries byte-for-byte unchanged", () => {
    for (const kind of ["points", "defect-cause"]) assert.equal(missingDataReadJql(kind, { mode: "self" }), missingDataJql(kind))
    assert.equal(missingDataReadJql("points", { mode: "self" }).includes("30d"), false)
  })
  it("uses Done transition for Points and created for Bug", () => {
    const scope = { mode: "person", accountIds: ["user-b", "user-a", "user-a"], projects: [], days: 30 }
    const points = missingDataReadJql("points", scope)
    const bug = missingDataReadJql("defect-cause", scope)
    assert.ok(points.includes('assignee in ("user-a", "user-b")'))
    assert.ok(points.includes("status CHANGED TO Done AFTER -30d"))
    assert.ok(points.includes("resolution in (EMPTY, Done, Fixed)"))
    assert.ok(points.includes('((status = Done and cf[13736] in (EMPTY, 0)) or (statusCategory not in ("To Do") and cf[10005] in (EMPTY, 0)))'))
    assert.equal(points.includes("project not in"), false)
    assert.equal(points.includes("currentUser"), false)
    assert.equal(points.includes("created"), false)
    assert.ok(bug.includes("created >= -30d"))
    assert.ok(bug.includes('status not in ("In Progress", "Dev Ready")'))
    assert.equal(bug.includes("CHANGED"), false)
    assert.equal(bug.includes("currentUser"), false)
  })
  it("projects intersect rather than replace original SUN/TKK/JIRATRY bug scope", () => {
    const jql = missingDataReadJql("defect-cause", { mode: "team-project", accountIds: ["a"], projects: ["pride"], days: 7 })
    assert.ok(jql.startsWith("project in (sun, tkk, jiratry)"))
    assert.ok(jql.endsWith("AND created >= -7d AND project in (pride)"))
  })
  it("fails closed on invalid IDs, empty populations, and oversized JQL", () => {
    for (const ids of [[], ['a" OR assignee is not empty'], Array.from({ length: 1001 }, (_, i) => `a${i}`), Array.from({ length: 400 }, (_, i) => `${i}${"a".repeat(120)}`)]) {
      assert.throws(() => missingDataReadJql("points", { mode: "person", accountIds: ids, projects: [], days: 30 }), DashboardFilterError)
    }
  })
})

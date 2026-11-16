import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { harness, input, fields, issueTypes, parent, task, plain } from "./helpers/projects-analysis-server-harness.mjs"

const rejects = (h, request = input, code = "invalid_response") => assert.rejects(h.getProjectsAnalysis(request), (error) => error.code === code)
const searches = (h) => h.calls.filter((call) => call.method === "POST")

describe("Projects team attribution server contract", () => {
  const member = (accountId) => ({ accountId, displayName: `Roster ${accountId}`, accountType: "atlassian" })
  const assigned = (id, accountId, overrides = {}) => task(id, "1", { assignee: accountId === null ? null : { accountId, displayName: `Returned ${accountId}` }, resolutiondate: "2026-10-25T12:00:00+0800", ...overrides })
  const groups = ["ent-android", "ent-androidtv", "ent-be1", "ent-be2", "ent-ios", "ent-web", "ent-pride", "ent-design", "ent-qa1", "ent-qa2", "ent-ep", "ent-sdet", "ent-sre"]
  const groupCalls = (h) => h.calls.filter((call) => call.path.startsWith("/rest/api/3/group/member?"))
  const emptyMembers = () => Object.fromEntries(groups.map((group) => [group, []]))
  it("selected overlapping groups reuse one complete pass for scope and later-configured ownership", async (t) => {
    const h = harness(t, { members: { "ent-be1": [member("shared"), member("be-only"), member("extra-roster")], "ent-web": [member("shared"), member("web-only")] }, tasks: [assigned("101", "shared"), assigned("102", "be-only"), assigned("103", "shared")] })
    const result = await h.getProjectsAnalysis({ ...input, groups: ["ent-web", "ent-be1"] })
    assert.deepEqual(plain(result.teamAttribution), { status: "available", byAssignee: [{ accountId: "be-only", teamId: "ent-be1" }, { accountId: "shared", teamId: "ent-web" }] })
    assert.equal(groupCalls(h).length, 2)
    assert.match(searches(h).at(-1).body.jql, /assignee in \("be-only", "extra-roster", "shared", "web-only"\)/)
    assert.equal((searches(h).at(-1).body.jql.match(/"shared"/g) ?? []).length, 1)
    assert.doesNotMatch(JSON.stringify(result), /Roster|extra-roster|web-only/)
    assert.equal(result.tasks.length, 3)
  })
  it("unrestricted classification waits until complete search and uses all 13 configured groups", async (t) => {
    const h = harness(t, { members: { ...emptyMembers(), "ent-be1": [member("shared")], "ent-web": [member("shared")], "ent-sre": [member("shared"), member("extra-roster")] }, tasks: [assigned("101", "shared"), assigned("102", "outside"), assigned("103", null)] })
    const result = await h.getProjectsAnalysis(input)
    assert.deepEqual(plain(result.teamAttribution), { status: "available", byAssignee: [{ accountId: "outside", teamId: "other" }, { accountId: "shared", teamId: "ent-sre" }] })
    assert.equal(groupCalls(h).length, 13)
    const firstLookup = h.calls.findIndex((call) => call.path.startsWith("/rest/api/3/group/member?"))
    assert.equal(h.calls.slice(firstLookup).some((call) => call.method === "POST"), false)
    assert.equal(searches(h).at(-1).body.jql, "parent in (1) AND issuetype in (20, 21) ORDER BY key ASC")
    assert.equal(result.tasks.length, 3); assert.equal(result.summaries[0].output.count, 3)
    assert.doesNotMatch(JSON.stringify(result), /Roster|extra-roster/)
    const model = h.load("lib/projects-analysis.ts")
    assert.deepEqual(plain(model.selectProjectsOutputTeamIssues(result.tasks, result.sprints[0], result.teamAttribution, ["other"]).map((row) => row.id)), ["102", "103"])
  })
  it("selected candidates do not inherit a later unselected group's overlap priority", async (t) => {
    const h = harness(t, { members: { "ent-be1": [member("shared")], "ent-web": [member("shared")], "ent-sre": [member("shared")] }, tasks: [assigned("101", "shared")] })
    const result = await h.getProjectsAnalysis({ ...input, groups: ["ent-be1", "ent-web"] })
    assert.equal(result.teamAttribution.byAssignee[0].teamId, "ent-web")
    assert.equal(groupCalls(h).some((call) => call.path.includes("ent-sre")), false)
  })
  it("no-team empty parent or child populations need no display roster requests", async (t) => {
    for (const options of [{ parents: [] }, { tasks: [] }]) {
      const h = harness(t, options)
      const result = await h.getProjectsAnalysis(input)
      assert.deepEqual(plain(result.teamAttribution), { status: "available", byAssignee: [] })
      assert.equal(groupCalls(h).length, 0)
    }
  })
  it("selected empty child population keeps selected scope eligibility and avoids a second lookup", async (t) => {
    const h = harness(t, { tasks: [] })
    const result = await h.getProjectsAnalysis({ ...input, groups: ["ent-web"] })
    assert.deepEqual(plain(result.teamAttribution), { status: "available", byAssignee: [] })
    assert.equal(groupCalls(h).length, 1)
  })
  it("unrestricted empty global rosters classify every returned nonmember as Other", async (t) => {
    const h = harness(t, { members: emptyMembers(), tasks: [assigned("101", "outside"), assigned("102", null)] })
    const result = await h.getProjectsAnalysis(input)
    assert.deepEqual(plain(result.teamAttribution), { status: "available", byAssignee: [{ accountId: "outside", teamId: "other" }] })
    assert.equal(result.summaries[0].output.count, 2)
  })
  it("global union larger than 1,000 is display-only, while selected union retains its limit", async (t) => {
    const members = { ...emptyMembers(), "ent-be1": Array.from({ length: 550 }, (_, i) => member(`be-${i}`)), "ent-web": Array.from({ length: 550 }, (_, i) => member(`web-${i}`)) }
    const h = harness(t, { members, tasks: [assigned("101", "web-549")] })
    const result = await h.getProjectsAnalysis(input)
    assert.deepEqual(plain(result.teamAttribution.byAssignee), [{ accountId: "web-549", teamId: "ent-web" }])
    assert.equal(result.tasks.length, 1)
    const selected = harness(t, { members })
    await rejects(selected, { ...input, groups: ["ent-be1", "ent-web"] }, "invalid_selection")
    assert.equal(searches(selected).length, 0)
  })
  for (const [label, groupResponse] of [
    ["malformed later group", (group) => group === "ent-be2" ? Response.json({ values: null }) : Response.json({ values: [member("returned")], total: 1, isLast: true })],
    ["403 membership permission", () => new Response("private", { status: 403 })],
    ["429 membership retry", () => new Response("private", { status: 429 })],
    ["500 membership failure", () => new Response("private", { status: 500 })],
    ["incomplete pagination", () => Response.json({ values: [], total: 2, isLast: false })],
    ["per-group over 1,000", () => Response.json({ values: [], total: 1001, isLast: false })],
  ]) it(`no-team ${label} discards all partial attribution, not the complete analysis`, async (t) => {
    const h = harness(t, { groupResponse, tasks: [assigned("101", "returned", { customfield_10005: null, customfield_13736: 2.345 }), assigned("102", null, { customfield_10005: 0, customfield_13736: null })] })
    const result = await h.getProjectsAnalysis(input)
    assert.deepEqual(plain(result.teamAttribution), { status: "unavailable", reason: "lookup_failed" })
    assert.equal(result.complete, true); assert.equal(result.tasks.length, 2); assert.equal(result.sourceIssueCount, 3)
    assert.deepEqual(plain(result.summaries[0].output), { count: 2, sp: { sum: 0, knownCount: 1, missingCount: 1 }, actualSp: { sum: 2.345, knownCount: 1, missingCount: 1 } })
    assert.equal(searches(h).at(-1).body.jql, "parent in (1) AND issuetype in (20, 21) ORDER BY key ASC")
    assert.equal(groupCalls(h).length, label === "malformed later group" ? 7 : 4)
  })
  for (const [status, optionalCode, selectedCode] of [[401, "reauthorize", "reauthorize"], [400, "configuration", "retry"], [404, "configuration", "retry"]]) it(`never converts group ${status} authorization/configuration into unavailable`, async (t) => {
    const options = { groupResponse: () => new Response("private", { status }) }
    const h = harness(t, options)
    await rejects(h, input, optionalCode)
    assert.equal(searches(h).length, 2)
    const selected = harness(t, options)
    await rejects(selected, { ...input, groups: ["ent-web"] }, selectedCode)
    assert.equal(searches(selected).length, 0)
  })
  it("concurrent optional auth failure outranks faster membership-only failure", async (t) => {
    const h = harness(t, { groupResponse: async (group) => {
      if (group === "ent-androidtv") { await new Promise((resolve) => setImmediate(resolve)); return new Response("private", { status: 401 }) }
      return Response.json({ values: null })
    } })
    await rejects(h, input, "reauthorize")
    assert.equal(groupCalls(h).length, 4)
  })
  it("optional cancellation stops later group scheduling even during a lookup failure", async (t) => {
    const controller = new AbortController()
    const h = harness(t, { groupResponse: () => Response.json({ values: null }), onCall: ({ path }) => { if (path.startsWith("/rest/api/3/group/member?")) controller.abort() } })
    await assert.rejects(h.getProjectsAnalysis(input, { signal: controller.signal }), (error) => error.code === "cancelled")
    assert.equal(groupCalls(h).length, 4)
  })
  it("optional deadline cannot be swallowed by successful or failed membership loads", async (t) => {
    for (const invalid of [false, true]) {
      let clock = Date.parse("2026-11-12T12:00:00Z")
      const h = harness(t, { clock: () => clock, groupResponse: () => Response.json(invalid ? { values: null } : { values: [], total: 0, isLast: true }), onCall: ({ path }) => { if (path.startsWith("/rest/api/3/group/member?")) clock += 120_001 } })
      await rejects(h, input, "retry")
      assert.equal(groupCalls(h).length, 4)
    }
  })
  it("credential expiry during optional classification is still a query failure", async (t) => {
    let h
    h = harness(t, { onCall: ({ path }) => { if (path.startsWith("/rest/api/3/group/member?")) h.credentials.expiresAt = 0 } })
    await rejects(h, input, "reauthorize")
    assert.equal(groupCalls(h).length, 4)
  })
  it("selected cancellation stops scheduling and never widens to unrestricted searches", async (t) => {
    const controller = new AbortController()
    const h = harness(t, { onCall: ({ path }) => { if (path.startsWith("/rest/api/3/group/member?")) controller.abort() } })
    await assert.rejects(h.getProjectsAnalysis({ ...input, groups }, { signal: controller.signal }), (error) => error.code === "cancelled")
    assert.equal(groupCalls(h).length, 4); assert.equal(searches(h).length, 0)
  })
  it("does not perform optional I/O after aggregate or source data validation failed", async (t) => {
    const h = harness(t, { tasks: [assigned("101", null, { customfield_10005: Number.MAX_VALUE }), assigned("102", null, { customfield_10005: Number.MAX_VALUE })] })
    await rejects(h)
    assert.equal(groupCalls(h).length, 0)
  })
  it("selected and global lookups share complete cached rosters without leaking extra accounts", async (t) => {
    const h = harness(t, { members: { ...emptyMembers(), "ent-web": [member("returned"), member("extra-roster")] }, tasks: [assigned("101", "returned")] })
    const selected = await h.getProjectsAnalysis({ ...input, groups: ["ent-web"] })
    const global = await h.getProjectsAnalysis(input)
    assert.equal(groupCalls(h).filter((call) => call.path.includes("groupname=ent-web&")).length, 1)
    assert.deepEqual(plain(selected.teamAttribution), plain(global.teamAttribution))
    assert.doesNotMatch(JSON.stringify(global), /extra-roster|Roster/)
  })
})

describe("Sprint analytics read-only server", () => {
  it("uses all-accessible children, not self, retains Actual-only/null/zero and full completion dates", async (t) => {
    const h = harness(t, { tasks: [task(), task("102", "1", { customfield_10005: 0, customfield_13736: null, resolutiondate: null })] })
    const data = await h.getProjectsAnalysis(input)
    assert.equal(data.complete, true); assert.equal(data.historicalSnapshot, false)
    assert.equal(data.sourceIssueCount, 3); assert.equal(data.tasks[0].resolvedDate, "2026-10-26")
    assert.equal(data.tasks[0].points, null); assert.equal(data.tasks[0].actualPoints, 2.345)
    assert.equal(data.summaries[0].outsideWindow.count, 1); assert.equal(data.summaries[0].unfinished.count, 1)
    assert.equal(data.summaries[0].output.count, 0)
    assert.ok(searches(h).every((call) => !/currentUser|assignee|created|resolutiondate/.test(call.body.jql)))
    assert.equal(h.tokenCalls(), 1); assert.equal(data.jiraBaseUrl, "https://fixture.example.invalid")
    assert.ok(!JSON.stringify(data).includes("fixture-token"))
  })
  for (const [devName, qaName] of [["DEV-Task", "QA-TASK"], [" dev-task ", " qA-tAsK "]]) {
    it(`accepts Jira type labels ${JSON.stringify([devName, qaName])} and keeps canonical DTO labels`, async (t) => {
      const externalTypes = [{ ...issueTypes[0], name: devName }, { ...issueTypes[1], name: qaName }]
      const h = harness(t, { issueTypes: externalTypes, tasks: [
        task("101", "1", { issuetype: externalTypes[0], customfield_10005: 5, resolutiondate: "2026-10-25T12:00:00+0800" }),
        task("102", "1", { issuetype: externalTypes[1], customfield_10005: 8, resolutiondate: "2026-10-25T12:00:00+0800" }),
      ] })
      const data = await h.getProjectsAnalysis(input)
      assert.deepEqual(plain(data.tasks.map((task) => task.issueType)), ["Dev-Task", "QA-Task"])
      assert.equal(data.summaries[0].output.sp.sum, 13)
      assert.equal(data.summaries[0].commitment.numerator, 5)
      assert.equal(data.summaries[0].commitment.denominator, 5)
      assert.equal(searches(h).at(-1).body.jql, "parent in (1) AND issuetype in (20, 21) ORDER BY key ASC")
    })
  }
  it("identifies returned children by discovered type ID, not their display labels", async (t) => {
    const h = harness(t, { tasks: [
      task("101", "1", { issuetype: { ...issueTypes[0], name: "DEV-TASK" } }),
      task("102", "1", { issuetype: { ...issueTypes[1], name: "Renamed QA display label" } }),
    ] })
    assert.deepEqual(plain((await h.getProjectsAnalysis(input)).tasks.map((task) => task.issueType)), ["Dev-Task", "QA-Task"])
  })
  it("uses fixed field IDs and schemas without requiring matching display names", async (t) => {
    const h = harness(t, { fields: fields.map((field, i) => ({ ...field, name: ["story points", "Actual Points", "工作類型"][i] })) })
    const data = await h.getProjectsAnalysis(input)
    assert.equal(data.tasks[0].actualPoints, 2.345)
    assert.equal(data.tasks[0].devType, "Dev")
  })
  for (const parentType of [" story ", "TASK", "bUg"]) {
    it(`accepts parent type ${JSON.stringify(parentType)} without changing the parent scope`, async (t) => {
      const p = parent()
      p.fields.issuetype.name = parentType
      const h = harness(t, { parents: [p] })
      assert.equal((await h.getProjectsAnalysis(input)).tasks.length, 1)
      assert.equal(searches(h)[0].body.jql, "project = SUN AND sprint = 7517 AND issuetype in (story, task, bug) ORDER BY key ASC")
    })
  }
  it("fully pages both parent and child queries before producing summaries", async (t) => {
    const h = harness(t, { pageSize: 1, parents: [parent("1"), parent("2")], tasks: [task(), task("102", "2", { issuetype: issueTypes[1], resolutiondate: "2026-10-25T15:59:59Z" })] })
    const data = await h.getProjectsAnalysis(input)
    assert.equal(searches(h).length, 4); assert.equal(data.sourceIssueCount, 4)
    assert.equal(data.tasks[1].issueType, "QA-Task"); assert.equal(data.summaries[0].output.count, 1)
  })
  it("rejects a later-page failure instead of returning partial numbers", async (t) => {
    const h = harness(t, { pageSize: 1, tasks: [task(), task("102")], pageError: { task: 500 } })
    await rejects(h, input, "retry")
  })
  it("deduplicates shared parents across Sprints and assigns children to both", async (t) => {
    const h = harness(t)
    const result = await h.getProjectsAnalysis({ ...input, sprintIds: [7517, 7518] })
    assert.equal(result.sourceIssueCount, 2); assert.equal(result.tasks.length, 1)
    assert.deepEqual(plain(result.tasks[0].sprintIds), [7517, 7518])
    assert.equal(result.summaries[1].output.count, 1)
  })
  it("fails conflicting repeated parent snapshots", async (t) => {
    const h = harness(t, { parentsBySprint: { 7517: [parent()], 7518: [{ ...parent(), fields: { ...parent().fields, issuetype: { id: "4", name: "Bug", subtask: false } } }] } })
    await rejects(h, { ...input, sprintIds: [7517, 7518] })
  })
  it("fails conflicting duplicate children returned across parent batches", async (t) => {
    const parents = Array.from({ length: 101 }, (_, i) => parent(String(i + 1)))
    let childBatch = 0
    const h = harness(t, { search: (body, page) => {
      if (body.jql.startsWith("project")) return page(parents, body, "parent")
      childBatch++
      return page([task("500", "1", { customfield_10005: childBatch })], body, "task")
    } })
    await rejects(h)
    assert.equal(childBatch, 2)
  })
  it("rejects contradictory enhanced-search termination even for empty results", async (t) => {
    const h = harness(t, { search: () => Response.json({ issues: [], isLast: false }) })
    await rejects(h, input, "retry")
  })
  it("rejects duplicate issue IDs across pages through the shared strict search", async (t) => {
    const h = harness(t, { search: (body) => Response.json({ issues: [parent()], isLast: Boolean(body.nextPageToken), ...(!body.nextPageToken ? { nextPageToken: "next" } : {}) }) })
    await rejects(h, input, "retry")
  })
  it("returns an explicit complete empty population and still verifies timezone/metadata", async (t) => {
    const h = harness(t, { parents: [] })
    const result = await h.getProjectsAnalysis(input)
    assert.equal(result.sourceIssueCount, 0); assert.equal(result.tasks.length, 0)
    assert.equal(result.summaries[0].population.sp.sum, 0)
    assert.equal(h.calls.filter((call) => call.path === "/rest/api/3/myself").length, 1)
    assert.equal(searches(h).length, 1)
  })
  it("server-resolves complete groups before deduplication/assignee filtering", async (t) => {
    const members = Array.from({ length: 51 }, (_, i) => ({ accountId: `member-${i}`, displayName: `Member ${i}`, accountType: "atlassian" }))
    const h = harness(t, { members: { "ent-web": members, "ent-be1": [members[0]] }, tasks: [task("101", "1", { assignee: { accountId: "member-50", displayName: "Member 50" } })] })
    const result = await h.getProjectsAnalysis({ ...input, groups: ["ent-web", "ent-be1"] })
    assert.equal(result.tasks.length, 1)
    assert.equal(h.calls.filter((call) => call.path.startsWith("/rest/api/3/group/member?")).length, 3)
    const query = searches(h).at(-1).body.jql
    assert.equal((query.match(/"member-0"/g) ?? []).length, 1)
    assert.ok(query.includes('"member-50"')); assert.ok(!/created|currentUser/.test(query))
    assert.ok(!JSON.stringify(result).includes("Member 49"))
  })
  it("rejects empty groups without widening to all or self", async (t) => {
    const h = harness(t, { members: { "ent-web": [] } })
    await rejects(h, { ...input, groups: ["ent-web"] }, "invalid_selection")
    assert.equal(searches(h).length, 0)
  })
  it("rejects incomplete group pagination", async (t) => {
    const h = harness(t, { groupResponse: () => Response.json({ values: [], isLast: false, total: 3 }) })
    await rejects(h, { ...input, groups: ["ent-web"] }, "retry")
    assert.equal(searches(h).length, 0)
  })
  it("rejects group membership overflow before searching", async (t) => {
    const h = harness(t, { groupResponse: () => Response.json({ values: [], isLast: false, total: 1001 }) })
    await rejects(h, { ...input, groups: ["ent-web"] }, "limit")
    assert.equal(searches(h).length, 0)
  })
  it("rejects parent project/type mismatches rather than widening the population", async (t) => {
    for (const invalidParent of [parent("1", "TKK"), { ...parent(), fields: { ...parent().fields, issuetype: { id: "3", name: "Epic", subtask: false } } }]) {
      const h = harness(t, { parents: [invalidParent] })
      await rejects(h)
    }
  })
  it("does not infer completion from current status on reopened work", async (t) => {
    const h = harness(t, { tasks: [
      task("101", "1", { status: { name: "In Progress" }, resolutiondate: null }),
      task("102", "1", { status: { name: "In Progress" }, resolutiondate: "2026-10-25T12:00:00+0800" }),
    ] })
    const result = await h.getProjectsAnalysis(input)
    assert.equal(result.summaries[0].unfinished.count, 1)
    assert.equal(result.summaries[0].output.count, 1)
  })
  it("retains unknown legal Dev Type options as unclassified for reconciliation", async (t) => {
    const h = harness(t, { tasks: [task("101", "1", { customfield_14642: { id: "999", value: "Future classification" }, resolutiondate: "2026-10-25T12:00:00+0800" })] })
    const result = await h.getProjectsAnalysis(input)
    assert.equal(result.tasks[0].devType, "Future classification")
    assert.equal(result.summaries[0].devTypes.find((row) => row.label === "未分類").totals.count, 1)
  })
  it("retains linked children's own Projects for pressure without expanding parent queries", async (t) => {
    const tasks = [
      { ...task("101", "1", { project: { id: "11", key: "TKK" }, customfield_10005: 5 }), key: "TKK-101" },
      task("102", "1", { customfield_10005: 3 }),
      { ...task("103", "1", { project: { id: "12", key: "OTHER" }, customfield_10005: 7 }), key: "OTHER-103" },
    ]
    const h = harness(t, { tasks })
    const result = await h.getProjectsAnalysis(input)
    assert.equal(result.tasks.find((task) => task.key === "TKK-101").projectId, "11")
    assert.equal(result.tasks.find((task) => task.key === "TKK-101").projectKey, "TKK")
    assert.equal(result.summaries[0].pressure.TKK.sp.sum, 5)
    assert.equal(result.summaries[0].pressure.SUN.sp.sum, 3)
    assert.equal(result.summaries[0].pressure.combined.sp.sum, 8)
    assert.equal(result.summaries[0].population.sp.sum, 15)
    assert.equal(result.sourceIssueCount, 4)
    assert.equal(searches(h).length, 2)
    assert.ok(searches(h)[0].body.jql.startsWith("project = SUN AND sprint = 7517"))
    assert.equal(searches(h)[1].body.jql, "parent in (1) AND issuetype in (20, 21) ORDER BY key ASC")
  })
  it("rejects a returned assignee outside the verified team", async (t) => {
    const h = harness(t)
    await rejects(h, { ...input, groups: ["ent-web"] })
  })

  for (const [name, mutation, code = "invalid_response"] of [
    ["omitted SP", (f) => { delete f.customfield_10005 }],
    ["omitted Actual SP", (f) => { delete f.customfield_13736 }],
    ["omitted Resolved", (f) => { delete f.resolutiondate }],
    ["empty Resolved", (f) => { f.resolutiondate = "" }],
    ["invalid Resolved", (f) => { f.resolutiondate = "2026-02-30T00:00:00Z" }],
    ["date-only Resolved", (f) => { f.resolutiondate = "2026-10-25" }],
    ["negative points", (f) => { f.customfield_10005 = -1 }],
    ["string Actual SP", (f) => { f.customfield_13736 = "2" }],
    ["missing assignee", (f) => { delete f.assignee }],
    ["malformed Dev Type", (f) => { f.customfield_14642 = "Dev" }],
    ["Project/key mismatch", (f) => { f.project = { id: "11", key: "TKK" } }],
    ["malformed Project ID", (f) => { f.project = { id: "not-numeric", key: "SUN" } }],
    ["malformed Project key", (f) => { f.project = { id: "11", key: "SUN OR 1=1" } }],
    ["omitted Project", (f) => { delete f.project }, "retry"],
    ["unknown parent", (f) => { f.parent = { id: "999", key: "SUN-999" } }],
    ["conflicting parent key", (f) => { f.parent = { id: "1", key: "SUN-999" } }],
    ["non-subtask type", (f) => { f.issuetype = { ...issueTypes[0], subtask: false } }],
    ["wrong issue type ID", (f) => { f.issuetype = { ...issueTypes[0], id: "22" } }],
  ]) it(`fails closed on ${name}`, async (t) => {
    const child = task(); mutation(child.fields)
    const h = harness(t, { tasks: [child], search: (body, page) => page(body.jql.startsWith("project") ? [parent()] : [child], body, "task") })
    await rejects(h, input, code)
  })

  for (const [name, options] of [
    ["missing field", { fields: fields.slice(1) }],
    ["wrong schema", { fields: [{ ...fields[0], schema: { type: "string" } }, ...fields.slice(1)] }],
    ["malformed scoped field must not fall back", { fields: [...fields, { ...fields[0], schema: null, scope: { type: "PROJECT", project: { id: "10" } } }] }],
    ["unknown scoped field must not fall back", { fields: [...fields, { ...fields[0], scope: { type: "PROJECT", project: {} } }] }],
    ["ambiguous scoped fields", { fields: [...fields, ...[0, 1].map(() => ({ ...fields[0], scope: { type: "PROJECT", project: { id: "10" } } }))] }],
    ["non-subtask metadata", { issueTypes: [{ ...issueTypes[0], subtask: false }, issueTypes[1]] }],
    ["invalid type ID", { issueTypes: [{ ...issueTypes[0], name: "DEV-Task", id: "not-numeric" }, issueTypes[1]] }],
    ["duplicate Dev/QA type IDs", { issueTypes: [issueTypes[0], { ...issueTypes[1], id: issueTypes[0].id }] }],
    ["unrelated type name", { issueTypes: [{ ...issueTypes[0], name: "Dev-Task-Other" }, issueTypes[1]] }],
    ["ambiguous case variants", { issueTypes: [...issueTypes, { ...issueTypes[0], name: "DEV-TASK", id: "30" }] }],
    ["ambiguous types", { issueTypes: [...issueTypes, { ...issueTypes[0], id: "30" }] }],
    ["malformed scoped type must not fall back", { issueTypes: [...issueTypes, { ...issueTypes[0], id: "30", subtask: null, scope: { type: "PROJECT", project: { id: "10" } } }] }],
  ]) it(`rejects metadata: ${name}`, async (t) => { const h = harness(t, options); await rejects(h, input, "metadata"); assert.equal(searches(h).length, 0) })

  it("ignores valid metadata scoped to a different project", async (t) => {
    const h = harness(t, { fields: [...fields, { ...fields[0], schema: null, scope: { type: "PROJECT", project: { id: "99" } } }] })
    assert.equal((await h.getProjectsAnalysis(input)).tasks.length, 1)
  })
  for (const [name, profile] of [
    ["wrong viewer", { accountId: "other-user", timeZone: "Asia/Taipei" }],
    ["missing timezone", { accountId: "fixture-viewer" }],
    ["invalid timezone", { accountId: "fixture-viewer", timeZone: "Not/A_Zone" }],
    ["offset timezone", { accountId: "fixture-viewer", timeZone: "+08:00" }],
  ]) it(`rejects verified profile: ${name}`, async (t) => { const h = harness(t, { profile }); await rejects(h); assert.equal(searches(h).length, 0) })

  it("projects offset/DST instants in the verified account timezone without cutoff", async (t) => {
    const h = harness(t, { profile: { accountId: "fixture-viewer", timeZone: "America/New_York" }, tasks: [
      task("101", "1", { resolutiondate: "2026-11-01T01:30:00-04:00" }),
      task("102", "1", { resolutiondate: "2026-11-01T01:30:00-05:00" }),
      task("103", "1", { resolutiondate: "2026-12-01T00:00:00Z" }),
    ] })
    assert.deepEqual(plain((await h.getProjectsAnalysis(input)).tasks.map((task) => task.resolvedDate)), ["2026-11-01", "2026-11-01", "2026-11-30"])
  })
  it("normalizes unpadded configured dates and recomputes ended eligibility", async (t) => {
    const h = harness(t, { now: "2026-11-03T00:01:00Z", parents: [] })
    const result = await h.getProjectsAnalysis({ ...input, project: "PRIDE", sprintIds: [7750], browserTimeZone: "UTC" })
    assert.equal(result.sprints[0].endDate, "2026-11-02")
    const early = harness(t, { now: "2026-11-03T00:01:00Z" })
    await rejects(early, { ...input, project: "PRIDE", sprintIds: [7750], browserTimeZone: "America/Los_Angeles" }, "invalid_selection")
    assert.equal(early.calls.length, 0)
  })
  it("reports aggregate overflow as invalid upstream data, not user selection", async (t) => {
    const h = harness(t, { tasks: [task("101", "1", { customfield_10005: Number.MAX_VALUE }), task("102", "1", { customfield_10005: Number.MAX_VALUE })] })
    await rejects(h)
  })
  it("allows exactly 5,000 unique sources after complete pagination", async (t) => {
    const h = harness(t, { tasks: Array.from({ length: 4999 }, (_, i) => task(String(1000 + i))) })
    assert.equal((await h.getProjectsAnalysis(input)).sourceIssueCount, 5000)
  })
  it("rejects 5,001 unique sources with the current limit in its message", async (t) => {
    const h = harness(t, { tasks: Array.from({ length: 5000 }, (_, i) => task(String(1000 + i))) })
    await assert.rejects(h.getProjectsAnalysis(input), (error) => error.code === "limit" && error.message.includes("5,000"))
  })
  it("does not request the next page after cancellation", async (t) => {
    const controller = new AbortController()
    const h = harness(t, { parents: [parent("1"), parent("2")], pageSize: 1, onCall: ({ method }) => { if (method === "POST") controller.abort() } })
    await assert.rejects(h.getProjectsAnalysis(input, { signal: controller.signal }), (error) => error.code === "cancelled")
    assert.equal(searches(h).length, 1)
  })
  it("enforces whole-query deadline before subsequent requests", async (t) => {
    let clock = Date.parse("2026-11-12T12:00:00Z")
    const h = harness(t, { clock: () => clock, onCall: () => { clock += 120_001 } })
    await rejects(h, input, "retry"); assert.equal(h.calls.length, 1)
  })
  it("rejects a session/token viewer mismatch before Jira I/O", async (t) => {
    const h = harness(t, { viewerId: "different-viewer" })
    await rejects(h, input, "reauthorize"); assert.equal(h.calls.length, 0)
  })
  it("checks authentication at service boundary without making Jira requests", async (t) => {
    const h = harness(t, { auth: false })
    await rejects(h, input, "reauthorize"); assert.equal(h.calls.length, 0)
  })
})

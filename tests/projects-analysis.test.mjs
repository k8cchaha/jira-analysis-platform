import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { projectsHarness, MODEL, task, resultFixture, plain } from "./helpers/projects-analysis-harness.mjs"
const model = projectsHarness().load(MODEL)
const sprint = { id: 6823, name: "Sprint 58", startDate: "2026-04-28", endDate: "2026-05-11" }
const summary = (tasks) => model.summarizeProjectsSprint(tasks, sprint)

describe("projects analysis six metrics", () => {
  it("shares Dev+QA output population with exact inclusive dates, not currently unfinished", () => {
    const tasks = [task(1), task(2, { issueType: "QA-Task", resolvedDate: "2026-05-11", points: 5 }), task(3, { resolvedDate: "2026-04-27" }), task(4, { resolvedDate: "2026-05-12" }), task(5, { resolvedDate: null }), task(6, { sprintIds: [6824] })]
    const s = summary(tasks)
    assert.equal(s.population.count, 5); assert.equal(s.output.count, 2); assert.equal(s.output.sp.sum, 8)
    assert.equal(s.outsideWindow.count, 2); assert.equal(s.unfinished.count, 1)
    for (const kind of ["output", "unfinished", "outside"]) assert.equal(model.selectProjectsMetricIssues(tasks, sprint, { kind }).length, kind === "unfinished" ? 1 : 2)
  })
  it("commitment uses Issue Type Dev-Task across all Dev Types, not Dev Type Dev", () => {
    const s = summary([task(1, { devType: "Bug", points: 4 }), task(2, { devType: "OP-Task", points: 6, resolvedDate: null }), task(3, { issueType: "QA-Task", points: 100 })])
    assert.deepEqual(plain(s.commitment), { numerator: 4, denominator: 10, value: .4, partial: false })
    assert.equal(s.commitmentPoints.all.knownCount, 2)
  })
  it("retains six exact categories plus unclassified and independent totals", () => {
    const labels = ["Pre-Spike", "Spike", "dev", "Bug", "OP-Task", "OP-Bug", "New Type", null]
    const s = summary(labels.map((devType, i) => task(i + 1, { devType, points: i, actualPoints: i * 2 })))
    assert.deepEqual(plain(s.devTypes.map((row) => row.label)), ["Pre-Spike", "Spike", "Dev", "Bug", "OP-Task", "OP-Bug", "未分類"])
    assert.equal(s.devTypes.reduce((n, row) => n + row.totals.count, 0), s.output.count)
    assert.equal(s.devTypes.reduce((n, row) => n + row.totals.sp.sum, 0), s.output.sp.sum)
    assert.equal(s.devTypes.at(-1).totals.count, 2)
  })
  it("Bug/Dev uses counts primarily, does not fold OP-Bug, and allows >100%", () => {
    const s = summary([task(1, { devType: "Bug", points: 10, actualPoints: 12 }), task(2, { devType: "Bug", points: 5, actualPoints: 8 }), task(3, { devType: "Dev", points: 3, actualPoints: 4 }), task(4, { devType: "OP-Bug", points: 99 })])
    assert.equal(s.quality.count.value, 2); assert.equal(s.quality.sp.value, 5); assert.equal(s.quality.actualSp.value, 5)
  })
  it("pressure is child's own Project within selected population, without Resolved window", () => {
    const s = summary([task(1, { projectKey: "TKK", points: 2, resolvedDate: null }), task(2, { projectKey: "SUN", points: 5, resolvedDate: "2026-06-01" }), task(3, { projectKey: "PRIDE", points: 99 })])
    assert.equal(s.pressure.TKK.sp.sum, 2); assert.equal(s.pressure.SUN.sp.sum, 5); assert.equal(s.pressure.combined.sp.sum, 7)
  })
  it("null is independent from zero/Actual-only; empty is zero, all missing is null", () => {
    const s = summary([task(1, { points: null, actualPoints: 4 }), task(2, { points: 0, actualPoints: null })])
    assert.deepEqual(plain(s.output.sp), { sum: 0, knownCount: 1, missingCount: 1 })
    assert.deepEqual(plain(s.output.actualSp), { sum: 4, knownCount: 1, missingCount: 1 })
    assert.equal(summary([]).output.sp.sum, 0)
    assert.equal(summary([task(1, { points: null })]).output.sp.sum, null)
    assert.equal(s.commitment.value, null); assert.equal(s.commitment.partial, true)
  })
  it("preserves source precision and fails on malformed or overflowing aggregates", () => {
    assert.equal(summary([task(1, { points: .04 }), task(2, { points: .04 })]).output.sp.sum, .08)
    for (const points of [undefined, "3", -1, Infinity, NaN]) assert.throws(() => summary([task(1, { points })]))
    assert.throws(() => summary([task(1, { points: Number.MAX_VALUE }), task(2, { points: Number.MAX_VALUE })]))
  })
  it("unavailable and zero denominators yield N/A, not misleading zeros", () => {
    for (const tasks of [[], [task(1, { devType: "Bug" })], [task(1, { points: null })], [task(1, { points: 0 })]]) assert.equal(summary(tasks).quality.sp.value, null)
    assert.equal(summary([]).commitment.value, null)
  })
  it("one shared task can belong to multiple Sprints without duplicated source rows", () => {
    const result = resultFixture(model, [task(1, { sprintIds: [6823, 6824] })], { project: "SUN", sprintIds: [6824, 6823], groups: [], browserTimeZone: "UTC" })
    assert.equal(result.tasks.length, 1); assert.equal(result.sourceIssueCount, 2)
    assert.deepEqual(plain(result.summaries.map((row) => row.population.count)), [1, 1])
    assert.equal(result.summaries[1].outsideWindow.count, 1)
  })
})

describe("exclusive team output and attribution DTO", () => {
  const available = (byAssignee = []) => ({ status: "available", byAssignee })
  const memberTask = (id, accountId, overrides = {}) => task(id, { assigneeAccountId: accountId, ...overrides })
  it("normalizes absent legacy attribution without fabricating Other", () => {
    const legacy = { ...resultFixture(model, [task(1)]) }
    delete legacy.teamAttribution
    assert.deepEqual(plain(model.parseProjectsAnalysisResult(legacy).teamAttribution), { status: "unavailable", reason: "not_provided" })
    for (const reason of ["lookup_failed", "not_provided"]) {
      const unavailable = { status: "unavailable", reason }
      assert.deepEqual(plain(model.parseProjectsAnalysisResult({ ...legacy, teamAttribution: unavailable }).teamAttribution), unavailable)
      assert.throws(() => model.selectProjectsOutputTeamIssues(legacy.tasks, sprint, unavailable, ["other"]))
      assert.throws(() => model.summarizeProjectsTeamOutput(legacy.tasks, sprint, unavailable, []))
    }
  })
  it("projects precisely one mapping for each non-null returned assignee and retains null Other", () => {
    const tasks = [memberTask(1, "shared"), memberTask(2, "shared"), memberTask(3, "outside"), task(4)]
    const attribution = available([{ accountId: "shared", teamId: "ent-web" }, { accountId: "outside", teamId: "other" }])
    const result = model.parseProjectsAnalysisResult({ ...resultFixture(model, tasks), teamAttribution: attribution })
    assert.deepEqual(plain(result.teamAttribution), attribution)
    assert.deepEqual(plain(model.selectProjectsOutputTeamIssues(result.tasks, sprint, attribution, ["other"]).map((row) => row.id)), ["3", "4"])
  })
  it("selected scope only accepts selected configured teams, never Other or null-assignee", () => {
    const request = { project: "SUN", sprintIds: [6823], groups: ["ent-be1", "ent-web"], browserTimeZone: "UTC" }
    const good = resultFixture(model, [memberTask(1, "shared")], request)
    const extension = (teamId) => ({ ...good, teamAttribution: available([{ accountId: "shared", teamId }]) })
    assert.equal(model.parseProjectsAnalysisResult(extension("ent-web")).teamAttribution.byAssignee[0].teamId, "ent-web")
    for (const teamId of ["other", "ent-qa1", "Web", "ent-web OR 1=1"]) assert.throws(() => model.parseProjectsAnalysisResult(extension(teamId)))
    assert.throws(() => model.parseProjectsAnalysisResult({ ...good, tasks: [task(1)], teamAttribution: available() }))
  })
  it("fails malformed supplied extensions, unsafe IDs, duplicates and missing/extra roster", () => {
    const good = resultFixture(model, [memberTask(1, "returned")])
    const row = { accountId: "returned", teamId: "ent-web" }
    for (const teamAttribution of [undefined, null, [], {}, { status: "unknown" }, { status: "unavailable", reason: "other" }, { status: "unavailable", reason: "lookup_failed", byAssignee: [] }, { status: "available" }, available(), available([row, row]), available([{ ...row, accountId: "not-returned" }]), available([row, { ...row, accountId: "extra-roster" }]), available([{ ...row, accountId: 'bad"id' }]), available([{ ...row, teamId: "unknown" }]), available([{ ...row, displayName: "Roster leak" }]), { ...available([row]), roster: [] }]) assert.throws(() => model.parseProjectsAnalysisResult({ ...good, teamAttribution }))
    for (const accountId of ["bad id", 'bad"id', "x".repeat(129)]) assert.throws(() => model.parseProjectsAnalysisResult({ ...good, tasks: [memberTask(1, accountId)] }))
  })
  it("reuses inclusive Dev+QA output and unions visible team issue sets without duplicates", () => {
    const tasks = [memberTask(1, "web", { points: .04, actualPoints: null }), memberTask(2, "qa", { issueType: "QA-Task", resolvedDate: "2026-05-11", points: .04, actualPoints: 4 }), task(3, { points: null, actualPoints: 2 }), memberTask(4, "web", { resolvedDate: null }), memberTask(5, "qa", { resolvedDate: "2026-05-12" }), memberTask(6, "web", { sprintIds: [6824] })]
    const attribution = available([{ accountId: "web", teamId: "ent-web" }, { accountId: "qa", teamId: "ent-qa1" }])
    const select = (ids) => model.selectProjectsOutputTeamIssues(tasks, sprint, attribution, ids)
    assert.deepEqual(plain(select(["ent-web", "ent-qa1", "ent-web"]).map((row) => row.id)), ["1", "2"])
    assert.deepEqual(plain(select(["ent-web", "ent-qa1", "other"]).map((row) => row.id)), ["1", "2", "3"])
    assert.deepEqual(plain(model.summarizeProjectsTeamOutput(tasks, sprint, attribution, ["ent-web", "ent-qa1", "other"])), { count: 3, sp: { sum: .08, knownCount: 2, missingCount: 1 }, actualSp: { sum: 6, knownCount: 2, missingCount: 1 } })
    assert.deepEqual(plain(model.summarizeProjectsTeamOutput(tasks, sprint, attribution, ["other"])), { count: 1, sp: { sum: null, knownCount: 0, missingCount: 1 }, actualSp: { sum: 2, knownCount: 1, missingCount: 0 } })
    assert.deepEqual(plain(model.summarizeProjectsTeamOutput(tasks, sprint, attribution, [])), plain(model.projectsWorkTotals([])))
    assert.equal(model.summarizeProjectsTeamOutput(tasks, sprint, attribution, ["ent-sre"]).sp.sum, 0)
    assert.throws(() => select(["unknown"]))
    assert.throws(() => model.selectProjectsOutputTeamIssues(tasks, sprint, available(), ["other"]))
  })
  it("keeps cross-Sprint output and Actual-only/zero independent", () => {
    const tasks = [memberTask(1, "web", { points: null, actualPoints: 2.345, resolvedDate: "2026-05-11", sprintIds: [6823, 6824] }), memberTask(2, "web", { points: 0, actualPoints: null })]
    const attribution = available([{ accountId: "web", teamId: "ent-web" }])
    const totals = model.summarizeProjectsTeamOutput(tasks, sprint, attribution, ["ent-web"])
    assert.deepEqual(plain(totals), { count: 2, sp: { sum: 0, knownCount: 1, missingCount: 1 }, actualSp: { sum: 2.345, knownCount: 1, missingCount: 1 } })
    const next = { ...sprint, id: 6824, startDate: "2026-05-11", endDate: "2026-05-25" }
    assert.deepEqual(plain(model.selectProjectsOutputTeamIssues(tasks, next, attribution, ["ent-web"]).map((row) => row.id)), ["1"])
  })
})

describe("projects request and complete DTO validation", () => {
  const request = { project: "SUN", sprintIds: [6823], groups: [], browserTimeZone: "UTC" }
  it("validates every clause and rejects duplicates, foreign IDs, unknown keys and >6", () => {
    for (const changes of [{ project: "UNKNOWN" }, { sprintIds: [] }, { sprintIds: [7401] }, { sprintIds: [6823, 6823] }, { sprintIds: [6823, 6824, 6825, 7323, 7324, 7510, 7511] }, { groups: ["unknown"] }, { groups: ["ent-web", "ent-web"] }, { browserTimeZone: "+08:00" }, { browserTimeZone: "Invalid/Zone" }, { jql: "any" }, { today: "2027-01-01" }, { accountIds: [] }]) assert.throws(() => model.parseProjectsAnalysisRequest({ ...request, ...changes }))
    assert.equal(model.projectsAnalysisFingerprint({ ...request, sprintIds: [6824, 6823], groups: ["ent-web", "ent-be1"] }), model.projectsAnalysisFingerprint({ ...request, sprintIds: [6823, 6824], groups: ["ent-be1", "ent-web"] }))
  })
  it("recomputes server today by browser zone and strictly excludes end day", () => {
    const selected = { ...request, sprintIds: [7518] }
    assert.equal(model.projectsCalendarToday("Asia/Taipei", new Date("2026-11-09T16:01:00Z")), "2026-11-10")
    assert.equal(model.projectsCalendarToday("America/Los_Angeles", new Date("2026-11-10T00:01:00Z")), "2026-11-09")
    assert.throws(() => model.resolveProjectsAnalysisSprints(selected, new Date("2026-11-09T12:00:00Z")))
    assert.equal(model.resolveProjectsAnalysisSprints(selected, new Date("2026-11-10T12:00:00Z")).length, 1)
    const pride = model.resolveProjectsAnalysisSprints({ ...request, project: "PRIDE", sprintIds: [7750] }, new Date("2026-11-03T12:00:00Z"))
    assert.equal(pride[0].endDate, "2026-11-02")
  })
  it("rejects incomplete flags, scope mismatch, omitted fields, duplicate tasks and unsafe Jira links", () => {
    const good = resultFixture(model, [task(1)])
    for (const patch of [{ complete: false }, { historicalSnapshot: true }, { schemaVersion: 2 }, { browserToday: "2027-01-01" }, { generatedAt: "2026-01-01T00:00:00Z" }, { sourceIssueCount: 1 }, { tasks: [task(1), task(1)] }, { tasks: [task(1, { points: undefined })] }, { tasks: [task(1, { resolvedDate: undefined })] }, { tasks: [task(1, { issueType: "Story" })] }, { tasks: [task(1, { issueType: ["Dev-Task"] })] }, { tasks: [task(1, { sprintIds: [6824] })] }, { jiraBaseUrl: "javascript:alert(1)" }, { jiraBaseUrl: "https://user:password@jira.example.test" }, { jiraBaseUrl: "https://jira.example.test/browse" }]) assert.throws(() => model.parseProjectsAnalysisResult({ ...good, ...patch }))
    assert.throws(() => model.parseProjectsAnalysisResult(good, { ...request, project: "TKK", sprintIds: [6619] }))
    assert.equal(model.parseProjectsAnalysisResult({ ...good, summaries: [{ fake: 999 }], token: "not-projected" }).summaries[0].output.sp.sum, 3)
    assert.equal("token" in model.parseProjectsAnalysisResult(good), false)
  })
})

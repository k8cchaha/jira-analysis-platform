import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import { describe, it } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const root = new URL("../", import.meta.url)
const compiled = new Map()
const SP = "customfield_10005"
const ACTUAL_SP = "customfield_13736"

const SPRINT = { id: 7517, name: "Sprint 70", startDate: "2026-10-13", endDate: "2026-10-25" }
const credentials = { cloudId: "fixture-cloud", accessToken: "fixture-token-not-real", viewerId: "fixture-user", expiresAt: 4_102_444_800_000 }
const plain = (value) => JSON.parse(JSON.stringify(value))
const searches = (h) => h.calls.filter((call) => call.path === "/rest/api/3/search/jql")
const markers = (tasks) => plain(tasks.map(({ key, doneBeforeStart, doneDate }) => ({ key, doneBeforeStart, doneDate })))

const parentIssues = ["SUN-50", "SUN-51"].map((key, index) => ({
  id: String(400 + index),
  key,
  // status / assignee 由撈母票時 request 取得，供「受阻母票計為已完成」與受阻彈窗
  // （母票狀態／母票 Owner）投影到各 Dev-Task。
  fields: {
    project: { id: "10" },
    summary: `Parent ${key}`,
    status: { name: index === 0 ? "Request Info" : "In Progress" },
    assignee: { accountId: index === 0 ? "u-parent-owner" : undefined, displayName: index === 0 ? "Parent Owner" : undefined },
  },
}))
const devTasks = [
  { id: "101", key: "SUN-101", summary: "Task A", points: 5, actualPoints: 6, resolvedAt: "2026-10-15T12:00:00+08:00", accountId: "u-aaa-101", status: "Done" },
  { id: "102", key: "SUN-102", summary: "Task B", points: 3, actualPoints: null, resolvedAt: "2026-10-18T12:00:00+08:00", accountId: "u-bbb-102", status: "Done" },
  { id: "103", key: "SUN-103", summary: "Task C", points: 8, actualPoints: 7, resolvedAt: "2026-10-19T12:00:00+08:00", accountId: "u-ccc-103", status: "In Progress" },
  { id: "104", key: "SUN-104", summary: "Unestimated", points: null, actualPoints: null, resolvedAt: null, accountId: "u-aaa-104", status: "To Do" },
  { id: "105", key: "SUN-105", summary: "Task D", points: 2, actualPoints: 2, resolvedAt: "2026-10-13T12:00:00+08:00", accountId: "u-bbb-105", status: "Done" },
]
const makeIssue = (task) => ({
  id: task.id,
  key: task.key,
  fields: {
    project: { id: "10" },
    summary: task.summary,
    status: task.status ? { name: task.status } : undefined,
    resolutiondate: task.resolvedAt,
    updated: task.updated,
    [SP]: task.points,
    [ACTUAL_SP]: task.actualPoints,
    assignee: task.assignee ?? { accountId: task.accountId ?? "u-fixture-dev", displayName: task.assigneeName ?? "Fixture Dev" },
    parent: { id: "450", key: task.parentKey ?? "SUN-50", fields: { issuetype: { name: task.parentType ?? "Story" } } },
  },
})

function harness(t, options = {}) {
  const calls = []
  const violations = []
  const tokenCalls = []
  const fail = (message) => {
    violations.push(message)
    throw new Error(message)
  }
  const list = options.devTasks ?? devTasks
  const parents = options.emptyParents ? [] : options.parentIssues ?? parentIssues
  const pagedResponse = (issues, body, kind) => {
    if (body.nextPageToken && options[`${kind}PageError`]) return new Response(null, { status: options[`${kind}PageError`] })
    const size = options[`${kind}PageSize`] ?? Math.max(1, issues.length)
    const prefix = `fixture-${kind}-`
    if (body.nextPageToken && !body.nextPageToken.startsWith(prefix)) return fail(`Unexpected ${kind} fixture page token`)
    const offset = body.nextPageToken ? Number(body.nextPageToken.slice(prefix.length)) : 0
    if (!Number.isSafeInteger(offset) || offset < 0) return fail(`Invalid ${kind} fixture page offset`)
    const next = offset + size < issues.length ? `${prefix}${offset + size}` : null
    return new Response(JSON.stringify({ issues: issues.slice(offset, offset + size), isLast: next === null, ...(next ? { nextPageToken: next } : {}) }), { status: 200 })
  }
  class JiraAuthorizationError extends Error {
    constructor(code) { super("Fixture authorization error"); this.code = code }
  }
  const modules = new Map()
  const globals = {
    Buffer, URL, URLSearchParams, Error, Date, Intl, FormData, AbortSignal, Request, Response,
    process: { env: { AUTH_SECRET: "unit-test-only-not-real", ATLASSIAN_JIRA_CLOUD_URL: "https://fixture.example.invalid/jira" } },
    console: { error: () => {} },
    fetch: async (url, init = {}) => {
      const prefix = `https://api.atlassian.com/ex/jira/${encodeURIComponent(options.cloudId ?? "fixture-cloud")}`
      if (!url.startsWith(prefix + "/rest/api/3/")) return fail(`Unexpected Jira origin: ${url}`)
      if (init.headers?.Authorization !== "Bearer fixture-token-not-real") return fail("Unexpected authorization fixture")
      if (init.cache !== "no-store") return fail("Jira requests must not be cached")
      const path = url.slice(prefix.length)
      const method = init.method ?? "GET"
      const body = init.body ? JSON.parse(init.body) : null
      calls.push({ path, method, body })
      // Profile lookup is deliberately isolated from search fixtures and shares the same transport contract.
      if (path === "/rest/api/3/myself") {
        if (method !== "GET" || body !== null) return fail("Profile lookup must be a body-free GET")
        if (init.headers?.Accept !== "application/json") return fail("Profile lookup must request JSON")
        if (init.redirect !== "error" || !init.signal) return fail("Profile lookup must reject redirects and use a timeout signal")
        if (options.myselfTransportError) throw new TypeError("Fixture network failure")
        if (options.myselfStatus) return new Response(null, { status: options.myselfStatus })
        if (options.myselfMalformedJson) return new Response("not-json", { status: 200 })
        const profile = Object.hasOwn(options, "profile") ? options.profile : { accountId: "fixture-user", timeZone: "Asia/Taipei" }
        return new Response(JSON.stringify(profile), { status: 200 })
      }
      if (!(path === "/rest/api/3/search/jql" && method === "POST")) return fail(`Unexpected Jira route: ${method} ${path}`)
      const jql = body.jql
      if (jql === "sprint = 7517 AND issuetype in (story, task, bug)") {
        return pagedResponse(parents, body, "parent")
      }
      const expectedParents = [...new Set(parents.map((parent) => parent.key))].sort().join(", ")
      if (jql === `parent in (${expectedParents}) AND issuetype = "Dev-Task"`) {
        if (options.allTasksError) return new Response(null, { status: options.allTasksError })
        return pagedResponse(list.map(makeIssue), body, "task")
      }
      return fail(`Unexpected search/jql: ${jql}`)
    },
  }
  const sandbox = vm.createContext(globals)
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!["lib/jira-http.ts", "lib/jira-burndown.ts", "lib/burndown-series.ts", "lib/burndown-completion.ts", "lib/burndown-status.ts", "lib/jira-dashboard.ts", "lib/date-range.ts", "lib/jira-dashboard-filter.ts", "lib/jira-dashboard-lookups.ts", "lib/jira-group-members-cache.ts", "lib/jira-fields.ts", "lib/jira-jql.ts", "lib/jira-missing-data.ts", "lib/jira-page-token.ts", "lib/jira-story-points.ts"].includes(path)) return fail(`Unexpected module: ${path}`)
    const loadedModule = { exports: {} }
    modules.set(path, loadedModule)
    if (!compiled.has(path)) {
      const filename = fileURLToPath(new URL(path, root))
      compiled.set(path, ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
      }).outputText)
    }
    const fixtureRequire = (specifier) => {
      if (specifier === "server-only") return {}
      if (specifier === "node:crypto") return require("node:crypto")
      if (specifier === "@/auth") return { auth: async () => ({ user: { id: "fixture-user" } }) }
      if (specifier === "@/lib/jira-token") return {
        JiraAuthorizationError,
        getJiraToken: async () => {
          tokenCalls.push(true)
          if (options.authError) throw new JiraAuthorizationError(options.authError)
          return { ...credentials, cloudId: options.cloudId ?? credentials.cloudId }
        },
      }
      if (specifier === "./jira-jql.ts") return load("lib/jira-jql.ts")
      if (specifier === "./jira-fields.ts") return load("lib/jira-fields.ts")
      if (specifier === "./burndown-series.ts") return load("lib/burndown-series.ts")
      if (specifier === "./date-range.ts") return load("lib/date-range.ts")
      if (specifier === "./jira-dashboard-filter.ts") return load("lib/jira-dashboard-filter.ts")
      if (specifier === "./jira-dashboard.ts") return load("lib/jira-dashboard.ts")
      if (specifier === "./jira-sprint-data.ts") return load("lib/jira-sprint-data.ts")
      if (["@/lib/jira-http", "@/lib/jira-dashboard", "@/lib/date-range", "@/lib/jira-dashboard-filter", "@/lib/jira-dashboard-lookups", "@/lib/jira-group-members-cache", "@/lib/jira-fields", "@/lib/jira-jql", "@/lib/jira-missing-data", "@/lib/jira-page-token"].includes(specifier)) return load(specifier.slice(2) + ".ts")
      if (specifier === "@/lib/burndown-series") return load("lib/burndown-series.ts")
      if (["@/lib/burndown-completion", "./burndown-completion.ts"].includes(specifier)) return load("lib/burndown-completion.ts")
      return fail(`Unexpected require: ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports) {\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  t.after(() => assert.deepEqual(violations, []))
  return {
    service: load("lib/jira-burndown.ts"),
    jql: load("lib/jira-jql.ts"),
    series: load("lib/burndown-series.ts"),
    completion: () => load("lib/burndown-completion.ts"),
    status: load("lib/burndown-status.ts"),
    calls, tokenCalls,
  }
}

describe("burndown query builders", () => {
  it("keeps complete parent/Dev scope and removes completion query APIs", (t) => {
    const h = harness(t)
    assert.equal(h.jql.sprintParentIssuesJql(7517), "sprint = 7517 AND issuetype in (story, task, bug)")
    assert.equal(h.jql.sprintParentIssuesOfTypeJql(7517, "story"), "sprint = 7517 AND issuetype = story")
    assert.equal(h.jql.sprintParentIssuesOfTypeJql(7517, "bug"), "sprint = 7517 AND issuetype = bug")
    assert.equal(h.jql.sprintDevTasksJql([" SUN-51 ", "SUN-50", "SUN-50"]), 'parent in (SUN-50, SUN-51) AND issuetype = "Dev-Task"')
    for (const name of ["sprintDevTasksResolvedOnJql", "sprintDevTasksResolvedBeforeJql", "sprintDevTasksDoneOnJql", "sprintDevTasksDoneBeforeJql"]) assert.equal(h.jql[name], undefined)
    assert.equal(h.service.iterateDoneDays, undefined)
    assert.equal(h.calls.length, 0)
  })
})

describe("pure account-timezone completion resolver", () => {
  const unfinished = { doneBeforeStart: false, doneDate: null }
  it("normalizes equivalent explicit offsets across local midnight without machine timezone", (t) => {
    const h = harness(t)
    const resolve = h.completion().createBurndownCompletionResolver("Asia/Taipei", "2026-10-13", "2026-10-25")
    for (const timestamp of ["2026-10-12T16:00:00Z", "2026-10-13T00:00:00+0800", "2026-10-13T00:00:00+08:00"]) {
      assert.deepEqual(plain(resolve(timestamp)), { doneBeforeStart: false, doneDate: "2026-10-13" })
    }
    assert.deepEqual(plain(resolve("2026-10-12T15:59:59.999Z")), { doneBeforeStart: true, doneDate: null })
    assert.deepEqual(plain(resolve("2026-10-25T15:59:59.999Z")), { doneBeforeStart: false, doneDate: "2026-10-25" })
    assert.deepEqual(plain(resolve("2026-10-25T16:00:00Z")), unfinished)
    assert.equal(h.calls.length, 0)
  })
  for (const [start, end, timestamps] of [
    ["2026-03-08", "2026-03-09", [["2026-03-08T04:59:59Z", null, true], ["2026-03-08T05:00:00Z", "2026-03-08", false], ["2026-03-08T06:59:59Z", "2026-03-08", false], ["2026-03-08T07:00:00Z", "2026-03-08", false], ["2026-03-09T03:59:59Z", "2026-03-08", false], ["2026-03-09T04:00:00Z", "2026-03-09", false]]],
    ["2026-11-01", "2026-11-02", [["2026-11-01T03:59:59Z", null, true], ["2026-11-01T04:00:00Z", "2026-11-01", false], ["2026-11-01T05:30:00Z", "2026-11-01", false], ["2026-11-01T06:30:00Z", "2026-11-01", false], ["2026-11-02T04:59:59Z", "2026-11-01", false], ["2026-11-02T05:00:00Z", "2026-11-02", false]]],
  ]) {
    it(`uses New York DST rules for ${start}`, (t) => {
      const resolve = harness(t).completion().createBurndownCompletionResolver("America/New_York", start, end)
      for (const [timestamp, doneDate, doneBeforeStart] of timestamps) assert.deepEqual(plain(resolve(timestamp)), { doneBeforeStart, doneDate })
    })
  }
  it("accepts real leap-day/month/year boundaries and absent Resolved values", (t) => {
    const create = harness(t).completion().createBurndownCompletionResolver
    for (const date of ["2026-10-31", "2026-12-31", "2028-02-29"]) {
      assert.deepEqual(plain(create("UTC", date, date)(`${date}T23:59:59Z`)), { doneBeforeStart: false, doneDate: date })
    }
    const resolve = create("UTC", "2026-10-13", "2026-10-25")
    for (const value of [null, undefined, ""]) assert.deepEqual(plain(resolve(value)), unfinished)
  })
  it("requires a usable account timezone", (t) => {
    const create = harness(t).completion().createBurndownCompletionResolver
    for (const zone of [undefined, null, "", "Not/A_Timezone", 8]) assert.throws(() => create(zone, "2026-10-13", "2026-10-25"))
  })
})

describe("Resolved aggregation shares task markers with chart and member status", () => {
  const fixtures = [
    { id: "301", key: "SUN-301", points: 5, actualPoints: 6, doneOn: "2026-10-15", resolvedAt: "2026-10-17T23:59:59+0800", status: "Done", accountId: "member-a" },
    { id: "302", key: "SUN-302", points: 3, actualPoints: 2, doneOn: null, resolvedAt: "2026-10-13T00:00:00+08:00", status: "In Progress", accountId: "member-a" },
    { id: "303", key: "SUN-303", points: 8, doneOn: "2026-10-18", resolvedAt: null, status: "In Progress", accountId: "member-b" },
    { id: "304", key: "SUN-304", points: 2, doneOn: "2026-10-18", resolvedAt: "2026-10-12T23:59:59+0800", status: "Reopened", accountId: "member-a" },
    { id: "305", key: "SUN-305", points: 4, doneOn: "2026-10-19", resolvedAt: "2026-10-25T23:59:59+0800", status: "Done", accountId: "member-a" },
    { id: "306", key: "SUN-306", points: 6, doneOn: "2026-10-19", resolvedAt: "2026-10-26T00:00:00+08:00", status: "Done", accountId: "member-b" },
    { id: "307", key: "SUN-307", points: 0, doneOn: "2026-10-15", resolvedAt: "2026-10-17T12:00:00+08:00", status: "Done", accountId: "member-a" },
    { id: "308", key: "SUN-308", points: null, doneOn: "2026-10-15", resolvedAt: "2026-10-17T12:00:00+08:00", status: "Done", accountId: "member-a" },
  ]
  it("uses only Resolved (including cleared/retained reopened dates) and keeps totals/blocked override", async (t) => {
    const h = harness(t, { devTasks: fixtures })
    const data = await h.service.getBurndownData(SPRINT, "2026-10-19")
    assert.equal(data.totalPoints, 28)
    assert.equal(data.unestimated[0].key, "SUN-308")
    const byKey = new Map(data.tasks.map((task) => [task.key, task]))
    assert.equal(byKey.get("SUN-301").doneDate, "2026-10-17", "Resolved differs from Done transition")
    assert.equal(byKey.get("SUN-302").doneDate, "2026-10-13", "no current Done requirement")
    assert.equal(byKey.get("SUN-303").doneDate, null, "cleared Resolved never falls back to transition")
    assert.equal(byKey.get("SUN-304").doneBeforeStart, true, "retained reopened date counts before start")
    assert.equal(byKey.get("SUN-304").doneDate, null)
    assert.equal(byKey.get("SUN-305").doneDate, null, "future Resolved is outside the current visible cutoff")
    assert.equal(byKey.get("SUN-306").doneDate, null, "after-Sprint date is not clamped")
    assert.equal(byKey.get("SUN-307").doneDate, "2026-10-17", "zero SP remains estimated")
    assert.equal(data.days[0].donePoints, 2)
    assert.equal(data.days.find((day) => day.date === "2026-10-17").donePoints, 5)
    assert.equal(data.days.find((day) => day.date === "2026-10-19").remainingPoints, 18)
    const queries = searches(h).map((call) => call.body.jql)
    assert.equal(queries.length, 2)
    assert.ok(queries.every((query) => !/resolved|CHANGED|updated/.test(query)))
    const series = h.series.computeBurndownSeries({ startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: data.today, tasks: data.tasks, unestimated: data.unestimated, accountIds: new Set(["member-a"]) })
    const teams = h.status.computeBurndownStatus({ tasks: series.tasks, today: data.today, teamOf: () => "Web", teamOrder: ["Web"] })
    assert.equal(series.totalPoints, 14)
    assert.equal(teams[0].doneTasks, 4)
    assert.equal(teams[0].donePoints, series.days.reduce((sum, day) => sum + day.donePoints, 0))
    assert.equal(teams[0].doneActualPoints, 8)
    const blocked = new Set(["Request Info"])
    const blockedSeries = h.series.computeBurndownSeries({ startDate: SPRINT.startDate, endDate: SPRINT.endDate, today: data.today, tasks: data.tasks, unestimated: data.unestimated, accountIds: null, blockedParentStatuses: blocked })
    const blockedTeams = h.status.computeBurndownStatus({ tasks: blockedSeries.tasks, today: data.today, teamOf: () => "Web", teamOrder: ["Web"], blockedParentStatuses: blocked })
    assert.equal(blockedTeams[0].donePoints, 28)
    assert.equal(blockedSeries.days.find((day) => day.date === data.today).remainingPoints, 0)
  })
  it("includes the full final day, but not the following day's midnight", async (t) => {
    const h = harness(t, { devTasks: fixtures })
    const data = await h.service.getBurndownData(SPRINT, "2026-11-01")
    assert.equal(data.tasks.find((task) => task.key === "SUN-305").doneDate, "2026-10-25")
    assert.equal(data.tasks.find((task) => task.key === "SUN-306").doneDate, null)
    assert.equal(data.days.at(-1).donePoints, 4)
    assert.equal(data.days.at(-1).remainingPoints, 14)
    assert.equal(searches(h).length, 2)
  })
  it("ignores repeated Done transitions and updated fallback while retaining Resolved opening precedence", async (t) => {
    const h = harness(t, { devTasks: [
      { id: "401", key: "SUN-401", points: 5, doneDates: ["2026-10-14", "2026-10-18"], status: "Reopened", resolvedAt: "2026-10-14T12:00:00+08:00" },
      { id: "402", key: "SUN-402", points: 2, doneDates: ["2026-10-10", "2026-10-19"], status: "Reopened", resolvedAt: "2026-10-12T12:00:00+08:00" },
      { id: "403", key: "SUN-403", points: 3, doneDates: ["2026-10-13", "2026-10-18"], status: "Reopened", resolvedAt: null },
      { id: "404", key: "SUN-404", points: 4, doneOn: "2026-10-19", status: "Done", updated: "2026-10-19T12:00:00+08:00", resolvedAt: null },
    ] })
    const data = await h.service.getBurndownData(SPRINT, "2026-10-19")
    assert.equal(data.totalPoints, 14)
    const byKey = new Map(data.tasks.map((task) => [task.key, task]))
    assert.equal(byKey.get("SUN-401").doneDate, "2026-10-14", "later Done transition must not overwrite current Resolved")
    assert.equal(byKey.get("SUN-402").doneBeforeStart, true)
    assert.equal(byKey.get("SUN-402").doneDate, null, "later Done transition must not add a second completion")
    for (const key of ["SUN-403", "SUN-404"]) {
      assert.equal(byKey.get(key).doneBeforeStart, false)
      assert.equal(byKey.get(key).doneDate, null, "cleared Resolved never falls back to history, current Done, or updated")
    }
    assert.equal(data.days[0].donePoints, 2)
    assert.equal(data.days.find((day) => day.date === "2026-10-14").donePoints, 5)
    assert.equal(data.days.find((day) => day.date === "2026-10-18").donePoints, 0)
    assert.equal(data.days.find((day) => day.date === "2026-10-19").donePoints, 0)
    assert.equal(data.days.find((day) => day.date === "2026-10-19").remainingPoints, 7)
    assert.ok(searches(h).every((call) => !/status|updated|CHANGED|resolved/.test(call.body.jql)))
  })
})

describe("burndown aggregation against fixture Jira", () => {
  it("sums estimated points, lists unestimated, and builds the daily series", async (t) => {
    const h = harness(t)
    // 固定「今天」= 2026-10-19，好驗證未來日期不給剩餘點數（null）。
    const data = await h.service.getBurndownData(SPRINT, "2026-10-19")

    assert.equal(data.totalPoints, 18)
    assert.equal(data.empty, false)
    assert.equal(data.sprint.name, "Sprint 70")
    assert.equal(data.today, "2026-10-19")
    assert.equal(data.unestimated.length, 1)
    assert.equal(data.unestimated[0].key, "SUN-104")
    assert.equal(data.unestimated[0].assigneeDisplayName, "Fixture Dev")
    assert.equal(data.unestimated[0].assigneeAccountId, "u-aaa-104")
    assert.deepEqual(JSON.parse(JSON.stringify(data.unestimated[0].parentIssueType)), { status: "known", name: "Story" })

    // 撈母票的查詢有 request「status」與「assignee」欄位，才能取母票狀態與 Owner。
    const parentQuery = h.calls.find((call) =>
      call.body && call.body.jql === "sprint = 7517 AND issuetype in (story, task, bug)"
    )
    assert.ok(parentQuery, "parent query should be issued")
    assert.deepEqual(parentQuery.body.fields, ["project", "status", "assignee"])

    // tasks：只含已估計、依 key 排序的 Dev-Task，並刻好 doneDate 與 assignee。
    assert.equal(data.tasks.length, 4)
    const byKey = new Map(data.tasks.map((task) => [task.key, task]))
    assert.equal(byKey.get("SUN-101").doneDate, "2026-10-15")
    assert.equal(byKey.get("SUN-102").doneDate, "2026-10-18")
    assert.equal(byKey.get("SUN-103").doneDate, "2026-10-19")
    assert.equal(byKey.get("SUN-105").doneDate, "2026-10-13")
    assert.equal(byKey.get("SUN-101").assigneeAccountId, "u-aaa-101")
    assert.equal(byKey.get("SUN-105").assigneeAccountId, "u-bbb-105")
    // summary 與 assignee 顯示名稱已投影（供長條點擊彈窗顯示）。
    assert.equal(byKey.get("SUN-101").summary, "Task A")
    assert.equal(byKey.get("SUN-101").assigneeDisplayName, "Fixture Dev")
    // Actual Story Points 已投影（未填為 null）。
    assert.equal(byKey.get("SUN-101").actualPoints, 6)
    assert.equal(byKey.get("SUN-102").actualPoints, null)
    // 母票 type 已投影（彈窗每列左側 icon）。
    assert.deepEqual(JSON.parse(JSON.stringify(byKey.get("SUN-101").parentIssueType)), { status: "known", name: "Story" })
    // 母票目前狀態已投影（勾選「受阻母票計為已完成」用）；fixture 的母票 SUN-50 為 Request Info。
    assert.equal(byKey.get("SUN-101").parentStatus, "Request Info")
    // Dev-Task 自身的 Jira status 已投影（開發狀況未完成彈窗的 Status 欄）。
    assert.equal(byKey.get("SUN-103").status, "In Progress")
    assert.equal(byKey.get("SUN-105").status, "Done")
    // 母票目前指派人已投影（受阻彈窗的「母票 Owner」欄）；SUN-50 為 Parent Owner。
    assert.equal(byKey.get("SUN-101").parentAssigneeDisplayName, "Parent Owner")

    // 天數 = 空起點格 + start..end 的每一天。
    assert.equal(data.days.length, 14) // 起點格 + 2026-10-13 ~ 2026-10-25
    const byDate = new Map(data.days.map((day) => [day.date, day]))
    // 空起點格：startDate 前一天，remaining=total 讓兩線從初始值對齊。
    assert.equal(data.days[0].date, "2026-10-12")
    assert.equal(data.days[0].remainingPoints, 18)
    assert.equal(data.days[0].donePoints, 0)

    // 每天完成點數（只計已估計）。
    assert.equal(byDate.get("2026-10-13").donePoints, 2)
    assert.equal(byDate.get("2026-10-14").donePoints, 0)
    assert.equal(byDate.get("2026-10-15").donePoints, 5)
    assert.equal(byDate.get("2026-10-18").donePoints, 3)
    assert.equal(byDate.get("2026-10-19").donePoints, 8)

    // 剩餘點數：累計遞減；今天(10-19)之後為 null（未到、不畫）。
    // 第一天(10-13)已有 SUN-105(2) 完成 → 16。
    assert.equal(byDate.get("2026-10-13").remainingPoints, 16)
    assert.equal(byDate.get("2026-10-19").remainingPoints, 0) // 18 全完成
    assert.equal(byDate.get("2026-10-20").remainingPoints, null) // 未來不畫
    assert.equal(byDate.get("2026-10-25").remainingPoints, null)
    // 今天以前（含）全部非 null 且不增；之後全部 null。
    let last = Infinity
    for (const day of data.days) {
      if (day.date <= "2026-10-19") {
        assert.notEqual(day.remainingPoints, null)
        assert.ok(day.remainingPoints <= last, "remaining must be non-increasing")
        last = day.remainingPoints
      } else {
        assert.equal(day.remainingPoints, null)
      }
    }

    // 理想線：從空起點格（10-12）的 total 開始全程傾斜，終點(10-25)=0。
    // 第一天(10-13)已走 1/13，18 × (12/13) → 16.6。
    assert.equal(byDate.get("2026-10-13").idealPoints, 16.6)
    assert.equal(byDate.get("2026-10-25").idealPoints, 0)
  })

  it("handles empty parent set as an empty burndown without further queries", async (t) => {
    const h = harness(t, { emptyParents: true })
    const data = await h.service.getBurndownData(SPRINT)
    assert.equal(data.empty, true)
    assert.equal(data.totalPoints, 0)
    assert.equal(data.unestimated.length, 0)
    assert.equal(data.days.length, 0)
    // Empty parents need neither Dev search nor account timezone lookup.
    assert.equal(searches(h).length, 1)
    assert.equal(h.calls.length, 1)
  })

  it("marks sprint-start-before Resolved tasks and shows them as the green opening cell", async (t) => {
    // 自訂 fixture：SUN-P1 的 Resolved 在 sprint 開始（10-13）之前（10-10）。
    const preDone = [
      { id: "201", key: "SUN-P1", summary: "Pre resolved", points: 2, actualPoints: 2, resolvedAt: "2026-10-10T12:00:00+08:00", accountId: "u-pre-201" },
    ]
    const h = harness(t, { devTasks: [...preDone] })
    const data = await h.service.getBurndownData(SPRINT, "2026-10-19")
    assert.equal(data.totalPoints, 2)
    // server 已把開局前 Resolved 標記在 task 上，供站內重算與長條使用。
    const byKey = new Map(data.tasks.map((task) => [task.key, task]))
    assert.equal(byKey.get("SUN-P1").doneBeforeStart, true)
    assert.equal(byKey.get("SUN-P1").doneDate, null) // doneDate 不在 sprint 範圍內
    // 空起點格：綠色長條 = 開局前 Resolved（2）；理想/剩餘起點 = 總點數 − 開局已完成 = 0。
    assert.equal(data.days[0].date, "2026-10-12")
    assert.equal(data.days[0].remainingPoints, 0)
    assert.equal(data.days[0].idealPoints, 0)
    assert.equal(data.days[0].donePoints, 2)
    // 剩餘線自第一天起就維持 0（開局已完成已把剩餘扣光）。
    const byDate = new Map(data.days.map((day) => [day.date, day]))
    assert.equal(byDate.get("2026-10-13").remainingPoints, 0)
  })
})

describe("bulk Resolved loading and projection", () => {
  it("returns every completion marker in base and preserves metadata/field projection", async (t) => {
    const h = harness(t)
    const base = await h.service.getBurndownBase(SPRINT, "2026-10-19", credentials)
    assert.deepEqual(markers(base.tasks), [
      { key: "SUN-101", doneBeforeStart: false, doneDate: "2026-10-15" },
      { key: "SUN-102", doneBeforeStart: false, doneDate: "2026-10-18" },
      { key: "SUN-103", doneBeforeStart: false, doneDate: "2026-10-19" },
      { key: "SUN-105", doneBeforeStart: false, doneDate: "2026-10-13" },
    ])
    assert.equal(base.tasks[0].parentStatus, "Request Info")
    assert.equal(base.tasks[0].parentAssigneeDisplayName, "Parent Owner")
    assert.equal(base.tasks[0].actualPoints, 6)
    assert.equal(base.unestimated[0].key, "SUN-104")
    const requests = searches(h)
    assert.deepEqual(requests.map((call) => call.body.jql), ["sprint = 7517 AND issuetype in (story, task, bug)", 'parent in (SUN-50, SUN-51) AND issuetype = "Dev-Task"'])
    assert.deepEqual(requests[0].body.fields, ["project", "status", "assignee"])
    assert.deepEqual(new Set(requests[1].body.fields), new Set(["project", "summary", "status", "assignee", "parent", SP, ACTUAL_SP, "resolutiondate"]))
    assert.equal(h.calls.filter((call) => call.path === "/rest/api/3/myself").length, 1)
    assert.equal(h.tokenCalls.length, 0, "injected credentials are reused for profile and both scopes")
  })
  it("still verifies the account timezone for nonempty parents with no Dev tasks", async (t) => {
    const h = harness(t, { devTasks: [] })
    const base = await h.service.getBurndownBase(SPRINT, "2026-10-19", credentials)
    assert.equal(base.empty, false)
    assert.equal(base.tasks.length, 0)
    assert.equal(base.totalPoints, 0)
    assert.equal(h.calls.filter((call) => call.path === "/rest/api/3/myself").length, 1)
    assert.equal(searches(h).length, 2)
  })
  it("fully pages parents before deriving Dev scope, then pages every estimated/unestimated task", async (t) => {
    const h = harness(t, { parentPageSize: 1, taskPageSize: 1 })
    const base = await h.service.getBurndownBase(SPRINT, "2026-10-19", credentials)
    assert.deepEqual(plain(base.parentKeys), ["SUN-50", "SUN-51"])
    assert.equal(base.tasks.length, 4)
    assert.equal(base.unestimated.length, 1)
    assert.equal(base.totalPoints, 18)
    assert.equal(base.tasks.find((task) => task.key === "SUN-105").doneDate, "2026-10-13")
    const requests = searches(h)
    assert.equal(requests.length, 7)
    assert.equal(requests[0].body.nextPageToken, undefined)
    assert.equal(requests[1].body.nextPageToken, "fixture-parent-1")
    assert.ok(requests.slice(0, 2).every((call) => call.body.jql === "sprint = 7517 AND issuetype in (story, task, bug)"))
    assert.ok(requests.slice(2).every((call) => call.body.jql === 'parent in (SUN-50, SUN-51) AND issuetype = "Dev-Task"'))
    assert.deepEqual(requests.slice(2).map((call) => call.body.nextPageToken ?? null), [null, "fixture-task-1", "fixture-task-2", "fixture-task-3", "fixture-task-4"])
  })
  for (const kind of ["parent", "task"]) {
    it(`rejects later ${kind} page failures instead of returning partial base`, async (t) => {
      const h = harness(t, { [`${kind}PageSize`]: 1, [`${kind}PageError`]: 500 })
      await assert.rejects(h.service.getBurndownBase(SPRINT, "2026-10-19", credentials), (error) => error.code === "retry")
      if (kind === "parent") {
        assert.equal(h.calls.length, 2)
        assert.ok(searches(h).every((call) => call.body.jql.startsWith("sprint =")))
      } else {
        assert.equal(searches(h).filter((call) => call.body.jql.startsWith("parent in")).length, 2)
      }
    })
  }
  it("keeps Jira search count independent of Sprint duration or today", async (t) => {
    for (const [sprint, today] of [
      [{ ...SPRINT, endDate: "2026-10-13" }, "2026-10-13"],
      [SPRINT, "2026-10-19"],
      [{ ...SPRINT, startDate: "2026-01-01", endDate: "2026-12-31" }, "2026-11-09"],
      [SPRINT, "2026-10-12"],
    ]) {
      const h = harness(t)
      await h.service.getBurndownBase(sprint, today, credentials)
      assert.equal(searches(h).length, 2)
      assert.equal(h.calls.length, 3)
    }
  })
  it("uses the account timezone, including source offsets on different calendar days", async (t) => {
    const h = harness(t, { devTasks: [
      { id: "501", key: "SUN-501", points: 2, resolvedAt: "2026-10-12T16:00:00Z" },
      { id: "502", key: "SUN-502", points: 3, resolvedAt: "2026-10-13T01:00:00+0900" },
      { id: "503", key: "SUN-503", points: 5, resolvedAt: "2026-10-12T15:59:59.999Z" },
    ] })
    const base = await h.service.getBurndownBase(SPRINT, "2026-10-19", credentials)
    assert.deepEqual(markers(base.tasks), [
      { key: "SUN-501", doneBeforeStart: false, doneDate: "2026-10-13" },
      { key: "SUN-502", doneBeforeStart: false, doneDate: "2026-10-13" },
      { key: "SUN-503", doneBeforeStart: true, doneDate: null },
    ])
  })
  it("counts retained resolution independently of current Done and treats null/empty/missing as unfinished", async (t) => {
    const h = harness(t, { devTasks: [
      { id: "511", key: "SUN-511", points: 1, status: "Reopened", resolvedAt: "2026-10-15T00:00:00+0800" },
      ...[null, "", undefined].map((resolvedAt, i) => ({ id: String(512 + i), key: `SUN-${512 + i}`, points: 2, status: "Done", updated: "2026-10-15T00:00:00Z", resolvedAt })),
    ] })
    const base = await h.service.getBurndownBase(SPRINT, "2026-10-19", credentials)
    assert.equal(base.tasks[0].doneDate, "2026-10-15")
    assert.ok(base.tasks.slice(1).every((task) => !task.doneBeforeStart && task.doneDate === null))
  })
  it("clips markers to today, Sprint end and the inclusive 60th day without clamping later completions", async (t) => {
    const sprint = { ...SPRINT, startDate: "2026-01-01", endDate: "2026-04-01" }
    const h = harness(t, { devTasks: [
      { id: "521", key: "SUN-521", points: 1, resolvedAt: "2025-12-31T23:59:59+08:00" },
      { id: "522", key: "SUN-522", points: 2, resolvedAt: "2026-03-01T23:59:59+08:00" },
      { id: "523", key: "SUN-523", points: 3, resolvedAt: "2026-03-02T00:00:00+08:00" },
      { id: "524", key: "SUN-524", points: 4, resolvedAt: "2026-04-02T00:00:00+08:00" },
    ] })
    const data = await h.service.getBurndownData(sprint, "2026-04-15")
    assert.equal(h.series.burndownLastDate(sprint.startDate, sprint.endDate, "2026-04-15"), "2026-03-01")
    assert.equal(h.series.burndownLastDate(SPRINT.startDate, SPRINT.endDate, "2026-10-12"), null)
    assert.equal(h.series.burndownLastDate(SPRINT.startDate, SPRINT.endDate, "2026-10-19"), "2026-10-19")
    assert.deepEqual(markers(data.tasks), [
      { key: "SUN-521", doneBeforeStart: true, doneDate: null },
      { key: "SUN-522", doneBeforeStart: false, doneDate: "2026-03-01" },
      { key: "SUN-523", doneBeforeStart: false, doneDate: null },
      { key: "SUN-524", doneBeforeStart: false, doneDate: null },
    ])
    assert.equal(data.days.at(-1).date, "2026-03-01")
    assert.equal(data.days.at(-1).remainingPoints, 7)
    const teams = h.status.computeBurndownStatus({ tasks: data.tasks, today: data.today, teamOf: () => "Web", teamOrder: ["Web"] })
    assert.equal(teams[0].doneTasks, 2)
    assert.equal(teams[0].donePoints, 3)
  })
  it("leaves future Sprint completion unmarked but retains opening precedence", async (t) => {
    const h = harness(t, { devTasks: [
      { id: "531", key: "SUN-531", points: 2, resolvedAt: "2026-10-12T23:59:59+08:00" },
      { id: "532", key: "SUN-532", points: 3, resolvedAt: "2026-10-13T00:00:00+08:00" },
    ] })
    const base = await h.service.getBurndownBase(SPRINT, "2026-10-12", credentials)
    assert.deepEqual(markers(base.tasks), [
      { key: "SUN-531", doneBeforeStart: true, doneDate: null },
      { key: "SUN-532", doneBeforeStart: false, doneDate: null },
    ])
  })
  for (const sprint of [SPRINT, { ...SPRINT, startDate: "2026-01-01", endDate: "2026-04-01" }]) {
    it(`places the historical blocked override at visible cutoff ${sprint.endDate}`, async (t) => {
      const h = harness(t, { devTasks: [
        { id: "541", key: "SUN-541", points: 5, resolvedAt: null },
        { id: "542", key: "SUN-542", points: 2, parentKey: "SUN-51", resolvedAt: `${sprint.startDate}T00:00:00+08:00` },
      ] })
      const data = await h.service.getBurndownData(sprint, "2026-11-09")
      const blocked = new Set(["Request Info"])
      const series = h.series.computeBurndownSeries({ startDate: sprint.startDate, endDate: sprint.endDate, today: data.today, tasks: data.tasks, unestimated: data.unestimated, accountIds: null, blockedParentStatuses: blocked })
      assert.equal(series.days.at(-1).date, sprint === SPRINT ? "2026-10-25" : "2026-03-01")
      assert.equal(series.days.at(-1).blockedPoints, 5)
      assert.equal(series.days.at(-1).remainingPoints, 0)
      assert.equal(series.days[0].donePoints, 0)
      assert.equal(series.days[0].remainingPoints, 7, "blocked points are not deducted from the opening cell")
      assert.equal(series.days[1].remainingPoints, 5)
      assert.ok(series.days.slice(0, -1).every((day) => !day.blockedPoints))
    })
  }
})

describe("strict malformed resolutiondate handling", () => {
  const invalid = [
    "2026-10-15", "2026-10-15T12:00:00", " ", "not-a-date",
    "2026-02-29T00:00:00Z", "2026-04-31T00:00:00+0800", "2026-13-01T00:00:00Z",
    "2026-10-15T24:00:00Z", "2026-10-15T12:60:00Z", "2026-10-15T12:00:60Z",
    "2026-10-15T12:00:00+2400", "2026-10-15T12:00:00+08:60", "2026-10-15T12:00:00Z trailing",
    123, {}, [],
  ]
  for (const value of invalid) {
    it(`fails controlled for ${JSON.stringify(value)}, even outside the visible window`, async (t) => {
      const h = harness(t, { devTasks: [{ id: "551", key: "SUN-551", points: 2, resolvedAt: value }] })
      await assert.rejects(h.service.getBurndownBase(SPRINT, "2026-10-12", credentials), (error) => error.code === "invalid_response")
      assert.throws(() => h.completion().createBurndownCompletionResolver("Asia/Taipei", SPRINT.startDate, "2026-10-19")(value))
    })
  }
  it("validates unestimated task timestamps too instead of silently skipping malformed data", async (t) => {
    const h = harness(t, { devTasks: [{ id: "552", key: "SUN-552", points: null, resolvedAt: "2026-10-15" }] })
    await assert.rejects(h.service.getBurndownBase(SPRINT, "2026-10-19", credentials), (error) => error.code === "invalid_response")
  })
})

describe("same-account timezone lookup failures", () => {
  for (const [name, profile] of [
    ["missing timezone", { accountId: "fixture-user" }],
    ["empty timezone", { accountId: "fixture-user", timeZone: "" }],
    ["invalid timezone", { accountId: "fixture-user", timeZone: "Not/A_Timezone" }],
    ["nonstring timezone", { accountId: "fixture-user", timeZone: 8 }],
    ["different account", { accountId: "another-viewer", timeZone: "Asia/Taipei" }],
    ["missing account", { timeZone: "Asia/Taipei" }],
    ["empty account", { accountId: "", timeZone: "Asia/Taipei" }],
    ["invalid profile", null],
  ]) {
    it(`fails closed for ${name}`, async (t) => {
      const h = harness(t, { profile })
      await assert.rejects(h.service.getBurndownBase(SPRINT, "2026-10-19", credentials), (error) => error.code === "invalid_response")
    })
  }
  for (const viewerId of [undefined, null, "", " "]) {
    it(`rejects an untrusted credentials viewer ${JSON.stringify(viewerId)}`, async (t) => {
      const h = harness(t, { profile: { accountId: viewerId ?? "fixture-user", timeZone: "Asia/Taipei" } })
      await assert.rejects(h.service.getBurndownBase(SPRINT, "2026-10-19", { ...credentials, viewerId }), (error) => error.code === "invalid_response")
    })
  }
  for (const [status, code] of [[401, "reauthorize"], [403, "request_failed"], [429, "retry"], [500, "retry"], [503, "retry"]]) {
    it(`maps profile HTTP ${status} to ${code} without fallback`, async (t) => {
      const h = harness(t, { myselfStatus: status })
      await assert.rejects(h.service.getBurndownBase(SPRINT, "2026-10-19", credentials), (error) => error.code === code)
      assert.equal(h.calls.filter((call) => call.path === "/rest/api/3/myself").length, 1)
    })
  }
  it("maps profile network failures to retry", async (t) => {
    const h = harness(t, { myselfTransportError: true })
    await assert.rejects(h.service.getBurndownBase(SPRINT, "2026-10-19", credentials), (error) => error.code === "retry")
  })
  it("rejects malformed profile JSON without a guessed timezone", async (t) => {
    const h = harness(t, { myselfMalformedJson: true })
    await assert.rejects(h.service.getBurndownBase(SPRINT, "2026-10-19", credentials), (error) => error.code === "invalid_response")
  })
})
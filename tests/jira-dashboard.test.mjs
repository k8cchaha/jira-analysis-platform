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
const AP = "customfield_13736"
const DC = "customfield_20000"
const RC = "customfield_20001"
const SOL = "customfield_20002"
const IMPACT = "customfield_14848"
const singleSchema = { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" }
const multiSchema = {
  type: "array", items: "option",
  custom: "com.atlassian.jira.plugin.system.customfieldtypes:multiselect",
}
const numericMeta = { schema: { type: "number" }, operations: ["set"] }
const pointFields = [
  { id: SP, name: "Story Points", schema: { type: "number" } },
  { id: AP, name: "Actual Story Points", schema: { type: "number" } },
]
const defectFields = [
  { id: DC, name: "Defect Cause", schema: multiSchema },
  { id: RC, name: "Root Cause", schema: { type: "string" } },
  { id: SOL, name: "Solution", schema: { type: "string" } },
]
const plain = (value) => JSON.parse(JSON.stringify(value))
const pointStatus = (name = "Done", key = "done") => ({ name, statusCategory: { key } })
const pointsJql = 'issuetype in (DEV-Task, QA-Task) and resolution in (EMPTY, Done, Fixed) and ((status = Done and cf[13736] in (EMPTY, 0)) or (statusCategory not in ("To Do") and cf[10005] in (EMPTY, 0))) and assignee = currentUser()'
const pointIssue = (id, storyPoints = null, actualStoryPoints = 0, projectId = "10", status = pointStatus()) => ({
  id: String(id), key: `TEST-${id}`,
  fields: { project: { id: projectId }, summary: `Fixture ${id}`, status, [SP]: storyPoints, [AP]: actualStoryPoints },
  editmeta: { fields: { [SP]: plain(numericMeta), [AP]: plain(numericMeta) } },
})
const defectIssue = (id, options = [{ id: "7", value: "Fixture cause" }]) => ({
  id: String(id), key: `TEST-${id}`,
  fields: {
    project: { id: "10" }, summary: `Fixture ${id}`, [DC]: null,
    [RC]: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Root cause text" }] }] },
    [SOL]: "Solution text",
  },
  editmeta: { fields: { [DC]: { schema: multiSchema, operations: ["set"], allowedValues: options } } },
})
const impactFields = (schema = singleSchema) => [{ id: IMPACT, name: "Renamed impact field", schema }]
const impactIssue = (id, schema = singleSchema, options = [{ id: "7", value: "Current context" }, { id: "22", value: "Other enabled" }, { id: "8", value: "Disabled", disabled: true }], value = null) => ({
  id: String(id), key: `SUN-${id}`,
  fields: { project: { id: "10" }, summary: `Impact fixture ${id}`, status: pointStatus("To Do", "new"), assignee: { displayName: "Fixture member" }, [IMPACT]: value },
  editmeta: { fields: { [IMPACT]: { schema, operations: ["set"], allowedValues: options } } },
})
const impactChange = (id, ids = ["7"]) => ({ issueId: String(id), impactScope: ids })
const change = (id, extra = {}) => ({ issueId: String(id), storyPoints: 1.25, expectedStoryPoints: null, ...extra })

// Only these project modules and Node crypto may be loaded in the sandbox.
// Every fetch is routed to local fixtures; no real auth, process environment, or network is available.
function harness(t, options = {}) {
  const calls = []
  const violations = []
  const tokenCalls = []
  const signIns = []
  let searches = 0
  const fail = (message) => {
    violations.push(message)
    throw new Error(message)
  }
  class JiraAuthorizationError extends Error {
    constructor(code) { super("Fixture authorization error"); this.code = code }
  }
  const modules = new Map()
  const globals = {
    Buffer, URL, URLSearchParams, Error, Date, FormData, AbortSignal, Request, Response,
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
      const call = { path, method, body }
      calls.push(call)
      if (options.responseStatus) return new Response(null, { status: options.responseStatus })
      let data
      if (path === "/rest/api/3/field" && method === "GET") {
        data = options.fields ?? (options.kind === "impact-scope" ? impactFields() : pointFields)
      } else if (path === "/rest/api/3/search/jql" && method === "POST") {
        if (options.assigned) {
          const ids = (options.issues ?? []).map((issue) => issue.id).join(", ")
          if (body.jql !== `id in (${ids}) AND assignee = currentUser() AND created >= -30d`) return fail(`Unexpected assigned query: ${body.jql}`)
        } else {
          const rules = load("lib/jira-missing-data.ts")
          const resolvedScope = typeof options.scope === "function" ? options.scope() : options.scope
          const scope = resolvedScope ? rules.missingDataReadJql(options.kind ?? "points", resolvedScope) : rules.missingDataJql(options.kind ?? "points")
          if (resolvedScope && resolvedScope.mode !== "self") {
            if (body.jql !== `${scope} ORDER BY key ASC`) return fail(`Unexpected or altered scoped query: ${body.jql}`)
          } else {
            if (body.jql !== `${scope} ORDER BY key ASC` && !body.jql.startsWith(`(${scope}) AND id in (`)) return fail(`Unexpected or altered query: ${body.jql}`)
            // Impact Scope has an intentional fixed-date OR release base, not a self near-N window.
            const dateCheckedJql = options.kind === "impact-scope"
              ? body.jql.replace('and (created >= "2026-11-01" or cf[13476] = "Sprint9") ', "")
              : body.jql
            if (/\b(created|updated|resolved|resolutiondate|startOfDay|now)\b|\b30d\b/i.test(dateCheckedJql)) return fail("An unexpected date restriction leaked into missing-data JQL")
          }
        }
        data = options.search ? options.search(body, searches++) : { issues: options.issues ?? [], isLast: true }
      } else if (options.scope && path.startsWith("/rest/api/3/user?") && method === "GET") {
        const params = new URL(url).searchParams
        const accountId = params.get("accountId")
        if ([...params.keys()].join(",") !== "accountId" || !options.users?.[accountId]) return fail(`Unexpected user lookup: ${path}`)
        if (init.redirect !== "error") return fail("User lookup must reject redirects")
        data = options.users[accountId]
      } else if (options.scope && path.startsWith("/rest/api/3/group/member?") && method === "GET") {
        const params = new URL(url).searchParams
        const group = params.get("groupname")
        const members = options.groups?.[group]
        if (!members || params.get("maxResults") !== "50" || !/^\d+$/.test(params.get("startAt") ?? "")) return fail(`Unexpected group lookup: ${path}`)
        if (init.redirect !== "error") return fail("Group lookup must reject redirects")
        const startAt = Number(params.get("startAt"))
        const values = members.slice(startAt, startAt + 50)
        data = { startAt, total: members.length, values, isLast: startAt + values.length === members.length }
      } else if (/^\/rest\/api\/3\/issue\/\d+\?/.test(path) && method === "GET") {
        if (options.liveStatus) return new Response(null, { status: options.liveStatus })
        const urlObject = new URL(url)
        const resolvedScope = typeof options.scope === "function" ? options.scope() : options.scope
        if (resolvedScope && resolvedScope.mode !== "self") {
          if (urlObject.searchParams.has("expand")) return fail("Read-only issue reads must not request edit metadata")
        } else if (urlObject.searchParams.get("expand") !== "editmeta") return fail("Missing per-issue edit metadata")
        const id = path.match(/\/issue\/(\d+)/)[1]
        data = options.live ? options.live(id) : (options.issues ?? []).find((issue) => issue.id === id)
        if (!data) return fail(`Unexpected live issue read: ${id}`)
      } else if (/^\/rest\/api\/3\/issue\/\d+$/.test(path) && method === "PUT") {
        const status = options.putStatus?.(path.match(/\/issue\/(\d+)/)[1]) ?? 204
        return new Response(null, { status })
      } else {
        return fail(`Unexpected Jira route: ${method} ${path}`)
      }
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })
    },
  }
  const sandbox = vm.createContext(globals)
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!["lib/jira-http.ts", "lib/jira-dashboard.ts", "lib/date-range.ts", "lib/jira-dashboard-filter.ts", "lib/jira-dashboard-lookups.ts", "lib/jira-group-members-cache.ts", "lib/jira-fields.ts", "lib/jira-jql.ts", "lib/jira-missing-data.ts", "lib/jira-page-token.ts", "lib/jira-story-points.ts", "app/(app)/dashboard/actions.ts", "app/api/dashboard/missing-data/route.ts"].includes(path)) return fail(`Unexpected module: ${path}`)
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
      if (specifier === "@/auth") return {
        auth: async () => options.unauthenticated ? null : { user: { id: options.viewerId ?? "fixture-user" } },
        signIn: async (provider, settings) => {
          if (!options.allowSignIn) return fail("Unexpected sign-in")
          signIns.push({ provider, ...settings })
        },
      }
      if (specifier === "@/lib/jira-token") return {
        JiraAuthorizationError,
        getJiraToken: async (refresh) => {
          tokenCalls.push(refresh)
          if (options.authError) throw new JiraAuthorizationError(options.authError)
          return { cloudId: options.cloudId ?? "fixture-cloud", accessToken: "fixture-token-not-real" }
        },
      }
      if (specifier === "./jira-jql.ts") return load("lib/jira-jql.ts")
      if (specifier === "./jira-fields.ts") return load("lib/jira-fields.ts")
      if (specifier === "./date-range.ts") return load("lib/date-range.ts")
      if (specifier === "./jira-dashboard-filter.ts") return load("lib/jira-dashboard-filter.ts")
      if (["@/lib/jira-http", "@/lib/jira-dashboard", "@/lib/date-range", "@/lib/jira-dashboard-filter", "@/lib/jira-dashboard-lookups", "@/lib/jira-group-members-cache", "@/lib/jira-fields", "@/lib/jira-jql", "@/lib/jira-missing-data", "@/lib/jira-page-token"].includes(specifier)) return load(specifier.slice(2) + ".ts")
      return fail(`Unexpected require: ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports) {\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  t.after(() => assert.deepEqual(violations, []))
  return {
    service: load("lib/jira-dashboard.ts"), assigned: () => load("lib/jira-story-points.ts"),
    actions: () => load("app/(app)/dashboard/actions.ts"), route: () => load("app/api/dashboard/missing-data/route.ts"),
    filters: () => load("lib/jira-dashboard-filter.ts"), lookups: () => load("lib/jira-dashboard-lookups.ts"),
    calls, tokenCalls, signIns,
  }
}
const rejectsCode = (operation, code) => assert.rejects(operation, (error) => error.code === code)
const puts = (h) => h.calls.filter((call) => call.method === "PUT")
const liveReads = (h) => h.calls.filter((call) => call.method === "GET" && call.path.includes("/issue/"))
const fixtureUser = (accountId) => ({ accountId, displayName: `Fixture ${accountId}`, accountType: "atlassian" })
const personFilter = (days = 17, accountId = "person-1") => ({ mode: "person", accountId, name: "Chosen person", days })
const personScope = (days = 17, accountId = "person-1") => ({ mode: "person", accountIds: [accountId], projects: [], days })
const teamFilter = (extra = {}) => ({ mode: "team-project", groups: ["ent-web"], exclusions: {}, projects: ["sun"], days: 17, ...extra })
const teamScope = (extra = {}) => ({ mode: "team-project", accountIds: ["person-1"], projects: ["sun"], days: 17, ...extra })
const pagedSearch = (body) => body.nextPageToken
  ? { issues: [pointIssue(2)], isLast: true }
  : { issues: [pointIssue(1)], nextPageToken: "fixture-next", isLast: false }

describe("Impact Scope dashboard", () => {
  const self = { mode: "self" }
  const scenarios = [
    { label: "self", filter: self, scope: self },
    { label: "person", filter: personFilter(), scope: personScope(), users: { "person-1": fixtureUser("person-1") } },
    ...[[], ["sun"], ["tkk"], ["sun", "tkk"]].map((projects) => ({ label: `team ${projects.join(",")}`, filter: teamFilter({ projects }), scope: teamScope({ projects }), groups: { "ent-web": [fixtureUser("person-1")] } })),
  ]
  for (const scenario of scenarios) it(`uses identical count/detail query with metadata-independent count: ${scenario.label}`, async (t) => {
    const h = harness(t, { ...scenario, kind: "impact-scope", issues: [impactIssue(1)] })
    const summary = await h.service.getMissingDataSummary("impact-scope", scenario.filter)
    assert.equal(h.calls.some((call) => call.path === "/rest/api/3/field" || call.path.includes("/issue/")), false)
    const page = await h.service.getMissingDataPage("impact-scope", null, scenario.filter)
    const searches = h.calls.filter((call) => call.body?.jql)
    assert.equal(summary.total, 1)
    assert.equal(summary.storyPointsMissing, 0)
    assert.equal(summary.actualStoryPointsMissing, 0)
    assert.equal(searches.length, 2)
    assert.equal(searches[0].body.jql, searches[1].body.jql)
    assert.equal(summary.jql, searches[1].body.jql)
    assert.ok(summary.jql.startsWith("project = sun"))
    assert.ok(summary.jql.includes('and (created >= "2026-11-01" or cf[13476] = "Sprint9") and cf[13476] is not EMPTY and assignee'))
    assert.equal(summary.jql.includes("created >= -"), scenario.label !== "self")
    assert.equal(page.readOnly, scenario.label !== "self")
    const row = page.issues[0]
    assert.equal(row.summary, "Impact fixture 1")
    assert.equal(row.statusName, "To Do")
    assert.doesNotMatch(summary.jql, /status/i)
    assert.equal(row.assigneeDisplayName, "Fixture member")
    for (const flag of ["storyPointsRequired", "actualStoryPointsRequired", "storyPointsEditable", "actualStoryPointsEditable", "defectCauseEditable"]) assert.equal(row[flag], false)
    assert.deepEqual(plain(row.defectCauseOptions), [])
    assert.equal(row.impactScope.mode, "single")
    assert.deepEqual(plain(row.impactScope.value), [])
    assert.equal(row.impactScope.editable, scenario.label === "self")
    assert.deepEqual(plain(row.impactScope.options), scenario.label === "self" ? [{ id: "7", value: "Current context" }, { id: "22", value: "Other enabled" }] : [])
    assert.ok(searches[1].body.fields.includes(IMPACT))
    assert.ok(searches[1].body.fields.includes("status"))
    assert.ok(liveReads(h).every((call) => new URLSearchParams(call.path.split("?")[1]).get("fields").split(",").includes("status")))
    assert.equal(h.calls.filter((call) => call.path === "/rest/api/3/field").length, 1)
    assert.equal(liveReads(h).length, scenario.label === "self" ? 1 : 0)
    assert.equal(puts(h).length, 0)
  })
  it("uses the live status for self details rather than the older search status", async (t) => {
    const original = impactIssue(1)
    const live = impactIssue(1)
    live.fields.status = pointStatus("In Progress", "indeterminate")
    const h = harness(t, { kind: "impact-scope", issues: [original], live: () => live })
    const page = await h.service.getMissingDataPage("impact-scope")
    assert.equal(page.issues[0].statusName, "In Progress")
    assert.equal(page.issues[0].impactScope.editable, true)
  })
  for (const status of [undefined, null, {}, { name: " " }, { name: 123 }]) it(`keeps unavailable status neutral without disabling Impact supplementation: ${JSON.stringify(status)}`, async (t) => {
    const issue = impactIssue(1)
    issue.fields.status = status
    const h = harness(t, { kind: "impact-scope", issues: [issue] })
    const page = await h.service.getMissingDataPage("impact-scope")
    assert.equal(page.issues[0].statusName, null)
    assert.equal(page.issues[0].impactScope.editable, true)
  })
  it("counts every page and returns authenticated complete detail pages", async (t) => {
    const h = harness(t, { kind: "impact-scope", live: (id) => impactIssue(id), search: (body) => body.nextPageToken ? { issues: [impactIssue(2)], isLast: true } : { issues: [impactIssue(1)], nextPageToken: "impact-next", isLast: false } })
    assert.equal((await h.service.getMissingDataSummary("impact-scope")).total, 2)
    const first = await h.service.getMissingDataPage("impact-scope")
    const second = await h.service.getMissingDataPage("impact-scope", first.nextPageToken)
    assert.equal(second.page, 2)
    assert.equal(second.nextPageToken, null)
    assert.deepEqual(plain([...first.issues, ...second.issues].map((row) => row.id)), ["1", "2"])
    assert.ok(second.previousPageToken)
    assert.equal(second.readOnly, false)
    const otherKind = harness(t)
    await rejectsCode(() => otherKind.service.getMissingDataPage("points", first.nextPageToken), "invalid_page")
    assert.equal(otherKind.calls.length, 0)
    const otherScope = harness(t, { kind: "impact-scope", scope: personScope(), users: { "person-1": fixtureUser("person-1") } })
    await rejectsCode(() => otherScope.service.getMissingDataPage("impact-scope", first.nextPageToken, personFilter()), "invalid_page")
    assert.equal(otherScope.calls.some((call) => call.body?.jql), false)
  })
  for (const scenario of [
    { label: "duplicate issues", search: () => ({ issues: [impactIssue(1)], nextPageToken: "same", isLast: false }) },
    { label: "looping cursor", search: (_body, index) => ({ issues: [impactIssue(index + 1)], nextPageToken: "same", isLast: false }) },
    { label: "incomplete pagination", search: () => ({ issues: [impactIssue(1)] }) },
    { label: "second-page failure", search: (_body, index) => index ? { invalid: true } : { issues: [impactIssue(1)], nextPageToken: "next", isLast: false } },
  ]) it(`never publishes a partial count on ${scenario.label}`, async (t) => {
    const h = harness(t, { kind: "impact-scope", search: scenario.search })
    await rejectsCode(() => h.service.getMissingDataSummary("impact-scope"), "retry")
  })
  it("enforces the 5,000-issue complete-count limit", async (t) => {
    const h = harness(t, { kind: "impact-scope", search: (_body, index) => ({ issues: Array.from({ length: 100 }, (_, i) => impactIssue(index * 100 + i + 1)), nextPageToken: `next-${index}`, isLast: false }) })
    await rejectsCode(() => h.service.getMissingDataSummary("impact-scope"), "limit")
  })
  for (const view of ["summary", "page"]) it(`supports ${view} GET with private no-store responses`, async (t) => {
    const h = harness(t, { kind: "impact-scope", issues: [impactIssue(1)] })
    const response = await h.route().GET(new Request(`https://fixture.example.invalid/api/dashboard/missing-data?kind=impact-scope&view=${view}`))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Cache-Control"), "private, no-store")
    const payload = await response.json()
    assert.equal(payload.status, "success")
    if (view === "page") assert.equal(payload.data.readOnly, false)
    else assert.equal(payload.summary.kind, "impact-scope")
  })
  it("rejects invalid and duplicate route filters before Jira access", async (t) => {
    const h = harness(t, { kind: "impact-scope" })
    for (const extra of ["kind=points", "view=page", "mode=team-project&group=bad", "jql=project%20is%20not%20empty"]) {
      assert.equal((await h.route().GET(new Request(`https://fixture.example.invalid/api/dashboard/missing-data?kind=impact-scope&view=summary&${extra}`))).status, 400)
    }
    assert.equal(h.calls.length, 0)
  })
  it("rejects cross-kind direct and action writes before requesting write credentials", async (t) => {
    const h = harness(t, { kind: "impact-scope" })
    await rejectsCode(() => h.service.updateMissingData("impact-scope", [{ issueId: "1", defectCause: ["7"] }]), "configuration")
    const form = new FormData()
    form.set("mode", "self")
    form.set("changes", JSON.stringify([{ issueId: "1", defectCause: ["7"] }]))
    const result = await h.actions().updateMissingDataAction("impact-scope", {}, form)
    assert.equal(result.status, "error")
    assert.match(result.message, /不允許/)
    assert.equal(h.tokenCalls.length, 0)
    assert.equal(h.calls.length, 0)
  })
})

describe("Impact Scope runtime select metadata and safe writes", () => {
  for (const [mode, schema, desired, expected] of [
    ["single", singleSchema, ["7"], { id: "7" }],
    ["multi", multiSchema, ["22", "7"], [{ id: "22" }, { id: "7" }]],
  ]) {
    it(`hydrates and safely writes a synthetic ${mode} field-only payload`, async (t) => {
      const issue = impactIssue(1, schema)
      const h = harness(t, { kind: "impact-scope", fields: impactFields(schema), issues: [issue] })
      const page = plain(await h.service.getMissingDataPage("impact-scope"))
      assert.equal(page.readOnly, false)
      assert.equal(page.issues[0].statusName, "To Do")
      assert.deepEqual(page.issues[0].impactScope, { mode, value: [], options: [{ id: "7", value: "Current context" }, { id: "22", value: "Other enabled" }], editable: true })
      const result = plain(await h.service.updateMissingData("impact-scope", [impactChange(1, desired)]))
      assert.deepEqual(result, { succeededIssueIds: ["1"], failures: [] })
      assert.deepEqual(puts(h), [{ path: "/rest/api/3/issue/1", method: "PUT", body: { fields: { [IMPACT]: expected } } }])
      const eligibility = h.calls.filter((call) => call.body?.jql).at(-1).body.jql
      assert.equal(eligibility, '(project = sun and issuetype in (story, task, bug) and cf[14848] is EMPTY and (created >= "2026-11-01" or cf[13476] = "Sprint9") and cf[13476] is not EMPTY and assignee = currentUser()) AND id in (1)')
      assert.deepEqual(h.tokenCalls, [undefined, true])
      assert.ok(liveReads(h).every((call) => new URLSearchParams(call.path.split("?")[1]).get("expand") === "editmeta"))
    })
    it(`rechecks original empty ${mode} value, schema and set permission`, async (t) => {
      const filled = mode === "single" ? { id: "7", value: "Filled" } : [{ id: "7", value: "Filled" }]
      const h = harness(t, { kind: "impact-scope", fields: impactFields(schema), issues: [impactIssue(1, schema)], live: () => impactIssue(1, schema, undefined, filled) })
      assert.deepEqual(plain((await h.service.getMissingDataPage("impact-scope")).issues), [])
      const result = await h.service.updateMissingData("impact-scope", [impactChange(1, desired)])
      assert.equal(result.failures.length, 1)
      assert.match(result.failures[0].message, /已被補填.*未覆寫/)
      assert.equal(puts(h).length, 0)
    })
    for (const value of mode === "single" ? [[], {}, "", 0, { id: "7" }, [{ id: "7", value: "Wrong shape" }]] : [{ id: "7", value: "Wrong shape" }, "", 0, [null], [{ id: "7" }], [{ id: "7", value: "A" }, { id: "7", value: "B" }]]) {
      it(`never treats malformed ${mode} original ${JSON.stringify(value)} as empty`, async (t) => {
        const h = harness(t, { kind: "impact-scope", fields: impactFields(schema), issues: [impactIssue(1, schema, undefined, value)] })
        const row = plain(await h.service.getMissingDataPage("impact-scope")).issues[0]
        assert.equal(row.impactScope.mode, mode)
        assert.equal(row.impactScope.value, null)
        assert.equal(row.impactScope.editable, false)
        assert.deepEqual(row.impactScope.options, [])
        assert.match(row.unavailableReason, /現值格式/)
        assert.equal((await h.service.updateMissingData("impact-scope", [impactChange(1, desired)])).failures.length, 1)
        assert.equal(puts(h).length, 0)
      })
    }
  }
  it("allows multi null or [] but never an absent original field", async (t) => {
    const issues = [impactIssue(1, multiSchema), impactIssue(2, multiSchema, undefined, [])]
    const h = harness(t, { kind: "impact-scope", fields: impactFields(multiSchema), issues })
    assert.ok((await h.service.getMissingDataPage("impact-scope")).issues.every((row) => row.impactScope.editable))
    assert.deepEqual(plain(await h.service.updateMissingData("impact-scope", [impactChange(1), impactChange(2)])), { succeededIssueIds: ["1", "2"], failures: [] })
    const absent = impactIssue(3)
    delete absent.fields[IMPACT]
    const missing = harness(t, { kind: "impact-scope", issues: [absent] })
    const row = (await missing.service.getMissingDataPage("impact-scope")).issues[0]
    assert.deepEqual(plain(row.impactScope), { mode: null, value: null, options: [], editable: false })
    assert.match(row.unavailableReason, /必要欄位/)
    assert.equal((await missing.service.updateMissingData("impact-scope", [impactChange(3)])).failures.length, 1)
    assert.equal(puts(missing).length, 0)
  })
  const invalidDiscovery = [
    { label: "missing field", fields: [] },
    { label: "other same-name field", fields: [{ id: "customfield_99999", name: "Impact Scope", schema: singleSchema }] },
    { label: "missing schema", fields: [{ id: IMPACT, name: "Impact Scope" }] },
    { label: "malformed schema", fields: impactFields(null) },
    { label: "unsupported schema", fields: impactFields({ type: "option", custom: "cascadingselect" }) },
    { label: "duplicate metadata", fields: [...impactFields(), ...impactFields()] },
    { label: "unsupported project", fields: impactFields().map((field) => ({ ...field, scope: { type: "PROJECT", project: { id: "99" } } })) },
    { label: "unsupported project shadows global", fields: [...impactFields(), ...impactFields({ type: "string" }).map((field) => ({ ...field, scope: { type: "PROJECT", project: { id: "10" } } }))] },
    { label: "missing project schema shadows global", fields: [...impactFields(), { id: IMPACT, name: "Impact Scope", scope: { type: "PROJECT", project: { id: "10" } } }] },
    { label: "missing project name shadows global", fields: [...impactFields(), { id: IMPACT, schema: singleSchema, scope: { type: "PROJECT", project: { id: "10" } } }] },
    { label: "unidentified scope cannot fall back", fields: [...impactFields(), { id: IMPACT, name: "Impact Scope", schema: singleSchema, scope: { type: "PROJECT" } }] },
    { label: "malformed scope cannot fall back", fields: [...impactFields(), { id: IMPACT, name: "Impact Scope", schema: singleSchema, scope: null }] },
    { label: "coercible scope type cannot fall back", fields: [...impactFields(), { id: IMPACT, name: "Impact Scope", schema: singleSchema, scope: { type: ["GLOBAL"] } }] },
    ...["", " ", "not-a-project", 10, null].map((id) => ({ label: `malformed project identity ${JSON.stringify(id)} cannot fall back`, fields: [...impactFields(), { id: IMPACT, name: "Impact Scope", schema: singleSchema, scope: { type: "PROJECT", project: { id } } }] })),
  ]
  for (const scenario of invalidDiscovery) it(`fails closed on ${scenario.label} without damaging metadata-free summary`, async (t) => {
    const h = harness(t, { kind: "impact-scope", fields: scenario.fields, issues: [impactIssue(1)] })
    assert.equal((await h.service.getMissingDataSummary("impact-scope")).total, 1)
    assert.equal(h.calls.some((call) => call.path === "/rest/api/3/field"), false)
    const row = (await h.service.getMissingDataPage("impact-scope")).issues[0]
    assert.deepEqual(plain(row.impactScope), { mode: null, value: null, options: [], editable: false })
    assert.equal(typeof row.unavailableReason, "string")
    assert.equal((await h.service.updateMissingData("impact-scope", [impactChange(1)])).failures.length, 1)
    assert.equal(puts(h).length, 0)
  })
  it("resolves per-project mode before schema matching, independent of name", async (t) => {
    const first = impactIssue(1, multiSchema)
    const second = impactIssue(2)
    second.fields.project.id = "20"
    const h = harness(t, { kind: "impact-scope", fields: [...impactFields(), ...impactFields(multiSchema).map((field) => ({ ...field, scope: { type: "PROJECT", project: { id: "10" } } }))], issues: [first, second] })
    assert.deepEqual(plain((await h.service.getMissingDataPage("impact-scope")).issues.map((row) => row.impactScope.mode)), ["multi", "single"])
    assert.deepEqual(plain(await h.service.updateMissingData("impact-scope", [impactChange(1, ["7", "22"]), impactChange(2)])), { succeededIssueIds: ["1", "2"], failures: [] })
    assert.deepEqual(puts(h).map((call) => call.body), [{ fields: { [IMPACT]: [{ id: "7" }, { id: "22" }] } }, { fields: { [IMPACT]: { id: "7" } } }])
  })
  it("does not let invalid inapplicable metadata override valid project discovery", async (t) => {
    const scoped = { ...impactFields()[0], scope: { type: "PROJECT", project: { id: "10" } } }
    const h = harness(t, { kind: "impact-scope", fields: [{ id: IMPACT, name: "Global unsupported" }, scoped], issues: [impactIssue(1)] })
    assert.equal((await h.service.getMissingDataPage("impact-scope")).issues[0].impactScope.editable, true)
    assert.deepEqual(plain(await h.service.updateMissingData("impact-scope", [impactChange(1)])), { succeededIssueIds: ["1"], failures: [] })
  })
  const invalidEditing = [
    ["missing editmeta", (issue) => { delete issue.editmeta }],
    ["missing field editmeta", (issue) => { issue.editmeta.fields = {} }],
    ["missing edit schema", (issue) => { delete issue.editmeta.fields[IMPACT].schema }],
    ["discovery/editmeta mismatch", (issue) => { issue.editmeta.fields[IMPACT].schema = multiSchema }],
    ["cascading edit schema", (issue) => { issue.editmeta.fields[IMPACT].schema = { ...singleSchema, custom: "com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect" } }],
    ["missing set", (issue) => { issue.editmeta.fields[IMPACT].operations = ["add"] }],
    ["malformed operations", (issue) => { issue.editmeta.fields[IMPACT].operations = "set" }],
    ["missing options", (issue) => { delete issue.editmeta.fields[IMPACT].allowedValues }],
    ["empty options", (issue) => { issue.editmeta.fields[IMPACT].allowedValues = [] }],
    ...[null, "7", { id: 7, value: "A" }, { id: "x", value: "A" }, { id: "7", value: " " }, { id: "7", value: 1 }, { id: "7", value: "A", disabled: "false" }, { id: "7", value: "A", disabled: null }].map((option) => [`malformed option ${JSON.stringify(option)}`, (issue) => { issue.editmeta.fields[IMPACT].allowedValues = [option] }]),
    ["duplicate option IDs", (issue) => { issue.editmeta.fields[IMPACT].allowedValues = [{ id: "7", value: "A" }, { id: "7", value: "B", disabled: true }] }],
    ["only disabled", (issue) => { issue.editmeta.fields[IMPACT].allowedValues = [{ id: "7", value: "A", disabled: true }] }],
  ]
  for (const [label, mutate] of invalidEditing) it(`disables read and rejects write on ${label}`, async (t) => {
    const issue = impactIssue(1)
    mutate(issue)
    const h = harness(t, { kind: "impact-scope", issues: [issue] })
    const row = plain(await h.service.getMissingDataPage("impact-scope")).issues[0]
    assert.deepEqual(row.impactScope, { mode: "single", value: [], options: [], editable: false })
    assert.equal(typeof row.unavailableReason, "string")
    assert.equal((await h.service.updateMissingData("impact-scope", [impactChange(1)])).failures.length, 1)
    assert.equal(puts(h).length, 0)
  })
  it("uses per-issue live options and rejects disabled/cross-context/stale options", async (t) => {
    const first = impactIssue(1, multiSchema, [{ id: "7", value: "First" }, { id: "8", value: "Disabled", disabled: true }])
    const second = impactIssue(2, multiSchema, [{ id: "22", value: "Second", disabled: false }])
    const h = harness(t, { kind: "impact-scope", fields: impactFields(multiSchema), issues: [first, second] })
    assert.deepEqual(plain((await h.service.getMissingDataPage("impact-scope")).issues.map((row) => row.impactScope.options)), [[{ id: "7", value: "First" }], [{ id: "22", value: "Second" }]])
    const invalid = await h.service.updateMissingData("impact-scope", [impactChange(1, ["22"]), impactChange(2, ["7"])])
    assert.equal(invalid.failures.length, 2)
    assert.equal((await h.service.updateMissingData("impact-scope", [impactChange(1, ["8"])] )).failures.length, 1)
    assert.equal(puts(h).length, 0)
    first.editmeta.fields[IMPACT].allowedValues = [{ id: "33", value: "Updated context" }]
    assert.equal((await h.service.updateMissingData("impact-scope", [impactChange(1)])).failures.length, 1)
    assert.equal(puts(h).length, 0)
  })
  it("rejects multiple selections on single fields and requires 204 acknowledgement", async (t) => {
    const h = harness(t, { kind: "impact-scope", issues: [impactIssue(1)] })
    const result = await h.service.updateMissingData("impact-scope", [impactChange(1, ["7", "22"])])
    assert.match(result.failures[0].message, /單選/)
    assert.equal(puts(h).length, 0)
    const unconfirmed = harness(t, { kind: "impact-scope", issues: [impactIssue(1)], putStatus: () => 200 })
    assert.equal((await unconfirmed.service.updateMissingData("impact-scope", [impactChange(1)])).failures.length, 1)
  })
  it("never reads or writes an issue removed from the original self eligibility query", async (t) => {
    const h = harness(t, { kind: "impact-scope" })
    assert.equal((await h.service.updateMissingData("impact-scope", [impactChange(1)])).failures.length, 1)
    assert.equal(liveReads(h).length, 0)
    assert.equal(puts(h).length, 0)
  })
  for (const status of [403, 500]) it(`keeps failed live hydration ${status} noneditable with clear reason`, async (t) => {
    const h = harness(t, { kind: "impact-scope", issues: [impactIssue(1)], liveStatus: status })
    const row = plain(await h.service.getMissingDataPage("impact-scope")).issues[0]
    assert.equal(row.impactScope.editable, false)
    assert.deepEqual(row.impactScope.options, [])
    assert.equal(typeof row.unavailableReason, "string")
  })
  for (const schema of [singleSchema, multiSchema]) it(`projects nonself search values without live reads or options: ${schema.type}`, async (t) => {
    const value = schema === singleSchema ? { id: "7", value: "Current label", private: "hidden" } : [{ id: "7", value: "Current label", private: "hidden" }]
    const h = harness(t, { kind: "impact-scope", fields: impactFields(schema), issues: [impactIssue(1, schema, undefined, value)], scope: personScope(), users: { "person-1": fixtureUser("person-1") } })
    const page = plain(await h.service.getMissingDataPage("impact-scope", null, personFilter()))
    assert.equal(page.readOnly, true)
    assert.deepEqual(page.issues[0].impactScope, { mode: schema === singleSchema ? "single" : "multi", value: [{ id: "7", value: "Current label" }], options: [], editable: false })
    assert.equal(liveReads(h).length, 0)
    assert.doesNotMatch(JSON.stringify(page), /hidden|allowedValues|editmeta/)
  })
  it("supports self action partial success and retains failed rows", async (t) => {
    const h = harness(t, { kind: "impact-scope", issues: [impactIssue(1), impactIssue(2)], putStatus: (id) => id === "2" ? 403 : 204 })
    const form = new FormData()
    form.set("mode", "self")
    form.set("submissionId", "impact-partial")
    form.set("changes", JSON.stringify([impactChange(1), impactChange(2)]))
    const result = plain(await h.actions().updateMissingDataAction("impact-scope", {}, form))
    assert.equal(result.status, "partial")
    assert.equal(result.submissionId, "impact-partial")
    assert.deepEqual(result.succeededIssueIds, ["1"])
    assert.equal(result.failures[0].issueId, "2")
  })
  it("rejects invalid direct payloads, untrusted metadata and signed-out actions before Jira", async (t) => {
    const h = harness(t, { kind: "impact-scope" })
    for (const changes of [[], [impactChange(1, [])], [impactChange(1, ["7", "7"])], [{ ...impactChange(1), mode: "multi" }], [{ ...impactChange(1), schema: singleSchema }], [{ ...impactChange(1), storyPoints: 1 }], [impactChange("SUN-1")], [impactChange(1), impactChange(1)]]) await rejectsCode(() => h.service.updateMissingData("impact-scope", changes), "configuration")
    assert.equal(h.tokenCalls.length, 0)
    const signedOut = harness(t, { kind: "impact-scope", unauthenticated: true })
    const form = new FormData()
    form.set("changes", JSON.stringify([impactChange(1)]))
    assert.equal((await signedOut.actions().updateMissingDataAction("impact-scope", {}, form)).status, "error")
    assert.equal(signedOut.tokenCalls.length, 0)
  })
})

describe("shared field definitions in assigned Story Points", () => {
  it("discovers numeric fields by fixed ID even when renamed", async (t) => {
    const h = harness(t, { fields: [
      { id: SP, name: "Renamed estimate", schema: { type: "number", customId: 10005 } },
      { id: "customfield_99999", name: "Story Points", schema: { type: "number" } },
      { id: SP, name: "Wrong schema", schema: { type: "string" } },
      { id: SP, name: "", schema: { type: "number" } },
    ] })
    assert.deepEqual(plain(await h.assigned().getJiraStoryPointsFields({ cloudId: "fixture-cloud", accessToken: "fixture-token-not-real" })), [{ id: SP, projectId: null }])
  })

  it("preserves project-scoped precedence and ambiguity handling", (t) => {
    const service = harness(t).assigned()
    const candidates = [{ id: SP, projectId: null }, { id: "scoped-fixture", projectId: "10" }]
    const fields = { [SP]: 0, "scoped-fixture": 2.5 }
    assert.deepEqual(plain(service.getIssueStoryPoints(fields, "10", candidates)), { value: 2.5, supported: true })
    assert.deepEqual(plain(service.getIssueStoryPoints(fields, "20", candidates)), { value: 0, supported: true })
    assert.equal(service.getIssueStoryPoints(fields, "10", [...candidates, { id: "duplicate-fixture", projectId: "10" }]).supported, false)
  })

  it("uses numeric editmeta to write the shared ID, still allowing zero", async (t) => {
    const issue = pointIssue(1, 3)
    issue.editmeta.fields[SP].schema.customId = 10005
    const h = harness(t, { assigned: true, issues: [issue] })
    const result = await h.assigned().updateJiraStoryPoints([{ issueId: "1", value: 0 }])
    assert.deepEqual(plain(result), { succeededIssueIds: ["1"], failures: [], updatedCount: 1, unchangedCount: 0 })
    assert.deepEqual(puts(h).map((call) => call.body), [{ fields: { customfield_10005: 0 } }])
    assert.deepEqual(h.tokenCalls, [true])
  })

  for (const schema of [null, { type: "string" }]) {
    it(`rejects invalid assigned editmeta schema: ${JSON.stringify(schema)}`, async (t) => {
      const issue = pointIssue(1, 3)
      issue.editmeta.fields[SP].schema = schema
      const h = harness(t, { assigned: true, issues: [issue] })
      const result = await h.assigned().updateJiraStoryPoints([{ issueId: "1", value: 2 }])
      assert.equal(result.failures.length, 1)
      assert.equal(puts(h).length, 0)
    })
  }
})

describe("exact missing-data summary against fixture Jira", () => {
  it("uses the supplied literal Points JQL in counts, detail, and mutation eligibility", async (t) => {
    const h = harness(t, { issues: [pointIssue(1)] })
    await h.service.getMissingDataSummary("points")
    await h.service.getMissingDataPage("points")
    await h.service.updateMissingData("points", [change(1)])
    assert.deepEqual(h.calls.filter((call) => call.path === "/rest/api/3/search/jql").map((call) => call.body.jql), [
      `${pointsJql} ORDER BY key ASC`, `${pointsJql} ORDER BY key ASC`, `(${pointsJql}) AND id in (1)`,
    ])
    for (const call of h.calls.filter((call) => call.path === "/rest/api/3/search/jql")) assert.ok(call.body.fields.includes("status"))
    for (const call of liveReads(h)) assert.ok(new URLSearchParams(call.path.split("?")[1]).get("fields").split(",").includes("status"))
  })

  for (const missing of [null, 0]) {
    it(`counts only status-dependent missing branches for ${missing}`, async (t) => {
      const issues = [
        pointIssue(1, missing, missing, "10", pointStatus("In Progress", "indeterminate")),
        pointIssue(2, 3, missing, "10", pointStatus("In Progress", "indeterminate")),
        pointIssue(3, 3, missing),
        pointIssue(4, missing, missing),
        pointIssue(5, missing, missing, "10", pointStatus("To Do", "new")),
        pointIssue(6, 3, missing, "10", pointStatus("Closed", "done")),
        pointIssue(7, missing, 3, "10", pointStatus("Closed", "done")),
        pointIssue(8, missing, missing, "10", pointStatus("Done", "new")),
        pointIssue(9, 3, missing, "10", pointStatus("dOnE", "done")),
      ]
      const h = harness(t, { issues })
      assert.deepEqual(plain(await h.service.getMissingDataSummary("points")), {
        kind: "points", total: 6, storyPointsMissing: 3, actualStoryPointsMissing: 4,
      })
    })
  }

  for (const status of [undefined, null, [], {}, { name: "" }, { name: "   ", statusCategory: { key: "done" } }, { name: 1, statusCategory: { key: "done" } }, { name: "Done" }, { name: "Done", statusCategory: [] }, pointStatus("Done", "unknown"), pointStatus("Done", 1)]) {
    it(`fails closed on malformed Points status ${JSON.stringify(status)}`, async (t) => {
      const issue = pointIssue(1)
      issue.fields.status = status
      const h = harness(t, { issues: [issue] })
      await rejectsCode(() => h.service.getMissingDataSummary("points"), "configuration")
      await rejectsCode(() => h.service.getMissingDataPage("points"), "configuration")
      const result = await h.service.updateMissingData("points", [change(1)])
      assert.equal(result.failures.length, 1)
      assert.match(result.failures[0].message, /有效狀態/)
      assert.equal(puts(h).length, 0)
    })
  }

  it("counts the cross-page null/zero union once per issue and each missing field separately", async (t) => {
    const h = harness(t, { search: (body, page) => {
      assert.equal(body.maxResults, 100)
      assert.deepEqual(body.fields, ["project", "status", SP, AP])
      assert.equal(body.nextPageToken, page === 0 ? undefined : "next-1")
      return page === 0
        ? { issues: [pointIssue(1, null, 3), pointIssue(2, 2, 0)], nextPageToken: "next-1", isLast: false }
        : { issues: [pointIssue(3, 0, null), pointIssue(4, 2.5, 3.75)], isLast: true }
    } })
    assert.deepEqual(plain(await h.service.getMissingDataSummary("points")), {
      kind: "points", total: 3, storyPointsMissing: 2, actualStoryPointsMissing: 2,
    })
  })

  it("counts defect null/empty arrays but not already-populated causes", async (t) => {
    const issues = [defectIssue(1), defectIssue(2), defectIssue(3)]
    issues[1].fields[DC] = []
    issues[2].fields[DC] = [{ id: "7", value: "Fixture cause" }]
    const h = harness(t, { kind: "defect-cause", fields: defectFields, issues })
    assert.deepEqual(plain(await h.service.getMissingDataSummary("defect-cause")), {
      kind: "defect-cause", total: 2, storyPointsMissing: 0, actualStoryPointsMissing: 0,
    })
  })

  it("fails instead of returning approximate totals on duplicate issue IDs across pages", async (t) => {
    const h = harness(t, { search: (_body, page) => page === 0
      ? { issues: [pointIssue(1)], nextPageToken: "next-1" }
      : { issues: [pointIssue(1)], isLast: true } })
    await rejectsCode(() => h.service.getMissingDataSummary("points"), "retry")
  })

  it("rejects repeated Jira page cursors", async (t) => {
    const h = harness(t, { search: (_body, page) => ({ issues: [pointIssue(page + 1)], nextPageToken: "same-cursor", isLast: false }) })
    await rejectsCode(() => h.service.getMissingDataSummary("points"), "retry")
    assert.equal(h.calls.filter((call) => call.method === "POST").length, 2)
  })

  for (const [name, page] of [
    ["absent terminal isLast", { issues: [pointIssue(1)] }],
    ["false terminal isLast", { issues: [pointIssue(1)], isLast: false }],
    ["contradictory terminal cursor", { issues: [pointIssue(1)], isLast: true, nextPageToken: "next" }],
    ["empty nonterminal page", { issues: [], nextPageToken: "next", isLast: false }],
  ]) {
    it(`rejects incomplete pagination: ${name}`, async (t) => {
      const h = harness(t, { search: () => page })
      await rejectsCode(() => h.service.getMissingDataSummary("points"), "retry")
    })
  }

  it("allows exactly 5,000 terminal source issues", async (t) => {
    const h = harness(t, { search: (body, page) => {
      assert.equal(body.nextPageToken, page === 0 ? undefined : `cursor-${page}`)
      return {
        issues: Array.from({ length: 100 }, (_, index) => pointIssue(page * 100 + index + 1)),
        ...(page === 49 ? { isLast: true } : { nextPageToken: `cursor-${page + 1}`, isLast: false }),
      }
    } })
    assert.equal((await h.service.getMissingDataSummary("points")).total, 5_000)
    assert.equal(h.calls.filter((call) => call.method === "POST").length, 50)
  })

  it("fails closed at 5,000 when Jira has more source issues", async (t) => {
    const h = harness(t, { search: (_body, page) => ({
      issues: Array.from({ length: 100 }, (_, index) => pointIssue(page * 100 + index + 1)),
      nextPageToken: `cursor-${page + 1}`, isLast: false,
    }) })
    await rejectsCode(() => h.service.getMissingDataSummary("points"), "limit")
    assert.equal(h.calls.filter((call) => call.method === "POST").length, 50)
  })

  for (const [status, code] of [[401, "reauthorize"], [403, "forbidden"], [429, "retry"]]) {
    it(`maps HTTP ${status} to ${code}`, async (t) => {
      const h = harness(t, { responseStatus: status })
      await rejectsCode(() => h.service.getMissingDataSummary("points"), code)
    })
  }

  it("maps mocked Jira authorization failures without reading Jira", async (t) => {
    const h = harness(t, { authError: "invalid_configuration" })
    const error = await h.service.getMissingDataSummary("points").catch((error) => error)
    assert.equal(h.service.dashboardError(error).code, "configuration")
    assert.equal(h.calls.length, 0)
  })

  for (const [name, fields, issue] of [
    ["unsupported number schema", [pointFields[0], { ...pointFields[1], schema: { type: "string" } }], pointIssue(1)],
    ["ambiguous numeric field", [...pointFields, pointFields[0]], pointIssue(1)],
    ["unsupported project context", pointFields.map((field) => ({ ...field, scope: { type: "PROJECT", project: { id: "99" } } })), pointIssue(1)],
  ]) {
    it(`fails closed on ${name}`, async (t) => {
      const h = harness(t, { fields, issues: [issue] })
      await rejectsCode(() => h.service.getMissingDataSummary("points"), "configuration")
    })
  }

  it("rejects ambiguous or unsupported Defect Cause metadata", async (t) => {
    const ambiguous = harness(t, { kind: "defect-cause", fields: [...defectFields, { ...defectFields[0], id: "customfield_29999" }] })
    await rejectsCode(() => ambiguous.service.getMissingDataSummary("defect-cause"), "configuration")
    const unsupported = harness(t, { kind: "defect-cause", fields: [{ ...defectFields[0], schema: { type: "array", items: "string" } }] })
    await rejectsCode(() => unsupported.service.getMissingDataSummary("defect-cause"), "configuration")
  })

  it("does not classify negative, string, or absent live points as missing", async (t) => {
    for (const value of [-1, "0", undefined]) {
      const issue = pointIssue(1)
      issue.fields[SP] = value
      const h = harness(t, { issues: [issue] })
      await rejectsCode(() => h.service.getMissingDataSummary("points"), value === undefined ? "configuration" : "retry")
    }
  })
})

describe("shared field discovery in dashboard", () => {
  it("keeps numeric matching ID-based rather than name-based", async (t) => {
    const fields = pointFields.map((field) => ({ ...field, name: "Renamed estimate", schema: { ...field.schema, customId: 10005 } }))
    const h = harness(t, { fields, issues: [pointIssue(1)] })
    assert.equal((await h.service.getMissingDataSummary("points")).total, 1)
  })

  it("normalizes dynamic names and prefers project-scoped supporting text", async (t) => {
    const scopedRoot = "customfield_20003"
    const fields = defectFields.map((field) => ({ ...field, name: ` ${field.name.toUpperCase()} ` }))
    fields.push({ id: scopedRoot, name: "root cause", schema: { type: "string" }, scope: { type: "PROJECT", project: { id: "10" } } })
    const issue = defectIssue(1)
    issue.fields[scopedRoot] = "Scoped root cause text"
    const h = harness(t, { kind: "defect-cause", fields, issues: [issue] })
    const page = await h.service.getMissingDataPage("defect-cause")
    assert.equal(page.issues[0].rootCause, "Scoped root cause text")
    assert.equal(page.issues[0].solution, "Solution text")
    assert.equal(page.issues[0].defectCauseEditable, true)
  })

  for (const custom of [undefined, "wrong-multiselect-plugin"]) {
    it(`rejects missing or wrong Defect Cause custom schema: ${custom}`, async (t) => {
      const fields = plain(defectFields)
      if (custom === undefined) delete fields[0].schema.custom
      else fields[0].schema.custom = custom
      const h = harness(t, { kind: "defect-cause", fields })
      await rejectsCode(() => h.service.getMissingDataSummary("defect-cause"), "configuration")
    })
  }
})

describe("missing-data detail pages", () => {
  it("drops hydrated rows that leave the status-dependent union and retains eligible editable fields", async (t) => {
    const originals = [pointIssue(1, 3, null), pointIssue(2), pointIssue(3), pointIssue(4, 3, null), pointIssue(5)]
    const current = [
      pointIssue(1, 3, null, "10", pointStatus("In Progress", "indeterminate")),
      pointIssue(2, null, 0, "10", pointStatus("To Do", "new")),
      pointIssue(3, null, 0, "10", pointStatus("In Progress", "indeterminate")),
      pointIssue(4, 3, null, "10", pointStatus("Closed", "done")),
      pointIssue(5, null, 0, "10", pointStatus("Done", "new")),
    ]
    const h = harness(t, { issues: originals, live: (id) => current.find((issue) => issue.id === id) })
    const page = plain(await h.service.getMissingDataPage("points"))
    assert.deepEqual(page.issues.map((row) => row.id), ["3", "5"])
    assert.deepEqual(page.issues.map((row) => [row.storyPointsRequired, row.actualStoryPointsRequired]), [[true, false], [false, true]])
    assert.ok(page.issues.every((row) => row.storyPointsEditable && row.actualStoryPointsEditable))
  })

  it("does not fallback to stale search status after malformed live status", async (t) => {
    const malformed = pointIssue(1)
    delete malformed.fields.status
    const h = harness(t, { issues: [pointIssue(1)], live: () => malformed })
    await rejectsCode(() => h.service.getMissingDataPage("points"), "configuration")
    assert.equal(puts(h).length, 0)
  })

  it("preserves conditional requiredness on safe fallback and warns only for required missing fields", async (t) => {
    const issue = pointIssue(1, null, 0, "10", pointStatus("In Progress", "indeterminate"))
    const fallback = harness(t, { issues: [issue], liveStatus: 403 })
    const row = plain(await fallback.service.getMissingDataPage("points")).issues[0]
    assert.equal(row.storyPointsRequired, true)
    assert.equal(row.actualStoryPointsRequired, false)
    assert.equal(row.storyPointsEditable, false)
    assert.equal(row.actualStoryPointsEditable, false)
    assert.doesNotMatch(JSON.stringify(row), /statusCategory|In Progress|fixture-token/)
    issue.editmeta.fields[AP].operations = ["add"]
    const editable = harness(t, { issues: [issue] })
    const editableRow = plain(await editable.service.getMissingDataPage("points")).issues[0]
    assert.equal(editableRow.storyPointsEditable, true)
    assert.equal(editableRow.actualStoryPointsEditable, false)
    assert.equal(Object.hasOwn(editableRow, "unavailableReason"), false)
  })

  it("uses each issue's live editmeta and allowedValues, excludes disabled options, and reads ADF safely", async (t) => {
    const first = defectIssue(1, [{ id: "7", value: "First context" }, { id: "8", value: "Disabled", disabled: true }])
    const second = defectIssue(2, [{ id: "22", value: "Second context" }])
    const h = harness(t, { kind: "defect-cause", fields: defectFields, issues: [first, second] })
    const page = plain(await h.service.getMissingDataPage("defect-cause"))
    assert.equal(page.page, 1)
    assert.equal(page.previousPageToken, null)
    assert.equal(page.nextPageToken, null)
    assert.equal(page.jiraBaseUrl, "https://fixture.example.invalid")
    assert.deepEqual(page.warnings, [])
    assert.deepEqual(page.issues[0].defectCauseOptions, [{ id: "7", value: "First context" }])
    assert.deepEqual(page.issues[1].defectCauseOptions, [{ id: "22", value: "Second context" }])
    assert.equal(page.issues[0].rootCause, "Root cause text")
    assert.equal(page.issues[0].solution, "Solution text")
    assert.equal(page.issues[0].defectCauseEditable, true)
    assert.equal(liveReads(h).length, 2)
    for (const call of liveReads(h)) {
      const params = new URLSearchParams(call.path.split("?")[1])
      assert.deepEqual(new Set(params.get("fields").split(",")), new Set(["project", "summary", "assignee", "parent", DC, RC, SOL]))
    }
  })

  for (const kind of ["points", "defect-cause"]) {
    it(`projects only assignee display names and actual parent types for ${kind}`, async (t) => {
      const issues = ["Bug", "Task", "Story", "Epic"].map((name, index) => {
        const issue = kind === "points" ? pointIssue(index + 1) : defectIssue(index + 1)
        issue.fields.assignee = { displayName: "Fixture Assignee", accountId: "private-account-id", emailAddress: "private@example.invalid", avatarUrls: { "48x48": "https://private.example.invalid/avatar" } }
        issue.fields.issuetype = { name: "Child type must not be used" }
        issue.fields.parent = { id: "private-parent-id", key: "PRIVATE-1", fields: { summary: "Private parent summary", issuetype: { name, iconUrl: "https://private.example.invalid/icon" } } }
        return issue
      })
      const h = harness(t, { kind, fields: kind === "points" ? pointFields : defectFields, issues })
      const page = plain(await h.service.getMissingDataPage(kind))
      assert.deepEqual(page.issues.map((row) => row.parentIssueType), ["Bug", "Task", "Story", "Epic"].map((name) => ({ status: "known", name })))
      assert.ok(page.issues.every((row) => row.assigneeDisplayName === "Fixture Assignee"))
      assert.doesNotMatch(JSON.stringify(page), /private-account-id|private@example|private-parent-id|PRIVATE-1|Private parent summary|private\.example|Child type must not be used|fixture-token-not-real|avatarUrls|iconUrl/)
      const selected = h.calls.find((call) => call.method === "POST").body.fields
      assert.ok(selected.includes("assignee") && selected.includes("parent"))
      for (const call of liveReads(h)) {
        const fields = new URLSearchParams(call.path.split("?")[1]).get("fields").split(",")
        assert.ok(fields.includes("assignee") && fields.includes("parent"))
      }
    })

    it(`distinguishes no parent from absent or malformed parent metadata for ${kind}`, async (t) => {
      const parents = [null, undefined, {}, [], "parent", { fields: {} }, { fields: { issuetype: {} } }, { fields: { issuetype: { name: 1 } } }, { fields: { issuetype: { name: "" } } }, { fields: { issuetype: { name: "   " } } }]
      const assignees = [null, undefined, {}, [], "assignee", { displayName: 1 }, { displayName: "" }, { displayName: "   " }]
      const issues = parents.map((parent, index) => {
        const issue = kind === "points" ? pointIssue(index + 1) : defectIssue(index + 1)
        issue.fields.parent = parent
        issue.fields.issuetype = { name: "Child Bug" }
        issue.fields.assignee = assignees[index % assignees.length]
        return issue
      })
      const h = harness(t, { kind, fields: kind === "points" ? pointFields : defectFields, issues })
      const page = plain(await h.service.getMissingDataPage(kind))
      assert.deepEqual(page.issues.map((row) => row.parentIssueType), parents.map((_, index) => ({ status: index === 0 ? "none" : "unknown" })))
      assert.ok(page.issues.every((row) => row.assigneeDisplayName === null))
      assert.doesNotMatch(JSON.stringify(page), /Child Bug/)
    })

    it(`preserves safe search metadata on a failed live ${kind} read`, async (t) => {
      const issue = kind === "points" ? pointIssue(1) : defectIssue(1)
      issue.fields.assignee = { displayName: "Fallback Assignee", accountId: "private-fallback-account" }
      issue.fields.parent = { fields: { issuetype: { name: "Story", iconUrl: "private-fallback-icon" } } }
      const h = harness(t, { kind, fields: kind === "points" ? pointFields : defectFields, issues: [issue], liveStatus: 403 })
      const row = plain(await h.service.getMissingDataPage(kind)).issues[0]
      assert.equal(row.assigneeDisplayName, "Fallback Assignee")
      assert.deepEqual(row.parentIssueType, { status: "known", name: "Story" })
      assert.equal(row.unavailableReason, "沒有權限存取這些 Jira 資料或編輯欄位。")
      assert.equal(row.storyPointsEditable, false)
      assert.equal(row.actualStoryPointsEditable, false)
      assert.equal(row.defectCauseEditable, false)
      assert.doesNotMatch(JSON.stringify(row), /private-fallback-account|private-fallback-icon/)
    })
  }

  it("offers every Jira-settable numeric field on a still-missing row, including existing values", async (t) => {
    const first = pointIssue(1, null, 3)
    const second = pointIssue(2, 0, null)
    second.editmeta.fields[AP] = { schema: { type: "number" }, operations: ["add"] }
    const h = harness(t, { issues: [first, second, pointIssue(3, 2, 4)] })
    const page = await h.service.getMissingDataPage("points")
    assert.equal(page.issues.length, 2)
    assert.equal(page.issues[0].storyPointsEditable, true)
    assert.equal(page.issues[0].actualStoryPointsEditable, true)
    assert.equal(page.issues[1].storyPointsEditable, true)
    assert.equal(page.issues[1].actualStoryPointsEditable, false)
    assert.equal(typeof page.issues[1].unavailableReason, "string")
  })

  it("requires login and rejects invalid encrypted page tokens before Jira requests", async (t) => {
    const signedOut = harness(t, { unauthenticated: true })
    await rejectsCode(() => signedOut.service.getMissingDataPage("points"), "reauthorize")
    assert.equal(signedOut.calls.length, 0)
    const invalidPage = harness(t)
    await rejectsCode(() => invalidPage.service.getMissingDataPage("points", "not-a-valid-token"), "invalid_page")
    assert.equal(invalidPage.calls.length, 0)
  })
})

describe("scoped missing-data reads", () => {
  for (const days of [1, 17, 60]) {
    for (const kind of ["points", "defect-cause"]) {
      it(`uses the chosen ${days}-day person ${kind} window in summary and detail JQL`, async (t) => {
        const filter = personFilter(days)
        const h = harness(t, {
          kind, scope: personScope(days), users: { "person-1": fixtureUser("person-1") },
          fields: kind === "points" ? pointFields : defectFields,
          issues: [kind === "points" ? pointIssue(1) : defectIssue(1)],
        })
        assert.equal((await h.service.getMissingDataSummary(kind, filter)).total, 1)
        assert.equal((await h.service.getMissingDataPage(kind, null, filter)).issues.length, 1)
        const queries = h.calls.filter((call) => call.method === "POST").map((call) => call.body.jql)
        assert.equal(queries.length, 2)
        for (const jql of queries) {
          assert.match(jql, /assignee in \("person-1"\)/)
          assert.doesNotMatch(jql, /currentUser\(\)/)
          if (kind === "points") {
            assert.ok(jql.endsWith(` AND created >= -${days}d ORDER BY key ASC`))
            assert.doesNotMatch(jql, /\b(updated|resolved|resolutiondate)\b/i)
          } else {
            assert.ok(jql.endsWith(` AND created >= -${days}d ORDER BY key ASC`))
            assert.doesNotMatch(jql, /status CHANGED|\b(updated|resolved|resolutiondate)\b/i)
          }
        }
        assert.equal(h.calls.filter((call) => call.path === "/rest/api/3/user?accountId=person-1").length, 2)
      })
    }
  }

  for (const mode of ["person", "team-project"]) {
    for (const kind of ["points", "defect-cause"]) {
      it(`makes ${mode} ${kind} pages read-only without editable options or unavailable reasons`, async (t) => {
        const h = harness(t, {
          kind, scope: mode === "person" ? personScope() : teamScope(),
          users: { "person-1": fixtureUser("person-1") }, groups: { "ent-web": [fixtureUser("person-1")] },
          fields: kind === "points" ? pointFields : defectFields,
          issues: [kind === "points" ? pointIssue(1, null, 3) : defectIssue(1)],
        })
        const page = plain(await h.service.getMissingDataPage(kind, null, mode === "person" ? personFilter() : teamFilter()))
        assert.equal(page.readOnly, true)
        assert.deepEqual(page.warnings, [])
        assert.equal(page.issues.length, 1)
        const row = page.issues[0]
        assert.equal(row.storyPointsEditable, false)
        assert.equal(row.actualStoryPointsEditable, false)
        assert.equal(row.defectCauseEditable, false)
        assert.deepEqual(row.defectCauseOptions, [])
        assert.equal(Object.hasOwn(row, "unavailableReason"), false)
        if (kind === "defect-cause") {
          assert.equal(row.rootCause, "Root cause text")
          assert.equal(row.solution, "Solution text")
        }
        assert.equal(liveReads(h).length, 1)
        assert.equal(new URLSearchParams(liveReads(h)[0].path.split("?")[1]).has("expand"), false)
        assert.equal(puts(h).length, 0)
      })
    }
  }

  it("keeps self detail reads editable with per-issue editmeta and date-free queries", async (t) => {
    const h = harness(t, { issues: [pointIssue(1)] })
    const page = await h.service.getMissingDataPage("points", null, { mode: "self" })
    assert.equal(page.readOnly, false)
    assert.equal(page.issues[0].storyPointsEditable, true)
    assert.equal(page.issues[0].actualStoryPointsEditable, true)
    assert.equal(new URLSearchParams(liveReads(h)[0].path.split("?")[1]).get("expand"), "editmeta")
    assert.doesNotMatch(h.calls.find((call) => call.method === "POST").body.jql, /30d|created|updated|resolved/i)
  })
})

describe("scoped page-token binding", () => {
  it("uses the canonical union of included group identities and invalidates tokens when membership changes", async (t) => {
    const groups = {
      "ent-web": [fixtureUser("person-2"), fixtureUser("person-1")],
      "ent-be1": [fixtureUser("person-3"), fixtureUser("person-2")],
    }
    let scope = teamScope({ accountIds: ["person-1", "person-2"], projects: ["sun", "tkk"] })
    const filter = teamFilter({
      groups: ["ent-web", "ent-be1", "ent-web"], projects: ["tkk", "sun", "tkk"],
      exclusions: { "ent-web": ["person-2"], "ent-be1": ["person-3"] },
    })
    const h = harness(t, { scope: () => scope, groups, issues: [pointIssue(1), pointIssue(2)], search: pagedSearch })
    const credentials = { cloudId: "fixture-cloud", accessToken: "fixture-token-not-real" }
    assert.deepEqual(plain(await h.lookups().resolveDashboardScope(filter, credentials)), scope)
    const first = await h.service.getMissingDataPage("points", null, filter)
    assert.equal(typeof first.nextPageToken, "string")
    const canonical = teamFilter({
      groups: ["ent-be1", "ent-web"], projects: ["sun", "tkk"],
      exclusions: { "ent-be1": ["person-3"], "ent-web": ["person-2"] },
    })
    const second = await h.service.getMissingDataPage("points", first.nextPageToken, canonical)
    assert.equal(second.page, 2)
    assert.equal(typeof second.previousPageToken, "string")
    const query = h.calls.find((call) => call.method === "POST").body.jql
    assert.match(query, /assignee in \("person-1", "person-2"\)/)
    assert.ok(query.endsWith(" AND created >= -17d AND project in (sun, tkk) ORDER BY key ASC"))
    const before = h.calls.length
    groups["ent-web"].push(fixtureUser("person-4"))
    scope = { ...scope, accountIds: ["person-1", "person-2", "person-4"] }
    await rejectsCode(() => h.service.getMissingDataPage("points", first.nextPageToken, canonical), "invalid_page")
    assert.equal(h.calls.slice(before).length, 2)
    assert.ok(h.calls.slice(before).every((call) => call.path.startsWith("/rest/api/3/group/member?")))
    assert.equal(puts(h).length, 0)
  })

  it("resolves all pages of group members before forming the deduplicated scope", async (t) => {
    const members = Array.from({ length: 51 }, (_, index) => fixtureUser(`person-${String(index + 1).padStart(2, "0")}`))
    const scope = teamScope({ accountIds: members.map((user) => user.accountId) })
    const h = harness(t, { scope, groups: { "ent-web": members } })
    assert.deepEqual(plain(await h.lookups().resolveDashboardScope(teamFilter(), { cloudId: "fixture-cloud", accessToken: "fixture-token-not-real" })), scope)
    assert.deepEqual(h.calls.map((call) => new URLSearchParams(call.path.split("?")[1]).get("startAt")), ["0", "50"])
  })

  for (const [label, changes] of [
    ["different person", { filter: personFilter(17, "person-2"), scope: personScope(17, "person-2") }],
    ["different chosen days", { filter: personFilter(18), scope: personScope(18) }],
    ["different serialized filter with identical resolved JQL", { filter: { ...personFilter(), name: "Changed display label" }, scope: personScope() }],
    ["different mode with identical resolved JQL", { filter: teamFilter({ projects: [] }), scope: teamScope({ projects: [] }) }],
    ["different viewer", { viewerId: "another-viewer" }],
    ["different site", { cloudId: "another-fixture-cloud" }],
    ["different missing-data kind", { kind: "defect-cause" }],
  ]) {
    it(`rejects a page token for ${label} before reading fields or issues`, async (t) => {
      const source = harness(t, {
        scope: personScope(), users: { "person-1": fixtureUser("person-1") },
        issues: [pointIssue(1)], search: pagedSearch,
      })
      const first = await source.service.getMissingDataPage("points", null, personFilter())
      const target = harness(t, {
        scope: changes.scope ?? personScope(), viewerId: changes.viewerId, cloudId: changes.cloudId,
        users: { "person-1": fixtureUser("person-1"), "person-2": fixtureUser("person-2") },
        groups: { "ent-web": [fixtureUser("person-1")] },
      })
      await rejectsCode(() => target.service.getMissingDataPage(changes.kind ?? "points", first.nextPageToken, changes.filter ?? personFilter()), "invalid_page")
      assert.equal(target.calls.length, 1)
      assert.ok(target.calls.every((call) => call.path.startsWith("/rest/api/3/user?") || call.path.startsWith("/rest/api/3/group/member?")))
      assert.equal(puts(target).length, 0)
    })
  }

  it("rejects changed groups and exclusions even if the current included union is unchanged", async (t) => {
    const h = harness(t, {
      scope: teamScope(), groups: { "ent-web": [fixtureUser("person-1")], "ent-be1": [fixtureUser("person-1")] },
      issues: [pointIssue(1)], search: pagedSearch,
    })
    const first = await h.service.getMissingDataPage("points", null, teamFilter())
    for (const filter of [
      teamFilter({ groups: ["ent-be1"] }),
      teamFilter({ exclusions: { "ent-web": ["person-no-longer-in-group"] } }),
      teamFilter({ projects: ["tkk"] }),
    ]) {
      const before = h.calls.length
      await rejectsCode(() => h.service.getMissingDataPage("points", first.nextPageToken, filter), "invalid_page")
      assert.equal(h.calls.slice(before).length, 1)
      assert.ok(h.calls[before].path.startsWith("/rest/api/3/group/member?"))
    }
  })
})

describe("missing-data saves and action outcomes", () => {
  for (const [name, current, extra] of [
    ["In Progress with filled SP and empty Actual", pointIssue(1, 3, null, "10", pointStatus("In Progress", "indeterminate")), { storyPoints: 4.5, expectedStoryPoints: 3 }],
    ["To Do with both fields missing", pointIssue(1, null, 0, "10", pointStatus("To Do", "new")), {}],
    ["Closed with filled SP and empty Actual", pointIssue(1, 3, null, "10", pointStatus("Closed", "done")), { storyPoints: 4.5, expectedStoryPoints: 3 }],
  ]) {
    it(`rejects a live row outside the Points union: ${name}`, async (t) => {
      const h = harness(t, { issues: [pointIssue(1)], live: () => current })
      const result = await h.service.updateMissingData("points", [change(1, extra)])
      assert.deepEqual(plain(result.succeededIssueIds), [])
      assert.equal(result.failures.length, 1)
      assert.match(result.failures[0].message, /缺失範圍.*未覆寫/)
      assert.equal(puts(h).length, 0)
    })
  }

  it("can edit either permitted field on an In Progress row that still lacks SP", async (t) => {
    const h = harness(t, { issues: [pointIssue(1, null, 3, "10", pointStatus("In Progress", "indeterminate"))] })
    const result = await h.service.updateMissingData("points", [{ issueId: "1", actualStoryPoints: 4.5, expectedActualStoryPoints: 3 }])
    assert.deepEqual(plain(result), { succeededIssueIds: ["1"], failures: [] })
    assert.deepEqual(puts(h)[0].body, { fields: { [AP]: 4.5 } })
  })

  it("revalidates eligibility with the fixed date-free scope and sends both points in one field-only PUT", async (t) => {
    const h = harness(t, { issues: [pointIssue(1)] })
    const result = await h.service.updateMissingData("points", [change(1, { actualStoryPoints: 2.75, expectedActualStoryPoints: 0 })])
    assert.deepEqual(plain(result), { succeededIssueIds: ["1"], failures: [] })
    assert.deepEqual(puts(h), [{ path: "/rest/api/3/issue/1", method: "PUT", body: { fields: { [SP]: 1.25, [AP]: 2.75 } } }])
    assert.deepEqual(h.tokenCalls, [true])
    const query = h.calls.find((call) => call.method === "POST")
    assert.match(query.body.jql, /\) AND id in \(1\)$/)
    assert.doesNotMatch(query.body.jql, /30d|created|updated|resolved/i)
  })

  it("rejects issues no longer eligible without reading or writing them", async (t) => {
    const h = harness(t)
    const result = await h.service.updateMissingData("points", [change(1)])
    assert.deepEqual(plain(result.succeededIssueIds), [])
    assert.equal(result.failures[0].issueId, "1")
    assert.equal(liveReads(h).length, 0)
    assert.equal(puts(h).length, 0)
  })

  it("never overwrites a missing original changed to positive points or from null to zero", async (t) => {
    for (const current of [3, 0]) {
      const h = harness(t, { issues: [pointIssue(1)], live: () => pointIssue(1, current, 0) })
      const result = await h.service.updateMissingData("points", [change(1)])
      assert.equal(result.failures.length, 1)
      assert.match(result.failures[0].message, /未覆寫/)
      assert.equal(puts(h).length, 0)
    }
  })

  for (const [property, expected, field] of [["storyPoints", "expectedStoryPoints", SP], ["actualStoryPoints", "expectedActualStoryPoints", AP]]) {
    it(`adjusts a matching existing positive ${property} on a still-missing issue through the action`, async (t) => {
      const issue = property === "storyPoints" ? pointIssue(1, 3, 0) : pointIssue(1, null, 3)
      const h = harness(t, { issues: [issue] })
      const form = new FormData()
      form.set("mode", "self")
      form.set("submissionId", "positive-original")
      form.set("changes", JSON.stringify([{ issueId: "1", [property]: 4.5, [expected]: 3 }]))
      const result = plain(await h.actions().updateMissingDataAction("points", {}, form))
      assert.equal(result.status, "success")
      assert.deepEqual(result.succeededIssueIds, ["1"])
      assert.deepEqual(puts(h).map((call) => call.body), [{ fields: { [field]: 4.5 } }])
      assert.deepEqual(h.calls.find((call) => call.method === "POST").body.fields, ["project", "status", SP, AP])
    })

    it(`rejects a changed positive ${property} without overwriting it`, async (t) => {
      const original = property === "storyPoints" ? pointIssue(1, 3, 0) : pointIssue(1, null, 3)
      const current = property === "storyPoints" ? pointIssue(1, 4, 0) : pointIssue(1, null, 4)
      const h = harness(t, { issues: [original], live: () => current })
      const result = await h.service.updateMissingData("points", [{ issueId: "1", [property]: 4.5, [expected]: 3 }])
      assert.equal(result.failures.length, 1)
      assert.match(result.failures[0].message, /未覆寫/)
      assert.equal(puts(h).length, 0)
    })

    it(`rejects a matching positive ${property} if both fields are complete at live read`, async (t) => {
      const original = property === "storyPoints" ? pointIssue(1, 3, 0) : pointIssue(1, null, 3)
      const h = harness(t, { issues: [original], live: () => pointIssue(1, 3, 3) })
      const result = await h.service.updateMissingData("points", [{ issueId: "1", [property]: 4.5, [expected]: 3 }])
      assert.equal(result.failures.length, 1)
      assert.match(result.failures[0].message, /已完整.*未覆寫/)
      assert.equal(puts(h).length, 0)
    })

    it(`still requires Jira set permission for an existing positive ${property}`, async (t) => {
      const issue = property === "storyPoints" ? pointIssue(1, 3, 0) : pointIssue(1, null, 3)
      issue.editmeta.fields[field].operations = ["add"]
      const h = harness(t, { issues: [issue] })
      const result = await h.service.updateMissingData("points", [{ issueId: "1", [property]: 4.5, [expected]: 3 }])
      assert.equal(result.failures.length, 1)
      assert.match(result.failures[0].message, /無法編輯/)
      assert.equal(puts(h).length, 0)
    })
  }

  it("does not write a matching positive adjustment when the accompanying missing field conflicts", async (t) => {
    const h = harness(t, { issues: [pointIssue(1, 3, null)], live: () => pointIssue(1, 3, 0) })
    const result = await h.service.updateMissingData("points", [{ issueId: "1", storyPoints: 4.5, expectedStoryPoints: 3, actualStoryPoints: 2, expectedActualStoryPoints: null }])
    assert.equal(result.failures.length, 1)
    assert.equal(puts(h).length, 0)
  })

  it("does not partially write either field when the other field conflicts", async (t) => {
    const h = harness(t, { issues: [pointIssue(1)], live: () => pointIssue(1, null, 4) })
    const result = await h.service.updateMissingData("points", [change(1, { actualStoryPoints: 2, expectedActualStoryPoints: 0 })])
    assert.equal(result.failures.length, 1)
    assert.equal(puts(h).length, 0)
  })

  it("rejects missing per-issue set permission", async (t) => {
    const issue = pointIssue(1)
    issue.editmeta.fields[SP].operations = ["add"]
    const h = harness(t, { issues: [issue] })
    const result = await h.service.updateMissingData("points", [change(1)])
    assert.equal(result.failures.length, 1)
    assert.equal(puts(h).length, 0)
  })

  it("accepts only live issue-context defect options and sends IDs, not labels or metadata", async (t) => {
    const h = harness(t, { kind: "defect-cause", fields: defectFields, issues: [defectIssue(1)] })
    const result = await h.service.updateMissingData("defect-cause", [{ issueId: "1", defectCause: ["7"] }])
    assert.deepEqual(plain(result), { succeededIssueIds: ["1"], failures: [] })
    assert.deepEqual(puts(h)[0].body, { fields: { [DC]: [{ id: "7" }] } })
  })

  it("rejects options from another context and disabled options before PUT", async (t) => {
    for (const option of ["22", "8"]) {
      const issue = defectIssue(1, [{ id: "7", value: "Current context" }, { id: "8", value: "Disabled", disabled: true }])
      const h = harness(t, { kind: "defect-cause", fields: defectFields, issues: [issue] })
      const result = await h.service.updateMissingData("defect-cause", [{ issueId: "1", defectCause: [option] }])
      assert.equal(result.failures.length, 1)
      assert.equal(puts(h).length, 0)
    }
  })

  it("never overwrites a defect cause already filled by someone else", async (t) => {
    const issue = defectIssue(1)
    issue.fields[DC] = [{ id: "7" }]
    const h = harness(t, { kind: "defect-cause", fields: defectFields, issues: [issue] })
    const result = await h.service.updateMissingData("defect-cause", [{ issueId: "1", defectCause: ["7"] }])
    assert.equal(result.failures.length, 1)
    assert.match(result.failures[0].message, /未覆寫/)
    assert.equal(puts(h).length, 0)
  })

  it("requires Jira's 204 acknowledgement before reporting success", async (t) => {
    const h = harness(t, { issues: [pointIssue(1)], putStatus: () => 200 })
    const result = await h.service.updateMissingData("points", [change(1)])
    assert.deepEqual(plain(result.succeededIssueIds), [])
    assert.equal(result.failures.length, 1)
  })

  it("returns per-issue partial success through the real server action with the submission ID", async (t) => {
    const h = harness(t, { issues: [pointIssue(1), pointIssue(2)], putStatus: (id) => id === "2" ? 403 : 204 })
    const form = new FormData()
    form.set("submissionId", "fixture-submission")
    form.set("changes", JSON.stringify([change(1), change(2)]))
    const result = plain(await h.actions().updateMissingDataAction("points", {}, form))
    assert.equal(result.status, "partial")
    assert.equal(result.submissionId, "fixture-submission")
    assert.deepEqual(result.succeededIssueIds, ["1"])
    assert.equal(result.failures.length, 1)
    assert.equal(result.failures[0].issueId, "2")
    assert.match(result.message, /草稿已保留/)
    assert.equal(puts(h).length, 2)
  })

  it("accepts an explicit self marker without changing the fixed date-free write scope", async (t) => {
    const h = harness(t, { issues: [pointIssue(1)] })
    const form = new FormData()
    form.set("mode", "self")
    form.set("submissionId", "explicit-self")
    form.set("changes", JSON.stringify([change(1)]))
    const result = await h.actions().updateMissingDataAction("points", {}, form)
    assert.equal(result.status, "success")
    assert.equal(result.submissionId, "explicit-self")
    assert.equal(puts(h).length, 1)
    assert.doesNotMatch(h.calls.find((call) => call.method === "POST").body.jql, /30d|created|updated|resolved/i)
  })

  for (const kind of ["points", "defect-cause", "impact-scope"]) {
    for (const [label, entries] of [
      ["person marker", [["mode", "person"]]],
      ["team marker", [["mode", "team-project"]]],
      ["duplicate self marker", [["mode", "self"], ["mode", "self"]]],
      ["mixed markers", [["mode", "self"], ["mode", "person"]]],
      ["account ID", [["mode", "self"], ["accountId", "person-1"]]],
      ["group", [["mode", "self"], ["group", "ent-web"]]],
      ["project", [["mode", "self"], ["project", "sun"]]],
      ["exclusion", [["mode", "self"], ["exclude", "ent-web|person-1"]]],
      ["chosen days", [["mode", "self"], ["days", "17"]]],
      ["empty scope field", [["accountId", ""]]],
    ]) {
      it(`refuses ${kind} action ${label} before any token request or PUT`, async (t) => {
        const h = harness(t)
        const form = new FormData()
        form.set("submissionId", "rejected-scope")
        form.set("changes", JSON.stringify(kind === "points" ? [change(1)] : kind === "defect-cause" ? [{ issueId: "1", defectCause: ["7"] }] : [impactChange(1)]))
        for (const [key, value] of entries) form.append(key, value)
        const result = plain(await h.actions().updateMissingDataAction(kind, {}, form))
        assert.equal(result.status, "error")
        assert.equal(result.submissionId, "rejected-scope")
        assert.match(result.message, /只有自己模式/)
        assert.deepEqual(result.succeededIssueIds, [])
        assert.equal(h.tokenCalls.length, 0)
        assert.equal(h.calls.length, 0)
        assert.equal(puts(h).length, 0)
      })
    }
  }

  it("validates the action payload and authentication before any Jira request", async (t) => {
    const invalid = harness(t)
    const form = new FormData()
    form.set("changes", JSON.stringify([change(1, { storyPoints: 0 })]))
    assert.equal((await invalid.actions().updateMissingDataAction("points", {}, form)).status, "error")
    assert.equal(invalid.calls.length, 0)
    const signedOut = harness(t, { unauthenticated: true })
    form.set("changes", JSON.stringify([change(1)]))
    assert.equal((await signedOut.actions().updateMissingDataAction("points", {}, form)).status, "error")
    assert.equal(signedOut.calls.length, 0)
  })
})

describe("dashboard reauthorization return paths", () => {
  for (const [label, input, expected] of [
    ["default self", undefined, "/dashboard"],
    ["explicit self", "/dashboard?mode=self", "/dashboard"],
    ["person", "/dashboard?days=17&name=Chosen%20person&accountId=person-1&mode=person", "/dashboard?mode=person&accountId=person-1&name=Chosen+person&days=17"],
    ["canonical group, exclusion, and project union", "/dashboard?project=tkk&group=ent-web&exclude=ent-web%7Cperson-2&mode=team-project&days=30&group=ent-be1&group=ent-web&project=sun&exclude=ent-web%7Cperson-2", "/dashboard?mode=team-project&group=ent-be1&group=ent-web&exclude=ent-web%7Cperson-2&project=sun&project=tkk"],
  ]) {
    it(`reauthorizes ${label} using only its canonical dashboard return path`, async (t) => {
      const h = harness(t, { allowSignIn: true })
      await h.actions().reauthorizeDashboardAction(input)
      assert.deepEqual(h.signIns, [{ provider: "atlassian", redirectTo: expected }])
      assert.equal(h.calls.length, 0)
      assert.equal(h.tokenCalls.length, 0)
    })
  }

  for (const input of [
    "https://external.example.invalid/dashboard?mode=person&accountId=person-1",
    "//external.example.invalid/dashboard", "/\\external.example.invalid/dashboard",
    "/settings", "/api/dashboard/missing-data", "/dashboard/other", "/dashboard#external",
    "/dashboard?redirectTo=https%3A%2F%2Fexternal.example.invalid",
    "/dashboard?mode=person&accountId=person-1&days=0",
    "/dashboard?mode=team-project&group=unknown-group",
    "/dashboard?mode=person&mode=self&accountId=person-1",
  ]) {
    it(`rejects an arbitrary or invalid reauthorization path: ${input}`, async (t) => {
      const h = harness(t, { allowSignIn: true })
      await assert.rejects(() => h.actions().reauthorizeDashboardAction(input), (error) => error.name === "DashboardFilterError")
      assert.deepEqual(h.signIns, [])
      assert.equal(h.calls.length, 0)
    })
  }
})

describe("missing-data route filter validation", () => {
  for (const query of [
    "mode=unknown", "mode=person", "mode=person&accountId=person-1&days=0",
    "mode=person&accountId=person-1&days=1.5", "mode=person&accountId=person-1&mode=self",
    "mode=person&accountId=person-1&accountId=person-2", "mode=team-project",
    "mode=team-project&group=unknown-group", "mode=team-project&group=ent-web&project=unknown-project",
    "mode=team-project&group=ent-web&exclude=ent-be1%7Cperson-1", "unexpected=value",
    "mode=person&accountId=person-1&name=%00",
  ]) {
    it(`returns HTTP 400 for malformed filters without Jira requests: ${query}`, async (t) => {
      const h = harness(t)
      const response = await h.route().GET(new Request(`https://fixture.example.invalid/api/dashboard/missing-data?kind=points&view=page&${query}`))
      assert.equal(response.status, 400)
      const payload = await response.json()
      assert.equal(payload.status, "error")
      assert.equal(response.headers.get("Cache-Control"), "private, no-store")
      assert.equal(response.headers.get("Vary"), "Cookie")
      assert.equal(h.tokenCalls.length, 0)
      assert.equal(h.calls.length, 0)
    })
  }

  for (const extra of ["kind=points", "view=page", "pageToken=a&pageToken=b"]) {
    it(`rejects duplicate reserved route parameters: ${extra}`, async (t) => {
      const h = harness(t)
      const response = await h.route().GET(new Request(`https://fixture.example.invalid/api/dashboard/missing-data?kind=points&view=page&${extra}`))
      assert.equal(response.status, 400)
      assert.equal(h.calls.length, 0)
    })
  }

  it("serves the selected person summary and read-only detail through the real route", async (t) => {
    const h = harness(t, { scope: personScope(), users: { "person-1": fixtureUser("person-1") }, issues: [pointIssue(1)] })
    for (const view of ["summary", "page"]) {
      const response = await h.route().GET(new Request(`https://fixture.example.invalid/api/dashboard/missing-data?kind=points&view=${view}&mode=person&accountId=person-1&name=Chosen+person&days=17`))
      assert.equal(response.status, 200)
      const payload = await response.json()
      assert.equal(payload.status, "success")
      if (view === "summary") assert.equal(payload.summary.total, 1)
      else {
        assert.equal(payload.data.readOnly, true)
        assert.equal(payload.data.issues[0].storyPointsEditable, false)
      }
    }
    assert.equal(puts(h).length, 0)
  })

  it("allows a valid encrypted page token larger than the filter URL limit", async (t) => {
    const firstCursor = "a".repeat(8_192)
    const secondCursor = "b".repeat(8_192)
    const h = harness(t, {
      scope: personScope(), users: { "person-1": fixtureUser("person-1") },
      issues: [pointIssue(1), pointIssue(2), pointIssue(3)],
      search: (body) => body.nextPageToken === secondCursor
        ? { issues: [pointIssue(3)], isLast: true }
        : body.nextPageToken === firstCursor
          ? { issues: [pointIssue(2)], nextPageToken: secondCursor, isLast: false }
          : { issues: [pointIssue(1)], nextPageToken: firstCursor, isLast: false },
    })
    const first = await h.service.getMissingDataPage("points", null, personFilter())
    const second = await h.service.getMissingDataPage("points", first.nextPageToken, personFilter())
    assert.ok(second.nextPageToken.length > h.filters().DASHBOARD_URL_LIMIT)
    const query = new URLSearchParams({ kind: "points", view: "page", mode: "person", accountId: "person-1", name: "Chosen person", days: "17", pageToken: second.nextPageToken })
    const response = await h.route().GET(new Request(`https://fixture.example.invalid/api/dashboard/missing-data?${query}`))
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.data.page, 3)
    assert.equal(payload.data.issues[0].id, "3")
    assert.equal(payload.data.readOnly, true)
  })
})

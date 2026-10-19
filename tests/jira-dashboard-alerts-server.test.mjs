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
const plain = (value) => JSON.parse(JSON.stringify(value))
const issue = (id) => ({ id: String(id), key: `FIXTURE-${id}`, fields: { project: { id: "10" } } })
const person = { mode: "person", accountId: "person-a", name: "Fixture User", days: 7 }
const team = { mode: "team-project", groups: ["ent-web", "ent-be1"], exclusions: { "ent-web": ["b"] }, projects: ["sun"], days: 17 }
const user = (accountId) => ({ accountId, displayName: `Fixture ${accountId}`, accountType: "atlassian" })

// Only fixture auth, allowlisted source modules, and local synthetic Jira responses are available.
function harness(t, options = {}) {
  const calls = [], tokenCalls = [], violations = []
  const modules = new Map()
  let active = 0, maxActive = 0, searchIndex = 0
  const fail = (message) => { violations.push(message); throw new Error(message) }
  class JiraAuthorizationError extends Error { constructor(code) { super("Fixture auth error"); this.code = code } }
  const globals = {
    Buffer, URL, URLSearchParams, AbortSignal, Request, Response,
    process: { env: {} }, console: { error: () => {} },
    fetch: async (url, init = {}) => {
      const prefix = "https://api.atlassian.com/ex/jira/fixture-cloud/rest/api/3/"
      if (!url.startsWith(prefix) || init.headers?.Authorization !== "Bearer fixture-token-not-real" || init.cache !== "no-store" || !init.signal) return fail("Unexpected transport or credential access")
      const path = url.slice(prefix.length), method = init.method ?? "GET"
      const body = init.body ? JSON.parse(init.body) : null
      calls.push({ path, method, body })
      if (options.responseStatus) return new Response(null, { status: options.responseStatus })
      if (options.networkError) throw new Error("Fixture offline")
      let data
      if (path === "search/jql" && method === "POST") {
        if (JSON.stringify(body.fields) !== '["project"]' || body.maxResults !== 100) return fail("Search must request minimal project-only page fields")
        active++; maxActive = Math.max(maxActive, active)
        try {
          data = options.search ? await options.search(body, searchIndex++) : { issues: [issue(1)], isLast: true }
        } finally { active-- }
      } else if (path.startsWith("user?") && method === "GET") {
        const id = new URL(url).searchParams.get("accountId")
        if (init.redirect !== "error") return fail("Lookup must reject redirects")
        data = options.user ? options.user(id) : user(id)
      } else if (path.startsWith("group/member?") && method === "GET") {
        const params = new URL(url).searchParams, name = params.get("groupname")
        if (init.redirect !== "error" || !options.groups?.[name]) return fail("Unexpected group lookup")
        const members = options.groups[name], startAt = Number(params.get("startAt")), values = members.slice(startAt, startAt + 50)
        data = { startAt, total: members.length, values, isLast: startAt + values.length === members.length }
      } else return fail(`Unexpected Jira operation ${method} ${path}`)
      if (options.malformedJson) return new Response("invalid JSON", { status: 200 })
      return new Response(JSON.stringify(data), { status: 200 })
    },
  }
  const sandbox = vm.createContext(globals)
  const allowed = ["lib/jira-dashboard.ts", "lib/jira-dashboard-alerts.ts", "lib/jira-dashboard-alerts-server.ts", "lib/jira-dashboard-filter.ts", "lib/jira-dashboard-lookups.ts", "lib/jira-fields.ts", "lib/jira-jql.ts", "lib/jira-missing-data.ts", "lib/jira-page-token.ts", "app/api/dashboard/alerts/route.ts"]
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!allowed.includes(path)) return fail(`Unexpected module ${path}`)
    const loaded = { exports: {} }; modules.set(path, loaded)
    if (!compiled.has(path)) {
      const filename = fileURLToPath(new URL(path, root))
      compiled.set(path, ts.transpileModule(readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)
    }
    const fixtureRequire = (specifier) => {
      if (specifier === "server-only") return {}
      if (specifier === "node:crypto") return require(specifier)
      if (specifier === "@/auth") return { auth: async () => options.unauthenticated ? null : { user: { id: "fixture-viewer" } } }
      if (specifier === "@/lib/jira-token") return {
        JiraAuthorizationError,
        getJiraToken: async (refresh) => { tokenCalls.push(refresh); if (options.authError) throw new JiraAuthorizationError(options.authError); return { cloudId: "fixture-cloud", accessToken: "fixture-token-not-real" } },
      }
      if (specifier.startsWith("@/lib/")) return load(specifier.slice(2) + ".ts")
      if (specifier.startsWith("./")) return load("lib/" + specifier.slice(2))
      return fail(`Unexpected import ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports){\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loaded, loaded.exports)
    return loaded.exports
  }
  t.after(() => assert.deepEqual(violations, []))
  return { service: load("lib/jira-dashboard-alerts-server.ts"), count: load("lib/jira-dashboard.ts").countJiraIssues, model: load("lib/jira-dashboard-alerts.ts"), route: () => load("app/api/dashboard/alerts/route.ts"), calls, tokenCalls, maxActive: () => maxActive }
}
const credentials = { cloudId: "fixture-cloud", accessToken: "fixture-token-not-real" }
const rejectsCode = (value, code) => assert.rejects(value, (error) => error.code === code)

describe("exact alert count traversal", () => {
  it("counts all pages using only search and minimal fields", async (t) => {
    const h = harness(t, { search: (body) => body.nextPageToken ? { issues: [issue(2)], isLast: true } : { issues: [issue(1)], nextPageToken: "second", isLast: false } })
    assert.equal(await h.count(credentials, "fixture count"), 2)
    assert.deepEqual(h.calls.map((call) => call.body.nextPageToken), [undefined, "second"])
    assert.equal(h.tokenCalls.length, 0)
  })
  it("accepts a verified empty terminal result as zero", async (t) => {
    const h = harness(t, { search: () => ({ issues: [], isLast: true }) })
    assert.equal(await h.count(credentials, "fixture count"), 0)
  })
  for (const [name, pages] of [
    ["same-page duplicate", [{ issues: [issue(1), issue(1)], isLast: true }]],
    ["cross-page duplicate", [{ issues: [issue(1)], nextPageToken: "second" }, { issues: [issue(1)], isLast: true }]],
    ["repeated cursor", [{ issues: [issue(1)], nextPageToken: "same" }, { issues: [issue(2)], nextPageToken: "same" }]],
    ["missing terminal marker", [{ issues: [] }]],
    ["contradictory cursor", [{ issues: [issue(1)], nextPageToken: "second", isLast: true }]],
    ["empty nonterminal", [{ issues: [], nextPageToken: "second" }]],
    ["invalid issue", [{ issues: [{ id: "not-numeric", key: "FIXTURE", fields: { project: { id: "10" } } }], isLast: true }]],
    ["absent project", [{ issues: [{ id: "1", key: "FIXTURE", fields: {} }], isLast: true }]],
    ["invalid envelope", [null]],
    ["oversized page", [{ issues: Array.from({ length: 101 }, (_, i) => issue(i + 1)), isLast: true }]],
    ["invalid cursor", [{ issues: [issue(1)], nextPageToken: "x".repeat(8193) }]],
  ]) it(`rejects ${name} without partial totals`, async (t) => {
    const h = harness(t, { search: (_body, index) => pages[index] })
    await rejectsCode(h.count(credentials, "fixture count"), "retry")
  })
  it("accepts exactly 5,000 terminal issues", async (t) => {
    const h = harness(t, { search: (_body, index) => ({ issues: Array.from({ length: 100 }, (_, i) => issue(index * 100 + i + 1)), ...(index === 49 ? { isLast: true } : { nextPageToken: `page-${index}` }) }) })
    assert.equal(await h.count(credentials, "fixture count"), 5000)
    assert.equal(h.calls.length, 50)
  })
  it("fails at 5,000 with continuation without another search", async (t) => {
    const h = harness(t, { search: (_body, index) => ({ issues: Array.from({ length: 100 }, (_, i) => issue(index * 100 + i + 1)), nextPageToken: `page-${index}` }) })
    await rejectsCode(h.count(credentials, "fixture count"), "limit")
    assert.equal(h.calls.length, 50)
  })
  it("permits the 100th terminal page", async (t) => {
    const h = harness(t, { search: (_body, index) => ({ issues: [issue(index + 1)], ...(index === 99 ? { isLast: true } : { nextPageToken: `page-${index}` }) }) })
    assert.equal(await h.count(credentials, "fixture count"), 100)
    assert.equal(h.calls.length, 100)
  })
  it("stops after 100 nonterminal searches", async (t) => {
    const h = harness(t, { search: (_body, index) => ({ issues: [issue(index + 1)], nextPageToken: `page-${index}` }) })
    await rejectsCode(h.count(credentials, "fixture count"), "retry")
    assert.equal(h.calls.length, 100)
  })
  for (const [responseStatus, code] of [[400, "configuration"], [401, "reauthorize"], [403, "forbidden"], [429, "retry"], [500, "retry"]]) {
    it(`maps Jira HTTP ${responseStatus}`, async (t) => { const h = harness(t, { responseStatus }); await rejectsCode(h.count(credentials, "fixture count"), code) })
  }
  for (const option of ["networkError", "malformedJson"]) it(`maps ${option} without a zero`, async (t) => {
    const h = harness(t, { [option]: true }); await rejectsCode(h.count(credentials, "fixture count"), "retry")
  })
})

describe("scoped alert group orchestration", () => {
  it("authenticates the DAL independently and never gets a token if logged out", async (t) => {
    const h = harness(t, { unauthenticated: true })
    await rejectsCode(h.service.getDashboardAlertCounts("bugs"), "reauthorize")
    assert.equal(h.tokenCalls.length, 0); assert.equal(h.calls.length, 0)
  })
  it("counts only the two bug queries with one scope/token resolution", async (t) => {
    const h = harness(t)
    assert.deepEqual(plain(await h.service.getDashboardAlertCounts("bugs")), { s0s1: 1, s2: 1 })
    assert.deepEqual(h.calls.map((call) => call.body.jql), ["s0s1", "s2"].map((key) => h.model.dashboardAlertJql(key, { mode: "self" })))
    assert.deepEqual(h.tokenCalls, [undefined])
  })
  it("gets two pending totals with at most two active searches", async (t) => {
    const h = harness(t, { search: async () => { await new Promise((resolve) => setTimeout(resolve, 5)); return { issues: [issue(1)], isLast: true } } })
    assert.deepEqual(plain(await h.service.getDashboardAlertCounts("pending")), { inReview: 1, requestInfo: 1 })
    assert.equal(h.maxActive(), 2); assert.equal(h.calls.length, 2)
  })
  it("uses verified person account equality and ignores supplied days/name", async (t) => {
    const h = harness(t)
    await h.service.getDashboardAlertCounts("bugs", person)
    assert.equal(h.calls.filter((call) => call.path.startsWith("user?")).length, 1)
    assert.ok(h.calls.filter((call) => call.body).every((call) => call.body.jql.includes('assignee = "person-a"') && !call.body.jql.includes("-7d") && !call.body.jql.includes("Fixture User")))
  })
  it("fails a mismatched person before any search", async (t) => {
    const h = harness(t, { user: () => user("other-person") })
    await assert.rejects(h.service.getDashboardAlertCounts("bugs", person))
    assert.equal(h.calls.filter((call) => call.body).length, 0)
  })
  it("unions complete groups after per-group exclusions and intersects projects", async (t) => {
    const h = harness(t, { groups: { "ent-web": [user("a"), user("b")], "ent-be1": [user("b"), user("c")] } })
    await h.service.getDashboardAlertCounts("bugs", team)
    const searches = h.calls.filter((call) => call.body)
    assert.ok(searches.every((call) => call.body.jql.includes('assignee in ("a", "b", "c") AND project in (sun)') && !call.body.jql.includes("-17d")))
    assert.equal(h.calls.filter((call) => call.path.startsWith("group/member?")).length, 2)
  })
  it("fully paginates group members before searching", async (t) => {
    const h = harness(t, { groups: { "ent-web": Array.from({ length: 51 }, (_, i) => user(`u${i}`)) } })
    await h.service.getDashboardAlertCounts("bugs", { ...team, groups: ["ent-web"], exclusions: {} })
    const lookups = h.calls.filter((call) => call.path.startsWith("group/member?"))
    assert.equal(lookups.length, 2)
    assert.ok(h.calls.filter((call) => call.body).every((call) => call.body.jql.includes('"u50"')))
  })
  it("rejects an empty included team without widened searches", async (t) => {
    const h = harness(t, { groups: { "ent-web": [user("a")] } })
    await assert.rejects(h.service.getDashboardAlertCounts("bugs", { ...team, groups: ["ent-web"], exclusions: { "ent-web": ["a"] } }))
    assert.equal(h.calls.filter((call) => call.body).length, 0)
  })
  it("returns only a complete group and stops scheduling after failure", async (t) => {
    const h = harness(t, { search: (_body, index) => index === 0 ? { issues: [] } : { issues: [issue(1)], isLast: true } })
    await rejectsCode(h.service.getDashboardAlertCounts("pending"), "retry")
    assert.ok(h.calls.length <= 3)
  })
  it("does not query three-day stale reminders", async (t) => {
    const h = harness(t)
    await h.service.getDashboardAlertCounts("pending")
    assert.equal(h.calls.length, 2)
    assert.ok(h.calls.every((call) => !call.body.jql.includes("updated")))
  })
  it("rejects invalid kinds before auth/token lookup", async (t) => {
    const h = harness(t); await rejectsCode(h.service.getDashboardAlertCounts("arbitrary"), "configuration"); assert.equal(h.tokenCalls.length, 0)
  })
})

describe("authenticated dashboard alerts API", () => {
  it("returns a safe count DTO with private headers", async (t) => {
    const h = harness(t), response = await h.route().GET(new Request("https://fixture.invalid/api/dashboard/alerts?kind=bugs"))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Cache-Control"), "private, no-store")
    assert.equal(response.headers.get("Vary"), "Cookie")
    assert.deepEqual(await response.json(), { status: "success", kind: "bugs", counts: { s0s1: 1, s2: 1 } })
  })
  it("rejects unauthenticated callers without token/network access", async (t) => {
    const h = harness(t, { unauthenticated: true }), response = await h.route().GET(new Request("https://fixture.invalid/api/dashboard/alerts?kind=bugs"))
    assert.equal(response.status, 401); assert.equal(h.calls.length, 0); assert.equal(h.tokenCalls.length, 0)
  })
  for (const query of ["", "kind=other", "kind=bugs&kind=pending", "kind=bugs&jql=arbitrary", "kind=bugs&mode=person", "kind=bugs&mode=team-project&project=sun", "kind=bugs&mode=person&accountId=a&days=0", "kind=pending&view=summary", "kind=bugs&pageToken=fixture"]) {
    it(`rejects invalid query ${query}`, async (t) => {
      const h = harness(t), response = await h.route().GET(new Request(`https://fixture.invalid/api/dashboard/alerts?${query}`))
      assert.equal(response.status, 400); assert.equal(h.calls.length, 0); assert.equal(h.tokenCalls.length, 0)
    })
  }
  for (const [responseStatus, status, code] of [[400, 502, "configuration"], [401, 401, "reauthorize"], [403, 403, "forbidden"], [429, 502, "retry"]]) {
    it(`maps Jira ${responseStatus} to safe API error`, async (t) => {
      const h = harness(t, { responseStatus }), response = await h.route().GET(new Request("https://fixture.invalid/api/dashboard/alerts?kind=bugs"))
      assert.equal(response.status, status); assert.equal((await response.json()).error.code, code)
    })
  }
  it("maps expired OAuth without publishing credentials", async (t) => {
    const h = harness(t, { authError: "refresh_failed" }), response = await h.route().GET(new Request("https://fixture.invalid/api/dashboard/alerts?kind=bugs"))
    assert.equal(response.status, 401); assert.equal((await response.json()).error.code, "reauthorize"); assert.equal(h.calls.length, 0)
  })
})

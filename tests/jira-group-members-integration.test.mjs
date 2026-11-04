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
const groupUser = (id) => ({ accountId: id, displayName: `Member ${id}`, accountType: "atlassian", active: true })
const filter = (extra = {}) => ({ mode: "team-project", groups: ["ent-web"], exclusions: {}, projects: [], days: 30, ...extra })
const range = { from: "2026-05-05", to: "2026-11-04" }
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

// Actual group route, browser store, scope resolver and workload service run against
// authenticated fixtures only. Owned module allowlists and transport assertions reject live I/O.
function harness(t, options = {}) {
  let clock = Date.parse("2026-11-04T04:00:00Z")
  const identity = { viewerId: "fixture-viewer", cloudId: "fixture-cloud", accessToken: "fixture-token-not-real", expiresAt: clock / 1000 + 7200 }
  const state = { authenticated: true, tokenError: null }
  const groups = { "ent-web": Array.from({ length: 51 }, (_, index) => groupUser(`web-${String(index).padStart(3, "0")}`)), ...options.groups }
  const groupCalls = []
  const searches = []
  const tokenCalls = []
  const violations = []
  let authCalls = 0
  const fail = (message) => { violations.push(message); throw new Error(message) }
  class JiraAuthorizationError extends Error {
    constructor(message, code) { super(message); this.code = code }
  }
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])) }
    static now() { return clock }
  }
  const sandbox = vm.createContext({
    URL, URLSearchParams, Error, Date: ClockDate, AbortSignal, AbortController, Request, Response, Buffer,
    console: { error: () => {} },
    fetch: async (url, init) => {
      const parsed = new URL(url)
      const prefix = `/ex/jira/${encodeURIComponent(identity.cloudId)}`
      if (parsed.origin !== "https://api.atlassian.com" || !parsed.pathname.startsWith(prefix)) return fail("Unexpected Jira origin/site")
      if (init.cache !== "no-store" || init.headers?.Authorization !== `Bearer ${identity.accessToken}` || init.headers?.Accept !== "application/json" || !init.signal) return fail("Unsafe Jira transport")
      const path = parsed.pathname.slice(prefix.length)
      if (path === "/rest/api/3/group/member") {
        if (init.method !== "GET" || init.body || init.redirect !== "error") return fail("Unsafe member request")
        const group = parsed.searchParams.get("groupname")
        const startAt = Number(parsed.searchParams.get("startAt"))
        assert.equal(parsed.searchParams.get("maxResults"), "50")
        const call = { group, startAt, viewerId: identity.viewerId, cloudId: identity.cloudId }
        groupCalls.push(call)
        const replacement = await options.response?.(call, groupCalls.length)
        if (replacement instanceof Response) return replacement
        const members = groups[group] ?? [groupUser(`${group}-member`)]
        const values = members.slice(startAt, startAt + 50)
        const data = replacement ?? { values, startAt, total: members.length, isLast: startAt + values.length === members.length }
        return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } })
      }
      if (path === "/rest/api/3/search/jql") {
        if (init.method !== "POST" || !init.body) return fail("Unexpected issue search")
        const body = JSON.parse(init.body)
        searches.push(body)
        return new Response(JSON.stringify({ issues: [], isLast: true }), { headers: { "Content-Type": "application/json" } })
      }
      return fail(`Unexpected Jira route: ${path}`)
    },
  })
  const allowed = new Set([
    "app/api/dashboard/lookups/route.ts", "lib/team-members-store.ts",
    "lib/jira-http.ts", "lib/jira-dashboard-lookups.ts", "lib/jira-group-members-cache.ts",
    "lib/jira-workload.ts", "lib/jira-dashboard.ts", "lib/jira-fields.ts", "lib/jira-jql.ts",
    "lib/date-range.ts", "lib/jira-dashboard-filter.ts", "lib/jira-missing-data.ts",
    "lib/jira-page-token.ts", "lib/workload-heatmap.ts",
  ])
  function bundle() {
    const modules = new Map()
    function load(path) {
      if (modules.has(path)) return modules.get(path).exports
      if (!allowed.has(path)) return fail(`Unexpected module: ${path}`)
      const loaded = { exports: {} }
      modules.set(path, loaded)
      if (!compiled.has(path)) {
        const filename = fileURLToPath(new URL(path, root))
        compiled.set(path, ts.transpileModule(readFileSync(filename, "utf8"), {
          fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText)
      }
      const fixtureRequire = (specifier) => {
        if (specifier === "server-only") return {}
        if (specifier === "node:crypto") return require(specifier)
        if (specifier === "@/auth") return { auth: async () => {
          authCalls++
          return state.authenticated ? { user: { id: identity.viewerId } } : null
        } }
        if (specifier === "@/lib/jira-token") return {
          JiraAuthorizationError,
          getJiraToken: async (refresh) => {
            tokenCalls.push(refresh)
            if (state.tokenError) throw new JiraAuthorizationError("Fixture authorization rejected", state.tokenError)
            return { ...identity }
          },
        }
        if (specifier.startsWith("@/lib/")) return load(specifier.slice(2) + (specifier.endsWith(".ts") ? "" : ".ts"))
        if (specifier.startsWith("./")) return load("lib/" + specifier.slice(2) + (specifier.endsWith(".ts") ? "" : ".ts"))
        return fail(`Unexpected import: ${specifier}`)
      }
      vm.runInContext(`(function(require,module,exports){\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loaded, loaded.exports)
      return loaded.exports
    }
    const route = load("app/api/dashboard/lookups/route.ts")
    return {
      route,
      lookups: load("lib/jira-dashboard-lookups.ts"),
      workload: load("lib/jira-workload.ts"),
      jql: load("lib/jira-jql.ts"),
      createStore: () => load("lib/team-members-store.ts").createTeamMembersStore((url, init) => {
        const request = new Request(new URL(url, "https://fixture.invalid"), init)
        return route.GET(request)
      }),
    }
  }
  t.after(() => assert.deepEqual(violations, []))
  return {
    bundle, identity, state, groups, groupCalls, searches, tokenCalls,
    authCalls: () => authCalls,
    advance: (ms) => { clock += ms },
    request: (group = "ent-web") => new Request(`https://fixture.invalid/api/dashboard/lookups?view=group&group=${encodeURIComponent(group)}`),
  }
}

async function preload(h, bundle, group = "ent-web") {
  const response = await bundle.route.GET(h.request(group))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  assert.equal(response.headers.get("Vary"), "Cookie")
  const body = await response.json()
  assert.equal(body.status, "success")
  assert.ok(body.members.every((member) => Object.keys(member).sort().join(",") === "accountId,displayName"))
  return body.members
}

async function searchScope(h, bundle, submitted = filter()) {
  const result = await bundle.workload.workloadScope(submitted)
  await bundle.workload.getWorkloadHeatmapBase(result.scope, range, range.to, result.credentials)
  return result.scope
}

describe("shared server group cache: preload to workload", () => {
  it("reuses startup browser preload across independent route bundles while issue search remains fresh", async (t) => {
    const h = harness(t)
    const startup = h.bundle()
    const search = h.bundle() // Separate module maps, same VM/globalThis runtime.
    const store = startup.createStore()
    await store.preload()
    assert.equal(store.getSnapshot()["ent-web"].members.length, 51)
    const before = h.groupCalls.length
    const scope = await searchScope(h, search)
    assert.equal(scope.accountIds.length, 51)
    assert.equal(h.groupCalls.length, before)
    assert.deepEqual(h.groupCalls.filter((call) => call.group === "ent-web").map(({ startAt }) => startAt), [0, 50])
    assert.equal(h.searches.length, 1)
    assert.equal(h.searches[0].jql, search.jql.workloadDevTasksJql(scope, range))
    await searchScope(h, search)
    assert.equal(h.searches.length, 2)
    assert.equal(h.groupCalls.length, before)
    assert.equal(h.authCalls(), before - 1) // One extra group page is not another endpoint/auth call.
    assert.equal(h.tokenCalls.filter((refresh) => refresh === true).length, 2)
  })

  it("joins complete multi-page preload already in flight instead of starting another lookup", async (t) => {
    const started = deferred()
    const release = deferred()
    const h = harness(t, { response: async ({ group, startAt }) => {
      if (group === "ent-web" && startAt === 0) { started.resolve(); await release.promise }
    } })
    const startup = h.bundle()
    const search = h.bundle()
    const loading = startup.createStore().ensure("ent-web")
    await started.promise
    const result = searchScope(h, search)
    assert.equal(h.groupCalls.length, 1)
    release.resolve()
    await loading
    const scope = await result
    assert.equal(scope.accountIds.length, 51)
    assert.deepEqual(h.groupCalls.map(({ startAt }) => startAt), [0, 50])
  })

  it("cleans up a failed pending lookup shared across bundles without publishing partial members", async (t) => {
    const started = deferred()
    const release = deferred()
    let broken = true
    const h = harness(t, { response: async ({ group, startAt }) => {
      if (broken && group === "ent-web" && startAt === 50) {
        started.resolve()
        await release.promise
        return new Response("Private Jira fixture must never leak", { status: 403 })
      }
    } })
    const startup = h.bundle()
    const search = h.bundle()
    const loading = startup.route.GET(h.request())
    await started.promise
    const pendingSearch = search.workload.workloadScope(filter())
    const failedSearch = assert.rejects(() => pendingSearch, (error) => error.code === "forbidden")
    release.resolve()
    const failedPreload = await loading
    assert.equal(failedPreload.status, 403)
    assert.doesNotMatch(JSON.stringify(await failedPreload.json()), /Private Jira fixture/)
    await failedSearch
    assert.deepEqual(h.groupCalls.map(({ startAt }) => startAt), [0, 50])
    assert.equal(h.searches.length, 0)
    broken = false
    const recovered = await searchScope(h, search)
    assert.equal(recovered.accountIds.length, 51)
    assert.deepEqual(h.groupCalls.slice(2).map(({ startAt }) => startAt), [0, 50])
  })

  it("maps cache admission errors safely even when the shared cache came from another bundle", async (t) => {
    const release = deferred()
    const started = deferred()
    const h = harness(t, { response: async ({ startAt }, count) => {
      if (startAt === 0) {
        if (count === 32) started.resolve()
        await release.promise
      }
    } })
    const owner = h.bundle()
    const otherBundle = h.bundle()
    const loads = Array.from({ length: 32 }, (_, index) => owner.lookups.getDashboardGroupMembers(
      "ent-web", { ...h.identity, viewerId: `fixture-viewer-${index}` }, { useSharedCache: true }
    ))
    await started.promise
    const response = await otherBundle.route.GET(h.request())
    assert.equal(response.status, 502)
    const body = await response.json()
    assert.equal(body.status, "error")
    assert.equal(body.error.code, "retry")
    assert.match(body.error.message, /忙碌/)
    assert.equal(h.groupCalls.length, 32)
    release.resolve()
    await Promise.all(loads)
  })

  it("reapplies group exclusions before union and preserves projects and range JQL", async (t) => {
    const h = harness(t, { groups: {
      "ent-web": [groupUser("person-1"), groupUser("person-2")],
      "ent-be1": [groupUser("person-2"), groupUser("person-3")],
    } })
    const startup = h.bundle()
    const search = h.bundle()
    await preload(h, startup)
    await preload(h, startup, "ent-be1")
    const scope = await searchScope(h, search, filter({
      groups: ["ent-web", "ent-be1"], exclusions: { "ent-web": ["person-2"], "ent-be1": ["person-3"] }, projects: ["sun"],
    }))
    assert.deepEqual(plain(scope.accountIds), ["person-1", "person-2"])
    assert.deepEqual(plain(scope.projects), ["sun"])
    assert.equal(h.groupCalls.length, 2)
    assert.equal(h.searches[0].jql, 'issuetype = "Dev-Task" AND status CHANGED TO "Done" DURING ("2026-05-05", "2026-11-04") AND assignee in ("person-1", "person-2") AND project in (sun) ORDER BY key ASC')
    await assert.rejects(() => search.workload.workloadScope(filter({ exclusions: { "ent-web": ["person-1", "person-2"] } })))
    assert.equal(h.searches.length, 1)
  })

  it("isolates viewers and sites but reuses membership after token rotation", async (t) => {
    const h = harness(t)
    const startup = h.bundle()
    const search = h.bundle()
    await preload(h, startup)
    h.identity.accessToken = "fixture-rotated-token-not-real"
    await search.workload.workloadScope(filter())
    assert.equal(h.groupCalls.length, 2)
    h.identity.viewerId = "fixture-other-viewer"
    await search.workload.workloadScope(filter())
    assert.equal(h.groupCalls.length, 4)
    h.identity.cloudId = "fixture-other-site"
    await search.workload.workloadScope(filter())
    assert.equal(h.groupCalls.length, 6)
  })

  it("requires endpoint auth and usable credentials before reusing a warm entry", async (t) => {
    const h = harness(t)
    const startup = h.bundle()
    const search = h.bundle()
    await preload(h, startup)
    h.state.authenticated = false
    assert.equal((await startup.route.GET(h.request())).status, 401)
    h.state.authenticated = true
    h.state.tokenError = "reauthorization_required"
    assert.equal((await startup.route.GET(h.request())).status, 401)
    await assert.rejects(() => search.workload.workloadScope(filter()), (error) => error.code === "reauthorize")
    h.state.tokenError = null
    h.identity.expiresAt = 0
    assert.equal((await startup.route.GET(h.request())).status, 401)
    await assert.rejects(() => search.workload.workloadScope(filter()), (error) => error.code === "reauthorization_required")
    assert.equal(h.groupCalls.length, 2)
    assert.equal(h.searches.length, 0)
  })

  it("hard expiry reloads complete membership rather than extending TTL on hits", async (t) => {
    const h = harness(t, { groups: { "ent-web": [groupUser("old-member")] } })
    const bundle = h.bundle()
    await preload(h, bundle)
    h.advance(29 * 60 * 1000)
    await bundle.workload.workloadScope(filter())
    assert.equal(h.groupCalls.length, 1)
    h.groups["ent-web"] = [groupUser("new-member")]
    h.advance(60 * 1000)
    const result = await bundle.workload.workloadScope(filter())
    assert.deepEqual(plain(result.scope.accountIds), ["new-member"])
    assert.equal(h.groupCalls.length, 2)
  })

  it("leaves default-fresh scope resolution independent of warmed workload membership", async (t) => {
    const h = harness(t, { groups: { "ent-web": [groupUser("old-member")] } })
    const bundle = h.bundle()
    await preload(h, bundle)
    h.groups["ent-web"] = [groupUser("new-member")]
    const fresh = await bundle.lookups.resolveDashboardScope(filter(), h.identity)
    assert.deepEqual(plain(fresh.accountIds), ["new-member"])
    const cached = await bundle.workload.workloadScope(filter())
    assert.deepEqual(plain(cached.scope.accountIds), ["old-member"])
    assert.equal(h.groupCalls.length, 2)
  })

  it("checks group allowlist before cache hits, including private Planning groups", async (t) => {
    const h = harness(t)
    const bundle = h.bundle()
    await bundle.lookups.getDashboardGroupMembers("ent-fpm", h.identity, { allowlist: new Set(["ent-fpm"]), useSharedCache: true })
    const before = h.groupCalls.length
    await assert.rejects(() => bundle.lookups.getDashboardGroupMembers("ent-fpm", h.identity, { useSharedCache: true }))
    assert.equal((await bundle.route.GET(h.request("ent-fpm"))).status, 400)
    assert.equal(h.groupCalls.length, before)
  })

  for (const failure of ["incomplete", "duplicate", "oversized", "forbidden"]) {
    it(`does not cache ${failure} member results and retries all pages`, async (t) => {
      let broken = true
      const h = harness(t, { response: ({ group, startAt }) => {
        if (!broken || group !== "ent-web") return undefined
        if (failure === "oversized") return { values: [], startAt: 0, total: 1001, isLast: false }
        if (failure === "forbidden") return new Response("Private Jira fixture", { status: 403 })
        if (startAt === 50 && failure === "incomplete") return { values: [groupUser("web-050")], startAt, total: 52, isLast: true }
        if (startAt === 50 && failure === "duplicate") return { values: [groupUser("web-000")], startAt, total: 51, isLast: true }
      } })
      const bundle = h.bundle()
      const failed = await bundle.route.GET(h.request())
      assert.equal((await failed.json()).status, "error")
      assert.equal(h.searches.length, 0)
      const before = h.groupCalls.length
      broken = false
      const result = await bundle.workload.workloadScope(filter())
      assert.equal(result.scope.accountIds.length, 51)
      assert.deepEqual(h.groupCalls.slice(before).map(({ startAt }) => startAt), [0, 50])
    })
  }
})

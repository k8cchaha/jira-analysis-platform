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
const credentials = { cloudId: "fixture-cloud", accessToken: "fixture-token-not-real", expiresAt: 9_999_999_999 }
const plain = (value) => JSON.parse(JSON.stringify(value))
const user = (id = "user-1", extra = {}) => ({
  accountId: id, displayName: `Fixture ${id}`, accountType: "atlassian", active: true,
  emailAddress: "private@example.invalid", avatarUrls: { "48x48": "https://fixture.invalid/avatar" },
  self: "https://fixture.invalid/user", ...extra,
})
const teamFilter = (extra = {}) => ({ mode: "team-project", groups: ["ent-web"], exclusions: {}, projects: [], days: 30, ...extra })

// These tests transpile only owned modules and the pure filter model. Auth/token are stubs,
// process is unavailable, and fetch cannot access real networking or arbitrary Jira routes.
function harness(t, options = {}) {
  const calls = []
  const tokenCalls = []
  const violations = []
  let authCalls = 0
  const fail = (message) => { violations.push(message); throw new Error(message) }
  class JiraAuthorizationError extends Error {
    constructor(code) { super("Secret fixture authorization detail"); this.code = code }
  }
  const modules = new Map()
  const sandbox = vm.createContext({
    URL, URLSearchParams, Error, AbortSignal, Response,
    fetch: async (url, init) => {
      const parsed = new URL(url)
      if (parsed.origin !== "https://api.atlassian.com" || !parsed.pathname.startsWith("/ex/jira/fixture-cloud/rest/api/3/")) return fail("Unexpected Jira origin")
      const path = parsed.pathname.slice("/ex/jira/fixture-cloud".length)
      if (!["/rest/api/3/user", "/rest/api/3/user/search", "/rest/api/3/group/member"].includes(path)) return fail("Unexpected Jira route")
      if (init.method !== "GET" || init.body || init.cache !== "no-store" || init.redirect !== "error" || !init.signal) return fail("Unsafe Jira request")
      if (init.headers?.Authorization !== `Bearer ${credentials.accessToken}` || init.headers?.Accept !== "application/json") return fail("Unexpected Jira headers")
      const call = { path, params: parsed.searchParams, init }
      calls.push(call)
      if (options.networkError) throw new Error("Secret fixture network detail")
      if (options.responseStatus) return new Response("Secret fixture Jira detail", { status: options.responseStatus })
      if (options.invalidJson) return new Response("Invalid JSON secret fixture", { status: 200 })
      const data = options.response
        ? await options.response(call, calls.length - 1)
        : path === "/rest/api/3/user/search" ? [user()] : path === "/rest/api/3/user" ? user(parsed.searchParams.get("accountId")) : { values: [user()], startAt: 0, total: 1, isLast: true }
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } })
    },
  })
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!["lib/jira-dashboard-lookups.ts", "lib/jira-dashboard-filter.ts", "lib/atlassian-oauth.ts", "app/api/dashboard/lookups/route.ts"].includes(path)) return fail(`Unexpected module: ${path}`)
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
      if (specifier === "@/auth") return { auth: async () => {
        authCalls++
        if (options.authThrow) throw new Error("Secret fixture session detail")
        return options.unauthenticated ? null : { user: { id: "fixture-session-user" } }
      } }
      if (specifier === "@/lib/jira-token") return {
        JiraAuthorizationError,
        getJiraToken: async (refresh) => {
          tokenCalls.push(refresh)
          if (options.authError) throw new JiraAuthorizationError(options.authError)
          return credentials
        },
      }
      if (["@/lib/jira-dashboard-lookups", "@/lib/jira-dashboard-filter"].includes(specifier)) return load(specifier.slice(2) + ".ts")
      return fail(`Unexpected require: ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports) {\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  t.after(() => assert.deepEqual(violations, []))
  return {
    service: load("lib/jira-dashboard-lookups.ts"), filter: load("lib/jira-dashboard-filter.ts"),
    route: () => load("app/api/dashboard/lookups/route.ts"), oauth: () => load("lib/atlassian-oauth.ts"),
    calls, tokenCalls, authCalls: () => authCalls, JiraAuthorizationError,
  }
}
const rejectsCode = (operation, code) => assert.rejects(operation, (error) => error.code === code)
const privateHeaders = (response) => {
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  assert.equal(response.headers.get("Vary"), "Cookie")
}
const routeRequest = (query) => new Request(`https://fixture.invalid/api/dashboard/lookups?${query}`)

describe("dashboard scope identity resolution", () => {
  it("self returns unchanged scope without Jira/auth/token lookup", async (t) => {
    const h = harness(t)
    assert.deepEqual(plain(await h.service.resolveDashboardScope({ mode: "self" }, credentials)), { mode: "self" })
    assert.equal(h.calls.length, 0)
    assert.equal(h.authCalls(), 0)
    assert.deepEqual(h.tokenCalls, [])
  })

  it("person verifies the accountId with Jira, ignoring the supplied name", async (t) => {
    const h = harness(t)
    const result = await h.service.resolveDashboardScope({ mode: "person", accountId: "jira:123-abc", name: "Spoofed display name", days: 42 }, credentials)
    assert.deepEqual(plain(result), { mode: "person", accountIds: ["jira:123-abc"], projects: [], days: 42 })
    assert.equal(h.calls[0].path, "/rest/api/3/user")
    assert.deepEqual([...h.calls[0].params], [["accountId", "jira:123-abc"]])
  })

  for (const [label, response, code] of [
    ["different identity", user("different"), "invalid_page"],
    ["app identity", user("person", { accountType: "app" }), "invalid_page"],
    ["customer identity", user("person", { accountType: "customer" }), "invalid_page"],
    ["missing account type", user("person", { accountType: undefined }), "retry"],
    ["missing ID", { displayName: "Fixture", accountType: "atlassian" }, "retry"],
    ["unsafe ID", user("bad\"id"), "retry"],
    ["empty name", user("person", { displayName: "" }), "retry"],
    ["oversized name", user("person", { displayName: "x".repeat(201) }), "retry"],
    ["array response", [user("person")], "retry"],
  ]) {
    it(`fails closed for a person with ${label}`, async (t) => {
      const h = harness(t, { response: () => response })
      await assert.rejects(() => h.service.resolveDashboardScope({ mode: "person", accountId: "person", name: "", days: 30 }, credentials), (error) => h.service.lookupError(error).code === code)
    })
  }

  it("rejects malformed person input before Jira", async (t) => {
    const h = harness(t)
    await assert.rejects(() => h.service.resolveDashboardScope({ mode: "person", accountId: "x OR currentUser()", name: "", days: 30 }, credentials))
    assert.equal(h.calls.length, 0)
  })

  it("union respects per-group exclusions and retains overlap in another group", async (t) => {
    const h = harness(t, { response: ({ params }) => ({ values: params.get("groupname") === "ent-web" ? [user("shared"), user("web-only")] : [user("shared"), user("be-only")], isLast: true, total: 2 }) })
    const result = await h.service.resolveDashboardScope(teamFilter({ groups: ["ent-web", "ent-be1"], exclusions: { "ent-web": ["shared", "web-only"] }, projects: ["sun"], days: 60 }), credentials)
    assert.deepEqual(plain(result), { mode: "team-project", accountIds: ["be-only", "shared"], projects: ["sun"], days: 60 })
  })

  it("empty member union is an explicit filter error, not a self fallback", async (t) => {
    const h = harness(t, { response: () => ({ values: [], startAt: 0, total: 0, isLast: true }) })
    await assert.rejects(() => h.service.resolveDashboardScope(teamFilter(), credentials), (error) => h.service.lookupError(error).code === "invalid_page")
  })

  it("caps concurrent selected-group lookups at four and loads every group", async (t) => {
    let active = 0
    let peak = 0
    const h = harness(t, { response: async ({ params }) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setImmediate(resolve))
      active--
      return { values: [user(params.get("groupname"))], isLast: true, total: 1 }
    } })
    const groups = h.filter.DASHBOARD_TEAMS.map((team) => team.group)
    const result = await h.service.resolveDashboardScope(teamFilter({ groups }), credentials)
    assert.equal(peak, 4)
    assert.equal(result.accountIds.length, groups.length)
    assert.equal(h.calls.length, groups.length)
  })

  it("a failed group prevents a partial scope and stops scheduling additional groups", async (t) => {
    const h = harness(t, { response: () => ({ values: null }) })
    await rejectsCode(() => h.service.resolveDashboardScope(teamFilter({ groups: h.filter.DASHBOARD_TEAMS.map((team) => team.group) }), credentials), "retry")
    assert.equal(h.calls.length, 4)
  })

  it("fails when the union across valid groups exceeds the shared 1,000-member limit", async (t) => {
    const h = harness(t, { response: ({ params }) => {
      const startAt = Number(params.get("startAt"))
      const group = params.get("groupname")
      return { values: Array.from({ length: 50 }, (_, i) => user(`${group}-${startAt + i}`)), startAt, total: 550, isLast: startAt === 500 }
    } })
    await assert.rejects(() => h.service.resolveDashboardScope(teamFilter({ groups: ["ent-web", "ent-be1"] }), credentials), (error) => h.service.lookupError(error).code === "invalid_page")
  })
})

describe("bounded safe user search", () => {
  it("encodes and trims the search while returning only accountId/displayName DTOs", async (t) => {
    const h = harness(t, { response: () => [user("valid"), user("valid"), user("inactive", { active: false }), user("app", { accountType: "app" }), user("customer", { accountType: "customer" })] })
    const result = await h.service.searchDashboardUsers("  王 & Alex  ", credentials)
    assert.deepEqual(plain(result), [{ accountId: "valid", displayName: "Fixture valid" }, { accountId: "inactive", displayName: "Fixture inactive" }])
    assert.equal(h.calls[0].path, "/rest/api/3/user/search")
    assert.deepEqual([...h.calls[0].params], [["query", "王 & Alex"], ["startAt", "0"], ["maxResults", "20"]])
    assert.doesNotMatch(JSON.stringify(result), /email|avatar|self|token|cloudId|accountType/)
  })

  it("prefers all exact displayName matches over partial matches", async (t) => {
    const h = harness(t, { response: () => [
      user("partial", { displayName: "Alex Example" }),
      user("exact-one", { displayName: "Alex" }),
      user("exact-two", { displayName: "Alex" }),
    ] })
    assert.deepEqual(plain(await h.service.searchDashboardUsers(" Alex ", credentials)), [
      { accountId: "exact-one", displayName: "Alex" },
      { accountId: "exact-two", displayName: "Alex" },
    ])
  })

  it("matches exact displayNames case-insensitively", async (t) => {
    const h = harness(t, { response: () => [
      user("partial", { displayName: "Alex Example" }),
      user("exact", { displayName: "aLeX" }),
    ] })
    assert.deepEqual(plain(await h.service.searchDashboardUsers(" ALEX ", credentials)), [
      { accountId: "exact", displayName: "aLeX" },
    ])
  })

  it("falls back to all safe search matches when no displayName exactly matches", async (t) => {
    const h = harness(t, { response: () => [
      user("one", { displayName: "Alex Example" }),
      user("two", { displayName: "Alexander" }),
    ] })
    assert.deepEqual(plain(await h.service.searchDashboardUsers("Alex", credentials)), [
      { accountId: "one", displayName: "Alex Example" },
      { accountId: "two", displayName: "Alexander" },
    ])
  })

  it("allows a single-character display-name search", async (t) => {
    const h = harness(t)
    assert.equal((await h.service.searchDashboardUsers(" 王 ", credentials)).length, 1)
    assert.equal(h.calls[0].params.get("query"), "王")
  })

  for (const query of ["", " ", "x".repeat(101), "safe\nquery", "safe\u007fquery", null]) {
    it(`rejects an invalid query ${JSON.stringify(query)} before Jira`, async (t) => {
      const h = harness(t)
      await assert.rejects(() => h.service.searchDashboardUsers(query, credentials))
      assert.equal(h.calls.length, 0)
    })
  }
  for (const response of [{ values: [user()] }, [user("bad id")], Array.from({ length: 21 }, (_, i) => user(`u-${i}`))]) {
    it("rejects malformed or oversized search data", async (t) => {
      const h = harness(t, { response: () => response })
      await rejectsCode(() => h.service.searchDashboardUsers("valid", credentials), "retry")
    })
  }
})

describe("complete bounded group pagination", () => {
  it("uses returned item count, not requested page size, and ignores upstream nextPage URLs", async (t) => {
    const h = harness(t, { response: ({ params }) => {
      assert.equal(params.get("groupname"), "ent-web")
      assert.equal(params.get("maxResults"), "50")
      const startAt = Number(params.get("startAt"))
      return startAt === 0
        ? { values: [user("one"), user("two")], startAt, total: 3, isLast: false, nextPage: "https://attacker.invalid/collect" }
        : { values: [user("three")], startAt, total: 3, isLast: true }
    } })
    const members = await h.service.getDashboardGroupMembers("ent-web", credentials)
    assert.deepEqual(plain(members.map((item) => item.accountId)), ["one", "two", "three"])
    assert.deepEqual(h.calls.map((call) => call.params.get("startAt")), ["0", "2"])
    assert.deepEqual(Object.keys(members[0]), ["accountId", "displayName"])
  })

  it("accepts total-based completion when isLast is omitted", async (t) => {
    const h = harness(t, { response: ({ params }) => {
      const startAt = Number(params.get("startAt"))
      return { values: [user(`u-${startAt}`)], startAt, total: 2 }
    } })
    assert.equal((await h.service.getDashboardGroupMembers("ent-web", credentials)).length, 2)
  })

  it("accepts isLast completion when startAt and total are omitted", async (t) => {
    const h = harness(t, { response: ({ params }) => ({ values: [user(`u-${params.get("startAt")}`)], isLast: params.get("startAt") === "1" }) })
    assert.equal((await h.service.getDashboardGroupMembers("ent-web", credentials)).length, 2)
  })

  it("skips app/customer DTOs without breaking source offsets", async (t) => {
    const h = harness(t, { response: ({ params }) => params.get("startAt") === "0"
      ? { values: [user("app", { accountType: "app" }), user("customer", { accountType: "customer" })], isLast: false, total: 3 }
      : { values: [user("one")], isLast: true, total: 3 } })
    assert.deepEqual(plain(await h.service.getDashboardGroupMembers("ent-web", credentials)), [{ accountId: "one", displayName: "Fixture one" }])
    assert.deepEqual(h.calls.map((call) => call.params.get("startAt")), ["0", "2"])
  })

  for (const [label, response] of [
    ["non-object page", []], ["missing values", { isLast: true }],
    ["oversized page", { values: Array.from({ length: 51 }, (_, i) => user(`u-${i}`)), isLast: true }],
    ["stalled empty page", { values: [], isLast: false, total: 2 }],
    ["missing completion markers", { values: [user()] }],
    ["mismatched start offset", { values: [user()], startAt: 50, isLast: true }],
    ["negative offset", { values: [user()], startAt: -1, isLast: true }],
    ["string offset", { values: [user()], startAt: "0", isLast: true }],
    ["invalid total", { values: [user()], total: 1.5, isLast: true }],
    ["string isLast", { values: [user()], isLast: "true" }],
    ["premature isLast", { values: [user()], total: 2, isLast: true }],
    ["false isLast at total", { values: [user()], total: 1, isLast: false }],
    ["total smaller than page", { values: [user()], total: 0, isLast: true }],
    ["duplicate identity", { values: [user(), user()], isLast: true }],
    ["malformed member", { values: [null], isLast: true }],
  ]) {
    it(`fails closed on ${label}`, async (t) => {
      const h = harness(t, { response: () => response })
      await rejectsCode(() => h.service.getDashboardGroupMembers("ent-web", credentials), "retry")
    })
  }

  it("rejects changing totals between pages", async (t) => {
    const h = harness(t, { response: ({ params }) => params.get("startAt") === "0" ? { values: [user("one")], total: 3, isLast: false } : { values: [user("two")], total: 2, isLast: true } })
    await rejectsCode(() => h.service.getDashboardGroupMembers("ent-web", credentials), "retry")
  })

  it("rejects repeated membership across pages", async (t) => {
    const h = harness(t, { response: () => ({ values: [user()], isLast: false }) })
    await rejectsCode(() => h.service.getDashboardGroupMembers("ent-web", credentials), "retry")
    assert.equal(h.calls.length, 2)
  })

  for (const group of ["jira-administrators", "ent-web&startAt=99", "ENT-WEB", "", null]) {
    it(`rejects nonallowlisted group ${JSON.stringify(group)} before Jira`, async (t) => {
      const h = harness(t)
      await assert.rejects(() => h.service.getDashboardGroupMembers(group, credentials))
      assert.equal(h.calls.length, 0)
    })
  }

  it("rejects total above 1,000 before returning any partial members", async (t) => {
    const h = harness(t, { response: () => ({ values: [user()], total: 1_001, isLast: false }) })
    await rejectsCode(() => h.service.getDashboardGroupMembers("ent-web", credentials), "limit")
    assert.equal(h.calls.length, 1)
  })

  it("accepts exactly 1,000 members and rejects over-limit source rows without total", async (t) => {
    const response = (isLast) => ({ params }) => {
      const startAt = Number(params.get("startAt"))
      return { values: Array.from({ length: 50 }, (_, i) => user(`u-${startAt + i}`)), startAt, isLast: isLast && startAt === 950 }
    }
    const exact = harness(t, { response: response(true) })
    assert.equal((await exact.service.getDashboardGroupMembers("ent-web", credentials)).length, 1_000)
    assert.equal(exact.calls.length, 20)
    const over = harness(t, { response: response(false) })
    await rejectsCode(() => over.service.getDashboardGroupMembers("ent-web", credentials), "limit")
    assert.equal(over.calls.length, 21)
  })

  it("stops after 100 nonterminal pages", async (t) => {
    const h = harness(t, { response: ({ params }) => ({ values: [user(`u-${params.get("startAt")}`)], isLast: false }) })
    await rejectsCode(() => h.service.getDashboardGroupMembers("ent-web", credentials), "limit")
    assert.equal(h.calls.length, 100)
  })
})

describe("safe lookup error mapping", () => {
  for (const [status, code] of [[401, "reauthorize"], [403, "forbidden"], [400, "configuration"], [404, "invalid_page"], [429, "retry"], [500, "retry"]]) {
    it(`maps Jira user status ${status} to ${code} without upstream text`, async (t) => {
      const h = harness(t, { responseStatus: status })
      await assert.rejects(() => h.service.searchDashboardUsers("valid", credentials), (error) => {
        const mapped = h.service.lookupError(error)
        assert.equal(mapped.code, code)
        assert.doesNotMatch(mapped.message, /Secret|fixture-token/)
        return true
      })
    })
  }
  it("group403 explicitly explains global permissions and missing-scope reauthorization", async (t) => {
    const h = harness(t, { responseStatus: 403 })
    await assert.rejects(() => h.service.getDashboardGroupMembers("ent-web", credentials), (error) => {
      assert.equal(error.code, "forbidden")
      assert.match(error.message, /Browse users and groups/)
      assert.match(error.message, /Administer Jira/)
      assert.match(error.message, /OAuth scopes/)
      assert.match(error.message, /重新授權/)
      return true
    })
  })
  it("missing group maps to configuration without propagating upstream payload", async (t) => {
    const h = harness(t, { responseStatus: 404 })
    await rejectsCode(() => h.service.getDashboardGroupMembers("ent-web", credentials), "configuration")
  })
  for (const options of [{ invalidJson: true }, { networkError: true }]) {
    it("maps JSON/network failures to safe retry errors", async (t) => {
      const h = harness(t, options)
      await rejectsCode(() => h.service.searchDashboardUsers("valid", credentials), "retry")
    })
  }
  it("maps known authorization, filter, and unknown exceptions safely", (t) => {
    const h = harness(t)
    assert.equal(h.service.lookupError(new h.JiraAuthorizationError("invalid_configuration")).code, "configuration")
    assert.equal(h.service.lookupError(new h.JiraAuthorizationError("refresh_failed")).code, "reauthorize")
    assert.deepEqual(plain(h.service.lookupError(new h.filter.DashboardFilterError("篩選無效"))), { code: "invalid_page", message: "篩選無效" })
    assert.doesNotMatch(h.service.lookupError(new Error("Secret credential content")).message, /Secret|credential/)
  })
})

describe("independently authenticated private lookup endpoint", () => {
  it("returns a users envelope with only safe DTOs and private headers", async (t) => {
    const h = harness(t)
    const response = await h.route().GET(routeRequest("view=users&query=valid"))
    assert.equal(response.status, 200)
    privateHeaders(response)
    assert.deepEqual(await response.json(), { status: "success", users: [{ accountId: "user-1", displayName: "Fixture user-1" }] })
    assert.equal(h.authCalls(), 1)
    assert.deepEqual(h.tokenCalls, [undefined])
  })
  it("returns a members envelope after independent auth/token checks", async (t) => {
    const h = harness(t)
    const response = await h.route().GET(routeRequest("view=group&group=ent-web"))
    assert.equal(response.status, 200)
    privateHeaders(response)
    assert.deepEqual(await response.json(), { status: "success", members: [{ accountId: "user-1", displayName: "Fixture user-1" }] })
    assert.equal(h.authCalls(), 1)
    assert.deepEqual(h.tokenCalls, [undefined])
  })
  it("returns 401 with private headers and never obtains a Jira token when logged out", async (t) => {
    const h = harness(t, { unauthenticated: true })
    const response = await h.route().GET(routeRequest("view=users&query=valid"))
    assert.equal(response.status, 401)
    privateHeaders(response)
    assert.equal((await response.json()).error.code, "reauthorize")
    assert.deepEqual(h.tokenCalls, [])
    assert.equal(h.calls.length, 0)
  })
  for (const query of [
    "", "view=users", "view=group", "view=arbitrary&query=valid", "view=users&query=%20",
    "view=users&query=valid&query=other", "view=users&view=group", "view=group&group=ent-web&group=ent-be1",
    "view=users&group=ent-web", "view=group&query=valid", "view=users&query=valid&path=user",
    "view=group&group=jira-administrators", "view=group&group=ent-web%26startAt%3D99",
    `view=users&query=${"x".repeat(101)}`, "view=users&query=safe%0Aquery",
    `view=group&group=${"x".repeat(2_050)}`,
  ]) {
    it(`rejects invalid endpoint input ${query.slice(0, 90)}`, async (t) => {
      const h = harness(t)
      const response = await h.route().GET(routeRequest(query))
      assert.equal(response.status, 400)
      privateHeaders(response)
      assert.equal((await response.json()).error.code, "invalid_page")
      assert.equal(h.calls.length, 0)
      assert.deepEqual(h.tokenCalls, [])
    })
  }
  for (const [options, query, status, code] of [
    [{ authError: "reauthorization_required" }, "view=users&query=valid", 401, "reauthorize"],
    [{ authError: "invalid_configuration" }, "view=users&query=valid", 502, "configuration"],
    [{ responseStatus: 403 }, "view=group&group=ent-web", 403, "forbidden"],
    [{ responseStatus: 429 }, "view=users&query=valid", 502, "retry"],
    [{ authThrow: true }, "view=users&query=valid", 502, "retry"],
    [{ response: () => ({ values: [], total: 1_001 }) }, "view=group&group=ent-web", 400, "limit"],
  ]) {
    it(`returns safe ${code} errors with private headers`, async (t) => {
      const h = harness(t, options)
      const response = await h.route().GET(routeRequest(query))
      assert.equal(response.status, status)
      privateHeaders(response)
      const body = await response.json()
      assert.equal(body.error.code, code)
      assert.doesNotMatch(JSON.stringify(body), /Secret|fixture-token|accessToken|cloudId|emailAddress/)
    })
  }
})

describe("narrow additive OAuth scopes", () => {
  it("includes the configured granular lookup and issue scopes without removing existing scopes", (t) => {
    const scopes = harness(t).oauth().ATLASSIAN_SCOPES.split(" ")
    assert.deepEqual(plain(scopes), ["read:me", "read:jira-work", "read:jira-user", "read:group:jira", "read:user:jira", "read:avatar:jira", "read:issue:jira", "write:jira-work", "offline_access"])
    assert.equal(new Set(scopes).size, scopes.length)
  })
})

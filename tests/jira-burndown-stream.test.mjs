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
const parentIssues = ["SUN-50", "SUN-51"].map((key, index) => ({
  id: String(400 + index),
  key,
  fields: { project: { id: "10" }, summary: `Parent ${key}` },
}))
const devTasks = [
  { id: "101", key: "SUN-101", summary: "Task A", points: 5, actualPoints: 6, resolvedAt: "2026-10-15T12:00:00+08:00", accountId: "u-aaa-101" },
  { id: "102", key: "SUN-102", summary: "Task B", points: 3, actualPoints: null, resolvedAt: "2026-10-18T12:00:00+08:00", accountId: "u-bbb-102" },
  { id: "103", key: "SUN-103", summary: "Task C", points: 8, actualPoints: 7, resolvedAt: "2026-10-19T12:00:00+08:00", accountId: "u-ccc-103" },
  { id: "104", key: "SUN-104", summary: "Unestimated", points: null, actualPoints: null, resolvedAt: null, accountId: "u-aaa-104" },
  { id: "105", key: "SUN-105", summary: "Task D", points: 2, actualPoints: 2, resolvedAt: "2026-10-13T12:00:00+08:00", accountId: "u-bbb-105" },
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
    parent: { id: "450", key: "SUN-50", fields: { issuetype: { name: task.parentType ?? "Story" } } },
  },
})

function harness(t, options = {}) {
  const calls = []
  const violations = []
  const tokenCalls = []
  const list = options.devTasks ?? devTasks
  const fail = (message) => { violations.push(message); throw new Error(message) }
  const parents = options.emptyParents ? [] : options.parentIssues ?? parentIssues
  const pagedResponse = async (issues, body, kind) => {
    if (body.nextPageToken && options[`${kind}PageGate`]) await options[`${kind}PageGate`]()
    if (body.nextPageToken && options[`${kind}PageError`]) return new Response(null, { status: options[`${kind}PageError`] })
    const size = options[`${kind}PageSize`] ?? Math.max(1, issues.length)
    const prefix = `fixture-${kind}-`
    if (body.nextPageToken && !body.nextPageToken.startsWith(prefix)) return fail(`Unexpected ${kind} fixture page token`)
    const offset = body.nextPageToken ? Number(body.nextPageToken.slice(prefix.length)) : 0
    if (!Number.isSafeInteger(offset) || offset < 0) return fail(`Invalid ${kind} fixture page offset`)
    const next = offset + size < issues.length ? `${prefix}${offset + size}` : null
    return new Response(JSON.stringify({
      issues: issues.slice(offset, offset + size),
      isLast: next === null,
      ...(next ? { nextPageToken: next } : {}),
    }), { status: 200 })
  }
  class JiraAuthorizationError extends Error {
    constructor(code) { super("Fixture authorization error"); this.code = code }
  }
  const modules = new Map()
  const globals = {
    Buffer, URL, URLSearchParams, Error, Intl, FormData, AbortSignal, Request, Response,
    // Freeze only the reference day; explicit calendar construction still uses the real Date implementation.
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [`${options.today ?? "2026-11-09"}T12:00:00.000Z`])) }
    },
    TextEncoder, TextDecoder, ReadableStream,
    process: { env: { AUTH_SECRET: "unit-test-only-not-real", ATLASSIAN_JIRA_CLOUD_URL: "https://fixture.example.invalid/jira" } },
    console: { error: () => {} },
    fetch: async (url, init = {}) => {
      const prefix = `https://api.atlassian.com/ex/jira/${encodeURIComponent(options.cloudId ?? "fixture-cloud")}`
      if (!url.startsWith(prefix + "/rest/api/3/")) return fail(`Unexpected Jira origin: ${url}`)
      // 路由真正走 SSE 時，`credentials` 由 route 的 getJiraToken(true) 給 stub token。
      if (init.headers?.Authorization !== "Bearer fixture-token-not-real") return fail("Unexpected authorization fixture")
      if (init.cache !== "no-store") return fail("Jira requests must not be cached")
      const path = url.slice(prefix.length)
      const method = init.method ?? "GET"
      const body = init.body ? JSON.parse(init.body) : null
      calls.push({ path, method, body })
      if (path === "/rest/api/3/myself") {
        if (method !== "GET" || body !== null) return fail("Profile lookup must be a body-free GET")
        if (init.headers?.Accept !== "application/json") return fail("Profile lookup must request JSON")
        if (init.redirect !== "error" || !init.signal) return fail("Profile lookup must reject redirects and use a timeout signal")
        if (options.myselfTransportError) throw new TypeError("Fixture network failure")
        if (options.myselfStatus) return new Response(null, { status: options.myselfStatus })
        const profile = Object.hasOwn(options, "profile") ? options.profile : { accountId: "fixture-user", timeZone: "Asia/Taipei" }
        return new Response(JSON.stringify(profile), { status: 200 })
      }
      if (!(path === "/rest/api/3/search/jql" && method === "POST")) return fail(`Unexpected Jira route: ${method} ${path}`)
      if (options.responseStatus) return new Response(null, { status: options.responseStatus })
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
  const allowed = [
    "lib/jira-burndown.ts", "lib/jira-account-timezone.ts",
    "lib/burndown-series.ts",
    "lib/burndown-completion.ts",
    "lib/burndown-params.ts",
    "lib/burndown-stream.ts",
    "lib/jira-dashboard.ts",
    "lib/jira-http.ts",
    "lib/date-range.ts", "lib/jira-dashboard-filter.ts",
    "lib/jira-dashboard-lookups.ts", "lib/jira-group-members-cache.ts",
    "lib/jira-fields.ts",
    "lib/jira-jql.ts",
    "lib/jira-missing-data.ts",
    "lib/jira-page-token.ts",
    "lib/jira-story-points.ts",
    "lib/jira-sprint-data.ts",
    "app/api/sprint/burndown/stream/route.ts",
    "app/(app)/sprint/burndown/page.tsx",
  ]
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!allowed.includes(path)) return fail(`Unexpected module: ${path}`)
    const loadedModule = { exports: {} }
    modules.set(path, loadedModule)
    if (!compiled.has(path)) {
      const filename = fileURLToPath(new URL(path, root))
      compiled.set(path, ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
      }).outputText)
    }
    const fixtureRequire = (specifier) => {
      if (specifier === "server-only") return {}
      if (specifier === "node:crypto" || specifier === "react/jsx-runtime") return require(specifier)
      if (specifier === "@/components/page-header") return { PageHeader: function PageHeader() {} }
      if (specifier === "@/app/(app)/sprint/burndown/burndown-client") return { BurndownClient: function BurndownClient() {} }
      if (specifier === "@/auth") return { auth: async () => options.unauthenticated ? null : { user: { id: "fixture-user" } } }
      if (specifier === "@/lib/jira-token") return {
        JiraAuthorizationError,
        getJiraToken: async (refresh) => {
          tokenCalls.push(refresh)
          if (options.authError) throw new JiraAuthorizationError(options.authError)
          return { ...credentials, cloudId: options.cloudId ?? credentials.cloudId }
        },
      }
      if (specifier.startsWith("@/lib/")) return load(specifier.slice(2) + (specifier.endsWith(".ts") ? "" : ".ts"))
      if (specifier.startsWith("./")) return load("lib/" + specifier.slice(2) + (specifier.endsWith(".ts") ? "" : ".ts"))
      return fail(`Unexpected require: ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports) {\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  t.after(() => assert.deepEqual(violations, []))
  return {
    service: load("lib/jira-burndown.ts"),
    stream: load("lib/burndown-stream.ts"),
    params: load("lib/burndown-params.ts"),
    route: () => load("app/api/sprint/burndown/stream/route.ts"),
    calls, tokenCalls,
    load,
  }
}
const credentials = { cloudId: "fixture-cloud", accessToken: "fixture-token-not-real", viewerId: "fixture-user", expiresAt: 4_102_444_800_000 }
const searches = (h) => h.calls.filter((call) => call.path === "/rest/api/3/search/jql")
// Explicit timestamp offsets are converted to the authenticated Jira account timezone.
const resolvedTasks = [
  { id: "201", key: "SUN-201", summary: "Retained Resolved before Sprint", points: 2, status: "Reopened", doneOn: "2026-10-15", resolvedAt: "2026-10-12T23:59:59.999+0800" },
  { id: "202", key: "SUN-202", summary: "Resolved at start midnight", points: 3, status: "In Progress", doneOn: "2026-10-18", resolvedAt: "2026-10-13T00:00:00.000+0800" },
  { id: "203", key: "SUN-203", summary: "Resolved without Done history at end of first day", points: 5, status: "Reopened", doneOn: null, resolvedAt: "2026-10-13T23:59:59.999+0800" },
  { id: "204", key: "SUN-204", summary: "Resolved at next day midnight", points: 0, status: "Done", doneOn: "2026-10-13", resolvedAt: "2026-10-14T00:00:00.000+0800" },
  { id: "205", key: "SUN-205", summary: "Cleared Resolved despite Done history and updated", points: 8, status: "Done", doneOn: "2026-10-13", updated: "2026-10-13T12:00:00.000+0800", resolvedAt: null },
  { id: "206", key: "SUN-206", summary: "Resolved after Sprint", points: 1, status: "Done", doneOn: "2026-10-13", resolvedAt: "2026-10-26T00:00:00.000+0800" },
]
const parseFrames = (body) => [...body.matchAll(/event: (\w+)\ndata: ([^\n]+)\n\n/g)].map((match) => ({ event: match[1], data: JSON.parse(match[2]) }))

describe("burndown base loader", () => {
  it("loads all completed markers, totalPoints, unestimated and parent keys", async (t) => {
    const h = harness(t)
    const base = await h.service.getBurndownBase(SPRINT, "2026-10-19", credentials)
    assert.equal(base.empty, false)
    assert.deepEqual(JSON.parse(JSON.stringify(base.parentKeys)), ["SUN-50", "SUN-51"])
    assert.equal(base.totalPoints, 18)
    assert.equal(base.tasks.length, 4)
    assert.deepEqual(Array.from(base.tasks, (task) => [task.key, task.doneDate, task.doneBeforeStart]), [
      ["SUN-101", "2026-10-15", false], ["SUN-102", "2026-10-18", false], ["SUN-103", "2026-10-19", false], ["SUN-105", "2026-10-13", false],
    ])
    assert.deepEqual(
      JSON.parse(JSON.stringify(base.tasks.map((task) => [task.key, task.points]).sort((a, b) => a[0].localeCompare(b[0])))),
      [["SUN-101", 5], ["SUN-102", 3], ["SUN-103", 8], ["SUN-105", 2]]
    )
    assert.equal(base.unestimated.length, 1)
    assert.equal(base.unestimated[0].key, "SUN-104")
  })
  it("returns an empty base with only the parent query when there are no parents", async (t) => {
    const h = harness(t, { emptyParents: true })
    const base = await h.service.getBurndownBase(SPRINT, "2026-10-19", credentials)
    assert.equal(base.empty, true)
    assert.equal(base.tasks.length, 0)
    assert.equal(base.unestimated.length, 0)
    assert.equal(base.totalPoints, 0)
    assert.equal(searches(h).length, 1)
    assert.equal(h.calls.length, 1, "empty parents skip the profile lookup too")
  })
})

describe("bulk completion API", () => {
  it("does not expose the removed daily Jira iterator", (t) => {
    assert.equal(harness(t).service.iterateDoneDays, undefined)
  })
})

describe("burndown SSE framing", () => {
  // This framing utility remains shared with workload; its generic day contract must survive.
  it("builds exact SSE frames for base/day/done/error", (t) => {
    const h = harness(t)
    assert.equal(
      h.stream.sse("done", {}),
      "event: done\ndata: {}\n\n"
    )
    assert.equal(
      h.stream.dayEvent({ date: "2026-10-15", keys: ["SUN-101"] }),
      'event: day\ndata: {"date":"2026-10-15","keys":["SUN-101"]}\n\n'
    )
    assert.match(h.stream.baseEvent({ today: "2026-10-19", empty: false, totalPoints: 18, tasks: [], unestimated: [], sprint: SPRINT }), /^event: base\ndata: \{/)
    assert.equal(
      h.stream.errorEvent({ code: "reauthorize", message: "請重新授權。" }),
      'event: error\ndata: {"code":"reauthorize","message":"請重新授權。"}\n\n'
    )
  })

  it("streams base → each day → done into the sink", async (t) => {
    const h = harness(t)
    const frames = []
    const sink = { enqueue: (frame) => frames.push(frame), close: () => { frames.push("<close>") } }
    const dayIterator = (async function* () {
      yield { date: "2026-10-13", keys: ["SUN-105"] }
      yield { date: "2026-10-15", keys: ["SUN-101"] }
    })()
    const base = { today: "2026-10-19", empty: false, totalPoints: 18, tasks: [], unestimated: [], sprint: SPRINT }
    await h.stream.streamBurndownEvents(sink, base, dayIterator, (e) => ({ code: "retry", message: String(e) }))
    assert.match(frames[0], /^event: base/)
    assert.match(frames[1], /event: day\ndata: \{"date":"2026-10-13","keys":\["SUN-105"\]\}/)
    assert.match(frames[2], /event: day\ndata: \{"date":"2026-10-15","keys":\["SUN-101"\]\}/)
    assert.equal(frames[3], "event: done\ndata: {}\n\n")
    assert.equal(frames[4], "<close>")
  })

  it("emits error and closes without a done event when a day throws", async (t) => {
    const h = harness(t)
    const frames = []
    const sink = { enqueue: (frame) => frames.push(frame), close: () => { frames.push("<close>") } }
    const dayIterator = (async function* () {
      yield { date: "2026-10-13", keys: [] }
      throw new Error("boom")
    })()
    const base = { today: "2026-10-19", empty: false, totalPoints: 18, tasks: [], unestimated: [], sprint: SPRINT }
    await h.stream.streamBurndownEvents(sink, base, dayIterator, () => ({ code: "retry", message: "爆炸" }))
    // 第一個 day（10-13）被 enqueue 後，下一次迭代才拋錯 → error 接在其後。
    assert.match(frames[0], /^event: base/)
    assert.equal(frames[1], 'event: day\ndata: {"date":"2026-10-13","keys":[]}\n\n')
    assert.equal(frames[2], 'event: error\ndata: {"code":"retry","message":"爆炸"}\n\n')
    assert.equal(frames[3], "<close>")
    assert.ok(frames.every((frame) => !frame.startsWith("event: done")), "must not emit done after an error")
  })
  it("frames bulk base directly to done when given an empty iterator", async (t) => {
    const h = harness(t)
    const frames = []
    const sink = { enqueue: (frame) => frames.push(frame), close: () => frames.push("<close>") }
    const base = { today: "2026-10-19", empty: false, totalPoints: 2, tasks: [{ key: "SUN-1", points: 2, doneBeforeStart: false, doneDate: "2026-10-15" }], unestimated: [], sprint: SPRINT }
    await h.stream.streamBurndownEvents(sink, base, (async function* () {})(), () => ({ code: "retry", message: "Unexpected failure" }))
    assert.deepEqual(parseFrames(frames.slice(0, -1).join("")).map((frame) => frame.event), ["base", "done"])
    assert.equal(frames.at(-1), "<close>")
    assert.equal(h.calls.length, 0)
  })
})

describe("burndown param parsing", () => {
  it("parses valid project and sprint ids", (t) => {
    const h = harness(t)
    assert.equal(h.params.parseProjectKey("SUN"), "SUN")
    assert.equal(h.params.parseSprintId("7517"), 7517)
  })
  it("rejects invalid project and sprint values", (t) => {
    const h = harness(t)
    assert.equal(h.params.parseProjectKey("NOPE"), null)
    assert.equal(h.params.parseProjectKey(undefined), null)
    assert.equal(h.params.parseSprintId("abc"), null)
    assert.equal(h.params.parseSprintId("0"), null)
    assert.equal(h.params.parseSprintId(undefined), null)
  })
  it("resolves a real sprint by id and rejects unknown ids", (t) => {
    const h = harness(t)
    const sprint = h.params.getSprintById("SUN", 7517)
    assert.equal(sprint.id, 7517)
    assert.equal(h.params.getSprintById("SUN", 999999), null)
    assert.equal(h.params.resolveSprint("SUN", 7517, "2026-10-19")?.id, 7517)
    // 未知 id 回退到目前 sprint（today 10-19 在 Sprint 70 範圍內）。
    assert.equal(h.params.resolveSprint("SUN", 1, "2026-10-19")?.id, 7517)
    assert.equal(h.params.resolveSprint(null, 7517, "2026-10-19"), null)
  })
})

describe("burndown stream route", () => {
  it("rejects unauthenticated callers without token or network access", async (t) => {
    const h = harness(t, { unauthenticated: true })
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
    assert.equal(response.status, 401)
    assert.equal(h.calls.length, 0)
    assert.equal(h.tokenCalls.length, 0)
  })
  it("rejects an invalid sprint before any token or stream", async (t) => {
    const h = harness(t)
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=nope"))
    assert.equal(response.status, 400)
    assert.equal(h.calls.length, 0)
    assert.equal(h.tokenCalls.length, 0)
    const response2 = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?sprint=7517"))
    assert.equal(response2.status, 400)
  })
  it("streams one fully projected base then done with no day frames", async (t) => {
    const h = harness(t)
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
    assert.equal(response.headers.get("Cache-Control"), "no-store, no-transform")
    const frames = parseFrames(await response.text())
    assert.deepEqual(frames.map((frame) => frame.event), ["base", "done"])
    assert.deepEqual(frames[0].data.tasks.map((task) => [task.key, task.doneDate]), [["SUN-101", "2026-10-15"], ["SUN-102", "2026-10-18"], ["SUN-103", "2026-10-19"], ["SUN-105", "2026-10-13"]])
    assert.deepEqual(frames[1].data, {})
    assert.equal(searches(h).length, 2)
  })
  it("turns an expired credential into a 401 before opening the stream", async (t) => {
    const h = harness(t, { authError: "refresh_failed" })
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error.code, "reauthorize")
    assert.equal(h.calls.length, 0)
  })
  it("maps full-task load failures to an error before any base or done", async (t) => {
    const h = harness(t, { allTasksError: 500 })
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517", { headers: { accept: "text/event-stream" } }))
    const frames = parseFrames(await response.text())
    assert.deepEqual(frames.map((frame) => frame.event), ["error"])
    assert.equal(frames[0].data.code, "retry")
  })

  // EventSource 讀不到非 2xx 的 body：若開流前失敗只回 401/400，瀏覽器只會落到
  // 通用的 onerror（「連線已中斷」），真正原因被丟掉。瀏覽器一律要拿到
  // 200 + `event: error` frame 才看得到訊息。
  it("delivers a pre-stream failure to EventSource as a readable error frame", async (t) => {
    const h = harness(t, { unauthenticated: true })
    const response = await h.route().GET(
      new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517", {
        headers: { accept: "text/event-stream" },
      })
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
    const body = await response.text()
    assert.equal(body, 'event: error\ndata: {"code":"reauthorize","message":"登入狀態已失效，請重新登入。"}\n\n')
    // 仍不得觸及 Jira 或簽發 token。
    assert.equal(h.calls.length, 0)
    assert.equal(h.tokenCalls.length, 0)
  })

  it("keeps real HTTP status codes for non-EventSource callers", async (t) => {
    const h = harness(t, { unauthenticated: true })
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
    assert.equal(response.status, 401)
    assert.equal(response.headers.get("Content-Type"), "application/json")
    assert.equal((await response.json()).error.code, "reauthorize")
  })

  it("names the invalid parameter to EventSource instead of a generic disconnect", async (t) => {
    const h = harness(t)
    const response = await h.route().GET(
      new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=nope", {
        headers: { accept: "text/event-stream" },
      })
    )
    assert.equal(response.status, 200)
    assert.match(await response.text(), /^event: error\ndata: \{"code":"configuration"/)
    assert.equal(h.calls.length, 0)
  })
})

describe("legacy By Resolved parameter contract", () => {
  it("accepts a missing legacy parameter or scalar canonical flag without selecting a mode", (t) => {
    const h = harness(t)
    assert.equal(h.params.isValidLegacyByResolved(undefined), true)
    assert.equal(h.params.isValidLegacyByResolved("1"), true)
    assert.equal(h.params.parseBurndownCompletionMode, undefined)
  })
  for (const value of ["", "0", "true", "resolved", "01", " 1", "1 ", [], ["1"], ["1", "1"], null]) {
    it(`rejects legacy ${JSON.stringify(value)} rather than widening the completion contract`, (t) => {
      assert.equal(harness(t).params.isValidLegacyByResolved(value), false)
    })
  }
  it("builds canonical mode-free URLs without emitting a legacy flag", (t) => {
    const h = harness(t)
    const { params } = h
    assert.equal(params.burndownQueryParams("SUN", 7517), "project=SUN&sprint=7517")
    assert.equal(params.burndownQueryParams("TKK", null), "project=TKK")
    assert.equal(params.burndownQueryParams(null, null), "")
    assert.equal(params.burndownHref("SUN", 7517), "/sprint/burndown?project=SUN&sprint=7517")
    assert.equal(params.burndownHref("TKK", null), "/sprint/burndown?project=TKK")
    assert.equal(params.burndownHref(null, null), "/sprint/burndown")
    for (const args of [["NOPE", 7517], [null, 7517], ["SUN", 0], ["SUN", 1.5], ["SUN", Number.MAX_SAFE_INTEGER + 1]]) {
      assert.throws(() => params.burndownHref(...args))
      assert.throws(() => params.burndownQueryParams(...args))
    }
    assert.equal(h.calls.length, 0)
  })
})

describe("bulk base pagination and stream atomicity", () => {
  it("projects opening and all daily markers from complete REST tasks without history queries", async (t) => {
    const h = harness(t, { devTasks: resolvedTasks, taskPageSize: 1, parentPageSize: 1 })
    const base = await h.service.getBurndownBase(SPRINT, "2026-10-14", credentials)
    assert.equal(base.totalPoints, 19)
    assert.deepEqual(Array.from(base.tasks, (task) => [task.key, task.doneBeforeStart, task.doneDate]), [
      ["SUN-201", true, null], ["SUN-202", false, "2026-10-13"], ["SUN-203", false, "2026-10-13"],
      ["SUN-204", false, "2026-10-14"], ["SUN-205", false, null], ["SUN-206", false, null],
    ])
    const requests = searches(h)
    assert.equal(requests.length, 8)
    assert.ok(requests.slice(0, 2).every((call) => call.body.jql === "sprint = 7517 AND issuetype in (story, task, bug)"))
    assert.ok(requests.slice(2).every((call) => call.body.jql === 'parent in (SUN-50, SUN-51) AND issuetype = "Dev-Task"'))
    assert.ok(requests.slice(2).every((call) => call.body.fields.includes("resolutiondate")))
    assert.equal(h.tokenCalls.length, 0)
  })
  for (const kind of ["parent", "task"]) {
    it(`does not open a successful stream until the last ${kind} page resolves`, async (t) => {
      let release
      let entered
      const gate = new Promise((resolve) => { release = resolve })
      const reached = new Promise((resolve) => { entered = resolve })
      const h = harness(t, { devTasks: resolvedTasks, [`${kind}PageSize`]: 1, [`${kind}PageGate`]: async () => { entered(); await gate } })
      let responseReady = false
      const pending = h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517")).then((response) => { responseReady = true; return response })
      try {
        await reached
        assert.equal(responseReady, false, "partial base must not be published while a page is pending")
      } finally {
        release()
      }
      const frames = parseFrames(await (await pending).text())
      assert.deepEqual(frames.map((frame) => frame.event), ["base", "done"])
      assert.equal(frames[0].data.tasks.length, 6)
      assert.equal(frames[0].data.tasks.find((task) => task.key === "SUN-204").doneDate, "2026-10-14")
    })
    it(`reports a later ${kind} page failure with no partial base or fake done`, async (t) => {
      const h = harness(t, { [`${kind}PageSize`]: 1, [`${kind}PageError`]: 500 })
      const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517", { headers: { accept: "text/event-stream" } }))
      const frames = parseFrames(await response.text())
      assert.deepEqual(frames.map((frame) => frame.event), ["error"])
      assert.equal(frames[0].data.code, "retry")
      if (kind === "parent") assert.equal(h.calls.length, 2, "incomplete parents never widen the Dev scope or trigger profile lookup")
    })
    it(`returns controlled JSON status for a later ${kind} page failure`, async (t) => {
      const h = harness(t, { [`${kind}PageSize`]: 1, [`${kind}PageError`]: 500 })
      const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
      assert.equal(response.status, 502)
      assert.equal((await response.json()).error.code, "retry")
    })
  }
  it("includes all pages in the single base with no additional daily searches", async (t) => {
    const h = harness(t, { devTasks: resolvedTasks, parentPageSize: 1, taskPageSize: 1 })
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
    const callsBeforeReading = h.calls.length
    assert.equal(callsBeforeReading, 9, "two parent pages, one profile lookup and six Dev pages precede the response")
    const frames = parseFrames(await response.text())
    assert.deepEqual(frames.map((frame) => frame.event), ["base", "done"])
    assert.equal(frames[0].data.tasks.length, 6)
    assert.equal(frames[0].data.tasks[0].doneBeforeStart, true)
    assert.equal(h.calls.length, callsBeforeReading, "framing must not perform additional Jira I/O")
  })
})

describe("Resolved-only stream route and legacy flag", () => {
  for (const suffix of ["byResolved", "byResolved=", "byResolved=0", "byResolved=true", "byResolved=1&byResolved=1", "byResolved=1&byResolved=0"]) {
    it(`rejects ${suffix} before credentials or Jira, including readable SSE errors`, async (t) => {
      const h = harness(t)
      const url = `https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517&${suffix}`
      const response = await h.route().GET(new Request(url))
      assert.equal(response.status, 400)
      assert.deepEqual((await response.json()).error, { code: "configuration", message: "舊版完成日期參數無效，請移除 byResolved 後重試。" })
      const sseResponse = await h.route().GET(new Request(url, { headers: { accept: "text/event-stream" } }))
      assert.equal(sseResponse.status, 200)
      assert.deepEqual(parseFrames(await sseResponse.text()), [{ event: "error", data: { code: "configuration", message: "舊版完成日期參數無效，請移除 byResolved 後重試。" } }])
      assert.equal(h.calls.length, 0)
      assert.equal(h.tokenCalls.length, 0)
    })
  }
  it("streams all default Resolved markers together without a mode or history query", async (t) => {
    const h = harness(t, { devTasks: resolvedTasks, today: "2026-10-14" })
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Cache-Control"), "no-store, no-transform")
    const frames = parseFrames(await response.text())
    assert.deepEqual(frames.map((frame) => frame.event), ["base", "done"])
    assert.equal(frames[0].data.today, "2026-10-14")
    assert.deepEqual(frames[0].data.tasks.map((task) => [task.key, task.doneBeforeStart, task.doneDate]), [
      ["SUN-201", true, null], ["SUN-202", false, "2026-10-13"], ["SUN-203", false, "2026-10-13"],
      ["SUN-204", false, "2026-10-14"], ["SUN-205", false, null], ["SUN-206", false, null],
    ])
    assert.ok(searches(h).every((call) => !/resolved|CHANGED|updated|status =/.test(call.body.jql)))
    assert.deepEqual(h.tokenCalls, [true])
  })
  it("accepts the legacy flag with exactly the same Resolved results and queries as the canonical route", async (t) => {
    const canonical = harness(t, { devTasks: resolvedTasks, today: "2026-10-14" })
    const legacy = harness(t, { devTasks: resolvedTasks, today: "2026-10-14" })
    const canonicalResponse = await canonical.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
    const legacyResponse = await legacy.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517&byResolved=1"))
    assert.equal(canonicalResponse.status, 200)
    assert.equal(legacyResponse.status, 200)
    const canonicalFrames = parseFrames(await canonicalResponse.text())
    assert.deepEqual(parseFrames(await legacyResponse.text()), canonicalFrames)
    assert.deepEqual(canonicalFrames.map((frame) => frame.event), ["base", "done"])
    assert.deepEqual(legacy.calls, canonical.calls)
    assert.equal(searches(legacy).length, 2)
    assert.ok(searches(legacy).every((call) => !/status|updated|CHANGED|resolved/.test(call.body.jql)))
    assert.deepEqual(canonical.tokenCalls, [true])
    assert.deepEqual(legacy.tokenCalls, [true])
  })
  it("finishes an empty-parent resolved stream without daily queries", async (t) => {
    const h = harness(t, { emptyParents: true })
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517&byResolved=1"))
    const frames = parseFrames(await response.text())
    assert.deepEqual(frames.map((frame) => frame.event), ["base", "done"])
    assert.equal(frames[0].data.empty, true)
    assert.equal(h.calls.length, 1)
  })
  it("does not publish partial base or fall back to history when full-task loading fails", async (t) => {
    const h = harness(t, { allTasksError: 500 })
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517&byResolved=1", { headers: { accept: "text/event-stream" } }))
    const frames = parseFrames(await response.text())
    assert.deepEqual(frames.map((frame) => frame.event), ["error"])
    assert.equal(frames[0].data.code, "retry")
    assert.ok(searches(h).every((call) => !/resolved|CHANGED/.test(call.body.jql)))
  })
  it("reports malformed resolutiondate before any base or done frame", async (t) => {
    const h = harness(t, { devTasks: [{ id: "601", key: "SUN-601", points: 5, resolvedAt: "2026-10-13" }] })
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517&byResolved=1", { headers: { accept: "text/event-stream" } }))
    const frames = parseFrames(await response.text())
    assert.deepEqual(frames.map((frame) => frame.event), ["error"])
    assert.equal(frames[0].data.code, "invalid_response")
  })
  it("keeps project/Sprint association and authentication checks for legacy URLs", async (t) => {
    const h = harness(t)
    const mismatch = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=TKK&sprint=7517&byResolved=1"))
    assert.equal(mismatch.status, 400)
    assert.equal(h.calls.length, 0)
    assert.equal(h.tokenCalls.length, 0)
    const unauthenticated = harness(t, { unauthenticated: true })
    const denied = await unauthenticated.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517&byResolved=1"))
    assert.equal(denied.status, 401)
    assert.equal(unauthenticated.calls.length, 0)
    assert.equal(unauthenticated.tokenCalls.length, 0)
  })
})

describe("profile lookup route failures", () => {
  for (const [options, code, status] of [
    [{ myselfStatus: 401 }, "reauthorize", 401],
    [{ myselfStatus: 403 }, "request_failed", 502],
    [{ myselfStatus: 429 }, "retry", 502],
    [{ myselfStatus: 500 }, "retry", 502],
    [{ myselfStatus: 503 }, "retry", 502],
    [{ myselfTransportError: true }, "retry", 502],
    [{ profile: { accountId: "another-viewer", timeZone: "Asia/Taipei" } }, "invalid_response", 502],
    [{ profile: { accountId: "fixture-user" } }, "invalid_response", 502],
    [{ profile: { accountId: "fixture-user", timeZone: "Not/A_Timezone" } }, "invalid_response", 502],
  ]) {
    it(`maps ${JSON.stringify(options)} to readable ${code} without base/done`, async (t) => {
      const h = harness(t, options)
      const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517", { headers: { accept: "text/event-stream" } }))
      assert.equal(response.status, 200)
      const frames = parseFrames(await response.text())
      assert.deepEqual(frames.map((frame) => frame.event), ["error"])
      assert.equal(frames[0].data.code, code)
      assert.equal(typeof frames[0].data.message, "string")
      assert.ok(frames[0].data.message.length > 0)
      assert.deepEqual(h.tokenCalls, [true])
      assert.equal(h.calls.filter((call) => call.path === "/rest/api/3/myself").length, 1)
    })
    it(`keeps controlled HTTP ${status} for non-SSE ${JSON.stringify(options)}`, async (t) => {
      const h = harness(t, options)
      const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
      assert.equal(response.status, status)
      assert.equal(response.headers.get("Content-Type"), "application/json")
      assert.equal((await response.json()).error.code, code)
    })
  }
})

describe("legacy By Resolved page shell", () => {
  for (const flag of [undefined, "1"]) {
    it(`uses the canonical mode-free endpoint for legacy ${JSON.stringify(flag)} without Jira requests`, async (t) => {
      const h = harness(t)
      const tree = await h.load("app/(app)/sprint/burndown/page.tsx").default({ searchParams: Promise.resolve({ project: "SUN", sprint: "7517", byResolved: flag }) })
      const client = tree.props.children.find((child) => child.type.name === "BurndownClient")
      assert.equal(Object.hasOwn(client.props, "completionMode"), false)
      assert.equal(client.props.endpoint, "/api/sprint/burndown/stream?project=SUN&sprint=7517")
      assert.equal(client.props.filterError, null)
      assert.equal(h.calls.length, 0)
      assert.equal(h.tokenCalls.length, 0)
    })
  }
  for (const flag of ["", "0", "true", ["1"], ["1", "1"]]) {
    it(`fails closed for ${JSON.stringify(flag)} with no endpoint or Jira requests`, async (t) => {
      const h = harness(t)
      const tree = await h.load("app/(app)/sprint/burndown/page.tsx").default({ searchParams: Promise.resolve({ project: "SUN", sprint: "7517", byResolved: flag }) })
      const client = tree.props.children.find((child) => child.type.name === "BurndownClient")
      assert.equal(Object.hasOwn(client.props, "completionMode"), false)
      assert.equal(client.props.endpoint, null)
      assert.equal(client.props.filterError, "舊版完成日期參數無效，請移除 byResolved 後重試。")
      assert.equal(h.calls.length, 0)
      assert.equal(h.tokenCalls.length, 0)
    })
  }
})

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
  { id: "101", key: "SUN-101", summary: "Task A", points: 5, actualPoints: 6, doneOn: "2026-10-15", accountId: "u-aaa-101" },
  { id: "102", key: "SUN-102", summary: "Task B", points: 3, actualPoints: null, doneOn: "2026-10-18", accountId: "u-bbb-102" },
  { id: "103", key: "SUN-103", summary: "Task C", points: 8, actualPoints: 7, doneOn: "2026-10-19", accountId: "u-ccc-103" },
  { id: "104", key: "SUN-104", summary: "Unestimated", points: null, actualPoints: null, doneOn: null, accountId: "u-aaa-104" },
  { id: "105", key: "SUN-105", summary: "Task D", points: 2, actualPoints: 2, doneOn: "2026-10-13", accountId: "u-bbb-105" },
]
const makeIssue = (task) => ({
  id: task.id,
  key: task.key,
  fields: {
    project: { id: "10" },
    summary: task.summary,
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
  const fail = (message) => { violations.push(message); throw new Error(message) }
  class JiraAuthorizationError extends Error {
    constructor(code) { super("Fixture authorization error"); this.code = code }
  }
  const modules = new Map()
  const globals = {
    Buffer, URL, URLSearchParams, Error, Date, FormData, AbortSignal, Request, Response,
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
      if (!(path === "/rest/api/3/search/jql" && method === "POST")) return fail(`Unexpected Jira route: ${method} ${path}`)
      if (options.responseStatus) return new Response(null, { status: options.responseStatus })
      const jql = body.jql
      if (jql.startsWith("sprint = 7517 AND issuetype in (story, task, bug)")) {
        return new Response(JSON.stringify({ issues: options.emptyParents ? [] : parentIssues, isLast: true }), { status: 200 })
      }
      if (/\bstatus CHANGED TO "Done" ON "(\d{4}-\d{2}-\d{2})"/.test(jql)) {
        if (options.dailyError) return new Response(null, { status: options.dailyError })
        const date = /\bstatus CHANGED TO "Done" ON "(\d{4}-\d{2}-\d{2})"/.exec(jql)[1]
        const done = devTasks.filter((task) => task.doneOn === date).map(makeIssue)
        return new Response(JSON.stringify({ issues: done, isLast: true }), { status: 200 })
      }
      if (/^parent in \(SUN-50, SUN-51\) AND issuetype = "Dev-Task"$/.test(jql)) {
        return new Response(JSON.stringify({ issues: devTasks.map(makeIssue), isLast: true }), { status: 200 })
      }
      return fail(`Unexpected search/jql: ${jql}`)
    },
  }
  const sandbox = vm.createContext(globals)
  const allowed = [
    "lib/jira-burndown.ts",
    "lib/burndown-series.ts",
    "lib/burndown-params.ts",
    "lib/burndown-stream.ts",
    "lib/jira-dashboard.ts",
    "lib/jira-dashboard-filter.ts",
    "lib/jira-dashboard-lookups.ts",
    "lib/jira-fields.ts",
    "lib/jira-jql.ts",
    "lib/jira-missing-data.ts",
    "lib/jira-page-token.ts",
    "lib/jira-story-points.ts",
    "lib/jira-sprint-data.ts",
    "app/api/sprint/burndown/stream/route.ts",
  ]
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!allowed.includes(path)) return fail(`Unexpected module: ${path}`)
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
      if (specifier === "@/auth") return { auth: async () => options.unauthenticated ? null : { user: { id: "fixture-user" } } }
      if (specifier === "@/lib/jira-token") return {
        JiraAuthorizationError,
        getJiraToken: async (refresh) => {
          tokenCalls.push(refresh)
          if (options.authError) throw new JiraAuthorizationError(options.authError)
          return { cloudId: options.cloudId ?? "fixture-cloud", accessToken: "fixture-token-not-real" }
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
const credentials = { cloudId: "fixture-cloud", accessToken: "fixture-token-not-real" }

describe("burndown base loader", () => {
  it("loads tasks (doneDate null), totalPoints, unestimated and parent keys", async (t) => {
    const h = harness(t)
    const base = await h.service.getBurndownBase(SPRINT, "2026-10-19", credentials)
    assert.equal(base.empty, false)
    assert.deepEqual(JSON.parse(JSON.stringify(base.parentKeys)), ["SUN-50", "SUN-51"])
    assert.equal(base.totalPoints, 18)
    // tasks 只含已估計、doneDate 尚未標記。
    assert.equal(base.tasks.length, 4)
    assert.ok(base.tasks.every((task) => task.doneDate === null))
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
    const searches = h.calls.filter((call) => call.path === "/rest/api/3/search/jql")
    assert.equal(searches.length, 1)
  })
})

describe("per-day done iterator", () => {
  it("yields keys per day in start→min(today,end) order", async (t) => {
    const h = harness(t)
    const seen = []
    for await (const { date, keys } of h.service.iterateDoneDays(SPRINT, "2026-10-15", credentials, ["SUN-50", "SUN-51"])) {
      seen.push([date, keys])
    }
    // start(10-13) 到 today(10-15)，不含 10-25。
    assert.deepEqual(seen.map(([date]) => date), ["2026-10-13", "2026-10-14", "2026-10-15"])
    assert.deepEqual(JSON.parse(JSON.stringify(seen[0][1])), ["SUN-105"]) // 10-13 完成 SUN-105
    assert.deepEqual(JSON.parse(JSON.stringify(seen[1][1])), [])          // 10-14 無人完成
    assert.deepEqual(JSON.parse(JSON.stringify(seen[2][1])), ["SUN-101"]) // 10-15 完成 SUN-101
  })
  it("propagates a mid-day Jira error to the caller", async (t) => {
    const h = harness(t, { dailyError: 500 })
    await assert.rejects(
      (async () => { for await (const _ of h.service.iterateDoneDays(SPRINT, "2026-10-25", credentials, ["SUN-50", "SUN-51"])) {} })(),
      (error) => error.code === "retry"
    )
  })
})

describe("burndown SSE framing", () => {
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
  it("streams base then per-day events then done", async (t) => {
    const h = harness(t)
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8")
    const body = await response.text()
    assert.match(body, /^event: base\ndata: \{/)
    const dayFrames = [...body.matchAll(/event: day\ndata: (\{[^\n]+\})/g)].map((m) => JSON.parse(m[1]))
    // 第一個 day 一定是 start(10-13)：當天 SUN-105 完成。日期以真系統 today 為準。
    assert.ok(dayFrames.length >= 1, `expected at least one day frame, got ${dayFrames.length}`)
    assert.equal(dayFrames[0].date, "2026-10-13")
    assert.deepEqual(dayFrames[0].keys, ["SUN-105"])
    assert.match(body, /event: done\ndata: \{\}\n\n$/)
  })
  it("turns an expired credential into a 401 before opening the stream", async (t) => {
    const h = harness(t, { authError: "refresh_failed" })
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error.code, "reauthorize")
    assert.equal(h.calls.length, 0)
  })
  it("maps Jira daily errors to an error SSE frame without a done event", async (t) => {
    const h = harness(t, { dailyError: 500 })
    const response = await h.route().GET(new Request("https://fixture.invalid/api/sprint/burndown/stream?project=SUN&sprint=7517"))
    const body = await response.text()
    assert.match(body, /^event: base/)
    assert.match(body, /event: error\ndata: \{/)
    assert.ok(!/\nevent: done\ndata:/.test(body), "must not emit done after an in-stream error")
  })
})
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

const RANGE = { from: "2026-10-13", to: "2026-10-19" }
const TODAY = "2026-10-19"
const SCOPE = { mode: "team-project", accountIds: ["u-aaa", "u-bbb"], projects: [], days: 30 }

/**
 * fixture 的 `resolutiondate` / `updated` 為 Jira 風格的 UTC 字串（中午，遠離 +0800 邊界）。
 * `resolutiondate: null` 代表 resolved 為空 → 走 updated 的 fallback。
 * `updated: null` 代表兩個欄位都無法解析。
 */
const devTasks = [
  { id: "101", key: "SUN-101", points: 5, resolutiondate: "2026-10-15T12:00:00.000+0000", accountId: "u-aaa" },
  { id: "102", key: "SUN-102", points: 3, resolutiondate: "2026-10-15T12:00:00.000+0000", accountId: "u-aaa" },
  { id: "103", key: "SUN-103", points: 8, resolutiondate: "2026-10-18T12:00:00.000+0000", accountId: "u-bbb" },
  { id: "104", key: "SUN-104", points: null, resolutiondate: "2026-10-17T12:00:00.000+0000", accountId: "u-aaa" },
  // resolved 早於區間 → 因為別的區間的轉換被撈到，但不屬於本次分析，整張丟棄。
  { id: "105", key: "SUN-105", points: 2, resolutiondate: "2026-10-01T12:00:00.000+0000", accountId: "u-bbb" },
  // resolved 晚於區間 → 夾到區間最後一天。
  { id: "107", key: "SUN-107", points: 6, resolutiondate: "2026-11-20T12:00:00.000+0000", accountId: "u-bbb" },
  // resolved 為空 → 用 updated。
  { id: "108", key: "SUN-108", points: 1, resolutiondate: null, updated: "2026-10-14T12:00:00.000+0000", accountId: "u-aaa" },
]

function makeIssue(task) {
  return {
    id: task.id,
    key: task.key,
    fields: {
      project: { id: "10" },
      summary: task.summary === undefined ? `Task ${task.key}` : task.summary,
      parent: task.parent,
      status: task.status,
      resolution: task.resolution,
      issuetype: { name: "Dev-Task" },
      [SP]: task.points,
      [ACTUAL_SP]: task.actualPoints,
      resolutiondate: task.resolutiondate === undefined ? "2026-10-15T12:00:00.000+0000" : task.resolutiondate,
      updated: task.updated === undefined ? "2026-10-15T12:00:00.000+0000" : task.updated,
      assignee:
        task.assigneeName !== undefined
          ? task.assigneeName === null
            ? undefined
            : { accountId: task.accountId ?? "u-fixture", displayName: task.assigneeName }
          : task.accountId === null
            ? undefined
            : { accountId: task.accountId, displayName: task.accountId.toUpperCase() },
    },
  }
}

function harness(t, options = {}) {
  const calls = []
  const violations = []
  const tokenCalls = []
  const fail = (message) => {
    violations.push(message)
    throw new Error(message)
  }
  const list = options.devTasks ?? devTasks
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
      calls.push({ path, method, body })
      if (!(path === "/rest/api/3/search/jql" && method === "POST")) return fail(`Unexpected Jira route: ${method} ${path}`)
      const jql = body.jql
      // 撈票看的是**轉換事件**，與 `resolutiondate` 無關，因此這裡不依 `resolutiondate` 過濾：
      // 一律回傳整個 fixture 清單（模擬「同一張票在多個區間都被撈到」），由服務層
      // 以 `resolutiondate` 決定完成日、淘汰不屬於本區間者。`resolutiondate` 為 null 的票也照樣
      // 回傳——真實 Jira 就是如此，這正是 `updated` fallback 存在的理由。
      const on = /\bstatus CHANGED TO "Done" ON "(\d{4}-\d{2}-\d{2})"/.exec(jql)
      if (on) {
        return new Response(JSON.stringify({ issues: list.map(makeIssue), isLast: true }), { status: 200 })
      }
      // 多日：status CHANGED TO "Done" DURING ("<from>", "<to>")
      const during = /\bstatus CHANGED TO "Done" DURING \("(\d{4}-\d{2}-\d{2})", "(\d{4}-\d{2}-\d{2})"\)/.exec(jql)
      if (during) {
        return new Response(JSON.stringify({ issues: list.map(makeIssue), isLast: true }), { status: 200 })
      }
      return fail(`Unexpected search/jql: ${jql}`)
    },
  }
  const sandbox = vm.createContext(globals)
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!["lib/jira-http.ts", "lib/jira-workload.ts", "lib/workload-heatmap.ts", "lib/jira-dashboard.ts", "lib/date-range.ts", "lib/jira-dashboard-filter.ts", "lib/jira-dashboard-lookups.ts", "lib/jira-fields.ts", "lib/jira-jql.ts", "lib/jira-missing-data.ts", "lib/jira-page-token.ts", "lib/jira-story-points.ts"].includes(path)) return fail(`Unexpected module: ${path}`)
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
          return { cloudId: options.cloudId ?? "fixture-cloud", accessToken: "fixture-token-not-real" }
        },
      }
      if (specifier === "./jira-jql.ts") return load("lib/jira-jql.ts")
      if (specifier === "./jira-fields.ts") return load("lib/jira-fields.ts")
      if (specifier === "./workload-heatmap.ts") return load("lib/workload-heatmap.ts")
      if (specifier === "./date-range.ts") return load("lib/date-range.ts")
      if (specifier === "./jira-dashboard-filter.ts") return load("lib/jira-dashboard-filter.ts")
      if (specifier === "./jira-dashboard.ts") return load("lib/jira-dashboard.ts")
      if (["@/lib/jira-http", "@/lib/jira-dashboard", "@/lib/date-range", "@/lib/jira-dashboard-filter", "@/lib/jira-dashboard-lookups", "@/lib/jira-fields", "@/lib/jira-jql", "@/lib/jira-missing-data", "@/lib/jira-page-token", "@/lib/workload-heatmap"].includes(specifier)) return load(specifier.slice(2) + ".ts")
      return fail(`Unexpected require: ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports) {\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  t.after(() => assert.deepEqual(violations, []))
  return { service: load("lib/jira-workload.ts"), jql: load("lib/jira-jql.ts"), calls, tokenCalls }
}

const credentials = { cloudId: "fixture-cloud", accessToken: "fixture-token-not-real" }
/** sandbox 內的陣列／物件來自另一個 realm，需先過 JSON 才能與宿主端深度比較。 */
const plain = (value) => JSON.parse(JSON.stringify(value))

describe("workload heatmap base", () => {
  it("issues exactly one query for the whole range", async (t) => {
    const h = harness(t)
    await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)

    // 一次查詢取回整個區間：不再逐日掃描。`DURING` 的 `to` **不加一**（見 builder 說明）。
    assert.equal(h.calls.length, 1)
    assert.equal(
      h.calls[0].body.jql,
      'issuetype = "Dev-Task" AND status CHANGED TO "Done" DURING ("2026-10-13", "2026-10-19") AND assignee in ("u-aaa", "u-bbb") ORDER BY key ASC'
    )
    // `searchJiraIssues` 一律自行加上 `project`；其餘為本服務要求的欄位。
    assert.deepEqual(h.calls[0].body.fields, ["project", "summary", "assignee", "resolutiondate", "updated", "parent", "status", "resolution", SP, ACTUAL_SP])
  })

  it("a single-day range uses ON instead of DURING", async (t) => {
    const h = harness(t)
    await h.service.getWorkloadHeatmapBase(SCOPE, { from: "2026-10-15", to: "2026-10-15" }, TODAY, credentials)
    assert.equal(
      h.calls[0].body.jql,
      'issuetype = "Dev-Task" AND status CHANGED TO "Done" ON "2026-10-15" AND assignee in ("u-aaa", "u-bbb") ORDER BY key ASC'
    )
  })

  it("resolves each completion date from resolved, dropping work completed before the range", async (t) => {
    const h = harness(t)
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)

    const byKey = Object.fromEntries(plain(base.tasks).map((task) => [task.key, task]))
    // 區間內完成：直接用 resolved 的日期（+0800）。
    assert.equal(byKey["SUN-101"].doneDate, "2026-10-15")
    assert.equal(byKey["SUN-102"].doneDate, "2026-10-15")
    assert.equal(byKey["SUN-103"].doneDate, "2026-10-18")
    // resolved 晚於區間：夾到區間最後一天。
    assert.equal(byKey["SUN-107"].doneDate, "2026-10-19")
    // resolved 為空：改用 updated。
    assert.equal(byKey["SUN-108"].doneDate, "2026-10-14")
    // 區間**前**完成者整張丟棄：不進 tasks，也不另立「先前完成」註記。
    assert.equal("SUN-105" in byKey, false)
    assert.equal(base.tasks.some((task) => task.key === "SUN-105"), false)
  })

  it("deduplicates a ticket the CHANGED semantics return more than once", async (t) => {
    const h = harness(t)
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
    const keys = plain(base.tasks).map((task) => task.key)
    assert.equal(new Set(keys).size, keys.length, `duplicate keys among ${JSON.stringify(keys)}`)
  })

  it("keeps unestimated tickets out of the points but reports them", async (t) => {
    const h = harness(t)
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
    assert.equal(base.unestimated.length, 1)
    assert.equal(base.unestimated[0].key, "SUN-104")
    assert.equal(base.tasks.find((task) => task.key === "SUN-104").points, null)
  })

  it("includes an unestimated ticket even when its resolved falls outside the range", async (t) => {
    // 未估計的判定先於完成日：即使這張票的完成日不屬於本區間，仍要出現在資料品質清單，
    // 否則「需要補填點數」的工作會隨著區間選擇而消失。
    const h = harness(t, {
      devTasks: [{ id: "104", key: "SUN-104", points: null, resolutiondate: "2026-10-01T12:00:00.000+0000", accountId: "u-aaa" }],
    })
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
    assert.deepEqual(plain(base.unestimated.map((item) => item.key)), ["SUN-104"])
    assert.deepEqual(plain(base.tasks), [])
  })

  it("stops the day list at today: future days are never drawn", async (t) => {
    const h = harness(t)
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, { from: "2026-10-13", to: "2026-10-31" }, TODAY, credentials)
    assert.equal(base.days.length, 7)
    assert.equal(base.days.at(-1), "2026-10-19")
    // 回傳的 range.to 也收斂到今天，client 不會畫出未來格。
    assert.equal(base.range.to, "2026-10-19")
  })

  it("has no day-count limit any more: a long range is still a single query", async (t) => {
    // 上限原本是為了防「N 天 = N 次查詢」；改成單次查詢後成本與天數脫鉤。
    const h = harness(t)
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, { from: "2026-01-01", to: "2026-10-19" }, TODAY, credentials)
    assert.equal(h.calls.length, 1)
    assert.equal(base.days.length, 292)
  })

  it("surfaces a Jira point value that cannot be read instead of guessing", async (t) => {
    const h = harness(t, { devTasks: [{ id: "101", key: "SUN-101", points: "five", resolutiondate: "2026-10-15T12:00:00.000+0000", accountId: "u-aaa" }] })
    await assert.rejects(
      () => h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials),
      /無法識別的 Story Points/
    )
  })

  it("preserves actual-only, SP-only, explicit zero and both-null tasks in a single dataset", async (t) => {
    const h = harness(t, { devTasks: [
      { id: "1", key: "A", accountId: "u-aaa", points: null, actualPoints: 4.2 },
      { id: "2", key: "B", accountId: "u-aaa", points: 3, actualPoints: null },
      { id: "3", key: "C", accountId: "u-aaa", points: 0, actualPoints: 0 },
      { id: "4", key: "D", accountId: "u-aaa", points: null, actualPoints: null },
    ] })
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
    assert.equal(h.calls.length, 1)
    assert.deepEqual(plain(base.tasks.map(({ key, points, actualPoints }) => ({ key, points, actualPoints }))), [
      { key: "A", points: null, actualPoints: 4.2 }, { key: "B", points: 3, actualPoints: null },
      { key: "C", points: 0, actualPoints: 0 }, { key: "D", points: null, actualPoints: null },
    ])
    assert.deepEqual(plain(base.unestimated.map((item) => item.key)), ["A", "D"])
    assert.deepEqual(plain(base.actualUnestimated.map((item) => item.key)), ["B", "D"])
    assert.equal(base.empty, false)
  })
  for (const actualPoints of ["five", -1]) {
    it(`rejects invalid Actual Story Points (${actualPoints}) instead of guessing`, async (t) => {
      const h = harness(t, { devTasks: [{ id: "1", key: "A", accountId: "u-aaa", points: null, actualPoints }] })
      await assert.rejects(() => h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials),
        (error) => error.code === "invalid_response" && /無法識別的 Actual Story Points/.test(error.message))
    })
  }
  it("treats omitted Actual as missing and retains out-of-range missing-field notices", async (t) => {
    const h = harness(t, { devTasks: [{ id: "1", key: "A", accountId: "u-aaa", points: 2, resolutiondate: "2026-10-01T12:00:00.000+0000" }] })
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
    assert.deepEqual(plain(base.tasks), [])
    assert.deepEqual(plain(base.actualUnestimated.map((item) => item.key)), ["A"])
    assert.deepEqual(plain(base.unestimated), [])
  })

  it("reports empty when the scope has no in-range Dev-Tasks at all", async (t) => {
    const h = harness(t, { devTasks: [] })
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
    assert.equal(base.empty, true)
    assert.deepEqual(plain(base.tasks), [])
    assert.deepEqual(plain(base.unestimated), [])
  })
})

describe("workload credentials and DTO projection", () => {
  it("projects only safe task details and never leaks tokens or cloudId", async (t) => {
    const h = harness(t)
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
    const serialized = JSON.stringify(base.tasks)
    assert.equal(serialized.includes("fixture-token-not-real"), false)
    assert.equal(serialized.includes("fixture-cloud"), false)
    for (const task of base.tasks) {
      assert.deepEqual(plain(Object.keys(task)).sort(), ["actualPoints", "assigneeAccountId", "assigneeDisplayName", "doneDate", "key", "parentIssueType", "points", "resolution", "resolvedDate", "status", "summary"])
      // doneDate 保證是區間內的日期字串，不再有 null。
      assert.match(task.doneDate, /^2026-10-1[3-9]$/)
    }
    // scope 只帶已驗證的識別碼，不含任何 Jira 原始 profile。
    assert.deepEqual(plain(base.scope.accountIds), ["u-aaa", "u-bbb"])
  })

  it("projects parent type and current status/resolution without raw metadata", async (t) => {
    const h = harness(t, { devTasks: [{ id: "1", key: "TEST-1", accountId: "u-aaa", points: 2,
      summary: "<script>summary</script>", status: { name: "In Progress", id: "secret-status" },
      resolution: { name: "Fixed", description: "secret-resolution" },
      parent: { id: "secret-parent", key: "SECRET-1", fields: { issuetype: { name: "Story", iconUrl: "secret-icon" }, summary: "secret-summary" } },
    }] })
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
    assert.equal(h.calls.length, 1)
    const task = plain(base.tasks[0])
    assert.deepEqual(task.parentIssueType, { status: "known", name: "Story" })
    assert.equal(task.summary, "<script>summary</script>")
    assert.equal(task.status, "In Progress", "Do not replace a currently reopened status with Done")
    assert.equal(task.resolution, "Fixed", "Resolution is a name, not resolved timestamp")
    assert.equal(task.resolvedDate, "2026-10-15")
    assert.doesNotMatch(JSON.stringify(task), /secret-|SECRET-1|iconUrl|Dev-Task/)
  })
  it("uses REST resolutiondate without a resolved alias for display and weekly completion", async (t) => {
    const fixture = { id: "1", key: "TEST-1", accountId: "u-aaa", points: 1,
      resolutiondate: "2026-10-15T16:30:00.000+0000", updated: "2026-10-18T12:00:00.000+0000" }
    const raw = makeIssue(fixture)
    assert.equal(Object.hasOwn(raw.fields, "resolved"), false)
    assert.equal(raw.fields.resolutiondate, fixture.resolutiondate)
    const h = harness(t, { devTasks: [fixture] })
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
    assert.equal(base.tasks[0].resolvedDate, "2026-10-16")
    assert.equal(base.tasks[0].doneDate, "2026-10-16", "Use resolutiondate, not the later updated date")
    assert.ok(h.calls[0].body.fields.includes("resolutiondate"))
    assert.equal(h.calls[0].body.fields.includes("resolved"), false)
  })
  it("keeps displayed Resolved separate from clamped/fallback completion date", async (t) => {
    const h = harness(t, { devTasks: [
      { id: "1", key: "TEST-1", accountId: "u-aaa", points: 1, resolutiondate: "2026-10-20T16:30:00.000+0000" },
      { id: "2", key: "TEST-2", accountId: "u-aaa", points: 1, resolutiondate: null },
      { id: "3", key: "TEST-3", accountId: "u-aaa", points: 1, resolutiondate: "invalid" },
    ] })
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
    assert.deepEqual(plain(base.tasks.map(({ doneDate, resolvedDate }) => ({ doneDate, resolvedDate }))), [
      { doneDate: "2026-10-19", resolvedDate: "2026-10-21" },
      { doneDate: "2026-10-15", resolvedDate: null }, { doneDate: "2026-10-15", resolvedDate: null },
    ])
  })
  for (const parent of [null, undefined, {}, [], { fields: { issuetype: { name: " " } } }]) {
    it(`handles missing parent/status/resolution safely (${JSON.stringify(parent)})`, async (t) => {
      const h = harness(t, { devTasks: [{ id: "1", key: "TEST-1", accountId: "u-aaa", points: 0,
        parent, summary: null, status: [], resolution: { name: 12 } }] })
      const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
      const task = plain(base.tasks[0])
      assert.deepEqual(task.parentIssueType, { status: parent === null ? "none" : "unknown" })
      assert.equal(task.summary, null)
      assert.equal(task.status, null)
      assert.equal(task.resolution, null)
      assert.equal(task.points, 0)
    })
  }

  it("keeps an unassigned Dev-Task as null rather than dropping it", async (t) => {
    const h = harness(t, {
      devTasks: [{ id: "106", key: "SUN-106", points: 4, resolutiondate: "2026-10-16T12:00:00.000+0000", accountId: null }],
    })
    const base = await h.service.getWorkloadHeatmapBase(SCOPE, RANGE, TODAY, credentials)
    const unassigned = base.tasks.find((task) => task.key === "SUN-106")
    assert.equal(unassigned.assigneeAccountId, null)
    assert.equal(unassigned.assigneeDisplayName, null)
    // 未指派的工作仍要留在 tasks 裡，否則熱點圖會少一列、點數被靜默丟棄。
    assert.equal(base.tasks.length, 1)
  })

  it("maps an authorization failure to a reauthorize error", async (t) => {
    const h = harness(t, { authError: "expired" })
    await assert.rejects(
      () => h.service.workloadScope({ ...SCOPE, groups: ["ent-web"], exclusions: {}, projects: [] }),
      (error) => error.name === "JiraWorkloadError" && error.code === "reauthorize"
    )
  })

  it("maps an incomplete OAuth configuration to request_failed, not reauthorize", async (t) => {
    const h = harness(t, { authError: "invalid_configuration" })
    await assert.rejects(
      () => h.service.workloadScope({ ...SCOPE, groups: ["ent-web"], exclusions: {}, projects: [] }),
      (error) => error.name === "JiraWorkloadError" && error.code === "request_failed"
    )
  })
})
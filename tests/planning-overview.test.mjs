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

// searchJiraIssues 會在最前面補 "project"。
const OVERVIEW_FIELDS_JSON = JSON.stringify(["project", "summary", "assignee", "reporter", "status", "issuetype", "parent", "customfield_10005"])

/**
 * 載入「任務規劃總覽」的 API route（`app/api/sprint/planning/overview/route.ts`）
 * 與純函式模組（`lib/planning-overview.ts`），stub `@/auth`、`@/lib/jira-token`、
 * `server-only`、`node:crypto`，並 mock `/rest/api/3/search/jql`（母票搜尋）。
 */
function harness(t, options = {}) {
  const violations = []
  const tokenCalls = []
  const overviewCalls = []
  const fail = (message) => { violations.push(message); throw new Error(message) }
  class JiraAuthorizationError extends Error {
    constructor(code) { super("Fixture authorization error"); this.code = code }
  }
  class JiraHttpError extends Error { constructor(status) { super(`Fixture http ${status}`); this.status = status } }

  // 母票含自身 issuetype + Epic parent（推導 epic）。
  const parents = options.parents ?? [
    {
      id: "1", key: "SUN-100",
      fields: {
        project: { id: "10" },
        issuetype: { name: "Story" },
        summary: "Story A",
        status: { name: "In Progress" },
        assignee: { displayName: "Owner A", accountId: "aa1" },
        reporter: { displayName: "PM X", accountId: "rr1" },
        parent: { id: "e1", key: "SUN-EPIC1", fields: { issuetype: { name: "Epic" }, summary: "Epic One" } },
        customfield_10005: 5,
      },
    },
    {
      id: "2", key: "SUN-101",
      fields: {
        project: { id: "10" },
        issuetype: { name: "Bug" },
        summary: "Bug B",
        status: { name: "Done" },
        assignee: null,
        reporter: null,
        parent: { id: "e2", key: "PRJ-EPIC2", fields: { issuetype: { name: "Epic" }, summary: null } },
        customfield_10005: null,
      },
    },
  ]

  const globals = {
    Buffer, URL, URLSearchParams, AbortSignal, Request, Response,
    process: { env: { AUTH_SECRET: "unit-test-only-not-real", ATLASSIAN_JIRA_CLOUD_URL: "https://fixture.example.invalid/jira" } },
    console: { error: () => {} },
    fetch: async (url, init = {}) => {
      const prefix = `https://api.atlassian.com/ex/jira/${encodeURIComponent(options.cloudId ?? "fixture-cloud")}`
      if (!url.startsWith(prefix + "/rest/api/3/")) return fail(`Unexpected Jira origin/route: ${url}`)
      if (init.headers?.Authorization !== "Bearer fixture-token-not-real") return fail("Unexpected authorization fixture")
      if (init.cache !== "no-store") return fail("Jira requests must not be cached")
      const path = url.slice(prefix.length)
      const method = init.method ?? "GET"
      const body = init.body ? JSON.parse(init.body) : null
      if (path === "/rest/api/3/search/jql" && method === "POST") {
        if (body.maxResults !== 100) return fail("Search must use maxResults 100")
        if (/\bsprint = \d+/.test(body.jql)) {
          if (JSON.stringify(body.fields) !== OVERVIEW_FIELDS_JSON) return fail(`Overview search must request overview fields; got ${JSON.stringify(body.fields)}`)
          overviewCalls.push(body.jql)
          if (options.responseStatus) return new Response(null, { status: options.responseStatus })
          return new Response(JSON.stringify({ issues: parents, isLast: true }), { status: 200 })
        }
        return fail(`Unexpected sprint search: ${body.jql}`)
      }
      return fail(`Unexpected Jira route: ${method} ${path}`)
    },
  }
  const sandbox = vm.createContext(globals)
  const allowed = [
    "lib/jira-dashboard.ts", "lib/jira-dashboard-filter.ts", "lib/jira-dashboard-lookups.ts",
    "lib/jira-fields.ts", "lib/jira-jql.ts", "lib/jira-missing-data.ts", "lib/jira-page-token.ts",
    "lib/jira-sprint-data.ts", "lib/burndown-params.ts", "lib/planning-data.ts",
    "lib/planning-subset.ts", "lib/planning-overview.ts", "app/api/sprint/planning/overview/route.ts",
  ]
  const modules = new Map()
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!allowed.includes(path)) return fail(`Unexpected module: ${path}`)
    const loaded = { exports: {} }
    modules.set(path, loaded)
    if (!compiled.has(path)) {
      const filename = fileURLToPath(new URL(path, root))
      compiled.set(path, ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
      }).outputText)
    }
    const fixtureRequire = (specifier) => {
      if (specifier === "server-only") return {}
      if (specifier === "node:crypto") return require("node:crypto")
      if (specifier === "@/auth") return { auth: async () => (options.unauthenticated ? null : { user: { id: "fixture-user" } }) }
      if (specifier === "@/lib/jira-token") return {
        JiraAuthorizationError,
        JiraHttpError,
        getJiraToken: async () => {
          tokenCalls.push(true)
          if (options.authError) throw new JiraAuthorizationError(options.authError)
          return { cloudId: options.cloudId ?? "fixture-cloud", accessToken: "fixture-token-not-real" }
        },
      }
      if (specifier.startsWith("@/lib/")) return load(specifier.slice(2) + (specifier.endsWith(".ts") ? "" : ".ts"))
      if (specifier.startsWith("./")) return load("lib/" + specifier.slice(2) + (specifier.endsWith(".ts") ? "" : ".ts"))
      return fail(`Unexpected require: ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports){\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loaded, loaded.exports)
    return loaded.exports
  }
  t.after(() => assert.deepEqual(violations, []))
  const route = load("app/api/sprint/planning/overview/route.ts")
  const model = load("lib/planning-overview.ts")
  return { route, model, tokenCalls, overviewCalls }
}

function GETroute(route, params) {
  const qs = new URLSearchParams(params).toString()
  return route.GET(new Request(`https://fixture.example.invalid/api/sprint/planning/overview${qs ? `?${qs}` : ""}`))
}

describe("planning overview route — auth & params", () => {
  it("無 session → 401，不打 token、不打 Jira", async (t) => {
    const h = harness(t, { unauthenticated: true })
    const res = await GETroute(h.route, { project: "SUN", sprint: "7517" })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.status, "error")
    assert.equal(body.error.code, "reauthorize")
    assert.equal(h.tokenCalls.length, 0)
  })

  it("壞 project → 400，不打 token", async (t) => {
    const h = harness(t)
    const res = await GETroute(h.route, { project: "NOPE", sprint: "7517" })
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.code, "configuration")
    assert.equal(h.tokenCalls.length, 0)
  })

  it("專案無進行中/未來 sprint（PRIDE）→ 400", async (t) => {
    const h = harness(t)
    const res = await GETroute(h.route, { project: "PRIDE", sprint: "7517" })
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.code, "configuration")
  })

  it("多重參數 → 400", async (t) => {
    const h = harness(t)
    const url = new URL("https://fixture.example.invalid/api/sprint/planning/overview")
    url.searchParams.append("project", "SUN")
    url.searchParams.append("project", "TKK")
    url.searchParams.append("sprint", "7517")
    const res = await h.route.GET(new Request(url))
    assert.equal(res.status, 400)
  })
})

describe("planning overview route — success & errors", () => {
  it("撈母票並回 success { items }，含 Epic 推導", async (t) => {
    const h = harness(t)
    const res = await GETroute(h.route, { project: "SUN", sprint: "7517" })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.status, "success")
    const items = plain(body.data.items)
    assert.deepEqual(plain(items.map((x) => x.key)), ["SUN-100", "SUN-101"])
    assert.equal(items[0].issueType, "Story")
    assert.deepEqual(plain(items[0].epic), { key: "SUN-EPIC1", summary: "Epic One" })
    assert.equal(items[0].points, 5)
    assert.equal(items[1].issueType, "Bug")
    assert.deepEqual(plain(items[1].epic), { key: "PRJ-EPIC2", summary: null })
    assert.equal(items[1].points, null)
    assert.equal(h.overviewCalls.length, 1)
    assert.match(h.overviewCalls[0], /issuetype in \(story, task, bug\)/)
    // client validator 可直接解碼。
    const parsed = h.model.parsePlanningOverviewResult(body)
    assert.equal(parsed.status, "success")
  })

  it("Jira 回 5xx → 502 retry", async (t) => {
    const h = harness(t, { responseStatus: 502 })
    const res = await GETroute(h.route, { project: "SUN", sprint: "7517" })
    assert.equal(res.status, 502)
    assert.equal((await res.json()).error.code, "retry")
  })

  it("authorization（非 configuration 錯誤）→ reauthorize 401", async (t) => {
    const h = harness(t, { authError: "missing_token" })
    const res = await GETroute(h.route, { project: "SUN", sprint: "7517" })
    assert.equal(res.status, 401)
    assert.equal((await res.json()).error.code, "reauthorize")
  })
})

describe("parsePlanningOverviewResult", () => {
  const validItem = (over = {}) => ({
    key: "SUN-102",
    summary: "S",
    issueType: "story",
    status: "In Progress",
    points: 3.5,
    assigneeDisplayName: "Owner",
    assigneeAccountId: "aa1",
    reporter: "PM",
    epic: { key: "SUN-EPIC1", summary: "Epic One" },
    ...over,
  })
  const good = { status: "success", data: { items: [] } }
  const ok = (t, payload) => {
    const h = harness(t)
    const parsed = h.model.parsePlanningOverviewResult(payload)
    assert.equal(parsed.status, "success")
    return parsed
  }

  it("接受合法 items（epic 有/無、三種 issueType、null points/reporter/assignee）", (t) => {
    const parsed = ok(t, { ...good, data: { items: [
      validItem(),
      validItem({ key: "SUN-103", epic: null, points: null, assigneeDisplayName: null, assigneeAccountId: null, reporter: null, issueType: "task" }),
      validItem({ key: "SUN-104", issueType: "bug" }),
    ] } })
    if (parsed.status !== "success") return
    assert.deepEqual(plain(parsed.data.items[1].epic), null)
    assert.equal(parsed.data.items[1].points, null)
    assert.equal(parsed.data.items[2].issueType, "bug")
  })

  it("回傳 error 分支並保留 code/message", (t) => {
    const h = harness(t)
    const parsed = h.model.parsePlanningOverviewResult({ status: "error", error: { code: "retry", message: "稍後重試" } })
    assert.equal(parsed.status, "error")
    if (parsed.status !== "error") return
    assert.equal(parsed.error.code, "retry")
    assert.equal(parsed.error.message, "稍後重試")
  })

  it("拒絕重複 key／缺 key／壞 epic／未列白名單的 error code", (t) => {
    const h = harness(t)
    assert.throws(() => h.model.parsePlanningOverviewResult({ ...good, data: { items: [validItem(), validItem()] } }))
    assert.throws(() => h.model.parsePlanningOverviewResult({ ...good, data: { items: [{ ...validItem(), key: "" }] } }))
    assert.throws(() => h.model.parsePlanningOverviewResult({ ...good, data: { items: [{ ...validItem(), epic: { key: "BAD KEY!", summary: null } }] } }))
    assert.throws(() => h.model.parsePlanningOverviewResult({ status: "error", error: { code: "nonsense", message: "x" } }))
    assert.throws(() => h.model.parsePlanningOverviewResult({ status: "success", data: "not-object" }))
    // epic 缺欄（無 summary）做 min 處置；壞 epic（summary 非字串）仍拒絕。
    assert.throws(() => h.model.parsePlanningOverviewResult({ ...good, data: { items: [{ ...validItem(), epic: { key: "SUN-E2", summary: 42 } }] } }))
  })
})

describe("buildOverviewGroups", () => {
  const item = (key, over = {}) => ({
    key,
    summary: null, issueType: "story", status: null, points: null,
    assigneeDisplayName: null, assigneeAccountId: null, reporter: null,
    epic: null,
    ...over,
  })

  it("Team 模式：依指派人團隊分群、未指派歸「其他」、群內帶 Epic 階層", (t) => {
    const h = harness(t)
    const groups = h.model.buildOverviewGroups({
      items: [
        item("SUN-105", { assigneeAccountId: "aa2", epic: { key: "E2", summary: "Epic2" } }),
        item("SUN-100", { assigneeAccountId: "aa1", assigneeDisplayName: "A", epic: { key: "E1", summary: "Epic1" } }),
        item("SUN-101", { assigneeAccountId: "aa1", assigneeDisplayName: "A", epic: { key: "E1", summary: "Epic1" } }),
        item("SUN-102", { assigneeAccountId: "aa1", assigneeDisplayName: "A", epic: null }),
        item("SUN-150", { assigneeAccountId: null, epic: { key: "E9", summary: "Epic9" } }),
      ],
      mode: "team",
      teamOf: (id) => (id === "aa1" ? "Web" : id === "aa2" ? "QA" : undefined),
      teamOrder: ["Web", "QA"],
    })
    assert.deepEqual(plain(groups.map((g) => g.label)), ["Web", "QA", "其他"])
    // Web 群：epic E1 → item SUN-100/SUN-101 children；無 epic item SUN-102。
    const web = groups[0]
    const epicRow = web.rows.find((row) => row.type === "epic")
    assert.equal(epicRow.epic.key, "E1")
    assert.deepEqual(plain(epicRow.children.map((c) => c.key)), ["SUN-100", "SUN-101"])
    assert.deepEqual(plain(web.rows.filter((row) => row.type === "item").map((row) => row.item.key)), ["SUN-102"])
    // 其他群：未指派的母票也顯示（母票清單不隱藏空卡）。
    assert.deepEqual(plain(groups[2].rows.map((row) => row.type)), ["epic"])
    assert.equal(groups[2].rows[0].epic.key, "E9")
  })

  it("Reporter 模式：依填報人分群、null 歸「未指定 Reporter」，群內 Epic 階層保留", (t) => {
    const h = harness(t)
    const groups = h.model.buildOverviewGroups({
      items: [
        item("SUN-100", { reporter: "PM Y", epic: { key: "E1", summary: "Epic1" } }),
        item("SUN-101", { reporter: "PM X", epic: null }),
        item("SUN-102", { reporter: null, epic: null }),
      ],
      mode: "reporter",
    })
    assert.deepEqual(plain(groups.map((g) => g.label).sort()), ["PM X", "PM Y", "未指定 Reporter"])
    const pmY = groups.find((g) => g.label === "PM Y")
    assert.equal(pmY.rows[0].type, "epic")
    const nep = groups.find((g) => g.label === "未指定 Reporter")
    assert.deepEqual(plain(nep.rows.map((r) => r.type)), ["item"])
  })

  it("群內排序：Epic 依 key、children 依 key、無 Epic item 依 key", (t) => {
    const h = harness(t)
    const groups = h.model.buildOverviewGroups({
      items: [
        item("SUN-2", { assigneeAccountId: "aa1", epic: null }),
        item("SUN-10", { assigneeAccountId: "aa1", epic: { key: "E1", summary: null } }),
        item("SUN-1", { assigneeAccountId: "aa1", epic: { key: "E1", summary: null } }),
        item("SUN-20", { assigneeAccountId: "aa1", epic: null }),
      ],
      mode: "team",
      teamOf: (id) => (id === "aa1" ? "Web" : undefined),
      teamOrder: ["Web"],
    })
    const grp = groups[0]
    assert.deepEqual(plain(grp.rows.map((row) => row.type)), ["epic", "item", "item"])
    assert.equal(grp.rows[0].type === "epic" && grp.rows[0].epic.key, "E1")
    assert.deepEqual(plain(grp.rows[0].children.map((c) => c.key)), ["SUN-1", "SUN-10"])
    assert.deepEqual(plain(grp.rows.filter((row) => row.type === "item").map((row) => row.item.key)), ["SUN-2", "SUN-20"])
  })
})

describe("countIssueTypes", () => {
  it("只算 mother ticket 的 story/task/bug，忽略其他 type", (t) => {
    const h = harness(t)
    const item = (k, type) => ({ key: k, summary: null, issueType: type, status: null, points: null, assigneeDisplayName: null, assigneeAccountId: null, reporter: null, epic: null })
    assert.deepEqual(plain(h.model.countIssueTypes([item("A", "Story"), item("B", "task"), item("C", "bug"), item("D", "Story"), item("E", "Epic"), item("F", null)])), { story: 2, task: 1, bug: 1 })
  })
})

describe("sumIssueTypePoints", () => {
  it("依票種加總母票點數，未估計視為 0，忽略 Epic；含小數進位", (t) => {
    const h = harness(t)
    const item = (k, type, points) => ({ key: k, summary: null, issueType: type, status: null, points, assigneeDisplayName: null, assigneeAccountId: null, reporter: null, epic: null })
    assert.deepEqual(
      plain(h.model.sumIssueTypePoints([
        item("A", "Story", 3.3), item("B", "Story", 2), item("C", "task", 1.5),
        item("D", "bug", null), item("E", "bug", 4), item("F", "Epic", 9), item("G", null, 5),
      ])),
      { story: 5.3, task: 1.5, bug: 4 }
    )
  })
})
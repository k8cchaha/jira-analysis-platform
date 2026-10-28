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

const TODAY = "2026-10-21"

/**
 * 載入新的 Planning subset API route（`app/api/sprint/planning/subset/route.ts`）
 * 及其依賴，stub `@/auth`、`@/lib/jira-token`、`server-only`、`node:crypto`，
 * 並 mock `/rest/api/3/search/jql`（母票搜尋 → 子集合搜尋）做端到端驗證。
 */
function harness(t, options = {}) {
  const violations = []
  const tokenCalls = []
  const fail = (message) => { violations.push(message); throw new Error(message) }
  class JiraAuthorizationError extends Error {
    constructor(code) { super("Fixture authorization error"); this.code = code }
  }
  class JiraHttpError extends Error { constructor(status) { super(`Fixture http ${status}`); this.status = status } }

  // 母票（MOTHER_FIELDS 撈取；含 summary/issuetype/parent=Epic 供階層投影）。
  const parents = options.parents ?? [
    { key: "SUN-100", id: "1", fields: { project: { id: "10" }, summary: "Story A", issuetype: { name: "Story" }, parent: { key: "SUN-90", fields: { summary: "Epic Alpha" } } } },
    { key: "SUN-101", id: "2", fields: { project: { id: "10" }, summary: "Task B", issuetype: { name: "Task" }, parent: null } },
  ]
  // 「未開子單」的母票：要完整明細欄位（summary/status/assignee/points）。
  const fullParents = options.fullParents ?? [
    {
      id: "1", key: "SUN-100",
      fields: {
        project: { id: "10" },
        summary: "Has subtasks",
        status: { name: "In Progress" },
        assignee: { displayName: "Owner A", accountId: "aa1" },
        reporter: { displayName: "Reporter X", accountId: "rr1" },
        components: [{ name: "Frontend" }, { name: "API" }],
        customfield_10005: 5,
      },
    },
    {
      id: "2", key: "SUN-101",
      fields: {
        project: { id: "10" },
        summary: "No children",
        status: { name: "To Do" },
        assignee: null,
        reporter: null,
        components: [],
        customfield_10005: null,
      },
    },
  ]
  // 子集合工作單（Dev+QA）：未估時（points 缺欄）＋未分派（assignee 空）共用同一批 fixture，
  // JQL 只在 server 端組合；此 mock 依載入內容決定母票/子集合回應。
  const subsetIssues = options.subsetIssues ?? [
    {
      id: "10", key: "SUN-102",
      fields: {
        project: { id: "10" },
        summary: "Unestimated task",
        status: { name: "In Progress" },
        assignee: null,
        issuetype: { name: "QA-Task" },
        customfield_14642: { value: "Bug" }, // option 物件形狀
        parent: { id: "450", key: "SUN-100", fields: { issuetype: { name: "Story" } } },
      },
    },
    {
      id: "11", key: "SUN-103",
      fields: {
        project: { id: "10" },
        summary: "Another task",
        status: { name: "To Do" },
        assignee: { displayName: "Owner A", accountId: "aa1" },
        issuetype: { name: "Dev-Task" },
        customfield_14642: "Dev", // 字串形狀
        parent: { id: "451", key: "SUN-101", fields: { issuetype: { name: "Task" } } },
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
        // 母票搜尋：sprint = … 。`getPlanningSubset` 用 MOTHER_FIELDS（summary+issuetype+parent），
        // 「未開子單」的 `fetchNoSubtaskParents` 用完整 PLANNING_FIELDS。
        if (/\bsprint = \d+/.test(body.jql)) {
          const motherFields = JSON.stringify(["project", "summary", "issuetype", "parent", "customfield_10005"])
          if (JSON.stringify(body.fields) === motherFields) {
            return new Response(JSON.stringify({ issues: options.parents ?? parents, isLast: true }), { status: 200 })
          }
          const planningFields = JSON.stringify(["project", "summary", "assignee", "reporter", "components", "parent", "status", "issuetype", "customfield_10005", "customfield_14642"])
          if (JSON.stringify(body.fields) === planningFields) {
            return new Response(JSON.stringify({ issues: options.fullParents ?? fullParents, isLast: true }), { status: 200 })
          }
          return fail("Parent search must request mother or planning fields")
        }
        // 工作單搜尋（Dev+QA，檢查欄位）：含未開子單的全量子票。
        const expectedFields = JSON.stringify(["project", "summary", "assignee", "reporter", "components", "parent", "status", "issuetype", "customfield_10005", "customfield_14642"])
        if (JSON.stringify(body.fields) !== expectedFields) return fail("Subset search must request planning fields")
        // Planning 工作單資料源必須是 Dev+QA（不是燃盡圖的 Dev-only）。
        if (!/issuetype in \("Dev-Task", "QA-Task"\)/.test(body.jql)) {
          return fail("Subset search must target Dev-Task and QA-Task work items")
        }
        if (options.responseStatus) return new Response(null, { status: options.responseStatus })
        return new Response(JSON.stringify({ issues: subsetIssues, isLast: true }), { status: 200 })
      }
      return fail(`Unexpected Jira route: ${method} ${path}`)
    },
  }
  const sandbox = vm.createContext(globals)
  const allowed = [
    "lib/jira-dashboard.ts", "lib/jira-dashboard-filter.ts", "lib/jira-dashboard-lookups.ts",
    "lib/jira-fields.ts", "lib/jira-jql.ts", "lib/jira-missing-data.ts", "lib/jira-page-token.ts",
    "lib/jira-sprint-data.ts", "lib/burndown-params.ts", "lib/planning-data.ts",
    "lib/planning-subset.ts", "app/api/sprint/planning/subset/route.ts",
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
  const route = load("app/api/sprint/planning/subset/route.ts")
  const model = load("lib/planning-subset.ts")
  return { route, model, tokenCalls }
}

function GETroute(route, params) {
  const qs = new URLSearchParams(params).toString()
  return route.GET(new Request(`https://fixture.example.invalid/api/sprint/planning/subset${qs ? `?${qs}` : ""}`))
}

describe("planning subset route — auth & params", () => {
  it("無 session → 401，不打 token、不打 Jira", async (t) => {
    const h = harness(t, { unauthenticated: true })
    const res = await GETroute(h.route, { project: "SUN", sprint: "7517", kind: "unestimated" })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.status, "error")
    assert.equal(body.error.code, "reauthorize")
    assert.equal(h.tokenCalls.length, 0)
  })

  it("壞 project → 400，不打 token", async (t) => {
    const h = harness(t)
    const res = await GETroute(h.route, { project: "NOPE", sprint: "7517", kind: "unestimated" })
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.code, "configuration")
    assert.equal(h.tokenCalls.length, 0)
  })

  it("專案無進行中/未來 sprint（PRIDE）→ 400", async (t) => {
    const h = harness(t)
    const res = await GETroute(h.route, { project: "PRIDE", sprint: "7517", kind: "unestimated" })
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.code, "configuration")
  })

  it("壞 kind → 400", async (t) => {
    const h = harness(t)
    const res = await GETroute(h.route, { project: "SUN", sprint: "7517", kind: "bogus" })
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.code, "configuration")
  })

  it("多重參數 → 400", async (t) => {
    const h = harness(t)
    const url = new URL("https://fixture.example.invalid/api/sprint/planning/subset")
    url.searchParams.append("project", "SUN")
    url.searchParams.append("project", "TKK")
    url.searchParams.append("sprint", "7517")
    url.searchParams.append("kind", "unestimated")
    const res = await h.route.GET(new Request(url))
    assert.equal(res.status, 400)
  })
})

describe("planning subset route — success", () => {
  it("撈子集合並回 success { tasks }", async (t) => {
    const h = harness(t)
    const res = await GETroute(h.route, { project: "SUN", sprint: "7517", kind: "unestimated" })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.status, "success")
    const tasks = plain(body.data.tasks)
    assert.deepEqual(tasks.map((x) => x.key), ["SUN-102", "SUN-103"])
    // points 缺欄 → null（未估時）；assignee 空 → null。
    assert.equal(tasks[0].points, null)
    assert.equal(tasks[0].assigneeDisplayName, null)
    assert.deepEqual(tasks[0].parentIssueType, { status: "known", name: "Story" })
    assert.deepEqual(tasks[1].parentIssueType, { status: "known", name: "Task" })
    assert.equal(tasks[1].assigneeAccountId, "aa1")
    // 工作單自身票種 + 母票 key（由子票的 parent 欄位投影）。
    assert.equal(tasks[0].issueType, "QA-Task")
    assert.equal(tasks[1].issueType, "Dev-Task")
    assert.equal(tasks[0].parentKey, "SUN-100")
    assert.equal(tasks[1].parentKey, "SUN-101")
    // Dev Type 欄位：option 物件與字串兩種形狀都解析成字串。
    assert.equal(tasks[0].devType, "Bug")
    assert.equal(tasks[1].devType, "Dev")
    // subset 彈窗是 flat 清單，不帶母票 summary / Epic（那屬主表的階層投影）。
    assert.equal(tasks[0].parentSummary, null)
    assert.equal(tasks[0].epic, null)
    // 該回應可直接經 client validator 解碼。
    const parsed = h.model.parsePlanningSubsetResult(body)
    assert.equal(parsed.status, "success")
  })

  it("未開子單：只列沒有任何工作單（Dev+QA）子票的母票", async (t) => {
    // 所有工作單（Dev+QA）都掛 SUN-101 下 → SUN-100 沒有子票，會被列出。
    const h = harness(t, {
      subsetIssues: [
        {
          id: "10", key: "SUN-102",
          fields: { project: { id: "10" }, summary: "t", status: { name: "In Progress" }, assignee: null, parent: { id: "450", key: "SUN-101", fields: { issuetype: { name: "Task" } } } },
        },
        {
          id: "11", key: "SUN-103",
          fields: { project: { id: "10" }, summary: "t2", status: { name: "To Do" }, assignee: null, parent: { id: "451", key: "SUN-101", fields: { issuetype: { name: "Task" } } } },
        },
      ],
    })
    const res = await GETroute(h.route, { project: "SUN", sprint: "7517", kind: "no-subtasks" })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.status, "success")
    const tasks = plain(body.data.tasks)
    assert.deepEqual(tasks.map((x) => x.key), ["SUN-100"])
    // 母票明細直接帶出；未開子單的母票其 parentIssueType 為 none。
    assert.equal(tasks[0].summary, "Has subtasks")
    assert.equal(tasks[0].points, 5)
    assert.deepEqual(tasks[0].parentIssueType, { status: "none" })
    // 新增欄位：Reporter / Component 一併帶出。
    assert.equal(tasks[0].reporter, "Reporter X")
    assert.deepEqual(tasks[0].components, ["Frontend", "API"])
    // client validator 可解碼。
    const parsed = h.model.parsePlanningSubsetResult(body)
    assert.equal(parsed.status, "success")
  })

  it("未開子單：全部母票都有子票 → 回空清單", async (t) => {
    const h = harness(t)
    const res = await GETroute(h.route, { project: "SUN", sprint: "7517", kind: "no-subtasks" })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(plain(body.data.tasks), [])
    assert.equal(body.status, "success")
  })
})

describe("planning subset client validator (parsePlanningSubsetResult)", () => {
  const validTask = (over = {}) => ({
    key: "SUN-102",
    summary: "S",
    status: "In Progress",
    points: 3.5,
    assigneeDisplayName: "Owner",
    assigneeAccountId: "aa1",
    reporter: "Reporter",
    components: ["Frontend"],
    issueType: "Dev-Task",
    devType: "Dev",
    parentKey: "SUN-100",
    parentSummary: "P",
    epic: { key: "SUN-20", summary: "Epic 1" },
    parentIssueType: { status: "known", name: "Story" },
    ...over,
  })
  const ok = (t, payload) => {
    const h = harness(t)
    const parsed = h.model.parsePlanningSubsetResult(payload)
    assert.equal(parsed.status, "success")
    return parsed
  }

  it("接受合法的 tasks（known parent、none/unknown parent、null points 與 assignee、空 components、epic 缺欄退化）", (t) => {
    const parsed = ok(t, {
      status: "success",
      data: { tasks: [
        validTask(),
        validTask({ key: "SUN-103", points: null, assigneeDisplayName: null, assigneeAccountId: null, parentIssueType: { status: "none" } }),
        validTask({ key: "SUN-104", parentIssueType: { status: "unknown" }, reporter: null, components: [] }),
        // epic 可為 null（無 Epic 母票）；issueType/parentKey/parentSummary/devType 可為 null。
        validTask({ key: "SUN-105", issueType: null, parentKey: null, parentSummary: null, epic: null, devType: null }),
      ] },
    })
    if (parsed.status !== "success") return
    assert.equal(parsed.data.tasks[0].points, 3.5)
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.data.tasks[1].parentIssueType)), { status: "none" })
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.data.tasks[2].parentIssueType)), { status: "unknown" })
    assert.deepEqual(parsed.data.tasks[0].components, ["Frontend"])
    assert.deepEqual(parsed.data.tasks[2].components, [])
    assert.equal(parsed.data.tasks[0].issueType, "Dev-Task")
    assert.equal(parsed.data.tasks[0].devType, "Dev")
    assert.equal(parsed.data.tasks[3].devType, null)
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.data.tasks[0].epic)), { key: "SUN-20", summary: "Epic 1" })
    assert.equal(parsed.data.tasks[3].epic, null)
  })

  it("回傳 error 分支並保留 code/message", (t) => {
    const h = harness(t)
    const parsed = h.model.parsePlanningSubsetResult({ status: "error", error: { code: "limit", message: "太多了" } })
    assert.equal(parsed.status, "error")
    if (parsed.status !== "error") return
    assert.equal(parsed.error.code, "limit")
    assert.equal(parsed.error.message, "太多了")
  })

  it("拒絕重複 key / 缺 key / 壞 points / 壞 components / 未列白名單的 error code", (t) => {
    const h = harness(t)
    const good = { status: "success", data: { tasks: [] } }
    assert.throws(() => h.model.parsePlanningSubsetResult({ ...good, data: { tasks: [validTask(), validTask()] } }))
    assert.throws(() => h.model.parsePlanningSubsetResult({ ...good, data: { tasks: [{ ...validTask(), key: "" }] } }))
    assert.throws(() => h.model.parsePlanningSubsetResult({ ...good, data: { tasks: [{ ...validTask(), points: -1 }] } }))
    assert.throws(() => h.model.parsePlanningSubsetResult({ ...good, data: { tasks: [{ ...validTask(), components: "not-array" }] } }))
    assert.throws(() => h.model.parsePlanningSubsetResult({ ...good, data: { tasks: [{ ...validTask(), components: [42] }] } }))
    // 壞 epic（非物件／缺 key／summary 型別錯）→ 拒絕。
    assert.throws(() => h.model.parsePlanningSubsetResult({ ...good, data: { tasks: [{ ...validTask(), epic: "SUN-20" }] } }))
    assert.throws(() => h.model.parsePlanningSubsetResult({ ...good, data: { tasks: [{ ...validTask(), epic: { summary: "no key" } }] } }))
    assert.throws(() => h.model.parsePlanningSubsetResult({ ...good, data: { tasks: [{ ...validTask(), epic: { key: "SUN-20", summary: 5 } }] } }))
    assert.throws(() => h.model.parsePlanningSubsetResult({ status: "error", error: { code: "nonsense", message: "x" } }))
    assert.throws(() => h.model.parsePlanningSubsetResult({ status: "success", data: "not-object" }))
    // 壞 parentIssueType（known 缺 name）做安全 fallback 為 unknown，而非拒絕。
    const parsed = h.model.parsePlanningSubsetResult({ ...good, data: { tasks: [{ ...validTask(), parentIssueType: { status: "known" } }] } })
    assert.equal(parsed.status, "success")
    if (parsed.status === "success") assert.deepEqual(JSON.parse(JSON.stringify(parsed.data.tasks[0].parentIssueType)), { status: "unknown" })
  })
})
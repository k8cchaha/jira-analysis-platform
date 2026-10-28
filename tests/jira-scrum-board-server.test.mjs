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

const SELF = { mode: "self" }
const PERSON_SCOPE = { mode: "person", accountIds: ["person-a"], projects: [], days: 17 }
const TEAM_SCOPE = { mode: "team-project", accountIds: ["a", "b", "c"], projects: ["sun"], days: 17 }
const PERSON_FILTER = { mode: "person", accountId: "person-a", name: "Fixture User", days: 17 }

// Fixture Dev-Task across the three active statuses, each with a distinct parent issue type
// (Story / Task / Bug / none) so column split AND card coloring are both exercised.
// Done fixtures (removed column) must be excluded by the JQL's `status not in ("Done")`.
const devTasks = [
  { id: "1", key: "SUN-101", summary: "Story task", status: "To Do", parentType: "Story" },
  { id: "2", key: "SUN-102", summary: "In progress task", status: "In Progress", parentType: "Task" },
  { id: "3", key: "SUN-103", summary: "In review task", status: "In Review", parentType: "Bug" },
  { id: "4", key: "SUN-104", summary: null, status: "Done", parentType: "Story" },
  { id: "5", key: "SUN-105", summary: "Lowercase status", status: "in progress", parentType: "Task" },
]
const makeIssue = (task) => ({
  id: task.id,
  key: task.key,
  fields: {
    project: { id: "10" },
    summary: task.summary,
    status: { name: task.status },
    assignee: task.assignee ?? { displayName: `Owner ${task.key}` },
    parent: task.parentType ? { id: "450", key: `SUN-${task.parentType}`, fields: { issuetype: { name: task.parentType } } } : undefined,
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
  const list = options.devTasks ?? devTasks
  const user = (accountId) => ({ accountId, displayName: `Fixture ${accountId}`, accountType: "atlassian" })
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
      calls.push({ path, method, body })
      if (path === "/rest/api/3/search/jql" && method === "POST") {
        const selfFields = JSON.stringify(["project", "summary", "status", "parent"])
        const scopedFields = JSON.stringify(["project", "summary", "status", "parent", "assignee"])
        if ((JSON.stringify(body.fields) !== selfFields && JSON.stringify(body.fields) !== scopedFields) || body.maxResults !== 100) {
          return fail("Scrum Board search must request exactly project/summary/status/parent (+ assignee when scoped)")
        }
        if (options.responseStatus) return new Response(null, { status: options.responseStatus })
        if (/\bstatus not in \("Done"\)/.test(body.jql)) {
          // JQL 排除 Done；mock 回傳時也一併過濾，模擬真實 Jira 的回應。
          return new Response(JSON.stringify({ issues: list.filter((task) => task.status.toLowerCase() !== "done").map(makeIssue), isLast: true }), { status: 200 })
        }
        return fail("Unexpected Scrum Board JQL")
      }
      if (init.redirect !== "error") return fail("Lookups must reject redirects")
      if (path.startsWith("/rest/api/3/user?") && method === "GET") {
        const id = new URL(url).searchParams.get("accountId")
        return new Response(JSON.stringify(user(id)), { status: 200 })
      }
      if (path.startsWith("/rest/api/3/group/member?") && method === "GET") {
        const params = new URL(url).searchParams
        const members = options.groups?.[params.get("groupname")] ?? [user("a"), user("b"), user("c")]
        const startAt = Number(params.get("startAt"))
        const values = members.slice(startAt, startAt + 50)
        return new Response(JSON.stringify({ startAt, total: members.length, values, isLast: startAt + values.length === members.length }), { status: 200 })
      }
      return fail(`Unexpected Jira route: ${method} ${path}`)
    },
  }
  const sandbox = vm.createContext(globals)
  const allowed = [
    "lib/jira-dashboard.ts", "lib/jira-dashboard-filter.ts", "lib/jira-dashboard-lookups.ts",
    "lib/jira-fields.ts", "lib/jira-jql.ts", "lib/jira-missing-data.ts", "lib/jira-page-token.ts",
    "lib/jira-scrum-board.ts", "lib/jira-scrum-board-server.ts",
  ]
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
        getJiraToken: async () => {
          tokenCalls.push(true)
          if (options.authError) throw new JiraAuthorizationError(options.authError)
          return { cloudId: options.cloudId ?? "fixture-cloud", accessToken: "fixture-token-not-real" }
        },
      }
      if (specifier.startsWith("@/lib/")) return load(specifier.slice(2) + ".ts")
      if (specifier.startsWith("./")) return load("lib/" + specifier.slice(2))
      return fail(`Unexpected require: ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports){\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loaded, loaded.exports)
    return loaded.exports
  }
  const modules = new Map()
  t.after(() => assert.deepEqual(violations, []))
  return { service: load("lib/jira-scrum-board-server.ts"), model: load("lib/jira-scrum-board.ts"), jql: load("lib/jira-jql.ts"), calls, tokenCalls }
}

describe("scrum board Dev-Task JQL", () => {
  it("defaults to currentUser for self and drops Done", (t) => {
    const h = harness(t)
    assert.equal(
      h.jql.scrumBoardDevTasksJql(SELF, null),
      'issuetype in ("Dev-Task", "QA-Task") AND status not in ("Done") AND assignee = currentUser() ORDER BY key ASC'
    )
  })
  it("layers the board recency window on self", (t) => {
    const h = harness(t)
    assert.equal(
      h.jql.scrumBoardDevTasksJql(SELF, 30),
      'issuetype in ("Dev-Task", "QA-Task") AND status not in ("Done") AND assignee = currentUser() AND (created >= -30d OR updated >= -30d) ORDER BY key ASC'
    )
  })
  it("uses assignee equality and the person near-N days for a person scope", (t) => {
    const h = harness(t)
    const jql = h.jql.scrumBoardDevTasksJql(PERSON_SCOPE, null)
    assert.ok(jql.includes('assignee = "person-a"'), "person must use one assignee equality")
    assert.ok(jql.includes("created >= -17d"), "person must add near-N days")
    assert.ok(!jql.includes("project"), "person with no projects must not restrict project")
  })
  it("uses assignee in(...), project in(...), near-N days, and the board window for a team scope", (t) => {
    const h = harness(t)
    const jql = h.jql.scrumBoardDevTasksJql(TEAM_SCOPE, 30)
    assert.ok(jql.includes('assignee in ("a", "b", "c")'))
    assert.ok(jql.includes("project in (sun)"))
    assert.ok(jql.includes("created >= -17d"))
    assert.ok(jql.includes("(created >= -30d OR updated >= -30d)"))
  })
  it("rejects invalid scopes before composing JQL", (t) => {
    const h = harness(t)
    const bad = [
      { ...PERSON_SCOPE, accountIds: [] },
      { ...PERSON_SCOPE, accountIds: ["a", "b"] },
      { ...PERSON_SCOPE, projects: ["zzz"] },
      { ...TEAM_SCOPE, accountIds: ["not a valid|id"] },
      { ...TEAM_SCOPE, accountIds: Array.from({ length: 1001 }, (_, i) => `u${i}`) },
    ]
    for (const scope of bad) assert.throws(() => h.jql.scrumBoardDevTasksJql(scope, null))
    // 非法 boardDays 也須先被擋下。
    assert.throws(() => h.jql.scrumBoardDevTasksJql(SELF, 0))
  })
})

describe("scrum board server", () => {
  it("rejects missing auth before any token/transport", async (t) => {
    const h = harness(t, { unauthenticated: true })
    await assert.rejects(h.service.getScrumBoardData(SELF, null))
    assert.equal(h.tokenCalls.length, 0)
    assert.equal(h.calls.length, 0)
  })

  it("rejects invalid boardDays before token lookup", async (t) => {
    const h = harness(t)
    await assert.rejects(h.service.getScrumBoardData(SELF, 0))
    await assert.rejects(h.service.getScrumBoardData(SELF, -3))
    await assert.rejects(h.service.getScrumBoardData(SELF, 1.5))
    assert.equal(h.tokenCalls.length, 0)
    assert.equal(h.calls.length, 0)
  })

  it("splits active Dev-Tasks into three columns (no Done) for self scope", async (t) => {
    const h = harness(t)
    const data = await h.service.getScrumBoardData(SELF, null)
    const columns = plain(data.columns)
    assert.deepEqual(columns.todo.map((c) => c.key), ["SUN-101"])
    assert.deepEqual(columns.inProgress.map((c) => c.key), ["SUN-102", "SUN-105"]) // case-insensitive
    assert.deepEqual(columns.inReview.map((c) => c.key), ["SUN-103"])
    assert.equal(columns.done, undefined, "removed Done column must not exist")
    assert.ok(!data.columns.todo.some((c) => c.key === "SUN-104") && !data.columns.inProgress.some((c) => c.key === "SUN-104") && !data.columns.inReview.some((c) => c.key === "SUN-104"), "Done fixture must be excluded")
    assert.deepEqual(plain(columns.todo[0].parentIssueType), { status: "known", name: "Story" })
    assert.deepEqual(plain(columns.inReview[0].parentIssueType), { status: "known", name: "Bug" })
    // 保留原始 status 名稱供卡片顯示。
    assert.equal(columns.inProgress[1].status, "in progress")
    assert.equal(data.readOnly, true)
    // self scope 不投影 assignee，卡片右上角不會顯示指派對象。
    assert.equal("assigneeDisplayName" in columns.todo[0], false)
  })

  it("resolves a person scope and sends assignee equality + near-N JQL", async (t) => {
    const h = harness(t)
    const data = await h.service.getScrumBoardData(PERSON_FILTER, null)
    assert.equal(data.readOnly, true)
    const search = h.calls.find((call) => call.body?.jql)
    assert.ok(search, "a search must be issued")
    assert.ok(search.body.jql.includes('assignee = "person-a"'), "person scope must restrict assignee")
    assert.ok(search.body.jql.includes("created >= -17d"), "person scope must add near-N days")
    assert.deepEqual(search.body.fields, ["project", "summary", "status", "parent", "assignee"], "non-self scope must request assignee")
    assert.equal(h.calls.filter((call) => call.path.startsWith("/rest/api/3/user?")).length, 1, "one user lookup to verify scope")
    // 非 self scope：每張卡片投影 assignee 顯示名稱，供右上角標示。
    assert.equal(plain(data.columns.todo[0].assigneeDisplayName), "Owner SUN-101")
  })

  it("applies the board recency window when boardDays is given, and not when null", async (t) => {
    const h = harness(t)
    await h.service.getScrumBoardData(SELF, null)
    await h.service.getScrumBoardData(SELF, 30)
    const withNull = h.calls.find((call) => call.body && !call.body.jql.includes("created >= -30d"))
    const withDays = h.calls.find((call) => call.body && call.body.jql.includes("(created >= -30d OR updated >= -30d)"))
    assert.ok(withNull && withDays, "both recency states must be issued")
  })

  it("surfaces an auth error without any transport", async (t) => {
    const h = harness(t, { authError: "refresh_failed" })
    await assert.rejects(h.service.getScrumBoardData(SELF, 30))
    assert.equal(h.calls.length, 0)
  })

  it("client validator keeps known parent issue types from the serialized server response", async (t) => {
    // 回歸：server 送出的 parentIssueType 已是 `{status,name}` DTO 形狀，
    // client 解碼器必須原樣保留，否則每個卡片都會落 unknown 而全灰。
    const h = harness(t)
    const payload = {
      status: "success",
      data: {
        columns: {
          todo: [{ key: "SUN-101", summary: "S", status: "To Do", parentIssueType: { status: "known", name: "Story" } }],
          inProgress: [{ key: "SUN-102", summary: "S", status: "In Progress", parentIssueType: { status: "known", name: "Task" } }],
          inReview: [{ key: "SUN-103", summary: "S", status: "In Review", parentIssueType: { status: "known", name: "Bug" } }],
        },
        jiraBaseUrl: "https://fixture.example.invalid",
        readOnly: true,
      },
    }
    const parsed = h.model.parseScrumBoardResult(payload)
    assert.equal(parsed.status, "success")
    if (parsed.status !== "success") return
    assert.deepEqual(plain(parsed.data.columns.todo[0].parentIssueType), { status: "known", name: "Story" })
    assert.deepEqual(plain(parsed.data.columns.inProgress[0].parentIssueType), { status: "known", name: "Task" })
    assert.deepEqual(plain(parsed.data.columns.inReview[0].parentIssueType), { status: "known", name: "Bug" })
  })
})
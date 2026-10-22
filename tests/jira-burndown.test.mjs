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
  const fail = (message) => {
    violations.push(message)
    throw new Error(message)
  }
  // 可注入覆寫的 Dev-Task 清單（用於「開局前 Done」等情境）。
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
      if (jql.startsWith("sprint = 7517 AND issuetype in (story, task, bug)")) {
        return new Response(JSON.stringify({ issues: options.emptyParents ? [] : parentIssues, isLast: true }), { status: 200 })
      }
      if (/\bstatus CHANGED TO "Done" ON "(\d{4}-\d{2}-\d{2})"/.test(jql)) {
        const date = /\bstatus CHANGED TO "Done" ON "(\d{4}-\d{2}-\d{2})"/.exec(jql)[1]
        const done = list.filter((task) => task.doneOn === date).map(makeIssue)
        return new Response(JSON.stringify({ issues: done, isLast: true }), { status: 200 })
      }
      if (/\bstatus CHANGED TO "Done" BEFORE "(\d{4}-\d{2}-\d{2})"/.test(jql)) {
        // 開局前 Done：`doneOn` 早於給定日期的 Dev-Task。
        const before = /\bstatus CHANGED TO "Done" BEFORE "(\d{4}-\d{2}-\d{2})"/.exec(jql)[1]
        const pre = list.filter((task) => task.doneOn !== null && task.doneOn < before).map(makeIssue)
        return new Response(JSON.stringify({ issues: pre, isLast: true }), { status: 200 })
      }
      if (/^parent in \(SUN-50, SUN-51\) AND issuetype = "Dev-Task"$/.test(jql)) {
        if (options.allTasksError) return new Response(null, { status: options.allTasksError })
        return new Response(JSON.stringify({ issues: list.map(makeIssue), isLast: true }), { status: 200 })
      }
      return fail(`Unexpected search/jql: ${jql}`)
    },
  }
  const sandbox = vm.createContext(globals)
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!["lib/jira-burndown.ts", "lib/burndown-series.ts", "lib/jira-dashboard.ts", "lib/jira-dashboard-filter.ts", "lib/jira-dashboard-lookups.ts", "lib/jira-fields.ts", "lib/jira-jql.ts", "lib/jira-missing-data.ts", "lib/jira-page-token.ts", "lib/jira-story-points.ts"].includes(path)) return fail(`Unexpected module: ${path}`)
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
      if (specifier === "./burndown-series.ts") return load("lib/burndown-series.ts")
      if (specifier === "./jira-dashboard-filter.ts") return load("lib/jira-dashboard-filter.ts")
      if (specifier === "./jira-dashboard.ts") return load("lib/jira-dashboard.ts")
      if (specifier === "./jira-sprint-data.ts") return load("lib/jira-sprint-data.ts")
      if (["@/lib/jira-dashboard", "@/lib/jira-dashboard-filter", "@/lib/jira-dashboard-lookups", "@/lib/jira-fields", "@/lib/jira-jql", "@/lib/jira-missing-data", "@/lib/jira-page-token"].includes(specifier)) return load(specifier.slice(2) + ".ts")
      if (specifier === "@/lib/burndown-series") return load("lib/burndown-series.ts")
      return fail(`Unexpected require: ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports) {\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  t.after(() => assert.deepEqual(violations, []))
  return {
    service: load("lib/jira-burndown.ts"),
    jql: load("lib/jira-jql.ts"),
    calls, tokenCalls,
  }
}

describe("burndown query builders", () => {
  it("builds parents, all-tasks, and done-on-day JQL from validated inputs", (t) => {
    const h = harness(t)
    assert.equal(h.jql.sprintParentIssuesJql(7517), "sprint = 7517 AND issuetype in (story, task, bug)")
    assert.equal(h.jql.sprintDevTasksJql(["SUN-51", "SUN-50"]), 'parent in (SUN-50, SUN-51) AND issuetype = "Dev-Task"')
    assert.equal(
      h.jql.sprintDevTasksDoneOnJql(["SUN-51", "SUN-50"], "2026-10-19"),
      'parent in (SUN-50, SUN-51) AND issuetype = "Dev-Task" AND status CHANGED TO "Done" ON "2026-10-19"'
    )
    assert.equal(
      h.jql.sprintDevTasksDoneBeforeJql(["SUN-51", "SUN-50"], "2026-10-13"),
      'parent in (SUN-50, SUN-51) AND issuetype = "Dev-Task" AND status CHANGED TO "Done" BEFORE "2026-10-13"'
    )
  })
})

describe("burndown aggregation against fixture Jira", () => {
  it("sums estimated points, lists unestimated, and builds the daily series", async (t) => {
    const h = harness(t)
    // 固定「今天」= 2026-10-19，好驗證未來日期不給剩餘點數（null）。
    const data = await h.service.getBurndownData(SPRINT, "2026-10-19")

    assert.equal(data.totalPoints, 18)
    assert.equal(data.empty, false)
    assert.equal(data.sprint.name, "Sprint 70")
    assert.equal(data.today, "2026-10-19")
    assert.equal(data.unestimated.length, 1)
    assert.equal(data.unestimated[0].key, "SUN-104")
    assert.equal(data.unestimated[0].assigneeDisplayName, "Fixture Dev")
    assert.equal(data.unestimated[0].assigneeAccountId, "u-aaa-104")
    assert.deepEqual(JSON.parse(JSON.stringify(data.unestimated[0].parentIssueType)), { status: "known", name: "Story" })

    // tasks：只含已估計、依 key 排序的 Dev-Task，並刻好 doneDate 與 assignee。
    assert.equal(data.tasks.length, 4)
    const byKey = new Map(data.tasks.map((task) => [task.key, task]))
    assert.equal(byKey.get("SUN-101").doneDate, "2026-10-15")
    assert.equal(byKey.get("SUN-102").doneDate, "2026-10-18")
    assert.equal(byKey.get("SUN-103").doneDate, "2026-10-19")
    assert.equal(byKey.get("SUN-105").doneDate, "2026-10-13")
    assert.equal(byKey.get("SUN-101").assigneeAccountId, "u-aaa-101")
    assert.equal(byKey.get("SUN-105").assigneeAccountId, "u-bbb-105")
    // summary 與 assignee 顯示名稱已投影（供長條點擊彈窗顯示）。
    assert.equal(byKey.get("SUN-101").summary, "Task A")
    assert.equal(byKey.get("SUN-101").assigneeDisplayName, "Fixture Dev")
    // Actual Story Points 已投影（未填為 null）。
    assert.equal(byKey.get("SUN-101").actualPoints, 6)
    assert.equal(byKey.get("SUN-102").actualPoints, null)
    // 母票 type 已投影（彈窗每列左側 icon）。
    assert.deepEqual(JSON.parse(JSON.stringify(byKey.get("SUN-101").parentIssueType)), { status: "known", name: "Story" })

    // 天數 = 空起點格 + start..end 的每一天。
    assert.equal(data.days.length, 14) // 起點格 + 2026-10-13 ~ 2026-10-25
    const byDate = new Map(data.days.map((day) => [day.date, day]))
    // 空起點格：startDate 前一天，remaining=total 讓兩線從初始值對齊。
    assert.equal(data.days[0].date, "2026-10-12")
    assert.equal(data.days[0].remainingPoints, 18)
    assert.equal(data.days[0].donePoints, 0)

    // 每天完成點數（只計已估計）。
    assert.equal(byDate.get("2026-10-13").donePoints, 2)
    assert.equal(byDate.get("2026-10-14").donePoints, 0)
    assert.equal(byDate.get("2026-10-15").donePoints, 5)
    assert.equal(byDate.get("2026-10-18").donePoints, 3)
    assert.equal(byDate.get("2026-10-19").donePoints, 8)

    // 剩餘點數：累計遞減；今天(10-19)之後為 null（未到、不畫）。
    // 第一天(10-13)已有 SUN-105(2) 完成 → 16。
    assert.equal(byDate.get("2026-10-13").remainingPoints, 16)
    assert.equal(byDate.get("2026-10-19").remainingPoints, 0) // 18 全完成
    assert.equal(byDate.get("2026-10-20").remainingPoints, null) // 未來不畫
    assert.equal(byDate.get("2026-10-25").remainingPoints, null)
    // 今天以前（含）全部非 null 且不增；之後全部 null。
    let last = Infinity
    for (const day of data.days) {
      if (day.date <= "2026-10-19") {
        assert.notEqual(day.remainingPoints, null)
        assert.ok(day.remainingPoints <= last, "remaining must be non-increasing")
        last = day.remainingPoints
      } else {
        assert.equal(day.remainingPoints, null)
      }
    }

    // 理想線：從空起點格（10-12）的 total 開始全程傾斜，終點(10-25)=0。
    // 第一天(10-13)已走 1/13，18 × (12/13) → 16.6。
    assert.equal(byDate.get("2026-10-13").idealPoints, 16.6)
    assert.equal(byDate.get("2026-10-25").idealPoints, 0)
  })

  it("handles empty parent set as an empty burndown without further queries", async (t) => {
    const h = harness(t, { emptyParents: true })
    const data = await h.service.getBurndownData(SPRINT)
    assert.equal(data.empty, true)
    assert.equal(data.totalPoints, 0)
    assert.equal(data.unestimated.length, 0)
    assert.equal(data.days.length, 0)
    // 只應有一次搜尋（撈母票），不得再查 Dev-Task 或每日。
    const searches = h.calls.filter((call) => call.path === "/rest/api/3/search/jql")
    assert.equal(searches.length, 1)
  })

  it("marks sprint-start-before Done tasks and shows them as the green opening cell", async (t) => {
    // 自訂 fixture：SUN-P1 在 sprint 開始（10-13）之前（10-10）就已 Done。
    const preDone = [
      { id: "201", key: "SUN-P1", summary: "Pre done", points: 2, actualPoints: 2, doneOn: "2026-10-10", accountId: "u-pre-201" },
    ]
    const h = harness(t, { devTasks: [...preDone] })
    const data = await h.service.getBurndownData(SPRINT, "2026-10-19")
    assert.equal(data.totalPoints, 2)
    // server 已把開局前 Done 標記在 task 上，供站內重算與長條使用。
    const byKey = new Map(data.tasks.map((task) => [task.key, task]))
    assert.equal(byKey.get("SUN-P1").doneBeforeStart, true)
    assert.equal(byKey.get("SUN-P1").doneDate, null) // doneDate 不在 sprint 範圍內
    // 空起點格：綠色長條 = 開局前 Done（2）；理想/剩餘起點 = 總點數 − 開局已完成 = 0。
    assert.equal(data.days[0].date, "2026-10-12")
    assert.equal(data.days[0].remainingPoints, 0)
    assert.equal(data.days[0].idealPoints, 0)
    assert.equal(data.days[0].donePoints, 2)
    // 剩餘線自第一天起就維持 0（開局已完成已把剩餘扣光）。
    const byDate = new Map(data.days.map((day) => [day.date, day]))
    assert.equal(byDate.get("2026-10-13").remainingPoints, 0)
  })
})
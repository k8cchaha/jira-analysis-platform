import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { posix } from "node:path"
import vm from "node:vm"
import assert from "node:assert/strict"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const root = new URL("../../", import.meta.url)
const compiled = new Map()
export const input = { project: "SUN", sprintIds: [7517], groups: [], browserTimeZone: "Asia/Taipei" }
export const fields = [
  { id: "customfield_10005", name: "Story Points", schema: { type: "number" } },
  { id: "customfield_13736", name: "Actual Story Points", schema: { type: "number" } },
  { id: "customfield_14642", name: "Dev Type", schema: { type: "option" } },
]
export const issueTypes = [{ id: "20", name: "Dev-Task", subtask: true }, { id: "21", name: "QA-Task", subtask: true }]
export const parent = (id = "1", project = "SUN") => ({ id, key: `${project}-${id}`, fields: { project: { id: "10", key: project }, issuetype: { id: "3", name: "Story", subtask: false } } })
export const task = (id = "101", parentId = "1", overrides = {}) => ({ id, key: `SUN-${id}`, fields: { project: { id: "10", key: "SUN" }, summary: `Task ${id}`, issuetype: issueTypes[0], parent: { id: parentId, key: `SUN-${parentId}` }, assignee: null, status: { name: "Done" }, resolutiondate: "2026-10-25T16:00:00Z", customfield_10005: null, customfield_13736: 2.345, customfield_14642: { id: "31", value: "Dev" }, ...overrides } })
export const plain = (value) => JSON.parse(JSON.stringify(value))

/** Real model/search/lookup/transport code, synthetic credentials and a closed endpoint allowlist. */
export function harness(t, options = {}) {
  const calls = [], violations = []
  let tokenCalls = 0, authCalls = 0
  const modules = new Map()
  const fail = (message) => { violations.push(message); throw new Error(message) }
  class JiraAuthorizationError extends Error { constructor(code) { super("Fixture auth"); this.code = code } }
  const credentials = { viewerId: "fixture-viewer", cloudId: "fixture-cloud", accessToken: "fixture-token", expiresAt: 4_102_444_800_000 }
  const pageResponse = (issues, body, kind) => {
    if (body.nextPageToken && options.pageError?.[kind]) return new Response("private upstream payload", { status: options.pageError[kind] })
    const size = Math.min(100, options.pageSize ?? 100)
    const offset = body.nextPageToken ? Number(body.nextPageToken) : 0
    const next = offset + size < issues.length ? String(offset + size) : null
    return Response.json({ issues: issues.slice(offset, offset + size), isLast: next === null, ...(next ? { nextPageToken: next } : {}) })
  }
  const DateFixture = class extends Date {
    constructor(...args) { super(...(args.length ? args : [options.now ?? "2026-11-12T12:00:00Z"])) }
    static now() { return options.clock?.() ?? Date.parse(options.now ?? "2026-11-12T12:00:00Z") }
  }
  const context = vm.createContext({
    URL, URLSearchParams, Buffer, Request, Response, AbortSignal, AbortController, TextDecoder, Uint8Array, Date: DateFixture, Intl,
    process: { env: { AUTH_SECRET: "fixture-secret-only", ATLASSIAN_JIRA_CLOUD_URL: "https://fixture.example.invalid/jira" } },
    console: { error: () => {}, log: () => {} },
    fetch: async (url, init = {}) => {
      const prefix = "https://api.atlassian.com/ex/jira/fixture-cloud"
      if (!url.startsWith(prefix + "/rest/api/3/")) return fail(`Unexpected URL ${url}`)
      if (init.headers?.Authorization !== "Bearer fixture-token" || init.cache !== "no-store") return fail("Invalid synthetic transport identity/cache")
      const path = url.slice(prefix.length), method = init.method ?? "GET", body = init.body ? JSON.parse(init.body) : null
      calls.push({ path, method, body })
      options.onCall?.({ path, method, body, calls })
      if (["PUT", "PATCH", "DELETE"].includes(method)) return fail(`Mutation forbidden ${method}`)
      if (path === "/rest/api/3/search/jql" && method === "POST") {
        if (body.maxResults !== 100) return fail("Wrong page size")
        if (options.search) return options.search(body, pageResponse, calls)
        if (/^project = (SUN|TKK|PRIDE) AND sprint = \d+ AND issuetype in \(story, task, bug\) ORDER BY key ASC$/.test(body.jql)) {
          const id = Number(/sprint = (\d+)/.exec(body.jql)[1])
          const parents = options.parentsBySprint?.[id] ?? options.parents ?? [parent()]
          return pageResponse(parents, body, "parent")
        }
        if (/^parent in \([\d, ]+\) AND issuetype in \(20, 21\)(?: AND assignee in \("[a-zA-Z0-9:_-]+"(?:, "[a-zA-Z0-9:_-]+")*\))? ORDER BY key ASC$/.test(body.jql)) {
          const ids = /^parent in \(([^)]+)\)/.exec(body.jql)[1].split(", ")
          return pageResponse((options.tasks ?? [task()]).filter((issue) => ids.includes(issue.fields.parent?.id)), body, "task")
        }
        return fail(`Unexpected JQL ${body.jql}`)
      }
      if (method !== "GET" || body !== null || init.redirect !== "error" || !init.signal) return fail(`Unexpected request ${method} ${path}`)
      if (options.status?.[path]) return new Response("private upstream payload", { status: options.status[path] })
      if (path === "/rest/api/3/project/SUN" || path === "/rest/api/3/project/TKK" || path === "/rest/api/3/project/PRIDE") return Response.json(options.project ?? { id: "10", key: path.split("/").at(-1) })
      if (path === "/rest/api/3/field") return Response.json(options.fields ?? fields)
      if (path === "/rest/api/3/issuetype") return Response.json(options.issueTypes ?? issueTypes)
      if (path === "/rest/api/3/myself") return options.profileJson ? new Response(options.profileJson) : Response.json(options.profile ?? { accountId: "fixture-viewer", timeZone: "Asia/Taipei" })
      if (path.startsWith("/rest/api/3/group/member?")) {
        const params = new URL(url).searchParams, group = params.get("groupname"), startAt = Number(params.get("startAt"))
        if (!inputGroup(group)) return fail("Unexpected group")
        if (options.groupResponse) return options.groupResponse(group, startAt)
        const members = options.members?.[group] ?? [{ accountId: "fixture-member", displayName: "Fixture member", accountType: "atlassian" }]
        const values = members.slice(startAt, startAt + 50)
        return Response.json({ values, startAt, total: members.length, isLast: startAt + values.length === members.length })
      }
      return fail(`Unexpected endpoint ${path}`)
    },
  })
  function inputGroup(group) { return ["ent-android", "ent-androidtv", "ent-be1", "ent-be2", "ent-ios", "ent-web", "ent-pride", "ent-design", "ent-qa1", "ent-qa2", "ent-ep", "ent-sdet", "ent-sre"].includes(group) }
  const allowed = new Set(["lib/jira-projects-analysis.ts", "lib/jira-account-timezone.ts", "lib/jira-http.ts", "lib/jira-dashboard.ts", "lib/jira-dashboard-lookups.ts", "lib/jira-group-members-cache.ts", "lib/jira-fields.ts", "lib/jira-jql.ts", "lib/jira-dashboard-filter.ts", "lib/jira-missing-data.ts", "lib/jira-page-token.ts", "lib/projects-analysis.ts", "lib/jira-sprint-data.ts", "lib/burndown-params.ts", "lib/burndown-completion.ts", "lib/date-range.ts", "lib/planning-overview.ts", "app/api/analytics/projects/query/route.ts"])
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!allowed.has(path)) return fail(`Unexpected module ${path}`)
    const loaded = { exports: {} }; modules.set(path, loaded)
    if (!compiled.has(path)) {
      const filename = fileURLToPath(new URL(path, root))
      compiled.set(path, ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText)
    }
    function fixtureRequire(specifier) {
      if (specifier === "server-only") return {}
      if (specifier === "node:crypto") return require(specifier)
      if (specifier === "@/auth") return { auth: async () => { authCalls++; return options.auth === false ? null : { user: { id: options.viewerId ?? "fixture-viewer" } } } }
      if (specifier === "@/lib/jira-token") return { JiraAuthorizationError, getJiraToken: async () => { tokenCalls++; if (options.tokenError) throw new JiraAuthorizationError(options.tokenError); return credentials } }
      const target = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(path), specifier)) : fail(`Unexpected import ${specifier}`)
      return load(target.endsWith(".ts") ? target : target + ".ts")
    }
    vm.runInContext(`(function(require,module,exports){${compiled.get(path)}\n})`, context, { filename: path })(fixtureRequire, loaded, loaded.exports)
    return loaded.exports
  }
  t?.after(() => assert.deepEqual(violations, [], "Unexpected modules/endpoints/mutations"))
  const service = load("lib/jira-projects-analysis.ts")
  return { ...service, load, calls, credentials, tokenCalls: () => tokenCalls, authCalls: () => authCalls }
}

export function jsonRequest(value = input, options = {}) {
  return new Request("https://app.example.invalid/api/analytics/projects/query", { method: "POST", headers: { origin: "https://app.example.invalid", "content-type": "application/json", ...options.headers }, body: JSON.stringify(value), ...options.init })
}

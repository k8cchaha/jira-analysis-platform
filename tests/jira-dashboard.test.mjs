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
const AP = "customfield_13736"
const DC = "customfield_20000"
const RC = "customfield_20001"
const SOL = "customfield_20002"
const multiSchema = {
  type: "array", items: "option",
  custom: "com.atlassian.jira.plugin.system.customfieldtypes:multiselect",
}
const numericMeta = { schema: { type: "number" }, operations: ["set"] }
const pointFields = [
  { id: SP, name: "Story Points", schema: { type: "number" } },
  { id: AP, name: "Actual Story Points", schema: { type: "number" } },
]
const defectFields = [
  { id: DC, name: "Defect Cause", schema: multiSchema },
  { id: RC, name: "Root Cause", schema: { type: "string" } },
  { id: SOL, name: "Solution", schema: { type: "string" } },
]
const plain = (value) => JSON.parse(JSON.stringify(value))
const pointIssue = (id, storyPoints = null, actualStoryPoints = 0, projectId = "10") => ({
  id: String(id), key: `TEST-${id}`,
  fields: { project: { id: projectId }, summary: `Fixture ${id}`, [SP]: storyPoints, [AP]: actualStoryPoints },
  editmeta: { fields: { [SP]: plain(numericMeta), [AP]: plain(numericMeta) } },
})
const defectIssue = (id, options = [{ id: "7", value: "Fixture cause" }]) => ({
  id: String(id), key: `TEST-${id}`,
  fields: {
    project: { id: "10" }, summary: `Fixture ${id}`, [DC]: null,
    [RC]: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Root cause text" }] }] },
    [SOL]: "Solution text",
  },
  editmeta: { fields: { [DC]: { schema: multiSchema, operations: ["set"], allowedValues: options } } },
})
const change = (id, extra = {}) => ({ issueId: String(id), storyPoints: 1.25, expectedStoryPoints: null, ...extra })

// Only these project modules and Node crypto may be loaded in the sandbox.
// Every fetch is routed to local fixtures; no real auth, process environment, or network is available.
function harness(t, options = {}) {
  const calls = []
  const violations = []
  const tokenCalls = []
  let searches = 0
  const fail = (message) => {
    violations.push(message)
    throw new Error(message)
  }
  class JiraAuthorizationError extends Error {
    constructor(code) { super("Fixture authorization error"); this.code = code }
  }
  const modules = new Map()
  const globals = {
    Buffer, URL, URLSearchParams, Error, Date, FormData, AbortSignal,
    process: { env: { AUTH_SECRET: "unit-test-only-not-real", ATLASSIAN_JIRA_CLOUD_URL: "https://fixture.example.invalid/jira" } },
    console: { error: () => {} },
    fetch: async (url, init = {}) => {
      const prefix = "https://api.atlassian.com/ex/jira/fixture-cloud"
      if (!url.startsWith(prefix + "/rest/api/3/")) return fail(`Unexpected Jira origin: ${url}`)
      if (init.headers?.Authorization !== "Bearer fixture-token-not-real") return fail("Unexpected authorization fixture")
      if (init.cache !== "no-store") return fail("Jira requests must not be cached")
      const path = url.slice(prefix.length)
      const method = init.method ?? "GET"
      const body = init.body ? JSON.parse(init.body) : null
      const call = { path, method, body }
      calls.push(call)
      if (options.responseStatus) return new Response(null, { status: options.responseStatus })
      let data
      if (path === "/rest/api/3/field" && method === "GET") {
        data = options.fields ?? pointFields
      } else if (path === "/rest/api/3/search/jql" && method === "POST") {
        const rules = load("lib/jira-missing-data.ts")
        const scope = rules.missingDataJql(options.kind ?? "points")
        if (body.jql !== `${scope} ORDER BY key ASC` && !body.jql.startsWith(`(${scope}) AND id in (`)) return fail(`Unexpected or altered query: ${body.jql}`)
        if (/\b(created|updated|resolved|resolutiondate|startOfDay|now)\b|\b30d\b/i.test(body.jql)) return fail("A date restriction leaked into missing-data JQL")
        data = options.search ? options.search(body, searches++) : { issues: options.issues ?? [], isLast: true }
      } else if (/^\/rest\/api\/3\/issue\/\d+\?/.test(path) && method === "GET") {
        const urlObject = new URL(url)
        if (urlObject.searchParams.get("expand") !== "editmeta") return fail("Missing per-issue edit metadata")
        const id = path.match(/\/issue\/(\d+)/)[1]
        data = options.live ? options.live(id) : (options.issues ?? []).find((issue) => issue.id === id)
        if (!data) return fail(`Unexpected live issue read: ${id}`)
      } else if (/^\/rest\/api\/3\/issue\/\d+$/.test(path) && method === "PUT") {
        const status = options.putStatus?.(path.match(/\/issue\/(\d+)/)[1]) ?? 204
        return new Response(null, { status })
      } else {
        return fail(`Unexpected Jira route: ${method} ${path}`)
      }
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })
    },
  }
  const sandbox = vm.createContext(globals)
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!["lib/jira-dashboard.ts", "lib/jira-missing-data.ts", "lib/jira-page-token.ts", "app/(app)/dashboard/actions.ts"].includes(path)) return fail(`Unexpected module: ${path}`)
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
      if (specifier === "@/auth") return {
        auth: async () => options.unauthenticated ? null : { user: { id: "fixture-user" } },
        signIn: async () => fail("Unexpected sign-in"),
      }
      if (specifier === "@/lib/jira-token") return {
        JiraAuthorizationError,
        getJiraToken: async (refresh) => {
          tokenCalls.push(refresh)
          if (options.authError) throw new JiraAuthorizationError(options.authError)
          return { cloudId: "fixture-cloud", accessToken: "fixture-token-not-real" }
        },
      }
      if (["@/lib/jira-dashboard", "@/lib/jira-missing-data", "@/lib/jira-page-token"].includes(specifier)) return load(specifier.slice(2) + ".ts")
      return fail(`Unexpected require: ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports) {\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  t.after(() => assert.deepEqual(violations, []))
  return { service: load("lib/jira-dashboard.ts"), actions: () => load("app/(app)/dashboard/actions.ts"), calls, tokenCalls }
}
const rejectsCode = (operation, code) => assert.rejects(operation, (error) => error.code === code)
const puts = (h) => h.calls.filter((call) => call.method === "PUT")
const liveReads = (h) => h.calls.filter((call) => call.method === "GET" && call.path.includes("/issue/"))

describe("exact missing-data summary against fixture Jira", () => {
  it("counts the cross-page null/zero union once per issue and each missing field separately", async (t) => {
    const h = harness(t, { search: (body, page) => {
      assert.equal(body.maxResults, 100)
      assert.deepEqual(body.fields, ["project", SP, AP])
      assert.equal(body.nextPageToken, page === 0 ? undefined : "next-1")
      return page === 0
        ? { issues: [pointIssue(1, null, 3), pointIssue(2, 2, 0)], nextPageToken: "next-1", isLast: false }
        : { issues: [pointIssue(3, 0, null), pointIssue(4, 2.5, 3.75)], isLast: true }
    } })
    assert.deepEqual(plain(await h.service.getMissingDataSummary("points")), {
      kind: "points", total: 3, storyPointsMissing: 2, actualStoryPointsMissing: 2,
    })
  })

  it("counts defect null/empty arrays but not already-populated causes", async (t) => {
    const issues = [defectIssue(1), defectIssue(2), defectIssue(3)]
    issues[1].fields[DC] = []
    issues[2].fields[DC] = [{ id: "7", value: "Fixture cause" }]
    const h = harness(t, { kind: "defect-cause", fields: defectFields, issues })
    assert.deepEqual(plain(await h.service.getMissingDataSummary("defect-cause")), {
      kind: "defect-cause", total: 2, storyPointsMissing: 0, actualStoryPointsMissing: 0,
    })
  })

  it("fails instead of returning approximate totals on duplicate issue IDs across pages", async (t) => {
    const h = harness(t, { search: (_body, page) => page === 0
      ? { issues: [pointIssue(1)], nextPageToken: "next-1" }
      : { issues: [pointIssue(1)], isLast: true } })
    await rejectsCode(() => h.service.getMissingDataSummary("points"), "retry")
  })

  it("rejects repeated Jira page cursors", async (t) => {
    const h = harness(t, { search: (_body, page) => ({ issues: [pointIssue(page + 1)], nextPageToken: "same-cursor", isLast: false }) })
    await rejectsCode(() => h.service.getMissingDataSummary("points"), "retry")
    assert.equal(h.calls.filter((call) => call.method === "POST").length, 2)
  })

  for (const [name, page] of [
    ["absent terminal isLast", { issues: [pointIssue(1)] }],
    ["false terminal isLast", { issues: [pointIssue(1)], isLast: false }],
    ["contradictory terminal cursor", { issues: [pointIssue(1)], isLast: true, nextPageToken: "next" }],
    ["empty nonterminal page", { issues: [], nextPageToken: "next", isLast: false }],
  ]) {
    it(`rejects incomplete pagination: ${name}`, async (t) => {
      const h = harness(t, { search: () => page })
      await rejectsCode(() => h.service.getMissingDataSummary("points"), "retry")
    })
  }

  it("allows exactly 5,000 terminal source issues", async (t) => {
    const h = harness(t, { search: (body, page) => {
      assert.equal(body.nextPageToken, page === 0 ? undefined : `cursor-${page}`)
      return {
        issues: Array.from({ length: 100 }, (_, index) => pointIssue(page * 100 + index + 1)),
        ...(page === 49 ? { isLast: true } : { nextPageToken: `cursor-${page + 1}`, isLast: false }),
      }
    } })
    assert.equal((await h.service.getMissingDataSummary("points")).total, 5_000)
    assert.equal(h.calls.filter((call) => call.method === "POST").length, 50)
  })

  it("fails closed at 5,000 when Jira has more source issues", async (t) => {
    const h = harness(t, { search: (_body, page) => ({
      issues: Array.from({ length: 100 }, (_, index) => pointIssue(page * 100 + index + 1)),
      nextPageToken: `cursor-${page + 1}`, isLast: false,
    }) })
    await rejectsCode(() => h.service.getMissingDataSummary("points"), "limit")
    assert.equal(h.calls.filter((call) => call.method === "POST").length, 50)
  })

  for (const [status, code] of [[401, "reauthorize"], [403, "forbidden"], [429, "retry"]]) {
    it(`maps HTTP ${status} to ${code}`, async (t) => {
      const h = harness(t, { responseStatus: status })
      await rejectsCode(() => h.service.getMissingDataSummary("points"), code)
    })
  }

  it("maps mocked Jira authorization failures without reading Jira", async (t) => {
    const h = harness(t, { authError: "invalid_configuration" })
    const error = await h.service.getMissingDataSummary("points").catch((error) => error)
    assert.equal(h.service.dashboardError(error).code, "configuration")
    assert.equal(h.calls.length, 0)
  })

  for (const [name, fields, issue] of [
    ["unsupported number schema", [pointFields[0], { ...pointFields[1], schema: { type: "string" } }], pointIssue(1)],
    ["ambiguous numeric field", [...pointFields, pointFields[0]], pointIssue(1)],
    ["unsupported project context", pointFields.map((field) => ({ ...field, scope: { type: "PROJECT", project: { id: "99" } } })), pointIssue(1)],
  ]) {
    it(`fails closed on ${name}`, async (t) => {
      const h = harness(t, { fields, issues: [issue] })
      await rejectsCode(() => h.service.getMissingDataSummary("points"), "configuration")
    })
  }

  it("rejects ambiguous or unsupported Defect Cause metadata", async (t) => {
    const ambiguous = harness(t, { kind: "defect-cause", fields: [...defectFields, { ...defectFields[0], id: "customfield_29999" }] })
    await rejectsCode(() => ambiguous.service.getMissingDataSummary("defect-cause"), "configuration")
    const unsupported = harness(t, { kind: "defect-cause", fields: [{ ...defectFields[0], schema: { type: "array", items: "string" } }] })
    await rejectsCode(() => unsupported.service.getMissingDataSummary("defect-cause"), "configuration")
  })

  it("does not classify negative, string, or absent live points as missing", async (t) => {
    for (const value of [-1, "0", undefined]) {
      const issue = pointIssue(1)
      issue.fields[SP] = value
      const h = harness(t, { issues: [issue] })
      await rejectsCode(() => h.service.getMissingDataSummary("points"), value === undefined ? "configuration" : "retry")
    }
  })
})

describe("missing-data detail pages", () => {
  it("uses each issue's live editmeta and allowedValues, excludes disabled options, and reads ADF safely", async (t) => {
    const first = defectIssue(1, [{ id: "7", value: "First context" }, { id: "8", value: "Disabled", disabled: true }])
    const second = defectIssue(2, [{ id: "22", value: "Second context" }])
    const h = harness(t, { kind: "defect-cause", fields: defectFields, issues: [first, second] })
    const page = plain(await h.service.getMissingDataPage("defect-cause"))
    assert.equal(page.page, 1)
    assert.equal(page.previousPageToken, null)
    assert.equal(page.nextPageToken, null)
    assert.equal(page.jiraBaseUrl, "https://fixture.example.invalid")
    assert.deepEqual(page.warnings, [])
    assert.deepEqual(page.issues[0].defectCauseOptions, [{ id: "7", value: "First context" }])
    assert.deepEqual(page.issues[1].defectCauseOptions, [{ id: "22", value: "Second context" }])
    assert.equal(page.issues[0].rootCause, "Root cause text")
    assert.equal(page.issues[0].solution, "Solution text")
    assert.equal(page.issues[0].defectCauseEditable, true)
    assert.equal(liveReads(h).length, 2)
    for (const call of liveReads(h)) {
      const params = new URLSearchParams(call.path.split("?")[1])
      assert.deepEqual(new Set(params.get("fields").split(",")), new Set(["project", "summary", DC, RC, SOL]))
    }
  })

  it("offers only missing numeric fields that each issue can set", async (t) => {
    const first = pointIssue(1, null, 3)
    const second = pointIssue(2, 0, null)
    second.editmeta.fields[AP] = { schema: { type: "number" }, operations: ["add"] }
    const h = harness(t, { issues: [first, second, pointIssue(3, 2, 4)] })
    const page = await h.service.getMissingDataPage("points")
    assert.equal(page.issues.length, 2)
    assert.equal(page.issues[0].storyPointsEditable, true)
    assert.equal(page.issues[0].actualStoryPointsEditable, false)
    assert.equal(page.issues[1].storyPointsEditable, true)
    assert.equal(page.issues[1].actualStoryPointsEditable, false)
    assert.equal(typeof page.issues[1].unavailableReason, "string")
  })

  it("requires login and rejects invalid encrypted page tokens before Jira requests", async (t) => {
    const signedOut = harness(t, { unauthenticated: true })
    await rejectsCode(() => signedOut.service.getMissingDataPage("points"), "reauthorize")
    assert.equal(signedOut.calls.length, 0)
    const invalidPage = harness(t)
    await rejectsCode(() => invalidPage.service.getMissingDataPage("points", "not-a-valid-token"), "invalid_page")
    assert.equal(invalidPage.calls.length, 0)
  })
})

describe("missing-data saves and action outcomes", () => {
  it("revalidates eligibility with the fixed date-free scope and sends both points in one field-only PUT", async (t) => {
    const h = harness(t, { issues: [pointIssue(1)] })
    const result = await h.service.updateMissingData("points", [change(1, { actualStoryPoints: 2.75, expectedActualStoryPoints: 0 })])
    assert.deepEqual(plain(result), { succeededIssueIds: ["1"], failures: [] })
    assert.deepEqual(puts(h), [{ path: "/rest/api/3/issue/1", method: "PUT", body: { fields: { [SP]: 1.25, [AP]: 2.75 } } }])
    assert.deepEqual(h.tokenCalls, [true])
    const query = h.calls.find((call) => call.method === "POST")
    assert.match(query.body.jql, /\) AND id in \(1\)$/)
    assert.doesNotMatch(query.body.jql, /30d|created|updated|resolved/i)
  })

  it("rejects issues no longer eligible without reading or writing them", async (t) => {
    const h = harness(t)
    const result = await h.service.updateMissingData("points", [change(1)])
    assert.deepEqual(plain(result.succeededIssueIds), [])
    assert.equal(result.failures[0].issueId, "1")
    assert.equal(liveReads(h).length, 0)
    assert.equal(puts(h).length, 0)
  })

  it("never overwrites positive points or a missing original changed from null to zero", async (t) => {
    for (const current of [3, 0]) {
      const h = harness(t, { issues: [pointIssue(1)], live: () => pointIssue(1, current, 0) })
      const result = await h.service.updateMissingData("points", [change(1)])
      assert.equal(result.failures.length, 1)
      assert.match(result.failures[0].message, /未覆寫/)
      assert.equal(puts(h).length, 0)
    }
  })

  it("does not partially write either field when the other field conflicts", async (t) => {
    const h = harness(t, { issues: [pointIssue(1)], live: () => pointIssue(1, null, 4) })
    const result = await h.service.updateMissingData("points", [change(1, { actualStoryPoints: 2, expectedActualStoryPoints: 0 })])
    assert.equal(result.failures.length, 1)
    assert.equal(puts(h).length, 0)
  })

  it("rejects missing per-issue set permission", async (t) => {
    const issue = pointIssue(1)
    issue.editmeta.fields[SP].operations = ["add"]
    const h = harness(t, { issues: [issue] })
    const result = await h.service.updateMissingData("points", [change(1)])
    assert.equal(result.failures.length, 1)
    assert.equal(puts(h).length, 0)
  })

  it("accepts only live issue-context defect options and sends IDs, not labels or metadata", async (t) => {
    const h = harness(t, { kind: "defect-cause", fields: defectFields, issues: [defectIssue(1)] })
    const result = await h.service.updateMissingData("defect-cause", [{ issueId: "1", defectCause: ["7"] }])
    assert.deepEqual(plain(result), { succeededIssueIds: ["1"], failures: [] })
    assert.deepEqual(puts(h)[0].body, { fields: { [DC]: [{ id: "7" }] } })
  })

  it("rejects options from another context and disabled options before PUT", async (t) => {
    for (const option of ["22", "8"]) {
      const issue = defectIssue(1, [{ id: "7", value: "Current context" }, { id: "8", value: "Disabled", disabled: true }])
      const h = harness(t, { kind: "defect-cause", fields: defectFields, issues: [issue] })
      const result = await h.service.updateMissingData("defect-cause", [{ issueId: "1", defectCause: [option] }])
      assert.equal(result.failures.length, 1)
      assert.equal(puts(h).length, 0)
    }
  })

  it("never overwrites a defect cause already filled by someone else", async (t) => {
    const issue = defectIssue(1)
    issue.fields[DC] = [{ id: "7" }]
    const h = harness(t, { kind: "defect-cause", fields: defectFields, issues: [issue] })
    const result = await h.service.updateMissingData("defect-cause", [{ issueId: "1", defectCause: ["7"] }])
    assert.equal(result.failures.length, 1)
    assert.match(result.failures[0].message, /未覆寫/)
    assert.equal(puts(h).length, 0)
  })

  it("requires Jira's 204 acknowledgement before reporting success", async (t) => {
    const h = harness(t, { issues: [pointIssue(1)], putStatus: () => 200 })
    const result = await h.service.updateMissingData("points", [change(1)])
    assert.deepEqual(plain(result.succeededIssueIds), [])
    assert.equal(result.failures.length, 1)
  })

  it("returns per-issue partial success through the real server action with the submission ID", async (t) => {
    const h = harness(t, { issues: [pointIssue(1), pointIssue(2)], putStatus: (id) => id === "2" ? 403 : 204 })
    const form = new FormData()
    form.set("submissionId", "fixture-submission")
    form.set("changes", JSON.stringify([change(1), change(2)]))
    const result = plain(await h.actions().updateMissingDataAction("points", {}, form))
    assert.equal(result.status, "partial")
    assert.equal(result.submissionId, "fixture-submission")
    assert.deepEqual(result.succeededIssueIds, ["1"])
    assert.equal(result.failures.length, 1)
    assert.equal(result.failures[0].issueId, "2")
    assert.match(result.message, /草稿已保留/)
    assert.equal(puts(h).length, 2)
  })

  it("validates the action payload and authentication before any Jira request", async (t) => {
    const invalid = harness(t)
    const form = new FormData()
    form.set("changes", JSON.stringify([change(1, { storyPoints: 0 })]))
    assert.equal((await invalid.actions().updateMissingDataAction("points", {}, form)).status, "error")
    assert.equal(invalid.calls.length, 0)
    const signedOut = harness(t, { unauthenticated: true })
    form.set("changes", JSON.stringify([change(1)]))
    assert.equal((await signedOut.actions().updateMissingDataAction("points", {}, form)).status, "error")
    assert.equal(signedOut.calls.length, 0)
  })
})

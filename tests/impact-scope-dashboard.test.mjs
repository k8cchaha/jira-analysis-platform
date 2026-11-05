import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import vm from "node:vm"
import { describe, it } from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const root = path.resolve(import.meta.dirname, "..")
const compiled = new Map()
const self = { mode: "self" }
const person = { mode: "person", accountId: "a", name: "Fixture person", days: 7 }
const panelPath = "app/(app)/dashboard/missing-data-panel.tsx"
const dialogPath = "app/(app)/dashboard/impact-scope-dialog.tsx"
const summary = (kind, total = 2) => ({ status: "success", summary: { kind, total, storyPointsMissing: 0, actualStoryPointsMissing: 0, jql: "fixture query", jiraBaseUrl: null } })
const issue = (id) => ({ id: String(id), key: `SUN-${id}`, summary: `Fixture <summary> ${id}`, assigneeDisplayName: "Fixture member", storyPointsRequired: false, actualStoryPointsRequired: false })
const page = (ids, number = 1, token = null, readOnly = true) => ({ status: "success", data: { readOnly, issues: ids.map(issue), page: number, nextPageToken: token, previousPageToken: null, jiraBaseUrl: "https://fixture.example.invalid", warnings: [] } })
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const response = (body, ok = true) => ({ ok, json: async () => body })
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

// Controlled offline hooks test; not a real browser/modal/router concurrency test.
function harness(fetcher) {
  const slots = []
  let index = 0
  let effects = []
  const modules = new Map()
  const calls = []
  const authorizations = []
  const stub = (label) => function Stub(props) { return React.createElement("div", { "data-component": label }, props.children) }
  const impactStub = stub("impact-dialog")
  const editDialog = (props) => React.createElement("section", { "aria-label": props.title }, React.createElement("h2", null, props.title), props.children)
  const hooks = {
    ...React,
    useState(initial) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial
      return [slots[slot], (value) => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value }]
    },
    useRef(initial) { const slot = index++; return slots[slot] ??= { current: initial } },
    useId() { return "fixture-id" },
    useCallback(fn) { return fn },
    useEffect(fn, deps) {
      const slot = index++
      const old = slots[slot]
      if (!old || deps.some((dep, i) => dep !== old.deps[i])) effects.push(() => { old?.cleanup?.(); slots[slot] = { deps, cleanup: fn() } })
    },
  }
  const sandbox = vm.createContext({ URL, URLSearchParams, AbortController, Error, Number, console, queueMicrotask, fetch: async (url, init) => { calls.push({ url, init }); return fetcher(url, init) } })
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports
    assert.ok([panelPath, dialogPath, "lib/jira-missing-data.ts", "lib/jira-missing-data-list.ts", "lib/jira-jql.ts", "lib/jira-fields.ts", "lib/jira-dashboard-filter.ts", "lib/date-range.ts"].includes(filename), `Unexpected module ${filename}`)
    const loadedModule = { exports: {} }
    modules.set(filename, loadedModule)
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(readFileSync(path.join(root, filename), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)
    function fixtureRequire(specifier) {
      if (specifier === "react") return hooks
      if (specifier === "react/jsx-runtime") return require(specifier)
      if (specifier === "next/navigation") return { useRouter: () => ({ push() {} }) }
      if (specifier === "@/components/edit-dialog") return { EditDialog: editDialog }
      if (specifier === "@/components/navigation-blocker") return { useNavigationBlocker: () => ({ isBlocked: false }) }
      if (specifier === "./actions") return { reauthorizeDashboardAction: async (href) => { authorizations.push(href) } }
      if (specifier === "./impact-scope-dialog") return { ImpactScopeDialog: impactStub }
      if (specifier === "./missing-data-dialog") return { MissingDataDialog: stub("write-dialog") }
      if (specifier === "./dashboard-filter") return { DashboardFilter: stub("filter") }
      if (specifier === "./dashboard-alert-cards") return { DashboardAlertCards: stub("alerts") }
      if (specifier === "./bug-alert-dialog") return { BugAlertDialog: stub("bugs") }
      if (specifier === "./due-reminder-dialog") return { DueReminderDialog: stub("due") }
      if (specifier === "./pending-issue-dialog") return { PendingIssueDialog: stub("pending") }
      if (specifier === "./jira-open-link") return { JiraOpenLink: stub("jira-link") }
      if (specifier.startsWith("@/lib/")) return load(specifier.slice(2) + ".ts")
      if (specifier.startsWith("./")) return load(path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier)))
      throw new Error(`Unexpected import ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports){${compiled.get(filename)}\n})`, sandbox)(fixtureRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  return {
    panel: load(panelPath).MissingDataPanel,
    dialog: load(dialogPath).ImpactScopeDialog,
    invoke(component, props) { index = 0; effects = []; const tree = component(props); effects.forEach((fn) => fn()); return tree },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()) },
    calls, authorizations, impactStub,
  }
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
const articles = (tree) => nodes(tree).filter((node) => node.type === "article")
const clickByText = (tree, text) => nodes(tree).find((node) => node.type === "button" && node.props.children === text).props.onClick()
const markup = (tree) => renderToStaticMarkup(tree)

describe("Impact Scope missing-data cards", () => {
  it("places the third neutral tile at the right with separate loading and retry", async () => {
    const waiting = deferred()
    let failed = true
    const h = harness(async (url) => {
      const kind = new URL(url, "https://fixture.invalid").searchParams.get("kind")
      if (kind === "points") return waiting.promise
      if (kind === "impact-scope" && failed) return response({ status: "error", error: { code: "retry", message: "Fixture unavailable" } }, false)
      return response(summary(kind))
    })
    const props = { applied: { filter: self, error: null } }
    let tree = h.invoke(h.panel, props)
    assert.equal(articles(tree).length, 3)
    assert.ok(articles(tree).every((node) => node.props["aria-busy"]))
    await settle()
    tree = h.invoke(h.panel, props)
    const cards = articles(tree)
    assert.equal(cards[0].props["aria-busy"], true)
    assert.equal(cards[1].props["aria-busy"], false)
    const html = markup(tree)
    assert.ok(html.indexOf("(Actual) Story Points 缺失") < html.indexOf("Defect Cause 缺失"))
    assert.ok(html.indexOf("Defect Cause 缺失") < html.indexOf("Impact Scope 缺失"))
    assert.match(html, /lg:grid-cols-3/)
    assert.match(markup(cards[2]), /Fixture unavailable/)
    assert.doesNotMatch(markup(cards[2]), /資料完整|張 Issue/)
    assert.ok(cards.every((node) => node.props.className.includes("min-w-0") && node.props.className.includes("dark:border-slate-800")))
    failed = false
    clickByText(cards[2], "重試")
    await settle()
    tree = h.invoke(h.panel, props)
    const impact = articles(tree)[2]
    assert.match(markup(impact), /查看明細/)
    assert.doesNotMatch(markup(impact), /補填/)
    nodes(impact).find((node) => node.type === "button" && node.props["aria-haspopup"] === "dialog").props.onClick()
    tree = h.invoke(h.panel, props)
    const dialog = nodes(tree).find((node) => node.type === h.impactStub)
    assert.equal(dialog.props.filter, self)
    const changed = h.invoke(h.panel, { applied: { filter: person, error: null } })
    const retained = nodes(changed).find((node) => node.type === h.impactStub)
    assert.equal(retained.props.filter, self)
    assert.equal(retained.props.scopeChanged, true)
    const previousCalls = h.calls.length
    retained.props.onClose()
    h.invoke(h.panel, { applied: { filter: person, error: null } })
    await settle()
    assert.equal(h.calls.length, previousCalls + 3)
    h.unmount()
    waiting.resolve(response(summary("points")))
    await settle()
  })
  for (const total of [0, -1, 0.5, 5001, "2"]) it(`handles exact zero or malformed counts ${total} without a clickable false result`, async () => {
    const h = harness(async (url) => response(summary(new URL(url, "https://fixture.invalid").searchParams.get("kind"), total)))
    const props = { applied: { filter: self, error: null } }
    h.invoke(h.panel, props)
    await settle()
    const impact = articles(h.invoke(h.panel, props))[2]
    assert.equal(nodes(impact).some((node) => node.props?.["aria-haspopup"] === "dialog"), false)
    assert.equal(markup(impact).includes("資料完整"), total === 0)
    h.unmount()
  })
  it("rejects obsolete scope responses", async () => {
    const old = deferred()
    const h = harness(async (url) => new URL(url, "https://fixture.invalid").searchParams.get("mode") === "person" ? response(summary(new URL(url, "https://fixture.invalid").searchParams.get("kind"), 3)) : old.promise)
    h.invoke(h.panel, { applied: { filter: self, error: null } })
    await settle()
    const props = { applied: { filter: person, error: null } }
    h.invoke(h.panel, props)
    await settle()
    old.resolve(response(summary("impact-scope", 999)))
    await settle()
    const impact = articles(h.invoke(h.panel, props))[2]
    assert.doesNotMatch(markup(impact), /999/)
    assert.match(markup(impact), />3<\/span>/)
    h.unmount()
  })
})

describe("Impact Scope read-only details", () => {
  for (const filter of [self, person]) it(`loads all pages with responsive read-only rows for ${filter.mode}`, async () => {
    const second = deferred()
    const h = harness(async (url) => new URL(url, "https://fixture.invalid").searchParams.has("pageToken") ? second.promise : response(page([1], 1, "next")))
    const props = { filter, scopeChanged: true, onClose() {} }
    let tree = h.invoke(h.dialog, props)
    await settle()
    assert.match(markup(h.invoke(h.dialog, props)), /正在載入/)
    second.resolve(response(page([2], 2)))
    await settle()
    tree = h.invoke(h.dialog, props)
    const html = markup(tree)
    assert.match(html, /Impact Scope 缺失明細/)
    assert.match(html, /SUN-1/)
    assert.match(html, /SUN-2/)
    assert.match(html, /Fixture &lt;summary&gt; 2/)
    assert.equal(html.includes("Assignee"), filter.mode !== "self")
    assert.match(html, /md:block/)
    assert.match(html, /md:hidden/)
    assert.match(html, /保留開啟時的範圍/)
    assert.doesNotMatch(html, /<form|<input|<select|儲存|補填/)
    assert.equal(h.calls.length, 2)
    assert.ok(h.calls.every((call) => call.init.cache === "no-store" && new URL(call.url, "https://fixture.invalid").searchParams.get("kind") === "impact-scope"))
    h.unmount()
    assert.ok(h.calls.every((call) => call.init.signal.aborted))
  })
  it("does not show partial rows on later-page failure and supports retry/reauthorization", async () => {
    let failed = true
    const h = harness(async (url) => response(failed && new URL(url, "https://fixture.invalid").searchParams.has("pageToken") ? { status: "error", error: { code: "forbidden", message: "Fixture denied" } } : page([1], 1, failed ? "next" : null)))
    const props = { filter: self, scopeChanged: false, onClose() {} }
    h.invoke(h.dialog, props)
    await settle()
    let tree = h.invoke(h.dialog, props)
    assert.match(markup(tree), /Fixture denied/)
    assert.doesNotMatch(markup(tree), /SUN-1/)
    clickByText(tree, "重新授權 Jira")
    await settle()
    assert.equal(h.authorizations.length, 1)
    failed = false
    clickByText(tree, "重試載入")
    h.invoke(h.dialog, props)
    await settle()
    tree = h.invoke(h.dialog, props)
    assert.match(markup(tree), /SUN-1/)
    h.unmount()
  })
  it("rejects non-read-only detail responses even in self mode", async () => {
    const h = harness(async () => response(page([1], 1, null, false)))
    const props = { filter: self, scopeChanged: false, onClose() {} }
    h.invoke(h.dialog, props)
    await settle()
    const html = markup(h.invoke(h.dialog, props))
    assert.match(html, /無法載入 Impact Scope 完整明細/)
    assert.doesNotMatch(html, /SUN-1/)
    h.unmount()
  })
  it("renders a complete empty list without implying loading or failure", async () => {
    const h = harness(async () => response(page([])))
    const props = { filter: self, scopeChanged: false, onClose() {} }
    h.invoke(h.dialog, props)
    await settle()
    const html = markup(h.invoke(h.dialog, props))
    assert.match(html, /目前沒有符合條件的 Issue/)
    assert.doesNotMatch(html, /正在載入|role="alert"/)
    h.unmount()
  })
  it("rejects obsolete detail responses when the requested scope changes", async () => {
    const old = deferred()
    const h = harness(async (url) => new URL(url, "https://fixture.invalid").searchParams.get("mode") === "person" ? response(page([2])) : old.promise)
    h.invoke(h.dialog, { filter: self, scopeChanged: false, onClose() {} })
    await settle()
    const props = { filter: person, scopeChanged: false, onClose() {} }
    h.invoke(h.dialog, props)
    await settle()
    old.resolve(response(page([1])))
    await settle()
    const html = markup(h.invoke(h.dialog, props))
    assert.match(html, /SUN-2/)
    assert.doesNotMatch(html, /SUN-1/)
    h.unmount()
  })
  it("aborts unmounted work without accepting later results", async () => {
    const waiting = deferred()
    const h = harness(async () => waiting.promise)
    const props = { filter: self, scopeChanged: false, onClose() {} }
    h.invoke(h.dialog, props)
    await settle()
    h.unmount()
    assert.equal(h.calls[0].init.signal.aborted, true)
    waiting.resolve(response(page([1], 1, null, false)))
    await settle()
    assert.doesNotMatch(markup(h.invoke(h.dialog, props)), /SUN-1/)
  })
})

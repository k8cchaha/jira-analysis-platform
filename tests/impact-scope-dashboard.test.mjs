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
const editorPath = "app/(app)/dashboard/missing-data-dialog.tsx"
const options = [{ id: "7", value: "Synthetic UI" }, { id: "8", value: "Synthetic API" }]
const impact = (mode = "single", editable = true) => ({ mode, value: [], options: editable ? options : [], editable })
const summary = (kind, total = 2) => ({ status: "success", summary: { kind, total, storyPointsMissing: 0, actualStoryPointsMissing: 0, jql: "fixture query", jiraBaseUrl: null } })
const issue = (id, field = impact()) => ({ id: String(id), key: `SUN-${id}`, summary: `Fixture <summary> ${id}`, statusName: "To Do", assigneeDisplayName: "Fixture member", storyPointsRequired: false, actualStoryPointsRequired: false, impactScope: field })
const page = (ids, number = 1, token = null, readOnly = true) => ({ status: "success", data: { readOnly, issues: ids.map((id) => issue(id, impact("single", !readOnly))), page: number, nextPageToken: token, previousPageToken: null, jiraBaseUrl: "https://fixture.example.invalid", warnings: [] } })
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const response = (body, ok = true) => ({ ok, json: async () => body })
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

// Controlled offline hooks test; not a real browser/modal/router concurrency test.
function harness(fetcher, updater = async () => ({ status: "error", message: "Synthetic failure", succeededIssueIds: [], failures: [] })) {
  const slots = []
  let index = 0
  let effects = []
  const modules = new Map()
  const calls = []
  const pushes = []
  let navigationBlocked = false
  const authorizations = []
  const updates = []
  const blockers = []
  const listeners = new Map()
  const setBlocked = (source, blocked) => blockers.push({ source, blocked })
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) }
  const stub = (label) => function Stub(props) { return React.createElement("div", { "data-component": label }, props.children) }
  const impactStub = stub("impact-dialog")
  const filterStub = stub("filter")
  const alertsStub = stub("alerts")
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
    useCallback(fn, deps) {
      const slot = index++
      const old = slots[slot]
      if (!old || deps.some((dep, i) => dep !== old.deps[i])) slots[slot] = { deps, fn }
      return slots[slot].fn
    },
    useActionState(fn, initial) {
      const slot = index++
      slots[slot] ??= { state: initial, pending: false }
      const action = async (data) => {
        slots[slot].pending = true
        try { slots[slot].state = await fn(slots[slot].state, data) }
        finally { slots[slot].pending = false }
      }
      return [slots[slot].state, action, slots[slot].pending]
    },
    useEffect(fn, deps) {
      const slot = index++
      const old = slots[slot]
      if (!old || deps.some((dep, i) => dep !== old.deps[i])) effects.push(() => { old?.cleanup?.(); slots[slot] = { deps, cleanup: fn() } })
    },
  }
  const sandbox = vm.createContext({ URL, URLSearchParams, AbortController, Error, Number, console, queueMicrotask, window, fetch: async (url, init) => { calls.push({ url, init }); return fetcher(url, init) } })
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports
    assert.ok([panelPath, dialogPath, editorPath, "lib/jira-missing-data.ts", "lib/jira-missing-data-list.ts", "lib/jira-jql.ts", "lib/jira-fields.ts", "lib/jira-dashboard-filter.ts", "lib/date-range.ts", "lib/status-color.ts"].includes(filename), `Unexpected module ${filename}`)
    const loadedModule = { exports: {} }
    modules.set(filename, loadedModule)
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(readFileSync(path.join(root, filename), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)
    function fixtureRequire(specifier) {
      if (specifier === "react") return hooks
      if (specifier === "react/jsx-runtime") return require(specifier)
      if (specifier === "next/navigation") return { useRouter: () => ({ push: (href) => pushes.push(href) }) }
      if (specifier === "@/components/edit-dialog") return { EditDialog: editDialog }
      if (specifier === "@/components/navigation-blocker") return { useNavigationBlocker: () => ({ isBlocked: navigationBlocked, setBlocked }) }
      if (specifier === "./parent-issue-type-icon") return { ParentIssueTypeIcon: stub("parent-type") }
      if (specifier === "./actions") return { reauthorizeDashboardAction: async (href) => { authorizations.push(href) }, updateMissingDataAction: async (kind, previous, data) => { updates.push({ kind, data }); return updater(kind, previous, data) } }
      if (specifier === "./impact-scope-dialog") return { ImpactScopeDialog: impactStub }
      if (specifier === "./missing-data-dialog") return filename === dialogPath ? load(editorPath) : { MissingDataDialog: stub("write-dialog") }
      if (specifier === "./dashboard-filter") return { DashboardFilter: filterStub }
      if (specifier === "./dashboard-alert-cards") return { DashboardAlertCards: alertsStub }
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
    editor: load(editorPath).MissingDataDialog,
    dialog: (props) => { const wrapped = load(dialogPath).ImpactScopeDialog(props); return wrapped.type(wrapped.props) },
    invoke(component, props) { index = 0; effects = []; const tree = component(props); effects.forEach((fn) => fn()); return tree },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()) },
    calls, pushes, authorizations, impactStub, filterStub, alertsStub, updates, blockers, listeners,
    blockNavigation(value) { navigationBlocked = value },
  }
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (["ImpactScopeInput", "DefectCauseInput"].includes(tree.type?.name)) return [tree, ...nodes(tree.type(tree.props))]
  return [tree, ...nodes(tree.props?.children)]
}
const articles = (tree) => nodes(tree).filter((node) => node.type === "article")
const clickByText = (tree, text) => nodes(tree).find((node) => node.type === "button" && [node.props.children].flat().join("") === text).props.onClick()
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
    assert.match(markup(impact), /查看明細與補填/)
    const countCalls = h.calls.length
    nodes(impact).find((node) => node.type === "button" && node.props["aria-haspopup"] === "dialog").props.onClick()
    tree = h.invoke(h.panel, props)
    const dialog = nodes(tree).find((node) => node.type === h.impactStub)
    assert.equal(dialog.props.filter, self)
    dialog.props.onSaved()
    await settle()
    assert.equal(h.calls.length, countCalls + 1)
    assert.equal(new URL(h.calls.at(-1).url, "https://fixture.invalid").searchParams.get("kind"), "impact-scope")
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

const controls = (h, tree) => nodes(tree).find((node) => node.type === h.filterStub)
const queryParams = (url) => new URL(url, "https://fixture.invalid").searchParams
const filterQuery = (url) => {
  const params = queryParams(url)
  for (const key of ["kind", "view", "pageToken"]) params.delete(key)
  return params.toString()
}

describe("Dashboard applied checkbox identity and snapshots", () => {
  it("pushes changed self flags, suppresses identical self, and keys URL history remounts by the full query", async () => {
    const h = harness(async (url) => response(summary(queryParams(url).get("kind"))))
    const p = (filter) => ({ applied: { filter, error: null }, viewerId: "fixture-viewer" })
    let tree = h.invoke(h.panel, p(self))
    const initialKey = controls(h, tree).key
    controls(h, tree).props.onApply(self)
    controls(h, tree).props.onApply({ ...self, includeUnexpectedClosed: false })
    assert.deepEqual(h.pushes, [])
    controls(h, tree).props.onApply({ ...self, includeUnexpectedClosed: true })
    assert.deepEqual(h.pushes, ["/dashboard?includeUnexpectedClosed=1"])
    tree = h.invoke(h.panel, p({ ...self, includeUnexpectedClosed: true }))
    assert.notEqual(controls(h, tree).key, initialKey)
    const enabledKey = controls(h, tree).key
    assert.equal(nodes(tree).find((node) => node.type === h.alertsStub).props.query, "includeUnexpectedClosed=1")
    controls(h, tree).props.onApply({ ...self, includeUnexpectedClosed: true })
    assert.equal(h.pushes.length, 1)
    h.blockNavigation(true)
    tree = h.invoke(h.panel, p({ ...self, includeUnexpectedClosed: true }))
    controls(h, tree).props.onApply(self)
    assert.equal(h.pushes.length, 1)
    h.blockNavigation(false)
    tree = h.invoke(h.panel, p({ ...self, includeUnexpectedClosed: true }))
    controls(h, tree).props.onApply(self)
    assert.deepEqual(h.pushes, ["/dashboard?includeUnexpectedClosed=1", "/dashboard"])
    tree = h.invoke(h.panel, p(self))
    assert.equal(controls(h, tree).key, initialKey)
    tree = h.invoke(h.panel, p({ ...self, includeUnexpectedClosed: true }))
    assert.equal(controls(h, tree).key, enabledKey)
    await settle()
    h.unmount()
  })

  it("marks all cards loading and ignores stale summary results after a flag-only self change", async () => {
    const old = deferred()
    const h = harness(async (url) => queryParams(url).has("includeUnexpectedClosed") ? response(summary(queryParams(url).get("kind"), 3)) : old.promise)
    h.invoke(h.panel, { applied: { filter: self, error: null } })
    await settle()
    assert.equal(h.calls.length, 3)
    const p = { applied: { filter: { ...self, includeUnexpectedClosed: true }, error: null } }
    let tree = h.invoke(h.panel, p)
    assert.ok(articles(tree).every((node) => node.props["aria-busy"] === true))
    assert.equal(nodes(tree).some((node) => node.props?.["aria-haspopup"] === "dialog"), false)
    await settle()
    old.resolve(response(summary("impact-scope", 999)))
    await settle()
    tree = h.invoke(h.panel, p)
    assert.equal(h.calls.length, 6)
    assert.ok(h.calls.slice(3).every(({ url }) => filterQuery(url) === "includeUnexpectedClosed=1"))
    assert.ok(articles(tree).every((node) => node.props["aria-busy"] === false && markup(node).includes(">3</span>")))
    assert.doesNotMatch(markup(tree), /999/)
    h.unmount()
  })

  for (const kind of ["points", "defect-cause", "impact-scope", "bugs", "due", "pending"]) it(`pins the complete ${kind} dialog query on a flag-only URL change until close`, async () => {
    const original = { mode: "team-project", groups: ["ent-web", "ent-be1"], exclusions: { "ent-web": ["excluded"] }, projects: ["sun", "tkk"], days: 7, includeUnexpectedClosed: true }
    const changed = { ...original, includeUnexpectedClosed: false }
    const h = harness(async (url) => response(summary(queryParams(url).get("kind"))))
    const p = (filter) => ({ applied: { filter, error: null }, viewerId: "fixture-viewer" })
    h.invoke(h.panel, p(original))
    await settle()
    let tree = h.invoke(h.panel, p(original))
    const key = controls(h, tree).key
    const query = nodes(tree).find((node) => node.type === h.alertsStub).props.query
    if (["points", "defect-cause", "impact-scope"].includes(kind)) {
      const card = articles(tree)[["points", "defect-cause", "impact-scope"].indexOf(kind)]
      nodes(card).find((node) => node.props?.["aria-haspopup"] === "dialog").props.onClick()
    } else {
      const alerts = nodes(tree).find((node) => node.type === h.alertsStub)
      alerts.props[{ bugs: "onOpenBugs", due: "onOpenDue", pending: "onOpenPending" }[kind]]()
    }
    tree = h.invoke(h.panel, p(changed))
    const dialog = nodes(tree).find((node) => node.props?.scopeChanged !== undefined && node.props.onClose)
    assert.ok(dialog)
    assert.equal(dialog.props.filter, original)
    assert.equal(dialog.props.scopeChanged, true)
    assert.equal(controls(h, tree).key, key)
    assert.equal(controls(h, tree).props.filter, original)
    assert.equal(nodes(tree).find((node) => node.type === h.alertsStub).props.query, query)
    controls(h, tree).props.onApply(changed)
    assert.deepEqual(h.pushes, [])
    await settle()
    assert.equal(h.calls.length, 3)
    if (dialog.props.onSaved) {
      dialog.props.onSaved()
      await settle()
      assert.equal(h.calls.length, 4)
      assert.equal(filterQuery(h.calls.at(-1).url), query)
      assert.equal(queryParams(h.calls.at(-1).url).get("kind"), kind)
    }
    const beforeClose = h.calls.length
    dialog.props.onClose()
    tree = h.invoke(h.panel, p(changed))
    assert.notEqual(controls(h, tree).key, key)
    assert.equal(controls(h, tree).props.filter, changed)
    assert.ok(articles(tree).every((node) => node.props["aria-busy"] === true))
    await settle()
    assert.equal(h.calls.length, beforeClose + 3)
    assert.ok(h.calls.slice(beforeClose).every(({ url }) => !queryParams(url).has("includeUnexpectedClosed")))
    h.unmount()
  })

  it("summary retry and save refresh retain the enabled self query while an Impact dialog is open", async () => {
    let failed = true
    const original = { ...self, includeUnexpectedClosed: true }
    const h = harness(async (url) => queryParams(url).get("kind") === "points" && failed
      ? response({ status: "error", error: { code: "retry", message: "Synthetic retry" } }, false)
      : response(summary(queryParams(url).get("kind"))))
    const p = (filter) => ({ applied: { filter, error: null } })
    h.invoke(h.panel, p(original))
    await settle()
    let tree = h.invoke(h.panel, p(original))
    nodes(articles(tree)[2]).find((node) => node.props?.["aria-haspopup"] === "dialog").props.onClick()
    tree = h.invoke(h.panel, p(self))
    failed = false
    clickByText(articles(tree)[0], "重試")
    nodes(tree).find((node) => node.type === h.impactStub).props.onSaved()
    await settle()
    assert.equal(h.calls.length, 5)
    assert.ok(h.calls.every(({ url }) => filterQuery(url) === "includeUnexpectedClosed=1"))
    assert.deepEqual(h.calls.slice(3).map(({ url }) => queryParams(url).get("kind")), ["points", "impact-scope"])
    tree = h.invoke(h.panel, p(self))
    assert.match(markup(articles(tree)[2]), /查看明細與補填/)
    assert.equal(nodes(tree).find((node) => node.type === h.impactStub).props.scopeChanged, true)
    h.unmount()
  })
})

function selector(tree, id = "1") {
  return nodes(tree).find((node) => node.type === "select" && node.props.id === `desktop-${id}-impact-scope`)
}
function formData(tree) {
  const data = new FormData()
  for (const node of nodes(tree).filter((node) => node.type === "input" && node.props.type === "hidden")) data.set(node.props.name, node.props.value)
  return data
}
function submitTree(tree) {
  const form = nodes(tree).find((node) => node.type === "form")
  let prevented = false
  form.props.onSubmit({ preventDefault() { prevented = true } })
  assert.equal(prevented, false)
  return form.props.action(formData(tree))
}

describe("Impact Scope supplementation", () => {
  const props = (extras = {}) => ({ filter: self, scopeChanged: false, onClose() {}, onSaved() {}, ...extras })
  it("selects single options, clears drafts and protects dirty closing/reload", async () => {
    let closes = 0
    const h = harness(async () => response(page([1], 1, null, false)))
    const p = props({ onClose() { closes++ } })
    h.invoke(h.dialog, p)
    await settle()
    let tree = h.invoke(h.dialog, p)
    selector(tree).props.onChange({ target: { value: "7" } })
    tree = h.invoke(h.dialog, p)
    assert.equal(selector(tree).props.value, "7")
    assert.match(markup(tree), /1 張未儲存/)
    assert.equal(h.listeners.has("beforeunload"), true)
    assert.equal(h.blockers.at(-1).blocked, true)
    clickByText(tree, "重新載入")
    tree = h.invoke(h.dialog, p)
    assert.match(markup(tree), /放棄尚未儲存的變更/)
    assert.equal(h.calls.length, 1)
    clickByText(tree, "繼續編輯")
    tree = h.invoke(h.dialog, p)
    selector(tree).props.onChange({ target: { value: "" } })
    tree = h.invoke(h.dialog, p)
    assert.match(markup(tree), /0 張未儲存/)
    assert.equal(h.listeners.has("beforeunload"), false)
    selector(tree).props.onChange({ target: { value: "8" } })
    tree = h.invoke(h.dialog, p)
    nodes(tree).find((node) => node.props?.title === "Impact Scope 缺失明細").props.onClose()
    tree = h.invoke(h.dialog, p)
    assert.equal(closes, 0)
    clickByText(tree, "放棄變更並關閉")
    assert.equal(closes, 1)
    h.unmount()
  })
  it("retains dirty drafts when confirmed reload fails", async () => {
    let failed = false
    const h = harness(async () => failed ? response({ status: "error", error: { code: "retry", message: "Synthetic reload failed" } }, false) : response(page([1], 1, null, false)))
    const p = props()
    h.invoke(h.dialog, p)
    await settle()
    let tree = h.invoke(h.dialog, p)
    selector(tree).props.onChange({ target: { value: "7" } })
    tree = h.invoke(h.dialog, p)
    clickByText(tree, "重新載入")
    tree = h.invoke(h.dialog, p)
    failed = true
    clickByText(tree, "放棄變更並繼續")
    await settle()
    tree = h.invoke(h.dialog, p)
    assert.equal(selector(tree).props.value, "7")
    assert.match(markup(tree), /Synthetic reload failed|1 張未儲存/)
    assert.equal(h.listeners.has("beforeunload"), true)
    h.unmount()
  })
  it("renders accessible multi-options and submits only selected IDs", async () => {
    const h = harness(async () => {
      const result = page([1], 1, null, false)
      result.data.issues[0].impactScope = impact("multi")
      return response(result)
    })
    const p = props()
    h.invoke(h.dialog, p)
    await settle()
    let tree = h.invoke(h.dialog, p)
    assert.equal(selector(tree), undefined)
    const input = nodes(tree).find((node) => node.type?.name === "ImpactScopeInput" && node.props.prefix === "desktop")
    input.props.onChange(["7", "8"])
    tree = h.invoke(h.dialog, p)
    assert.match(markup(tree), /Synthetic UI、Synthetic API/)
    const ids = JSON.parse(formData(tree).get("changes"))
    assert.deepEqual(ids, [{ issueId: "1", impactScope: ["7", "8"] }])
    assert.equal(nodes(tree).filter((node) => node.type === "input" && node.props.type === "checkbox").length, 4)
    await submitTree(tree)
    assert.equal(h.updates[0].kind, "impact-scope")
    assert.equal(h.updates[0].data.has("fieldId"), false)
    h.unmount()
  })
  it("locks while saving, preserves failed snapshot drafts and refreshes successful count", async () => {
    const waiting = deferred()
    let saves = 0
    const h = harness(async () => response(page([1, 2], 1, null, false)), async (_kind, _previous, data) => {
      await waiting.promise
      return { submissionId: data.get("submissionId"), status: "partial", message: "Synthetic partial success", succeededIssueIds: ["1"], failures: [{ issueId: "2", message: "Synthetic denied" }] }
    })
    const p = props({ onSaved() { saves++ } })
    h.invoke(h.dialog, p)
    await settle()
    let tree = h.invoke(h.dialog, p)
    selector(tree, "1").props.onChange({ target: { value: "7" } })
    selector(tree, "2").props.onChange({ target: { value: "8" } })
    tree = h.invoke(h.dialog, p)
    const submitted = submitTree(tree)
    tree = h.invoke(h.dialog, p)
    assert.equal(selector(tree, "2").props.disabled, true)
    selector(tree, "2").props.onChange({ target: { value: "7" } })
    waiting.resolve()
    await submitted
    tree = h.invoke(h.dialog, p)
    assert.equal(selector(tree, "1"), undefined)
    assert.equal(selector(tree, "2").props.value, "8")
    assert.match(markup(tree), /Synthetic denied/)
    assert.match(markup(tree), /1 張未儲存/)
    assert.equal(saves, 1)
    assert.equal(h.calls.length, 1)
    assert.deepEqual(JSON.parse(formData(tree).get("changes")), [{ issueId: "2", impactScope: ["8"] }])
    h.unmount()
  })
  it("reloads the list after all changes succeed", async () => {
    let saves = 0
    let completed = false
    const h = harness(async () => response(page(completed ? [] : [1], 1, null, false)), async (_kind, _previous, data) => {
      completed = true
      return { submissionId: data.get("submissionId"), status: "success", message: "Synthetic saved", succeededIssueIds: ["1"], failures: [] }
    })
    const p = props({ onSaved() { saves++ } })
    h.invoke(h.dialog, p)
    await settle()
    let tree = h.invoke(h.dialog, p)
    selector(tree).props.onChange({ target: { value: "7" } })
    tree = h.invoke(h.dialog, p)
    await submitTree(tree)
    await settle()
    tree = h.invoke(h.dialog, p)
    assert.equal(saves, 1)
    assert.equal(h.calls.length, 2)
    assert.match(markup(tree), /目前沒有待補資料/)
    assert.equal(h.listeners.has("beforeunload"), false)
    h.unmount()
  })
  it("shows unavailable/unknown values without controls or a valid submission", async () => {
    const h = harness(async () => {
      const result = page([1], 1, null, false)
      result.data.issues[0] = { ...issue(1, { mode: null, value: null, options: [], editable: false }), unavailableReason: "Synthetic unsupported schema" }
      return response(result)
    })
    const p = props()
    h.invoke(h.dialog, p)
    await settle()
    const tree = h.invoke(h.dialog, p)
    assert.match(markup(tree), /無法識別欄位值|Synthetic unsupported schema/)
    assert.equal(selector(tree), undefined)
    assert.equal(nodes(tree).find((node) => node.type === "button" && node.props.type === "submit").props.disabled, true)
    assert.equal(h.updates.length, 0)
    h.unmount()
  })
  it("keeps nonself current labels readonly even when populated", async () => {
    const h = harness(async () => {
      const result = page([1])
      result.data.issues[0].impactScope.value = [options[0]]
      return response(result)
    })
    const p = props({ filter: person })
    h.invoke(h.dialog, p)
    await settle()
    const tree = h.invoke(h.dialog, p)
    assert.match(markup(tree), /Synthetic UI|Assignee/)
    assert.equal(selector(tree), undefined)
    assert.equal(nodes(tree).some((node) => node.type === "button" && node.props.type === "submit"), false)
    assert.equal(h.updates.length, 0)
    h.unmount()
  })
  it("rejects unknown selected IDs and caps drafts at 50 rows", async () => {
    const h = harness(async (url) => new URL(url, "https://fixture.invalid").searchParams.has("pageToken") ? response(page([51], 2, null, false)) : response(page(Array.from({ length: 50 }, (_, i) => i + 1), 1, "second", false)))
    const p = props()
    h.invoke(h.dialog, p)
    await settle()
    let tree = h.invoke(h.dialog, p)
    selector(tree).props.onChange({ target: { value: "999" } })
    tree = h.invoke(h.dialog, p)
    assert.match(markup(tree), /請選擇有效的 Impact Scope/)
    assert.equal(nodes(tree).find((node) => node.type === "button" && node.props.type === "submit").props.disabled, true)
    for (let id = 1; id <= 50; id++) selector(tree, String(id)).props.onChange({ target: { value: "7" } })
    tree = h.invoke(h.dialog, p)
    assert.equal(selector(tree, "51").props.disabled, true)
    selector(tree, "51").props.onChange({ target: { value: "8" } })
    tree = h.invoke(h.dialog, p)
    assert.equal(JSON.parse(formData(tree).get("changes")).length, 50)
    assert.equal(selector(tree, "51").props.value, "")
    h.unmount()
  })
  it("preserves drafts when a save result cannot match its submission", async () => {
    let saves = 0
    const h = harness(async () => response(page([1], 1, null, false)), async () => ({ submissionId: "wrong", status: "success", message: "Synthetic untrusted result", succeededIssueIds: ["1"], failures: [] }))
    const p = props({ onSaved() { saves++ } })
    h.invoke(h.dialog, p)
    await settle()
    let tree = h.invoke(h.dialog, p)
    selector(tree).props.onChange({ target: { value: "7" } })
    tree = h.invoke(h.dialog, p)
    await submitTree(tree)
    tree = h.invoke(h.dialog, p)
    assert.equal(selector(tree).props.value, "7")
    assert.match(markup(tree), /無法核對儲存結果/)
    assert.equal(saves, 0)
    h.unmount()
  })
  it("rejects malformed metadata and HTTP failures claiming success", async () => {
    for (const malformed of [true, false]) {
      const h = harness(async () => {
        const result = page([1], 1, null, false)
        if (malformed) delete result.data.issues[0].impactScope
        return response(result, malformed)
      })
      const p = props()
      h.invoke(h.dialog, p)
      await settle()
      const html = markup(h.invoke(h.dialog, p))
      assert.doesNotMatch(html, /SUN-1|<select/)
      assert.match(html, /不完整|無法載入完整明細/)
      h.unmount()
    }
  })
})

describe("existing shared editor regression", () => {
  it("renders expanded self Points read-only reasons and excludes those rows from drafts", async () => {
    const reason = "此票不符合原本的本人補填範圍，僅供查看。"
    const h = harness(async () => {
      const result = page([1, 2], 1, null, false)
      result.data.issues = result.data.issues.map((row, index) => ({ ...row,
        storyPoints: null, actualStoryPoints: 0, storyPointsRequired: true, actualStoryPointsRequired: true,
        storyPointsEditable: index === 0, actualStoryPointsEditable: index === 0,
        parentIssueType: { status: "none" }, ...(index === 1 ? { unavailableReason: reason } : {}),
      }))
      return response(result)
    })
    const p = { kind: "points", filter: { ...self, includeUnexpectedClosed: true }, onClose() {}, onSaved() {} }
    h.invoke(h.editor, p)
    await settle()
    let tree = h.invoke(h.editor, p)
    const html = markup(tree)
    assert.match(html, /id="desktop-1-storyPoints"[^>]*type="number"|type="number"[^>]*id="desktop-1-storyPoints"/)
    assert.doesNotMatch(html, /id="(?:desktop|mobile)-2-(?:storyPoints|actualStoryPoints)"/)
    assert.ok(html.includes(`title="${reason}"`))
    assert.ok(html.includes(reason))
    const inputs = nodes(tree).filter((node) => node.type?.name === "PointInput" && node.props.prefix === "desktop")
    inputs.find((node) => node.props.issue.id === "2" && node.props.field === "storyPoints").props.onChange("99")
    inputs.find((node) => node.props.issue.id === "1" && node.props.field === "storyPoints").props.onChange("2")
    tree = h.invoke(h.editor, p)
    assert.deepEqual(JSON.parse(formData(tree).get("changes")), [{ issueId: "1", storyPoints: 2, expectedStoryPoints: null }])
    assert.equal(formData(tree).has("includeUnexpectedClosed"), false)
    assert.ok(h.calls.every(({ url }) => new URL(url, "https://fixture.invalid").searchParams.get("includeUnexpectedClosed") === "1"))
    h.unmount()
  })
  it("retains Points columns without Impact Scope controls", async () => {
    const h = harness(async () => {
      const result = page([1])
      result.data.issues[0] = { ...result.data.issues[0], storyPoints: 0, actualStoryPoints: null, storyPointsRequired: true, actualStoryPointsRequired: true, parentIssueType: { status: "none" } }
      return response(result)
    })
    const p = { kind: "points", filter: person, onClose() {}, onSaved() {} }
    h.invoke(h.editor, p)
    await settle()
    const html = markup(h.invoke(h.editor, p))
    assert.match(html, /SP<\/th>|Actual SP<\/th>/)
    assert.doesNotMatch(html, /Impact Scope|Defect Cause|Root Cause|Status<\/th>|Status：/)
    h.unmount()
  })
  it("retains Defect Cause drafts and fields without Impact fallthrough", async () => {
    const h = harness(async () => {
      const result = page([1], 1, null, false)
      result.data.issues[0] = { ...result.data.issues[0], rootCause: "Synthetic Root", solution: "Synthetic Solution", defectCause: [], defectCauseOptions: options, defectCauseEditable: true }
      return response(result)
    })
    const p = { kind: "defect-cause", filter: self, onClose() {}, onSaved() {} }
    h.invoke(h.editor, p)
    await settle()
    let tree = h.invoke(h.editor, p)
    assert.match(markup(tree), /Root Cause|Solution|Defect Cause/)
    assert.doesNotMatch(markup(tree), /Impact Scope|Status<\/th>|Status：/)
    nodes(tree).find((node) => node.type?.name === "DefectCauseInput" && node.props.prefix === "desktop").props.onChange(["7"])
    tree = h.invoke(h.editor, p)
    assert.deepEqual(JSON.parse(formData(tree).get("changes")), [{ issueId: "1", defectCause: ["7"] }])
    h.unmount()
  })
})

describe("Impact Scope full-query checkbox detail regressions", () => {
  it("rejects a late detail result on a flag-only self scope change", async () => {
    const old = deferred()
    const h = harness(async (url) => queryParams(url).has("includeUnexpectedClosed") ? response(page([2], 1, null, false)) : old.promise)
    h.invoke(h.dialog, { filter: self, scopeChanged: false, onClose() {}, onSaved() {} })
    await settle()
    const p = { filter: { ...self, includeUnexpectedClosed: true }, scopeChanged: false, onClose() {}, onSaved() {} }
    h.invoke(h.dialog, p)
    await settle()
    assert.equal(h.calls.length, 2)
    assert.equal(h.calls[0].init.signal.aborted, true)
    assert.equal(h.calls[1].init.signal.aborted, false)
    assert.equal(filterQuery(h.calls[1].url), "includeUnexpectedClosed=1")
    old.resolve(response(page([1], 1, null, false)))
    await settle()
    const tree = h.invoke(h.dialog, p)
    assert.match(markup(tree), /SUN-2/)
    assert.doesNotMatch(markup(tree), /SUN-1/)
    assert.ok(selector(tree, "2"), "enabling a read option does not turn self into read-only")
    h.unmount()
  })

  it("retains the full enabled person snapshot for detail retry and Jira reauthorization", async () => {
    const filter = { ...person, includeUnexpectedClosed: true }
    let failed = true
    const h = harness(async () => failed ? response({ status: "error", error: { code: "forbidden", message: "Synthetic permission retry" } }, false) : response(page([2])))
    const p = { filter, scopeChanged: true, onClose() {}, onSaved() {} }
    h.invoke(h.dialog, p)
    await settle()
    let tree = h.invoke(h.dialog, p)
    assert.match(markup(tree), /保留開啟時的範圍/)
    clickByText(tree, "重新授權 Jira")
    await settle()
    assert.equal(h.authorizations.length, 1)
    assert.equal(filterQuery(h.authorizations[0]), "mode=person&accountId=a&name=Fixture+person&days=7&includeUnexpectedClosed=1")
    // Reauthorization is an intentional navigation; a fresh offline instance drives the retry.
    h.unmount()
    const retry = harness(async () => failed ? response({ status: "error", error: { code: "retry", message: "Synthetic list retry" } }, false) : response(page([2])))
    retry.invoke(retry.dialog, p)
    await settle()
    tree = retry.invoke(retry.dialog, p)
    failed = false
    clickByText(tree, "重試載入")
    await settle()
    tree = retry.invoke(retry.dialog, p)
    assert.equal(retry.calls.length, 2)
    assert.ok(retry.calls.every(({ url }) => filterQuery(url) === filterQuery(h.authorizations[0])))
    assert.match(markup(tree), /SUN-2/)
    assert.equal(selector(tree, "2"), undefined)
    assert.equal(nodes(tree).some((node) => node.type === "button" && node.props.type === "submit"), false)
    retry.unmount()
  })

  it("keeps enabled self edits locked to the submitted draft and refreshes with the retained flag after save", async () => {
    const waiting = deferred()
    let completed = false
    let saves = 0
    const filter = { ...self, includeUnexpectedClosed: true }
    const h = harness(async () => response(page(completed ? [] : [1], 1, null, false)), async (_kind, _previous, data) => {
      await waiting.promise
      completed = true
      return { submissionId: data.get("submissionId"), status: "success", message: "Synthetic saved", succeededIssueIds: ["1"], failures: [] }
    })
    const p = { filter, scopeChanged: true, onClose() {}, onSaved() { saves++ } }
    h.invoke(h.dialog, p)
    await settle()
    let tree = h.invoke(h.dialog, p)
    selector(tree).props.onChange({ target: { value: "7" } })
    tree = h.invoke(h.dialog, p)
    const saving = submitTree(tree)
    tree = h.invoke(h.dialog, p)
    assert.equal(selector(tree).props.disabled, true)
    selector(tree).props.onChange({ target: { value: "8" } })
    assert.equal(h.updates.length, 1)
    assert.equal(h.updates[0].data.get("mode"), "self")
    assert.equal(h.updates[0].data.has("includeUnexpectedClosed"), false)
    assert.deepEqual(JSON.parse(h.updates[0].data.get("changes")), [{ issueId: "1", impactScope: ["7"] }])
    waiting.resolve()
    await saving
    await settle()
    tree = h.invoke(h.dialog, p)
    assert.equal(saves, 1)
    assert.equal(h.calls.length, 2)
    assert.ok(h.calls.every(({ url }) => filterQuery(url) === "includeUnexpectedClosed=1"))
    assert.match(markup(tree), /目前沒有待補資料/)
    assert.match(markup(tree), /保留開啟時的範圍/)
    assert.equal(h.listeners.has("beforeunload"), false)
    h.unmount()
  })
})

describe("Impact Scope guarded details", () => {
  for (const [status, color] of [
    ["In Progress", "text-blue-600 dark:text-blue-300"],
    ["In Review", "text-blue-600 dark:text-blue-300"],
    ["Done", "text-green-600 dark:text-green-400"],
    ["To Do", "text-slate-600 dark:text-slate-300"],
    ["Unknown status", "text-slate-600 dark:text-slate-300"],
    [null, "text-slate-600 dark:text-slate-300"],
  ]) it(`applies the shared ${status ?? "unavailable"} status color on desktop and mobile`, async () => {
    const result = page([1], 1, null, false)
    result.data.issues[0].statusName = status
    const h = harness(async () => response(result))
    const props = { filter: self, onClose() {}, onSaved() {} }
    h.invoke(h.dialog, props)
    await settle()
    const tree = h.invoke(h.dialog, props)
    const text = status ?? "—"
    const desktop = nodes(tree).find((node) => node.type === "td" && node.props.children === text)
    const mobile = nodes(tree).find((node) => node.type === "span" && node.props.children === text)
    assert.equal(desktop.props.className, `break-words px-3 py-3 ${color}`)
    assert.equal(mobile.props.className, color)
    h.unmount()
  })
  it("shows a neutral Status placeholder when Jira has no status name", async () => {
    const result = page([1], 1, null, false)
    result.data.issues[0].statusName = null
    const h = harness(async () => response(result))
    const props = { filter: self, onClose() {}, onSaved() {} }
    h.invoke(h.dialog, props)
    await settle()
    const html = markup(h.invoke(h.dialog, props))
    assert.match(html, /Status<\/th>/)
    assert.match(html, /Status：<span[^>]*>—<\/span>/)
    assert.match(html, /<td[^>]*>—<\/td>/)
    h.unmount()
  })
  for (const filter of [self, person]) it(`loads all pages with responsive scoped rows for ${filter.mode}`, async () => {
    const second = deferred()
    const readOnly = filter.mode !== "self"
    const h = harness(async (url) => new URL(url, "https://fixture.invalid").searchParams.has("pageToken") ? second.promise : response(page([1], 1, "next", readOnly)))
    const props = { filter, scopeChanged: true, onClose() {}, onSaved() {} }
    let tree = h.invoke(h.dialog, props)
    await settle()
    assert.match(markup(h.invoke(h.dialog, props)), /正在載入/)
    second.resolve(response(page([2], 2, null, readOnly)))
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
    assert.match(html, /Impact Scope<\/th>/)
    assert.match(html, /Status<\/th>/)
    assert.match(html, /Status：<span[^>]*>To Do<\/span>/)
    assert.ok(html.indexOf("Summary</th>") < html.indexOf("Status</th>"))
    assert.ok(html.indexOf("Status</th>") < html.indexOf("Impact Scope</th>"))
    assert.match(html, /<td[^>]*>To Do<\/td>/)
    assert.doesNotMatch(html, /Root Cause|Solution|Defect Cause/)
    assert.equal(html.includes("<select"), !readOnly)
    assert.equal(html.includes("確認儲存"), !readOnly)
    assert.equal(h.calls.length, 2)
    assert.ok(h.calls.every((call) => call.init.cache === "no-store" && new URL(call.url, "https://fixture.invalid").searchParams.get("kind") === "impact-scope"))
    h.unmount()
    assert.ok(h.calls.every((call) => call.init.signal.aborted))
  })
  it("does not show partial rows on later-page failure and supports retry/reauthorization", async () => {
    let failed = true
    const h = harness(async (url) => response(failed && new URL(url, "https://fixture.invalid").searchParams.has("pageToken") ? { status: "error", error: { code: "forbidden", message: "Fixture denied" } } : page([1], 1, failed ? "next" : null)))
    const props = { filter: person, scopeChanged: false, onClose() {}, onSaved() {} }
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
  it("rejects editable detail responses in nonself mode", async () => {
    const h = harness(async () => response(page([1], 1, null, false)))
    const props = { filter: person, scopeChanged: false, onClose() {}, onSaved() {} }
    h.invoke(h.dialog, props)
    await settle()
    const html = markup(h.invoke(h.dialog, props))
    assert.match(html, /無法載入完整明細/)
    assert.doesNotMatch(html, /SUN-1/)
    h.unmount()
  })
  it("renders a complete empty list without implying loading or failure", async () => {
    const h = harness(async () => response(page([])))
    const props = { filter: self, scopeChanged: false, onClose() {}, onSaved() {} }
    h.invoke(h.dialog, props)
    await settle()
    const html = markup(h.invoke(h.dialog, props))
    assert.match(html, /目前沒有待補資料/)
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
    const props = { filter: self, scopeChanged: false, onClose() {}, onSaved() {} }
    h.invoke(h.dialog, props)
    await settle()
    h.unmount()
    assert.equal(h.calls[0].init.signal.aborted, true)
    waiting.resolve(response(page([1], 1, null, false)))
    await settle()
    assert.doesNotMatch(markup(h.invoke(h.dialog, props)), /SUN-1/)
  })
})

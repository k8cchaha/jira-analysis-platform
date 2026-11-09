import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, normalize } from "node:path"
import vm from "node:vm"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const compiled = new Map()
const plain = (value) => JSON.parse(JSON.stringify(value))
const PAGE = "app/(app)/analytics/projects/page.tsx"
const FILTER = "app/(app)/analytics/projects/projects-filter.tsx"
const SELECTOR = "app/(app)/sprint/burndown/sprint-selector.tsx"

function harness(today = "2026-10-21") {
  const modules = new Map()
  const pushes = []
  let transitionCount = 0
  let pending = false
  let activeHooks = null
  const hooksByComponent = new Map()
  const layoutEffects = []
  const effects = []
  const snapshot = { "ent-web": { status: "success", members: [{ accountId: "a", displayName: "Fixture member" }] } }
  const fail = (message) => { throw new Error(message) }
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [`${today}T12:00:00Z`])) }
  }
  const react = {
    ...require("react"),
    useState(initial) {
      if (!activeHooks) return [typeof initial === "function" ? initial() : initial, () => {}]
      const hooks = activeHooks
      const index = hooks.cursor++
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial
      return [hooks.values[index], (value) => {
        hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value
      }]
    },
    // Controlled optimistic lifecycle: retain intent during transitions, reconcile to
    // committed page props on completion. This is not a real browser concurrency test.
    useOptimistic(base) {
      if (!activeHooks) return [base, () => {}]
      const hooks = activeHooks
      const index = hooks.cursor++
      if (!pending) hooks.values[index] = undefined
      return [hooks.values[index] ?? base, (value) => { hooks.values[index] = value }]
    },
    useTransition: () => [pending, (callback) => { transitionCount++; pending = true; callback() }],
    useLayoutEffect: (effect) => { if (activeHooks) layoutEffects.push(effect) },
    useEffect: (effect) => { if (activeHooks) effects.push(effect) },
    useRef(current) {
      if (!activeHooks) return { current }
      const hooks = activeHooks
      const index = hooks.cursor++
      if (!(index in hooks.values)) hooks.values[index] = { current }
      return hooks.values[index]
    },
    useId: () => "fixture-team",
    useSyncExternalStore: (_subscribe, client, server) => activeHooks ? client() : server(),
  }
  const sandbox = vm.createContext({
    Date: FixedDate, URLSearchParams, Error,
    fetch: () => fail("Project filters must not request Planning or analytics data"),
  })
  const allowed = new Set([
    PAGE, FILTER, SELECTOR,
    ...["story-points", "members", "trends", "comparison"].map((feature) => `app/(app)/analytics/${feature}/page.tsx`),
    "components/coming-soon.tsx", "components/page-header.tsx",
    "components/team-select.tsx", "components/filter-dropdown.tsx", "components/project-selector.tsx", "components/date-range-field.tsx", "components/search-button.tsx",
    "lib/projects-filter.ts", "lib/burndown-params.ts", "lib/jira-sprint-data.ts", "lib/jira-jql.ts",
    "lib/jira-fields.ts", "lib/date-range.ts", "lib/jira-dashboard-filter.ts", "lib/jira-missing-data.ts",
  ])
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!allowed.has(path)) return fail(`Unexpected module: ${path}`)
    const mod = { exports: {} }
    modules.set(path, mod)
    if (!compiled.has(path)) {
      compiled.set(path, ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
        fileName: path,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText)
    }
    const fixtureRequire = (name) => {
      if (name === "react") return react
      if (name === "react/jsx-runtime") return require(name)
      if (name === "next/navigation") return { useRouter: () => ({ push: (href) => pushes.push(href) }) }
      if (name === "@/components/navigation-blocker") return { GuardedLink: ({ children, ...props }) => createElement("a", props, children) }
      if (name === "@/components/team-members-provider") return {
        useTeamMembers: () => ({ groupStates: snapshot, loadGroup: () => fail("Unexpected group load"), retryGroup: () => fail("Unexpected group retry") }),
      }
      const base = name.startsWith("@/") ? name.slice(2) : name.startsWith("./")
        ? normalize(`${dirname(path)}/${name}`) : fail(`Unexpected import: ${name}`)
      const resolved = [...allowed].find((file) => file === `${base}.ts` || file === `${base}.tsx`)
      return load(resolved ?? base)
    }
    vm.runInContext(`(function(require,module,exports){${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, mod, mod.exports)
    return mod.exports
  }
  function invoke(Component, props) {
    const hooks = hooksByComponent.get(Component) ?? { values: [], cursor: 0 }
    hooksByComponent.set(Component, hooks)
    hooks.cursor = 0
    activeHooks = hooks
    try { return Component(props) } finally {
      activeHooks = null
      while (layoutEffects.length) layoutEffects.shift()()
    }
  }
  return {
    load, invoke, pushes,
    setPending: (value) => { pending = value },
    flushEffects: () => { while (effects.length) effects.shift()() },
    get transitionCount() { return transitionCount },
    page: async (params = {}) => load(PAGE).default({ searchParams: Promise.resolve(params) }),
  }
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== "object" || !tree.props) return []
  return [tree, ...nodes(tree.props.children)]
}
function selectorOf(tree) { return nodes(tree).find((node) => node.type?.name === "ProjectSelector") }
function teamOf(tree) { return nodes(tree).find((node) => node.type?.name === "TeamSelect") }
function sprintDropdown(tree) { return nodes(tree).find((node) => node.props.id === "projects-sprints") }
function dateField(tree) { return nodes(tree).find((node) => node.type?.name === "DateRangeField") }
function modeRadio(tree, mode) { return nodes(tree).find((node) => node.type === "input" && node.props.type === "radio" && node.props.value === mode) }
function queryButton(tree) { return nodes(tree).find((node) => node.type?.name === "SearchButton") }
const sprintSelection = (project, selectedSprintIds = []) => ({ project, mode: "sprints", selectedSprintIds, error: null })
function checkbox(tree, name) {
  const label = nodes(sprintDropdown(tree)).find((node) => node.type === "label" && nodes(node).some((child) => child.type === "span" && child.props.children === name))
  return nodes(label).find((node) => node.type === "input")
}
function render(Component, props) { return renderToStaticMarkup(createElement(Component, props)) }

const selectionProps = async (h, params) => (await h.page(params)).props.filters.props

describe("project analysis all-Sprints parameters", () => {
  it("starts without a project, options or automatic Sprint selection", async () => {
    const h = harness()
    const tree = await h.page()
    assert.equal(tree.props.filters.type, h.load(FILTER).ProjectsFilter)
    assert.equal(tree.props.filters.key, null)
    assert.deepEqual(plain(tree.props.filters.props), { project: null, sprints: [], mode: "sprints", selectedSprintIds: [], error: null })
  })
  for (const project of ["SUN", "TKK", "PRIDE"]) {
    it(`${project} includes every configured historical/current/future Sprint, with none selected by default`, async () => {
      const h = harness()
      const props = await selectionProps(h, { project })
      assert.deepEqual(plain(props.sprints), plain(h.load("lib/jira-sprint-data.ts").getProjectSprints(project)))
      assert.deepEqual(plain(props.selectedSprintIds), [])
      assert.equal(props.error, null)
      assert.ok(props.sprints.some((sprint) => sprint.endDate < "2026-10-21"))
    })
  }
  it("is date independent and accepts ended Sprints", async () => {
    const h = harness("2027-02-01")
    const props = await selectionProps(h, { project: "TKK", sprint: "6619" })
    assert.ok(props.sprints.length > 0)
    assert.deepEqual(plain(props.selectedSprintIds), [6619])
    assert.equal(props.error, null)
  })
  it("accepts single-value legacy URLs and canonical repeated selections", async () => {
    const h = harness()
    assert.deepEqual(plain((await selectionProps(h, { project: "SUN", sprint: "6823" })).selectedSprintIds), [6823])
    const props = await selectionProps(h, { project: "SUN", sprint: ["7518", "6823", "7518"] })
    assert.deepEqual(plain(props.selectedSprintIds), [6823, 7518])
    const { projectsFilterHref } = h.load("lib/projects-filter.ts")
    assert.equal(projectsFilterHref(sprintSelection("SUN", [7518, 6823, 7518])), "/analytics/projects?project=SUN&sprint=6823&sprint=7518")
    assert.equal(projectsFilterHref(sprintSelection("SUN")), "/analytics/projects?project=SUN")
  })
  it("rejects malformed, foreign, unknown or incomplete scope instead of dropping clauses", async () => {
    const h = harness()
    for (const params of [
      { project: "sun" }, { project: "UNKNOWN" }, { project: ["SUN", "TKK"] }, { sprint: "6823" },
      { project: "SUN", sprint: "0" }, { project: "SUN", sprint: "999999" },
      { project: "SUN", sprint: ["6823", "7401"] }, { project: "SUN", sprint: ["6823", "invalid"] },
      { project: "SUN", sprint: "9007199254740992" }, { project: "SUN", sprint: "1 OR 1=1" },
      { project: "SUN", unknown: "1" }, { project: "SUN", sprint: Array(129).fill("6823") },
      { project: "SUN", sprint: "1".repeat(16_385) },
    ]) {
      const props = await selectionProps(h, params)
      assert.match(props.error, /篩選條件無效/)
      assert.deepEqual(plain(props.selectedSprintIds), [])
    }
    const { projectsFilterHref } = h.load("lib/projects-filter.ts")
    for (const [project, ids] of [["UNKNOWN", []], ["SUN", [7401]], ["SUN", [0]], ["SUN", [NaN]], ["SUN", Array(129).fill(6823)]]) {
      assert.throws(() => projectsFilterHref(sprintSelection(project, ids)), /篩選條件無效/)
    }
  })
})

describe("project exclusive interval parameters", () => {
  it("round trips dates with inclusive bounds and omits inactive Sprint parameters", async () => {
    const h = harness()
    const range = { from: "2026-10-01", to: "2026-10-21" }
    const selection = { project: "SUN", mode: "dates", dateRange: range, error: null }
    const { projectsFilterHref, projectsFilterResult } = h.load("lib/projects-filter.ts")
    const href = projectsFilterHref(selection)
    assert.equal(href, "/analytics/projects?project=SUN&mode=dates&from=2026-10-01&to=2026-10-21")
    const parsed = projectsFilterResult(Object.fromEntries(new URLSearchParams(href.split("?")[1])))
    assert.deepEqual(plain(parsed.dateRange), range)
    assert.equal(parsed.mode, "dates")
    assert.equal(parsed.error, null)
    assert.equal("selectedSprintIds" in parsed, false)
    assert.equal(projectsFilterHref(projectsFilterResult({ project: "SUN", mode: "sprints", sprint: "6823" })), "/analytics/projects?project=SUN&sprint=6823")
    assert.equal(projectsFilterResult({ project: "SUN", mode: "dates", from: "2024-02-29", to: "2024-02-29" }).error, null)
  })
  for (const params of [
    { mode: "unknown" }, { mode: ["dates", "sprints"] }, { mode: ["dates"] },
    { from: "2026-10-01", to: "2026-10-21" },
    { mode: "sprints", from: "2026-10-01", to: "2026-10-21" },
    { mode: "dates", from: "2026-10-01", to: "2026-10-21", sprint: "6823" },
    { mode: "dates" }, { mode: "dates", from: "2026-10-01" }, { mode: "dates", to: "2026-10-21" },
    { mode: "dates", from: ["2026-10-01"], to: "2026-10-21" },
    { mode: "dates", from: "2026-10-01", to: ["2026-10-21", "2026-10-22"] },
    { mode: "dates", from: "2026-02-29", to: "2026-10-21" },
    { mode: "dates", from: "2026-10-22", to: "2026-10-21" },
    { mode: "dates", from: "2026-10-1", to: "2026-10-21" },
    { mode: "dates", from: "2000-01-01", to: "2026-10-21" },
    { mode: "dates", from: "1".repeat(16_385), to: "2026-10-21" },
  ]) {
    it(`rejects invalid or mixed interval ${JSON.stringify(params).slice(0, 180)}`, async () => {
      const props = await selectionProps(harness(), { project: "SUN", ...params })
      assert.equal(props.project, "SUN")
      assert.match(props.error, /篩選條件無效/)
      if (props.mode === "dates") assert.equal(props.dateRange, null)
      else assert.deepEqual(plain(props.selectedSprintIds), [])
    })
  }
  it("requires a project for dates and rejects malformed serializer selections", async () => {
    const h = harness()
    assert.match((await selectionProps(h, { mode: "dates", from: "2026-10-01", to: "2026-10-21" })).error, /篩選條件無效/)
    const { projectsFilterHref } = h.load("lib/projects-filter.ts")
    const dates = { project: "SUN", mode: "dates", dateRange: { from: "2026-10-01", to: "2026-10-21" }, error: null }
    for (const selection of [
      { ...dates, selectedSprintIds: [] }, { ...dates, mode: "unknown" }, { ...dates, dateRange: null },
      { ...dates, project: null }, { ...dates, error: "invalid" },
      { ...dates, dateRange: { from: "2026-02-30", to: "2026-10-21" } },
      { ...sprintSelection("SUN"), dateRange: dates.dateRange },
    ]) assert.throws(() => projectsFilterHref(selection), /篩選條件無效/)
  })
})

describe("project exclusive interval UI", () => {
  for (const [params, enabled] of [
    [{}, false], [{ project: "SUN" }, false],
    [{ project: "SUN", sprint: "6823" }, true],
    [{ project: "SUN", sprint: ["6823", "7518"] }, true],
    [{ project: "SUN", sprint: "7401" }, false],
    [{ project: "SUN", mode: "dates", from: "2026-10-01", to: "2026-10-21" }, true],
    [{ project: "SUN", mode: "dates", from: "2026-10-21", to: "2026-10-21" }, true],
    [{ project: "SUN", mode: "dates", from: "invalid", to: "2026-10-21" }, false],
    [{ project: "SUN", mode: "dates", from: "2026-10-22", to: "2026-10-21" }, false],
    [{ project: "SUN", mode: "dates", from: "2000-01-01", to: "2026-10-21" }, false],
  ]) it(`places the shared Query action at the right with enabled=${enabled} for ${JSON.stringify(params)}`, async () => {
    const h = harness()
    const props = await selectionProps(h, params)
    const { SearchButton } = h.load("components/search-button.tsx")
    const tree = h.invoke(h.load(FILTER).ProjectsFilter, props)
    assert.equal(tree.type, "form")
    const interval = tree.props.children[1]
    assert.equal(interval.type, "fieldset")
    assert.equal(interval.props.disabled, props.project === null)
    const row = interval.props.children[1]
    assert.match(row.props.className, /\bflex\b/)
    assert.match(row.props.className, /\bflex-wrap\b/)
    assert.match(row.props.className, /\bmin-w-0\b/)
    assert.ok(nodes(row.props.children[0]).includes(sprintDropdown(tree)))
    assert.ok(nodes(row.props.children[1]).includes(modeRadio(tree, "dates")))
    const action = row.props.children[2]
    assert.match(action.props.className, /\bml-auto\b/)
    assert.match(action.props.className, /\bmax-w-full\b/)
    assert.match(action.props.className, /\bmin-w-0\b/)
    assert.match(action.props.className, /\bpt-5\b/, "align with controls below their headings")
    assert.equal(action.props.children.type, SearchButton)
    assert.equal(nodes(tree).filter((node) => node.type === SearchButton).length, 1)
    assert.equal(action.props.children.props.disabled, !enabled)
    assert.equal(action.props.children.props.className, undefined)
    assert.equal(action.props.children.props.style, undefined)
    for (const panel of nodes(interval).filter((node) => "inert" in node.props)) {
      assert.equal(nodes(panel).some((node) => node.type === SearchButton), false)
    }
    const helpId = action.props.children.props["aria-describedby"]
    assert.match(nodes(tree).find((node) => node.props.id === helpId).props.children, /尚未開放/)
    const button = h.invoke(SearchButton, action.props.children.props)
    assert.equal(button.props.type, "submit")
    assert.equal(button.props.disabled, !enabled)
    assert.equal(button.props.children, "查詢")
    assert.match(button.props.className, /\bw-24\b/)
    assert.match(button.props.className, /\bmax-w-full\b/)
    assert.match(button.props.className, /\bmin-w-0\b/)
    let prevented = false
    tree.props.onSubmit({ preventDefault() { prevented = true } })
    assert.equal(prevented, true, "prevent Enter/native submission from navigating the placeholder form")
    assert.deepEqual(h.pushes, [])
    assert.equal(h.transitionCount, 0)
    const markup = renderToStaticMarkup(createElement("div", null, tree))
    assert.equal((markup.match(/>查詢<\/button>/g) ?? []).length, 1)
    const submitMarkup = markup.match(/<button[^>]*type="submit"[^>]*>查詢<\/button>/)?.[0]
    assert.ok(submitMarkup)
    assert.equal(submitMarkup.includes('disabled=""'), !enabled)
    assert.match(markup, /id="projects-query-help"/)
    const submitted = h.invoke(h.load(FILTER).ProjectsFilter, props)
    assert.equal(nodes(submitted).some((node) => node.props.role === "status" && /篩選條件已就緒/.test(node.props.children)), enabled)
  })
  it("recomputes Query readiness from the active mode across checkbox, project and history changes", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    let props = await selectionProps(h, { project: "SUN" })
    let tree = h.invoke(ProjectsFilter, props)
    assert.equal(queryButton(tree).props.disabled, true, "valid inactive dates do not satisfy Sprints mode")
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: true } })
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(queryButton(tree).props.disabled, false)
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: false } })
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(queryButton(tree).props.disabled, true)
    modeRadio(tree, "dates").props.onChange()
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(queryButton(tree).props.disabled, false, "default month range enables dates without Sprint selection")
    modeRadio(tree, "sprints").props.onChange()
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(queryButton(tree).props.disabled, true)
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: true } })
    tree = h.invoke(ProjectsFilter, props)
    const staleSubmit = tree.props.onSubmit
    selectorOf(tree).props.onProjectChange("TKK")
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(queryButton(tree).props.disabled, true, "project changes clear checked Sprints")
    staleSubmit({ preventDefault() {} })
    assert.equal(nodes(h.invoke(ProjectsFilter, props)).some((node) => node.props.role === "status" && /篩選條件已就緒/.test(node.props.children)), false)
    h.setPending(false)
    for (const [params, disabled] of [
      [{ project: "SUN", sprint: "6823" }, false],
      [{ project: "SUN" }, true],
      [{ project: "SUN", mode: "dates", from: "2026-10-01", to: "2026-10-21" }, false],
      [{}, true],
    ]) {
      props = await selectionProps(h, params)
      tree = h.invoke(ProjectsFilter, props)
      assert.equal(queryButton(tree).props.disabled, disabled)
    }
  })
  it("validates date drafts and clears submitted placeholder feedback when the interval changes", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, { project: "SUN", mode: "dates", from: "2026-10-01", to: "2026-10-21" })
    let tree = h.invoke(ProjectsFilter, props)
    const notice = (tree) => nodes(tree).some((node) => node.props.role === "status" && /篩選條件已就緒/.test(node.props.children))
    const submit = tree.props.onSubmit
    dateField(tree).props.onChange({ from: "2026-09-01", to: "2026-09-30" })
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(queryButton(tree).props.disabled, false)
    submit({ preventDefault() {} })
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(notice(tree), true)
    dateField(tree).props.onChange({ from: "2026-09-02", to: "2026-09-30" })
    assert.equal(notice(h.invoke(ProjectsFilter, props)), false)
    assert.deepEqual(h.pushes, [], "readiness and placeholder submit do not query or navigate")
    for (const dateRange of [null, { from: "", to: "" }, { from: "2026-02-30", to: "2026-10-21" }, { from: "2026-10-22", to: "2026-10-21" }]) {
      const fresh = harness()
      const invalid = { ...props, dateRange }
      const rendered = fresh.invoke(fresh.load(FILTER).ProjectsFilter, invalid)
      assert.equal(queryButton(rendered).props.disabled, true)
      rendered.props.onSubmit({ preventDefault() {} })
      assert.equal(notice(fresh.invoke(fresh.load(FILTER).ProjectsFilter, invalid)), false)
      assert.deepEqual(fresh.pushes, [])
    }
  })
  it("places named radios directly beside their controls without duplicate visible headings or nested interactive labels", async () => {
    for (const mode of ["sprints", "dates"]) {
      const h = harness()
      const props = await selectionProps(h, mode === "sprints"
        ? { project: "SUN" }
        : { project: "SUN", mode: "dates", from: "2026-10-01", to: "2026-10-21" })
      const tree = h.invoke(h.load(FILTER).ProjectsFilter, props)
      for (const [value, name, control] of [
        ["sprints", "Sprints", sprintDropdown(tree)],
        ["dates", "分析區間", dateField(tree)],
      ]) {
        const radio = modeRadio(tree, value)
        const block = nodes(tree).find((node) => node.props.children?.[0] === radio)
        assert.equal(block.type, "div")
        assert.match(block.props.className, /\bflex\b/)
        assert.match(block.props.className, /\bmin-w-0\b/)
        assert.match(radio.props.className, /\bshrink-0\b/)
        assert.equal(radio.props["aria-label"], name)
        assert.notEqual(radio.props.disabled, true, "inactive radios must remain operable")
        assert.equal(radio.props.checked, value === mode)
        const panel = block.props.children[1]
        assert.equal(panel.props.inert, value !== mode)
        assert.ok(nodes(panel).includes(control))
        assert.match(panel.props.className, /\bmin-w-0\b/)
        assert.equal(nodes(tree).some((node) => ["label", "button"].includes(node.type) && nodes(node).includes(radio)), false)
      }
      // Render the initialized client tree, including the real controls' headings.
      const markup = renderToStaticMarkup(createElement("div", null, tree))
      assert.equal((markup.match(/>Sprints</g) ?? []).length, 1)
      assert.equal((markup.match(/>分析區間</g) ?? []).length, 1)
      assert.deepEqual(h.pushes, [])
    }
  })
  it("uses two native same-name radios outside their inactive inert panels without initializing navigation", async () => {
    const h = harness()
    const props = await selectionProps(h, { project: "SUN", sprint: "6823" })
    const tree = h.invoke(h.load(FILTER).ProjectsFilter, props)
    const sprintRadio = modeRadio(tree, "sprints")
    const datesRadio = modeRadio(tree, "dates")
    assert.equal(sprintRadio.props.name, datesRadio.props.name)
    assert.equal(sprintRadio.props.checked, true)
    assert.equal(datesRadio.props.checked, false)
    const panels = nodes(tree.props.children[1]).filter((node) => "inert" in node.props)
    assert.equal(panels.length, 2)
    assert.equal(panels[0].props.inert, false)
    assert.equal(panels[1].props.inert, true)
    assert.equal(panels[1].props["aria-disabled"], true)
    assert.equal(panels.flatMap(nodes).some((node) => node.props.type === "radio"), false)
    assert.deepEqual(plain(dateField(tree).props.value), { from: "2026-09-22", to: "2026-10-21" })
    const field = dateField(tree)
    const fieldTree = h.invoke(field.type, field.props)
    h.flushEffects()
    assert.deepEqual(h.pushes, [])
    const shortcutGroup = nodes(fieldTree).find((node) => node.props["aria-label"] === "時間區間快捷鍵")
    const shortcutButtons = nodes(shortcutGroup).filter((node) => node.type === "button")
    assert.deepEqual(shortcutButtons.map((node) => node.props.children), ["近1月", "近2月", "近3月", "近6月"])
    assert.deepEqual(shortcutButtons.map((node) => node.props["aria-pressed"]), [true, false, false, false])
    dateField(tree).props.onCommit({ from: "2026-09-01", to: "2026-10-01" })
    dateField(tree).props.onChange({ from: "2026-09-01", to: "2026-10-01" })
    assert.deepEqual(h.pushes, [])
  })
  it("applies each month shortcut through the existing date commit and exclusive URL", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, { project: "SUN", mode: "dates", from: "2026-10-01", to: "2026-10-21" })
    const expected = [
      ["近1月", "2026-09-22"], ["近2月", "2026-08-22"],
      ["近3月", "2026-07-22"], ["近6月", "2026-04-22"],
    ]
    for (const [label, from] of expected) {
      const field = dateField(h.invoke(ProjectsFilter, props))
      const tree = h.invoke(field.type, field.props)
      h.flushEffects()
      const button = nodes(tree).find((node) => node.type === "button" && node.props.children === label)
      button.props.onClick()
      assert.equal(h.pushes.at(-1), `/analytics/projects?project=SUN&mode=dates&from=${from}&to=2026-10-21`)
      const updated = dateField(h.invoke(ProjectsFilter, props))
      assert.deepEqual(plain(updated.props.value), { from, to: "2026-10-21" })
    }
    assert.equal(h.pushes.length, 4)
  })
  it("closes Sprint panel, restores inactive drafts and handles rapid mode/date/project events", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, { project: "SUN", sprint: "6823" })
    let tree = h.invoke(ProjectsFilter, props)
    sprintDropdown(tree).props.onOpenChange(true)
    tree = h.invoke(ProjectsFilter, props)
    const oldTree = tree
    modeRadio(tree, "dates").props.onChange()
    checkbox(oldTree, "Sprint 71").props.onChange({ target: { checked: true } })
    sprintDropdown(oldTree).props.onOpenChange(true)
    assert.equal(h.pushes.length, 1)
    assert.equal(h.pushes[0], "/analytics/projects?project=SUN&mode=dates&from=2026-09-22&to=2026-10-21")
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(sprintDropdown(tree).props.open, false)
    assert.equal(modeRadio(tree, "sprints").props.checked, false)
    assert.equal(modeRadio(tree, "dates").props.checked, true)
    assert.notEqual(dateField(tree).key, dateField(oldTree).key)
    const selectedRange = { from: "2026-09-01", to: "2026-09-30" }
    dateField(tree).props.onChange(selectedRange)
    assert.equal(h.pushes.length, 1)
    dateField(tree).props.onCommit(selectedRange)
    dateField(tree).props.onCommit(selectedRange)
    assert.equal(h.pushes.length, 2)
    // No render between mode switches: the latest intent and drafts must win.
    modeRadio(tree, "sprints").props.onChange()
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=SUN&sprint=6823")
    dateField(tree).props.onCommit({ from: "2026-01-01", to: "2026-01-31" })
    assert.equal(h.pushes.length, 3)
    modeRadio(oldTree, "dates").props.onChange()
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=SUN&mode=dates&from=2026-09-01&to=2026-09-30")
    selectorOf(tree).props.onProjectChange("TKK")
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=TKK&mode=dates&from=2026-09-01&to=2026-09-30")
    modeRadio(tree, "sprints").props.onChange()
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=TKK")
  })
  it("preserves an uncommitted date draft across a project change and ignores callbacks from the old calendar", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, { project: "SUN", mode: "dates", from: "2026-09-01", to: "2026-09-30" })
    const tree = h.invoke(ProjectsFilter, props)
    const range = { from: "2026-10-01", to: "2026-10-21" }
    dateField(tree).props.onChange(range)
    selectorOf(tree).props.onProjectChange("TKK")
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=TKK&mode=dates&from=2026-10-01&to=2026-10-21")
    dateField(tree).props.onCommit({ from: "2026-08-01", to: "2026-08-31" })
    assert.equal(h.pushes.length, 1)
    const next = h.invoke(ProjectsFilter, props)
    assert.notEqual(dateField(tree).key, dateField(next).key)
    modeRadio(next, "sprints").props.onChange()
    modeRadio(next, "dates").props.onChange()
    dateField(next).props.onChange({ from: "2026-01-01", to: "2026-01-31" })
    dateField(next).props.onCommit({ from: "2026-01-01", to: "2026-01-31" })
    assert.equal(h.pushes.length, 3)
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=TKK&mode=dates&from=2026-10-01&to=2026-10-21")
  })
  it("restores active date history, preserves Team and does not revive previous date edits", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const params = { project: "SUN", mode: "dates", from: "2026-09-01", to: "2026-09-30" }
    let props = await selectionProps(h, params)
    let tree = h.invoke(ProjectsFilter, props)
    teamOf(tree).props.onGroupsChange(["ent-web"])
    dateField(tree).props.onChange({ from: "2026-10-01", to: "2026-10-21" })
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(dateField(tree).props.value.from, "2026-10-01")
    dateField(tree).props.onCommit({ from: "2026-10-01", to: "2026-10-21" })
    h.setPending(false)
    props = await selectionProps(h, params)
    tree = h.invoke(ProjectsFilter, props)
    assert.deepEqual(plain(dateField(tree).props.value), { from: "2026-09-01", to: "2026-09-30" })
    assert.deepEqual(plain(teamOf(tree).props.groups), ["ent-web"])
    assert.equal(modeRadio(tree, "dates").props.checked, true)
    modeRadio(tree, "sprints").props.onChange()
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=SUN")
    modeRadio(tree, "dates").props.onChange()
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=SUN&mode=dates&from=2026-09-01&to=2026-09-30")
  })
  it("disables every non-project filter before selection and ignores their callbacks without changing drafts", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h)
    let tree = h.invoke(ProjectsFilter, props)
    const assertDisabled = (tree) => {
      const projectWrapper = tree.props.children[0].props.children[0]
      assert.notEqual(projectWrapper.props.inert, true)
      const teamWrapper = tree.props.children[0].props.children[1]
      assert.equal(teamWrapper.props.inert, true)
      assert.equal(teamWrapper.props["aria-disabled"], true)
      assert.match(teamWrapper.props.className, /opacity-50/)
      const intervals = tree.props.children[1]
      assert.equal(intervals.props.disabled, true)
      for (const mode of ["sprints", "dates"]) assert.equal(modeRadio(tree, mode).props.disabled, true)
      const panels = nodes(intervals).filter((node) => "inert" in node.props)
      assert.equal(panels.length, 2)
      for (const panel of panels) {
        assert.equal(panel.props.inert, true)
        assert.equal(panel.props["aria-disabled"], true)
        assert.match(panel.props.className, /opacity-50/)
      }
      assert.equal(sprintDropdown(tree).props.open, false)
    }
    assertDisabled(tree)
    const markup = render(ProjectsFilter, props)
    assert.match(markup, /<fieldset disabled="" aria-disabled="true"/)
    assert.match(markup, /請先選擇專案/)
    const seeded = plain(dateField(tree).props.value)
    const teamKey = teamOf(tree).key
    modeRadio(tree, "dates").props.onChange()
    modeRadio(tree, "sprints").props.onChange()
    sprintDropdown(tree).props.onOpenChange(true)
    teamOf(tree).props.onGroupsChange(["ent-web"])
    const range = { from: "2026-10-01", to: "2026-10-10" }
    dateField(tree).props.onChange(range)
    dateField(tree).props.onCommit(range)
    tree = h.invoke(ProjectsFilter, props)
    assertDisabled(tree)
    assert.equal(modeRadio(tree, "sprints").props.checked, true)
    assert.deepEqual(plain(teamOf(tree).props.groups), [])
    assert.deepEqual(plain(dateField(tree).props.value), seeded)
    assert.deepEqual(h.pushes, [])
    selectorOf(tree).props.onProjectChange("SUN")
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=SUN")
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(tree.props.children[0].props.children[1].props.inert, false)
    assert.notEqual(teamOf(tree).key, teamKey, "reset the disabled team's private dropdown on activation")
    assert.equal(tree.props.children[1].props.disabled, false)
    assert.equal(modeRadio(tree, "sprints").props.disabled, false)
    assert.equal(modeRadio(tree, "dates").props.disabled, false)
    teamOf(tree).props.onGroupsChange(["ent-web"])
    sprintDropdown(tree).props.onOpenChange(true)
    tree = h.invoke(ProjectsFilter, props)
    assert.deepEqual(plain(teamOf(tree).props.groups), ["ent-web"])
    assert.equal(sprintDropdown(tree).props.open, true)
    modeRadio(tree, "dates").props.onChange()
    tree = h.invoke(ProjectsFilter, props)
    dateField(tree).props.onCommit(range)
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=SUN&mode=dates&from=2026-10-01&to=2026-10-10")
  })
  it("disables filters again on no-project history and rejects stale mode, team, date and dropdown callbacks", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    let props = await selectionProps(h, { project: "SUN", mode: "dates", from: "2026-10-01", to: "2026-10-21" })
    let tree = h.invoke(ProjectsFilter, props)
    teamOf(tree).props.onGroupsChange(["ent-web"])
    tree = h.invoke(ProjectsFilter, props)
    const oldTree = tree
    props = await selectionProps(h)
    tree = h.invoke(ProjectsFilter, props)
    assert.notEqual(teamOf(tree).key, teamOf(oldTree).key)
    assert.notEqual(dateField(tree).key, dateField(oldTree).key)
    for (const candidate of [oldTree, tree]) {
      modeRadio(candidate, "dates").props.onChange()
      modeRadio(candidate, "sprints").props.onChange()
      teamOf(candidate).props.onGroupsChange(["ent-be1"])
      sprintDropdown(candidate).props.onOpenChange(true)
      dateField(candidate).props.onChange({ from: "2026-01-01", to: "2026-01-31" })
      dateField(candidate).props.onCommit({ from: "2026-01-01", to: "2026-01-31" })
    }
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(tree.props.children[1].props.disabled, true)
    assert.equal(tree.props.children[0].props.children[1].props.inert, true)
    assert.equal(modeRadio(tree, "sprints").props.checked, true)
    assert.equal(sprintDropdown(tree).props.open, false)
    assert.deepEqual(plain(teamOf(tree).props.groups), ["ent-web"])
    assert.deepEqual(plain(dateField(tree).props.value), { from: "2026-10-01", to: "2026-10-21" })
    assert.deepEqual(h.pushes, [])
  })
  it("does not mount an empty date field during SSR or auto-correct an invalid dates URL", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, { project: "SUN" })
    assert.match(render(ProjectsFilter, props), /正在準備分析區間/)
    const invalid = await selectionProps(h, { project: "SUN", mode: "dates", from: "invalid", to: "2026-10-21" })
    const tree = h.invoke(ProjectsFilter, invalid)
    assert.equal(modeRadio(tree, "dates").props.checked, true)
    assert.ok(nodes(tree).some((node) => node.props.role === "alert"))
    assert.deepEqual(h.pushes, [])
    dateField(tree).props.onCommit({ from: "2026-10-22", to: "2026-10-21" })
    dateField(tree).props.onCommit({ from: "2000-01-01", to: "2026-10-21" })
    assert.deepEqual(h.pushes, [])
    assert.doesNotThrow(() => render(ProjectsFilter, invalid))
  })
})

describe("project Sprints multi-selection and navigation", () => {
  it("preserves whole-team selection across same-page props and resets only on fresh instance", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    let props = await selectionProps(h, { project: "SUN" })
    let tree = h.invoke(ProjectsFilter, props)
    const team = teamOf(tree)
    assert.equal(team.props.perMember, false)
    team.props.onGroupsChange(["ent-web", "ent-be1"], ["a"], true)
    props = await selectionProps(h, { project: "TKK", sprint: "7403" })
    tree = h.invoke(ProjectsFilter, props)
    assert.deepEqual(plain(teamOf(tree).props.groups), ["ent-web", "ent-be1"])
    assert.deepEqual(h.pushes, [])
    const fresh = harness()
    assert.deepEqual(plain(teamOf(fresh.invoke(fresh.load(FILTER).ProjectsFilter, props)).props.groups), [])
  })
  it("keeps the dropdown open and preserves rapid add/add/remove intent before server props arrive", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, { project: "SUN" })
    let tree = h.invoke(ProjectsFilter, props)
    sprintDropdown(tree).props.onOpenChange(true)
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(sprintDropdown(tree).props.open, true)
    // Same rendered callbacks: no render or RSC update between these events.
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: true } })
    checkbox(tree, "Sprint 71").props.onChange({ target: { checked: true } })
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: false } })
    assert.deepEqual(h.pushes, [
      "/analytics/projects?project=SUN&sprint=6823",
      "/analytics/projects?project=SUN&sprint=6823&sprint=7518",
      "/analytics/projects?project=SUN&sprint=7518",
    ])
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(sprintDropdown(tree).props.open, true)
    assert.equal(checkbox(tree, "Sprint 58").props.checked, false)
    assert.equal(checkbox(tree, "Sprint 71").props.checked, true)
    const stale = await selectionProps(h, { project: "SUN", sprint: "6823" })
    assert.equal(checkbox(h.invoke(ProjectsFilter, stale), "Sprint 71").props.checked, true)
    const final = await selectionProps(h, { project: "SUN", sprint: "7518" })
    h.setPending(false)
    tree = h.invoke(ProjectsFilter, final)
    checkbox(tree, "Sprint 71").props.onChange({ target: { checked: false } })
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=SUN")
    assert.equal(sprintDropdown(h.invoke(ProjectsFilter, final)).props.value, "選擇 Sprints")
  })
  it("restores committed history props without reviving previous optimistic selections", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    let props = await selectionProps(h, { project: "SUN", sprint: ["6823", "7518"] })
    let tree = h.invoke(ProjectsFilter, props)
    assert.equal(checkbox(tree, "Sprint 58").props.checked, true)
    props = await selectionProps(h, { project: "SUN", sprint: "7518" })
    h.setPending(false)
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(checkbox(tree, "Sprint 58").props.checked, false)
    checkbox(tree, "Sprint 59").props.onChange({ target: { checked: true } })
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=SUN&sprint=6824&sprint=7518")
  })
  it("project changes clear Sprints and prevent old project checkbox events during transition", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, { project: "SUN", sprint: "7518" })
    const tree = h.invoke(ProjectsFilter, props)
    const selector = selectorOf(tree)
    const selectorTree = h.invoke(selector.type, selector.props)
    const projectButtons = nodes(selectorTree).filter((node) => node.props.role === "radio")
    projectButtons[0].props.onClick()
    assert.equal(h.pushes.length, 0)
    projectButtons[1].props.onClick()
    assert.equal(h.pushes[0], "/analytics/projects?project=TKK")
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: true } })
    assert.equal(h.pushes.length, 1)
    const pendingTree = h.invoke(ProjectsFilter, props)
    assert.equal(selectorOf(pendingTree).props.project, "TKK")
    assert.equal(sprintDropdown(pendingTree).props.open, false)
    assert.equal(nodes(sprintDropdown(pendingTree)).filter((node) => node.type === "input").length, 0)
    h.setPending(false)
    const nextProps = await selectionProps(h, { project: "TKK" })
    const committed = h.invoke(ProjectsFilter, nextProps)
    checkbox(committed, "S128").props.onChange({ target: { checked: true } })
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=TKK&sprint=6619")
  })
  it("marks only Project required, renders full native labels, and uses central bounded widths", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, { project: "SUN" })
    const markup = render(ProjectsFilter, props)
    const { FILTER_SELECT_WIDTH_CLASS } = h.load("components/filter-dropdown.tsx")
    assert.ok(markup.indexOf('id="projects-project-label"') < markup.indexOf('id="fixture-team-label"'))
    assert.ok(markup.indexOf('id="fixture-team-label"') < markup.indexOf('id="projects-sprints-label"'))
    const projectLabel = markup.match(/<span id="projects-project-label"[\s\S]*?<\/span><\/span>/)?.[0]
    assert.match(projectLabel, /aria-hidden="true"[^>]*>\*<\/span>/)
    assert.match(projectLabel, /sr-only[^>]*>（必選）/)
    assert.doesNotMatch(markup, /aria-required|展開 Web 成員|Fixture member/)
    assert.equal((markup.match(/type="submit"/g) ?? []).length, 1)
    assert.match(markup, /<button[^>]*type="submit"[^>]*disabled=""[^>]*>查詢<\/button>/)
    assert.equal((markup.match(/type="checkbox"/g) ?? []).length, props.sprints.length + h.load("lib/jira-dashboard-filter.ts").DASHBOARD_TEAMS.length)
    const tree = h.invoke(ProjectsFilter, props)
    const labels = nodes(sprintDropdown(tree)).filter((node) => node.type === "label")
    assert.equal(labels.length, props.sprints.length)
    assert.equal(labels[0].props.children[1].props.children, props.sprints.at(-1).name)
    for (const kind of ["project", "sprint", "team"]) assert.ok(markup.includes(`class="relative ${FILTER_SELECT_WIDTH_CLASS[kind]}"`))
    assert.match(markup, /class="truncate"/)
  })
  it("shows pending, no-project, no-options and invalid-scope states distinctly", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    let props = await selectionProps(h, {})
    assert.match(render(ProjectsFilter, props), /請先選擇專案/)
    assert.match(render(ProjectsFilter, { ...props, project: "SUN" }), /此專案暫無可檢視的 Sprints/)
    props = await selectionProps(h, { project: "SUN", sprint: "7401" })
    let tree = h.invoke(ProjectsFilter, props)
    assert.match(sprintDropdown(tree).props.value, /重新選擇/)
    assert.equal(tree.props.children[2].props.role, "alert")
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: true } })
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(tree.props.children[2], null)
    assert.equal(tree.props["aria-busy"], true)
    assert.equal(tree.props.children[3].props.role, "status")
  })
  it("leaves original single Sprint behavior intact for Planning, Burndown and Capacity", () => {
    const h = harness()
    const { SprintSelector } = h.load(SELECTOR)
    const sprints = h.load("lib/jira-sprint-data.ts").getProjectSprints("SUN")
    for (const basePath of ["/sprint/planning", "/sprint/burndown", "/sprint/capacity"]) {
      const paths = []
      const props = { basePath, project: "SUN", sprints, selectedSprintId: 7518, onNavigate: (path) => paths.push(path) }
      const tree = h.invoke(SprintSelector, props)
      const slot = tree.props.children[1].props.children
      const dropdown = slot.props.children[0]
      assert.equal(dropdown.props.label, "Sprint")
      assert.equal(dropdown.props.value, "Sprint 71")
      dropdown.props.onOpenChange(true)
      nodes(dropdown).find((node) => node.props.role === "option").props.onClick()
      assert.equal(paths[0], `${basePath}?project=SUN&sprint=7522`)
      assert.equal(h.invoke(SprintSelector, props).props.children[1].props.children.props.children[0].props.open, false)
      assert.doesNotMatch(render(SprintSelector, props), /（必選）|type="checkbox"/)
    }
  })
})

describe("analysis subtitles and ComingSoon slot regressions", () => {
  it("hides header subtitles on all placeholder analysis pages but preserves planned content", async () => {
    const h = harness()
    const pages = [await h.page(), ...["story-points", "members", "trends", "comparison"].map((feature) => h.load(`app/(app)/analytics/${feature}/page.tsx`).default())]
    for (const tree of pages) {
      const markup = renderToStaticMarkup(tree)
      const header = markup.match(/<header\b[^>]*>[\s\S]*?<\/header>/)[0]
      assert.equal((header.match(/<h1\b/g) ?? []).length, 1)
      assert.doesNotMatch(header, /<p\b/)
      assert.ok(markup.includes(tree.props.description))
    }
  })
  it("renders one header, then filters, then placeholder", async () => {
    const markup = renderToStaticMarkup(await harness().page())
    assert.equal((markup.match(/<h1\b/g) ?? []).length, 1)
    assert.ok(markup.indexOf("</header>") < markup.indexOf('id="projects-project-label"'))
    assert.ok(markup.indexOf('id="projects-project-label"') < markup.indexOf("<section"))
    assert.match(markup, /此功能正在準備中/)
  })
  it("preserves default subtitles and adds no filter container outside analytics", () => {
    const h = harness()
    const { ComingSoon } = h.load("components/coming-soon.tsx")
    const props = { title: "Other page", description: "Existing description" }
    const markup = render(ComingSoon, props)
    assert.equal(markup, render(ComingSoon, { ...props, filters: null }))
    assert.match(markup, /<\/header><section/)
    assert.match(markup.match(/<header\b[^>]*>[\s\S]*?<\/header>/)[0], /Existing description/)
    const hidden = render(ComingSoon, { ...props, showDescription: false })
    assert.doesNotMatch(hidden.match(/<header\b[^>]*>[\s\S]*?<\/header>/)[0], /Existing description/)
    assert.match(hidden, /Existing description/)
  })
})

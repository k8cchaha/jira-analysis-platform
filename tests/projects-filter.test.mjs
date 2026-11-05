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
    useEffect: () => {},
    useRef(current) {
      if (!activeHooks) return { current }
      const hooks = activeHooks
      const index = hooks.cursor++
      if (!(index in hooks.values)) hooks.values[index] = { current }
      return hooks.values[index]
    },
    useId: () => "fixture-team",
  }
  const sandbox = vm.createContext({
    Date: FixedDate, URLSearchParams, Error,
    fetch: () => fail("Project filters must not request Planning or analytics data"),
  })
  const allowed = new Set([
    PAGE, FILTER, SELECTOR,
    ...["story-points", "members", "trends", "comparison"].map((feature) => `app/(app)/analytics/${feature}/page.tsx`),
    "components/coming-soon.tsx", "components/page-header.tsx",
    "components/team-select.tsx", "components/filter-dropdown.tsx",
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
    get transitionCount() { return transitionCount },
    page: async (params = {}) => load(PAGE).default({ searchParams: Promise.resolve(params) }),
  }
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== "object" || !tree.props) return []
  return [tree, ...nodes(tree.props.children)]
}
function selectorOf(tree) { return tree.props.children[0] }
function sprintDropdown(tree) { return selectorOf(tree).props.sprintSlot.props.children[0] }
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
    assert.deepEqual(plain(tree.props.filters.props), { project: null, sprints: [], selectedSprintIds: [], error: null })
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
    assert.equal(projectsFilterHref("SUN", [7518, 6823, 7518]), "/analytics/projects?project=SUN&sprint=6823&sprint=7518")
    assert.equal(projectsFilterHref("SUN", []), "/analytics/projects?project=SUN")
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
      assert.throws(() => projectsFilterHref(project, ids), /篩選條件無效/)
    }
  })
})

describe("project Sprints multi-selection and navigation", () => {
  it("preserves whole-team selection across same-page props and resets only on fresh instance", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    let props = await selectionProps(h, { project: "SUN" })
    let tree = h.invoke(ProjectsFilter, props)
    const team = selectorOf(tree).props.teamSlot
    assert.equal(team.props.perMember, false)
    team.props.onGroupsChange(["ent-web", "ent-be1"], ["a"], true)
    props = await selectionProps(h, { project: "TKK", sprint: "7403" })
    tree = h.invoke(ProjectsFilter, props)
    assert.deepEqual(plain(selectorOf(tree).props.teamSlot.props.groups), ["ent-web", "ent-be1"])
    assert.deepEqual(h.pushes, [])
    const fresh = harness()
    assert.deepEqual(plain(selectorOf(fresh.invoke(fresh.load(FILTER).ProjectsFilter, props)).props.teamSlot.props.groups), [])
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
    assert.ok(markup.indexOf('id="sprint-project-label"') < markup.indexOf('id="projects-sprints-label"'))
    assert.ok(markup.indexOf('id="projects-sprints-label"') < markup.indexOf('id="fixture-team-label"'))
    const projectLabel = markup.match(/<span id="sprint-project-label"[\s\S]*?<\/span><\/span>/)?.[0]
    assert.match(projectLabel, /aria-hidden="true"[^>]*>\*<\/span>/)
    assert.match(projectLabel, /sr-only[^>]*>（必選）/)
    assert.doesNotMatch(markup, /aria-required|type="submit"|展開 Web 成員|Fixture member/)
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
    assert.equal(tree.props.children[1].props.role, "alert")
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: true } })
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(tree.props.children[1], null)
    assert.equal(tree.props["aria-busy"], true)
    assert.equal(tree.props.children[2].props.role, "status")
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
    assert.ok(markup.indexOf("</header>") < markup.indexOf('id="sprint-project-label"'))
    assert.ok(markup.indexOf('id="sprint-project-label"') < markup.indexOf("<section"))
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

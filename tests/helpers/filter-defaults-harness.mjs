import { readFileSync } from "node:fs"
import { dirname, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { strict as assert } from "node:assert"
import ts from "typescript"

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const pure = new Set([
  "lib/filter-defaults.ts", "lib/jira-jql.ts", "lib/jira-fields.ts", "lib/jira-dashboard-filter.ts",
  "lib/burndown-params.ts", "lib/jira-sprint-data.ts", "lib/projects-filter.ts",
  "lib/team-analysis-filter.ts", "lib/date-range.ts", "lib/workload-filter.ts", "lib/workload-heatmap.ts", "lib/projects-analysis.ts", "lib/planning-overview.ts", "lib/jira-missing-data.ts",
])
const clients = new Set([
  "components/filter-defaults-provider.tsx", "components/filter-defaults-navigation.tsx", "components/team-select.tsx",
  "app/(app)/dashboard/dashboard-filter.tsx", "app/(app)/analytics/workload/workload-filter.tsx",
  "app/(app)/analytics/projects/projects-filter.tsx", "app/(app)/analytics/projects/projects-query-client.tsx", "app/(app)/analytics/story-points/team-analysis-filter.tsx",
  "app/(app)/sprint/planning/planning-client.tsx", "app/(app)/sprint/burndown/burndown-client.tsx",
])
const inert = (name) => ({ [name]: Object.defineProperty(() => null, "name", { value: name }) })
export const plain = (value) => JSON.parse(JSON.stringify(value))
export function nodes(value) {
  if (!value || typeof value !== "object") return []
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value.props) return []
  return [value, ...Object.values(value.props).flatMap(nodes)]
}

/** Real defaults modules and consumers; only transport and unrelated child UI are stubbed. */
export function defaultsHarness({ path = "/sprint/planning", search = "", storage = new Map() } = {}) {
  const instances = new Map(), cache = new Map(), microtasks = []
  const listeners = { window: new Map(), document: new Map() }
  const replacements = [], pushes = [], requests = []
  const teamStates = {}
  let current, hookIndex, dirty, context = { defaults: { project: null, groups: [] }, ready: false, saveDefaults: async () => {} }
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const stateSlot = () => {
    const index = hookIndex++
    return [current.slots, index]
  }
  function memo(fn, deps) {
    const [slots, index] = stateSlot()
    if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { deps, value: fn() }
    return slots[index].value
  }
  function effect(fn, deps) {
    const [slots, index] = stateSlot()
    if (!slots[index] || !same(slots[index].deps, deps)) {
      const previous = slots[index]
      const next = { deps, cleanup: null }
      slots[index] = next
      current.effects.push(() => { previous?.cleanup?.(); next.cleanup = fn() })
    }
  }
  const react = {
    createContext: (value) => ({ Provider: function Provider() {}, value }),
    useContext: () => context,
    useState(initial) {
      const [slots, index] = stateSlot()
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial
      return [slots[index], (next) => { const value = typeof next === "function" ? next(slots[index]) : next; if (!Object.is(value, slots[index])) dirty = true; slots[index] = value }]
    },
    useRef(initial) { const [slots, index] = stateSlot(); return slots[index] ??= { current: initial } },
    useCallback: (fn, deps) => memo(() => fn, deps), useMemo: memo,
    useEffect: effect, useLayoutEffect: effect,
    useId: () => "fixture", useTransition: () => [false, (fn) => fn()],
    useOptimistic: (value) => [value, () => {}],
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }
  const target = (kind) => ({
    addEventListener(type, fn) { if (!listeners[kind].has(type)) listeners[kind].set(type, new Set()); listeners[kind].get(type).add(fn) },
    removeEventListener(type, fn) { listeners[kind].get(type)?.delete(fn) },
  })
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  const window = { ...target("window"), localStorage, location: { pathname: path, search } }
  const document = target("document")
  const stubs = {
    "./projects-analysis-view": inert("ProjectsAnalysisView"),
    "@/components/team-select": inert("TeamSelect"),
    "@/components/navigation-blocker": inert("GuardedLink"),
    "@/components/project-selector": inert("ProjectSelector"),
    "@/components/search-button": inert("SearchButton"),
    "@/components/date-range-field": { ...inert("DateRangeField"), useBrowserToday: () => "2026-11-12" },
    "@/components/filter-dropdown": { ...inert("FilterDropdown"), FILTER_SELECT_WIDTH_CLASS: { project: "w-40", team: "w-56", sprint: "w-56" } },
    "@/components/team-members-provider": { useTeamMembers: () => ({ groupStates: teamStates, loadGroup: async () => {}, retryGroup: async () => {} }) },
    "./actions": { reauthorizeDashboardAction: () => assert.fail("unexpected authorization request") },
    "@/app/(app)/sprint/burndown/sprint-selector": inert("SprintSelector"),
    "@/app/(app)/sprint/planning/assignment-status": inert("AssignmentStatus"),
    "@/app/(app)/sprint/planning/planning-overview": inert("PlanningOverview"),
    "@/app/(app)/dashboard/parent-issue-type-icon": inert("ParentIssueTypeIcon"),
    "@/components/edit-dialog": inert("EditDialog"), "@/components/ticket-link": inert("TicketLink"),
    "@/lib/planning-subset": { parsePlanningSubsetResult: () => assert.fail("unexpected planning request") },
    "@/lib/burndown-series": { computeBurndownSeries: () => [] },
    "@/app/(app)/sprint/burndown/burndown-chart": inert("BurndownChart"),
    "@/app/(app)/sprint/burndown/unestimated-button": inert("UnestimatedButton"),
    "@/app/(app)/sprint/burndown/day-tasks-dialog": inert("DayTasksDialog"),
    "@/app/(app)/sprint/burndown/development-status": inert("DevelopmentStatus"),
  }
  function load(path) {
    if (cache.has(path)) return cache.get(path)
    assert.ok(pure.has(path) || clients.has(path), `Unexpected module: ${path}`)
    const source = readFileSync(`${root}/${path}`, "utf8")
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
    const mod = { exports: {} }
    cache.set(path, mod.exports)
    const require = (name) => {
      if (name === "react") return react
      if (name === "react/jsx-runtime") return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: "Fragment" }
      if (name === "next/navigation") return { usePathname: () => window.location.pathname, useRouter: () => ({ replace: (...args) => replacements.push(args), push: (...args) => pushes.push(args) }) }
      if (name === "./projects-filter" && path.startsWith("app/")) return inert("ProjectsFilter")
      if (Object.hasOwn(stubs, name)) return stubs[name]
      const resolved = name.startsWith("@/") ? name.slice(2) : posix.normalize(`${posix.dirname(path)}/${name}`)
      const file = [resolved, `${resolved}.ts`, `${resolved}.tsx`].find((candidate) => pure.has(candidate) || clients.has(candidate))
      assert.ok(file, `Unexpected import: ${name} from ${path}`)
      return load(file)
    }
    runInNewContext(code, { require, module: mod, exports: mod.exports, URLSearchParams, Date, Set, Map, Object, Error, AbortController, window, document, localStorage, queueMicrotask: (fn) => microtasks.push(fn), fetch: (...args) => { requests.push(args); assert.fail("unexpected fetch") }, EventSource: function () { assert.fail("unexpected stream") } }, { filename: path })
    cache.set(path, mod.exports)
    return mod.exports
  }
  function draw(component, props = {}, key = component) {
    const instance = instances.get(key) ?? { slots: [], effects: [] }
    instances.set(key, instance)
    let tree, turns = 0
    do {
      assert.ok(++turns < 30, "render did not settle")
      current = instance; hookIndex = 0; dirty = false
      tree = component(props)
      if (tree?.type?.name === "Provider") context = tree.props.value
      const effects = instance.effects.splice(0)
      effects.forEach((fn) => fn())
    } while (dirty)
    return tree
  }
  function unmount(key) {
    const instance = instances.get(key)
    instance?.slots.forEach((slot) => slot?.cleanup?.())
    instances.delete(key)
  }
  return {
    load, draw, unmount, storage, localStorage, window, listeners, teamStates, replacements, pushes, requests,
    get context() { return context }, set context(value) { context = value },
    flush() { while (microtasks.length) microtasks.shift()() },
    emit(kind, type, event = {}) { listeners[kind].get(type)?.forEach((fn) => fn(event)) },
  }
}

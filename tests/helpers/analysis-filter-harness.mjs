import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, normalize } from "node:path"
import vm from "node:vm"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const compiled = new Map()
export const plain = (value) => JSON.parse(JSON.stringify(value))
export const PROJECT_PAGE = "app/(app)/analytics/projects/page.tsx"
export const PROJECT_FILTER = "app/(app)/analytics/projects/projects-filter.tsx"
export const TEAM_PAGE = "app/(app)/analytics/story-points/page.tsx"
export const TEAM_FILTER = "app/(app)/analytics/story-points/team-analysis-filter.tsx"
export const SELECTOR = "app/(app)/sprint/burndown/sprint-selector.tsx"

export function harness(today = "2026-10-21") {
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
    // Controlled optimistic lifecycle, not a real browser concurrency test.
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
    fetch: () => fail("Analysis filters must not request Planning or analytics data"),
  })
  const allowed = new Set([
    PROJECT_PAGE, PROJECT_FILTER, TEAM_PAGE, TEAM_FILTER, SELECTOR,
    "components/coming-soon.tsx", "components/page-header.tsx",
    "components/team-select.tsx", "components/filter-dropdown.tsx", "components/project-selector.tsx", "components/date-range-field.tsx", "components/search-button.tsx",
    "lib/projects-filter.ts", "lib/team-analysis-filter.ts", "lib/burndown-params.ts", "lib/jira-sprint-data.ts", "lib/jira-jql.ts",
    "lib/jira-fields.ts", "lib/date-range.ts", "lib/jira-dashboard-filter.ts", "lib/jira-missing-data.ts",
  ])
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!allowed.has(path)) return fail(`Unexpected module: ${path}`)
    const mod = { exports: {} }
    modules.set(path, mod)
    if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText)
    const fixtureRequire = (name) => {
      if (name === "react") return react
      if (name === "react/jsx-runtime") return require(name)
      if (name === "next/navigation") return { useRouter: () => ({ push: (href) => pushes.push(href) }) }
      if (name === "@/components/navigation-blocker") return { GuardedLink: ({ children, ...props }) => createElement("a", props, children) }
      if (name === "@/components/team-members-provider") return {
        useTeamMembers: () => ({ groupStates: snapshot, loadGroup: () => fail("Unexpected group load"), retryGroup: () => fail("Unexpected group retry") }),
      }
      const base = name.startsWith("@/") ? name.slice(2) : name.startsWith("./") ? normalize(`${dirname(path)}/${name}`) : fail(`Unexpected import: ${name}`)
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
    page: async (params = {}, path = PROJECT_PAGE) => load(path).default({ searchParams: Promise.resolve(params) }),
  }
}
export function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== "object" || !tree.props) return []
  return [tree, ...nodes(tree.props.children)]
}
export const selectorOf = (tree) => nodes(tree).find((node) => node.type?.name === "ProjectSelector")
export const teamOf = (tree) => nodes(tree).find((node) => node.type?.name === "TeamSelect")
export const sprintDropdown = (tree) => nodes(tree).find((node) => node.props.id === "projects-sprints")
export const dateField = (tree) => nodes(tree).find((node) => node.type?.name === "DateRangeField")
export const queryButton = (tree) => nodes(tree).find((node) => node.type?.name === "SearchButton")
export const readyNotice = (tree) => nodes(tree).some((node) => node.props.role === "status" && /篩選條件已就緒/.test(node.props.children))
export function checkbox(tree, name) {
  const label = nodes(sprintDropdown(tree)).find((node) => node.type === "label" && nodes(node).some((child) => child.type === "span" && child.props.children === name))
  return nodes(label).find((node) => node.type === "input")
}
export const render = (Component, props) => renderToStaticMarkup(createElement(Component, props))

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, normalize } from "node:path"
import vm from "node:vm"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
const require = createRequire(import.meta.url), ts = require("typescript"), compiled = new Map()
export const MODEL = "lib/projects-analysis.ts"
export const CLIENT = "app/(app)/analytics/projects/projects-query-client.tsx"
export const VIEW = "app/(app)/analytics/projects/projects-analysis-view.tsx"
export const CHART = "app/(app)/analytics/projects/projects-trend-chart.tsx"
export const GEOMETRY = "app/(app)/analytics/projects/projects-trend-geometry.ts"
export const plain = (value) => JSON.parse(JSON.stringify(value))
export function projectsHarness() {
  const modules = new Map(), components = new Map(), effects = [], requests = [], events = new Map()
  let active = null
  let nextId = 0
  const groupStates = {}
  const hooks = {
    ...require("react"),
    useId() {
      if (!active) return require("react").useId()
      return hooks.useState(() => `projects-fixture-${nextId++}`)[0]
    },
    useState(initial) {
      if (!active) return [typeof initial === "function" ? initial() : initial, () => {}]
      const state = active, index = state.cursor++
      if (!(index in state.values)) state.values[index] = typeof initial === "function" ? initial() : initial
      return [state.values[index], (next) => { state.values[index] = typeof next === "function" ? next(state.values[index]) : next }]
    },
    useRef(initial) {
      if (!active) return { current: initial }
      const state = active, index = state.cursor++
      if (!(index in state.values)) state.values[index] = { current: initial }
      return state.values[index]
    },
    useEffect(effect, dependencies) {
      if (!active) return
      const state = active, index = state.cursor++, previous = state.values[index]
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        state.values[index] = { dependencies, cleanup: previous?.cleanup }
        effects.push(() => { state.values[index].cleanup?.(); state.values[index].cleanup = effect() })
      }
    },
  }
  const sandbox = vm.createContext({ Date, Intl, URL, URLSearchParams, Error, AbortController, Response, console,
    window: { addEventListener(name, callback) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback) }, removeEventListener(name, callback) { events.get(name)?.delete(callback) } },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })) },
  })
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (path.endsWith(".css")) return {}
    if (!path.startsWith("lib/") && ![CLIENT, VIEW, CHART, GEOMETRY].includes(path)) throw new Error(`Unexpected module ${path}`)
    const loadedModule = { exports: {} }; modules.set(path, loadedModule)
    if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)
    const fixtureRequire = (name) => {
      if (name === "react") return hooks
      if (name === "react/jsx-runtime") return require(name)
      if (name === "@/components/filter-defaults-provider") return { useDefaultTeamGroups: () => hooks.useState([]) }
      if (name === "@/components/team-members-provider") return { useTeamMembers: () => ({ groupStates }) }
      if (name === "./projects-filter") return { ProjectsFilter: function ProjectsFilter(props) { return createElement("form", props) } }
      if (name === "@/components/ticket-link") return { TicketLink: ({ task, jiraBaseUrl }) => createElement("a", { href: `${jiraBaseUrl}/browse/${encodeURIComponent(task.key)}` }, task.key) }
      let base = name.startsWith("@/") ? name.slice(2) : name.startsWith(".") ? normalize(`${dirname(path)}/${name}`) : null
      if (!base) throw new Error(`Unexpected import ${name}`)
      if (!/\.(tsx?|css)$/.test(base)) base += [VIEW, CHART].some((path) => path === `${base}.tsx`) ? ".tsx" : ".ts"
      return load(base)
    }
    vm.runInContext(`(function(require,module,exports){${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  function invoke(Component, props) {
    const state = components.get(Component) ?? { values: [], cursor: 0 }
    components.set(Component, state); state.cursor = 0; active = state
    try { return Component(props) } finally { active = null }
  }
  return { load, invoke, requests, groupStates, flushEffects() { while (effects.length) effects.shift()() }, event(name) { for (const callback of events.get(name) ?? []) callback() }, unmount(Component) { const state = components.get(Component); for (const item of state?.values ?? []) item?.cleanup?.() }, render(Component, props) { return renderToStaticMarkup(createElement(Component, props)) } }
}
export function nodes(tree) { if (Array.isArray(tree)) return tree.flatMap(nodes); if (!tree?.props) return []; return [tree, ...nodes(tree.props.children)] }
export function task(id, overrides = {}) {
  return { id: String(id), key: `SUN-${id}`, summary: `Work ${id}`, parentId: "999", parentKey: "SUN-999", projectId: "100", projectKey: "SUN", issueType: "Dev-Task", devType: "Dev", points: 3, actualPoints: 2, resolvedDate: "2026-04-28", assigneeAccountId: null, assigneeDisplayName: null, statusName: "Done", sprintIds: [6823], ...overrides }
}
export function resultFixture(model, tasks = [], request = { project: "SUN", sprintIds: [6823], groups: [], browserTimeZone: "UTC" }, teamAttribution) {
  const startedAt = "2026-11-12T12:00:00Z"
  return model.parseProjectsAnalysisResult({ schemaVersion: 1, complete: true, historicalSnapshot: false, request, startedAt, generatedAt: startedAt, browserToday: "2026-11-12", jiraTimeZone: "Asia/Taipei", sourceIssueCount: tasks.length + new Set(tasks.map((task) => task.parentId)).size, sprints: model.resolveProjectsAnalysisSprints(request, new Date(startedAt)), tasks, ...(teamAttribution === undefined ? {} : { teamAttribution }), jiraBaseUrl: "https://jira.example.test" })
}

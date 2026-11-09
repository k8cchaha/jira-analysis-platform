import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const path = "app/(app)/sprint/burndown/burndown-client.tsx"
const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
  fileName: path,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

// Controlled hooks and base SSE event: verifies UI state without real browser/network I/O.
function harness() {
  const slots = []
  let cursor = 0
  const effects = []
  const streams = []
  const queries = []
  const pushes = []
  const react = {
    ...require("react"),
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next }]
    },
    useMemo: (compute) => compute(),
    useTransition: () => [false, (callback) => callback()],
    useEffect: (effect) => effects.push(effect),
  }
  class FixtureEventSource {
    listeners = new Map()
    constructor(url) { this.url = url; streams.push(this) }
    addEventListener(name, callback) { this.listeners.set(name, callback) }
    close() {}
    emit(name, payload) { this.listeners.get(name)?.({ data: JSON.stringify(payload) }) }
  }
  const inertComponent = (name) => ({ [name]: function () { return null } })[name]
  const stubs = {
    "react": react,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { useRouter: () => ({ push: (href) => pushes.push(href) }) },
    "@/lib/burndown-series": { computeBurndownSeries: (input) => {
      queries.push(input)
      return { totalPoints: 5, days: [], tasks: input.tasks, unestimated: [] }
    } },
    "@/lib/jira-dashboard-filter": { DASHBOARD_TEAMS: [] },
  }
  for (const [module, name] of [
    ["sprint-selector", "SprintSelector"], ["burndown-chart", "BurndownChart"],
    ["unestimated-button", "UnestimatedButton"], ["day-tasks-dialog", "DayTasksDialog"],
    ["development-status", "DevelopmentStatus"],
  ]) stubs[`@/app/(app)/sprint/burndown/${module}`] = { [name]: inertComponent(name) }
  stubs["@/components/team-select"] = { TeamSelect: inertComponent("TeamSelect") }
  const sandbox = vm.createContext({ EventSource: FixtureEventSource, Date, Set })
  const mod = { exports: {} }
  vm.runInContext(`(function(require,module,exports){${code}\n})`, sandbox, { filename: path })((name) => {
    assert.ok(Object.hasOwn(stubs, name), `Unexpected import: ${name}`)
    return stubs[name]
  }, mod, mod.exports)
  const props = {
    project: "SUN", sprints: [], selectedSprintId: 1,
    sprint: { id: 1, name: "Fixture Sprint", startDate: "2026-10-13", endDate: "2026-10-25" },
    endpoint: "/api/sprint/burndown/stream?project=SUN&sprint=1", jiraBaseUrl: null,
  }
  const draw = () => { cursor = 0; effects.length = 0; return mod.exports.BurndownClient(props) }
  draw()
  effects[0]()
  streams[0].emit("base", { today: "2026-10-19", empty: false, tasks: [], unestimated: [], totalPoints: 5 })
  return { draw, streams, queries, pushes }
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree?.props) return []
  return [tree, ...nodes(tree.props.children)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("")
  return tree?.props ? text(tree.props.children) : typeof tree === "string" ? tree : ""
}
function checkbox(tree, label) {
  const node = nodes(tree).find((node) => node.type === "label" && text(node) === label)
  return nodes(node).find((node) => node.type === "input")
}
function display(tree) { return nodes(tree).find((node) => node.props["aria-label"] === "圖形顯示") }
function chart(tree) { return nodes(tree).find((node) => node.type?.name === "BurndownChart") }

describe("Burn Down mid-Sprint display placeholder", () => {
  it("adds an unchecked second-row option outside the original three-option fieldset", () => {
    const h = harness()
    const tree = h.draw()
    const group = display(tree)
    const fieldset = group.props.children[0]
    assert.equal(fieldset.type, "fieldset")
    assert.equal(fieldset.props.disabled, false)
    assert.deepEqual(nodes(fieldset).filter((node) => node.type === "input").map((node) => node.props.checked), [true, true, true])
    assert.equal(group.props.children[1].type, "label")
    assert.equal(text(group.props.children[1]), "中途加入的票")
    assert.equal(checkbox(tree, "中途加入的票").props.checked, false)
    assert.equal(checkbox(tree, "中途加入的票").props.disabled, undefined)
    assert.match(group.props.className, /flex-col/)
    const markup = renderToStaticMarkup(createElement("div", null, group))
    assert.match(markup, /<\/fieldset><label[^>]*><input type="checkbox"[^>]*\/>中途加入的票/)
  })
  it("disables and dims all three choices while preserving their values and the current chart", () => {
    const h = harness()
    let tree = h.draw()
    checkbox(tree, "剩餘點數").props.onChange({ target: { checked: false } })
    checkbox(tree, "受阻母票計為已完成").props.onChange({ target: { checked: false } })
    tree = h.draw()
    const previousChart = chart(tree).props
    checkbox(tree, "中途加入的票").props.onChange({ target: { checked: true } })
    tree = h.draw()
    const fieldset = display(tree).props.children[0]
    assert.equal(fieldset.props.disabled, true)
    assert.match(fieldset.props.className, /opacity-50/)
    assert.equal(checkbox(tree, "中途加入的票").props.checked, true)
    for (const label of ["剩餘點數", "已完成", "受阻母票計為已完成"]) {
      checkbox(tree, label).props.onChange({ target: { checked: true } })
    }
    tree = h.draw()
    assert.deepEqual(["剩餘點數", "已完成", "受阻母票計為已完成"].map((label) => checkbox(tree, label).props.checked), [false, true, false])
    assert.equal(chart(tree).props.showLine, previousChart.showLine)
    assert.equal(chart(tree).props.showBar, previousChart.showBar)
    assert.equal(h.queries.at(-1).blockedParentStatuses, null)
    assert.equal(h.streams.length, 1, "display toggle must not open another stream")
    assert.deepEqual(h.pushes, [])
    const markup = renderToStaticMarkup(createElement("div", null, display(tree)))
    assert.match(markup, /<fieldset disabled=""[^>]*opacity-50/)
    checkbox(tree, "中途加入的票").props.onChange({ target: { checked: false } })
    tree = h.draw()
    assert.equal(display(tree).props.children[0].props.disabled, false)
    assert.doesNotMatch(display(tree).props.children[0].props.className, /opacity-50/)
    assert.deepEqual(["剩餘點數", "已完成", "受阻母票計為已完成"].map((label) => checkbox(tree, label).props.checked), [false, true, false])
    checkbox(tree, "剩餘點數").props.onChange({ target: { checked: true } })
    assert.equal(checkbox(h.draw(), "剩餘點數").props.checked, true)
  })
})

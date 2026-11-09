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
  let previousDeps = null
  let cleanup = null
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
    useEffect: (effect, deps) => effects.push({ effect, deps }),
  }
  class FixtureEventSource {
    listeners = new Map()
    constructor(url) { this.url = url; streams.push(this) }
    addEventListener(name, callback) { this.listeners.set(name, callback) }
    closed = false
    close() { this.closed = true }
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
  const sandbox = vm.createContext({ EventSource: FixtureEventSource, Date, Set, URLSearchParams })
  const paramsCode = ts.transpileModule(readFileSync(new URL("../lib/burndown-params.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const paramsModule = { exports: {} }
  vm.runInContext(`(function(require,module,exports){${paramsCode}\n})`, sandbox)((name) => {
    if (name === "./jira-jql") return { SPRINT_PROJECTS: [{ key: "SUN" }, { key: "TKK" }, { key: "PRIDE" }] }
    if (name === "./jira-sprint-data") return {}
    assert.fail(`Unexpected params import: ${name}`)
  }, paramsModule, paramsModule.exports)
  stubs["@/lib/burndown-params"] = paramsModule.exports
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
  const flushEffects = () => {
    const { effect, deps } = effects[0]
    if (!previousDeps || deps.some((value, index) => value !== previousDeps[index])) {
      cleanup?.()
      previousDeps = [...deps]
      cleanup = effect()
    }
  }
  draw()
  flushEffects()
  streams[0].emit("base", { today: "2026-10-19", empty: false, tasks: [], unestimated: [], totalPoints: 5 })
  streams[0].emit("done", {})
  return { draw, flushEffects, props, streams, queries, pushes }
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree?.props) return []
  return [tree, ...nodes(tree.props.children), ...nodes(tree.props.trailing), ...nodes(tree.props.teamSlot)]
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
function component(tree, name) { return nodes(tree).find((node) => node.type?.name === name) }

const baseFixture = { today: "2026-10-19", empty: false, totalPoints: 5, unestimated: [], tasks: [{ key: "SUN-101", points: 5, doneDate: null, doneBeforeStart: false }] }

describe("Burn Down complete dataset", () => {
  it("waits for a complete base and done, then displays all daily markers together", () => {
    const h = harness()
    h.props.endpoint = "/api/sprint/burndown/stream?project=SUN&sprint=2"
    h.draw(); h.flushEffects()
    assert.equal(chart(h.draw()), undefined)
    const tasks = [
      { ...baseFixture.tasks[0], doneDate: "2026-10-13" },
      { ...baseFixture.tasks[0], key: "SUN-102", doneDate: "2026-10-18" },
    ]
    h.streams[1].emit("base", { ...baseFixture, tasks })
    assert.equal(chart(h.draw()), undefined, "base without done is not a completed result")
    h.streams[1].emit("done", {})
    const tree = h.draw()
    assert.ok(chart(tree))
    assert.equal(h.streams[1].closed, true)
    assert.deepEqual(Array.from(h.queries.at(-1).tasks, (task) => task.doneDate), ["2026-10-13", "2026-10-18"])
    assert.doesNotMatch(text(tree), /已接收.*天/)
    assert.equal(h.streams[1].listeners.has("day"), false)
  })
  it("does not show a partial base after failure or done without base", () => {
    const h = harness()
    h.props.endpoint = "/api/sprint/burndown/stream?project=SUN&sprint=2"
    h.draw(); h.flushEffects()
    h.streams[1].emit("base", baseFixture)
    h.streams[1].emit("error", { message: "Incomplete data" })
    assert.equal(chart(h.draw()), undefined)
    assert.match(text(h.draw()), /Incomplete data/)
    h.streams[1].emit("done", {})
    assert.equal(chart(h.draw()), undefined)
    const other = harness()
    other.props.endpoint = "/api/sprint/burndown/stream?project=SUN&sprint=2"
    other.draw(); other.flushEffects()
    other.streams[1].emit("done", {})
    assert.equal(chart(other.draw()), undefined)
    assert.match(text(other.draw()), /串流資料不完整/)
  })
  it("removes the completion-rule checkbox while retaining unestimated and display controls", () => {
    const h = harness()
    const tree = h.draw()
    const selector = component(tree, "SprintSelector")
    assert.equal(checkbox(tree, "By Resolved"), undefined)
    assert.equal(nodes(selector.props.trailing).some((node) => node.type === "input"), false)
    assert.ok(component(selector.props.trailing, "UnestimatedButton"))
    assert.doesNotMatch(renderToStaticMarkup(selector.props.trailing), /By Resolved/)
    assert.equal(checkbox(tree, "受阻母票計為已完成").props.checked, true)
    checkbox(tree, "中途加入的票").props.onChange({ target: { checked: true } })
    assert.equal(checkbox(h.draw(), "By Resolved"), undefined)
  })
  it("navigates Project/Sprint without generating or retaining a legacy flag", () => {
    const h = harness()
    const tree = h.draw()
    component(tree, "SprintSelector").props.onNavigate("/sprint/burndown?project=TKK")
    assert.equal(h.pushes.at(-1), "/sprint/burndown?project=TKK")
    component(tree, "SprintSelector").props.onNavigate("/sprint/burndown?project=SUN&sprint=2&byResolved=1")
    assert.equal(h.pushes.at(-1), "/sprint/burndown?project=SUN&sprint=2")
    component(tree, "SprintSelector").props.onNavigate("/sprint/burndown?project=SUN&sprint=1")
    assert.equal(h.pushes.at(-1), "/sprint/burndown?project=SUN&sprint=1")
    assert.equal(h.streams.length, 1, "navigation awaits matching server endpoint")
    assert.ok(h.pushes.every((href) => !href.includes("byResolved")))
  })
  it("hides stale data/details before cleanup, closes old streams and retains team/display preferences", () => {
    const h = harness()
    h.streams[0].emit("base", { ...baseFixture, tasks: [{ ...baseFixture.tasks[0], doneDate: "2026-10-15" }] })
    h.streams[0].emit("done", {})
    let tree = h.draw()
    checkbox(tree, "剩餘點數").props.onChange({ target: { checked: false } })
    component(tree, "TeamSelect").props.onGroupsChange(["ent-web"], ["member-1"], true)
    chart(tree).props.onBarClick("2026-10-15")
    tree = h.draw()
    assert.ok(component(tree, "DayTasksDialog"))
    const oldStatusKey = component(tree, "DevelopmentStatus").key
    h.props.selectedSprintId = 2
    h.props.sprint = { ...h.props.sprint, id: 2, name: "Next fixture Sprint" }
    h.props.endpoint = "/api/sprint/burndown/stream?project=SUN&sprint=2"
    tree = h.draw()
    assert.equal(chart(tree), undefined)
    assert.equal(component(tree, "DayTasksDialog"), undefined)
    h.flushEffects()
    assert.equal(h.streams[0].closed, true)
    h.streams[0].emit("base", { ...baseFixture, tasks: [{ key: "STALE" }] })
    h.streams[0].emit("day", { date: "2026-10-18", keys: ["SUN-101"] })
    assert.equal(chart(h.draw()), undefined, "late old events cannot reveal data")
    h.streams[1].emit("base", { ...baseFixture, tasks: [{ ...baseFixture.tasks[0], doneDate: "2026-10-17" }] })
    assert.equal(chart(h.draw()), undefined, "waits for completion acknowledgement")
    h.streams[1].emit("done", {})
    tree = h.draw()
    assert.equal(Object.hasOwn(h.queries.at(-1), "throughDate"), false)
    assert.equal(h.queries.at(-1).tasks[0].doneDate, "2026-10-17")
    assert.equal(component(tree, "DayTasksDialog"), undefined)
    assert.notEqual(component(tree, "DevelopmentStatus").key, oldStatusKey, "member dialog snapshots remount")
    assert.equal(chart(tree).props.showLine, false)
    assert.deepEqual(component(tree, "TeamSelect").props.groups, ["ent-web"])
    assert.equal(h.streams[1].listeners.has("day"), false, "no daily marker listener remains")
    tree = h.draw()
    chart(tree).props.onBarClick("2026-10-17")
    tree = h.draw()
    assert.equal(component(tree, "DayTasksDialog").props.tasks[0].doneDate, "2026-10-17")
    assert.equal(component(tree, "DevelopmentStatus").props.tasks[0].doneDate, "2026-10-17")
  })
  it("isolates Project changes including old opening markers, while retaining display preferences", () => {
    const h = harness()
    h.streams[0].emit("base", { ...baseFixture, tasks: [{ ...baseFixture.tasks[0], doneBeforeStart: true }] })
    h.streams[0].emit("done", {})
    let tree = h.draw()
    checkbox(tree, "受阻母票計為已完成").props.onChange({ target: { checked: false } })
    chart(tree).props.onBarClick("2026-10-12", true)
    const previousStatusKey = component(h.draw(), "DevelopmentStatus").key
    h.props.project = "TKK"
    h.props.selectedSprintId = 3
    h.props.sprint = { ...h.props.sprint, id: 3 }
    h.props.endpoint = "/api/sprint/burndown/stream?project=TKK&sprint=3"
    tree = h.draw()
    assert.equal(chart(tree), undefined)
    assert.equal(component(tree, "DayTasksDialog"), undefined)
    h.flushEffects()
    assert.equal(h.streams[0].closed, true)
    h.streams[0].emit("day", { date: "2026-10-15", keys: ["SUN-101"] })
    h.streams[1].emit("base", { ...baseFixture, tasks: [{ ...baseFixture.tasks[0], key: "TKK-101" }] })
    h.streams[1].emit("done", {})
    tree = h.draw()
    assert.equal(h.queries.at(-1).tasks[0].key, "TKK-101")
    assert.equal(h.queries.at(-1).tasks[0].doneBeforeStart, false)
    assert.equal(h.queries.at(-1).tasks[0].doneDate, null)
    assert.equal(Object.hasOwn(h.queries.at(-1), "throughDate"), false)
    assert.equal(checkbox(tree, "受阻母票計為已完成").props.checked, false)
    assert.equal(h.queries.at(-1).blockedParentStatuses, null)
    assert.notEqual(component(tree, "DevelopmentStatus").key, previousStatusKey)
    assert.equal(component(tree, "DayTasksDialog"), undefined)
    assert.doesNotMatch(h.streams[1].url, /byResolved/)
  })
  it("retries the selected Sprint without restoring old markers or daily details", () => {
    const h = harness()
    h.props.selectedSprintId = 2
    h.props.sprint = { ...h.props.sprint, id: 2, name: "Next fixture Sprint" }
    h.props.endpoint = "/api/sprint/burndown/stream?project=SUN&sprint=2"
    h.draw(); h.flushEffects()
    h.streams[1].emit("base", baseFixture)
    h.streams[1].emit("done", {})
    let tree = h.draw()
    chart(tree).props.onBarClick("2026-10-17")
    h.streams[1].emit("error", { message: "fixture failure" })
    tree = h.draw()
    nodes(tree).find((node) => node.type === "button" && text(node) === "重新載入").props.onClick()
    tree = h.draw()
    assert.equal(chart(tree), undefined)
    h.flushEffects()
    assert.equal(h.streams[1].closed, true)
    assert.match(h.streams[2].url, /\?project=SUN&sprint=2&t=\d+$/)
    assert.ok(h.streams.every((stream) => !stream.url.includes("byResolved")))
    h.streams[2].emit("base", baseFixture)
    h.streams[2].emit("done", {})
    tree = h.draw()
    assert.equal(component(tree, "DayTasksDialog"), undefined)
    assert.equal(Object.hasOwn(h.queries.at(-1), "throughDate"), false)
  })
  it("shows a fatal pre-base error for a new Sprint, not an endless loading overlay", () => {
    const h = harness()
    h.props.selectedSprintId = 2
    h.props.sprint = { ...h.props.sprint, id: 2, name: "Next fixture Sprint" }
    h.props.endpoint = "/api/sprint/burndown/stream?project=SUN&sprint=2"
    h.draw(); h.flushEffects()
    h.streams[1].emit("error", { message: "Resolved query failed" })
    const tree = h.draw()
    assert.match(text(tree), /Resolved query failed/)
    assert.ok(nodes(tree).some((node) => node.type === "button" && text(node) === "重新載入"))
    assert.equal(chart(tree), undefined)
    assert.equal(nodes(tree).some((node) => node.props["aria-label"] === "正在更新燃盡圖"), false)
  })
  it("shows invalid-filter errors without a loading overlay or replacement query", () => {
    const h = harness()
    h.props.endpoint = null
    h.props.filterError = "舊版完成日期參數無效，請移除 byResolved 後重試。"
    const tree = h.draw()
    h.flushEffects()
    assert.equal(h.streams.length, 1)
    assert.equal(h.streams[0].closed, true)
    assert.equal(text(nodes(tree).find((node) => node.props.role === "alert")), h.props.filterError)
    assert.equal(nodes(tree).some((node) => node.props["aria-label"] === "正在更新燃盡圖"), false)
  })
})

describe("Burn Down mid-Sprint display placeholder", () => {
  it("hides the unchecked placeholder while keeping the original three controls enabled", () => {
    const h = harness()
    const tree = h.draw()
    const group = display(tree)
    const fieldset = group.props.children[0]
    assert.equal(fieldset.type, "fieldset")
    assert.equal(fieldset.props.disabled, false)
    assert.deepEqual(nodes(fieldset).filter((node) => node.type === "input").map((node) => node.props.checked), [true, true, true])
    assert.equal(group.props.children[1].type, "label")
    assert.equal(group.props.children[1].props.hidden, true)
    assert.match(group.props.children[1].props.className, /\bhidden\b/)
    assert.doesNotMatch(group.props.children[1].props.className, /\bflex\b/)
    assert.equal(text(group.props.children[1]), "中途加入的票")
    assert.equal(checkbox(tree, "中途加入的票").props.checked, false)
    assert.equal(checkbox(tree, "中途加入的票").props.disabled, undefined)
    assert.match(group.props.className, /flex-col/)
    const markup = renderToStaticMarkup(createElement("div", null, group))
    assert.match(markup, /<\/fieldset><label hidden="" class="hidden [^"]*"><input type="checkbox"[^>]*\/>中途加入的票/)
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

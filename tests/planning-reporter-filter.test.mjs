import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import { describe, it } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const compiled = new Map()
const base = "app/(app)/sprint/planning/"
const plain = (value) => JSON.parse(JSON.stringify(value))

/** Persistent hook slots exercise real client callbacks and memo dependencies, not browser lifecycle. */
function harness() {
  let cursor = 0
  let slots = []
  const clientSlots = []
  const overviewSlots = []
  const componentSlots = new Map()
  let effects = []
  const viewport = { innerWidth: 1024, innerHeight: 768, addEventListener() {}, removeEventListener() {} }
  const modules = new Map()
  const react = {
    ...require("react"),
    useState(initial) {
      const index = cursor++
      const current = slots
      if (!(index in current)) current[index] = typeof initial === "function" ? initial() : initial
      return [current[index], (next) => { current[index] = typeof next === "function" ? next(current[index]) : next }]
    },
    useMemo(factory, deps) {
      const index = cursor++
      const previous = slots[index]
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        slots[index] = { deps, value: factory() }
      }
      return slots[index].value
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useLayoutEffect(callback) { effects.push(callback) },
    useTransition: () => [false, (callback) => callback()],
  }
  const allowed = new Set([
    `${base}planning-client.tsx`, `${base}planning-overview.tsx`,
    "lib/planning-subset.ts", "lib/planning-overview.ts", "lib/jira-missing-data.ts",
    "lib/date-range.ts", "lib/jira-dashboard-filter.ts", "lib/jira-jql.ts", "lib/jira-fields.ts", "lib/status-color.ts",
  ])
  const inertComponent = (name) => ({ [name]: () => null })
  const stubs = {
    "@/app/(app)/sprint/burndown/sprint-selector": inertComponent("SprintSelector"),
    "@/app/(app)/sprint/planning/assignment-status": inertComponent("AssignmentStatus"),
    "@/app/(app)/dashboard/parent-issue-type-icon": inertComponent("ParentIssueTypeIcon"),
    "@/components/team-select": inertComponent("TeamSelect"),
    "@/components/filter-defaults-provider": { useDefaultTeamGroups: () => react.useState([]) },
    "@/components/edit-dialog": inertComponent("EditDialog"),
    "@/components/ticket-link": inertComponent("TicketLink"),
    "@/components/team-members-provider": { useTeamMembers: () => { throw new Error("No membership request in this wiring test") } },
    "next/navigation": { useRouter: () => ({ push: () => { throw new Error("No navigation on filter or View changes") } }) },
  }
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    assert.ok(allowed.has(path), `Unexpected module: ${path}`)
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
      if (name in stubs) return stubs[name]
      if (name.startsWith("@/")) {
        const owned = name.slice(2)
        return load(`${owned}.${owned.startsWith("lib/") ? "ts" : "tsx"}`)
      }
      if (name.startsWith("./")) return load(`lib/${name.slice(2)}`)
      throw new Error(`Unexpected import: ${name}`)
    }
    vm.runInNewContext(`(function(require,module,exports){${compiled.get(path)}\n})`, { window: viewport }, { filename: path })(fixtureRequire, mod, mod.exports)
    return mod.exports
  }
  const { PlanningClient } = load(`${base}planning-client.tsx`)
  const { PlanningOverview } = load(`${base}planning-overview.tsx`)
  function draw(component, props, state) {
    slots = state
    cursor = 0
    effects = []
    const tree = component(props)
    for (const node of elements(tree)) {
      if (!node.props?.ref || typeof node.props.ref !== "object") continue
      const rows = elements(tree).filter((item) => item.type === "li").length
      node.props.ref.current = {
        style: node.props.style ? { ...node.props.style } : {},
        getBoundingClientRect: () => node.props.role === "tooltip"
          ? { width: node.props.style.width, height: 62 + rows * 20 + (text(tree).includes("另 ") ? 20 : 0) }
          : { left: 900, top: 650, width: 208, height: 208 },
      }
    }
    for (const effect of effects) effect()
    return tree
  }
  return {
    client: (props) => draw(PlanningClient, props, clientSlots),
    overview: (props) => draw(PlanningOverview, props, overviewSlots),
    component(node) {
      if (!componentSlots.has(node.type)) componentSlots.set(node.type, [])
      return draw(node.type, node.props, componentSlots.get(node.type))
    },
    viewport,
  }
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements)
  if (!tree || typeof tree !== "object") return []
  return [tree, ...elements(tree.props?.children)]
}

function nodes(tree, name) {
  if (!tree) return []
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, name))
  if (typeof tree !== "object") return []
  const matches = typeof tree.type === "function" && tree.type.name === name ? [tree] : []
  return [...matches, ...nodes(tree.props?.children, name)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("")
  if (typeof tree === "string" || typeof tree === "number") return String(tree)
  return tree?.props ? text(tree.props.children) : ""
}
const one = (tree, name) => {
  const matches = nodes(tree, name)
  assert.equal(matches.length, 1, name)
  return matches[0]
}
const mother = (key, assigneeAccountId, over = {}) => ({
  key, summary: key, points: 5, components: [], assigneeAccountId,
  reporter: "PM", reporterAccountId: "pm", issueType: "Story", epic: null, ...over,
})
const child = (key, assigneeAccountId, parentKey) => ({
  key, summary: key, status: null, points: 3, assigneeDisplayName: null, assigneeAccountId,
  reporter: null, components: [], issueType: "Dev-Task", devType: "Dev", parentKey,
  parentSummary: null, epic: null, parentIssueType: { status: "known", name: "Story" },
})
const reporterMothers = (tree) => nodes(tree, "ReporterGroupSection").flatMap(({ props: { group } }) => [
  ...group.epicGroups.flatMap((epic) => epic.parents), ...group.noEpic,
])
const keys = (tree) => reporterMothers(tree).map((parent) => parent.key).sort()

function fixture() {
  const h = harness()
  const sharedEpic = { key: "SUN-90", summary: "Shared Epic" }
  const props = {
    project: "SUN", sprints: [], selectedSprintId: 7517,
    sprint: { id: 7517, name: "Fixture Sprint", startDate: "2026-10-21", endDate: "2026-11-04" },
    dataError: null, jiraBaseUrl: null,
    pmFpmAccountIds: ["pm"], pmOpmAccountIds: [],
    parents: [
      mother("SUN-100", "web", { epic: sharedEpic, components: ["Backend"] }),
      mother("SUN-101", "be", { epic: sharedEpic, components: ["CMS"] }),
      mother("SUN-102", "web"), // No child: must still appear.
      mother("SUN-103", null),
      mother("SUN-104", "other", { reporter: "Other PM", reporterAccountId: "other-pm", epic: { key: "SUN-91", summary: "Other Epic" } }),
    ],
    tasks: [child("SUN-200", "be", "SUN-100"), child("SUN-201", "web", "SUN-101")],
  }
  let client = h.client(props)
  one(client, "PlanningTabs").props.onSwitch("overview")
  const draw = () => {
    client = h.client(props)
    const overview = nodes(client, "PlanningOverview")[0]
    if (!overview) return { client }
    const overviewProps = overview.props
    return { client, overviewProps, tree: h.overview(overviewProps) }
  }
  let view = draw()
  one(view.tree, "RadioGroup").props.onModeChange("reporter")
  view = draw()
  return {
    props, draw, h,
    select(groups, ids, ready = true) {
      const current = draw()
      const selector = one(current.client, "SprintSelector").props.teamSlot
      assert.equal(selector.props.perMember, false)
      selector.props.onGroupsChange(groups, ids, ready)
      return draw()
    },
  }
}

describe("Planning Reporter View — shared Assignee filter", () => {
  it("Planning 不再顯示 Capacity 區塊，保留任務規劃與團隊篩選", () => {
    const f = fixture()
    const view = f.draw()
    assert.equal(nodes(view.client, "CapacityPanel").length, 0)
    assert.equal(nodes(view.client, "PlanningOverview").length, 1)
    assert.equal(one(view.client, "SprintSelector").props.basePath, "/sprint/planning")
    assert.doesNotMatch(text(view.client), /Capacity/)
  })

  it("無選取顯示全部母票含未指派；單團隊只看母票 Assignee，不看 Reporter、子票或 Component", () => {
    const f = fixture()
    assert.deepEqual(keys(f.draw().tree), ["SUN-100", "SUN-101", "SUN-102", "SUN-103", "SUN-104"])
    const view = f.select(["ent-web"], ["web"])
    assert.deepEqual(keys(view.tree), ["SUN-100", "SUN-102"])
    assert.deepEqual(plain(view.overviewProps.tasks.map((task) => task.key)), ["SUN-201"])
    assert.ok(view.overviewProps.memberIds.has("web"))
    const group = one(view.tree, "ReporterGroupSection").props.group
    assert.equal(group.reporterAccountId, "pm")
    assert.equal(group.rank, 0)
    assert.deepEqual(plain(group.epicGroups.map((epic) => [epic.epic.key, epic.parents.length])), [["SUN-90", 1]])
    assert.equal(reporterMothers(view.tree).reduce((sum, parent) => sum + parent.points, 0), 10)
    for (const name of ["PieChart", "DevTypePieChart"]) {
      assert.equal(one(view.tree, name).props.tasks, view.overviewProps.tasks)
    }
  })

  it("選取聯集、切換團隊與清除篩選會重算 memo；清除恢復未指派母票", () => {
    const f = fixture()
    f.select(["ent-web"], ["web"])
    assert.deepEqual(keys(f.select(["ent-web", "ent-be1"], ["web", "be"]).tree), ["SUN-100", "SUN-101", "SUN-102"])
    assert.deepEqual(keys(f.select(["ent-be1"], ["be"]).tree), ["SUN-101"])
    const cleared = f.select([], [])
    assert.equal(cleared.overviewProps.memberIds, null)
    assert.equal(keys(cleared.tree).length, 5)
  })

  it("零命中移除全部 Reporter/Epic 卡，提供篩選空狀態", () => {
    const f = fixture()
    const view = f.select(["ent-qa1"], ["qa"])
    assert.deepEqual(keys(view.tree), [])
    assert.equal(nodes(view.tree, "ReporterGroupSection").length, 0)
    assert.match(text(view.tree), /沒有符合目前篩選條件的母票/)
  })

  it("切換 Team/Reporter 與內容 tab 保留 Filter，不導航或重新請求", () => {
    const f = fixture()
    let view = f.select(["ent-web"], ["web"])
    one(view.tree, "RadioGroup").props.onModeChange("team")
    view = f.draw()
    assert.equal(nodes(view.tree, "ReporterGroupSection").length, 0)
    assert.equal(one(view.tree, "DevTypeGroupSection").props.typeGroups[0].tasks[0].key, "SUN-201")
    one(view.tree, "RadioGroup").props.onModeChange("reporter")
    view = f.draw()
    assert.deepEqual(keys(view.tree), ["SUN-100", "SUN-102"])
    one(view.client, "PlanningTabs").props.onSwitch("assignment")
    one(f.draw().client, "PlanningTabs").props.onSwitch("overview")
    assert.deepEqual(keys(f.draw().tree), ["SUN-100", "SUN-102"])
  })

  it("Team Card 加總各 Dev Type 的 Dev/QA 點數，未估點與零點不影響總和，只計篩選後工作單", () => {
    const f = fixture()
    f.props.tasks = [
      { ...child("SUN-200", "web", "SUN-100"), points: 1.1, devType: "Dev" },
      { ...child("SUN-201", "web", "SUN-100"), points: 2.2, issueType: "QA-Task", devType: "Bug" },
      { ...child("SUN-202", "web", "SUN-100"), points: null, devType: "Spike" },
      { ...child("SUN-203", "web", "SUN-100"), points: 0, devType: null },
      { ...child("SUN-204", "be", "SUN-101"), points: 100 },
    ]
    let view = f.select(["ent-web"], ["web"])
    one(view.tree, "RadioGroup").props.onModeChange("team")
    view = f.draw()
    const card = one(view.tree, "DevTypeGroupSection")
    for (const open of [true, false]) {
      const rendered = card.type({ ...card.props, open })
      assert.match(text(rendered), /4 張 · 3\.3 點/)
      assert.doesNotMatch(text(rendered), /103\.3 點/)
    }
  })

  it("Team Card 全部未估點仍顯示 0 點", () => {
    const f = fixture()
    f.props.tasks = [{ ...child("SUN-200", "web", "SUN-100"), points: null }]
    let view = f.select(["ent-web"], ["web"])
    one(view.tree, "RadioGroup").props.onModeChange("team")
    view = f.draw()
    const card = one(view.tree, "DevTypeGroupSection")
    assert.match(text(card.type(card.props)), /1 張 · 0 點/)
  })

  it("沿用現有未完整載入時的共用 memberIds 行為，不以 teamOf 當 Filter", () => {
    const f = fixture()
    const view = f.select(["ent-web"], [], false)
    assert.equal(view.overviewProps.memberIds, null)
    assert.equal(keys(view.tree).length, 5)
    assert.equal(view.overviewProps.tasks.length, 2)
  })
})

function tooltipFixture() {
  const f = fixture()
  f.props.jiraBaseUrl = "https://fixture.atlassian.net"
  f.props.tasks = [
    { ...f.props.tasks[0], assigneeAccountId: "a", assigneeDisplayName: "Alice", points: 3 },
    { ...f.props.tasks[1], assigneeAccountId: "b", assigneeDisplayName: "Bob", points: 1, issueType: "QA-Task" },
    { ...f.props.tasks[0], key: "SUN-202", assigneeAccountId: "a", assigneeDisplayName: "Alice", points: 6, devType: "Bug", parentIssueType: { status: "known", name: "Bug" } },
    { ...f.props.tasks[0], key: "SUN-203", assigneeAccountId: "c", assigneeDisplayName: "Zero", points: null },
  ]
  f.select(["ent-web"], ["a", "b", "c"])
  one(f.draw().tree, "RadioGroup").props.onModeChange("team")
  return f
}
const renderChart = (f, name) => f.h.component(one(f.draw().tree, name))
const chartRow = (tree, category) => elements(tree).find((node) => node.type === "a" && node.props["aria-label"] === `在 Jira 開啟 ${category} 工作單`)
const renderTip = (f, tree) => f.h.component(one(tree, "MemberBreakdownTooltip"))

describe("Planning member tooltip selection", () => {
  it("requires exactly one selected group and an active filter, not visible team/member count", () => {
    const f = tooltipFixture()
    for (const [groups, ids, ready, expected] of [
      [[], [], true, false], [["ent-web"], [], false, false], [["ent-web"], [], true, false],
      [["ent-web"], ["a"], true, true], [["ent-web", "ent-be1"], ["a"], true, false],
      [["ent-be1"], ["b"], true, true], [[], [], true, false],
    ]) {
      const view = f.select(groups, ids, ready)
      assert.equal(view.overviewProps.showMemberBreakdown, expected)
      if (view.overviewProps.tasks.length > 0) {
        for (const name of ["PieChart", "DevTypePieChart"]) assert.equal(one(view.tree, name).props.showMemberBreakdown, expected)
      }
    }
  })
})

describe("Planning member tooltip rendering", () => {
  for (const [name, category] of [["PieChart", "Story"], ["DevTypePieChart", "Dev"]]) {
    it(`${name}: hover/focus uses category-local points/count and keeps Jira links`, () => {
      const f = tooltipFixture()
      let tree = renderChart(f, name)
      const href = chartRow(tree, category).props.href
      chartRow(tree, category).props.onMouseEnter()
      tree = renderChart(f, name)
      let tip = renderTip(f, tree)
      assert.match(text(tip), new RegExp(`${category} · 依成員`))
      assert.match(text(tip), /Alice375%/)
      assert.match(text(tip), /Bob125%/)
      assert.match(text(tip), /Zero00%/)
      assert.doesNotMatch(text(tip), /依團隊/)
      one(tree, "MetricSwitch").props.onMetricChange("count")
      tree = renderChart(f, name)
      tip = renderTip(f, tree)
      assert.match(text(tip), /Alice133\.3%/)
      assert.match(text(tip), /Bob133\.3%/)
      assert.match(text(tip), /Zero133\.3%/)
      assert.equal(chartRow(tree, category).props.href, href)
      chartRow(tree, category).props.onKeyDown({ key: "Escape" })
      assert.equal(nodes(renderChart(f, name), "MemberBreakdownTooltip").length, 0)
      chartRow(renderChart(f, name), category).props.onFocus()
      assert.match(text(renderTip(f, renderChart(f, name))), /依成員/)
      chartRow(renderChart(f, name), category).props.onBlur()
      assert.equal(nodes(renderChart(f, name), "MemberBreakdownTooltip").length, 0)
    })

    it(`${name}: preserves team-mode tooltip when multiple teams are selected`, () => {
      const f = tooltipFixture()
      f.select(["ent-web", "ent-be1"], ["a", "b", "c"])
      const tree = renderChart(f, name)
      chartRow(tree, category).props.onMouseEnter()
      const next = renderChart(f, name)
      assert.match(text(next), /依團隊/)
      assert.equal(nodes(next, "MemberBreakdownTooltip").length, 0)
      assert.equal(nodes(next, "MemberBreakdownDetails").length, 0)
    })

    it(`${name}: long lists explicitly link a bounded preview to complete member details`, () => {
      const f = tooltipFixture()
      f.props.tasks = Array.from({ length: 20 }, (_, index) => ({
        ...f.props.tasks[0], key: `SUN-${300 + index}`, assigneeAccountId: `id-${index}`,
        assigneeDisplayName: `Member ${index} with a long display name`, points: 1,
      }))
      f.select(["ent-web"], f.props.tasks.map((task) => task.assigneeAccountId))
      f.h.viewport.innerWidth = 240
      f.h.viewport.innerHeight = 200
      let tree = renderChart(f, name)
      chartRow(tree, category).props.onFocus()
      tree = renderChart(f, name)
      const tip = renderTip(f, tree)
      const tipRows = elements(tip).filter((n) => n.type === "li")
      assert.equal(tipRows.length, 5)
      assert.match(text(tip), /另 15 位，見成員明細/)
      const bounds = tip.props.ref.current.getBoundingClientRect()
      const { left, top } = tip.props.ref.current.style
      assert.ok(parseFloat(left) >= 8 && parseFloat(left) + bounds.width <= 232)
      assert.ok(parseFloat(top) >= 8 && parseFloat(top) + bounds.height <= 192)
      const details = f.h.component(one(tree, "MemberBreakdownDetails"))
      assert.equal(details.type, "details")
      assert.equal(details.props.open, undefined)
      assert.equal(elements(details).filter((n) => n.type === "li").length, 20)
      assert.match(text(details), /Member 19 with a long display name/)
      assert.ok(elements(details).filter((n) => n.type === "li").every((n) => text(n).endsWith("5%")))
    })
  }

  it("focusable non-Jira rows/arcs show the same details, and zero-point members remain readable", () => {
    const f = tooltipFixture()
    f.props.jiraBaseUrl = null
    for (const name of ["PieChart", "DevTypePieChart"]) {
      let tree = renderChart(f, name)
      const arc = elements(tree).find((node) => node.type === "g" && node.props.onMouseEnter)
      assert.equal(arc.props.tabIndex, 0)
      arc.props.onFocus()
      tree = renderChart(f, name)
      assert.match(text(renderTip(f, tree)), /依成員/)
      const fallbackRow = elements(tree).find((node) => node.type === "li" && node.props.onFocus)
      assert.equal(fallbackRow.props.tabIndex, 0)
      fallbackRow.props.onMouseLeave()
      assert.equal(nodes(renderChart(f, name), "MemberBreakdownTooltip").length, 0)
    }
    f.props.tasks = [{ ...f.props.tasks[0], points: null }]
    f.select(["ent-web"], ["a"])
    const tree = renderChart(f, "DevTypePieChart")
    const details = f.h.component(one(tree, "MemberBreakdownDetails"))
    assert.match(text(details), /Alice0 SP0%/)
    const arc = elements(tree).find((node) => node.type === "g" && node.props.onMouseEnter)
    assert.equal(arc, undefined)
  })

  it("the charts keep independent metrics and zero-value categories do not show a tooltip", () => {
    const f = tooltipFixture()
    let ticket = renderChart(f, "PieChart")
    one(ticket, "MetricSwitch").props.onMetricChange("count")
    ticket = renderChart(f, "PieChart")
    assert.equal(one(ticket, "MetricSwitch").props.metric, "count")
    assert.equal(one(renderChart(f, "DevTypePieChart"), "MetricSwitch").props.metric, "points")
    chartRow(ticket, "Task").props.onFocus()
    assert.equal(nodes(renderChart(f, "PieChart"), "MemberBreakdownTooltip").length, 0)
  })
})

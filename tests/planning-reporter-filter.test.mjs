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
    useTransition: () => [false, (callback) => callback()],
  }
  const allowed = new Set([
    `${base}planning-client.tsx`, `${base}planning-overview.tsx`,
    "lib/planning-subset.ts", "lib/planning-overview.ts", "lib/jira-missing-data.ts",
    "lib/jira-dashboard-filter.ts", "lib/jira-jql.ts", "lib/jira-fields.ts", "lib/status-color.ts",
  ])
  const inertComponent = (name) => ({ [name]: () => null })
  const stubs = {
    "@/app/(app)/sprint/burndown/sprint-selector": inertComponent("SprintSelector"),
    "@/app/(app)/sprint/planning/capacity-panel": inertComponent("CapacityPanel"),
    "@/app/(app)/sprint/planning/assignment-status": inertComponent("AssignmentStatus"),
    "@/app/(app)/dashboard/parent-issue-type-icon": inertComponent("ParentIssueTypeIcon"),
    "@/components/team-select": inertComponent("TeamSelect"),
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
    vm.runInNewContext(`(function(require,module,exports){${compiled.get(path)}\n})`, {}, { filename: path })(fixtureRequire, mod, mod.exports)
    return mod.exports
  }
  const { PlanningClient } = load(`${base}planning-client.tsx`)
  const { PlanningOverview } = load(`${base}planning-overview.tsx`)
  function draw(component, props, state) {
    slots = state
    cursor = 0
    return component(props)
  }
  return {
    client: (props) => draw(PlanningClient, props, clientSlots),
    overview: (props) => draw(PlanningOverview, props, overviewSlots),
  }
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
    dataError: null, jiraBaseUrl: null, viewerAccountId: "viewer",
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
    props, draw,
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

  it("沿用現有未完整載入時的共用 memberIds 行為，不以 teamOf 當 Filter", () => {
    const f = fixture()
    const view = f.select(["ent-web"], [], false)
    assert.equal(view.overviewProps.memberIds, null)
    assert.equal(keys(view.tree).length, 5)
    assert.equal(view.overviewProps.tasks.length, 2)
  })
})

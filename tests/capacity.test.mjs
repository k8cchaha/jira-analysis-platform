import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { posix } from "node:path"
import vm from "node:vm"
import { describe, it } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const base = "app/(app)/sprint/capacity/"
const selectorPath = "app/(app)/sprint/burndown/sprint-selector.tsx"
const compiled = new Map()
const plain = (value) => JSON.parse(JSON.stringify(value))
const forbidden = (action) => { throw new Error(`Offline Capacity test forbids ${action}`) }

/** Real TS/TSX modules, stubbed auth/UI boundary, and persistent hook slots; no browser lifecycle. */
function harness({ now = "2026-10-21T12:00:00.000Z", session = { user: { id: "viewer" } } } = {}) {
  const modules = new Map()
  const imported = new Set()
  const paths = []
  let authCalls = 0
  let pending = false
  let transitioning = false
  let cursor = 0
  let slots = []
  const allowed = new Set([
    `${base}page.tsx`, `${base}capacity-client.tsx`, `${base}capacity-panel.tsx`, selectorPath,
    "lib/burndown-params.ts", "lib/jira-sprint-data.ts", "lib/jira-jql.ts",
    "lib/jira-fields.ts", "lib/date-range.ts", "lib/jira-dashboard-filter.ts",
  ])
  class FrozenDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return new Date(now).getTime() }
    getFullYear() { return forbidden("local date extraction") }
    getMonth() { return forbidden("local date extraction") }
    getDate() { return forbidden("local date extraction") }
  }
  const react = {
    useState(initial) {
      const index = cursor++
      const current = slots
      if (!(index in current)) current[index] = typeof initial === "function" ? initial() : initial
      return [current[index], (next) => {
        current[index] = typeof next === "function" ? next(current[index]) : next
      }]
    },
    useTransition: () => [pending, (callback) => {
      pending = true
      transitioning = true
      try { return callback() } finally { transitioning = false }
    }],
  }
  function PageHeader() { return null }
  function FilterDropdown() { return null }
  const stubs = {
    "@/auth": { auth: async () => { authCalls++; return session } },
    "@/components/page-header": { PageHeader },
    "@/components/filter-dropdown": {
      FilterDropdown,
      // Width behavior is covered by the shared selector suite, not this migration suite.
      FILTER_SELECT_WIDTH_CLASS: { project: "project-width", sprint: "sprint-width", team: "team-width" },
    },
    "next/navigation": { useRouter: () => ({ push(path) {
      assert.equal(transitioning, true, "router.push must run inside startTransition")
      paths.push(path)
    } }) },
  }
  const sandbox = vm.createContext({
    Date: FrozenDate, URLSearchParams,
    fetch: () => forbidden("fetch"),
    localStorage: new Proxy({}, { get: () => forbidden("localStorage") }),
    sessionStorage: new Proxy({}, { get: () => forbidden("sessionStorage") }),
    process: { env: new Proxy({}, { get: () => forbidden("environment access") }) },
  })
  function load(path) {
    assert.ok(allowed.has(path), `Unexpected module (Planning/network code is not allowed): ${path}`)
    if (modules.has(path)) return modules.get(path).exports
    const mod = { exports: {} }
    modules.set(path, mod)
    if (!compiled.has(path)) {
      compiled.set(path, ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
        fileName: path,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText)
    }
    const fixtureRequire = (name) => {
      imported.add(name)
      if (name === "react") return react
      if (name === "react/jsx-runtime") return require(name)
      if (Object.hasOwn(stubs, name)) return stubs[name]
      let owned
      if (name.startsWith("@/")) owned = name.slice(2)
      else if (name.startsWith("./")) owned = posix.join(posix.dirname(path), name)
      else throw new Error(`Unexpected import: ${name}`)
      return load(/\.tsx?$/.test(owned) ? owned : `${owned}.${owned.startsWith("lib/") ? "ts" : "tsx"}`)
    }
    vm.runInContext(`(function(require,module,exports){${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, mod, mod.exports)
    return mod.exports
  }
  const page = load(`${base}page.tsx`)
  const { CapacityClient } = load(`${base}capacity-client.tsx`)
  const { CapacityPanel } = load(`${base}capacity-panel.tsx`)
  const { SprintSelector } = load(selectorPath)
  return {
    page, CapacityClient, CapacityPanel, SprintSelector,
    params: load("lib/burndown-params.ts"), sprints: load("lib/jira-sprint-data.ts"), imported, paths,
    get authCalls() { return authCalls },
    finishTransition() { pending = false },
    draw(component, props, state = []) {
      slots = state
      cursor = 0
      return component(props)
    },
  }
}

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate))
  if (!tree || typeof tree !== "object") return []
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("")
  if (typeof tree === "string" || typeof tree === "number") return String(tree)
  return tree?.props ? text(tree.props.children) : ""
}
function one(tree, predicate, label = "matching node") {
  const found = nodes(tree, predicate)
  assert.equal(found.length, 1, label)
  return found[0]
}
const component = (tree, name) => one(tree, (node) => typeof node.type === "function" && node.type.name === name, name)
const element = (tree, type) => one(tree, (node) => node.type === type, type)
const button = (tree, label) => one(tree, (node) => node.type === "button" && text(node) === label, label)
const teamButton = (tree, team) => one(tree, (node) => node.type === "button" && node.props["aria-label"]?.startsWith(`${team} `), team)
const input = (tree, member) => one(tree, (node) => node.type === "input" && node.props["aria-label"] === `${member} 的請假時數`, member)
const rowCells = (tree, member) => {
  const row = one(tree, (node) => node.type === "tr" && nodes(node, (child) => child.type === "td" && text(child) === member).length === 1, member)
  return nodes(row, (node) => node.type === "td")
}
const dialogNode = (tree) => component(tree, "CapacityDialog")
const ids = (sprints) => Array.from(sprints, (sprint) => sprint.id)

async function pageFixture(query, options) {
  const h = harness(options)
  const tree = await h.page.default({ searchParams: Promise.resolve(query) })
  assert.equal(tree.type, require("react").Fragment)
  assert.equal(component(tree, "PageHeader").props.title, "Capacity")
  const client = component(tree, "CapacityClient")
  assert.equal(client.type, h.CapacityClient)
  assert.equal(h.authCalls, 1)
  return { h, tree, props: client.props }
}

function clientProps(h, overrides = {}) {
  const sprint = h.params.getSprintById("SUN", 7517)
  return { project: "SUN", sprints: h.sprints.getPlanningSprints("SUN", "2026-10-21"), selectedSprintId: sprint.id, sprint, viewerAccountId: "viewer", ...overrides }
}
function panelFixture(project = "TKK", viewerAccountId = "viewer") {
  const h = harness()
  const panelState = []
  const props = { project, viewerAccountId }
  const draw = () => h.draw(h.CapacityPanel, props, panelState)
  function open(team) {
    teamButton(draw(), team).props.onClick()
    const state = [] // Each opening mounts a fresh dialog draft; the panel state persists.
    return () => {
      const node = dialogNode(draw())
      return h.draw(node.type, node.props, state)
    }
  }
  return { h, draw, open }
}

// Fixed dates and expected IDs keep these tests independent of the machine clock.
describe("Capacity page — static, validated project and current/future Sprint selection", () => {
  it("exports Capacity metadata and forwards actual parser/resolver results and viewer ID", async () => {
    const { h, props } = await pageFixture({ project: "SUN" }, { session: { user: { id: "verified-account" } } })
    assert.equal(h.page.metadata.title, "Capacity")
    assert.deepEqual(Object.keys(props).sort(), ["project", "selectedSprintId", "sprint", "sprints", "viewerAccountId"])
    assert.equal(props.project, "SUN")
    assert.deepEqual(ids(props.sprints), [7517, 7518, 7519, 7520, 7521, 7522])
    assert.equal(props.selectedSprintId, 7517)
    assert.deepEqual(plain(props.sprint), plain(h.params.resolvePlanningSprint("SUN", null, "2026-10-21")))
    assert.deepEqual(plain(props.sprints), plain(h.sprints.getPlanningSprints("SUN", "2026-10-21")))
    assert.equal(props.viewerAccountId, "verified-account")
    assert.ok(!Array.from(h.imported).some((name) => /planning-data|planning-client|jira-.*server|server-only|next-auth/.test(name)))
  })

  for (const project of [undefined, "", "sun", " SUN ", "INVALID", 'SUN OR project = TKK', ["SUN", "TKK"]]) {
    it(`keeps missing/invalid project ${JSON.stringify(project)} empty, even with a Sprint ID`, async () => {
      const { props } = await pageFixture({ project, sprint: "7519" })
      assert.equal(props.project, null)
      assert.deepEqual(ids(props.sprints), [])
      assert.equal(props.sprint, null)
      assert.equal(props.selectedSprintId, null)
    })
  }

  for (const [label, sprint, expected] of [
    ["active", "7517", 7517], ["future", "7519", 7519], ["historical", "7515", 7517],
    ["foreign project", "7401", 7517], ["unknown", "999999", 7517],
    ["missing", undefined, 7517], ["zero", "0", 7517], ["negative", "-1", 7517],
    ["decimal", "7519.0", 7517], ["exponent", "7.519e3", 7517], ["whitespace", " 7519", 7517],
    ["unsafe integer", "9007199254740992", 7517], ["JQL fragment", "7519 OR 1=1", 7517],
    ["repeated URL param", ["7517", "7519"], 7517],
  ]) {
    it(`resolves ${label} Sprint through the real validated planning options`, async () => {
      const { h, props } = await pageFixture({ project: "SUN", sprint })
      assert.equal(props.selectedSprintId, expected)
      assert.equal(props.sprint.id, expected)
      assert.ok(ids(props.sprints).includes(expected))
      assert.equal(props.sprint.id, h.params.resolvePlanningSprint("SUN", h.params.parseSprintId(sprint), "2026-10-21").id)
    })
  }

  it("uses the UTC day at an offset boundary, not local date fields", async () => {
    const { props } = await pageFixture({ project: "SUN" }, { now: "2026-10-25T23:30:00-07:00" })
    assert.equal(props.selectedSprintId, 7518)
    assert.deepEqual(ids(props.sprints), [7518, 7519, 7520, 7521, 7522])
  })

  it("selects the earliest future Sprint when today falls in a gap", async () => {
    const { props } = await pageFixture({ project: "TKK" }, { now: "2026-06-12T12:00:00Z" })
    assert.equal(props.selectedSprintId, 6620)
    assert.equal(props.sprints[0].id, 6620)
    assert.ok(props.sprint.startDate > "2026-06-12")
  })

  it("allows an all-future list before the first Sprint starts", async () => {
    const { h, props } = await pageFixture({ project: "SUN" }, { now: "2025-01-01T00:00:00Z" })
    assert.equal(props.selectedSprintId, 6823)
    assert.deepEqual(ids(props.sprints), ids(h.sprints.getProjectSprints("SUN")))
  })

  for (const project of ["SUN", "TKK", "PRIDE"]) {
    it(`${project} at 2099 has no available Sprint and does not revive historical data`, async () => {
      const { props } = await pageFixture({ project, sprint: "7517" }, { now: "2099-01-01T00:00:00Z" })
      assert.equal(props.project, project)
      assert.deepEqual(ids(props.sprints), [])
      assert.equal(props.sprint, null)
      assert.equal(props.selectedSprintId, null)
    })
  }

  for (const session of [null, {}, { user: {} }, { user: { id: "" } }]) {
    it(`forwards empty viewer fallback for ${JSON.stringify(session)}`, async () => {
      const { props } = await pageFixture({ project: "TKK" }, { session })
      assert.equal(props.viewerAccountId, "")
    })
  }
})

describe("Capacity client and actual SprintSelector callbacks", () => {
  it("forwards selector props without team/trailing controls and keys the panel only by project", () => {
    const h = harness()
    const props = clientProps(h)
    const tree = h.draw(h.CapacityClient, props)
    const selector = component(tree, "SprintSelector")
    assert.equal(selector.type, h.SprintSelector)
    assert.equal(selector.props.project, props.project)
    assert.equal(selector.props.sprints, props.sprints)
    assert.equal(selector.props.selectedSprintId, props.selectedSprintId)
    assert.equal(selector.props.basePath, "/sprint/capacity")
    assert.equal(typeof selector.props.onNavigate, "function")
    assert.equal(selector.props.teamSlot, undefined)
    assert.equal(selector.props.trailing, undefined)
    const panel = component(tree, "CapacityPanel")
    assert.equal(panel.type, h.CapacityPanel)
    assert.equal(panel.key, "SUN")
    assert.deepEqual(plain(panel.props), { project: "SUN", viewerAccountId: "viewer" })
    const future = h.params.getSprintById("SUN", 7519)
    assert.equal(component(h.draw(h.CapacityClient, { ...props, sprint: future, selectedSprintId: future.id }), "CapacityPanel").key, panel.key)
    assert.equal(component(h.draw(h.CapacityClient, { ...props, project: "TKK" }), "CapacityPanel").key, "TKK")
    assert.equal(nodes(tree, (node) => node.props?.role === "status").length, 0)
  })

  it("gates the panel on BOTH project and Sprint and displays distinct empty states", () => {
    const h = harness()
    for (const [project, sprint, expected] of [
      [null, null, /請先選擇專案/], [null, clientProps(h).sprint, /請先選擇專案/],
      ["SUN", null, /SUN 暫無進行中或未來的 Sprint/],
    ]) {
      const tree = h.draw(h.CapacityClient, clientProps(h, { project, sprint, sprints: [], selectedSprintId: null }))
      assert.equal(nodes(tree, (node) => node.type === h.CapacityPanel).length, 0)
      assert.match(text(tree), expected)
      assert.equal(component(tree, "SprintSelector").props.project, project)
    }
  })

  it("actual project/Sprint choices navigate within Capacity through a transition and expose pending status", () => {
    const h = harness()
    const props = clientProps(h)
    const draw = () => h.draw(h.CapacityClient, props)
    const selectorProps = component(draw(), "SprintSelector").props
    const selectorState = []
    const select = () => h.draw(h.SprintSelector, selectorProps, selectorState)
    const dropdown = (kind) => one(select(), (node) => node.type.name === "FilterDropdown" && node.props.kind === kind, kind)
    dropdown("project").props.onOpenChange(true)
    assert.equal(dropdown("project").props.open, true)
    one(select(), (node) => node.props?.role === "radio" && node.key === "SUN").props.onClick()
    assert.equal(h.paths.length, 0, "active project is a no-op")
    assert.equal(dropdown("project").props.open, false)
    one(select(), (node) => node.props?.role === "radio" && node.key === "TKK").props.onClick()
    assert.deepEqual(h.paths, ["/sprint/capacity?project=TKK"])
    const status = one(draw(), (node) => node.props?.role === "status")
    assert.equal(status.props["aria-label"], "正在更新 Capacity")
    assert.equal(status.props["aria-live"], "polite")
    h.finishTransition()
    assert.equal(nodes(draw(), (node) => node.props?.role === "status").length, 0)

    dropdown("sprint").props.onOpenChange(true)
    assert.equal(dropdown("sprint").props.open, true)
    const options = nodes(select(), (node) => node.props?.role === "option")
    assert.deepEqual(options.map((node) => Number(node.key)), [7522, 7521, 7520, 7519, 7518, 7517])
    assert.equal(options.find((node) => node.key === "7517").props["aria-selected"], true)
    options.find((node) => node.key === "7519").props.onClick()
    assert.equal(dropdown("sprint").props.open, false)
    assert.deepEqual(h.paths, ["/sprint/capacity?project=TKK", "/sprint/capacity?project=SUN&sprint=7519"])
    assert.equal(one(draw(), (node) => node.props?.role === "status").props["aria-label"], "正在更新 Capacity")
  })

  it("actual selector has no Sprint options without a project or available Sprints", () => {
    const h = harness()
    for (const project of [null, "SUN"]) {
      const tree = h.draw(h.SprintSelector, { project, sprints: [], selectedSprintId: null, basePath: "/sprint/capacity", onNavigate: () => forbidden("empty Sprint navigation") })
      assert.equal(nodes(tree, (node) => node.props?.role === "option").length, 0)
      assert.match(text(tree), project ? /此專案暫無可檢視的 Sprint/ : /請先選擇專案/)
    }
  })
})

const projectMocks = {
  SUN: [
    ["Android", true, 58, 1, ["Alice", "Bob", "Cindy"]], ["Backend", false, 0, 0, ["David", "Eve"]],
    ["iOS", true, 38, 1, ["Frank", "Grace"]], ["Web", false, 0, 0, ["Henry", "Ivy"]],
    ["QA", true, 40, 0, ["Jack", "Ken"]], ["Design", false, 0, 0, ["Lily"]],
  ],
  TKK: [
    ["Android", true, 38, 1, ["Mina", "Naomi"]], ["Backend", true, 40, 0, ["Oscar", "Peggy"]],
    ["iOS", false, 0, 0, ["Quinn"]], ["Web", true, 38, 1, ["Ray", "Sara"]],
    ["QA", true, 40, 0, ["Tom", "Uma"]], ["Design", false, 0, 0, ["Vera"]],
  ],
  PRIDE: [
    ["Android", true, 38, 1, ["Wade", "Xena"]], ["Backend", false, 0, 0, ["Yuki"]],
    ["iOS", true, 40, 0, ["Zoe", "Aaron"]], ["Web", true, 38, 1, ["Betty", "Carl"]],
    ["QA", false, 0, 0, ["Dana"]],
  ],
}

describe("Moved CapacityPanel — unchanged project mocks and local-only dialog behavior", () => {
  for (const [project, expected] of Object.entries(projectMocks)) {
    it(`${project} renders the correct teams, capacities and project-specific member mocks`, () => {
      const f = panelFixture(project)
      assert.equal(f.draw().props["aria-label"], "Capacity")
      assert.match(text(element(f.draw(), "h2")), new RegExp(`（${expected.reduce((sum, team) => sum + team[3], 0)} 天假期）`))
      assert.equal(nodes(f.draw(), (node) => node.type === "button").length, expected.length)
      for (const [team, filled, capacity, leaveDays, members] of expected) {
        const card = teamButton(f.draw(), team)
        assert.ok(card.props["aria-label"].includes(`${filled ? "已填寫" : "尚未填寫"} Capacity（${capacity}）`), team)
        assert.equal(text(card.props.children[1]), filled ? String(capacity) : "—")
        const drawDialog = f.open(team)
        const node = dialogNode(f.draw())
        assert.equal(node.props.team.filled, filled)
        assert.equal(node.props.team.capacity, capacity)
        assert.equal(node.props.team.leaveDays, leaveDays)
        assert.deepEqual(Array.from(node.props.team.members, (member) => member.name), members)
        assert.equal(drawDialog().props["aria-label"], `${team} Capacity`)
        one(drawDialog(), (child) => child.type === "button" && child.props["aria-label"] === "關閉").props.onClick()
        assert.equal(nodes(f.draw(), (child) => child.type.name === "CapacityDialog").length, 0)
      }
      if (project === "PRIDE") assert.equal(nodes(f.draw(), (node) => node.props?.["aria-label"]?.startsWith("Design ")).length, 0)
    })
  }

  it("only mock Web/QA membership AND a nonempty viewer enable editing; other teams stay readonly", () => {
    for (const viewer of ["viewer", ""]) {
      const f = panelFixture("SUN", viewer)
      for (const [team, filled, , , members] of projectMocks.SUN) {
        const drawDialog = f.open(team)
        const editable = viewer !== "" && ["Web", "QA"].includes(team)
        assert.equal(dialogNode(f.draw()).props.editable, editable, `${team}/${viewer}`)
        const tree = drawDialog()
        assert.equal(nodes(tree, (node) => node.type === "input").length, editable ? members.length : 0)
        assert.equal(nodes(tree, (node) => node.type === "button" && /^(提交|更新|取消)$/.test(text(node))).length, editable ? 2 : 0)
        if (!editable && !filled) assert.match(text(tree), /此團隊尚未填寫本 Sprint 的 Capacity/)
        if (!editable && filled) assert.equal(nodes(tree, (node) => node.type === "table").length, 1)
        one(tree, (node) => node.type === "button" && node.props["aria-label"] === "關閉").props.onClick()
      }
    }
  })

  it("filled dialog updates only dirty drafts; cancellation discards changes without updating panel totals", () => {
    const f = panelFixture()
    let drawDialog = f.open("Web")
    assert.equal(button(drawDialog(), "更新").props.disabled, true)
    input(drawDialog(), "Ray").props.onChange({ target: { value: "16" } })
    assert.equal(input(drawDialog(), "Ray").props.value, 16)
    assert.equal(text(rowCells(drawDialog(), "Ray")[2]), "16")
    assert.equal(button(drawDialog(), "更新").props.disabled, false)
    assert.match(text(element(f.draw(), "h2")), /（2 天假期）/)
    assert.match(teamButton(f.draw(), "Web").props["aria-label"], /Capacity（38）/)
    input(drawDialog(), "Ray").props.onChange({ target: { value: "8" } })
    assert.equal(button(drawDialog(), "更新").props.disabled, true, "reverting to original clears dirty state")
    input(drawDialog(), "Ray").props.onChange({ target: { value: "24" } })
    button(drawDialog(), "取消").props.onClick()
    assert.equal(nodes(f.draw(), (node) => node.type.name === "CapacityDialog").length, 0)
    drawDialog = f.open("Web")
    assert.equal(input(drawDialog(), "Ray").props.value, 8)
    assert.equal(button(drawDialog(), "更新").props.disabled, true)
    assert.match(text(element(f.draw(), "h2")), /（2 天假期）/)
  })

  it("saving recalculates every member, clamps points to zero, and updates team and overall leave totals", () => {
    const f = panelFixture()
    let drawDialog = f.open("Web")
    input(drawDialog(), "Ray").props.onChange({ target: { value: "16" } })
    input(drawDialog(), "Sara").props.onChange({ target: { value: "96" } })
    assert.equal(text(rowCells(drawDialog(), "Sara")[2]), "0")
    button(drawDialog(), "更新").props.onClick()
    assert.equal(nodes(f.draw(), (node) => node.type.name === "CapacityDialog").length, 0)
    assert.match(teamButton(f.draw(), "Web").props["aria-label"], /已填寫 Capacity（16）/)
    assert.match(text(element(f.draw(), "h2")), /（15 天假期）/)
    assert.match(teamButton(f.draw(), "Android").props["aria-label"], /Capacity（38）/)
    drawDialog = f.open("Web")
    assert.deepEqual(plain(dialogNode(f.draw()).props.team.members), [
      { name: "Ray", leave: 16, points: 16 }, { name: "Sara", leave: 96, points: 0 },
    ])
    assert.equal(dialogNode(f.draw()).props.team.leaveDays, 14)
    assert.equal(button(drawDialog(), "更新").props.disabled, true)
    assert.deepEqual(f.h.paths, [], "editing does not navigate")
    const fresh = panelFixture()
    assert.match(teamButton(fresh.draw(), "Web").props["aria-label"], /Capacity（38）/, "saved mock state is not persisted")
  })

  it("an unfilled editable team can submit an unchanged draft and retain the original mock status", () => {
    const f = panelFixture("SUN")
    const drawDialog = f.open("Web")
    assert.equal(button(drawDialog(), "提交").props.disabled, false)
    assert.match(text(drawDialog()), /尚未提交/)
    button(drawDialog(), "提交").props.onClick()
    assert.match(teamButton(f.draw(), "Web").props["aria-label"], /尚未填寫 Capacity（40）/)
    assert.equal(text(teamButton(f.draw(), "Web").props.children[1]), "—")
    assert.match(text(element(f.draw(), "h2")), /（2 天假期）/)
  })

  it("normalizes invalid/negative leave hours and applies the 20 − hours × 0.25 rule in the real draft callback", () => {
    const f = panelFixture()
    const drawDialog = f.open("Web")
    for (const [value, hours, points] of [
      ["0", 0, 20], ["8", 8, 18], ["4.5", 4.5, 18.875], ["80", 80, 0], ["96", 96, 0],
      ["-3", 0, 20], ["NaN", 0, 20], ["Infinity", 0, 20], ["", 0, 20],
    ]) {
      input(drawDialog(), "Ray").props.onChange({ target: { value } })
      assert.equal(input(drawDialog(), "Ray").props.value, hours, value)
      assert.equal(text(rowCells(drawDialog(), "Ray")[2]), String(points), value)
      assert.equal(input(drawDialog(), "Ray").props.min, 0)
      assert.equal(input(drawDialog(), "Ray").props.step, 1)
    }
  })

  it("dialog backdrop closes, while clicks inside stop propagation", () => {
    const f = panelFixture()
    const drawDialog = f.open("QA")
    const tree = drawDialog()
    let stopped = false
    tree.props.children.props.onClick({ stopPropagation() { stopped = true } })
    assert.equal(stopped, true)
    assert.equal(dialogNode(f.draw()).props.team.team, "QA")
    tree.props.onClick()
    assert.equal(nodes(f.draw(), (node) => node.type.name === "CapacityDialog").length, 0)
  })

  it("Sprint Note opens the unchanged readonly mock dialog and supports close/backdrop callbacks", () => {
    const f = panelFixture()
    const note = component(f.draw(), "SprintNoteButton")
    const state = []
    const drawNote = () => f.h.draw(note.type, note.props, state)
    assert.equal(nodes(drawNote(), (node) => node.type.name === "SprintNoteDialog").length, 0)
    for (const closeWithBackdrop of [false, true]) {
      button(drawNote(), "SprintNote").props.onClick()
      const node = component(drawNote(), "SprintNoteDialog")
      const tree = f.h.draw(node.type, node.props)
      assert.equal(tree.props.role, "dialog")
      assert.equal(tree.props["aria-modal"], "true")
      assert.equal(tree.props["aria-label"], "Sprint Note")
      assert.match(text(tree), /目前無此 Sprint 的註記.*假資料/)
      assert.equal(nodes(tree, (child) => ["input", "textarea", "form"].includes(child.type)).length, 0)
      assert.equal(nodes(tree, (child) => child.type === "button").length, 1)
      let stopped = false
      tree.props.children.props.onClick({ stopPropagation() { stopped = true } })
      assert.equal(stopped, true)
      if (closeWithBackdrop) tree.props.onClick()
      else one(tree, (child) => child.type === "button" && child.props["aria-label"] === "關閉").props.onClick()
      assert.equal(nodes(drawNote(), (child) => child.type.name === "SprintNoteDialog").length, 0)
    }
  })
})

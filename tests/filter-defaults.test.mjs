import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { defaultsHarness, nodes, plain } from "./helpers/filter-defaults-harness.mjs"

const defaults = { project: "SUN", groups: ["ent-be1", "ent-web"] }
const ready = (h, value = defaults) => { h.context = { defaults: value, ready: true, saveDefaults: async () => {} } }
const named = (tree, name) => nodes(tree).find((node) => node.type?.name === name)
const model = defaultsHarness().load("lib/filter-defaults.ts")
const qs = (query = "") => new URLSearchParams(query)

describe("defaults storage and validation", () => {
  it("normalizes only canonical projects and whole-team identifiers, deduped in configured order", () => {
    assert.deepEqual(plain(model.normalizeFilterDefaults({ ...defaults, groups: ["ent-web", "ent-be1", "ent-web"], members: ["ignored"] })), defaults)
    assert.deepEqual(plain(model.normalizeFilterDefaults({ project: null, groups: [] })), { project: null, groups: [] })
    assert.deepEqual(plain(model.defaultDashboardProjects(defaults)), ["sun"])
    assert.deepEqual(plain(model.defaultDashboardProjects({ project: "TKK", groups: [] })), ["tkk"])
    assert.deepEqual(plain(model.defaultDashboardProjects({ project: "PRIDE", groups: [] })), ["pride"])
  })
  for (const input of [null, [], {}, { project: "sun", groups: [] }, { project: "OTHER", groups: [] }, { project: null, groups: "ent-web" }, { project: null, groups: ["unknown"] }, { project: null, groups: Array(14).fill("ent-web") }]) {
    it(`rejects invalid preference ${JSON.stringify(input)}`, () => assert.throws(() => model.normalizeFilterDefaults(input)))
  }
  it("round trips across reloads without storing member data, and isolates accounts", () => {
    const h = defaultsHarness()
    const saved = model.writeFilterDefaults(h.localStorage, "viewer-a", { ...defaults, token: "discarded", members: ["discarded"] })
    assert.deepEqual(plain(saved), defaults)
    assert.deepEqual(JSON.parse(h.storage.get(model.filterDefaultsStorageKey("viewer-a"))), { version: 1, ...defaults })
    assert.deepEqual(plain(model.readFilterDefaults(h.localStorage, "viewer-a")), defaults)
    assert.deepEqual(plain(model.readFilterDefaults(h.localStorage, "viewer-b")), { project: null, groups: [] })
    assert.throws(() => model.filterDefaultsStorageKey(""))
  })
  for (const raw of [null, "", "{", "null", "[]", JSON.stringify(defaults), JSON.stringify({ version: 2, ...defaults }), JSON.stringify({ version: 1, project: "bad", groups: [] }), " ".repeat(2049)]) {
    it(`tolerates malformed/missing/versioned/oversized storage (${String(raw).slice(0, 35)})`, () => {
      assert.deepEqual(plain(model.readFilterDefaults({ getItem: () => raw }, "viewer-a")), { project: null, groups: [] })
    })
  }
  it("handles read denial and reports failed saves without returning success", () => {
    assert.deepEqual(plain(model.readFilterDefaults({ getItem() { throw new Error("denied") } }, "viewer-a")), { project: null, groups: [] })
    assert.throws(() => model.writeFilterDefaults({ setItem() { throw new Error("quota") } }, "viewer-a", defaults), /無法儲存預設值/)
  })
})

describe("clean-entry URL defaults", () => {
  for (const [path, href] of [
    ["/analytics/projects", "/analytics/projects?project=SUN"],
    ["/analytics/story-points", "/analytics/story-points?project=SUN&from=2026-10-13&to=2026-11-12"],
    ["/sprint/planning", "/sprint/planning?project=SUN"],
    ["/sprint/burndown", "/sprint/burndown?project=SUN"],
    ["/sprint/capacity", "/sprint/capacity?project=SUN"],
  ]) {
    it(`seeds project only on ${path}, leaving Sprint resolution to the existing page`, () => {
      assert.equal(model.defaultProjectHref(path, qs(), "SUN", "2026-11-12"), href)
      assert.equal(model.defaultProjectHref(path, qs(), null, "2026-11-12"), null)
      for (const query of ["project=TKK", "project=", "project=bad", "project=SUN&project=TKK", "sprint=1", "sprint=", "other=bad", "group=ent-web", "exclude=bad"]) {
        assert.equal(model.defaultProjectHref(path, qs(query), "SUN", "2026-11-12"), null, query)
      }
    })
  }
  it("preserves only the valid legacy byResolved flag", () => {
    assert.equal(model.defaultProjectHref("/sprint/burndown", qs("byResolved=1"), "SUN", "2026-11-12"), "/sprint/burndown?byResolved=1&project=SUN")
    for (const query of ["byResolved=", "byResolved=0", "byResolved=1&byResolved=1"]) {
      assert.equal(model.defaultProjectHref("/sprint/burndown", qs(query), "SUN", "2026-11-12"), null)
    }
  })
  it("ignores nested dialogs, dashboard, workload and unsupported pages", () => {
    for (const path of ["/dashboard", "/analytics/workload", "/sprint/burndown/day", "/settings", "/issues/assigned"]) {
      assert.equal(model.defaultProjectHref(path, qs(), "SUN", "2026-11-12"), null)
      assert.equal(model.canDefaultTeamGroups(path, qs()), false)
    }
  })
  for (const path of ["/analytics/projects", "/analytics/story-points", "/sprint/planning", "/sprint/burndown"]) {
    it(`never fills teams over explicit/incomplete/invalid conditions on ${path}`, () => {
      assert.equal(model.canDefaultTeamGroups(path, qs()), true)
      for (const query of ["group=", "group=ent-web", "exclude=bad", "project=", "project=bad", "project=SUN&project=SUN", "sprint=1", "sprint=", "project=SUN&sprint=999999999", "unknown=x"]) {
        assert.equal(model.canDefaultTeamGroups(path, qs(query)), false, query)
      }
    })
  }
  it("allows valid existing project/Sprint scopes but not a different project's Sprint", () => {
    const sprintData = defaultsHarness().load("lib/jira-sprint-data.ts")
    const sun = sprintData.getProjectSprints("SUN")[0].id
    assert.equal(model.canDefaultTeamGroups("/sprint/planning", qs(`project=SUN&sprint=${sun}`)), true)
    assert.equal(model.canDefaultTeamGroups("/sprint/planning", qs(`project=TKK&sprint=${sun}`)), false)
    assert.equal(model.canDefaultTeamGroups("/sprint/burndown", qs("byResolved=1")), true)
    assert.equal(model.canDefaultTeamGroups("/sprint/burndown", qs("byResolved=1&byResolved=1")), false)
    assert.equal(model.canDefaultTeamGroups("/analytics/story-points", qs("project=SUN&from=2026-10-13&to=2026-11-12")), true)
    assert.equal(model.canDefaultTeamGroups("/analytics/story-points", qs("project=SUN")), false)
  })
})

describe("real provider and one-time hooks", () => {
  it("hydrates empty, then restores preferences; save updates provider but not an existing entry", async () => {
    const h = defaultsHarness()
    const mod = h.load("components/filter-defaults-provider.tsx")
    model.writeFilterDefaults(h.localStorage, "viewer-a", defaults)
    const providerProps = { viewerId: "viewer-a", children: null }
    h.draw(mod.FilterDefaultsProvider, providerProps)
    assert.equal(h.context.ready, false)
    assert.deepEqual(plain(h.context.defaults), { project: null, groups: [] })
    await assert.rejects(h.context.saveDefaults(defaults), /正在載入/)
    const Entry = () => mod.useDefaultTeamGroups()
    assert.deepEqual(plain(h.draw(Entry)[0]), [])
    h.flush(); h.draw(mod.FilterDefaultsProvider, providerProps)
    assert.equal(h.context.ready, true)
    assert.deepEqual(plain(h.draw(Entry)[0]), defaults.groups)
    await h.context.saveDefaults({ project: "TKK", groups: ["ent-ios"] })
    h.draw(mod.FilterDefaultsProvider, providerProps)
    assert.deepEqual(plain(h.context.defaults), { project: "TKK", groups: ["ent-ios"] })
    assert.deepEqual(plain(h.draw(Entry)[0]), defaults.groups)
    assert.deepEqual(plain(h.draw(Entry, {}, "new-entry")[0]), ["ent-ios"])
  })
  it("remounting a keyed provider switches accounts without exposing the previous preferences", () => {
    const h = defaultsHarness(), mod = h.load("components/filter-defaults-provider.tsx")
    model.writeFilterDefaults(h.localStorage, "viewer-a", defaults)
    h.draw(mod.FilterDefaultsProvider, { viewerId: "viewer-a" }, "a"); h.flush()
    h.draw(mod.FilterDefaultsProvider, { viewerId: "viewer-a" }, "a")
    assert.deepEqual(plain(h.context.defaults), defaults)
    h.unmount("a")
    h.draw(mod.FilterDefaultsProvider, { viewerId: "viewer-b" }, "b")
    assert.equal(h.context.ready, false)
    assert.deepEqual(plain(h.context.defaults), { project: null, groups: [] })
    h.flush(); h.draw(mod.FilterDefaultsProvider, { viewerId: "viewer-b" }, "b")
    assert.deepEqual(plain(h.context.defaults), { project: null, groups: [] })
    h.unmount("b")
    assert.equal(h.listeners.window.get("storage").size, 0)
  })
  it("accepts own-account storage events and clear, ignores other accounts; cleans pending reads", () => {
    const h = defaultsHarness(), mod = h.load("components/filter-defaults-provider.tsx"), props = { viewerId: "viewer-a" }
    h.draw(mod.FilterDefaultsProvider, props); h.flush(); h.draw(mod.FilterDefaultsProvider, props)
    model.writeFilterDefaults(h.localStorage, "viewer-a", defaults)
    h.emit("window", "storage", { key: model.filterDefaultsStorageKey("viewer-b") })
    h.draw(mod.FilterDefaultsProvider, props)
    assert.equal(h.context.defaults.project, null)
    h.emit("window", "storage", { key: model.filterDefaultsStorageKey("viewer-a") }); h.draw(mod.FilterDefaultsProvider, props)
    assert.deepEqual(plain(h.context.defaults), defaults)
    h.storage.clear(); h.emit("window", "storage", { key: null }); h.draw(mod.FilterDefaultsProvider, props)
    assert.equal(h.context.defaults.project, null)
    h.unmount(mod.FilterDefaultsProvider)
    h.draw(mod.FilterDefaultsProvider, props); h.unmount(mod.FilterDefaultsProvider); h.flush()
    assert.equal(h.context.ready, false)
  })
  it("blocked browser storage remains usable and failed save retains the prior provider state", async () => {
    const h = defaultsHarness(), mod = h.load("components/filter-defaults-provider.tsx"), props = { viewerId: "viewer-a" }
    Object.defineProperty(h.window, "localStorage", { get() { throw new Error("storage blocked") } })
    h.draw(mod.FilterDefaultsProvider, props); h.flush(); h.draw(mod.FilterDefaultsProvider, props)
    assert.equal(h.context.ready, true)
    await assert.rejects(h.context.saveDefaults(defaults), /storage blocked|無法儲存/)
    h.draw(mod.FilterDefaultsProvider, props)
    assert.equal(h.context.defaults.project, null)
  })
  it("waits for secondary readiness and only applies once, even when defaults change", () => {
    const h = defaultsHarness(), mod = h.load("components/filter-defaults-provider.tsx"), applied = []
    const Entry = ({ waiting, eligible = true }) => mod.useInitialFilterDefaults((value) => applied.push(plain(value)), eligible, waiting)
    ready(h)
    h.draw(Entry, { waiting: true }); assert.equal(applied.length, 0)
    h.draw(Entry, { waiting: false }); assert.deepEqual(applied, [defaults])
    ready(h, { project: "PRIDE", groups: [] }); h.draw(Entry, { waiting: false }); assert.equal(applied.length, 1)
    h.draw(Entry, { eligible: false }, "invalid"); h.draw(Entry, { eligible: true }, "invalid"); assert.equal(applied.length, 1)
  })
  it("manual selection before storage readiness wins, including intentional clearing", () => {
    for (const chosen of [[], ["ent-ios"]]) {
      const h = defaultsHarness(), mod = h.load("components/filter-defaults-provider.tsx")
      const Entry = () => mod.useDefaultTeamGroups()
      h.draw(Entry)[1](chosen); ready(h)
      assert.deepEqual(plain(h.draw(Entry)[0]), chosen)
    }
  })
  it("a later URL change is checked before pending team defaults initialize", () => {
    const h = defaultsHarness(), mod = h.load("components/filter-defaults-provider.tsx")
    const Entry = () => mod.useDefaultTeamGroups()
    h.draw(Entry); h.window.location.search = "?project=&sprint=1"; ready(h)
    assert.deepEqual(plain(h.draw(Entry)[0]), [])
  })
})

describe("real clean-entry navigation", () => {
  function navigation(h) {
    const mod = h.load("components/filter-defaults-navigation.tsx")
    const entry = h.draw(mod.FilterDefaultsNavigation)
    return () => h.draw(entry.type, entry.props, entry.key)
  }
  it("uses replace once, preserves no-scroll, and never re-navigates after save/storage updates", () => {
    const h = defaultsHarness(), draw = navigation(h)
    draw(); assert.equal(h.replacements.length, 0)
    ready(h); draw(); draw()
    assert.deepEqual(plain(h.replacements), [["/sprint/planning?project=SUN", { scroll: false }]])
    ready(h, { project: "PRIDE", groups: [] }); draw()
    assert.equal(h.replacements.length, 1); assert.equal(h.pushes.length, 0); assert.equal(h.requests.length, 0)
  })
  for (const event of ["pointerdown", "keydown"]) {
    it(`${event} before readiness preserves user ownership; event listeners are removed on exit`, () => {
      const h = defaultsHarness(), draw = navigation(h)
      draw(); h.emit("document", event); ready(h); draw()
      assert.equal(h.replacements.length, 0)
      h.unmount("/sprint/planning")
      assert.equal(h.listeners.document.get("pointerdown").size, 0)
      assert.equal(h.listeners.document.get("keydown").size, 0)
    })
  }
  it("does not act on a stale pathname or invalid/explicit live URL", () => {
    for (const change of [() => ({ pathname: "/dashboard", search: "" }), () => ({ pathname: "/sprint/planning", search: "?sprint=1" }), () => ({ pathname: "/sprint/planning", search: "?project=TKK" })]) {
      const h = defaultsHarness(), draw = navigation(h)
      draw(); h.window.location = change(); ready(h); draw()
      assert.equal(h.replacements.length, 0)
    }
  })
})

describe("real filter consumers", () => {
  it("workload seeds drafts only, requires complete membership, and saves do not overwrite them", () => {
    const h = defaultsHarness({ path: "/analytics/workload" }); ready(h)
    const { WorkloadFilterForm } = h.load("app/(app)/analytics/workload/workload-filter.tsx")
    const submitted = [], props = { initialFilter: null, initialError: null, onQuery: (value) => submitted.push(value) }
    let tree = h.draw(WorkloadFilterForm, props)
    assert.deepEqual(plain(named(tree, "TeamSelect").props.groups), defaults.groups)
    assert.equal(named(tree, "FilterDropdown").props.value, "Saku")
    assert.equal(named(tree, "SearchButton").props.disabled, true)
    h.teamStates["ent-be1"] = { status: "success", members: [{ accountId: "member-a", displayName: "Member A" }] }
    tree = h.draw(WorkloadFilterForm, props)
    assert.equal(named(tree, "SearchButton").props.disabled, true)
    h.teamStates["ent-web"] = { status: "success", members: [{ accountId: "member-b", displayName: "Member B" }] }
    tree = h.draw(WorkloadFilterForm, props)
    assert.equal(named(tree, "SearchButton").props.disabled, false)
    assert.equal(submitted.length, 0); assert.equal(h.requests.length, 0)
    ready(h, { project: "TKK", groups: ["ent-ios"] }); tree = h.draw(WorkloadFilterForm, props)
    assert.deepEqual(plain(named(tree, "TeamSelect").props.groups), defaults.groups)
    assert.equal(named(tree, "FilterDropdown").props.value, "Saku")
  })
  it("a workload Project edit before readiness prevents a late preference overwrite", () => {
    const h = defaultsHarness({ path: "/analytics/workload" })
    const { WorkloadFilterForm } = h.load("app/(app)/analytics/workload/workload-filter.tsx")
    const props = { initialFilter: null, initialError: null, onQuery: () => assert.fail("automatic query") }
    const tree = h.draw(WorkloadFilterForm, props)
    const project = named(tree, "FilterDropdown")
    nodes(project).filter((node) => node.type === "input")[1].props.onChange({ target: { checked: true } })
    ready(h)
    const next = h.draw(WorkloadFilterForm, props)
    assert.equal(named(next, "FilterDropdown").props.value, "Telasa")
    assert.deepEqual(plain(named(next, "TeamSelect").props.groups), [])
  })
  it("Planning waits for the real TeamSelect's complete membership before narrowing data", () => {
    const h = defaultsHarness(); ready(h)
    const { PlanningClient } = h.load("app/(app)/sprint/planning/planning-client.tsx")
    const { TeamSelect } = h.load("components/team-select.tsx")
    const sprint = h.load("lib/jira-sprint-data.ts").getProjectSprints("SUN")[0]
    const tasks = ["member-a", "member-b", "member-other"].map((assigneeAccountId) => ({ assigneeAccountId, points: 2 }))
    const props = { project: "SUN", sprints: [sprint], selectedSprintId: sprint.id, sprint, tasks, dataError: null, jiraBaseUrl: null, parents: [], pmFpmAccountIds: [], pmOpmAccountIds: [] }
    let tree = h.draw(PlanningClient, props)
    h.draw(TeamSelect, named(tree, "TeamSelect").props)
    assert.equal(named(h.draw(PlanningClient, props), "AssignmentStatus").props.tasks.length, 3)
    h.teamStates["ent-be1"] = { status: "success", members: [{ accountId: "member-a", displayName: "Member A" }] }
    h.draw(TeamSelect, named(tree, "TeamSelect").props)
    assert.equal(named(h.draw(PlanningClient, props), "AssignmentStatus").props.tasks.length, 3)
    h.teamStates["ent-web"] = { status: "success", members: [{ accountId: "member-b", displayName: "Member B" }] }
    h.draw(TeamSelect, named(tree, "TeamSelect").props)
    tree = h.draw(PlanningClient, props)
    assert.deepEqual(plain(named(tree, "AssignmentStatus").props.tasks.map((task) => task.assigneeAccountId)), ["member-a", "member-b"])
    assert.equal(h.requests.length, 0)
  })
  it("workload preserves valid URL selections, invalid scope and explicit empty raw conditions", () => {
    const value = { groups: ["ent-ios"], projects: ["tkk"], exclusions: {}, from: "2026-10-13", to: "2026-11-12" }
    for (const [search, initialFilter, initialError] of [["?group=ent-ios&project=tkk", value, null], ["?group=&project=", null, "invalid scope"], ["?group=&project=", null, null]]) {
      const h = defaultsHarness({ path: "/analytics/workload", search }); ready(h)
      const { WorkloadFilterForm } = h.load("app/(app)/analytics/workload/workload-filter.tsx")
      const tree = h.draw(WorkloadFilterForm, { initialFilter, initialError, onQuery: () => assert.fail("automatic query") })
      assert.deepEqual(plain(named(tree, "TeamSelect").props.groups), initialFilter?.groups ?? [])
      assert.equal(named(tree, "FilterDropdown").props.value, initialFilter ? "Telasa" : "選擇專案…")
    }
  })
  it("dashboard does not persist an empty remembered draft while preferences are still loading", () => {
    const h = defaultsHarness({ path: "/dashboard" })
    const { DashboardFilter } = h.load("app/(app)/dashboard/dashboard-filter.tsx")
    const props = { filter: { mode: "self" }, viewerId: "viewer-a", onApply: () => assert.fail("automatic query") }
    h.draw(DashboardFilter, props); h.flush(); h.draw(DashboardFilter, props)
    assert.equal(h.storage.has("jira-dashboard-filter:viewer-a"), false)
    ready(h); h.draw(DashboardFilter, props)
    assert.deepEqual(JSON.parse(h.storage.get("jira-dashboard-filter:viewer-a")), { groups: defaults.groups, exclusions: {}, projects: ["sun"] })
  })
  it("dashboard remains self; no query, and remembered draft (including deliberate empty) wins", () => {
    for (const saved of [null, { groups: [], exclusions: {}, projects: [] }, { groups: ["ent-ios"], exclusions: {}, projects: ["tkk"] }]) {
      const h = defaultsHarness({ path: "/dashboard" }); ready(h)
      if (saved) h.storage.set("jira-dashboard-filter:viewer-a", JSON.stringify(saved))
      const { DashboardFilter } = h.load("app/(app)/dashboard/dashboard-filter.tsx")
      const props = { filter: { mode: "self" }, viewerId: "viewer-a", onApply: () => assert.fail("automatic query") }
      let tree = h.draw(DashboardFilter, props); h.flush(); tree = h.draw(DashboardFilter, props)
      assert.equal(nodes(tree).find((node) => node.type === "input" && node.props.value === "self").props.checked, true)
      nodes(tree).find((node) => node.type === "input" && node.props.value === "team-project").props.onChange()
      tree = h.draw(DashboardFilter, props)
      assert.equal(named(tree, "FilterDropdown").props.value, saved?.groups.length ? "iOS" : saved ? "選擇團隊…" : "BE1 · Web")
      const project = nodes(tree).find((node) => node.type?.name === "FilterDropdown" && node.props.kind === "project")
      assert.equal(project.props.value, saved?.projects.length ? "Telasa" : saved ? "選擇專案…" : "Saku")
      assert.equal(h.requests.length, 0)
    }
  })
  for (const [path, source, exportName, props] of [
    ["/analytics/projects", "app/(app)/analytics/projects/projects-query-client.tsx", "ProjectsQueryClient", { project: "SUN", sprints: [], selectedSprintIds: [], error: null }],
    ["/analytics/story-points", "app/(app)/analytics/story-points/team-analysis-filter.tsx", "TeamAnalysisFilter", { project: "SUN", dateRange: { from: "2026-10-13", to: "2026-11-12" }, error: null }],
    ["/sprint/planning", "app/(app)/sprint/planning/planning-client.tsx", "PlanningClient", { project: null, sprints: [], selectedSprintId: null, sprint: null, tasks: [], dataError: null, jiraBaseUrl: null, parents: [], pmFpmAccountIds: [], pmOpmAccountIds: [] }],
    ["/sprint/burndown", "app/(app)/sprint/burndown/burndown-client.tsx", "BurndownClient", { project: null, sprints: [], selectedSprintId: null, sprint: null, endpoint: null, jiraBaseUrl: null }],
  ]) {
    it(`${exportName} seeds root Teams once without query, navigation or stream`, () => {
      const h = defaultsHarness({ path }); ready(h)
      const Component = h.load(source)[exportName]
      let tree = h.draw(Component, props)
      const selectorName = exportName === "ProjectsQueryClient" ? "ProjectsFilter" : "TeamSelect"
      assert.deepEqual(plain(named(tree, selectorName).props.groups), defaults.groups)
      // Preserve the existing Burndown per-member selector; Projects' controlled Filter is tested separately.
      if (exportName !== "ProjectsQueryClient") assert.equal(named(tree, "TeamSelect").props.perMember, exportName === "BurndownClient" ? undefined : false)
      ready(h, { project: "PRIDE", groups: ["ent-ios"] }); tree = h.draw(Component, props)
      assert.deepEqual(plain(named(tree, selectorName).props.groups), defaults.groups)
      assert.equal(h.requests.length, 0); assert.equal(h.pushes.length, 0); assert.equal(h.replacements.length, 0)
    })
  }
})

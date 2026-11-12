import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { harness, plain, PROJECT_FILTER as FILTER, TEAM_PAGE, SELECTOR, nodes, selectorOf, teamOf, sprintDropdown, dateField, queryButton, readyNotice, checkbox, render } from "./helpers/analysis-filter-harness.mjs"

const selectionProps = async (h, params) => (await h.page(params)).props.filters.props
const sprintSelection = (project, selectedSprintIds = []) => ({ project, selectedSprintIds, error: null })

describe("project analysis all-Sprints parameters", () => {
  it("starts without a project, options or automatic Sprint selection", async () => {
    const h = harness()
    const tree = await h.page()
    assert.equal(tree.props.filters.type, h.load(FILTER).ProjectsFilter)
    assert.equal(tree.props.filters.key, null)
    assert.deepEqual(plain(tree.props.filters.props), { project: null, sprints: [], selectedSprintIds: [], error: null, dateMigrationHref: null })
  })
  for (const project of ["SUN", "TKK", "PRIDE"]) it(`${project} includes all configured historical/current/future Sprints without preselection`, async () => {
    const h = harness()
    const props = await selectionProps(h, { project })
    assert.deepEqual(plain(props.sprints), plain(h.load("lib/jira-sprint-data.ts").getProjectSprints(project)))
    assert.deepEqual(plain(props.selectedSprintIds), [])
    assert.equal(props.error, null)
    assert.ok(props.sprints.some((sprint) => sprint.endDate < "2026-10-21"))
  })
  it("accepts ended Sprints independent of today, singleton and sorted/deduped repeated IDs", async () => {
    const h = harness("2027-02-01")
    assert.deepEqual(plain((await selectionProps(h, { project: "TKK", sprint: "6619" })).selectedSprintIds), [6619])
    const { projectsFilterHref, projectsFilterResult } = h.load("lib/projects-filter.ts")
    const props = await selectionProps(h, { project: "SUN", sprint: ["7518", "6823", "7518"] })
    assert.deepEqual(plain(props.selectedSprintIds), [6823, 7518])
    assert.equal(projectsFilterHref(sprintSelection("SUN", [7518, 6823, 7518])), "/analytics/projects?project=SUN&sprint=6823&sprint=7518")
    assert.equal(projectsFilterHref(sprintSelection("SUN")), "/analytics/projects?project=SUN")
    assert.equal(projectsFilterHref(projectsFilterResult({ project: "SUN", mode: "sprints", sprint: "6823" })), "/analytics/projects?project=SUN&sprint=6823")
  })
  it("rejects malformed, foreign, unknown or incomplete scope rather than dropping clauses", async () => {
    const h = harness()
    for (const params of [
      { project: "sun" }, { project: "UNKNOWN" }, { project: ["SUN", "TKK"] }, { sprint: "6823" },
      { project: "SUN", sprint: "0" }, { project: "SUN", sprint: "999999" },
      { project: "SUN", sprint: ["6823", "7401"] }, { project: "SUN", sprint: ["6823", "invalid"] },
      { project: "SUN", sprint: "9007199254740992" }, { project: "SUN", sprint: "1 OR 1=1" },
      { project: "SUN", unknown: "1" }, { project: "SUN", sprint: Array(129).fill("6823") },
      { project: "SUN", sprint: "1".repeat(16_385) }, { project: "SUN", mode: ["sprints"] }, { project: "SUN", mode: "unknown" },
    ]) {
      const props = await selectionProps(h, params)
      assert.match(props.error, /篩選條件無效/)
      assert.deepEqual(plain(props.selectedSprintIds), [])
    }
    const { projectsFilterHref } = h.load("lib/projects-filter.ts")
    for (const selection of [sprintSelection("UNKNOWN"), sprintSelection("SUN", [7401]), sprintSelection("SUN", [0]), sprintSelection("SUN", [NaN]), sprintSelection("SUN", Array(129).fill(6823)), { ...sprintSelection("SUN"), mode: "dates" }, { ...sprintSelection("SUN"), dateRange: {} }]) {
      assert.throws(() => projectsFilterHref(selection), /篩選條件無效/)
    }
  })
})

describe("closest Sprint for dropdown scrolling", () => {
  const { closestSprint, getProjectSprints } = harness().load("lib/jira-sprint-data.ts")
  for (const [project, today, id] of [
    ["SUN", "2026-10-21", 7517], ["SUN", "2026-10-13", 7517], ["SUN", "2026-10-25", 7517],
    ["SUN", "2026-10-26", 7518], ["TKK", "2026-10-21", 7401],
    ["SUN", "2025-01-01", 6823], ["SUN", "2027-02-01", 7522],
    ["PRIDE", "2026-08-10", 7565], ["PRIDE", "2026-08-12", 7598],
    ["PRIDE", "2026-11-02", 7750], ["PRIDE", "2026-11-12", 7750],
  ]) it(`${project} on ${today} locates ${id} without mutating options`, () => {
    const sprints = getProjectSprints(project)
    const before = plain(sprints)
    assert.equal(closestSprint(sprints, today)?.id, id)
    assert.deepEqual(plain(sprints), before)
  })
  it("uses interval distance, not just start dates, with deterministic ties", () => {
    const sprint = (id, startDate, endDate) => ({ id, name: `Sprint ${id}`, startDate, endDate })
    const past = sprint(1, "2026-01-01", "2026-02-10")
    const future = sprint(2, "2026-02-14", "2026-02-28")
    assert.equal(closestSprint([future, past], "2026-02-11")?.id, 1)
    assert.equal(closestSprint([future, past], "2026-02-12")?.id, 1)
    assert.equal(closestSprint([future, past], "2026-02-13")?.id, 2)
    const overlapping = sprint(3, "2026-02-01", "2026-02-20")
    assert.equal(closestSprint([overlapping, past], "2026-02-10")?.id, 1)
    assert.equal(closestSprint([sprint(4, past.startDate, past.endDate), past], "2026-02-10")?.id, 1)
  })
  it("handles empty and invalid ranges without picking an unrelated Sprint", () => {
    assert.equal(closestSprint([], "2026-10-21"), null)
    assert.equal(closestSprint(getProjectSprints("SUN"), "not-a-date"), null)
    for (const [startDate, endDate] of [["bad", "2026-10-31"], ["2026-10-01", "bad"], ["2026-02-30", "2026-03-01"], ["2026-10-31", "2026-10-01"]]) {
      assert.equal(closestSprint([{ id: 1, name: "Invalid", startDate, endDate }], "2026-10-21"), null)
    }
  })
})

describe("moved project date URLs", () => {
  for (const [params, href] of [
    [{ project: "SUN", mode: "dates", from: "2026-10-01", to: "2026-10-21" }, "/analytics/story-points?project=SUN&from=2026-10-01&to=2026-10-21"],
    ...[
      { project: "SUN", from: "2026-10-01", to: "2026-10-21" },
      { project: "SUN", mode: "dates", from: "2026-10-01" },
      { project: "SUN", mode: "dates", from: "2026-02-29", to: "2026-10-21" },
      { project: "SUN", mode: "dates", from: "2026-10-22", to: "2026-10-21" },
      { project: "SUN", mode: "dates", from: "2000-01-01", to: "2026-10-21" },
      { project: "SUN", mode: "dates", from: "2026-10-01", to: ["2026-10-21"] },
      { project: ["SUN"], mode: "dates", from: "2026-10-01", to: "2026-10-21" },
      { project: "SUN", mode: ["dates", "sprints"], from: "2026-10-01", to: "2026-10-21" },
      { project: "SUN", mode: "dates", from: "2026-10-01", to: "2026-10-21", unknown: "1" },
      { project: "SUN", mode: "dates", from: "2026-10-01", to: "2026-10-21", sprint: "6823" },
    ].map((params) => [params, "/analytics/story-points"]),
  ]) it(`blocks Query and offers only the validated migration link: ${JSON.stringify(params)}`, async () => {
    const h = harness()
    const props = await selectionProps(h, params)
    assert.ok(props.error)
    assert.equal(props.dateMigrationHref, href)
    const tree = h.invoke(h.load(FILTER).ProjectsFilter, props)
    assert.equal(queryButton(tree).props.disabled, true)
    assert.equal(dateField(tree), undefined)
    assert.equal(nodes(tree).some((node) => node.props.type === "radio"), false)
    assert.match(renderToStaticMarkup(tree), /分析區間已移至團隊分析/)
    assert.equal(nodes(tree).find((node) => node.props.href)?.props.href, href)
    tree.props.onSubmit({ preventDefault() {} })
    assert.equal(readyNotice(h.invoke(h.load(FILTER).ProjectsFilter, props)), false)
    assert.deepEqual(h.pushes, [])
  })
})

describe("project Sprint-only UI and navigation", () => {
  for (const [params, enabled] of [[{}, false], [{ project: "SUN" }, false], [{ project: "SUN", sprint: "6823" }, true], [{ project: "SUN", sprint: ["6823", "7518"] }, true], [{ project: "SUN", sprint: "7401" }, false]]) it(`shared Query readiness ${JSON.stringify(params)}`, async () => {
    const h = harness()
    const props = await selectionProps(h, params)
    const { ProjectsFilter } = h.load(FILTER)
    const tree = h.invoke(ProjectsFilter, props)
    const button = queryButton(tree)
    assert.equal(button.props.disabled, !enabled)
    assert.equal(button.props.style, undefined)
    assert.equal(button.props.className, undefined)
    const markup = renderToStaticMarkup(tree)
    assert.equal((markup.match(/>查詢<\/button>/g) ?? []).length, 1)
    assert.doesNotMatch(markup, /type="radio"|近1月|近2月|分析區間/)
    tree.props.onSubmit({ preventDefault() {} })
    assert.equal(readyNotice(h.invoke(ProjectsFilter, props)), enabled)
    assert.deepEqual(h.pushes, [])
  })
  it("disables every non-project control initially and after empty history", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    let props = await selectionProps(h, {})
    let tree = h.invoke(ProjectsFilter, props)
    assert.equal(nodes(tree).find((node) => node.type === "fieldset").props.disabled, true)
    assert.equal(nodes(tree).find((node) => node.props.children === teamOf(tree)).props.inert, true)
    sprintDropdown(tree).props.onOpenChange(true)
    teamOf(tree).props.onGroupsChange(["ent-web"])
    assert.deepEqual(h.pushes, [])
    assert.deepEqual(plain(teamOf(h.invoke(ProjectsFilter, props)).props.groups), [])
    selectorOf(tree).props.onProjectChange("SUN")
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=SUN")
    h.setPending(false)
    props = await selectionProps(h, { project: "SUN", sprint: "6823" })
    tree = h.invoke(ProjectsFilter, props)
    teamOf(tree).props.onGroupsChange(["ent-web"])
    const oldTree = tree
    props = await selectionProps(h, {})
    tree = h.invoke(ProjectsFilter, props)
    teamOf(oldTree).props.onGroupsChange(["ent-be1"])
    sprintDropdown(oldTree).props.onOpenChange(true)
    checkbox(oldTree, "Sprint 71").props.onChange({ target: { checked: true } })
    assert.equal(nodes(tree).find((node) => node.type === "fieldset").props.disabled, true)
    assert.deepEqual(plain(teamOf(h.invoke(ProjectsFilter, props)).props.groups), ["ent-web"])
    assert.equal(h.pushes.length, 1)
  })
  it("enables Sprints and Team only after Project selection, and Query only with a Sprint", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, {})
    let tree = h.invoke(ProjectsFilter, props)
    const assertControls = (tree, projectSelected, queryEnabled) => {
      const [, sprints, team] = tree.props.children[0].props.children
      assert.equal(sprints.props.disabled, !projectSelected)
      assert.equal(sprints.props["aria-disabled"], !projectSelected)
      assert.equal(team.props.inert, !projectSelected)
      assert.equal(team.props["aria-disabled"], !projectSelected)
      assert.equal(queryButton(tree).props.disabled, !queryEnabled)
    }
    assertControls(tree, false, false)
    selectorOf(tree).props.onProjectChange("SUN")
    tree = h.invoke(ProjectsFilter, props)
    assertControls(tree, true, false)
    h.setPending(false)
    const projectProps = await selectionProps(h, { project: "SUN" })
    tree = h.invoke(ProjectsFilter, projectProps)
    assertControls(tree, true, false)
    assert.deepEqual(plain(teamOf(tree).props.groups), [])
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: true } })
    tree = h.invoke(ProjectsFilter, projectProps)
    assertControls(tree, true, true)
    assert.deepEqual(plain(teamOf(tree).props.groups), [])
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: false } })
    tree = h.invoke(ProjectsFilter, projectProps)
    assertControls(tree, true, false)
    checkbox(tree, "Sprint 71").props.onChange({ target: { checked: true } })
    tree = h.invoke(ProjectsFilter, projectProps)
    assertControls(tree, true, true)
    selectorOf(tree).props.onProjectChange("TKK")
    tree = h.invoke(ProjectsFilter, projectProps)
    assertControls(tree, true, false)
    h.setPending(false)
    tree = h.invoke(ProjectsFilter, props)
    assertControls(tree, false, false)
  })
  it("preserves whole-Team state across page props and clears readiness on Team changes", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    let props = await selectionProps(h, { project: "SUN", sprint: "6823" })
    let tree = h.invoke(ProjectsFilter, props)
    assert.equal(teamOf(tree).props.perMember, false)
    tree.props.onSubmit({ preventDefault() {} })
    assert.equal(readyNotice(h.invoke(ProjectsFilter, props)), true)
    teamOf(tree).props.onGroupsChange(["ent-web", "ent-be1"])
    assert.equal(readyNotice(h.invoke(ProjectsFilter, props)), false)
    props = await selectionProps(h, { project: "TKK", sprint: "7403" })
    tree = h.invoke(ProjectsFilter, props)
    assert.deepEqual(plain(teamOf(tree).props.groups), ["ent-web", "ent-be1"])
    const fresh = harness()
    assert.deepEqual(plain(teamOf(fresh.invoke(fresh.load(FILTER).ProjectsFilter, props)).props.groups), [])
  })
  it("retains rapid add/add/remove intent and open panel while server props lag", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, { project: "SUN" })
    let tree = h.invoke(ProjectsFilter, props)
    sprintDropdown(tree).props.onOpenChange(true)
    tree = h.invoke(ProjectsFilter, props)
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: true } })
    checkbox(tree, "Sprint 71").props.onChange({ target: { checked: true } })
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: false } })
    assert.deepEqual(h.pushes, ["/analytics/projects?project=SUN&sprint=6823", "/analytics/projects?project=SUN&sprint=6823&sprint=7518", "/analytics/projects?project=SUN&sprint=7518"])
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(sprintDropdown(tree).props.open, true)
    assert.equal(checkbox(tree, "Sprint 58").props.checked, false)
    const stale = await selectionProps(h, { project: "SUN", sprint: "6823" })
    assert.equal(checkbox(h.invoke(ProjectsFilter, stale), "Sprint 71").props.checked, true)
    h.setPending(false)
    tree = h.invoke(ProjectsFilter, await selectionProps(h, { project: "SUN", sprint: "7518" }))
    checkbox(tree, "Sprint 71").props.onChange({ target: { checked: false } })
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=SUN")
  })
  it("restores history without old optimistic selections and recalculates readiness", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    let props = await selectionProps(h, { project: "SUN", sprint: ["6823", "7518"] })
    let tree = h.invoke(ProjectsFilter, props)
    assert.equal(checkbox(tree, "Sprint 58").props.checked, true)
    props = await selectionProps(h, { project: "SUN", sprint: "7518" })
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(checkbox(tree, "Sprint 58").props.checked, false)
    checkbox(tree, "Sprint 59").props.onChange({ target: { checked: true } })
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=SUN&sprint=6824&sprint=7518")
  })
  it("clears Sprints on Project change and ignores old checkboxes and late submit", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, { project: "SUN", sprint: "7518" })
    const tree = h.invoke(ProjectsFilter, props)
    selectorOf(tree).props.onProjectChange("SUN")
    assert.equal(h.pushes.length, 0)
    selectorOf(tree).props.onProjectChange("TKK")
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: true } })
    tree.props.onSubmit({ preventDefault() {} })
    assert.equal(h.pushes.length, 1)
    const pending = h.invoke(ProjectsFilter, props)
    assert.equal(selectorOf(pending).props.project, "TKK")
    assert.equal(sprintDropdown(pending).props.open, false)
    assert.equal(nodes(sprintDropdown(pending)).filter((node) => node.type === "input").length, 0)
    assert.equal(readyNotice(pending), false)
    h.setPending(false)
    const next = h.invoke(ProjectsFilter, await selectionProps(h, { project: "TKK" }))
    checkbox(next, "S128").props.onChange({ target: { checked: true } })
    assert.equal(h.pushes.at(-1), "/analytics/projects?project=TKK&sprint=6619")
  })
  it("keeps Project, Sprints, Team and Query in one wrapping row with central widths", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const { FILTER_SELECT_WIDTH_CLASS } = h.load("components/filter-dropdown.tsx")
    for (const params of [{}, { project: "SUN", sprint: ["6823", "7518"] }]) {
      const tree = h.invoke(ProjectsFilter, await selectionProps(h, params))
      const row = tree.props.children[0]
      const [project, sprints, team, query] = row.props.children
      assert.equal(row.props.children.length, 4)
      assert.match(row.props.className, /flex-wrap/)
      assert.match(row.props.className, /items-end/)
      assert.match(row.props.className, /min-w-0/)
      assert.equal(project.props.children, selectorOf(tree))
      assert.equal(team.props.children, teamOf(tree))
      assert.equal(sprints.type, "fieldset")
      assert.ok(nodes(sprints).includes(sprintDropdown(tree)))
      assert.equal(query.props.children, queryButton(tree))
      assert.equal(nodes(sprints).includes(queryButton(tree)), false)
      assert.equal(sprints.props.disabled, !params.project)
      assert.equal(project.props.className, FILTER_SELECT_WIDTH_CLASS.project)
      assert.ok(team.props.className.startsWith(FILTER_SELECT_WIDTH_CLASS.team))
      assert.equal(sprints.props.className, FILTER_SELECT_WIDTH_CLASS.sprint)
      assert.match(query.props.className, /ml-auto/)
      for (const control of [project, sprints, team, query]) {
        assert.match(control.props.className, /max-w-full/)
        assert.match(control.props.className, /min-w-0/)
        assert.doesNotMatch(control.props.className, /mt-4|pt-5/)
        assert.equal(control.props.style, undefined)
      }
      const dropdown = sprintDropdown(tree)
      const native = h.invoke(dropdown.type, dropdown.props)
      assert.equal(native.props.className, `relative ${FILTER_SELECT_WIDTH_CLASS.sprint}`)
      const panel = nodes(native).find((node) => node.props.id === "projects-sprints-options")
      assert.match(panel.props.className, /w-full min-w-0/)
      const search = queryButton(tree)
      assert.equal(search.props.className, undefined)
      assert.equal(search.props.style, undefined)
      assert.match(h.invoke(search.type, search.props).props.className, /w-24 max-w-full/)
    }
  })
  it("marks Project and Sprints required but leaves Team optional, retaining labels and central widths", async () => {
    const h = harness()
    const props = await selectionProps(h, { project: "SUN" })
    const markup = render(h.load(FILTER).ProjectsFilter, props)
    for (const params of [{}, { project: "SUN" }, { project: "SUN", sprint: "6823" }]) {
      const tree = h.invoke(h.load(FILTER).ProjectsFilter, await selectionProps(h, params))
      assert.equal(selectorOf(tree).props.required, true)
      assert.equal(sprintDropdown(tree).props.required, true)
      const html = renderToStaticMarkup(tree)
      assert.equal((html.match(/sr-only[^>]*>（必選）/g) ?? []).length, 2)
      for (const label of ["專案", "Sprints"]) assert.ok(html.includes(`${label}<span aria-hidden="true" class="ml-1 text-rose-600 dark:text-rose-400">*</span><span class="sr-only">（必選）</span>`))
      assert.doesNotMatch(renderToStaticMarkup(teamOf(tree)), /（必選）/)
    }
    assert.doesNotMatch(markup, /aria-required|展開 Web 成員|Fixture member/)
    const { FILTER_SELECT_WIDTH_CLASS } = h.load("components/filter-dropdown.tsx")
    for (const kind of ["project", "sprint", "team"]) assert.ok(markup.includes(`class="relative ${FILTER_SELECT_WIDTH_CLASS[kind]}"`))
    assert.match(markup, /class="truncate"/)
    const labels = nodes(sprintDropdown(h.invoke(h.load(FILTER).ProjectsFilter, props))).filter((node) => node.type === "label")
    assert.equal(labels.length, props.sprints.length)
    assert.equal(labels[0].props.children[1].props.children[0].props.children, props.sprints.at(-1).name)
  })
  it("shows grey start/end dates below each Sprint name without increasing row spacing", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    for (const project of ["SUN", "TKK", "PRIDE"]) {
      const props = await selectionProps(h, { project })
      const tree = h.invoke(ProjectsFilter, props)
      const labels = nodes(sprintDropdown(tree)).filter((node) => node.type === "label")
      const ordered = [...props.sprints].sort((a, b) => b.startDate.localeCompare(a.startDate))
      assert.equal(labels.length, ordered.length)
      labels.forEach((label, index) => {
        const sprint = ordered[index]
        assert.equal(label.props["data-sprint-id"], sprint.id)
        const [name, dates] = label.props.children[1].props.children
        assert.equal(name.props.children, sprint.name)
        assert.match(name.props.className, /block.*leading-5/)
        assert.equal(dates.props.children.join(""), `${sprint.startDate} - ${sprint.endDate}`)
        assert.equal(dates.props.title, `${sprint.startDate} - ${sprint.endDate}`)
        assert.match(dates.props.className, /block truncate text-xs leading-4/)
        assert.match(dates.props.className, /text-slate-500 dark:text-slate-400/)
        assert.match(label.props.className, /min-h-10/)
        assert.match(label.props.className, /py-0/)
        assert.doesNotMatch(label.props.className, /\b(?:my-|space-y-|gap-y-)/)
      })
      assert.equal(sprintDropdown(tree).props.value, "選擇 Sprints")
    }
  })
  it("aligns the closest Sprint toward the top on each open without selecting it or resetting manual scrolling", async () => {
    const h = harness("2026-10-21")
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, { project: "SUN", sprint: "6823" })
    let tree = h.invoke(ProjectsFilter, props)
    const targets = []
    const panel = { hidden: false, scrollTop: 0, clientTop: 1, clientHeight: 300, getBoundingClientRect: () => ({ top: 100 }) }
    const fieldset = nodes(tree).find((node) => node.type === "fieldset")
    fieldset.props.ref.current = { querySelector: (selector) => {
      targets.push(selector)
      return { parentElement: panel, offsetHeight: 40, getBoundingClientRect: () => ({ top: 501 - panel.scrollTop }) }
    } }
    h.flushEffects()
    assert.deepEqual(targets, [])
    sprintDropdown(tree).props.onOpenChange(true)
    tree = h.invoke(ProjectsFilter, props)
    h.flushEffects()
    assert.deepEqual(targets, ['[data-sprint-id="7517"]'])
    assert.equal(panel.scrollTop, 400)
    assert.equal(checkbox(tree, "Sprint 58").props.checked, true)
    assert.equal(checkbox(tree, "Sprint 70").props.checked, false)
    assert.deepEqual(h.pushes, [])
    panel.scrollTop = 120
    checkbox(tree, "Sprint 71").props.onChange({ target: { checked: true } })
    tree = h.invoke(ProjectsFilter, props)
    h.flushEffects()
    h.setPending(false)
    tree = h.invoke(ProjectsFilter, await selectionProps(h, { project: "SUN", sprint: ["6823", "7518"] }))
    h.flushEffects()
    assert.equal(panel.scrollTop, 120)
    assert.equal(targets.length, 1)
    sprintDropdown(tree).props.onOpenChange(false)
    tree = h.invoke(ProjectsFilter, props)
    h.flushEffects()
    assert.equal(targets.length, 1)
    sprintDropdown(tree).props.onOpenChange(true)
    tree = h.invoke(ProjectsFilter, props)
    h.flushEffects()
    assert.equal(targets.length, 2)
    assert.equal(panel.scrollTop, 400)
    assert.equal(sprintDropdown(tree).props.open, true)
  })
  it("scrolls a near-top current Sprint even when the old centered target would clamp to zero", async () => {
    for (const [project, expectedId] of [["SUN", 7519], ["TKK", 7402], ["PRIDE", 7750]]) {
      const h = harness("2026-11-12")
      const { ProjectsFilter } = h.load(FILTER)
      const props = await selectionProps(h, { project })
      let tree = h.invoke(ProjectsFilter, props)
      const rows = nodes(sprintDropdown(tree)).filter((node) => node.type === "label")
      const index = rows.findIndex((row) => row.props["data-sprint-id"] === expectedId)
      const rowHeight = 40
      const padding = 4
      const contentHeight = rows.length * rowHeight + padding * 2
      const viewportHeight = Math.min(300, contentHeight)
      const maxScroll = contentHeight - viewportHeight
      const optionTop = padding + index * rowHeight
      assert.ok(optionTop - (viewportHeight - rowHeight) / 2 < 0)
      let scrollTop = 0
      const panel = {
        hidden: false, clientTop: 1, clientHeight: viewportHeight,
        get scrollTop() { return scrollTop },
        set scrollTop(value) { scrollTop = Math.max(0, Math.min(maxScroll, value)) },
        getBoundingClientRect: () => ({ top: 100 }),
      }
      nodes(tree).find((node) => node.type === "fieldset").props.ref.current = { querySelector: (selector) => {
        assert.equal(selector, `[data-sprint-id="${expectedId}"]`)
        return { parentElement: panel, offsetHeight: rowHeight, getBoundingClientRect: () => ({ top: 100 + panel.clientTop + optionTop - panel.scrollTop }) }
      } }
      h.flushEffects()
      sprintDropdown(tree).props.onOpenChange(true)
      tree = h.invoke(ProjectsFilter, props)
      h.flushEffects()
      assert.equal(panel.scrollTop, Math.min(optionTop, maxScroll))
      assert.ok(panel.scrollTop > 0)
      assert.deepEqual(h.pushes, [])
    }
  })
  it("waits for new Project options before locating a pending open panel", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const props = await selectionProps(h, {})
    let tree = h.invoke(ProjectsFilter, props)
    const targets = []
    const panel = { hidden: false, scrollTop: 0, clientTop: 0, clientHeight: 300, getBoundingClientRect: () => ({ top: 100 }) }
    nodes(tree).find((node) => node.type === "fieldset").props.ref.current = { querySelector: (selector) => {
      targets.push(selector)
      return { parentElement: panel, offsetHeight: 40, getBoundingClientRect: () => ({ top: 500 }) }
    } }
    h.flushEffects()
    selectorOf(tree).props.onProjectChange("TKK")
    tree = h.invoke(ProjectsFilter, props)
    sprintDropdown(tree).props.onOpenChange(true)
    tree = h.invoke(ProjectsFilter, props)
    h.flushEffects()
    assert.equal(sprintDropdown(tree).props.open, false)
    assert.deepEqual(targets, [])
    h.setPending(false)
    tree = h.invoke(ProjectsFilter, await selectionProps(h, { project: "TKK" }))
    h.flushEffects()
    assert.equal(sprintDropdown(tree).props.open, true)
    assert.deepEqual(targets, ['[data-sprint-id="7401"]'])
    assert.equal(panel.scrollTop, 400)
  })
  it("does not scroll a disabled, empty or hidden Sprint panel", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const empty = await selectionProps(h, {})
    let tree = h.invoke(ProjectsFilter, empty)
    const queries = []
    nodes(tree).find((node) => node.type === "fieldset").props.ref.current = { querySelector: (selector) => {
      queries.push(selector)
      return { parentElement: { hidden: true, getBoundingClientRect() { assert.fail("Hidden panel must not scroll") } } }
    } }
    sprintDropdown(tree).props.onOpenChange(true)
    h.invoke(ProjectsFilter, empty)
    h.flushEffects()
    assert.deepEqual(queries, [])
    const props = { ...empty, project: "SUN" }
    tree = h.invoke(ProjectsFilter, props)
    sprintDropdown(tree).props.onOpenChange(true)
    tree = h.invoke(ProjectsFilter, props)
    h.flushEffects()
    assert.deepEqual(queries, [])
    sprintDropdown(tree).props.onOpenChange(false)
    h.invoke(ProjectsFilter, props)
    h.flushEffects()
    const full = await selectionProps(h, { project: "SUN" })
    tree = h.invoke(ProjectsFilter, full)
    sprintDropdown(tree).props.onOpenChange(true)
    h.invoke(ProjectsFilter, full)
    h.flushEffects()
    assert.deepEqual(queries, ['[data-sprint-id="7517"]'])
  })
  it("distinguishes pending, empty options and invalid scope", async () => {
    const h = harness()
    const { ProjectsFilter } = h.load(FILTER)
    const empty = await selectionProps(h, {})
    assert.match(render(ProjectsFilter, { ...empty, project: "SUN" }), /此專案暫無可檢視的 Sprints/)
    const props = await selectionProps(h, { project: "SUN", sprint: "7401" })
    let tree = h.invoke(ProjectsFilter, props)
    assert.ok(nodes(tree).some((node) => node.props.role === "alert"))
    checkbox(tree, "Sprint 58").props.onChange({ target: { checked: true } })
    tree = h.invoke(ProjectsFilter, props)
    assert.equal(nodes(tree).some((node) => node.props.role === "alert"), false)
    assert.equal(tree.props["aria-busy"], true)
    assert.ok(nodes(tree).some((node) => node.props.role === "status" && node.props.children === "正在更新篩選條件…"))
  })
  it("keeps Planning/Burndown/Capacity single-Sprint behavior unchanged", () => {
    const h = harness()
    const { SprintSelector } = h.load(SELECTOR)
    const sprints = h.load("lib/jira-sprint-data.ts").getProjectSprints("SUN")
    for (const basePath of ["/sprint/planning", "/sprint/burndown", "/sprint/capacity"]) {
      const paths = []
      const props = { basePath, project: "SUN", sprints, selectedSprintId: 7518, onNavigate: (path) => paths.push(path) }
      const tree = h.invoke(SprintSelector, props)
      const dropdown = tree.props.children[1].props.children.props.children[0]
      assert.equal(dropdown.props.label, "Sprint")
      dropdown.props.onOpenChange(true)
      nodes(dropdown).find((node) => node.props.role === "option").props.onClick()
      assert.equal(paths[0], `${basePath}?project=SUN&sprint=7522`)
      assert.equal(h.invoke(SprintSelector, props).props.children[1].props.children.props.children[0].props.open, false)
      assert.doesNotMatch(render(SprintSelector, props), /（必選）|type="checkbox"/)
    }
  })
})

describe("analysis ComingSoon slots", () => {
  it("renders async filters between one subtitle-free header and honest placeholder", async () => {
    const h = harness()
    for (const tree of [await h.page({ project: "SUN", sprint: ["7518", "6823"] }), await h.page({}, TEAM_PAGE)]) {
      assert.equal(tree.props.showDescription, false)
      const markup = renderToStaticMarkup(tree)
      const header = markup.match(/<header\b[^>]*>[\s\S]*?<\/header>/)[0]
      assert.equal((header.match(/<h1\b/g) ?? []).length, 1)
      assert.doesNotMatch(header, /<p\b/)
      assert.ok(markup.includes(tree.props.description))
      assert.ok(markup.indexOf("</header>") < markup.indexOf("<form"))
      assert.ok(markup.indexOf("<form") < markup.indexOf("<section"))
      assert.match(markup, /此功能正在準備中/)
    }
  })
  it("preserves default ComingSoon subtitles outside analytics", () => {
    const { ComingSoon } = harness().load("components/coming-soon.tsx")
    const props = { title: "Other page", description: "Existing description" }
    assert.equal(render(ComingSoon, props), render(ComingSoon, { ...props, filters: null }))
    assert.match(render(ComingSoon, props), /<\/header><section/)
  })
})

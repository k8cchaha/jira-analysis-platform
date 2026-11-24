import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { harness, plain, TEAM_PAGE, TEAM_FILTER as FILTER, nodes, teamOf, dateField, queryButton } from "./helpers/analysis-filter-harness.mjs"

const selectionProps = async (h, params = {}) => (await h.page(params, TEAM_PAGE)).props.filters.props
const range = { from: "2026-10-01", to: "2026-10-21" }
const params = { project: "SUN", ...range }
const selectTeam = (tree, group = "ent-web") => teamOf(tree).props.onGroupsChange([group])
/** The form itself is a host element; find the filter's onSubmit the way the browser would (by walking up). */
const submitForm = (tree) => {
  const form = nodes(tree).find((node) => node.props?.onSubmit)
  assert.ok(form, "the filter form has an onSubmit handler")
  const run = form.props.onSubmit({ preventDefault() {} })
  return Promise.resolve(run).catch((error) => { throw new Error("submit failed: " + (error && error.stack ? error.stack.split("\n").slice(0, 4).join(" | ") : error)) })
}

describe("Team analysis strict dates URL", () => {
  it("distinguishes empty initial state, valid complete dates and canonical URL", async () => {
    const h = harness()
    assert.deepEqual(plain(await selectionProps(h)), { project: null, dateRange: null, error: null })
    const { teamAnalysisFilterHref, teamAnalysisFilterResult } = h.load("lib/team-analysis-filter.ts")
    const selection = await selectionProps(h, params)
    assert.deepEqual(plain(selection), { project: "SUN", dateRange: range, error: null })
    const href = teamAnalysisFilterHref(selection)
    assert.equal(href, "/analytics/story-points?project=SUN&from=2026-10-01&to=2026-10-21")
    assert.deepEqual(plain(teamAnalysisFilterResult(Object.fromEntries(new URLSearchParams(href.split("?")[1])))), plain(selection))
    assert.equal(teamAnalysisFilterResult({ project: "SUN", from: "2024-02-29", to: "2024-02-29" }).error, null)
  })
  for (const invalid of [
    { project: "SUN" }, { project: "sun", ...range }, { project: "UNKNOWN", ...range }, { project: ["SUN"], ...range }, { ...range },
    { project: "SUN", from: range.from }, { project: "SUN", to: range.to }, { project: "SUN", from: [range.from], to: range.to },
    { project: "SUN", from: range.from, to: [range.to, range.to] }, { ...params, mode: "dates" }, { ...params, sprint: "6823" }, { ...params, unknown: "1" },
    { ...params, from: "2026-02-29" }, { ...params, from: "2026-10-22" }, { ...params, from: "2026-10-1" }, { ...params, from: "2000-01-01" },
    { ...params, from: "1".repeat(16_385) },
  ]) it(`rejects ${JSON.stringify(invalid).slice(0, 160)} without turning it into an active default scope`, async () => {
    const h = harness()
    const selection = await selectionProps(h, invalid)
    assert.ok(selection.error)
    assert.equal(selection.dateRange, null)
    const tree = h.invoke(h.load(FILTER).TeamAnalysisFilter, selection)
    assert.equal(queryButton(tree).props.disabled, true)
    assert.ok(nodes(tree).some((node) => node.props.role === "alert"))
    await submitForm(tree)
    // An invalid URL keeps a disabled query; submitting changes no visible state.
    assert.equal(queryButton(h.invoke(h.load(FILTER).TeamAnalysisFilter, selection)).props.disabled, true)
    assert.deepEqual(h.pushes, [])
  })
  it("revalidates serializers rather than trusting typed callers", () => {
    const { teamAnalysisFilterHref } = harness().load("lib/team-analysis-filter.ts")
    const valid = { project: "SUN", dateRange: range, error: null }
    for (const invalid of [
      { ...valid, project: null }, { ...valid, project: "UNKNOWN" }, { ...valid, error: "invalid" }, { ...valid, dateRange: null },
      { ...valid, mode: "dates" }, { ...valid, sprint: "6823" }, { ...valid, selectedSprintIds: [] },
      { ...valid, dateRange: { from: "2026-02-30", to: range.to } }, { ...valid, dateRange: { from: "2000-01-01", to: range.to } },
    ]) assert.throws(() => teamAnalysisFilterHref(invalid), /篩選條件無效/)
  })
})

describe("Team date filter controls and placeholder submission", () => {
  it("awaits searchParams, stays ComingSoon and uses no Sprint/mode controls", async () => {
    const h = harness()
    const page = await h.page(params, TEAM_PAGE)
    assert.equal(page.props.title, "成員分析")
    assert.equal(page.props.showDescription, false)
    assert.equal(page.props.filters.type, h.load(FILTER).TeamAnalysisFilter)
    const tree = h.invoke(page.props.filters.type, page.props.filters.props)
    assert.equal(nodes(tree).some((node) => node.props.type === "radio" || node.props.kind === "sprint"), false)
    const markup = renderToStaticMarkup(tree)
    // Same shortcuts as 工作量分析: 近3月／近6月／今年.
    assert.match(markup, /近3月/)
    assert.match(markup, /近6月/)
    assert.match(markup, /今年/)
    assert.match(markup, /分析區間/)
    assert.doesNotMatch(markup, /近1月|近2月|近7天|近30天/)
    assert.deepEqual(h.pushes, [])
  })

  it("copies the 工作量分析 block: 分析區間 · 團隊 · 專案 on one row with 查詢 on the right", async () => {
    const h = harness()
    const { TeamAnalysisFilter } = h.load(FILTER)
    const props = await selectionProps(h, params)
    const tree = h.invoke(TeamAnalysisFilter, props)
    const section = nodes(tree).find((node) => node.type === "section" && node.props["aria-label"] === "查詢範圍")
    assert.ok(section, "the filter is the same bordered 查詢範圍 block")
    const row = nodes(section).find((node) => node.type === "div" && /flex min-w-0 flex-wrap items-end gap-2/.test(node.props.className ?? ""))
    assert.ok(row, "one wrapping row orders the controls")
    const order = nodes(row).map((node) => node.type?.name ?? node.type).filter((type) => ["DateRangeField", "TeamSelect", "FilterDropdown"].includes(type))
    assert.deepEqual(order, ["DateRangeField", "TeamSelect", "FilterDropdown"])
    const button = nodes(row).find((node) => node.props?.className === "ml-auto shrink-0")
    assert.ok(nodes(button).some((node) => node.type?.name === "SearchButton"), "查詢 sits alone at the row's right edge")
    const { project, team } = h.load("components/filter-dropdown.tsx").FILTER_SELECT_WIDTH_CLASS
    assert.ok(renderToStaticMarkup(tree).includes(`relative ${team}`) || renderToStaticMarkup(tree).includes(project))
    assert.equal(nodes(tree).filter((node) => node.type === "section" && node.props["aria-label"] === "查詢範圍").length, 1)
  })

  it("gates 查詢 until a team's roster is loaded and the analysis range is chosen", async () => {
    const h = harness()
    const { TeamAnalysisFilter } = h.load(FILTER)
    const props = await selectionProps(h, params)
    let tree = h.invoke(TeamAnalysisFilter, props)
    assert.equal(queryButton(tree).props.disabled, true, "no team yet")
    selectTeam(tree)
    tree = h.invoke(TeamAnalysisFilter, props)
    // The harness roster is already loaded; the preset range arrives from DateRangeField.
    const field = dateField(tree)
    field.props.onCommit(range)
    tree = h.invoke(TeamAnalysisFilter, props)
    assert.equal(queryButton(tree).props.disabled, false)
    // Submitting the current render is what the browser does; the component already has the team and range.
    await submitForm(tree)
    tree = h.invoke(TeamAnalysisFilter, props)
    assert.deepEqual(h.pushes, [], "member analysis never navigates")
    assert.equal(h.analyticsRequests.length, 1, "查詢 calls the members API once")
    const url = new URL(h.analyticsRequests[0], "https://fixture.invalid")
    assert.equal(url.pathname, "/api/analytics/members")
    assert.equal(url.searchParams.get("from"), range.from)
    assert.equal(url.searchParams.get("to"), range.to)
    assert.deepEqual(url.searchParams.getAll("group"), ["ent-web"])
  })

  it("disables the query button and shows 查詢中… while the request is in flight", async () => {
    const h = harness()
    const { TeamAnalysisFilter } = h.load(FILTER)
    const props = await selectionProps(h, params)
    let tree = h.invoke(TeamAnalysisFilter, props)
    selectTeam(tree)
    tree = h.invoke(TeamAnalysisFilter, props)
    dateField(tree).props.onCommit(range)
    tree = h.invoke(TeamAnalysisFilter, props)
    const pending = submitForm(tree)
    // `onSubmit` runs through one microtask before it sets loading; read the button after that tick.
    await Promise.resolve()
    const loading = queryButton(h.invoke(TeamAnalysisFilter, props))
    assert.equal(loading.props.loading, true, "the button is busy while the request is in flight")
    await pending
    assert.equal(queryButton(h.invoke(TeamAnalysisFilter, props)).props.loading, false, "loading clears when the response arrives")
  })

  it("starts the range from 近3月 like 工作量分析", async () => {
    const h = harness()
    const { TeamAnalysisFilter } = h.load(FILTER)
    const props = await selectionProps(h)
    let tree = h.invoke(TeamAnalysisFilter, props)
    h.invoke(dateField(tree).type, dateField(tree).props)
    h.flushEffects()
    tree = h.invoke(TeamAnalysisFilter, props)
    assert.deepEqual(plain(dateField(tree).props.value), { from: "2026-07-22", to: "2026-10-21" })
    assert.equal(dateField(tree).props.defaultPreset, "last3Months")
    const calendar = h.invoke(dateField(tree).type, dateField(tree).props)
    h.flushEffects()
    assert.deepEqual(nodes(calendar).filter((node) => node.type === "button" && node.props["aria-pressed"] !== undefined).map((node) => node.props.children), ["近3月", "近6月", "今年"])
  })

  it("applies each shortcut through the shared DateRangeField without navigating", async () => {
    const h = harness()
    const { TeamAnalysisFilter } = h.load(FILTER)
    const props = await selectionProps(h, params)
    for (const label of ["近3月", "近6月", "今年"]) {
      const field = dateField(h.invoke(TeamAnalysisFilter, props))
      const calendar = h.invoke(field.type, field.props)
      h.flushEffects()
      nodes(calendar).find((node) => node.type === "button" && node.props.children === label).props.onClick()
      assert.deepEqual(h.pushes, [], "shortcut only updates the local range")
    }
  })

  it("keeps the team draft local and queries again only when 查詢 is pressed", async () => {
    const h = harness()
    const { TeamAnalysisFilter } = h.load(FILTER)
    const props = await selectionProps(h, params)
    let tree = h.invoke(TeamAnalysisFilter, props)
    selectTeam(tree)
    tree = h.invoke(TeamAnalysisFilter, props)
    dateField(tree).props.onCommit(range)
    tree = h.invoke(TeamAnalysisFilter, props)
    await submitForm(tree)
    assert.equal(h.analyticsRequests.length, 1)
    // Changing the range is only a draft: nothing is requested until 查詢 again.
    dateField(h.invoke(TeamAnalysisFilter, props)).props.onChange({ from: "2026-09-01", to: "2026-09-30" })
    assert.equal(h.analyticsRequests.length, 1)
    assert.deepEqual(h.pushes, [])
  })

  it("shows the loaded roster count and refuses to submit with no members", async () => {
    const h = harness()
    const { TeamAnalysisFilter } = h.load(FILTER)
    const props = await selectionProps(h, params)
    let tree = h.invoke(TeamAnalysisFilter, props)
    selectTeam(tree, "ent-web")
    tree = h.invoke(TeamAnalysisFilter, props)
    assert.match(renderToStaticMarkup(tree), /已選 1 個團隊、1 名不重複成員/)
    selectTeam(tree, "ent-qa1")
    tree = h.invoke(TeamAnalysisFilter, props)
    assert.equal(queryButton(tree).props.disabled, true, "a team with no loaded roster cannot be queried")
  })
})

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { projectsHarness, MODEL, VIEW, plain, nodes, task, resultFixture } from "./helpers/projects-analysis-harness.mjs"

const request = { project: "SUN", sprintIds: [6824, 6823], groups: [], browserTimeZone: "UTC" }
const attribution = { status: "available", byAssignee: [
  { accountId: "account-android", teamId: "ent-android" },
  { accountId: "account-web", teamId: "ent-web" },
  { accountId: "account-sre", teamId: "ent-sre" },
] }
const source = () => [
  task(1, { assigneeAccountId: "account-android", points: 2, actualPoints: 5 }),
  task(2, { assigneeAccountId: "account-android", points: null, actualPoints: 0 }),
  task(3, { assigneeAccountId: "account-web", points: 6, actualPoints: null, issueType: "QA-Task" }),
  task(4, { points: 4, actualPoints: 9 }),
  task(5, { assigneeAccountId: "account-sre", resolvedDate: null, points: null, actualPoints: 7 }),
  task(6, { assigneeAccountId: "account-web", resolvedDate: "2026-05-12", points: 100, actualPoints: 100 }),
  task(7, { assigneeAccountId: "account-android", resolvedDate: "2026-05-12", sprintIds: [6824], points: 3, actualPoints: 8 }),
]
const chart = (tree) => nodes(tree).find((n) => n.type?.name === "ProjectsTrendChart" && n.props.id === "output")
const panel = (tree) => nodes(tree).find((n) => n.props["data-topic"] === "output")
const header = (tree) => nodes(panel(tree)).find((n) => n.type?.name === "Panel")
const controls = (tree) => nodes(header(tree).props.controls)
// 全團隊總覽／各團隊產出 is the output-view segmented control.
const viewControl = (tree) => controls(tree).find((n) => Array.isArray(n.props?.choices) && n.props.choices.includes("all-teams"))
const setTotal = (tree, show) => viewControl(tree).props.onChange(show ? "all-teams" : "by-team")
const OVERVIEW = "__overview__"
// 全團隊總覽 has no total series any more: the chart sums the visible teams itself.
const stackedTotals = (tree, kind, index) => nodes(tree).filter((n) => n.props["data-stack-kind"] === kind && n.props["data-stack-index"] === index).map((n) => n.props["data-stack-total"])[0]
const totalShown = (tree) => viewControl(tree).props.value === "all-teams"
const totalDisabled = (tree) => viewControl(tree).props.disabled === true
const unitControl = (tree) => controls(tree).find((n) => Array.isArray(n.props?.choices) && !n.props.choices.includes("all-teams"))
// The unit switch only exists in 各團隊產出; in 全團隊總覽 both units are charted together.
const setUnit = (tree, unit) => { setTotal(tree, false); unitControl(tree).props.onChange(unit) }
// Keep 全團隊總覽 on while changing the unit (only possible by visiting 各團隊產出, where the switch lives).
const qaCheckbox = (tree) => controls(tree).find((n) => n.props?.type === "checkbox")
const plotted = (tree) => nodes(tree).filter((n) => n.props["data-series"])
const readout = (tree) => nodes(tree).find((n) => n.props.role === "region")
const legends = (tree) => nodes(tree).filter((n) => n.type === "button" && n.props["aria-label"]?.startsWith("顯示 "))
const target = (tree, index = 0) => nodes(tree).find((n) => n.props["data-sprint-index"] === index)
const text = (tree) => renderToStaticMarkup(tree).replace(/<[^>]*>/g, "")
const localDetail = (tree) => nodes(tree).find((n) => n.props.description === "本次完整查詢資料的唯讀明細，不會另查 Jira。")
function exactLink(tree, label, ids) {
  const matches = [...renderToStaticMarkup(tree).matchAll(/<a\b([^>]*)>/g)].filter((m) => m[1].includes(label))
  assert.ok(matches.length, `No ${label} link`)
  for (const match of matches) {
    const href = match[1].match(/href="([^"]*)"/)[1].replaceAll("&amp;", "&")
    assert.equal(new URL(href).searchParams.get("jql"), `id in (${ids.join(", ")}) ORDER BY key ASC`)
    assert.match(match[1], /target="_blank"/)
    assert.match(match[1], /rel="noopener noreferrer"/)
  }
}
function setup(options = {}) {
  const h = projectsHarness(), Component = h.load(VIEW).ProjectsAnalysisView
  // A fresh fixture per scenario keeps the simulated component state independent between tests.
  const result = options.result ?? resultFixture(h.load(MODEL), options.tasks ?? source(), options.request ?? request, options.attribution ?? attribution)
  // The page now opens in 全團隊總覽; per-team specs start from 各團隊產出 unless they ask for the default.
  const render = () => h.invoke(Component, { result })
  // The page now opens in 全團隊總覽; per-team specs ask for 各團隊產出 explicitly (defaults are covered separately).
  if (options.view !== "all-teams") viewControl(render()).props.onChange("by-team")

  const draw = () => h.invoke(chart(render()).type, chart(render()).props)
  const toggle = (label) => legends(draw()).find((n) => n.props["aria-label"] === `顯示 ${label} 產出`).props.onClick()
  return { h, result, Component, render, draw, toggle }
}

describe("Projects output zero-team filtering", () => {
  const switchingTasks = () => [
    task(1, { assigneeAccountId: "account-android", points: 2, actualPoints: 0 }),
    task(2, { assigneeAccountId: "account-sre", points: 0, actualPoints: 7 }),
    task(3, { assigneeAccountId: "account-web", points: null, actualPoints: 5 }),
    task(4, { points: 0, actualPoints: 0 }),
  ]
  it("recomputes visible-team totals per unit while 全團隊總覽 sums exactly the plotted teams", () => {
    const { render, draw, h } = setup({ tasks: switchingTasks(), request: { ...request, sprintIds: [6823] } })
    const series = () => chart(render()).props.series
    const totals = (kind) => nodes(draw()).filter((n) => n.props["data-stack-kind"] === kind && n.props["data-stack-index"] === 0).map((n) => n.props["data-stack-total"])
    assert.deepEqual(plain(series().map((s) => s.id)), ["ent-android", "ent-web"])
    setTotal(render(), true)
    assert.deepEqual(totals("points"), [2], "Android 2 SP; Web's is unknown so it is not added")
    assert.deepEqual(totals("actual"), [5], "Web 5 Actual SP; Android 0 and SRE 7 (no SP) do not change it")
    // The unit switch lives in 各團隊產出; switching there must not invent a total series.
    setTotal(render(), false)
    unitControl(render()).props.onChange("actualSp")
    assert.deepEqual(plain(series().map((s) => s.id)), ["ent-web", "ent-sre"])
    setTotal(render(), true)
    assert.deepEqual(plain(series().map((s) => s.id)), ["ent-web", "ent-sre"], "no total series is pushed into the legend")
    assert.deepEqual(totals("points"), [], "no plotable Story Point total, so no estimate bar")
    assert.deepEqual(totals("actual"), [12], "Web 5 + SRE 7 Actual SP")
    assert.equal(chart(render()).props.stackedTotalId, OVERVIEW)
    const tile = nodes(panel(render())).find((n) => n.props["data-summary-tile"] !== undefined)
    exactLink(tile, "全範圍總產出 Actual SP，", ["1", "2", "3", "4"])
    assert.equal(h.requests.length, 0)
  })
  it("restores eligibility with fixed identities and preserves manual hiding through unit changes", () => {
    const { render, draw, toggle } = setup({ tasks: switchingTasks() })
    const identity = () => chart(render()).props.series.map((s) => [s.id, s.color, plain(s.encoding)])
    const original = identity(), key = chart(render()).key
    target(draw(), 1).props.onClick()
    toggle("Android")
    setUnit(render(), "actualSp")
    assert.equal(legends(draw()).find((n) => n.props["aria-label"] === "顯示 SRE 產出").props["aria-pressed"], true)
    toggle("SRE")
    setUnit(render(), "sp")
    assert.deepEqual(identity(), original)
    assert.equal(legends(draw()).find((n) => n.props["aria-label"] === "顯示 Android 產出").props["aria-pressed"], false)
    assert.equal(chart(render()).key, key)
    assert.equal(nodes(draw()).find((n) => n.props["data-selection-index"] !== undefined).props["data-selection-index"], 1)
    setUnit(render(), "actualSp")
    assert.equal(legends(draw()).find((n) => n.props["aria-label"] === "顯示 SRE 產出").props["aria-pressed"], false)
    assert.ok(!plotted(draw()).some((n) => n.props["data-series"] === "ent-sre"))
    assert.equal(chart(render()).props.series.find((s) => s.id === "ent-sre").encoding.shape, 5)
  })
  it("keeps the exact output cohort when QA-Task is unchecked: only completed, in-window work leaves the sum", () => {
    const tasks = [
      task(1, { assigneeAccountId: "account-android", points: 2 }),
      task(2, { assigneeAccountId: "account-web", points: 3 }),
      task(3, { assigneeAccountId: "account-sre", points: 5, issueType: "QA-Task" }),
      task(4, { assigneeAccountId: "account-android", points: 100, resolvedDate: null }),
      task(5, { assigneeAccountId: "account-web", points: 50, resolvedDate: "2026-06-30" }),
    ]
    const { render } = setup({ tasks, request: { ...request, sprintIds: [6823] } })
    const values = () => Object.fromEntries(chart(render()).props.series.map((s) => [s.id, plain(s.values.map((v) => v.value))]))
    assert.deepEqual(values(), { "ent-android": [2], "ent-web": [3], "ent-sre": [5] }, "unfinished and out-of-window work never counts as output")
    qaCheckbox(render()).props.onChange({ target: { checked: false } })
    assert.deepEqual(values(), { "ent-android": [2], "ent-web": [3] }, "unchanged for teams without QA; only the QA-only team drops")
  })
  it("keeps unknown and partially filled zero totals instead of inferring complete zero", () => {
    const { render, draw } = setup({ tasks: [
      task(1, { assigneeAccountId: "account-android", points: 0, actualPoints: 0 }),
      task(2, { assigneeAccountId: "account-android", points: null, actualPoints: null }),
      task(3, { assigneeAccountId: "account-web", points: null, actualPoints: null }),
      task(4, { assigneeAccountId: "account-sre", points: 0, actualPoints: 0 }),
    ] })
    for (const unit of ["sp", "actualSp"]) {
      unitControl(render()).props.onChange(unit)
      const series = chart(render()).props.series
      assert.deepEqual(plain(series.map((s) => s.id)), ["ent-android", "ent-web"])
      assert.deepEqual(plain(series[0].values.map((v) => [v.value, v.partial])), [[0, true], [0, false]])
      assert.deepEqual(plain(series[1].values.map((v) => v.value)), [null, 0])
      assert.equal(legends(draw()).length, 2)
      exactLink(series[0].values[0].note, "未填張數", ["2"])
    }
    setTotal(render(), true)
    // A known total of zero draws no bar (same as before), but the partial curve keeps its hollow marker.
    assert.equal(nodes(draw()).filter((n) => n.props["data-stack-index"] !== undefined).length, 0)
    const pointsCurve = plotted(draw()).find((n) => String(n.props.className ?? "").includes("projects-trend-series-points"))
    assert.ok(nodes(pointsCurve).some((n) => n.type?.name === "Marker" && n.props.partial), "partial total stays hollow")
  })
  it("distinguishes automatically all-zero teams from manual hiding and restores nonzero Actual", () => {
    // The simulated component keeps one state, so the default view is only observable on a fresh mount.
    const { render, draw } = setup({ tasks: [task(1, { points: 0, actualPoints: 8 })], attribution: { status: "available", byAssignee: [] }, view: "all-teams" })
    for (const checked of [true, true]) {
      setTotal(render(), checked)
      assert.equal(chart(render()).props.series.length, 0)
      assert.equal(legends(draw()).length, 0)
      assert.equal(plotted(draw()).length, 0)
      assert.equal(readout(draw()), undefined)
      assert.equal(nodes(draw()).filter((n) => n.props["data-sprint-index"] !== undefined).length, 0)
      assert.match(text(draw()), /所選 Sprint 的團隊點數皆為 0/)
      assert.doesNotMatch(text(draw()), /請點選圖例加入|全部未填/)
    }
    setTotal(render(), false)
    unitControl(render()).props.onChange("actualSp")
    setTotal(render(), true)
    assert.deepEqual(plain(chart(render()).props.series.map((s) => s.id)), ["other"], "no total series in the series list")
    assert.deepEqual(nodes(draw()).filter((n) => n.props["data-stack-kind"] === "actual").map((n) => n.props["data-stack-total"]), [8])
    setTotal(render(), false)
    unitControl(render()).props.onChange("sp")
    assert.equal(chart(render()).props.series.length, 0)
    const empty = setup({ tasks: [], attribution: { status: "available", byAssignee: [] } })
    assert.match(text(empty.draw()), /所選 Sprint 的團隊點數皆為 0/)
    const unavailable = setup({ tasks: [task(1, { points: 0, actualPoints: 0 })], attribution: { status: "unavailable", reason: "lookup_failed" } })
    assert.equal(chart(unavailable.render()).props.series[0].values[0].value, 0)
    assert.ok(plotted(unavailable.draw()).some((n) => n.props["data-series"] === "scope-output"))
  })
})

describe("Projects per-team completed output", () => {
  it("defaults to SP, an unchecked total, and only nonzero or incomplete teams without the removed description", () => {
    const { render, draw, h } = setup(), tree = render()
    assert.equal(header(tree).props.description, undefined)
    assert.equal(unitControl(tree).props.value, "sp")
    assert.deepEqual(plain(unitControl(tree).props.choices), ["sp", "actualSp"])
    assert.equal(totalShown(tree), false)
    assert.equal(totalDisabled(tree), false)
    assert.equal(chart(tree).props.series.length, 3)
    assert.equal(legends(draw()).length, 3)
    assert.ok(legends(draw()).every((n) => n.props.type === "button" && n.props["aria-pressed"]))
    assert.equal(plotted(draw()).length, 3)
    assert.doesNotMatch(text(tree), /Dev-Task＋QA-Task；Resolved 日/)
    assert.equal(h.requests.length, 0)
  })
  it("filters QA-Task from output charts, tables and details when 含 QA-Task is unchecked", () => {
    const { render, draw, h } = setup()
    const detailIds = () => [...renderToStaticMarkup(localDetail(render()).props.title).matchAll(/id%20in%20\(([^)]*)\)/g)].flatMap((m) => decodeURIComponent(m[1]).split(", ")).sort()
    // Default: QA-Task included, matching the server summary.
    assert.equal(qaCheckbox(render()).props.checked, true)
    assert.equal(chart(render()).props.series.find((s) => s.id === "ent-web").values[0].value, 6)
    // Unchecked: the QA-Task (task 3, 6 SP) leaves every output figure, the table and its detail cohort.
    qaCheckbox(render()).props.onChange({ target: { checked: false } })
    assert.equal(qaCheckbox(render()).props.checked, false)
    // Web's only Sprint-1 completion was the QA-Task, so the team drops out; Android is unchanged.
    assert.deepEqual(plain(chart(render()).props.series.map((x) => [x.id, x.values.map((v) => v.value)])), [["ent-android", [2, 3]], ["other", [4, 0]]])
    setTotal(render(), true)
    const points = nodes(draw()).filter((n) => n.props["data-stack-kind"] === "points").map((n) => n.props["data-stack-total"])
    assert.deepEqual(points, [6, 3], "Android 2 + Other 4, then Android 3 + Other 0")
    // The separate 顯示團隊合計 line is gone; the teams themselves carry the links.
    assert.equal(chart(render()).props.series.some((s) => s.id === "visible-total"), false)
    const androidTotal = chart(render()).props.series.find((s) => s.id === "ent-android")
    exactLink(androidTotal.values[0].readout, "Android SP，", ["1", "2"])
    // Other topics keep their own server-backed cohorts.
    assert.equal(h.requests.length, 0)
  })
  it("opens in 全團隊總覽 and hides the SP／Actual SP switch until 各團隊產出 is chosen", () => {
    const { render } = setup({ view: "all-teams" })
    assert.equal(viewControl(render()).props.value, "all-teams", "全團隊總覽 is the default")
    assert.equal(unitControl(render()), undefined, "no unit switch while both units are charted")
    viewControl(render()).props.onChange("by-team")
    assert.equal(viewControl(render()).props.value, "by-team")
    assert.deepEqual(plain(unitControl(render()).props.choices), ["sp", "actualSp"])
    viewControl(render()).props.onChange("all-teams")
    assert.equal(unitControl(render()), undefined)
  })
  it("exposes 全團隊總覽／各團隊產出 as a segmented control instead of the old 顯示總量 checkbox", () => {
    const { render, draw } = setup(), tree = render()
    const control = viewControl(tree)
    assert.deepEqual(plain(control.props.choices), ["all-teams", "by-team"])
    assert.deepEqual(plain(control.props.labels), { "all-teams": "全團隊總覽", "by-team": "各團隊產出" })
    assert.equal(control.props.value, "by-team")
    assert.equal(nodes(header(tree).props.controls).some((n) => n.props?.children === "顯示總量"), false)
    // Switching to 全團隊總覽 shows the visible-team union and stacks bars exactly like the old checked mode.
    control.props.onChange("all-teams")
    assert.equal(viewControl(render()).props.value, "all-teams")
    assert.equal(chart(render()).props.stackedTotalId, OVERVIEW)
    assert.ok(nodes(draw()).some((n) => n.props["data-stack-index"] !== undefined))
    assert.equal(nodes(draw()).filter((n) => n.type === "path" && n.props.className === "projects-trend-line").length, 2)
    viewControl(render()).props.onChange("by-team")
    assert.equal(chart(render()).props.stackedTotalId, undefined)
    assert.equal(nodes(draw()).filter((n) => n.props["data-stack-index"] !== undefined).length, 0)
  })
  it("renders exact Dev+QA completed team values and Other, excluding entirely zero teams and unfinished/outside work", () => {
    const { render } = setup(), values = Object.fromEntries(chart(render()).props.series.map((s) => [s.id, plain(s.values.map((v) => v.value))]))
    assert.deepEqual(values["ent-android"], [2, 3])
    assert.deepEqual(values["ent-web"], [6, 0])
    assert.deepEqual(values.other, [4, 0])
    assert.equal(values["ent-sre"], undefined)
    const android = chart(render()).props.series.find((s) => s.id === "ent-android")
    assert.equal(android.values[0].partial, true)
    exactLink(android.values[0].readout, "Android SP，", ["1", "2"])
    exactLink(android.values[0].note, "已填張數", ["1"])
    exactLink(android.values[0].note, "未填張數", ["2"])
    exactLink(android.values[0].note, "完整率母體", ["1", "2"])
  })
  it("adds an all-teams-only exact visible-team union and retains all-null Actual instead of adding nullable sums", () => {
    const { render, draw, toggle } = setup()
    setTotal(render(), true)
    const spTotals = () => nodes(draw()).filter((n) => n.props["data-stack-kind"] === "points").map((n) => n.props["data-stack-total"])
    assert.deepEqual(spTotals(), [12, 3], "the union of visible teams, Sprint 58 then Sprint 59")
    assert.equal(legends(draw()).length, 3, "the total is not a legend entry")
    exactLink(chart(render()).props.series.find((s) => s.id === "ent-android").values[0].readout, "Android SP，", ["1", "2"])
    toggle("Android"); toggle("其他")
    assert.deepEqual(spTotals(), [6], "Sprint 59's union is 0, so no bar is drawn")
    // With a unit that has unknown values, the overview keeps the estimate's own coverage note on its team series.
    const android = chart(render()).props.series.find((s) => s.id === "ent-android")
    exactLink(android.values[1].note, "完整率母體", ["7"])
    assert.equal(chart(render()).props.series.some((s) => s.id === "visible-total"), false, "no total series exists")
  })
  it("checked mode stacks only positive known team amounts beneath a total-only curve and restores team lines when unchecked", () => {
    const { render, draw } = setup()
    setTotal(render(), true)
    assert.equal(chart(render()).props.stackedTotalId, OVERVIEW)
    const tree = draw(), columns = nodes(tree).filter((n) => n.props["data-stack-index"] !== undefined)
    // Every Sprint draws two side-by-side bars: the Story Point estimate and the Actual SP.
    const actual = columns.filter((n) => n.props["data-stack-kind"] === "actual"), points = columns.filter((n) => n.props["data-stack-kind"] === "points")
    assert.deepEqual(actual.map((n) => n.props["data-stack-total"]), [14, 8], "Android 5 + Web null + Other 9 and Android 8 + Web 0 + Other 0")
    assert.deepEqual(points.map((n) => n.props["data-stack-total"]), [12, 3])
    const segments = nodes(actual[0]).filter((n) => n.props["data-stack-value"] !== undefined)
    assert.deepEqual(segments.map((n) => [n.props["data-series"], n.props["data-stack-value"]]), [["ent-android", 5], ["other", 9]])
    assert.deepEqual(nodes(points[0]).filter((n) => n.props["data-stack-value"] !== undefined).map((n) => [n.props["data-series"], n.props["data-stack-value"]]), [["ent-android", 2], ["ent-web", 6], ["other", 4]])
    for (const segment of [...segments, ...nodes(points[0]).filter((n) => n.props["data-stack-value"] !== undefined)]) assert.ok(!nodes(segment).some((n) => n.type?.name === "Marker" || n.props.className === "projects-trend-line"))
    assert.ok(nodes(points[0]).some((n) => String(n.props.className ?? "").includes("projects-stack-segment-points")), "estimates use the lighter style")
    // Both totals are drawn as curves: Story Points and Actual Story Points, each centred on its own bar.
    const curves = plotted(tree).filter((n) => n.props["data-series"] === "visible-total" || String(n.props["data-series-unit"] ?? "").length)
    const lineGroups = plotted(tree).filter((n) => String(n.props.className ?? "").includes("projects-trend-series"))
    assert.deepEqual(lineGroups.map((n) => n.props["data-series-unit"]), ["points", "actualPoints"], "one curve per unit, estimates first")
    const [pointsLine, actualLine] = lineGroups.map((group) => ({ color: group.props.style["--series-color"], dash: nodes(group).find((n) => n.props.className === "projects-trend-line")?.props.strokeDasharray }))
    assert.equal(pointsLine.color, "var(--viz-points)", "Story Points uses the light blue token")
    assert.ok(pointsLine.dash, "Story Points is dashed")
    assert.equal(actualLine.color, "var(--viz-actual)", "Actual Story Points uses the solid blue token")
    assert.equal(actualLine.dash, undefined, "Actual Story Points is solid")
    const pointsCurve = plotted(tree).find((n) => n.props["data-series-unit"] === "points"), actualCurve = plotted(tree).find((n) => n.props["data-series-unit"] === "actualPoints")
    const pointsMarkers = nodes(pointsCurve).filter((n) => n.type?.name === "Marker"), actualMarkers = nodes(actualCurve).filter((n) => n.type?.name === "Marker")
    assert.equal(pointsMarkers.length, 2)
    assert.equal(actualMarkers.length, 2)
    assert.equal(pointsMarkers[0].props.partial, true, "the estimate has an unfilled Sprint, so its marker is hollow")
    for (const column of columns) {
      const bars = nodes(column).filter((n) => n.props.className === "projects-stack-fill")
      assert.equal(column.props.transform, pointsCurve.props.transform)
      assert.ok(bars.every((n) => n.props.width <= 24 && n.props.height > 0))
      assert.ok(bars.length > 0)
    }
    assert.equal(curves.length, 2)
    // The two bars of a Sprint sit left/right of its marker line, and the estimate bar is never the darker one.
    const center = (column) => { const bar = nodes(column).find((n) => n.props.className === "projects-stack-fill"); return bar.props.x + bar.props.width / 2 }
    assert.ok(center(points[0]) < center(actual[0]), "the estimate bar sits left of the actual bar")
    assert.ok(center(actual[0]) - center(points[0]) <= 72, "both bars stay inside the Sprint slot")
    assert.equal(nodes(tree).filter((n) => n.props.className === "projects-trend-line").length, 2, "one curve per unit")
    assert.equal(nodes(tree).find((n) => n.props.className === "projects-trend-unit-title").props.children, "SP / Actual SP")
    setTotal(render(), false)
    assert.equal(chart(render()).props.stackedTotalId, undefined)
    assert.equal(nodes(draw()).filter((n) => n.props["data-stack-index"] !== undefined).length, 0)
    assert.equal(plotted(draw()).length, 3)
  })
  it("keeps the selected Sprint and stable team identities through checked/unchecked transitions", () => {
    const { render, draw, toggle } = setup()
    target(draw(), 1).props.onClick()
    const identity = () => chart(render()).props.series.map((s) => [s.id, s.color, plain(s.encoding)])
    const before = identity(), key = chart(render()).key
    for (const checked of [true, false, true]) {
      setTotal(render(), checked)
      assert.equal(nodes(draw()).find((n) => n.props["data-selection-index"] !== undefined).props["data-selection-index"], 1)
      assert.equal(nodes(draw()).find((n) => n.props["data-pill-index"] !== undefined).props["data-pill-index"], 1)
      assert.equal(nodes(draw()).find((n) => n.props["data-selection-index"] !== undefined).props["data-selection-index"], 1)
      assert.deepEqual(identity(), before)
      assert.equal(chart(render()).key, key)
    }
    setTotal(render(), false)
    unitControl(render()).props.onChange("actualSp")
    toggle("Android")
    assert.ok(!plotted(draw()).some((n) => n.props["data-series"] === "ent-android"))
    assert.deepEqual(identity(), before)
    assert.equal(nodes(draw()).find((n) => n.props["data-selection-index"] !== undefined).props["data-selection-index"], 1)
  })
  it("does not let empty-team zeros fabricate bars or total markers when the visible union is all missing", () => {
    const { render, draw, toggle } = setup()
    setUnit(render(), "actualSp")
    setTotal(render(), true)
    toggle("Android"); toggle("其他")
    const tree = draw()
    assert.equal(nodes(tree).filter((n) => n.props["data-stack-index"] === 0 && n.props["data-stack-kind"] === "actual").length, 0)
    // The Story Point estimate is still known for Sprint 58, so that curve keeps its point; Actual SP has none yet.
    assert.deepEqual(nodes(plotted(tree).find((n) => n.props["data-series-unit"] === "points")).filter((n) => n.type?.name === "Marker").map((n) => n.key), ["0", "1"])
    const missing = setup({ tasks: [task(1, { assigneeAccountId: "account-android", points: null, actualPoints: null })], attribution: { status: "available", byAssignee: [attribution.byAssignee[0]] } })
    setTotal(missing.render(), true)
    assert.equal(nodes(missing.draw()).filter((n) => n.props["data-stack-index"] !== undefined).length, 0)
    // Second Sprint is genuinely empty, so verify the all-missing first Sprint alone.
    const c = chart(missing.render())
    const onlyMissing = missing.h.invoke(c.type, { ...c.props, sprints: c.props.sprints.slice(0, 1), series: c.props.series.map((s) => ({ ...s, values: s.values.slice(0, 1) })) })
    assert.equal(nodes(onlyMissing).filter((n) => n.props["data-bar-value"] !== undefined).length, 0)
    assert.equal(nodes(onlyMissing).filter((n) => n.type?.name === "Marker").length, 0)
  })
  it("single Sprint checked mode has one stack and one total marker, while complete-zero teams are filtered", () => {
    const { render, draw } = setup({ request: { ...request, sprintIds: [6823] }, tasks: source().slice(0, 6) })
    setTotal(render(), true)
    assert.equal(nodes(draw()).filter((n) => n.props["data-stack-index"] !== undefined).length, 2, "one estimate bar and one actual bar")
    assert.equal(nodes(draw()).filter((n) => n.type?.name === "Marker").length, 2, "one marker per unit")
    assert.equal(nodes(draw()).filter((n) => n.props.className === "projects-trend-line").length, 0)
    const zero = setup({ request: { ...request, sprintIds: [6823] }, tasks: [task(1, { points: 0, actualPoints: 0 })], attribution: { status: "available", byAssignee: [] } })
    setTotal(zero.render(), true)
    assert.equal(nodes(zero.draw()).filter((n) => n.props["data-stack-index"] !== undefined).length, 0)
    assert.equal(nodes(zero.draw()).filter((n) => n.type?.name === "Marker").length, 0)
    assert.match(text(zero.draw()), /所選 Sprint 的團隊點數皆為 0/)
    assert.doesNotMatch(text(zero.draw()), /全部未填|請點選圖例加入/)
  })
  it("uses scoped pattern IDs and only the total for endpoint labels in stacked mode", () => {
    const { render, draw } = setup({ request: { ...request, groups: ["ent-android"] }, tasks: source().filter((t) => t.assigneeAccountId === "account-android"), attribution: { status: "available", byAssignee: [attribution.byAssignee[0]] } })
    setTotal(render(), true)
    const tree = draw()
    const ids = nodes(tree).filter((n) => n.type === "pattern").map((n) => n.props.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(ids.every((id) => id.startsWith("projects-stack-")))
    assert.deepEqual(nodes(tree).filter((n) => n.props.className === "projects-trend-end-label").map((n) => n.props.children), [], "stacked overview draws no end label")
    assert.equal(nodes(tree).filter((n) => n.type?.name === "FillKey").length, 1)
  })
  it("removes only plot/readout/actions, preserving recoverable legends, full catalog and full reconciliation tables", () => {
    const { render, draw, toggle } = setup()
    target(draw()).props.onClick()
    const originalTable = nodes(panel(render())).filter((n) => n.type === "table").map(text)
    toggle("Android")
    assert.equal(chart(render()).props.series.length, 3)
    assert.equal(plotted(draw()).length, 2)
    assert.ok(!plotted(draw()).some((n) => n.props["data-series"] === "ent-android"))
    assert.doesNotMatch(text(readout(draw())), /Android：|Android SP/)
    assert.ok(!nodes(draw()).some((n) => n.type === "button" && n.props.children === "Android SP，查看工作單明細"))
    assert.equal(legends(draw())[0].props["aria-pressed"], false)
    assert.deepEqual(nodes(panel(render())).filter((n) => n.type === "table").map(text), originalTable)
    toggle("Android")
    assert.equal(plotted(draw()).length, 3)
    assert.equal(legends(draw())[0].props["aria-pressed"], true)
  })
  it("retains fixed hue/shape/dash identities, chart key and selected Sprint through hide and unit switching", () => {
    const { render, draw, toggle } = setup()
    const identity = () => chart(render()).props.series.map((s) => [s.id, s.color, plain(s.encoding)])
    const original = identity(), originalKey = chart(render()).key
    assert.equal(new Set(original.map((s) => JSON.stringify(s.slice(1)))).size, 3)
    target(draw(), 1).props.onClick()
    toggle("Android")
    setUnit(render(), "actualSp")
    assert.deepEqual(identity(), original)
    assert.equal(chart(render()).key, originalKey)
    assert.equal(nodes(draw()).find((n) => n.props["data-selection-index"] !== undefined).props["data-selection-index"], 1)
    const web = plotted(draw()).find((n) => n.props["data-series"] === "ent-web")
    assert.equal(web.props.style["--series-color"], "var(--viz-type-5)")
    assert.ok(nodes(web).filter((n) => n.type?.name === "Marker").every((n) => n.props.shape === 5))
  })
  it("all-hidden state has no fake total/zero paths/readout/actions and every team can be restored", () => {
    const { render, draw, toggle } = setup()
    setTotal(render(), true)
    for (const legend of legends(draw())) legend.props.onClick()
    assert.equal(plotted(draw()).length, 0)
    assert.equal(chart(render()).props.series.length, 3)
    assert.equal(readout(draw()), undefined)
    assert.equal(nodes(draw()).filter((n) => n.props["data-selection-index"] !== undefined || n.props["data-pill-index"] !== undefined || n.props.className === "projects-trend-focus-cue").length, 0)
    assert.equal(nodes(draw()).filter((n) => n.props["data-sprint-index"] !== undefined).length, 0)
    assert.match(text(draw()), /尚未顯示團隊，請點選圖例加入/)
    assert.equal(legends(draw()).length, 3)
    assert.ok(legends(draw()).every((n) => !n.props["aria-pressed"]))
    assert.equal(nodes(draw()).filter((n) => n.type === "path" && n.props.className === "projects-trend-line").length, 0)
    toggle("Web")
    const seriesIds = () => plotted(draw()).filter((n) => String(n.props.className ?? "").includes("projects-trend-series")).map((n) => n.props["data-series-unit"] ?? n.props["data-series"])
    assert.deepEqual(seriesIds(), ["points", "actualPoints"], "only the two total curves come back; the hidden Web team stays hidden")
    assert.equal(chart(render()).props.legendToggle.visibleIds.includes("ent-web"), true)
    assert.equal(chart(render()).props.stackedTotalId, OVERVIEW)
    assert.deepEqual(nodes(draw()).filter((n) => n.props["data-stack-kind"] === "points").map((n) => n.props["data-stack-total"]), [6], "just the Web team")
  })
  it("clears a stale team detail when the visible teams or the output view change", () => {
    const { render, toggle } = setup()
    // Open a team detail from a link inside the chart's data (the 工作單明細 button row was removed).
    const android = () => chart(render()).props.series.find((s) => s.id === "ent-android")
    android().values[0].actions[0].onClick()
    exactLink(localDetail(render()).props.title, "明細張數", ["1", "2"])
    toggle("Android")
    assert.equal(localDetail(render()), undefined, "hiding the team drops its detail")
    android().values[0].actions[0].onClick()
    setTotal(render(), true)
    assert.equal(localDetail(render()), undefined, "switching to 全團隊總覽 drops the per-team detail")
  })
  it("keeps output options across topics and resets them for a new mounted result without fetching", () => {
    const { render, draw, toggle, h, Component, result } = setup()
    unitControl(render()).props.onChange("actualSp")
    toggle("Android")
    for (const label of ["開發品質", "總產出"]) nodes(render()).find((n) => n.props.role === "tab" && n.props.children === label).props.onClick({ currentTarget: { focus() {}, scrollIntoView() {} } })
    assert.equal(unitControl(render()).props.value, "actualSp")
    assert.equal(legends(draw())[0].props["aria-pressed"], false)
    const next = projectsHarness(), tree = next.invoke(next.load(VIEW).ProjectsAnalysisView, { result })
    // A new result mounts with the page defaults: 全團隊總覽, every team visible.
    assert.equal(totalShown(tree), true, "全團隊總覽 is the default")
    assert.equal(unitControl(tree), undefined, "the unit switch is hidden in 全團隊總覽")
    assert.equal(chart(tree).props.legendToggle.visibleIds.length, 3)
    assert.equal(h.requests.length, 0)
    assert.ok(Component)
  })
  it("single Sprint uses observation markers and a scope-wide summary that follows only the point switch", () => {
    const { render, draw, toggle } = setup({ request: { ...request, sprintIds: [6823] }, tasks: source().slice(0, 6) })
    assert.equal(nodes(draw()).filter((n) => n.type === "path" && n.props.className === "projects-trend-line").length, 0)
    assert.ok(nodes(draw()).some((n) => n.type?.name === "Marker"))
    toggle("Android")
    setUnit(render(), "actualSp")
    const tile = nodes(panel(render())).find((n) => n.props["data-summary-tile"] !== undefined)
    assert.match(text(tile), /全範圍總產出14 Actual SP/)
    exactLink(tile, "全範圍總產出 Actual SP，", ["1", "2", "3", "4"])
  })
  it("selected candidates retain global encodings and never add Other or unrelated teams", () => {
    const selected = { ...request, groups: ["ent-web", "ent-be1"] }
    const tasks = [task(1, { assigneeAccountId: "account-web" })]
    const { render, draw } = setup({ request: selected, tasks, attribution: { status: "available", byAssignee: [{ accountId: "account-web", teamId: "ent-web" }] } })
    assert.deepEqual(plain(chart(render()).props.series.map((s) => [s.id, s.color, s.encoding.shape])), [["ent-web", "type-5", 5]])
    assert.equal(legends(draw()).length, 1)
  })
  it("unavailable and legacy attribution do not fake teams; full-scope point switching and exact links remain", () => {
    for (const reason of ["lookup_failed", "not_provided"]) {
      const { render, draw } = setup({ attribution: { status: "unavailable", reason } })
      assert.equal(totalDisabled(render()), true)
      assert.equal(legends(draw()).length, 0)
      assert.match(text(panel(render())), /團隊歸屬資料無法取得/)
      assert.equal(chart(render()).props.series[0].id, "scope-output")
      assert.equal(chart(render()).props.series[0].values[0].value, 12)
      setUnit(render(), "actualSp")
      assert.equal(chart(render()).props.series[0].values[0].value, 14)
      exactLink(chart(render()).props.series[0].values[0].readout, "全範圍總產出 Actual SP，", ["1", "2", "3", "4"])
    }
  })
})

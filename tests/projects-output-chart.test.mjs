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
const checkbox = (tree) => controls(tree).find((n) => n.type === "input" && n.props.type === "checkbox")
const unitControl = (tree) => controls(tree).find((n) => n.type?.name === "Units")
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
  const result = resultFixture(h.load(MODEL), options.tasks ?? source(), options.request ?? request, options.attribution ?? attribution)
  const render = () => h.invoke(Component, { result })
  const draw = () => h.invoke(chart(render()).type, chart(render()).props)
  const toggle = (label) => legends(draw()).find((n) => n.props["aria-label"] === `顯示 ${label} 輸出`).props.onClick()
  return { h, result, Component, render, draw, toggle }
}

describe("Projects output zero-team filtering", () => {
  const switchingTasks = () => [
    task(1, { assigneeAccountId: "account-android", points: 2, actualPoints: 0 }),
    task(2, { assigneeAccountId: "account-sre", points: 0, actualPoints: 7 }),
    task(3, { assigneeAccountId: "account-web", points: null, actualPoints: 5 }),
    task(4, { points: 0, actualPoints: 0 }),
  ]
  it("recomputes eligible teams and exact total cohorts per unit without changing full tables or scope summaries", () => {
    const { render, draw, h } = setup({ tasks: switchingTasks(), request: { ...request, sprintIds: [6823] } })
    const series = () => chart(render()).props.series
    const total = () => series().find((s) => s.id === "visible-total")
    const tables = () => nodes(panel(render())).filter((n) => n.type === "table").map(text)
    const originalTables = tables()
    assert.deepEqual(plain(series().map((s) => s.id)), ["ent-android", "ent-web"])
    checkbox(render()).props.onChange({ target: { checked: true } })
    assert.equal(total().values[0].value, 2)
    assert.equal(total().values[0].partial, true)
    exactLink(total().values[0].readout, "顯示團隊合計 SP，", ["1", "3"])
    nodes(draw()).find((n) => n.type === "button" && n.props.children === "顯示團隊合計 SP，查看工作單明細").props.onClick()
    exactLink(localDetail(render()).props.title, "明細張數", ["1", "3"])
    unitControl(render()).props.onChange("actualSp")
    assert.equal(localDetail(render()), undefined)
    assert.deepEqual(plain(series().map((s) => s.id)), ["ent-web", "ent-sre", "visible-total"])
    assert.equal(total().values[0].value, 12)
    exactLink(total().values[0].readout, "顯示團隊合計 Actual SP，", ["2", "3"])
    exactLink(total().values[0].note, "完整率母體", ["2", "3"])
    assert.deepEqual(tables(), originalTables)
    const tile = nodes(panel(render())).find((n) => n.props["data-summary-tile"] !== undefined)
    exactLink(tile, "全範圍總輸出 Actual SP，", ["1", "2", "3", "4"])
    assert.equal(h.requests.length, 0)
  })
  it("restores eligibility with fixed identities and preserves manual hiding through unit changes", () => {
    const { render, draw, toggle } = setup({ tasks: switchingTasks() })
    const identity = () => chart(render()).props.series.map((s) => [s.id, s.color, plain(s.encoding)])
    const original = identity(), key = chart(render()).key
    target(draw(), 1).props.onClick()
    toggle("Android")
    unitControl(render()).props.onChange("actualSp")
    assert.equal(legends(draw()).find((n) => n.props["aria-label"] === "顯示 SRE 輸出").props["aria-pressed"], true)
    toggle("SRE")
    unitControl(render()).props.onChange("sp")
    assert.deepEqual(identity(), original)
    assert.equal(legends(draw()).find((n) => n.props["aria-label"] === "顯示 Android 輸出").props["aria-pressed"], false)
    assert.equal(chart(render()).key, key)
    assert.match(text(readout(draw())), /Sprint 59/)
    unitControl(render()).props.onChange("actualSp")
    assert.equal(legends(draw()).find((n) => n.props["aria-label"] === "顯示 SRE 輸出").props["aria-pressed"], false)
    assert.ok(!plotted(draw()).some((n) => n.props["data-series"] === "ent-sre"))
    assert.equal(chart(render()).props.series.find((s) => s.id === "ent-sre").encoding.shape, 5)
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
    checkbox(render()).props.onChange({ target: { checked: true } })
    assert.equal(chart(render()).props.series.at(-1).values[0].value, 0)
    assert.equal(chart(render()).props.series.at(-1).values[0].partial, true)
    assert.equal(nodes(draw()).filter((n) => n.props["data-stack-index"] !== undefined).length, 0)
    assert.ok(nodes(draw()).some((n) => n.type?.name === "Marker" && n.props.partial))
  })
  it("distinguishes automatically all-zero teams from manual hiding and restores nonzero Actual", () => {
    const { render, draw } = setup({ tasks: [task(1, { points: 0, actualPoints: 8 })], attribution: { status: "available", byAssignee: [] } })
    for (const checked of [false, true]) {
      checkbox(render()).props.onChange({ target: { checked } })
      assert.equal(chart(render()).props.series.length, 0)
      assert.equal(legends(draw()).length, 0)
      assert.equal(plotted(draw()).length, 0)
      assert.equal(readout(draw()), undefined)
      assert.equal(nodes(draw()).filter((n) => n.props["data-sprint-index"] !== undefined).length, 0)
      assert.match(text(draw()), /所選 Sprint 的團隊點數皆為 0/)
      assert.doesNotMatch(text(draw()), /請點選圖例加入|全部未填/)
    }
    unitControl(render()).props.onChange("actualSp")
    assert.deepEqual(plain(chart(render()).props.series.map((s) => s.id)), ["other", "visible-total"])
    assert.equal(chart(render()).props.series.at(-1).values[0].value, 8)
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
    assert.equal(checkbox(tree).props.checked, false)
    assert.equal(checkbox(tree).props.disabled, false)
    assert.equal(chart(tree).props.series.length, 3)
    assert.equal(legends(draw()).length, 3)
    assert.ok(legends(draw()).every((n) => n.props.type === "button" && n.props["aria-pressed"]))
    assert.equal(plotted(draw()).length, 3)
    assert.doesNotMatch(text(tree), /Dev-Task＋QA-Task；Resolved 日/)
    assert.equal(h.requests.length, 0)
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
  it("adds a checkbox-only exact visible-team union and retains all-null Actual instead of adding nullable sums", () => {
    const { render, draw, toggle } = setup()
    checkbox(render()).props.onChange({ target: { checked: true } })
    const total = () => chart(render()).props.series.find((s) => s.id === "visible-total")
    assert.equal(total().values[0].value, 12)
    assert.equal(total().toggleable, false)
    assert.equal(legends(draw()).length, 3)
    exactLink(total().values[0].readout, "顯示團隊合計 SP，", ["1", "2", "3", "4"])
    toggle("Android"); toggle("其他")
    assert.equal(total().values[0].value, 6)
    unitControl(render()).props.onChange("actualSp")
    assert.equal(total().values[0].value, null)
    assert.equal(total().values[0].partial, true)
    exactLink(total().values[0].note, "未填張數", ["3"])
    assert.doesNotMatch(renderToStaticMarkup(total().values[0].readout), /<a\b/)
    checkbox(render()).props.onChange({ target: { checked: false } })
    assert.equal(total(), undefined)
  })
  it("checked mode stacks only positive known team amounts beneath a total-only curve and restores team lines when unchecked", () => {
    const { render, draw } = setup()
    checkbox(render()).props.onChange({ target: { checked: true } })
    assert.equal(chart(render()).props.stackedTotalId, "visible-total")
    const tree = draw(), columns = nodes(tree).filter((n) => n.props["data-stack-index"] !== undefined)
    assert.deepEqual(columns.map((n) => n.props["data-stack-total"]), [12, 3])
    const segments = nodes(columns[0]).filter((n) => n.props["data-stack-value"] !== undefined)
    assert.deepEqual(segments.map((n) => [n.props["data-series"], n.props["data-stack-value"]]), [["ent-android", 2], ["ent-web", 6], ["other", 4]])
    for (const segment of segments) assert.ok(!nodes(segment).some((n) => n.type?.name === "Marker" || n.props.className === "projects-trend-line"))
    const total = plotted(tree).find((n) => n.props["data-series"] === "visible-total")
    const markers = nodes(total).filter((n) => n.type?.name === "Marker")
    assert.equal(markers.length, 2)
    assert.equal(markers[0].props.partial, true)
    for (const [index, column] of columns.entries()) {
      const rects = nodes(column).filter((n) => n.props.className === "projects-stack-fill")
      assert.equal(Math.min(...rects.map((n) => n.props.y)), markers[index].props.y)
      assert.equal(rects[0].props.x + rects[0].props.width / 2, markers[index].props.x)
      assert.equal(column.props.transform, total.props.transform)
      assert.ok(rects.every((n) => n.props.width <= 24 && n.props.height > 0))
    }
    assert.equal(nodes(total).filter((n) => n.props.className === "projects-trend-line").length, 1)
    assert.match(text(tree), /曲線只顯示總量/)
    checkbox(render()).props.onChange({ target: { checked: false } })
    assert.equal(chart(render()).props.stackedTotalId, undefined)
    assert.equal(nodes(draw()).filter((n) => n.props["data-stack-index"] !== undefined).length, 0)
    assert.equal(plotted(draw()).length, 3)
  })
  it("keeps the selected Sprint and stable team identities through checked/unchecked transitions", () => {
    const { render, draw, toggle } = setup()
    target(draw(), 1).props.onClick()
    const identity = () => chart(render()).props.series.filter((s) => s.id !== "visible-total").map((s) => [s.id, s.color, plain(s.encoding)])
    const before = identity(), key = chart(render()).key
    for (const checked of [true, false, true]) {
      checkbox(render()).props.onChange({ target: { checked } })
      assert.match(text(readout(draw())), /Sprint 59/)
      assert.equal(nodes(draw()).find((n) => n.props["data-pill-index"] !== undefined).props["data-pill-index"], 1)
      assert.equal(nodes(draw()).find((n) => n.props["data-selection-index"] !== undefined).props["data-selection-index"], 1)
      assert.deepEqual(identity(), before)
      assert.equal(chart(render()).key, key)
    }
    toggle("Android")
    assert.ok(!plotted(draw()).some((n) => n.props["data-series"] === "ent-android"))
    unitControl(render()).props.onChange("actualSp")
    assert.deepEqual(identity(), before)
    assert.match(text(readout(draw())), /Sprint 59/)
  })
  it("does not let empty-team zeros fabricate bars or total markers when the visible union is all missing", () => {
    const { render, draw, toggle } = setup()
    checkbox(render()).props.onChange({ target: { checked: true } })
    toggle("Android"); toggle("其他")
    unitControl(render()).props.onChange("actualSp")
    const tree = draw()
    assert.equal(nodes(tree).filter((n) => n.props["data-stack-index"] === 0).length, 0)
    const total = plotted(tree).find((n) => n.props["data-series"] === "visible-total")
    assert.deepEqual(nodes(total).filter((n) => n.type?.name === "Marker").map((n) => n.key), ["1"])
    const missing = setup({ tasks: [task(1, { assigneeAccountId: "account-android", points: null, actualPoints: null })], attribution: { status: "available", byAssignee: [attribution.byAssignee[0]] } })
    checkbox(missing.render()).props.onChange({ target: { checked: true } })
    assert.equal(nodes(missing.draw()).filter((n) => n.props["data-stack-index"] !== undefined).length, 0)
    // Second Sprint is genuinely empty, so verify the all-missing first Sprint alone.
    const c = chart(missing.render())
    const onlyMissing = missing.h.invoke(c.type, { ...c.props, sprints: c.props.sprints.slice(0, 1), series: c.props.series.map((s) => ({ ...s, values: s.values.slice(0, 1) })) })
    assert.match(text(onlyMissing), /全部未填或不適用/)
    assert.equal(nodes(onlyMissing).filter((n) => n.type?.name === "Marker").length, 0)
  })
  it("single Sprint checked mode has one stack and one total marker, while complete-zero teams are filtered", () => {
    const { render, draw } = setup({ request: { ...request, sprintIds: [6823] }, tasks: source().slice(0, 6) })
    checkbox(render()).props.onChange({ target: { checked: true } })
    assert.equal(nodes(draw()).filter((n) => n.props["data-stack-index"] !== undefined).length, 1)
    assert.equal(nodes(draw()).filter((n) => n.type?.name === "Marker").length, 1)
    assert.equal(nodes(draw()).filter((n) => n.props.className === "projects-trend-line").length, 0)
    const zero = setup({ request: { ...request, sprintIds: [6823] }, tasks: [task(1, { points: 0, actualPoints: 0 })], attribution: { status: "available", byAssignee: [] } })
    checkbox(zero.render()).props.onChange({ target: { checked: true } })
    assert.equal(nodes(zero.draw()).filter((n) => n.props["data-stack-index"] !== undefined).length, 0)
    assert.equal(nodes(zero.draw()).filter((n) => n.type?.name === "Marker").length, 0)
    assert.match(text(zero.draw()), /所選 Sprint 的團隊點數皆為 0/)
    assert.doesNotMatch(text(zero.draw()), /全部未填|請點選圖例加入/)
  })
  it("uses scoped pattern IDs and only the total for endpoint labels in stacked mode", () => {
    const { render, draw } = setup({ request: { ...request, groups: ["ent-android"] }, tasks: source().filter((t) => t.assigneeAccountId === "account-android"), attribution: { status: "available", byAssignee: [attribution.byAssignee[0]] } })
    checkbox(render()).props.onChange({ target: { checked: true } })
    const tree = draw()
    const ids = nodes(tree).filter((n) => n.type === "pattern").map((n) => n.props.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(ids.every((id) => id.startsWith("projects-stack-")))
    assert.deepEqual(nodes(tree).filter((n) => n.props.className === "projects-trend-end-label").map((n) => n.props.children), ["顯示團隊合計"])
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
    unitControl(render()).props.onChange("actualSp")
    assert.deepEqual(identity(), original)
    assert.equal(chart(render()).key, originalKey)
    assert.match(text(readout(draw())), /Sprint 59/)
    assert.equal(nodes(readout(draw())).filter((n) => n.type === "strong").length, 2)
    const web = plotted(draw()).find((n) => n.props["data-series"] === "ent-web")
    assert.equal(web.props.style["--series-color"], "var(--viz-type-5)")
    assert.ok(nodes(web).filter((n) => n.type?.name === "Marker").every((n) => n.props.shape === 5))
  })
  it("all-hidden state has no fake total/zero paths/readout/actions and every team can be restored", () => {
    const { render, draw, toggle } = setup()
    checkbox(render()).props.onChange({ target: { checked: true } })
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
    assert.deepEqual(plotted(draw()).map((n) => n.props["data-series"]), ["ent-web", "visible-total"])
    assert.equal(chart(render()).props.series.at(-1).values[0].value, 6)
  })
  it("team and total local detail cohorts are exact and stale output detail clears on team/total changes", () => {
    const { render, draw, toggle } = setup()
    const act = (label) => nodes(draw()).find((n) => n.type === "button" && n.props.children === label).props.onClick()
    act("Android SP，查看工作單明細")
    exactLink(localDetail(render()).props.title, "明細張數", ["1", "2"])
    toggle("Web")
    assert.equal(localDetail(render()), undefined)
    checkbox(render()).props.onChange({ target: { checked: true } })
    act("顯示團隊合計 SP，查看工作單明細")
    exactLink(localDetail(render()).props.title, "明細張數", ["1", "2", "4"])
    checkbox(render()).props.onChange({ target: { checked: false } })
    assert.equal(localDetail(render()), undefined)
  })
  it("keeps output options across topics and resets them for a new mounted result without fetching", () => {
    const { render, draw, toggle, h, Component, result } = setup()
    toggle("Android")
    checkbox(render()).props.onChange({ target: { checked: true } })
    unitControl(render()).props.onChange("actualSp")
    for (const label of ["開發品質", "總輸出"]) nodes(render()).find((n) => n.props.role === "tab" && n.props.children === label).props.onClick({ currentTarget: { focus() {}, scrollIntoView() {} } })
    assert.equal(unitControl(render()).props.value, "actualSp")
    assert.equal(checkbox(render()).props.checked, true)
    assert.equal(legends(draw())[0].props["aria-pressed"], false)
    const next = projectsHarness(), tree = next.invoke(next.load(VIEW).ProjectsAnalysisView, { result })
    assert.equal(unitControl(tree).props.value, "sp")
    assert.equal(checkbox(tree).props.checked, false)
    assert.equal(chart(tree).props.legendToggle.visibleIds.length, 3)
    assert.equal(h.requests.length, 0)
    assert.ok(Component)
  })
  it("single Sprint uses observation markers and a scope-wide summary that follows only the point switch", () => {
    const { render, draw, toggle } = setup({ request: { ...request, sprintIds: [6823] }, tasks: source().slice(0, 6) })
    assert.equal(nodes(draw()).filter((n) => n.type === "path" && n.props.className === "projects-trend-line").length, 0)
    assert.ok(nodes(draw()).some((n) => n.type?.name === "Marker"))
    toggle("Android")
    unitControl(render()).props.onChange("actualSp")
    const tile = nodes(panel(render())).find((n) => n.props["data-summary-tile"] !== undefined)
    assert.match(text(tile), /全範圍總輸出14 Actual SP/)
    exactLink(tile, "全範圍總輸出 Actual SP，", ["1", "2", "3", "4"])
  })
  it("selected candidates retain global encodings and never add Other or unrelated teams", () => {
    const selected = { ...request, groups: ["ent-web", "ent-be1"] }
    const tasks = [task(1, { assigneeAccountId: "account-web" })]
    const { render, draw } = setup({ request: selected, tasks, attribution: { status: "available", byAssignee: [{ accountId: "account-web", teamId: "ent-web" }] } })
    assert.deepEqual(plain(chart(render()).props.series.map((s) => [s.id, s.color, s.encoding.shape])), [["ent-web", "type-5", 5]])
    assert.equal(legends(draw()).length, 1)
    assert.match(text(nodes(panel(render())).find((n) => n.type === "table")), /BE1/)
  })
  it("unavailable and legacy attribution do not fake teams; full-scope point switching and exact links remain", () => {
    for (const reason of ["lookup_failed", "not_provided"]) {
      const { render, draw } = setup({ attribution: { status: "unavailable", reason } })
      assert.equal(checkbox(render()).props.disabled, true)
      assert.equal(legends(draw()).length, 0)
      assert.match(text(panel(render())), /團隊歸屬資料無法取得/)
      assert.equal(chart(render()).props.series[0].id, "scope-output")
      assert.equal(chart(render()).props.series[0].values[0].value, 12)
      unitControl(render()).props.onChange("actualSp")
      assert.equal(chart(render()).props.series[0].values[0].value, 14)
      exactLink(chart(render()).props.series[0].values[0].readout, "全範圍總輸出 Actual SP，", ["1", "2", "3", "4"])
    }
  })
})

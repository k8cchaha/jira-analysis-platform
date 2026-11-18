import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { projectsHarness, MODEL, VIEW, CHART, GEOMETRY, nodes, plain, task, resultFixture } from "./helpers/projects-analysis-harness.mjs"

const request = { project: "SUN", sprintIds: [6823, 6824], groups: [], browserTimeZone: "UTC" }
const cohortSource = () => [
  task(1, { points: 5, actualPoints: 2, resolvedDate: "2026-04-28" }),
  task(2, { points: 2, actualPoints: 6, resolvedDate: "2026-05-11" }),
  task(3, { points: 0, actualPoints: 0 }),
  task(4, { points: null, actualPoints: 2 }),
  task(5, { points: 5, actualPoints: null }),
  task(6, { issueType: "QA-Task", points: 8, actualPoints: 1 }),
  task(7, { points: 4, actualPoints: 1, resolvedDate: null, statusName: "Done", parentStatus: "Request Info" }),
  task(8, { points: 5, actualPoints: 1, resolvedDate: "2026-05-12" }),
  task(9, { points: 10, actualPoints: 1, sprintIds: [6824] }),
  task(10, { points: 0, actualPoints: 2 }),
  task(11, { points: 2, actualPoints: 0 }),
]
const topic = (tree) => nodes(tree).find((node) => node.props["data-topic"] === "estimation-deviation")
const chartOf = (tree) => nodes(topic(tree)).find((node) => node.type?.name === "ProjectsTrendChart")
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} vs ${expected}`)

describe("Completed paired Dev-Task estimation deviation", () => {
  it("uses one completed in-window paired cohort and retains zeros while excluding QA, missing pairs and unresolved work", () => {
    const h = projectsHarness(), model = h.load(MODEL), result = resultFixture(model, cohortSource(), request)
    const before = JSON.stringify(result.tasks)
    const selected = model.selectProjectsMetricIssues(result.tasks, result.sprints[0], { kind: "estimation-deviation" })
    assert.deepEqual(plain(selected.map((row) => row.id)), ["1", "2", "3", "10", "11"])
    const value = model.projectsEstimationDeviation(result.tasks, result.sprints[0])
    assert.equal(value.value, -1)
    assert.equal(value.totals.count, 5)
    assert.equal(value.totals.sp.sum, 9)
    assert.equal(value.totals.actualSp.sum, 10)
    assert.equal(model.projectsEstimationDeviation(result.tasks, result.sprints[1]).value, null)
    assert.equal(JSON.stringify(result.tasks), before)
  })
  it("distinguishes an empty cohort from a genuine zero or positive/negative cancellation", () => {
    const h = projectsHarness(), model = h.load(MODEL), sprint = resultFixture(model).sprints[0]
    assert.equal(model.projectsEstimationDeviation([], sprint).value, null)
    assert.equal(model.projectsEstimationDeviation([task(1, { points: 0, actualPoints: 0 })], sprint).value, 0)
    assert.equal(model.projectsEstimationDeviation([task(1, { points: 3, actualPoints: 1, statusName: "In Progress", parentStatus: "Request Info" })], sprint).value, 2, "completed eligibility follows Resolved, not statuses or another topic's blocked-parent checkbox")
    assert.equal(model.projectsEstimationDeviation([task(1, { points: 5, actualPoints: 2 }), task(2, { points: 2, actualPoints: 5 })], sprint).value, 0)
    for (const amount of [Number.MIN_VALUE, Number.MAX_VALUE]) {
      assert.equal(model.projectsEstimationDeviation([task(1, { points: amount, actualPoints: 0 })], sprint).value, amount)
      assert.equal(model.projectsEstimationDeviation([task(1, { points: 0, actualPoints: amount })], sprint).value, -amount)
    }
  })
})

describe("Opt-in signed trend geometry", () => {
  it("keeps zero centered and supports finite extreme positive/negative values without mutating samples", () => {
    const h = projectsHarness(), geometry = h.load(GEOMETRY)
    for (const extent of [Number.MIN_VALUE, 5, Number.MAX_VALUE]) {
      const values = Object.freeze([extent, 0, -extent])
      const result = geometry.buildSignedTrendGeometry(values, extent, 300, 100)
      assert.deepEqual(plain(result.points.map((point) => point.y)), [0, 50, 100])
      assert.doesNotMatch(result.paths.join(" "), /NaN|Infinity/)
      assert.deepEqual(values, [extent, 0, -extent])
      const maximum = geometry.cleanSignedAxisMaximum(values)
      assert.ok(Number.isFinite(maximum) && maximum >= extent && maximum > 0)
    }
  })
  it("preserves null gaps and the original nonnegative contract while rejecting invalid signed domains", () => {
    const h = projectsHarness(), geometry = h.load(GEOMETRY)
    const result = geometry.buildSignedTrendGeometry([-5, 0, null, 5], 5, 300, 100)
    assert.deepEqual(plain(result.points.map((point) => [point.index, point.x, point.y])), [[0, 0, 100], [1, 100, 50], [3, 300, 0]])
    assert.equal(result.paths.length, 1)
    assert.throws(() => geometry.buildTrendGeometry([-1], 5, 300, 100), /non-negative/)
    for (const value of [NaN, Infinity, -Infinity, undefined, "2"]) {
      assert.throws(() => geometry.cleanSignedAxisMaximum([value]))
      assert.throws(() => geometry.buildSignedTrendGeometry([value], 5, 300, 100))
    }
    assert.throws(() => geometry.buildSignedTrendGeometry([-6], 5, 300, 100))
    for (const maximum of [0, -1, NaN, Infinity]) assert.throws(() => geometry.buildSignedTrendGeometry([0], maximum, 300, 100))
  })
})

describe("Estimation deviation chart and tab", () => {
  it("aligns signed ticks, zero baseline, labels and markers without clamping negative raw values", () => {
    const h = projectsHarness(), Component = h.load(CHART).ProjectsTrendChart
    const props = { id: "signed", sprints: [1, 2, 3].map((id) => ({ id, name: `Sprint ${id}`, startDate: "2026-01-01", endDate: "2026-01-14" })), series: [{ id: "delta", label: "Delta", color: "sp", values: [-5, 0, 5].map((value) => ({ value, display: String(value) })) }], unit: "SP", formatTick: String, signed: true, labelPointValues: true, initialSprintId: 1 }
    const before = JSON.stringify(props.series), tree = h.invoke(Component, props)
    const marker = nodes(tree).find((node) => node.type?.name === "Marker" && node.key === "0")
    close(marker.props.y, 206)
    const valueLabel = nodes(tree).find((node) => node.props["data-line-value"] === "delta")
    assert.equal(valueLabel.props.children, "-5")
    close(valueLabel.props.y, 22 + marker.props.y - 8)
    const zero = nodes(tree).find((node) => node.props.className === "projects-trend-zero-baseline")
    close(zero.props.y1, 125)
    close(nodes(tree).find((node) => node.props.className === "projects-trend-end-label").props.y, 26, "endpoint label shares the signed Y mapping")
    assert.ok(nodes(tree).find((node) => node.type === "svg" && node.props.onPointerMove).props["aria-label"].includes("正負"))
    const grid = nodes(tree).find((node) => node.props.className === "projects-trend-grid")
    assert.deepEqual(nodes(grid).filter((node) => node.type === "text").map((node) => node.props.children), ["-5", "-2.5", "0", "2.5", "5"])
    assert.equal(JSON.stringify(props.series), before)
    assert.throws(() => h.invoke(Component, { ...props, signed: false }), /non-negative/)
    assert.throws(() => h.invoke(Component, { ...props, distribution: true }), /signed|Signed/)
    assert.throws(() => h.invoke(Component, { ...props, stackedTotalId: "delta" }), /signed|Signed/)
  })
  it("places the tab directly after the two rates and exposes the exact eligible numbers and detail cohort without fetching", () => {
    const h = projectsHarness(), model = h.load(MODEL), result = resultFixture(model, cohortSource(), request), Component = h.load(VIEW).ProjectsAnalysisView
    const render = () => h.invoke(Component, { result })
    const tabs = nodes(render()).filter((node) => node.props.role === "tab")
    assert.deepEqual(tabs.map((tab) => tab.props.children), ["總產出", "負載率／完成率", "估點偏差率", "完成任務類型", "目前未完成"])
    assert.equal(chartOf(render()).props.signed, true)
    assert.equal(chartOf(render()).props.unit, "SP")
    assert.deepEqual(plain(chartOf(render()).props.series[0].values.map((value) => value.value)), [-1, null])
    assert.equal(chartOf(render()).props.initialSprintId, 6824)
    const table = nodes(topic(render())).find((node) => node.type === "table")
    assert.ok(table)
    assert.match(renderToStaticMarkup(table), /Actual SP/)
    assert.match(renderToStaticMarkup(table), /—／不適用/)
    const button = nodes(topic(render())).find((node) => node.type === "button" && node.props["aria-label"]?.includes("估點偏差率，查看工作單明細"))
    button.props.onClick()
    const detail = nodes(render()).find((node) => node.props.description === "本次完整查詢資料的唯讀明細，不會另查 Jira。")
    const tickets = nodes(detail).filter((node) => node.type?.name === "TicketLink").map((node) => node.props.task.key)
    assert.deepEqual([...new Set(tickets)], ["SUN-1", "SUN-2", "SUN-3", "SUN-10", "SUN-11"])
    assert.equal(h.requests.length, 0)
  })
  it("keeps a singleton as one signed point and preserves a tiny negative value in scientific text", () => {
    const h = projectsHarness(), model = h.load(MODEL), result = resultFixture(model, [task(1, { points: 0, actualPoints: Number.MIN_VALUE })]), Component = h.load(VIEW).ProjectsAnalysisView
    const tree = h.invoke(Component, { result }), chart = chartOf(tree)
    assert.equal(chart.props.series[0].values[0].value, -Number.MIN_VALUE)
    assert.notEqual(chart.props.series[0].values[0].display, "-0")
    assert.notEqual(chart.props.series[0].values[0].display, "0")
    const drawn = h.invoke(chart.type, chart.props)
    assert.equal(nodes(drawn).filter((node) => node.props.className === "projects-trend-line").length, 0)
    assert.equal(nodes(drawn).filter((node) => node.type?.name === "Marker").length, 1)
  })
})

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
  it("places the tab directly after the two rates and shows the exact eligible numbers without fetching or detail links", () => {
    const h = projectsHarness(), model = h.load(MODEL), result = resultFixture(model, cohortSource(), request), Component = h.load(VIEW).ProjectsAnalysisView
    const render = () => h.invoke(Component, { result })
    const tabs = nodes(render()).filter((node) => node.props.role === "tab")
    assert.deepEqual(tabs.map((tab) => tab.props.children), ["總產出", "負載率／完成率", "估點偏差率", "完成任務類型", "目前未完成"])
    assert.equal(chartOf(render()).props.signed, true, "rates stay signed: an underestimate is negative")
    assert.equal(chartOf(render()).props.unit, "%")
    // Deviation rate = (SP − Actual SP) ÷ SP; the newest Sprint has no paired work, so its rate stays unknown.
    // Sprint 58: (5−2)+(2−6)+(0−0)+(0−2)+(2−0) = −1 over 9 SP = −1/9; Sprint 59 has no paired work.
    assert.deepEqual(plain(chartOf(render()).props.series[0].values.map((value) => value.value)), [-1 / 9, null])
    assert.equal(chartOf(render()).props.initialSprintId, 6824)
    const table = nodes(topic(render())).find((node) => node.type === "table")
    assert.ok(table)
    // The newest Sprint is selected, so the table reports only that Sprint's cohort.
    const text = renderToStaticMarkup(table)
    assert.match(text, /Sprint 59/)
    assert.match(text, /符合條件張數/)
    assert.equal(nodes(topic(render())).some((node) => node.type === "button" && String(node.props["aria-label"] ?? "").includes("查看工作單明細")), false, "the 明細 column was removed")
    assert.equal(h.requests.length, 0)
  })
  it("keeps a singleton as one signed point and preserves a tiny negative value in scientific text", () => {
    const h = projectsHarness(), model = h.load(MODEL), result = resultFixture(model, [task(1, { points: 0, actualPoints: Number.MIN_VALUE })]), Component = h.load(VIEW).ProjectsAnalysisView
    const tree = h.invoke(Component, { result }), chart = chartOf(tree)
    // (0 − MIN_VALUE) ÷ 0 has no rate: zero SP is not a denominator.
    assert.equal(chart.props.series[0].values[0].value, null)
    const drawn = h.invoke(chart.type, chart.props)
    assert.equal(nodes(drawn).filter((node) => node.props.className === "projects-trend-line").length, 0)
    // A single Sprint draws no join line; the unknown rate still renders one point slot.
    assert.ok(nodes(drawn).filter((node) => node.type?.name === "Marker").length <= 1)
  })
})

describe("Estimation deviation view switch", () => {
  const request = { project: "SUN", sprintIds: [6823, 6824], groups: [], browserTimeZone: "UTC" }
  // Sprint 58 window is 2026-04-28..2026-05-11; Sprint 59 is 2026-05-12..2026-05-25.
  const source = [
    task(1, { points: 5, actualPoints: 2, resolvedDate: "2026-04-28", sprintIds: [6823], assigneeAccountId: "acc-web", assigneeDisplayName: "Web Dev" }),
    task(2, { points: 2, actualPoints: 6, resolvedDate: "2026-05-13", sprintIds: [6824], assigneeAccountId: "acc-android", assigneeDisplayName: "Android Dev" }),
    task(3, { points: 3, actualPoints: 3, resolvedDate: "2026-05-14", sprintIds: [6824], assigneeAccountId: "acc-web", assigneeDisplayName: "Web Dev" }),
  ]
  const attribution = { status: "available", byAssignee: [{ accountId: "acc-web", teamId: "ent-web" }, { accountId: "acc-android", teamId: "ent-android" }] }
  const setup = (taskSource = source, taskRequest = request, taskAttribution = attribution) => {
    const h = projectsHarness(), model = h.load(MODEL)
    const result = resultFixture(model, taskSource, taskRequest, taskAttribution)
    return { h, result, render: () => h.invoke(h.load(VIEW).ProjectsAnalysisView, { result }) }
  }
  const topic = (tree) => nodes(tree).find((node) => node.props["data-topic"] === "estimation-deviation")
  const switchTo = (render, label) => {
    const units = nodes(topic(render())).find((node) => node.type?.name === "Panel").props.controls.props.children
    nodes(units.type(units.props)).find((node) => node.type === "button" && node.props.children === label).props.onClick()
  }
  const tableOf = (tree) => nodes(topic(tree)).find((node) => node.type === "table")
  const text = (node) => typeof node.props.children === "string" ? node.props.children : Array.isArray(node.props.children) ? node.props.children.map((child) => typeof child === "string" ? child : "").join("") : ""
  const rowsOf = (tree) => nodes(tableOf(tree)).filter((node) => node.type === "tr").map((row) => nodes(row).filter((cell) => cell.type === "th" || cell.type === "td").map(text))
  const estimationCharts = (tree) => nodes(topic(tree)).filter((node) => node.type?.name === "ProjectsTrendChart")

  it("defaults to one aggregate curve and offers 全團隊總覽／各團隊偏差率", () => {
    const { h, render } = setup()
    const units = nodes(topic(render())).find((node) => node.type?.name === "Panel").props.controls.props.children
    assert.deepEqual(nodes(units.type(units.props)).filter((node) => node.type === "button").map((node) => node.props.children), ["全團隊總覽", "各團隊偏差率"])
    const [chart] = estimationCharts(render())
    assert.equal(chart.props.id, "estimation-deviation")
    // Rate = (ΣSP − ΣActual) ÷ ΣSP over the Sprint's paired cohort:
    // Sprint 58: (5 + 2) = 7 SP → −1 ÷ 7; Sprint 59: (3 − 3) + (2 − 6) over (3 + 2) SP → −4 ÷ 5 = −0.8.
    // (The aggregate curve sums the same paired tasks as the per-team curves.)
    assert.deepEqual(plain(chart.props.series[0].values.map((value) => value.value)), [0.6, -0.8])
    assert.equal(h.requests.length, 0)
  })

  it("plots one signed curve per in-scope team", () => {
    const { h, render } = setup()
    switchTo(render, "各團隊偏差率")
    const tree = render()
    const [chart] = estimationCharts(tree)
    assert.equal(chart.props.id, "estimation-deviation-teams")
    assert.equal(chart.props.unit, "%")
    const web = chart.props.series.find((series) => series.id === "ent-web")
    // Web: Sprint 58 (5−2)÷5 = 0.6; Sprint 59 (3−3)÷3 = 0.
    assert.deepEqual(plain(web.values.map((value) => value.value)), [0.6, 0])
    const android = chart.props.series.find((series) => series.id === "ent-android")
    // Android has paired work only in Sprint 59: (2−6)÷2 = −2.
    assert.deepEqual(plain(android.values.map((value) => value.value)), [null, -2], "Android only has paired work in Sprint 59")
    // Without a clicked Sprint each team row sums every Sprint; the newest Sprint opens selected, so clear it first.
    chart.props.onSprintSelect(null)
    const summed = render()
    // Only teams with qualifying paired work are listed: a 0 張 team never appears.
    assert.deepEqual(rowsOf(summed), [
      ["團隊", "符合條件張數", "SP", "Actual SP", "SP − Actual SP", "偏差率"],
      ["Android", "1 張", "2", "6", "-4", "-200%"],
      ["Web", "2 張", "8", "5", "3", "37.5%"],
    ])
    assert.deepEqual(plain(estimationCharts(summed)[0].props.series.map((series) => series.id)), ["ent-android", "ent-web"], "the legend and chart drop zero teams too")
    assert.deepEqual(rowsOf(summed).find((row) => row[0] === "Web"), ["Web", "2 張", "8", "5", "3", "37.5%"], "Web: Sprint 58 +3, Sprint 59 0 over 8 SP")
    assert.equal(nodes(tableOf(tree)).some((node) => node.props.children === "明細"), false, "no 明細 column")
    assert.equal(nodes(topic(tree)).some((node) => node.type === "button" && String(node.props["aria-label"] ?? "").includes("查看工作單明細")), false, "no detail links")
    assert.equal(h.requests.length, 0)
  })

  it("hides and restores a team through its own legend list", () => {
    const { render } = setup()
    switchTo(render, "各團隊偏差率")
    estimationCharts(render())[0].props.legendToggle.onToggle("ent-android")
    assert.equal(estimationCharts(render())[0].props.series.some((series) => series.id === "ent-android"), false)
    assert.ok(estimationCharts(render())[0].props.legendSeries.some((series) => series.id === "ent-android"))
    estimationCharts(render())[0].props.legendToggle.onToggle("ent-android")
    assert.ok(estimationCharts(render())[0].props.series.some((series) => series.id === "ent-android"))
  })
})

describe("Estimation deviation for a single team", () => {
  const request = { project: "SUN", sprintIds: [6823, 6824], groups: ["ent-web"], browserTimeZone: "UTC" }
  const attribution = { status: "available", byAssignee: [{ accountId: "acc-a", teamId: "ent-web" }, { accountId: "acc-b", teamId: "ent-web" }] }
  const source = [
    task(1, { points: 5, actualPoints: 2, resolvedDate: "2026-04-28", sprintIds: [6823], assigneeAccountId: "acc-a", assigneeDisplayName: "A" }),
    task(2, { points: 2, actualPoints: 6, resolvedDate: "2026-04-28", sprintIds: [6823], assigneeAccountId: "acc-b", assigneeDisplayName: "B" }),
    task(3, { points: 3, actualPoints: 1, resolvedDate: "2026-05-13", sprintIds: [6824], assigneeAccountId: "acc-a", assigneeDisplayName: "A" }),
    task(4, { points: 6, actualPoints: 4, resolvedDate: "2026-05-13", sprintIds: [6824], assigneeAccountId: "acc-b", assigneeDisplayName: "B" }),
  ]
  const setup = () => {
    const h = projectsHarness(), model = h.load(MODEL)
    const result = resultFixture(model, source, request, attribution)
    h.groupStates["ent-web"] = { status: "success", members: [{ accountId: "acc-a", displayName: "Ann" }, { accountId: "acc-b", displayName: "Ben" }] }
    return { h, render: () => h.invoke(h.load(VIEW).ProjectsAnalysisView, { result }) }
  }
  const topic = (tree) => nodes(tree).find((node) => node.props["data-topic"] === "estimation-deviation")
  const switchTo = (render, label) => {
    const units = nodes(topic(render())).find((node) => node.type?.name === "Panel").props.controls.props.children
    nodes(units.type(units.props)).find((node) => node.type === "button" && node.props.children === label).props.onClick()
  }
  const chart = (tree) => nodes(topic(tree)).find((node) => node.type?.name === "ProjectsTrendChart")
  const rowsOfTypeTable = (tree) => {
    const text = (node) => typeof node.props.children === "string" ? node.props.children : Array.isArray(node.props.children) ? node.props.children.map((child) => typeof child === "string" ? child : "").join("") : ""
    const tables = nodes(topic(tree)).filter((node) => node.type === "table")
    return nodes(tables.at(-1)).filter((node) => node.type === "tr").map((row) => nodes(row).filter((cell) => cell.type === "th" || cell.type === "td").map(text))
  }
  const text = (node) => typeof node.props.children === "string" ? node.props.children : Array.isArray(node.props.children) ? node.props.children.map((child) => typeof child === "string" ? child : "").join("") : ""
  const tableRows = (tree) => nodes(nodes(topic(tree)).find((node) => node.type === "table")).filter((node) => node.type === "tr").map((row) => nodes(row).filter((cell) => cell.type === "th" || cell.type === "td").map(text))

  it("offers member labels and plots one signed curve per member with real values", () => {
    const { h, render } = setup()
    switchTo(render, "各成員偏差率")
    const tree = render()
    assert.equal(chart(tree).props.id, "estimation-deviation-teams")
    assert.deepEqual(plain(chart(tree).props.series.map((series) => series.label)), ["Ann", "Ben"])
    const ann = chart(tree).props.series.find((series) => series.label === "Ann")
    // Rates: Ann (5−2)÷5 = 0.6 and (3−1)÷3 = 2/3; Ben (2−6)÷2 = −2 and (6−4)÷6 = 1/3.
    assert.deepEqual(plain(ann.values.map((value) => value.value)), [0.6, 2 / 3], "Ann: 5−2 and 3−1 over their SP")
    const ben = chart(tree).props.series.find((series) => series.label === "Ben")
    assert.deepEqual(plain(ben.values.map((value) => value.value)), [-2, 1 / 3], "Ben: 2−6 and 6−4 over their SP")
    assert.equal(h.requests.length, 0)
  })

  it("sums all selected Sprints per member when no Sprint is selected, and narrows to the clicked Sprint otherwise", () => {
    const { render } = setup()
    switchTo(render, "各成員偏差率")
    // A query opens with the newest Sprint preselected.
    assert.deepEqual(tableRows(render()), [
      ["成員", "符合條件張數", "SP", "Actual SP", "SP − Actual SP", "偏差率"],
      ["Ann", "1 張", "3", "1", "2", "66.7%"],
      ["Ben", "1 張", "6", "4", "2", "33.3%"],
    ])
    // Clearing the selection (chart reports null) falls back to every Sprint summed.
    chart(render()).props.onSprintSelect(null)
    assert.deepEqual(tableRows(render()), [
      ["成員", "符合條件張數", "SP", "Actual SP", "SP − Actual SP", "偏差率"],
      ["Ann", "2 張", "8", "3", "5", "62.5%"],
      ["Ben", "2 張", "8", "10", "-2", "-25%"],
    ])
  })

  it("scopes 全成員總覽 to that team only, not the whole project", () => {
    const h = projectsHarness(), model = h.load(MODEL)
    // Web is the only team in scope; another team's work in the payload must not leak into its rows.
    const result = resultFixture(model, source, request, attribution)
    h.groupStates["ent-web"] = { status: "success", members: [{ accountId: "acc-a", displayName: "Ann" }, { accountId: "acc-b", displayName: "Ben" }] }
    const render = () => h.invoke(h.load(VIEW).ProjectsAnalysisView, { result })
    // Clicked Sprint 59: Web only → (3−1) + (6−4) = 4 over 9 SP.
    assert.deepEqual(tableRows(render()), [
      ["Sprint", "符合條件張數", "SP", "Actual SP", "SP − Actual SP", "偏差率"],
      ["Sprint 59", "2 張", "9", "5", "4", "44.4%"],
    ])
    chart(render()).props.onSprintSelect(null)
    // All Sprints: Web's 4 paired tasks (58: 2 張, 59: 2 張).
    assert.deepEqual(tableRows(render()).at(-1), ["全部 Sprint 加總", "4 張", "16", "13", "3", "18.8%"])
    // The Dev Type trend is scoped too: all of Web's work here is Dev.
    assert.deepEqual(rowsOfTypeTable(render()).at(-1), ["Dev", "4 張", "16", "13", "3", "18.8%"], "the Dev Type table follows the same scope")
  })

  it("narrows the 全成員總覽 table to the clicked Sprint and sums every Sprint without a selection", () => {
    const { render } = setup()
    assert.deepEqual(tableRows(render()), [
      ["Sprint", "符合條件張數", "SP", "Actual SP", "SP − Actual SP", "偏差率"],
      ["Sprint 59", "2 張", "9", "5", "4", "44.4%"],
    ])
    chart(render()).props.onSprintSelect(null)
    assert.deepEqual(tableRows(render()), [
      ["Sprint", "符合條件張數", "SP", "Actual SP", "SP − Actual SP", "偏差率"],
      ["Sprint 58", "2 張", "7", "8", "-1", "-14.3%"],
      ["Sprint 59", "2 張", "9", "5", "4", "44.4%"],
      ["全部 Sprint 加總", "4 張", "16", "13", "3", "18.8%"],
    ])
  })
})

describe("Dev Type deviation trend under the overview table", () => {
  const request = { project: "SUN", sprintIds: [6823, 6824], groups: [], browserTimeZone: "UTC" }
  const source = [
    task(1, { devType: "Dev", points: 5, actualPoints: 2, resolvedDate: "2026-04-28", sprintIds: [6823] }),
    task(2, { devType: "Dev", points: 2, actualPoints: 6, resolvedDate: "2026-05-13", sprintIds: [6824] }),
    task(3, { devType: "Bug", points: 4, actualPoints: 4, resolvedDate: "2026-05-13", sprintIds: [6824] }),
    task(4, { devType: "Spike", points: 3, actualPoints: 3, resolvedDate: "2026-05-13", sprintIds: [6824], issueType: "QA-Task" }),
  ]
  const setup = () => {
    const h = projectsHarness(), model = h.load(MODEL)
    const result = resultFixture(model, source, request, { status: "available", byAssignee: [] })
    return { render: () => h.invoke(h.load(VIEW).ProjectsAnalysisView, { result }) }
  }
  const topic = (tree) => nodes(tree).find((node) => node.props["data-topic"] === "estimation-deviation")
  const charts = (tree) => nodes(topic(tree)).filter((node) => node.type?.name === "ProjectsTrendChart")

  it("charts each Dev Type's deviation rate beside the same table rows", () => {
    const { render } = setup()
    const tree = render()
    assert.deepEqual(plain(charts(tree).map((chart) => chart.props.id)), ["estimation-deviation", "estimation-deviation-types"])
    const types = charts(tree)[1]
    assert.equal(types.props.unit, "%")
    assert.equal(types.props.signed, true)
    // Only Dev-Task types with paired work: Dev and Bug; the QA-Task Spike is excluded.
    assert.deepEqual(plain(types.props.series.map((series) => series.label)), ["Dev", "Bug"])
    const dev = types.props.series.find((series) => series.label === "Dev")
    assert.deepEqual(plain(dev.values.map((value) => value.value)), [0.6, -2])
    const bug = types.props.series.find((series) => series.label === "Bug")
    assert.deepEqual(plain(bug.values.map((value) => value.value)), [null, 0])
    // The cross-check table below carries the current range (newest Sprint selected): Dev (2−6)÷2 = −200%, Bug 0%.
    const tables = nodes(topic(tree)).filter((node) => node.type === "table")
    const typeTable = tables.at(-1)
    const cellText = (cell) => typeof cell.props.children === "string" ? cell.props.children : Array.isArray(cell.props.children) ? cell.props.children.map((child) => typeof child === "string" ? child : "").join("") : ""
    const rows = nodes(typeTable).filter((node) => node.type === "tr").map((row) => nodes(row).filter((cell) => cell.type === "th" || cell.type === "td").map(cellText))
    assert.deepEqual(rows, [
      ["Dev Type", "符合條件張數", "SP", "Actual SP", "SP − Actual SP", "偏差率"],
      ["Dev", "1 張", "2", "6", "-4", "-200%"],
      ["Bug", "1 張", "4", "4", "0", "0%"],
    ])
  })

  it("is only drawn for the overview views, not 各團隊／各成員偏差率", () => {
    const { render } = setup()
    const units = nodes(topic(render())).find((node) => node.type?.name === "Panel").props.controls.props.children
    nodes(units.type(units.props)).find((node) => node.type === "button" && node.props.children === "各團隊偏差率").props.onClick()
    assert.deepEqual(plain(charts(render()).map((chart) => chart.props.id)), ["estimation-deviation-teams"])
  })
})

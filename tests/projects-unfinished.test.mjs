import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { statusColorClass } from "../lib/status-color.ts"
import { projectsHarness, MODEL, VIEW, nodes, plain, task, resultFixture } from "./helpers/projects-analysis-harness.mjs"
import { harness as serverHarness, input, parent, task as serverTask } from "./helpers/projects-analysis-server-harness.mjs"

const request = { project: "SUN", sprintIds: [6823, 6824], groups: [], browserTimeZone: "UTC" }
const rowTask = (id, overrides = {}) => task(id, { parentId: String(900 + id), parentKey: `SUN-${900 + id}`, resolvedDate: null, parentIssueType: "Story", ...overrides })
const source = () => [
  rowTask(101, { points: 5, parentStatus: "In Progress", statusName: "To Do", assigneeAccountId: "member-1", assigneeDisplayName: "Assignee 1" }),
  rowTask(102, { points: 0, parentIssueType: "Task", parentStatus: "Blocked", statusName: "Done" }),
  rowTask(103, { points: null, parentIssueType: "Bug", parentStatus: null, statusName: null }),
  rowTask(104, { points: 7, sprintIds: [6824] }),
  rowTask(105, { points: 20, resolvedDate: "2026-05-12" }),
  rowTask(106, { points: 4, resolvedDate: "2026-04-28" }),
  rowTask(107, { points: 1, parentIssueType: "Task", sprintIds: [6823, 6824] }),
]
const panel = (tree) => nodes(tree).find((node) => node.props["data-topic"] === "unfinished")
const chartOf = (tree) => nodes(panel(tree)).find((node) => node.type?.name === "ProjectsTrendChart")
const unitsOf = (tree) => nodes(nodes(panel(tree)).find((node) => node.type?.name === "Panel").props.controls).find((node) => node.type?.name === "Units")
const detailOf = (tree) => nodes(panel(tree)).find((node) => node.type?.name === "ProjectsUnfinishedDetail")
function checkboxOf(tree, label, topic = "unfinished") {
  const scope = nodes(tree).find((node) => node.props["data-topic"] === topic)
  const controls = nodes(scope).find((node) => node.type?.name === "Panel").props.controls
  const wrapper = nodes(controls).find((node) => node.type === "label" && text(node).includes(label))
  return nodes(wrapper).find((node) => node.props.type === "checkbox")
}
const statusSortButton = (tree) => nodes(tree).find((node) => node.type === "th" && node.props["aria-sort"] !== undefined).props.children
const rowIds = (tree) => nodes(tree).filter((node) => node.type === "tr" && node.key !== null).map((node) => node.key)
const target = (tree, index) => nodes(tree).find((node) => node.props["data-sprint-index"] === index)
function setup(tasks = source(), selectedRequest = request) {
  const h = projectsHarness(), model = h.load(MODEL), Component = h.load(VIEW).ProjectsAnalysisView
  const result = resultFixture(model, tasks, selectedRequest)
  const render = () => h.invoke(Component, { result })
  const draw = () => { const chart = chartOf(render()); return h.invoke(chart.type, chart.props) }
  const detail = () => { const element = detailOf(render()); return element ? h.invoke(element.type, element.props) : null }
  return { h, result, render, draw, detail }
}
const text = (tree) => renderToStaticMarkup(tree).replace(/<[^>]*>/g, "")

describe("Projects parent type DTO and original unfinished cohort", () => {
  it("retains valid parent types and normalizes absent legacy types to unknown without changing summaries", () => {
    const h = projectsHarness(), model = h.load(MODEL), result = resultFixture(model, source(), request)
    assert.deepEqual(plain(result.tasks.slice(0, 3).map((row) => row.parentIssueType)), ["Story", "Task", "Bug"])
    const legacy = plain(result)
    for (const row of legacy.tasks) delete row.parentIssueType
    const normalized = model.parseProjectsAnalysisResult(legacy, request)
    assert.ok(normalized.tasks.every((row) => row.parentIssueType === null))
    assert.deepEqual(plain(normalized.summaries), plain(result.summaries))
    assert.deepEqual(plain(model.selectProjectsMetricIssues(result.tasks, result.sprints[0], { kind: "unfinished" }).map((row) => row.id)), ["101", "102", "103", "107"])
    assert.equal(result.summaries[0].unfinished.count, 4)
    assert.equal(result.summaries[0].unfinished.sp.sum, 6)
  })
  it("rejects invalid supplied parent types rather than guessing from the child type", () => {
    const h = projectsHarness(), model = h.load(MODEL), result = resultFixture(model, source(), request)
    for (const value of ["Epic", "story", "", 0, false, {}, []]) {
      const raw = plain(result); raw.tasks[0].parentIssueType = value
      assert.throws(() => model.parseProjectsAnalysisResult(raw, request), model.ProjectsAnalysisValidationError)
    }
  })
  it("projects verified parent types and both statuses through the original queries without issue lookups", async (t) => {
    const parents = [parent("1"), parent("2"), parent("3")]
    for (const [index, type] of [" story ", "TASK", "bUg"].entries()) parents[index].fields.issuetype = { id: String(3 + index), name: type, subtask: false }
    parents[0].fields.status = { name: "In Progress" }
    parents[1].fields.status = { name: "Blocked" }
    parents[2].fields.status = null
    const h = serverHarness(t, { parents, tasks: [
      serverTask("101", "1", { resolutiondate: null, status: { name: "To Do" } }),
      serverTask("102", "2", { resolutiondate: null, status: { name: "Done" }, customfield_10005: 0 }),
      serverTask("103", "3", { resolutiondate: null, status: null }),
    ] })
    const result = await h.getProjectsAnalysis(input)
    assert.deepEqual(plain(result.tasks.map((row) => [row.parentIssueType, row.parentStatus, row.statusName])), [["Story", "In Progress", "To Do"], ["Task", "Blocked", "Done"], ["Bug", null, null]])
    assert.equal(result.summaries[0].unfinished.count, 3)
    const searches = h.calls.filter((call) => call.method === "POST")
    assert.equal(searches.length, 2)
    assert.equal(searches[0].body.jql, "project = SUN AND sprint = 7517 AND issuetype in (story, task, bug) ORDER BY key ASC")
    assert.equal(searches[1].body.jql, "parent in (1, 2, 3) AND issuetype in (20, 21) ORDER BY key ASC")
    assert.deepEqual(searches[0].body.fields, ["project", "issuetype", "status"])
    assert.ok(!h.calls.some((call) => call.path.startsWith("/rest/api/3/issue/")))
  })
})

const filterSource = () => [
  rowTask(101, { points: 5, parentStatus: "In Progress" }),
  rowTask(102, { points: 3, issueType: "QA-Task", parentStatus: "In Review" }),
  rowTask(103, { points: 2, parentStatus: "Request Info" }),
  rowTask(104, { points: 7, issueType: "QA-Task", parentStatus: "Request Info" }),
  rowTask(105, { points: 0, parentStatus: "Pending" }),
  rowTask(106, { points: null, parentStatus: "Reproduce" }),
  rowTask(107, { points: 1, parentStatus: null }),
  rowTask(108, { points: 4, parentStatus: "RequestInfo" }),
  rowTask(109, { points: 9, parentStatus: "Done", statusName: "Request Info" }),
  rowTask(110, { points: 100, parentStatus: "Request Info", resolvedDate: "2026-04-28" }),
  rowTask(111, { points: 1000, sprintIds: [6824] }),
  rowTask(112, { points: 11, issueType: "QA-Task", resolvedDate: "2026-04-28" }),
]
const setFilters = (render, includeQa, hideRequestInfo) => {
  checkboxOf(render(), "含 QA-Task").props.onChange({ target: { checked: includeQa } })
  checkboxOf(render(), "隱藏受阻母票").props.onChange({ target: { checked: hideRequestInfo } })
}

describe("Unfinished display filters, latest selection and parent status sorting", () => {
  it("ANDs QA and exact Request Info filters across the chart and complete list without changing raw summaries", () => {
    for (const [includeQa, hideRequestInfo, ids, sp] of [
      [true, false, [101, 102, 103, 104, 105, 106, 107, 108, 109], 31],
      [false, false, [101, 103, 105, 106, 107, 108, 109], 21],
      [true, true, [101, 102, 105, 106, 107, 108, 109], 22],
      [false, true, [101, 105, 106, 107, 108, 109], 19],
    ]) {
      const { h, result, render, draw } = setup(filterSource())
      assert.equal(checkboxOf(render(), "含 QA-Task").props.checked, true)
      assert.equal(checkboxOf(render(), "隱藏受阻母票").props.checked, false)
      target(draw(), 0).props.onClick()
      setFilters(render, includeQa, hideRequestInfo)
      const expectedIds = ids.map(String)
      assert.deepEqual(plain(detailOf(render()).props.tasks.map((row) => row.id)), expectedIds)
      assert.equal(chartOf(render()).props.series[0].values[0].value, sp)
      assert.equal(chartOf(render()).props.series[0].values[0].partial, true, "the unfilled Dev-Task remains included")
      const selected = h.load(MODEL).selectProjectsMetricIssues(result.tasks, result.sprints[0], { kind: "unfinished" }, { excludeQa: !includeQa, excludeRequestInfoParent: hideRequestInfo })
      assert.deepEqual(plain(selected.map((row) => row.id)), expectedIds)
      unitsOf(render()).props.onChange("count")
      assert.equal(chartOf(render()).props.series[0].values[0].value, ids.length)
      assert.deepEqual(plain(detailOf(render()).props.tasks.map((row) => row.id)), expectedIds)
      assert.equal(result.summaries[0].unfinished.count, 9)
      assert.equal(result.summaries[0].unfinished.sp.sum, 31)
      assert.equal(h.requests.length, 0)
    }
  })
  it("uses the same filtered cohort for singleton summary numbers and their Jira links", () => {
    const { h, render } = setup(filterSource().filter((row) => !row.sprintIds.includes(6824)), { ...request, sprintIds: [6823] })
    setFilters(render, false, true)
    const tile = nodes(panel(render())).find((node) => node.props["data-summary-tile"] !== undefined)
    assert.match(text(tile), /6 張/)
    assert.match(text(tile), /19 SP/)
    const hrefs = [...renderToStaticMarkup(tile).matchAll(/href="([^"]+)"/g)].map((match) => new URL(match[1].replaceAll("&amp;", "&")))
    const queries = hrefs.map((href) => href.searchParams.get("jql")).filter(Boolean)
    assert.equal(queries.length, 2)
    assert.ok(queries.every((query) => query === "id in (101, 105, 106, 107, 108, 109) ORDER BY key ASC"))
    assert.equal(chartOf(render()).props.series[0].values[0].value, 19)
    assert.equal(detailOf(render()).props.tasks.length, 6)
    assert.equal(h.requests.length, 0)
  })
  it("keeps unfinished QA controls independent from the output topic", () => {
    const { h, render } = setup(filterSource())
    setFilters(render, false, true)
    assert.equal(checkboxOf(render(), "含 QA-Task", "output").props.checked, true)
    const output = () => nodes(render()).find((node) => node.type?.name === "ProjectsTrendChart" && node.props.id === "output")
    assert.equal(output().props.series[0].values[0].value, 111)
    checkboxOf(render(), "含 QA-Task", "output").props.onChange({ target: { checked: false } })
    assert.equal(output().props.series[0].values[0].value, 100)
    setFilters(render, true, false)
    assert.equal(chartOf(render()).props.series[0].values[0].value, 31)
    assert.equal(checkboxOf(render(), "含 QA-Task").props.checked, true)
    assert.equal(checkboxOf(render(), "含 QA-Task", "output").props.checked, false)
    assert.equal(h.requests.length, 0)
  })
  it("seeds the newest Sprint once and retains manual choice or dismissal through unit/filter changes", () => {
    const { render, draw } = setup()
    assert.equal(detailOf(render()).props.sprint.id, 6824)
    assert.equal(nodes(draw()).find((node) => node.props["data-selection-index"] !== undefined).props["data-selection-index"], 1)
    target(draw(), 1).props.onClick()
    assert.equal(detailOf(render()).props.sprint.id, 6824, "first click confirms the seeded Sprint")
    target(draw(), 1).props.onClick()
    assert.equal(detailOf(render()).props.sprint, null)
    unitsOf(render()).props.onChange("count")
    setFilters(render, false, true)
    assert.equal(detailOf(render()).props.sprint, null, "a cleared selection stays in aggregate mode rather than re-seeding")
    target(draw(), 0).props.onClick()
    unitsOf(render()).props.onChange("sp")
    setFilters(render, true, false)
    assert.equal(detailOf(render()).props.sprint.id, 6823)
    assert.equal(setup().result.sprints.at(-1).id, 6824)
    assert.equal(detailOf(setup().render()).props.sprint.id, 6824, "a fresh result starts on the newest Sprint again")
    const empty = setup([rowTask(101, { sprintIds: [6824], parentStatus: "Request Info" })])
    setFilters(empty.render, true, true)
    assert.equal(detailOf(empty.render()).props.sprint.id, 6824)
    assert.equal(detailOf(empty.render()).props.tasks.length, 0)
    assert.match(text(empty.detail()), /沒有未完成工作單/)
  })
  it("shows a deduplicated aggregate of all selected Sprints when selection is cleared, preserving filters and sorting", () => {
    const { h, render, draw, detail } = setup()
    target(draw(), 1).props.onClick()
    target(draw(), 1).props.onClick()
    assert.equal(detailOf(render()).props.sprint, null)
    assert.deepEqual(plain(detailOf(render()).props.tasks.map((row) => row.id)), ["101", "102", "103", "104", "107"])
    assert.equal(detailOf(render()).props.tasks.filter((row) => row.id === "107").length, 1)
    assert.equal(h.load(MODEL).projectsWorkTotals(detailOf(render()).props.tasks).sp.sum, 13, "shared issues are not double counted")
    assert.match(text(detail()), /全部已選 Sprint 加總/)
    assert.equal(nodes(draw()).find((node) => node.props["data-selection-index"] !== undefined), undefined)
    statusSortButton(detail()).props.onClick()
    unitsOf(render()).props.onChange("count")
    assert.equal(nodes(detail()).find((node) => node.type === "th" && node.props["aria-sort"] !== undefined).props["aria-sort"], "ascending")
    assert.equal(detailOf(render()).props.sprint, null)
    assert.equal(h.requests.length, 0)
    const filtered = setup(filterSource())
    setFilters(filtered.render, false, true)
    target(filtered.draw(), 1).props.onClick()
    target(filtered.draw(), 1).props.onClick()
    assert.equal(detailOf(filtered.render()).props.sprint, null)
    assert.deepEqual(plain(detailOf(filtered.render()).props.tasks.map((row) => row.id)), ["101", "105", "106", "107", "108", "109", "111"])
    assert.equal(filtered.h.requests.length, 0)
    target(filtered.draw(), 0).props.onClick()
    assert.equal(detailOf(filtered.render()).props.sprint.id, 6823)
    assert.deepEqual(plain(detailOf(filtered.render()).props.tasks.map((row) => row.id)), ["101", "105", "106", "107", "108", "109"])
  })
  it("reuses status colors and cycles accessible copy-only status sorting while filters/units retain its direction", () => {
    const { result, render, detail } = setup([
      rowTask(105, { parentStatus: "Request Info" }), rowTask(103, { parentStatus: "In Progress" }),
      rowTask(102, { parentStatus: "Done" }), rowTask(104, { parentStatus: null }), rowTask(101, { parentStatus: "In Progress" }),
    ], { ...request, sprintIds: [6823] })
    const original = JSON.stringify(result.tasks)
    assert.deepEqual(rowIds(detail()), ["105", "103", "102", "104", "101"])
    for (const row of result.tasks) {
      const cell = nodes(nodes(detail()).find((node) => node.type === "tr" && node.key === row.id)).filter((node) => node.type === "td")[1]
      assert.ok(nodes(cell).some((node) => node.props.children === (row.parentStatus ?? "—") && node.props.className === statusColorClass(row.parentStatus)))
    }
    const header = () => nodes(detail()).find((node) => node.type === "th" && node.props["aria-sort"] !== undefined)
    assert.equal(header().props["aria-sort"], "none")
    statusSortButton(detail()).props.onClick()
    assert.equal(header().props["aria-sort"], "ascending")
    assert.deepEqual(rowIds(detail()), ["102", "101", "103", "105", "104"])
    unitsOf(render()).props.onChange("count")
    setFilters(render, true, true)
    assert.equal(header().props["aria-sort"], "ascending")
    assert.deepEqual(rowIds(detail()), ["102", "101", "103", "104"])
    setFilters(render, true, false)
    statusSortButton(detail()).props.onClick()
    assert.equal(header().props["aria-sort"], "descending")
    assert.deepEqual(rowIds(detail()), ["105", "101", "103", "102", "104"])
    statusSortButton(detail()).props.onClick()
    assert.equal(header().props["aria-sort"], "none")
    assert.deepEqual(rowIds(detail()), ["105", "103", "102", "104", "101"])
    assert.equal(JSON.stringify(result.tasks), original)
    assert.ok(statusSortButton(detail()).props["aria-label"].includes("升冪"))
    assert.equal(statusSortButton(detail()).props.type, "button")
  })
})

describe("Projects unified unfinished chart and inline issue list", () => {
  it("defaults to SP with exactly one chart and switches only its metric, retaining its identity and cohort", () => {
    const { h, render } = setup()
    assert.equal(nodes(panel(render())).filter((node) => node.type?.name === "ProjectsTrendChart").length, 1)
    assert.equal(chartOf(render()).props.id, "unfinished")
    assert.equal(unitsOf(render()).props.value, "sp")
    assert.deepEqual(plain(unitsOf(render()).props.choices), ["sp", "count"])
    assert.deepEqual(plain(chartOf(render()).props.series[0].values.map((value) => value.value)), [6, 8])
    assert.equal(detailOf(render()).props.sprint.id, 6824, "every new result starts on the newest Sprint")
    assert.deepEqual(plain(detailOf(render()).props.tasks.map((row) => row.id)), ["104", "107"])
    const identity = [chartOf(render()).type, chartOf(render()).key, chartOf(render()).props.series[0].id, chartOf(render()).props.series[0].color]
    unitsOf(render()).props.onChange("count")
    assert.equal(chartOf(render()).props.unit, "張數")
    assert.equal(chartOf(render()).props.integer, true)
    assert.deepEqual(plain(chartOf(render()).props.series[0].values.map((value) => value.value)), [4, 2])
    assert.deepEqual([chartOf(render()).type, chartOf(render()).key, chartOf(render()).props.series[0].id, chartOf(render()).props.series[0].color], identity)
    unitsOf(render()).props.onChange("sp")
    assert.deepEqual(plain(chartOf(render()).props.series[0].values.map((value) => value.value)), [6, 8])
    assert.equal(h.requests.length, 0)
  })
  it("lists the selected Sprint's full unfinished cohort in the requested seven-column order", () => {
    const { h, render, draw, detail } = setup()
    target(draw(), 0).props.onClick()
    const element = detailOf(render())
    assert.equal(element.props.sprint.id, 6823)
    assert.deepEqual(plain(element.props.tasks.map((row) => row.id)), ["101", "102", "103", "107"])
    const tree = detail(), headings = nodes(tree).filter((node) => node.type === "th")
    assert.equal(tree.props.id, target(draw(), 0).props["aria-controls"])
    assert.equal(nodes(tree).find((node) => node.props.role === "region").props.tabIndex, 0, "the local table scroller remains keyboard accessible")
    assert.deepEqual(headings.map(text), ["母票類型", "母票狀態", "Ticket", "Summary", "狀態", "Assignee", "SP"])
    const rows = nodes(tree).filter((node) => node.type === "tr" && node.key !== null)
    const first = nodes(rows.find((row) => row.key === "101")).filter((node) => node.type === "td")
    assert.match(text(first[0]), /Story/)
    assert.equal(text(first[1]), "In Progress")
    assert.equal(text(first[2]), "SUN-101")
    assert.equal(text(first[3]), "Work 101")
    assert.ok(nodes(first[3]).some((node) => String(node.props.className ?? "").includes("min-w-48") && String(node.props.className ?? "").includes("whitespace-normal")), "narrow tables keep Summary readable and wrap it instead of squeezing it to a few characters")
    assert.equal(text(first[4]), "To Do")
    assert.equal(text(first[5]), "Assignee 1")
    assert.equal(text(first[6]), "5")
    assert.match(renderToStaticMarkup(tree), /Issue type：Story/)
    assert.match(renderToStaticMarkup(tree), /Issue type：Task/)
    assert.match(renderToStaticMarkup(tree), /Issue type：Bug/)
    const zero = nodes(rows.find((row) => row.key === "102")).filter((node) => node.type === "td")
    assert.equal(text(zero[1]), "Blocked")
    assert.equal(text(zero[4]), "Done", "Resolved null remains unfinished even when the child status says Done")
    assert.equal(text(zero[5]), "未指派")
    assert.equal(text(zero[6]), "0")
    const missing = nodes(rows.find((row) => row.key === "103")).filter((node) => node.type === "td")
    assert.equal(text(missing[1]), "—")
    assert.equal(text(missing[4]), "—")
    assert.equal(text(missing[6]), "-")
    unitsOf(render()).props.onChange("count")
    assert.deepEqual(plain(detailOf(render()).props.tasks.map((row) => row.id)), ["101", "102", "103", "107"])
    assert.equal(nodes(draw()).find((node) => node.props["data-selection-index"] !== undefined).props["data-selection-index"], 0)
    assert.equal(text(nodes(detail()).filter((node) => node.type === "tr" && node.key === "101")[0]).includes("5"), true)
    target(draw(), 1).props.onClick()
    assert.deepEqual(plain(detailOf(render()).props.tasks.map((row) => row.id)), ["104", "107"])
    target(draw(), 1).props.onClick()
    assert.equal(detailOf(render()).props.sprint, null)
    assert.deepEqual(plain(detailOf(render()).props.tasks.map((row) => row.id)), ["101", "102", "103", "104", "107"])
    assert.equal(h.requests.length, 0)
  })
  it("supports one Sprint without a fabricated line and selects its list via Enter or Space", () => {
    for (const key of ["Enter", " "]) {
      const { h, render, draw } = setup(source().filter((row) => !row.sprintIds.includes(6824)), { ...request, sprintIds: [6823] })
      assert.equal(chartOf(render()).props.sprints.length, 1)
      assert.equal(nodes(draw()).filter((node) => node.props.className === "projects-trend-line").length, 0)
      assert.equal(detailOf(render()).props.sprint.id, 6823, "the singleton also starts selected")
      target(draw(), 0).props.onKeyDown({ key, preventDefault() {} })
      assert.ok(detailOf(render()))
      assert.equal(detailOf(render()).props.sprint.id, 6823)
      assert.equal(h.requests.length, 0)
    }
  })
  it("centers every table header while retaining the sort button's full click target", () => {
    const { detail } = setup()
    const tree = detail()
    assert.equal(nodes(tree).find((node) => node.type === "table").props.className, "projects-unfinished-table")
    const button = statusSortButton(tree)
    assert.ok(button.props.className.startsWith("flex min-h-9"))
    assert.ok(!button.props.className.includes("inline-flex"), "block flex avoids an extra inline baseline offset")
    const css = readFileSync(new URL("../app/(app)/analytics/projects/projects-analysis.css", import.meta.url), "utf8")
    assert.match(css, /\.projects-analysis \.projects-unfinished-table thead th\s*\{[^}]*vertical-align:\s*middle/)
  })
  it("renders plain tickets without a Jira origin and escapes summaries while retaining the complete text", () => {
    const summary = '<img src="x" onerror="alert(1)"> A long unfinished summary'
    const { result, draw, detail } = setup([rowTask(101, { summary })])
    result.jiraBaseUrl = null
    target(draw(), 0).props.onClick()
    const html = renderToStaticMarkup(detail())
    assert.doesNotMatch(html, /<a\b|<img\b/)
    assert.match(html, /&lt;img/)
    assert.match(html, /SUN-101/)
    assert.ok(nodes(detail()).some((node) => node.props.children === summary && String(node.props.className ?? "").includes("whitespace-normal")))
  })
  it("keeps all-missing SP rows visible, shows unknown parent icons for legacy metadata, and handles empty selection", () => {
    const { render, draw, detail } = setup([rowTask(101, { points: null, parentIssueType: null })])
    assert.deepEqual(plain(chartOf(render()).props.series[0].values.map((value) => value.value)), [null, 0])
    target(draw(), 0).props.onClick()
    assert.match(renderToStaticMarkup(detail()), /Issue type 未知/)
    assert.equal(text(nodes(detail()).filter((node) => node.type === "td").at(-1)), "-")
    unitsOf(render()).props.onChange("count")
    assert.deepEqual(plain(chartOf(render()).props.series[0].values.map((value) => value.value)), [1, 0])
    assert.equal(detailOf(render()).props.tasks.length, 1)
    target(draw(), 1).props.onClick()
    assert.equal(detailOf(render()).props.tasks.length, 0)
    assert.match(text(detail()), /沒有未完成工作單/)
  })
})

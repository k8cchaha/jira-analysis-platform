import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { projectsHarness, MODEL, CLIENT, VIEW, CHART, plain, nodes, task, resultFixture } from "./helpers/projects-analysis-harness.mjs"
const props = { project: "SUN", selectedSprintIds: [6823], error: null, sprints: [], dateMigrationHref: null }
const filter = (tree) => nodes(tree).find((node) => node.type?.name === "ProjectsFilter")
const view = (tree) => nodes(tree).find((node) => node.type?.name === "ProjectsAnalysisView")
function setup(initial = props) { const h = projectsHarness(), Component = h.load(CLIENT).ProjectsQueryClient; const render = (next = initial) => h.invoke(Component, next); render(); h.flushEffects(); return { h, Component, render } }
function success(h, index, tasks = [task(1)]) {
  const request = JSON.parse(h.requests[index].options.body)
  const result = resultFixture(h.load(MODEL), tasks, request)
  h.requests[index].resolve(Response.json({ status: "success", data: result }))
}

describe("explicit projects query lifecycle (controlled hooks)", () => {
  it("never fetches on entry, URL restore, group defaults or history; preserves controlled Team", () => {
    const { h, render } = setup()
    filter(render()).props.onGroupsChange(["ent-web"])
    h.groupStates["ent-web"] = { status: "success" }
    const next = render({ ...props, project: "TKK", selectedSprintIds: [6619] })
    assert.deepEqual([...filter(next).props.groups], ["ent-web"])
    h.flushEffects(); h.event("popstate"); render(); assert.equal(h.requests.length, 0)
  })
  it("submits one bounded scope POST, no member IDs; same group readiness does not refetch", async () => {
    const { h, render } = setup()
    const pending = filter(render()).props.onQuery(props)
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, "/api/analytics/projects/query")
    assert.equal(h.requests[0].options.method, "POST")
    assert.deepEqual(Object.keys(JSON.parse(h.requests[0].options.body)).sort(), ["browserTimeZone", "groups", "project", "sprintIds"])
    success(h, 0); await pending
    assert.ok(view(render())); h.groupStates["ent-web"] = { status: "success" }; render(); assert.equal(h.requests.length, 1)
  })
  it("does not query selected Teams before full metadata is ready", () => {
    const { h, render } = setup(); filter(render()).props.onGroupsChange(["ent-web"])
    filter(render()).props.onQuery(props); assert.equal(h.requests.length, 0)
    assert.equal(filter(render()).props.teamReady, false)
  })
  it("immediate draft invalidation aborts and late results never overwrite", async () => {
    const { h, render } = setup(); const pending = filter(render()).props.onQuery(props)
    filter(render()).props.onDraftChange(); assert.equal(h.requests[0].options.signal.aborted, true)
    success(h, 0); await pending; assert.equal(view(render()), undefined)
  })
  it("A→B→A clears A permanently and scope changes gate before effect cleanup", async () => {
    const { h, render } = setup(); const pending = filter(render()).props.onQuery(props)
    success(h, 0); await pending; assert.ok(view(render()))
    assert.equal(view(render({ ...props, selectedSprintIds: [6824] })), undefined)
    assert.equal(view(render(props)), undefined); h.flushEffects(); assert.equal(h.requests.length, 1)
  })
  it("new submission wins even if prior fetch ignores abort; requery retains old frame dimmed", async () => {
    const { h, render } = setup(); const old = filter(render()).props.onQuery(props), newer = filter(render()).props.onQuery(props)
    success(h, 1, [task(2, { points: 8 })]); await newer
    success(h, 0); await old; assert.equal(view(render()).props.result.summaries[0].output.sp.sum, 8)
    const priorKey = view(render()).key
    const retry = filter(render()).props.onQuery(props); assert.ok(view(render())); assert.equal(filter(render()).props.loading, true)
    success(h, 2, [task(3, { points: 5 })]); await retry; assert.equal(view(render()).props.result.summaries[0].output.sp.sum, 5)
    assert.notEqual(view(render()).key, priorKey, "new success remounts presentation state even with the same timestamp")
  })
  it("history and unmount abort current requests; same-scope history does not revive", async () => {
    const { h, Component, render } = setup(); const pending = filter(render()).props.onQuery(props)
    h.event("popstate"); assert.equal(h.requests[0].options.signal.aborted, true)
    success(h, 0); await pending; assert.equal(view(render()), undefined)
    filter(render()).props.onQuery(props); h.unmount(Component); assert.equal(h.requests[1].options.signal.aborted, true)
  })
  it("malformed/foreign scope and server errors show retry without partial new data", async () => {
    const { h, render } = setup(); const pending = filter(render()).props.onQuery(props)
    h.requests[0].resolve(Response.json({ status: "error", error: { code: "limit", message: "範圍超限" } }, { status: 422 })); await pending
    assert.equal(view(render()), undefined)
    assert.ok(nodes(render()).some((node) => node.props.role === "alert"))
    const retry = nodes(render()).find((node) => node.type === "button" && node.props.children === "重試相同條件").props.onClick()
    assert.equal(h.requests.length, 2); success(h, 1); await retry; assert.ok(view(render()))
  })
})

const chartNode = (tree, id) => nodes(tree).find((node) => node.type?.name === "ProjectsTrendChart" && node.props.id === id)
const target = (tree, index = 0) => nodes(tree).find((node) => node.props["data-sprint-index"] === index)
const readout = (tree) => nodes(tree).find((node) => node.props.role === "region")
const text = (tree) => renderToStaticMarkup(tree).replace(/<[^>]*>/g, "")
const paths = (tree) => nodes(tree).filter((node) => node.type === "path" && node.props.className === "projects-trend-line")
const markers = (tree) => nodes(tree).filter((node) => node.type?.name === "Marker")
const multiRequest = { project: "SUN", sprintIds: [6824, 6823], groups: [], browserTimeZone: "UTC" }
function searchLinks(tree) {
  return [...renderToStaticMarkup(tree).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    tag: match[1], label: match[1].match(/aria-label="([^"]*)"/)?.[1],
    href: match[1].match(/href="([^"]*)"/)?.[1].replaceAll("&amp;", "&"),
  })).filter((link) => link.href?.includes("/issues/?jql="))
}
function expectQuery(tree, label, ids) {
  const matching = searchLinks(tree).filter((link) => link.label?.includes(label))
  assert.ok(matching.length, `Missing numeric link: ${label}`)
  for (const link of matching) {
    assert.equal(new URL(link.href).searchParams.get("jql"), `id in (${[...new Set(ids)].sort().join(", ")}) ORDER BY key ASC`)
    assert.match(link.tag, /target="_blank"/); assert.match(link.tag, /rel="noopener noreferrer"/)
  }
}

const topicTabs = (tree) => nodes(tree).filter((node) => node.props.role === "tab")
const topicPanels = (tree) => nodes(tree).filter((node) => node.props.role === "tabpanel")
const activePanel = (tree) => topicPanels(tree).find((node) => !node.props.hidden)
const localDetail = (tree) => nodes(tree).find((node) => node.props.description === "本次完整查詢資料的唯讀明細，不會另查 Jira。")
function topicTrigger(log = []) {
  return { focus() { log.push("focus") }, scrollIntoView(options) { log.push(options) } }
}
function clickTopic(tree, label, trigger = topicTrigger()) {
  topicTabs(tree).find((tab) => tab.props.children === label).props.onClick({ currentTarget: trigger })
}

describe("local Projects topic tabs", () => {
  it("links six stable tabs to mounted panels with one active topic and topic-local summaries", () => {
    for (const request of [undefined, multiRequest]) {
      const h = projectsHarness(), Component = h.load(VIEW).ProjectsAnalysisView
      const result = resultFixture(h.load(MODEL), [task(1)], request), render = () => h.invoke(Component, { result })
      const tree = render(), tabs = topicTabs(tree), panels = topicPanels(tree)
      assert.deepEqual(tabs.map((tab) => tab.props.children), ["總輸出", "完成的任務類型", "Sprint 完成率", "開發品質", "開發壓力", "目前未完成"])
      assert.equal(panels.length, 6)
      assert.equal(activePanel(tree).props["data-topic"], "output")
      assert.equal(tabs.filter((tab) => tab.props["aria-selected"]).length, 1)
      assert.equal(tabs.filter((tab) => tab.props.tabIndex === 0).length, 1)
      assert.equal(panels.filter((panel) => !panel.props.hidden).length, 1)
      for (const [index, panel] of panels.entries()) {
        assert.equal(tabs[index].props["aria-controls"], panel.props.id)
        assert.equal(panel.props["aria-labelledby"], tabs[index].props.id)
        assert.equal(tabs[index].props.type, "button")
        assert.equal(nodes(panel).filter((node) => "data-summary-tile" in node.props).length, request ? 0 : 1)
      }
      const ids = panels.map((panel) => panel.props.id)
      for (const [index, tab] of tabs.entries()) {
        const log = []
        clickTopic(render(), tab.props.children, topicTrigger(log))
        const next = render()
        assert.equal(activePanel(next).props["data-topic"], panels[index].props["data-topic"])
        assert.deepEqual(topicPanels(next).map((panel) => panel.props.id), ids)
        assert.equal(topicPanels(next).filter((panel) => !panel.props.hidden).length, 1)
        assert.equal(topicTabs(next).filter((trigger) => trigger.props.tabIndex === 0).length, 1)
        assert.deepEqual(plain(log), ["focus", { block: "nearest", inline: "nearest" }])
      }
      assert.equal(nodes(render()).filter((node) => node.type?.name === "DataTable").length, 6)
      assert.equal(nodes(render()).filter((node) => node.type?.name === "ProjectsTrendChart").length, request ? 7 : 2)
      assert.equal(h.requests.length, 0)
    }
  })
  it("uses Sprint 完成率 for metric labels while retaining the internal metric identifiers", () => {
    for (const request of [undefined, multiRequest]) {
      const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1)], request)
      const Component = h.load(VIEW).ProjectsAnalysisView, tree = h.invoke(Component, { result })
      const panel = topicPanels(tree).find((node) => node.props["data-topic"] === "commitment")
      assert.equal(nodes(panel).find((node) => node.type?.name === "Panel").props.title, "Sprint 完成率")
      assert.ok(h.render(Component, { result }).includes("Sprint 完成率 比率與分子分母"))
      assert.doesNotMatch(h.render(Component, { result }), /Commitment/)
      if (request) {
        const series = chartNode(tree, "commitment").props.series[0]
        assert.equal(series.id, "commitment")
        assert.equal(series.label, "Sprint 完成率")
        assert.deepEqual(plain(series.values[0].actions.map((action) => action.label)), ["Sprint 完成率 分子 · 完成明細", "Sprint 完成率 分母 · 全部明細"])
      }
      assert.equal(h.requests.length, 0)
    }
  })
  it("uses wrapping arrows and Home/End, without intercepting chart or unrelated keys", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1)], multiRequest)
    const Component = h.load(VIEW).ProjectsAnalysisView, render = () => h.invoke(Component, { result })
    const focused = []
    for (const tab of topicTabs(render())) tab.props.ref({ focus() { focused.push(tab.props.children) }, scrollIntoView() {} })
    for (const [key, expected] of [["ArrowLeft", "unfinished"], ["ArrowRight", "output"], ["End", "unfinished"], ["Home", "output"], ["ArrowRight", "types"]]) {
      let prevented = 0
      topicTabs(render()).find((tab) => tab.props["aria-selected"]).props.onKeyDown({ key, preventDefault() { prevented++ } })
      const next = render()
      assert.equal(activePanel(next).props["data-topic"], expected)
      assert.equal(prevented, 1)
      assert.equal(focused.at(-1), topicTabs(next).find((tab) => tab.props["aria-selected"]).props.children)
    }
    for (const key of ["Escape", "ArrowDown", "Tab", "Enter"]) {
      topicTabs(render()).find((tab) => tab.props["aria-selected"]).props.onKeyDown({ key, preventDefault() { assert.fail(`Unexpected prevention: ${key}`) } })
      assert.equal(activePanel(render()).props["data-topic"], "types")
    }
    assert.ok(topicPanels(render()).every((panel) => !panel.props.onKeyDown))
    assert.equal(h.requests.length, 0)
  })
  it("preserves unit choices, chart identities and observation/emphasis across topic switching", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1)], multiRequest)
    const Component = h.load(VIEW).ProjectsAnalysisView, render = () => h.invoke(Component, { result })
    clickTopic(render(), "完成的任務類型")
    nodes(activePanel(render())).find((node) => node.type?.name === "Units").props.onChange("count")
    const original = chartNode(render(), "types"), draw = () => h.invoke(original.type, chartNode(render(), "types").props)
    nodes(draw()).find((node) => node.props["aria-label"] === "聚焦 Dev 趨勢").props.onClick()
    target(draw(), 1).props.onClick()
    const label = text(readout(draw()))
    clickTopic(render(), "開發品質")
    nodes(activePanel(render())).find((node) => node.type?.name === "Units").props.onChange("actualSp")
    clickTopic(render(), "總輸出"); clickTopic(render(), "完成的任務類型")
    assert.equal(nodes(activePanel(render())).find((node) => node.type?.name === "Units").props.value, "count")
    assert.equal(chartNode(render(), "types").key, original.key)
    assert.equal(text(readout(draw())), label)
    assert.ok(nodes(draw()).some((node) => node.props["aria-label"] === "聚焦 Dev 趨勢" && node.props["aria-pressed"]))
    clickTopic(render(), "開發品質")
    assert.equal(nodes(activePanel(render())).find((node) => node.type?.name === "Units").props.value, "actualSp")
    assert.equal(h.requests.length, 0)
  })
  it("keeps local details outside panels, clearing them only when changing topic", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1)])
    const Component = h.load(VIEW).ProjectsAnalysisView, render = () => h.invoke(Component, { result })
    nodes(activePanel(render())).find((node) => node.props["aria-label"] === "全範圍總輸出，查看工作單明細").props.onClick()
    assert.ok(localDetail(render()))
    assert.ok(topicPanels(render()).every((panel) => !localDetail(panel)))
    clickTopic(render(), "總輸出")
    assert.ok(localDetail(render()))
    clickTopic(render(), "開發品質")
    assert.equal(localDetail(render()), undefined)
    assert.equal(h.requests.length, 0)
  })
  it("has instance-safe tab and panel IDs in a shared server-rendered document", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1)])
    const Component = h.load(VIEW).ProjectsAnalysisView
    const html = renderToStaticMarkup(createElement("div", null, createElement(Component, { result }), createElement(Component, { result })))
    const controls = [...html.matchAll(/role="tab"[^>]*aria-controls="([^"]+)"/g)].map((match) => match[1])
    assert.equal(controls.length, 12)
    assert.equal(new Set(controls).size, 12)
    for (const id of controls) assert.ok(html.includes(`id="${id}" role="tabpanel"`))
  })
})

describe("projects result visualization and readonly local details", () => {
  it("renders six categories plus unknown, coverage and ratio formulas", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1, { points: null, actualPoints: 5 }), task(2, { devType: "Bug", points: 6 }), task(3, { devType: "Bug", points: 3 }), task(4, { resolvedDate: null, points: 0 })])
    const html = h.render(h.load(VIEW).ProjectsAnalysisView, { result })
    for (const text of ["—／未填", "Actual SP", "Sprint 完成率", "OP-Bug", "未分類", "200%", "分母全部 Dev-Task SP", "未填", "查看數據表", "單一 Sprint 顯示類型分布"]) assert.ok(html.includes(text), text)
    assert.doesNotMatch(html, /NaN|Infinity|績效排行/)
    assert.equal((html.match(/<details/g) ?? []).length, 6)
    assert.ok(html.includes('aria-label="圖例"'))
    const tree = h.invoke(h.load(VIEW).ProjectsAnalysisView, { result })
    assert.equal(nodes(tree).filter((node) => node.type === "button" && node.props.className?.includes("text-2xl")).length, 0)
    assert.equal(nodes(tree).filter((node) => node.type === "article" && "data-summary-tile" in node.props).length, 6)
    assert.equal(nodes(tree).filter((node) => node.type?.name === "ProjectsTrendChart").length, 2)
    assert.equal(chartNode(tree, "types").props.distribution, true)
  })
  it("omits the explanatory result header for single and multiple Sprints", () => {
    for (const request of [undefined, multiRequest]) {
      const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1)], request)
      const html = h.render(h.load(VIEW).ProjectsAnalysisView, { result })
      for (const removed of ["已套用：", "張唯一來源（含母票）", "完成日依 Jira 帳號時區", "已結束判定依瀏覽器", "不是 Sprint 起始承諾或結束快照", "請勿將跨 Sprint 輸出直接相加", "有底線的數字可在 Jira", "本站明細不會另查資料", result.startedAt, result.generatedAt]) {
        assert.ok(!html.includes(removed), `Unexpected result explanation: ${removed}`)
      }
      assert.equal((html.match(/<details/g) ?? []).length, 6)
      assert.ok(html.includes("本站明細"))
      assert.ok(html.includes('target="_blank"'))
      assert.equal(h.requests.length, 0)
    }
  })
  it("retains empty population feedback without the explanatory result header", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [])
    const html = h.render(h.load(VIEW).ProjectsAnalysisView, { result })
    assert.ok(html.includes('role="status"'))
    assert.ok(html.includes("此範圍沒有 Dev-Task／QA-Task 工作單"))
    assert.ok(!html.includes("已套用："))
  })
  it("retains finite geometry and truthful scientific labels for the smallest valid point", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1, { points: Number.MIN_VALUE, actualPoints: 0 })], multiRequest)
    const viewTree = h.invoke(h.load(VIEW).ProjectsAnalysisView, { result }), chart = chartNode(viewTree, "output")
    assert.notEqual(chart.props.series[0].values[0].display, "0")
    const tree = h.invoke(chart.type, chart.props)
    assert.doesNotMatch(renderToStaticMarkup(tree), /NaN|Infinity/)
    assert.ok(markers(tree).length > 0)
    assert.ok(paths(tree).length > 0)
  })
  it("separates the six metrics and unfinished units, projecting existing sorted summaries", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1), task(2, { resolvedDate: null, sprintIds: [6824], points: 8 })], multiRequest)
    const tree = h.invoke(h.load(VIEW).ProjectsAnalysisView, { result })
    const charts = nodes(tree).filter((node) => node.type?.name === "ProjectsTrendChart")
    assert.deepEqual(charts.map((node) => node.props.id), ["output", "types", "commitment", "quality", "pressure", "unfinished-sp", "unfinished-count"])
    assert.deepEqual([...chartNode(tree, "output").props.sprints].map((s) => s.id), [6823, 6824])
    assert.deepEqual(plain(chartNode(tree, "output").props.series[0].values.map((v) => v.value)), [3, 0])
    assert.deepEqual(plain(chartNode(tree, "unfinished-sp").props.series[0].values.map((v) => v.value)), [0, 8])
    assert.deepEqual(plain(chartNode(tree, "unfinished-count").props.series[0].values.map((v) => v.value)), [0, 1])
    assert.equal(chartNode(tree, "unfinished-count").props.integer, true)
    assert.equal(chartNode(tree, "quality").props.unit, "%")
    assert.equal(chartNode(tree, "pressure").props.series.length, 2)
    assert.match(renderToStaticMarkup(chartNode(tree, "pressure").props.series[1].values[0].note), /TKK＋SUN/)
  })
  it("switches seven type series and quality units locally without repainting identities or fetching", () => {
    const h = projectsHarness(), model = h.load(MODEL), Component = h.load(VIEW).ProjectsAnalysisView
    const result = resultFixture(model, [task(1, { points: 2, actualPoints: 4 }), task(2, { devType: "Bug", points: 3 }), task(3, { devType: "Bug", points: 3 })], multiRequest)
    const render = () => h.invoke(Component, { result })
    const units = (name, unit) => nodes(render()).find((node) => node.type?.name === "Units" && node.props.name === name).props.onChange(unit)
    const original = chartNode(render(), "types").props.series
    assert.deepEqual(plain(original.map((s) => s.label)), [...model.PROJECTS_DEV_TYPES])
    for (const unit of ["actualSp", "count", "sp"]) {
      units("完成的任務類型", unit)
      const chart = chartNode(render(), "types")
      assert.deepEqual(chart.props.series.map((s) => [s.id, s.color]), original.map((s) => [s.id, s.color]))
      chart.props.series.forEach((s, index) => assert.equal(s.values[0].value, unit === "count" ? result.summaries[0].devTypes[index].totals.count : result.summaries[0].devTypes[index].totals[unit].sum))
      assert.equal(chart.key, `types-${unit}`)
    }
    assert.equal(chartNode(render(), "quality").props.series[0].values[0].value, 2)
    for (const unit of ["sp", "actualSp", "count"]) {
      units("開發品質", unit)
      assert.equal(chartNode(render(), "quality").props.series[0].values[0].value, result.summaries[0].quality[unit].value)
    }
    assert.equal(h.requests.length, 0)
  })
  it("keeps all series while emphasizing, changing emphasis and restoring the original identities", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1)], multiRequest)
    const chart = chartNode(h.invoke(h.load(VIEW).ProjectsAnalysisView, { result }), "types")
    const render = () => h.invoke(chart.type, chart.props)
    const legends = (tree) => nodes(tree).filter((node) => node.type === "button" && node.props["aria-label"]?.startsWith("聚焦"))
    const identities = () => nodes(render()).filter((n) => n.props["data-series"]).map((n) => [n.props["data-series"], n.props.style["--series-color"]]).sort((a, b) => a[0].localeCompare(b[0]))
    const original = identities()
    legends(render())[2].props.onClick()
    assert.equal(nodes(render()).filter((n) => n.props.className?.includes("is-context")).length, 6)
    assert.equal(legends(render())[2].props["aria-pressed"], true)
    assert.equal(nodes(render()).filter((n) => n.props["data-series"]).at(-1).props["data-series"], "Dev")
    legends(render())[3].props.onClick()
    assert.equal(legends(render())[3].props["aria-pressed"], true)
    assert.deepEqual(identities(), original)
    target(render(), 0).props.onFocus()
    assert.equal(nodes(readout(render())).filter((n) => n.type === "strong").length, 7)
    assert.equal(nodes(readout(render())).filter((n) => n.type === "button").length, 1)
    assert.equal(nodes(render()).filter((n) => n.props.role === "tooltip").length, 0)
    legends(render())[3].props.onClick()
    assert.equal(nodes(render()).filter((n) => n.props.className?.includes("is-context")).length, 0)
    assert.deepEqual(identities(), original)
    assert.equal(h.requests.length, 0)
  })
  it("has focus-priority readouts, Escape, pointer crosshair, arrow navigation and touch pinning", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1)], multiRequest)
    const chart = chartNode(h.invoke(h.load(VIEW).ProjectsAnalysisView, { result }), "output"), render = () => h.invoke(chart.type, chart.props)
    const svg = (tree) => nodes(tree).find((n) => n.type === "svg" && n.props.onPointerMove)
    const pointer = { pointerType: "mouse", clientX: 640, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 640 }) } }
    svg(render()).props.onPointerMove(pointer)
    assert.match(renderToStaticMarkup(readout(render())), /Sprint 59/)
    target(render(), 0).props.onFocus()
    assert.match(renderToStaticMarkup(readout(render())), /Sprint 58/)
    svg(render()).props.onPointerLeave()
    assert.ok(readout(render()))
    target(render(), 0).props.onKeyDown({ key: "Escape" })
    assert.equal(readout(render()), undefined)
    let selector, focused = false
    target(render(), 0).props.onKeyDown({ key: "ArrowRight", preventDefault() {}, currentTarget: { ownerSVGElement: { querySelector(value) { selector = value; return { focus() { focused = true } } } } } })
    assert.equal(selector, '[data-sprint-index="1"]'); assert.equal(focused, true)
    svg(render()).props.onPointerMove({ ...pointer, pointerType: "touch" })
    assert.equal(readout(render()), undefined)
    target(render(), 1).props.onClick()
    assert.ok(readout(render())); svg(render()).props.onPointerLeave(); assert.ok(readout(render()))
    target(render(), 1).props.onKeyDown({ key: "Escape" })
    assert.equal(readout(render()), undefined)
    assert.equal(h.requests.length, 0)
  })
  const selectionFixture = () => {
    const h = projectsHarness(), Component = h.load(CHART).ProjectsTrendChart
    const sprints = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, name: index === 2 ? "Sprint 60 · 很長的合成測試名稱用於驗證選取標籤" : `Sprint ${58 + index}`, startDate: "2026-01-01", endDate: "2026-01-14" }))
    const props = { id: "selection", sprints, series: [{ id: "sp", label: "SP", color: "sp", values: sprints.map((_, index) => ({ value: index, display: String(index) })) }], unit: "SP", formatTick: String }
    const render = (overrides = {}) => h.invoke(Component, { ...props, ...overrides })
    const pointer = (index) => nodes(render()).find((n) => n.type === "svg" && n.props.onPointerMove).props.onPointerMove({ pointerType: "mouse", clientX: 58 + index * 430 / 5, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 640 }) } })
    return { h, props, render, pointer }
  }
  const selectedBand = (tree) => nodes(tree).find((n) => n.props["data-selection-index"] !== undefined)
  const selectedPill = (tree) => nodes(tree).find((n) => n.props["data-pill-index"] !== undefined)
  it("keeps hover-only sticky readouts without selection decoration and retains a committed Sprint during same-slot motion", () => {
    const { render, pointer, h } = selectionFixture()
    assert.equal(selectedBand(render()), undefined)
    assert.equal(selectedPill(render()), undefined)
    pointer(5)
    assert.match(text(readout(render())), /Sprint 63/)
    assert.ok(nodes(render()).some((n) => n.props.className === "projects-trend-crosshair"))
    assert.equal(selectedBand(render()), undefined)
    nodes(render()).find((n) => n.type === "svg" && n.props.onPointerMove).props.onPointerLeave()
    assert.match(text(readout(render())), /Sprint 63/)
    assert.equal(selectedPill(render()), undefined)
    target(render(), 2).props.onClick()
    assert.equal(selectedBand(render()).props["data-selection-index"], 2)
    assert.equal(selectedPill(render()).props["data-pill-index"], 2)
    pointer(2)
    assert.equal(selectedBand(render()).props["data-selection-index"], 2)
    pointer(4)
    assert.match(text(readout(render())), /Sprint 62/)
    assert.equal(selectedBand(render()), undefined)
    assert.equal(selectedPill(render()), undefined)
    assert.equal(h.requests.length, 0)
  })
  it("commits keyboard focus and Enter/Space, clears decoration on dismiss, and retains CSS-controlled compact focus cues", () => {
    const { render } = selectionFixture()
    target(render(), 0).props.onFocus()
    assert.equal(selectedPill(render()).props["data-pill-index"], 0)
    assert.equal(nodes(render()).filter((n) => n.props.className === "projects-trend-focus-cue").length, 6)
    target(render(), 0).props.onKeyDown({ key: "Escape" })
    assert.equal(readout(render()), undefined)
    assert.equal(selectedBand(render()), undefined)
    assert.equal(nodes(render()).filter((n) => n.props.className === "projects-trend-focus-cue").length, 6)
    for (const key of ["Enter", " "]) {
      target(render(), 0).props.onKeyDown({ key, preventDefault() {} })
      assert.equal(selectedBand(render()).props["data-selection-index"], 0)
      readout(render()).props.onKeyDown({ key: "Escape", preventDefault() {} })
      assert.equal(selectedPill(render()), undefined)
    }
    target(render(), 3).props.onFocus()
    assert.equal(selectedPill(render()).props["data-pill-index"], 3)
    assert.match(text(readout(render())), /Sprint 61/)
  })
  it("clamps selection bounds at both plot edges, preserves full names, and draws the band behind data", () => {
    const { render, props } = selectionFixture()
    for (const index of [0, 2, 5]) {
      target(render(), index).props.onFocus()
      const tree = render(), band = selectedBand(tree), pill = selectedPill(tree), svg = nodes(tree).find((n) => n.type === "svg" && n.props.onPointerMove)
      const crosshair = nodes(tree).find((n) => n.props.className === "projects-trend-crosshair")
      assert.ok(band.props.width > 0 && band.props.width <= 40)
      assert.ok(band.props.x >= 58 && band.props.x + band.props.width <= 488)
      assert.ok(crosshair.props.x1 >= band.props.x && crosshair.props.x1 <= band.props.x + band.props.width)
      assert.equal(pill.props.children, props.sprints[index].name)
      assert.equal(pill.props.title, props.sprints[index].name)
      assert.ok(parseFloat(pill.props.style.left) >= 58 / 640 * 100)
      assert.ok((parseFloat(pill.props.style.left) + parseFloat(pill.props.style.width)) <= 488 / 640 * 100 + 1e-10)
      assert.ok(parseFloat(pill.props.style.width) * 640 / 100 <= 160)
      assert.ok(nodes(tree).find((n) => n.type === "text" && n.props.children === (index === 2 ? `${props.sprints[index].name.slice(0, 12)}…` : props.sprints[index].name)).props.className.includes("is-covered"))
      const order = nodes(svg)
      assert.ok(order.indexOf(band) < order.findIndex((n) => n.props["data-series"] === "sp"))
      target(render(), index).props.onBlur()
    }
  })
  it("does not decorate distribution or all-hidden charts, and centers single Sprint selection without fabricating a line", () => {
    const { render, props } = selectionFixture()
    const single = { sprints: props.sprints.slice(0, 1), series: props.series.map((s) => ({ ...s, values: s.values.slice(0, 1) })) }
    target(render(single), 0).props.onClick()
    assert.equal(selectedPill(render(single)).props["data-pill-index"], 0)
    assert.equal(paths(render(single)).length, 0)
    assert.equal(nodes(render(single)).find((n) => n.props.className === "projects-trend-crosshair").props.x1, 273)
    const hidden = { ...single, legendToggle: { visibleIds: [], onToggle() {} } }
    assert.equal(selectedBand(render(hidden)), undefined)
    assert.equal(selectedPill(render(hidden)), undefined)
    assert.equal(nodes(render(hidden)).filter((n) => n.props.className === "projects-trend-focus-cue").length, 0)
    assert.equal(selectedBand(render({ ...single, distribution: true })), undefined)
    assert.equal(selectedPill(render({ ...single, distribution: true })), undefined)
  })
  it("keeps null gaps, valid zeros and partial marker metadata; two points are straight, three curved", () => {
    const h = projectsHarness(), Component = h.load(CHART).ProjectsTrendChart
    const sprints = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Sprint ${i}`, startDate: "2026-01-01", endDate: "2026-01-14" }))
    const values = [1, null, 0, 3, 2, null].map((value, i) => ({ value, display: String(value), partial: i === 3 }))
    const chart = h.invoke(Component, { id: "gaps", sprints, series: [{ id: "x", label: "SP", color: "sp", values }], unit: "SP", formatTick: String })
    assert.equal(paths(chart).length, 1); assert.match(paths(chart)[0].props.d, / C /)
    assert.equal(markers(chart).length, 4); assert.equal(markers(chart).filter((n) => n.props.partial).length, 1)
    assert.ok(markers(chart).some((n) => n.props.y === 206))
    const two = h.invoke(Component, { id: "two", sprints: sprints.slice(0, 2), series: [{ id: "x", label: "SP", color: "sp", values: values.slice(2, 4) }], unit: "SP", formatTick: String })
    assert.match(paths(two)[0].props.d, / L /); assert.doesNotMatch(paths(two)[0].props.d, / C /)
    const missing = h.invoke(Component, { id: "missing", sprints, series: [{ id: "x", label: "SP", color: "sp", values: sprints.map(() => ({ value: null, display: "未填" })) }], unit: "SP", formatTick: String })
    assert.equal(paths(missing).length, 0); assert.equal(markers(missing).length, 0)
    assert.match(renderToStaticMarkup(missing), /全部未填或不適用/)
  })
  it("shows ratios above 100% with interactive readouts and separate local detail actions", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1), task(2, { devType: "Bug" }), task(3, { devType: "Bug" })], multiRequest)
    const tree = h.invoke(h.load(VIEW).ProjectsAnalysisView, { result }), chart = chartNode(tree, "quality")
    assert.equal(chart.props.series[0].values[0].value, 2)
    const render = () => h.invoke(chart.type, chart.props)
    target(render(), 0).props.onFocus()
    assert.match(renderToStaticMarkup(readout(render())), /200%/)
    assert.match(text(readout(render())), /2／1 張數/)
    assert.equal(nodes(readout(render())).filter((n) => n.type === "button").length, 1)
    assert.equal(nodes(render()).filter((n) => n.props.role === "tooltip").length, 0)
    assert.deepEqual(plain(chart.props.series[0].values[0].actions.map((a) => a.label)), ["Bug 明細", "Dev 明細"])
    assert.equal(chartNode(tree, "commitment").props.series[0].values[0].actions.length, 2)
  })
  it("details use the selected observation's original metric predicates without fetching", () => {
    const h = projectsHarness(), model = h.load(MODEL), Component = h.load(VIEW).ProjectsAnalysisView
    const result = resultFixture(model, [task(1), task(2, { resolvedDate: "2026-05-12", sprintIds: [6824] }), task(3, { resolvedDate: null })], multiRequest)
    const render = () => h.invoke(Component, { result })
    const chart = chartNode(render(), "output"), draw = () => h.invoke(chart.type, chart.props)
    target(draw(), 1).props.onClick()
    nodes(draw()).find((n) => n.type === "button" && n.props.children === "全範圍總輸出 SP，查看工作單明細").props.onClick()
    const tree = render(), detail = nodes(tree).find((n) => n.props.title && text(n.props.title).includes("全範圍總輸出 SP"))
    assert.ok(text(detail.props.title).includes("Sprint 59")); assert.ok(text(detail.props.title).includes("1 張工作單"))
    assert.match(renderToStaticMarkup(tree), /Work 2/); assert.match(renderToStaticMarkup(tree), /md:hidden/)
    assert.equal(h.requests.length, 0)
  })
  it("single-Sprint distribution does not fabricate trends or turn missing points into zeros", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1, { points: null, actualPoints: null })])
    const chart = chartNode(h.invoke(h.load(VIEW).ProjectsAnalysisView, { result }), "types"), render = () => h.invoke(chart.type, chart.props)
    const tree = render()
    assert.equal(paths(tree).length, 0)
    assert.ok(nodes(tree).some((n) => n.props["data-series"] === "Dev"))
    const dev = nodes(tree).find((n) => n.props["data-series"] === "Dev")
    assert.match(renderToStaticMarkup(dev), /未填/)
    assert.equal(nodes(dev).find((n) => n.props.className?.includes("projects-distribution-fill")).props.style.width, "0%")
    nodes(dev).find((n) => n.type === "button").props.onFocus()
    assert.ok(readout(render()))
    assert.equal(h.requests.length, 0)
  })
  it("links every aggregate to its exact metric cohort and each coverage count to its own field subset", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [
      task(1, { points: 0, actualPoints: null }),
      task(2, { devType: "Bug", points: null, actualPoints: 4 }),
      task(3, { resolvedDate: null, points: 8 }),
      task(4, { resolvedDate: "2026-05-12", points: 5 }),
      task(5, { issueType: "QA-Task", devType: "OP-Bug", projectKey: "TKK", projectId: "200" }),
      task(6, { sprintIds: [6824], resolvedDate: "2026-05-12" }),
    ], multiRequest)
    const tree = h.invoke(h.load(VIEW).ProjectsAnalysisView, { result })
    expectQuery(tree, "Sprint 58 · 全範圍總輸出 SP，", ["1", "2", "5"])
    expectQuery(tree, "Sprint 58 · 全範圍總輸出 Actual SP，", ["1", "2", "5"])
    expectQuery(tree, "Sprint 58 · 全範圍總輸出 SP · 已填張數", ["1", "5"])
    expectQuery(tree, "Sprint 58 · 全範圍總輸出 SP · 未填張數", ["2"])
    expectQuery(tree, "Sprint 58 · 全範圍總輸出 Actual SP · 已填張數", ["2", "5"])
    expectQuery(tree, "Sprint 58 · 全範圍總輸出 Actual SP · 未填張數", ["1"])
    expectQuery(tree, "Sprint 58 · 全範圍總輸出 SP · 完整率母體", ["1", "2", "5"])
    expectQuery(tree, "Sprint 58 · 目前未完成，", ["3"])
    expectQuery(tree, "Sprint 58 · 區間外完成，", ["4"])
    expectQuery(tree, "Sprint 58 · 區間外完成 SP，", ["4"])
    expectQuery(tree, "Sprint 58 · 母體張數，", ["1", "2", "3", "4", "5"])
    expectQuery(tree, "Sprint 58 · TKK SP，", ["5"])
    expectQuery(tree, "Sprint 58 · SUN SP，", ["1", "2", "3", "4"])
    expectQuery(tree, "Sprint 58 · TKK＋SUN SP，", ["1", "2", "3", "4", "5"])
    expectQuery(tree, "Sprint 59 · 全範圍總輸出 SP，", ["6"])
    assert.equal(h.requests.length, 0)
  })
  it("links ratio comparison, numerator and denominator separately without changing formulas", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1), task(2, { devType: "Bug" }), task(3, { devType: "Bug", issueType: "QA-Task" }), task(4, { resolvedDate: null }), task(5, { devType: "OP-Bug" })], multiRequest)
    const tree = h.invoke(h.load(VIEW).ProjectsAnalysisView, { result })
    expectQuery(tree, "Sprint 完成率 · 全部 Dev-Task", ["1", "2", "4", "5"])
    expectQuery(tree, "Sprint 完成率 分子 · SP", ["1", "2", "5"])
    expectQuery(tree, "Sprint 完成率 分母 · SP", ["1", "2", "4", "5"])
    expectQuery(tree, "Bug／Dev · Bug＋Dev 比較母體", ["1", "2", "3"])
    for (const unit of ["張數", "SP", "Actual SP"]) {
      expectQuery(tree, `Bug／Dev 分子 · ${unit}`, ["2", "3"])
      expectQuery(tree, `Bug／Dev 分母 · ${unit}`, ["1"])
    }
    const chart = chartNode(tree, "quality"), render = () => h.invoke(chart.type, chart.props)
    target(render(), 0).props.onFocus()
    expectQuery(readout(render()), "Bug＋Dev 比較母體", ["1", "2", "3"])
    assert.match(text(readout(render())), /200%/)
  })
  it("retains the same readout when leaving the plot or tabbing into links, with one roving observation", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1), task(2, { sprintIds: [6824], resolvedDate: "2026-05-12" })], multiRequest)
    const chart = chartNode(h.invoke(h.load(VIEW).ProjectsAnalysisView, { result }), "output"), render = () => h.invoke(chart.type, chart.props)
    const svg = () => nodes(render()).find((n) => n.type === "svg" && n.props.onPointerMove)
    target(render(), 0).props.onFocus(); target(render(), 0).props.onBlur()
    svg().props.onPointerLeave()
    assert.match(text(readout(render())), /Sprint 58/)
    readout(render()).props.onFocusCapture()
    svg().props.onPointerMove({ pointerType: "mouse", clientX: 640, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 640 }) } })
    assert.match(text(readout(render())), /Sprint 58/)
    expectQuery(readout(render()), "全範圍總輸出 SP", ["1"])
    assert.equal(nodes(render()).filter((n) => n.props["data-sprint-index"] !== undefined && n.props.tabIndex === 0).length, 1)
    assert.equal(target(render(), 0).props["aria-controls"], "output-readout")
    readout(render()).props.onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null })
    svg().props.onPointerMove({ pointerType: "mouse", clientX: 640, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 640 }) } })
    assert.match(text(readout(render())), /Sprint 59/)
    readout(render()).props.onKeyDown({ key: "Escape", preventDefault() {} })
    assert.equal(readout(render()), undefined)
    assert.equal(h.requests.length, 0)
  })
  it("single-Sprint summary and distribution use external numbers and independent local details", () => {
    const h = projectsHarness(), result = resultFixture(h.load(MODEL), [task(1, { points: 0 }), task(2, { devType: "Bug" }), task(3, { devType: "OP-Bug" })])
    const Component = h.load(VIEW).ProjectsAnalysisView, render = () => h.invoke(Component, { result })
    const tiles = nodes(render()).filter((n) => n.type === "article" && "data-summary-tile" in n.props)
    expectQuery(tiles[0], "總輸出 SP", ["1", "2", "3"])
    expectQuery(tiles[3], "Bug＋Dev 比較母體", ["1", "2"])
    nodes(tiles[3]).find((n) => n.type === "button").props.onClick()
    const details = nodes(render()).find((n) => n.props.title && text(n.props.title).includes("張工作單"))
    assert.match(text(details.props.title), /2 張工作單/)
    assert.doesNotMatch(renderToStaticMarkup(details), /Work 3/)
    expectQuery(details, "明細張數", ["1", "2"])
    assert.match(renderToStaticMarkup(details), /href="https:\/\/jira.example.test\/browse\/SUN-1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*aria-label="SUN-1 · SP/)
    const chart = chartNode(render(), "types"), distribution = h.invoke(chart.type, chart.props)
    expectQuery(distribution, "Dev SP", ["1"])
    const html = renderToStaticMarkup(render())
    for (const match of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) assert.doesNotMatch(match[1], /<a\b/)
    for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) assert.doesNotMatch(match[1], /<a\b|<button\b/)
  })
  it("empty cohorts, placeholders and missing Jira origin stay unlinked; nonempty zero is linked", () => {
    const h = projectsHarness(), Component = h.load(VIEW).ProjectsAnalysisView
    const result = resultFixture(h.load(MODEL), [task(1, { points: 0, actualPoints: null })])
    const render = (result) => h.invoke(Component, { result })
    expectQuery(render(result), "總輸出 SP，", ["1"])
    assert.equal(searchLinks(render(result)).some((a) => a.label?.includes("總輸出 Actual SP，")), false)
    assert.equal(searchLinks(render(result)).some((a) => a.label?.includes("目前未完成")), false)
    assert.doesNotMatch(renderToStaticMarkup(render({ ...result, jiraBaseUrl: null })), /href=/)
    assert.doesNotMatch(renderToStaticMarkup(render(resultFixture(h.load(MODEL)))), /href=/)
    assert.equal(h.requests.length, 0)
  })
  it("oversized exact cohorts keep complete local details and never truncate or broaden Jira searches", () => {
    const h = projectsHarness(), Component = h.load(VIEW).ProjectsAnalysisView
    const tasks = Array.from({ length: 1100 }, (_, i) => task(`${"9".repeat(26)}${String(i + 1).padStart(4, "0")}`))
    const result = resultFixture(h.load(MODEL), tasks), render = () => h.invoke(Component, { result })
    assert.equal(searchLinks(render()).length, 0)
    assert.match(renderToStaticMarkup(render()), /無法完整建立 Jira 查詢/)
    const tile = nodes(render()).find((n) => n.type === "article" && "data-summary-tile" in n.props)
    nodes(tile).find((n) => n.type === "button").props.onClick()
    const details = nodes(render()).find((n) => n.props.title && text(n.props.title).includes("張工作單"))
    assert.match(text(details.props.title), /1,100 張工作單/)
    assert.equal(nodes(details).filter((n) => n.type === "tr").length, 1101)
    assert.equal(h.requests.length, 0)
  })
})

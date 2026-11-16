import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { projectsHarness, MODEL, VIEW, nodes, plain, task, resultFixture } from "./helpers/projects-analysis-harness.mjs"

const request = { project: "SUN", sprintIds: [6824, 6823], groups: [], browserTimeZone: "UTC" }
const attribution = { status: "available", byAssignee: [
  { accountId: "account-android", teamId: "ent-android" },
  { accountId: "account-web", teamId: "ent-web" },
] }
const tasks = () => [
  task(1, { assigneeAccountId: "account-android", points: 6, actualPoints: 8 }),
  task(2, { assigneeAccountId: "account-web", points: 2, actualPoints: 4 }),
  task(3, { assigneeAccountId: "account-android", points: 4, actualPoints: null, sprintIds: [6824], resolvedDate: "2026-05-12" }),
]
const text = (tree) => renderToStaticMarkup(tree).replace(/<[^>]*>/g, " ")
// The detail panel is passed to the harness as a component element, so locate it by its React name.
const detailOf = (tree) => nodes(tree).find((node) => node.type?.name === "ProjectsSprintDetail")

function setup(options = {}) {
  const h = projectsHarness(), Component = h.load(VIEW).ProjectsAnalysisView
  // Two Android members and one Web member, so the placeholder capacity is 2 × 20 and 1 × 20 points.
  h.groupStates["ent-android"] = { status: "success", members: [{ accountId: "a1" }, { accountId: "a2" }] }
  h.groupStates["ent-web"] = { status: "success", members: [{ accountId: "w1" }] }
  const result = resultFixture(h.load(MODEL), options.tasks ?? tasks(), options.request ?? request, options.attribution ?? attribution)
  const render = () => h.invoke(Component, { result })
  const chart = (tree) => nodes(tree).find((n) => n.type?.name === "ProjectsTrendChart" && n.props.id === "output")
  const draw = (tree = render()) => h.invoke(chart(tree).type, chart(tree).props)
  const sprintTarget = (tree, index) => nodes(draw(tree)).find((n) => n.props["data-sprint-index"] === index)
  return { h, result, render, chart, draw, sprintTarget }
}

describe("Sprint detail under the 總產出 trend", () => {
  it("opens on the newest Sprint with its bars labelled, and switches on a click", () => {
    const { render, draw, sprintTarget } = setup()
    // A finished query shows the newest Sprint (6824, index 1) without any click.
    assert.equal(detailOf(render()).props.sprint.id, 6824)
    assert.equal(nodes(draw()).filter((n) => n.props["data-selection-index"] === 1).length, 1, "the newest Sprint starts selected")
    // Sprint 59 only has Story Points filled, so only that bar gets a value label.
    assert.deepEqual(nodes(draw()).filter((n) => n.props["data-bar-value"] !== undefined).map((n) => n.props["data-bar-value"]), ["points"])
    sprintTarget(render(), 0).props.onClick()
    const labels = nodes(draw()).filter((n) => n.props["data-bar-value"] !== undefined)
    assert.deepEqual(labels.map((n) => [n.props["data-bar-value"], n.props.children]), [["points", "8"], ["actual", "12"]], "Story Points and Actual SP of the clicked Sprint")
    const panel = detailOf(render())
    assert.ok(panel, "the Sprint panel opens below the chart")
    assert.equal(panel.props.sprint.id, 6823)
    assert.match(String(panel.props.sprint.startDate), /^2026-/)
  })

  it("clears the panel when the same Sprint is clicked twice", () => {
    const { render, sprintTarget } = setup()
    const click = (index) => { sprintTarget(render(), index).props.onClick() }
    // The page's pre-selection is not a click: the first click confirms it, the second clears it.
    assert.equal(detailOf(render()).props.sprint.id, 6824)
    click(1)
    assert.equal(detailOf(render()).props.sprint.id, 6824)
    click(1)
    assert.equal(detailOf(render()), undefined, "the second click clears")
    click(0)
    assert.ok(detailOf(render()))
    click(0)
    assert.equal(detailOf(render()), undefined)
  })

  it("splits completed Story Points per team and divides them by the placeholder capacity", () => {
    const { render, sprintTarget, h } = setup()
    // Sprint 58 (the older one) carries both teams' completed points.
    sprintTarget(render(), 0).props.onClick()
    // The panel is a plain function: calling it yields its markup tree with the pie slices and capacity rows.
    const html = renderToStaticMarkup(detailOf(render()).type(detailOf(render()).props))
    const pieTeams = [...html.matchAll(/data-pie-team="([^"]+)"/g)].map((match) => match[1])
    assert.deepEqual(pieTeams, ["ent-android", "ent-web"], "one slice per team with completed points")
    // Each team is one horizontal bar; its row carries the exact numbers beside the bar.
    const rateOf = (team) => html.match(new RegExp(`data-capacity-team="${team}"[\\s\\S]*?data-capacity-rate="([^"]*)"`))?.[1]
    const barOf = (team) => html.match(new RegExp(`data-capacity-team="${team}"[\\s\\S]*?<div[^>]*role="img" aria-label="([^"]*)"`))?.[1]
    // Saku gives 20 points per member: Android 2 members = 40, Web 1 member = 20.
    assert.equal(rateOf("ent-android"), "15", "Android 6 of 2 × 20 points")
    assert.equal(barOf("ent-android"), "Android：完成 6 SP／Capacity 40，兌現率 15%")
    assert.equal(rateOf("ent-web"), "10", "Web 2 of 1 × 20 points")
  })

  it("scopes the chart colour tokens onto the panel so pie slices actually paint", () => {
    const { render, sprintTarget } = setup()
    sprintTarget(render(), 0).props.onClick()
    const detail = detailOf(render())
    // --viz-* only exist under `.projects-viz`; the panel sits outside the chart, so it must carry the class too.
    const html0 = renderToStaticMarkup(detail.type(detail.props))
    assert.match(html0.match(/<section[^>]*>/)?.[0] ?? "", /projects-viz/)
    const html = renderToStaticMarkup(detail.type(detail.props))
    // Each slice is a circle (inside a Jira link) painted with a token defined by the chart stylesheet.
    const slices = [...html.matchAll(/<circle[^>]*(?:stroke="(var\(--viz-[a-z0-9-]+\))")[^>]*stroke-width="22"/g)].map((match) => match[1])
    assert.deepEqual(slices.slice(1), ["var(--viz-type-0)", "var(--viz-type-5)"], "one valid colour token per slice (the first is the track)")
    for (const token of html.matchAll(/var\((--viz-[a-z0-9-]+)\)/g)) assert.match(token[1], /^--viz-(type-[0-6]|grid|sp|actual|points|focus)$/, token[1])
  })
  it("compares the selected team's members when exactly one team is visible, hiding members without points", () => {
    // A single-team scope makes the roster of that team the object of both panels.
    const request = { project: "SUN", sprintIds: [6824, 6823], groups: ["ent-android"], browserTimeZone: "UTC" }
    const teamTasks = [
      task(1, { assigneeAccountId: "account-android", assigneeDisplayName: "Alice", points: 5 }),
      task(2, { assigneeAccountId: "account-web", assigneeDisplayName: "Bob", points: 3 }),
      task(3, { assigneeAccountId: "account-web", assigneeDisplayName: "Carol", points: 0 }),
    ]
    const { h, render, sprintTarget } = setup({
      request,
      tasks: teamTasks,
      attribution: { status: "available", byAssignee: [{ accountId: "account-android", teamId: "ent-android" }, { accountId: "account-web", teamId: "ent-android" }] },
    })
    h.groupStates["ent-android"] = { status: "success", members: [{ accountId: "account-android", displayName: "Alice Chen" }, { accountId: "account-web", displayName: "Bob Lin" }] }
    sprintTarget(render(), 0).props.onClick()
    const detail = detailOf(render())
    const html = renderToStaticMarkup(detail.type(detail.props))
    assert.deepEqual(plain(detail.props.teams.map((team) => [team.kind, team.label, team.points, team.capacity])), [
      ["member", "Alice Chen", 5, 20],
      ["member", "Bob Lin", 3, 20],
    ], "names come from the roster; Carol has no points and is omitted")
    assert.match(html, /成員完成點數佔比/)
    assert.match(html, /完成 SP／成員 Capacity/)
    assert.match(html, /data-capacity-rate="25"/, "Alice 5 of 20")
    assert.match(html, /data-capacity-rate="15"/, "Bob 3 of 20")
  })
  it("opens each row's exact issues in Jira from the pie slice, its SP label and the capacity bar", () => {
    const { render, sprintTarget } = setup()
    sprintTarget(render(), 0).props.onClick()
    const detail = detailOf(render())
    const html = renderToStaticMarkup(detail.type(detail.props))
    const links = [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>/g)].map((match) => match[1].replaceAll("&amp;", "&"))
    assert.ok(links.length >= 4, "each of the two rows links from the pie legend, the rate and the bar")
    const jql = links.map((href) => decodeURIComponent(new URL(href).searchParams.get("jql")))
    // Sprint 58 completed Android task 1 and Web task 2 (see setup()); every link names exactly one of them.
    assert.deepEqual([...new Set(jql)].sort(), ["id in (1) ORDER BY key ASC", "id in (2) ORDER BY key ASC"])
    assert.equal(links.length, 6, "SP label, rate and bar for each of the two rows; slices now drill down instead")
    assert.ok(links.every((href) => new URL(href).host === "jira.example.test"))
  })
  it("charts the team's members and renames both views when only one team is in scope", () => {
    const request = { project: "SUN", sprintIds: [6824, 6823], groups: ["ent-android"], browserTimeZone: "UTC" }
    const { h, render } = setup({
      request,
      tasks: [
        task(1, { assigneeAccountId: "account-android", assigneeDisplayName: "Alice", points: 5 }),
        task(2, { assigneeAccountId: "account-web", assigneeDisplayName: "Bob", points: 3 }),
        task(3, { assigneeAccountId: "account-android", assigneeDisplayName: "Alice", points: 2, sprintIds: [6824], resolvedDate: "2026-05-12" }),
      ],
      attribution: { status: "available", byAssignee: [{ accountId: "account-android", teamId: "ent-android" }, { accountId: "account-web", teamId: "ent-android" }] },
    })
    h.groupStates["ent-android"] = { status: "success", members: [{ accountId: "account-android", displayName: "Alice Chen" }, { accountId: "account-web", displayName: "Bob Lin" }] }
    const outputChart = (tree) => nodes(tree).find((n) => n.type?.name === "ProjectsTrendChart" && n.props.id === "output")
    const tree = render()
    const mode = (t) => nodes(nodes(nodes(t).find((n) => n.props["data-topic"] === "output")).find((n) => n.type?.name === "Panel").props.controls).find((n) => Array.isArray(n.props?.choices) && n.props.choices.includes("all-teams"))
    assert.deepEqual(plain(mode(tree).props.labels), { "all-teams": "全成員總覽", "by-team": "各成員產出" })
    assert.deepEqual(plain(outputChart(tree).props.series.map((s) => [s.label, s.values.map((v) => v.points)])), [["Alice Chen", [5, 2]], ["Bob Lin", [3, 0]]], "one bar series per member")
    // Hiding a member from the legend removes it from the bars, exactly like hiding a team.
    const drawn = h.invoke(outputChart(tree).type, outputChart(tree).props)
    nodes(drawn).find((n) => n.type === "button" && n.props["aria-label"] === "顯示 Alice Chen 產出").props.onClick()
    assert.deepEqual(plain(outputChart(render()).props.legendToggle.visibleIds), ["member:account-web"])
  })
  it("swells a pie slice on hover and grows that team's member bars on click", () => {
    const { render, h, sprintTarget } = setup()
    // Sprint 58 (index 0) carries both teams' completed points.
    sprintTarget(render(), 0).props.onClick()
    const detail = detailOf(render())
    const pie = nodes(detail.type(detail.props)).find((node) => node.type?.name === "TeamPie")
    const drawPie = () => h.invoke(pie.type, pie.props)
    const slice = (tree, id) => nodes(tree).find((node) => node.props["data-pie-team"] === id)
    const strokeOf = (tree, id) => nodes(slice(tree, id)).filter((node) => node.type === "circle").map((circle) => circle.props.strokeWidth)
    assert.deepEqual(strokeOf(drawPie(), "ent-android"), [22, 30], "idle slice")
    slice(drawPie(), "ent-android").props.onPointerEnter()
    assert.equal(strokeOf(drawPie(), "ent-android")[0], 26, "hover swells the slice")
    slice(drawPie(), "ent-android").props.onPointerLeave()
    const idle = drawPie()
    assert.equal(nodes(idle).find((node) => node.props["data-pie-members"] !== undefined), undefined, "nothing grows before a click")
    slice(idle, "ent-android").props.onClick()
    const open = drawPie()
    const members = nodes(open).find((node) => node.props["data-pie-members"] !== undefined)
    assert.equal(members.props["data-pie-members"], "ent-android")
    // Members are keyed by Jira account; only Android contributed completed points in Sprint 58.
    assert.deepEqual(nodes(open).filter((node) => node.props["data-pie-member"] !== undefined).map((node) => node.props["data-pie-member"]), ["account-android"], "one row per member with points")
    assert.equal(slice(open, "ent-android").props["aria-pressed"], true, "the open slice stays expanded")
    // Clicking the same slice closes it again.
    slice(open, "ent-android").props.onClick()
    assert.equal(nodes(drawPie()).find((node) => node.props["data-pie-members"] !== undefined), undefined)
  })
  it("uses 40 points per member for Telasa", () => {
    // Telasa S1xx sprints: use its own ids and a task resolved inside the first one.
    const telasa = { project: "TKK", sprintIds: [6619, 6620], groups: [], browserTimeZone: "UTC" }
    // Fixture tasks default to SUN's project fields; give them Telasa's project so the result validates.
    const telasaTask = [task(1, { assigneeAccountId: "account-android", points: 6, sprintIds: [6619], resolvedDate: "2026-05-25", projectId: "300", projectKey: "TKK" })]
    const { render, sprintTarget } = setup({ request: telasa, tasks: telasaTask, attribution: { status: "available", byAssignee: [{ accountId: "account-android", teamId: "ent-android" }] } })
    sprintTarget(render(), 0).props.onClick()
    const html = renderToStaticMarkup(detailOf(render()).type(detailOf(render()).props))
    const body = plain(html.replace(/<[^>]*>/g, " "))
    assert.match(body, /7\.5%/, "Telasa gives 40 points per member: 6 of 80")
    assert.match(body, /完成 6 SP／Capacity 80（2 人）/)
  })
})

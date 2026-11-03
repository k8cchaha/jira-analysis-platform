import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import { describe, it } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const compiled = new Map()
const root = "app/(app)/analytics/workload/summary/"
const plain = (value) => JSON.parse(JSON.stringify(value))

/** Actual page/client/route wiring with mocked hooks, auth and Jira I/O; not a browser test. */
function harness(snapshot = { "ent-web": { status: "success", members: [{ accountId: "fixture-member", displayName: "Fixture" }] } }, now = "2026-11-03T12:00:00.000Z") {
  let slots = []
  let cursor = 0
  const modules = new Map()
  const effects = []
  const sources = []
  const calls = []
  const todayCaps = []
  class FrozenDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return new Date(now).valueOf() }
  }
  const base = {
    today: "2026-11-03", empty: false, days: ["2026-11-02", "2026-11-03"],
    tasks: [{ key: "TEST-1", points: 2, actualPoints: 5, doneDate: "2026-11-02", assigneeAccountId: "fixture-member", assigneeDisplayName: "Fixture", summary: "Fixture task", parentIssueType: { status: "known", name: "Story" }, status: "Done", resolution: "Fixed", resolvedDate: "2026-11-02" }],
    unestimated: [], actualUnestimated: [],
  }
  class FakeEventSource {
    constructor(url) {
      this.url = url
      this.closed = false
      this.listeners = new Map()
      sources.push(this)
    }
    addEventListener(name, listener) { this.listeners.set(name, listener) }
    close() { this.closed = true }
  }
  class JiraAuthorizationError extends Error {}
  class JiraDashboardError extends Error {}
  class JiraWorkloadError extends Error {}
  const hooks = {
    useState(initial) {
      const index = cursor++
      const owned = slots
      if (!(index in owned)) owned[index] = typeof initial === "function" ? initial() : initial
      return [owned[index], (next) => { owned[index] = typeof next === "function" ? next(owned[index]) : next }]
    },
    useEffect(effect, deps) {
      const index = cursor++
      const previous = slots[index]
      if (!previous || deps.some((value, i) => value !== previous[i])) effects.push(effect)
      slots[index] = deps
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useId() {
      const index = cursor++
      if (!(index in slots)) slots[index] = `fixture-details-${index}`
      return slots[index]
    },
    useMemo: (compute) => compute(),
  }
  const sandbox = vm.createContext({
    URL, URLSearchParams, Request, Response, ReadableStream, TextEncoder, Date: FrozenDate, Error,
    EventSource: FakeEventSource,
    fetch: () => { throw new Error("No live HTTP request is allowed") },
  })
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    const mod = { exports: {} }
    modules.set(path, mod)
    if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText)
    function fixtureRequire(name) {
      if (name === "react") return { ...require(name), ...hooks }
      if (name === "react/jsx-runtime") return require(name)
      if (name === "@/auth") return { auth: async () => ({ user: { id: "fixture-user" } }) }
      if (name === "@/lib/jira-token") return { JiraAuthorizationError }
      if (name === "@/lib/jira-dashboard") return { JiraDashboardError, dashboardJiraBaseUrl: () => "https://fixture.invalid" }
      if (name === "@/lib/jira-workload") return {
        JiraWorkloadError,
        workloadScope: async (filter) => {
          calls.push({ kind: "scope", filter: plain(filter) })
          return { scope: { mode: "team-project", accountIds: ["fixture-member"], projects: [], days: 30 }, credentials: {} }
        },
        getWorkloadHeatmapBase: async (_scope, range, today) => {
          todayCaps.push(today)
          calls.push({ kind: "base", range: plain(range) })
          return base
        },
      }
      if (name === "@/components/team-members-provider") return {
        useTeamMembers: () => ({ groupStates: snapshot }),
      }
      if (name === "@/components/page-header") return { PageHeader: () => null }
      if (name === "@/components/team-select") return { TeamSelect: () => null }
      if (name === "./workload-filter") return { WorkloadFilterForm: () => null }
      if (name === "./workload-heatmap-grid") return { WorkloadHeatmapGrid: () => null }
      if (name === "./workload-issue-details") return { WorkloadIssueDetails: () => null }
      if (name === "./workload-heatmap-client") return load(`${root}workload-heatmap-client.tsx`)
      if (name === "./date-range.ts") return load("lib/date-range.ts")
      if (["@/lib/workload-filter", "@/lib/jira-dashboard-filter", "@/lib/workload-heatmap", "@/lib/date-range", "@/lib/burndown-stream"].includes(name)) return load(`${name.slice(2)}.ts`)
      throw new Error(`Unexpected stream dependency: ${name}`)
    }
    vm.runInContext(`(function(require,module,exports){${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, mod, mod.exports)
    return mod.exports
  }
  async function mount(searchParams) {
    const page = await load(`${root}page.tsx`).default({ searchParams: Promise.resolve(searchParams) })
    const client = page.props.children.find((child) => child?.props?.endpoint)
    assert.ok(client, "The page must accept the filter and render a heatmap client")
    let clientProps = client.props
    const clientSlots = []
    let streamSlots = []
    let previousStreamKey
    let stream
    function wrapper() {
      slots = clientSlots
      cursor = 0
      const tree = client.type(clientProps)
      stream = tree.props.children.props.children
      if (previousStreamKey !== stream.key) {
        streamSlots = []
        previousStreamKey = stream.key
      }
      return tree
    }
    function render() {
      wrapper()
      slots = streamSlots
      cursor = 0
      return stream.type(stream.props)
    }
    render()
    assert.equal(effects.length, 1)
    const cleanup = effects.pop()()
    return { endpoint: client.props.endpoint, source: sources.at(-1), cleanup, render, wrapper, metricSwitch: () => { wrapper(); return stream.props.metricSwitch }, streamKey: () => stream.key, retry: () => stream.props.onRetry(), setFilter: (next) => { clientProps = { ...clientProps, ...next } } }
  }
  const GET = load("app/api/analytics/workload/heatmap/stream/route.ts").GET
  return {
    load, mount, sources, calls, base, effects, todayCaps,
    request: (url, accept = "text/event-stream") => GET(new Request(`https://fixture.invalid${url}`, { headers: { accept } })),
  }
}

const sseEvents = (body) => body.trim().split("\n\n").map((frame) => {
  const [event, data] = frame.split("\n")
  return { event: event.slice("event: ".length), data: JSON.parse(data.slice("data: ".length)) }
})

describe("workload page → EventSource → stream route (offline)", () => {
  for (const [now, today] of [
    ["2026-11-03T15:59:59.000Z", "2026-11-03"],
    ["2026-11-03T16:00:00.000Z", "2026-11-04"],
    ["2026-11-03T17:00:00.000Z", "2026-11-04"],
  ]) {
    it(`caps dates in the completion calendar timezone at ${now}`, async () => {
      const h = harness(undefined, now)
      const response = await h.request("/api/analytics/workload/heatmap/stream?group=ent-web&from=2026-10-04&to=2026-11-04")
      assert.equal(response.status, 200)
      assert.equal(sseEvents(await response.text()).at(-1).event, "done")
      assert.deepEqual(h.todayCaps, [today])
      assert.deepEqual(h.calls.at(-1).range, { from: "2026-10-04", to: "2026-11-04" }, "The cap must not alter the submitted query range")
    })
  }

  it("sends the exact canonical endpoint for Web + 近1月 and receives base → done", async (t) => {
    const h = harness()
    const range = h.load("lib/date-range.ts").dateRangeForPreset("last1Month", "2026-11-03")
    const mounted = await h.mount({ group: "ent-web", ...range })
    t.after(mounted.cleanup)
    assert.equal(mounted.endpoint, "/api/analytics/workload/heatmap/stream?group=ent-web&from=2026-10-04&to=2026-11-03")
    assert.equal(mounted.source.url, mounted.endpoint, "EventSource must not append transport-only query parameters")
    const response = await h.request(mounted.source.url)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store, no-transform")
    assert.deepEqual(sseEvents(await response.text()), [{ event: "base", data: h.base }, { event: "done", data: {} }])
    assert.deepEqual(h.calls, [
      { kind: "scope", filter: { mode: "team-project", groups: ["ent-web"], exclusions: {}, projects: [], days: 30 } },
      { kind: "base", range: { from: "2026-10-04", to: "2026-11-03" } },
    ])
    mounted.cleanup()
    assert.equal(mounted.source.closed, true, "Unmount must close the subscription")
    const reopened = await h.mount({ group: "ent-web", ...range })
    t.after(reopened.cleanup)
    assert.notEqual(reopened.source, mounted.source, "Remount opens a new connection without a cache-buster")
    assert.equal(reopened.source.url, mounted.endpoint)
    reopened.source.onerror()
    assert.equal(reopened.source.closed, true, "A failed connection must not automatically reconnect")
  })

  it("retains applied member exclusions, inactive rows and team ordering without an in-result selector", async (t) => {
    const member = (accountId) => ({ accountId, displayName: accountId })
    const h = harness({
      "ent-web": { status: "success", members: [member("fixture-member"), member("inactive"), member("excluded"), member("shared")] },
      "ent-be1": { status: "success", members: [member("backend-inactive"), member("shared")] },
    })
    const mounted = await h.mount({
      group: ["ent-web", "ent-be1"], exclude: ["ent-web|excluded", "ent-web|shared"],
      from: "2026-10-04", to: "2026-11-03",
    })
    t.after(mounted.cleanup)
    mounted.source.listeners.get("base")({ data: JSON.stringify(h.base) })
    mounted.source.listeners.get("done")({ data: "{}" })
    const rendered = mounted.render()
    const rows = plain(rendered.props.children[0].props.children.props.heatmap.rows)
    // 跨團隊排除先處理再 union；shared 仍由 BE1 納入，顯示分組沿用固定順序的後者優先。
    assert.deepEqual(rows.map((row) => row.accountId), ["backend-inactive", "fixture-member", "inactive", "shared"])
    assert.deepEqual(rows.map((row) => row.teamLabel), ["BE1", "Web", "Web", "Web"])
    assert.equal(rows.find((row) => row.accountId === "fixture-member").totalPoints, 2)
    assert.ok(rows.find((row) => row.accountId === "inactive").cells.every((points) => points === null))
    assert.equal(rows.some((row) => row.accountId === "excluded"), false)
    assert.equal(h.sources.length, 1, "Receiving data and recomputing rows must not reopen the stream")
  })

  it("switches both metrics locally without a heading/date, reconnect or second query", async (t) => {
    const h = harness()
    const mounted = await h.mount({ group: "ent-web", from: "2026-10-04", to: "2026-11-03" })
    t.after(mounted.cleanup)
    const task = (key, points, actualPoints) => ({ ...h.base.tasks[0], key, points, actualPoints })
    const payload = { ...h.base, tasks: [task("A", 2, null), task("B", null, 5), task("C", 0, 0), task("D", null, null)],
      unestimated: [{ key: "B" }, { key: "D" }], actualUnestimated: [{ key: "A" }, { key: "D" }] }
    const response = await h.request(mounted.source.url)
    await response.text()
    mounted.source.listeners.get("base")({ data: JSON.stringify(payload) })
    mounted.source.listeners.get("done")({ data: "{}" })
    const find = (node, predicate) => {
      if (!node || typeof node !== "object") return null
      if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean)
      return predicate(node) ? node : find(node.props?.children, predicate)
    }
    const visibleText = (node) => typeof node === "string" || typeof node === "number" ? String(node) :
      Array.isArray(node) ? node.map(visibleText).join("") : visibleText(node?.props?.children ?? "")
    const getSwitch = () => find(mounted.metricSwitch(), (node) => node.props?.role === "switch")
    assert.equal(getSwitch().props["aria-checked"], false)
    assert.equal(getSwitch().props["aria-label"], "使用 Actual Story Points")
    assert.doesNotMatch(visibleText(mounted.wrapper()), /每週完成點數|2026-10-04|2026-11-03|→/)
    const initialKey = mounted.streamKey()
    const first = mounted.render().props.children[0].props.children
    assert.equal(first.props.metric, "points")
    assert.equal(first.props.metricSwitch.props["aria-label"], "點數指標", "The existing switch is passed into the grid summary row")
    assert.equal(first.props.metricSwitch.props.children[1].props["aria-checked"], false)
    assert.deepEqual(plain(first.props.heatmap.rows[0].cells), [2])
    assert.deepEqual(plain(first.props.heatmap.unestimated), payload.unestimated)
    getSwitch().props.onClick()
    const actual = mounted.render().props.children[0].props.children
    assert.equal(getSwitch().props["aria-checked"], true)
    assert.equal(actual.props.metric, "actualPoints")
    assert.notEqual(actual.key, first.key, "Reset only the grid tooltip, not the stream")
    assert.deepEqual(plain(actual.props.heatmap.rows[0].cells), [5])
    assert.deepEqual(plain(actual.props.heatmap.unestimated), payload.actualUnestimated)
    getSwitch().props.onClick()
    const back = mounted.render().props.children[0].props.children
    assert.deepEqual(plain(back.props.heatmap), plain(first.props.heatmap))
    assert.equal(mounted.streamKey(), initialKey)
    assert.equal(h.sources.length, 1)
    assert.equal(h.effects.length, 0, "Metric changes must not schedule another subscription effect")
    assert.equal(h.calls.length, 2, "One scope call and one data call only")
    assert.equal(mounted.source.url, mounted.endpoint)
  })

  it("projects the requested five weeks and selects the partial final week without another query", async (t) => {
    const h = harness()
    const mounted = await h.mount({ group: "ent-web", from: "2026-10-04", to: "2026-11-03" })
    t.after(mounted.cleanup)
    const payload = { ...h.base,
      days: Array.from({ length: 31 }, (_, index) => new Date(Date.UTC(2026, 9, 4 + index)).toISOString().slice(0, 10)),
      tasks: [...h.base.tasks, { ...h.base.tasks[0], key: "hidden", doneDate: "2026-10-04", points: 999, actualPoints: 999 }],
    }
    await (await h.request(mounted.source.url)).text()
    mounted.source.listeners.get("base")({ data: JSON.stringify(payload) })
    mounted.source.listeners.get("done")({ data: "{}" })
    const grid = () => mounted.render().props.children[0].props.children
    assert.deepEqual(plain(grid().props.heatmap.weeks.map((week) => week.start)), ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"])
    assert.deepEqual(plain(grid().props.heatmap.rows[0].cells), [null, null, null, null, 2])
    assert.equal(grid().props.heatmap.rows[0].totalPoints, 2)
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-11-02" })
    const detail = () => mounted.render().props.children[1]
    assert.deepEqual(plain(detail().props.tasks.map((task) => task.key)), ["TEST-1"])
    assert.equal(detail().props.points, 2)
    mounted.metricSwitch().props.children[1].props.onClick()
    assert.equal(detail().props.points, 5)
    assert.equal(grid().props.heatmap.rows[0].totalPoints, 5)
    assert.equal(h.sources.length, 1)
    assert.equal(h.effects.length, 0)
    assert.equal(h.calls.length, 2)
  })

  it("selects/replaces/closes inline details and keeps metric changes local", async (t) => {
    const h = harness()
    const mounted = await h.mount({ group: "ent-web", from: "2026-10-04", to: "2026-11-03" })
    t.after(mounted.cleanup)
    const task = (key, points, actualPoints, doneDate) => ({ ...h.base.tasks[0], key, points, actualPoints, doneDate,
      summary: key, parentIssueType: { status: "known", name: "Story" }, status: "Done", resolution: "Fixed", resolvedDate: doneDate })
    const payload = { ...h.base, days: ["2026-10-05", "2026-11-02", "2026-11-03"], tasks: [
      task("A", 2, null, "2026-11-02"), task("B", null, 5, "2026-11-02"),
      task("C", 0, null, "2026-10-05"),
    ] }
    await (await h.request(mounted.source.url)).text()
    mounted.source.listeners.get("base")({ data: JSON.stringify(payload) })
    mounted.source.listeners.get("done")({ data: "{}" })
    const grid = () => mounted.render().props.children[0].props.children
    const detail = () => mounted.render().props.children[1]
    const toggle = () => mounted.metricSwitch().props.children[1].props.onClick()
    assert.equal(detail(), null)
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-11-02" })
    assert.deepEqual(plain(detail().props.tasks.map((value) => value.key)), ["A"])
    assert.equal(detail().props.points, 2)
    assert.equal(detail().props.jiraBaseUrl, "https://fixture.invalid")
    assert.equal(grid().props.detailsId, detail().props.id)
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-11-02" })
    assert.equal(detail(), null, "Clicking the selected cell again closes its details")
    assert.equal(grid().props.selection, null, "Repeated click clears the selection frame")
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-11-02" })
    assert.deepEqual(plain(detail().props.tasks.map((value) => value.key)), ["A"])
    toggle()
    assert.deepEqual(plain(detail().props.tasks.map((value) => value.key)), ["B"])
    assert.equal(detail().props.metric, "actualPoints")
    assert.equal(detail().props.points, 5)
    let focused = false
    const gridContainer = mounted.render().props.children[0]
    gridContainer.props.ref.current = { querySelectorAll: () => [{ dataset: { workloadAccount: "fixture-member", workloadWeek: "2026-11-02" }, focus: () => { focused = true } }] }
    detail().props.onClose()
    assert.equal(focused, true, "Closing restores focus to the currently mounted selected button")
    assert.equal(detail(), null)
    toggle()
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-10-05" })
    assert.equal(detail().props.points, 0)
    assert.deepEqual(plain(detail().props.tasks.map((value) => value.key)), ["C"])
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-10-05" })
    assert.equal(detail(), null, "Zero-valued cells also toggle off on repeated click")
    assert.equal(grid().props.selection, null)
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-11-02" })
    assert.deepEqual(plain(detail().props.tasks.map((value) => value.key)), ["A"])
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-10-05" })
    toggle()
    assert.equal(detail(), null, "Actual missing must clear an SP-only selection")
    toggle()
    assert.equal(detail(), null, "Returning to SP must not revive cleared details")
    assert.equal(grid().props.selection, null)
    assert.equal(h.sources.length, 1)
    assert.equal(h.effects.length, 0)
    assert.equal(h.calls.length, 2)
    assert.equal(mounted.source.url, mounted.endpoint)
  })

  it("resets selection on retry or a newly applied endpoint while retaining the metric", async (t) => {
    const h = harness()
    const mounted = await h.mount({ group: "ent-web", from: "2026-10-04", to: "2026-11-03" })
    t.after(mounted.cleanup)
    const receive = () => {
      h.sources.at(-1).listeners.get("base")({ data: JSON.stringify(h.base) })
      h.sources.at(-1).listeners.get("done")({ data: "{}" })
    }
    receive()
    mounted.metricSwitch().props.children[1].props.onClick()
    let tree = mounted.render()
    tree.props.children[0].props.children.props.onSelect({ accountId: "fixture-member", weekStart: "2026-11-02" })
    assert.ok(mounted.render().props.children[1])
    for (const reset of [() => mounted.retry(), () => mounted.setFilter({ endpoint: `${mounted.endpoint}&project=sun` })]) {
      const oldKey = mounted.streamKey()
      reset()
      mounted.render()
      assert.notEqual(mounted.streamKey(), oldKey)
      const cleanup = h.effects.pop()()
      t.after(cleanup)
      receive()
      tree = mounted.render()
      assert.equal(tree.props.children[0].props.children.props.metric, "actualPoints")
      assert.equal(tree.props.children[0].props.children.props.selection, null)
      assert.equal(tree.props.children[1], null)
      tree.props.children[0].props.children.props.onSelect({ accountId: "fixture-member", weekStart: "2026-11-02" })
      assert.ok(mounted.render().props.children[1])
    }
  })

  for (const extra of ["t=1793695671352", "unknown=1", "jql=project%3Dsun"]) {
    it(`still rejects unsupported parameters (${extra}) before scope resolution or Jira I/O`, async () => {
      const h = harness()
      const url = `/api/analytics/workload/heatmap/stream?group=ent-web&from=2026-10-04&to=2026-11-03&${extra}`
      const response = await h.request(url)
      assert.equal(response.status, 200)
      assert.deepEqual(sseEvents(await response.text()), [{ event: "error", data: { code: "configuration", message: "篩選條件無效，請重新選擇後查詢。" } }])
      const jsonResponse = await h.request(url, "application/json")
      assert.equal(jsonResponse.status, 400)
      assert.equal((await jsonResponse.json()).error.code, "configuration")
      assert.deepEqual(h.calls, [])
    })
  }
})

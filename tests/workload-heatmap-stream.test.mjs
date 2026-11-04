import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import { describe, it } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const compiled = new Map()
const root = "app/(app)/analytics/workload/"
const plain = (value) => JSON.parse(JSON.stringify(value))

/** Actual page/client/route wiring with mocked hooks, auth and Jira I/O; not a browser test. */
function harness(snapshot = { "ent-web": { status: "success", members: [{ accountId: "fixture-member", displayName: "Fixture" }] } }, now = "2026-11-03T12:00:00.000Z") {
  let slots = []
  let cursor = 0
  const dirty = new Set()
  const pushes = []
  const popstateListeners = new Set()
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
      return [owned[index], (next) => { owned[index] = typeof next === "function" ? next(owned[index]) : next; dirty.add(owned) }]
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
    window: {
      addEventListener: (name, callback) => { assert.equal(name, "popstate"); popstateListeners.add(callback) },
      removeEventListener: (name, callback) => { assert.equal(name, "popstate"); popstateListeners.delete(callback) },
    },
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
      if (name === "next/navigation") return { useRouter: () => ({ push: (href) => pushes.push(href) }) }
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
      if (name === "./workload-query-client") return load(`${root}workload-query-client.tsx`)
      if (name === "./workload-heatmap-client") return load(`${root}workload-heatmap-client.tsx`)
      if (name === "./date-range.ts") return load("lib/date-range.ts")
      if (["@/lib/workload-filter", "@/lib/jira-dashboard-filter", "@/lib/workload-heatmap", "@/lib/date-range", "@/lib/burndown-stream"].includes(name)) return load(`${name.slice(2)}.ts`)
      throw new Error(`Unexpected stream dependency: ${name}`)
    }
    vm.runInContext(`(function(require,module,exports){${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, mod, mod.exports)
    return mod.exports
  }
  async function mount(searchParams, { submit = true } = {}) {
    const callsBeforeMount = calls.length
    const sourcesBeforeMount = sources.length
    const Page = load(`${root}page.tsx`).default
    const page = await Page({ searchParams: Promise.resolve(searchParams) })
    const coordinator = page.props.children.find((child) => child?.type?.name === "WorkloadQueryClient")
    assert.ok(coordinator, "The page must always render its local query coordinator")
    let coordinatorProps = coordinator.props
    const coordinatorSlots = []
    const clientSlots = []
    const coordinatorCleanups = []
    let streamSlots = []
    let previousStreamKey
    let streamCleanup
    let currentSource
    let stream
    let form
    let client
    function draw(component, props, owned) {
      let tree
      let attempts = 0
      do {
        dirty.delete(owned)
        slots = owned
        cursor = 0
        tree = component(props)
        assert.ok(++attempts < 10, "Render-state synchronization must settle")
      } while (dirty.has(owned))
      return tree
    }
    function wrapper() {
      const content = draw(coordinator.type, coordinatorProps, coordinatorSlots)
      while (effects.length) coordinatorCleanups.push(effects.shift()())
      form = content.props.children[0]
      client = content.props.children[1]
      const tree = client ? draw(client.type, client.props, clientSlots) : null
      const candidate = tree?.props.children.props.children
      const nextStream = candidate?.type?.name === "HeatmapStream" ? candidate : null
      if (previousStreamKey !== nextStream?.key) {
        streamCleanup?.()
        streamCleanup = undefined
        streamSlots = []
        previousStreamKey = nextStream?.key
      }
      stream = nextStream
      return tree
    }
    function render() {
      const tree = wrapper()
      if (!stream) return tree
      const result = draw(stream.type, stream.props, streamSlots)
      while (effects.length) {
        streamCleanup = effects.shift()()
        currentSource = sources.at(-1)
      }
      return result
    }
    const cleanup = () => {
      streamCleanup?.()
      streamCleanup = undefined
      coordinatorCleanups.splice(0).forEach((close) => close?.())
    }
    render()
    assert.equal(stream, null, "URL restoration is idle before an explicit submit")
    assert.equal(calls.length, callsBeforeMount, "Rendering the page cannot call workload scope/base")
    assert.equal(sources.length, sourcesBeforeMount, "URL restoration cannot open EventSource")
    const result = {
      get endpoint() { return client?.props.endpoint },
      get source() { return currentSource },
      get client() { return client },
      cleanup, render, wrapper,
      form: () => { wrapper(); return form },
      submit: (next = coordinatorProps.filter) => { wrapper(); form.props.onQuery(next); return render() },
      navigate: async (params, { popstate = false } = {}) => {
        if (popstate) popstateListeners.forEach((callback) => callback())
        const next = await Page({ searchParams: Promise.resolve(params) })
        coordinatorProps = next.props.children.find((child) => child?.type?.name === "WorkloadQueryClient").props
        return render()
      },
      popstate: () => { popstateListeners.forEach((callback) => callback()); return render() },
      metricSwitch: () => {
        const tree = wrapper()
        return stream?.props.metricSwitch ?? tree?.props.children.props.children[0].props.children
      },
      streamKey: () => stream?.key,
      retry: () => stream.props.onRetry(),
    }
    if (submit) result.submit()
    return result
  }
  const GET = load("app/api/analytics/workload/heatmap/stream/route.ts").GET
  return {
    load, mount, sources, calls, base, effects, todayCaps, pushes, popstateListeners,
    request: (url, accept = "text/event-stream") => GET(new Request(`https://fixture.invalid${url}`, { headers: { accept } })),
  }
}

const sseEvents = (body) => body.trim().split("\n\n").map((frame) => {
  const [event, data] = frame.split("\n")
  return { event: event.slice("event: ".length), data: JSON.parse(data.slice("data: ".length)) }
})

describe("manual workload query activation (offline)", () => {
  const a = { group: "ent-web", from: "2026-10-04", to: "2026-11-03" }
  const b = { ...a, project: "sun" }
  const c = { ...a, project: "tkk" }
  const parsed = (h, params) => h.load("lib/workload-filter.ts").parseWorkloadFilter(new URLSearchParams(params))

  for (const params of [a, {}, { group: "ent-web" }, { ...a, submitted: "1" }]) {
    it(`restores URL without querying on entry or reload: ${JSON.stringify(params)}`, async (t) => {
      const h = harness()
      const first = await h.mount(params, { submit: false })
      t.after(first.cleanup)
      assert.equal(h.sources.length, 0)
      assert.equal(h.calls.length, 0)
      if (params === a) {
        assert.deepEqual(plain(first.form().props.initialFilter), plain(parsed(h, a)))
        assert.equal(first.endpoint, null)
      } else assert.equal(first.form().props.initialFilter, null)
      first.cleanup()
      const refreshed = await h.mount(params, { submit: false })
      t.after(refreshed.cleanup)
      assert.equal(h.sources.length, 0)
      assert.equal(h.calls.length, 0)
    })
  }

  it("starts only after submit and refresh after a completed query remains idle", async (t) => {
    const h = harness()
    const mounted = await h.mount(a, { submit: false })
    mounted.submit()
    t.after(mounted.cleanup)
    assert.equal(h.sources.length, 1)
    assert.deepEqual(h.pushes, ["/analytics/workload?group=ent-web&from=2026-10-04&to=2026-11-03"])
    await (await h.request(mounted.source.url)).text()
    mounted.source.listeners.get("base")({ data: JSON.stringify(h.base) })
    mounted.source.listeners.get("done")({ data: "{}" })
    mounted.render()
    mounted.cleanup()
    const refreshed = await h.mount(a, { submit: false })
    t.after(refreshed.cleanup)
    assert.equal(h.sources.length, 1, "Reload cannot silently query the same URL again")
    assert.equal(h.calls.length, 2, "Only the earlier explicit request called scope and base")
    assert.equal(refreshed.endpoint, null)
  })

  it("waits for its changed-filter URL and never queries the old scope", async (t) => {
    const h = harness()
    const mounted = await h.mount(a)
    t.after(mounted.cleanup)
    const old = mounted.source
    mounted.submit(parsed(h, b))
    assert.equal(old.closed, true)
    assert.equal(mounted.endpoint, null)
    assert.equal(h.sources.length, 1)
    mounted.render()
    assert.equal(h.sources.length, 1, "Pending navigation cannot query old URL")
    await mounted.navigate(b)
    assert.equal(h.sources.length, 2)
    assert.equal(mounted.source.url, "/api/analytics/workload/heatmap/stream?group=ent-web&project=sun&from=2026-10-04&to=2026-11-03")
    assert.deepEqual(plain(mounted.client.props.filter.projects), ["sun"])
  })

  it("can submit from an empty URL without losing the pending activation", async (t) => {
    const h = harness()
    const mounted = await h.mount({}, { submit: false })
    t.after(mounted.cleanup)
    mounted.submit(parsed(h, a))
    assert.equal(h.sources.length, 0)
    await mounted.navigate(a)
    assert.equal(h.sources.length, 1)
  })

  it("unrequested URL changes cancel activation permanently, including A → B → A", async (t) => {
    const h = harness()
    const mounted = await h.mount(a)
    t.after(mounted.cleanup)
    const old = mounted.source
    await mounted.navigate(b)
    assert.equal(old.closed, true)
    await mounted.navigate(a)
    assert.equal(mounted.endpoint, null)
    assert.equal(h.sources.length, 1)
    mounted.submit()
    assert.equal(h.sources.length, 2)
  })

  it("popstate cancels active and pending queries even for identical URL history entries", async (t) => {
    const h = harness()
    const mounted = await h.mount(a)
    t.after(mounted.cleanup)
    const old = mounted.source
    mounted.popstate()
    assert.equal(old.closed, true)
    await mounted.navigate(a)
    assert.equal(h.sources.length, 1)
    mounted.submit(parsed(h, b))
    mounted.popstate()
    await mounted.navigate(b)
    assert.equal(mounted.endpoint, null)
    await mounted.navigate(a, { popstate: true })
    await mounted.navigate(b, { popstate: true })
    assert.equal(h.sources.length, 1)
    mounted.cleanup()
    assert.equal(h.popstateListeners.size, 0)
  })

  it("keeps the latest rapid submission if its matching URL commits directly", async (t) => {
    const h = harness()
    const mounted = await h.mount(a, { submit: false })
    t.after(mounted.cleanup)
    mounted.submit(parsed(h, b))
    mounted.submit(parsed(h, c))
    await mounted.navigate(c)
    assert.equal(h.sources.length, 1)
    assert.match(mounted.source.url, /project=tkk/)
    await mounted.navigate(c)
    assert.equal(h.sources.length, 1, "Same URL RSC updates must not issue another request")
  })

  it("an invalid URL cancels an active query without widening to a fallback", async (t) => {
    const h = harness()
    const mounted = await h.mount(a)
    t.after(mounted.cleanup)
    const old = mounted.source
    await mounted.navigate({ ...a, jql: "project=sun" })
    assert.equal(old.closed, true)
    assert.equal(mounted.form().props.initialFilter, null)
    await mounted.navigate(a)
    assert.equal(mounted.endpoint, null)
    assert.equal(h.sources.length, 1)
  })

  it("a stale or unrelated navigation cancels the latest rapid submission fail-closed", async (t) => {
    const h = harness()
    const mounted = await h.mount(a, { submit: false })
    t.after(mounted.cleanup)
    mounted.submit(parsed(h, b))
    mounted.submit(parsed(h, c))
    await mounted.navigate(b)
    await mounted.navigate(c)
    assert.equal(h.sources.length, 0, "Neither outdated B nor cancelled C may run automatically")
    mounted.submit()
    assert.equal(h.sources.length, 1)
    assert.match(mounted.source.url, /project=tkk/)
  })
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

  it("cycles Total sorting locally, preserves selection and metric sorting without another request or navigation", async (t) => {
    const h = harness()
    const mounted = await h.mount({ group: "ent-web", from: "2026-10-04", to: "2026-11-03" })
    t.after(mounted.cleanup)
    await (await h.request(mounted.source.url)).text()
    mounted.source.listeners.get("base")({ data: JSON.stringify(h.base) })
    mounted.source.listeners.get("done")({ data: "{}" })
    const grid = () => mounted.render().props.children[0].props.children
    const detail = () => mounted.render().props.children[1]
    const initialSource = mounted.source
    const initialKey = mounted.streamKey()
    const pushes = [...h.pushes]
    const original = plain(grid().props.heatmap)
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-11-02" })
    const selection = plain(grid().props.selection)
    const detailsId = detail().props.id
    assert.equal(grid().props.totalSort, "none")
    for (const expected of ["descending", "ascending", "none", "descending"]) {
      grid().props.onCycleTotalSort()
      assert.equal(grid().props.totalSort, expected)
      assert.deepEqual(plain(grid().props.selection), selection)
      assert.equal(detail().props.id, detailsId)
      assert.deepEqual(plain(detail().props.tasks), h.base.tasks)
      assert.deepEqual(plain(grid().props.heatmap), original, "Presentation order must not alter aggregated data")
    }
    mounted.metricSwitch().props.children[1].props.onClick()
    assert.equal(grid().props.totalSort, "descending", "Metric-keyed grid remount must not reset sorting")
    assert.equal(grid().props.metric, "actualPoints")
    assert.equal(grid().props.heatmap.rows[0].totalPoints, 5)
    assert.deepEqual(plain(grid().props.selection), selection)
    assert.deepEqual(plain(detail().props.tasks), h.base.tasks)
    grid().props.onCycleTotalSort()
    assert.equal(grid().props.totalSort, "ascending")
    mounted.metricSwitch().props.children[1].props.onClick()
    assert.equal(grid().props.totalSort, "ascending")
    assert.equal(grid().props.metric, "points")
    assert.equal(mounted.source, initialSource)
    assert.equal(mounted.streamKey(), initialKey)
    assert.equal(h.sources.length, 1)
    assert.equal(h.calls.length, 2)
    assert.equal(h.effects.length, 0)
    assert.deepEqual(h.pushes, pushes)
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
    assert.equal(detail().props.tasks.reduce((sum, task) => sum + (task.points ?? 0), 0), 2)
    mounted.metricSwitch().props.children[1].props.onClick()
    assert.equal(detail().props.tasks.reduce((sum, task) => sum + (task.actualPoints ?? 0), 0), 5)
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
    assert.equal(detail().props.tasks.reduce((sum, task) => sum + (task.points ?? 0), 0), 2)
    assert.equal(detail().props.jiraBaseUrl, "https://fixture.invalid")
    assert.equal(grid().props.detailsId, detail().props.id)
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-11-02" })
    assert.equal(detail(), null, "Clicking the selected cell again closes its details")
    assert.equal(grid().props.selection, null, "Repeated click clears the selection frame")
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-11-02" })
    assert.deepEqual(plain(detail().props.tasks.map((value) => value.key)), ["A"])
    toggle()
    assert.deepEqual(plain(detail().props.tasks.map((value) => value.key)), ["B"])
    assert.equal(grid().props.metric, "actualPoints")
    assert.equal("metric" in detail().props, false)
    assert.equal("points" in detail().props, false)
    assert.equal(detail().props.tasks.reduce((sum, task) => sum + (task.actualPoints ?? 0), 0), 5)
    let focused = false
    const gridContainer = mounted.render().props.children[0]
    gridContainer.props.ref.current = { querySelectorAll: () => [{ dataset: { workloadAccount: "fixture-member", workloadWeek: "2026-11-02" }, focus: () => { focused = true } }] }
    detail().props.onClose()
    assert.equal(focused, true, "Closing restores focus to the currently mounted selected button")
    assert.equal(detail(), null)
    toggle()
    grid().props.onSelect({ accountId: "fixture-member", weekStart: "2026-10-05" })
    assert.equal(detail().props.tasks.reduce((sum, task) => sum + (task.points ?? 0), 0), 0)
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

  it("resets selection and Total sorting on retry or new submissions while retaining the metric", async (t) => {
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
    for (const reset of [
      () => mounted.retry(),
      async () => {
        mounted.submit({ ...mounted.form().props.initialFilter, projects: ["sun"] })
        await mounted.navigate({ group: "ent-web", from: "2026-10-04", to: "2026-11-03", project: "sun" })
      },
      () => mounted.submit(),
    ]) {
      mounted.render().props.children[0].props.children.props.onCycleTotalSort()
      assert.equal(mounted.render().props.children[0].props.children.props.totalSort, "descending")
      const oldKey = mounted.streamKey()
      const oldSource = mounted.source
      await reset()
      mounted.render()
      assert.notEqual(mounted.streamKey(), oldKey)
      assert.equal(oldSource.closed, true, "Replacing the keyed stream immediately closes the old source")
      receive()
      tree = mounted.render()
      assert.equal(tree.props.children[0].props.children.props.metric, "actualPoints")
      assert.equal(tree.props.children[0].props.children.props.totalSort, "none")
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

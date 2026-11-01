import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const compiled = new Map()
const plain = (value) => JSON.parse(JSON.stringify(value))
const member = (accountId = "fixture-member") => ({ accountId, displayName: `Fixture ${accountId}` })
const success = (members = [member()]) => Response.json({ status: "success", members })
const tick = () => new Promise((resolve) => setImmediate(resolve))

function harness(fetcher = async () => success(), hookSnapshot, effects, reactOverride) {
  const modules = new Map()
  const calls = []
  const sandbox = vm.createContext({
    URLSearchParams, Error, AbortController, queueMicrotask,
    fetch: async (url, init) => {
      assert.match(url, /^\/api\/dashboard\/lookups\?view=group&group=ent-/)
      assert.equal(init.cache, "no-store")
      assert.ok(init.signal)
      assert.equal(init.body, undefined)
      assert.equal(init.method, undefined) // GET, never a live write.
      const call = { group: new URL(url, "https://fixture.invalid").searchParams.get("group"), init }
      calls.push(call)
      return fetcher(call, calls.length)
    },
  })
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    const mod = { exports: {} }
    modules.set(path, mod)
    if (!compiled.has(path)) {
      compiled.set(path, ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
        fileName: path,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText)
    }
    const fixtureRequire = (name) => {
      if (name === "react" && reactOverride) return { ...require(name), ...reactOverride }
      if (name === "react" && effects) return { ...require(name), useEffect: (effect) => { effects.push(effect) } }
      if (["react", "react/jsx-runtime"].includes(name)) return require(name)
      if (name === "./actions") return { reauthorizeDashboardAction: () => { throw new Error("No server action in tests") } }
      if (name === "@/lib/jira-jql") return { SPRINT_PROJECTS: [{ key: "SUN", label: "Fixture project" }] } // Rendering fixture only; no JQL execution.
      if (name === "@/components/team-members-provider" && hookSnapshot) {
        return { useTeamMembers: () => ({ groupStates: hookSnapshot, loadGroup: () => Promise.resolve(), retryGroup: () => Promise.resolve() }) }
      }
      const owned = ["@/lib/jira-dashboard-filter", "@/lib/team-members-store", "@/components/team-members-provider", "@/components/filter-dropdown", "@/components/search-button"]
      if (owned.includes(name)) return load(`${name.slice(2)}.${name.startsWith("@/components/") ? "tsx" : "ts"}`)
      throw new Error(`Unexpected import: ${name}`)
    }
    vm.runInContext(`(function(require,module,exports){${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, mod, mod.exports)
    return mod.exports
  }
  return {
    createStore: load("lib/team-members-store.ts").createTeamMembersStore,
    teams: load("lib/jira-dashboard-filter.ts").DASHBOARD_TEAMS,
    calls, load,
  }
}

function deferredNetwork() {
  const pending = []
  return {
    pending,
    fetcher(call) {
      return new Promise((resolve, reject) => { pending.push({ ...call, resolve, reject }) })
    },
    async drain() {
      while (pending.length) {
        pending.shift().resolve(success())
        await tick()
      }
    },
  }
}

const render = (component, props = {}) => renderToStaticMarkup(createElement(component, props))

describe("application-scoped team memberships", () => {
  it("constructs without fetching and has stable, empty SSR snapshots", () => {
    const h = harness()
    const store = h.createStore()
    assert.equal(h.calls.length, 0)
    assert.deepEqual(plain(store.getSnapshot()), {})
    assert.equal(store.getSnapshot(), store.getSnapshot())
    assert.equal(store.getServerSnapshot(), store.getServerSnapshot())
  })

  it("preloads all teams before a dropdown mounts, with at most four active requests", async () => {
    const network = deferredNetwork()
    const h = harness(network.fetcher)
    const store = h.createStore()
    const release = store.retain()
    assert.equal(h.calls.length, 4)
    assert.equal(Object.keys(store.getSnapshot()).length, 11)
    // Even a requested/retried queued group must use the same bounded queue.
    const queuedGroup = h.teams.at(-1).group
    const queued = store.ensure(queuedGroup)
    assert.equal(queued, store.retry(queuedGroup))
    assert.equal(h.calls.length, 4)
    network.pending.shift().resolve(success())
    await tick()
    assert.equal(h.calls.length, 5)
    assert.equal(network.pending.length, 4)
    await network.drain()
    await queued
    assert.deepEqual(h.calls.map(({ group }) => group), plain(h.teams.map(({ group }) => group)))
    assert.ok(h.teams.every(({ group }) => store.getSnapshot()[group].status === "success"))
    release()
  })

  it("shares in-flight work and cached results after consumer unsubscribe/remount", async () => {
    const network = deferredNetwork()
    const h = harness(network.fetcher)
    const store = h.createStore()
    let updates = 0
    const unsubscribe = store.subscribe(() => { updates++ })
    const first = store.ensure("ent-web")
    assert.equal(first, store.ensure("ent-web"))
    assert.equal(first, store.retry("ent-web"))
    assert.equal(h.calls.length, 1)
    unsubscribe()
    assert.equal(network.pending[0].init.signal.aborted, false)
    await network.drain()
    await first
    const cached = store.getSnapshot()
    const unsubscribeAgain = store.subscribe(() => { updates++ })
    await store.ensure("ent-web")
    await store.retry("ent-web") // Successful entries are not refreshed.
    assert.equal(h.calls.length, 1)
    assert.equal(store.getSnapshot(), cached)
    assert.equal(updates, 1)
    unsubscribeAgain()
  })

  it("deduplicates reentrant ensures before publishing loading", async () => {
    const h = harness()
    const store = h.createStore()
    let nested
    store.subscribe(() => {
      if (store.getSnapshot()["ent-web"]?.status === "loading") nested = store.ensure("ent-web")
    })
    const first = store.ensure("ent-web")
    assert.equal(first, nested)
    await first
    assert.equal(h.calls.length, 1)
  })

  it("deduplicates members and drops profile fields instead of caching raw users", async () => {
    const h = harness(async () => success([
      { ...member("a"), emailAddress: "private@example.invalid", avatarUrls: {}, accessToken: "fixture-not-real" },
      member("a"), member("b"),
    ]))
    const store = h.createStore()
    await store.ensure("ent-web")
    assert.deepEqual(plain(store.getSnapshot()["ent-web"]), { status: "success", members: [member("a"), member("b")] })
    assert.deepEqual(plain(store.getServerSnapshot()), {})
    assert.throws(() => store.ensure("unknown"), /Invalid team/)
  })

  for (const [label, response] of [
    ["invalid JSON", () => new Response("broken")],
    ["invalid envelope", () => Response.json({ status: "success", users: [] })],
    ["invalid account ID", () => success([member('bad"id')])],
    ["missing display name", () => success([{ accountId: "a" }])],
    ["long display name", () => success([{ ...member(), displayName: "a".repeat(201) }])],
    ["control characters", () => success([{ ...member(), displayName: "a\u0000b" }])],
    ["partial invalid members", () => success([member(), null])],
    ["HTTP failure disguised as success", () => Response.json({ status: "success", members: [] }, { status: 502 })],
    ["network failure", () => { throw new Error("Private network detail") }],
  ]) it(`rejects ${label} without publishing a partial or empty success`, async () => {
    const h = harness(async () => response())
    const store = h.createStore()
    await store.ensure("ent-web")
    assert.equal(store.getSnapshot()["ent-web"].status, "error")
    assert.equal(store.getSnapshot()["ent-web"].error.code, "retry")
    await store.ensure("ent-web")
    await store.preload()
    assert.equal(h.calls.filter(({ group }) => group === "ent-web").length, 1)
  })

  for (const [status, code] of [[401, "reauthorize"], [403, "forbidden"]]) {
    it(`preserves ${status} errors, avoids automatic retry, and recovers on explicit retry`, async () => {
      const h = harness(async (_, count) => count === 1
        ? Response.json({ status: "error", error: { code, message: "Fixture permission error" } }, { status })
        : success())
      const store = h.createStore()
      await store.ensure("ent-web")
      assert.deepEqual(plain(store.getSnapshot()["ent-web"]), { status: "error", error: { code, message: "Fixture permission error" } })
      await store.ensure("ent-web")
      assert.equal(h.calls.length, 1)
      await store.retry("ent-web")
      assert.equal(h.calls.length, 2)
      assert.equal(store.getSnapshot()["ent-web"].status, "success")
    })
  }

  it("survives StrictMode cleanup/setup without aborting or repeating preloads", async () => {
    const network = deferredNetwork()
    const h = harness(network.fetcher)
    const store = h.createStore()
    const firstRelease = store.retain()
    firstRelease()
    const secondRelease = store.retain()
    await tick()
    assert.equal(h.calls.length, 4)
    assert.equal(h.calls[0].init.signal.aborted, false)
    await network.drain()
    assert.equal(h.calls.length, 11)
    secondRelease()
    secondRelease() // Releases are idempotent.
    await tick()
    assert.deepEqual(plain(store.getSnapshot()), {})
  })

  it("discards old memberships and ignores late responses after logout/identity replacement", async () => {
    const network = deferredNetwork()
    const h = harness(network.fetcher)
    const oldStore = h.createStore()
    const release = oldStore.retain()
    const oldRequests = [...network.pending]
    release()
    await tick()
    assert.ok(oldRequests.every(({ init }) => init.signal.aborted))
    assert.deepEqual(plain(oldStore.getSnapshot()), {})
    const freshStore = h.createStore()
    const newWork = freshStore.ensure("ent-web")
    const freshRequest = network.pending.pop()
    freshRequest.resolve(success([member("new-viewer-member")]))
    await newWork
    // Mock deliberately ignores abort to exercise late-response protection.
    for (const request of oldRequests) request.resolve(success([member("old-viewer-member")]))
    await tick()
    assert.deepEqual(plain(oldStore.getSnapshot()), {})
    assert.deepEqual(plain(freshStore.getSnapshot()["ent-web"].members), [member("new-viewer-member")])
    assert.equal(h.calls.length, 5) // No queued work from the old application starts.
  })

  it("creates fresh membership data on a new application instance (page reload)", async () => {
    const h = harness()
    const first = h.createStore()
    await first.ensure("ent-web")
    const second = h.createStore()
    assert.deepEqual(plain(second.getSnapshot()), {})
    await second.ensure("ent-web")
    assert.equal(h.calls.length, 2)
  })
})

describe("team membership consumer wiring (SSR only, not browser lifecycle)", () => {
  it("renders the authenticated provider and TeamSelect without network during SSR", () => {
    const h = harness()
    const { TeamMembersProvider } = h.load("components/team-members-provider.tsx")
    const { TeamSelect } = h.load("components/team-select.tsx")
    render(TeamMembersProvider, {
      viewerId: "fixture-viewer",
      children: createElement(TeamSelect, { groups: [], onGroupsChange: () => {} }),
    })
    assert.equal(h.calls.length, 0)
  })

  it("selects only the first clicked member of an unselected team and resets whole-team selection", () => {
    const states = []
    let cursor = 0
    const h = harness(undefined, { "ent-web": { status: "success", members: [member("a"), member("b")] } }, undefined, {
      useState: (initial) => {
        const index = cursor++
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial
        return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next }]
      },
      useRef: (initial) => {
        const index = cursor++
        if (!(index in states)) states[index] = { current: initial }
        return states[index]
      },
      useId: () => "fixture-selector",
      useEffect: () => {},
    })
    const { TeamSelect } = h.load("components/team-select.tsx")
    let groups = []
    let reported
    const draw = () => {
      cursor = 0
      return TeamSelect({ groups, onGroupsChange: (...args) => { reported = plain(args); groups = reported[0] } })
    }
    const elements = (node) => Array.isArray(node) ? node.flatMap(elements)
      : node && typeof node === "object" ? [node, ...elements(node.props?.children)] : []
    const inputFor = (text) => {
      const label = elements(draw()).find((node) => node.type === "label" && elements(node.props.children).some((child) => child.type === "span" && child.props.children === text))
      assert.ok(label, text)
      return elements(label).find((node) => node.type === "input")
    }
    inputFor("Fixture a").props.onChange({ target: { checked: true } })
    assert.deepEqual(reported, [["ent-web"], ["a"], true])
    assert.equal(inputFor("Fixture b").props.checked, false)
    const partial = {}
    inputFor("Web").props.ref(partial)
    assert.equal(partial.indeterminate, true)
    inputFor("Fixture a").props.onChange({ target: { checked: false } })
    assert.deepEqual(reported, [[], [], true])
    inputFor("Fixture b").props.onChange({ target: { checked: true } })
    assert.deepEqual(reported, [["ent-web"], ["b"], true])
    inputFor("Web").props.onChange({ target: { checked: false } })
    inputFor("Web").props.onChange({ target: { checked: true } })
    assert.deepEqual(reported, [["ent-web"], ["a", "b"], true])
    assert.equal(inputFor("Fixture a").props.checked, true)
    const full = {}
    inputFor("Web").props.ref(full)
    assert.equal(full.indeterminate, false)
  })

  it("reads cached members in both modes, exposing member controls only in perMember mode", () => {
    const snapshot = { "ent-web": { status: "success", members: [member("a"), member("b")] } }
    const h = harness(undefined, snapshot)
    const { TeamSelect } = h.load("components/team-select.tsx")
    const props = { groups: ["ent-web"], onGroupsChange: () => {} }
    const perMember = render(TeamSelect, props)
    const perTeam = render(TeamSelect, { ...props, perMember: false })
    assert.match(perMember, /Fixture a/)
    assert.match(perMember, /2\/2/)
    assert.match(perTeam, /2\/2/)
    assert.doesNotMatch(perTeam, /Fixture a|展開 Web 成員/)
    assert.equal(h.calls.length, 0)
  })

  it("does not close on null blur before label activation, but still closes for outside focus", () => {
    const refs = []
    const h = harness(undefined, undefined, undefined, {
      useRef: (value) => { const ref = { current: value }; refs.push(ref); return ref },
      useEffect: () => {},
    })
    const { FilterDropdown } = h.load("components/filter-dropdown.tsx")
    const changes = []
    const tree = FilterDropdown({ id: "fixture", kind: "team", label: "團隊", value: "Web", open: true, onOpenChange: (value) => changes.push(value), describedBy: "help" })
    const inside = {}
    const outside = {}
    const wrapper = { contains: (target) => target === inside }
    refs[0].current = wrapper
    tree.props.onBlur({ currentTarget: wrapper, relatedTarget: null })
    tree.props.onBlur({ currentTarget: wrapper, relatedTarget: inside })
    assert.deepEqual(changes, [])
    tree.props.onBlur({ currentTarget: wrapper, relatedTarget: outside })
    assert.deepEqual(changes, [false])
  })

  it("automatically sizes each dropdown kind without caller width props", () => {
    const h = harness()
    const { FilterDropdown, FILTER_SELECT_WIDTH_CLASS } = h.load("components/filter-dropdown.tsx")
    for (const [kind, width] of [["team", "w-56"], ["project", "w-40"], ["sprint", "w-56"]]) {
      const markup = render(FilterDropdown, { id: kind, kind, label: kind, value: "Long selection", open: true, onOpenChange: () => {}, describedBy: "help" })
      assert.ok(markup.startsWith(`<div class="relative ${FILTER_SELECT_WIDTH_CLASS[kind]}">`))
      assert.match(FILTER_SELECT_WIDTH_CLASS[kind], new RegExp(`^${width} max-w-full min-w-0 shrink-0$`))
      assert.match(markup, /class="truncate"/)
    }
  })

  it("keeps search submits the same width in idle, loading, and both Dashboard modes", () => {
    const h = harness(undefined, {})
    const { SearchButton } = h.load("components/search-button.tsx")
    const { DashboardFilter } = h.load("app/(app)/dashboard/dashboard-filter.tsx")
    for (const loading of [false, true]) {
      const markup = render(SearchButton, { loading, "aria-describedby": "help" })
      assert.match(markup, /type="submit"/)
      assert.match(markup, /h-10 w-24 max-w-full min-w-0/)
      assert.match(markup, /aria-describedby="help"/)
      assert.equal(markup.includes('disabled=""'), loading)
      assert.ok(markup.includes(loading ? "查詢中…" : "查詢"))
    }
    for (const filter of [
      { mode: "team-project", groups: [], exclusions: {}, projects: [], days: 30 },
      { mode: "person", accountId: "fixture-member", name: "Fixture", days: 30 },
    ]) {
      const markup = render(DashboardFilter, { viewerId: "fixture-viewer", filter, onApply: () => {} })
      assert.match(markup.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "", /h-10 w-24 max-w-full min-w-0/)
    }
  })

  it("uses the same bounded width for both Sprint modes and Dashboard team filters", () => {
    const h = harness(undefined, { "ent-web": { status: "success", members: [member("a")] } })
    const { FILTER_SELECT_WIDTH_CLASS } = h.load("components/filter-dropdown.tsx")
    const { TeamSelect } = h.load("components/team-select.tsx")
    const { DashboardFilter } = h.load("app/(app)/dashboard/dashboard-filter.tsx")
    for (const markup of [
      render(TeamSelect, { groups: [], onGroupsChange: () => {} }),
      render(TeamSelect, { groups: ["ent-web"], perMember: false, onGroupsChange: () => {} }),
      render(DashboardFilter, { viewerId: "fixture-viewer", filter: { mode: "team-project", groups: ["ent-web"], exclusions: {}, projects: [], days: 30 }, onApply: () => {} }),
    ]) {
      assert.ok(markup.includes(`class="relative ${FILTER_SELECT_WIDTH_CLASS.team}"`))
      assert.match(markup, /class="truncate"/)
    }
    assert.match(FILTER_SELECT_WIDTH_CLASS.team, /w-56 max-w-full/)
  })

  it("uses the shared bounded width for Dashboard projects and both Sprint project selectors", () => {
    const h = harness(undefined, {})
    const { FILTER_SELECT_WIDTH_CLASS } = h.load("components/filter-dropdown.tsx")
    const { DashboardFilter } = h.load("app/(app)/dashboard/dashboard-filter.tsx")
    const { SprintSelector } = h.load("app/(app)/sprint/burndown/sprint-selector.tsx")
    const dashboard = render(DashboardFilter, {
      viewerId: "fixture-viewer",
      filter: { mode: "team-project", groups: [], exclusions: {}, projects: [], days: 30 },
      onApply: () => {},
    })
    assert.match(dashboard, /lg:grid-cols-\[14rem_10rem_max-content_max-content\]/)
    const projectDropdown = dashboard.match(/<div class="relative [^"]+"><span id="[^"]+-projects-label"[\s\S]*?<\/fieldset><\/div>/)?.[0]
    assert.ok(projectDropdown)
    assert.ok(projectDropdown.startsWith(`<div class="relative ${FILTER_SELECT_WIDTH_CLASS.project}">`))
    assert.match(projectDropdown, /class="truncate"/)
    for (const basePath of ["/sprint/burndown", "/sprint/planning"]) {
      const markup = render(SprintSelector, { basePath, project: null, sprints: [], selectedSprintId: null })
      assert.ok(markup.includes(`<div class="${FILTER_SELECT_WIDTH_CLASS.project}"><div class="relative ${FILTER_SELECT_WIDTH_CLASS.project}"><span id="sprint-project-label"`))
      assert.ok(markup.includes(`<div class="${FILTER_SELECT_WIDTH_CLASS.sprint}"><div class="relative ${FILTER_SELECT_WIDTH_CLASS.sprint}"><span id="sprint-label"`))
      assert.doesNotMatch(markup, /lg:w-44|lg:w-40/) // No per-page breakpoint width overrides.
    }
  })

  it("makes the complete team selection area a native label, keeping expansion separate", () => {
    const h = harness(undefined, { "ent-web": { status: "success", members: [member("a")] } })
    const { TeamSelect } = h.load("components/team-select.tsx")
    const { DashboardFilter } = h.load("app/(app)/dashboard/dashboard-filter.tsx")
    const markups = [
      render(TeamSelect, { groups: ["ent-web"], onGroupsChange: () => {} }),
      render(TeamSelect, { groups: ["ent-web"], perMember: false, onGroupsChange: () => {} }),
      render(DashboardFilter, { viewerId: "fixture-viewer", filter: { mode: "team-project", groups: ["ent-web"], exclusions: {}, projects: [], days: 30 }, onApply: () => {} }),
    ]
    for (const markup of markups) {
      const labels = markup.match(/<label\b[^>]*>[\s\S]*?<\/label>/g) ?? []
      const teamRow = labels.find((label) => label.includes("<span>Web</span>"))
      assert.ok(teamRow)
      assert.match(teamRow, /flex-1/)
      assert.match(teamRow, /min-h-10/)
      assert.match(teamRow, /px-2 py-2/)
      assert.match(teamRow, /hover:bg-slate-50/)
      assert.match(teamRow, /ml-auto[^>]*>1\/1<\/span>/) // Count is inside the clickable label.
      assert.equal((teamRow.match(/type="checkbox"/g) ?? []).length, 1)
      assert.doesNotMatch(teamRow, /<button|role="button"/) // Native label activation, not a second toggle handler.
    }
    for (const markup of [markups[0], markups[2]]) {
      assert.match(markup, /<div class="flex min-w-0 items-stretch"><button[^>]*aria-label="展開 Web 成員"[\s\S]*?<\/button><label/)
    }
  })

  it("makes each member label span the row including the indentation and right padding", () => {
    const h = harness(undefined, { "ent-web": { status: "success", members: [member("a")] } })
    const { TeamSelect } = h.load("components/team-select.tsx")
    const { DashboardFilter } = h.load("app/(app)/dashboard/dashboard-filter.tsx")
    for (const markup of [
      render(TeamSelect, { groups: ["ent-web"], onGroupsChange: () => {} }),
      render(DashboardFilter, { viewerId: "fixture-viewer", filter: { mode: "team-project", groups: ["ent-web"], exclusions: {}, projects: [], days: 30 }, onApply: () => {} }),
    ]) {
      const memberRow = (markup.match(/<label\b[^>]*>[\s\S]*?<\/label>/g) ?? []).find((label) => label.includes("Fixture a"))
      assert.ok(memberRow)
      assert.match(memberRow, /min-h-10 w-full/)
      assert.match(memberRow, /py-2 pr-3 pl-10/)
      assert.match(memberRow, /hover:bg-slate-50/)
      assert.equal((memberRow.match(/type="checkbox"/g) ?? []).length, 1)
      assert.doesNotMatch(memberRow, /<button|role="button"/)
    }
  })

  it("reports already-cached selected members and team labels to a newly mounted consumer", () => {
    const effects = []
    const seed = harness()
    const snapshot = Object.fromEntries(seed.teams.map(({ group }) => [group, { status: "success", members: [member(group)] }]))
    for (const perMember of [true, false]) {
      const h = harness(undefined, snapshot, effects)
      const { TeamSelect } = h.load("components/team-select.tsx")
      const selected = []
      const labels = []
      render(TeamSelect, {
        groups: ["ent-web"], perMember,
        onGroupsChange: (...args) => selected.push(plain(args)),
        onMembersReady: (value) => labels.push(plain(value)),
      })
      // Explicit effect invocation is a wiring check, not a DOM/hydration simulation.
      for (const effect of effects.splice(0)) effect()
      assert.deepEqual(selected, [[["ent-web"], ["ent-web"], true]])
      assert.equal(labels.length, 1)
      assert.equal(labels[0]["ent-web"], "Web")
      assert.equal(h.calls.length, 0)
    }
  })

  it("keeps whole-team error recovery accessible without a member expansion", () => {
    const h = harness(undefined, { "ent-web": { status: "error", error: { code: "forbidden", message: "Fixture permission error" } } })
    const { TeamSelect } = h.load("components/team-select.tsx")
    const markup = render(TeamSelect, { groups: ["ent-web"], perMember: false, onGroupsChange: () => {} })
    assert.match(markup, /Fixture permission error/)
    assert.match(markup, /重試 Web/)
    assert.doesNotMatch(markup, /展開 Web 成員/)
  })

  it("Dashboard queries require all selected memberships, including on a cached remount", () => {
    for (const complete of [false, true]) {
      const h = harness(undefined, {
        "ent-web": { status: "success", members: [member("a")] },
        "ent-be1": complete ? { status: "success", members: [member("a"), member("b")] } : { status: "loading" },
      })
      const { DashboardFilter } = h.load("app/(app)/dashboard/dashboard-filter.tsx")
      const props = { viewerId: "fixture-viewer", filter: { mode: "team-project", groups: ["ent-web", "ent-be1"], exclusions: {}, projects: [], days: 30 }, onApply: () => {} }
      for (let mount = 0; mount < 2; mount++) {
        const markup = render(DashboardFilter, props)
        const queryButton = markup.match(/<button[^>]*type="submit"[^>]*>/)?.[0]
        assert.ok(queryButton)
        assert.equal(queryButton.includes('disabled=""'), !complete)
        if (complete) assert.match(markup, /2 名不重複成員/)
      }
      assert.equal(h.calls.length, 0)
    }
  })
})

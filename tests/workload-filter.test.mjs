import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import { describe, it } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const compiled = new Map()
const plain = (value) => JSON.parse(JSON.stringify(value))
const root = "app/(app)/analytics/workload/summary/"
const user = (accountId) => ({ accountId, displayName: accountId })
const success = (...ids) => ({ status: "success", members: ids.map(user) })

/** Offline hook/callback wiring, not a browser lifecycle or measured layout. */
function harness(initialSnapshot = {}) {
  let snapshot = initialSnapshot
  const modules = new Map()
  const slotsByComponent = new Map()
  const pushes = []
  let slots = []
  let cursor = 0
  let effects = []
  const hooks = {
    useState(initial) {
      const index = cursor++
      const owned = slots
      if (!(index in owned)) owned[index] = typeof initial === "function" ? initial() : initial
      return [owned[index], (next) => { owned[index] = typeof next === "function" ? next(owned[index]) : next }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useId: () => "fixture-filter",
    useEffect: (effect) => { effects.push(effect) },
    useMemo: (compute) => compute(),
    // DateRangeField 以 useSyncExternalStore(訂閱, clientSnapshot, serverSnapshot) 取得本機今天。
// fixture 直接呼叫它傳入的 getter 以貼近真實行為，但改以可控的 today 覆寫 client 值，
// 讓「尚未取得今天（server 回 null）」與「已取得今天」兩條路徑都能被測試。
    useSyncExternalStore: (_subscribe, _getSnapshot, getServerSnapshot) => (today === null && getServerSnapshot ? getServerSnapshot() : today),
  }
  let today = null
  const sandbox = vm.createContext({
    URLSearchParams, Error, Date,
    fetch: () => { throw new Error("No workload HTTP request is allowed") },
  })
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    const mod = { exports: {} }
    modules.set(path, mod)
    if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText)
    const fixtureRequire = (name) => {
      if (name === "react") return { ...require(name), ...hooks }
      if (name === "react/jsx-runtime") return require(name)
      if (name === "next/navigation") return { useRouter: () => ({ push: (href) => pushes.push(href) }) }
      if (name === "@/components/team-members-provider") return {
        useTeamMembers: () => ({ groupStates: snapshot, loadGroup: async () => {}, retryGroup: async () => {} }),
      }
      if (name === "@/lib/jira-dashboard") return { dashboardJiraBaseUrl: () => "https://fixture.invalid" }
      if (name === "./workload-issue-details") return { WorkloadIssueDetails: () => null }
      if (name === "./date-range.ts") return load("lib/date-range.ts")
      if (name === "./workload-filter") return load(`${root}workload-filter.tsx`)
      if (name === "./workload-heatmap-client") return load(`${root}workload-heatmap-client.tsx`)
      if (name === "./workload-heatmap-grid") return load(`${root}workload-heatmap-grid.tsx`)
      const owned = ["@/components/page-header", "@/components/team-select", "@/components/filter-dropdown", "@/components/search-button", "@/components/date-range-field", "@/lib/jira-dashboard-filter", "@/lib/workload-filter", "@/lib/date-range", "@/lib/workload-heatmap"]
      if (owned.includes(name)) return load(`${name.slice(2)}.${name.startsWith("@/components/") ? "tsx" : "ts"}`)
      throw new Error(`Unexpected dependency: ${name}`)
    }
    vm.runInContext(`(function(require,module,exports){${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, mod, mod.exports)
    return mod.exports
  }
  function draw(component, props) {
    if (!slotsByComponent.has(component)) slotsByComponent.set(component, [])
    slots = slotsByComponent.get(component)
    cursor = 0
    effects = []
    const tree = component(props)
    const pending = effects
    // TeamSelect 的選取 effect 與 DateRangeField 的預設區間 effect 需要在 fixture 中執行；
    // 兩者都不註冊 DOM listener，因此不需要 mock 事件目標。
    if ([load("components/team-select.tsx").TeamSelect, load("components/date-range-field.tsx").DateRangeField].includes(component)) pending.forEach((effect) => { try { effect() } catch { /* 非 hook 環境下 effect 可能無 cleanup 需求 */ } })
    return tree
  }
  const Form = load(`${root}workload-filter.tsx`).WorkloadFilterForm
  let props = { initialFilter: null, initialError: null }
  return {
    load, draw, pushes,
    setSnapshot: (value) => { snapshot = value },
    setToday: (value) => { today = value },
    form(nextProps) { if (nextProps) props = nextProps; return draw(Form, props) },
    component: (node) => draw(node.type, node.props),
  }
}

function elements(node, predicate) {
  const found = []
  function visit(value) {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (predicate(value)) found.push(value)
    visit(value.props?.children)
  }
  visit(node)
  return found
}
const one = (tree, predicate) => {
  const found = elements(tree, predicate)
  assert.equal(found.length, 1)
  return found[0]
}
const named = (tree, name) => one(tree, (node) => node.type?.name === name)
/** 最外層 fragment 的直接 children（展平陣列與條件渲染的 false/null）。 */
const children = (tree) => {
  const root = Array.isArray(tree) ? tree : [tree]
  return root.flatMap((node) => (node?.type === Symbol.for("react.fragment") ? node.props.children : node))
    .flat()
    .filter((child) => child !== null && child !== undefined && child !== false)
}
const text = (node) => {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(text).join("")
  return node?.props ? text(node.props.children) : ""
}
function submit(tree) {
  let prevented = false
  one(tree, (node) => node.type === "form").props.onSubmit({ preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
}
const filter = { groups: ["ent-web"], exclusions: {}, projects: [], from: "2026-10-01", to: "2026-10-31" }
const formProps = (value = filter) => ({ initialFilter: value, initialError: null })

describe("page-configurable DateRangeField shortcuts", () => {
  const today = "2026-10-19"
  const recent = { id: "recent", label: "最近一週", preset: "last7" }
  const monthly = { id: "monthly", label: "最近一個月", preset: "last30" }
  const sprint = { id: "sprint", label: "本期 Sprint", range: { from: "2026-10-19", to: "2026-11-01" } }
  const buttons = (tree) => elements(tree, (node) => node.type === "button" && "aria-pressed" in node.props)
  function fieldFixture(options = {}, browserToday = today) {
    const h = harness()
    h.setToday(browserToday)
    const changes = []
    const commits = []
    const props = {
      value: { from: "2026-10-13", to: today },
      ...options,
      onChange: (value) => { props.value = value; changes.push(plain(value)) },
      onCommit: (value) => commits.push(plain(value)),
    }
    const Field = h.load("components/date-range-field.tsx").DateRangeField
    return { h, props, changes, commits, draw: () => h.draw(Field, props) }
  }

  it("keeps all six defaults with the existing active state and button layout", () => {
    const f = fieldFixture()
    const tree = f.draw()
    const choices = buttons(tree)
    assert.deepEqual(choices.map(text), ["今日", "本週", "上週", "本月", "近 7 日", "近 30 日"])
    assert.deepEqual(choices.filter((button) => button.props["aria-pressed"]).map(text), ["近 7 日"])
    assert.ok(choices.every((button) => button.props.type === "button" && button.props.disabled === false))
    assert.ok(choices.every((button) => /h-10 shrink-0/.test(button.props.className)))
    assert.equal(f.changes.length, 0)
  })
  it("renders page order and labels, and commits built-in and custom dates through the same callbacks", () => {
    const f = fieldFixture({ shortcuts: [sprint, monthly, recent] })
    let tree = f.draw()
    assert.deepEqual(buttons(tree).map(text), ["本期 Sprint", "最近一個月", "最近一週"])
    buttons(tree)[0].props.onClick()
    assert.deepEqual(f.changes, [sprint.range])
    assert.deepEqual(f.commits, [sprint.range])
    tree = f.draw()
    assert.deepEqual(buttons(tree).filter((button) => button.props["aria-pressed"]).map(text), ["本期 Sprint"])
    assert.doesNotMatch(text(tree), /自訂區間/)
    buttons(tree)[1].props.onClick()
    assert.deepEqual(f.changes[1], { from: "2026-09-20", to: today })
    assert.deepEqual(f.commits[1], f.changes[1])
    assert.equal(f.h.pushes.length, 0)
  })
  it("matches controlled dates only against visible options and responds to configuration changes", () => {
    const f = fieldFixture({ shortcuts: [monthly] })
    let tree = f.draw()
    assert.equal(buttons(tree).filter((button) => button.props["aria-pressed"]).length, 0)
    assert.doesNotMatch(text(tree), /自訂區間/)
    f.props.shortcuts = [recent, monthly]
    tree = f.draw()
    assert.deepEqual(buttons(tree).filter((button) => button.props["aria-pressed"]).map(text), ["最近一週"])
    f.props.value = { from: "2026-10-14", to: today }
    assert.doesNotMatch(text(f.draw()), /自訂區間/)
    assert.equal(f.changes.length, 0)
    assert.equal(f.commits.length, 0)
  })
  it("hides the valid-range status without hiding invalid-range feedback", () => {
    const f = fieldFixture({ value: { from: "2026-10-14", to: today } })
    let status = elements(f.draw(), (node) => node.props.role === "status")[0]
    assert.equal(status.props.className, "sr-only")
    assert.equal(text(status), "分析區間已設定。")
    f.props.value = { from: "2026-10-21", to: today }
    status = elements(f.draw(), (node) => node.props.role === "status")[0]
    assert.doesNotMatch(status.props.className, /sr-only/)
    assert.equal(text(status), "結束日不可早於起始日。")
  })
  it("activates only the first identical range in page order", () => {
    const f = fieldFixture({
      shortcuts: [{ id: "week", label: "本週", preset: "thisWeek" }, recent],
      value: { from: today, to: "2026-10-25" },
    }, "2026-10-25")
    assert.deepEqual(buttons(f.draw()).filter((button) => button.props["aria-pressed"]).map(text), ["本週"])
    f.props.shortcuts.reverse()
    assert.deepEqual(buttons(f.draw()).filter((button) => button.props["aria-pressed"]).map(text), ["最近一週"])
  })
  it("omits an empty shortcut group without removing inputs/calendar or changing the default", () => {
    const f = fieldFixture({ shortcuts: [], value: { from: "", to: "" } })
    let tree = f.draw()
    assert.equal(elements(tree, (node) => node.props["aria-label"] === "時間區間快捷鍵").length, 0)
    assert.equal(elements(tree, (node) => node.type?.name === "DateInput").length, 2)
    assert.equal(elements(tree, (node) => node.props["aria-label"] === "開啟月曆選擇分析區間").length, 1)
    assert.deepEqual(f.changes, [{ from: "2026-10-13", to: today }])
    assert.deepEqual(f.commits, f.changes)
    tree = f.draw()
    assert.doesNotMatch(text(tree), /自訂區間/)
    f.props.value = { from: "", to: "" }
    f.draw()
    assert.equal(f.changes.length, 1) // Clearing later must not reinitialize.
  })
  it("keeps browser-today gating and initializes a nonvisible default preset only once", () => {
    const f = fieldFixture({ shortcuts: [sprint, recent], defaultPreset: "last30", value: { from: "", to: "" } }, null)
    const serverTree = f.draw()
    assert.ok(buttons(serverTree).every((button) => button.props.disabled))
    assert.equal(f.changes.length, 0)
    f.h.setToday(today)
    f.draw()
    assert.deepEqual(f.changes, [{ from: "2026-09-20", to: today }])
    assert.deepEqual(f.commits, f.changes)
    assert.doesNotMatch(text(f.draw()), /自訂區間/)
    assert.equal(f.changes.length, 1)
  })
  it("clicking a shortcut in the workload form changes only the draft until submit", () => {
    const h = harness({ "ent-web": success("a") })
    h.setToday(today)
    let tree = h.form(formProps())
    const field = named(tree, "DateRangeField")
    const customized = h.draw(field.type, { ...field.props, shortcuts: [sprint] })
    buttons(customized)[0].props.onClick()
    assert.equal(h.pushes.length, 0)
    tree = h.form()
    assert.deepEqual(plain(named(tree, "DateRangeField").props.value), sprint.range)
    submit(tree)
    assert.deepEqual(h.pushes, ["/analytics/workload/summary?group=ent-web&from=2026-10-19&to=2026-11-01"])
  })
})

// Import whitelist deliberately excludes auth, Jira services, APIs and query builders.
describe("workload UI URL selections", () => {
  const h = harness()
  const { parseWorkloadFilter, serializeWorkloadFilter, workloadHref, workloadFilterResult } = h.load("lib/workload-filter.ts")
  it("empty URL is unselected, not self, with the range supplied by the field", () => {
    assert.equal(parseWorkloadFilter(new URLSearchParams()), null)
    const tree = h.form()
    // 沒有 URL 區間時，表單先給空草稿；實際日期由 DateRangeField 依瀏覽器本機今天補上，
    // 因此表單本身不假造日期，也不預設任何快捷鍵。
    assert.deepEqual(plain(named(tree, "DateRangeField").props.value).from, "")
    assert.deepEqual(plain(named(tree, "DateRangeField").props.value).to, "")
    assert.deepEqual(plain(named(tree, "TeamSelect").props.groups), [])
    assert.equal(named(tree, "SearchButton").props.disabled, true)
    assert.equal(elements(tree, (node) => node.props.role === "alert").length, 0)
    assert.match(text(tree), /尚未選擇分析區間/)
  })
  it("reuses Dashboard scope validation and serializes a deterministic range", () => {
    const value = { groups: ["ent-web", "ent-be1", "ent-web"], exclusions: { "ent-web": ["b", "a", "a"] }, projects: ["tkk", "sun", "sun"], from: "2026-10-01", to: "2026-10-31" }
    const serialized = serializeWorkloadFilter(value)
    assert.equal(serialized, "group=ent-be1&group=ent-web&exclude=ent-web%7Ca&exclude=ent-web%7Cb&project=sun&project=tkk&from=2026-10-01&to=2026-10-31")
    assert.equal(serializeWorkloadFilter(parseWorkloadFilter(new URLSearchParams(serialized))), serialized)
    assert.equal(workloadHref(filter), "/analytics/workload/summary?group=ent-web&from=2026-10-01&to=2026-10-31")
    // 日曆日不因重複序列化而位移（不經 UTC 轉換）。
    const single = serializeWorkloadFilter({ ...filter, from: "2026-01-01", to: "2026-01-01" })
    assert.match(single, /from=2026-01-01&to=2026-01-01/)
    // 不會寫入天數：區間模型與「近 N 天」無關。
    assert.doesNotMatch(serialized, /days=/)
    assert.doesNotMatch(serializeWorkloadFilter({ ...filter, from: "2026-10-01", to: "2026-10-30" }), /days=/)
  })
  for (const query of [
    "mode=self", "mode=person&accountId=a", "mode=team-project&group=ent-web", "jql=project%3Dsun", "unknown=1", "days=30", "project=sun", "group=ent-qa", "group=ent-web&project=bad", "group=ent-web&exclude=ent-be1%7Ca", "group=ent-web&exclude=invalid", "group=ent-web&days=1&days=2",
    // 區間是本頁的查詢範圍：缺少、只有一端、重複、顛倒或畸形一律不套用。
    "group=ent-web", "group=ent-web&from=2026-10-01", "group=ent-web&to=2026-10-31", "group=ent-web&from=2026-10-01&from=2026-10-02&to=2026-10-31", "group=ent-web&from=2026-10-31&to=2026-10-01", "group=ent-web&from=2026-02-30&to=2026-10-31", "group=ent-web&from=2026-1-01&to=2026-10-31", "group=ent-web&from=&to=", "group=ent-web&from=2020-01-01&to=2040-01-01",
  ]) it(`rejects unsupported or incomplete scope ${query}`, () => {
    const result = workloadFilterResult(new URLSearchParams(query))
    assert.equal(result.filter, null)
    assert.equal(typeof result.error, "string")
  })
  for (const [from, to] of [["2026-10-31", "2026-10-01"], ["2026-02-30", "2026-10-31"], ["26-10-01", "2026-10-31"], ["2026-10-01", "2026-1-31"]]) {
    it(`rejects invalid range ${from} → ${to}`, () => assert.throws(() => parseWorkloadFilter(new URLSearchParams(`group=ent-web&from=${from}&to=${to}`))))
  }
})

describe("workload page and filter callbacks", () => {
  it("provides only four recent-month shortcuts and defaults to 近1月", () => {
    const h = harness({ "ent-web": success("a") })
    const field = named(h.form(formProps()), "DateRangeField")
    assert.equal(field.props.defaultPreset, "last1Month")
    assert.deepEqual(plain(field.props.shortcuts).map((option) => option.label), ["近1月", "近2月", "近3月", "近6月"])
    h.setToday("2026-11-03")
    const markup = h.component(field)
    assert.deepEqual(elements(markup, (node) => node.type === "button" && "aria-pressed" in node.props).map(text), ["近1月", "近2月", "近3月", "近6月"])
  })
  it("initializes 近1月 only after browser today is known and highlights it", () => {
    const h = harness({ "ent-web": success("a") })
    let tree = h.form()
    h.component(named(tree, "DateRangeField"))
    assert.equal(named(h.form(), "DateRangeField").props.value.from, "")
    h.setToday("2026-11-03")
    h.component(named(h.form(), "DateRangeField"))
    tree = h.form()
    assert.deepEqual(plain(named(tree, "DateRangeField").props.value), { from: "2026-10-04", to: "2026-11-03" })
    const markup = h.component(named(tree, "DateRangeField"))
    assert.deepEqual(elements(markup, (node) => node.type === "button" && node.props["aria-pressed"] === true).map(text), ["近1月"])
    assert.equal(h.pushes.length, 0)
  })
  for (const [label, from] of [["近1月", "2026-10-04"], ["近2月", "2026-09-04"], ["近3月", "2026-08-04"], ["近6月", "2026-05-04"]]) {
    it(`${label} updates the draft and submits its exact calendar-month range`, () => {
      const h = harness({ "ent-web": success("a") })
      h.setToday("2026-11-03")
      let tree = h.form(formProps())
      const markup = h.component(named(tree, "DateRangeField"))
      one(markup, (node) => node.type === "button" && text(node) === label).props.onClick()
      assert.equal(h.pushes.length, 0)
      tree = h.form()
      assert.deepEqual(plain(named(tree, "DateRangeField").props.value), { from, to: "2026-11-03" })
      submit(tree)
      assert.deepEqual(h.pushes, [`/analytics/workload/summary?group=ent-web&from=${from}&to=2026-11-03`])
    })
  }
  it("only renders requested controls and explanatory text, with shared widths", () => {
    const h = harness({ "ent-web": success("a") })
    const tree = h.form(formProps())
    assert.equal(elements(tree, (node) => node.type === "input" && node.props.type === "radio").length, 0)
    assert.equal(elements(tree, (node) => node.type?.name === "TeamSelect").length, 1)
    const project = named(tree, "FilterDropdown")
    assert.equal(project.props.kind, "project")
    const projectMarkup = h.component(project)
    assert.match(projectMarkup.props.className, /w-40 max-w-full min-w-0/)
    const team = h.component(named(tree, "TeamSelect"))
    assert.equal(team.props.kind, "team")
    const teamMarkup = h.component(team)
    assert.match(teamMarkup.props.className, /w-56 max-w-full min-w-0/)
    const button = h.component(named(tree, "SearchButton"))
    assert.equal(button.props.type, "submit")
    assert.match(button.props.className, /w-24 max-w-full min-w-0/)
    // 第一排是分析區間，第二排才是團隊／專案／查詢；只有後者需要 flex-wrap 收窄。
    const rows = one(tree, (node) => node.type === "form").props.children
    assert.equal(elements(rows[0], (node) => node.type?.name === "DateRangeField").length, 1)
    assert.equal(elements(rows[1], (node) => node.type?.name === "TeamSelect").length, 1)
    assert.match(rows[1].props.className, /flex-wrap/)
    assert.doesNotMatch(text(tree), /工作量資料尚未接上/)
    assert.equal(h.pushes.length, 0)
  })
  it("draft changes never navigate; submit serializes only selections to the workload URL", () => {
    const h = harness({ "ent-web": success("a"), "ent-be1": success("a", "b") })
    let tree = h.form(formProps())
    named(tree, "TeamSelect").props.onGroupsChange(["ent-web", "ent-be1"], ["a", "b"], true)
    named(tree, "TeamSelect").props.onExclusionsChange({ "ent-web": ["a"] })
    const project = named(tree, "FilterDropdown")
    const tkk = elements(project, (node) => node.type === "label").find((node) => text(node) === "Telasa")
    one(tkk, (node) => node.type === "input").props.onChange({ target: { checked: true } })
    // 分析區間由 DateRangeField 以受控 callback 上報（快捷鍵／月曆選取時）。
    named(tree, "DateRangeField").props.onChange({ from: "2026-10-01", to: "2026-10-31" })
    named(tree, "DateRangeField").props.onCommit({ from: "2026-10-01", to: "2026-10-31" })
    assert.equal(h.pushes.length, 0)
    tree = h.form()
    assert.equal(named(tree, "SearchButton").props.disabled, false)
    submit(tree)
    assert.deepEqual(h.pushes, ["/analytics/workload/summary?group=ent-be1&group=ent-web&exclude=ent-web%7Ca&project=tkk&from=2026-10-01&to=2026-10-31"])
  })
  it("submits the range restored from the URL without touching the shortcuts", () => {
    const h = harness({ "ent-web": success("a") })
    const restored = { ...filter, from: "2026-09-15", to: "2026-09-28" }
    const tree = h.form(formProps(restored))
    // 已套用的區間直接沿用，不需要使用者再碰一次快捷鍵。
    assert.deepEqual(plain(named(tree, "DateRangeField").props.value).from, "2026-09-15")
    assert.deepEqual(plain(named(tree, "DateRangeField").props.value).to, "2026-09-28")
    submit(tree)
    assert.deepEqual(h.pushes, ["/analytics/workload/summary?group=ent-web&from=2026-09-15&to=2026-09-28"])
  })
  it("blocks submit until a range exists, without falling back to a default window", () => {
    const h = harness({ "ent-web": success("a") })
    // 沒有 URL 區間、也還沒取得本機今天時，表單維持空區間草稿。
    const tree = h.form({ initialFilter: { ...filter, from: "", to: "" }, initialError: null })
    assert.deepEqual(plain(named(tree, "DateRangeField").props.value).from, "")
    assert.deepEqual(plain(named(tree, "DateRangeField").props.value).to, "")
    // 未選區間時先提示，尚未進入錯誤狀態。
    assert.equal(elements(tree, (node) => node.props.role === "alert").length, 0)
    assert.match(text(tree), /尚未選擇分析區間/)
    submit(tree) // 送出仍不得放行，也不得自行套用任何預設區間。
    assert.equal(h.pushes.length, 0)
    assert.match(text(one(h.form(), (node) => node.props.role === "alert")), /請先選擇分析區間/)
  })
  it("lets a long range through: the query count no longer scales with the day count", () => {
    const h = harness({ "ent-web": success("a") })
    // 熱點圖改成一次查詢後，天數只影響回應筆數、不影響請求數，因此不再有 60 天上限。
    // 上限只由 date-range 的畸形輸入保護（DATE_RANGE_MAX_DAYS）負責。
    const from = "2026-01-01"
    const to = "2026-12-31"
    // 草稿存於表單內部：onChange 寫入 range、onCommit 標記已觸碰；兩者都要落在同一棵樹上。
    let tree = h.form(formProps())
    named(tree, "DateRangeField").props.onChange({ from, to })
    named(tree, "DateRangeField").props.onCommit({ from, to })
    tree = h.form() // 重新繪製後草稿仍在，且已標記為「已觸碰」。
    submit(tree)
    assert.deepEqual(h.pushes, [`/analytics/workload/summary?group=ent-web&from=${from}&to=${to}`])
  })
  it("fills the default range in the browser, once, without overriding a restored range", () => {
    const h = harness({ "ent-web": success("a") })
    // 第一次繪製（server snapshot）時還沒有本機今天，維持空區間。
    let tree = h.form({ initialFilter: { ...filter, from: "", to: "" }, initialError: null })
    assert.equal(named(tree, "DateRangeField").props.value.from, "")
    // 取得本機今天後，DateRangeField 的 effect 以本頁預設的近1月補值並回報上層。
    h.setToday("2026-10-19")
    tree = h.form()
    assert.equal(named(tree, "DateRangeField").props.value.from, "") // 尚未套用，等 effect 執行
    h.component(named(tree, "DateRangeField"))
    tree = h.form()
    assert.equal(named(tree, "DateRangeField").props.value.from, "2026-09-20")
    assert.equal(named(tree, "DateRangeField").props.value.to, "2026-10-19")
    // 補值後即成為可查的草稿，未選擇提示消失。
    assert.doesNotMatch(text(tree), /尚未選擇分析區間/)
    submit(tree)
    assert.deepEqual(h.pushes, ["/analytics/workload/summary?group=ent-web&from=2026-09-20&to=2026-10-19"])
    // 只補一次：重繪不會再改動已套用的區間。
    h.component(named(h.form(), "DateRangeField"))
    assert.equal(named(h.form(), "DateRangeField").props.value.from, "2026-09-20")
  })
  it("never lets the default override a range restored from the URL", () => {
    const h = harness({ "ent-web": success("a") })
    h.setToday("2026-10-19")
    const restored = { ...filter, from: "2026-08-01", to: "2026-08-31" }
    let tree = h.form(formProps(restored))
    h.component(named(tree, "DateRangeField"))
    tree = h.form()
    assert.equal(named(tree, "DateRangeField").props.value.from, "2026-08-01")
    assert.equal(named(tree, "DateRangeField").props.value.to, "2026-08-31")
    submit(tree)
    assert.deepEqual(h.pushes, ["/analytics/workload/summary?group=ent-web&from=2026-08-01&to=2026-08-31"])
  })
  for (const snapshot of [ {}, { "ent-web": { status: "loading" } }, { "ent-web": { status: "error", error: { message: "failure" } } }, { "ent-web": success() } ]) {
    it(`blocks incomplete/empty populations ${JSON.stringify(snapshot)}`, () => {
      const h = harness(snapshot)
      const tree = h.form(formProps())
      assert.equal(named(tree, "SearchButton").props.disabled, true)
      submit(tree) // A programmatic/Enter submit cannot bypass the disabled button.
      assert.equal(h.pushes.length, 0)
      assert.equal(elements(h.form(), (node) => node.props.role === "alert").length, 1)
    })
  }
  it("blocks no-team, all-excluded and partially ready selections without broadening", () => {
    for (const value of [
      { ...filter, groups: [] },
      { ...filter, exclusions: { "ent-web": ["a"] } },
      { ...filter, groups: ["ent-web", "ent-be1"] },
    ]) {
      const h = harness({ "ent-web": success("a"), "ent-be1": { status: "loading" } })
      const tree = h.form(formProps(value))
      assert.equal(named(tree, "SearchButton").props.disabled, true)
      submit(tree)
      assert.equal(h.pushes.length, 0)
    }
  })
  it("does not trust stale callback readiness when a selected group fails later", () => {
    const h = harness({ "ent-web": success("a") })
    let tree = h.form(formProps())
    named(tree, "TeamSelect").props.onGroupsChange(["ent-web"], ["a"], true)
    h.setSnapshot({ "ent-web": { status: "error", error: { message: "failure" } } })
    tree = h.form()
    assert.equal(named(tree, "SearchButton").props.disabled, true)
    submit(tree)
    assert.equal(h.pushes.length, 0)
  })
  it("restored individual exclusions survive loading and apply only complete current memberships", () => {
    const h = harness({ "ent-web": { status: "loading" } })
    const restored = { ...filter, exclusions: { "ent-web": ["a"] } }
    let tree = h.form(formProps(restored))
    h.component(named(tree, "TeamSelect"))
    assert.equal(named(tree, "SearchButton").props.disabled, true)
    h.setSnapshot({ "ent-web": success("a", "b") })
    tree = h.form()
    h.component(named(tree, "TeamSelect"))
    tree = h.form()
    assert.match(text(tree), /1 名不重複成員/)
    submit(tree)
    assert.deepEqual(h.pushes, ["/analytics/workload/summary?group=ent-web&exclude=ent-web%7Ca&from=2026-10-01&to=2026-10-31"])
  })
  it("awaits route params, preserves applied state via keys and rejects invalid URLs without self fallback", async () => {
    const h = harness()
    const Page = h.load(`${root}page.tsx`).default
    const empty = named(await Page({ searchParams: Promise.resolve({}) }), "WorkloadFilterForm")
    assert.equal(empty.key, "empty")
    assert.equal(empty.props.initialFilter, null)
    // 區間是查詢範圍的一部分：URL 沒有 from/to 時不套用任何預設視窗。
    assert.equal(named(await Page({ searchParams: Promise.resolve({ group: "ent-web" }) }), "WorkloadFilterForm").props.initialFilter, null)
    const params = { group: ["ent-web", "ent-be1"], exclude: "ent-web|a", from: "2026-10-01", to: "2026-10-31" }
    const first = await Page({ searchParams: Promise.resolve(params) })
    assert.equal(named(first, "PageHeader").props.title, "工作量分析")
    const applied = named(first, "WorkloadFilterForm")
    assert.equal(applied.key, "group=ent-be1&group=ent-web&exclude=ent-web%7Ca&from=2026-10-01&to=2026-10-31")
    assert.deepEqual(plain(applied.props.initialFilter.exclusions), { "ent-web": ["a"] })
    assert.equal(applied.props.initialFilter.from, "2026-10-01")
    assert.equal(applied.props.initialFilter.to, "2026-10-31")
    // 換區間（或換團隊）都會讓 key 改變，觸發表單重新掛載並還原新條件。
    const changed = named(await Page({ searchParams: Promise.resolve({ group: "ent-web", from: "2026-10-01", to: "2026-10-07" }) }), "WorkloadFilterForm")
    assert.notEqual(changed.key, applied.key)
    const back = named(await Page({ searchParams: Promise.resolve(params) }), "WorkloadFilterForm")
    assert.equal(back.key, applied.key)
    const invalid = named(await Page({ searchParams: Promise.resolve({ mode: "self" }) }), "WorkloadFilterForm")
    assert.equal(invalid.props.initialFilter, null)
    assert.equal(typeof invalid.props.initialError, "string")
    assert.match(invalid.key, /^invalid:/)
  })

  it("keeps the team selector only in the search form and uses the latest applied filter in the heatmap", () => {
    const h = harness({ "ent-web": success("a"), "ent-be1": success("b") })
    const Client = h.load(`${root}workload-heatmap-client.tsx`).WorkloadHeatmapClient
    const endpoint = "/api/analytics/workload/heatmap/stream?group=ent-web&from=2026-10-01&to=2026-10-31"
    const first = h.draw(Client, { filter, endpoint })
    assert.equal(elements(h.form(formProps()), (node) => node.type?.name === "TeamSelect").length, 1)
    assert.equal(elements(first, (node) => node.type?.name === "TeamSelect").length, 0)
    assert.doesNotMatch(text(first), /團隊變更只過濾/)
    const stream = named(first, "HeatmapStream")
    assert.deepEqual(plain(stream.props.filter), filter)
    assert.deepEqual(plain(stream.props.teamOf), { a: "Web", b: "BE1" })
    assert.equal("groups" in stream.props, false)
    assert.equal("memberIds" in stream.props, false)
    const changedFilter = { ...filter, groups: ["ent-be1"], exclusions: { "ent-be1": ["b"] } }
    const changed = h.draw(Client, { filter: changedFilter, endpoint: `${endpoint}&project=sun` })
    assert.deepEqual(plain(named(changed, "HeatmapStream").props.filter), changedFilter)
    assert.equal(elements(changed, (node) => node.type?.name === "TeamSelect").length, 0)
  })

  // 同一個 fragment 下兩個 sibling 帶相同 key，React 會警告重複 key。
  // 表單需要 key（條件變更時重設草稿），熱點圖不需要（其內部 HeatmapStream 已
  // 以 endpoint 為 key，重設自然發生），因此後者不得再掛同一把 key。
  it("does not give sibling children the same key", async () => {
    const h = harness()
    const Page = h.load(`${root}page.tsx`).default
    const params = { group: "ent-be1", from: "2026-10-28", to: "2026-11-03" }
    const tree = await Page({ searchParams: Promise.resolve(params) })
    const siblings = children(tree)
    const keys = siblings.map((child) => child?.key).filter((key) => key !== undefined && key !== null)
    assert.equal(new Set(keys).size, keys.length, `duplicate sibling key among ${JSON.stringify(keys)}`)
    // 熱點圖仍必須渲染，且與表單同源（靠 endpoint 觸發重設）。
    assert.ok(named(tree, "WorkloadHeatmapClient"), "heatmap should still render")
    assert.equal(named(tree, "WorkloadHeatmapClient").props.jiraBaseUrl, "https://fixture.invalid")
    // 未掛 key 時此 JSX runtime 回報 null（而非 undefined），兩者同義。
    assert.ok(named(tree, "WorkloadHeatmapClient").key == null)
  })
})

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, it } from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
function load(path, mocks, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, globals)((name) => {
    if (name in mocks) return mocks[name]
    if (name === "react/jsx-runtime") return require(name)
    throw new Error(`Unexpected defaults UI import: ${name}`)
  }, mod, mod.exports)
  return mod.exports
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree?.props) return []
  return [tree, ...nodes(tree.props.children)]
}
const named = (tree, name) => nodes(tree).find((node) => node.type?.name === name)
const button = (tree, text) => nodes(tree).find((node) => node.type === "button" && node.props.children === text)
const event = () => ({ prevented: false, preventDefault() { this.prevented = true } })
const plain = (value) => JSON.parse(JSON.stringify(value))
const tick = () => new Promise((resolve) => queueMicrotask(resolve))
function hooks() {
  const values = []
  const effects = []
  let cursor = 0
  let changed = false
  const react = {
    ...React,
    useId: () => "defaults-fixture",
    useState(initial) {
      const index = cursor++
      if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial
      return [values[index], (next) => {
        const value = typeof next === "function" ? next(values[index]) : next
        if (!Object.is(values[index], value)) changed = true
        values[index] = value
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in values)) values[index] = { current: initial }
      return values[index]
    },
    useEffect(effect, dependencies) {
      const index = cursor++
      const previous = values[index]
      if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return
      const state = { dependencies, cleanup: undefined }
      values[index] = state
      effects.push(() => { previous?.cleanup?.(); state.cleanup = effect() })
    },
  }
  return {
    react,
    render(callback) {
      let tree
      let passes = 0
      do {
        changed = false
        cursor = 0
        tree = callback()
        if (++passes > 10) throw new Error("Render update loop")
      } while (changed)
      return tree
    },
    flush() { while (effects.length) effects.shift()() },
    unmount() { for (const value of values) value?.cleanup?.() },
  }
}
function harness({ defaults = { project: "SUN", groups: ["team-a"] }, ready = true } = {}) {
  const h = hooks()
  const listeners = new Map()
  const blockers = new Map()
  const confirmations = []
  const saved = []
  let closeCalls = 0
  let confirmResult = true
  let saveImplementation = async () => {}
  const provider = { defaults, ready, async saveDefaults(next) { saved.push(plain(next)); await saveImplementation(next) } }
  function EditDialog() {}
  function ProjectSelector() {}
  function TeamSelect() {}
  const setBlocked = (source, value) => { blockers.set(source, value) }
  const mod = load("../components/app-shell/filter-defaults-dialog.tsx", {
    react: h.react,
    "@/components/edit-dialog": { EditDialog },
    "@/components/project-selector": { ProjectSelector },
    "@/components/team-select": { TeamSelect },
    "@/components/filter-defaults-provider": { useFilterDefaults: () => provider },
    "@/components/navigation-blocker": { useNavigationBlocker: () => ({ setBlocked }) },
    "@/lib/filter-defaults": {
      EMPTY_FILTER_DEFAULTS: { project: null, groups: [] },
      normalizeFilterDefaults(value) { return { project: value.project, groups: [...new Set(value.groups)].sort() } },
    },
  }, {
    Error,
    window: {
      confirm(message) { confirmations.push(message); return confirmResult },
      addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener) },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
    },
  })
  return {
    ...h, provider, saved, confirmations,
    render: () => h.render(() => mod.FilterDefaultsDialog({ onClose: () => { closeCalls++ } })),
    dispatch(type, value) { for (const listener of listeners.get(type) ?? []) listener(value) },
    get closeCalls() { return closeCalls },
    get blocked() { return [...blockers.values()].some(Boolean) },
    get listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0) },
    setConfirm(value) { confirmResult = value },
    setSave(callback) { saveImplementation = callback },
  }
}

describe("filter defaults modal draft", () => {
  it("uses the small strict dialog and shared vertical selectors, with group-only defaults help", () => {
    const h = harness()
    const tree = h.render()
    h.flush()
    assert.equal(tree.type.name, "EditDialog")
    assert.equal(tree.props.title, "預設值設定")
    assert.equal(tree.props.size, "small")
    assert.equal(tree.props.iconClose, true)
    assert.equal(tree.props.description, "預設值只帶入之後進入頁面時尚未指定的條件")
    assert.equal(tree.props.fitContent, true)
    assert.equal(nodes(tree).some((node) => typeof node.props.children === "string" && /僅在同一瀏覽器|未選團隊表示/.test(node.props.children)), false)
    assert.equal(named(tree, "ProjectSelector").props.project, "SUN")
    assert.equal(typeof named(tree, "ProjectSelector").props.onClear, "function")
    assert.equal(named(tree, "TeamSelect").props.perMember, false)
    assert.match(named(tree, "TeamSelect").props.helpText, /預設值.*不設定個別成員排除/)
    const fieldset = nodes(tree).find((node) => node.type === "fieldset")
    assert.equal(fieldset.props.disabled, false)
    assert.doesNotMatch(fieldset.props.className, /min-h-/)
    const body = nodes(tree).find((node) => /overflow-y-auto/.test(node.props.className ?? ""))
    assert.ok(body)
    assert.doesNotMatch(body.props.className, /flex-1/)
    assert.ok(body.props.className.includes("[&_[id$='-options']]:static"), "Open dropdowns participate in compact content height rather than being clipped")
    assert.equal(h.blocked, false)
    assert.equal(h.listenerCount, 0)
  })
  it("disables edits/save until ready, then snapshots once without replacing later drafts", () => {
    const h = harness({ defaults: { project: null, groups: [] }, ready: false })
    let tree = h.render()
    h.flush()
    assert.equal(nodes(tree).find((node) => node.type === "fieldset").props.disabled, true)
    assert.equal(button(tree, "儲存").props.disabled, true)
    assert.ok(nodes(tree).some((node) => node.props.role === "status"))
    named(tree, "ProjectSelector").props.onProjectChange("TKK")
    button(tree, "儲存").props.onClick()
    assert.equal(h.saved.length, 0)
    h.provider.defaults = { project: "PRIDE", groups: ["team-b"] }
    h.provider.ready = true
    tree = h.render()
    h.flush()
    assert.equal(named(tree, "ProjectSelector").props.project, "PRIDE")
    assert.equal(button(tree, "儲存").props.disabled, false)
    named(tree, "ProjectSelector").props.onProjectChange("TKK")
    h.provider.defaults = { project: "SUN", groups: ["team-c"] }
    tree = h.render()
    h.flush()
    assert.equal(named(tree, "ProjectSelector").props.project, "TKK")
    assert.deepEqual(plain(named(tree, "TeamSelect").props.groups), ["team-b"])
    assert.equal(h.blocked, true)
    h.unmount()
    assert.equal(h.blocked, false)
  })
  it("closes clean drafts with either cancel or X without saving/confirmation", () => {
    for (const control of ["cancel", "close"]) {
      const h = harness()
      const tree = h.render()
      h.flush()
      if (control === "cancel") button(tree, "取消").props.onClick()
      else tree.props.onClose()
      assert.equal(h.closeCalls, 1)
      assert.equal(h.saved.length, 0)
      assert.equal(h.confirmations.length, 0)
      h.unmount()
    }
  })
  it("requires discard confirmation for cancel/X, preserves rejected drafts, and cleans guards", () => {
    for (const control of ["cancel", "close"]) {
      const h = harness()
      let tree = h.render()
      h.flush()
      named(tree, "ProjectSelector").props.onClear()
      tree = h.render()
      h.flush()
      assert.equal(named(tree, "ProjectSelector").props.project, null)
      assert.equal(h.blocked, true)
      assert.equal(h.listenerCount, 1)
      const unload = event()
      h.dispatch("beforeunload", unload)
      assert.equal(unload.prevented, true)
      assert.equal(unload.returnValue, "")
      h.setConfirm(false)
      if (control === "cancel") button(tree, "取消").props.onClick()
      else tree.props.onClose()
      assert.equal(h.closeCalls, 0)
      assert.match(h.confirmations[0], /尚未儲存.*放棄/)
      assert.equal(named(h.render(), "ProjectSelector").props.project, null)
      h.setConfirm(true)
      tree.props.onClose()
      assert.equal(h.closeCalls, 1)
      assert.equal(h.saved.length, 0)
      h.unmount()
      assert.equal(h.blocked, false)
      assert.equal(h.listenerCount, 0)
    }
  })
  it("normalizes group drafts and clears dirty guards after reverting to the opening snapshot", () => {
    const h = harness({ defaults: { project: "SUN", groups: ["team-a", "team-b"] } })
    let tree = h.render()
    h.flush()
    named(tree, "TeamSelect").props.onGroupsChange(["team-b", "team-a", "team-a"], [], false)
    tree = h.render()
    h.flush()
    assert.equal(h.blocked, false)
    named(tree, "ProjectSelector").props.onProjectChange("TKK")
    tree = h.render()
    h.flush()
    assert.equal(h.blocked, true)
    named(tree, "ProjectSelector").props.onProjectChange("SUN")
    h.render()
    h.flush()
    assert.equal(h.blocked, false)
    assert.equal(h.listenerCount, 0)
  })
  it("locks pending saves and explicit close, saves the draft snapshot once, then closes on success", async () => {
    const h = harness()
    let complete
    h.setSave(() => new Promise((resolve) => { complete = resolve }))
    let tree = h.render()
    h.flush()
    named(tree, "ProjectSelector").props.onClear()
    tree = h.render()
    h.flush()
    const stale = tree
    button(tree, "儲存").props.onClick()
    button(stale, "儲存").props.onClick()
    stale.props.onClose()
    named(stale, "ProjectSelector").props.onProjectChange("TKK")
    tree = h.render()
    h.flush()
    assert.equal(tree.props.busy, true)
    assert.equal(button(tree, "取消").props.disabled, true)
    assert.equal(button(tree, "儲存中…").props.disabled, true)
    assert.equal(nodes(tree).find((node) => node.type === "fieldset").props.disabled, true)
    named(tree, "TeamSelect").props.onGroupsChange(["team-b"], [], true)
    tree.props.onClose()
    assert.equal(h.closeCalls, 0)
    assert.deepEqual(h.saved, [{ project: null, groups: ["team-a"] }])
    assert.equal(h.listenerCount, 1)
    complete()
    await tick()
    await tick()
    h.render()
    h.flush()
    assert.equal(h.closeCalls, 1)
    assert.equal(h.blocked, false)
    assert.equal(h.listenerCount, 0)
    assert.equal(h.confirmations.length, 0)
  })
  it("retains the draft and inline storage error on failure, then supports a successful retry", async () => {
    const h = harness()
    h.setSave(async () => { throw new Error("瀏覽器無法保存，請允許儲存空間。") })
    let tree = h.render()
    h.flush()
    named(tree, "TeamSelect").props.onGroupsChange([], [], true)
    tree = h.render()
    h.flush()
    button(tree, "儲存").props.onClick()
    await tick()
    await tick()
    tree = h.render()
    h.flush()
    assert.equal(h.closeCalls, 0)
    assert.equal(tree.props.busy, false)
    assert.equal(h.blocked, true)
    assert.equal(h.listenerCount, 1)
    assert.deepEqual(plain(named(tree, "TeamSelect").props.groups), [])
    assert.equal(nodes(tree).find((node) => node.props.role === "alert").props.children, "瀏覽器無法保存，請允許儲存空間。")
    h.setSave(async () => {})
    button(tree, "儲存").props.onClick()
    await tick()
    await tick()
    tree = h.render()
    h.flush()
    assert.equal(h.closeCalls, 1)
    assert.equal(nodes(tree).some((node) => node.props.role === "alert"), false)
    assert.equal(h.blocked, false)
    assert.deepEqual(h.saved, [{ project: "SUN", groups: [] }, { project: "SUN", groups: [] }])
  })
  it("guards a clean draft while saving and does not call close after unmount", async () => {
    const h = harness()
    let complete
    h.setSave(() => new Promise((resolve) => { complete = resolve }))
    const tree = h.render()
    h.flush()
    button(tree, "儲存").props.onClick()
    h.render()
    h.flush()
    assert.equal(h.blocked, true)
    assert.equal(h.listenerCount, 1)
    h.unmount()
    complete()
    await tick()
    await tick()
    assert.equal(h.closeCalls, 0)
    assert.equal(h.blocked, false)
    assert.equal(h.listenerCount, 0)
  })
})

describe("shared defaults UI extensions", () => {
  it("keeps ProjectSelector non-null callbacks and adds a clear radio only for opt-in callers", () => {
    const h = hooks()
    function FilterDropdown() {}
    const projects = [{ key: "SUN", label: "Sun" }, { key: "TKK", label: "TKK" }, { key: "PRIDE", label: "Pride" }]
    const mod = load("../components/project-selector.tsx", {
      react: h.react,
      "@/components/filter-dropdown": { FilterDropdown },
      "@/lib/jira-jql": { SPRINT_PROJECTS: projects },
    })
    const changes = []
    let clears = 0
    const render = (props = {}) => h.render(() => mod.ProjectSelector({ project: "SUN", onProjectChange: (next) => changes.push(next), ...props }))
    let tree = render()
    assert.equal(nodes(tree).filter((node) => node.props.role === "radio").length, 3)
    assert.equal(named(tree, "FilterDropdown").props.kind, "project")
    assert.equal(named(tree, "FilterDropdown").props.className, undefined)
    const onClear = () => { clears++ }
    tree = render({ onClear })
    named(tree, "FilterDropdown").props.onOpenChange(true)
    tree = render({ onClear })
    const choices = nodes(tree).filter((node) => node.props.role === "radio")
    assert.equal(choices.length, 4)
    assert.equal(choices[0].props.children[1].props.children, "不設定預設專案")
    assert.equal(choices[0].props["aria-checked"], false)
    choices[0].props.onClick()
    assert.equal(clears, 1)
    assert.equal(named(render({ onClear, project: null }), "FilterDropdown").props.open, false)
    assert.equal(nodes(render({ onClear, project: null })).find((node) => node.props.role === "radio").props["aria-checked"], true)
    choices[1].props.onClick()
    assert.deepEqual(changes, [])
    choices[2].props.onClick()
    assert.deepEqual(changes, ["TKK"])
  })
  it("preserves default large modal styling, mobile layout, strict closing, focus and scroll cleanup", () => {
    for (const [size, width, fitContent] of [[undefined, "md:max-w-6xl", undefined], ["large", "md:max-w-6xl", false], ["small", "md:max-w-lg", false], ["small", "md:max-w-lg", true]]) {
      const h = hooks()
      let closeCalls = 0
      const document = { activeElement: null, body: { style: { overflow: "scroll" } } }
      class HTMLElement {
        isConnected = true
        focused = 0
        focus() { this.focused++; document.activeElement = this }
      }
      const avatar = new HTMLElement()
      document.activeElement = avatar
      const native = { shown: 0, closed: 0, showModal() { this.shown++ }, close() { this.closed++ } }
      const mod = load("../components/edit-dialog.tsx", { react: h.react }, { document, HTMLElement })
      const render = (busy = false) => h.render(() => mod.EditDialog({ title: "Fixture", description: "Fixture description", size, fitContent, busy, onClose: () => { closeCalls++ }, children: "body" }))
      let tree = render()
      tree.props.ref.current = native
      h.flush()
      assert.equal(native.shown, 1)
      assert.equal(document.body.style.overflow, "hidden")
      assert.equal(tree.props["aria-modal"], "true")
      assert.ok(tree.props["aria-labelledby"])
      assert.ok(tree.props.className.includes(width))
      if (fitContent) {
        assert.match(tree.props.className, /m-auto h-fit max-h-\[90dvh\].*w-full/)
        assert.ok(tree.props.className.split(/\s+/).includes("md:h-fit"))
        assert.equal(tree.props.className.split(/\s+/).some((value) => ["h-dvh", "h-auto", "md:h-auto"].includes(value)), false, "Fixed inset must not stretch the content-height variant")
      } else {
        assert.match(tree.props.className, /h-dvh.*w-full.*overflow-hidden/)
        assert.ok(tree.props.className.split(/\s+/).includes("md:h-auto"))
      }
      assert.match(tree.props.className, /md:max-h-\[90dvh\]/)
      assert.match(tree.props.className, /dark:bg-slate-900 dark:text-white/)
      const escape = event()
      tree.props.onCancel(escape)
      assert.equal(escape.prevented, true)
      assert.equal(closeCalls, 0)
      assert.equal(tree.props.onClick, undefined, "Backdrop has no dismissal handler")
      tree = render(true)
      assert.equal(nodes(tree).find((node) => node.props["aria-label"] === "關閉").props.disabled, true)
      h.unmount()
      assert.equal(native.closed, 1)
      assert.equal(document.body.style.overflow, "scroll")
      assert.equal(avatar.focused, 1)
    }
  })
  it("retains central selector widths and narrow-container clamp rather than modal-specific overrides", () => {
    const source = readFileSync(new URL("../components/filter-dropdown.tsx", import.meta.url), "utf8")
    const dialog = readFileSync(new URL("../components/app-shell/filter-defaults-dialog.tsx", import.meta.url), "utf8")
    assert.match(source, /team: "w-56 max-w-full min-w-0 shrink-0"/)
    assert.match(source, /project: "w-40 max-w-full min-w-0 shrink-0"/)
    assert.match(source, /top-full[^\n]*w-full[^\n]*overflow-y-auto/)
    assert.doesNotMatch(dialog, /w-40|w-56|widthClass|width=/)
  })
})

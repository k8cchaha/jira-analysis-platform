import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, it } from "node:test"
import vm from "node:vm"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const source = readFileSync(new URL("../components/app-shell/account-menu.tsx", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree?.props) return []
  return [tree, ...nodes(tree.props.children)]
}
function event(key, extra = {}) {
  return { key, prevented: false, preventDefault() { this.prevented = true }, ...extra }
}
function harness() {
  const values = []
  const effects = []
  const listeners = new Map()
  const confirmations = []
  let cursor = 0
  let blocked = false
  let confirmResult = true
  let logoutCalls = 0
  let modalOpen = false
  const logout = async () => { logoutCalls++ }
  const document = {
    activeElement: null,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
  }
  class Node {
    constructor(label) { this.label = label }
    focus() { if (!modalOpen || this !== triggerNode) document.activeElement = this }
  }
  const triggerNode = new Node("trigger")
  const defaultsNode = new Node("defaults")
  const logoutNode = new Node("logout")
  const wrapperNode = new Node("wrapper")
  wrapperNode.contains = (target) => [wrapperNode, triggerNode, defaultsNode, logoutNode].includes(target)
  const react = {
    ...require("react"),
    useId: () => "account-fixture",
    useState(initial) {
      const index = cursor++
      if (!(index in values)) values[index] = initial
      return [values[index], (next) => { values[index] = next }]
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
  const sandbox = vm.createContext({
    document, Node,
    window: { confirm(message) { confirmations.push(message); return confirmResult } },
  })
  const mod = { exports: {} }
  const fixtureRequire = (name) => {
    if (name === "react") return react
    if (name === "react/jsx-runtime") return require(name)
    if (name === "@/components/app-shell/logout-action") return { logout }
    if (name === "@/components/navigation-blocker") return { useNavigationBlocker: () => ({ isBlocked: blocked }) }
    if (name === "@/components/app-shell/icons") return { NavigationIconGlyph: (props) => require("react").createElement("svg", { "aria-hidden": true, "data-icon": props.name }) }
    if (name === "@/components/app-shell/filter-defaults-dialog") return { FilterDefaultsDialog: (props) => require("react").createElement("dialog", props) }
    throw new Error(`Unexpected account menu import: ${name}`)
  }
  vm.runInContext(`(function(require,module,exports){${compiled}\n})`, sandbox)(fixtureRequire, mod, mod.exports)
  function render(user = { name: "Fixture User" }) {
    cursor = 0
    const tree = mod.exports.AccountMenu({ user })
    modalOpen = nodes(tree).some((node) => node.type?.name === "FilterDefaultsDialog")
    tree.props.ref.current = wrapperNode
    nodes(tree).find((node) => node.props["aria-haspopup"] === "menu").props.ref.current = triggerNode
    const items = nodes(tree).filter((node) => node.props.role === "menuitem")
    items[0]?.props.ref(defaultsNode)
    items[1]?.props.ref(logoutNode)
    return tree
  }
  return {
    render, logout, confirmations, document, triggerNode, defaultsNode, logoutNode,
    outsideNode: new Node("outside"),
    flush() { while (effects.length) effects.shift()() },
    unmount() { for (const value of values) value?.cleanup?.() },
    dispatch(type, value) { for (const listener of [...listeners.get(type) ?? []]) listener(value) },
    get listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0) },
    get logoutCalls() { return logoutCalls },
    setBlocked(value) { blocked = value },
    setConfirm(value) { confirmResult = value },
  }
}
const trigger = (tree) => nodes(tree).find((node) => node.props["aria-haspopup"] === "menu")
const menu = (tree) => nodes(tree).find((node) => node.props.role === "menu")
const items = (tree) => nodes(tree).filter((node) => node.props.role === "menuitem")
function open(h, key) {
  const tree = h.render()
  if (key) trigger(tree).props.onKeyDown(event(key))
  else trigger(tree).props.onClick()
  const opened = h.render()
  h.flush()
  return opened
}

describe("account avatar dropdown", () => {
  it("starts closed with an accessible 36px avatar and preserves image/initials fallbacks", () => {
    const h = harness()
    for (const [user, expected] of [[{ name: "Fixture User" }, "FU"], [{ name: "  " }, "U"], [{ name: "Single" }, "S"]]) {
      const tree = h.render(user)
      const button = trigger(tree)
      assert.equal(button.props["aria-label"], "帳號選單")
      assert.equal(button.props["aria-expanded"], false)
      assert.equal(button.props.type, "button")
      assert.match(button.props.className, /h-9 w-9/)
      assert.equal(button.props.children, expected)
      assert.equal(menu(tree), undefined)
      assert.equal(nodes(tree).some((node) => node.type === "form"), false)
    }
    const image = nodes(h.render({ name: "Fixture", image: "/fixture-avatar.png" })).find((node) => node.type === "img")
    assert.equal(image.props.src, "/fixture-avatar.png")
    assert.equal(image.props.alt, "")
  })
  it("renders enabled defaults with settings icon, separator, and red icon/text logout in the requested order", () => {
    const h = harness()
    const tree = open(h)
    const panel = menu(tree)
    const [defaults, separator, form] = panel.props.children
    assert.match(renderToStaticMarkup(defaults), /預設值設定/)
    assert.match(renderToStaticMarkup(defaults), /data-icon="settings"/)
    assert.equal(defaults.props.children[0].props.name, "settings")
    assert.equal(defaults.props["aria-disabled"], undefined)
    assert.equal(defaults.props.disabled, undefined)
    assert.equal(defaults.props.title, undefined)
    assert.match(defaults.props.className, /cursor-pointer/)
    assert.match(defaults.props.className, /dark:text-slate-200/)
    assert.equal(separator.props.role, "separator")
    assert.equal(form.type, "form")
    assert.equal(form.props.action, h.logout)
    assert.equal(form.props.children.props.type, "submit")
    assert.equal(form.props.children.props.role, "menuitem")
    assert.match(form.props.children.props.className, /text-rose-600/)
    assert.match(form.props.children.props.className, /dark:text-rose-400/)
    const icon = nodes(form).find((node) => node.type === "svg")
    assert.equal(icon.props["aria-hidden"], "true")
    assert.equal(icon.props.stroke, "currentColor")
    assert.match(renderToStaticMarkup(form.props.children), /登出/)
    assert.equal(panel.props["aria-labelledby"], trigger(tree).props.id)
    assert.equal(trigger(tree).props["aria-controls"], panel.props.id)
    assert.match(panel.props.className, /top-full right-0/)
    assert.match(panel.props.className, /max-w-\[calc\(100vw-2rem\)\]/)
    assert.equal(h.listenerCount, 3)
    assert.equal(h.document.activeElement, h.defaultsNode)
  })
  it("closes the menu before opening defaults and restores avatar focus on dialog close", () => {
    const h = harness()
    const tree = open(h)
    items(tree)[0].props.onClick()
    const opened = h.render()
    h.flush()
    assert.equal(menu(opened), undefined)
    assert.equal(trigger(opened).props["aria-expanded"], false)
    assert.equal(h.listenerCount, 0)
    const dialog = nodes(opened).find((node) => node.type.name === "FilterDefaultsDialog")
    assert.ok(dialog)
    dialog.props.onClose()
    const closed = h.render()
    h.flush()
    assert.equal(nodes(closed).some((node) => node.type.name === "FilterDefaultsDialog"), false)
    assert.equal(h.document.activeElement, h.triggerNode)
    assert.equal(h.logoutCalls, 0)
    assert.ok(menu(open(h)), "The account menu remains usable after closing defaults")
    h.unmount()
    assert.equal(h.listenerCount, 0)
  })
  it("toggles from the avatar, cleans up listeners, and does not sign out on opening", () => {
    const h = harness()
    const tree = open(h)
    trigger(tree).props.onClick()
    const closed = h.render()
    h.flush()
    assert.equal(menu(closed), undefined)
    assert.equal(h.listenerCount, 0)
    assert.equal(h.logoutCalls, 0)
  })
  for (const [key, last] of [["ArrowDown", false], ["ArrowUp", true]]) it(`opens with ${key} at the correct menu item`, () => {
    const h = harness()
    const tree = open(h, key)
    assert.equal(trigger(tree).props["aria-expanded"], true)
    assert.equal(h.document.activeElement, last ? h.logoutNode : h.defaultsNode)
    const opposite = last ? "ArrowDown" : "ArrowUp"
    trigger(tree).props.onKeyDown(event(opposite))
    assert.equal(h.document.activeElement, last ? h.defaultsNode : h.logoutNode)
  })
  it("leaves Enter/Space native button activation intact", () => {
    for (const key of ["Enter", " "]) {
      const h = harness()
      const tree = h.render()
      const keydown = event(key)
      trigger(tree).props.onKeyDown(keydown)
      assert.equal(keydown.prevented, false)
      // Simulate the click generated by native button activation; not a browser test.
      trigger(tree).props.onClick()
      assert.ok(menu(h.render()))
      h.flush()
      h.unmount()
      assert.equal(h.listenerCount, 0)
    }
  })
  it("reopens without accumulating listeners and removes them on unmount", () => {
    const h = harness()
    let tree = open(h)
    for (let i = 0; i < 3; i++) {
      trigger(tree).props.onClick()
      h.render()
      h.flush()
      assert.equal(h.listenerCount, 0)
      tree = open(h)
      assert.equal(h.listenerCount, 3)
    }
    h.unmount()
    assert.equal(h.listenerCount, 0)
  })
  it("supports item navigation and lets Tab leave without a focus trap", () => {
    const h = harness()
    const tree = open(h)
    for (const [key, target] of [["ArrowDown", h.logoutNode], ["ArrowDown", h.defaultsNode], ["ArrowUp", h.logoutNode], ["Home", h.defaultsNode], ["End", h.logoutNode], ["預", h.defaultsNode], ["登", h.logoutNode]]) {
      const keydown = event(key)
      menu(tree).props.onKeyDown(keydown)
      assert.equal(keydown.prevented, true)
      assert.equal(h.document.activeElement, target)
    }
    for (const shiftKey of [false, true]) {
      const tab = event("Tab", { shiftKey })
      menu(tree).props.onKeyDown(tab)
      assert.equal(tab.prevented, false)
    }
    assert.ok(items(tree).every((item) => item.props.tabIndex === -1))
  })
  it("closes on Escape and restores avatar focus", () => {
    const h = harness()
    open(h)
    const escape = event("Escape")
    h.dispatch("keydown", escape)
    const closed = h.render()
    h.flush()
    assert.equal(escape.prevented, true)
    assert.equal(menu(closed), undefined)
    assert.equal(h.document.activeElement, h.triggerNode)
    assert.equal(h.listenerCount, 0)
  })
  for (const type of ["pointerdown", "focusin"]) it(`dismisses only outside ${type}, without stealing focus`, () => {
    const h = harness()
    open(h)
    h.dispatch(type, { target: h.defaultsNode })
    let tree = h.render()
    h.flush()
    assert.ok(menu(tree))
    h.outsideNode.focus()
    h.dispatch(type, { target: h.outsideNode })
    tree = h.render()
    h.flush()
    assert.equal(menu(tree), undefined)
    assert.equal(h.document.activeElement, h.outsideNode)
    assert.equal(h.listenerCount, 0)
  })
  for (const [blocked, confirmed, prevented] of [[false, false, false], [true, false, true], [true, true, false]]) it(`retains logout server form with blocker=${blocked}, confirm=${confirmed}`, () => {
    const h = harness()
    h.setBlocked(blocked)
    h.setConfirm(confirmed)
    const tree = open(h)
    const form = nodes(tree).find((node) => node.type === "form")
    const submit = event()
    form.props.onSubmit(submit)
    assert.equal(submit.prevented, prevented)
    assert.equal(h.confirmations.length, blocked ? 1 : 0)
    if (blocked) assert.equal(h.confirmations[0], "你有尚未儲存的變更，確定要離開此頁面嗎？")
    assert.equal(form.props.action, h.logout)
    assert.ok(menu(h.render()), "Form must not unmount before its server action is dispatched")
    assert.equal(h.logoutCalls, 0)
  })
  it("integrates one route-keyed account menu and removes the standalone logout from AppShell", () => {
    const shell = readFileSync(new URL("../components/app-shell/app-shell.tsx", import.meta.url), "utf8")
    assert.equal((shell.match(/<AccountMenu\b/g) ?? []).length, 1)
    assert.match(shell, /<AccountMenu key=\{pathname\} user=\{user\} \/>/)
    assert.doesNotMatch(shell, /<form action=\{logout\}|logout-action|aria-label="登出"/)
    assert.match(shell, /\{user.name\}/)
    assert.match(shell, /\{user.email\}/)
  })
})

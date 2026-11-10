import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, normalize } from "node:path"
import vm from "node:vm"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const root = new URL("../", import.meta.url)
const base = "app/(app)/settings/system/"
const compiled = new Map()
const names = ["ATLASSIAN_PAT", "AUTH_ATLASSIAN_SECRET", "AUTH_SECRET", "AUTH_ATLASSIAN_ID", "AUTH_URL", "ATLASSIAN_JIRA_CLOUD_URL"]
const secrets = names.slice(0, 3)
const plain = (value) => JSON.parse(JSON.stringify(value))
const fixture = () => Object.fromEntries(names.map((name) => [name, `synthetic-${name}-value`]))
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

// Exact source whitelist, mock auth and isolated synthetic process.env; never load actual auth or credential files.
function harness({ env = fixture(), session, authError = false, action } = {}) {
  const allowed = new Set([...['environment.ts', 'environment-server.ts', 'actions.ts', 'environment-diagnostics.tsx', 'page.tsx'].map((file) => base + file), "components/app-shell/navigation.ts", "components/page-header.tsx"])
  const modules = new Map()
  const reads = []
  const logs = []
  const calls = []
  const tasks = []
  const events = { document: new Map(), window: new Map() }
  const hooks = []
  const effects = []
  let cursor = 0
  let rendering = false
  let unmounted = false
  let updatesAfterUnmount = 0
  let authCalls = 0
  let connections = 0
  let visibility = "visible"
  let currentSession = session
  let currentAuthError = authError
  const fail = (message) => { throw new Error(message) }
  const eventTarget = (kind) => ({
    addEventListener(name, callback) { const set = events[kind].get(name) ?? new Set(); set.add(callback); events[kind].set(name, set) },
    removeEventListener(name, callback) { events[kind].get(name)?.delete(callback) },
  })
  const doc = { ...eventTarget("document"), get visibilityState() { return visibility } }
  const dependencyEqual = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const react = {
    ...require("react"),
    useState(initial) {
      if (!rendering) return [initial, () => fail("Unexpected SSR state update")]
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], (value) => { if (unmounted) updatesAfterUnmount++; hooks[index] = typeof value === "function" ? value(hooks[index]) : value }]
    },
    useRef(initial) {
      if (!rendering) return { current: initial }
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    useCallback(callback, deps) {
      if (!rendering) return callback
      const index = cursor++
      if (!dependencyEqual(hooks[index]?.deps, deps)) hooks[index] = { deps, callback }
      return hooks[index].callback
    },
    useEffect(callback, deps) {
      if (!rendering) return
      const index = cursor++
      if (!dependencyEqual(hooks[index]?.deps, deps)) effects.push(() => {
        hooks[index]?.cleanup?.()
        hooks[index] = { deps, cleanup: callback() }
      })
    },
    useTransition: () => [false, (callback) => { tasks.push(callback()) }],
  }
  const sandbox = vm.createContext({
    Error, document: doc, window: eventTarget("window"),
    process: { env: new Proxy(env, {
      get(target, key) { reads.push(key); if (!names.includes(key)) return fail("Unexpected diagnostic key"); return target[key] },
      ownKeys: () => fail("Do not enumerate process.env"),
    }) },
    console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    fetch: () => fail("No live request permitted"),
    localStorage: new Proxy({}, { get: () => fail("No browser storage permitted") }),
    sessionStorage: new Proxy({}, { get: () => fail("No browser storage permitted") }),
  })
  function load(path) {
    if (!allowed.has(path)) return fail(`Unexpected source: ${path}`)
    if (modules.has(path)) return modules.get(path).exports
    const mod = { exports: {} }
    modules.set(path, mod)
    if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText)
    const fixtureRequire = (name) => {
      if (name === "server-only") return {}
      if (name === "@/auth") return { auth: async () => { authCalls++; if (currentAuthError) throw new Error("synthetic-auth-error-secret"); return currentSession } }
      if (name === "next/server") return { connection: async () => { connections++ } }
      if (name === "react") return react
      if (name === "react/jsx-runtime") return require(name)
      if (path.endsWith("environment-diagnostics.tsx") && name === "./actions") return { revealEnvironmentSecretAction: async (key) => {
        calls.push(key)
        return action ? action(key) : load(base + "actions.ts").revealEnvironmentSecretAction(key)
      } }
      const target = name.startsWith("@/") ? name.slice(2) : name.startsWith("./") ? normalize(`${dirname(path)}/${name}`) : fail(`Unexpected import: ${name}`)
      const resolved = [...allowed].find((file) => file === `${target}.ts` || file === `${target}.tsx`)
      return load(resolved ?? target)
    }
    vm.runInContext(`(function(require,module,exports){${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, mod, mod.exports)
    return mod.exports
  }
  if (session === undefined) currentSession = { user: { id: "synthetic-admin", email: load("components/app-shell/navigation.ts").ADMIN_EMAILS[0] } }
  return {
    env, reads, logs, calls, load,
    get authCalls() { return authCalls }, get connections() { return connections }, get updatesAfterUnmount() { return updatesAfterUnmount },
    setSession(value) { currentSession = value }, setAuthError(value) { currentAuthError = value },
    summary: () => load(base + "environment-server.ts").readEnvironmentSummary(),
    reveal: (key) => load(base + "actions.ts").revealEnvironmentSecretAction(key),
    page: () => load(base + "page.tsx").default(),
    invoke(entries) {
      cursor = 0; rendering = true
      try { return load(base + "environment-diagnostics.tsx").EnvironmentDiagnostics({ entries }) }
      finally { rendering = false; while (effects.length) effects.shift()() }
    },
    flush: async () => { await Promise.all(tasks.splice(0)) },
    emit(kind, name) { for (const listener of events[kind].get(name) ?? []) listener() },
    setVisibility(value) { visibility = value; for (const listener of events.document.get("visibilitychange") ?? []) listener() },
    unmount() { unmounted = true; for (const hook of hooks) hook?.cleanup?.() },
  }
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree?.props) return []
  return [tree, ...nodes(tree.props.children)]
}
const text = (tree) => renderToStaticMarkup(tree)
const row = (tree, name) => nodes(tree).find((node) => node.type === "div" && node.key === name)
const button = (tree, label) => nodes(tree).find((node) => node.type === "button" && node.props.children === label)
const show = (tree, name) => nodes(row(tree, name)).find((node) => node.props["aria-label"] === `顯示 ${name}`)
const clientEntries = () => names.map((name, index) => ({ name, sensitive: index < 3, purpose: "Synthetic purpose", state: "set", value: index < 3 ? null : `public-${name}` }))
const success = (name, value) => ({ ok: true, name, state: value === null ? "unset" : value === "" ? "empty" : "set", value })

// Unit simulations, not a browser or Next HTTP integration run.
describe("system environment server boundary", () => {
  for (const [label, session, authError] of [
    ["unauthenticated", null], ["non-admin", { user: { id: "a", email: "member@example.com" } }],
    ["missing ID", { user: { email: "admin-placeholder" } }], ["blank ID", { user: { id: " " } }],
    ["malformed ID", { user: { id: 42 } }], ["missing user", {}], ["auth throws", null, true],
  ]) it(`${label} cannot read diagnostics through page or action`, async () => {
    const h = harness({ session, authError })
    assert.equal(await h.summary(), null)
    assert.equal((await h.reveal("AUTH_SECRET")).ok, false)
    const markup = text(await h.page())
    assert.match(markup, /無權查看/)
    assert.doesNotMatch(markup, /synthetic-auth-error-secret|synthetic-AUTH_SECRET-value/)
    assert.deepEqual(h.reads, [])
    assert.deepEqual(h.logs, [])
  })
  it("rejects authorization error even for an allowed admin and rejects missing admin ID", async () => {
    const h = harness()
    const email = h.load("components/app-shell/navigation.ts").ADMIN_EMAILS[0]
    for (const session of [{ user: { id: "admin", email }, jiraAuthorizationError: "refresh_failed" }, { user: { email } }, { user: { id: "", email } }, { user: { id: "admin", email: null } }]) {
      h.setSession(session)
      assert.equal(await h.summary(), null)
      assert.equal((await h.reveal("AUTH_SECRET")).ok, false)
    }
    assert.deepEqual(h.reads, [])
  })
  it("serializes only six safe entries and no sensitive value, prefix or length in initial DTO/page/SSR", async () => {
    const h = harness()
    assert.deepEqual(h.reads, [], "module loading must not read env")
    const summary = await h.summary()
    assert.deepEqual(Array.from(summary, (entry) => entry.name), names)
    for (const entry of summary) assert.equal(entry.value, entry.sensitive ? null : h.env[entry.name])
    for (const secret of secrets) assert.ok(!JSON.stringify(summary).includes(h.env[secret]))
    const page = await h.page()
    assert.equal(h.connections, 1)
    const markup = text(page)
    assert.equal((markup.match(/<h1\b/g) ?? []).length, 1)
    assert.match(markup, /已遮蔽/)
    for (const secret of secrets) assert.ok(!markup.includes(h.env[secret]))
    for (const name of names.slice(3)) assert.ok(markup.includes(h.env[name]))
    assert.deepEqual(h.logs, [])
  })
  it("uses normalized session email and reauthorizes each request without trusting client identity", async () => {
    const h = harness()
    const email = h.load("components/app-shell/navigation.ts").ADMIN_EMAILS[0]
    h.setSession({ user: { id: "admin", email: ` ${email.toUpperCase()} ` } })
    assert.equal((await h.reveal("AUTH_SECRET")).ok, true)
    h.setSession({ user: { id: "member", email: "member@example.com" } })
    assert.equal((await h.reveal({ name: "AUTH_SECRET", email })).ok, false)
    assert.equal((await h.reveal("AUTH_SECRET")).ok, false)
    assert.deepEqual(h.reads, ["AUTH_SECRET"])
    assert.equal(h.authCalls, 3)
  })
  it("rejects arbitrary/extra/non-sensitive keys and objects before any env read", async () => {
    const h = harness()
    for (const key of ["PATH", "NEXT_PUBLIC_SECRET", "AUTH_SECRET ", "auth_secret", ...names.slice(3), null, undefined, [], {}, { name: "AUTH_SECRET" }, ["AUTH_SECRET"]]) {
      assert.equal((await h.reveal(key)).ok, false)
    }
    assert.deepEqual(h.reads, [])
    assert.deepEqual(h.logs, [])
  })
  it("reads only the requested secret and picks up runtime changes, missing and empty values", async () => {
    const h = harness()
    for (const secret of secrets) assert.deepEqual(plain(await h.reveal(secret)), success(secret, h.env[secret]))
    assert.deepEqual(h.reads, secrets)
    h.env.AUTH_SECRET = "new-synthetic-value"
    assert.equal((await h.reveal("AUTH_SECRET")).value, "new-synthetic-value")
    h.env.AUTH_SECRET = ""
    delete h.env.ATLASSIAN_PAT
    h.env.AUTH_URL = ""
    delete h.env.AUTH_ATLASSIAN_ID
    const summary = await h.summary()
    assert.deepEqual(plain(summary.find((entry) => entry.name === "AUTH_SECRET")), { ...plain(h.load(base + "environment.ts").ENVIRONMENT_FIELDS[2]), state: "empty", value: null })
    assert.equal(summary[0].state, "unset")
    assert.equal(summary[3].state, "unset")
    assert.equal(summary[3].value, null)
    assert.equal(summary[4].state, "empty")
    assert.equal(summary[4].value, "")
    assert.deepEqual(plain(await h.reveal("AUTH_SECRET")), success("AUTH_SECRET", ""))
    assert.deepEqual(plain(await h.reveal("ATLASSIAN_PAT")), success("ATLASSIAN_PAT", null))
  })
})

describe("system environment reveal client", () => {
  it("requires explicit confirmation and hides all sensitive values by default", async () => {
    const h = harness()
    const entries = clientEntries()
    let tree = h.invoke(entries)
    show(tree, "AUTH_SECRET").props.onClick()
    tree = h.invoke(entries)
    assert.match(text(tree), /確認將 AUTH_SECRET/)
    assert.deepEqual(h.calls, [])
    button(tree, "取消").props.onClick()
    tree = h.invoke(entries)
    assert.deepEqual(h.calls, [])
    assert.equal(button(tree, "確認顯示"), undefined)
    show(tree, "AUTH_SECRET").props.onClick()
    tree = h.invoke(entries)
    const confirm = button(tree, "確認顯示").props.onClick
    confirm(); confirm()
    assert.deepEqual(h.calls, ["AUTH_SECRET"], "duplicate confirmation is ignored synchronously")
    assert.match(text(h.invoke(entries)), /讀取中/)
    await h.flush()
    tree = h.invoke(entries)
    assert.ok(text(tree).includes(h.env.AUTH_SECRET))
    button(tree, "隱藏／清除").props.onClick()
    assert.ok(!text(h.invoke(entries)).includes(h.env.AUTH_SECRET))
  })
  it("does not restore a late response after hiding while pending", async () => {
    const response = deferred()
    const h = harness({ action: () => response.promise })
    const entries = clientEntries()
    let tree = h.invoke(entries)
    show(tree, "AUTH_SECRET").props.onClick()
    button(h.invoke(entries), "確認顯示").props.onClick()
    tree = h.invoke(entries)
    button(tree, "隱藏／清除").props.onClick()
    response.resolve(success("AUTH_SECRET", "late-synthetic-secret"))
    await h.flush()
    tree = h.invoke(entries)
    assert.doesNotMatch(text(tree), /late-synthetic-secret|讀取中/)
    assert.ok(show(tree, "AUTH_SECRET"))
  })
  it("clears an old selection, ignores its stale confirm and discards its late response", async () => {
    const responses = [deferred(), deferred()]
    const h = harness({ action: (name) => responses[name === "AUTH_SECRET" ? 0 : 1].promise })
    const entries = clientEntries()
    show(h.invoke(entries), "AUTH_SECRET").props.onClick()
    const oldConfirm = button(h.invoke(entries), "確認顯示").props.onClick
    oldConfirm()
    show(h.invoke(entries), "ATLASSIAN_PAT").props.onClick()
    oldConfirm()
    assert.deepEqual(h.calls, ["AUTH_SECRET"])
    button(h.invoke(entries), "確認顯示").props.onClick()
    responses[1].resolve(success("ATLASSIAN_PAT", "current-synthetic-secret"))
    responses[0].resolve(success("AUTH_SECRET", "obsolete-synthetic-secret"))
    await h.flush()
    const markup = text(h.invoke(entries))
    assert.match(markup, /current-synthetic-secret/)
    assert.doesNotMatch(markup, /obsolete-synthetic-secret/)
  })
  for (const event of ["tab hidden", "pagehide", "unmount"]) it(`ignores pending response after ${event}`, async () => {
    const response = deferred()
    const h = harness({ action: () => response.promise })
    const entries = clientEntries()
    show(h.invoke(entries), "AUTH_SECRET").props.onClick()
    button(h.invoke(entries), "確認顯示").props.onClick()
    if (event === "tab hidden") h.setVisibility("hidden")
    else if (event === "pagehide") h.emit("window", "pagehide")
    else h.unmount()
    response.resolve(success("AUTH_SECRET", "late-hidden-synthetic-secret"))
    await h.flush()
    assert.equal(h.updatesAfterUnmount, 0)
    if (event !== "unmount") {
      h.setVisibility("visible")
      assert.doesNotMatch(text(h.invoke(entries)), /late-hidden-synthetic-secret/)
    }
  })
  it("clears a displayed secret on tab hide and cannot confirm a stale hidden dialog", async () => {
    const h = harness()
    const entries = clientEntries()
    show(h.invoke(entries), "AUTH_SECRET").props.onClick()
    const confirm = button(h.invoke(entries), "確認顯示").props.onClick
    confirm()
    await h.flush()
    assert.ok(text(h.invoke(entries)).includes(h.env.AUTH_SECRET))
    h.setVisibility("hidden")
    confirm()
    h.setVisibility("visible")
    assert.ok(!text(h.invoke(entries)).includes(h.env.AUTH_SECRET))
    assert.equal(h.calls.length, 1)
  })
  for (const [label, action] of [
    ["server denies", async () => ({ ok: false, message: "無權查看環境值" })],
    ["request throws", async () => { throw new Error("synthetic-transport-secret") }],
    ["wrong name", async () => success("ATLASSIAN_PAT", "wrong-synthetic-secret")],
  ]) it(`${label} shows a controlled error without leaking thrown values`, async () => {
    const h = harness({ action })
    const entries = clientEntries()
    show(h.invoke(entries), "AUTH_SECRET").props.onClick()
    button(h.invoke(entries), "確認顯示").props.onClick()
    await h.flush()
    const tree = h.invoke(entries)
    assert.ok(nodes(tree).some((node) => node.props.role === "alert"))
    assert.doesNotMatch(text(tree), /synthetic-transport-secret|wrong-synthetic-secret/)
    assert.deepEqual(h.logs, [])
  })
  it("escapes long text, preserves whitespace, and shows changed empty/unset states", async () => {
    let value = '<script>alert("synthetic")</script>\n' + "x".repeat(4096)
    const h = harness({ action: async (name) => success(name, value) })
    const entries = clientEntries()
    entries[3].value = '<img src=x onerror="synthetic">'
    for (const next of [value, "", null]) {
      value = next
      show(h.invoke(entries), "AUTH_SECRET").props.onClick()
      button(h.invoke(entries), "確認顯示").props.onClick()
      await h.flush()
      const tree = h.invoke(entries)
      const markup = text(tree)
      assert.doesNotMatch(markup, /<script>|<img/)
      assert.match(markup, /whitespace-pre-wrap break-all/)
      assert.match(markup, /min-w-0/)
      assert.match(markup, /&lt;img/)
      assert.match(text(row(tree, "AUTH_SECRET")), next === null ? /未設定/ : next === "" ? /空字串/ : /&lt;script/)
      button(tree, "隱藏／清除").props.onClick()
    }
  })
})

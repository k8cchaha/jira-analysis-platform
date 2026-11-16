import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const root = new URL("../", import.meta.url)

function loadPage(path) {
  const allowed = new Set([path, "components/page-header.tsx"])
  const modules = new Map()
  const fail = (message) => { throw new Error(message) }
  const sandbox = vm.createContext({
    process: new Proxy({}, { get: () => fail("Settings pages must not read environment values") }),
    fetch: () => fail("Settings pages must not request data"),
  })
  function load(file) {
    if (!allowed.has(file)) return fail(`Unexpected source: ${file}`)
    if (modules.has(file)) return modules.get(file).exports
    const mod = { exports: {} }
    modules.set(file, mod)
    const code = ts.transpileModule(readFileSync(new URL(file, root), "utf8"), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    const fixtureRequire = (name) => {
      if (name === "react/jsx-runtime") return require(name)
      if (name === "@/components/page-header") return load("components/page-header.tsx")
      return fail(`Unexpected import: ${name}`)
    }
    vm.runInContext(`(function(require,module,exports){${code}\n})`, sandbox, { filename: file })(fixtureRequire, mod, mod.exports)
    return mod.exports
  }
  return load(path).default
}

describe("cleared settings pages", () => {
  for (const [kind, title] of [["project", "專案設定"], ["system", "系統設定"]]) {
    it(`${kind} retains only its title and performs no environment read or request`, () => {
      const Page = loadPage(`app/(app)/settings/${kind}/page.tsx`)
      for (const props of [undefined, { searchParams: Promise.resolve({ name: "AUTH_SECRET", reveal: "true" }) }]) {
        const tree = Page(props)
        const html = renderToStaticMarkup(tree)
        assert.equal(tree.props.title, title)
        assert.equal(tree.props.description, undefined)
        assert.equal(tree.props.children, undefined)
        assert.equal((html.match(/<h1\b/g) ?? []).length, 1)
        assert.equal(html.replace(/<[^>]*>/g, ""), title)
        assert.doesNotMatch(html, /<section|<form|<button|<input|<code|<p\b|ToDo|ComingSoon|AUTH_SECRET|環境變數|讀取中/)
      }
    })
  }
  it("removes the reader, reveal Server Action, client UI and environment metadata", () => {
    for (const file of ["actions.ts", "environment-server.ts", "environment.ts", "environment-diagnostics.tsx"]) {
      assert.equal(existsSync(new URL(`app/(app)/settings/system/${file}`, root)), false, `${file} must not remain as an executable diagnostic entry point`)
    }
    assert.equal(existsSync(new URL("tests/system-environment.test.mjs", root)), false)
  })
})

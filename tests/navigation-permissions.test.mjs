import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import { describe, it } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const root = new URL("../", import.meta.url)
const compiled = new Map()

/**
 * 載入 `components/app-shell/navigation.ts`（純模組，無 import、無 I/O）。
 * 在 vm 沙箱編譯載入，與其它測試 harness 一致；任何不預期的 require 直接 throw。
 */
function harness() {
  const fail = (message) => { throw new Error(message) }
  const globals = {
    Buffer, URL, Date, Error, console: { error: () => {} },
  }
  const sandbox = vm.createContext(globals)
  const modules = new Map()
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    const loadedModule = { exports: {} }
    modules.set(path, loadedModule)
    if (!compiled.has(path)) {
      const filename = fileURLToPath(new URL(path, root))
      compiled.set(path, ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
      }).outputText)
    }
    const fixtureRequire = (specifier) => fail(`Unexpected require: ${specifier}`)
    vm.runInContext(`(function(require,module,exports) {\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  return load("components/app-shell/navigation.ts")
}

const ALL_IDS = ["sprint", "issues", "analytics", "reports"]

/** host 側讀取回傳類別的 id 清單（避免沙箱 realm 的 array 比對問題）。 */
function categoryIds(categories) {
  return Array.from({ length: categories.length }, (_, i) => String(categories[i].id))
}

describe("visibleNavigationCategories（依登入使用者權限）", () => {
  it("管理員 alexwcwang（alexwcwang@kkcompany.com）→ 顯示全部類別", () => {
    const nav = harness()
    const visible = nav.visibleNavigationCategories(nav.navigationCategories, "alexwcwang@kkcompany.com")
    assert.deepEqual(categoryIds(visible), ALL_IDS)
  })

  it("管理員 kennylin（kennylin@kkcompany.com）→ 顯示全部類別", () => {
    const nav = harness()
    const visible = nav.visibleNavigationCategories(nav.navigationCategories, "kennylin@kkcompany.com")
    assert.deepEqual(categoryIds(visible), ALL_IDS)
  })

  it("管理員 email 大小寫／前後空白被忽略", () => {
    const nav = harness()
    const visible = nav.visibleNavigationCategories(
      nav.navigationCategories,
      "  ALEXWCWANG@KKCOMPANY.COM "
    )
    assert.deepEqual(categoryIds(visible), ALL_IDS)
  })

  it("非管理員（清單外的 email）→ 只留 Sprint 管理（Planning + Burn Down）", () => {
    const nav = harness()
    const visible = nav.visibleNavigationCategories(nav.navigationCategories, "someone@example.com")
    assert.deepEqual(categoryIds(visible), ["sprint"])
    // Sprint 類別內應同時有 Planning 與 Burn Down 兩個 feature。
    const sprint = visible[0]
    assert.deepEqual(
      Array.from({ length: sprint.features.length }, (_, i) => String(sprint.features[i].id)),
      ["planning", "burndown"]
    )
  })

  it("email undefined（無 email 情形）→ 非管理員視為受限", () => {
    const nav = harness()
    const visible = nav.visibleNavigationCategories(nav.navigationCategories, undefined)
    assert.deepEqual(categoryIds(visible), ["sprint"])
  })
})
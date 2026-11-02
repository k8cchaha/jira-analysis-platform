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

describe("Sprint Capacity navigation", () => {
  it("adds one final Capacity item while preserving existing Sprint entries", () => {
    const nav = harness()
    const sprint = nav.navigationCategories.find((category) => category.id === "sprint")
    assert.deepEqual(Array.from(sprint.features, (feature) => feature.id), ["planning", "burndown", "capacity"])
    const capacity = sprint.features.at(-1)
    assert.equal(capacity.label, "Capacity")
    assert.equal(capacity.icon, "capacity")
    const teamAnalysis = nav.navigationCategories.find((category) => category.id === "analytics").features.find((feature) => feature.label === "團隊分析")
    assert.notEqual(capacity.icon, teamAnalysis.icon)
    assert.deepEqual(JSON.parse(JSON.stringify(capacity.routes)), [{ href: "/sprint/capacity", label: "Capacity" }])
    assert.deepEqual(JSON.parse(JSON.stringify(nav.getNavigationState("/sprint/capacity"))), { title: "Capacity", categoryId: "sprint" })
  })

  it("keeps the new entry under existing navigation visibility rules", () => {
    const nav = harness()
    const admin = nav.visibleNavigationCategories(nav.navigationCategories, nav.ADMIN_EMAILS[0])
    assert.ok(admin.find((category) => category.id === "sprint").features.some((feature) => feature.id === "capacity"))
    assert.equal(nav.visibleNavigationCategories(nav.navigationCategories, "someone@example.com").length, 0)
  })
})

describe("Analysis navigation", () => {
  it("orders project before team analysis and comparison directly after trends", () => {
    const nav = harness()
    const analytics = nav.navigationCategories.find((category) => category.id === "analytics")
    assert.deepEqual(Array.from(analytics.features, (feature) => feature.label), ["工作量分析", "專案分析", "團隊分析", "成員分析", "趨勢分析", "比較分析"])
    const team = analytics.features[2]
    assert.equal(team.icon, "members")
    assert.equal(team.routes[0].href, "/analytics/story-points/summary")
    const project = analytics.features[1]
    assert.equal(analytics.features[3].icon, "person")
    assert.equal(project.icon, "projects")
    assert.equal(project.routes[0].href, "/analytics/projects/summary")
    const comparison = analytics.features.at(-1)
    assert.equal(comparison.icon, "comparison")
    assert.deepEqual(JSON.parse(JSON.stringify(comparison.routes)), [{ href: "/analytics/comparison/summary", label: "摘要" }])
    assert.deepEqual(JSON.parse(JSON.stringify(nav.getNavigationState(comparison.routes[0].href))), { title: "比較分析", categoryId: "analytics" })
    const adminCategories = nav.visibleNavigationCategories(nav.navigationCategories, nav.ADMIN_EMAILS[0])
    assert.ok(adminCategories.find((category) => category.id === "analytics").features.some((feature) => feature.id === "comparison"))
    assert.equal(nav.visibleNavigationCategories(nav.navigationCategories, "someone@example.com").length, 0)
    for (const [path, title] of [[team.routes[0].href, "團隊分析"], [project.routes[0].href, "專案分析"]]) {
      assert.deepEqual(JSON.parse(JSON.stringify(nav.getNavigationState(path))), { title, categoryId: "analytics" })
    }
  })

  it("keeps renamed team and new project destinations honest ComingSoon pages", () => {
    for (const [path, title] of [
      ["app/(app)/analytics/story-points/summary/page.tsx", "團隊分析"],
      ["app/(app)/analytics/projects/summary/page.tsx", "專案分析"],
      ["app/(app)/analytics/comparison/summary/page.tsx", "比較分析"],
    ]) {
      const code = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
        fileName: path,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText
      const ComingSoon = () => null
      const mod = { exports: {} }
      const fixtureRequire = (name) => {
        if (name === "react/jsx-runtime") return require(name)
        if (name === "@/components/coming-soon") return { ComingSoon }
        throw new Error(`Unexpected page import: ${name}`)
      }
      vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {}, { filename: path })(fixtureRequire, mod, mod.exports)
      const page = mod.exports.default()
      assert.equal(page.type, ComingSoon)
      assert.equal(page.props.title, title)
    }
  })

  it("renders people and project folder icons instead of the former points star", () => {
    const path = "components/app-shell/icons.tsx"
    const code = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    const mod = { exports: {} }
    const fixtureRequire = (name) => {
      if (name === "react/jsx-runtime") return require(name)
      throw new Error(`Unexpected icon import: ${name}`)
    }
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {}, { filename: path })(fixtureRequire, mod, mod.exports)
    const people = mod.exports.NavigationIconGlyph({ name: "members" })
    const project = mod.exports.NavigationIconGlyph({ name: "projects" })
    assert.equal(people.type, "svg")
    assert.equal(people.props.children[0].type, "circle")
    assert.equal(project.type, "svg")
    assert.equal(project.props["aria-hidden"], true)
    assert.equal(project.props.children[0].type, "path")
    assert.notEqual(project.props.children[0].props.d, people.props.children[1].props.d)
    const person = mod.exports.NavigationIconGlyph({ name: "person" })
    assert.equal(person.type, "svg")
    assert.equal(person.props["aria-hidden"], true)
    assert.equal(person.props.children[0].type, "circle")
    assert.equal(person.props.children[0].props.cx, "12")
    assert.equal(person.props.children[1].props.d, "M5 21a7 7 0 0 1 14 0")
    assert.notEqual(person.props.children[1].props.d, people.props.children[1].props.d)
    const capacity = mod.exports.NavigationIconGlyph({ name: "capacity" })
    assert.equal(capacity.type, "svg")
    assert.equal(capacity.props["aria-hidden"], true)
    assert.equal(capacity.props.children[0].type, "circle")
    assert.equal(capacity.props.children[2].type, "circle")
    assert.equal(capacity.props.children[2].props.r, "5")
    assert.equal(capacity.props.children[3].props.d, "M17 13v3l2 1")
    assert.notEqual(capacity.props.children[1].props.d, people.props.children[1].props.d)
    const comparison = mod.exports.NavigationIconGlyph({ name: "comparison" })
    const trends = mod.exports.NavigationIconGlyph({ name: "trends" })
    assert.equal(comparison.type, "svg")
    assert.equal(comparison.props["aria-hidden"], true)
    assert.equal(comparison.props.children[0].type, "rect")
    assert.match(comparison.props.children[1].props.d, /^M12 4v16/)
    assert.notEqual(comparison.props.children[1].props.d, trends.props.children[1].props.d)
  })
})

const ALL_IDS = ["sprint", "analytics", "reports", "settings"]

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

  it("管理員 nickchen（nickchen@kkcompany.com）→ 顯示全部類別", () => {
    const nav = harness()
    const visible = nav.visibleNavigationCategories(nav.navigationCategories, "nickchen@kkcompany.com")
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

  it("非管理員（清單外的 email）→ 不顯示任何類別（只剩儀表板）", () => {
    const nav = harness()
    const visible = nav.visibleNavigationCategories(nav.navigationCategories, "someone@example.com")
    assert.deepEqual(categoryIds(visible), [])
  })

  it("email undefined（無 email 情形）→ 非管理員視為受限", () => {
    const nav = harness()
    const visible = nav.visibleNavigationCategories(nav.navigationCategories, undefined)
    assert.deepEqual(categoryIds(visible), [])
  })
})
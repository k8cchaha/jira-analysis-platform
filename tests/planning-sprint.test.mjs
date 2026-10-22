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
 * 載入 `lib/jira-sprint-data.ts` 與 `lib/burndown-params.ts`（兩者都 import
 * extensionless 的 `./jira-jql`，需以 vm 編譯載入，與其它測試 harness 一致）。
 * 純模組、無 I/O、無 fetch 需求；任何不預期的 require 直接 throw（測試即失敗）。
 */
function harness() {
  const fail = (message) => { throw new Error(message) }
  const globals = {
    Buffer, URL, URLSearchParams, Error, Date, FormData, AbortSignal, Request, Response,
    TextEncoder, TextDecoder, ReadableStream,
    process: { env: {} },
    console: { error: () => {} },
  }
  const sandbox = vm.createContext(globals)
  const allowed = [
    "lib/jira-sprint-data.ts",
    "lib/burndown-params.ts",
    "lib/jira-jql.ts",
    "lib/jira-fields.ts",
    "lib/jira-dashboard-filter.ts",
    "lib/jira-missing-data.ts",
  ]
  const modules = new Map()
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!allowed.includes(path)) return fail(`Unexpected module: ${path}`)
    const loadedModule = { exports: {} }
    modules.set(path, loadedModule)
    if (!compiled.has(path)) {
      const filename = fileURLToPath(new URL(path, root))
      compiled.set(path, ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
      }).outputText)
    }
    const fixtureRequire = (specifier) => {
      if (specifier === "server-only") return {}
      if (specifier.startsWith("@/lib/")) return load(specifier.slice(2) + (specifier.endsWith(".ts") ? "" : ".ts"))
      if (specifier.startsWith("./")) return load("lib/" + specifier.slice(2) + (specifier.endsWith(".ts") ? "" : ".ts"))
      return fail(`Unexpected require: ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports) {\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  return {
    sprints: load("lib/jira-sprint-data.ts"),
    params: load("lib/burndown-params.ts"),
    jql: load("lib/jira-jql.ts"),
  }
}

// today：2026-10-21（SUN＝Sprint 70 進行中、隨之 Sprint 71；TKK＝S132 進行中、隨之 S133；PRIDE 最後一個 Sprint 已於 10-19 結束）
const TODAY = "2026-10-21"

describe("getPlanningSprints（當前＋下一個）", () => {
  // vm 沙箱內的 Array.prototype.map / Number 都屬於沙箱 realm，回傳的陣列與
  // boxed number 是沙箱物件；改以 host 側逐一讀取 .length 與 Number(s.id) 比對。
  const assertIds = (plan, expected) => {
    assert.equal(plan.length, expected.length)
    expected.forEach((id, index) => assert.equal(Number(plan[index].id), id))
  }

  it("SUN：回傳進行中的 Sprint 70 與下一個 Sprint 71", () => {
    const { sprints } = harness()
    assertIds(sprints.getPlanningSprints("SUN", TODAY), [7517, 7518]) // Sprint 70, 71
  })

  it("TKK：回傳進行中的 S132 與下一個 S133", () => {
    const { sprints } = harness()
    assertIds(sprints.getPlanningSprints("TKK", TODAY), [7401, 7402]) // S132, S133
  })

  it("PRIDE：最後一個 Sprint 已結束於今天之前 → 回空陣列（不回退過去）", () => {
    const { sprints } = harness()
    assert.equal(sprints.getPlanningSprints("PRIDE", TODAY).length, 0)
  })

  it("某專案連一個 sprint 都沒有 → 回空陣列", () => {
    const { sprints } = harness()
    assert.equal(sprints.getPlanningSprints("SUN", "2025-01-01").length, 0)
  })

  it("current 是最後一個 sprint（今天在其期間）→ 只回它本身", () => {
    const { sprints } = harness()
    // TKK 的 S135 為最後一棒（12-21 → 01-24）；取 2027-01-05 在其期間內。
    assertIds(sprints.getPlanningSprints("TKK", "2027-01-05"), [7404]) // 只有 S135
  })
})

describe("resolvePlanningSprint（只允許 planning 對）", () => {
  it("有效的下一個 sprint → 選它", () => {
    const { params } = harness()
    assert.equal(params.resolvePlanningSprint("SUN", 7518, TODAY)?.id, 7518)
  })

  it("有效的當前 sprint → 選它", () => {
    const { params } = harness()
    assert.equal(params.resolvePlanningSprint("SUN", 7517, TODAY)?.id, 7517)
  })

  it("無效（已過去的歷史）sprint id → 回退到當前 sprint", () => {
    const { params } = harness()
    assert.equal(params.resolvePlanningSprint("SUN", 7515, TODAY)?.id, 7517)
  })

  it("未指定 id → 回退到當前 sprint", () => {
    const { params } = harness()
    assert.equal(params.resolvePlanningSprint("SUN", null, TODAY)?.id, 7517)
  })

  it("無專案 → null", () => {
    const { params } = harness()
    assert.equal(params.resolvePlanningSprint(null, null, TODAY), null)
  })

  it("專案沒有進行中/未來 sprint → null", () => {
    const { params } = harness()
    assert.equal(params.resolvePlanningSprint("PRIDE", null, TODAY), null)
  })
})

describe("Planning 未估時／未分派 JQL builder（以 sprintDevTasksJql 為基底）", () => {
  it("未估時＝Dev-Task 範圍 + cf[10005] in (Empty, 0)", () => {
    const { jql } = harness()
    assert.equal(
      jql.sprintUnestimatedJql(["SUN-51", "SUN-50"]),
      'parent in (SUN-50, SUN-51) AND issuetype = "Dev-Task" AND cf[10005] in (Empty, 0)'
    )
  })

  it("未分派＝Dev-Task 範圍 + assignee is empty", () => {
    const { jql } = harness()
    assert.equal(
      jql.sprintUnassignedJql(["SUN-50"]),
      'parent in (SUN-50) AND issuetype = "Dev-Task" AND assignee is empty'
    )
  })

  it("key 先驗證排序去重（與其它 builder 一致）", () => {
    const { jql } = harness()
    assert.equal(
      jql.sprintUnassignedJql(["SUN-99", "", "  SUN-02 ", "SUN-02"]),
      'parent in (SUN-02, SUN-99) AND issuetype = "Dev-Task" AND assignee is empty'
    )
  })
})
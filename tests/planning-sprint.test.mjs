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

// today：2026-10-21。新規則：顯示「當天仍在範圍內（active）」＋「未來的」全部 sprint，
// 即 `endDate >= today`，照 startDate 升序。
// SUN：Sprint 70（10-13..10-25，含今天）為進行中；71..75 為未來 → 共 6 個。
// TKK：S132（09-21..10-25，含今天）為進行中；S133/S134/S135 為未來 → 共 4 個。
// PRIDE：最近 S30（10-06..10-19）也已結束 → 空。
const TODAY = "2026-10-21"

describe("getPlanningSprints（進行中＋未來的全部 sprint）", () => {
  // vm 沙箱內的 Array.prototype / Number 屬於沙箱 realm，回傳的陣列與 boxed number
  // 是沙箱物件；改以 host 側逐一讀取 .length 與 Number(s.id) 比對。
  const assertIds = (plan, expected) => {
    assert.equal(plan.length, expected.length)
    expected.forEach((id, index) => assert.equal(Number(plan[index].id), id))
  }

  it("SUN：進行中 Sprint 70 + 未來的 71..75（升序）", () => {
    const { sprints } = harness()
    assertIds(sprints.getPlanningSprints("SUN", TODAY), [7517, 7518, 7519, 7520, 7521, 7522])
  })

  it("TKK：進行中 S132 + 未來的 S133/S134/S135（升序）", () => {
    const { sprints } = harness()
    assertIds(sprints.getPlanningSprints("TKK", TODAY), [7401, 7402, 7403, 7404])
  })

  it("PRIDE：最近的 Sprint 也已結束 → 回空陣列（不回退過去）", () => {
    const { sprints } = harness()
    assert.equal(sprints.getPlanningSprints("PRIDE", TODAY).length, 0)
  })

  it("今天在任何 sprint 開始之前 → 列出全部未來的 sprint", () => {
    // SUN 最早的 Sprint 58（04-28 開始）在 2025-01-01 之前 → 全部都是未來。
    const { sprints } = harness()
    assertIds(sprints.getPlanningSprints("SUN", "2025-01-01"), [6823, 6824, 6825, 7323, 7324, 7510, 7511, 7512, 7513, 7514, 7515, 7516, 7517, 7518, 7519, 7520, 7521, 7522])
  })

  it("已結束最後一個 sprint 之後 → 回空陣列", () => {
    // TKK 最後一棒 S135 結束於 2027-01-24；2027-02-01 已無任何範圍內 sprint。
    const { sprints } = harness()
    assert.equal(sprints.getPlanningSprints("TKK", "2027-02-01").length, 0)
  })
})

describe("resolvePlanningSprint（預設＝進行中，否則最早未來；只允許 planning 選項內）", () => {
  it("明確指定有效的未來 sprint（在選項內）→ 選它", () => {
    const { params } = harness()
    assert.equal(params.resolvePlanningSprint("SUN", 7518, TODAY)?.id, 7518)
  })

  it("明確指定進行中的 sprint（在選項內）→ 選它", () => {
    const { params } = harness()
    assert.equal(params.resolvePlanningSprint("SUN", 7517, TODAY)?.id, 7517)
  })

  it("未指定 id → 預設＝當天仍在範圍內的 Sprint 70（id 7517）", () => {
    const { params } = harness()
    assert.equal(params.resolvePlanningSprint("SUN", null, TODAY)?.id, 7517)
  })

  it("無效（已過去的歷史）sprint id → 回退到預設（進行中 Sprint 70）", () => {
    const { params } = harness()
    assert.equal(params.resolvePlanningSprint("SUN", 7515, TODAY)?.id, 7517)
  })

  it("當天不在任何 sprint 範圍內 → 預設最早的那個未來 sprint", () => {
    // 2026-10-27：不在 Sprint 70（結束 10-25）也不在 Sprint 71（10-26 開始）內 → 選最早未來 Sprint 71。
    const { params } = harness()
    assert.equal(params.resolvePlanningSprint("SUN", null, "2026-10-27")?.id, 7518)
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
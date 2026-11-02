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
const plain = (value) => JSON.parse(JSON.stringify(value))

/**
 * 載入「任務規劃總覽」的純函式模組（`lib/planning-overview.ts`）。它只 `import type`
 * `PlanningTask`（transpile 後無 runtime import），因此 harness 不 stub 任何 server 依賴。
 */
function harness(t) {
  const violations = []
  const fail = (message) => { violations.push(message); throw new Error(message) }
  const globals = { Buffer, URL, URLSearchParams, AbortSignal, Request, Response, console: { error: () => {} } }
  const sandbox = vm.createContext(globals)
  const allowed = ["lib/planning-overview.ts"]
  const modules = new Map()
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    if (!allowed.includes(path)) return fail(`Unexpected module: ${path}`)
    const loaded = { exports: {} }
    modules.set(path, loaded)
    if (!compiled.has(path)) {
      const filename = fileURLToPath(new URL(path, root))
      compiled.set(path, ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
      }).outputText)
    }
    const fixtureRequire = (specifier) => {
      if (specifier === "server-only") return {}
      if (specifier.startsWith("@/lib/")) return load(specifier.slice(2) + (specifier.endsWith(".ts") ? "" : ".ts"))
      return fail(`Unexpected require: ${specifier}`)
    }
    vm.runInContext(`(function(require,module,exports){\n${compiled.get(path)}\n})`, sandbox, { filename: path })(fixtureRequire, loaded, loaded.exports)
    return loaded.exports
  }
  t.after(() => assert.deepEqual(violations, []))
  return load("lib/planning-overview.ts")
}

/** 造一張工作單（純函式只用到 key/points/parentIssueType/assigneeAccountId/reporter/parentKey/parentSummary/epic/devType）。 */
function task(key, over = {}) {
  return {
    key,
    summary: null,
    status: null,
    points: null,
    assigneeDisplayName: null,
    assigneeAccountId: null,
    reporter: null,
    components: [],
    issueType: "Dev-Task",
    devType: null,
    parentKey: null,
    parentSummary: null,
    epic: null,
    parentIssueType: { status: "known", name: "Story" },
    ...over,
  }
}
/** 母票類型 helper：known／none／unknown。 */
const known = (name) => ({ status: "known", name })
const none = { status: "none", name: null }
const unknown = { status: "unknown", name: null }

/** 造一張母票（Reporter View；純函式只用 key/summary/points/reporter/reporterAccountId/issueType/epic/components）。 */
function parent(key, over = {}) {
  return {
    key,
    summary: null,
    points: null,
    components: [],
    reporter: null,
    reporterAccountId: null,
    assigneeAccountId: null,
    issueType: "Story",
    epic: null,
    ...over,
  }
}

describe("devTaskTypeOf", () => {
  it("known 且為 Story/Task/Bug → 對應票種（大小寫不敏感）", (t) => {
    const m = harness(t)
    assert.equal(m.devTaskTypeOf(task("A", { parentIssueType: known("Story") })), "story")
    assert.equal(m.devTaskTypeOf(task("B", { parentIssueType: known("TASK") })), "task")
    assert.equal(m.devTaskTypeOf(task("C", { parentIssueType: known("bug") })), "bug")
  })

  it("母票類型 none／unknown／非三類名稱 → null", (t) => {
    const m = harness(t)
    assert.equal(m.devTaskTypeOf(task("A", { parentIssueType: none })), null)
    assert.equal(m.devTaskTypeOf(task("B", { parentIssueType: unknown })), null)
    assert.equal(m.devTaskTypeOf(task("C", { parentIssueType: known("Epic") })), null)
    assert.equal(m.devTaskTypeOf(task("D", { parentIssueType: known("Extra") })), null)
  })
})

describe("devTypeFamilyOf", () => {
  it("依值名稱分類色族：Spike/Pre-Spike→spike、OP-Task/OP-Bug→op、Dev→dev、Bug→bug（不分大小寫）", (t) => {
    const m = harness(t)
    assert.equal(m.devTypeFamilyOf("Spike"), "spike")
    assert.equal(m.devTypeFamilyOf("Pre-Spike"), "spike")
    assert.equal(m.devTypeFamilyOf("pre-spike"), "spike")
    assert.equal(m.devTypeFamilyOf("OP-Task"), "op")
    assert.equal(m.devTypeFamilyOf("OP-Bug"), "op") // OP 家族優先於 bug，故歸藍非紅
    assert.equal(m.devTypeFamilyOf("Dev"), "dev")
    assert.equal(m.devTypeFamilyOf("BUG"), "bug")
  })

  it("null／空字串／未知值 → null", (t) => {
    const m = harness(t)
    assert.equal(m.devTypeFamilyOf(null), null)
    assert.equal(m.devTypeFamilyOf(""), null)
    assert.equal(m.devTypeFamilyOf("Something Else"), null)
  })
})

describe("buildPlanningGroups", () => {
  const teamOf = (id) => (id === "aa1" ? "Web" : id === "aa2" ? "QA" : undefined)

  it("Team 模式：依指派人團隊分群、未指派歸「其他」、群內 flat 列 Dev-Task、順序依 teamOrder、「其他」殿後", (t) => {
    const m = harness(t)
    const groups = m.buildPlanningGroups({
      tasks: [
        task("SUN-100", { assigneeAccountId: "aa1" }),
        task("SUN-101", { assigneeAccountId: "aa3" }), // 無對應團隊 → 其他
        task("SUN-102", { assigneeAccountId: "aa2" }),
        task("SUN-103", { assigneeAccountId: null }), // 未指派 → 其他
      ],
      mode: "team",
      teamOf,
      teamOrder: ["Web", "QA"],
    })
    assert.deepEqual(plain(groups.map((g) => g.label)), ["Web", "QA", "其他"])
    assert.deepEqual(plain(groups[0].tasks.map((x) => x.key)), ["SUN-100"])
    assert.deepEqual(plain(groups[1].tasks.map((x) => x.key)), ["SUN-102"])
    assert.deepEqual(plain(groups[2].tasks.map((x) => x.key).sort()), ["SUN-101", "SUN-103"])
  })

  it("Team 模式：群內 Dev-Task 依 key 排序", (t) => {
    const m = harness(t)
    const groups = m.buildPlanningGroups({
      tasks: [
        task("SUN-2", { assigneeAccountId: "aa1" }),
        task("SUN-10", { assigneeAccountId: "aa1" }),
        task("SUN-1", { assigneeAccountId: "aa1" }),
      ],
      mode: "team",
      teamOf,
      teamOrder: ["Web"],
    })
    assert.deepEqual(plain(groups[0].tasks.map((x) => x.key)), ["SUN-1", "SUN-2", "SUN-10"])
  })

  it("Reporter 模式：依填報人分群、null 歸「未指定 Reporter」、名稱排序", (t) => {
    const m = harness(t)
    const groups = m.buildPlanningGroups({
      tasks: [
        task("SUN-100", { reporter: "PM Y" }),
        task("SUN-101", { reporter: null }),
        task("SUN-102", { reporter: "PM X" }),
        task("SUN-103", { reporter: "PM Y" }),
      ],
      mode: "reporter",
    })
    assert.deepEqual(plain(groups.map((g) => g.label)), ["未指定 Reporter", "PM X", "PM Y"])
    assert.deepEqual(plain(groups[2].tasks.map((x) => x.key)), ["SUN-100", "SUN-103"])
    assert.deepEqual(plain(groups[0].tasks.map((x) => x.key)), ["SUN-101"])
  })

  it("空輸入 → 空群組", (t) => {
    const m = harness(t)
    assert.deepEqual(plain(m.buildPlanningGroups({ tasks: [], mode: "team", teamOf, teamOrder: [] })), [])
  })
})

describe("buildReporterHierarchy", () => {
  const pmRank = (accountId) =>
    accountId === "fpm1" ? "fpm" : accountId === "opm1" ? "opm" : null

  it("空輸入 → 空列表", (t) => {
    const m = harness(t)
    assert.deepEqual(plain(m.buildReporterHierarchy({ parents: [], pmRank })), [])
  })

  it("依 Reporter 分群：PM(fpm→opm)→其他(顯示名)→未指定殿後", (t) => {
    const m = harness(t)
    const groups = m.buildReporterHierarchy({
      parents: [
        parent("SUN-104", { reporter: "OPM One", reporterAccountId: "opm1" }),
        parent("SUN-101", { reporter: "Dev Three", reporterAccountId: "d3" }),
        parent("SUN-102", { reporter: null, reporterAccountId: null }),
        parent("SUN-105", { reporter: "Dev One", reporterAccountId: "d1" }),
        parent("SUN-100", { reporter: "FPM One", reporterAccountId: "fpm1" }),
        parent("SUN-103", { reporter: "Dev Two", reporterAccountId: "d2" }),
      ],
      pmRank,
    })
    // fpm 前、opm 次、其他（Dev One/Two/Three 依 zh 顯示名）、未指定殿後
    assert.deepEqual(plain(groups.map((g) => g.label)), [
      "FPM One",
      "OPM One",
      "Dev One",
      "Dev Three",
      "Dev Two",
      "未指定 Reporter",
    ])
    assert.deepEqual(plain(groups.map((g) => g.rank)), [0, 1, 2, 2, 2, 3])
    // 每群無 Epic（此用例未給 epic）；epicGroups 空、noEpic 依 key 排序
    assert.deepEqual(plain(groups[0].epicGroups), [])
    assert.deepEqual(plain(groups[0].noEpic.map((p) => p.key)), ["SUN-100"])
  })

  it("每群內：有 Epic 的母票依 Epic 分組～無 Epic 收進 noEpic；母票依 key 排序", (t) => {
    const m = harness(t)
    const epicA = { key: "SUN-E1", summary: "Epic One" }
    const epicB = { key: "SUN-E2", summary: "Epic Two" }
    const groups = m.buildReporterHierarchy({
      parents: [
        parent("SUN-10", { reporterAccountId: "fpm1", epic: epicB }),
        parent("SUN-2", { reporterAccountId: "fpm1", epic: null }),
        parent("SUN-1", { reporterAccountId: "fpm1", epic: epicA }),
        parent("SUN-11", { reporterAccountId: "fpm1", epic: epicA }),
      ],
      pmRank,
    })
    const group = groups[0]
    // 有 Epic 者依 key 分組（E1 前於 E2）
    assert.deepEqual(plain(group.epicGroups.map((g) => g.epic.key)), ["SUN-E1", "SUN-E2"])
    assert.deepEqual(plain(group.epicGroups[0].parents.map((p) => p.key)), ["SUN-1", "SUN-11"])
    assert.deepEqual(plain(group.epicGroups[0].epic), epicA)
    // 無 Epic 者收進 noEpic（依 key 排序）
    assert.deepEqual(plain(group.noEpic.map((p) => p.key)), ["SUN-2"])
  })

  it("pmRank 依 accountId 判定 PM；fpm 與 opm 即使名稱順序顛倒仍到最前", (t) => {
    const m = harness(t)
    const groups = m.buildReporterHierarchy({
      parents: [
        parent("SUN-1", { reporter: "Zulu Dev", reporterAccountId: "z" }),
        parent("SUN-2", { reporter: "AAA PM", reporterAccountId: "opm1" }),
        parent("SUN-3", { reporter: "Mid FPM", reporterAccountId: "fpm1" }),
      ],
      pmRank,
    })
    assert.deepEqual(plain(groups.map((g) => g.label)), ["Mid FPM", "AAA PM", "Zulu Dev"])
  })

  it("pmRank 不傳：所有有 accountId 的 Reporter 皆非 PM，仍依顯示名排序", (t) => {
    const m = harness(t)
    const groups = m.buildReporterHierarchy({
      parents: [
        parent("SUN-1", { reporter: "Beta", reporterAccountId: "b" }),
        parent("SUN-2", { reporter: "Alpha", reporterAccountId: "a" }),
      ],
    })
    assert.deepEqual(plain(groups.map((g) => g.rank)), [2, 2])
    assert.deepEqual(plain(groups.map((g) => g.label)), ["Alpha", "Beta"])
  })
})

describe("countDevTaskTypes", () => {
  it("依 Dev-Task 的母票類型分 Story/Task/Bug；無法歸類者忽略", (t) => {
    const m = harness(t)
    assert.deepEqual(plain(m.countDevTaskTypes([
      task("A", { parentIssueType: known("Story") }),
      task("B", { parentIssueType: known("Task") }),
      task("C", { parentIssueType: known("Bug") }),
      task("D", { parentIssueType: known("Story") }),
      task("E", { parentIssueType: none }),
      task("F", { parentIssueType: known("Epic") }),
    ])), { story: 2, task: 1, bug: 1 })
  })
})

describe("sumDevTaskTypePoints", () => {
  it("依票種加總 Dev-Task 點數、未估計視為 0、無法歸類者忽略、小數進位", (t) => {
    const m = harness(t)
    assert.deepEqual(plain(m.sumDevTaskTypePoints([
      task("A", { parentIssueType: known("Story"), points: 3.3 }),
      task("B", { parentIssueType: known("Story"), points: 2 }),
      task("C", { parentIssueType: known("Task"), points: 1.5 }),
      task("D", { parentIssueType: known("Bug"), points: null }),
      task("E", { parentIssueType: known("Bug"), points: 4 }),
      task("F", { parentIssueType: none, points: 9 }),
      task("G", { parentIssueType: known("Epic"), points: 5 }),
    ])), { story: 5.3, task: 1.5, bug: 4 })
  })
})

describe("buildDevTaskTypeTeamBreakdown", () => {
  const teamOf = (id) => (id === "aa1" ? "Web" : id === "aa2" ? "QA" : undefined)
  const base = { teamOf, teamOrder: ["Web", "QA"] }

  it("count：依指派人團隊分 bucket、未指派歸「其他」、總量=張數、順序依 teamOrder、「其他」殿後", (t) => {
    const m = harness(t)
    const got = m.buildDevTaskTypeTeamBreakdown({
      tasks: [
        task("A", { parentIssueType: known("Story"), assigneeAccountId: "aa1" }),
        task("B", { parentIssueType: known("Story"), assigneeAccountId: "aa1" }),
        task("C", { parentIssueType: known("Story"), assigneeAccountId: "aa2" }),
        task("D", { parentIssueType: known("Story"), assigneeAccountId: null }),
        task("E", { parentIssueType: known("Story"), assigneeAccountId: null }),
        task("F", { parentIssueType: known("Story"), assigneeAccountId: "aa9" }), // 無對應團隊 → 其他
        task("G", { parentIssueType: known("Task"), assigneeAccountId: "aa1" }), // 不算（另一票種）
      ],
      issueType: "story", metric: "count", ...base,
    })
    assert.deepEqual(plain(got), { total: 6, teams: [
      { label: "Web", value: 2 }, { label: "QA", value: 1 },
      { label: "其他", value: 3 },
    ] })
  })

  it("points：依 Dev-Task 點數加總（未估計視 0），只算指定票種、total 為該票種點數和", (t) => {
    const m = harness(t)
    const got = m.buildDevTaskTypeTeamBreakdown({
      tasks: [
        task("A", { parentIssueType: known("Story"), assigneeAccountId: "aa1", points: 5 }),
        task("B", { parentIssueType: known("Story"), assigneeAccountId: "aa1", points: null }),
        task("C", { parentIssueType: known("Story"), assigneeAccountId: "aa2", points: 3.3 }),
        task("D", { parentIssueType: known("Task"), assigneeAccountId: "aa2", points: 99 }), // 不算
      ],
      issueType: "story", metric: "points", ...base,
    })
    assert.deepEqual(plain(got), { total: 8.3, teams: [
      { label: "Web", value: 5 }, { label: "QA", value: 3.3 },
    ] })
  })

  it("指定票種無任何 Dev-Task → total 0、teams 空", (t) => {
    const m = harness(t)
    const got = m.buildDevTaskTypeTeamBreakdown({
      tasks: [task("A", { parentIssueType: known("Bug"), assigneeAccountId: "aa1", points: 1 })],
      issueType: "story", metric: "count", ...base,
    })
    assert.deepEqual(plain(got), { total: 0, teams: [] })
  })
})

describe("buildPlanningDevTypeGroups", () => {
  const teamOf = (id) => (id === "aa1" ? "Web" : id === "aa2" ? "QA" : undefined)

  it("Team 分群；群內依 Dev Type 排序（Pre-Spike→Spike→Dev→Bug→OP-Task→OP-Bug→未分類）、空群不輸出、群內依 key", (t) => {
    const m = harness(t)
    const got = m.buildPlanningDevTypeGroups({
      tasks: [
        task("SUN-105", { assigneeAccountId: "aa1", devType: "Dev" }),
        task("SUN-104", { assigneeAccountId: "aa1", devType: "Bug" }),
        task("SUN-103", { assigneeAccountId: "aa1", devType: "Pre-Spike" }),
        task("SUN-102", { assigneeAccountId: "aa1", devType: "Spike" }),
        task("SUN-106", { assigneeAccountId: "aa1", devType: "OP-Bug" }),
        task("SUN-107", { assigneeAccountId: "aa1", devType: "Other" }), // 未分類
        task("SUN-101", { assigneeAccountId: "aa1", devType: "Dev" }),
        task("SUN-200", { assigneeAccountId: "aa2", devType: "OP-Task" }),
        task("SUN-300", { assigneeAccountId: null, devType: "Bug" }), // 未指派 → 其他
      ],
      teamOf,
      teamOrder: ["Web", "QA"],
    })
    assert.deepEqual(plain(got.map((g) => g.label)), ["Web", "QA", "其他"])

    // Web 群：Pre-Spike→Spike→Dev→Bug→OP-Bug→未分類（OP-Task 無人 → 不輸出）。
    const web = got[0]
    assert.deepEqual(plain(web.typeGroups.map((g) => g.label)), ["Pre-Spike", "Spike", "Dev", "Bug", "OP-Bug", "未分類"])
    assert.deepEqual(plain(web.typeGroups[0].tasks.map((x) => x.key)), ["SUN-103"])
    assert.deepEqual(plain(web.typeGroups[1].tasks.map((x) => x.key)), ["SUN-102"])
    // Dev 群：SUN-101、SUN-105（依 key 排序）。
    assert.deepEqual(plain(web.typeGroups[2].tasks.map((x) => x.key)), ["SUN-101", "SUN-105"])
    assert.deepEqual(plain(web.typeGroups[3].tasks.map((x) => x.key)), ["SUN-104"])
    assert.deepEqual(plain(web.typeGroups[4].tasks.map((x) => x.key)), ["SUN-106"])
    assert.deepEqual(plain(web.typeGroups[5].tasks.map((x) => x.key)), ["SUN-107"])
    // QA 群只有 OP-Task。
    assert.deepEqual(plain(got[1].typeGroups.map((g) => g.label)), ["OP-Task"])
    // 其他群只有 Bug。
    assert.deepEqual(plain(got[2].typeGroups.map((g) => g.label)), ["Bug"])
  })

  it("devType null 的工作單歸「未分類」", (t) => {
    const m = harness(t)
    const got = m.buildPlanningDevTypeGroups({
      tasks: [task("SUN-1", { assigneeAccountId: "aa1", devType: null })],
      teamOf,
      teamOrder: ["Web"],
    })
    const web = got[0]
    assert.deepEqual(plain(web.typeGroups.map((g) => g.label)), ["未分類"])
    assert.deepEqual(plain(web.typeGroups[0].tasks.map((x) => x.key)), ["SUN-1"])
  })

  it("空輸入 → 空群組；無任何團隊 → 全歸『其他』", (t) => {
    const m = harness(t)
    assert.deepEqual(plain(m.buildPlanningDevTypeGroups({ tasks: [], teamOf, teamOrder: [] })), [])
    const got = m.buildPlanningDevTypeGroups({
      tasks: [task("SUN-1", { assigneeAccountId: "aa9" })],
      teamOf,
      teamOrder: ["Web"],
    })
    assert.deepEqual(plain(got.map((g) => g.label)), ["其他"])
  })
})

describe("devTypeLabelOf", () => {
  it("固定分類值（不分大小寫）→ 正規化標籤；null／未知值 → 未分類", (t) => {
    const m = harness(t)
    for (const [input, expected] of [
      ["Pre-Spike", "Pre-Spike"], ["pre-spike", "Pre-Spike"], ["SPIKE", "Spike"],
      ["Dev", "Dev"], ["dev", "Dev"], ["Bug", "Bug"], ["bug", "Bug"],
      ["OP-Task", "OP-Task"], ["op-task", "OP-Task"], ["OP-Bug", "OP-Bug"],
      ["Something", m.UNCLASSIFIED_DEV_TYPE_LABEL], [null, "未分類"],
    ]) {
      assert.equal(m.devTypeLabelOf(input), expected)
    }
  })
})

describe("countDevTypeLabels / sumDevTypeLabelPoints", () => {
  it("依固定分類計數與加總點數，未估計視 0、未知值併入未分類、key 齊全（含未分類）", (t) => {
    const m = harness(t)
    const tasks = [
      task("A", { devType: "Pre-Spike" }),
      task("B", { devType: "Dev", points: 3.3 }),
      task("C", { devType: "Bug", points: 2 }),
      task("D", { devType: "bug", points: null }),
      task("E", { devType: "OP-Task", points: 1.5 }),
      task("F", { devType: "Weird" }), // 未知 → 未分類
      task("G", { devType: null }), // null → 未分類
    ]
    assert.deepEqual(plain(m.countDevTypeLabels(tasks)), {
      "Pre-Spike": 1, Spike: 0, Dev: 1, Bug: 2, "OP-Task": 1, "OP-Bug": 0, "未分類": 2,
    })
    assert.deepEqual(plain(m.sumDevTypeLabelPoints(tasks)), {
      "Pre-Spike": 0, Spike: 0, Dev: 3.3, Bug: 2, "OP-Task": 1.5, "OP-Bug": 0, "未分類": 0,
    })
  })
})

describe("buildDevTaskTypeMemberBreakdown", () => {
  it("count／points：Dev+QA 工作單依母票 Story/Task/Bug 分類，忽略 none／unknown／其他母票類型", (t) => {
    const m = harness(t)
    const tasks = [
      task("S-DEV", { parentIssueType: known("Story"), assigneeAccountId: "s", assigneeDisplayName: "Story member", points: 1.2 }),
      task("S-QA", { issueType: "QA-Task", parentIssueType: known("STORY"), assigneeAccountId: "s", assigneeDisplayName: "Story member", points: 2.3 }),
      task("T-DEV", { parentIssueType: known("Task"), assigneeAccountId: "t", assigneeDisplayName: "Task member", points: 4 }),
      task("T-QA", { issueType: "QA-Task", parentIssueType: known("TASK"), assigneeAccountId: "t", assigneeDisplayName: "Task member", points: null }),
      task("B-DEV", { parentIssueType: known("Bug"), assigneeAccountId: "b", assigneeDisplayName: "Bug member", points: 5 }),
      task("B-QA", { issueType: "QA-Task", parentIssueType: known("bug"), assigneeAccountId: "b", assigneeDisplayName: "Bug member", points: 0.5 }),
      task("NONE", { parentIssueType: none, assigneeAccountId: "excluded", points: 99 }),
      task("UNKNOWN", { parentIssueType: unknown, assigneeAccountId: "excluded", points: 99 }),
      task("EPIC", { parentIssueType: known("Epic"), assigneeAccountId: "excluded", points: 99 }),
    ]
    for (const [issueType, accountId, label, points] of [
      ["story", "s", "Story member", 3.5],
      ["task", "t", "Task member", 4],
      ["bug", "b", "Bug member", 5.5],
    ]) {
      for (const metric of ["count", "points"]) {
        const value = metric === "count" ? 2 : points
        assert.deepEqual(plain(m.buildDevTaskTypeMemberBreakdown({ tasks, issueType, metric })), {
          total: value, members: [{ accountId, label, value }],
        }, `${issueType}/${metric}`)
      }
    }
  })
})

describe("buildDevTypeLabelMemberBreakdown", () => {
  it("count／points：Dev+QA 工作單依正規化 Dev Type 分類，未知／null／空值併入未分類", (t) => {
    const m = harness(t)
    const tasks = [
      task("PRE", { devType: "pre-spike", assigneeAccountId: "member", points: 1 }),
      task("SPIKE", { issueType: "QA-Task", devType: "SPIKE", assigneeAccountId: "member", points: 2 }),
      task("DEV", { devType: "dev", assigneeAccountId: "member", points: 3 }),
      task("DEV-QA", { issueType: "QA-Task", devType: "Dev", assigneeAccountId: "member", points: null }),
      task("BUG", { issueType: "QA-Task", devType: "bug", assigneeAccountId: "member", points: 4 }),
      task("OP-TASK", { devType: "op-task", assigneeAccountId: "member", points: 5 }),
      task("OP-BUG", { issueType: "QA-Task", devType: "OP-BUG", assigneeAccountId: "member", points: 6 }),
      task("UNKNOWN", { devType: "Something Else", assigneeAccountId: "member", points: 0.1 }),
      task("NULL", { issueType: "QA-Task", devType: null, assigneeAccountId: "member", points: 0.2 }),
      task("EMPTY", { devType: "", assigneeAccountId: "member", points: null }),
    ]
    for (const [label, count, points] of [
      ["Pre-Spike", 1, 1], ["Spike", 1, 2], ["Dev", 2, 3], ["Bug", 1, 4],
      ["OP-Task", 1, 5], ["OP-Bug", 1, 6], ["未分類", 3, 0.3],
    ]) {
      for (const metric of ["count", "points"]) {
        const value = metric === "count" ? count : points
        assert.deepEqual(plain(m.buildDevTypeLabelMemberBreakdown({ tasks, label, metric })), {
          total: value, members: [{ accountId: "member", label: "member", value }],
        }, `${label}/${metric}`)
      }
    }
  })
})

for (const [name, category] of [
  ["buildDevTaskTypeMemberBreakdown", { issueType: "story" }],
  ["buildDevTypeLabelMemberBreakdown", { label: "Dev" }],
]) {
  describe(`${name} — 共用成員份額契約`, () => {
    const selected = (key, over = {}) => task(key, { devType: "Dev", ...over })
    const other = (key, over = {}) => task(key, { devType: "Bug", parentIssueType: known("Bug"), ...over })

    it("count／points：同 ID 合併、同名不同 ID 保留；分母只算分類內已指派工作單，非全團隊總量", (t) => {
      const m = harness(t)
      const tasks = [
        selected("DEV-1", { assigneeAccountId: "a", assigneeDisplayName: " Alex ", points: 1 }),
        selected("QA-1", { issueType: "QA-Task", assigneeAccountId: "a", assigneeDisplayName: "Alex", points: 2 }),
        selected("DEV-2", { assigneeAccountId: "b", assigneeDisplayName: "Alex", points: 4 }),
        selected("UNASSIGNED", { assigneeAccountId: null, assigneeDisplayName: "Not a member", points: 50 }),
        other("OTHER", { assigneeAccountId: "outside", assigneeDisplayName: "Outside category", points: 99 }),
        other("OTHER-A", { assigneeAccountId: "a", assigneeDisplayName: "A different category name", points: 99 }),
      ]
      const count = plain(m[name]({ tasks, ...category, metric: "count" }))
      assert.deepEqual(count, { total: 3, members: [
        { accountId: "a", label: "Alex", value: 2 },
        { accountId: "b", label: "Alex", value: 1 },
      ] })
      assert.notEqual(count.total, tasks.length)
      const points = plain(m[name]({ tasks, ...category, metric: "points" }))
      assert.deepEqual(points, { total: 7, members: [
        { accountId: "b", label: "Alex", value: 4 },
        { accountId: "a", label: "Alex", value: 3 },
      ] })
      assert.notEqual(points.total, tasks.reduce((sum, item) => sum + (item.points ?? 0), 0))
    })

    it("缺少／空白名稱以 ID 顯示；保留零點數 Assignee，不虛構 roster／Reporter／未指派成員", (t) => {
      const m = harness(t)
      const tasks = [
        selected("NULL-NAME", { assigneeAccountId: "id-a", points: null, reporter: "Roster-only person" }),
        selected("BLANK-NAME", { issueType: "QA-Task", assigneeAccountId: "id-b", assigneeDisplayName: " \t ", points: 0 }),
        selected("EMPTY-NAME", { assigneeAccountId: "id-c", assigneeDisplayName: "", points: null }),
        selected("UNASSIGNED", { assigneeAccountId: null, assigneeDisplayName: "Unassigned name", points: 100 }),
        other("OTHER", { assigneeAccountId: "no-selected-tasks", points: 100 }),
      ]
      for (const metric of ["count", "points"]) {
        const value = metric === "count" ? 1 : 0
        assert.deepEqual(plain(m[name]({ tasks, ...category, metric })), {
          total: value * 3,
          members: ["id-a", "id-b", "id-c"].map((accountId) => ({ accountId, label: accountId, value })),
        })
      }
    })

    it("空輸入／空分類／分類僅有未指派工作單 → total 0、members 空（兩種 metric）", (t) => {
      const m = harness(t)
      for (const tasks of [
        [],
        [other("OTHER", { assigneeAccountId: "a", points: 5 })],
        [selected("UNASSIGNED", { assigneeAccountId: null, points: 5 })],
      ]) {
        for (const metric of ["count", "points"]) {
          assert.deepEqual(plain(m[name]({ tasks, ...category, metric })), { total: 0, members: [] })
        }
      }
    })

    it("輸入順序不影響結果：同 ID 取 zh 最小非空白名稱、值降序→名稱 zh→ID 排序", (t) => {
      const m = harness(t)
      // zh 的「阿」在「波」之前，與 Unicode code point 順序相反。
      const tasks = [
        selected("A-ZH", { assigneeAccountId: "rename", assigneeDisplayName: " 波 ", points: 1 }),
        selected("A-BLANK", { assigneeAccountId: "rename", assigneeDisplayName: " ", points: 1 }),
        selected("A-LEAST", { issueType: "QA-Task", assigneeAccountId: "rename", assigneeDisplayName: " 阿 ", points: 1 }),
        selected("A-NULL", { assigneeAccountId: "rename", assigneeDisplayName: null, points: 1 }),
        selected("B", { assigneeAccountId: "wave", assigneeDisplayName: "波", points: 1 }),
        selected("C", { assigneeAccountId: "a-same", assigneeDisplayName: "同名", points: 1 }),
        selected("D", { assigneeAccountId: "b-same", assigneeDisplayName: "同名", points: 1 }),
        selected("E", { assigneeAccountId: "first-name", assigneeDisplayName: "阿", points: 1 }),
      ]
      const expected = { total: 8, members: [
        { accountId: "rename", label: "阿", value: 4 },
        { accountId: "first-name", label: "阿", value: 1 },
        { accountId: "wave", label: "波", value: 1 },
        { accountId: "a-same", label: "同名", value: 1 },
        { accountId: "b-same", label: "同名", value: 1 },
      ] }
      const before = plain(tasks)
      for (const metric of ["count", "points"]) {
        for (let offset = 0; offset < tasks.length; offset += 1) {
          const rotated = [...tasks.slice(offset), ...tasks.slice(0, offset)]
          for (const ordered of [rotated, [...rotated].reverse()]) {
            assert.deepEqual(plain(m[name]({ tasks: ordered, ...category, metric })), expected)
          }
        }
      }
      assert.deepEqual(tasks, before)
    })

    it("points：先加總再四捨五入一位小數；total 由原始點數加總，不加總已捨入 bucket", (t) => {
      const m = harness(t)
      const tasks = [
        selected("A1", { assigneeAccountId: "a", assigneeDisplayName: "Alice", points: 0.11 }),
        selected("A2", { assigneeAccountId: "a", assigneeDisplayName: "Alice", points: 0.12 }),
        selected("B1", { assigneeAccountId: "b", assigneeDisplayName: "Bob", points: 0.12 }),
        selected("B2", { issueType: "QA-Task", assigneeAccountId: "b", assigneeDisplayName: "Bob", points: 0.12 }),
        selected("C1", { assigneeAccountId: "c", assigneeDisplayName: "Charlie", points: 0.1 }),
        selected("C2", { assigneeAccountId: "c", assigneeDisplayName: "Charlie", points: 0.2 }),
        selected("C3", { assigneeAccountId: "c", assigneeDisplayName: "Charlie", points: null }),
        selected("C4", { assigneeAccountId: "c", assigneeDisplayName: "Charlie", points: 0.14 }),
        selected("C5", { assigneeAccountId: "c", assigneeDisplayName: "Charlie", points: 0.14 }),
        selected("C6", { assigneeAccountId: "c", assigneeDisplayName: "Charlie", points: 0.01 }),
      ]
      // 原始 bucket：Alice 0.23、Bob 0.24、Charlie 0.59；捨入後 Alice/Bob 同值，改依名稱排序。
      const expected = { total: 1.1, members: [
        { accountId: "c", label: "Charlie", value: 0.6 },
        { accountId: "a", label: "Alice", value: 0.2 },
        { accountId: "b", label: "Bob", value: 0.2 },
      ] }
      for (const ordered of [tasks, [...tasks].reverse()]) {
        const got = plain(m[name]({ tasks: ordered, ...category, metric: "points" }))
        assert.deepEqual(got, expected)
        assert.notEqual(got.total, got.members.reduce((sum, member) => sum + member.value, 0))
      }
    })
  })
}

describe("buildDevTypeLabelTeamBreakdown", () => {
  const teamOf = (id) => (id === "aa1" ? "Web" : id === "aa2" ? "QA" : undefined)
  const base = { teamOf, teamOrder: ["Web", "QA"] }

  it("count：依指派人團隊分 bucket、未指派歸「其他」、只算指定 Dev Type、總量=張數、順序依 teamOrder", (t) => {
    const m = harness(t)
    const got = m.buildDevTypeLabelTeamBreakdown({
      tasks: [
        task("A", { devType: "Dev", assigneeAccountId: "aa1" }),
        task("B", { devType: "Dev", assigneeAccountId: "aa1" }),
        task("C", { devType: "Dev", assigneeAccountId: "aa2" }),
        task("D", { devType: "Dev", assigneeAccountId: null }),
        task("E", { devType: "Dev", assigneeAccountId: "aa9" }), // 無對應團隊 → 其他
        task("F", { devType: "Bug", assigneeAccountId: "aa1" }), // 不算（另一分類）
      ],
      label: "Dev", metric: "count", ...base,
    })
    assert.deepEqual(plain(got), { total: 5, teams: [
      { label: "Web", value: 2 }, { label: "QA", value: 1 }, { label: "其他", value: 2 },
    ] })
  })

  it("points：依點數加總（未估計視 0）、只算指定分類、total 為該分類點數和；空分類 → total 0、teams 空", (t) => {
    const m = harness(t)
    assert.deepEqual(plain(m.buildDevTypeLabelTeamBreakdown({
      tasks: [
        task("A", { devType: "Dev", assigneeAccountId: "aa1", points: 5 }),
        task("B", { devType: "Dev", assigneeAccountId: "aa1", points: null }),
        task("C", { devType: "Dev", assigneeAccountId: "aa2", points: 3.3 }),
        task("D", { devType: "Bug", assigneeAccountId: "aa2", points: 99 }), // 不算
      ],
      label: "Dev", metric: "points", ...base,
    })), { total: 8.3, teams: [{ label: "Web", value: 5 }, { label: "QA", value: 3.3 }] })

    assert.deepEqual(plain(m.buildDevTypeLabelTeamBreakdown({
      tasks: [task("A", { devType: "Bug", assigneeAccountId: "aa1", points: 1 })],
      label: "Dev", metric: "count", ...base,
    })), { total: 0, teams: [] })
  })
})
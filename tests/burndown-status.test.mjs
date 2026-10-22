import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { computeBurndownStatus } from "../lib/burndown-status.ts"

const TODAY = "2026-10-19"

const task = (key, points, doneDate, assignee, actualPoints = null, doneBeforeStart = false) => ({
  key,
  summary: `Summary ${key}`,
  points,
  actualPoints,
  doneDate,
  doneBeforeStart,
  assigneeDisplayName: assignee ? `Display ${assignee}` : null,
  assigneeAccountId: assignee,
})

const teamOf = (id) =>
  id === "u-web-1" || id === "u-web-2"
    ? "Web"
    : id === "u-be-1"
      ? "BE1"
      : undefined

const TEAM_ORDER = ["Web", "BE1", "BE2", "Android", "Design", "EP", "iOS", "SDET", "SRE", "Pride", "QA"]

describe("computeBurndownStatus", () => {
  it("groups by team, sorts assignees by name, and computes per-member stats", () => {
    const result = computeBurndownStatus({
      tasks: [
        task("T-1", 5, "2026-10-15", "u-web-1", 6),
        task("T-2", 8, null, "u-web-1"),
        task("T-3", 3, "2026-10-18", "u-be-1"),
        task("T-4", 2, null, "u-web-2"),
        task("T-5", 4, null, "u-web-2", 4),
      ],
      today: TODAY,
      teamOf,
      teamOrder: TEAM_ORDER,
    })

    // Web 在前，BE1 在後（依 teamOrder）。
    assert.deepEqual(result.map((team) => team.label), ["Web", "BE1"])

    const web = result[0]
    assert.equal(web.label, "Web")
    assert.deepEqual(web.assignees.map((a) => a.assigneeName), ["Display u-web-1", "Display u-web-2"])

    const web1 = web.assignees[0]
    assert.equal(web1.totalTasks, 2)
    assert.equal(web1.doneTasks, 1)
    assert.equal(web1.notDoneTasks, 1)
    assert.equal(web1.donePoints, 5)
    assert.equal(web1.notDonePoints, 8)
    assert.equal(web1.doneActualPoints, 6)
    assert.equal(web1.completionPercent, 38.5) // 5/13 → 38.46 → 四捨五入 38.5

    const be = result[1]
    assert.equal(be.label, "BE1")
    assert.equal(be.assignees.length, 1)
    assert.equal(be.assignees[0].donePoints, 3)
    assert.equal(be.assignees[0].completionPercent, 100)
  })

  it("rolls up team-level completion aggregates", () => {
    const result = computeBurndownStatus({
      tasks: [
        task("T-1", 5, "2026-10-15", "u-web-1", 6),
        task("T-2", 8, null, "u-web-1"),
        task("T-3", 3, "2026-10-18", "u-be-1"),
        task("T-4", 2, null, "u-web-2", 2),
      ],
      today: TODAY,
      teamOf,
      teamOrder: TEAM_ORDER,
    })
    const web = result[0]
    assert.equal(web.totalTasks, 3)
    assert.equal(web.doneTasks, 1) // 只有 T-1 完成
    assert.equal(web.notDoneTasks, 2)
    assert.equal(web.donePoints, 5)
    assert.equal(web.doneActualPoints, 6)
    assert.equal(web.notDonePoints, 10) // 8 + 2
    assert.equal(web.completionPercent, Math.round((5 / 15) * 1000) / 10) // 33.3

    const be = result[1]
    assert.equal(be.totalTasks, 1)
    assert.equal(be.doneTasks, 1)
    assert.equal(be.completionPercent, 100)
  })

  it("treats future done dates as not done and keeps null actual SP out of the actual sum", () => {
    const result = computeBurndownStatus({
      tasks: [
        task("T-1", 3, "2026-10-25", "u-web-1", null), // doneDate 在未來 → 未完成
        task("T-2", 4, "2026-10-15", "u-web-1", 2), // 已完成→實際計入
      ],
      today: TODAY,
      teamOf,
      teamOrder: TEAM_ORDER,
    })
    const web1 = result[0].assignees[0]
    assert.equal(web1.doneTasks, 1)
    assert.equal(web1.donePoints, 4)
    assert.equal(web1.doneActualPoints, 2)
    assert.equal(web1.notDoneTasks, 1)
    assert.equal(web1.notDonePoints, 3)
  })

  it("puts assignees without a known team (or unassigned) into 其他 at the end", () => {
    const result = computeBurndownStatus({
      tasks: [
        task("T-1", 5, null, "u-unknown", 0),
        task("T-2", 2, "2026-10-14", null), // 未指派
      ],
      today: TODAY,
      teamOf,
      teamOrder: TEAM_ORDER,
    })
    assert.equal(result.length, 1)
    assert.equal(result[0].label, "其他")
    // 依名稱排序；中英混排的順序取決於 locale，這裡只驗證都歸入「其他」。
    assert.equal(result[0].assignees.length, 2)
    for (const name of ["Display u-unknown", "未指派"]) {
      assert.ok(result[0].assignees.some((a) => a.assigneeName === name), `missing ${name}`)
    }
  })

  it("returns null completion percent when total points is zero", () => {
    const result = computeBurndownStatus({
      tasks: [task("T-1", 0, null, "u-web-1")],
      today: TODAY,
      teamOf,
      teamOrder: TEAM_ORDER,
    })
    assert.equal(result[0].assignees[0].completionPercent, null)
  })

  it("counts sprint-start-before Done tasks as completed (green opening cell work)", () => {
    const result = computeBurndownStatus({
      tasks: [
        task("T-B", 4, null, "u-web-1", null, true), // 開局前完成 → 算已完成
        task("T-1", 5, "2026-10-15", "u-web-1", 6),
        task("T-2", 8, null, "u-web-1"), // 未完成
      ],
      today: TODAY,
      teamOf,
      teamOrder: TEAM_ORDER,
    })
    const web = result[0]
    const web1 = web.assignees[0]
    assert.equal(web1.totalTasks, 3)
    assert.equal(web1.doneTasks, 2) // 開局前完成(T-B) + 10-15完成(T-1)
    assert.equal(web1.notDoneTasks, 1)
    assert.equal(web1.donePoints, 9) // 4 + 5
    assert.equal(web1.notDonePoints, 8)
    // 開局前完成也進團隊層級彙總。
    assert.equal(web.doneTasks, 2)
    assert.equal(web.donePoints, 9)
    assert.equal(web.completionPercent, Math.round((9 / 17) * 1000) / 10)
  })

  it("orders teams by teamOrder and appends unknown teams last", () => {
    const result = computeBurndownStatus({
      tasks: [
        task("T-1", 1, null, "u-unknown-A"),
        task("T-2", 1, null, "u-unknown-B"),
        task("T-3", 1, null, "u-be-1"),
        task("T-4", 1, null, "u-web-1"),
      ],
      today: TODAY,
      teamOf,
      teamOrder: TEAM_ORDER,
    })
    assert.deepEqual(result.map((team) => team.label), ["Web", "BE1", "其他"])
    assert.deepEqual(result[2].assignees.map((a) => a.assigneeName), ["Display u-unknown-A", "Display u-unknown-B"])
  })
})
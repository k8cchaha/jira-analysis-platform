import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { computeAssignmentStatus } from "../lib/assignment-status.ts"

/** 造一個 Dev-Task：points 可為 null（未估計）。 */
const task = (key, points, assigneeAccountId, assigneeDisplayName = null) => ({
  key,
  summary: `Summary ${key}`,
  points,
  assigneeAccountId,
  assigneeDisplayName: assigneeDisplayName ?? (assigneeAccountId ? `Display ${assigneeAccountId}` : null),
})

const teamOf = (id) =>
  id === "u-web-1" || id === "u-web-2"
    ? "Web"
    : id === "u-be-1"
      ? "BE1"
      : undefined

const TEAM_ORDER = ["Web", "BE1", "BE2", "Android", "Design", "EP", "iOS", "SDET", "SRE", "Pride", "QA"]

describe("computeAssignmentStatus", () => {
  it("依指派人彙整已分派點數、以團隊分組，Capacity＝每人數值", () => {
    const result = computeAssignmentStatus({
      tasks: [
        task("T-1", 5, "u-web-1", "Alice"),
        task("T-2", 8, "u-web-1", "Alice"),
        task("T-3", 3, "u-be-1", "Bob"),
        task("T-4", 2, "u-web-2", "Carol"),
        task("T-5", null, "u-web-2", "Carol"), // 未估計 → 該員點數仍為 0，不計
      ],
      teamOf,
      teamOrder: TEAM_ORDER,
      perPersonCapacity: 20,
    })

    assert.deepEqual(result.map((t) => t.label), ["Web", "BE1"])

    const web = result[0]
    assert.equal(web.capacity, 40) // 2 人 × 20
    assert.equal(web.assignedPoints, 5 + 8 + 2) // 15（null 不算）
    assert.deepEqual(web.members.map((m) => m.name), ["Alice", "Carol"])

    const alice = web.members[0]
    assert.equal(alice.capacity, 20)
    assert.equal(alice.assignedPoints, 13) // 5 + 8

    const be = result[1]
    assert.equal(be.capacity, 20)
    assert.equal(be.assignedPoints, 3)
  })

  it("未指派與無對應團隊的指派人歸「其他」，未指派 Capacity 為 null", () => {
    const result = computeAssignmentStatus({
      tasks: [
        task("T-1", 5, "u-web-1"),
        task("T-2", 1, "u-unknown"),   // 不在 teamOf → 其他
        task("T-3", 4, null),           // 未指派 → 其他
      ],
      teamOf,
      teamOrder: TEAM_ORDER,
      perPersonCapacity: 40,
    })

    const other = result.find((t) => t.label === "其他")
    assert.ok(other, "應有「其他」團隊")
    assert.equal(other.assignedPoints, 1 + 4)

    const unassigned = other.members.find((m) => m.assigneeAccountId === null)
    assert.equal(unassigned.name, "未指派")
    assert.equal(unassigned.capacity, null)
    assert.equal(unassigned.assignedPoints, 4)

    const unknown = other.members.find((m) => m.assigneeAccountId === "u-unknown")
    assert.equal(unknown.capacity, 40) // 其他團隊的真實指派人仍給Capacity
    assert.equal(unknown.assignedPoints, 1)
  })

  it("teamOrder 決定顯示順序；未列出者排最後", () => {
    const result = computeAssignmentStatus({
      tasks: [
        task("T-1", 2, "u-be-1"),
        task("T-2", 3, "u-web-1"),
        task("T-3", 1, "u-zzz"),
      ],
      teamOf,
      teamOrder: ["Web"],
      perPersonCapacity: 20,
    })
    // Web 在前；BE1、其他 依名稱（zh）排序在後。
    assert.deepEqual(result.map((t) => t.label), ["Web", "其他", "BE1"])
  })
})
/**
 * Planning「任務分派狀況」的純函數（無 I/O、無 `server-only`）。
 *
 * 以該 sprint 的 Dev-Task（已過濾）為輸入，依指派人（assignee）彙整每人的
 * 「已分派點數」，再以團隊分組排序輸出——與燃盡圖「成員開發狀況」
 * （`computeBurndownStatus`）的分組方式一致。client 端（`assignment-status.tsx`）
 * 繪製用；資料與主表共用同一份已過濾 Dev-Task，不重發 JQL。
 */

export interface MemberAssignment {
  /** 姓名；未指派為「未指派」。 */
  name: string
  assigneeAccountId: string | null
  /** 可用點數（Capacity，依專案而定）；未指派者無從適用 → null。 */
  capacity: number | null
  /** 已分派點數（該指派人的 Dev-Task 加總）。 */
  assignedPoints: number
}

export interface TeamAssignment {
  /** 團隊顯示名稱；無對應團隊（或未指派）為「其他」。 */
  label: string
  /** 團隊識別（DASHBOARD_TEAMS 的 group，或 "other"）。 */
  teamKey: string
  /** 團隊 Capacity＝成員 Capacity（可用點數）總和（不含未指派者）。 */
  capacity: number
  /** 已配點數＝成員已分派點數總和。 */
  assignedPoints: number
  members: MemberAssignment[]
}

/** 指派給「無對應團隊」或「未指派」者的團隊 fallback。 */
export const OTHER_TEAM = { label: "其他", teamKey: "other" }

export interface AssignmentStatusInput {
  /** 已過濾的 Dev-Task（與主表同源）。 */
  tasks: readonly {
    points: number | null
    assigneeDisplayName: string | null
    assigneeAccountId: string | null
  }[]
  /** accountId → 團隊 label 的映射（由團隊選單載入）；缺省者歸「其他」。 */
  teamOf: (accountId: string | null) => string | undefined
  /** 團隊的顯示順序（label）；越靠前越前面，未在此清單者排最後。 */
  teamOrder: readonly string[]
  /** 每人可用的點數（Capacity，依專案而定；Saku＝20、Telasa＝40）。 */
  perPersonCapacity: number
}

export function computeAssignmentStatus(
  input: AssignmentStatusInput
): TeamAssignment[] {
  const { tasks, teamOf, teamOrder, perPersonCapacity } = input

  // 依指派人彙整（accountId 為 null 的未指派任務歸為單一「未指派」）。
  const byAssignee = new Map<string, MemberAssignment>()
  for (const task of tasks) {
    const accountId = task.assigneeAccountId
    const key = accountId ?? "\u0000unassigned"
    let member = byAssignee.get(key)
    if (!member) {
      member = {
        name: task.assigneeDisplayName ?? (accountId === null ? "未指派" : accountId),
        assigneeAccountId: accountId,
        capacity: accountId === null ? null : perPersonCapacity,
        assignedPoints: 0,
      }
      byAssignee.set(key, member)
    }
    member.assignedPoints += task.points ?? 0
  }

  const assignees = [...byAssignee.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh")
  )

  // 依團隊分組；團隊層級彙總 Capacity 與已配點數。
  const byTeam = new Map<string, TeamAssignment>()
  const teamOfMember = (member: MemberAssignment) => {
    const label = teamOf(member.assigneeAccountId)
    return label ? { label, teamKey: label } : OTHER_TEAM
  }
  const newTeam = (label: string, teamKey: string): TeamAssignment => ({
    label,
    teamKey,
    capacity: 0,
    assignedPoints: 0,
    members: [],
  })
  for (const member of assignees) {
    const team = teamOfMember(member)
    let group = byTeam.get(team.teamKey)
    if (!group) {
      group = newTeam(team.label, team.teamKey)
      byTeam.set(team.teamKey, group)
    }
    group.members.push(member)
    group.assignedPoints += member.assignedPoints
    if (member.capacity !== null) group.capacity += member.capacity
  }

  const rank = new Map<string, number>(
    teamOrder.map((label, index) => [label, index])
  )
  return [...byTeam.values()].sort((a, b) => {
    const ra = rank.get(a.label)
    const rb = rank.get(b.label)
    if (ra === undefined && rb === undefined) return a.label.localeCompare(b.label, "zh")
    if (ra === undefined) return 1
    if (rb === undefined) return -1
    return ra - rb
  })
}
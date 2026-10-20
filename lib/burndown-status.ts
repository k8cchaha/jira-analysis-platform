/**
 * 燃盡圖下方「成員開發狀況」的純函數（無 I/O、無 `server-only`）。
 *
 * 以同一個 `computeBurndownSeries` 產出的「已過濾、已估計」Dev-Task 為輸入，
 * 依指派人（assignee）彙整每人的完成/未完成統計，再以團隊分組排序輸出。
 * client 端（`burndown-client.tsx`）繪製用；與圖表共用同一份過濾後資料，
 * 不重發 JQL。
 */

export interface AssigneeStatus {
  assigneeName: string
  assigneeAccountId: string | null
  /** 該指派人的總張數（已估計 Dev-Task）。 */
  totalTasks: number
  /** 已完成的張數（doneDate 在今天以前（含））。 */
  doneTasks: number
  /** 已完成的總 Story Points。 */
  donePoints: number
  /** 已完成的總 Actual Story Points（僅計有值的任務；未填不計）。 */
  doneActualPoints: number
  /** 未完成的張數。 */
  notDoneTasks: number
  /** 未完成的總 Story Points。 */
  notDonePoints: number
  /** 完成度 = donePoints / totalPoints × 100；totalPoints 為 0 時為 null。 */
  completionPercent: number | null
}

export interface TeamStatus {
  /** 團隊顯示名稱；無對應團隊（或未指派）為「其他」。 */
  label: string
  /** 團隊識別（DASHBOARD_TEAMS 的 group，或 "other"）。 */
  teamKey: string
  assignees: AssigneeStatus[]
  /** 團隊整體：總張數。 */
  totalTasks: number
  /** 團隊整體：已完成張數。 */
  doneTasks: number
  /** 團隊整體：未完成張數。 */
  notDoneTasks: number
  /** 團隊整體：已完成總 Story Points。 */
  donePoints: number
  /** 團隊整體：已完成總 Actual Story Points。 */
  doneActualPoints: number
  /** 團隊整體：未完成總 Story Points。 */
  notDonePoints: number
  /** 團隊整體：完成度 = donePoints / (donePoints + notDonePoints) × 100；無點數為 null。 */
  completionPercent: number | null
}

/** 指派給「無對應團隊」或「未指派」者的團隊 fallback。 */
export const OTHER_TEAM = { label: "其他", teamKey: "other" }

export interface BurndownStatusInput {
  /** 已過濾、已估計的 Dev-Task（來自 `computeBurndownSeries().tasks`）。 */
  tasks: readonly {
    points: number
    actualPoints: number | null
    doneDate: string | null
    assigneeDisplayName: string | null
    assigneeAccountId: string | null
  }[]
  /** 今天（`YYYY-MM-DD`）；doneDate 在此以前（含）才算完成。 */
  today: string
  /** accountId → 團隊 label 的映射（由團隊選單載入）；缺省者歸「其他」。 */
  teamOf: (accountId: string | null) => string | undefined
  /** 團隊的顯示順序（label）；越靠前越前面，未在此清單者排最後。 */
  teamOrder: readonly string[]
}

export function computeBurndownStatus(input: BurndownStatusInput): TeamStatus[] {
  const { tasks, today, teamOf, teamOrder } = input

  // 依指派人彙整。
  const byAssignee = new Map<string, AssigneeStatus>()
  for (const task of tasks) {
    const accountId = task.assigneeAccountId
    const key = accountId ?? "\u0000unassigned"
    let status = byAssignee.get(key)
    if (!status) {
      status = {
        assigneeName: task.assigneeDisplayName ?? (accountId === null ? "未指派" : accountId),
        assigneeAccountId: accountId,
        totalTasks: 0,
        doneTasks: 0,
        donePoints: 0,
        doneActualPoints: 0,
        notDoneTasks: 0,
        notDonePoints: 0,
        completionPercent: null,
      }
      byAssignee.set(key, status)
    }
    status.totalTasks += 1
    const done = task.doneDate !== null && task.doneDate <= today
    if (done) {
      status.doneTasks += 1
      status.donePoints += task.points
      if (task.actualPoints !== null) status.doneActualPoints += task.actualPoints
    } else {
      status.notDoneTasks += 1
      status.notDonePoints += task.points
    }
  }

  const assignees = [...byAssignee.values()]
  for (const status of assignees) {
    const total = status.donePoints + status.notDonePoints
    status.completionPercent = total > 0 ? Math.round((status.donePoints / total) * 1000) / 10 : null
  }
  // 依指派人名稱排序。
  assignees.sort((a, b) => a.assigneeName.localeCompare(b.assigneeName, "zh"))

  // 依團隊分組；團隊層級也彙總整組的完成/未完成統計。
  const byTeam = new Map<
    string,
    TeamStatus
  >()
  const teamKeyOf = (status: AssigneeStatus) => {
    const label = teamOf(status.assigneeAccountId)
    if (!label) return OTHER_TEAM
    return { label, teamKey: label }
  }
  const newTeam = (label: string, teamKey: string): TeamStatus => ({
    label,
    teamKey,
    assignees: [],
    totalTasks: 0,
    doneTasks: 0,
    notDoneTasks: 0,
    donePoints: 0,
    doneActualPoints: 0,
    notDonePoints: 0,
    completionPercent: null,
  })
  for (const status of assignees) {
    const team = teamKeyOf(status)
    let group = byTeam.get(team.teamKey)
    if (!group) {
      group = newTeam(team.label, team.teamKey)
      byTeam.set(team.teamKey, group)
    }
    group.assignees.push(status)
    group.totalTasks += status.totalTasks
    group.doneTasks += status.doneTasks
    group.notDoneTasks += status.notDoneTasks
    group.donePoints += status.donePoints
    group.doneActualPoints += status.doneActualPoints
    group.notDonePoints += status.notDonePoints
  }
  for (const group of byTeam.values()) {
    const total = group.donePoints + group.notDonePoints
    group.completionPercent = total > 0 ? Math.round((group.donePoints / total) * 1000) / 10 : null
  }

  const rank = new Map<string, number>(teamOrder.map((label, index) => [label, index]))
  const ordered = [...byTeam.values()].sort((a, b) => {
    const ra = rank.get(a.label)
    const rb = rank.get(b.label)
    if (ra === undefined && rb === undefined) return a.label.localeCompare(b.label, "zh")
    if (ra === undefined) return 1
    if (rb === undefined) return -1
    return ra - rb
  })

  return ordered
}
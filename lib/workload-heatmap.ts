/**
 * 工作量分析熱點圖的純函數（無 I/O、無 `server-only`）。
 *
 * 將完成 Dev-Task 的所選點數投影成數值任務，再按 (assignee, date) 分桶。
 * 提供每日與每週聚合；Story Points／Actual Story Points 共用來源與完成日，
 * 缺值不補零，切換只在站內重算，不重發 JQL。
 * 完成日由 server 使用下方既有 resolved／updated 推導規則解析。
 */

import { requireDate, shiftDate } from "./date-range.ts"
import type { MissingIssue } from "./jira-missing-data.ts"

/** 熱點圖的一張 Dev-Task（已估計；未估計者另列）。 */
export interface HeatmapTask {
  key: string
  /** 已估計的 Story Points。 */
  points: number
  /** 完成日（`YYYY-MM-DD`），**保證落在分析區間內**（由 `resolveCompletionDate` 決定）。 */
  doneDate: string
  /** 指派人 accountId；未指派為 null。 */
  assigneeAccountId: string | null
  /** 指派人顯示名稱；未指派為 null。 */
  assigneeDisplayName: string | null
}

/** 原始完成任務與兩種獨立點數；缺值不改變任務人口。 */
export interface WorkloadCompletedTask extends Omit<HeatmapTask, "points"> {
  points: number | null
  actualPoints: number | null
  summary: string | null
  parentIssueType: MissingIssue["parentIssueType"]
  /** 本次搜尋取得的目前狀態與 Resolution，不是完成日的歷史快照。 */
  status: string | null
  resolution: string | null
  /** Jira REST resolutiondate 欄位的 UTC+8 日曆日；不以 updated 或推導完成日補值。 */
  resolvedDate: string | null
}

export interface WorkloadCellSelection {
  accountId: string | null
  weekStart: string
}

export type WorkloadMetric = "points" | "actualPoints"
export const WORKLOAD_METRIC_LABELS: Record<WorkloadMetric, string> = {
  points: "Story Points",
  actualPoints: "Actual Story Points",
}

/** 熱點圖的一列（一位成員）。 */
export interface HeatmapRow {
  /** 列識別：accountId，未指派為 null。 */
  accountId: string | null
  displayName: string
  /** 團隊顯示名稱；無對應團隊或未指派為「其他」。 */
  teamLabel: string
  /** 團隊識別（`DASHBOARD_TEAMS` 的 group，或 OTHER_TEAM.teamKey）。 */
  teamKey: string
  /**
   * 逐日點數，與 `days` 同長同序。`null` 表示沒有可計入的所選點數
   * （沒有完成或未填該欄）；0 表示有完成且該欄為零。
   */
  cells: (number | null)[]
  /** 區間內完成的總點數。 */
  totalPoints: number
  /** 區間內有完成紀錄的天數。 */
  activeDays: number
}

export interface HeatmapUnestimated {
  key: string
  assigneeDisplayName: string | null
  assigneeAccountId: string | null
}

export interface WorkloadHeatmap {
  days: string[]
  rows: HeatmapRow[]
  /** 全域共用的級距上界（`HEATMAP_SCALE`），供圖說與上色使用。 */
  scale: readonly number[]
  /** 圖上所有格子的最大值（0 表示全空）。 */
  maxPoints: number
  /** 未估計的 Dev-Task（需補填的資料品質清單）。 */
  unestimated: HeatmapUnestimated[]
}

/** 週一起日不早於分析起日的週欄；from/to 為實際取得日期的涵蓋範圍，末週可不足一週。 */
export interface HeatmapWeek {
  start: string
  from: string
  to: string
  year: string
  dayCount: number
}

export interface WeeklyWorkloadHeatmap {
  weeks: HeatmapWeek[]
  rows: (Omit<HeatmapRow, "activeDays"> & { activeWeeks: number })[]
  scale: readonly number[]
  maxPoints: number
  unestimated: HeatmapUnestimated[]
}

/**
 * 格子深淺的級距上界：0 為空格，其餘四級為 1-2／3-5／6-9／10+。
 * 全圖共用同一把尺，因此可跨成員比較「誰在哪一天做得多」。
 */
export const HEATMAP_SCALE = [1, 3, 6, 10] as const

/** 團隊分析的基準時區：UTC+8。Jira 回傳 UTC，切日曆日一律先換到這個時區。 */
export const ANALYSIS_TIMEZONE_OFFSET_MINUTES = 480

/**
 * 把 Jira 的日期時間字串切成 **+0800** 的日曆日（`YYYY-MM-DD`）。
 *
 * **為什麼不能直接 `slice(0, 10)`**：Jira 回傳的是 UTC（如
 * `2026-11-03T16:30:00.000+0000`），直接切字串會得到 UTC 日期，於 +0800 之下
 * 00:00–08:00 完成的票會被歸到**前一天**。這是最容易靜默出錯的一處，因此
 * 一律先位移時區再取日期。
 *
 * 無法辨識的字串回 null，由呼叫端決定 fallback，不在此臆測。
 */
export function analysisCalendarDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed + ANALYSIS_TIMEZONE_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10)
}

/**
 * 解出一張 Dev-Task 在本次分析中的完成日。
 *
 * 撈票用的是 `status CHANGED TO "Done" DURING (...)`（事件），因此同一張票可能在
 * 多個區間被撈到——此投影以 `resolved` 參數決定日期，呼叫端傳入 Jira REST
 * `fields.resolutiondate`（不是 JQL 名稱 `resolved`），不代表重建歷史轉換時間：
 *
 * 1. `resolved` 有值且在區間內 → 用它。
 * 2. `resolved` 晚於區間訖日 → 夾到區間最後一天（該票在區間內確實在動）。
 * 3. `resolved` 早於區間起日 → **整張丟棄**（回 null）。這批票是因為別的時間點
 *    的轉換才被撈進來，不屬於本次分析。
 * 4. `resolved` 為空 → 改用 `updated`，規則同上（含早於區間即丟棄）。
 * 5. 兩者皆無法解析 → 視為在區間內完成，夾到區間最後一天（寧可留下也不靜默丟點）。
 *
 * **早於區間丟棄、晚於區間夾到末日，這個不對稱是刻意的**：早於區間代表這張票
 * 的完成不屬於本次分析；晚於區間代表它在區間內有活動，只是完成日被設得更晚。
 */
export function resolveCompletionDate({
  resolved,
  updated,
  range,
}: {
  resolved: unknown
  updated: unknown
  range: { from: string; to: string }
}): string | null {
  const resolvedDate = analysisCalendarDate(resolved)
  if (resolvedDate !== null) {
    if (resolvedDate < range.from) return null
    return resolvedDate > range.to ? range.to : resolvedDate
  }
  const updatedDate = analysisCalendarDate(updated)
  if (updatedDate !== null) {
    if (updatedDate < range.from) return null
    return updatedDate > range.to ? range.to : updatedDate
  }
  // 兩個欄位都無法解析：仍算在區間內完成（夾到末日），避免點數靜默消失。
  return range.to
}

/** 指派給「無對應團隊」或「未指派」者的團隊 fallback（與 `burndown-status.ts` 一致）。 */
const OTHER_TEAM = { label: "其他", teamKey: "other" }

/** 未指派的列識別；以不可能的帳號字元開頭，避免與真實 accountId 碰撞。 */
const UNASSIGNED_KEY = "\u0000unassigned"

/** 點數一律顯示到小數第一位，消除 0.1+0.2 等浮點誤差。 */
function roundPoints(value: number): number {
  return Math.round(value * 10) / 10
}

/** 取某格點數所屬的級距索引（0 = 空格、1..4 對應 `HEATMAP_SCALE`）。 */
export function heatmapLevel(points: number | null): number {
  if (points === null || points <= 0) return 0
  let level = 1
  for (let index = 0; index < HEATMAP_SCALE.length; index += 1) {
    if (points >= HEATMAP_SCALE[index]) level = index + 1
  }
  return level
}

/** 只投影已填的所選點數；零是有效值，缺值不以另一欄或零補齊。 */
export function projectWorkloadTasks(
  tasks: readonly WorkloadCompletedTask[],
  metric: WorkloadMetric
): HeatmapTask[] {
  return tasks.flatMap((task) => {
    const points = task[metric]
    return points === null ? [] : [{
      key: task.key,
      points,
      doneDate: task.doneDate,
      assigneeAccountId: task.assigneeAccountId,
      assigneeDisplayName: task.assigneeDisplayName,
    }]
  })
}

/** 與週格共用已取得日期及指標條件；只傳回實際貢獻該格的原始任務。 */
export function workloadCellTasks({
  tasks, metric, selection, week, days, from, to,
}: {
  tasks: readonly WorkloadCompletedTask[]
  metric: WorkloadMetric
  selection: WorkloadCellSelection
  week: HeatmapWeek
  days: readonly string[]
  from: string
  to: string
}): WorkloadCompletedTask[] {
  if (selection.weekStart !== week.start) return []
  const includedDays = new Set(days.filter((day) =>
    day >= from && day <= to && day >= week.from && day <= week.to
  ))
  return tasks.filter((task) => task.assigneeAccountId === selection.accountId &&
    task[metric] !== null && includedDays.has(task.doneDate))
}

/** 雙指標共用原有週聚合器；未指派缺值任務也保留一列，避免切換讓成員消失。 */
export function computeMetricWorkloadHeatmap({
  tasks, metric, unestimated = [], actualUnestimated = [], ...input
}: Omit<Parameters<typeof computeWeeklyWorkloadHeatmap>[0], "tasks"> & {
  tasks: readonly WorkloadCompletedTask[]
  metric: WorkloadMetric
  actualUnestimated?: readonly HeatmapUnestimated[]
}): WeeklyWorkloadHeatmap {
  const result = computeWeeklyWorkloadHeatmap({
    ...input,
    tasks: projectWorkloadTasks(tasks, metric),
    unestimated: metric === "points" ? unestimated : actualUnestimated,
  })
  const includedDays = new Set(input.days)
  if (!result.rows.some((row) => row.accountId === null) && tasks.some((task) =>
    task.assigneeAccountId === null && task.doneDate >= input.from &&
    task.doneDate <= input.to && includedDays.has(task.doneDate)
  )) {
    result.rows.push({
      accountId: null, displayName: "未指派", teamLabel: OTHER_TEAM.label, teamKey: OTHER_TEAM.teamKey,
      cells: result.weeks.map(() => null), totalPoints: 0, activeWeeks: 0,
    })
  }
  return result
}

/**
 * 以原始任務按週彙總，週合計後才取顯示精度（不可加總已四捨五入的每日格子）。
 * 排除週一起日早於分析起日的週；末週可不完整，只計已取得的區間內日期。
 * 任務只重映射至保留週，確保格值與總計不含被隱藏的週；不擴大查詢或改完成日。
 */
export function computeWeeklyWorkloadHeatmap(
  input: Parameters<typeof computeWorkloadHeatmap>[0]
): WeeklyWorkloadHeatmap {
  const includedDays = [...new Set(input.days)].filter((day) => day >= input.from && day <= input.to).sort()
  const dayToWeek = new Map<string, string>()
  const buckets = new Map<string, HeatmapWeek>()
  for (const day of includedDays) {
    const weekday = (new Date(requireDate(day)).getUTCDay() + 6) % 7
    const start = shiftDate(day, -weekday)
    if (start < input.from) continue
    dayToWeek.set(day, start)
    const existing = buckets.get(start)
    if (existing) {
      existing.to = day
      existing.dayCount += 1
    } else {
      buckets.set(start, { start, from: day, to: day, year: start.slice(0, 4), dayCount: 1 })
    }
  }
  const weeks = [...buckets.values()]
  const tasks = input.tasks.flatMap((task) => {
    const start = dayToWeek.get(task.doneDate)
    return start === undefined ? [] : [{ ...task, doneDate: start }]
  })
  const result = computeWorkloadHeatmap({
    ...input,
    from: weeks[0]?.start ?? input.from,
    to: weeks.at(-1)?.start ?? input.to,
    days: weeks.map((week) => week.start),
    tasks,
  })
  return {
    weeks,
    rows: result.rows.map(({ activeDays, ...row }) => ({ ...row, activeWeeks: activeDays })),
    scale: result.scale,
    maxPoints: result.maxPoints,
    unestimated: result.unestimated,
  }
}

export function computeWorkloadHeatmap({
  from,
  to,
  days,
  tasks,
  members,
  teamOf,
  teamOrder,
  unestimated = [],
}: {
  /** 區間起日（`YYYY-MM-DD`，含）。 */
  from: string
  /** 區間訖日（`YYYY-MM-DD`，含）。 */
  to: string
  /** 要顯示的日期（升冪、`YYYY-MM-DD`）；通常為 `from`..`to`，由呼叫端產生。 */
  days: readonly string[]
  tasks: readonly HeatmapTask[]
  /** 要顯示的成員列（含完全沒有活動者）；列順序由 teamOrder 與名稱決定。 */
  members: readonly { accountId: string; displayName: string }[]
  /** accountId → 團隊 label 的映射（由團隊選單載入）；缺省者歸「其他」。 */
  teamOf: (accountId: string | null) => string | undefined
  /** 團隊的顯示順序（label）；越靠前越前面，未在此清單者排最後。 */
  teamOrder: readonly string[]
  unestimated?: readonly HeatmapUnestimated[]
}): WorkloadHeatmap {
  // 逐日點數：accountId → date → points。完成日已由 `resolveCompletionDate` 保證
  // 落在區間內，這裡仍擋一次區間外者作防禦，但不再是主要的淘汰機制。
  const buckets = new Map<string, Map<string, number>>()
  for (const task of tasks) {
    if (task.doneDate < from || task.doneDate > to) continue
    const key = task.assigneeAccountId ?? UNASSIGNED_KEY
    let byDate = buckets.get(key)
    if (!byDate) {
      byDate = new Map<string, number>()
      buckets.set(key, byDate)
    }
    byDate.set(task.doneDate, (byDate.get(task.doneDate) ?? 0) + task.points)
  }

  // 列來源是「所選成員」而非 tasks：完全沒有活動的成員也要成列（該列全空）。
  const rows: Omit<HeatmapRow, "teamKey">[] = members.map((member) => {
    const byDate = buckets.get(member.accountId)
    const cells = days.map((date) => {
      const points = byDate?.get(date)
      return points === undefined ? null : roundPoints(points)
    })
    let total = 0
    let activeDays = 0
    for (const points of byDate?.values() ?? []) {
      total += points
      activeDays += 1
    }
    return {
      accountId: member.accountId,
      displayName: member.displayName,
      teamLabel: teamOf(member.accountId) ?? OTHER_TEAM.label,
      cells,
      totalPoints: roundPoints(total),
      activeDays,
    }
  })

  // 未指派的工作獨立一列（只在區間內真的有完成紀錄時才出現）。
  const unassignedByDate = buckets.get(UNASSIGNED_KEY)
  if (unassignedByDate) {
    let total = 0
    let activeDays = 0
    for (const points of unassignedByDate?.values() ?? []) {
      total += points
      activeDays += 1
    }
    rows.push({
      accountId: null,
      displayName: "未指派",
      teamLabel: OTHER_TEAM.label,
      cells: days.map((date) => {
        const points = unassignedByDate?.get(date)
        return points === undefined ? null : roundPoints(points)
      }),
      totalPoints: roundPoints(total),
      activeDays,
    })
  }

  // 排序：先依 teamOrder 的團隊順序（未列者最後），再依成員顯示名稱。
  const teamRank = (label: string): number => {
    const index = teamOrder.indexOf(label)
    return index === -1 ? teamOrder.length : index
  }
  rows.sort((left, right) => {
    const byTeam = teamRank(left.teamLabel) - teamRank(right.teamLabel)
    if (byTeam !== 0) return byTeam
    if (left.teamLabel !== right.teamLabel) return left.teamLabel.localeCompare(right.teamLabel)
    return left.displayName.localeCompare(right.displayName)
  })

  let maxPoints = 0
  for (const row of rows) {
    for (const cell of row.cells) if (cell !== null && cell > maxPoints) maxPoints = cell
  }

  return {
    days: [...days],
    rows: rows.map((row) => ({
      ...row,
      teamKey: row.teamLabel === OTHER_TEAM.label ? OTHER_TEAM.teamKey : row.teamLabel,
    })),
    scale: HEATMAP_SCALE,
    maxPoints: roundPoints(maxPoints),
    unestimated: [...unestimated],
  }
}
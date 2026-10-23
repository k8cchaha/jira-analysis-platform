/**
 * Burn Down 系列的純函數（無 I/O、無 `server-only`）。
 *
 * server（`lib/jira-burndown.ts`）與 browser（`burndown-client.tsx`）共用同一份
 * 聚合邏輯，團隊過濾時在站內以同樣公式重算，不重發 JQL。
 */

export interface BurndownTask {
  key: string
  summary: string | null
  /** 已估計的 Story Points。 */
  points: number
  /** Actual Story Points（實際花費）；未填（無法提供）為 null。 */
  actualPoints: number | null
  /** 已移至 Done 的日期（`YYYY-MM-DD`）；尚未完成為 null。 */
  doneDate: string | null
  /** 在 sprint 開始日**之前**就已 Done（故 doneDate 在 sprint 範圍外、未經每日掃描標記）。 */
  doneBeforeStart: boolean
  /** Dev-Task 目前的 Jira 狀態名稱（如 "In Progress"）；未知為 null。 */
  status: string | null
  /** 母票目前狀態名稱（如 "Request Info"）；無母票或未知為 null。 */
  parentStatus: string | null
  /** 母票目前指派人顯示名稱；無母票或未指派為 null。 */
  parentAssigneeDisplayName: string | null
  /** 指派人顯示名稱；未指派為 null。 */
  assigneeDisplayName: string | null
  /** 指派人 accountId；未指派為 null。 */
  assigneeAccountId: string | null
  /** 母票的 Issue Type（彈窗每列左側的 type icon）。 */
  parentIssueType: { status: "known"; name: string } | { status: "none" | "unknown" }
}

export interface BurndownUnestimated {
  key: string
  summary: string | null
  assigneeDisplayName: string | null
  assigneeAccountId: string | null
  parentIssueType: { status: "known"; name: string } | { status: "none" | "unknown" }
}

export interface BurndownDay {
  /** `YYYY-MM-DD`。 */
  date: string
  /** 當天切到 Done 的點數。 */
  donePoints: number
  /** 歸到該天（最後一天節點）的「受阻母票 Dev-Task」點數；僅 >0 時有值、畫深灰長條。 */
  blockedPoints?: number
  /** 截至當天累計剩餘點數；未到當天（未來）為 null、不畫。 */
  remainingPoints: number | null
  /** 理想線在當天的值（等速下降）。 */
  idealPoints: number
}

export interface BurndownSeries {
  totalPoints: number
  days: BurndownDay[]
  unestimated: BurndownUnestimated[]
  /** 過濾後的已估計 Dev-Task（供長條點擊彈窗顯示，與圖表同過濾範圍）。 */
  tasks: BurndownTask[]
}

/** 理想的 sprint 天數上限（天上的資料忽略）。 */
const MAX_SPRINT_DAYS = 60

/** 解析 `YYYY-MM-DD`，不合法拋錯（純函數，供呼叫端以受控輸入呼叫）。 */
function parseDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`Invalid date: ${date}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const value = new Date(Date.UTC(year, month - 1, day))
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date: ${date}`)
  }
  return value
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** 把 `YYYY-MM-DD` 往後（正）或往前（負）偏移 `days` 天（純函數）。 */
function shiftDate(date: string, days: number): string {
  const value = parseDate(date)
  value.setUTCDate(value.getUTCDate() + days)
  return toIsoDate(value)
}

/** 產生 [start, end] 每天的 `YYYY-MM-DD`（上限 60 天）。 */
function* eachDay(start: string, end: string): IterableIterator<string> {
  const current = parseDate(start)
  const limit = parseDate(end)
  const max = new Date(current.getTime())
  max.setUTCDate(max.getUTCDate() + (MAX_SPRINT_DAYS - 1))
  const cap = limit < max ? limit : max
  for (;;) {
    yield toIsoDate(current)
    if (current >= cap) return
    current.setUTCDate(current.getUTCDate() + 1)
  }
}

/** 理想線：從 start 的 total，等速降到 end 的 0。 */
function remainingAt(total: number, date: string, start: string, end: string): number {
  const totalMs = parseDate(end).getTime() - parseDate(start).getTime()
  if (totalMs <= 0) return total
  const elapsedMs = parseDate(date).getTime() - parseDate(start).getTime()
  const fraction = Math.min(1, Math.max(0, elapsedMs / totalMs))
  return Math.round(total * (1 - fraction) * 10) / 10
}

function matchesScope(
  accountId: string | null,
  accountIds: ReadonlySet<string> | null
): boolean {
  if (accountIds === null) return true
  return accountId !== null && accountIds.has(accountId)
}

/** 母票目前狀態是否落在「受阻」集合（沒有集合就不套用）。 */
function isParentBlocked(
  task: BurndownTask,
  blockedParentStatuses: ReadonlySet<string> | null | undefined
): boolean {
  if (blockedParentStatuses === null || blockedParentStatuses === undefined) return false
  return task.parentStatus !== null && blockedParentStatuses.has(task.parentStatus)
}

/**
 * 依選定的指派人群組（`accountIds`）重算燃盡系列。
 *
 * - `accountIds === null` → 全體（不含團隊過濾）。
 * - `tasks` 只算 assignee ∈ accountIds 的已估計任務；`unestimated` 只保留
 *   assignee ∈ accountIds 的未估計任務。
 * - 每天 done 點數只累計 `task.doneDate === date` 的命中任務；`date > today`
 *   的 `remainingPoints` 為 null（未到、不畫）。
 * - `throughDate`（可選）：串流已逐日掃描到的最新日期。實際剩餘線只畫到
 *   `date <= throughDate`，之後還未掃描的天一律 null（不一次畫完、逐日長出）；
 *   未提供（一次算完）時等同 `today`，畫到今天為止。
 * - `days` 最前面含一個「空起點格」（`startDate` 前一天，remaining＝total），
 *   x=0 的初始值讓實際線與理想線對齊。其 `donePoints` 顯示「sprint 開始前就
 *   Done」的點數（client 以綠色長條呈現），不累計 sprint 內每日 done。
 * - `blockedParentStatuses`（可選）：勾選「受阻母票計為已完成」時，母票目前狀態
 *   ∈ 此集合的 Dev-Task 視為「已完成」。這些點數**全部歸到**「目前的最後一天」
 *   （`effectiveThrough`，即 `throughDate ?? today`）這一個節點：該天多放一段
 *   `blockedPoints` 深灰長條、剩餘也多扣這量；**之前每一天的長條與曲線不受影響**，
 *   故不像 `doneBeforeStart` 那樣開局就壓低整條剩餘線。
 */
export function computeBurndownSeries({
  startDate,
  endDate,
  today,
  throughDate,
  tasks,
  unestimated,
  accountIds,
  blockedParentStatuses,
}: {
  startDate: string
  endDate: string
  today: string
  /** 串流已掃描到的最新日期；省略＝一次算完（畫到今天）。 */
  throughDate?: string | null
  tasks: readonly BurndownTask[]
  unestimated: readonly BurndownUnestimated[]
  accountIds: ReadonlySet<string> | null
  /** 受阻母票的狀態集合（見上）；未提供或 null＝不套用受阻視為完成。 */
  blockedParentStatuses?: ReadonlySet<string> | null
}): BurndownSeries {
  let totalPoints = 0
  const byDate = new Map<string, number>()
  // sprint 開始日前就已 Done 的點數（空起點格的綠色長條）：這批已完成、也計入
  // 剩餘/總點數——它們在每日 `runningDone` 計算前就先從剩餘中扣掉，且總點數本身
  // 已有含它們（`sprintDevTasksJql` 不限制完成日期）。
  let preSprintDonePoints = 0
  // 勾選「受阻母票計為已完成」的點數：母票受阻的 Dev-Task 全部歸到「目前的最後
  // 一天」節點（`blockedDonePoints` 匯總）、疊成深灰長條並在那天扣剩餘；**不**
  // 在開局壓線。
  let blockedDonePoints = 0
  for (const task of tasks) {
    if (!matchesScope(task.assigneeAccountId, accountIds)) continue
    totalPoints += task.points
    if (task.doneBeforeStart) {
      preSprintDonePoints += task.points
      continue
    }
    // 受阻母票的 Dev-Task：點數匯總，歸到最後一天節點（不進每日 byDate）。
    if (isParentBlocked(task, blockedParentStatuses)) {
      blockedDonePoints += task.points
      continue
    }
    // 未來還沒到：完成尚未發生，累計剩餘點數暫不列入（原始 else 分支亦不會查 future）。
    if (task.doneDate !== null && !(task.doneDate > today)) {
      byDate.set(task.doneDate, (byDate.get(task.doneDate) ?? 0) + task.points)
    }
  }

  // 總點數四捨五入到小數第一位，消除浮點累加誤差；理想線／每日剩餘與顯示共用同值。
  const roundedTotal = Math.round(totalPoints * 10) / 10

  const filteredUnestimated = unestimated.filter((issue) =>
    matchesScope(issue.assigneeAccountId, accountIds)
  )
  const filteredTasks = tasks.filter((task) =>
    matchesScope(task.assigneeAccountId, accountIds)
  )

  // 理想線起點 = 空起點格日期：從 remainingStart（總點數 − 開局已完成）開始
  // 全程等速傾斜到 endDate 的 0，而非從 startDate 才開始下降（避免頂端一段
  // 水平停在 total）。開局已完成的部分在 sprint 開始前就消耗，不列入理想範圍。
  const idealStart = shiftDate(startDate, -1)

  // 只要有任何一筆「今天以前已完成」的記錄，實際剩餘線才有可信的下降資料；
  // 否則（例如串流初期資料未到、或 sprint 至今全未完成）所有天的 remainingPoints
  // 都為 null，實際線不畫——不先畫一條還沒有資料支持的平線。
  // sprint 開始前就 Done（preSprintDonePoints）也算已完成的記錄。受阻母票
  // （blockedDonePoints）**不算**：它的點數歸到最後一天節點，不應讓過去每一天
  // 因此冒出受到影響的曲線。
  const hasDoneRecord =
    preSprintDonePoints > 0 ||
    tasks.some(
      (task) =>
        matchesScope(task.assigneeAccountId, accountIds) &&
        task.doneDate !== null &&
        task.doneDate <= today
    )

  const roundedPreSprintDone = Math.round(preSprintDonePoints * 10) / 10
  const roundedBlockedDone = Math.round(blockedDonePoints * 10) / 10
  // 理想線／實際剩餘線的共同起點：總點數扣除「開局前就已 Done」的部分，因為
  // 這些點數在 sprint 開始前就已消耗，不屬於 sprint 期間要「燃」的剩餘範圍。
  // （受阻母票**不**從此起點扣——屬「目前起視為完成」的最小影響，理想線不受影響。）
  const roundedRemainingStart = roundedTotal - roundedPreSprintDone
  const days: BurndownDay[] = [
    // x=0 的空起點格：sprint 開跑前一天。實際剩餘線與理想線都從
    // remainingStart（＝總點數 − 開局已完成）出發並在 x 軸對齊。此格不累計
    // sprint 內的每日 done，但顯示「sprint 開始前就已 Done」的點數（綠色長條）。
    {
      date: idealStart,
      donePoints: roundedPreSprintDone,
      remainingPoints: hasDoneRecord ? roundedRemainingStart : null,
      idealPoints: roundedRemainingStart,
    },
  ]

  // 實際剩餘線的「畫到哪」：串流已逐日掃描到的最新日期；未提供＝畫到今天。
  // 超過此限（串流尚未掃描到）的天 remaining 為 null，避免一收到第一筆完成
  // 資料就把整段畫完。
  const effectiveThrough = throughDate ?? today
  // 剩餘＝總點數 − 已完成。sprint 開始前就 Done 的點數先扣（開局即已完成），
  // 之後逐日再加扣當天完成的點數，讓剩餘線反映「第一天的實際點已落後理想線」。
  // 受阻母票的點數**不**在開局扣：全部歸到 `effectiveThrough` 那天節點。
  let runningDone = roundedPreSprintDone
  for (const date of eachDay(startDate, endDate)) {
    const donePoints = Math.round((byDate.get(date) ?? 0) * 10) / 10
    const future = date > today
    const beyondStream = date > effectiveThrough
    // 受阻點數只放在「目前的最後一天」節點（可見區內），疊在當天完成長條之上。
    const blocked = date === effectiveThrough ? roundedBlockedDone : 0
    // 只有「今天以前（含）」且「串流已掃描到」的完成才往前累計剩餘點數。
    runningDone += donePoints
    days.push({
      date,
      donePoints,
      blockedPoints: blocked > 0 ? blocked : undefined,
      remainingPoints:
        future || !hasDoneRecord || beyondStream
          ? null
          : roundedTotal - runningDone - blocked,
      idealPoints:
        roundedTotal === 0 ? 0 : remainingAt(roundedRemainingStart, date, idealStart, endDate),
    })
  }

  return { totalPoints: roundedTotal, days, unestimated: filteredUnestimated, tasks: filteredTasks }
}
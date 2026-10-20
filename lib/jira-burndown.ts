import "server-only"

import {
  getJiraToken,
  JiraAuthorizationError,
  type JiraCredentials,
} from "@/lib/jira-token"
import { searchJiraIssues, dashboardJiraBaseUrl } from "@/lib/jira-dashboard"
import {
  sprintParentIssuesJql,
  sprintDevTasksJql,
  sprintDevTasksDoneOnJql,
} from "@/lib/jira-jql"
import { STORY_POINTS_FIELD, ACTUAL_STORY_POINTS_FIELD } from "@/lib/jira-fields"
import {
  computeBurndownSeries,
  type BurndownDay,
  type BurndownTask,
  type BurndownUnestimated,
} from "@/lib/burndown-series"
import type { MissingIssue } from "@/lib/jira-missing-data"
import type { SprintRecord } from "@/lib/jira-sprint-data"

export class JiraBurndownError extends Error {
  constructor(readonly code: BurndownErrorCode, message: string) {
    super(message)
    this.name = "JiraBurndownError"
  }
}
export type BurndownErrorCode =
  | "reauthorize"
  | "invalid_response"
  | "limit"
  | "request_failed"

export type { BurndownDay, BurndownTask, BurndownUnestimated }

/**
 * 燃盡圖資料。`tasks` 保留每張已估計 Dev-Task 的 assignee 與完成日期，
 * client 可在站內依團隊成員重算（`lib/burndown-series.ts`），不必重發 JQL。
 */
export interface BurndownData {
  sprint: Pick<SprintRecord, "id" | "name" | "startDate" | "endDate">
  /** server 決定的參照日（`YYYY-MM-DD`）；團隊過濾時以此為「今天」。 */
  today: string
  /** 已估計 Dev-Task 的 Story Points 加總（燃盡圖的基底總量）。 */
  totalPoints: number
  /** 每張已估計 Dev-Task（供站內團隊過濾重算）。 */
  tasks: BurndownTask[]
  /** Story Points 為空的 Dev-Task（需團隊補填的資料品質清單）。 */
  unestimated: BurndownUnestimated[]
  /** startDate..endDate 每一天，含理想線與依日期推算的目前線。 */
  days: BurndownDay[]
  /** 是否完成（母票為空或資料過少視為完成但為空）。 */
  empty: boolean
}

const MAX_DEVTASKS = 5_000
/** 每日查詢的天數上限（防止超長 sprint 產生大量查詢）。 */
const MAX_DAILY_QUERIES = 60

function pointValue(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new JiraBurndownError(
      "invalid_response",
      "Jira 回傳了無法識別的 Story Points，無法提供精確結果。"
    )
  }
  // 統一四捨五入到小數第一位，讓所有下游顯示一致。
  return Math.round(value * 10) / 10
}

/**
 * Actual Story Points 的寬鬆解析：非負有限數字才採用，否則回 null（未填或不可用）。
 * Actual 僅供彈窗/加總展示，不值得因格式異常中斷整個燃盡圖，故不像 `pointValue`
 * 那樣對非法值拋錯。統一四捨五入到小數第一位。
 */
function actualPointValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
  return Math.round(value * 10) / 10
}

/**
 * 燃盡圖的「基底」資料（步驟 1+2 的結果，尚未做逐日 done-at 標記）。
 * SSE 路由先把這一塊送給 client 畫出圖表骨架；逐日資料以 `iterateDoneDays`
 * 流式補上。以 `YYYY-MM-DD` `today` 與 credential 注入，維持純、可測。
 */
export interface BurndownBase {
  sprint: Pick<SprintRecord, "id" | "name" | "startDate" | "endDate">
  today: string
  empty: boolean
  parentKeys: string[]
  totalPoints: number
  /** 已估計 Dev-Task，`doneDate` 全為 null（尚未標記）。 */
  tasks: BurndownTask[]
  unestimated: BurndownUnestimated[]
}

/**
 * 步驟 1+2：撈此 sprint 的母票再撈全部 Dev-Task，算出 `totalPoints` 與
 * tasks / unestimated。不發逐日查詢。`empty` 時回空白基底。
 */
export async function getBurndownBase(
  sprint: SprintRecord,
  today: string,
  credentials: JiraCredentials
): Promise<BurndownBase> {
  // 1. 撈此 sprint 的母票（Story / Task / Bug）。
  const parentKeys = new Set<string>()
  let parents = 0
  for await (const issues of searchJiraIssues(
    credentials,
    sprintParentIssuesJql(sprint.id),
    []
  )) {
    for (const issue of issues) {
      parents += 1
      parentKeys.add(issue.key)
      if (parents > MAX_DEVTASKS) {
        throw new JiraBurndownError("limit", "此 Sprint 的票數過多，無法提供精確結果。")
      }
    }
  }

  const empty = parentKeys.size === 0
  const unestimated: BurndownUnestimated[] = []
  const tasks: BurndownTask[] = []
  const keys = [...parentKeys]
  let total = 0

  if (!empty) {
    // 2. 撈全部 Dev-Task：給 tasks 填上 points / actualPoints / assignee，未估計進清單。
    for await (const issues of searchJiraIssues(
      credentials,
      sprintDevTasksJql(keys),
      ["summary", "assignee", "parent", STORY_POINTS_FIELD, ACTUAL_STORY_POINTS_FIELD]
    )) {
      for (const issue of issues) {
        const points = pointValue(issue.fields[STORY_POINTS_FIELD])
        if (points === null) {
          unestimated.push({
            key: issue.key,
            summary:
              typeof issue.fields.summary === "string" ? issue.fields.summary : null,
            assigneeDisplayName: assigneeDisplayName(issue.fields.assignee),
            assigneeAccountId: assigneeAccountId(issue.fields.assignee),
            parentIssueType: parentIssueTypeOf(issue.fields.parent),
          })
          continue
        }
        tasks.push({
          key: issue.key,
          summary:
            typeof issue.fields.summary === "string" ? issue.fields.summary : null,
          points,
          actualPoints: actualPointValue(issue.fields[ACTUAL_STORY_POINTS_FIELD]),
          doneDate: null,
          assigneeDisplayName: assigneeDisplayName(issue.fields.assignee),
          assigneeAccountId: assigneeAccountId(issue.fields.assignee),
          parentIssueType: parentIssueTypeOf(issue.fields.parent),
        })
        total += points
      }
    }
  }

  const roundedTotal = Math.round(total * 10) / 10
  return {
    sprint: { id: sprint.id, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate },
    today,
    empty,
    parentKeys: keys,
    totalPoints: roundedTotal,
    tasks,
    unestimated,
  }
}

/**
 * 步驟 3：逐日撈「當天切到 Done」的 Dev-Task，逐日 `yield { date, keys }`。
 * 以 key 傳遞最小化 payload，client 端自對應到 task。錯誤（limit /
 * invalid_response / reauthorize）直接往上拋，由呼叫端（`getBurndownData`
 * 或 SSE 路由）決定如何處理。
 */
export async function* iterateDoneDays(
  sprint: Pick<SprintRecord, "id" | "startDate" | "endDate">,
  today: string,
  credentials: JiraCredentials,
  parentKeys: string[]
): AsyncGenerator<{ date: string; keys: string[] }> {
  // 未來（超過今天）尚未發生，不發查詢。
  for (const date of eachDayUpTo(sprint.startDate, sprint.endDate, today)) {
    const keys: string[] = []
    for await (const issues of searchJiraIssues(
      credentials,
      sprintDevTasksDoneOnJql(parentKeys, date),
      [STORY_POINTS_FIELD]
    )) {
      for (const issue of issues) keys.push(issue.key)
    }
    yield { date, keys }
  }
}

export async function getBurndownData(
  sprint: SprintRecord,
  today = new Date().toISOString().slice(0, 10)
): Promise<BurndownData> {
  let credentials
  try {
    credentials = await getJiraToken()
  } catch (error) {
    if (error instanceof JiraAuthorizationError) {
      throw new JiraBurndownError(
        error.code === "invalid_configuration" ? "request_failed" : "reauthorize",
        "無法讀取 Jira 登入狀態，請重新授權。"
      )
    }
    throw new JiraBurndownError("request_failed", "無法取得 Jira 登入資料。")
  }

  const base = await getBurndownBase(sprint, today, credentials)
  if (base.empty) {
    return {
      sprint: base.sprint,
      today,
      totalPoints: 0,
      tasks: [],
      unestimated: base.unestimated,
      days: [],
      empty: true,
    }
  }

  // 3. 逐日把 doneDate 刻回對應 task，再算完整系列（維持既有行為）。
  const byKey = new Map(base.tasks.map((task) => [task.key, task]))
  for await (const { date, keys } of iterateDoneDays(
    sprint,
    today,
    credentials,
    base.parentKeys
  )) {
    for (const key of keys) {
      const task = byKey.get(key)
      if (task) task.doneDate = date
    }
  }

  const series = computeBurndownSeries({
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    today,
    tasks: base.tasks,
    unestimated: base.unestimated,
    accountIds: null, // 全體（站內團隊過濾由 client 重算）
  })

  return {
    sprint: base.sprint,
    today,
    totalPoints: series.totalPoints,
    tasks: series.tasks,
    unestimated: series.unestimated,
    days: series.days,
    empty: false,
  }
}

/** 產生 [start, end] 每天但只到 today（含）、最多 60 天的 `YYYY-MM-DD`。 */
function* eachDayUpTo(
  start: string,
  end: string,
  today: string
): IterableIterator<string> {
  const current = parseDate(start)
  const capped = parseDate(today < end ? today : end)
  const stop = capped < maxDay(current) ? capped : maxDay(current)
  for (;;) {
    yield toIsoDate(current)
    if (current >= stop) return
    current.setUTCDate(current.getUTCDate() + 1)
  }
}

function maxDay(start: Date): Date {
  const day = new Date(start.getTime())
  day.setUTCDate(day.getUTCDate() + (MAX_DAILY_QUERIES - 1))
  return day
}

function parseDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) {
    throw new JiraBurndownError("invalid_response", "Sprint 日期格式無效。")
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const value = new Date(Date.UTC(year, month - 1, day))
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    throw new JiraBurndownError("invalid_response", "Sprint 日期無效。")
  }
  return value
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** 從 Jira assignee 物件取出顯示名稱（可能為 null）。 */
function assigneeDisplayName(value: unknown): string | null {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.displayName === "string" && record.displayName.trim().length > 0) {
      return record.displayName
    }
  }
  return null
}

/** 從 Jira assignee 物件取出 accountId（可能為 null）。 */
function assigneeAccountId(value: unknown): string | null {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.accountId === "string" && record.accountId.trim().length > 0) {
      return record.accountId
    }
  }
  return null
}

/** 從 Jira `parent` 欄位取出母票的 Issue Type（known / none / unknown）。 */
function parentIssueTypeOf(
  value: unknown
): MissingIssue["parentIssueType"] {
  if (value === null || value === undefined) return { status: "none" }
  if (typeof value !== "object") return { status: "unknown" }
  const parent = value as Record<string, unknown>
  const nested = parent.fields
  const name = recordFieldName(nested)
  return name ? { status: "known", name } : { status: "unknown" }
}

function recordFieldName(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const issuetype = record.issuetype
  if (typeof issuetype === "object" && issuetype !== null) {
    const name = (issuetype as Record<string, unknown>).name
    if (typeof name === "string" && name.trim().length > 0) return name
  }
  return null
}

export { dashboardJiraBaseUrl as burndownJiraBaseUrl }
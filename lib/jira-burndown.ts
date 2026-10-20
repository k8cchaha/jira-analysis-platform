import "server-only"

import { getJiraToken, JiraAuthorizationError } from "@/lib/jira-token"
import { searchJiraIssues, dashboardJiraBaseUrl } from "@/lib/jira-dashboard"
import {
  sprintParentIssuesJql,
  sprintDevTasksJql,
  sprintDevTasksDoneOnJql,
} from "@/lib/jira-jql"
import { STORY_POINTS_FIELD } from "@/lib/jira-fields"
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
  return value
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
  const keys = [...parentKeys]

  if (!empty) {
    // 2. 撈全部 Dev-Task：給 totalTasks 填上 points / assignee，未估計進清單。
    const tasks: BurndownTask[] = []
    const byKey = new Map<string, BurndownTask>()
    for await (const issues of searchJiraIssues(
      credentials,
      sprintDevTasksJql(keys),
      ["summary", "assignee", "parent", STORY_POINTS_FIELD]
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
        const task: BurndownTask = {
          key: issue.key,
          summary:
            typeof issue.fields.summary === "string" ? issue.fields.summary : null,
          points,
          doneDate: null,
          assigneeDisplayName: assigneeDisplayName(issue.fields.assignee),
          assigneeAccountId: assigneeAccountId(issue.fields.assignee),
          parentIssueType: parentIssueTypeOf(issue.fields.parent),
        }
        tasks.push(task)
        byKey.set(task.key, task)
      }
    }

    // 3. 逐日撈「當天切到 Done」的 Dev-Task，把 doneDate 刻回對應 task。
    //    未來（超過今天）尚未發生，不發查詢。
    for (const date of eachDayUpTo(sprint.startDate, sprint.endDate, today)) {
      for await (const issues of searchJiraIssues(
        credentials,
        sprintDevTasksDoneOnJql(keys, date),
        [STORY_POINTS_FIELD]
      )) {
        for (const issue of issues) {
          const task = byKey.get(issue.key)
          if (task) task.doneDate = date
        }
      }
    }

    const series = computeBurndownSeries({
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      today,
      tasks,
      unestimated,
      accountIds: null, // 全體（站內團隊過濾由 client 重算）
    })

    return {
      sprint: { id: sprint.id, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate },
      today,
      totalPoints: series.totalPoints,
      tasks: series.tasks,
      unestimated: series.unestimated,
      days: series.days,
      empty,
    }
  }

  // 無母票：回傳空白、不含任何內容，不發 Dev-Task / 每日查詢。
  return {
    sprint: { id: sprint.id, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate },
    today,
    totalPoints: 0,
    tasks: [],
    unestimated,
    days: [],
    empty,
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
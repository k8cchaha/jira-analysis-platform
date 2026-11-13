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
} from "@/lib/jira-jql"
import { STORY_POINTS_FIELD, ACTUAL_STORY_POINTS_FIELD } from "@/lib/jira-fields"
import {
  computeBurndownSeries,
  burndownLastDate,
  type BurndownDay,
  type BurndownTask,
  type BurndownUnestimated,
} from "@/lib/burndown-series"
import { getVerifiedJiraAccountTimeZone, JiraAccountTimeZoneError } from "@/lib/jira-account-timezone"
import { createBurndownCompletionResolver } from "@/lib/burndown-completion"
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
  | "retry"

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
 * 完整燃盡圖資料集：所有分頁及 resolutiondate 投影完成後才回傳。
 * SSE 一次傳送所有完成 markers，client 只做站內團隊重算。
 */
export interface BurndownBase {
  sprint: Pick<SprintRecord, "id" | "name" | "startDate" | "endDate">
  today: string
  empty: boolean
  parentKeys: string[]
  totalPoints: number
  /** 已估計 Dev-Task，完成日期／開局標記已完整投影。 */
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
  let lastDate: string | null
  try { lastDate = burndownLastDate(sprint.startDate, sprint.endDate, today) }
  catch { throw new JiraBurndownError("invalid_response", "Sprint 日期無效。") }
  // 1. 撈此 sprint 的母票（Story / Task / Bug）。request `status` 與 `assignee`，
  //    供「受阻母票計為已完成」的 checkbox 與受阻彈窗（母票狀態／母票 Owner）用。
  const parentKeys = new Set<string>()
  const parentInfo = new Map<string, { status: string | null; assigneeName: string | null }>()
  let parents = 0
  for await (const issues of searchJiraIssues(
    credentials,
    sprintParentIssuesJql(sprint.id),
    ["status", "assignee"]
  )) {
    for (const issue of issues) {
      parents += 1
      parentKeys.add(issue.key)
      parentInfo.set(issue.key, {
        status: statusName(issue.fields.status),
        assigneeName: assigneeDisplayName(issue.fields.assignee),
      })
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
    const timeZone = await jiraAccountTimeZone(credentials)
    let resolveCompletion: ReturnType<typeof createBurndownCompletionResolver>
    try { resolveCompletion = createBurndownCompletionResolver(timeZone, sprint.startDate, lastDate) }
    catch { throw new JiraBurndownError("invalid_response", "Jira 帳號時區無效，無法判定完成日期。") }
    // 2. 撈全部 Dev-Task：給 tasks 填上 points / actualPoints / assignee，未估計進清單。
    for await (const issues of searchJiraIssues(
      credentials,
      sprintDevTasksJql(keys),
      ["summary", "status", "assignee", "parent", "resolutiondate", STORY_POINTS_FIELD, ACTUAL_STORY_POINTS_FIELD]
    )) {
      for (const issue of issues) {
        const points = pointValue(issue.fields[STORY_POINTS_FIELD])
        let completion: ReturnType<typeof resolveCompletion>
        try { completion = resolveCompletion(issue.fields.resolutiondate) }
        catch { throw new JiraBurndownError("invalid_response", "Jira 回傳了無法識別的 Resolved 日期，無法提供精確結果。") }
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
          ...completion,
          status: statusName(issue.fields.status),
          parentStatus: parentStatusOf(issue.fields.parent, parentInfo),
          parentAssigneeDisplayName: parentAssigneeOf(issue.fields.parent, parentInfo),
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

/** Compatibility boundary: preserve the existing Burndown error codes and messages. */
async function jiraAccountTimeZone(credentials: JiraCredentials): Promise<string> {
  try { return await getVerifiedJiraAccountTimeZone(credentials) }
  catch (error) {
    if (error instanceof JiraAccountTimeZoneError) {
      throw new JiraBurndownError(error.code === "forbidden" ? "request_failed" : error.code, error.message)
    }
    throw error
  }
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

/** 從 Jira status 欄位（`fields.status`）取名稱；缺失/格式異常回 null。 */
function statusName(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const name = (value as Record<string, unknown>).name
  return typeof name === "string" && name.trim().length > 0 ? name : null
}

/** 從 Dev-Task 的 `parent` 欄位查母票目前狀態；無母票/母票不在清單回 null。 */
function parentStatusOf(
  value: unknown,
  parentInfo: ReadonlyMap<string, { status: string | null; assigneeName: string | null }>
): string | null {
  return parentInfoOf(value, parentInfo)?.status ?? null
}

/** 從 Dev-Task 的 `parent` 欄位查母票目前指派人顯示名稱；無母票/未指派回 null。 */
function parentAssigneeOf(
  value: unknown,
  parentInfo: ReadonlyMap<string, { status: string | null; assigneeName: string | null }>
): string | null {
  return parentInfoOf(value, parentInfo)?.assigneeName ?? null
}

/** 依母票 key 查 `parentInfo`；`value` 無 key 或不在清單回 undefined。 */
function parentInfoOf(
  value: unknown,
  parentInfo: ReadonlyMap<string, { status: string | null; assigneeName: string | null }>
): { status: string | null; assigneeName: string | null } | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const key = (value as Record<string, unknown>).key
  if (typeof key !== "string" || key.trim().length === 0) return undefined
  return parentInfo.get(key)
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
import "server-only"

import {
  getJiraToken,
  JiraAuthorizationError,
  type JiraCredentials,
} from "@/lib/jira-token"
import { searchJiraIssues } from "@/lib/jira-dashboard"
import { workloadDevTasksJql } from "@/lib/jira-jql"
import { STORY_POINTS_FIELD, ACTUAL_STORY_POINTS_FIELD, JIRA_FIELDS } from "@/lib/jira-fields"
import { shiftDate, type DateRange } from "@/lib/date-range"
import { resolveDashboardScope } from "@/lib/jira-dashboard-lookups"
import type { DashboardFilter, ResolvedDashboardScope } from "@/lib/jira-dashboard-filter"
import {
  resolveCompletionDate,
  analysisCalendarDate,
  type WorkloadCompletedTask,
  type HeatmapUnestimated,
} from "@/lib/workload-heatmap"

export class JiraWorkloadError extends Error {
  constructor(readonly code: WorkloadErrorCode, message: string) {
    super(message)
    this.name = "JiraWorkloadError"
  }
}
export type WorkloadErrorCode =
  | "reauthorize"
  | "invalid_response"
  | "limit"
  | "request_failed"

export type { WorkloadCompletedTask, HeatmapUnestimated }

/**
 * 熱點圖的基底：區間內完成 Dev-Task 的兩種點數，加上已驗證的 scope。
 * `tasks` 保留 assignee 與完成日期，client 切換指標不必重發 JQL。
 */
export interface WorkloadHeatmapBase {
  /** server 決定的參照日（`YYYY-MM-DD`）。 */
  today: string
  scope: ResolvedDashboardScope
  range: DateRange
  /** 要顯示的日期（升冪、`YYYY-MM-DD`）。 */
  days: string[]
  /** 屬於本區間的完成 Dev-Task，兩欄可獨立缺值。 */
  tasks: WorkloadCompletedTask[]
  /** Story Points 為空的 Dev-Task（需團隊補填的資料品質清單）。 */
  unestimated: HeatmapUnestimated[]
  /** Actual Story Points 為空，範圍與 Story Points 資料品質清單一致。 */
  actualUnestimated: HeatmapUnestimated[]
  /** 是否沒有任何已完成紀錄（畫面顯示空狀態）。 */
  empty: boolean
}

/**
 * 取得 credentials 並解析出已驗證的 scope。授權與範圍的單一入口：
 * **失敗即失敗**，不退回 self、也不放大查詢範圍。
 *
 * `refresh` 比照燃盡圖傳 true，讓長串流中仍可能再簽發 token。
 */
export async function workloadScope(filter: DashboardFilter): Promise<{
  scope: ResolvedDashboardScope
  credentials: JiraCredentials
}> {
  let credentials: JiraCredentials
  try {
    credentials = await getJiraToken(true)
  } catch (error) {
    if (error instanceof JiraAuthorizationError) {
      throw new JiraWorkloadError(
        jiraAuthorizationCode(error),
        error.code === "invalid_configuration"
          ? "Jira OAuth 設定不完整，請聯繫管理員。"
          : "無法讀取 Jira 登入狀態，請重新授權。"
      )
    }
    throw new JiraWorkloadError("request_failed", "無法取得 Jira 登入資料。")
  }
  return { scope: await resolveDashboardScope(filter, credentials), credentials }
}

/**
 * 一次查詢取回區間內曾經轉為 Done 的 Dev-Task，並就地解出每張票的完成日。
 *
 * 完成日以 Jira REST `resolutiondate` 為準（`resolveCompletionDate`，一律 +0800 切日曆日）；
 * 不屬於本區間者（完成日早於 `from`）直接淘汰，不進 `tasks` 也不計點。
 * `range` 與 `today` 應已由呼叫端驗證。
 */
export async function getWorkloadHeatmapBase(
  scope: ResolvedDashboardScope,
  range: DateRange,
  today: string,
  credentials: JiraCredentials
): Promise<WorkloadHeatmapBase> {
  // 未來日尚未發生，不畫；`days` 只到 min(to, today)。
  const last = range.to < today ? range.to : today
  const days: string[] = []
  if (last >= range.from) {
    let current = range.from
    for (;;) {
      days.push(current)
      if (current >= last) break
      current = shiftDate(current, 1)
    }
  }

  const tasks: WorkloadCompletedTask[] = []
  const unestimated: HeatmapUnestimated[] = []
  const actualUnestimated: HeatmapUnestimated[] = []
  // 同一張票可能因 `CHANGED` 的語意被重複回傳（見 `workloadDevTasksJql` 說明）；
  // 以 key 去重，確保每張票只計一次點、只落一格。
  const seen = new Set<string>()
  for await (const issues of searchJiraIssues(
    credentials,
    workloadDevTasksJql(scope, range),
    ["summary", "assignee", "resolutiondate", "updated", "parent", "status", "resolution", STORY_POINTS_FIELD, ACTUAL_STORY_POINTS_FIELD]
  )) {
    for (const issue of issues) {
      if (seen.has(issue.key)) continue
      seen.add(issue.key)

      const assigneeId = assigneeAccountId(issue.fields.assignee)
      const assigneeName = assigneeDisplayName(issue.fields.assignee)
      // 缺值清單先於完成日判定；任一指標未填都不排除另一指標的完成任務。
      const points = pointValue(issue.fields[STORY_POINTS_FIELD], JIRA_FIELDS.storyPoints.name)
      const actualPoints = pointValue(issue.fields[ACTUAL_STORY_POINTS_FIELD], JIRA_FIELDS.actualStoryPoints.name)
      const missing = { key: issue.key, assigneeDisplayName: assigneeName, assigneeAccountId: assigneeId }
      if (points === null) unestimated.push(missing)
      if (actualPoints === null) actualUnestimated.push(missing)
      // 完成日早於區間 → 這張票不屬於本次分析，整張丟棄（不進格子、不計總數）。
      const doneDate = resolveCompletionDate({
        resolved: issue.fields.resolutiondate,
        updated: issue.fields.updated,
        range,
      })
      if (doneDate === null) continue

      tasks.push({
        key: issue.key,
        points,
        actualPoints,
        doneDate,
        assigneeAccountId: assigneeId,
        assigneeDisplayName: assigneeName,
        summary: displayText(issue.fields.summary),
        parentIssueType: parentIssueType(issue.fields.parent),
        status: namedValue(issue.fields.status),
        resolution: namedValue(issue.fields.resolution),
        resolvedDate: analysisCalendarDate(issue.fields.resolutiondate),
      })
    }
  }

  const empty = tasks.length === 0 && unestimated.length === 0 && actualUnestimated.length === 0
  return { today, scope, range: { ...range, to: last }, days, tasks, unestimated, actualUnestimated, empty }
}

function pointValue(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new JiraWorkloadError(
      "invalid_response",
      `Jira 回傳了無法識別的 ${fieldName}，無法提供精確結果。`
    )
  }
  return Math.round(value * 10) / 10
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function displayText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}
function namedValue(value: unknown): string | null {
  return record(value) ? displayText(value.name) : null
}
function parentIssueType(value: unknown): WorkloadCompletedTask["parentIssueType"] {
  if (value === null) return { status: "none" }
  if (!record(value) || !record(value.fields)) return { status: "unknown" }
  const name = namedValue(value.fields.issuetype)
  return name === null ? { status: "unknown" } : { status: "known", name }
}

function assigneeDisplayName(value: unknown): string | null {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.displayName === "string" && record.displayName.trim().length > 0) {
      return record.displayName
    }
  }
  return null
}

function assigneeAccountId(value: unknown): string | null {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.accountId === "string" && record.accountId.trim().length > 0) {
      return record.accountId
    }
  }
  return null
}

export { jiraAuthorizationCode as workloadAuthorizationCode }
/** 讓 route 能把授權錯誤轉成統一的 code，不需自行判斷子類別。 */
function jiraAuthorizationCode(error: JiraAuthorizationError): WorkloadErrorCode {
  return error.code === "invalid_configuration" ? "request_failed" : "reauthorize"
}
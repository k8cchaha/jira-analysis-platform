import "server-only"

import { auth } from "@/auth"
import { getJiraToken } from "@/lib/jira-token"
import { dashboardJiraBaseUrl, JiraDashboardError, searchJiraIssues } from "@/lib/jira-dashboard"
import { resolveDashboardScope } from "@/lib/jira-dashboard-lookups"
import { SELF_FILTER, DashboardFilterError, type DashboardFilter } from "@/lib/jira-dashboard-filter"
import { scrumBoardDevTasksJql } from "@/lib/jira-jql"
import type { ScrumBoardCard, ScrumBoardData, ScrumColumnKey } from "@/lib/jira-scrum-board"

/**
 * Scrum Board（儀表板下方三欄看板，跨專案）的資料。**套用上方 Dashboard 的 assignee scope**
 * （self / person / team），只顯示該範圍內的 active Dev-Task；另外可疊加看板自己的
 * 「近 boardDays 天建立/更新」條件。`boardDays` 為 null 表示看板不套重近條件。
 *
 * 每一張 Dev-Task 依其自身 status 分到三欄（Done 已移除、不撈），並從母票的 issue type
 * 取卡片外框/背景色（Story / Task / Bug）。非 self scope（person / team）時額外投影 assignee
 * 顯示名稱，供卡片右上角標示指派對象。
 */
export async function getScrumBoardData(filter: DashboardFilter = SELF_FILTER, boardDays: number | null): Promise<ScrumBoardData> {
  const session = await auth()
  if (!session?.user?.id) throw new JiraDashboardError("reauthorize", "登入狀態已失效，請重新登入。")
  if (boardDays !== null) validateDays(boardDays)
  const credentials = await getJiraToken()
  const scope = await resolveDashboardScope(filter, credentials)
  const showAssignee = scope.mode !== "self"

  const columns: Record<ScrumColumnKey, ScrumBoardCard[]> = {
    todo: [], inProgress: [], inReview: [],
  }

  for await (const issues of searchJiraIssues(
    credentials,
    scrumBoardDevTasksJql(scope, boardDays),
    ["summary", "status", "parent", ...(showAssignee ? ["assignee"] : [])]
  )) {
    for (const issue of issues) {
      const status = statusName(issue.fields.status)
      if (!status) continue // 缺少 status 的 Dev-Task 無法歸欄，跳過（不應發生）。
      const assignee = issue.fields.assignee
      const assigneeDisplayName = showAssignee && assignee !== null && assignee !== undefined
        ? displayNameOf(assignee) : null
      columns[columnOf(status)].push({
        key: issue.key,
        summary: typeof issue.fields.summary === "string" ? issue.fields.summary : null,
        status,
        parentIssueType: parentIssueTypeOf(issue.fields.parent),
        ...(showAssignee ? { assigneeDisplayName } : {}),
      })
    }
  }

  return { columns, jiraBaseUrl: dashboardJiraBaseUrl(), readOnly: true }
}

/** 正整數（看板自己的「近 X 天建立/更新」）。沿用 dashboardDays 的校驗，但允許 null=不套。 */
function validateDays(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DashboardFilterError("近 X 天必須是大於 0 的整數。")
  }
}

/** 依 Dev-Task 自身 status 名稱（小寫）歸欄；Done 已被 JQL 排除，無法辨識者一律落 `todo`，避免丟資料。 */
function columnOf(status: string): ScrumColumnKey {
  switch (status.toLowerCase()) {
    case "in progress": return "inProgress"
    case "in review": return "inReview"
    default: return "todo"
  }
}

/** 從 Jira status 欄位取出狀態名稱；缺失/格式異常回 null。 */
function statusName(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const name = (value as Record<string, unknown>).name
  return typeof name === "string" && name.trim().length > 0 ? name : null
}

/** 從 Jira `assignee` 欄位取出顯示名稱；缺失/格式異常回 null。 */
function displayNameOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const displayName = (value as Record<string, unknown>).displayName
  return typeof displayName === "string" && displayName.trim().length > 0 ? displayName : null
}

/** 從 `parent` 欄位取出母票的 Issue Type（known / none / unknown）。 */
function parentIssueTypeOf(value: unknown): ScrumBoardCard["parentIssueType"] {
  if (value === null || value === undefined) return { status: "none" }
  if (typeof value !== "object") return { status: "unknown" }
  const parent = value as Record<string, unknown>
  const name = recordFieldName(parent.fields)
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
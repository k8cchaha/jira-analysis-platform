import "server-only"

import { auth } from "@/auth"
import { getJiraToken } from "@/lib/jira-token"
import { countJiraIssues, searchJiraIssues, dashboardJiraBaseUrl, JiraDashboardError } from "@/lib/jira-dashboard"
import { resolveDashboardScope } from "@/lib/jira-dashboard-lookups"
import { SELF_FILTER, type DashboardFilter } from "@/lib/jira-dashboard-filter"
import { DASHBOARD_ALERT_KEYS, dashboardAlertJql, type DashboardAlertCountsByKind, type DashboardAlertKind, type DashboardAlertKey, type BugAlertDetails, type BugAlertIssue, isJiraDueDate, type DueReminderDetails, type DueReminderIssue, type PendingIssueDetails, type PendingIssueDetail } from "@/lib/jira-dashboard-alerts"

export async function getDashboardAlertCounts<K extends DashboardAlertKind>(kind: K, filter: DashboardFilter = SELF_FILTER): Promise<DashboardAlertCountsByKind[K]> {
  if (kind !== "bugs" && kind !== "pending" && kind !== "due") throw new JiraDashboardError("configuration", "查詢參數無效。")
  const session = await auth()
  if (!session?.user?.id) throw new JiraDashboardError("reauthorize", "登入狀態已失效，請重新登入。")
  const credentials = await getJiraToken()
  const scope = await resolveDashboardScope(filter, credentials)
  const queries = DASHBOARD_ALERT_KEYS[kind].map((key) => ({ key, jql: dashboardAlertJql(key, scope) }))
  const counts: Partial<Record<DashboardAlertKey, number>> = {}
  let cursor = 0
  let failed = false
  // Each card resolves its scope once and publishes only a complete group of counts.
  await Promise.all(Array.from({ length: Math.min(2, queries.length) }, async () => {
    while (!failed && cursor < queries.length) {
      const query = queries[cursor++]
      try { counts[query.key] = await countJiraIssues(credentials, query.jql) }
      catch (error) { failed = true; throw error }
    }
  }))
  if (kind === "bugs") {
    return { s0s1: counts.s0s1!, s2: counts.s2! } as DashboardAlertCountsByKind[K]
  }
  if (kind === "due") {
    return { overdue: counts.overdue!, upcoming: counts.upcoming! } as DashboardAlertCountsByKind[K]
  }
  return { inReview: counts.inReview!, requestInfo: counts.requestInfo! } as DashboardAlertCountsByKind[K]
}

export async function getBugAlertDetails(filter: DashboardFilter = SELF_FILTER): Promise<BugAlertDetails> {
  const session = await auth()
  if (!session?.user?.id) throw new JiraDashboardError("reauthorize", "登入狀態已失效，請重新登入。")
  const credentials = await getJiraToken()
  const scope = await resolveDashboardScope(filter, credentials)
  const showAssignee = scope.mode !== "self"
  const observedAt = Date.now()
  function text(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new JiraDashboardError("retry", "Bug 明細資料不完整，請重新載入。")
    return value
  }
  function named(value: unknown): string {
    if (typeof value !== "object" || value === null || !("name" in value)) throw new JiraDashboardError("retry", "Bug 明細資料不完整，請重新載入。")
    return text(value.name)
  }
  async function read(key: "s0s1" | "s2"): Promise<BugAlertIssue[]> {
    const issues: BugAlertIssue[] = []
    const fields = ["summary", "priority", "status", "updated", ...(showAssignee ? ["assignee"] : [])]
    for await (const page of searchJiraIssues(credentials, dashboardAlertJql(key, scope), fields)) {
      for (const issue of page) {
        const updated = Date.parse(text(issue.fields.updated))
        if (!Number.isFinite(updated)) throw new JiraDashboardError("retry", "Bug 未更新時間無效，請重新載入。")
        const assignee = issue.fields.assignee
        let assigneeDisplayName: string | null = null
        if (showAssignee && assignee !== null) {
          if (typeof assignee !== "object" || !("displayName" in assignee)) throw new JiraDashboardError("retry", "Bug Assignee 資料不完整，請重新載入。")
          assigneeDisplayName = text(assignee.displayName)
        }
        issues.push({
          id: issue.id, key: issue.key,
          summary: text(issue.fields.summary), priority: named(issue.fields.priority), status: named(issue.fields.status),
          updatedDays: updated > observedAt ? null : Math.floor((observedAt - updated) / 86_400_000),
          ...(showAssignee ? { assigneeDisplayName } : {}),
        })
      }
    }
    return issues
  }
  const [s0s1, s2] = await Promise.all([read("s0s1"), read("s2")])
  const ids = new Set(s0s1.map((issue) => issue.id))
  if (s2.some((issue) => ids.has(issue.id))) throw new JiraDashboardError("retry", "Bug 在查詢期間已變更，請重新載入。")
  s0s1.sort((a, b) => (a.priority === "Critical (P0)" ? 0 : 1) - (b.priority === "Critical (P0)" ? 0 : 1) || a.key.localeCompare(b.key))
  return { s0s1, s2, jiraBaseUrl: dashboardJiraBaseUrl(), readOnly: true }
}

export async function getDueReminderDetails(filter: DashboardFilter = SELF_FILTER): Promise<DueReminderDetails> {
  const session = await auth()
  if (!session?.user?.id) throw new JiraDashboardError("reauthorize", "登入狀態已失效，請重新登入。")
  const credentials = await getJiraToken()
  const scope = await resolveDashboardScope(filter, credentials)
  const showAssignee = scope.mode !== "self"
  function text(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new JiraDashboardError("retry", "到期提醒明細資料不完整，請重新載入。")
    return value
  }
  function named(value: unknown): string {
    if (typeof value !== "object" || value === null || !("name" in value)) throw new JiraDashboardError("retry", "到期提醒明細資料不完整，請重新載入。")
    return text(value.name)
  }
  async function read(key: "overdue" | "upcoming"): Promise<DueReminderIssue[]> {
    const issues: DueReminderIssue[] = []
    const fields = ["summary", "issuetype", "status", "duedate", ...(showAssignee ? ["assignee"] : [])]
    for await (const page of searchJiraIssues(credentials, dashboardAlertJql(key, scope), fields)) {
      for (const issue of page) {
        const dueDate = issue.fields.duedate
        if (!isJiraDueDate(dueDate)) throw new JiraDashboardError("retry", "Issue 到期日期無效，請重新載入。")
        let assigneeDisplayName: string | null = null
        const assignee = issue.fields.assignee
        if (showAssignee && assignee !== null) {
          if (typeof assignee !== "object" || !("displayName" in assignee)) throw new JiraDashboardError("retry", "Issue Assignee 資料不完整，請重新載入。")
          assigneeDisplayName = text(assignee.displayName)
        }
        issues.push({
          id: issue.id, key: issue.key, issueType: named(issue.fields.issuetype), summary: text(issue.fields.summary),
          status: named(issue.fields.status), dueDate, ...(showAssignee ? { assigneeDisplayName } : {}),
        })
      }
    }
    return issues
  }
  const [overdue, upcoming] = await Promise.all([read("overdue"), read("upcoming")])
  const ids = new Set(overdue.map((issue) => issue.id))
  if (upcoming.some((issue) => ids.has(issue.id))) throw new JiraDashboardError("retry", "Issue 在查詢期間已變更，請重新載入。")
  return { overdue, upcoming, jiraBaseUrl: dashboardJiraBaseUrl(), readOnly: true }
}

export async function getPendingIssueDetails(filter: DashboardFilter = SELF_FILTER): Promise<PendingIssueDetails> {
  const session = await auth()
  if (!session?.user?.id) throw new JiraDashboardError("reauthorize", "登入狀態已失效，請重新登入。")
  const credentials = await getJiraToken()
  const scope = await resolveDashboardScope(filter, credentials)
  const showAssignee = scope.mode !== "self"
  function text(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new JiraDashboardError("retry", "Issue 待處理明細資料不完整，請重新載入。")
    return value
  }
  function named(value: unknown): string {
    if (typeof value !== "object" || value === null || !("name" in value)) throw new JiraDashboardError("retry", "Issue 待處理明細資料不完整，請重新載入。")
    return text(value.name)
  }
  async function read(key: "inReview" | "requestInfo"): Promise<PendingIssueDetail[]> {
    const issues: PendingIssueDetail[] = []
    const fields = ["summary", "issuetype", "status", "updated", ...(showAssignee ? ["assignee"] : [])]
    for await (const page of searchJiraIssues(credentials, dashboardAlertJql(key, scope), fields)) {
      for (const issue of page) {
        const updated = text(issue.fields.updated)
        if (!Number.isFinite(Date.parse(updated))) throw new JiraDashboardError("retry", "Issue Updated 日期無效，請重新載入。")
        let assigneeDisplayName: string | null = null
        const assignee = issue.fields.assignee
        if (showAssignee && assignee !== null) {
          if (typeof assignee !== "object" || !("displayName" in assignee)) throw new JiraDashboardError("retry", "Issue Assignee 資料不完整，請重新載入。")
          assigneeDisplayName = text(assignee.displayName)
        }
        issues.push({
          id: issue.id, key: issue.key, issueType: named(issue.fields.issuetype), summary: text(issue.fields.summary),
          status: named(issue.fields.status), updated, ...(showAssignee ? { assigneeDisplayName } : {}),
        })
      }
    }
    return issues
  }
  const [inReview, requestInfo] = await Promise.all([read("inReview"), read("requestInfo")])
  const ids = new Set(inReview.map((issue) => issue.id))
  if (requestInfo.some((issue) => ids.has(issue.id))) throw new JiraDashboardError("retry", "Issue 在查詢期間已變更，請重新載入。")
  return { inReview, requestInfo, jiraBaseUrl: dashboardJiraBaseUrl(), readOnly: true }
}

import { DASHBOARD_JQL_LIMIT, DASHBOARD_MEMBER_LIMIT, DASHBOARD_PROJECTS, DashboardFilterError, dashboardDays, isDashboardAccountId, type ResolvedDashboardScope } from "./jira-dashboard-filter.ts"
import { MISSING_DATA_LIMIT, type MissingDataError } from "./jira-missing-data.ts"

export type DashboardAlertKind = "bugs" | "pending" | "due"
export interface BugAlertCounts { s0s1: number; s2: number }
export interface PendingIssueCounts { inReview: number; requestInfo: number }
export interface DueReminderCounts { overdue: number; upcoming: number }
export interface DashboardAlertCountsByKind { bugs: BugAlertCounts; pending: PendingIssueCounts; due: DueReminderCounts }
export type DashboardAlertResult =
  | { status: "success"; kind: "bugs"; counts: BugAlertCounts }
  | { status: "success"; kind: "pending"; counts: PendingIssueCounts }
  | { status: "success"; kind: "due"; counts: DueReminderCounts }
  | { status: "error"; error: MissingDataError }

export interface BugAlertIssue {
  id: string
  key: string
  priority: string
  summary: string
  status: string
  updatedDays: number | null
  assigneeDisplayName?: string | null
}
export interface BugAlertDetails {
  s0s1: BugAlertIssue[]
  s2: BugAlertIssue[]
  jiraBaseUrl: string | null
  readOnly: true
}
export type BugAlertDetailsResult =
  | { status: "success"; data: BugAlertDetails }
  | { status: "error"; error: MissingDataError }

export interface DueReminderIssue {
  id: string
  key: string
  issueType: string
  summary: string
  status: string
  dueDate: string
  assigneeDisplayName?: string | null
}
export interface DueReminderDetails {
  overdue: DueReminderIssue[]
  upcoming: DueReminderIssue[]
  jiraBaseUrl: string | null
  readOnly: true
}
export type DueReminderDetailsResult =
  | { status: "success"; data: DueReminderDetails }
  | { status: "error"; error: MissingDataError }

export interface PendingIssueDetail {
  id: string
  key: string
  issueType: string
  summary: string
  status: string
  updated: string
  assigneeDisplayName?: string | null
}
export interface PendingIssueDetails {
  inReview: PendingIssueDetail[]
  requestInfo: PendingIssueDetail[]
  jiraBaseUrl: string | null
  readOnly: true
}
export type PendingIssueDetailsResult =
  | { status: "success"; data: PendingIssueDetails }
  | { status: "error"; error: MissingDataError }

export function isJiraDueDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const DASHBOARD_ALERT_JQL = {
  s0s1: 'project in (sun, tkk, jiratry, pride) and issuetype = "Bug" AND priority IN ("Critical (P0)", "High (P1)") AND (statusCategory = "To Do" or status = "In Progress")',
  s2: 'project in (sun, tkk, jiratry, pride) and issuetype = "Bug" AND priority IN ("Medium (P2)") AND (statusCategory = "To Do" or status = "In Progress") and updated < -10d',
  inReview: 'issuetype in (DEV-Task, QA-Task) and status = "In Review"',
  requestInfo: 'status = "Request Info"',
  overdue: 'duedate < startOfDay() AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))',
  upcoming: 'duedate >= startOfDay() AND duedate < startOfDay("+3d") AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))',
} as const
export type DashboardAlertKey = keyof typeof DASHBOARD_ALERT_JQL
export const DASHBOARD_ALERT_KEYS = {
  bugs: ["s0s1", "s2"], pending: ["inReview", "requestInfo"], due: ["overdue", "upcoming"],
} as const

export function dashboardAlertJql(key: DashboardAlertKey, scope: ResolvedDashboardScope): string {
  if (!Object.hasOwn(DASHBOARD_ALERT_JQL, key)) throw new DashboardFilterError()
  let assignee = "assignee = currentUser()"
  let projects = ""
  let date = ""
  if (scope.mode !== "self") {
    dashboardDays(String(scope.days))
    date = ` AND created >= -${scope.days}d`
    if (
      !["person", "team-project"].includes(scope.mode) ||
      !scope.accountIds.length || scope.accountIds.length > DASHBOARD_MEMBER_LIMIT ||
      scope.accountIds.some((id) => !isDashboardAccountId(id)) ||
      (scope.mode === "person" && (scope.accountIds.length !== 1 || scope.projects.length !== 0)) ||
      scope.projects.some((project) => !DASHBOARD_PROJECTS.some((option) => option.key === project))
    ) throw new DashboardFilterError()
    const ids = [...new Set(scope.accountIds)].sort().map((id) => `"${id}"`)
    assignee = scope.mode === "person" ? `assignee = ${ids[0]}` : `assignee in (${ids.join(", ")})`
    if (scope.projects.length) projects = ` AND project in (${[...new Set(scope.projects)].sort().join(", ")})`
  }
  const jql = `(${DASHBOARD_ALERT_JQL[key]}) AND ${assignee}${date}${projects} ORDER BY key ASC`
  if (jql.length > DASHBOARD_JQL_LIMIT) throw new DashboardFilterError("所選成員產生的查詢過大，請縮小團隊範圍。")
  return jql
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MISSING_DATA_LIMIT
}
function invalidResult(): never { throw new Error("警示筆數回應不完整，請重新載入。") }

export function parseBugAlertDetailsResult(value: unknown): BugAlertDetailsResult {
  if (!record(value)) invalidResult()
  if (value.status === "error") {
    const result = parseDashboardAlertResult("bugs", value)
    if (result.status !== "error") invalidResult()
    return result
  }
  if (value.status !== "success" || !record(value.data) || value.data.readOnly !== true) invalidResult()
  const data = value.data
  let jiraBaseUrl: string | null = null
  if (data.jiraBaseUrl !== null) {
    if (typeof data.jiraBaseUrl !== "string") invalidResult()
    const url = new URL(data.jiraBaseUrl)
    if (url.protocol !== "https:" || url.origin !== data.jiraBaseUrl) invalidResult()
    jiraBaseUrl = url.origin
  }
  const ids = new Set<string>()
  function issues(value: unknown): BugAlertIssue[] {
    if (!Array.isArray(value) || value.length > MISSING_DATA_LIMIT) invalidResult()
    return value.map((issue) => {
      if (!record(issue) || typeof issue.id !== "string" || !/^\d{1,30}$/.test(issue.id) || ids.has(issue.id)) invalidResult()
      for (const field of ["key", "priority", "summary", "status"] as const) {
        if (typeof issue[field] !== "string" || !issue[field].trim()) invalidResult()
      }
      if (issue.updatedDays !== null && (typeof issue.updatedDays !== "number" || !Number.isSafeInteger(issue.updatedDays) || issue.updatedDays < 0)) invalidResult()
      if (issue.assigneeDisplayName !== undefined && issue.assigneeDisplayName !== null && typeof issue.assigneeDisplayName !== "string") invalidResult()
      ids.add(issue.id)
      return {
        id: issue.id, key: issue.key as string, priority: issue.priority as string, summary: issue.summary as string,
        status: issue.status as string, updatedDays: issue.updatedDays as number | null,
        ...(issue.assigneeDisplayName !== undefined ? { assigneeDisplayName: issue.assigneeDisplayName as string | null } : {}),
      }
    })
  }
  return { status: "success", data: { s0s1: issues(data.s0s1), s2: issues(data.s2), jiraBaseUrl, readOnly: true } }
}

export function parseDueReminderDetailsResult(value: unknown): DueReminderDetailsResult {
  if (!record(value)) invalidResult()
  if (value.status === "error") {
    const result = parseDashboardAlertResult("due", value)
    if (result.status !== "error") invalidResult()
    return result
  }
  if (value.status !== "success" || !record(value.data) || value.data.readOnly !== true) invalidResult()
  const data = value.data
  let jiraBaseUrl: string | null = null
  if (data.jiraBaseUrl !== null) {
    if (typeof data.jiraBaseUrl !== "string") invalidResult()
    const url = new URL(data.jiraBaseUrl)
    if (url.protocol !== "https:" || url.origin !== data.jiraBaseUrl) invalidResult()
    jiraBaseUrl = url.origin
  }
  const ids = new Set<string>()
  function issues(value: unknown): DueReminderIssue[] {
    if (!Array.isArray(value) || value.length > MISSING_DATA_LIMIT) invalidResult()
    return value.map((issue) => {
      if (!record(issue) || typeof issue.id !== "string" || !/^\d{1,30}$/.test(issue.id) || ids.has(issue.id)) invalidResult()
      for (const field of ["key", "issueType", "summary", "status"] as const) {
        if (typeof issue[field] !== "string" || !issue[field].trim()) invalidResult()
      }
      if (!isJiraDueDate(issue.dueDate)) invalidResult()
      if (issue.assigneeDisplayName !== undefined && issue.assigneeDisplayName !== null && typeof issue.assigneeDisplayName !== "string") invalidResult()
      ids.add(issue.id)
      return {
        id: issue.id, key: issue.key as string, issueType: issue.issueType as string, summary: issue.summary as string,
        status: issue.status as string, dueDate: issue.dueDate,
        ...(issue.assigneeDisplayName !== undefined ? { assigneeDisplayName: issue.assigneeDisplayName as string | null } : {}),
      }
    })
  }
  return { status: "success", data: { overdue: issues(data.overdue), upcoming: issues(data.upcoming), jiraBaseUrl, readOnly: true } }
}

export function parsePendingIssueDetailsResult(value: unknown): PendingIssueDetailsResult {
  if (!record(value)) invalidResult()
  if (value.status === "error") {
    const result = parseDashboardAlertResult("pending", value)
    if (result.status !== "error") invalidResult()
    return result
  }
  if (value.status !== "success" || !record(value.data) || value.data.readOnly !== true) invalidResult()
  const data = value.data
  let jiraBaseUrl: string | null = null
  if (data.jiraBaseUrl !== null) {
    if (typeof data.jiraBaseUrl !== "string") invalidResult()
    const url = new URL(data.jiraBaseUrl)
    if (url.protocol !== "https:" || url.origin !== data.jiraBaseUrl) invalidResult()
    jiraBaseUrl = url.origin
  }
  const ids = new Set<string>()
  function issues(value: unknown): PendingIssueDetail[] {
    if (!Array.isArray(value) || value.length > MISSING_DATA_LIMIT) invalidResult()
    return value.map((issue) => {
      if (!record(issue) || typeof issue.id !== "string" || !/^\d{1,30}$/.test(issue.id) || ids.has(issue.id)) invalidResult()
      for (const field of ["key", "issueType", "summary", "status", "updated"] as const) {
        if (typeof issue[field] !== "string" || !issue[field].trim()) invalidResult()
      }
      if (!Number.isFinite(Date.parse(issue.updated as string))) invalidResult()
      if (issue.assigneeDisplayName !== undefined && issue.assigneeDisplayName !== null && typeof issue.assigneeDisplayName !== "string") invalidResult()
      ids.add(issue.id)
      return {
        id: issue.id, key: issue.key as string, issueType: issue.issueType as string, summary: issue.summary as string,
        status: issue.status as string, updated: issue.updated as string,
        ...(issue.assigneeDisplayName !== undefined ? { assigneeDisplayName: issue.assigneeDisplayName as string | null } : {}),
      }
    })
  }
  return { status: "success", data: { inReview: issues(data.inReview), requestInfo: issues(data.requestInfo), jiraBaseUrl, readOnly: true } }
}

export function parseDashboardAlertResult(kind: "bugs", value: unknown): Extract<DashboardAlertResult, { kind: "bugs" } | { status: "error" }>
export function parseDashboardAlertResult(kind: "pending", value: unknown): Extract<DashboardAlertResult, { kind: "pending" } | { status: "error" }>
export function parseDashboardAlertResult(kind: "due", value: unknown): Extract<DashboardAlertResult, { kind: "due" } | { status: "error" }>
export function parseDashboardAlertResult(kind: DashboardAlertKind, value: unknown): DashboardAlertResult
export function parseDashboardAlertResult(kind: DashboardAlertKind, value: unknown): DashboardAlertResult {
  if (kind !== "bugs" && kind !== "pending" && kind !== "due") invalidResult()
  if (!record(value)) invalidResult()
  if (value.status === "error") {
    const error = value.error
    if (!record(error) || typeof error.code !== "string" || !["reauthorize", "forbidden", "retry", "configuration", "limit", "invalid_page"].includes(error.code) || typeof error.message !== "string" || !error.message.length || error.message.length > 2_000) invalidResult()
    return { status: "error", error: { code: error.code as MissingDataError["code"], message: error.message } }
  }
  if (value.status !== "success" || value.kind !== kind || !record(value.counts)) invalidResult()
  const values = value.counts
  if (kind === "bugs") {
    if (!count(values.s0s1) || !count(values.s2)) invalidResult()
    return { status: "success", kind, counts: { s0s1: values.s0s1, s2: values.s2 } }
  }
  if (kind === "due") {
    if (!count(values.overdue) || !count(values.upcoming)) invalidResult()
    return { status: "success", kind, counts: { overdue: values.overdue, upcoming: values.upcoming } }
  }
  if (!count(values.inReview) || !count(values.requestInfo)) invalidResult()
  return { status: "success", kind, counts: { inReview: values.inReview, requestInfo: values.requestInfo } }
}

import { JIRA_FIELDS, customFieldJql } from "./jira-fields.ts"
import { DASHBOARD_JQL_LIMIT, DASHBOARD_MEMBER_LIMIT, DASHBOARD_PROJECTS, DashboardFilterError, dashboardDays, isDashboardAccountId, type ResolvedDashboardScope } from "./jira-dashboard-filter.ts"
import type { MissingDataKind } from "./jira-missing-data.ts"

export const RECENT_ASSIGNED_ISSUES_SCOPE_JQL =
  "assignee = currentUser() AND created >= -30d"
export const RECENT_ASSIGNED_ISSUES_JQL =
  `${RECENT_ASSIGNED_ISSUES_SCOPE_JQL} ORDER BY created DESC`

export function recentAssignedIssuesUpdateJql(issueIds: readonly string[]): string {
  return `id in (${issueIds.join(", ")}) AND ${RECENT_ASSIGNED_ISSUES_SCOPE_JQL}`
}

export const POINTS_SCOPE_JQL =
  'issuetype in (DEV-Task, QA-Task) and resolution in (EMPTY, Done, Fixed)'

const storyPointsJql = customFieldJql(JIRA_FIELDS.storyPoints.id)
const actualStoryPointsJql = customFieldJql(JIRA_FIELDS.actualStoryPoints.id)

export const MISSING_POINTS_JQL =
  `${POINTS_SCOPE_JQL} and ((status = Done and ${actualStoryPointsJql} in (EMPTY, 0)) or (statusCategory not in ("To Do") and ${storyPointsJql} in (EMPTY, 0))) and assignee = currentUser()`

export const MISSING_DEFECT_CAUSE_JQL =
  `project in (sun, tkk, jiratry) and issuetype = bug and assignee = currentUser() and statusCategory != "To Do" and status not in ("In Progress", "Dev Ready") and resolution in (EMPTY, Done, Fixed) and ${JIRA_FIELDS.defectCause.jql} is EMPTY`

export function missingDataJql(kind: MissingDataKind) {
  return kind === "points" ? MISSING_POINTS_JQL : MISSING_DEFECT_CAUSE_JQL
}

export function missingDataReadJql(kind: MissingDataKind, scope: ResolvedDashboardScope): string {
  if (scope.mode === "self") return missingDataJql(kind)
  dashboardDays(String(scope.days))
  if (!scope.accountIds.length || scope.accountIds.length > DASHBOARD_MEMBER_LIMIT || scope.accountIds.some((id) => !isDashboardAccountId(id)) || scope.projects.some((project) => !DASHBOARD_PROJECTS.some((option) => option.key === project))) throw new DashboardFilterError()
  const assignees = [...new Set(scope.accountIds)].sort().map((id) => `"${id}"`).join(", ")
  const base = missingDataJql(kind).replace(/assignee = currentUser\(\)/i, `assignee in (${assignees})`)
  const date = `created >= -${scope.days}d`
  const projects = scope.projects.length ? ` AND project in (${[...new Set(scope.projects)].sort().join(", ")})` : ""
  const jql = `${base} AND ${date}${projects}`
  if (jql.length > DASHBOARD_JQL_LIMIT) throw new DashboardFilterError("所選成員產生的查詢過大，請縮小團隊範圍。")
  return jql
}

export function missingDataListJql(kind: MissingDataKind, scope: ResolvedDashboardScope): string {
  return `${missingDataReadJql(kind, scope)} ORDER BY key ASC`
}

export function missingDataUpdateJql(kind: MissingDataKind, issueIds: readonly string[]): string {
  return `(${missingDataJql(kind)}) AND id in (${issueIds.join(",")})`
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

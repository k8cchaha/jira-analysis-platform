import { DEV_TYPE_FIELD, JIRA_FIELDS, customFieldJql } from "./jira-fields.ts"
import { DASHBOARD_JQL_LIMIT, DASHBOARD_MEMBER_LIMIT, DASHBOARD_PROJECTS, DashboardFilterError, dashboardDays, isDashboardAccountId, type ResolvedDashboardScope } from "./jira-dashboard-filter.ts"
import type { MissingDataKind } from "./jira-missing-data.ts"

export const SPRINT_PROJECTS = [
  { label: "Saku", key: "SUN" },
  { label: "Telasa", key: "TKK" },
  { label: "Pride", key: "PRIDE" },
] as const
export type SprintProjectKey = (typeof SPRINT_PROJECTS)[number]["key"]

/**
 * 燃盡圖的查詢（Dev-Task Story Points、以母票的 Sprint 為準）。
 *
 * 只有頂層票（Story / Task / Bug）能掛 Sprint，Dev-Task 是 sub-task、
 * 無法直接進 Sprint，所以一律先以 `sprint = <id>` 撈母票、再以
 * `parent in (...)` 取其下的 Dev-Task。完整查詢統一放這裡，consumer
 * 不得自行組 JQL。
 */

/** 某 sprint 的母票（Story / Task / Bug）。 */
export function sprintParentIssuesJql(sprintId: number): string {
  return `sprint = ${sprintId} AND issuetype in (story, task, bug)`
}

/** 票種比例圓餅圖的母票票種；允許值限 Story / Task / Bug（Epic 與 Dev-Task 不算）。 */
export type ParentIssueType = "story" | "task" | "bug"

/**
 * 某 sprint 中、某單一票種的母票（票種比例圓餅圖的 Jira deep-link 用）。
 * 與 `sprintParentIssuesJql` 相同來源，但只取單一 `issuetype`，讓深連結
 * 「sprint = X AND issuetype = y」能精確對應該票種的母票。
 */
export function sprintParentIssuesOfTypeJql(sprintId: number, issueType: ParentIssueType): string {
  return `sprint = ${sprintId} AND issuetype = ${issueType}`
}

/**
 * 某 sprint 中、某單一**母票票種**之下的全部 Dev-Task（Dev-Task 票種比例圓餅圖的
 * Jira deep-link 用）。總覽圓餅圖以 Dev-Task 的 `parentIssueType` 分 Story／Task／Bug，
 * 因此深連結「sprint = X AND parent.issuetype = y AND issuetype = "Dev-Task"」能精確
 * 對應到該票種母票底下的 Dev-Task（與 `sprintDevTasksJql` 同屬 Dev-Task 資料源）。
 */
export function sprintDevTasksOfParentTypeJql(
  sprintId: number,
  issueType: ParentIssueType
): string {
  return `sprint = ${sprintId} AND parent.issuetype = ${issueType} AND issuetype = "Dev-Task"`
}

/** 某組母票之下的全部 Dev-Task（用於總點數與「未估計」清單）。 */
export function sprintDevTasksJql(parentKeys: readonly string[]): string {
  const keys = enforcedSortedKeys(parentKeys)
  return `parent in (${keys}) AND issuetype = "Dev-Task"`
}

/**
 * 某組母票之下的全部工作單（Dev-Task + QA-Task）。Planning 全頁以 Dev + QA
 * 為統一的工作單資料源，故主表、圓餅深連結與「未估計／未分派」清單都用這組
 * Dev+QA builder。`sprintDevTasksJql` 系列仍保留給燃盡圖（只算 Dev-Task）。
 */
export function sprintChildTasksJql(parentKeys: readonly string[]): string {
  const keys = enforcedSortedKeys(parentKeys)
  return `parent in (${keys}) AND issuetype in ("Dev-Task", "QA-Task")`
}

/**
 * 以 key 選取一群 Epic（Reporter View 需依「Epic 的 Reporter」分群）。只取 Epic，
 * 避免把其他票型誤帶入。空 key 清單回空字串（呼叫端應跳過查詢）。
 */
export function epicIssuesByKeyJql(epicKeys: readonly string[]): string {
  const keys = enforcedSortedKeys(epicKeys)
  if (!keys) return ""
  return `key in (${keys}) AND issuetype = "Epic"`
}

/** 某組母票之下、某單一母票票種（Story/Task/Bug）底下的全部工作單（圓餅圖深連結）。 */
export function sprintChildTasksOfParentTypeJql(
  sprintId: number,
  issueType: ParentIssueType
): string {
  return `sprint = ${sprintId} AND parent.issuetype = ${issueType} AND issuetype in ("Dev-Task", "QA-Task")`
}

/** 此 sprint 中、某單一 Dev Type 值底下的全部工作單（開發類型分佈圓餅圖深連結，Dev+QA）。 */
export function sprintChildTasksOfDevTypeJql(sprintId: number, devTypeValue: string): string {
  return `sprint = ${sprintId} AND ${customFieldJql(DEV_TYPE_FIELD)} = "${devTypeValue}" AND issuetype in ("Dev-Task", "QA-Task")`
}

/** 此 sprint 中、**未填** Dev Type 的全部工作單（開發類型分佈圓餅圖「未分類」段的深連結，Dev+QA）。 */
export function sprintChildTasksUnclassifiedDevTypeJql(sprintId: number): string {
  return `sprint = ${sprintId} AND ${customFieldJql(DEV_TYPE_FIELD)} is EMPTY AND issuetype in ("Dev-Task", "QA-Task")`
}

/** 某組母票之下、尚未估計 Story Points 的工作單（Planning 彈窗顯示用，Dev+QA）。 */
export function sprintChildTasksUnestimatedJql(parentKeys: readonly string[]): string {
  return `${sprintChildTasksJql(parentKeys)} AND ${storyPointsJql} in (Empty, 0)`
}

/** 某組母票之下、未指派人的工作單（Planning 彈窗顯示用，Dev+QA）。 */
export function sprintChildTasksUnassignedJql(parentKeys: readonly string[]): string {
  return `${sprintChildTasksJql(parentKeys)} AND assignee is empty`
}

/** 某組母票之下、在某一天切到 Done 的 Dev-Task（每日完成度）。 */
export function sprintDevTasksDoneOnJql(
  parentKeys: readonly string[],
  date: string
): string {
  const keys = enforcedSortedKeys(parentKeys)
  return `parent in (${keys}) AND issuetype = "Dev-Task" AND status CHANGED TO "Done" ON "${date}"`
}

/** 某組母票之下、在 `beforeDate` 之前就已切到 Done 的 Dev-Task（空起點格的綠色已完成量）。 */
export function sprintDevTasksDoneBeforeJql(
  parentKeys: readonly string[],
  beforeDate: string
): string {
  const keys = enforcedSortedKeys(parentKeys)
  return `parent in (${keys}) AND issuetype = "Dev-Task" AND status CHANGED TO "Done" BEFORE "${beforeDate}"`
}

/**
 * 儀表板下方的任務看板（跨專案）全部 active 開發單（Dev-Task + QA-Task）：套用上方
 * Dashboard scope 的 assignee（self→currentUser()；person→`=`；team→`in (...)`＋有選 project
 * 才加 project in (...)），person/team 並加 `created >= -Nd`。`boardDays` 非 null 時再疊加
 * 「近 X 天建立或更新」（`created` 或 `updated` 任一時點在 -Xd 內）；null 表示看板不套重近
 * 條件（只有 self 會在 UI 上提供這個開關，因 person/team 已有近-N 天限制）。Done 已移除欄位，
 * 故 JQL 用 `status not in ("Done")` 不撈完成任務。scope/`boardDays` 應已由呼叫端驗證。
 */
export function scrumBoardDevTasksJql(scope: ResolvedDashboardScope, boardDays: number | null): string {
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
  let recency = ""
  if (boardDays !== null) {
    dashboardDays(String(boardDays))
    recency = ` AND (created >= -${boardDays}d OR updated >= -${boardDays}d)`
  }
  const jql = `issuetype in ("Dev-Task", "QA-Task") AND status not in ("Done") AND ${assignee}${date}${projects}${recency} ORDER BY key ASC`
  if (jql.length > DASHBOARD_JQL_LIMIT) throw new DashboardFilterError("所選成員產生的查詢過大，請縮小團隊範圍。")
  return jql
}

/** 某組母票之下、尚未估計 Story Points 的 Dev-Task（Planning 彈窗顯示用）。 */
export function sprintUnestimatedJql(parentKeys: readonly string[]): string {
  return `${sprintDevTasksJql(parentKeys)} AND ${storyPointsJql} in (Empty, 0)`
}

/** 某組母票之下、未指派人的 Dev-Task（Planning 彈窗顯示用）。 */
export function sprintUnassignedJql(parentKeys: readonly string[]): string {
  return `${sprintDevTasksJql(parentKeys)} AND assignee is empty`
}

/** 驗證並轉成排序後、無重複的逗號分隔 key 字串，避免未驗證值直接進 JQL。 */
function enforcedSortedKeys(parentKeys: readonly string[]): string {
  const normalized = parentKeys.map((key) => key.trim()).filter((key) => key.length > 0)
  const unique = [...new Set(normalized)]
  return unique.sort().join(", ")
}

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
  inReview: 'status = "In Review"',
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

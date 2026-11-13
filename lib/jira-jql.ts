import { DEV_TYPE_FIELD, JIRA_FIELDS, customFieldJql } from "./jira-fields.ts"
import { DASHBOARD_JQL_LIMIT, DASHBOARD_MEMBER_LIMIT, DASHBOARD_PROJECTS, DashboardFilterError, dashboardDays, isDashboardAccountId, includesUnexpectedClosed, type DashboardReadOptions, type ResolvedDashboardScope } from "./jira-dashboard-filter.ts"
import { requireDateRange, type DateRange } from "./date-range.ts"
import type { MissingDataKind, WritableMissingDataKind } from "./jira-missing-data.ts"

export const SPRINT_PROJECTS = [
  { label: "Saku", key: "SUN" },
  { label: "Telasa", key: "TKK" },
  { label: "Pride", key: "PRIDE" },
] as const
export type SprintProjectKey = (typeof SPRINT_PROJECTS)[number]["key"]

/** Sprint review parents, explicitly intersected with the selected project. */
export function projectsAnalysisParentIssuesJql(project: SprintProjectKey, sprintId: number): string {
  if (!SPRINT_PROJECTS.some((option) => option.key === project) || !Number.isSafeInteger(sprintId) || sprintId < 1) throw new DashboardFilterError()
  return `project = ${project} AND sprint = ${sprintId} AND issuetype in (story, task, bug) ORDER BY key ASC`
}

/** Exact locally selected issue set for Jira navigation; no extra scope or population predicates. */
export function projectsAnalysisIssueIdsJql(ids: readonly string[]): string | null {
  if (!Array.isArray(ids)) throw new DashboardFilterError("Issue ID 無效。")
  for (const id of ids) {
    if (typeof id !== "string" || !/^[1-9]\d{0,29}$/.test(id)) throw new DashboardFilterError("Issue ID 無效。")
  }
  if (!ids.length) return null
  const jql = `id in (${[...new Set(ids)].sort().join(", ")}) ORDER BY key ASC`
  if (jql.length > DASHBOARD_JQL_LIMIT) throw new DashboardFilterError("分析查詢過大，請縮小範圍。")
  return jql
}

/** All Dev+QA children; no completion/created window and no implicit self scope. */
export function projectsAnalysisChildQueries(
  parentIds: readonly string[],
  issueTypeIds: readonly string[],
  accountIdsOrNull: readonly string[] | null,
): string[] {
  const numericIds = (ids: readonly string[]) => Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string" && /^[1-9]\d{0,29}$/.test(id))
  if (!numericIds(parentIds) || parentIds.length > 2_000 || !numericIds(issueTypeIds) || issueTypeIds.length !== 2 || new Set(issueTypeIds).size !== 2) throw new DashboardFilterError()
  if (accountIdsOrNull !== null && (!Array.isArray(accountIdsOrNull) || !accountIdsOrNull.length || accountIdsOrNull.length > DASHBOARD_MEMBER_LIMIT || accountIdsOrNull.some((id) => !isDashboardAccountId(id)))) throw new DashboardFilterError()
  const types = [...issueTypeIds].sort().join(", ")
  const assignee = accountIdsOrNull === null ? "" : ` AND assignee in (${[...new Set(accountIdsOrNull)].sort().map((id) => `"${id}"`).join(", ")})`
  const suffix = `) AND issuetype in (${types})${assignee} ORDER BY key ASC`
  const prefix = "parent in ("
  const queries: string[] = []
  let batch: string[] = []
  for (const id of [...new Set(parentIds)].sort()) {
    if (prefix.length + id.length + suffix.length > DASHBOARD_JQL_LIMIT) throw new DashboardFilterError("所選成員產生的查詢過大，請縮小團隊範圍。")
    if (batch.length >= 100 || prefix.length + [...batch, id].join(", ").length + suffix.length > DASHBOARD_JQL_LIMIT) {
      queries.push(`${prefix}${batch.join(", ")}${suffix}`)
      batch = []
    }
    batch.push(id)
  }
  if (batch.length) queries.push(`${prefix}${batch.join(", ")}${suffix}`)
  return queries
}

/**
 * 燃盡圖的查詢（Dev-Task Story Points、以母票的 Sprint 為準）。
 *
 * 只有頂層票（Story / Task / Bug）能掛 Sprint，Dev-Task 是 sub-task、
 * 無法直接進 Sprint，所以一律先以 `sprint = <id>` 撈母票、再以
 * `parent in (...)` 取其下的 Dev-Task。完整查詢統一放這裡，consumer
 * 不得自行組 JQL。
 */

/** 某 sprint 的母票（Story / Task / Bug）。
 *  對應真實 JQL：`sprint = <sprintId> AND issuetype in (story, task, bug)` */
export function sprintParentIssuesJql(sprintId: number): string {
  return `sprint = ${sprintId} AND issuetype in (story, task, bug)`
}

/** 票種比例圓餅圖的母票票種；允許值限 Story / Task / Bug（Epic 與 Dev-Task 不算）。 */
export type ParentIssueType = "story" | "task" | "bug"

/**
 * 某 sprint 中、某單一票種的母票（票種比例圓餅圖的 Jira deep-link 用）。
 * 與 `sprintParentIssuesJql` 相同來源，但只取單一 `issuetype`，讓深連結
 * 「sprint = X AND issuetype = y」能精確對應該票種的母票。
 * 對應真實 JQL：`sprint = <sprintId> AND issuetype = <issueType>`
 */
export function sprintParentIssuesOfTypeJql(sprintId: number, issueType: ParentIssueType): string {
  return `sprint = ${sprintId} AND issuetype = ${issueType}`
}

/**
 * 某 sprint 中、某單一**母票票種**之下的全部 Dev-Task（Dev-Task 票種比例圓餅圖的
 * Jira deep-link 用）。總覽圓餅圖以 Dev-Task 的 `parentIssueType` 分 Story／Task／Bug，
 * 因此深連結「sprint = X AND parent.issuetype = y AND issuetype = "Dev-Task"」能精確
 * 對應到該票種母票底下的 Dev-Task（與 `sprintDevTasksJql` 同屬 Dev-Task 資料源）。
 * 對應真實 JQL：`sprint = <sprintId> AND parent.issuetype = <issueType> AND issuetype = "Dev-Task"`
 */
export function sprintDevTasksOfParentTypeJql(
  sprintId: number,
  issueType: ParentIssueType
): string {
  return `sprint = ${sprintId} AND parent.issuetype = ${issueType} AND issuetype = "Dev-Task"`
}

/** 某組母票之下的全部 Dev-Task（用於總點數與「未估計」清單）。
 *  對應真實 JQL：`parent in (<keyA>, <keyB>, …) AND issuetype = "Dev-Task"` */
export function sprintDevTasksJql(parentKeys: readonly string[]): string {
  const keys = enforcedSortedKeys(parentKeys)
  return `parent in (${keys}) AND issuetype = "Dev-Task"`
}

/**
 * 某組母票之下的全部工作單（Dev-Task + QA-Task）。Planning 全頁以 Dev + QA
 * 為統一的工作單資料源，故主表、圓餅深連結與「未估計／未分派」清單都用這組
 * Dev+QA builder。`sprintDevTasksJql` 系列仍保留給燃盡圖（只算 Dev-Task）。
 * 對應真實 JQL：`parent in (<keyA>, <keyB>, …) AND issuetype in ("Dev-Task", "QA-Task")`
 */
export function sprintChildTasksJql(parentKeys: readonly string[]): string {
  const keys = enforcedSortedKeys(parentKeys)
  return `parent in (${keys}) AND issuetype in ("Dev-Task", "QA-Task")`
}

/**
 * 以 key 選取一群 Epic（Reporter View 需依「Epic 的 Reporter」分群）。只取 Epic，
 * 避免把其他票型誤帶入。空 key 清單回空字串（呼叫端應跳過查詢）。
 * 對應真實 JQL：`key in (<keyA>, <keyB>, …) AND issuetype = "Epic"`
 */
export function epicIssuesByKeyJql(epicKeys: readonly string[]): string {
  const keys = enforcedSortedKeys(epicKeys)
  if (!keys) return ""
  return `key in (${keys}) AND issuetype = "Epic"`
}

/** 某組母票之下、某單一母票票種（Story/Task/Bug）底下的全部工作單（圓餅圖深連結）。
 *  對應真實 JQL：`sprint = <sprintId> AND parent.issuetype = <issueType> AND issuetype in ("Dev-Task", "QA-Task")` */
export function sprintChildTasksOfParentTypeJql(
  sprintId: number,
  issueType: ParentIssueType
): string {
  return `sprint = ${sprintId} AND parent.issuetype = ${issueType} AND issuetype in ("Dev-Task", "QA-Task")`
}

/** 此 sprint 中、某單一 Dev Type 值底下的全部工作單（開發類型分佈圓餅圖深連結，Dev+QA）。
 *  對應真實 JQL：`sprint = <sprintId> AND cf[14642] = "<devTypeValue>" AND issuetype in ("Dev-Task", "QA-Task")` */
export function sprintChildTasksOfDevTypeJql(sprintId: number, devTypeValue: string): string {
  return `sprint = ${sprintId} AND ${customFieldJql(DEV_TYPE_FIELD)} = "${devTypeValue}" AND issuetype in ("Dev-Task", "QA-Task")`
}

/** 此 sprint 中、**未填** Dev Type 的全部工作單（開發類型分佈圓餅圖「未分類」段的深連結，Dev+QA）。
 *  對應真實 JQL：`sprint = <sprintId> AND cf[14642] is EMPTY AND issuetype in ("Dev-Task", "QA-Task")` */
export function sprintChildTasksUnclassifiedDevTypeJql(sprintId: number): string {
  return `sprint = ${sprintId} AND ${customFieldJql(DEV_TYPE_FIELD)} is EMPTY AND issuetype in ("Dev-Task", "QA-Task")`
}

/** 某組母票之下、尚未估計 Story Points 的工作單（Planning 彈窗顯示用，Dev+QA）。
 *  對應真實 JQL：`parent in (<keyA>, <keyB>, …) AND issuetype in ("Dev-Task", "QA-Task") AND cf[10005] in (Empty, 0)` */
export function sprintChildTasksUnestimatedJql(parentKeys: readonly string[]): string {
  return `${sprintChildTasksJql(parentKeys)} AND ${storyPointsJql} in (Empty, 0)`
}

/** 某組母票之下、未指派人的工作單（Planning 彈窗顯示用，Dev+QA）。
 *  對應真實 JQL：`parent in (<keyA>, <keyB>, …) AND issuetype in ("Dev-Task", "QA-Task") AND assignee is empty` */
export function sprintChildTasksUnassignedJql(parentKeys: readonly string[]): string {
  return `${sprintChildTasksJql(parentKeys)} AND assignee is empty`
}

/**
 * 儀表板下方的任務看板（跨專案）全部 active 開發單（Dev-Task + QA-Task）：套用上方
 * Dashboard scope 的 assignee（self→currentUser()；person→`=`；team→`in (...)`＋有選 project
 * 才加 project in (...)），person/team 並加 `created >= -Nd`。`boardDays` 非 null 時再疊加
 * 「近 X 天建立或更新」（`created` 或 `updated` 任一時點在 -Xd 內）；null 表示看板不套重近
 * 條件（只有 self 會在 UI 上提供這個開關，因 person/team 已有近-N 天限制）。Done 已移除欄位，
 * 故 JQL 用 `status not in ("Done")` 不撈完成任務。scope/`boardDays` 應已由呼叫端驗證。
 *
 * 對應真實 JQL（依 scope 與 boardDays 組合）：
 * ．self、看板不套重近（boardDays = null）：
 *   `issuetype in ("Dev-Task", "QA-Task") AND status not in ("Done") AND assignee = currentUser() ORDER BY key ASC`
 * ．self、套「近 X 天建立或更新」：
 *   `issuetype in ("Dev-Task", "QA-Task") AND status not in ("Done") AND assignee = currentUser() AND (created >= -Xd OR updated >= -Xd) ORDER BY key ASC`
 * ．person／team（scope.mode ≠ self；scope.days 對應 -Nd 天）：
 *   `issuetype in ("Dev-Task", "QA-Task") AND status not in ("Done") AND assignee = "<accountId>"`（person）
 *   `… AND assignee in ("<idA>", "<idB>", …)`（team）
 *   `… AND created >= -Nd ORDER BY key ASC`
 *   ．有選 project 時：`… AND project in (<SUN, TKK, PRIDE…>) …`
 *   ．看板再套重近時，於 `created >= -Nd` 之後再接 ` AND (created >= -Xd OR updated >= -Xd)`。
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

/** 某組母票之下、尚未估計 Story Points 的 Dev-Task（Planning 彈窗顯示用）。
 *  對應真實 JQL：`parent in (<keyA>, <keyB>, …) AND issuetype = "Dev-Task" AND cf[10005] in (Empty, 0)` */
export function sprintUnestimatedJql(parentKeys: readonly string[]): string {
  return `${sprintDevTasksJql(parentKeys)} AND ${storyPointsJql} in (Empty, 0)`
}

/** 某組母票之下、未指派人的 Dev-Task（Planning 彈窗顯示用）。
 *  對應真實 JQL：`parent in (<keyA>, <keyB>, …) AND issuetype = "Dev-Task" AND assignee is empty` */
export function sprintUnassignedJql(parentKeys: readonly string[]): string {
  return `${sprintDevTasksJql(parentKeys)} AND assignee is empty`
}

/** 驗證並轉成排序後、無重複的逗號分隔 key 字串，避免未驗證值直接進 JQL。 */
function enforcedSortedKeys(parentKeys: readonly string[]): string {
  const normalized = parentKeys.map((key) => key.trim()).filter((key) => key.length > 0)
  const unique = [...new Set(normalized)]
  return unique.sort().join(", ")
}

/** 近期指派給我（currentUser）且最近 30 天建立的全部分母（Scope 片段）。
 *  對應真實 JQL：`assignee = currentUser() AND created >= -30d` */
export const RECENT_ASSIGNED_ISSUES_SCOPE_JQL =
  "assignee = currentUser() AND created >= -30d"
/** 近期指派清單（同 Scope，依建立時間新到舊）。
 *  對應真實 JQL：`assignee = currentUser() AND created >= -30d ORDER BY created DESC` */
export const RECENT_ASSIGNED_ISSUES_JQL =
  `${RECENT_ASSIGNED_ISSUES_SCOPE_JQL} ORDER BY created DESC`

/** 更新近期指派清單時的自中央限定查詢（限制只能改到「指派給我且近 30 天建立」的票）。
 *  對應真實 JQL：`id in (<issueIdA>, <issueIdB>, …) AND assignee = currentUser() AND created >= -30d` */
export function recentAssignedIssuesUpdateJql(issueIds: readonly string[]): string {
  return `id in (${issueIds.join(", ")}) AND ${RECENT_ASSIGNED_ISSUES_SCOPE_JQL}`
}

/** 缺失資料的共同分母（Dev-Task / QA-Task，且 resolution 在未解、Done、Fixed 三者之一）。
 *  對應真實 JQL：`issuetype in (DEV-Task, QA-Task) and resolution in (EMPTY, Done, Fixed)` */
export const POINTS_SCOPE_JQL =
  'issuetype in (DEV-Task, QA-Task) and resolution in (EMPTY, Done, Fixed)'

const storyPointsJql = customFieldJql(JIRA_FIELDS.storyPoints.id)
const actualStoryPointsJql = customFieldJql(JIRA_FIELDS.actualStoryPoints.id)
const missingPointsPredicate = `((status = Done and ${actualStoryPointsJql} in (EMPTY, 0)) or (statusCategory not in ("To Do") and ${storyPointsJql} in (EMPTY, 0)))`

/** 指派給我的工作單中，「Story Points」或「Actual Story Points」缺失者（缺失資料卡)。
 *  對應真實 JQL（POINTS_SCOPE_JQL 展開、cf[10005]=Story Points / cf[13736]=Actual Story Points）：
 *   `issuetype in (DEV-Task, QA-Task) and resolution in (EMPTY, Done, Fixed) and
 *    ((status = Done and cf[13736] in (EMPTY, 0)) or (statusCategory not in ("To Do") and cf[10005] in (EMPTY, 0)))
 *    and assignee = currentUser()` */
export const MISSING_POINTS_JQL =
  `${POINTS_SCOPE_JQL} and ${missingPointsPredicate} and assignee = currentUser()`

/** Expanded Points READ population only; original supplementation eligibility remains unchanged. */
export const MISSING_POINTS_WITH_UNEXPECTED_CLOSED_JQL =
  `issuetype in (DEV-Task, QA-Task) and ${missingPointsPredicate} and assignee = currentUser()`

/** 指派給我的 Defect（Bug）中，「Defect Cause」未填者。限定 SUN／TKK／jiratry 專案（僅這些專案有此欄位）。
 *  對應真實 JQL（defectCause 欄位在 Jira 中為 `"Defect Cause[Select List (multiple choices)]"`）：
 *   `project in (sun, tkk, jiratry) and issuetype = bug and assignee = currentUser() and
 *    statusCategory != "To Do" and status not in ("In Progress", "Dev Ready") and
 *    resolution in (EMPTY, Done, Fixed) and "Defect Cause[Select List (multiple choices)]" is EMPTY` */
export const MISSING_DEFECT_CAUSE_JQL =
  `project in (sun, tkk, jiratry) and issuetype = bug and assignee = currentUser() and statusCategory != "To Do" and status not in ("In Progress", "Dev Ready") and resolution in (EMPTY, Done, Fixed) and ${JIRA_FIELDS.defectCause.jql} is EMPTY`

/** SUN 的 Story／Task／Bug，Impact Scope 未填（不限狀態）；self 可依 Jira 權限補填。 */
export const MISSING_IMPACT_SCOPE_JQL =
  `project = sun and issuetype in (story, task, bug) and ${customFieldJql(JIRA_FIELDS.impactScope.id)} is EMPTY and (created >= "2026-11-01" or ${customFieldJql(JIRA_FIELDS.releasePackage.id)} = "Sprint9") and ${customFieldJql(JIRA_FIELDS.releasePackage.id)} is not EMPTY and assignee = currentUser()`

/** 權威缺失資料查詢；未識別的 kind 不回退到另一個類別。 */
export function missingDataJql(kind: MissingDataKind) {
  switch (kind) {
    case "points": return MISSING_POINTS_JQL
    case "defect-cause": return MISSING_DEFECT_CAUSE_JQL
    case "impact-scope": return MISSING_IMPACT_SCOPE_JQL
    default: throw new DashboardFilterError("不支援此查詢類型。")
  }
}

/**
 * 缺失資料的讀取查詢：預設 self 回 `missingDataJql(kind)`；Points 可透過
 * read option 納入非預期關閉票（只移除 resolution 限制，不改更新資格）。person／team 把
 * `assignee = currentUser()` 改為 `assignee in (<accountIds>)`，並疊加 `created >= -Nd`
 * 近-N 天視窗與（有選 project 時）`project in (...)`。
 *
 * 對應真實 JQL（以 kind = points、person 為例）：
 * `issuetype in (DEV-Task, QA-Task) and resolution in (EMPTY, Done, Fixed) and
 *  ((status = Done and cf[13736] in (EMPTY, 0)) or (statusCategory not in ("To Do") and cf[10005] in (EMPTY, 0)))
 *  and assignee in ("<idA>", "<idB>", …) AND created >= -<scope.days>d [AND project in (<SUN, TKK, PRIDE…>)]`
 * kind = defect-cause 時以 MISSING_DEFECT_CAUSE_JQL 為 base，同樣以 `assignee in (...)` 代換。
 */
export function missingDataReadJql(kind: MissingDataKind, scope: ResolvedDashboardScope, options: DashboardReadOptions = {}): string {
  const includeUnexpected = includesUnexpectedClosed(options)
  const selfQuery = kind === "points" && includeUnexpected ? MISSING_POINTS_WITH_UNEXPECTED_CLOSED_JQL : missingDataJql(kind)
  if (scope.mode === "self") return selfQuery
  dashboardDays(String(scope.days))
  if (!scope.accountIds.length || scope.accountIds.length > DASHBOARD_MEMBER_LIMIT || scope.accountIds.some((id) => !isDashboardAccountId(id)) || scope.projects.some((project) => !DASHBOARD_PROJECTS.some((option) => option.key === project))) throw new DashboardFilterError()
  const assignees = [...new Set(scope.accountIds)].sort().map((id) => `"${id}"`).join(", ")
  const base = selfQuery.replace(/assignee = currentUser\(\)/i, `assignee in (${assignees})`)
  const date = `created >= -${scope.days}d`
  const projects = scope.projects.length ? ` AND project in (${[...new Set(scope.projects)].sort().join(", ")})` : ""
  const jql = `${base} AND ${date}${projects}`
  if (jql.length > DASHBOARD_JQL_LIMIT) throw new DashboardFilterError("所選成員產生的查詢過大，請縮小團隊範圍。")
  return jql
}

/** 缺失資料清單查詢（唯讀，依 key 升冪排序）。
 *  對應真實 JQL：`<missingDataReadJql(kind, scope)> ORDER BY key ASC` */
export function missingDataListJql(kind: MissingDataKind, scope: ResolvedDashboardScope, options: DashboardReadOptions = {}): string {
  return `${missingDataReadJql(kind, scope, options)} ORDER BY key ASC`
}

/** 缺失資料的更新查詢：以原始 `missingDataJql(kind)`（含 `assignee = currentUser()`，不隨 scope
 *  放寬）為括號 base，再限制到指定 issue id，確保只能改到「現在仍屬於自己的缺失清單」。
 *  對應真實 JQL：`(<MISSING_POINTS_JQL | MISSING_DEFECT_CAUSE_JQL | MISSING_IMPACT_SCOPE_JQL>) AND id in (<issueIdA>, <issueIdB>, …)` */
export function missingDataUpdateJql(kind: WritableMissingDataKind, issueIds: readonly string[]): string {
  if (kind !== "points" && kind !== "defect-cause" && kind !== "impact-scope") throw new DashboardFilterError("不支援此更新類型。")
  if (!issueIds.length || issueIds.length > 50 || issueIds.some((id) => typeof id !== "string" || !/^\d{1,30}$/.test(id)) || new Set(issueIds).size !== issueIds.length) throw new DashboardFilterError("Issue ID 無效或重複。")
  return `(${missingDataJql(kind)}) AND id in (${issueIds.join(",")})`
}

/** 儀表板警示查詢的「子查詢」常數（不含 scope 的 assignee／近-N 天／project 限制）；scope 由
 *  `dashboardAlertJql`（下方）包上一層。各 key 對應真實 JQL：
 *
 * ．`bugs.s0s1`（P0/P1 高優先 Bug，尚在處理中）：
 *   `issuetype = "Bug" AND priority IN ("Critical (P0)", "High (P1)") AND (statusCategory = "To Do" or status = "In Progress")`
 * ．`bugs.s2`（P2 中優先 Bug，尚在處理中且超過 10 天未更新）：
 *   `issuetype = "Bug" AND priority IN ("Medium (P2)") AND (statusCategory = "To Do" or status = "In Progress") and updated < -10d`
 * ．`pending.inReview`：`status = "In Review"`
 * ．`pending.requestInfo`：`status = "Request Info"`
 * ．`due.overdue`（已過到期日）：
 *   `duedate < startOfDay() AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))`
 * ．`due.upcoming`（未來 3 天內到期）：
 *   `duedate >= startOfDay() AND duedate < startOfDay("+3d") AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))`
 */
export const DASHBOARD_ALERT_JQL = {
  s0s1: 'issuetype = "Bug" AND priority IN ("Critical (P0)", "High (P1)") AND (statusCategory = "To Do" or status = "In Progress")',
  s2: 'issuetype = "Bug" AND priority IN ("Medium (P2)") AND (statusCategory = "To Do" or status = "In Progress") and updated < -10d',
  inReview: 'status = "In Review"',
  requestInfo: 'status = "Request Info"',
  overdue: 'duedate < startOfDay() AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))',
  upcoming: 'duedate >= startOfDay() AND duedate < startOfDay("+3d") AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))',
} as const
export type DashboardAlertKey = keyof typeof DASHBOARD_ALERT_JQL
export const DASHBOARD_ALERT_KEYS = {
  bugs: ["s0s1", "s2"], pending: ["inReview", "requestInfo"], due: ["overdue", "upcoming"],
} as const

/**
 * 給定某警示子 key，組出附帶 scope 限制的完整警示查詢：把 `DASHBOARD_ALERT_JQL[key]` 用括號包起，
 * 再依 scope 加上 `assignee`（self→currentUser()；person→`=`；team→`in (...)`）與近-N 天
 * `created >= -Nd`、以及有選 project 時的 `project in (...)`，最後依 key 升冪排序。
 *
 * 對應真實 JQL（以 key = s0s1、scope = team 為例）：
 * `(issuetype = "Bug" AND priority IN ("Critical (P0)", "High (P1)") AND (statusCategory = "To Do" or status = "In Progress"))
 *  AND assignee in ("<idA>", "<idB>", …) AND created >= -<scope.days>d [AND project in (<SUN, TKK, PRIDE…>)] ORDER BY key ASC`
 */
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

/**
 * 分析資料的日期欄位。
 *
 * `created` 為專案層級的分析事件時間（開單日），語意與 Dashboard 的
 * `created >= -Nd` 近-N 天視窗一致；此處把相對天數換成使用者選定的絕對區間。
 * 之後若有分析需要改用其他日期欄位（例如實際完成日），必須在此新增欄位並由
 * builder 依參數選用，consumer 不得自行拼接日期條件。
 */
export type AnalysisDateField = "created"

/** 分析查詢共用的排序：依 key 升冪，讓完整分頁的結果順序穩定。 */
export const ANALYSIS_ORDER_BY = "ORDER BY key ASC"

/** 檢查 `YYYY-MM-DD`；不合法／顛倒／超過上限一律拋 `DashboardFilterError`。 */
export function requireAnalysisDateRange(range: DateRange): DateRange {
  try {
    return requireDateRange(range)
  } catch {
    throw new DashboardFilterError("分析區間無效，請重新選擇起訖日期。")
  }
}

/**
 * 「分析區間」的日期限制片段（含前導 ` AND `），端點皆為**含當日**：
 * Jira 的 `>=` / `<=` 對日期欄位以當日 00:00 比較，因此 `to` 需帶到下一天的前一刻；
 * 對 date-only 欄位則用 `<= "YYYY-MM-DD"` 即可涵蓋當日。
 *
 * 對應真實 JQL：` AND created >= "2026-10-01" AND created <= "2026-10-31"`
 */
export function analysisDateJql(range: DateRange, field: AnalysisDateField = "created"): string {
  const { from, to } = requireAnalysisDateRange(range)
  const end = field === "created" ? ` AND ${field} <= "${to} 23:59"` : ` AND ${field} <= "${to}"`
  return ` AND ${field} >= "${from}"${end}`
}

/**
 * 把一段（不含日期限制的）查詢疊上「分析區間」與排序。
 *
 * `base` 必須是**集中定義**的查詢或 builder 輸出（例如 `MISSING_POINTS_JQL`）；
 * consumer 不得自行拼字串。base 已含 `ORDER BY` 時以 `ORDER BY key ASC` 覆寫，
 * 避免同一個查詢出現兩段排序。
 *
 * 對應真實 JQL（以 base = MISSING_POINTS_JQL 為例）：
 * `<MISSING_POINTS_JQL> AND created >= "2026-10-01" AND created <= "2026-10-31" ORDER BY key ASC`
 */
export function analysisRangeJql(base: string, range: DateRange, field: AnalysisDateField = "created"): string {
  const body = base.replace(/\s+ORDER BY\s+[^)]*$/i, "").trim()
  const jql = `${body}${analysisDateJql(range, field)} ${ANALYSIS_ORDER_BY}`
  if (jql.length > DASHBOARD_JQL_LIMIT) throw new DashboardFilterError("分析查詢過大，請縮小範圍。")
  return jql
}

/**
 * 工作量分析熱點圖的查詢（Dev-Task Story Points、依指派人與絕對日期區間）。
 *
 * 與燃盡圖的差別：這裡**沒有 sprint 錨點**，範圍由「成員（assignee）＋選填專案＋
 * 分析區間」決定，因此不需要燃盡圖那套「先撈母票、再 `parent in (...)`」的兩步；
 * Dev-Task 可直接以 `assignee` 查（同 Dashboard `POINTS_SCOPE_JQL` 的作法）。
 *
 * **撈票只用 `status CHANGED TO "Done"`，不用 `resolved` 夾擊**：`CHANGED` 是轉換
 * 事件，`DURING` 區間內只要發生過一次「轉為 Done」就會命中，因此同一張票可能在
 * 多個區間被撈到（已實測）。重複不是問題——真正的完成日由 issue 的 `resolved`
 * 決定（見 `lib/workload-series.ts`），多撈到的票在分桶時會被淘汰或收斂到同一格。
 *
 * 刻意**不加** `CHANGED FROM (...)`：加了反而會鎖太窄。若某張票先在 10-1 由
 * In Progress 轉 Done、10-10 又 Done→Done 一次，`FROM` 子句會讓它在兩個區間都
 * 落空；不加則至少在其中之一被撈到，完成日再靠 `resolved` 定位。
 */

/** 驗證 scope 並轉成可安全內嵌的 assignee／project 片段。 */
function enforcedWorkloadScope(scope: ResolvedDashboardScope): { assignee: string; projects: string } {
  if (scope.mode === "self" || !scope.accountIds.length || scope.accountIds.length > DASHBOARD_MEMBER_LIMIT) {
    throw new DashboardFilterError("請至少選擇一個團隊，並保留一名成員。")
  }
  if (scope.accountIds.some((id) => !isDashboardAccountId(id))) throw new DashboardFilterError()
  if (scope.projects.some((project) => !DASHBOARD_PROJECTS.some((option) => option.key === project))) {
    throw new DashboardFilterError()
  }
  const ids = [...new Set(scope.accountIds)].sort().map((id) => `"${id}"`)
  const assignee = ids.length === 1 ? `assignee = ${ids[0]}` : `assignee in (${ids.join(", ")})`
  const projects = scope.projects.length
    ? ` AND project in (${[...new Set(scope.projects)].sort().join(", ")})`
    : ""
  return { assignee, projects }
}

/**
 * 把「轉為 Done」的日期條件寫成 JQL：單日用 `ON`，多日用 `DURING`。
 *
 * `DURING` 需要兩個**不同**的端點才有間隔，因此單日區間非得走 `ON`；多日時
 * `to` **不加一**（`DURING` 的訖日已是含當日語意，加上去反而多撈一天）。
 *
 * 對應真實 JQL：
 * - 單日：`status CHANGED TO "Done" ON "2026-10-05"`
 * - 多日：`status CHANGED TO "Done" DURING ("2026-10-01", "2026-10-05")`
 */
export function workloadDoneDuringJql(range: DateRange): string {
  const { from, to } = requireAnalysisDateRange(range)
  return from === to
    ? `status CHANGED TO "Done" ON "${from}"`
    : `status CHANGED TO "Done" DURING ("${from}", "${to}")`
}

/**
 * 區間內曾經「轉為 Done」的 Dev-Task（熱點圖唯一的資料來源）。
 *
 * 一次查詢取回整個區間，不再逐日掃描：`resolved` 是欄位值而非事件，逐日查詢
 * 換不到額外資訊。天數因此不影響查詢次數，只影響回應筆數。
 */
export function workloadDevTasksJql(scope: ResolvedDashboardScope, range: DateRange): string {
  const { assignee, projects } = enforcedWorkloadScope(scope)
  const jql = `issuetype = "Dev-Task" AND ${workloadDoneDuringJql(range)} AND ${assignee}${projects} ${ANALYSIS_ORDER_BY}`
  if (jql.length > DASHBOARD_JQL_LIMIT) throw new DashboardFilterError("分析查詢過大，請縮小範圍。")
  return jql
}

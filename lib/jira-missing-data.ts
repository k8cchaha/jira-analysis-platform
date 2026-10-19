import { JIRA_FIELDS, customFieldJql } from "./jira-fields.ts"
import { DASHBOARD_JQL_LIMIT, DASHBOARD_MEMBER_LIMIT, DASHBOARD_PROJECTS, DashboardFilterError, dashboardDays, isDashboardAccountId, type ResolvedDashboardScope } from "./jira-dashboard-filter.ts"

export { STORY_POINTS_FIELD, ACTUAL_STORY_POINTS_FIELD } from "./jira-fields.ts"

export type MissingDataKind = "points" | "defect-cause"

export const MISSING_DATA_LIMIT = 5_000
export const MISSING_DATA_PAGE_SIZE = 50

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

export function isMissingPoint(value: unknown): value is null | 0 {
  return value === null || value === 0
}

export function isPointValue(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0)
}

export function missingPoints(value: Pick<MissingIssue, "storyPoints" | "actualStoryPoints" | "storyPointsRequired" | "actualStoryPointsRequired">) {
  return {
    storyPointsMissing: value.storyPointsRequired && isMissingPoint(value.storyPoints),
    actualStoryPointsMissing: value.actualStoryPointsRequired && isMissingPoint(value.actualStoryPoints),
  }
}

export interface MissingDataSummary {
  kind: MissingDataKind
  total: number
  storyPointsMissing: number
  actualStoryPointsMissing: number
}

export interface MissingIssue {
  id: string
  key: string
  summary: string
  assigneeDisplayName: string | null
  parentIssueType: { status: "known"; name: string } | { status: "none" | "unknown" }
  storyPoints: number | null
  actualStoryPoints: number | null
  storyPointsRequired: boolean
  actualStoryPointsRequired: boolean
  storyPointsEditable: boolean
  actualStoryPointsEditable: boolean
  rootCause: string
  solution: string
  defectCause: string[]
  defectCauseOptions: Array<{ id: string; value: string }>
  defectCauseEditable: boolean
  unavailableReason?: string
}

export interface MissingDataPage {
  readOnly: boolean
  issues: MissingIssue[]
  page: number
  nextPageToken: string | null
  previousPageToken: string | null
  jiraBaseUrl: string | null
  warnings: string[]
}

export interface MissingDataChange {
  issueId: string
  storyPoints?: number
  actualStoryPoints?: number
  defectCause?: string[]
  expectedStoryPoints?: number | null
  expectedActualStoryPoints?: number | null
}

export interface MissingDataActionState {
  submissionId: string | null
  status: "idle" | "success" | "partial" | "error"
  message: string
  succeededIssueIds: string[]
  failures: Array<{ issueId: string; message: string }>
}

export interface MissingDataError {
  message: string
  code: "reauthorize" | "forbidden" | "retry" | "configuration" | "limit" | "invalid_page"
}

export type MissingDataSummaryResult =
  | { status: "success"; summary: MissingDataSummary }
  | { status: "error"; error: MissingDataError }

export type MissingDataPageResult =
  | { status: "success"; data: MissingDataPage }
  | { status: "error"; error: MissingDataError }

export function parseMissingDataChanges(kind: MissingDataKind, value: unknown): MissingDataChange[] {
  if (typeof value !== "string" || value.length === 0 || value.length > 10_000) {
    throw new Error("變更資料為空或過大。")
  }
  let data: unknown
  try {
    data = JSON.parse(value)
  } catch {
    throw new Error("變更資料格式錯誤。")
  }
  if (!Array.isArray(data) || data.length === 0 || data.length > MISSING_DATA_PAGE_SIZE) {
    throw new Error("一次必須更新 1 到 50 張 Issue。")
  }
  const seen = new Set<string>()
  return data.map((item): MissingDataChange => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("變更資料格式錯誤。")
    const record = item as Record<string, unknown>
    const id = record.issueId
    if (typeof id !== "string" || !/^\d{1,30}$/.test(id) || seen.has(id)) {
      throw new Error("Issue ID 無效或重複。")
    }
    seen.add(id)
    const allowed = kind === "points"
      ? ["issueId", "storyPoints", "actualStoryPoints", "expectedStoryPoints", "expectedActualStoryPoints"]
      : ["issueId", "defectCause"]
    if (Object.keys(record).some((key) => !allowed.includes(key))) throw new Error("包含不允許更新的欄位。")
    const change: MissingDataChange = { issueId: id }
    if (kind === "points") {
      for (const [field, expected] of [["storyPoints", "expectedStoryPoints"], ["actualStoryPoints", "expectedActualStoryPoints"]] as const) {
        if (!(field in record)) {
          if (expected in record) throw new Error("變更資料格式錯誤。")
          continue
        }
        const point = record[field]
        if (typeof point !== "number" || !Number.isFinite(point) || point <= 0) {
          throw new Error("補填的 Points 必須是大於 0 的有限數值。")
        }
        if (!isPointValue(record[expected])) throw new Error("原始 Points 值無效。")
        change[field] = point
        change[expected] = record[expected]
      }
      if (change.storyPoints === undefined && change.actualStoryPoints === undefined) throw new Error("沒有可送出的變更。")
    } else {
      const options = record.defectCause
      if (!Array.isArray(options) || options.length === 0 || options.length > 100 || options.some((option) => typeof option !== "string" || !/^\d{1,30}$/.test(option)) || new Set(options).size !== options.length) {
        throw new Error("請選擇有效且不重複的 Defect Cause 選項。")
      }
      change.defectCause = options as string[]
    }
    return change
  })
}

export function jiraText(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return "—"
  if (typeof value !== "object" || Array.isArray(value)) return "（無法識別的文字格式）"
  const node = value as Record<string, unknown>
  if (node.type === "text" && typeof node.text === "string") return node.text
  if (node.type === "hardBreak") return "\n"
  if (node.type === "mention" && node.attrs && typeof node.attrs === "object") {
    const text = (node.attrs as Record<string, unknown>).text
    return typeof text === "string" ? text : ""
  }
  if (Array.isArray(node.content)) {
    const text = node.content.map(jiraText).join("")
    return ["paragraph", "heading", "listItem", "blockquote", "codeBlock"].includes(String(node.type)) ? `${text}\n` : text
  }
  if (node.type === "doc") return "—"
  return ""
}

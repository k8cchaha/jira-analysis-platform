import "server-only"

import { auth } from "@/auth"
import { getJiraToken, JiraAuthorizationError, type JiraCredentials } from "@/lib/jira-token"
import { JIRA_FIELDS, STORY_POINTS_FIELD, ACTUAL_STORY_POINTS_FIELD, matchesJiraFieldSchema } from "@/lib/jira-fields"
import {
  MISSING_DATA_LIMIT,
  MISSING_DATA_PAGE_SIZE,
  isPointValue,
  missingPoints,
  jiraText,
  missingDataJql,
  missingDataReadJql,
  type MissingDataChange,
  type MissingDataError,
  type MissingDataKind,
  type MissingDataPage,
  type MissingDataSummary,
  type MissingIssue,
} from "@/lib/jira-missing-data"
import { initialPageCursor, openPageToken, sealPageToken } from "@/lib/jira-page-token"
import { DashboardFilterError, SELF_FILTER, serializeDashboardFilter, type DashboardFilter } from "@/lib/jira-dashboard-filter"
import { resolveDashboardScope, JiraDashboardLookupError, lookupError } from "@/lib/jira-dashboard-lookups"

export class JiraDashboardError extends Error {
  constructor(readonly code: MissingDataError["code"], message: string) {
    super(message)
    this.name = "JiraDashboardError"
  }
}

type RecordValue = Record<string, unknown>
interface JiraField {
  id: string
  name: string
  schema: RecordValue
  projectId: string | null
}
interface FieldSet {
  points: JiraField[]
  actualPoints: JiraField[]
  defectCause: JiraField[]
  rootCause: JiraField[]
  solution: JiraField[]
}
interface RawIssue {
  id: string
  key: string
  fields: RecordValue
  projectId: string
}
interface SearchPage {
  issues: RawIssue[]
  nextPageToken: string | null
}

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}
function invalidResponse(message = "Jira 回傳了無法識別的資料，無法提供完整結果。") {
  return new JiraDashboardError("retry", message)
}

export function dashboardError(error: unknown): MissingDataError {
  if (error instanceof DashboardFilterError) return { code: "configuration", message: error.message }
  if (error instanceof JiraDashboardLookupError) return lookupError(error)
  if (error instanceof JiraDashboardError) return { code: error.code, message: error.message }
  if (error instanceof JiraAuthorizationError) {
    return error.code === "invalid_configuration"
      ? { code: "configuration", message: "Jira OAuth 設定不完整，請聯繫管理員。" }
      : { code: "reauthorize", message: "Jira 授權已失效，請重新授權。" }
  }
  console.error("Unexpected Jira missing-data request failure")
  return { code: "retry", message: "暫時無法取得 Jira 資料，請稍後重試。" }
}

async function jiraFetch(credentials: JiraCredentials, path: string, init: RequestInit = {}) {
  let response: Response
  try {
    response = await fetch(`https://api.atlassian.com/ex/jira/${encodeURIComponent(credentials.cloudId)}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credentials.accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new JiraDashboardError("retry", "暫時無法連線至 Jira，請稍後重試。")
  }
  if (!response.ok) {
    if (response.status === 401) throw new JiraDashboardError("reauthorize", "Jira 授權已失效，請重新授權。")
    if (response.status === 403) throw new JiraDashboardError("forbidden", "沒有權限存取這些 Jira 資料或編輯欄位。")
    if (response.status === 429) throw new JiraDashboardError("retry", "Jira 請求過於頻繁，請稍後重試。")
    if (response.status === 400) throw new JiraDashboardError("configuration", "Jira 無法接受查詢或欄位更新，請確認欄位設定與權限。")
    throw new JiraDashboardError("retry", "Jira 暫時無法完成請求，請稍後重試。")
  }
  return response
}
async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw invalidResponse()
  }
}

async function getFields(credentials: JiraCredentials, kind: MissingDataKind): Promise<FieldSet> {
  const data = await responseJson(await jiraFetch(credentials, "/rest/api/3/field"))
  if (!Array.isArray(data)) throw invalidResponse()
  const all: JiraField[] = []
  for (const field of data) {
    if (!record(field) || !nonemptyString(field.id) || !nonemptyString(field.name) || !record(field.schema)) continue
    let projectId: string | null = null
    if (record(field.scope) && field.scope.type !== "GLOBAL") {
      if (field.scope.type !== "PROJECT" || !record(field.scope.project) || !nonemptyString(field.scope.project.id)) continue
      projectId = field.scope.project.id
    }
    all.push({ id: field.id, name: field.name, schema: field.schema, projectId })
  }
  const named = (name: string) => all.filter((field) => field.name.trim().toLowerCase() === name.toLowerCase())
  const fields: FieldSet = {
    points: all.filter((field) => field.id === STORY_POINTS_FIELD && matchesJiraFieldSchema(field.schema, JIRA_FIELDS.storyPoints.schema)),
    actualPoints: all.filter((field) => field.id === ACTUAL_STORY_POINTS_FIELD && matchesJiraFieldSchema(field.schema, JIRA_FIELDS.actualStoryPoints.schema)),
    defectCause: named(JIRA_FIELDS.defectCause.name).filter((field) => matchesJiraFieldSchema(field.schema, JIRA_FIELDS.defectCause.schema)),
    rootCause: named(JIRA_FIELDS.rootCause.name).filter((field) => matchesJiraFieldSchema(field.schema, JIRA_FIELDS.rootCause.schema)),
    solution: named(JIRA_FIELDS.solution.name).filter((field) => matchesJiraFieldSchema(field.schema, JIRA_FIELDS.solution.schema)),
  }
  if (kind === "points" && (!fields.points.length || !fields.actualPoints.length)) {
    throw new JiraDashboardError("configuration", "找不到可用的 Story Points 或 Actual Story Points 數值欄位。")
  }
  if (kind === "defect-cause" && !fields.defectCause.length) {
    throw new JiraDashboardError("configuration", "找不到 Defect Cause 多選欄位，請確認 Jira 設定。")
  }
  if (kind === "defect-cause" && new Set(fields.defectCause.map((field) => field.id)).size > 1) {
    throw new JiraDashboardError("configuration", "有多個同名 Defect Cause 欄位，無法確認查詢對應的欄位。")
  }
  return fields
}
function resolveField(candidates: JiraField[], projectId: string): JiraField | null {
  const scoped = candidates.filter((field) => field.projectId === projectId)
  const matches = scoped.length ? scoped : candidates.filter((field) => field.projectId === null)
  if (matches.length > 1) throw new JiraDashboardError("configuration", "Jira 欄位對應不唯一，請聯繫管理員確認。")
  return matches[0] ?? null
}
function requireField(candidates: JiraField[], issue: RawIssue) {
  const field = resolveField(candidates, issue.projectId)
  if (!field || !Object.hasOwn(issue.fields, field.id)) {
    throw new JiraDashboardError("configuration", `${issue.key} 未回傳必要欄位或此專案不支援該欄位，無法判定資料缺失。`)
  }
  return field
}
function fieldIds(fields: FieldSet, kind: MissingDataKind, detail: boolean) {
  const selected = kind === "points"
    ? [...fields.points, ...fields.actualPoints]
    : [...fields.defectCause, ...(detail ? [...fields.rootCause, ...fields.solution] : [])]
  return [...new Set(["project", ...(kind === "points" ? ["status"] : []), ...(detail ? ["summary", "assignee", "parent"] : []), ...selected.map((field) => field.id)])]
}
function parseIssue(value: unknown): RawIssue {
  if (!record(value) || !nonemptyString(value.id) || !/^\d{1,30}$/.test(value.id) || !nonemptyString(value.key) || !record(value.fields) || !record(value.fields.project) || !nonemptyString(value.fields.project.id)) {
    throw invalidResponse()
  }
  return { id: value.id, key: value.key, fields: value.fields, projectId: value.fields.project.id }
}
async function search(credentials: JiraCredentials, jql: string, fields: string[], maxResults: number, nextPageToken?: string | null): Promise<SearchPage> {
  const data = await responseJson(await jiraFetch(credentials, "/rest/api/3/search/jql", {
    method: "POST",
    body: JSON.stringify({ jql, fields, maxResults, ...(nextPageToken ? { nextPageToken } : {}) }),
  }))
  if (!record(data) || !Array.isArray(data.issues) || data.issues.length > maxResults) throw invalidResponse()
  const token = data.nextPageToken
  if (token !== undefined && token !== null && (!nonemptyString(token) || token.length > 8_192)) throw invalidResponse()
  const next = nonemptyString(token) ? token : null
  if ((data.isLast === true && next) || (!next && data.isLast !== true) || (next && data.issues.length === 0)) throw invalidResponse("Jira 分頁資訊不完整，無法提供精確結果。")
  return { issues: data.issues.map(parseIssue), nextPageToken: next }
}
export async function* searchJiraIssues(credentials: JiraCredentials, jql: string, fields: string[] = []): AsyncGenerator<RawIssue[]> {
  const seen = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | null = null
  for (let page = 0; page < 100; page += 1) {
    const result = await search(credentials, jql, [...new Set(["project", ...fields])], 100, cursor)
    for (const issue of result.issues) {
      if (seen.has(issue.id)) throw invalidResponse("Jira 分頁包含重複資料，請重新載入以取得完整結果。")
      seen.add(issue.id)
      if (seen.size > MISSING_DATA_LIMIT) throw limitError()
    }
    cursor = result.nextPageToken
    if (cursor) {
      if (seen.size >= MISSING_DATA_LIMIT) throw limitError()
      if (cursors.has(cursor)) throw invalidResponse("Jira 分頁無法完成，請重新載入。")
      cursors.add(cursor)
    }
    yield result.issues
    if (!cursor) return
  }
  throw invalidResponse("Jira 分頁過多，無法提供精確筆數，請縮小查詢範圍。")
}
export async function countJiraIssues(credentials: JiraCredentials, jql: string): Promise<number> {
  let total = 0
  for await (const issues of searchJiraIssues(credentials, jql)) total += issues.length
  return total
}
export { baseUrl as dashboardJiraBaseUrl }

function pointsValues(fields: FieldSet, issue: RawIssue) {
  const point = requireField(fields.points, issue)
  const actual = requireField(fields.actualPoints, issue)
  const storyPoints = issue.fields[point.id]
  const actualStoryPoints = issue.fields[actual.id]
  if (!isPointValue(storyPoints) || !isPointValue(actualStoryPoints)) throw invalidResponse(`${issue.key} 的 Points 值無效，無法提供精確缺失結果。`)
  const status = issue.fields.status
  if (!record(status) || !nonemptyString(status.name) || !status.name.trim() || !record(status.statusCategory) || !nonemptyString(status.statusCategory.key) || !["new", "indeterminate", "done"].includes(status.statusCategory.key)) {
    throw new JiraDashboardError("configuration", `${issue.key} 未回傳有效狀態，無法判定 Points 缺失範圍。`)
  }
  return {
    storyPoints, actualStoryPoints,
    storyPointsRequired: status.statusCategory.key !== "new",
    actualStoryPointsRequired: status.name.toLowerCase() === "done",
  }
}
function causeValues(fields: FieldSet, issue: RawIssue): string[] {
  const cause = requireField(fields.defectCause, issue)
  const value = issue.fields[cause.id]
  if (value === null) return []
  if (!Array.isArray(value) || value.some((option) => !record(option) || !nonemptyString(option.id))) throw invalidResponse()
  return value.map((option) => (option as RecordValue).id as string)
}

export async function getMissingDataSummary(kind: MissingDataKind, filter: DashboardFilter = SELF_FILTER): Promise<MissingDataSummary> {
  const credentials = await getJiraToken()
  const scope = await resolveDashboardScope(filter, credentials)
  const jql = `${missingDataReadJql(kind, scope)} ORDER BY key ASC`
  const fields = await getFields(credentials, kind)
  const summary: MissingDataSummary = { kind, total: 0, storyPointsMissing: 0, actualStoryPointsMissing: 0 }
  const seen = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | null = null
  do {
    const result = await search(credentials, jql, fieldIds(fields, kind, false), 100, cursor)
    for (const issue of result.issues) {
      if (seen.has(issue.id)) throw invalidResponse("Jira 分頁包含重複資料，請重新載入以取得完整結果。")
      seen.add(issue.id)
      if (seen.size > MISSING_DATA_LIMIT) throw limitError()
      if (kind === "points") {
        const { storyPointsMissing, actualStoryPointsMissing } = missingPoints(pointsValues(fields, issue))
        if (storyPointsMissing || actualStoryPointsMissing) summary.total += 1
        if (storyPointsMissing) summary.storyPointsMissing += 1
        if (actualStoryPointsMissing) summary.actualStoryPointsMissing += 1
      } else if (causeValues(fields, issue).length === 0) {
        summary.total += 1
      }
    }
    cursor = result.nextPageToken
    if (cursor) {
      if (seen.size >= MISSING_DATA_LIMIT) throw limitError()
      if (cursors.has(cursor) || cursors.size >= 100) throw invalidResponse("Jira 分頁無法完成，請重新載入。")
      cursors.add(cursor)
    }
  } while (cursor)
  return summary
}
function limitError() {
  return new JiraDashboardError("limit", "符合查詢的資料超過 5,000 筆，無法提供完整概況；請聯繫管理員縮小查詢範圍。")
}
function baseUrl() {
  try {
    const url = new URL(process.env.ATLASSIAN_JIRA_CLOUD_URL ?? "")
    return url.protocol === "https:" ? url.origin : null
  } catch {
    return null
  }
}

async function liveIssue(credentials: JiraCredentials, id: string, ids: string[], readOnly = false) {
  const params = new URLSearchParams({ fields: [...new Set(["project", "summary", ...ids])].join(",") })
  if (!readOnly) params.set("expand", "editmeta")
  const data = await responseJson(await jiraFetch(credentials, `/rest/api/3/issue/${encodeURIComponent(id)}?${params}`))
  const issue = parseIssue(data)
  if (issue.id !== id) throw invalidResponse()
  const editmeta = record(data) && record(data.editmeta) && record(data.editmeta.fields) ? data.editmeta.fields : {}
  return { issue, editmeta }
}
function numericEditable(editmeta: RecordValue, id: string) {
  const meta = editmeta[id]
  const schema = id === ACTUAL_STORY_POINTS_FIELD ? JIRA_FIELDS.actualStoryPoints.schema : JIRA_FIELDS.storyPoints.schema
  return record(meta) && matchesJiraFieldSchema(meta.schema, schema) && Array.isArray(meta.operations) && meta.operations.includes("set")
}
function causeOptions(editmeta: RecordValue, id: string) {
  const meta = editmeta[id]
  if (!record(meta) || !matchesJiraFieldSchema(meta.schema, JIRA_FIELDS.defectCause.schema) || !Array.isArray(meta.operations) || !meta.operations.includes("set") || !Array.isArray(meta.allowedValues)) return []
  if (meta.allowedValues.some((option) => !record(option) || !nonemptyString(option.id) || !/^\d{1,30}$/.test(option.id) || !nonemptyString(option.value))) throw invalidResponse("Defect Cause 選項格式無法識別。")
  return meta.allowedValues.filter((option) => option.disabled !== true).map((option) => ({ id: option.id as string, value: option.value as string }))
}
function textField(candidates: JiraField[], issue: RawIssue, label: string, warnings: Set<string>) {
  let field: JiraField | null
  try {
    field = resolveField(candidates, issue.projectId)
  } catch {
    warnings.add(`${label} 欄位有多個同名對應，無法顯示。`)
    return "（欄位對應不唯一）"
  }
  if (!field || !Object.hasOwn(issue.fields, field.id)) {
    warnings.add(`${label} 欄位找不到或無法讀取。`)
    return "（欄位無法讀取）"
  }
  return jiraText(issue.fields[field.id]).trim() || "—"
}
function parentIssueType(value: unknown): MissingIssue["parentIssueType"] {
  if (value === null) return { status: "none" }
  if (!record(value) || !record(value.fields) || !record(value.fields.issuetype)) return { status: "unknown" }
  const name = value.fields.issuetype.name
  return nonemptyString(name) && name.trim() ? { status: "known", name } : { status: "unknown" }
}
function toMissingIssue(fields: FieldSet, issue: RawIssue, kind: MissingDataKind, editmeta: RecordValue, warnings: Set<string>, readOnly = false): MissingIssue | null {
  const assignee = issue.fields.assignee
  const row: MissingIssue = {
    id: issue.id, key: issue.key, summary: typeof issue.fields.summary === "string" ? issue.fields.summary : "未命名議題",
    assigneeDisplayName: record(assignee) && nonemptyString(assignee.displayName) && assignee.displayName.trim() ? assignee.displayName : null,
    parentIssueType: parentIssueType(issue.fields.parent),
    storyPoints: null, actualStoryPoints: null, storyPointsRequired: false, actualStoryPointsRequired: false,
    storyPointsEditable: false, actualStoryPointsEditable: false,
    rootCause: "—", solution: "—", defectCause: [], defectCauseOptions: [], defectCauseEditable: false,
  }
  if (kind === "points") {
    const values = pointsValues(fields, issue)
    const { storyPointsMissing, actualStoryPointsMissing } = missingPoints(values)
    if (!storyPointsMissing && !actualStoryPointsMissing) return null
    row.storyPoints = values.storyPoints
    row.actualStoryPoints = values.actualStoryPoints
    row.storyPointsRequired = values.storyPointsRequired
    row.actualStoryPointsRequired = values.actualStoryPointsRequired
    row.storyPointsEditable = !readOnly && numericEditable(editmeta, STORY_POINTS_FIELD)
    row.actualStoryPointsEditable = !readOnly && numericEditable(editmeta, ACTUAL_STORY_POINTS_FIELD)
    if (!readOnly && ((storyPointsMissing && !row.storyPointsEditable) || (actualStoryPointsMissing && !row.actualStoryPointsEditable))) row.unavailableReason = "部分缺失欄位無法編輯，請確認 Jira 權限與編輯畫面設定。"
  } else {
    row.defectCause = causeValues(fields, issue)
    if (row.defectCause.length > 0) return null
    row.rootCause = textField(fields.rootCause, issue, JIRA_FIELDS.rootCause.name, warnings)
    row.solution = textField(fields.solution, issue, JIRA_FIELDS.solution.name, warnings)
    const cause = requireField(fields.defectCause, issue)
    row.defectCauseOptions = readOnly ? [] : causeOptions(editmeta, cause.id)
    row.defectCauseEditable = !readOnly && row.defectCauseOptions.length > 0
    if (!readOnly && !row.defectCauseEditable) row.unavailableReason = "Defect Cause 無可用編輯選項，請確認 Jira 權限與欄位設定。"
  }
  return row
}

export async function getMissingDataPage(kind: MissingDataKind, pageToken?: string | null, filter: DashboardFilter = SELF_FILTER): Promise<MissingDataPage> {
  const session = await auth()
  if (!session?.user?.id) throw new JiraDashboardError("reauthorize", "登入狀態已失效，請重新登入。")
  const credentials = await getJiraToken()
  const scope = await resolveDashboardScope(filter, credentials)
  const readOnly = scope.mode !== "self"
  const jql = `${missingDataReadJql(kind, scope)} ORDER BY key ASC`
  const context = { userId: session.user.id, cloudId: credentials.cloudId, kind, jql, filterKey: serializeDashboardFilter(filter) }
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new JiraDashboardError("configuration", "分頁加密設定不完整。")
  let cursor = initialPageCursor()
  if (pageToken) {
    try {
      cursor = openPageToken(pageToken, context, secret)
    } catch {
      throw new JiraDashboardError("invalid_page", "此分頁已過期或無效，請從第一頁重新載入。")
    }
  }
  if (cursor.path.length > MISSING_DATA_LIMIT / MISSING_DATA_PAGE_SIZE) throw limitError()
  const fields = await getFields(credentials, kind)
  const selectedFields = fieldIds(fields, kind, true)
  const result = await search(credentials, jql, selectedFields, MISSING_DATA_PAGE_SIZE, cursor.path.at(-1))
  const warnings = new Set<string>()
  const seen = new Set<string>()
  const issues = await mapConcurrent(result.issues, async (original) => {
    if (seen.has(original.id)) throw invalidResponse()
    seen.add(original.id)
    try {
      const { issue, editmeta } = await liveIssue(credentials, original.id, selectedFields, readOnly)
      return toMissingIssue(fields, issue, kind, editmeta, warnings, readOnly)
    } catch (error) {
      if (!(error instanceof JiraDashboardError) || error.code === "configuration" || error.code === "reauthorize") throw error
      const row = toMissingIssue(fields, original, kind, {}, warnings, readOnly)
      if (row) row.unavailableReason = error.message
      return row
    }
  })
  const next = result.nextPageToken
  if (next && cursor.path.includes(next)) throw invalidResponse()
  if (next && cursor.path.length >= MISSING_DATA_LIMIT / MISSING_DATA_PAGE_SIZE) throw limitError()
  return {
    readOnly,
    issues: issues.filter((issue): issue is MissingIssue => issue !== null),
    page: cursor.path.length,
    nextPageToken: next ? sealPageToken({ path: [...cursor.path, next], expiresAt: cursor.expiresAt }, context, secret) : null,
    previousPageToken: cursor.path.length > 1 ? sealPageToken({ path: cursor.path.slice(0, -1), expiresAt: cursor.expiresAt }, context, secret) : null,
    jiraBaseUrl: baseUrl(), warnings: [...warnings],
  }
}

export async function updateMissingData(kind: MissingDataKind, changes: MissingDataChange[]) {
  const credentials = await getJiraToken(true)
  const fields = await getFields(credentials, kind)
  const ids = changes.map((change) => change.issueId).join(",")
  const eligible = await search(credentials, `(${missingDataJql(kind)}) AND id in (${ids})`, fieldIds(fields, kind, false), MISSING_DATA_PAGE_SIZE)
  if (eligible.nextPageToken) throw invalidResponse()
  const eligibleIds = new Set(eligible.issues.map((issue) => issue.id))
  const results = await mapConcurrent(changes, async (change) => {
    try {
      if (!eligibleIds.has(change.issueId)) throw new JiraDashboardError("retry", "此 Issue 已不在缺失清單中或已被其他人補填，請重新載入。")
      const { issue, editmeta } = await liveIssue(credentials, change.issueId, fieldIds(fields, kind, false))
      const updates: RecordValue = {}
      if (kind === "points") {
        const values = pointsValues(fields, issue)
        const { storyPointsMissing, actualStoryPointsMissing } = missingPoints(values)
        if (!storyPointsMissing && !actualStoryPointsMissing) throw new JiraDashboardError("retry", "此 Issue 的 Points 已完整或已不在缺失範圍，未覆寫；請重新載入。")
        for (const [property, expected, id] of [
          ["storyPoints", "expectedStoryPoints", STORY_POINTS_FIELD],
          ["actualStoryPoints", "expectedActualStoryPoints", ACTUAL_STORY_POINTS_FIELD],
        ] as const) {
          const desired = change[property]
          if (desired === undefined) continue
          const current = values[property]
          if (current !== change[expected]) throw new JiraDashboardError("retry", "Points 已在載入後變更，未覆寫；請重新載入後確認。")
          if (!numericEditable(editmeta, id)) throw new JiraDashboardError("forbidden", "此 Issue 的 Points 欄位無法編輯。")
          updates[id] = desired
        }
      } else {
        const cause = requireField(fields.defectCause, issue)
        if (causeValues(fields, issue).length > 0) throw new JiraDashboardError("retry", "Defect Cause 已被補填，未覆寫；請重新載入。")
        const options = new Set(causeOptions(editmeta, cause.id).map((option) => option.id))
        if (!change.defectCause?.length || change.defectCause.some((id) => !options.has(id))) throw new JiraDashboardError("forbidden", "Defect Cause 選項已變更或無法編輯，請重新載入。")
        updates[cause.id] = change.defectCause.map((id) => ({ id }))
      }
      if (Object.keys(updates).length === 0) throw invalidResponse()
      const response = await jiraFetch(credentials, `/rest/api/3/issue/${encodeURIComponent(issue.id)}`, {
        method: "PUT", body: JSON.stringify({ fields: updates }),
      })
      if (response.status !== 204) throw invalidResponse("Jira 未確認欄位更新成功，請重新載入後確認。")
      return { issueId: change.issueId, success: true as const }
    } catch (error) {
      return { issueId: change.issueId, success: false as const, message: dashboardError(error).message }
    }
  })
  return {
    succeededIssueIds: results.filter((result) => result.success).map((result) => result.issueId),
    failures: results.flatMap((result) => result.success ? [] : [{ issueId: result.issueId, message: result.message }]),
  }
}

async function mapConcurrent<T, R>(values: T[], mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length)
  let index = 0
  async function worker() {
    while (index < values.length) {
      const current = index++
      results[current] = await mapper(values[current])
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, worker))
  return results
}

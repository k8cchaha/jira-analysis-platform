import { parseProjectKey } from "./burndown-params"
import { getProjectSprints, normalizeSprintCalendarDate, type SprintRecord } from "./jira-sprint-data"
import { DASHBOARD_TEAMS, isDashboardAccountId } from "./jira-dashboard-filter"
import { isPointValue } from "./jira-missing-data"
import { DEV_TYPE_GROUP_LABELS, devTypeLabelOf } from "./planning-overview"
import { dateRangeValue } from "./date-range"
import type { SprintProjectKey } from "./jira-jql"

export const PROJECTS_SPRINT_LIMIT = 6
export const PROJECTS_SOURCE_LIMIT = 5_000
export const PROJECTS_DEV_TYPES = [...DEV_TYPE_GROUP_LABELS, "未分類"] as const
export type ProjectsAnalysisRequest = { project: SprintProjectKey; sprintIds: number[]; groups: string[]; browserTimeZone: string }
export type ProjectsAnalysisTask = {
  id: string; key: string; summary: string; parentId: string; parentKey: string
  projectId: string; projectKey: string; issueType: "Dev-Task" | "QA-Task"
  devType: string | null; points: number | null; actualPoints: number | null
  resolvedDate: string | null; assigneeAccountId: string | null; assigneeDisplayName: string | null
  statusName: string | null; sprintIds: number[]
}
export type PointTotal = { sum: number | null; knownCount: number; missingCount: number }
export type WorkTotals = { count: number; sp: PointTotal; actualSp: PointTotal }
export type ProjectsRatio = { numerator: number | null; denominator: number | null; value: number | null; partial: boolean }
export type ProjectsMetric = { kind: "population" | "output" | "unfinished" | "outside" | "commitment-all" | "commitment-done" | "type" | "pressure"; value?: string }
export type ProjectsSprintSummary = {
  sprint: SprintRecord; population: WorkTotals; output: WorkTotals; unfinished: WorkTotals; outsideWindow: WorkTotals
  devTypes: { label: string; totals: WorkTotals }[]; commitment: ProjectsRatio; commitmentPoints: { done: PointTotal; all: PointTotal }
  quality: { count: ProjectsRatio; sp: ProjectsRatio; actualSp: ProjectsRatio }
  pressure: { TKK: WorkTotals; SUN: WorkTotals; combined: WorkTotals }
}
export type ProjectsTeamAttribution =
  | { status: "available"; byAssignee: { accountId: string; teamId: string }[] }
  | { status: "unavailable"; reason: "lookup_failed" | "not_provided" }
export type ProjectsAnalysisResult = {
  schemaVersion: 1; complete: true; historicalSnapshot: false; request: ProjectsAnalysisRequest
  startedAt: string; generatedAt: string; browserToday: string; jiraTimeZone: string
  sourceIssueCount: number; sprints: SprintRecord[]; tasks: ProjectsAnalysisTask[]
  summaries: ProjectsSprintSummary[]; jiraBaseUrl: string | null
  /** Optional only for legacy typed fixtures; the result parser always normalizes it. */
  teamAttribution?: ProjectsTeamAttribution
}
export class ProjectsAnalysisValidationError extends Error {}
function invalid(message = "分析條件或資料無效，請重新選擇後查詢。"): never { throw new ProjectsAnalysisValidationError(message) }
export function projectsRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
export function projectsText(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 10_000 && value === value.trim() }
export function projectsNumericId(value: unknown): value is string { return typeof value === "string" && /^[1-9]\d{0,29}$/.test(value) }
export function projectsTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 100 || value !== value.trim() || /^[+-]/.test(value)) return false
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true } catch { return false }
}
export function projectsCalendarToday(timeZone: string, now = new Date()): string {
  if (!projectsTimeZone(timeZone) || !Number.isFinite(now.getTime())) return invalid()
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, calendar: "iso8601", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  const date = `${get("year")}-${get("month")}-${get("day")}`
  if (dateRangeValue(date) === null) return invalid()
  return date
}
export function parseProjectsAnalysisRequest(value: unknown): ProjectsAnalysisRequest {
  if (!projectsRecord(value) || Object.keys(value).some((key) => !["project", "sprintIds", "groups", "browserTimeZone"].includes(key))) return invalid()
  const project = typeof value.project === "string" ? parseProjectKey(value.project) : null
  if (!project || !Array.isArray(value.sprintIds) || !value.sprintIds.length || value.sprintIds.length > PROJECTS_SPRINT_LIMIT) return invalid(`請選擇專案及 1–${PROJECTS_SPRINT_LIMIT} 個已結束 Sprint。`)
  const allowed = new Set(getProjectSprints(project).map((sprint) => sprint.id))
  if (value.sprintIds.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || !allowed.has(id)) || new Set(value.sprintIds).size !== value.sprintIds.length) return invalid()
  if (!Array.isArray(value.groups) || value.groups.length > DASHBOARD_TEAMS.length || value.groups.some((group) => typeof group !== "string" || !DASHBOARD_TEAMS.some((team) => team.group === group)) || new Set(value.groups).size !== value.groups.length || !projectsTimeZone(value.browserTimeZone)) return invalid()
  return { project, sprintIds: [...value.sprintIds].sort((a, b) => a - b), groups: [...value.groups].sort(), browserTimeZone: value.browserTimeZone }
}
export function projectsAnalysisFingerprint(value: ProjectsAnalysisRequest): string { return JSON.stringify(parseProjectsAnalysisRequest(value)) }
export function resolveProjectsAnalysisSprints(request: ProjectsAnalysisRequest, now = new Date()): SprintRecord[] {
  const today = projectsCalendarToday(request.browserTimeZone, now)
  return request.sprintIds.map((id) => {
    const configured = getProjectSprints(request.project).find((sprint) => sprint.id === id)
    if (!configured) return invalid()
    const startDate = normalizeSprintCalendarDate(configured.startDate), endDate = normalizeSprintCalendarDate(configured.endDate)
    if (!startDate || !endDate || startDate > endDate || endDate >= today) return invalid("僅能分析結束日期早於今天的 Sprint。")
    return { ...configured, startDate, endDate }
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id)
}
export function selectProjectsMetricIssues(tasks: readonly ProjectsAnalysisTask[], sprint: SprintRecord, metric: ProjectsMetric): ProjectsAnalysisTask[] {
  const completed = (task: ProjectsAnalysisTask) => task.resolvedDate !== null && task.resolvedDate >= sprint.startDate && task.resolvedDate <= sprint.endDate
  return tasks.filter((task) => {
    if (!task.sprintIds.includes(sprint.id)) return false
    switch (metric.kind) {
      case "population": return true
      case "output": return completed(task)
      case "unfinished": return task.resolvedDate === null
      case "outside": return task.resolvedDate !== null && !completed(task)
      case "commitment-all": return task.issueType === "Dev-Task"
      case "commitment-done": return task.issueType === "Dev-Task" && completed(task)
      case "type": return completed(task) && devTypeLabelOf(task.devType) === metric.value
      case "pressure": return (task.projectKey === "TKK" || task.projectKey === "SUN") && (!metric.value || task.projectKey === metric.value)
    }
  })
}
export function projectsPointTotal(tasks: readonly ProjectsAnalysisTask[], field: "points" | "actualPoints"): PointTotal {
  let sum = 0, knownCount = 0
  for (const task of tasks) {
    if (!isPointValue(task[field])) return invalid("點數資料無效。")
    if (task[field] !== null) { sum += task[field]; knownCount++ }
  }
  if (!Number.isFinite(sum)) return invalid("點數總計超出可計算範圍。")
  return { sum: tasks.length && !knownCount ? null : sum, knownCount, missingCount: tasks.length - knownCount }
}
export function projectsWorkTotals(tasks: readonly ProjectsAnalysisTask[]): WorkTotals { return { count: tasks.length, sp: projectsPointTotal(tasks, "points"), actualSp: projectsPointTotal(tasks, "actualPoints") } }

function parseTeamAttribution(value: unknown, tasks: readonly ProjectsAnalysisTask[], groups: readonly string[]): ProjectsTeamAttribution {
  if (!projectsRecord(value)) return invalid("團隊歸屬資料不完整，請重試。")
  if (value.status === "unavailable") {
    if (Object.keys(value).some((key) => !["status", "reason"].includes(key)) || (value.reason !== "lookup_failed" && value.reason !== "not_provided")) return invalid()
    return { status: "unavailable", reason: value.reason }
  }
  if (value.status !== "available" || Object.keys(value).some((key) => !["status", "byAssignee"].includes(key)) || !Array.isArray(value.byAssignee)) return invalid()
  const selected = groups.length > 0
  const candidates = new Set<string>(selected ? groups : DASHBOARD_TEAMS.map((team) => team.group))
  const accounts = new Set<string>()
  for (const task of tasks) {
    if (task.assigneeAccountId === null) { if (selected) return invalid(); continue }
    if (!isDashboardAccountId(task.assigneeAccountId)) return invalid()
    accounts.add(task.assigneeAccountId)
  }
  if (value.byAssignee.length !== accounts.size) return invalid()
  const seen = new Set<string>()
  const byAssignee = value.byAssignee.map((entry) => {
    if (!projectsRecord(entry) || Object.keys(entry).some((key) => !["accountId", "teamId"].includes(key)) || !isDashboardAccountId(entry.accountId) || !accounts.has(entry.accountId) || seen.has(entry.accountId) || typeof entry.teamId !== "string" || (!candidates.has(entry.teamId) && (selected || entry.teamId !== "other"))) return invalid()
    seen.add(entry.accountId)
    return { accountId: entry.accountId, teamId: entry.teamId }
  })
  return { status: "available", byAssignee }
}

/** Unavailable attribution is an explicit failure, never a fabricated Other/zero total. */
export function selectProjectsOutputTeamIssues(tasks: readonly ProjectsAnalysisTask[], sprint: SprintRecord, attribution: ProjectsTeamAttribution, teamIds: readonly string[]): ProjectsAnalysisTask[] {
  const validated = parseTeamAttribution(attribution, tasks, [])
  if (validated.status !== "available") return invalid("團隊歸屬暫時無法使用。")
  const allowed = new Set<string>([...DASHBOARD_TEAMS.map((team) => team.group), "other"])
  if (teamIds.some((id) => !allowed.has(id))) return invalid()
  const visible = new Set(teamIds)
  const byAssignee = new Map(validated.byAssignee.map((entry) => [entry.accountId, entry.teamId]))
  return selectProjectsMetricIssues(tasks, sprint, { kind: "output" }).filter((task) => visible.has(task.assigneeAccountId === null ? "other" : byAssignee.get(task.assigneeAccountId)!))
}
export function summarizeProjectsTeamOutput(tasks: readonly ProjectsAnalysisTask[], sprint: SprintRecord, attribution: ProjectsTeamAttribution, teamIds: readonly string[]): WorkTotals {
  return projectsWorkTotals(selectProjectsOutputTeamIssues(tasks, sprint, attribution, teamIds))
}
function ratio(numerator: number | null, denominator: number | null, partial = false): ProjectsRatio {
  const value = numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null
  if (value !== null && !Number.isFinite(value)) return invalid()
  return { numerator, denominator, value, partial }
}
export function summarizeProjectsSprint(tasks: readonly ProjectsAnalysisTask[], sprint: SprintRecord): ProjectsSprintSummary {
  const select = (kind: ProjectsMetric["kind"], value?: string) => selectProjectsMetricIssues(tasks, sprint, { kind, value })
  const bug = projectsWorkTotals(select("type", "Bug")), dev = projectsWorkTotals(select("type", "Dev"))
  const done = projectsWorkTotals(select("commitment-done")), all = projectsWorkTotals(select("commitment-all"))
  const pointsRatio = (a: PointTotal, b: PointTotal) => ratio(a.sum, b.sum, a.missingCount + b.missingCount > 0)
  return {
    sprint, population: projectsWorkTotals(select("population")), output: projectsWorkTotals(select("output")), unfinished: projectsWorkTotals(select("unfinished")), outsideWindow: projectsWorkTotals(select("outside")),
    devTypes: PROJECTS_DEV_TYPES.map((label) => ({ label, totals: projectsWorkTotals(select("type", label)) })), commitment: pointsRatio(done.sp, all.sp), commitmentPoints: { done: done.sp, all: all.sp },
    quality: { count: ratio(bug.count, dev.count), sp: pointsRatio(bug.sp, dev.sp), actualSp: pointsRatio(bug.actualSp, dev.actualSp) },
    pressure: { TKK: projectsWorkTotals(select("pressure", "TKK")), SUN: projectsWorkTotals(select("pressure", "SUN")), combined: projectsWorkTotals(select("pressure")) },
  }
}
function nullableText(value: unknown): value is string | null { return value === null || projectsText(value) }
export function parseProjectsAnalysisResult(value: unknown, expected?: ProjectsAnalysisRequest): ProjectsAnalysisResult {
  if (!projectsRecord(value) || value.schemaVersion !== 1 || value.complete !== true || value.historicalSnapshot !== false) return invalid("分析資料不完整，請重試。")
  const request = parseProjectsAnalysisRequest(value.request)
  if (expected && projectsAnalysisFingerprint(request) !== projectsAnalysisFingerprint(expected)) return invalid("分析範圍與提交條件不符。")
  if (!projectsTimeZone(value.jiraTimeZone) || typeof value.browserToday !== "string" || dateRangeValue(value.browserToday) === null || typeof value.startedAt !== "string" || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.generatedAt)) || Date.parse(value.generatedAt) < Date.parse(value.startedAt)) return invalid()
  if (projectsCalendarToday(request.browserTimeZone, new Date(value.startedAt)) !== value.browserToday) return invalid()
  const sprints = resolveProjectsAnalysisSprints(request, new Date(value.startedAt))
  if (JSON.stringify(value.sprints) !== JSON.stringify(sprints) || !Array.isArray(value.tasks) || value.tasks.length > PROJECTS_SOURCE_LIMIT || typeof value.sourceIssueCount !== "number" || !Number.isInteger(value.sourceIssueCount) || value.sourceIssueCount < value.tasks.length || value.sourceIssueCount > PROJECTS_SOURCE_LIMIT) return invalid()
  const seen = new Set<string>(), parents = new Set<string>()
  const tasks = value.tasks.map((raw): ProjectsAnalysisTask => {
    if (!projectsRecord(raw) || !projectsNumericId(raw.id) || seen.has(raw.id) || !projectsNumericId(raw.parentId) || !projectsNumericId(raw.projectId) || !projectsText(raw.key) || !projectsText(raw.parentKey) || !projectsText(raw.projectKey) || typeof raw.summary !== "string" || raw.summary.length > 100_000 || (raw.issueType !== "Dev-Task" && raw.issueType !== "QA-Task") || !nullableText(raw.devType) || !isPointValue(raw.points) || !isPointValue(raw.actualPoints) || !(raw.assigneeAccountId === null || isDashboardAccountId(raw.assigneeAccountId)) || !nullableText(raw.assigneeDisplayName) || !nullableText(raw.statusName) || !(raw.resolvedDate === null || (typeof raw.resolvedDate === "string" && dateRangeValue(raw.resolvedDate) !== null)) || !Array.isArray(raw.sprintIds) || !raw.sprintIds.length || new Set(raw.sprintIds).size !== raw.sprintIds.length || raw.sprintIds.some((id) => !request.sprintIds.includes(id))) return invalid()
    seen.add(raw.id); parents.add(raw.parentId)
    return { id: raw.id, key: raw.key, summary: raw.summary, parentId: raw.parentId, parentKey: raw.parentKey, projectId: raw.projectId, projectKey: raw.projectKey, issueType: raw.issueType as ProjectsAnalysisTask["issueType"], devType: raw.devType, points: raw.points, actualPoints: raw.actualPoints, resolvedDate: raw.resolvedDate as string | null, assigneeAccountId: raw.assigneeAccountId, assigneeDisplayName: raw.assigneeDisplayName, statusName: raw.statusName, sprintIds: [...raw.sprintIds].sort((a, b) => a - b) }
  })
  if (tasks.length + parents.size > value.sourceIssueCount) return invalid()
  let jiraBaseUrl: string | null = null
  if (value.jiraBaseUrl !== null) {
    if (typeof value.jiraBaseUrl !== "string") return invalid()
    const url = new URL(value.jiraBaseUrl)
    if (url.protocol !== "https:" || url.username || url.password || url.origin !== value.jiraBaseUrl) return invalid()
    jiraBaseUrl = url.origin
  }
  const summaries = sprints.map((sprint) => summarizeProjectsSprint(tasks, sprint))
  const teamAttribution: ProjectsTeamAttribution = Object.hasOwn(value, "teamAttribution")
    ? parseTeamAttribution(value.teamAttribution, tasks, request.groups)
    : { status: "unavailable", reason: "not_provided" }
  return { schemaVersion: 1, complete: true, historicalSnapshot: false, request, startedAt: value.startedAt, generatedAt: value.generatedAt, browserToday: value.browserToday, jiraTimeZone: value.jiraTimeZone, sourceIssueCount: value.sourceIssueCount, sprints, tasks, summaries, jiraBaseUrl, teamAttribution }
}

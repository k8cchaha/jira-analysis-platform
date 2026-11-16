import { SPRINT_PROJECTS, type SprintProjectKey } from "./jira-jql"
import { DASHBOARD_TEAMS } from "./jira-dashboard-filter"
import { burndownQueryParams, getSprintById, isValidLegacyByResolved, parseProjectKey, parseSprintId } from "./burndown-params"
import { projectsFilterHref, projectsFilterResult } from "./projects-filter"
import { teamAnalysisFilterHref, teamAnalysisFilterResult } from "./team-analysis-filter"
import { dateRangeForPreset } from "./date-range"

export interface FilterDefaults {
  project: SprintProjectKey | null
  groups: string[]
}
export const EMPTY_FILTER_DEFAULTS: FilterDefaults = { project: null, groups: [] }
const MAX_STORAGE_LENGTH = 2_048

/** Preferences are UI seeds, not authorization or a submitted Jira scope. */
export function normalizeFilterDefaults(value: unknown): FilterDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("預設值格式無效。")
  const input = value as Record<string, unknown>
  if (input.project !== null && !SPRINT_PROJECTS.some((option) => option.key === input.project)) throw new Error("請選擇有效的專案。")
  if (!Array.isArray(input.groups) || input.groups.length > DASHBOARD_TEAMS.length || input.groups.some((group) => !DASHBOARD_TEAMS.some((team) => team.group === group))) {
    throw new Error("請選擇有效的團隊。")
  }
  return {
    project: input.project as SprintProjectKey | null,
    groups: DASHBOARD_TEAMS.filter((team) => (input.groups as unknown[]).includes(team.group)).map((team) => team.group),
  }
}
export function filterDefaultsStorageKey(viewerId: string): string {
  if (!viewerId) throw new Error("尚未登入，無法儲存預設值。")
  return `jira-analysis:filter-defaults:v1:${viewerId}`
}
export function readFilterDefaults(storage: Pick<Storage, "getItem">, viewerId: string): FilterDefaults {
  try {
    const raw = storage.getItem(filterDefaultsStorageKey(viewerId))
    if (!raw || raw.length > MAX_STORAGE_LENGTH) return EMPTY_FILTER_DEFAULTS
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object" || (value as Record<string, unknown>).version !== 1) return EMPTY_FILTER_DEFAULTS
    return normalizeFilterDefaults(value)
  } catch { return EMPTY_FILTER_DEFAULTS }
}
export function writeFilterDefaults(storage: Pick<Storage, "setItem">, viewerId: string, value: unknown): FilterDefaults {
  const defaults = normalizeFilterDefaults(value)
  try { storage.setItem(filterDefaultsStorageKey(viewerId), JSON.stringify({ version: 1, ...defaults })) }
  catch { throw new Error("無法儲存預設值，請確認瀏覽器允許儲存資料後重試。") }
  return defaults
}
export function defaultDashboardProjects(defaults: FilterDefaults): string[] {
  return defaults.project ? [defaults.project.toLowerCase()] : []
}
export function absentDefaultCondition(params: URLSearchParams, kind: "project" | "team"): boolean {
  return (kind === "project" ? ["project", "sprint"] : ["group", "exclude"]).every((key) => !params.has(key))
}

function filterParamsRecord(params: URLSearchParams): Record<string, string | string[]> {
  const raw: Record<string, string | string[]> = Object.create(null)
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key)
    raw[key] = values.length === 1 ? values[0] : values
  }
  return raw
}

/** Team defaults must not silently replace an invalid or incomplete root URL. */
export function canDefaultTeamGroups(pathname: string, params: URLSearchParams): boolean {
  if (!absentDefaultCondition(params, "team")) return false
  const raw = filterParamsRecord(params)
  if (pathname === "/analytics/projects") return !projectsFilterResult(raw).error
  if (pathname === "/analytics/story-points") return !teamAnalysisFilterResult(raw).error
  if (!["/sprint/planning", "/sprint/burndown"].includes(pathname)) return false
  const allowed = pathname === "/sprint/burndown" ? ["project", "sprint", "byResolved"] : ["project", "sprint"]
  if ([...params.keys()].some((key) => !allowed.includes(key))) return false
  if (!isValidLegacyByResolved(raw.byResolved)) return false
  const project = typeof raw.project === "string" ? parseProjectKey(raw.project) : null
  if (params.has("project") && !project) return false
  if (params.has("sprint")) {
    const sprint = typeof raw.sprint === "string" ? parseSprintId(raw.sprint) : null
    if (!project || !sprint || !getSprintById(project, sprint)) return false
  }
  return true
}

/** Use existing URL validators/builders; never repair an explicit or invalid scope. */
export function defaultProjectHref(pathname: string, params: URLSearchParams, project: SprintProjectKey | null, today: string): string | null {
  if (!project || !absentDefaultCondition(params, "project")) return null
  const raw = filterParamsRecord(params)
  if (pathname === "/analytics/projects") {
    if (projectsFilterResult(raw).error) return null
    return projectsFilterHref({ project, selectedSprintIds: [], error: null })
  }
  if (pathname === "/analytics/story-points") {
    if (teamAnalysisFilterResult(raw).error) return null
    return teamAnalysisFilterHref({ project, dateRange: dateRangeForPreset("last1Month", today), error: null })
  }
  if (!["/sprint/planning", "/sprint/burndown", "/sprint/capacity"].includes(pathname)) return null
  // byResolved=1 is the sole compatible extra parameter on the Sprint root pages.
  if ([...params.keys()].some((key) => pathname !== "/sprint/burndown" || key !== "byResolved")) return null
  if (pathname === "/sprint/burndown" && !isValidLegacyByResolved(raw.byResolved)) return null
  const next = new URLSearchParams(params)
  for (const [key, value] of new URLSearchParams(burndownQueryParams(project, null))) next.set(key, value)
  return `${pathname}?${next}`
}

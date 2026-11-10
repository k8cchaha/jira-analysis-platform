import { parseProjectKey, parseSprintId } from "./burndown-params"
import { getProjectSprints, type SprintRecord } from "./jira-sprint-data"
import { teamAnalysisFilterHref, teamAnalysisFilterResult } from "./team-analysis-filter"
import type { SprintProjectKey } from "./jira-jql"

export type ProjectsSelection = { project: SprintProjectKey | null; selectedSprintIds: readonly number[]; error: string | null }
type ProjectsFilterResult = ProjectsSelection & { sprints: readonly SprintRecord[]; dateMigrationHref: string | null }
const MAX_SPRINT_VALUES = 128
const MAX_QUERY_LENGTH = 16_384
const INVALID_FILTER = "篩選條件無效，請重新選擇專案與 Sprints。"

function validSprintIds(project: SprintProjectKey, values: readonly string[]): number[] {
  if (values.length > MAX_SPRINT_VALUES) throw new Error(INVALID_FILTER)
  const allowed = new Set(getProjectSprints(project).map((sprint) => sprint.id))
  const ids = values.map((value) => {
    const id = value.length <= 16 ? parseSprintId(value) : null
    if (id === null || !allowed.has(id)) throw new Error(INVALID_FILTER)
    return id
  })
  return [...new Set(ids)].sort((a, b) => a - b)
}

/** 僅搬移完全有效的舊日期條件；非法參數不得被刪掉後當作有效範圍。 */
function dateMigrationHref(params: Record<string, string | string[] | undefined>): string | null {
  const hasDates = params.from !== undefined || params.to !== undefined || (Array.isArray(params.mode) ? params.mode.includes("dates") : params.mode === "dates")
  if (!hasDates) return null
  const fallback = "/analytics/story-points"
  if (params.mode !== "dates" || Object.entries(params).some(([key, value]) => value !== undefined && (!["project", "mode", "from", "to"].includes(key) || typeof value !== "string"))) return fallback
  const parsed = teamAnalysisFilterResult({ project: params.project, from: params.from, to: params.to })
  try { return teamAnalysisFilterHref(parsed) } catch { return fallback }
}

export function projectsFilterResult(params: Record<string, string | string[] | undefined>): ProjectsFilterResult {
  const project = parseProjectKey(typeof params.project === "string" ? params.project : undefined)
  const sprints = project ? getProjectSprints(project) : []
  const migrationHref = dateMigrationHref(params)
  try {
    let length = 0
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      if (!["project", "sprint", "mode"].includes(key) || (key !== "sprint" && typeof value !== "string")) throw new Error(INVALID_FILTER)
      const values = Array.isArray(value) ? value : [value]
      if (values.length > MAX_SPRINT_VALUES) throw new Error(INVALID_FILTER)
      for (const item of values) {
        length += key.length + item.length
        if (length > MAX_QUERY_LENGTH) throw new Error(INVALID_FILTER)
      }
    }
    if (params.mode !== undefined && params.mode !== "sprints") throw new Error(INVALID_FILTER)
    if (!project) {
      if (Object.values(params).some((value) => value !== undefined)) throw new Error(INVALID_FILTER)
      return { project: null, sprints: [], selectedSprintIds: [], error: null, dateMigrationHref: null }
    }
    const values = params.sprint === undefined ? [] : Array.isArray(params.sprint) ? params.sprint : [params.sprint]
    return { project, sprints, selectedSprintIds: validSprintIds(project, values), error: null, dateMigrationHref: null }
  } catch {
    return { project, sprints, selectedSprintIds: [], error: INVALID_FILTER, dateMigrationHref: migrationHref }
  }
}

export function projectsFilterHref(selection: ProjectsSelection): string {
  const { project } = selection
  if (!project || parseProjectKey(project) === null || selection.error || "dateRange" in selection || "mode" in selection
    || !Array.isArray(selection.selectedSprintIds) || selection.selectedSprintIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error(INVALID_FILTER)
  const params = new URLSearchParams({ project })
  for (const id of validSprintIds(project, selection.selectedSprintIds.map(String))) params.append("sprint", String(id))
  return `/analytics/projects?${params}`
}

import { parseProjectKey, parseSprintId } from "./burndown-params"
import { requireDateRange, type DateRange } from "./date-range"
import { getProjectSprints, type SprintRecord } from "./jira-sprint-data"
import type { SprintProjectKey } from "./jira-jql"

type ProjectsScope = { project: SprintProjectKey | null; error: string | null }
export type ProjectsSelection = ProjectsScope & (
  | { mode: "sprints"; selectedSprintIds: readonly number[] }
  | { mode: "dates"; dateRange: DateRange | null }
)
type ProjectsFilterResult = ProjectsSelection & { sprints: readonly SprintRecord[] }

const MAX_SPRINT_VALUES = 128
const MAX_QUERY_LENGTH = 16_384
const INVALID_FILTER = "篩選條件無效，請重新選擇專案與資料區間。"

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

/** 專案分析專用：舊網址預設 Sprints，日期與 Sprint 條件不得混用。 */
export function projectsFilterResult(params: Record<string, string | string[] | undefined>): ProjectsFilterResult {
  const project = parseProjectKey(typeof params.project === "string" ? params.project : undefined)
  const sprints = project ? getProjectSprints(project) : []
  const mode = params.mode === "dates" ? "dates" : "sprints"
  try {
    let length = 0
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      if (!["project", "sprint", "mode", "from", "to"].includes(key)) throw new Error(INVALID_FILTER)
      if (key !== "sprint" && typeof value !== "string") throw new Error(INVALID_FILTER)
      const values = Array.isArray(value) ? value : [value]
      if (values.length > MAX_SPRINT_VALUES) throw new Error(INVALID_FILTER)
      for (const item of values) {
        length += key.length + item.length
        if (length > MAX_QUERY_LENGTH) throw new Error(INVALID_FILTER)
      }
    }
    if (params.mode !== undefined && params.mode !== "sprints" && params.mode !== "dates") throw new Error(INVALID_FILTER)
    if (!project) {
      if (Object.values(params).some((value) => value !== undefined)) throw new Error(INVALID_FILTER)
      return { project: null, sprints: [], mode: "sprints", selectedSprintIds: [], error: null }
    }
    if (mode === "dates") {
      if (params.sprint !== undefined || typeof params.from !== "string" || typeof params.to !== "string") throw new Error(INVALID_FILTER)
      const dateRange = requireDateRange({ from: params.from, to: params.to })
      return { project, sprints, mode, dateRange, error: null }
    }
    if (params.from !== undefined || params.to !== undefined) throw new Error(INVALID_FILTER)
    const values = params.sprint === undefined ? [] : Array.isArray(params.sprint) ? params.sprint : [params.sprint]
    return { project, sprints, mode, selectedSprintIds: validSprintIds(project, values), error: null }
  } catch {
    // 無效 URL 不可視為空選取／不限區間；保留合法專案及明確錯誤，不自動修正。
    return mode === "dates"
      ? { project, sprints, mode, dateRange: null, error: INVALID_FILTER }
      : { project, sprints, mode, selectedSprintIds: [], error: INVALID_FILTER }
  }
}

/** 固定頁面路徑；驗證完整作用中區間後才產生可分享的網址。 */
export function projectsFilterHref(selection: ProjectsSelection): string {
  const { project } = selection
  if (!project || parseProjectKey(project) === null || selection.error) throw new Error(INVALID_FILTER)
  const params = new URLSearchParams({ project })
  if (selection.mode === "sprints") {
    if ("dateRange" in selection || !Array.isArray(selection.selectedSprintIds) || selection.selectedSprintIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error(INVALID_FILTER)
    const ids = validSprintIds(project, selection.selectedSprintIds.map(String))
    for (const id of ids) params.append("sprint", String(id))
  } else if (selection.mode === "dates") {
    if ("selectedSprintIds" in selection || !selection.dateRange) throw new Error(INVALID_FILTER)
    try {
      const range = requireDateRange(selection.dateRange)
      params.set("mode", "dates")
      params.set("from", range.from)
      params.set("to", range.to)
    } catch { throw new Error(INVALID_FILTER) }
  } else { throw new Error(INVALID_FILTER) }
  return `/analytics/projects?${params.toString()}`
}

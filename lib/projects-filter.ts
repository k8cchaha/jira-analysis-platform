import { parseProjectKey, parseSprintId } from "./burndown-params"
import { getProjectSprints, type SprintRecord } from "./jira-sprint-data"
import type { SprintProjectKey } from "./jira-jql"

export interface ProjectsSelection {
  project: SprintProjectKey | null
  selectedSprintIds: readonly number[]
  error: string | null
}

interface ProjectsFilterResult extends ProjectsSelection {
  sprints: readonly SprintRecord[]
}

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

/** 專案分析專用；多 Sprint 不使用 Planning 的日期篩選或預設回退。 */
export function projectsFilterResult(params: Record<string, string | string[] | undefined>): ProjectsFilterResult {
  const project = parseProjectKey(typeof params.project === "string" ? params.project : undefined)
  const sprints = project ? getProjectSprints(project) : []
  try {
    let length = 0
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      if (key !== "project" && key !== "sprint") throw new Error(INVALID_FILTER)
      const values = Array.isArray(value) ? value : [value]
      if (values.length > MAX_SPRINT_VALUES) throw new Error(INVALID_FILTER)
      for (const item of values) {
        length += key.length + item.length
        if (length > MAX_QUERY_LENGTH) throw new Error(INVALID_FILTER)
      }
    }
    const values = params.sprint === undefined ? [] : Array.isArray(params.sprint) ? params.sprint : [params.sprint]
    if (!project) {
      if (params.project !== undefined || values.length > 0) throw new Error(INVALID_FILTER)
      return { project: null, sprints: [], selectedSprintIds: [], error: null }
    }
    return { project, sprints, selectedSprintIds: validSprintIds(project, values), error: null }
  } catch {
    // 錯誤狀態不可視為空選取／不限制 Sprint；保留合法專案供使用者重新選取。
    return { project, sprints, selectedSprintIds: [], error: INVALID_FILTER }
  }
}

/** 固定頁面路徑；驗證完整 selection 後才建立可分享的重複 sprint 參數。 */
export function projectsFilterHref(project: SprintProjectKey, selectedSprintIds: readonly number[]): string {
  if (parseProjectKey(project) === null || selectedSprintIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error(INVALID_FILTER)
  }
  const ids = validSprintIds(project, selectedSprintIds.map(String))
  const params = new URLSearchParams({ project })
  for (const id of ids) params.append("sprint", String(id))
  return `/analytics/projects?${params.toString()}`
}

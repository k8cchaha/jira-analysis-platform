import { parseProjectKey } from "./burndown-params"
import { requireDateRange, type DateRange } from "./date-range"
import type { SprintProjectKey } from "./jira-jql"

export type TeamAnalysisSelection = {
  project: SprintProjectKey | null
  dateRange: DateRange | null
  error: string | null
}
const INVALID_FILTER = "篩選條件無效，請重新選擇專案與分析區間。"
const MAX_QUERY_LENGTH = 16_384

/** 空網址是初始狀態；任何已提交條件都必須包含專案及完整日期。 */
export function teamAnalysisFilterResult(params: Record<string, string | string[] | undefined>): TeamAnalysisSelection {
  const project = parseProjectKey(typeof params.project === "string" ? params.project : undefined)
  try {
    let length = 0
    let populated = false
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      populated = true
      if (!["project", "from", "to"].includes(key) || typeof value !== "string") throw new Error(INVALID_FILTER)
      length += key.length + value.length
      if (length > MAX_QUERY_LENGTH) throw new Error(INVALID_FILTER)
    }
    if (!populated) return { project: null, dateRange: null, error: null }
    if (!project || typeof params.from !== "string" || typeof params.to !== "string") throw new Error(INVALID_FILTER)
    return { project, dateRange: requireDateRange({ from: params.from, to: params.to }), error: null }
  } catch {
    return { project, dateRange: null, error: INVALID_FILTER }
  }
}

export function teamAnalysisFilterHref(selection: TeamAnalysisSelection): string {
  if (!selection.project || parseProjectKey(selection.project) === null || selection.error || !selection.dateRange
    || "mode" in selection || "sprint" in selection || "selectedSprintIds" in selection) throw new Error(INVALID_FILTER)
  try {
    const range = requireDateRange(selection.dateRange)
    return `/analytics/story-points?${new URLSearchParams({ project: selection.project, from: range.from, to: range.to })}`
  } catch { throw new Error(INVALID_FILTER) }
}

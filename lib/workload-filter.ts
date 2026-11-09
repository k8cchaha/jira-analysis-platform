import {
  DashboardFilterError,
  parseDashboardFilter,
  serializeDashboardFilter,
} from "@/lib/jira-dashboard-filter"
import type { DashboardFilter } from "@/lib/jira-dashboard-filter"
import { requireDateRange, type DateRange } from "@/lib/date-range"

/**
 * 工作量分析的查詢條件：團隊／成員／專案加上「分析區間」。
 *
 * 日期一律以 `from` / `to`（含當日）承載，與「近 N 天」是**不同**的模型：
 * 快捷鍵（今日／本週／上週／本月／近 7 日／近 30 日）在瀏覽器端展開成絕對日期後
 * 才進來，因此伺服器不必知道使用者當初按下哪個快捷鍵，也不必用伺服器時區重算；
 * 還原時再由畫面比對日期回頭標示快捷鍵。
 *
 * 仍沿用 Dashboard 的團隊／成員／專案驗證（群組白名單、成員上限、URL 長度），
 * `days` 只在串接 dashboard serializer 時以 30 代入，會被序列化時略過，不代表查詢範圍。
 *
 * UI selections and the analysis date window. The workload query population is defined by
 * the heatmap builders in `lib/jira-jql.ts` (Dev-Task completion, same as the Burndown chart);
 * this module only validates and serializes the conditions.
 */
export type WorkloadFilter = Omit<Extract<DashboardFilter, { mode: "team-project" }>, "mode" | "days" | "includeUnexpectedClosed"> & DateRange
export type WorkloadFilterResult = { filter: WorkloadFilter | null; error: string | null }
const keys = new Set(["group", "exclude", "project", "from", "to"])
/** Dashboard serializer 只在日期等於 30 時才省略 `days`；區間模型不需寫入天數。 */
const SERIALIZED_DAYS = 30

/** 讀取單一 `from` / `to`；缺少、重複或非日期一律視為無效，不套用任何預設區間。 */
function singleDate(params: URLSearchParams, key: "from" | "to"): string {
  const values = params.getAll(key)
  if (values.length !== 1) throw new DashboardFilterError()
  return values[0]
}

function requireRange(from: string, to: string): DateRange {
  try {
    return requireDateRange({ from, to })
  } catch (error) {
    throw error instanceof RangeError ? new DashboardFilterError(error.message) : new DashboardFilterError()
  }
}

export function parseWorkloadFilter(params: URLSearchParams): WorkloadFilter | null {
  if (params.size === 0) return null
  const range = requireRange(singleDate(params, "from"), singleDate(params, "to"))
  for (const key of params.keys()) if (!keys.has(key)) throw new DashboardFilterError()
  const input = new URLSearchParams(params)
  input.delete("from")
  input.delete("to")
  input.set("mode", "team-project")
  input.set("days", String(SERIALIZED_DAYS))
  const parsed = parseDashboardFilter(input)
  if (parsed.mode !== "team-project") throw new DashboardFilterError()
  return { groups: parsed.groups, exclusions: parsed.exclusions, projects: parsed.projects, ...range }
}

export function workloadFilterResult(params: URLSearchParams): WorkloadFilterResult {
  try { return { filter: parseWorkloadFilter(params), error: null } }
  catch (error) {
    return { filter: null, error: error instanceof DashboardFilterError ? error.message : "篩選條件無效。" }
  }
}

export function serializeWorkloadFilter(filter: WorkloadFilter): string {
  const { from, to, groups, exclusions, projects } = filter
  const range = requireRange(from, to)
  const params = new URLSearchParams(serializeDashboardFilter({ groups, exclusions, projects, mode: "team-project", days: SERIALIZED_DAYS }))
  params.delete("mode")
  params.delete("days")
  params.set("from", range.from)
  params.set("to", range.to)
  return params.toString()
}

export function workloadHref(filter: WorkloadFilter): string {
  return `/analytics/workload?${serializeWorkloadFilter(filter)}`
}
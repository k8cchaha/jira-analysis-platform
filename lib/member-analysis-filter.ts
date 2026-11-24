import {
  DashboardFilterError,
  parseDashboardFilter,
  type DashboardFilter,
} from "./jira-dashboard-filter.ts"
import { requireDateRange, type DateRange } from "./date-range.ts"

/**
 * 成員分析的查詢條件：與工作量分析相同的團隊／成員／專案加上 `from` / `to` 區間。
 * 只有條件驗證與序列化；JQL 與 Jira I/O 由 `jira-jql.ts` 與服務層負責。
 */
export type MemberAnalysisFilter = Omit<Extract<DashboardFilter, { mode: "team-project" }>, "mode" | "days" | "includeUnexpectedClosed"> & DateRange
const keys = new Set(["group", "exclude", "project", "from", "to"])
/** Dashboard serializer 只在日期等於 30 時才省略 `days`；這裡以 30 代入僅為通過驗證。 */
const SERIALIZED_DAYS = 30

function singleDate(params: URLSearchParams, key: "from" | "to"): string {
  const values = params.getAll(key)
  if (values.length !== 1) throw new DashboardFilterError("請選擇完整的分析區間。")
  return values[0]
}

function requireRange(from: string, to: string): DateRange {
  try {
    return requireDateRange({ from, to })
  } catch (error) {
    throw error instanceof RangeError ? new DashboardFilterError(error.message) : new DashboardFilterError()
  }
}

/** 空參數代表尚未查詢（回 null）；其餘一律完整驗證。 */
export function parseMemberAnalysisFilter(params: URLSearchParams): MemberAnalysisFilter | null {
  if (params.size === 0) return null
  const range = requireRange(singleDate(params, "from"), singleDate(params, "to"))
  for (const key of params.keys()) if (!keys.has(key)) throw new DashboardFilterError("查詢參數無效。")
  const input = new URLSearchParams(params)
  input.delete("from")
  input.delete("to")
  input.set("mode", "team-project")
  input.set("days", String(SERIALIZED_DAYS))
  const parsed = parseDashboardFilter(input)
  if (parsed.mode !== "team-project") throw new DashboardFilterError()
  return { groups: [...parsed.groups], exclusions: { ...parsed.exclusions }, projects: [...parsed.projects], ...range }
}

/** 路由參數 → 已驗證條件；空參數回 null。 */
export function parseMemberAnalysisParams(params: URLSearchParams): { filter: MemberAnalysisFilter; range: DateRange } | null {
  const filter = parseMemberAnalysisFilter(params)
  return filter ? { filter, range: { from: filter.from, to: filter.to } } : null
}

export function memberAnalysisFilterResult(params: URLSearchParams): { filter: MemberAnalysisFilter | null; error: string | null } {
  try {
    return { filter: parseMemberAnalysisFilter(params), error: null }
  } catch (error) {
    return { filter: null, error: error instanceof DashboardFilterError ? error.message : "篩選條件無效。" }
  }
}

/**
 * 成員分析的查詢字串；與工作量分析相同的鍵，順序固定。
 *
 * 不使用 `serializeDashboardFilter`：它會把結果再丟回 `parseDashboardFilter` 自我驗證，而驗證用的
 * `Set` 在伺服器 worker 與其他 import 之間可能不是同一份（`instanceof` 會失敗），造成明明有效的
 * 條件被當成無效。這裡改以同一份 builder 自行組字串，驗證交給路由端的 `parseMemberAnalysisFilter`。
 */
export function serializeMemberAnalysisFilter(filter: MemberAnalysisFilter): string {
  const { from, to, groups, exclusions, projects } = filter
  const range = requireRange(from, to)
  const unique = <T>(values: readonly T[]) => [...new Set(values)]
  if (!unique(groups).length) throw new DashboardFilterError("請至少選擇一個團隊。")
  const params = new URLSearchParams()
  for (const group of unique(groups)) params.append("group", group)
  for (const group of unique(groups)) for (const id of unique(exclusions[group] ?? [])) params.append("exclude", `${group}|${id}`)
  for (const project of unique(projects)) params.append("project", project)
  params.delete("mode")
  params.delete("days")
  params.set("from", range.from)
  params.set("to", range.to)
  return params.toString()
}

export const DASHBOARD_TEAMS = [
  { label: "Web", group: "ent-web" }, { label: "BE1", group: "ent-be1" },
  { label: "BE2", group: "ent-be2" }, { label: "Android", group: "ent-android" },
  { label: "Design", group: "ent-design" }, { label: "EP", group: "ent-ep" },
  { label: "iOS", group: "ent-ios" }, { label: "SDET", group: "ent-sdet" },
  { label: "SRE", group: "ent-sre" }, { label: "Pride", group: "ent-pride" },
  { label: "QA", group: "ent-qa" },
] as const
export const DASHBOARD_PROJECTS = [
  { label: "Saku", key: "sun" }, { label: "Telasa", key: "tkk" }, { label: "Pride", key: "pride" },
] as const

export interface DashboardUser { accountId: string; displayName: string }
export type DashboardFilter =
  | { mode: "self" }
  | { mode: "person"; accountId: string; name: string; days: number }
  | { mode: "team-project"; groups: string[]; exclusions: Record<string, string[]>; projects: string[]; days: number }
export type ResolvedDashboardScope =
  | { mode: "self" }
  | { mode: "person" | "team-project"; accountIds: string[]; projects: string[]; days: number }
export type DashboardFilterResult = { filter: DashboardFilter; error: null } | { filter: null; error: string }
export const SELF_FILTER: DashboardFilter = { mode: "self" }
export const DASHBOARD_URL_LIMIT = 16_384
export const DASHBOARD_MEMBER_LIMIT = 1_000
export const DASHBOARD_JQL_LIMIT = 32_000
const filterKeys = new Set(["mode", "accountId", "name", "days", "group", "exclude", "project"])
const teamNames = new Set<string>(DASHBOARD_TEAMS.map((team) => team.group))
const projectKeys = new Set<string>(DASHBOARD_PROJECTS.map((project) => project.key))

export class DashboardFilterError extends Error {
  constructor(message = "篩選條件無效，請重新選擇後查詢。") {
    super(message)
    this.name = "DashboardFilterError"
  }
}
export function isDashboardAccountId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9:_-]{1,128}$/.test(value)
}
export function dashboardDays(value: string): number {
  const number = Number(value)
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number)) {
    throw new DashboardFilterError("近 X 天必須是大於 0 的整數。")
  }
  return number
}
function unique(values: string[]): string[] { return [...new Set(values)].sort() }
function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key)
  if (values.length > 1) throw new DashboardFilterError()
  return values[0] ?? null
}
export function dashboardSearchParams(value: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, items] of Object.entries(value)) {
    for (const item of Array.isArray(items) ? items : items === undefined ? [] : [items]) params.append(key, item)
  }
  return params
}

export function parseDashboardFilter(params: URLSearchParams, allowedExtras: string[] = []): DashboardFilter {
  const filterParams = new URLSearchParams([...params].filter(([key]) => !allowedExtras.includes(key)))
  if (filterParams.toString().length > DASHBOARD_URL_LIMIT || [...filterParams].length > 1_100) {
    throw new DashboardFilterError("篩選條件過大，請減少成員排除項目。")
  }
  for (const key of params.keys()) if (!filterKeys.has(key) && !allowedExtras.includes(key)) throw new DashboardFilterError()
  const mode = single(params, "mode") ?? "self"
  if (!["self", "person", "team-project"].includes(mode)) throw new DashboardFilterError()
  // Inactive fields are discarded when a mode is serialized, not used to broaden its query.
  if (mode === "self") return SELF_FILTER
  const days = dashboardDays(single(params, "days") ?? "30")
  if (mode === "person") {
    const accountId = single(params, "accountId")
    const name = single(params, "name") ?? ""
    if (!isDashboardAccountId(accountId) || name.length > 200 || /[\u0000-\u001f]/.test(name)) throw new DashboardFilterError()
    return { mode, accountId, name, days }
  }
  const groups = unique(params.getAll("group"))
  const projects = unique(params.getAll("project"))
  if (!groups.length || groups.some((group) => !teamNames.has(group)) || projects.some((key) => !projectKeys.has(key))) throw new DashboardFilterError()
  const exclusions: Record<string, string[]> = {}
  const excluded = params.getAll("exclude")
  if (excluded.length > DASHBOARD_MEMBER_LIMIT) throw new DashboardFilterError("排除成員過多，請縮小團隊選取範圍。")
  for (const item of excluded) {
    const separator = item.indexOf("|")
    const group = item.slice(0, separator)
    const accountId = item.slice(separator + 1)
    if (separator < 0 || !groups.includes(group) || !isDashboardAccountId(accountId)) throw new DashboardFilterError()
    ;(exclusions[group] ??= []).push(accountId)
  }
  for (const group of Object.keys(exclusions)) exclusions[group] = unique(exclusions[group])
  return { mode: "team-project", groups, exclusions, projects, days }
}
export function dashboardFilterResult(params: URLSearchParams): DashboardFilterResult {
  try { return { filter: parseDashboardFilter(params), error: null } }
  catch (error) { return { filter: null, error: error instanceof DashboardFilterError ? error.message : "篩選條件無效。" } }
}
export function serializeDashboardFilter(filter: DashboardFilter): string {
  const params = new URLSearchParams()
  if (filter.mode !== "self") {
    params.set("mode", filter.mode)
    if (filter.mode === "person") {
      params.set("accountId", filter.accountId)
      if (filter.name) params.set("name", filter.name)
    } else {
      for (const group of unique(filter.groups)) params.append("group", group)
      for (const group of unique(filter.groups)) for (const id of unique(filter.exclusions[group] ?? [])) params.append("exclude", `${group}|${id}`)
      for (const project of unique(filter.projects)) params.append("project", project)
    }
    if (filter.days !== 30) params.set("days", String(filter.days))
  }
  parseDashboardFilter(params)
  return params.toString()
}
export function dashboardHref(filter: DashboardFilter): string {
  const query = serializeDashboardFilter(filter)
  return `/dashboard${query ? `?${query}` : ""}`
}
export function dashboardReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > DASHBOARD_URL_LIMIT + 20) throw new DashboardFilterError()
  const url = new URL(value, "https://dashboard.invalid")
  if (url.origin !== "https://dashboard.invalid" || url.pathname !== "/dashboard" || url.hash) throw new DashboardFilterError()
  return dashboardHref(parseDashboardFilter(url.searchParams))
}
export function includedDashboardMembers(groups: string[], exclusions: Record<string, string[]>, members: Record<string, DashboardUser[]>): string[] {
  const ids = new Set<string>()
  for (const group of groups) {
    if (!members[group]) throw new DashboardFilterError("所選團隊成員尚未完整載入。")
    const excluded = new Set(exclusions[group] ?? [])
    for (const member of members[group]) {
      if (!isDashboardAccountId(member.accountId)) throw new DashboardFilterError()
      if (!excluded.has(member.accountId)) ids.add(member.accountId)
    }
  }
  if (ids.size === 0) throw new DashboardFilterError("請至少選擇一名團隊成員。")
  if (ids.size > DASHBOARD_MEMBER_LIMIT) throw new DashboardFilterError("所選成員超過 1,000 人，請縮小團隊範圍。")
  return [...ids].sort()
}

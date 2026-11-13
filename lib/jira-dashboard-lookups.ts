import "server-only"

import {
  DASHBOARD_MEMBER_LIMIT,
  DASHBOARD_TEAMS,
  DashboardFilterError,
  includedDashboardMembers,
  isDashboardAccountId,
  parseDashboardFilter,
  serializeDashboardFilter,
  type DashboardFilter,
  type DashboardUser,
  type ResolvedDashboardScope,
} from "@/lib/jira-dashboard-filter"
import { JiraAuthorizationError, type JiraCredentials } from "@/lib/jira-token"
import type { MissingDataError } from "@/lib/jira-missing-data"
import { jiraFetch as httpJiraFetch, JiraTransportError } from "@/lib/jira-http"
import { getSharedJiraGroupMembersCache } from "@/lib/jira-group-members-cache"

const PAGE_SIZE = 50
const USER_SEARCH_LIMIT = 20
const PAGE_LIMIT = 100
const GROUP_CONCURRENCY = 4
const allowedGroups = new Set<string>(DASHBOARD_TEAMS.map((team) => team.group))

export class JiraDashboardLookupError extends Error {
  constructor(readonly code: MissingDataError["code"], message: string) {
    super(message)
    this.name = "JiraDashboardLookupError"
  }
}

export function lookupError(error: unknown): MissingDataError {
  if (error instanceof JiraDashboardLookupError) return { code: error.code, message: error.message }
  if (error instanceof DashboardFilterError) return { code: "invalid_page", message: error.message }
  if (error instanceof JiraAuthorizationError) {
    return error.code === "invalid_configuration"
      ? { code: "configuration", message: "Jira OAuth 設定不完整，請聯繫管理員。" }
      : { code: "reauthorize", message: "Jira 授權已失效，請重新授權。" }
  }
  return { code: "retry", message: "暫時無法取得 Jira 使用者或團隊成員，請稍後重試。" }
}

function invalidResponse() {
  return new JiraDashboardLookupError("retry", "Jira 使用者或團隊成員資料不完整，請稍後重試。")
}
function memberLimit() {
  return new JiraDashboardLookupError("limit", "團隊成員超過 1,000 人，請縮小團隊範圍。")
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}
function validateGroup(group: string, allowlist: ReadonlySet<string>) {
  if (!allowlist.has(group)) throw new DashboardFilterError("請選擇有效的團隊。")
}

export function validateDashboardUserQuery(query: string): string {
  if (typeof query !== "string" || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new DashboardFilterError("使用者搜尋文字必須是 1 到 100 個字元。")
  }
  const value = query.trim()
  if (value.length < 1 || value.length > 100) throw new DashboardFilterError("使用者搜尋文字必須是 1 到 100 個字元。")
  return value
}

async function jiraLookup(credentials: JiraCredentials, path: string, params: URLSearchParams, group = false): Promise<unknown> {
  const query = params.toString()
  let response: Response
  try {
    response = await httpJiraFetch(
      credentials,
      `/rest/api/3/${path}${query ? `?${query}` : ""}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      }
    )
  } catch (cause) {
    if (cause instanceof JiraTransportError) {
      throw new JiraDashboardLookupError("retry", "暫時無法連線至 Jira，請稍後重試。")
    }
    throw cause
  }
  if (!response.ok) {
    if (response.status === 401) throw new JiraDashboardLookupError("reauthorize", "Jira 授權已失效，請重新授權。")
    if (response.status === 403) {
      throw new JiraDashboardLookupError("forbidden", group
        ? "讀取團隊成員需要 Jira 全域權限 Browse users and groups 或 Administer Jira；若缺少 OAuth scopes，請重新授權。"
        : "讀取使用者需要 Jira 全域權限 Browse users and groups；若缺少 OAuth scopes，請重新授權。")
    }
    if (response.status === 404) throw new JiraDashboardLookupError(group ? "configuration" : "invalid_page", group ? "所選團隊不存在或無法存取，請聯繫管理員。" : "所選使用者不存在或無法存取，請重新選擇。")
    if (response.status === 400) throw new JiraDashboardLookupError("configuration", "Jira 無法接受使用者或團隊查詢，請確認設定與權限。")
    if (response.status === 429) throw new JiraDashboardLookupError("retry", "Jira 請求過於頻繁，請稍後重試。")
    throw new JiraDashboardLookupError("retry", "Jira 暫時無法完成查詢，請稍後重試。")
  }
  try { return await response.json() }
  catch { throw invalidResponse() }
}

// Jira identity, never a caller-supplied display name or email, determines membership.
function dashboardUser(value: unknown): DashboardUser | null {
  if (!record(value) || !isDashboardAccountId(value.accountId)) throw invalidResponse()
  if (value.accountType === "app" || value.accountType === "customer") return null
  if (value.accountType !== "atlassian" || typeof value.displayName !== "string" || !value.displayName.trim() || value.displayName.length > 200 || /[\u0000-\u001f\u007f]/.test(value.displayName)) throw invalidResponse()
  return { accountId: value.accountId, displayName: value.displayName }
}

export async function searchDashboardUsers(query: string, credentials: JiraCredentials): Promise<DashboardUser[]> {
  const value = validateDashboardUserQuery(query)
  const data = await jiraLookup(credentials, "user/search", new URLSearchParams({ query: value, startAt: "0", maxResults: String(USER_SEARCH_LIMIT) }))
  if (!Array.isArray(data) || data.length > USER_SEARCH_LIMIT) throw invalidResponse()
  const users = new Map<string, DashboardUser>()
  for (const raw of data) {
    const user = dashboardUser(raw)
    if (user) users.set(user.accountId, user)
  }
  const results = [...users.values()]
  const normalizedQuery = value.toLowerCase()
  const exactMatches = results.filter((user) => user.displayName.toLowerCase() === normalizedQuery)
  return exactMatches.length ? exactMatches : results
}

/**
 * 撈單一 Jira 群組的成員（完整分頁、總量與去重驗證）。預設只允許 `DASHBOARD_TEAMS`
 * 的團隊群；`options.allowlist` 可提供額外的許可群組（例如 Planning 的 PM 群），
 * 用於 server 端內部解析，不影響儀表板團隊下拉的暴露範圍。
 */
export async function getDashboardGroupMembers(
  group: string,
  credentials: JiraCredentials,
  options: { allowlist?: ReadonlySet<string>; useSharedCache?: boolean } = {}
): Promise<DashboardUser[]> {
  // Always validate before a hit, including groups allowed only by private server callers.
  validateGroup(group, options.allowlist ?? allowedGroups)
  if (options.useSharedCache) {
    try {
      return await getSharedJiraGroupMembersCache().get(credentials, group, () => fetchCompleteGroupMembers(group, credentials))
    } catch (error) {
      // The shared instance may have been created by a different route bundle/class copy.
      if (error instanceof Error && "code" in error) {
        if (error.code === "group_members_cache_capacity") {
          throw new JiraDashboardLookupError("retry", "團隊成員查詢忙碌中，請稍後重試。")
        }
        if (error.code === "reauthorization_required") {
          throw new JiraAuthorizationError("Jira authorization must be renewed", "reauthorization_required")
        }
      }
      throw error
    }
  }
  return fetchCompleteGroupMembers(group, credentials)
}

async function fetchCompleteGroupMembers(group: string, credentials: JiraCredentials): Promise<DashboardUser[]> {
  const members: DashboardUser[] = []
  const seen = new Set<string>()
  let startAt = 0
  let expectedTotal: number | undefined
  for (let page = 0; page < PAGE_LIMIT; page++) {
    const data = await jiraLookup(credentials, "group/member", new URLSearchParams({ groupname: group, maxResults: String(PAGE_SIZE), startAt: String(startAt) }), true)
    if (!record(data) || !Array.isArray(data.values) || data.values.length > PAGE_SIZE) throw invalidResponse()
    if (data.startAt !== undefined && (!nonnegativeInteger(data.startAt) || data.startAt !== startAt)) throw invalidResponse()
    if (data.isLast !== undefined && typeof data.isLast !== "boolean") throw invalidResponse()
    if (data.total !== undefined) {
      if (!nonnegativeInteger(data.total)) throw invalidResponse()
      if (data.total > DASHBOARD_MEMBER_LIMIT) throw memberLimit()
      if (expectedTotal !== undefined && data.total !== expectedTotal) throw invalidResponse()
      expectedTotal = data.total
    }
    const next = startAt + data.values.length
    if (next > DASHBOARD_MEMBER_LIMIT) throw memberLimit()
    if (expectedTotal !== undefined && next > expectedTotal) throw invalidResponse()
    for (const raw of data.values) {
      const user = dashboardUser(raw)
      const id = (raw as Record<string, unknown>).accountId as string
      if (seen.has(id)) throw invalidResponse()
      seen.add(id)
      if (user) members.push(user)
    }
    // Explicit completion or a verified total is required; never infer completion from a short page.
    const reachedTotal = expectedTotal !== undefined && next === expectedTotal
    if (data.isLast === true) {
      if (expectedTotal !== undefined && !reachedTotal) throw invalidResponse()
      return members
    }
    if (data.isLast === false && reachedTotal) throw invalidResponse()
    if (data.isLast === undefined && reachedTotal) return members
    if (!data.values.length || (data.isLast === undefined && expectedTotal === undefined)) throw invalidResponse()
    startAt = next
  }
  throw new JiraDashboardLookupError("limit", "團隊成員分頁過多，無法完整載入，請縮小團隊範圍。")
}

/** Complete per-group rosters only: union/exclusion eligibility belongs to the scope caller.
 * Checks are caller-local and never abort transports shared by another request.
 */
export async function loadDashboardGroupMembers(
  groups: readonly string[],
  credentials: JiraCredentials,
  options: { useSharedCache?: boolean; check?: () => void } = {}
): Promise<Record<string, DashboardUser[]>> {
  if (!Array.isArray(groups) || groups.length > DASHBOARD_TEAMS.length || new Set(groups).size !== groups.length) throw new DashboardFilterError("請選擇有效的團隊。")
  for (const group of groups) validateGroup(group, allowedGroups)
  options.check?.()
  const members: Record<string, DashboardUser[]> = {}
  let cursor = 0
  let failed = false
  const results = await Promise.allSettled(Array.from({ length: Math.min(GROUP_CONCURRENCY, groups.length) }, async () => {
    while (!failed && cursor < groups.length) {
      try {
        options.check?.()
        const group = groups[cursor++]
        members[group] = await getDashboardGroupMembers(group, credentials, options)
        options.check?.()
      } catch (error) { failed = true; options.check?.(); throw error }
    }
  }))
  options.check?.()
  // Wait for already shared/in-flight work so an auth failure cannot be hidden by
  // a faster membership-only failure. Never schedule another group after failure.
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason)
  const protectedError = errors.find((error) => error instanceof JiraAuthorizationError || (error instanceof Error && "code" in error && ["reauthorize", "configuration", "cancelled", "reauthorization_required", "invalid_configuration"].includes(String(error.code))))
  if (protectedError !== undefined) throw protectedError
  if (errors.length) throw errors[0]
  return members
}

export async function resolveDashboardScope(
  filter: DashboardFilter,
  credentials: JiraCredentials,
  options: { useSharedCache?: boolean } = {}
): Promise<ResolvedDashboardScope> {
  if (filter.mode === "self") return { mode: "self" }
  const validated = parseDashboardFilter(new URLSearchParams(serializeDashboardFilter(filter)))
  if (validated.mode === "self") return { mode: "self" }
  if (validated.mode === "person") {
    const raw = await jiraLookup(credentials, "user", new URLSearchParams({ accountId: validated.accountId }))
    const user = dashboardUser(raw)
    if (!user || user.accountId !== validated.accountId) throw new DashboardFilterError("所選使用者無效，請重新選擇。")
    return { mode: "person", accountIds: [user.accountId], projects: [], days: validated.days }
  }
  const members = await loadDashboardGroupMembers(validated.groups, credentials, options)
  return {
    mode: "team-project",
    accountIds: includedDashboardMembers(validated.groups, validated.exclusions, members),
    projects: validated.projects,
    days: validated.days,
  }
}

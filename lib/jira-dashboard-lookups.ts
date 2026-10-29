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
  let response: Response
  try {
    response = await fetch(`https://api.atlassian.com/ex/jira/${encodeURIComponent(credentials.cloudId)}/rest/api/3/${path}?${params}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${credentials.accessToken}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new JiraDashboardLookupError("retry", "暫時無法連線至 Jira，請稍後重試。")
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
  options: { allowlist?: ReadonlySet<string> } = {}
): Promise<DashboardUser[]> {
  validateGroup(group, options.allowlist ?? allowedGroups)
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

export async function resolveDashboardScope(filter: DashboardFilter, credentials: JiraCredentials): Promise<ResolvedDashboardScope> {
  if (filter.mode === "self") return { mode: "self" }
  const validated = parseDashboardFilter(new URLSearchParams(serializeDashboardFilter(filter)))
  if (validated.mode === "self") return { mode: "self" }
  if (validated.mode === "person") {
    const raw = await jiraLookup(credentials, "user", new URLSearchParams({ accountId: validated.accountId }))
    const user = dashboardUser(raw)
    if (!user || user.accountId !== validated.accountId) throw new DashboardFilterError("所選使用者無效，請重新選擇。")
    return { mode: "person", accountIds: [user.accountId], projects: [], days: validated.days }
  }
  const members: Record<string, DashboardUser[]> = {}
  let cursor = 0
  let failed = false
  await Promise.all(Array.from({ length: Math.min(GROUP_CONCURRENCY, validated.groups.length) }, async () => {
    while (!failed && cursor < validated.groups.length) {
      const group = validated.groups[cursor++]
      try { members[group] = await getDashboardGroupMembers(group, credentials) }
      catch (error) { failed = true; throw error }
    }
  }))
  return {
    mode: "team-project",
    accountIds: includedDashboardMembers(validated.groups, validated.exclusions, members),
    projects: validated.projects,
    days: validated.days,
  }
}

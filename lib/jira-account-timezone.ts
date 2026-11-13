import "server-only"

import type { JiraCredentials } from "@/lib/jira-token"
import { jiraFetch, JiraTransportError } from "@/lib/jira-http"

export class JiraAccountTimeZoneError extends Error {
  constructor(readonly code: "reauthorize" | "forbidden" | "invalid_response" | "retry", message: string) {
    super(message)
    this.name = "JiraAccountTimeZoneError"
  }
}

/** Profile and searches must use the same verified OAuth viewer; never guess a timezone. */
export async function getVerifiedJiraAccountTimeZone(credentials: JiraCredentials): Promise<string> {
  if (typeof credentials.viewerId !== "string" || !credentials.viewerId.trim()) {
    throw new JiraAccountTimeZoneError("invalid_response", "Jira 帳號身分不完整，無法判定完成日期。")
  }
  let response: Response
  try {
    response = await jiraFetch(credentials, "/rest/api/3/myself", {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    if (error instanceof JiraTransportError) throw new JiraAccountTimeZoneError("retry", "暫時無法讀取 Jira 帳號時區，請稍後重試。")
    throw error
  }
  if (!response.ok) {
    if (response.status === 401) throw new JiraAccountTimeZoneError("reauthorize", "Jira 授權已失效，請重新授權。")
    if (response.status === 403) throw new JiraAccountTimeZoneError("forbidden", "無法讀取 Jira 帳號時區，請確認 read:jira-user 授權。")
    throw new JiraAccountTimeZoneError("retry", "暫時無法讀取 Jira 帳號時區，請稍後重試。")
  }
  let profile: unknown
  try { profile = await response.json() }
  catch { throw new JiraAccountTimeZoneError("invalid_response", "Jira 帳號時區資料無法識別。") }
  if (typeof profile !== "object" || profile === null || Array.isArray(profile) ||
      !("accountId" in profile) || profile.accountId !== credentials.viewerId ||
      !("timeZone" in profile) || typeof profile.timeZone !== "string") {
    throw new JiraAccountTimeZoneError("invalid_response", "Jira 帳號身分或時區資料不完整，無法判定完成日期。")
  }
  const timeZone = profile.timeZone
  try {
    if (!timeZone || timeZone.length > 100 || timeZone !== timeZone.trim() || /^[+-]/.test(timeZone)) throw new Error()
    new Intl.DateTimeFormat("en", { timeZone }).format(0)
  } catch {
    throw new JiraAccountTimeZoneError("invalid_response", "Jira 帳號時區無效，無法判定完成日期。")
  }
  return timeZone
}

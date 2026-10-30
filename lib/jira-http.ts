import "server-only"

import type { JiraCredentials } from "@/lib/jira-token"

/**
 * 連線等級的 Jira 傳輸錯誤（網路中斷／timeout／CSP 等，與 HTTP 狀態無關）。
 * 這是所有對 Jira REST API 直連共用的中立例外：各 service 在包裝層自行把它
 * 對映成各自的錯誤型別（如 JiraDashboardError / JiraStoryPointsError /
 * JiraDashboardLookupError），因此這裡不綁定任何 service 的語意。
 */
export class JiraTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "JiraTransportError"
  }
}

const JIRA_API_ROOT = "https://api.atlassian.com/ex/jira"

/**
 * 對 Jira REST API 的**唯一直連傳輸基底**。只負責：組 base URL（雲端 Jira
 * cloudId）、戴 Bearer token、統一 `Accept`／`cache: no-store`、依傳入的
 * RequestInit 帶 signal（timeout）／redirect／body／額外 headers。
 *
 * **不**判斷 `response.ok`、**不**回傳 JSON、**不**映射 HTTP 狀態——那些是各
 * service 的職責（它們有自己的錯誤型別與訊息）。這裡只把無法送達請求的
 * 連線例外統一丟 `JiraTransportError`（以 `cause` 保留原始錯誤）。
 *
 * 呼叫端請傳入自己原本的傳輸選項，例如：
 * - dashboard／scope lookup：`{ signal: AbortSignal.timeout(20_000) }`
 * - scope lookup 再加 `{ redirect: "error" }`
 * - Story Points 更新沿用原本「無 timeout」設定則不傳 signal。
 */
export async function jiraFetch(
  credentials: JiraCredentials,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const { signal, redirect, body, ...rest } = init
  const requestInit: RequestInit = {
    ...rest,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${credentials.accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
    ...(signal !== undefined ? { signal } : {}),
    ...(redirect !== undefined ? { redirect } : {}),
    body,
  }
  try {
    return await fetch(
      `${JIRA_API_ROOT}/${encodeURIComponent(credentials.cloudId)}${path}`,
      requestInit
    )
  } catch (cause) {
    throw new JiraTransportError("Jira request failed", { cause })
  }
}
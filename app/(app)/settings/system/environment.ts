// 暫時診斷的固定白名單；純 metadata，不得在此讀取環境值。
export const ENVIRONMENT_FIELDS = [
  { name: "ATLASSIAN_PAT", sensitive: true, purpose: "Atlassian 個人存取權杖（PAT）。目前應用程式未使用此變數；Jira 請求採用 OAuth，不代表此值可用於目前連線。" },
  { name: "AUTH_ATLASSIAN_SECRET", sensitive: true, purpose: "Atlassian OAuth client secret，用於登入及更新存取權杖。" },
  { name: "AUTH_SECRET", sensitive: true, purpose: "Auth.js JWT session 與應用程式分頁 token 的加密密鑰。" },
  { name: "AUTH_ATLASSIAN_ID", sensitive: false, purpose: "Atlassian OAuth client ID，用於登入及更新存取權杖。" },
  { name: "AUTH_URL", sensitive: false, purpose: "應用程式的穩定網址，用於 Auth.js 部署及 OAuth callback 設定。" },
  { name: "ATLASSIAN_JIRA_CLOUD_URL", sensitive: false, purpose: "目標 Jira Cloud 網址，用於匹配授權站點、Issue 連結與登入頁站點名稱。" },
] as const

export type EnvironmentField = (typeof ENVIRONMENT_FIELDS)[number]
export type SecretEnvironmentName = Extract<EnvironmentField, { sensitive: true }>["name"]
export type EnvironmentState = "unset" | "empty" | "set"
export type EnvironmentEntry = EnvironmentField & { state: EnvironmentState; value: string | null }
export type EnvironmentRevealResult =
  | { ok: true; name: SecretEnvironmentName; state: EnvironmentState; value: string | null }
  | { ok: false; message: string }

export const ENVIRONMENT_STATE_LABELS: Record<EnvironmentState, string> = {
  unset: "未設定", empty: "空字串", set: "已設定",
}

export function isSecretEnvironmentName(name: unknown): name is SecretEnvironmentName {
  return typeof name === "string" && ENVIRONMENT_FIELDS.some((field) => field.sensitive && field.name === name)
}

import "server-only"

import { auth } from "@/auth"
import { isAdminEmail } from "@/components/app-shell/navigation"
import { ENVIRONMENT_FIELDS, isSecretEnvironmentName, type EnvironmentEntry, type EnvironmentRevealResult, type EnvironmentState } from "./environment"

async function isAuthorizedAdmin(): Promise<boolean> {
  try {
    const session = await auth()
    return typeof session?.user?.id === "string" && session.user.id.trim().length > 0 &&
      !session.jiraAuthorizationError && isAdminEmail(session.user.email)
  } catch {
    return false
  }
}

function valueState(value: string | undefined): EnvironmentState {
  return value === undefined ? "unset" : value === "" ? "empty" : "set"
}

/** Request-time DTO：敏感原值絕不放進初始 HTML、RSC 或 client props。 */
export async function readEnvironmentSummary(): Promise<EnvironmentEntry[] | null> {
  if (!await isAuthorizedAdmin()) return null
  return ENVIRONMENT_FIELDS.map((field) => {
    const value = process.env[field.name]
    return { ...field, state: valueState(value), value: field.sensitive ? null : value ?? null }
  })
}

/** 每次 action 都重新授權；只讀取、回傳所要求的單項敏感值。 */
export async function revealEnvironmentSecret(name: unknown): Promise<EnvironmentRevealResult> {
  if (!await isAuthorizedAdmin()) return { ok: false, message: "無權查看環境值，請確認管理員登入狀態。" }
  if (!isSecretEnvironmentName(name)) return { ok: false, message: "不支援此環境變數。" }
  const value = process.env[name]
  return { ok: true, name, state: valueState(value), value: value ?? null }
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

interface PageTokenContext {
  userId: string
  cloudId: string
  kind: string
  jql: string
  filterKey?: string
}

// 只保留「這一頁要交給 Jira 的那一個 token」，不累積整條鏈，網址長度因此固定。
export interface PageCursor {
  next: string | null
  expiresAt: number
}

const TOKEN_TTL_MS = 15 * 60 * 1_000
// 單一 Jira token 上限 8,192 字元，加密與 base64url 膨脹後仍遠低於此值。
const MAX_TOKEN_LENGTH = 16 * 1024
const MAX_JIRA_TOKEN_LENGTH = 8_192

function binding(context: PageTokenContext) {
  return createHash("sha256").update(JSON.stringify([
    "dashboard/missing-data", context.userId, context.cloudId, context.kind, context.jql,
    ...(context.filterKey ? [context.filterKey] : []),
  ])).digest()
}

function encryptionKey(secret: string) {
  if (!secret) throw new Error("Page token encryption is not configured")
  return createHash("sha256").update(`jira-dashboard-page-token-v1\0${secret}`).digest()
}

function validCursor(value: unknown): value is PageCursor {
  if (!value || typeof value !== "object") return false
  const cursor = value as PageCursor
  if (Object.keys(cursor).some((key) => key !== "next" && key !== "expiresAt")) return false
  return Number.isFinite(cursor.expiresAt) &&
    (cursor.next === null || (typeof cursor.next === "string" && cursor.next.length > 0 && cursor.next.length <= MAX_JIRA_TOKEN_LENGTH))
}

export function initialPageCursor(now = Date.now()): PageCursor {
  return { next: null, expiresAt: now + TOKEN_TTL_MS }
}

export function sealPageToken(cursor: PageCursor, context: PageTokenContext, secret: string) {
  if (!validCursor(cursor)) throw new Error("Invalid page cursor")
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv)
  cipher.setAAD(binding(context))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(cursor), "utf8"), cipher.final()])
  const result = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")
  if (result.length > MAX_TOKEN_LENGTH) throw new Error("Page cursor is too large")
  return result
}

export function openPageToken(token: string, context: PageTokenContext, secret: string, now = Date.now()): PageCursor {
  if (!token || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid page token")
  try {
    const bytes = Buffer.from(token, "base64url")
    if (bytes.length < 29) throw new Error("Invalid page token")
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), bytes.subarray(0, 12))
    decipher.setAAD(binding(context))
    decipher.setAuthTag(bytes.subarray(12, 28))
    const data: unknown = JSON.parse(Buffer.concat([
      decipher.update(bytes.subarray(28)), decipher.final(),
    ]).toString("utf8"))
    if (!validCursor(data) || data.expiresAt <= now || data.expiresAt > now + TOKEN_TTL_MS) throw new Error("Expired page token")
    return data
  } catch {
    throw new Error("Invalid or expired page token")
  }
}

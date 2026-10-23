export { scrumBoardDevTasksJql } from "./jira-jql.ts"
import { MISSING_DATA_LIMIT, type MissingDataError } from "./jira-missing-data.ts"

/** Scrum Board 的欄位 key（三個 active 狀態；Done 已移除）。 */
export type ScrumColumnKey = "todo" | "inProgress" | "inReview"

/** 看板上一張 Dev-Task 卡片。 */
export interface ScrumBoardCard {
  key: string
  summary: string | null
  /** Dev-Task 目前的 Jira 狀態名稱（如 "To Do"）。 */
  status: string
  /** 母票的 Issue Type（決定卡片外框/背景色）。 */
  parentIssueType:
    | { status: "known"; name: string }
    | { status: "none" | "unknown" }
  /** 指派對象顯示名稱（非 self scope 時才有；未指派或 self 為 null／缺欄）。 */
  assigneeDisplayName?: string | null
}

export interface ScrumBoardData {
  columns: Record<ScrumColumnKey, ScrumBoardCard[]>
  jiraBaseUrl: string | null
  readOnly: true
}

export type ScrumBoardResult =
  | { status: "success"; data: ScrumBoardData }
  | { status: "error"; error: MissingDataError }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function invalidResult(): never { throw new Error("Scrum Board 回應不完整，請重新載入。") }

/** 解碼 server 已解析好的母票 Issue Type（`{status,name}` DTO 形狀），非 Jira 原始封包。 */
function parentIssueType(value: unknown): ScrumBoardCard["parentIssueType"] {
  if (!record(value)) return { status: "unknown" }
  if (value.status === "none") return { status: "none" }
  if (value.status === "unknown") return { status: "unknown" }
  if (value.status === "known" && typeof value.name === "string" && value.name.trim()) {
    return { status: "known", name: value.name }
  }
  return { status: "unknown" }
}

/** client 端安全解碼 Scrum Board 回應（避免信任未驗證的 server JSON）。 */
export function parseScrumBoardResult(value: unknown): ScrumBoardResult {
  if (!record(value)) invalidResult()
  if (value.status === "error") {
    const error = value.error
    if (
      !record(error) ||
      typeof error.code !== "string" ||
      !["reauthorize", "forbidden", "retry", "configuration", "limit", "invalid_page"].includes(error.code) ||
      typeof error.message !== "string" ||
      !error.message.length ||
      error.message.length > 2_000
    ) invalidResult()
    return { status: "error", error: { code: error.code as MissingDataError["code"], message: error.message } }
  }
  if (value.status !== "success" || !record(value.data) || value.data.readOnly !== true) invalidResult()
  const data = value.data
  let jiraBaseUrl: string | null = null
  if (data.jiraBaseUrl !== null) {
    if (typeof data.jiraBaseUrl !== "string") invalidResult()
    const url = new URL(data.jiraBaseUrl)
    if (url.protocol !== "https:" || url.origin !== data.jiraBaseUrl) invalidResult()
    jiraBaseUrl = url.origin
  }
  if (!record(data.columns)) invalidResult()
  const ids = new Set<string>()
  function column(value: unknown): ScrumBoardCard[] {
    if (!Array.isArray(value) || value.length > MISSING_DATA_LIMIT) invalidResult()
    return value.map((card) => {
      if (!record(card) || typeof card.key !== "string" || !/^[A-Za-z0-9_-]+$/.test(card.key) || ids.has(card.key)) invalidResult()
      if (card.summary !== null && typeof card.summary !== "string") invalidResult()
      if (typeof card.status !== "string" || !card.status.trim()) invalidResult()
      let assigneeDisplayName: string | null | undefined
      if (card.assigneeDisplayName !== undefined) {
        if (card.assigneeDisplayName === null) assigneeDisplayName = null
        else if (typeof card.assigneeDisplayName === "string" && card.assigneeDisplayName.trim() && card.assigneeDisplayName.length <= 200) assigneeDisplayName = card.assigneeDisplayName
        else invalidResult()
      }
      ids.add(card.key)
      return {
        key: card.key,
        summary: card.summary as string | null,
        status: card.status,
        parentIssueType: parentIssueType(card.parentIssueType),
        ...(assigneeDisplayName !== undefined ? { assigneeDisplayName } : {}),
      }
    })
  }
  const todo = column(data.columns.todo)
  const inProgress = column(data.columns.inProgress)
  const inReview = column(data.columns.inReview)
  return { status: "success", data: { columns: { todo, inProgress, inReview }, jiraBaseUrl, readOnly: true } }
}
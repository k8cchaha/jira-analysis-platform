import { MISSING_DATA_LIMIT, type MissingDataError } from "./jira-missing-data.ts"

/**
 * Planning 明細表的一列 Dev-Task。與燃盡圖不同，這裡把「估計＋未估計」的單
 * 都放同一張表：未估計的 `points` 為 `null`（顯示「—」），不因此中斷。
 * `status` 是 Jira 目前的工作流狀態名稱（Planning 只展示，不做群組/圖表）。
 *
 * 這個 DTO 放在 client-safe 模組（無 `server-only`），供 server（`planning-data.ts`）
 * 與 client（`planning-client.tsx` 的彈窗/驗證器）共用，避免兩處重複定義。
 */
export interface PlanningTask {
  key: string
  summary: string | null
  /** 目前的 status 名稱；讀不到為 null。 */
  status: string | null
  /** 已估計的 Story Points；未估計（無法提供）為 null。 */
  points: number | null
  assigneeDisplayName: string | null
  assigneeAccountId: string | null
  parentIssueType:
    | { status: "known"; name: string }
    | { status: "none" | "unknown" }
}

export type PlanningSubsetResult =
  | { status: "success"; data: { tasks: PlanningTask[] } }
  | { status: "error"; error: MissingDataError }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function invalidResult(): never { throw new Error("Planning 回應不完整，請重新載入。") }

/** 解碼 server 已解析好的母票 Issue Type（`{status,name}` DTO 形狀），非 Jira 原始封包。 */
function parentIssueType(value: unknown): PlanningTask["parentIssueType"] {
  if (!record(value)) return { status: "unknown" }
  if (value.status === "none") return { status: "none" }
  if (value.status === "unknown") return { status: "unknown" }
  if (value.status === "known" && typeof value.name === "string" && value.name.trim()) {
    return { status: "known", name: value.name }
  }
  return { status: "unknown" }
}

function optionalString(value: unknown, maxLength = 200): string | null {
  if (value === null) return null
  if (typeof value !== "string" || value.length > maxLength) invalidResult()
  return value as string
}

function pointsOrNull(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalidResult()
  return Math.round(value * 10) / 10
}

/** client 端安全解碼「未估時／未分派」的 Planning 彈窗回應（避免信任未驗證的 server JSON）。 */
export function parsePlanningSubsetResult(value: unknown): PlanningSubsetResult {
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
  if (value.status !== "success" || !record(value.data)) invalidResult()
  const data = value.data
  if (!Array.isArray(data.tasks) || data.tasks.length > MISSING_DATA_LIMIT) invalidResult()
  const ids = new Set<string>()
  const tasks = data.tasks.map((task) => {
    if (
      !record(task) ||
      typeof task.key !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(task.key) ||
      ids.has(task.key)
    ) invalidResult()
    ids.add(task.key)
    if (task.summary !== null && typeof task.summary !== "string") invalidResult()
    if (task.status !== null && typeof task.status !== "string") invalidResult()
    return {
      key: task.key,
      summary: optionalString(task.summary),
      status: optionalString(task.status),
      points: pointsOrNull(task.points),
      assigneeDisplayName: optionalString(task.assigneeDisplayName),
      assigneeAccountId: optionalString(task.assigneeAccountId, 100),
      parentIssueType: parentIssueType(task.parentIssueType),
    }
  })
  return { status: "success", data: { tasks } }
}
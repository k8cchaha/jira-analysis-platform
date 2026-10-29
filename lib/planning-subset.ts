import { MISSING_DATA_LIMIT, type MissingDataError } from "./jira-missing-data.ts"

/**
 * Planning 明細表的一列工作單（Dev-Task 或 QA-Task）。與燃盡圖不同，這裡把「估計
 * ＋未估計」的單都放同一張表：未估計的 `points` 為 `null`（顯示「—」），不因此中斷。
 * `status` 是 Jira 目前的工作流狀態名稱（Planning 只展示，不做群組/圖表）。
 *
 * 母票與 Epic 資訊去正則座化到每張子票上（`parentKey`／`parentSummary`／`epic`），
 * 讓 client 純函式可直接組「Epic → 母票 → 子票」階層，無需另做 server join。
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
  /** 填報人（Reporter）的顯示名稱；讀不到為 null。 */
  reporter: string | null
  /** Component 名稱清單；無或讀不到為空陣列。 */
  components: string[]
  /** 子票自身的 Issue Type 名稱（"Dev-Task"／"QA-Task"）；讀不到為 null。 */
  issueType: string | null
  /** 工作單的「Dev Type」欄位值（Spike／Pre-Spike／OP-Task／OP-Bug／Dev／Bug 等）；讀不到為 null。 */
  devType: string | null
  /** 母票 key（此子票所屬的 Story/Task/Bug）；讀不到為 null。 */
  parentKey: string | null
  /** 母票 summary（母票表頭用）；讀不到為 null。 */
  parentSummary: string | null
  /** 母票所屬的 Epic（階層群組表頭）；無 Epic 或讀不到為 null。 */
  epic: { key: string; summary: string | null } | null
  parentIssueType:
    | { status: "known"; name: string }
    | { status: "none" | "unknown" }
}

export type PlanningSubsetResult =
  | { status: "success"; data: { tasks: PlanningTask[] } }
  | { status: "error"; error: MissingDataError }

/**
 * Reporter View 的一列母票（Story / Task / Bug）。與 `PlanningTask` 照顧子票不同，
 * 這裡以「開單的人（Reporter）」為主，顯示 Epic → 母票 階層；子單不列出。欄位由
 * server（`planning-data.ts` 的 `fetchSprintMothers`）投影，無需另發查詢。
 * `issueType` 為母票自身 Issue Type 名稱（供 `TicketLink`／`ParentIssueTypeIcon`）。
 *
 * 分群歸屬：母票有 Epic 時，`reporter`／`reporterAccountId` 為該 **Epic 的 Reporter**
 * （Epic 下所有 Story/Task/Bug 都歸給開 Epic 的人）；母票無 Epic 時才取母票自身
 * 的 Reporter。母票所屬 Epic 仍由 `epic` 欄帶出（階層分組表頭用）。
 */
export interface ReporterParent {
  key: string
  summary: string | null
  /** 母票自身的 Story Points；未估計為 null。 */
  points: number | null
  /** Component 名稱清單；無或讀不到為空陣列。 */
  components: string[]
  /** 分群歸屬者的顯示名（有 Epic 為 Epic 的 Reporter；否則為母票自身 Reporter）。 */
  reporter: string | null
  /** 分群歸屬者的 accountId（同上；用於 PM 群比對）。 */
  reporterAccountId: string | null
  /** 母票自身 Issue Type 名稱（Story／Task／Bug）；讀不到為 null。 */
  issueType: string | null
  /** 母票所屬的 Epic（階層群組表頭）；無 Epic 或讀不到為 null。 */
  epic: { key: string; summary: string | null } | null
}

export type PlanningParentsResult =
  | { status: "success"; data: { parents: ReporterParent[] } }
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

/** 解碼 Epic 物件 `{ key, summary }`；null／缺欄／畸形回 null（階層退化成無 Epic 表頭）。 */
function epicObject(value: unknown): { key: string; summary: string | null } | null {
  if (value === null) return null
  if (!record(value)) invalidResult()
  const key = value.key
  if (typeof key !== "string" || key.length === 0 || key.length > 200) invalidResult()
  const summary = value.summary
  if (summary !== null && typeof summary !== "string") invalidResult()
  return { key, summary: optionalString(summary) }
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
      reporter: optionalString(task.reporter),
      components: stringList(task.components),
      issueType: optionalString(task.issueType),
      devType: optionalString(task.devType),
      parentKey: optionalString(task.parentKey, 100),
      parentSummary: optionalString(task.parentSummary),
      epic: epicObject(task.epic),
      parentIssueType: parentIssueType(task.parentIssueType),
    }
  })
  return { status: "success", data: { tasks } }
}

/** client 端安全解碼「任務規劃總覽 → Reporter View」的母票回應（避免信任未驗證的 server JSON）。 */
export function parsePlanningParentsResult(value: unknown): PlanningParentsResult {
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
  if (!Array.isArray(data.parents) || data.parents.length > MISSING_DATA_LIMIT) invalidResult()
  const ids = new Set<string>()
  const parents = data.parents.map((parent) => {
    if (
      !record(parent) ||
      typeof parent.key !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(parent.key) ||
      ids.has(parent.key)
    ) invalidResult()
    ids.add(parent.key)
    if (parent.summary !== null && typeof parent.summary !== "string") invalidResult()
    return {
      key: parent.key,
      summary: optionalString(parent.summary),
      points: pointsOrNull(parent.points),
      components: stringList(parent.components),
      reporter: optionalString(parent.reporter),
      reporterAccountId: optionalString(parent.reporterAccountId, 100),
      issueType: optionalString(parent.issueType),
      epic: epicObject(parent.epic),
    }
  })
  return { status: "success", data: { parents } }
}

/** 解碼 Component 名稱清單（陣列內每個元素須為字串；上限 32 個、每個 120 字元）。 */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) invalidResult()
  return value.map((item) => {
    if (typeof item !== "string" || item.length > 120) invalidResult()
    return item
  })
}

/**
 * client 端「寬鬆」投影已由 server 端解析、並以 `ReporterParent` 型別傳入 RSC 的母票。
 * `parents` 是 server-trusted、server 端已用寬鬆 helper（`pointsOrNull`／`assigneeDisplayName`
 * ／`componentNames`）正規化好的 typed 資料，沒有未驗證 JSON；因此這裡**不再跑嚴格的
 * `parsePlanningParentsResult`**（那會對單一壞值 throw、整頁崩潰），而是把每個欄位寬鬆地
 * 套用與 server 相同的界定（非負有限點數、≤200 字串、≤32 個元件）——壞值一律靜默收斂成
 * 安全預設（`null`／空陣列），絕不 throw。這是 `规划` 明細表一貫的「單一壞值不該打掛整頁」
 * 哲學（見 `planning-data.ts` 的 `pointsOrNull`）。
 */
export function projectReporterParents(value: unknown): ReporterParent[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value) || value.length > MISSING_DATA_LIMIT) return []
  const seen = new Set<string>()
  const parents: ReporterParent[] = []
  for (const parent of value) {
    if (!record(parent)) continue
    const key = typeof parent.key === "string" && /^[A-Za-z0-9_-]+$/.test(parent.key) ? parent.key : null
    if (key === null || seen.has(key)) continue
    seen.add(key)
    parents.push({
      key,
      summary: stringOrNull(parent.summary),
      points: pointsOrNullLenient(parent.points),
      components: stringListLenient(parent.components),
      reporter: stringOrNull(parent.reporter),
      reporterAccountId: stringOrNull(parent.reporterAccountId),
      issueType: stringOrNull(parent.issueType),
      epic: epicObjectLenient(parent.epic),
    })
  }
  return parents
}

/** 寬鬆版：非字串或超長一律回 null（不 throw）。 */
function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200) return null
  return value
}

/** 寬鬆版：非負有限數字才採用，否則 null（與 server 的 `pointsOrNull` 同）。 */
function pointsOrNullLenient(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
  return Math.round(value * 10) / 10
}

/** 寬鬆版：非陣列／超 32 個／非字串／超長的元素一律回 []（不 throw）。 */
function stringListLenient(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === "string" && item.length <= 120) out.push(item)
  }
  return out
}

/** 寬鬆版：畸形 Epic 一律回 null（階層退化成無 Epic 表頭）。 */
function epicObjectLenient(value: unknown): { key: string; summary: string | null } | null {
  if (!record(value)) return null
  const key = value.key
  if (typeof key !== "string" || key.length === 0 || key.length > 200) return null
  return { key, summary: stringOrNull(value.summary) }
}
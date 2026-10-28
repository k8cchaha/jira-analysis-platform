import { MISSING_DATA_LIMIT, type MissingDataError } from "./jira-missing-data.ts"

/**
 * Planning「任務規劃總覽」的一列母票（Story / Task / Bug，不是 Dev-Task）。
 * Team ／Reporter 分群顯示、票種圓餅圖、Epic 階層都以此為資料來源。
 *
 * `epic` 由 server 從母票的標準 `parent` 欄位推導：當母票的 parent 是 Epic
 * （issuetype.name 含 "epic"）時，帶其 key＋summary；否則為 null。因此不需
 * 新增任何自訂欄位、也不改 `jira-fields.ts`／`jira-jql.ts`。
 *
 * 這個 DTO 放在 client-safe 模組（無 `server-only`），供 server（`planning-data.ts`）
 * 與 client（`planning-client.tsx` 的驗證器／分群）共用。
 */
export interface PlanningOverviewItem {
  key: string
  summary: string | null
  /** 母票自身的 Issue Type 名稱（story / task / bug）；讀不到為 null。 */
  issueType: string | null
  status: string | null
  /** Story Points；未估計為 null。 */
  points: number | null
  assigneeDisplayName: string | null
  assigneeAccountId: string | null
  /** 填報人（Reporter）的顯示名稱；讀不到為 null。 */
  reporter: string | null
  /** 母票所屬 Epic（由 parent 欄位推導）；非 Epic 之子或讀不到為 null。 */
  epic: { key: string; summary: string | null } | null
}

/** server 回傳的成功信封。 */
export interface PlanningOverviewResult {
  items: PlanningOverviewItem[]
}

export type PlanningOverviewResponse =
  | { status: "success"; data: PlanningOverviewResult }
  | { status: "error"; error: MissingDataError }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function invalidResult(): never { throw new Error("任務規劃總覽回應不完整，請重新載入。") }

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

/** 解碼 server 已解析好的 Epic 物件（`{status,name}` 元素），非 Jira 原始封包。 */
function epicLookup(value: unknown): PlanningOverviewItem["epic"] {
  if (value === null) return null
  if (!record(value)) invalidResult()
  if (typeof value.key !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.key)) invalidResult()
  if (value.summary !== null && typeof value.summary !== "string") invalidResult()
  return {
    key: value.key,
    summary: optionalString(value.summary),
  }
}

/** client 端安全解碼「任務規劃總覽」回應（避免信任未驗證的 server JSON）。 */
export function parsePlanningOverviewResult(value: unknown): PlanningOverviewResponse {
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
  if (!Array.isArray(data.items) || data.items.length > MISSING_DATA_LIMIT) invalidResult()
  const ids = new Set<string>()
  const items = data.items.map((item) => {
    if (
      !record(item) ||
      typeof item.key !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(item.key) ||
      ids.has(item.key)
    ) invalidResult()
    ids.add(item.key)
    return {
      key: item.key,
      summary: optionalString(item.summary),
      issueType: optionalString(item.issueType),
      status: optionalString(item.status),
      points: pointsOrNull(item.points),
      assigneeDisplayName: optionalString(item.assigneeDisplayName),
      assigneeAccountId: optionalString(item.assigneeAccountId, 100),
      reporter: optionalString(item.reporter),
      epic: epicLookup(item.epic),
    }
  })
  return { status: "success", data: { items } }
}

/**
 * 任務清單的分群方式：Team＝依指派人的團隊（缺省者歸「其他」）；Reporter＝依填報人。
 */
export type OverviewGroupMode = "team" | "reporter"

/**
 * 一列任務清單的 row：`epic` 型別是「Epic 表頭」（其下 children 為同 Epic 的母票）；
 * `item` 型別是直接列出的母票（無 Epic）。
 */
export type OverviewRow =
  | { type: "epic"; epic: { key: string; summary: string | null }; children: PlanningOverviewItem[] }
  | { type: "item"; item: PlanningOverviewItem }

export interface OverviewGroup {
  /** 群組顯示名稱（團隊 label 或 Reporter 顯示名）。 */
  label: string
  rows: OverviewRow[]
}

/** Team 模式下「無對應團隊或未指派」的歸屬；沿用任務分派狀況的慣例，但母票無 Capacity。 */
export const OVERVIEW_OTHER_TEAM_LABEL = "其他"
/** Reporter 模式下填報人為 null 的歸屬。 */
const UNNAMED_REPORTER_LABEL = "未指定 Reporter"

/** 依 `item.epic.key` 去重排序用；把 key 建議排序（數字在後、字母在前）。 */
function compareKeys(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true })
}

/**
 * 把一組母票分群成任務清單的顯示結構（純函式，無 I/O）。
 *
 * - Team 模式：依指派人的團隊分群（`teamOf(accountId)`；未指派／無對應團隊歸「其他」），
 *   群組順序依 `teamOrder` 的 label 次序、未列者 `localeCompare("zh")` 置後。
 * - Reporter 模式：依填報人顯示名稱分群（null 歸「未指定 Reporter」），群組依名稱排序。
 * - 每群內再建 Epic 階層：有 `epic` 的母票掛到該 Epic 表頭下（children 依 key 排序），
 *   無 Epic 的母票直接成 `item` row（依 key 排序）；Epic 表頭依 key 排序、排在無 Epic 之前。
 */
export function buildOverviewGroups(input: {
  items: readonly PlanningOverviewItem[]
  mode: OverviewGroupMode
  /** Team 模式用：accountId → 團隊 label；缺省者歸「其他」。 */
  teamOf?: (accountId: string | null) => string | undefined
  /** Team 模式用：團隊顯示順序（label）。 */
  teamOrder?: readonly string[]
}): OverviewGroup[] {
  const { items, mode, teamOf, teamOrder } = input

  // 1. 依模式把母票歸到某個群組 key／label。
  const groupKeyOf = (item: PlanningOverviewItem): string => {
    if (mode === "reporter") return item.reporter ?? UNNAMED_REPORTER_LABEL
    const label = item.assigneeAccountId === null ? undefined : teamOf?.(item.assigneeAccountId)
    return label ?? OVERVIEW_OTHER_TEAM_LABEL
  }

  const buckets = new Map<string, PlanningOverviewItem[]>()
  for (const item of items) {
    const key = groupKeyOf(item)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
    }
    bucket.push(item)
  }

  // 2. 群組順序。
  const sortedGroupKeys =
    mode === "reporter"
      ? [...buckets.keys()].sort((a, b) => a.localeCompare(b, "zh"))
      : sortTeamLabels([...buckets.keys()], teamOrder ?? [])

  // 3. 每個群組內建 Epic 階層。
  const groups: OverviewGroup[] = []
  for (const key of sortedGroupKeys) {
    const bucket = buckets.get(key)!
    groups.push({ label: key, rows: buildRows(bucket) })
  }

  return groups
}

function sortTeamLabels(labels: string[], teamOrder: readonly string[]): string[] {
  const rank = new Map<string, number>(teamOrder.map((label, index) => [label, index]))
  return [...labels].sort((a, b) => {
    const ra = rank.get(a)
    const rb = rank.get(b)
    if (ra === undefined && rb === undefined) return a.localeCompare(b, "zh")
    if (ra === undefined) return 1
    if (rb === undefined) return -1
    return ra - rb
  })
}

/** 把一組母票建成 Epic 表頭 + item 的 row 序列。 */
function buildRows(bucket: readonly PlanningOverviewItem[]): OverviewRow[] {
  const bare: PlanningOverviewItem[] = []
  const byEpic = new Map<string, PlanningOverviewItem[]>()
  for (const item of bucket) {
    if (item.epic === null) {
      bare.push(item)
    } else {
      let list = byEpic.get(item.epic.key)
      if (!list) {
        list = []
        byEpic.set(item.epic.key, list)
      }
      list.push(item)
    }
  }
  bare.sort((a, b) => compareKeys(a.key, b.key))
  const epicKeys = [...byEpic.keys()].sort(compareKeys)

  const rows: OverviewRow[] = []
  for (const epicKey of epicKeys) {
    const children = [...byEpic.get(epicKey)!].sort((a, b) => compareKeys(a.key, b.key))
    // Epic 表頭的 summary 取第一張母票帶的 epic.summary（同 Epic 下都相同）。
    rows.push({ type: "epic", epic: children[0].epic!, children })
  }
  for (const item of bare) {
    rows.push({ type: "item", item })
  }
  return rows
}

/** 圓餅圖的票種計數（只算母票自身 type：story / task / bug；其餘忽略）。 */
export function countIssueTypes(items: readonly PlanningOverviewItem[]): {
  story: number
  task: number
  bug: number
} {
  let story = 0
  let task = 0
  let bug = 0
  for (const item of items) {
    const type = item.issueType?.toLowerCase()
    if (type === "story") story += 1
    else if (type === "task") task += 1
    else if (type === "bug") bug += 1
  }
  return { story, task, bug }
}

/** 圓餅圖點數統計：依票種加總母票的 Story Points（未估計視為 0；Epic 不算）。 */
export function sumIssueTypePoints(items: readonly PlanningOverviewItem[]): {
  story: number
  task: number
  bug: number
} {
  let story = 0
  let task = 0
  let bug = 0
  for (const item of items) {
    const type = item.issueType?.toLowerCase()
    const points = item.points ?? 0
    if (type === "story") story += points
    else if (type === "task") task += points
    else if (type === "bug") bug += points
  }
  return {
    story: Math.round(story * 10) / 10,
    task: Math.round(task * 10) / 10,
    bug: Math.round(bug * 10) / 10,
  }
}
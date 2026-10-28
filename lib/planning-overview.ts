import type { PlanningTask } from "./planning-subset.ts"

/**
 * Planning「任務規劃總覽」的統計與分群（client-safe，無 I/O、無 `server-only`）。
 *
 * 改版後以 **Dev-Task（子票）** 為唯一資料來源（與「任務分派狀況」對齊）：左側任務
 * 清單按 Team／Reporter 分群、每一列是一張 Dev-Task；票種圓餅圖以 Dev-Task 的母票
 * 類型（`parentIssueType`）分 Story／Task／Bug。因此總覽的點數加總與分派狀況一致。
 *
 * 輸入直接是已驗證的 `PlanningTask[]`（由 server 撈回、client 以
 * `parsePlanningSubsetResult` 驗證過），不需在此再做 DTO 解碼。
 */

/** 任務清單的分群方式：Team＝依指派人的團隊（缺省者歸「其他」）；Reporter＝依填報人。 */
export type OverviewGroupMode = "team" | "reporter"

/** 匯總裡的一群 Dev-Task（一列母票底下分派的子票）。 */
export interface PlanningGroup {
  /** 群組顯示名稱（團隊 label 或 Reporter 顯示名）。 */
  label: string
  tasks: PlanningTask[]
}

/** 圓餅圖的統計量：點數／張數；團隊 breakdown 也依此量算。 */
export type OverviewMetric = "points" | "count"

/** Team 模式下「無對應團隊或未指派」的歸屬；沿用任務分派狀況的慣例。 */
export const OVERVIEW_OTHER_TEAM_LABEL = "其他"
/** Reporter 模式下填報人為 null 的歸屬。 */
const UNNAMED_REPORTER_LABEL = "未指定 Reporter"

/** 依 Dev-Task 的 key 排序。 */
function compareKeys(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true })
}

/**
 * 把一組 Dev-Task 分群成任務清單（純函式，無 I/O）。
 *
 * - Team 模式：依指派人的團隊分群（`teamOf(accountId)`；未指派／無對應團隊歸「其他」），
 *   群組順序依 `teamOrder` 的 label 次序、未列者 `localeCompare("zh")` 置後、「其他」殿後。
 * - Reporter 模式：依填報人顯示名稱分群（null 歸「未指定 Reporter」），群組依名稱排序。
 * - 每群內 flat 列出 Dev-Task（依 key 排序），無 Epic 階層。
 */
export function buildPlanningGroups(input: {
  tasks: readonly PlanningTask[]
  mode: OverviewGroupMode
  /** Team 模式用：accountId → 團隊 label；缺省者歸「其他」。 */
  teamOf?: (accountId: string | null) => string | undefined
  /** Team 模式用：團隊顯示順序（label）。 */
  teamOrder?: readonly string[]
}): PlanningGroup[] {
  const { tasks, mode, teamOf, teamOrder } = input

  // 1. 依模式把每張 Dev-Task 歸到某個群組 key／label。
  const groupKeyOf = (task: PlanningTask): string => {
    if (mode === "reporter") return task.reporter ?? UNNAMED_REPORTER_LABEL
    const label = task.assigneeAccountId === null ? undefined : teamOf?.(task.assigneeAccountId)
    return label ?? OVERVIEW_OTHER_TEAM_LABEL
  }

  const buckets = new Map<string, PlanningTask[]>()
  for (const task of tasks) {
    const key = groupKeyOf(task)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
    }
    bucket.push(task)
  }

  // 2. 群組順序。
  const sortedGroupKeys =
    mode === "reporter"
      ? [...buckets.keys()].sort((a, b) => a.localeCompare(b, "zh"))
      : sortTeamLabels([...buckets.keys()], teamOrder ?? [])

  // 3. 每個群組內 flat 列出 Dev-Task（依 key 排序）。
  return sortedGroupKeys.map((key) => ({
    label: key,
    tasks: [...buckets.get(key)!].sort((a, b) => compareKeys(a.key, b.key)),
  }))
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

/** Team View 依 Dev Type 分群的順序（未分類殿後）。 */
export const DEV_TYPE_GROUP_LABELS = ["Pre-Spike", "Spike", "Dev", "Bug", "OP-Task", "OP-Bug"] as const
/** 不在 DEV_TYPE_GROUP_LABELS 內（或讀不到）的 Dev Type 值歸入「未分類」。 */
export const UNCLASSIFIED_DEV_TYPE_LABEL = "未分類"

/** 一個 Dev Type 群（此群下的工作單，依 key 排序）。 */
export interface DevTypeGroup {
  /** 群組表頭顯示的 Dev Type 值（未分類為 `UNCLASSIFIED_DEV_TYPE_LABEL`）。 */
  label: string
  tasks: PlanningTask[]
}

/** Team View 分群：一組（依指派人團隊歸類）底下再依 Dev Type 拆成子群。 */
export interface OverviewDevTypeGroup {
  label: string
  typeGroups: DevTypeGroup[]
}

/** Dev Type 值在 `DEV_TYPE_GROUP_LABELS` 中的序位；找不到（或 null）回未分類序位。 */
function devTypeRank(value: string | null): number {
  if (!value) return DEV_TYPE_GROUP_LABELS.length
  const lower = value.toLowerCase()
  const index = DEV_TYPE_GROUP_LABELS.findIndex((label) => label.toLowerCase() === lower)
  return index === -1 ? DEV_TYPE_GROUP_LABELS.length : index
}

/**
 * 把一組工作單組成分群的「Team → Dev Type」兩層（純函式，無 I/O，Team 用）。
 *
 * - 群組歸屬沿用 Team 規則：依 `assigneeAccountId` 的 `teamOf`，缺省者歸「其他」，
 *   群組順序依 `teamOrder`、「其他」殿後（與 `buildPlanningGroups` 相同）。
 * - 每個 Team 內依 Dev Type 分群，順序依 `DEV_TYPE_GROUP_LABELS`（Pre-Spike → Spike →
 *   Dev → Bug → OP-Task → OP-Bug），其餘／未填歸「未分類」殿後；空群（無人）不輸出。
 * - 群內工作單依 key 排序。不再分母票／Epic 階層。
 */
export function buildPlanningDevTypeGroups(input: {
  tasks: readonly PlanningTask[]
  teamOf: (accountId: string | null) => string | undefined
  teamOrder: readonly string[]
}): OverviewDevTypeGroup[] {
  const { tasks, teamOf, teamOrder } = input

  // 1. 依團隊分 bucket。
  const buckets = new Map<string, PlanningTask[]>()
  for (const task of tasks) {
    const label = task.assigneeAccountId === null ? undefined : teamOf(task.assigneeAccountId)
    const key = label ?? OVERVIEW_OTHER_TEAM_LABEL
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
    }
    bucket.push(task)
  }

  const sortedGroupKeys = sortTeamLabels([...buckets.keys()], teamOrder)

  // 2. 每個群組內依 Dev Type 分群。
  return sortedGroupKeys.map((label) => {
    const groupTasks = buckets.get(label)!

    const typeBuckets = new Map<number, PlanningTask[]>()
    for (const task of [...groupTasks].sort((a, b) => compareKeys(a.key, b.key))) {
      const rank = devTypeRank(task.devType)
      let bucket = typeBuckets.get(rank)
      if (!bucket) {
        bucket = []
        typeBuckets.set(rank, bucket)
      }
      bucket.push(task)
    }

    const typeGroups: DevTypeGroup[] = [...typeBuckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rank, grouped]) => ({
        label: rank < DEV_TYPE_GROUP_LABELS.length ? DEV_TYPE_GROUP_LABELS[rank] : UNCLASSIFIED_DEV_TYPE_LABEL,
        tasks: grouped,
      }))

    return { label, typeGroups }
  })
}

/** 由 Dev-Task 的母票類型推斷圓餅圖票種；無法歸類（none／unknown／非三類）回 null。 */
export function devTaskTypeOf(task: PlanningTask): "story" | "task" | "bug" | null {
  const pt = task.parentIssueType
  if (pt.status !== "known") return null
  const name = pt.name.toLowerCase()
  if (name === "story") return "story"
  if (name === "task") return "task"
  if (name === "bug") return "bug"
  return null
}

/** 圓餅圖的票種計數（以 Dev-Task 母票類型分 Story／Task／Bug；無法歸類者忽略）。 */
export function countDevTaskTypes(tasks: readonly PlanningTask[]): {
  story: number
  task: number
  bug: number
} {
  let story = 0
  let task = 0
  let bug = 0
  for (const t of tasks) {
    const type = devTaskTypeOf(t)
    if (type === "story") story += 1
    else if (type === "task") task += 1
    else if (type === "bug") bug += 1
  }
  return { story, task, bug }
}

/** 圓餅圖點數統計：依票種加總 Dev-Task 的 Story Points（未估計視為 0；無法歸類者忽略）。 */
export function sumDevTaskTypePoints(tasks: readonly PlanningTask[]): {
  story: number
  task: number
  bug: number
} {
  let story = 0
  let task = 0
  let bug = 0
  for (const t of tasks) {
    const type = devTaskTypeOf(t)
    const points = t.points ?? 0
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

/**
 * 工作單「Dev Type」欄位值的色族分類（純函式，供 Team/Reporter View 的 Dev Type 欄著色）。
 * 依值名稱（不區分大小寫）：
 * - `spike`：名稱含 "spike"（Spike／Pre-Spike）→ 深黃。
 * - `op`：名稱以 "op" 開頭（OP-Task／OP-Bug）→ 藍色（優先於 bug，故 OP-Bug 歸藍非紅）。
 * - `bug`：名稱含 "bug"（Bug）→ 紅色。
 * - `dev`：名稱含 "dev"（Dev）→ 綠色。
 * - 其他／讀不到 → `null`（中性）。
 */
export function devTypeFamilyOf(value: string | null): "spike" | "op" | "bug" | "dev" | null {
  if (!value) return null
  const name = value.toLowerCase()
  if (name.includes("spike")) return "spike"
  if (name.startsWith("op")) return "op"
  if (name.includes("bug")) return "bug"
  if (name.includes("dev")) return "dev"
  return null
}

/** Dev Type 值的正規化分類標籤：若等於某固定分類（不分大小寫）回該分類，否則歸「未分類」。 */
export function devTypeLabelOf(value: string | null): string {
  if (!value) return UNCLASSIFIED_DEV_TYPE_LABEL
  const lower = value.toLowerCase()
  const match = DEV_TYPE_GROUP_LABELS.find((label) => label.toLowerCase() === lower)
  return match ?? UNCLASSIFIED_DEV_TYPE_LABEL
}

/** 依 Dev Type 分類的工作單計數（key = 固定分類標籤 + 未分類，皆存在、無票為 0）。 */
export function countDevTypeLabels(tasks: readonly PlanningTask[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const label of [...DEV_TYPE_GROUP_LABELS, UNCLASSIFIED_DEV_TYPE_LABEL]) counts[label] = 0
  for (const t of tasks) {
    const label = devTypeLabelOf(t.devType)
    counts[label] += 1
  }
  return counts
}

/** 依 Dev Type 分類的工作單點數加總（未估計視 0；key = 固定分類標籤 + 未分類，皆存在、無票為 0）。 */
export function sumDevTypeLabelPoints(tasks: readonly PlanningTask[]): Record<string, number> {
  const sums: Record<string, number> = {}
  for (const label of [...DEV_TYPE_GROUP_LABELS, UNCLASSIFIED_DEV_TYPE_LABEL]) sums[label] = 0
  for (const t of tasks) {
    const label = devTypeLabelOf(t.devType)
    sums[label] += t.points ?? 0
  }
  for (const label of Object.keys(sums)) sums[label] = Math.round(sums[label] * 10) / 10
  return sums
}

/** 算「某個 Dev Type 分類下、各團隊的比例」，供開發類型分佈圓餅圖 hover 弧段時顯示。 */
export function buildDevTypeLabelTeamBreakdown(input: {
  tasks: readonly PlanningTask[]
  /** 目標的 Dev Type 分類標籤（正規化，含「未分類」）。 */
  label: string
  metric: OverviewMetric
  teamOf: (accountId: string | null) => string | undefined
  teamOrder: readonly string[]
}): TypeTeamBreakdown {
  const { tasks, label, metric, teamOf, teamOrder } = input

  const buckets = new Map<string, number>()
  for (const task of tasks) {
    if (devTypeLabelOf(task.devType) !== label) continue
    const team = task.assigneeAccountId === null ? undefined : teamOf(task.assigneeAccountId)
    const teamLabel = team ?? OVERVIEW_OTHER_TEAM_LABEL
    const delta = metric === "points" ? (task.points ?? 0) : 1
    buckets.set(teamLabel, (buckets.get(teamLabel) ?? 0) + delta)
  }

  let total = 0
  const teams: TeamSlice[] = [...buckets.entries()]
    .map(([label, value]) => {
      total += value
      return metric === "points" ? { label, value: Math.round(value * 10) / 10 } : { label, value }
    })
    .sort((a, b) => labelRank(a.label, teamOrder) - labelRank(b.label, teamOrder) || a.label.localeCompare(b.label, "zh"))

  return { total: Math.round(total * 10) / 10, teams }
}

/** 一個票種下、某團隊的統計量（值依張數/點數決定）。 */
export interface TeamSlice {
  label: string
  value: number
}

/** 一個票種的「團隊 breakdown」：該票種的總量 + 各團隊份額。 */
export interface TypeTeamBreakdown {
  total: number
  teams: TeamSlice[]
}

/**
 * 算「某個票種下、各團隊的比例」，供圓餅圖 hover 該票種弧段時顯示。
 * 團隊歸屬沿用 `teamOf`（assigneeAccountId → team；未指派／無對應團隊歸「其他」），
 * 值依 `metric`：`count` 按張數、`points` 按 Story Points（未估計視 0）。
 * 團隊順序 = 依 `teamOrder` 的 label 次序，未列者 `localeCompare("zh")` 置後（「其他」殿後）。
 */
export function buildDevTaskTypeTeamBreakdown(input: {
  tasks: readonly PlanningTask[]
  issueType: "story" | "task" | "bug"
  metric: OverviewMetric
  teamOf: (accountId: string | null) => string | undefined
  teamOrder: readonly string[]
}): TypeTeamBreakdown {
  const { tasks, issueType, metric, teamOf, teamOrder } = input

  const buckets = new Map<string, number>()
  for (const task of tasks) {
    if (devTaskTypeOf(task) !== issueType) continue
    const label = task.assigneeAccountId === null ? undefined : teamOf(task.assigneeAccountId)
    const team = label ?? OVERVIEW_OTHER_TEAM_LABEL
    const delta = metric === "points" ? (task.points ?? 0) : 1
    buckets.set(team, (buckets.get(team) ?? 0) + delta)
  }

  let total = 0
  const teams: TeamSlice[] = [...buckets.entries()]
    .map(([label, value]) => {
      total += value
      return metric === "points" ? { label, value: Math.round(value * 10) / 10 } : { label, value }
    })
    .sort((a, b) => labelRank(a.label, teamOrder) - labelRank(b.label, teamOrder) || a.label.localeCompare(b.label, "zh"))

  return { total: Math.round(total * 10) / 10, teams }
}

/** 團隊排序權重：在 `teamOrder` 內的照序號；未列者一律大於所有已列（「其他」等未列者殿後）。 */
function labelRank(label: string, teamOrder: readonly string[]): number {
  const index = teamOrder.indexOf(label)
  return index === -1 ? teamOrder.length + 1 : index
}
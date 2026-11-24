import { DEV_TYPE_GROUP_LABELS, UNCLASSIFIED_DEV_TYPE_LABEL } from "./planning-overview.ts"

/**
 * 成員分析的純資料模型（無 I/O、無 React、無 `server-only`）。
 *
 * 後端一次查完「區間內 resolved 的 Dev-Task」後投影成每張票的最小欄位，前端只做
 * 彙總與排序，不再回查 Jira。點數缺值保留 null，不以 0 補，也不與另一欄互補。
 */
export const MEMBER_ANALYSIS_DEV_TYPES = [...DEV_TYPE_GROUP_LABELS, UNCLASSIFIED_DEV_TYPE_LABEL] as const
export type MemberAnalysisDevType = typeof MEMBER_ANALYSIS_DEV_TYPES[number]

/**
 * 畫面上合併後的四大類（Dev Type 比重與圓餅圖共用）：
 * Pre-Spike 併入 Spike、OP-Task 與 OP-Bug 併入 OP；未分類不畫。
 */
// 顏色直接寫在這裡（不在專案頁的 --viz-* 變數作用範圍內），並提供深色模式的等效色。
export const MEMBER_ANALYSIS_CHART_CATEGORIES = [
  { id: "spike", label: "Spike", color: "#f0a020", className: "bg-[#f0a020] dark:bg-[#c98500]", members: ["Pre-Spike", "Spike"] },
  { id: "dev", label: "Dev", color: "#2a9d5c", className: "bg-[#2a9d5c] dark:bg-[#39b573]", members: ["Dev"] },
  { id: "op", label: "OP", color: "#2a78d6", className: "bg-[#2a78d6] dark:bg-[#3987e5]", members: ["OP-Task", "OP-Bug"] },
  { id: "bug", label: "Bug", color: "#d64545", className: "bg-[#d64545] dark:bg-[#e56060]", members: ["Bug"] },
] as const satisfies readonly { id: string; label: string; color: string; className: string; members: readonly MemberAnalysisDevType[] }[]
export type MemberAnalysisChartCategory = typeof MEMBER_ANALYSIS_CHART_CATEGORIES[number]["id"]

export interface MemberAnalysisIssue {
  key: string
  /** 負責人；null 代表未指派，歸在「未指派」列。 */
  assigneeAccountId: string | null
  assigneeDisplayName: string | null
  /** Dev Type 原始值（Jira option value）；null 或不在已知清單時歸「未分類」。 */
  devType: string | null
  points: number | null
  actualPoints: number | null
  /** Resolved 日期（`YYYY-MM-DD`，UTC+8 日曆日）；尚未完成時為 null。 */
  resolvedDate: string | null
}

export interface MemberAnalysisResult {
  issues: MemberAnalysisIssue[]
  /** 本次查詢實際使用的 JQL（原樣顯示，不另外拼接）。 */
  jql: string
  jiraBaseUrl: string | null
  from: string
  to: string
}

/** Dev Type 值對應到已知群組；大小寫不敏感，未知值一律「未分類」。 */
export function memberAnalysisDevType(value: string | null): MemberAnalysisDevType {
  const lower = value?.trim().toLowerCase()
  return MEMBER_ANALYSIS_DEV_TYPES.find((label) => label.toLowerCase() === lower) ?? UNCLASSIFIED_DEV_TYPE_LABEL
}

export interface MemberAnalysisRow {
  accountId: string | null
  displayName: string
  /** 完成的張數；0 是有效值。 */
  count: number
  /** Story Points 合計；全部缺值時為 null。 */
  points: number | null
  actualPoints: number | null
  /** 各 Dev Type 張數，順序固定（DEV_TYPE_GROUP_LABELS → 未分類）。 */
  devTypes: { label: MemberAnalysisDevType; count: number }[]
  /** 合併後的四大類 SP 合計（供橫條與圓餅）；未分類不列入。 */
  categories: { id: MemberAnalysisChartCategory; points: number }[]
}

const isPoint = (value: number | null): value is number => value !== null && Number.isFinite(value)

/** Σ 已知值；全部缺值回 null（不補 0）。 */
function sumPoints(values: readonly (number | null)[]): number | null {
  const known = values.filter(isPoint)
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null
}

/**
 * 依成員彙總；成員順序照 Jira 顯示名稱，未指派固定在最後。
 * 同一人可能在不同票上有不同顯示名稱（改名），取第一筆非空值。
 */
export function summarizeMemberAnalysis(issues: readonly MemberAnalysisIssue[]): MemberAnalysisRow[] {
  const rows = new Map<string, { row: MemberAnalysisRow; points: (number | null)[]; actualPoints: (number | null)[]; categoryPoints: Map<MemberAnalysisChartCategory, number> }>()
  for (const issue of issues) {
    const id = issue.assigneeAccountId ?? ""
    let entry = rows.get(id)
    if (!entry) {
      entry = {
        row: { accountId: issue.assigneeAccountId, displayName: issue.assigneeAccountId === null ? "未指派" : issue.assigneeDisplayName?.trim() || issue.assigneeAccountId, count: 0, points: null, actualPoints: null, devTypes: MEMBER_ANALYSIS_DEV_TYPES.map((label) => ({ label, count: 0 })), categories: categoryPointsFor(new Map()) },
        points: [],
        actualPoints: [],
        categoryPoints: new Map(),
      }
      rows.set(id, entry)
    }
    entry.row.count += 1
    entry.points.push(issue.points)
    entry.actualPoints.push(issue.actualPoints)
    const devType = entry.row.devTypes.find((group) => group.label === memberAnalysisDevType(issue.devType))!
    devType.count += 1
    const category = chartCategoryOf(issue.devType)
    if (category && issue.points !== null && Number.isFinite(issue.points)) entry.categoryPoints.set(category, (entry.categoryPoints.get(category) ?? 0) + issue.points)
  }
  return [...rows.values()]
    .map(({ row, points, actualPoints, categoryPoints }) => ({ ...row, points: sumPoints(points), actualPoints: sumPoints(actualPoints), categories: categoryPointsFor(categoryPoints) }))
    .sort((a, b) => (a.accountId === null ? 1 : b.accountId === null ? -1 : 0) || a.displayName.localeCompare(b.displayName, "zh-Hant"))
}

/** 某個 Dev Type 值屬於哪個畫面分類；未分類回 null（不畫）。 */
export function chartCategoryOf(devType: string | null): MemberAnalysisChartCategory | null {
  const label = memberAnalysisDevType(devType)
  return MEMBER_ANALYSIS_CHART_CATEGORIES.find((category) => (category.members as readonly string[]).includes(label))?.id ?? null
}

function categoryPointsFor(totals: ReadonlyMap<MemberAnalysisChartCategory, number>): { id: MemberAnalysisChartCategory; points: number }[] {
  return MEMBER_ANALYSIS_CHART_CATEGORIES.map((category) => ({ id: category.id, points: totals.get(category.id) ?? 0 }))
}

/** 全員合計，供表格最後一列使用；空結果回 null 而非全 0。 */
export function summarizeMemberAnalysisTotal(issues: readonly MemberAnalysisIssue[]): MemberAnalysisRow | null {
  if (!issues.length) return null
  const totals = new Map<MemberAnalysisChartCategory, number>()
  for (const issue of issues) {
    const category = chartCategoryOf(issue.devType)
    if (category && issue.points !== null && Number.isFinite(issue.points)) totals.set(category, (totals.get(category) ?? 0) + issue.points)
  }
  return {
    accountId: null,
    displayName: "合計",
    count: issues.length,
    points: sumPoints(issues.map((issue) => issue.points)),
    actualPoints: sumPoints(issues.map((issue) => issue.actualPoints)),
    devTypes: MEMBER_ANALYSIS_DEV_TYPES.map((label) => ({ label, count: issues.filter((issue) => memberAnalysisDevType(issue.devType) === label).length })),
    categories: categoryPointsFor(totals),
  }
}

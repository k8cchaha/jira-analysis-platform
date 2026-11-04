/**
 * 「分析區間」的純日期邏輯（無 I/O、無 React、無 `server-only`）。
 *
 * 所有日期一律是 `YYYY-MM-DD` 日曆日字串，代表**瀏覽器本機時區**的日曆日；不做
 * UTC 位移、不帶時間。快捷鍵的範圍由呼叫端明確傳入 `today`，模組本身不讀時鐘，
 * 因此可在任何時區以固定輸入重現結果，也讓「今日／本週」的語意可被測試鎖定。
 *
 * 本模組只描述區間，不做 Jira 查詢：JQL 的日期邊界仍由 `jira-jql.ts` 的 builder
 * 依套用的區間組裝。
 */

/** 分析區間，`from` / `to` 皆為**含當日**的 `YYYY-MM-DD`。 */
export interface DateRange {
  from: string
  to: string
}

/** 時間區間快捷鍵。`custom` 代表使用者自行挑選、未對應任何快捷鍵的區間。 */
export type DateRangePreset = "today" | "thisWeek" | "lastWeek" | "thisMonth" | "last7" | "last30"
  | "last1Month" | "last2Months" | "last3Months" | "last6Months" | "custom"

/** 實際可按的快捷鍵（不含 `custom`），順序與畫面按鈕一致。 */
export type DateRangePresetKey = Exclude<DateRangePreset, "custom">

/** 預設快捷鍵顯示順序；各頁可透過 DateRangeShortcut 清單客製。 */
export const DATE_RANGE_PRESET_ORDER: readonly DateRangePresetKey[] = [
  "today",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "last7",
  "last30",
]

export const DATE_RANGE_PRESET_LABEL: Record<DateRangePresetKey, string> = {
  today: "今日",
  thisWeek: "本週",
  lastWeek: "上週",
  thisMonth: "本月",
  last7: "近 7 日",
  last30: "近 30 日",
  last1Month: "近1月",
  last2Months: "近2月",
  last3Months: "近3月",
  last6Months: "近6月",
}

/** 頁面提供的快捷選項：沿用內建日期計算，或提供已解析的絕對日期；id 須唯一。 */
export type DateRangeShortcut = {
  id: string
  label: string
} & (
  | { preset: DateRangePresetKey; range?: never }
  | { range: DateRange; preset?: never }
)

/** 未提供頁面配置時沿用原有六個按鈕。 */
export const DEFAULT_DATE_RANGE_SHORTCUTS: readonly DateRangeShortcut[] = DATE_RANGE_PRESET_ORDER.map((preset) => ({
  id: preset,
  label: DATE_RANGE_PRESET_LABEL[preset],
  preset,
}))

/**
 * 分析區間的天數上限。用途是擋掉畸形輸入展開出的巨大區間（例如把年份打成五位數），
 * 而不是限制正常的分析視窗；十年已遠超任何實際分析需求，因此取 3,660 天（約 10 年）。
 */
export const DATE_RANGE_MAX_DAYS = 3_660

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
/** 以 UTC 承載 `YYYY-MM-DD` 的毫秒值；僅作日期運算，不代表任何時區的瞬間。 */
const DAY_MS = 86_400_000

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/** 把 `YYYY-MM-DD` 解析成 UTC 毫秒；非日曆日（如 2026-02-30）回 null。 */
export function dateRangeValue(date: string): number | null {
  const match = DATE_PATTERN.exec(date)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const value = new Date(Date.UTC(year, month - 1, day))
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null
  return value.getTime()
}

/** 解析 `YYYY-MM-DD`；不合法拋錯（供已驗證的內部運算呼叫）。 */
export function requireDate(date: string): number {
  const value = dateRangeValue(date)
  if (value === null) throw new Error(`Invalid date: ${date}`)
  return value
}

function format(value: number): string {
  const date = new Date(value)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 以 `YYYY-MM-DD` 加減天數；跨越月份／年份由 Date 正規化。 */
export function shiftDate(date: string, days: number): string {
  return format(requireDate(date) + days * DAY_MS)
}

/** `to` 是否不早於 `from`（含當日語意下，單日區間為合法）。 */
export function isValidDateRange(range: DateRange): boolean {
  const from = dateRangeValue(range.from)
  const to = dateRangeValue(range.to)
  return from !== null && to !== null && from <= to
}

/** 含頭含尾的日曆天數；任一端不合法回 null。 */
export function dateRangeDayCount(range: DateRange): number | null {
  if (!isValidDateRange(range)) return null
  return Math.round((requireDate(range.to) - requireDate(range.from)) / DAY_MS) + 1
}

/** 兩個區間是否代表同一段日期（供快捷鍵比對選取狀態，不受物件身分影響）。 */
export function sameDateRange(a: DateRange | null, b: DateRange | null): boolean {
  if (!a || !b) return a === b
  return a.from === b.from && a.to === b.to
}

/** 近 N 月：回推日曆月、月底截至目標月末；從回推日的翌日起算，包含今天。 */
function recentCalendarMonths(today: string, months: number): DateRange {
  const targetMonth = shiftMonth(today.slice(0, 7), -months)
  const [year, month] = targetMonth.split("-").map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(Number(today.slice(8)), lastDay)
  return { from: shiftDate(`${targetMonth}-${pad(day)}`, 1), to: today }
}

/**
 * 依 `today` 展開快捷鍵區間。
 *
 * - `today` / `last7` / `last30`：`lastN` 為**含今天的近 N 日**（N 天，非 N+1）。
 * - `thisWeek` / `lastWeek`：**週一到週日**（ISO 週）。
 * - `thisMonth`：完整日曆月，末日為當月最後一天。
 * - `last1Month` / `last2Months` / `last3Months` / `last6Months`：近 N 個日曆月，包含今天。
 */
export function dateRangeForPreset(preset: DateRangePresetKey, today: string, month?: string): DateRange {
  const time = requireDate(today)
  const weekday = (new Date(time).getUTCDay() + 6) % 7 // 0 = 週一
  switch (preset) {
    case "today":
      return { from: today, to: today }
    case "thisWeek": {
      const monday = shiftDate(today, -weekday)
      return { from: monday, to: shiftDate(monday, 6) }
    }
    case "lastWeek": {
      const monday = shiftDate(today, -weekday - 7)
      return { from: monday, to: shiftDate(monday, 6) }
    }
    case "thisMonth": {
      const [year, monthNumber] = (month ?? today).split("-")
      const first = `${year}-${monthNumber}-01`
      const lastDay = new Date(Date.UTC(Number(year), Number(monthNumber), 0)).getUTCDate()
      return { from: first, to: `${year}-${monthNumber}-${pad(lastDay)}` }
    }
    case "last1Month":
      return recentCalendarMonths(today, 1)
    case "last2Months":
      return recentCalendarMonths(today, 2)
    case "last3Months":
      return recentCalendarMonths(today, 3)
    case "last6Months":
      return recentCalendarMonths(today, 6)
    case "last30":
      return { from: shiftDate(today, -29), to: today }
    case "last7":
      return { from: shiftDate(today, -6), to: today }
  }
}

/** 解析快捷選項；自訂區間沿用共用日期驗證，不做時區位移。 */
export function dateRangeForShortcut(shortcut: DateRangeShortcut, today: string): DateRange {
  return shortcut.preset !== undefined
    ? dateRangeForPreset(shortcut.preset, today)
    : requireDateRange(shortcut.range)
}

/** 只匹配頁面提供的快捷選項；相同日期依顯示順序取第一個，無匹配回 null。 */
export function matchDateRangeShortcut(
  range: DateRange,
  today: string,
  shortcuts: readonly DateRangeShortcut[] = DEFAULT_DATE_RANGE_SHORTCUTS
): string | null {
  const resolved = shortcuts.map((shortcut) => ({ id: shortcut.id, range: dateRangeForShortcut(shortcut, today) }))
  return resolved.find((shortcut) => sameDateRange(range, shortcut.range))?.id ?? null
}

/** 目前顯示的區間對應哪個快捷鍵；已手動改成不符任何快捷鍵時回 `"custom"`。 */
export function matchDateRangePreset(range: DateRange, today: string): DateRangePreset {
  for (const preset of DATE_RANGE_PRESET_ORDER) {
    if (sameDateRange(range, dateRangeForPreset(preset, today))) return preset
  }
  return "custom"
}

/**
 * 檢查一段分析區間：起訖須為合法日曆日、結束不早於起始、且不超過 `DATE_RANGE_MAX_DAYS`。
 * 不合法一律拋 `RangeError`；呼叫端（`jira-jql.ts`）再轉為既有的篩選錯誤型別。
 */
export function requireDateRange(range: DateRange): DateRange {
  if (!isValidDateRange(range)) throw new RangeError("分析區間無效，請重新選擇起訖日期。")
  const days = dateRangeDayCount(range)
  if (days === null || days > DATE_RANGE_MAX_DAYS) throw new RangeError("分析區間過長，請縮小範圍。")
  return { from: range.from, to: range.to }
}

/** 取 `YYYY-MM` 的月份字串；不合法回 null。 */
export function requireMonth(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Invalid month: ${month}`)
  const [year, monthNumber] = month.split("-")
  if (Number(monthNumber) < 1 || Number(monthNumber) > 12) throw new Error(`Invalid month: ${month}`)
  // 以該月第一天驗證年份可被解析（避免 "0000-13" 之類通過）。
  requireDate(`${year}-${monthNumber}-01`)
  return month
}

/** 依 `months`（可為負）位移月份，日固定為 1 號；用於月曆換頁。 */
export function shiftMonth(month: string, months: number): string {
  const [year, monthNumber] = requireMonth(month).split("-").map(Number)
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + months, 1))
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`
}

/** 依偏移秒數回推「現在」在哪個日曆日；用於以瀏覽器本機時區取得今天。 */
export function localDateFromOffset(now: Date, timezoneOffsetMinutes: number): string {
  return new Date(now.getTime() - timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10)
}
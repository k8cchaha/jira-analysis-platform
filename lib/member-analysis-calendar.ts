import { requireDate, shiftDate, type DateRange } from "./date-range.ts"

/**
 * 成員分析的工作日計算（純函式，無 I/O）。
 *
 * 工作日 = 區間內扣除週六、週日與表列的國定假日。假日表只放「放假日」，
 * 補班日（週六上班）目前不在此模型內；日後若要支援，於 `MEMBER_ANALYSIS_WORKDAYS` 再加補班日清單即可。
 * 日期一律是 `YYYY-MM-DD` 的瀏覽器本機日曆日，與分析區間同一基準。
 */
export const MEMBER_ANALYSIS_HOLIDAYS: readonly string[] = [
  // 2026（台灣行政機關辦公日曆表）
  "2026-01-01", // 元旦
  "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", // 春節
  "2026-02-27", // 二二八調整放假
  "2026-02-28", // 和平紀念日
  "2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06", // 兒童節／清明節
  "2026-05-01", // 勞動節
  "2026-06-19", // 端午節
  "2026-09-25", // 中秋節
  "2026-09-28", // 教師節（例假日順延）
  "2026-10-10", // 國慶日
  "2026-10-26", // 光復節補假
  "2026-12-25", // 行憲紀念日
]

const HOLIDAY_SET = new Set(MEMBER_ANALYSIS_HOLIDAYS)

/** 該日是否為工作日（非週六／週日，且不在假日表）。 */
export function isMemberAnalysisWorkday(date: string): boolean {
  const weekday = (new Date(requireDate(date)).getUTCDay() + 6) % 7 // 0 = 週一
  return weekday <= 4 && !HOLIDAY_SET.has(date)
}

/** 區間內（含頭含尾）的工作日天數；空或不合法區間回 0。 */
export function memberAnalysisWorkdays(range: DateRange): number {
  if (!range.from || !range.to || range.from > range.to) return 0
  let days = 0
  for (let date = range.from; date <= range.to; date = shiftDate(date, 1)) {
    if (isMemberAnalysisWorkday(date)) days += 1
  }
  return days
}

/** SP ÷ 工作日；工作日為 0 或 SP 未填時回 null（不補 0、不除不存在的分母）。 */
export function pointsPerWorkday(points: number | null, workdays: number): number | null {
  return points === null || workdays <= 0 || !Number.isFinite(points) ? null : points / workdays
}

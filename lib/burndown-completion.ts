/** Resolved timestamp → Jira 帳號日曆日；純函式，不補值、不重建歷史。 */
export interface BurndownCompletion {
  doneBeforeStart: boolean
  doneDate: string | null
}

function resolvedInstant(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value !== "string") throw new Error("Invalid resolutiondate")
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(value)
  if (!match) throw new Error("Invalid resolutiondate")
  const [, y, m, d, h, min, s, fraction, zone, sign, offsetH, offsetM] = match
  const year = Number(y), month = Number(m), day = Number(d)
  const hour = Number(h), minute = Number(min), second = Number(s)
  if (year < 1 || hour > 23 || minute > 59 || second > 59) throw new Error("Invalid resolutiondate")
  const local = new Date(0)
  local.setUTCFullYear(year, month - 1, day)
  local.setUTCHours(hour, minute, second, Number((fraction ?? "").padEnd(3, "0").slice(0, 3)))
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) {
    throw new Error("Invalid resolutiondate")
  }
  let offset = 0
  if (zone !== "Z") {
    if (Number(offsetH) > 23 || Number(offsetM) > 59) throw new Error("Invalid resolutiondate offset")
    offset = (Number(offsetH) * 60 + Number(offsetM)) * (sign === "+" ? 1 : -1)
  }
  return new Date(local.getTime() - offset * 60_000)
}

/** 建立一次 formatter，供同份完整資料集共用；時區必須來自 server-verified Jira profile。 */
export function createBurndownCompletionResolver(
  timeZone: string,
  startDate: string,
  lastDate: string | null
): (value: unknown) => BurndownCompletion {
  if (typeof timeZone !== "string" || !timeZone.trim() || timeZone !== timeZone.trim() || /^[+-]/.test(timeZone)) {
    throw new Error("Invalid Jira timeZone")
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, calendar: "iso8601", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit", era: "short",
  })
  return (value) => {
    const instant = resolvedInstant(value)
    if (instant === null) return { doneBeforeStart: false, doneDate: null }
    const parts = formatter.formatToParts(instant)
    const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)?.value
    const year = part("year")
    if (part("era") !== "AD" || !year || Number(year) > 9999) throw new Error("Invalid resolutiondate calendar")
    const date = `${year.padStart(4, "0")}-${part("month")}-${part("day")}`
    if (date < startDate) return { doneBeforeStart: true, doneDate: null }
    return { doneBeforeStart: false, doneDate: lastDate !== null && date <= lastDate ? date : null }
  }
}

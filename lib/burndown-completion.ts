/** Resolved timestamp → Jira 帳號日曆日；純函式，不補值、不重建歷史。 */
export interface BurndownCompletion {
  doneBeforeStart: boolean
  doneDate: string | null
}

/** DEBUG BUILD: one line per rejected timestamp, carrying only its shape — never the value or the issue. */
function debugReject(reason: string, value: unknown): void {
  const shape = typeof value !== "string" ? typeof value : !value ? "empty" : value.replace(/\d/g, "9").slice(0, 40)
  console.error(JSON.stringify({ scope: "resolved-date", reason, shape }))
}

function resolvedInstant(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value !== "string") { debugReject("not-a-string", value); throw new Error("Invalid resolutiondate") }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(value)
  if (!match) { debugReject("format", value); throw new Error("Invalid resolutiondate") }
  const [, y, m, d, h, min, s, fraction, zone, sign, offsetH, offsetM] = match
  const year = Number(y), month = Number(m), day = Number(d)
  const hour = Number(h), minute = Number(min), second = Number(s)
  if (year < 1 || hour > 23 || minute > 59 || second > 59) { debugReject("range", value); throw new Error("Invalid resolutiondate") }
  const local = new Date(0)
  local.setUTCFullYear(year, month - 1, day)
  local.setUTCHours(hour, minute, second, Number((fraction ?? "").padEnd(3, "0").slice(0, 3)))
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) {
    debugReject("not-a-calendar-day", value)
    throw new Error("Invalid resolutiondate")
  }
  let offset = 0
  if (zone !== "Z") {
    if (Number(offsetH) > 23 || Number(offsetM) > 59) { debugReject("offset", value); throw new Error("Invalid resolutiondate offset") }
    offset = (Number(offsetH) * 60 + Number(offsetM)) * (sign === "+" ? 1 : -1)
  }
  return new Date(local.getTime() - offset * 60_000)
}

/** 完整 Resolved 日曆日，不裁切 Sprint 範圍；null 僅代表未填。 */
export function createResolvedCalendarDateResolver(timeZone: string): (value: unknown) => string | null {
  if (typeof timeZone !== "string" || !timeZone.trim() || timeZone !== timeZone.trim() || /^[+-]/.test(timeZone)) {
    console.error(JSON.stringify({ scope: "resolved-date", reason: "bad-timezone-shape" }))
    throw new Error("Invalid Jira timeZone")
  }
  // DEBUG BUILD: building the formatter throws when this runtime has no data for the zone; name it.
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      // ISO formatters may omit era in newer ICU; Gregorian keeps the AD/BC boundary check usable.
      timeZone, calendar: "gregory", numberingSystem: "latn",
      year: "numeric", month: "2-digit", day: "2-digit", era: "short",
    })
  } catch (error) {
    console.error(JSON.stringify({ scope: "resolved-date", reason: "timezone-not-supported", timeZone, runtime: `${process.version} icu=${process.versions.icu ?? "none"} cldr=${process.versions.cldr ?? "none"}`, error: error instanceof Error ? error.name : typeof error }))
    throw error
  }
  return (value) => {
    const instant = resolvedInstant(value)
    if (instant === null) return null
    const parts = formatter.formatToParts(instant)
    const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)?.value
    const year = part("year")
    const calendarYear = Number(year)
    if (part("era") !== "AD" || !year || !Number.isInteger(calendarYear) || calendarYear < 1 || calendarYear > 9999) { debugReject("calendar", value); throw new Error("Invalid resolutiondate calendar") }
    return `${year.padStart(4, "0")}-${part("month")}-${part("day")}`
  }
}

/** 原 Burn Down 的範圍投影保持不變。 */
export function createBurndownCompletionResolver(timeZone: string, startDate: string, lastDate: string | null): (value: unknown) => BurndownCompletion {
  const resolve = createResolvedCalendarDateResolver(timeZone)
  return (value) => {
    const date = resolve(value)
    if (date === null) return { doneBeforeStart: false, doneDate: null }
    if (date < startDate) return { doneBeforeStart: true, doneDate: null }
    return { doneBeforeStart: false, doneDate: lastDate !== null && date <= lastDate ? date : null }
  }
}

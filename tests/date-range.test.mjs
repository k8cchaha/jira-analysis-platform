import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  DEFAULT_DATE_RANGE_SHORTCUTS,
  DATE_RANGE_MAX_DAYS,
  DATE_RANGE_PRESET_LABEL,
  DATE_RANGE_PRESET_ORDER,
  dateRangeDayCount,
  dateRangeForPreset,
  dateRangeForShortcut,
  matchDateRangeShortcut,
  dateRangeValue,
  isValidDateRange,
  localDateFromOffset,
  matchDateRangePreset,
  requireDateRange,
  requireMonth,
  sameDateRange,
  shiftDate,
  shiftMonth,
} from "../lib/date-range.ts"

// 2026-10-19 是週一；2026-10-25 是週日；2026-11-01 是週日。
const MONDAY = "2026-10-19"
const WEDNESDAY = "2026-10-21"
const SUNDAY = "2026-10-25"

describe("date-range calendar arithmetic", () => {
  it("shifts days across month and year boundaries", () => {
    assert.equal(shiftDate("2026-10-19", 1), "2026-10-20")
    assert.equal(shiftDate("2026-10-31", 1), "2026-11-01")
    assert.equal(shiftDate("2026-11-01", -1), "2026-10-31")
    assert.equal(shiftDate("2026-01-01", -1), "2025-12-31")
    assert.equal(shiftDate("2026-03-01", -1), "2026-02-28") // 非閏年
    assert.equal(shiftDate("2028-03-01", -1), "2028-02-29") // 閏年
    assert.equal(shiftDate(MONDAY, 0), MONDAY)
  })
  it("rejects malformed and impossible calendar days", () => {
    for (const value of ["2026-2-01", "2026-02-1", "26-02-01", "2026/02/01", "2026-13-01", "2026-02-30", "2026-00-10", "", "2026-02-01T00:00"]) {
      assert.equal(dateRangeValue(value), null, value)
      assert.throws(() => shiftDate(value, 1))
    }
    assert.equal(dateRangeValue("2028-02-29"), Date.UTC(2028, 1, 29))
  })
  it("counts inclusive days and flags reversed ranges", () => {
    assert.equal(dateRangeDayCount({ from: MONDAY, to: MONDAY }), 1)
    assert.equal(dateRangeDayCount({ from: MONDAY, to: SUNDAY }), 7)
    assert.equal(dateRangeDayCount({ from: "2026-01-01", to: "2026-12-31" }), 365)
    assert.equal(dateRangeDayCount({ from: SUNDAY, to: MONDAY }), null)
    assert.equal(dateRangeDayCount({ from: "2026-02-30", to: MONDAY }), null)
    assert.equal(isValidDateRange({ from: MONDAY, to: MONDAY }), true)
    assert.equal(isValidDateRange({ from: SUNDAY, to: MONDAY }), false)
  })
  it("compares ranges by value, not by object identity", () => {
    assert.equal(sameDateRange({ from: MONDAY, to: SUNDAY }, { from: MONDAY, to: SUNDAY }), true)
    assert.equal(sameDateRange({ from: MONDAY, to: SUNDAY }, { from: MONDAY, to: MONDAY }), false)
    assert.equal(sameDateRange(null, null), true)
    assert.equal(sameDateRange(null, { from: MONDAY, to: SUNDAY }), false)
  })
  it("enforces the range ceiling and rejects invalid ranges", () => {
    assert.deepEqual(requireDateRange({ from: MONDAY, to: SUNDAY }), { from: MONDAY, to: SUNDAY })
    assert.throws(() => requireDateRange({ from: SUNDAY, to: MONDAY }), RangeError)
    assert.throws(() => requireDateRange({ from: "2026-02-30", to: MONDAY }), RangeError)
    // 上限本身允許，超過一天即拒絕。
    assert.equal(dateRangeDayCount({ from: "2020-01-01", to: shiftDate("2020-01-01", DATE_RANGE_MAX_DAYS - 1) }), DATE_RANGE_MAX_DAYS)
    assert.throws(() => requireDateRange({ from: "2020-01-01", to: shiftDate("2020-01-01", DATE_RANGE_MAX_DAYS) }), RangeError)
  })
  it("derives the local calendar day from a fixed instant and offset", () => {
    // 台北 (UTC+8)：UTC 2026-10-18T20:30Z 已是本機 10-19。
    assert.equal(localDateFromOffset(new Date("2026-10-18T20:30:00Z"), -480), "2026-10-19")
    // 洛杉磯 (UTC-7)：同瞬間仍是 10-18。
    assert.equal(localDateFromOffset(new Date("2026-10-18T20:30:00Z"), 420), "2026-10-18")
    assert.equal(localDateFromOffset(new Date("2026-10-18T20:30:00Z"), 0), "2026-10-18")
  })
})

describe("date-range presets", () => {
  it("exposes the six shortcut labels in display order", () => {
    assert.deepEqual([...DATE_RANGE_PRESET_ORDER], ["today", "thisWeek", "lastWeek", "thisMonth", "last7", "last30"])
    assert.deepEqual(DATE_RANGE_PRESET_ORDER.map((key) => DATE_RANGE_PRESET_LABEL[key]), ["今日", "本週", "上週", "本月", "近 7 日", "近 30 日"])
  })
  it("expands today as a single inclusive day", () => {
    assert.deepEqual(dateRangeForPreset("today", MONDAY), { from: MONDAY, to: MONDAY })
  })
  it("uses Monday-to-Sunday ISO weeks for 本週 and 上週", () => {
    for (const today of [MONDAY, WEDNESDAY, SUNDAY]) {
      assert.deepEqual(dateRangeForPreset("thisWeek", today), { from: "2026-10-19", to: "2026-10-25" }, today)
      assert.deepEqual(dateRangeForPreset("lastWeek", today), { from: "2026-10-12", to: "2026-10-18" }, today)
    }
    // 跨月：2026-11-01 是週日，仍屬 10-26 起的那一週。
    assert.deepEqual(dateRangeForPreset("thisWeek", "2026-11-01"), { from: "2026-10-26", to: "2026-11-01" })
  })
  it("uses whole calendar months for 本月", () => {
    assert.deepEqual(dateRangeForPreset("thisMonth", "2026-10-21"), { from: "2026-10-01", to: "2026-10-31" })
    assert.deepEqual(dateRangeForPreset("thisMonth", "2026-02-15"), { from: "2026-02-01", to: "2026-02-28" })
    assert.deepEqual(dateRangeForPreset("thisMonth", "2028-02-15"), { from: "2028-02-01", to: "2028-02-29" }) // 閏年
    assert.deepEqual(dateRangeForPreset("thisMonth", "2026-04-30"), { from: "2026-04-01", to: "2026-04-30" })
    // 可指定基準月份，讓「今天」所在月份之外的月曆也能算。
    assert.deepEqual(dateRangeForPreset("thisMonth", "2026-10-21", "2026-12-09"), { from: "2026-12-01", to: "2026-12-31" })
  })
  it("counts 近 N 日 as N days including today", () => {
    assert.deepEqual(dateRangeForPreset("last7", MONDAY), { from: "2026-10-13", to: MONDAY })
    assert.deepEqual(dateRangeForPreset("last30", MONDAY), { from: "2026-09-20", to: MONDAY })
    assert.equal(dateRangeDayCount(dateRangeForPreset("last7", MONDAY)), 7)
    assert.equal(dateRangeDayCount(dateRangeForPreset("last30", MONDAY)), 30)
    assert.equal(dateRangeDayCount(dateRangeForPreset("today", MONDAY)), 1)
  })
  it("expands recent calendar months including today without assuming 30-day months", () => {
    const today = "2026-11-03"
    for (const [preset, from] of [
      ["last1Month", "2026-10-04"],
      ["last2Months", "2026-09-04"],
      ["last3Months", "2026-08-04"],
      ["last6Months", "2026-05-04"],
    ]) {
      assert.deepEqual(dateRangeForPreset(preset, today), { from, to: today })
    }
    assert.equal(dateRangeDayCount(dateRangeForPreset("last1Month", today)), 31)
    assert.equal(dateRangeDayCount(dateRangeForPreset("last1Month", "2026-03-03")), 28)
  })
  it("clamps the backdated month day before adding one inclusive day, across leap years and year boundaries", () => {
    assert.deepEqual(dateRangeForPreset("last1Month", "2026-03-31"), { from: "2026-03-01", to: "2026-03-31" })
    assert.deepEqual(dateRangeForPreset("last1Month", "2028-03-31"), { from: "2028-03-01", to: "2028-03-31" })
    assert.deepEqual(dateRangeForPreset("last6Months", "2026-08-31"), { from: "2026-03-01", to: "2026-08-31" })
    assert.deepEqual(dateRangeForPreset("last3Months", "2026-01-01"), { from: "2025-10-02", to: "2026-01-01" })
    assert.deepEqual(dateRangeForPreset("last1Month", "2026-11-01"), { from: "2026-10-02", to: "2026-11-01" })
  })
  it("matches the current range back to a shortcut and reports custom", () => {
    assert.equal(matchDateRangePreset({ from: "2026-10-19", to: "2026-10-25" }, WEDNESDAY), "thisWeek")
    assert.equal(matchDateRangePreset({ from: "2026-10-15", to: WEDNESDAY }, WEDNESDAY), "last7")
    assert.equal(matchDateRangePreset({ from: "2026-10-01", to: "2026-10-31" }, WEDNESDAY), "thisMonth")
    assert.equal(matchDateRangePreset({ from: "2026-10-14", to: MONDAY }, WEDNESDAY), "custom")
    // 手動改成「近 7 日」的日期時，即使沒按快捷鍵也應標示為該快捷鍵。
    assert.equal(matchDateRangePreset({ ...dateRangeForPreset("last7", WEDNESDAY) }, WEDNESDAY), "last7")
  })
  it("resolves overlapping shortcuts in display order", () => {
    // 週一當天，「本週」= 10-19 ~ 10-25；若今天就是 10-19，近 7 日為 10-13 ~ 10-19，
    // 兩者不相等，故不會誤判；確認順序仍以 DATE_RANGE_PRESET_ORDER 為準。
    assert.equal(matchDateRangePreset({ from: MONDAY, to: MONDAY }, MONDAY), "today")
    const order = DATE_RANGE_PRESET_ORDER.indexOf("today") < DATE_RANGE_PRESET_ORDER.indexOf("last7")
    assert.equal(order, true)
  })
})

describe("page-specific date-range shortcuts", () => {
  const monthly = { id: "monthly", label: "最近一個月", preset: "last30" }
  const sprint = { id: "sprint", label: "本期 Sprint", range: { from: MONDAY, to: "2026-11-01" } }

  it("derives default definitions from the original keys and labels", () => {
    assert.deepEqual(DEFAULT_DATE_RANGE_SHORTCUTS, DATE_RANGE_PRESET_ORDER.map((preset) => ({
      id: preset, label: DATE_RANGE_PRESET_LABEL[preset], preset,
    })))
    assert.deepEqual(JSON.parse(JSON.stringify([monthly, sprint])), [monthly, sprint])
  })
  it("resolves relabelled built-ins and fixed ranges without mutating the configuration", () => {
    assert.deepEqual(dateRangeForShortcut(monthly, MONDAY), dateRangeForPreset("last30", MONDAY))
    const resolved = dateRangeForShortcut(sprint, WEDNESDAY)
    assert.deepEqual(resolved, sprint.range)
    assert.notEqual(resolved, sprint.range)
    resolved.from = SUNDAY
    assert.equal(sprint.range.from, MONDAY)
  })
  it("only matches visible shortcuts; empty lists and partial overlaps never match", () => {
    const week = dateRangeForPreset("thisWeek", WEDNESDAY)
    assert.equal(matchDateRangeShortcut(week, WEDNESDAY, [monthly, sprint]), null)
    assert.equal(matchDateRangeShortcut(week, WEDNESDAY, []), null)
    assert.equal(matchDateRangeShortcut(week, WEDNESDAY), "thisWeek")
    assert.equal(matchDateRangeShortcut(sprint.range, WEDNESDAY, [monthly, sprint]), "sprint")
  })
  it("resolves identical ranges by page display order, not original preset order", () => {
    const week = { id: "week", label: "本週", preset: "thisWeek" }
    const recent = { id: "recent", label: "近 7 日", preset: "last7" }
    // On Sunday these two options represent exactly the same dates.
    const range = dateRangeForPreset("last7", SUNDAY)
    assert.equal(matchDateRangeShortcut(range, SUNDAY, [recent, week]), "recent")
    assert.equal(matchDateRangeShortcut(range, SUNDAY, [week, recent]), "week")
  })
  it("rejects malformed, reversed and oversized custom dates even after an earlier matching option", () => {
    for (const range of [
      { from: "2026-02-30", to: MONDAY },
      { from: SUNDAY, to: MONDAY },
      { from: "2020-01-01", to: shiftDate("2020-01-01", DATE_RANGE_MAX_DAYS) },
    ]) {
      const invalid = { id: "invalid", label: "錯誤範圍", range }
      assert.throws(() => dateRangeForShortcut(invalid, MONDAY), RangeError)
      assert.throws(() => matchDateRangeShortcut(sprint.range, MONDAY, [sprint, invalid]), RangeError)
    }
  })
})

describe("month navigation", () => {
  it("shifts months across year boundaries", () => {
    assert.equal(shiftMonth("2026-10", 1), "2026-11")
    assert.equal(shiftMonth("2026-12", 1), "2027-01")
    assert.equal(shiftMonth("2026-01", -1), "2025-12")
    assert.equal(shiftMonth("2026-06", -6), "2025-12")
    assert.equal(shiftMonth("2026-06", 0), "2026-06")
  })
  it("rejects malformed months", () => {
    assert.equal(requireMonth("2026-10"), "2026-10")
    for (const value of ["2026-13", "2026-00", "2026-1", "26-10", "2026/10", ""]) {
      assert.throws(() => requireMonth(value), value)
    }
  })
})
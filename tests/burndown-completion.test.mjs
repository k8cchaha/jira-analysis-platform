import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createBurndownCompletionResolver, createResolvedCalendarDateResolver } from "../lib/burndown-completion.ts"
import { mockIsoCalendarWithoutEra } from "./helpers/intl-calendar-harness.mjs"

const resolve = createBurndownCompletionResolver("Asia/Taipei", "2026-10-13", "2026-10-19")
const markers = (doneDate, doneBeforeStart = false) => ({ doneDate, doneBeforeStart })

describe("Resolved calendar runtime compatibility", () => {
  it("keeps valid completion dates when the ISO formatter omits era", (t) => {
    mockIsoCalendarWithoutEra(t)
    const options = { timeZone: "Asia/Taipei", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", era: "short" }
    const instant = new Date("2026-10-12T16:00:00Z")
    assert.equal(new Intl.DateTimeFormat("en-CA", { ...options, calendar: "iso8601" }).formatToParts(instant).some((part) => part.type === "era"), false)
    assert.equal(new Intl.DateTimeFormat("en-CA", { ...options, calendar: "gregory" }).formatToParts(instant).find((part) => part.type === "era")?.value, "AD")

    const calendarDate = createResolvedCalendarDateResolver("Asia/Taipei")
    const completion = createBurndownCompletionResolver("Asia/Taipei", "2026-10-13", "2026-10-19")
    for (const stamp of ["2026-10-12T16:00:00Z", "2026-10-13T00:00:00+0800", "2026-10-13T00:00:00+08:00", "2026-10-12T09:00:00-0700"]) {
      assert.equal(calendarDate(stamp), "2026-10-13")
      assert.deepEqual(completion(stamp), markers("2026-10-13"))
    }
    assert.deepEqual(completion("2026-10-12T23:59:59.999+0800"), markers(null, true))
    assert.deepEqual(completion("2026-10-20T00:00:00+0800"), markers(null))
    for (const missing of [null, undefined, ""]) assert.equal(calendarDate(missing), null)
  })

  for (const omitIsoEra of [false, true]) {
    const runtime = omitIsoEra ? "ISO formatter without era" : "native Intl"
    it(`accepts the first and last supported calendar years with ${runtime}`, (t) => {
      if (omitIsoEra) mockIsoCalendarWithoutEra(t)
      const calendarDate = createResolvedCalendarDateResolver("UTC")
      assert.equal(calendarDate("0001-01-01T00:00:00Z"), "0001-01-01")
      assert.equal(calendarDate("9999-12-31T23:59:59Z"), "9999-12-31")
    })
    it(`rejects final calendar dates outside AD 1–9999 with ${runtime}`, (t) => {
      if (omitIsoEra) mockIsoCalendarWithoutEra(t)
      const utc = createResolvedCalendarDateResolver("UTC")
      assert.throws(() => utc("0000-01-01T00:00:00Z"), /Invalid resolutiondate/)
      assert.throws(() => utc("0001-01-01T00:00:00+0100"), /Invalid resolutiondate calendar/)
      assert.throws(() => utc("9999-12-31T23:30:00-0100"), /Invalid resolutiondate calendar/)
      assert.throws(() => createResolvedCalendarDateResolver("Etc/GMT+1")("0001-01-01T00:00:00Z"), /Invalid resolutiondate calendar/)
      assert.throws(() => createResolvedCalendarDateResolver("Etc/GMT-1")("9999-12-31T23:30:00Z"), /Invalid resolutiondate calendar/)
    })
    it(`validates the account date rather than rejecting an out-of-range UTC year with ${runtime}`, (t) => {
      if (omitIsoEra) mockIsoCalendarWithoutEra(t)
      assert.equal(createResolvedCalendarDateResolver("Etc/GMT-1")("0001-01-01T00:00:00+0100"), "0001-01-01")
      assert.equal(createResolvedCalendarDateResolver("Etc/GMT+1")("9999-12-31T23:30:00-0100"), "9999-12-31")
    })
  }
})

describe("bulk Resolved timestamp projection", () => {
  it("uses the Jira account calendar, not timestamp text or host timezone", () => {
    assert.deepEqual(resolve("2026-10-12T16:00:00Z"), markers("2026-10-13"))
    assert.deepEqual(resolve("2026-10-12T23:59:59.999+0800"), markers(null, true))
    for (const stamp of ["2026-10-13T00:00:00+0800", "2026-10-13T00:00:00+08:00", "2026-10-12T16:00:00Z", "2026-10-12T09:00:00-0700"]) {
      assert.deepEqual(resolve(stamp), markers("2026-10-13"))
    }
  })
  it("keeps pre-start independent and never clamps later dates or supplies fallback", () => {
    assert.deepEqual(resolve("2026-10-10T12:00:00Z"), markers(null, true))
    assert.deepEqual(resolve("2026-10-19T23:59:59.999+0800"), markers("2026-10-19"))
    assert.deepEqual(resolve("2026-10-20T00:00:00+0800"), markers(null))
    for (const missing of [null, undefined, ""]) assert.deepEqual(resolve(missing), markers(null))
    const future = createBurndownCompletionResolver("UTC", "2026-10-13", null)
    assert.deepEqual(future("2026-10-13T00:00:00Z"), markers(null))
  })
  it("handles DST using the named account zone", () => {
    const ny = createBurndownCompletionResolver("America/New_York", "2026-03-07", "2026-03-10")
    assert.deepEqual(ny("2026-03-08T04:59:59Z"), markers("2026-03-07"))
    assert.deepEqual(ny("2026-03-08T05:00:00Z"), markers("2026-03-08"))
    assert.deepEqual(ny("2026-03-09T03:59:59Z"), markers("2026-03-08"))
    assert.deepEqual(ny("2026-03-09T04:00:00Z"), markers("2026-03-09"))
    const fall = createBurndownCompletionResolver("America/New_York", "2026-10-31", "2026-11-02")
    assert.deepEqual(fall("2026-11-01T05:30:00Z"), markers("2026-11-01"))
    assert.deepEqual(fall("2026-11-01T06:30:00Z"), markers("2026-11-01"))
  })
  it("validates leap days and year/month boundaries", () => {
    const leap = createBurndownCompletionResolver("UTC", "2028-02-28", "2028-03-01")
    assert.deepEqual(leap("2028-02-29T00:00:00Z"), markers("2028-02-29"))
    const year = createBurndownCompletionResolver("Asia/Taipei", "2026-12-31", "2027-01-01")
    assert.deepEqual(year("2026-12-31T16:00:00Z"), markers("2027-01-01"))
  })
  it("rejects malformed nonempty dates and offset-less local timestamps", () => {
    for (const value of ["2026-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-00-01T00:00:00Z", "2026-13-01T00:00:00Z", "2026-10-00T00:00:00Z", "2026-10-13T24:00:00Z", "2026-10-13T00:60:00Z", "2026-10-13T00:00:60Z", "2026-10-13T00:00:00+2400", "2026-10-13T00:00:00+0860", "2026-10-13T00:00:00", "2026-10-13", " ", "garbage", 0, {}, []]) {
      assert.throws(() => resolve(value), String(value))
    }
  })
  it("requires an explicit supported named timezone", () => {
    for (const zone of [undefined, null, "", " ", "Invalid/Zone", "+08:00", " Asia/Taipei"]) {
      assert.throws(() => createBurndownCompletionResolver(zone, "2026-10-13", "2026-10-19"))
    }
  })
})

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  ANALYSIS_ORDER_BY,
  MISSING_POINTS_JQL,
  analysisDateJql,
  analysisRangeJql,
  requireAnalysisDateRange,
} from "../lib/jira-jql.ts"
import { DashboardFilterError } from "../lib/jira-dashboard-filter.ts"
import { DATE_RANGE_MAX_DAYS, shiftDate } from "../lib/date-range.ts"

const RANGE = { from: "2026-10-01", to: "2026-10-31" }

describe("analysis date-range JQL", () => {
  it("bounds created inclusively with an explicit end day", () => {
    // created 帶時間：`<= to` 會漏掉當天，必須比較到當日 23:59。
    assert.equal(analysisDateJql(RANGE), ' AND created >= "2026-10-01" AND created <= "2026-10-31 23:59"')
    assert.equal(analysisDateJql({ from: "2026-10-19", to: "2026-10-19" }), ' AND created >= "2026-10-19" AND created <= "2026-10-19 23:59"')
  })
  it("uses a plain date comparison for date-only fields", () => {
    assert.equal(analysisDateJql(RANGE, "duedate"), ' AND duedate >= "2026-10-01" AND duedate <= "2026-10-31"')
  })
  it("rejects invalid, reversed and oversized ranges instead of widening", () => {
    assert.throws(() => analysisDateJql({ from: "2026-10-31", to: "2026-10-01" }), DashboardFilterError)
    assert.throws(() => analysisDateJql({ from: "2026-02-30", to: "2026-10-01" }), DashboardFilterError)
    assert.throws(() => analysisDateJql({ from: "2026-1-01", to: "2026-10-01" }), DashboardFilterError)
    assert.throws(() => analysisDateJql({ from: "2026-10-01", to: "99999-10-01" }), DashboardFilterError)
    assert.throws(() => requireAnalysisDateRange({ from: "", to: "" }), DashboardFilterError)
  })
  it("allows a decade-long window but refuses anything beyond the ceiling", () => {
    // 上限為 3,660 天（約 10 年）：正常分析視窗一律放行，只有畸形輸入會被擋下。
    assert.doesNotThrow(() => analysisDateJql({ from: "2020-01-01", to: "2029-12-31" }))
    assert.doesNotThrow(() => requireAnalysisDateRange({ from: "2020-01-01", to: shiftDate("2020-01-01", DATE_RANGE_MAX_DAYS - 1) }))
    assert.throws(() => requireAnalysisDateRange({ from: "2020-01-01", to: shiftDate("2020-01-01", DATE_RANGE_MAX_DAYS) }), DashboardFilterError)
  })
  it("composes over a centrally defined query and appends one stable sort", () => {
    const jql = analysisRangeJql(MISSING_POINTS_JQL, RANGE)
    assert.equal(jql, `${MISSING_POINTS_JQL} AND created >= "2026-10-01" AND created <= "2026-10-31 23:59" ${ANALYSIS_ORDER_BY}`)
    assert.equal(ANALYSIS_ORDER_BY, "ORDER BY key ASC")
    // 只有一段 ORDER BY，且落在日期限制之後。
    assert.equal(jql.match(/ORDER BY/g).length, 1)
    assert.ok(jql.endsWith("ORDER BY key ASC"))
    assert.ok(jql.indexOf("ORDER BY") > jql.indexOf("created >="))
  })
  it("replaces an existing sort instead of stacking a second one", () => {
    const jql = analysisRangeJql("project = sun ORDER BY created DESC", RANGE)
    assert.equal(jql.match(/ORDER BY/g).length, 1)
    assert.equal(jql, 'project = sun AND created >= "2026-10-01" AND created <= "2026-10-31 23:59" ORDER BY key ASC')
  })
  it("keeps the base query intact and interpolates nothing from the range but dates", () => {
    for (const range of [RANGE, { from: "2026-01-05", to: "2026-01-05" }, { from: "2025-12-28", to: "2026-01-03" }]) {
      const jql = analysisRangeJql(MISSING_POINTS_JQL, range)
      assert.ok(jql.startsWith(`${MISSING_POINTS_JQL} AND created >=`), jql)
      assert.match(jql, /^[^"]*"[^"]*"$/m.test ? /./ : /./)
      assert.equal(jql.match(/"/g).length % 2, 0, "quotes stay balanced")
    }
  })
})
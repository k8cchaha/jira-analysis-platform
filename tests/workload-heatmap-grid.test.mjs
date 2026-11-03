import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
import * as heatmap from "../lib/workload-heatmap.ts"

const require = createRequire(import.meta.url)
const file = new URL("../app/(app)/analytics/workload/workload-heatmap-grid.tsx", import.meta.url)
const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
  fileName: file.pathname,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
})
const compiled = { exports: {} }
const fixtureRequire = (name) => {
  if (name === "@/lib/workload-heatmap") return heatmap
  if (["react", "react/jsx-runtime"].includes(name)) return require(name)
  throw new Error(`Unexpected grid dependency: ${name}`)
}
new Function("require", "module", "exports", outputText)(fixtureRequire, compiled, compiled.exports)
const render = (value, metric = "points", selection = null, metricSwitch = null) => renderToStaticMarkup(createElement(compiled.exports.WorkloadHeatmapGrid, { heatmap: value, metric, metricSwitch, selection, detailsId: "fixture-details", onSelect: () => {} }))
function build(overrides = {}) {
  return heatmap.computeWeeklyWorkloadHeatmap({
    from: "2026-12-28", to: "2027-01-11",
    days: ["2026-12-31", "2027-01-03", "2027-01-04", "2027-01-11"],
    tasks: [
      { key: "A", points: 2.1, doneDate: "2026-12-31", assigneeAccountId: "a", assigneeDisplayName: "Alice" },
      { key: "B", points: 3, doneDate: "2027-01-03", assigneeAccountId: "a", assigneeDisplayName: "Alice" },
      { key: "C", points: 0, doneDate: "2027-01-04", assigneeAccountId: "a", assigneeDisplayName: "Alice" },
    ],
    members: [{ accountId: "a", displayName: "Alice" }], teamOf: () => "Web", teamOrder: ["Web"], ...overrides,
  })
}

describe("weekly heatmap table markup (not browser layout)", () => {
  it("places the metric switch beside the summary, right-aligned with narrow-width wrapping", () => {
    const markup = render(build(), "points", null, createElement("button", { role: "switch", "aria-checked": false }, "Metric switch"))
    const header = markup.slice(0, markup.indexOf('<div class="max-w-full overflow-x-auto'))
    assert.match(header, /flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2/)
    assert.match(header, /<\/p><div class="ml-auto max-w-full"><button role="switch"/)
    assert.equal((markup.match(/role="switch"/g) ?? []).length, 1)
  })
  it("renders a two-row year/Monday header with correct spans", () => {
    const markup = render(build())
    assert.match(markup, /rowSpan="2"[^>]*scope="col"/i)
    const header = markup.match(/<thead[\s\S]*?<\/thead>/)[0]
    assert.match(header, /Member[\s\S]*?<th rowSpan="2" scope="col"[^>]*>Total<\/th><th rowSpan="2" scope="col"[^>]*>Output%<\/th>[\s\S]*?>2026<\/th>/i)
    assert.match(markup, /colSpan="1"[^>]*scope="colgroup"[^>]*>2026<\/th>/i)
    assert.match(markup, /colSpan="2"[^>]*scope="colgroup"[^>]*>2027<\/th>/i)
    for (const monday of ["12/28", "01/04", "01/11"]) assert.match(markup, new RegExp(`>${monday}<`))
    assert.equal((markup.match(/<thead[\s\S]*?<\/thead>/)?.[0].match(/<tr>/g) ?? []).length, 2)
  })
  it("shows five columns for 10/04–11/03, excludes 09/28 and retains the two-day final week", () => {
    const markup = render(build({
      from: "2026-10-04", to: "2026-11-03",
      days: Array.from({ length: 31 }, (_, index) => new Date(Date.UTC(2026, 9, 4 + index)).toISOString().slice(0, 10)),
      tasks: [
        { key: "hidden", points: 999, doneDate: "2026-10-04", assigneeAccountId: "a", assigneeDisplayName: "Alice" },
        { key: "last", points: 3, doneDate: "2026-11-03", assigneeAccountId: "a", assigneeDisplayName: "Alice" },
      ],
    }))
    for (const monday of ["10/05", "10/12", "10/19", "10/26", "11/02"]) assert.match(markup, new RegExp(`>${monday}<`))
    assert.doesNotMatch(markup, /09\/28|>999</)
    assert.equal((markup.match(/<td\b/g) ?? []).length, 7)
    assert.match(markup, /<td[^>]*>3<\/td><td[^>]*>6%<\/td>/)
    assert.match(markup, /title="2026-11-02 ～ 2026-11-03（2 天）"/)
    assert.match(markup, /Alice・2026-11-02 ～ 2026-11-03（2 天）：Story Points 完成 3 點/)
    const summary = markup.match(/<p role="status"[^>]*>([\s\S]*?)<\/p>/)[1].replace(/<[^>]*>/g, "")
    assert.equal(summary, "共 1 名成員、5 週， 合計 3 點。")
    assert.match(markup, /<th[^>]*text-center[^>]*><span aria-hidden="true">Member<\/span>/)
  })
  it("prints weekly sums and zero while leaving null cells visually blank", () => {
    const markup = render(build())
    assert.match(markup, />5\.1<\/button>/)
    assert.match(markup, />0<\/button>/)
    assert.match(markup, /<span class="sr-only">沒有可計入的 Story Points<\/span>/)
    assert.equal((markup.match(/<td\b/g) ?? []).length, 5)
    assert.match(markup, /Alice・2026-12-31 ～ 2027-01-03（2 天）：Story Points 完成 5.1 點/)
    assert.match(markup, /Alice・2027-01-11 ～ 2027-01-11（1 天）：沒有可計入的 Story Points/)
    assert.doesNotMatch(markup, /writing-mode|h-4 w-4/)
  })
  it("places Total and Output% after each name using all displayed weeks, not active weeks", () => {
    const markup = render(build({ members: [{ accountId: "a", displayName: "Alice" }, { accountId: "b", displayName: "Bob" }] }))
    const rows = markup.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].match(/<tr>[\s\S]*?<\/tr>/g)
    assert.match(rows[0], /Alice<\/span><\/th><td[^>]*>5\.1<\/td><td[^>]*>17%<\/td>/)
    assert.match(rows[1], /Bob<\/span><\/th><td[^>]*>0<\/td><td[^>]*>0%<\/td>/)
    for (const row of rows) {
      const totals = row.match(/<td[^>]*>[\s\S]*?<\/td>/g).slice(0, 2).join("")
      assert.doesNotMatch(totals, /<button|aria-expanded|data-workload-week/)
    }
  })
  it("updates Total and Output% with the selected metric, including unassigned rows and percentages above 100", () => {
    const task = (key, points, actualPoints, accountId = "a") => ({
      key, points, actualPoints, doneDate: "2027-01-04", assigneeAccountId: accountId, assigneeDisplayName: accountId,
    })
    const input = {
      from: "2026-12-28", to: "2027-01-11", days: ["2026-12-31", "2027-01-04", "2027-01-11"],
      members: [{ accountId: "a", displayName: "Alice" }], teamOf: () => "Web", teamOrder: ["Web"],
      tasks: [task("assigned", 30, 60), task("unassigned", 4, null, null)],
    }
    for (const metric of ["points", "actualPoints"]) {
      const markup = render(heatmap.computeMetricWorkloadHeatmap({ ...input, metric }), metric)
      const rows = markup.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].match(/<tr>[\s\S]*?<\/tr>/g)
      assert.match(rows[0], metric === "points"
        ? /Alice<\/span><\/th><td[^>]*>30<\/td><td[^>]*>100%<\/td>/
        : /Alice<\/span><\/th><td[^>]*>60<\/td><td[^>]*>200%<\/td>/)
      assert.match(rows[1], metric === "points"
        ? /未指派<\/span><\/th><td[^>]*>4<\/td><td[^>]*>13\.3%<\/td>/
        : /未指派<\/span><\/th><td[^>]*>0<\/td><td[^>]*>0%<\/td>/)
    }
  })
  it("makes numeric cells including zero buttons, with selected state and a details target", () => {
    const markup = render(build(), "points", { accountId: "a", weekStart: "2027-01-04" })
    assert.equal((markup.match(/<button\b/g) ?? []).length, 2)
    assert.equal((markup.match(/aria-expanded="true"/g) ?? []).length, 1)
    assert.equal((markup.match(/aria-controls="fixture-details"/g) ?? []).length, 2)
    assert.match(markup, /type="button"[^>]*aria-expanded="true"[^>]*>0<\/button>/)
    assert.doesNotMatch(markup, /<button[^>]*沒有可計入/)
    const buttons = markup.match(/<button\b[^>]*>/g)
    const selected = buttons.find((button) => button.includes('aria-expanded="true"'))
    assert.match(selected, /outline-3 outline-offset-\[-3px\] outline-amber-600 dark:outline-amber-300/)
    assert.doesNotMatch(selected, /hover:outline|focus-visible:outline/)
    assert.equal(buttons.filter((button) => button.includes("outline-amber-600")).length, 1)
    assert.doesNotMatch(render(build()), /outline-amber-/)
  })
  it("freezes all three leading columns in headers and rows with fixed non-overlapping widths", () => {
    for (const metric of ["points", "actualPoints"]) {
      const markup = render(build({ members: [{ accountId: "a", displayName: "A very long member name that must truncate" }, { accountId: "b", displayName: "Bob" }] }), metric)
      assert.match(markup, /<table[^>]*table-fixed[^>]*style="min-width:456px"/)
      assert.match(markup, /<colgroup><col style="width:140px"\/><col style="width:72px"\/><col style="width:88px"\/>/)
      const header = markup.match(/<thead[\s\S]*?<\/thead>/)[0]
      const frozenHeaders = header.match(/<th\b[^>]*rowSpan="2"[^>]*>/gi)
      assert.equal(frozenHeaders.length, 3)
      for (const [index, offset] of ["left-0", "left-[140px]", "left-[212px]"].entries()) {
        assert.ok(frozenHeaders[index].includes(`sticky ${offset} z-20`))
        assert.ok(frozenHeaders[index].includes("bg-slate-50"))
        assert.ok(frozenHeaders[index].includes("dark:bg-slate-900"))
      }
      const rows = markup.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].match(/<tr>[\s\S]*?<\/tr>/g)
      for (const row of rows) {
        const cells = row.match(/<(?:th|td)\b[^>]*>/g)
        for (const [index, offset] of ["left-0", "left-[140px]", "left-[212px]"].entries()) {
          assert.ok(cells[index].includes(`sticky ${offset} z-10`))
          assert.ok(cells[index].includes("bg-slate-50"))
          assert.ok(cells[index].includes("dark:bg-slate-900"))
        }
        for (const cell of cells.slice(3)) assert.doesNotMatch(cell, /sticky|left-/)
      }
      assert.match(markup, /max-w-\[116px\] truncate/)
      assert.match(markup, /max-w-full overflow-x-auto/)
    }
    const singleWeek = render(build({ days: ["2027-01-04"] }))
    assert.match(singleWeek, /style="min-width:352px"/)
  })
  it("stops horizontal scroll chaining at table edges without blocking vertical page scrolling", () => {
    const days = Array.from({ length: 30 }, (_, index) => new Date(Date.UTC(2026, 0, 5 + index * 7)).toISOString().slice(0, 10))
    for (const metric of ["points", "actualPoints"]) {
      for (const shownDays of [days, days.slice(0, 1)]) {
        const markup = render(build({ from: days[0], to: days.at(-1), days: shownDays }), metric)
        const scroller = markup.match(/<div[^>]*role="region"[^>]*>/)[0]
        assert.match(scroller, /overflow-x-auto overscroll-x-none/)
        assert.match(scroller, /tabindex="0"/)
        assert.doesNotMatch(scroller, /overscroll-y-|overscroll-none(?:\s|"|$)|touch-none|overflow-hidden/)
        assert.match(markup, new RegExp(`min-width:${300 + shownDays.length * 52}px`))
      }
    }
  })
  it("retains scrollable rectangular cells, sticky names and keyboard-readable values", () => {
    const markup = render(build())
    assert.match(markup, /max-w-full overflow-x-auto/)
    assert.match(markup, /border-spacing-0/)
    assert.match(markup, /sticky left-0/)
    assert.match(markup, /min-w-\[140px\]/)
    assert.match(markup, /h-\[30px\] min-w-\[52px\]/)
    assert.match(markup, /tabindex="0" aria-label="Alice・/)
    assert.match(markup, /text-right/)
    assert.match(markup, /每欄為週一到週日/)
  })
  it("keeps totals and inactive members without explanatory footer notices", () => {
    const markup = render(build({
      members: [{ accountId: "a", displayName: "Alice" }, { accountId: "b", displayName: "Bob" }],
      unestimated: [{ key: "missing", assigneeAccountId: "a", assigneeDisplayName: "Alice" }],
    }))
    assert.match(markup, />Bob<\/span>/)
    assert.equal((markup.match(/<td\b/g) ?? []).length, 10)
    assert.doesNotMatch(markup, /另有|張 Dev-Task 未填|不計入此指標點數/)
    const summary = markup.match(/<p role="status"[^>]*>([\s\S]*?)<\/p>/)[1].replace(/<[^>]*>/g, "")
    assert.equal(summary, "共 2 名成員、3 週， 合計 5.1 點。")
    assert.doesNotMatch(markup, /空格：|每週從週一開始/)
  })
  it("names Actual Story Points in accessible text without explanatory footer notices", () => {
    const markup = render(build({ unestimated: [{ key: "missing", assigneeAccountId: "a", assigneeDisplayName: "Alice" }] }), "actualPoints")
    assert.match(markup, /Dev-Task Actual Story Points/)
    assert.match(markup, /Actual Story Points 完成 5.1 點/)
    assert.match(markup, /沒有可計入的 Actual Story Points/)
    assert.doesNotMatch(markup, /空格：|每週從週一開始|另有|張 Dev-Task 未填|不計入此指標點數/)
    assert.match(markup, />0<\/button>/)
  })
  it("escapes names as text instead of treating data as HTML", () => {
    const markup = render(build({ members: [{ accountId: "a", displayName: "<script>not-code</script>" }] }))
    assert.doesNotMatch(markup, /<script>/)
    assert.match(markup, /&lt;script&gt;not-code&lt;\/script&gt;/)
  })
  it("handles no dates and no members without a malformed table", () => {
    const emptyDates = render(build({ days: [] }))
    assert.match(emptyDates, /沒有可顯示的週/)
    const noWeek = render(build({ from: "2026-12-31", to: "2027-01-03", days: ["2026-12-31", "2027-01-03"] }), "points", null,
      createElement("button", { role: "switch", "aria-checked": false }, "Metric switch"))
    assert.match(noWeek, /沒有可顯示的週/)
    assert.match(noWeek, /role="switch"/)
    assert.doesNotMatch(noWeek, /<table|NaN|Infinity/)
    assert.doesNotMatch(emptyDates, /<table/)
    const emptyMembers = render(build({ members: [], tasks: [] }))
    assert.match(emptyMembers, /沒有可顯示的成員/)
    assert.doesNotMatch(emptyMembers, /<table/)
  })
})

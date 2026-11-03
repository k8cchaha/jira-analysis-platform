import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
import * as heatmap from "../lib/workload-heatmap.ts"

const require = createRequire(import.meta.url)
const modules = new Map()
function load(path) {
  if (modules.has(path)) return modules.get(path).exports
  const mod = { exports: {} }
  modules.set(path, mod)
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  const fixtureRequire = (name) => {
    if (["react", "react/jsx-runtime"].includes(name)) return require(name)
    if (name === "@/lib/workload-heatmap") return heatmap
    if (name === "@/components/ticket-link") return load("components/ticket-link.tsx")
    if (name === "@/app/(app)/dashboard/parent-issue-type-icon") return load("app/(app)/dashboard/parent-issue-type-icon.tsx")
    throw new Error(`Unexpected details dependency: ${name}`)
  }
  new Function("require", "module", "exports", outputText)(fixtureRequire, mod, mod.exports)
  return mod.exports
}
const Details = load("app/(app)/analytics/workload/workload-issue-details.tsx").WorkloadIssueDetails
const task = { key: "TEST-1", points: 0, actualPoints: null, summary: "A summary", status: "In Progress", resolution: "Fixed", resolvedDate: "2026-11-03", parentIssueType: { status: "known", name: "Story" } }
const props = { id: "fixture-details", memberName: "Alice", week: { start: "2026-11-02", from: "2026-11-02", to: "2026-11-03", dayCount: 2, year: "2026" }, tasks: [task], jiraBaseUrl: "https://fixture.invalid", onClose: () => {} }
const render = (overrides = {}) => renderToStaticMarkup(createElement(Details, { ...props, ...overrides }))

describe("workload inline issue details (static markup)", () => {
  it("shows seven ordered columns without Status, with SP/Actual SP and Resolved month/day", () => {
    const markup = render()
    const head = markup.match(/<thead[\s\S]*?<\/thead>/)[0]
    const labels = ["Parent Type Icon", "Ticket", "Summary", "Resolution", "Resolved", ">SP<", ">Actual SP<"]
    const positions = labels.map((label) => head.indexOf(label))
    assert.ok(positions.every((index, i) => index >= 0 && (i === 0 || index > positions[i - 1])))
    assert.match(markup, /id="fixture-details" aria-labelledby="fixture-details-title"/)
    assert.match(markup, /hidden max-w-full overflow-x-auto md:block/)
    assert.match(markup, /md:hidden/)
    assert.match(markup, /Parent Issue type：Story/)
    assert.match(markup, />11\/03<\/td>/)
    assert.match(markup, />11\/03<\/dd>/)
    assert.doesNotMatch(markup, />2026-11-03<\/td>/)
    assert.match(markup, />0<\/td>/)
    assert.match(markup, /未填/)
    assert.equal((head.match(/<th\b/g) ?? []).length, 7)
    assert.doesNotMatch(markup, />Status<|In Progress/)
    assert.match(markup, /Fixed/)
    assert.match(markup, /關閉明細/)
  })
  it("shows one compact title with both sums from the listed tasks, ignoring missing fields", () => {
    const markup = render({ memberName: "Derek Shih", tasks: [
      { ...task, key: "A", points: 23, actualPoints: 5.1 },
      { ...task, key: "B", points: 0.1, actualPoints: null },
      { ...task, key: "C", points: 0.1, actualPoints: 0.2 },
      { ...task, key: "D", points: null, actualPoints: 0 },
      { ...task, key: "E", points: null, actualPoints: null },
      { ...task, key: "F", points: 0, actualPoints: null },
      { ...task, key: "G", points: 0, actualPoints: 0 },
      { ...task, key: "H", points: null, actualPoints: null },
    ] })
    const title = markup.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)[1]
    assert.equal(title, "Derek Shih・8 張・SP 合計：23.2 點 | Actual SP 合計：5.3 點")
    assert.doesNotMatch(title, /單據明細|2026-|Story Points/)
    assert.doesNotMatch(markup, /<p role="status"/)
    assert.match(markup, /<caption class="sr-only">Alice|<caption class="sr-only">Derek Shih/)
    assert.match(markup, /2026-11-02 ～ 2026-11-03/)
    assert.doesNotMatch(markup, /23\.200000|5\.300000/)
  })
  it("uses safe existing TicketLink encoding and text escaping", () => {
    const markup = render({ tasks: [{ ...task, key: "TEST/a?b", summary: "<script>bad</script>", status: "<b>Done</b>", resolution: "<i>Fixed</i>" }] })
    assert.match(markup, /href="https:\/\/fixture.invalid\/browse\/TEST%2Fa%3Fb"/)
    assert.match(markup, /target="_blank" rel="noopener noreferrer"/)
    assert.match(markup, /&lt;script&gt;bad&lt;\/script&gt;/)
    assert.doesNotMatch(markup, /Done|&lt;b&gt;/)
    assert.match(markup, /&lt;i&gt;Fixed&lt;\/i&gt;/)
    assert.doesNotMatch(markup, /<script>|<b>|<i>/)
    assert.doesNotMatch(render({ jiraBaseUrl: null }), /href=/)
  })
  it("handles absent metadata/Resolved without inventing values and preserves Actual zero", () => {
    for (const status of ["none", "unknown"]) {
      const markup = render({ tasks: [{ ...task, points: null, actualPoints: 0, summary: null, status: null, resolution: null, resolvedDate: null, parentIssueType: { status } }] })
      assert.match(markup, status === "none" ? /沒有 Parent Issue/ : /Parent Issue type 未知/)
      assert.match(markup, /Alice・1 張・SP 合計：0 點 \| Actual SP 合計：0 點/)
      assert.match(markup, />—<\/td>/)
      assert.match(markup, />0<\/td>/)
      assert.match(markup, /未填/)
    }
  })
})

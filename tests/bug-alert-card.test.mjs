import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

const require = createRequire(import.meta.url)
function component(name, exported) {
  const file = new URL(`../app/(app)/dashboard/${name}.tsx`, import.meta.url)
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file.pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  })
  const compiled = { exports: {} }
  new Function("require", "module", "exports", outputText)(require, compiled, compiled.exports)
  return (props = {}) => renderToStaticMarkup(createElement(compiled.exports[exported], props))
}
const bug = component("bug-alert-card", "BugAlertCard")
const pending = component("pending-issue-card", "PendingIssueCard")

describe("dashboard alert cards", () => {
  it("shows loading without invented counts, green borders or interactive details", () => {
    for (const render of [bug, pending]) {
      const markup = render({ loading: true })
      assert.match(markup, /aria-busy="true"/)
      assert.match(markup, /載入中/)
      assert.match(markup, /border-slate-200/)
      assert.doesNotMatch(markup, /張 Issue|border-green|查看明細|<button\b|<a\b/)
    }
  })
  it("renders Bug counts, red title, yellow icon and red or green borders", () => {
    const zero = bug({ s0s1Count: 0, s2Count: 0 })
    assert.match(zero, /border-green-500/)
    assert.equal((zero.match(/0 張 Issue/g) ?? []).length, 2)
    assert.match(zero, /text-red-600/)
    assert.match(zero, /<svg aria-hidden="true" class="[^"]*text-yellow-500/)
    for (const [s0s1Count, s2Count] of [[1, 0], [0, 2], [2, 3]]) {
      assert.match(bug({ s0s1Count, s2Count }), /border-red-500/)
    }
  })
  it("renders only pending totals with green at zero and blue borders when counted", () => {
    const zero = pending({ inReviewCount: 0, requestInfoCount: 0 })
    assert.match(zero, /border-green-500/)
    assert.doesNotMatch(zero, /border-blue|border-yellow|超過3天未更新/)
    const counts = pending({ inReviewCount: 2, requestInfoCount: 3 })
    assert.match(counts, /border-blue-500/)
    assert.match(counts, /2 張 Issue/)
    assert.match(counts, /3 張 Issue/)
    assert.doesNotMatch(counts, /border-green|border-yellow|超過3天未更新/)
  })
  it("renders failed-query feedback with neutral borders instead of old counts", () => {
    for (const [render, counts] of [[bug, { s0s1Count: 0, s2Count: 0 }], [pending, { inReviewCount: 0, requestInfoCount: 0 }]]) {
      const markup = render({ ...counts, feedback: createElement("p", { role: "alert" }, "Fixture query error") })
      assert.match(markup, /Fixture query error/)
      assert.match(markup, /border-slate-200/)
      assert.doesNotMatch(markup, /張 Issue|border-green/)
    }
  })
  it("keeps 2px outlines, light/dark surfaces and single-column grid placement", () => {
    for (const render of [bug, pending]) {
      const markup = render()
      assert.match(markup, /border-2/)
      assert.match(markup, /bg-white/)
      assert.match(markup, /dark:bg-slate-900/)
      assert.doesNotMatch(markup, /col-span-/)
    }
  })
})

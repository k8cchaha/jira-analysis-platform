import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

const require = createRequire(import.meta.url)
const file = new URL("../app/(app)/dashboard/bug-alert-card.tsx", import.meta.url)
const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
  fileName: file.pathname,
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
})
const compiled = { exports: {} }
new Function("require", "module", "exports", outputText)(require, compiled, compiled.exports)
const markup = renderToStaticMarkup(createElement(compiled.exports.BugAlertCard))

describe("unconfigured Bug alert card", () => {
  it("renders one card with both priority checks and pending states", () => {
    assert.equal((markup.match(/<article\b/g) ?? []).length, 1)
    assert.match(markup, /Bug 警示/)
    assert.match(markup, /S0／S1/)
    assert.match(markup, /S2 超過10天未更新/)
    assert.equal((markup.match(/待設定查詢/g) ?? []).length, 2)
  })
  it("does not imply fetched counts, completed data, or interactive details", () => {
    assert.doesNotMatch(markup, /張 Issue|資料完整|查看明細|<button\b|<a\b|aria-busy|role="(?:alert|status)"|animate-pulse/)
    assert.match(markup, /<svg aria-hidden="true"/)
  })
  it("uses a single grid column and matching light and dark card surfaces", () => {
    assert.doesNotMatch(markup, /col-span-/)
    assert.match(markup, /bg-white/)
    assert.match(markup, /dark:bg-slate-900/)
  })
})

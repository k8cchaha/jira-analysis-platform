import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
import * as jiraUrl from "../lib/jira-url.ts"

const require = createRequire(import.meta.url)
function loadComponent(path) {
  assert.ok(["components/ticket-link.tsx", "app/(app)/dashboard/jira-open-link.tsx"].includes(path))
  const mod = { exports: {} }
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  const fixtureRequire = (name) => {
    if (name === "react/jsx-runtime") return require(name)
    if (name === "@/lib/jira-url") return jiraUrl
    throw new Error(`Unexpected Jira-link dependency: ${name}`)
  }
  new Function("require", "module", "exports", outputText)(fixtureRequire, mod, mod.exports)
  return mod.exports
}
const { TicketLink } = loadComponent("components/ticket-link.tsx")
const dashboardLinks = loadComponent("app/(app)/dashboard/jira-open-link.tsx")

// Pure href assembly preserves the existing contract; callers validate the Jira origin.
describe("shared Jira navigation URLs", () => {
  it("encodes the complete search query once, retaining the Jira search path", () => {
    const jql = 'id in (1, 2) AND summary ~ "A&B + 50% / 中文? #" ORDER BY key ASC'
    const href = jiraUrl.jiraSearchHref("https://fixture.invalid/jira", jql)
    assert.equal(href, `https://fixture.invalid/jira/issues/?jql=${encodeURIComponent(jql)}`)
    const url = new URL(href)
    assert.equal(url.searchParams.get("jql"), jql)
    assert.deepEqual([...url.searchParams.keys()], ["jql"])
    assert.equal(url.hash, "")
    assert.equal(jiraUrl.jiraSearchHref("https://fixture.invalid", ""), "https://fixture.invalid/issues/?jql=")
  })
  it("encodes issue keys as a single browse path segment, including reserved characters", () => {
    assert.equal(jiraUrl.jiraIssueHref("https://fixture.invalid", "SUN-1"), "https://fixture.invalid/browse/SUN-1")
    const key = "SUN/a?b#c + 中文%2F"
    const href = jiraUrl.jiraIssueHref("https://fixture.invalid/jira", key)
    assert.equal(href, `https://fixture.invalid/jira/browse/${encodeURIComponent(key)}`)
    const url = new URL(href)
    assert.equal(decodeURIComponent(url.pathname.split("/").at(-1)), key)
    assert.equal(url.search, "")
    assert.equal(url.hash, "")
  })
  it("removes exactly one trailing slash for both helpers without stripping the context path", () => {
    for (const [base, normalized] of [
      ["https://fixture.invalid", "https://fixture.invalid"],
      ["https://fixture.invalid/", "https://fixture.invalid"],
      ["https://fixture.invalid/jira/", "https://fixture.invalid/jira"],
      ["https://fixture.invalid/jira//", "https://fixture.invalid/jira/"],
    ]) {
      assert.equal(jiraUrl.jiraSearchHref(base, "id = 1"), `${normalized}/issues/?jql=id%20%3D%201`)
      assert.equal(jiraUrl.jiraIssueHref(base, "SUN-1"), `${normalized}/browse/SUN-1`)
    }
  })
  it("keeps Dashboard's compatibility export identical and retains its link visibility/attributes", () => {
    assert.equal(dashboardLinks.jiraSearchHref, jiraUrl.jiraSearchHref)
    const markup = renderToStaticMarkup(createElement(dashboardLinks.JiraOpenLink, {
      jiraBaseUrl: "https://fixture.invalid/jira/", jql: "id in (1, 2) ORDER BY key ASC", label: "Fixture",
    }))
    assert.match(markup, /href="https:\/\/fixture.invalid\/jira\/issues\/\?jql=id%20in%20\(1%2C%202\)%20ORDER%20BY%20key%20ASC"/)
    assert.match(markup, /target="_blank" rel="noopener noreferrer"/)
    assert.match(markup, /opacity-0/)
    assert.match(markup, /group-hover:opacity-100/)
    assert.equal(dashboardLinks.JiraOpenLink({ jiraBaseUrl: null, jql: "id = 1", label: "Fixture" }), null)
    assert.equal(dashboardLinks.JiraOpenLink({ jiraBaseUrl: "https://fixture.invalid", jql: "", label: "Fixture" }), null)
  })
  it("preserves TicketLink text, QA/default styles, accessibility and no-URL fallback", () => {
    const render = (issueType, jiraBaseUrl = "https://fixture.invalid/jira/") => renderToStaticMarkup(createElement(TicketLink, {
      task: { key: "SUN/a?b", issueType }, jiraBaseUrl,
    }))
    const qa = render("QA-Task")
    assert.match(qa, /href="https:\/\/fixture.invalid\/jira\/browse\/SUN%2Fa%3Fb"/)
    assert.match(qa, /target="_blank" rel="noopener noreferrer"/)
    assert.match(qa, /aria-label="在 Jira 開啟 SUN\/a\?b（另開分頁）"/)
    assert.match(qa, /text-\[#FF6670\]/)
    assert.match(qa, />SUN\/a\?b<\/a>/)
    assert.match(render("Dev-Task"), /text-blue-600/)
    assert.match(render(null), /text-blue-600/)
    assert.equal(render("QA-Task", null), '<span class="break-words font-medium">SUN/a?b</span>')
  })
})

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { computeAssignmentStatus, OTHER_TEAM } from "../lib/assignment-status.ts"

const require = createRequire(import.meta.url)
const path = "app/(app)/sprint/planning/assignment-status.tsx"
const code = require("typescript").transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
  fileName: path,
  compilerOptions: { module: 1, target: 9, jsx: 4 },
}).outputText
const stubs = {
  react: require("react"),
  "react/jsx-runtime": require("react/jsx-runtime"),
  "@/lib/assignment-status": { computeAssignmentStatus, OTHER_TEAM },
  "@/lib/status-color": { statusColorClass: () => "" },
  "@/app/(app)/dashboard/parent-issue-type-icon": { ParentIssueTypeIcon: () => null },
  "@/components/ticket-link": { TicketLink: () => null },
}
const mod = { exports: {} }
vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {}, { filename: path })((name) => {
  assert.ok(Object.hasOwn(stubs, name), `Unexpected import: ${name}`)
  return stubs[name]
}, mod, mod.exports)

function render(points, project = "SUN", accountId = "fixture-user") {
  return renderToStaticMarkup(createElement(mod.exports.AssignmentStatus, {
    project,
    tasks: [{ key: "SUN-1", points, assigneeAccountId: accountId, assigneeDisplayName: "Fixture member" }],
    teamOf: { "fixture-user": "Web" },
    teamOrder: ["Web"],
    jiraBaseUrl: null,
  }))
}

function badge(markup) {
  const match = markup.match(/<span class="([^"]+)" title="[^"]* 總分派比例">總分派比例 ([^<]+)<\/span>/)
  assert.ok(match, "team ratio badge must remain visible with its numeric label")
  return { className: match[1], text: match[2] }
}

describe("Planning total assignment ratio colors", () => {
  const cases = [
    [0, "blue-600", "blue-400"], [49.9, "blue-600", "blue-400"],
    [69, "blue-600", "blue-400"], [69.9, "blue-600", "blue-400"],
    [70, "green-700", "green-400"], [90, "green-700", "green-400"],
    [90.1, "amber-700", "amber-400"], [91, "amber-700", "amber-400"],
    [100, "amber-700", "amber-400"], [100.1, "red-700", "red-400"],
    [110, "red-700", "red-400"], [150, "red-700", "red-400"],
  ]
  for (const project of ["SUN", "TKK", "PRIDE"]) {
    for (const [value, light, dark] of cases) it(`${project}: ${value}% uses ${light} / ${dark}`, () => {
      const capacity = project === "TKK" ? 40 : 20
      const markup = render(value * capacity / 100, project)
      const result = badge(markup)
      assert.equal(result.text, `${value}%`)
      assert.ok(result.className.split(" ").includes(`text-${light}`))
      assert.ok(result.className.split(" ").includes(`dark:text-${dark}`))
      assert.doesNotMatch(result.className, /emerald|purple/)
      assert.match(markup, /text-slate-700 dark:text-slate-200">[\d.]+%<\/td>/, "member ratio stays neutral")
      assert.ok(markup.includes(`style="width:${Math.min(100, value)}%"`), "progress geometry and original blue fill are unchanged")
      assert.match(markup, /bg-blue-500 dark:bg-blue-400/)
    })
  }
  it("keeps an undefined ratio neutral when no member capacity exists", () => {
    const markup = render(5, "SUN", null)
    const result = badge(markup)
    assert.equal(result.text, "—")
    assert.match(result.className, /text-slate-600 dark:text-slate-300/)
    assert.doesNotMatch(markup, /style="width:/)
  })
})

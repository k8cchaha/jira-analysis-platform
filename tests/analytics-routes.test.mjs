import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { describe, it } from "node:test"
import { createRequire } from "node:module"
import { format } from "node:url"
import { getRedirectUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server.js"
import ts from "typescript"

const filename = new URL("../next.config.ts", import.meta.url)
const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
  fileName: filename.pathname,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const loadedConfig = { exports: {} }
new Function("require", "module", "exports", outputText)(
  (name) => { throw new Error(`Unexpected config dependency: ${name}`) }, loadedConfig, loadedConfig.exports,
)
const nextConfig = loadedConfig.exports.default
const aliases = {
  workload: ["summary", "breakdown", "detail"],
  projects: ["summary"],
  "story-points": ["summary", "distribution", "detail"],
  members: ["summary", "comparison", "detail"],
  trends: ["summary", "comparison", "detail"],
  comparison: ["summary"],
}
const canonicalFeatures = ["workload", "projects", "story-points", "members"]
const mergedFeatures = ["trends", "comparison"]
const featureDestination = (feature) => `/analytics/${mergedFeatures.includes(feature) ? "projects" : feature}`
const mergedSources = mergedFeatures.flatMap((feature) => [
  `/analytics/${feature}`, ...aliases[feature].map((view) => `/analytics/${feature}/${view}`),
])
const origin = "https://fixture.invalid"
const responseFor = (path) => unstable_getResponseFromNextConfig({ url: `${origin}${path}`, nextConfig })

// Next 16.3.2 的 experimental config helper 以 URLSearchParams(record) 將 array
// 轉成逗號字串；正式 router 用 stringifyQuery + node:url.format，保留重複值。
// 此案例直接呼叫已安裝的 production resolver，不重寫 matcher，也不啟動伺服器。
const require = createRequire(import.meta.url)
const { getResolveRoutes } = require("next/dist/server/lib/router-utils/resolve-routes")
const { buildCustomRoute } = require("next/dist/server/lib/router-utils/filesystem")
const { defaultConfig } = require("next/dist/server/config-shared")
async function runtimeRedirect(path) {
  const fail = () => { throw new Error("Legacy redirects must finish before filesystem or middleware work") }
  const fsChecker = {
    buildId: "fixture-build",
    headers: [],
    redirects: (await nextConfig.redirects()).map((rule) => buildCustomRoute("redirect", rule, "", false)),
    rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
    getMiddlewareMatchers: () => undefined,
    getItem: fail,
  }
  const resolve = getResolveRoutes(fsChecker, defaultConfig, { dir: process.cwd(), dev: false, minimalMode: false }, {}, {}, fail)
  const result = await resolve({
    req: { url: path, headers: { host: "fixture.invalid" }, socket: {} },
    res: {}, isUpgradeReq: true, invokedOutputs: new Set(),
  })
  assert.equal(result.finished, true)
  assert.equal(result.statusCode, 307)
  return new URL(format(result.parsedUrl), origin)
}

function assertQueryPreserved(destination, query) {
  const expected = new URLSearchParams(query)
  assert.deepEqual([...new Set(destination.searchParams.keys())].sort(), [...new Set(expected.keys())].sort())
  for (const key of new Set(expected.keys())) assert.deepEqual(destination.searchParams.getAll(key), expected.getAll(key))
}

describe("consolidated analysis page routes and legacy compatibility", () => {
  it("defines exactly 16 literal redirects with single-hop destinations and no wildcard", async () => {
    const rules = await nextConfig.redirects()
    assert.equal(rules.length, 16)
    const expected = [
      ...Object.entries(aliases).flatMap(([feature, views]) => views.map((view) => ({
        source: `/analytics/${feature}/${view}`, destination: featureDestination(feature), permanent: false,
      }))),
      ...mergedFeatures.map((feature) => ({ source: `/analytics/${feature}`, destination: "/analytics/projects", permanent: false })),
    ]
    assert.deepEqual(rules, expected)
    assert.equal(new Set(rules.map((rule) => rule.source)).size, rules.length)
    for (const rule of rules) assert.equal(rules.some((next) => next.source === rule.destination), false)
  })

  for (const feature of canonicalFeatures) {
    it(`${feature} has one physical page and no view directories`, () => {
      const folder = new URL(`../app/(app)/analytics/${feature}/`, import.meta.url)
      assert.ok(existsSync(new URL("page.tsx", folder)))
      assert.equal(readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length, 0)
    })
  }
  for (const feature of mergedFeatures) {
    it(`${feature} no longer has a separate physical page`, () => {
      assert.equal(existsSync(new URL(`../app/(app)/analytics/${feature}/page.tsx`, import.meta.url)), false)
    })
    it(`redirects the former ${feature} root directly to projects with 307`, async () => {
      const response = await responseFor(`/analytics/${feature}`)
      assert.equal(response.status, 307)
      assert.equal(getRedirectUrl(response), `${origin}/analytics/projects`)
    })
  }
  for (const [feature, views] of Object.entries(aliases)) {
    for (const view of views) {
      it(`redirects /analytics/${feature}/${view} directly to its canonical entry with 307`, async () => {
        const response = await responseFor(`/analytics/${feature}/${view}`)
        assert.equal(response.status, 307)
        assert.equal(getRedirectUrl(response), `${origin}${featureDestination(feature)}`)
      })
    }
  }

  it("preserves repeated workload groups/projects/exclusions and dates without normalizing invalid input", async () => {
    const query = "group=ent-web&group=ent-be1&project=sun&project=tkk&exclude=ent-web%7Ca&exclude=ent-be1%7Cb&from=2026-10-04&to=2026-11-03"
    for (const view of aliases.workload) {
      const destination = await runtimeRedirect(`/analytics/workload/${view}?${query}`)
      assert.equal(destination.pathname, "/analytics/workload")
      assertQueryPreserved(destination, query)
    }
    const invalid = "group=ent-web&from=2026-10-01&from=2026-10-02&to=2026-10-31&unknown=1"
    assertQueryPreserved(await runtimeRedirect(`/analytics/workload/summary?${invalid}`), invalid)
  })

  for (const query of [
    "project=SUN&sprint=7518&sprint=6823&sprint=7518",
    "project=SUN&mode=dates&from=2026-10-01&to=2026-10-31",
    "project=SUN&project=TKK&sprint=7401&unknown=1&unknown=2",
    "project=SUN&mode=dates&from=2026-10-01&from=2026-10-02&to=2026-10-31&sprint=7518",
    "project=SUN&mode=invalid&from=not-a-date&to=&group=ent-web",
  ]) {
    it(`passes through consolidated legacy queries unchanged: ${query}`, async () => {
      for (const source of [...mergedSources, "/analytics/projects/summary"]) {
        const destination = await runtimeRedirect(`${source}?${query}`)
        assert.equal(destination.pathname, "/analytics/projects")
        assertQueryPreserved(destination, query)
        assert.equal(getRedirectUrl(await responseFor(`${destination.pathname}${destination.search}`)), null, "no second redirect")
      }
    })
  }

  for (const path of [
    ...canonicalFeatures.map((feature) => `/analytics/${feature}`),
    "/analytics/workload/unknown", "/analytics/members/comparison/extra", "/analytics/unknown/summary",
    "/analytics/projects/unknown", "/analytics/trends/unknown", "/analytics/trends/detail/extra",
    "/analytics/comparison/detail", "/analytics/comparison/summary/extra",
    "/api/analytics/workload/heatmap/stream", "/api/analytics/trends", "/api/analytics/comparison",
    "/sprint/planning", "/reports/saved/list",
  ]) {
    it(`does not redirect ${path}`, async () => {
      const response = await responseFor(path)
      assert.equal(getRedirectUrl(response), null)
    })
  }
})

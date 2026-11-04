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

describe("flat analysis page routes and legacy compatibility", () => {
  it("defines exactly 14 literal legacy redirects, never feature-root or wildcard redirects", async () => {
    const rules = await nextConfig.redirects()
    assert.equal(rules.length, 14)
    const expected = Object.entries(aliases).flatMap(([feature, views]) => views.map((view) => ({
      source: `/analytics/${feature}/${view}`, destination: `/analytics/${feature}`, permanent: false,
    })))
    assert.deepEqual(rules, expected)
  })

  for (const [feature, views] of Object.entries(aliases)) {
    it(`${feature} has one physical page and no view directories`, () => {
      const folder = new URL(`../app/(app)/analytics/${feature}/`, import.meta.url)
      assert.ok(existsSync(new URL("page.tsx", folder)))
      assert.equal(readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length, 0)
    })
    for (const view of views) {
      it(`redirects /analytics/${feature}/${view} directly to its flat entry with 307`, async () => {
        const response = await responseFor(`/analytics/${feature}/${view}`)
        assert.equal(response.status, 307)
        assert.equal(getRedirectUrl(response), `${origin}/analytics/${feature}`)
      })
    }
  }

  it("preserves repeated group/project/exclude values and dates without normalizing away invalid input", async () => {
    const query = "group=ent-web&group=ent-be1&project=sun&project=tkk&exclude=ent-web%7Ca&exclude=ent-be1%7Cb&from=2026-10-04&to=2026-11-03"
    const expected = new URLSearchParams(query)
    for (const view of aliases.workload) {
      const destination = await runtimeRedirect(`/analytics/workload/${view}?${query}`)
      assert.equal(destination.pathname, "/analytics/workload")
      for (const key of new Set(expected.keys())) assert.deepEqual(destination.searchParams.getAll(key), expected.getAll(key))
    }
    const destination = await runtimeRedirect("/analytics/workload/summary?group=ent-web&from=2026-10-01&from=2026-10-02&to=2026-10-31&unknown=1")
    const params = destination.searchParams
    assert.deepEqual(params.getAll("from"), ["2026-10-01", "2026-10-02"])
    assert.equal(params.get("unknown"), "1", "The target parser must still reject invalid query input")
  })

  for (const path of [
    ...Object.keys(aliases).map((feature) => `/analytics/${feature}`),
    "/analytics/workload/unknown", "/analytics/members/comparison/extra", "/analytics/unknown/summary",
    "/api/analytics/workload/heatmap/stream", "/sprint/planning", "/reports/saved/list",
  ]) {
    it(`does not redirect ${path}`, async () => {
      const response = await responseFor(path)
      assert.equal(getRedirectUrl(response), null)
    })
  }
})

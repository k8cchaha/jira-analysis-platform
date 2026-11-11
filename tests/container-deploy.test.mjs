import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import ts from "typescript"

/** 以 CommonJS 轉譯並執行無依賴的 TS 模組；任何 import 都視為違反契約。 */
function loadDependencyFree(relativePath) {
  const filename = new URL(`../${relativePath}`, import.meta.url)
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename.pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const loaded = { exports: {} }
  new Function("require", "module", "exports", outputText)(
    (name) => { throw new Error(`Unexpected dependency in ${relativePath}: ${name}`) }, loaded, loaded.exports,
  )
  return loaded.exports
}

describe("container deployment contract", () => {
  it("builds standalone output so the image runs server.js without node_modules", () => {
    const nextConfig = loadDependencyFree("next.config.ts").default
    assert.equal(nextConfig.output, "standalone")
  })

  it("serves an unauthenticated, uncached 200 health check without touching auth or Jira", async () => {
    const { GET, dynamic } = loadDependencyFree("app/api/healthz/route.ts")
    assert.equal(dynamic, "force-dynamic")

    const response = await GET()

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(await response.json(), { status: "ok" })
  })

  it("keeps the health check outside the login-redirect proxy matcher", () => {
    const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8")
    const matcher = source.slice(source.indexOf("matcher"))
    assert.doesNotMatch(matcher, /"\/api/)
  })
})

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import { describe, it } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const compiled = ts.transpileModule(readFileSync(new URL("../lib/jira-token.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const plain = (value) => JSON.parse(JSON.stringify(value))
const session = (extra = {}) => ({
  user: { id: "verified-viewer", name: "not an identity" },
  jiraCloudId: "verified-site", jiraAccessToken: "fixture-not-real", jiraExpiresAt: 200,
  ...extra,
})
function harness(value = session()) {
  let current = value
  const calls = []
  const loadedModule = { exports: {} }
  const context = vm.createContext({ Date: class extends Date { static now() { return 100_000 } }, Error })
  vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context)((id) => {
    if (id === "server-only") return {}
    if (id === "@/auth") return {
      getInternalAuthSession: async () => { calls.push("internal"); return current },
      refreshAuthSession: async () => { calls.push("refresh"); return current },
    }
    throw new Error(`Unexpected import ${id}`)
  }, loadedModule, loadedModule.exports)
  return { ...loadedModule.exports, calls, setSession: (value) => { current = value } }
}

describe("server Jira credential identity", () => {
  it("projects viewer/token/site from the same validated internal session", async () => {
    const h = harness()
    assert.deepEqual(plain(await h.getJiraToken()), {
      viewerId: "verified-viewer", cloudId: "verified-site", accessToken: "fixture-not-real", expiresAt: 200,
    })
    assert.deepEqual(h.calls, ["internal"])
    h.setSession(session({ user: { id: "new-viewer" }, jiraCloudId: "new-site" }))
    assert.equal((await h.getJiraToken(true)).viewerId, "new-viewer")
    assert.deepEqual(h.calls, ["internal", "refresh"])
  })

  it("rejects missing viewer, credential failure and expiry instead of producing a cache identity", async () => {
    for (const [value, code] of [
      [null, "not_connected"],
      [session({ user: {} }), "not_connected"],
      [session({ jiraAuthorizationError: "refresh_failed" }), "refresh_failed"],
      [session({ jiraAccessToken: null }), "reauthorization_required"],
      [session({ jiraCloudId: null }), "reauthorization_required"],
      [session({ jiraExpiresAt: 100 }), "reauthorization_required"],
      [session({ jiraExpiresAt: NaN }), "reauthorization_required"],
    ]) {
      const h = harness(value)
      await assert.rejects(h.getJiraToken(), (error) => error.code === code)
    }
  })
})

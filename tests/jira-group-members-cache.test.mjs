import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import { describe, it } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const source = ts.transpileModule(readFileSync(new URL("../lib/jira-group-members-cache.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const plain = (value) => JSON.parse(JSON.stringify(value))
const members = (id = "member-1") => [{ accountId: id, displayName: `Name ${id}`, ignored: "not retained" }]
const credentials = (extra = {}) => ({ viewerId: "viewer-1", cloudId: "cloud-1", accessToken: "fixture-not-real", expiresAt: 9_999_999_999, ...extra })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness() {
  class JiraAuthorizationError extends Error {
    constructor(message, code) { super(message); this.code = code }
  }
  const context = vm.createContext({ Error, Date })
  const load = () => {
    const loadedModule = { exports: {} }
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context)((id) => {
      if (id === "server-only") return {}
      if (id === "@/lib/jira-token") return { JiraAuthorizationError }
      throw new Error(`Unexpected import: ${id}`)
    }, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  return { ...load(), load }
}

describe("server-verified group member cache", () => {
  it("shares the instance across separate bundle evaluations in one server realm", () => {
    const h = harness()
    assert.equal(h.getSharedJiraGroupMembersCache(), h.load().getSharedJiraGroupMembersCache())
    assert.notEqual(h.getSharedJiraGroupMembersCache(), harness().getSharedJiraGroupMembersCache())
  })

  it("expires exactly at 30 minutes and cache hits never extend the lifetime", async () => {
    const h = harness()
    let now = 1000, calls = 0
    const cache = h.createJiraGroupMembersCache({ now: () => now })
    const load = async () => { calls++; return members(`member-${calls}`) }
    assert.equal((await cache.get(credentials(), "ent-web", load))[0].accountId, "member-1")
    now += h.GROUP_MEMBERS_TTL_MS - 1
    await cache.get(credentials(), "ent-web", load)
    assert.equal(calls, 1)
    now++
    assert.equal((await cache.get(credentials(), "ent-web", load))[0].accountId, "member-2")
    assert.equal(calls, 2)
  })

  it("starts TTL at complete load success, not request start", async () => {
    const h = harness()
    let now = 0, calls = 0
    const d = deferred()
    const cache = h.createJiraGroupMembersCache({ now: () => now, ttlMs: 100 })
    const first = cache.get(credentials(), "ent-web", () => { calls++; return d.promise })
    await Promise.resolve()
    now = 200
    d.resolve(members())
    await first
    now = 299
    await cache.get(credentials(), "ent-web", async () => { calls++; return members() })
    assert.equal(calls, 1)
    now = 300
    await cache.get(credentials(), "ent-web", async () => { calls++; return members() })
    assert.equal(calls, 2)
  })

  it("deduplicates in-flight loaders and isolates every returned DTO", async () => {
    const h = harness(), d = deferred()
    let calls = 0
    const cache = h.createJiraGroupMembersCache()
    const load = () => { calls++; return d.promise }
    const first = cache.get(credentials(), "ent-web", load)
    const second = cache.get(credentials(), "ent-web", load)
    await Promise.resolve()
    assert.equal(calls, 1)
    const original = members()
    d.resolve(original)
    const [a, b] = await Promise.all([first, second])
    a[0].displayName = "changed"
    a.push({ accountId: "rogue", displayName: "rogue" })
    original[0].accountId = "changed externally"
    assert.deepEqual(plain(b), [{ accountId: "member-1", displayName: "Name member-1" }])
    assert.deepEqual(plain(await cache.get(credentials(), "ent-web", load)), plain(b))
    b[0].accountId = "changed again"
    assert.equal((await cache.get(credentials(), "ent-web", load))[0].accountId, "member-1")
  })

  it("isolates viewers/sites/groups with unambiguous keys, but reuses after token rotation", async () => {
    const cache = harness().createJiraGroupMembersCache()
    let calls = 0
    const load = async () => { calls++; return members() }
    for (const [creds, group] of [
      [credentials(), "ent-web"],
      [credentials({ viewerId: "viewer-2" }), "ent-web"],
      [credentials({ cloudId: "cloud-2" }), "ent-web"],
      [credentials(), "ent-be1"],
      [credentials({ viewerId: "a/b", cloudId: "c" }), "ent-web"],
      [credentials({ viewerId: "a", cloudId: "b/c" }), "ent-web"],
    ]) await cache.get(creds, group, load)
    assert.equal(calls, 6)
    await cache.get(credentials({ accessToken: "rotated-fixture-token", expiresAt: 9_999_999_998 }), "ent-web", load)
    assert.equal(calls, 6)
  })

  it("rejects unusable current credentials before a warm cache hit", async () => {
    const cache = harness().createJiraGroupMembersCache({ now: () => 20_000 })
    let calls = 0
    const load = async () => { calls++; return members() }
    await cache.get(credentials(), "ent-web", load)
    for (const change of [
      { viewerId: undefined }, { viewerId: "" }, { cloudId: "" }, { accessToken: "" },
      { expiresAt: 20 }, { expiresAt: 19 }, { expiresAt: NaN }, { expiresAt: undefined },
    ]) await assert.rejects(cache.get(credentials(change), "ent-web", load), (error) => error.code === "reauthorization_required")
    assert.equal(calls, 1)
  })

  it("cleans up shared failures and synchronous throws so retry loads again", async () => {
    const cache = harness().createJiraGroupMembersCache(), d = deferred()
    const first = cache.get(credentials(), "ent-web", () => d.promise)
    const second = cache.get(credentials(), "ent-web", () => { throw new Error("must not load twice") })
    const rejected = Promise.all([assert.rejects(first, /failed/), assert.rejects(second, /failed/)])
    d.reject(new Error("failed"))
    await rejected
    await assert.rejects(cache.get(credentials(), "ent-web", () => { throw new Error("sync failure") }), /sync failure/)
    assert.equal((await cache.get(credentials(), "ent-web", async () => members()))[0].accountId, "member-1")
  })

  it("never serves expired data after a failed refresh, and caches verified empty lists", async () => {
    let now = 0, calls = 0
    const cache = harness().createJiraGroupMembersCache({ now: () => now, ttlMs: 100 })
    await cache.get(credentials(), "ent-web", async () => members())
    now = 100
    await assert.rejects(cache.get(credentials(), "ent-web", async () => { calls++; throw new Error("refresh failed") }), /refresh failed/)
    assert.deepEqual(plain(await cache.get(credentials(), "ent-web", async () => { calls++; return [] })), [])
    await cache.get(credentials(), "ent-web", async () => { calls++; return members() })
    assert.equal(calls, 2)
  })

  it("evicts least-recently-used completed entries without extending TTL", async () => {
    const cache = harness().createJiraGroupMembersCache({ maxEntries: 2 })
    const calls = []
    const get = (group) => cache.get(credentials(), group, async () => { calls.push(group); return members() })
    await get("a"); await get("b"); await get("a"); await get("c"); await get("a"); await get("b")
    assert.deepEqual(calls, ["a", "b", "c", "b"])
  })

  it("bounds actual in-flight loads, still joins same-key work at capacity, and releases failed slots", async () => {
    const cache = harness().createJiraGroupMembersCache({ maxEntries: 1, maxInflight: 1 }), d = deferred()
    let calls = 0
    const first = cache.get(credentials(), "a", () => { calls++; return d.promise })
    const second = cache.get(credentials(), "a", () => { calls++; return members() })
    const rejected = Promise.all([assert.rejects(first, /failure/), assert.rejects(second, /failure/)])
    await assert.rejects(cache.get(credentials(), "b", async () => { calls++; return members() }), (error) => error.code === "group_members_cache_capacity")
    d.reject(new Error("failure"))
    await rejected
    await cache.get(credentials(), "b", async () => { calls++; return members() })
    assert.equal(calls, 2)
  })

  it("pins active work while completed entries are evicted", async () => {
    const cache = harness().createJiraGroupMembersCache({ maxEntries: 1, maxInflight: 2 }), d = deferred()
    let activeCalls = 0
    const active = cache.get(credentials(), "active", () => { activeCalls++; return d.promise })
    await cache.get(credentials(), "a", async () => members("a"))
    await cache.get(credentials(), "b", async () => members("b"))
    const joined = cache.get(credentials(), "active", () => { activeCalls++; return members() })
    d.resolve(members("active"))
    assert.deepEqual(plain(await active), plain(await joined))
    assert.equal(activeCalls, 1)
  })

  it("rejects invalid factory bounds rather than allowing unbounded storage", () => {
    for (const option of [{ ttlMs: 0 }, { maxEntries: 0 }, { maxInflight: -1 }, { maxEntries: Infinity }]) {
      assert.throws(() => harness().createJiraGroupMembersCache(option), /positive integers/)
    }
  })
})

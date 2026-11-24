import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseMemberAnalysisFilter, parseMemberAnalysisParams, serializeMemberAnalysisFilter } from "../lib/member-analysis-filter.ts"

const params = "group=ent-web&from=2026-01-01&to=2026-11-03"

describe("member analysis filter", () => {
  it("round-trips groups, exclusions, projects and the range", () => {
    const parsed = parseMemberAnalysisFilter(new URLSearchParams(`${params}&group=ent-be1&exclude=ent-web%7Cacc-1&project=sun`))
    // Groups keep the dashboard's canonical (sorted) order, so the round trip is stable.
    assert.deepEqual(parsed, { groups: ["ent-be1", "ent-web"], exclusions: { "ent-web": ["acc-1"] }, projects: ["sun"], from: "2026-01-01", to: "2026-11-03" })
    assert.equal(serializeMemberAnalysisFilter(parsed), "group=ent-be1&group=ent-web&exclude=ent-web%7Cacc-1&project=sun&from=2026-01-01&to=2026-11-03")
  })
  it("returns null for an empty query and rejects unknown or malformed parameters", () => {
    assert.equal(parseMemberAnalysisFilter(new URLSearchParams()), null)
    assert.equal(parseMemberAnalysisParams(new URLSearchParams()), null)
    for (const invalid of [`group=ent-web`, `group=ent-web&from=2026-01-01`, `${params}&mode=dates`, `${params}&unknown=1`, `from=2026-01-01&to=2026-11-03`, `group=unknown&from=2026-01-01&to=2026-11-03`, `group=ent-web&from=2026-02-30&to=2026-11-03`]) {
      assert.throws(() => parseMemberAnalysisFilter(new URLSearchParams(invalid)), invalid)
    }
  })
  it("refuses to serialize an empty team scope", () => {
    assert.throws(() => serializeMemberAnalysisFilter({ groups: [], exclusions: {}, projects: [], from: "2026-01-01", to: "2026-11-03" }), /團隊/)
  })
})

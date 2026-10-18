import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { loadMissingDataList, MissingDataListError } from "../lib/jira-missing-data-list.ts"

function page(number, ids = [], nextPageToken = null, extras = {}) {
  return { status: "success", data: {
    readOnly: false, issues: ids.map((id) => ({ id: String(id), storyPointsRequired: true, actualStoryPointsRequired: true })), page: number,
    nextPageToken, previousPageToken: null, jiraBaseUrl: "https://fixture.invalid", warnings: [], ...extras,
  } }
}
function reader(pages, calls = []) {
  return async (token) => { calls.push(token); return pages[calls.length - 1] }
}
function signal() { return new AbortController().signal }

async function rejectsIncomplete(pages) {
  await assert.rejects(loadMissingDataList(reader(pages), signal()), (error) => error instanceof MissingDataListError && error.detail.code === "retry")
}

describe("complete dashboard dialog list", () => {
  it("collects more than 50 rows sequentially in server order", async () => {
    const calls = []
    const result = await loadMissingDataList(reader([
      page(1, Array.from({ length: 50 }, (_, i) => i + 1), "second"), page(2, [51, 52]),
    ], calls), signal())
    assert.deepEqual(calls, [null, "second"])
    assert.equal(result.issues.length, 52)
    assert.deepEqual(result.issues.slice(-2).map((issue) => issue.id), ["51", "52"])
    assert.equal("page" in result, false)
    assert.equal("nextPageToken" in result, false)
  })
  it("continues through empty hydrated batches and deduplicates warnings", async () => {
    const result = await loadMissingDataList(reader([
      page(1, [], "second", { warnings: ["A"] }), page(2, [1], null, { warnings: ["A", "B"] }),
    ]), signal())
    assert.deepEqual(result.warnings, ["A", "B"])
    assert.equal(result.issues.length, 1)
  })
  it("preserves status-dependent Points flags across complete batches", async () => {
    const progress = { id: "1", storyPointsRequired: true, actualStoryPointsRequired: false }
    const done = { id: "2", storyPointsRequired: true, actualStoryPointsRequired: true }
    const result = await loadMissingDataList(reader([
      page(1, [], "second", { issues: [progress] }), page(2, [], null, { issues: [done] }),
    ]), signal())
    assert.deepEqual(result.issues, [progress, done])
  })
  for (const field of ["storyPointsRequired", "actualStoryPointsRequired"]) {
    for (const value of [undefined, null, 0, "false"]) {
      it(`rejects invalid ${field} ${String(value)}`, async () => {
        const issue = { id: "1", storyPointsRequired: true, actualStoryPointsRequired: false, [field]: value }
        await rejectsIncomplete([page(1, [], null, { issues: [issue] })])
      })
    }
  }
  it("accepts an empty terminal list", async () => {
    assert.deepEqual((await loadMissingDataList(reader([page(1)]), signal())).issues, [])
  })
  it("preserves read-only state for both missing-data kinds", async () => {
    for (const kind of ["points", "defect-cause"]) {
      const result = await loadMissingDataList(reader([
        page(1, [1], "second", { readOnly: true, issues: [{ id: "1", kind, storyPointsRequired: kind === "points", actualStoryPointsRequired: kind === "points" }] }),
        page(2, [2], null, { readOnly: true, issues: [{ id: "2", kind, storyPointsRequired: kind === "points", actualStoryPointsRequired: kind === "points" }] }),
      ]), signal())
      assert.equal(result.readOnly, true)
      assert.deepEqual(result.issues.map((issue) => issue.kind), [kind, kind])
    }
  })
  it("does not resolve a partial list after a later API failure", async () => {
    const detail = { code: "invalid_page", message: "Expired fixture cursor" }
    await assert.rejects(loadMissingDataList(reader([page(1, [1], "second"), { status: "error", error: detail }]), signal()),
      (error) => error instanceof MissingDataListError && error.detail === detail)
  })
  it("propagates a transport failure and can restart from the first batch", async () => {
    const failure = new Error("offline")
    await assert.rejects(loadMissingDataList(async () => { throw failure }, signal()), (error) => error === failure)
    const calls = []
    await loadMissingDataList(reader([page(1, [1])], calls), signal())
    assert.deepEqual(calls, [null])
  })
  it("rejects duplicate issue IDs in one batch", async () => { await rejectsIncomplete([page(1, [1, 1])]) })
  it("rejects duplicate issue IDs across batches", async () => { await rejectsIncomplete([page(1, [1], "second"), page(2, [1])]) })
  it("rejects repeated continuation tokens", async () => { await rejectsIncomplete([page(1, [], "same"), page(2, [], "same")]) })
  it("rejects noncontiguous batch numbering", async () => { await rejectsIncomplete([page(1, [], "second"), page(3)]) })
  it("rejects a scope permission change", async () => { await rejectsIncomplete([page(1, [], "second"), page(2, [], null, { readOnly: true })]) })
  it("rejects a Jira site change", async () => { await rejectsIncomplete([page(1, [], "second"), page(2, [], null, { jiraBaseUrl: null })]) })
  for (const [name, value] of Object.entries({
    "missing envelope": null,
    "unknown status": { status: "other" },
    "missing data": { status: "success" },
    "bad issue collection": page(1, [], null, { issues: null }),
    "too many rows": page(1, Array.from({ length: 51 }, (_, i) => i + 1)),
    "invalid identity": page(1, ["fixture-not-numeric"]),
    "bad warnings": page(1, [], null, { warnings: [42] }),
    "empty continuation": page(1, [], ""),
    "oversized continuation": page(1, [], "x".repeat(250_001)),
    "missing continuation": page(1, [], undefined, { nextPageToken: undefined }),
  })) {
    it(`rejects ${name}`, async () => { await rejectsIncomplete([value]) })
  }
  it("accepts exactly 100 terminal batches and 5,000 rows", async () => {
    const pages = Array.from({ length: 100 }, (_, i) => page(i + 1, Array.from({ length: 50 }, (_, j) => i * 50 + j + 1), i === 99 ? null : `token-${i}`))
    assert.equal((await loadMissingDataList(reader(pages), signal())).issues.length, 5_000)
  })
  it("rejects continuation after batch 100 without making another request", async () => {
    const calls = []
    const pages = Array.from({ length: 100 }, (_, i) => page(i + 1, [], `token-${i}`))
    await assert.rejects(loadMissingDataList(reader(pages, calls), signal()), (error) => error.detail.code === "limit")
    assert.equal(calls.length, 100)
  })
  it("does not request when already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const calls = []
    await assert.rejects(loadMissingDataList(reader([page(1)], calls), controller.signal), { name: "AbortError" })
    assert.equal(calls.length, 0)
  })
  it("ignores an aborted response and does not request the next batch", async () => {
    const controller = new AbortController()
    let resolve
    let calls = 0
    const loading = loadMissingDataList(() => { calls++; return new Promise((done) => { resolve = done }) }, controller.signal)
    controller.abort()
    resolve(page(1, [1], "next"))
    await assert.rejects(loading, { name: "AbortError" })
    assert.equal(calls, 1)
  })
})

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { harness, input, jsonRequest } from "./helpers/projects-analysis-server-harness.mjs"

function route(h) { return h.load("app/api/analytics/projects/query/route.ts") }
function privateResponse(response) { assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Cookie"); assert.equal(response.headers.get("access-control-allow-origin"), null) }

describe("Sprint analytics JSON POST", () => {
  it("returns finalized summaries using the standard envelope, with private no-store", async (t) => {
    const h = harness(t)
    const response = await route(h).POST(jsonRequest())
    assert.equal(response.status, 200); privateResponse(response)
    const result = await response.json()
    assert.equal(result.status, "success"); assert.equal(result.data.complete, true)
    assert.equal(result.data.summaries.length, 1); assert.equal(h.authCalls(), 2)
    assert.equal(route(h).GET, undefined); assert.equal(route(h).PUT, undefined)
  })
  it("returns complete original analytics when no-team display membership is unavailable", async (t) => {
    const h = harness(t, { groupResponse: () => new Response("private membership payload", { status: 403 }) })
    const response = await route(h).POST(jsonRequest())
    assert.equal(response.status, 200); privateResponse(response)
    const result = await response.json()
    assert.equal(result.status, "success"); assert.equal(result.data.complete, true)
    assert.deepEqual(result.data.teamAttribution, { status: "unavailable", reason: "lookup_failed" })
    assert.equal(result.data.tasks.length, 1); assert.equal(result.data.sourceIssueCount, 2)
    assert.doesNotMatch(JSON.stringify(result), /private membership payload|fixture-token|cloudId/)
  })
  for (const [groupStatus, status, code] of [[401, 401, "reauthorize"], [400, 502, "configuration"], [404, 502, "configuration"]]) it(`propagates optional group ${groupStatus} as ${code}, not success`, async (t) => {
    const h = harness(t, { groupResponse: () => new Response("private membership payload", { status: groupStatus }) })
    const response = await route(h).POST(jsonRequest())
    assert.equal(response.status, status); privateResponse(response)
    const result = await response.json()
    assert.equal(result.status, "error"); assert.equal(result.error.code, code)
    assert.doesNotMatch(JSON.stringify(result), /private membership payload|fixture-token/)
  })
  it("selected membership permission failures still fail the entire query", async (t) => {
    const h = harness(t, { groupResponse: () => new Response("private membership payload", { status: 403 }) })
    const response = await route(h).POST(jsonRequest({ ...input, groups: ["ent-web"] }))
    assert.equal(response.status, 403); privateResponse(response)
    assert.equal((await response.json()).error.code, "forbidden")
    assert.equal(h.calls.some((call) => call.method === "POST"), false)
  })
  it("cancellation during optional classification is not degraded to a success response", async (t) => {
    const controller = new AbortController()
    const h = harness(t, { onCall: ({ path }) => { if (path.startsWith("/rest/api/3/group/member?")) controller.abort() } })
    const response = await route(h).POST(jsonRequest(input, { init: { signal: controller.signal } }))
    assert.equal(response.status, 408); privateResponse(response)
    assert.equal((await response.json()).error.code, "cancelled")
  })
  for (const [name, value, options, status] of [
    ["extra JQL", { ...input, jql: "project = ALL" }, {}, 400],
    ["client account IDs", { ...input, accountIds: ["fixture-member"] }, {}, 400],
    ["client team attribution", { ...input, teamAttribution: { status: "available", byAssignee: [] } }, {}, 400],
    ["client today", { ...input, today: "2099-01-01" }, {}, 400],
    ["more than six Sprints", { ...input, sprintIds: [7517, 7518, 7519, 7520, 7504, 7505, 7506] }, {}, 400],
    ["unknown Team", { ...input, groups: ["arbitrary-group"] }, {}, 400],
    ["invalid timezone", { ...input, browserTimeZone: "Mars/Now" }, {}, 400],
    ["active Sprint", { ...input, sprintIds: [7519] }, {}, 400],
    ["cross-origin", input, { headers: { origin: "https://other.example.invalid" } }, 403],
    ["cross-site Fetch Metadata", input, { headers: { "sec-fetch-site": "cross-site" } }, 403],
    ["wrong content type", input, { headers: { "content-type": "text/plain" } }, 415],
    ["oversized declared length", input, { headers: { "content-length": "16385" } }, 413],
  ]) it(`rejects ${name} before Jira I/O`, async (t) => {
    const h = harness(t), response = await route(h).POST(jsonRequest(value, options))
    assert.equal(response.status, status); privateResponse(response)
    assert.equal(h.calls.length, 0); assert.equal(h.tokenCalls(), 0)
  })
  it("requires Origin rather than inferring same-origin from cookies", async (t) => {
    const h = harness(t), request = jsonRequest(); request.headers.delete("origin")
    const response = await route(h).POST(request)
    assert.equal(response.status, 403); privateResponse(response); assert.equal(h.calls.length, 0)
  })
  it("counts streamed bytes, not just a misleading Content-Length", async (t) => {
    const bytes = new TextEncoder().encode(" ".repeat(16 * 1024 + 1))
    const body = new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 8000)); controller.enqueue(bytes.subarray(8000)); controller.close() } })
    const request = new Request("https://app.example.invalid/api/analytics/projects/query", { method: "POST", headers: { origin: "https://app.example.invalid", "content-type": "application/json", "content-length": "1" }, body, duplex: "half" })
    const h = harness(t), response = await route(h).POST(request)
    assert.equal(response.status, 413); privateResponse(response); assert.equal(h.calls.length, 0)
  })
  it("rejects invalid JSON and UTF-8 without Jira I/O", async (t) => {
    const h = harness(t)
    for (const body of ["{oops", new Uint8Array([0xc3, 0x28])]) {
      const request = jsonRequest(input, { init: { body } })
      const response = await route(h).POST(request)
      assert.equal(response.status, 400); privateResponse(response)
    }
    assert.equal(h.calls.length, 0)
  })
  it("checks route login before body/Jira and marks errors private", async (t) => {
    const h = harness(t, { auth: false }), response = await route(h).POST(jsonRequest())
    assert.equal(response.status, 401); privateResponse(response)
    assert.equal((await response.json()).error.code, "reauthorize"); assert.equal(h.tokenCalls(), 0)
  })
  for (const status of [401, 403, 429, 500]) it(`maps upstream ${status} without exposing its payload`, async (t) => {
    const h = harness(t, { status: { "/rest/api/3/field": status } })
    const response = await route(h).POST(jsonRequest())
    assert.equal(response.status, status === 401 ? 401 : status === 403 ? 403 : 502)
    privateResponse(response); assert.ok(!(await response.text()).includes("private upstream payload"))
  })
  it("passes request cancellation to the service and makes no Jira requests", async (t) => {
    const h = harness(t), controller = new AbortController(); controller.abort()
    const response = await route(h).POST(jsonRequest(input, { init: { signal: controller.signal } }))
    assert.equal(response.status, 408); privateResponse(response); assert.equal(h.calls.length, 0)
  })
})

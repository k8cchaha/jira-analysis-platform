import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { initialPageCursor, openPageToken, sealPageToken } from "../lib/jira-page-token.ts"

const now = Date.UTC(2026, 0, 1)
const ttl = 15 * 60 * 1_000
const secret = "unit-test-only-not-a-real-secret"
const context = {
  userId: "test-user",
  cloudId: "test-cloud",
  kind: "points",
  jql: "test fixed missing-data scope",
}
const cursor = { ...initialPageCursor(now), path: [null, "raw-jira-next-page-1", "raw-jira-next-page-2"] }

describe("encrypted Jira page tokens", () => {
  it("initializes the first-page cursor with a fixed 15-minute lifetime", () => {
    assert.deepEqual(initialPageCursor(now), { path: [null], expiresAt: now + ttl })
  })

  it("round-trips first-page and multi-page cursors without exposing the raw cursor", () => {
    for (const value of [initialPageCursor(now), cursor]) {
      const token = sealPageToken(value, context, secret)
      assert.match(token, /^[A-Za-z0-9_-]+$/)
      assert.deepEqual(openPageToken(token, context, secret, now), value)
      const decoded = Buffer.from(token, "base64url").toString("utf8")
      assert.equal(decoded.includes("expiresAt"), false)
      assert.equal(decoded.includes("raw-jira-next-page"), false)
    }
  })

  it("uses fresh nonces when sealing the same cursor twice", () => {
    const first = sealPageToken(cursor, context, secret)
    const second = sealPageToken(cursor, context, secret)
    assert.notEqual(first, second)
    assert.deepEqual(openPageToken(first, context, secret, now), cursor)
    assert.deepEqual(openPageToken(second, context, secret, now), cursor)
  })

  it("binds tokens independently to user, cloud, kind, and exact JQL", () => {
    const token = sealPageToken(cursor, context, secret)
    for (const field of ["userId", "cloudId", "kind", "jql"]) {
      assert.throws(
        () => openPageToken(token, { ...context, [field]: `${context[field]}-different` }, secret, now),
        /Invalid or expired page token/,
      )
    }
    assert.throws(() => openPageToken(token, { ...context, jql: `${context.jql} ` }, secret, now))
  })

  it("rejects a wrong or empty encryption secret", () => {
    const token = sealPageToken(cursor, context, secret)
    assert.throws(() => openPageToken(token, context, `${secret}-different`, now))
    assert.throws(() => openPageToken(token, context, "", now))
    assert.throws(() => sealPageToken(cursor, context, ""), /not configured/)
  })

  it("detects tampering in the nonce, authentication tag, and ciphertext", () => {
    const bytes = Buffer.from(sealPageToken(cursor, context, secret), "base64url")
    for (const index of [0, 12, 28, bytes.length - 1]) {
      const tampered = Buffer.from(bytes)
      tampered[index] ^= 1
      assert.throws(() => openPageToken(tampered.toString("base64url"), context, secret, now))
    }
  })

  it("rejects truncated, malformed, and oversized tokens", () => {
    const token = sealPageToken(cursor, context, secret)
    for (const value of ["", " ", "%%%", "a", "a".repeat(250_001), `${token}=`, token.slice(0, -8)]) {
      assert.throws(() => openPageToken(value, context, secret, now))
    }
  })

  it("expires at the exact boundary and does not refresh expiry on opening or resealing", () => {
    const token = sealPageToken(cursor, context, secret)
    assert.deepEqual(openPageToken(token, context, secret, now + ttl - 1), cursor)
    assert.throws(() => openPageToken(token, context, secret, now + ttl))
    assert.throws(() => openPageToken(token, context, secret, now + ttl + 1))
    const opened = openPageToken(token, context, secret, now + 1_000)
    const resealed = sealPageToken(opened, context, secret)
    assert.equal(openPageToken(resealed, context, secret, now + 1_000).expiresAt, now + ttl)
    assert.throws(() => openPageToken(resealed, context, secret, now + ttl))
  })

  it("rejects an authenticated cursor whose expiry is beyond the allowed lifetime", () => {
    const token = sealPageToken({ ...cursor, expiresAt: now + ttl + 1 }, context, secret)
    assert.throws(() => openPageToken(token, context, secret, now))
  })

  it("rejects malformed cursor shapes, duplicate cursors, and invalid lifetimes", () => {
    for (const value of [
      null,
      {},
      { expiresAt: now + ttl, path: [] },
      { expiresAt: now + ttl, path: ["not-first-page"] },
      { expiresAt: now + ttl, path: [null, null] },
      { expiresAt: now + ttl, path: [null, ""] },
      { expiresAt: now + ttl, path: [null, 7] },
      { expiresAt: now + ttl, path: [null, "same", "same"] },
      { expiresAt: now + ttl, path: [null, "a".repeat(8_193)] },
      { expiresAt: now + ttl, path: [null, ...Array.from({ length: 101 }, (_, index) => String(index))] },
      { expiresAt: Infinity, path: [null] },
      { expiresAt: NaN, path: [null] },
      { expiresAt: "invalid", path: [null] },
    ]) {
      assert.throws(() => sealPageToken(value, context, secret), /Invalid page cursor/)
    }
  })

  it("accepts the maximum cursor depth and individual raw-token length", () => {
    const deepest = { expiresAt: now + ttl, path: [null, ...Array.from({ length: 100 }, (_, index) => `page-${index}`)] }
    const longest = { expiresAt: now + ttl, path: [null, "a".repeat(8_192)] }
    for (const value of [deepest, longest]) {
      assert.deepEqual(openPageToken(sealPageToken(value, context, secret), context, secret, now), value)
    }
  })

  it("fails closed when a structurally valid cursor exceeds the encrypted-size limit", () => {
    const oversized = {
      expiresAt: now + ttl,
      path: [null, ...Array.from({ length: 30 }, (_, index) => `${index}:`.padEnd(8_192, "a"))],
    }
    assert.throws(() => sealPageToken(oversized, context, secret), /Page cursor is too large/)
  })
})

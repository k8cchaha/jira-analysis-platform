import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  ACTUAL_STORY_POINTS_FIELD,
  MISSING_DATA_LIMIT,
  MISSING_DATA_PAGE_SIZE,
  MISSING_DEFECT_CAUSE_JQL,
  MISSING_POINTS_JQL,
  POINTS_SCOPE_JQL,
  STORY_POINTS_FIELD,
  isMissingPoint,
  isPointValue,
  jiraText,
  missingDataJql,
  parseMissingDataChanges,
} from "../lib/jira-missing-data.ts"

const pointsChange = {
  issueId: "101",
  storyPoints: 1.25,
  expectedStoryPoints: null,
}
const parsePoints = (changes) => parseMissingDataChanges("points", JSON.stringify(changes))
const parseDefects = (changes) => parseMissingDataChanges("defect-cause", JSON.stringify(changes))

describe("missing-data JQL contract", () => {
  it("keeps the fixed points population and sun/tkk resolution exception", () => {
    assert.equal(
      POINTS_SCOPE_JQL,
      'issuetype in ("DEV-Task", "QA-Task") AND assignee = currentUser() AND status = Done AND (project not in (sun, tkk) OR resolution in (Done, Fixed))',
    )
    assert.equal(
      MISSING_POINTS_JQL,
      `${POINTS_SCOPE_JQL} AND (cf[10005] is EMPTY OR cf[10005] = 0 OR cf[13736] is EMPTY OR cf[13736] = 0)`,
    )
    assert.equal(missingDataJql("points"), MISSING_POINTS_JQL)
    assert.equal(STORY_POINTS_FIELD, "customfield_10005")
    assert.equal(ACTUAL_STORY_POINTS_FIELD, "customfield_13736")
  })

  it("preserves the exact defect-cause scope", () => {
    assert.equal(
      MISSING_DEFECT_CAUSE_JQL,
      'project in (sun, tkk) and issuetype = bug and assignee = currentUser() and statusCategory != "To Do" and status not in ("In Progress", "Dev Ready") and resolution in (EMPTY, Done, Fixed) and "Defect Cause[Select List (multiple choices)]" is EMPTY',
    )
    assert.equal(missingDataJql("defect-cause"), MISSING_DEFECT_CAUSE_JQL)
  })

  it("does not introduce a date filter or alter the precise population cap", () => {
    for (const jql of [MISSING_POINTS_JQL, MISSING_DEFECT_CAUSE_JQL]) {
      assert.doesNotMatch(jql, /\b(created|updated|resolved|resolutiondate|duedate|startOfDay|startOfWeek|startOfMonth|now)\b/i)
    }
    assert.equal(MISSING_DATA_LIMIT, 5_000)
    assert.equal(MISSING_DATA_PAGE_SIZE, 50)
  })
})

describe("point validity and missingness", () => {
  it("treats null and zero as valid values needing supplementation", () => {
    for (const value of [null, 0, -0]) {
      assert.equal(isMissingPoint(value), true)
      assert.equal(isPointValue(value), true)
    }
  })

  it("accepts positive finite decimals without classifying them as missing", () => {
    for (const value of [0.125, 1, 3.75, Number.MAX_VALUE]) {
      assert.equal(isPointValue(value), true)
      assert.equal(isMissingPoint(value), false)
    }
  })

  it("does not relabel invalid or absent values as missing", () => {
    for (const value of [-1, -0.1, undefined, NaN, Infinity, -Infinity, "0", "1", false, {}, []]) {
      assert.equal(isPointValue(value), false)
      assert.equal(isMissingPoint(value), false)
    }
  })
})

describe("parseMissingDataChanges points", () => {
  it("accepts two positive decimal fields with original null and zero", () => {
    const change = {
      issueId: "101",
      storyPoints: 1.25,
      actualStoryPoints: 2.75,
      expectedStoryPoints: null,
      expectedActualStoryPoints: 0,
    }
    assert.deepEqual(parsePoints([change]), [change])
    assert.deepEqual(parsePoints([{ ...change, expectedStoryPoints: 0, expectedActualStoryPoints: null }]), [
      { ...change, expectedStoryPoints: 0, expectedActualStoryPoints: null },
    ])
  })

  it("accepts either field independently", () => {
    assert.deepEqual(parsePoints([pointsChange]), [pointsChange])
    const actualOnly = { issueId: "102", actualStoryPoints: 0.5, expectedActualStoryPoints: 0 }
    assert.deepEqual(parsePoints([actualOnly]), [actualOnly])
  })

  it("accepts exactly the current-page batch limit", () => {
    const changes = Array.from({ length: 50 }, (_, index) => ({ ...pointsChange, issueId: String(index + 1) }))
    assert.deepEqual(parsePoints(changes), changes)
  })

  it("rejects duplicate issue IDs", () => {
    assert.throws(() => parsePoints([pointsChange, { ...pointsChange, storyPoints: 2 }]))
  })

  it("rejects unknown, cross-kind, and prototype-looking fields", () => {
    for (const extra of [{ summary: "untrusted" }, { defectCause: ["7"] }, { expectedPoints: null }]) {
      assert.throws(() => parsePoints([{ ...pointsChange, ...extra }]))
    }
    assert.throws(() => parseMissingDataChanges("points", '[{"issueId":"101","storyPoints":1,"expectedStoryPoints":null,"__proto__":{}}]'))
  })

  for (const [name, value] of [["zero", 0], ["negative", -1], ["null", null], ["numeric string", "1.25"], ["boolean", true], ["object", {}]]) {
    it(`rejects ${name} replacement values for both points fields`, () => {
      assert.throws(() => parsePoints([{ ...pointsChange, storyPoints: value }]))
      assert.throws(() => parsePoints([{ issueId: "101", actualStoryPoints: value, expectedActualStoryPoints: null }]))
    })
  }

  it("rejects nonfinite numbers encoded as overflowing JSON exponents", () => {
    for (const field of ["storyPoints", "actualStoryPoints"]) {
      const expected = field === "storyPoints" ? "expectedStoryPoints" : "expectedActualStoryPoints"
      for (const value of ["1e309", "-1e309"]) {
        assert.throws(() => parseMissingDataChanges("points", `[{"issueId":"101","${field}":${value},"${expected}":null}]`))
      }
    }
    assert.throws(() => parseMissingDataChanges("points", '[{"issueId":"101","storyPoints":NaN,"expectedStoryPoints":null}]'))
  })

  it("requires a missing original value, never a positive, negative, string, or absent original", () => {
    for (const expected of [1, -1, "0", false, {}, [], undefined]) {
      assert.throws(() => parsePoints([{ ...pointsChange, expectedStoryPoints: expected }]))
      assert.throws(() => parsePoints([{ issueId: "101", actualStoryPoints: 2, expectedActualStoryPoints: expected }]))
    }
  })

  it("rejects orphaned originals and empty changes", () => {
    for (const change of [
      { issueId: "101" },
      { issueId: "101", expectedStoryPoints: null },
      { issueId: "101", expectedActualStoryPoints: 0 },
      { ...pointsChange, expectedActualStoryPoints: null },
    ]) {
      assert.throws(() => parsePoints([change]))
    }
  })
})

describe("parseMissingDataChanges envelope", () => {
  it("rejects empty, malformed, nonstring, and oversized submissions", () => {
    for (const value of [undefined, null, [], {}, 1, "", " ", "not json", "[", " ".repeat(10_001)]) {
      assert.throws(() => parseMissingDataChanges("points", value))
    }
  })

  it("rejects nonarrays, empty batches, invalid rows, and more than 50 issues", () => {
    for (const value of [null, {}, "text", 1, [], [null], [[]], ["row"], [false]]) {
      assert.throws(() => parseMissingDataChanges("points", JSON.stringify(value)))
    }
    const tooMany = Array.from({ length: 51 }, (_, index) => ({ ...pointsChange, issueId: String(index + 1) }))
    assert.throws(() => parsePoints(tooMany))
    assert.throws(() => parseDefects(tooMany.map(({ issueId }) => ({ issueId, defectCause: ["7"] }))))
  })

  it("requires 1-to-30-digit string issue IDs in either kind", () => {
    for (const issueId of [undefined, null, 101, "", "-1", "1.5", "ISSUE-101", " 101", "101 ", "1".repeat(31)]) {
      assert.throws(() => parsePoints([{ ...pointsChange, issueId }]))
      assert.throws(() => parseDefects([{ issueId, defectCause: ["7"] }]))
    }
    assert.equal(parsePoints([{ ...pointsChange, issueId: "1".repeat(30) }])[0].issueId, "1".repeat(30))
  })
})

describe("parseMissingDataChanges defect-cause", () => {
  it("accepts distinct numeric option IDs, preserving their order", () => {
    const change = { issueId: "101", defectCause: ["7", "22", "1".repeat(30)] }
    assert.deepEqual(parseDefects([change]), [change])
  })

  it("rejects duplicate issue and option IDs rather than silently deduplicating", () => {
    const change = { issueId: "101", defectCause: ["7"] }
    assert.throws(() => parseDefects([change, change]))
    assert.throws(() => parseDefects([{ issueId: "101", defectCause: ["7", "22", "7"] }]))
  })

  it("rejects missing, empty, excessive, and nonarray option selections", () => {
    for (const defectCause of [undefined, null, [], "7", {}, Array.from({ length: 101 }, (_, index) => String(index + 1))]) {
      assert.throws(() => parseDefects([{ issueId: "101", defectCause }]))
    }
    const change = { issueId: "101", defectCause: Array.from({ length: 100 }, (_, index) => String(index + 1)) }
    assert.deepEqual(parseDefects([change]), [change])
  })

  it("rejects untrusted labels, option objects, and malformed option IDs", () => {
    for (const option of [7, null, false, {}, { id: "7", value: "label" }, "", "label", "-7", "7.5", " 7", "7 ", "1".repeat(31), "<script>alert(1)</script>"]) {
      assert.throws(() => parseDefects([{ issueId: "101", defectCause: [option] }]))
    }
  })

  it("does not accept caller-supplied option metadata or points fields", () => {
    for (const extra of [{ defectCauseOptions: [{ id: "7", value: "label" }] }, { storyPoints: 1 }, { expectedStoryPoints: null }]) {
      assert.throws(() => parseDefects([{ issueId: "101", defectCause: ["7"], ...extra }]))
    }
  })
})

describe("jiraText plain text and ADF", () => {
  it("keeps plain text and supplies explicit absent/unsupported fallbacks", () => {
    assert.equal(jiraText("plain text"), "plain text")
    assert.equal(jiraText(""), "")
    assert.equal(jiraText(null), "—")
    assert.equal(jiraText(undefined), "—")
    assert.equal(jiraText({ type: "doc", version: 1 }), "—")
    for (const value of [1, true, []]) assert.equal(jiraText(value), "（無法識別的文字格式）")
  })

  it("flattens paragraphs, hard breaks, mentions, headings, and lists into text", () => {
    const adf = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [
          { type: "text", text: "Root cause" },
          { type: "hardBreak" },
          { type: "mention", attrs: { id: "test-account", text: "@Reviewer" } },
        ] },
        { type: "heading", content: [{ type: "text", text: "Solution" }] },
        { type: "bulletList", content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Fix" }] }] },
        ] },
      ],
    }
    assert.equal(jiraText(adf), "Root cause\n@Reviewer\nSolution\nFix\n\n")
  })

  it("extracts text only, never rendering link, HTML, media, or mention attributes", () => {
    const adf = { type: "doc", content: [
      { type: "paragraph", content: [
        { type: "text", text: "safe label", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
        { type: "mention", attrs: { id: "private-id", text: "@Test", href: "javascript:alert(1)" } },
        { type: "inlineCard", attrs: { url: "https://example.invalid/private" } },
        { type: "media", attrs: { id: "private-media", alt: "<script>alert(1)</script>" } },
      ] },
    ] }
    assert.equal(jiraText(adf), "safe label@Test\n")
    assert.equal(jiraText({ type: "text", text: "<b>literal text</b>" }), "<b>literal text</b>")
    assert.equal(jiraText({ type: "mention", attrs: { id: "private-id" } }), "")
    assert.equal(jiraText({ type: "unknown", attrs: { text: "not node text" } }), "")
  })
})

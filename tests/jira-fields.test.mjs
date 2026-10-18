import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  JIRA_FIELDS,
  STORY_POINTS_FIELD,
  ACTUAL_STORY_POINTS_FIELD,
  customFieldJql,
  matchesJiraFieldSchema,
} from "../lib/jira-fields.ts"
import {
  STORY_POINTS_FIELD as missingStoryPoints,
  ACTUAL_STORY_POINTS_FIELD as missingActualStoryPoints,
} from "../lib/jira-missing-data.ts"

describe("central Jira field definitions", () => {
  it("preserves fixed numeric IDs and compatibility exports", () => {
    assert.equal(STORY_POINTS_FIELD, "customfield_10005")
    assert.equal(ACTUAL_STORY_POINTS_FIELD, "customfield_13736")
    assert.equal(missingStoryPoints, STORY_POINTS_FIELD)
    assert.equal(missingActualStoryPoints, ACTUAL_STORY_POINTS_FIELD)
    assert.equal(JIRA_FIELDS.storyPoints.name, "Story Points")
    assert.equal(JIRA_FIELDS.actualStoryPoints.name, "Actual Story Points")
    assert.deepEqual(JIRA_FIELDS.storyPoints.schema, { type: "number" })
    assert.deepEqual(JIRA_FIELDS.actualStoryPoints.schema, { type: "number" })
  })

  it("derives numeric JQL references from the REST IDs", () => {
    assert.equal(customFieldJql(STORY_POINTS_FIELD), "cf[10005]")
    assert.equal(customFieldJql(ACTUAL_STORY_POINTS_FIELD), "cf[13736]")
    assert.equal(customFieldJql("customfield_12345"), "cf[12345]")
  })

  it("records names and schemas without inventing dynamically discovered IDs", () => {
    assert.equal(JIRA_FIELDS.defectCause.name, "Defect Cause")
    assert.equal(JIRA_FIELDS.defectCause.jql, '"Defect Cause[Select List (multiple choices)]"')
    assert.deepEqual(JIRA_FIELDS.defectCause.schema, {
      type: "array", items: "option",
      custom: "com.atlassian.jira.plugin.system.customfieldtypes:multiselect",
    })
    assert.equal(JIRA_FIELDS.rootCause.name, "Root Cause")
    assert.equal(JIRA_FIELDS.solution.name, "Solution")
    for (const field of [JIRA_FIELDS.defectCause, JIRA_FIELDS.rootCause, JIRA_FIELDS.solution]) {
      assert.equal(Object.hasOwn(field, "id"), false)
    }
    assert.deepEqual(JIRA_FIELDS.rootCause.schema, { type: "string" })
    assert.deepEqual(JIRA_FIELDS.solution.schema, { type: "string" })
  })

  it("compares only required schema properties, allowing additional Jira metadata", () => {
    assert.equal(matchesJiraFieldSchema({ type: "number", customId: 10005, custom: "float" }, JIRA_FIELDS.storyPoints.schema), true)
    assert.equal(matchesJiraFieldSchema({ ...JIRA_FIELDS.defectCause.schema, customId: 20000 }, JIRA_FIELDS.defectCause.schema), true)
    assert.equal(matchesJiraFieldSchema({ type: "string", custom: "textarea" }, JIRA_FIELDS.rootCause.schema), true)
  })

  it("rejects missing, malformed, and incorrectly typed numeric schemas", () => {
    for (const schema of [undefined, null, [], "number", 1, {}, { type: "string" }, { type: "Number" }]) {
      assert.equal(matchesJiraFieldSchema(schema, JIRA_FIELDS.storyPoints.schema), false)
    }
  })

  it("requires all multiselect schema properties", () => {
    for (const key of ["type", "items", "custom"]) {
      const schema = { ...JIRA_FIELDS.defectCause.schema }
      delete schema[key]
      assert.equal(matchesJiraFieldSchema(schema, JIRA_FIELDS.defectCause.schema), false)
      schema[key] = "wrong"
      assert.equal(matchesJiraFieldSchema(schema, JIRA_FIELDS.defectCause.schema), false)
    }
  })
})

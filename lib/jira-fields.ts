export const JIRA_FIELDS = {
  storyPoints: {
    id: "customfield_10005",
    name: "Story Points",
    schema: { type: "number" },
  },
  actualStoryPoints: {
    id: "customfield_13736",
    name: "Actual Story Points",
    schema: { type: "number" },
  },
  /** 工作單的「Dev Type」分類欄位（Select）；值如 Spike／Pre-Spike／OP-Task／OP-Bug／Dev／Bug。 */
  devType: {
    id: "customfield_14642",
    name: "Dev Type",
    schema: { type: "option" },
  },
  // These IDs are resolved from Jira metadata by name and schema.
  defectCause: {
    name: "Defect Cause",
    jql: '"Defect Cause[Select List (multiple choices)]"',
    schema: {
      type: "array",
      items: "option",
      custom: "com.atlassian.jira.plugin.system.customfieldtypes:multiselect",
    },
  },
  rootCause: {
    name: "Root Cause",
    schema: { type: "string" },
  },
  solution: {
    name: "Solution",
    schema: { type: "string" },
  },
} as const

export const STORY_POINTS_FIELD = JIRA_FIELDS.storyPoints.id
export const ACTUAL_STORY_POINTS_FIELD = JIRA_FIELDS.actualStoryPoints.id
export const DEV_TYPE_FIELD = JIRA_FIELDS.devType.id

export function customFieldJql(id: `customfield_${number}`): string {
  return `cf[${id.slice("customfield_".length)}]`
}

export function matchesJiraFieldSchema(
  schema: unknown,
  required: Readonly<Record<string, string>>
): boolean {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return false
  const value = schema as Record<string, unknown>
  return Object.entries(required).every(([key, expected]) => value[key] === expected)
}

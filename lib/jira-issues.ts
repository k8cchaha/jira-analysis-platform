import "server-only"

import {
  getJiraToken,
  JiraAuthorizationError,
  type JiraCredentials,
} from "@/lib/jira-token"
import {
  getIssueStoryPoints,
  getJiraStoryPointsFields,
  JiraStoryPointsError,
  RECENT_ASSIGNED_ISSUES_JQL,
  type JiraStoryPointsField,
} from "@/lib/jira-story-points"

export interface JiraIssueSummary {
  id: string
  key: string
  summary: string
  status: string
  priority: string
  issueType: string
  project: string
  created: string | null
  storyPoints: number | null
  storyPointsSupported: boolean
  storyPointsUnavailableReason?: string
}

export interface JiraIssueSearchResult {
  issues: JiraIssueSummary[]
  hasMore: boolean
}

type JiraIssueSearchErrorCode =
  | "reauthorization_required"
  | "forbidden"
  | "rate_limited"
  | "service_unavailable"
  | "invalid_response"
  | "request_failed"

export class JiraIssueSearchError extends Error {
  constructor(
    message: string,
    readonly code: JiraIssueSearchErrorCode,
    readonly status?: number
  ) {
    super(message)
    this.name = "JiraIssueSearchError"
  }
}

export async function getRecentAssignedIssues(): Promise<JiraIssueSearchResult> {
  let credentials: JiraCredentials
  try {
    credentials = await getJiraToken()
  } catch (error) {
    if (error instanceof JiraAuthorizationError) throw error
    throw new JiraIssueSearchError(
      "Unable to load Jira credentials",
      "request_failed"
    )
  }

  let storyPointsFields: JiraStoryPointsField[]
  try {
    storyPointsFields = await getJiraStoryPointsFields(credentials)
  } catch (error) {
    if (error instanceof JiraStoryPointsError) {
      throw new JiraIssueSearchError(error.message, error.code, error.status)
    }
    throw error
  }

  let response: Response
  try {
    response = await fetch(
      `https://api.atlassian.com/ex/jira/${encodeURIComponent(credentials.cloudId)}/rest/api/3/search/jql`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jql: RECENT_ASSIGNED_ISSUES_JQL,
          fields: [
            "summary",
            "status",
            "created",
            "issuetype",
            "priority",
            "project",
            ...storyPointsFields.map((field) => field.id),
          ],
          maxResults: 50,
        }),
        cache: "no-store",
      }
    )
  } catch {
    throw new JiraIssueSearchError(
      "Unable to reach Jira",
      "request_failed"
    )
  }

  if (!response.ok) {
    const code = getHttpErrorCode(response.status)
    console.error("Jira issue search failed", { status: response.status, code })
    throw new JiraIssueSearchError(
      "Jira issue search failed",
      code,
      response.status
    )
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new JiraIssueSearchError(
      "Jira returned invalid JSON",
      "invalid_response"
    )
  }

  return parseSearchResult(data, storyPointsFields)
}

function parseSearchResult(
  data: unknown,
  storyPointsFields: JiraStoryPointsField[]
): JiraIssueSearchResult {
  if (!isRecord(data) || !Array.isArray(data.issues)) {
    throw new JiraIssueSearchError(
      "Jira returned an invalid issue list",
      "invalid_response"
    )
  }

  return {
    issues: data.issues.map((issue) => parseIssue(issue, storyPointsFields)),
    hasMore: getString(data.nextPageToken) !== null,
  }
}

function parseIssue(
  value: unknown,
  storyPointsFields: JiraStoryPointsField[]
): JiraIssueSummary {
  if (!isRecord(value)) {
    throw new JiraIssueSearchError(
      "Jira returned an invalid issue",
      "invalid_response"
    )
  }

  const id = getString(value.id)
  const key = getString(value.key)
  if (!id || !key) {
    throw new JiraIssueSearchError(
      "Jira returned an issue without an ID or key",
      "invalid_response"
    )
  }

  const fields = isRecord(value.fields) ? value.fields : {}
  const project = isRecord(fields.project) ? fields.project : null
  const projectId = getString(project?.id)
  const storyPoints = projectId
    ? getIssueStoryPoints(fields, projectId, storyPointsFields)
    : {
        value: null,
        supported: false,
        unavailableReason: "此 Issue 缺少專案資訊",
      }

  return {
    id,
    key,
    summary: getString(fields.summary) ?? "未命名議題",
    status: getNestedName(fields.status),
    priority: getNestedName(fields.priority),
    issueType: getNestedName(fields.issuetype),
    project: getNestedName(fields.project),
    created: getString(fields.created),
    storyPoints: storyPoints.value,
    storyPointsSupported: storyPoints.supported,
    storyPointsUnavailableReason: storyPoints.unavailableReason,
  }
}

function getNestedName(value: unknown) {
  return isRecord(value) ? (getString(value.name) ?? "—") : "—"
}

function getHttpErrorCode(status: number): JiraIssueSearchErrorCode {
  if (status === 401) return "reauthorization_required"
  if (status === 403) return "forbidden"
  if (status === 429) return "rate_limited"
  if (status >= 500) return "service_unavailable"
  return "request_failed"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

import "server-only"

import { JIRA_FIELDS, STORY_POINTS_FIELD, matchesJiraFieldSchema } from "@/lib/jira-fields"
import {
  getJiraToken,
  type JiraCredentials,
} from "@/lib/jira-token"

export const RECENT_ASSIGNED_ISSUES_JQL =
  "assignee = currentUser() AND created >= -30d ORDER BY created DESC"

const JIRA_API_ROOT = "https://api.atlassian.com/ex/jira"
const UPDATE_CONCURRENCY = 4

export interface JiraStoryPointsField {
  id: string
  projectId: string | null
}

export interface JiraStoryPointsValue {
  value: number | null
  supported: boolean
  unavailableReason?: string
}

export interface StoryPointsChange {
  issueId: string
  value: number | null
}

export interface StoryPointsUpdateFailure {
  issueId: string
  message: string
}

export interface StoryPointsUpdateResult {
  succeededIssueIds: string[]
  failures: StoryPointsUpdateFailure[]
  updatedCount: number
  unchangedCount: number
}

export type JiraStoryPointsErrorCode =
  | "reauthorization_required"
  | "forbidden"
  | "rate_limited"
  | "service_unavailable"
  | "invalid_response"
  | "request_failed"

export class JiraStoryPointsError extends Error {
  constructor(
    message: string,
    readonly code: JiraStoryPointsErrorCode,
    readonly status?: number
  ) {
    super(message)
    this.name = "JiraStoryPointsError"
  }
}

export async function getJiraStoryPointsFields(
  credentials: JiraCredentials
): Promise<JiraStoryPointsField[]> {
  const response = await jiraFetch(credentials, "/rest/api/3/field")

  if (!response.ok) {
    throw createRequestError("Jira field discovery failed", response.status)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new JiraStoryPointsError(
      "Jira returned invalid field JSON",
      "invalid_response"
    )
  }

  if (!Array.isArray(data)) {
    throw new JiraStoryPointsError(
      "Jira returned an invalid field list",
      "invalid_response"
    )
  }

  const fields: JiraStoryPointsField[] = []
  for (const value of data) {
    if (!isRecord(value)) continue

    const id = getString(value.id)
    const name = getString(value.name)
    const schema = isRecord(value.schema) ? value.schema : null
    if (
      id !== STORY_POINTS_FIELD ||
      !name ||
      !matchesJiraFieldSchema(schema, JIRA_FIELDS.storyPoints.schema)
    ) {
      continue
    }

    const scope = isRecord(value.scope) ? value.scope : null
    if (!scope || scope.type === "GLOBAL") {
      fields.push({ id, projectId: null })
      continue
    }

    const project = isRecord(scope.project) ? scope.project : null
    const projectId = getString(project?.id)
    if (scope.type === "PROJECT" && projectId) {
      fields.push({ id, projectId })
    }
  }

  return fields
}

export function getIssueStoryPoints(
  fields: Record<string, unknown>,
  projectId: string,
  candidates: JiraStoryPointsField[]
): JiraStoryPointsValue {
  const candidate = resolveStoryPointsField(candidates, projectId)
  if (!candidate) {
    return {
      value: null,
      supported: false,
      unavailableReason: "找不到唯一可用的 Story Points 欄位",
    }
  }

  if (!Object.prototype.hasOwnProperty.call(fields, candidate.id)) {
    return {
      value: null,
      supported: false,
      unavailableReason: "此 Issue 不支援 Story Points",
    }
  }

  const value = fields[candidate.id]
  if (value === null) return { value: null, supported: true }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return { value, supported: true }
  }

  return {
    value: null,
    supported: false,
    unavailableReason: "Jira 回傳了無法識別的 Story Points 值",
  }
}

export async function updateJiraStoryPoints(
  changes: StoryPointsChange[]
): Promise<StoryPointsUpdateResult> {
  const credentials = await getJiraToken(true)
  const candidates = await getJiraStoryPointsFields(credentials)
  const eligibleIssues = await getEligibleIssues(credentials, changes, candidates)

  const results = await mapWithConcurrency(
    changes,
    UPDATE_CONCURRENCY,
    async (change) => {
      const issue = eligibleIssues.get(change.issueId)
      if (!issue) {
        return failure(change.issueId, "這張 Issue 已不在目前可更新的清單中")
      }

      const candidate = resolveStoryPointsField(candidates, issue.projectId)
      if (!candidate) {
        return failure(change.issueId, "找不到唯一可用的 Story Points 欄位")
      }

      return updateOneIssue(credentials, issue, candidate, change)
    }
  )

  const succeededIssueIds: string[] = []
  const failures: StoryPointsUpdateFailure[] = []
  let updatedCount = 0
  let unchangedCount = 0

  for (const result of results) {
    if (result.status === "failed") {
      failures.push({ issueId: result.issueId, message: result.message })
    } else {
      succeededIssueIds.push(result.issueId)
      if (result.status === "updated") updatedCount += 1
      else unchangedCount += 1
    }
  }

  return { succeededIssueIds, failures, updatedCount, unchangedCount }
}

async function getEligibleIssues(
  credentials: JiraCredentials,
  changes: StoryPointsChange[],
  candidates: JiraStoryPointsField[]
) {
  const issueIds = changes.map((change) => change.issueId).join(", ")
  const response = await jiraFetch(credentials, "/rest/api/3/search/jql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jql: `id in (${issueIds}) AND assignee = currentUser() AND created >= -30d`,
      fields: ["project", ...candidates.map((field) => field.id)],
      maxResults: changes.length,
    }),
  })

  if (!response.ok) {
    throw createRequestError("Jira issue authorization failed", response.status)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new JiraStoryPointsError(
      "Jira returned invalid issue JSON",
      "invalid_response"
    )
  }

  if (!isRecord(data) || !Array.isArray(data.issues)) {
    throw new JiraStoryPointsError(
      "Jira returned an invalid issue list",
      "invalid_response"
    )
  }

  const issues = new Map<string, EligibleIssue>()
  for (const value of data.issues) {
    if (!isRecord(value)) continue
    const id = getString(value.id)
    const fields = isRecord(value.fields) ? value.fields : null
    const project = fields && isRecord(fields.project) ? fields.project : null
    const projectId = getString(project?.id)
    if (id && projectId && fields) issues.set(id, { id, projectId, fields })
  }

  return issues
}

async function updateOneIssue(
  credentials: JiraCredentials,
  issue: EligibleIssue,
  candidate: JiraStoryPointsField,
  change: StoryPointsChange
): Promise<IssueUpdateResult> {
  const params = new URLSearchParams({
    fields: candidate.id,
    expand: "editmeta",
  })

  let response: Response
  try {
    response = await jiraFetch(
      credentials,
      `/rest/api/3/issue/${encodeURIComponent(issue.id)}?${params}`
    )
  } catch {
    return failure(issue.id, "暫時無法連線至 Jira，請稍後再試")
  }

  if (!response.ok) {
    console.error("Jira Story Points metadata request failed", {
      issueId: issue.id,
      status: response.status,
    })
    return failure(issue.id, getIssueFailureMessage(response.status))
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    return failure(issue.id, "Jira 回傳了無法識別的資料")
  }

  if (!isRecord(data)) return failure(issue.id, "Jira 回傳了無法識別的資料")

  const fields = isRecord(data.fields) ? data.fields : null
  const editmeta = isRecord(data.editmeta) ? data.editmeta : null
  const editableFields = editmeta && isRecord(editmeta.fields) ? editmeta.fields : null
  const metadataValue = editableFields?.[candidate.id]
  const metadata: Record<string, unknown> | null = isRecord(metadataValue)
    ? metadataValue
    : null

  if (!fields || !metadata) {
    return failure(issue.id, "這張 Issue 的 Story Points 無法編輯")
  }

  const schema = isRecord(metadata.schema) ? metadata.schema : null
  const operations = Array.isArray(metadata.operations)
    ? metadata.operations.filter((value): value is string => typeof value === "string")
    : []
  if (!matchesJiraFieldSchema(schema, JIRA_FIELDS.storyPoints.schema) || !operations.includes("set")) {
    return failure(issue.id, "這張 Issue 的 Story Points 無法編輯")
  }
  if (change.value === null && metadata.required === true) {
    return failure(issue.id, "這張 Issue 的 Story Points 為必填，不能清空")
  }

  const currentValue = fields[candidate.id]
  if (
    currentValue !== null &&
    !(typeof currentValue === "number" && Number.isFinite(currentValue))
  ) {
    return failure(issue.id, "Jira 回傳了無法識別的 Story Points 值")
  }
  if (currentValue === change.value) {
    return { issueId: issue.id, status: "unchanged" }
  }

  let updateResponse: Response
  try {
    updateResponse = await jiraFetch(
      credentials,
      `/rest/api/3/issue/${encodeURIComponent(issue.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { [candidate.id]: change.value } }),
      }
    )
  } catch {
    return failure(issue.id, "暫時無法連線至 Jira，請稍後再試")
  }

  if (updateResponse.status !== 204) {
    console.error("Jira Story Points update failed", {
      issueId: issue.id,
      status: updateResponse.status,
    })
    return failure(issue.id, getIssueFailureMessage(updateResponse.status))
  }

  return { issueId: issue.id, status: "updated" }
}

function resolveStoryPointsField(
  candidates: JiraStoryPointsField[],
  projectId: string
) {
  const projectFields = candidates.filter((field) => field.projectId === projectId)
  if (projectFields.length === 1) return projectFields[0]
  if (projectFields.length > 1) return null

  const globalFields = candidates.filter((field) => field.projectId === null)
  return globalFields.length === 1 ? globalFields[0] : null
}

async function jiraFetch(
  credentials: JiraCredentials,
  path: string,
  init: RequestInit = {}
) {
  try {
    return await fetch(
      `${JIRA_API_ROOT}/${encodeURIComponent(credentials.cloudId)}${path}`,
      {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credentials.accessToken}`,
          ...init.headers,
        },
        cache: "no-store",
      }
    )
  } catch {
    throw new JiraStoryPointsError("Unable to reach Jira", "request_failed")
  }
}

function createRequestError(message: string, status: number) {
  const code = getHttpErrorCode(status)
  console.error(message, { status, code })
  return new JiraStoryPointsError(message, code, status)
}

function getHttpErrorCode(status: number): JiraStoryPointsErrorCode {
  if (status === 401) return "reauthorization_required"
  if (status === 403) return "forbidden"
  if (status === 429) return "rate_limited"
  if (status >= 500) return "service_unavailable"
  return "request_failed"
}

function getIssueFailureMessage(status: number) {
  if (status === 401) return "Jira 授權已失效，請重新登入"
  if (status === 403) return "沒有權限更新這張 Issue"
  if (status === 429) return "Jira 請求過於頻繁，請稍後再試"
  return status >= 500
    ? "Jira 服務暫時無法使用，請稍後再試"
    : "無法更新這張 Issue 的 Story Points"
}

function failure(issueId: string, message: string): IssueUpdateResult {
  return { issueId, status: "failed", message }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker)
  )
  return results
}

interface EligibleIssue {
  id: string
  projectId: string
  fields: Record<string, unknown>
}

type IssueUpdateResult =
  | { issueId: string; status: "updated" | "unchanged" }
  | { issueId: string; status: "failed"; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

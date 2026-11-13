import "server-only"

import { auth } from "@/auth"
import { getJiraToken, JiraAuthorizationError, type JiraCredentials } from "@/lib/jira-token"
import { jiraFetch, JiraTransportError } from "@/lib/jira-http"
import { searchJiraIssues, dashboardJiraBaseUrl, JiraDashboardError } from "@/lib/jira-dashboard"
import { loadDashboardGroupMembers, JiraDashboardLookupError } from "@/lib/jira-dashboard-lookups"
import { DASHBOARD_TEAMS, DashboardFilterError, includedDashboardMembers, isDashboardAccountId, type DashboardUser } from "@/lib/jira-dashboard-filter"
import { JIRA_FIELDS, matchesJiraFieldSchema } from "@/lib/jira-fields"
import { projectsAnalysisParentIssuesJql, projectsAnalysisChildQueries } from "@/lib/jira-jql"
import { getVerifiedJiraAccountTimeZone, JiraAccountTimeZoneError } from "@/lib/jira-account-timezone"
import { createResolvedCalendarDateResolver } from "@/lib/burndown-completion"
import { isPointValue } from "@/lib/jira-missing-data"
import {
  PROJECTS_SOURCE_LIMIT, ProjectsAnalysisValidationError, parseProjectsAnalysisRequest,
  parseProjectsAnalysisResult, projectsCalendarToday, projectsNumericId, projectsRecord,
  projectsText, resolveProjectsAnalysisSprints,
  type ProjectsAnalysisResult, type ProjectsAnalysisTask, type ProjectsTeamAttribution,
} from "@/lib/projects-analysis"

type RecordValue = Record<string, unknown>
export type ProjectsAnalysisErrorCode = "reauthorize" | "forbidden" | "invalid_selection" | "metadata" | "invalid_response" | "limit" | "retry" | "cancelled" | "configuration"
export class JiraProjectsAnalysisError extends Error {
  constructor(readonly code: ProjectsAnalysisErrorCode, message: string) {
    super(message)
    this.name = "JiraProjectsAnalysisError"
  }
}
function invalid(): never { throw new JiraProjectsAnalysisError("invalid_response", "Jira 分析資料不完整或互相矛盾，請重新查詢。") }
function metadata(): never {
  console.log('HOHIHOHOHOOH')
  throw new JiraProjectsAnalysisError("metadata", "Jira 欄位或工作單票種設定不完整、不適用或不唯一，請聯繫管理員。")
}

/** Only public errors cross the boundary; never upstream response bodies or tokens. */
export function projectsAnalysisError(error: unknown): { code: ProjectsAnalysisErrorCode; message: string } {
  if (error instanceof JiraProjectsAnalysisError) return { code: error.code, message: error.message }
  if (error instanceof ProjectsAnalysisValidationError || error instanceof DashboardFilterError) return { code: "invalid_selection", message: error.message }
  if (error instanceof JiraAuthorizationError) return error.code === "invalid_configuration"
    ? { code: "configuration", message: "Jira OAuth 設定不完整，請聯繫管理員。" }
    : { code: "reauthorize", message: "Jira 授權已失效，請重新授權。" }
  if (error instanceof JiraAccountTimeZoneError) return { code: error.code, message: error.message }
  if (error instanceof JiraDashboardError || error instanceof JiraDashboardLookupError) {
    const code = error.code === "reauthorize" || error.code === "forbidden" || error.code === "limit" ? error.code : "retry"
    return { code, message: code === "reauthorize" ? "Jira 授權已失效，請重新授權。" : code === "forbidden" ? "沒有權限讀取所選 Jira 資料或團隊。" : code === "limit" ? "資料或團隊成員超過上限，請縮小分析範圍。" : "暫時無法取得完整 Jira 資料，請稍後重試。" }
  }
  return { code: "retry", message: "暫時無法取得完整 Jira 分析資料，請稍後重試。" }
}

async function metadataJson(credentials: JiraCredentials, path: string, check: () => void): Promise<unknown> {
  check()
  let response: Response
  try {
    response = await jiraFetch(credentials, path, { method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000) })
  } catch (error) {
    if (error instanceof JiraTransportError) throw new JiraProjectsAnalysisError("retry", "暫時無法連線至 Jira，請稍後重試。")
    throw error
  }
  check()
  if (!response.ok) {
    if (response.status === 401) throw new JiraProjectsAnalysisError("reauthorize", "Jira 授權已失效，請重新授權。")
    if (response.status === 403) throw new JiraProjectsAnalysisError("forbidden", "沒有權限讀取所選 Jira 資料。")
    if (response.status === 400 || response.status === 404) metadata()
    throw new JiraProjectsAnalysisError("retry", "Jira 暫時無法完成分析，請稍後重試。")
  }
  let data: unknown
  try { data = await response.json() } catch { invalid() }
  check()
  return data
}

/** Parse scope BEFORE schema filtering: malformed scoped candidates may never fall back globally. */
function candidateProject(candidate: RecordValue): string | null {
  if (!Object.hasOwn(candidate, "scope")) return null
  const scope = candidate.scope
  if (!projectsRecord(scope)) return metadata()
  if (scope.type === "GLOBAL") return null
  if (scope.type !== "PROJECT" || !projectsRecord(scope.project) || !projectsNumericId(scope.project.id)) return metadata()
  return scope.project.id
}
function scopedCandidate(candidates: RecordValue[], projectId: string): RecordValue {
  const parsed = candidates.map((value) => ({ value, projectId: candidateProject(value) }))
  const scoped = parsed.filter((candidate) => candidate.projectId === projectId)
  const applicable = scoped.length ? scoped : parsed.filter((candidate) => candidate.projectId === null)
  if (applicable.length !== 1) return metadata()
  return applicable[0].value
}

export async function discoverProjectsAnalysisFields(credentials: JiraCredentials, projectId: string, check: () => void = () => {}): Promise<string[]> {
  const data = await metadataJson(credentials, "/rest/api/3/field", check)
  if (!Array.isArray(data)) return metadata()
  return [JIRA_FIELDS.storyPoints, JIRA_FIELDS.actualStoryPoints, JIRA_FIELDS.devType].map((definition) => {
    const candidates = data.filter((field): field is RecordValue => projectsRecord(field) && field.id === definition.id)
    const selected = scopedCandidate(candidates, projectId)
    // Fixed field identity comes from JIRA_FIELDS, not a mutable display name.
    if (!matchesJiraFieldSchema(selected.schema, definition.schema)) return metadata()
    return definition.id
  })
}

export async function discoverProjectsAnalysisIssueTypes(credentials: JiraCredentials, projectId: string, check: () => void = () => {}): Promise<Map<string, ProjectsAnalysisTask["issueType"]>> {
  console.log('RRRRR - 1')
  const data = await metadataJson(credentials, "/rest/api/3/issuetype", check)
  console.log('RRRRR - 2')
  if (!Array.isArray(data)) return metadata()
  console.log('RRRRR - 3')
  const types = new Map<string, ProjectsAnalysisTask["issueType"]>()
  console.log('RRRRR - 4')
  for (const name of ["Dev-Task", "QA-Task"] as const) {
    console.log('RRRRR - 4.1'+ name)
    const candidates = data.filter((type): type is RecordValue => projectsRecord(type) && typeof type.name === "string" && type.name.trim().toLowerCase() === name.toLowerCase())
    console.log('RRRRR - 4.2')
    const selected = scopedCandidate(candidates, projectId)
    console.log('RRRRR - 4.3')
    // Candidate lookup already matches names case-insensitively; retain the verified ID.
    if (!projectsNumericId(selected.id) || selected.subtask !== true || types.has(selected.id)) {
      console.log('RRRRR - 4.4')
      console.log({
      expectedName: name,
      actualName: selected.name,
      id: selected.id,
      validId: projectsNumericId(selected.id),
      subtask: selected.subtask,
      duplicateId: projectsNumericId(selected.id) && types.has(selected.id),
    })
      return metadata()
    }
    console.log('RRRRR - 4.5')
    types.set(selected.id, name)
  }
  console.log('RRRRR - 5')
  return types
}

function required(fields: RecordValue, key: string): unknown {
  if (!Object.hasOwn(fields, key)) return invalid()
  return fields[key]
}
function issueKey(value: unknown, project: string): value is string {
  return typeof value === "string" && value.length <= 200 && value.startsWith(`${project}-`) && /^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(value)
}
function nullableName(value: unknown): string | null {
  if (value === null) return null
  if (!projectsText(value) || /[\u0000-\u001f\u007f]/.test(value)) return invalid()
  return value
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (projectsRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
  return JSON.stringify(value) ?? "undefined"
}

function taskTeamAttribution(tasks: readonly ProjectsAnalysisTask[], groups: readonly string[], members: Record<string, DashboardUser[]>): ProjectsTeamAttribution {
  const returnedAccounts = new Set(tasks.flatMap((task) => task.assigneeAccountId === null ? [] : [task.assigneeAccountId]))
  const byAccount = new Map<string, string>()
  // Configuration order, not request order or worker completion order: later wins.
  for (const team of DASHBOARD_TEAMS) {
    if (!groups.includes(team.group)) continue
    if (!members[team.group]) invalid()
    for (const member of members[team.group]) {
      if (returnedAccounts.has(member.accountId)) byAccount.set(member.accountId, team.group)
    }
  }
  return { status: "available", byAssignee: [...returnedAccounts].sort().map((accountId) => ({ accountId, teamId: byAccount.get(accountId) ?? "other" })) }
}

/** Boundary checks stop subsequent lookups/pages, not shared transports already in flight. */
export async function getProjectsAnalysis(value: unknown, options: { signal?: AbortSignal } = {}): Promise<ProjectsAnalysisResult> {
  console.log('XOOXOXOXXOXOOXXOXO - 1')
  const started = new Date()
  const deadline = Date.now() + 120_000
  const check = () => {
    if (options.signal?.aborted) throw new JiraProjectsAnalysisError("cancelled", "分析已取消，請重新查詢。")
    if (Date.now() >= deadline) throw new JiraProjectsAnalysisError("retry", "分析逾時，請縮小範圍後重試。")
  }
  try {
    console.log('XOOXOXOXXOXOOXXOXO - 2')
    const request = parseProjectsAnalysisRequest(value)
    const sprints = resolveProjectsAnalysisSprints(request, started)
    check()
    const session = await auth()
    check()
    if (!session?.user?.id) throw new JiraProjectsAnalysisError("reauthorize", "登入狀態已失效，請重新登入。")
    const credentials = await getJiraToken()
    check()
    if (credentials.viewerId !== session.user.id) throw new JiraProjectsAnalysisError("reauthorize", "Jira 登入身分不一致，請重新登入。")
    let accountIds: string[] | null = null
    let selectedMembers: Record<string, DashboardUser[]> | null = null
    if (request.groups.length) {
      console.log('XXXXXXX - 1')
      selectedMembers = await loadDashboardGroupMembers(request.groups, credentials, { useSharedCache: true, check })
      check()
      accountIds = includedDashboardMembers(request.groups, {}, selectedMembers)
      if (!accountIds.length) throw new JiraProjectsAnalysisError("invalid_selection", "所選團隊沒有可分析的完整成員，請重新選擇。")
    }
    console.log('XOOXOXOXXOXOOXXOXO - 3')
    const project = await metadataJson(credentials, `/rest/api/3/project/${encodeURIComponent(request.project)}`, check)
    if (!projectsRecord(project) || !projectsNumericId(project.id) || project.key !== request.project) metadata()
    const projectId = project.id
    console.log('XOOXOXOXXOXOOXXOXO - 3.01')
    const customFields = await discoverProjectsAnalysisFields(credentials, projectId, check)
    console.log('XOOXOXOXXOXOOXXOXO - 3.02')
    const types = await discoverProjectsAnalysisIssueTypes(credentials, projectId, check)
    console.log('XOOXOXOXXOXOOXXOXO - 3.03')
    check()
    console.log('XOOXOXOXXOXOOXXOXO - 3.04')
    const jiraTimeZone = await getVerifiedJiraAccountTimeZone(credentials)
    check()
    const resolveDate = createResolvedCalendarDateResolver(jiraTimeZone)
    const sources = new Map<string, string>()
    const keys = new Map<string, string>()
    console.log('XOOXOXOXXOXOOXXOXO - 3.1')
    const remember = (issue: { id: string; key: string; fields: RecordValue }) => {
      if (!projectsNumericId(issue.id) || (keys.has(issue.key) && keys.get(issue.key) !== issue.id)) invalid()
      const signature = stable(issue)
      const previous = sources.get(issue.id)
      console.log('XOOXOXOXXOXOOXXOXO - 3.2')
      if (previous !== undefined && previous !== signature) invalid()
      sources.set(issue.id, signature)
      keys.set(issue.key, issue.id)
      if (sources.size > PROJECTS_SOURCE_LIMIT) throw new JiraProjectsAnalysisError("limit", `分析來源超過 ${PROJECTS_SOURCE_LIMIT.toLocaleString("en-US")} 張唯一 Issue，請縮小 Sprint 或團隊範圍。`)
    }
    console.log('XOOXOXOXXOXOOXXOXO - 4')
    async function* pages(jql: string, fields: string[]) {
      const iterator = searchJiraIssues(credentials, jql, fields)
      try {
        while (true) {
          check()
          const page = await iterator.next()
          check()
          if (page.done) return
          yield page.value
        }
      } finally { await iterator.return(undefined) }
    }
    const parents = new Map<string, { key: string; sprintIds: Set<number> }>()
    for (const sprint of sprints) {
      for await (const issues of pages(projectsAnalysisParentIssuesJql(request.project, sprint.id), ["issuetype"])) {
        for (const issue of issues) {
          const issueProject = required(issue.fields, "project"), type = required(issue.fields, "issuetype")
          if (!projectsRecord(issueProject) || issueProject.id !== projectId || issueProject.key !== request.project || !issueKey(issue.key, request.project) || !projectsRecord(type) || type.subtask !== false || typeof type.name !== "string" || !["story", "task", "bug"].includes(type.name.trim().toLowerCase())) invalid()
          remember(issue)
          const parent = parents.get(issue.id) ?? { key: issue.key, sprintIds: new Set<number>() }
          parent.sprintIds.add(sprint.id)
          parents.set(issue.id, parent)
        }
      }
    }
    const tasks = new Map<string, ProjectsAnalysisTask>()
    if (parents.size) {
      const queries = projectsAnalysisChildQueries([...parents.keys()], [...types.keys()], accountIds)
      for (const jql of queries) {
        for await (const issues of pages(jql, ["summary", "issuetype", "parent", "assignee", "status", "resolutiondate", ...customFields])) {
          for (const issue of issues) {
            if (parents.has(issue.id)) invalid()
            // Parent IDs define the scope; pressure uses each linked child's own Project.
            const issueProject = required(issue.fields, "project"), parentValue = required(issue.fields, "parent"), type = required(issue.fields, "issuetype")
            if (!projectsRecord(issueProject) || !projectsNumericId(issueProject.id) || typeof issueProject.key !== "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(issueProject.key) || !issueKey(issue.key, issueProject.key) || !projectsRecord(parentValue) || !projectsNumericId(parentValue.id) || !projectsRecord(type) || !projectsNumericId(type.id) || type.subtask !== true) invalid()
            const parent = parents.get(parentValue.id), issueType = types.get(type.id)
            // The discovered type ID supplies the canonical Dev/QA label; display names are not identity.
            if (!parent || parentValue.key !== parent.key || !issueType) invalid()
            const points = required(issue.fields, JIRA_FIELDS.storyPoints.id), actualPoints = required(issue.fields, JIRA_FIELDS.actualStoryPoints.id)
            if (!isPointValue(points) || !isPointValue(actualPoints)) invalid()
            const devValue = required(issue.fields, JIRA_FIELDS.devType.id)
            let devType: string | null = null
            if (devValue !== null) {
              if (!projectsRecord(devValue) || !projectsNumericId(devValue.id) || !projectsText(devValue.value)) invalid()
              devType = nullableName(devValue.value)
            }
            const assignee = required(issue.fields, "assignee")
            let assigneeAccountId: string | null = null, assigneeDisplayName: string | null = null
            if (assignee !== null) {
              if (!projectsRecord(assignee) || !isDashboardAccountId(assignee.accountId)) invalid()
              assigneeAccountId = assignee.accountId
              assigneeDisplayName = nullableName(assignee.displayName)
            }
            if (accountIds !== null && (assigneeAccountId === null || !accountIds.includes(assigneeAccountId))) invalid()
            const status = required(issue.fields, "status")
            if (status !== null && !projectsRecord(status)) invalid()
            const statusName = status === null ? null : nullableName(status.name)
            const summary = required(issue.fields, "summary")
            if (typeof summary !== "string" || summary.length > 100_000) invalid()
            const resolved = required(issue.fields, "resolutiondate")
            if (!(resolved === null || (typeof resolved === "string" && resolved.length > 0))) invalid()
            let resolvedDate: string | null
            try { resolvedDate = resolveDate(resolved) } catch { invalid() }
            remember(issue)
            tasks.set(issue.id, { id: issue.id, key: issue.key, summary, parentId: parentValue.id, parentKey: parent.key, projectId: issueProject.id, projectKey: issueProject.key, issueType, devType, points, actualPoints, resolvedDate, assigneeAccountId, assigneeDisplayName, statusName, sprintIds: [...parent.sprintIds].sort((a, b) => a - b) })
          }
        }
      }
    }
    check()
    try {
      // Finish and validate the original analysis before optional display-only I/O.
      const result = parseProjectsAnalysisResult({ schemaVersion: 1, complete: true, historicalSnapshot: false, request, startedAt: started.toISOString(), generatedAt: new Date().toISOString(), browserToday: projectsCalendarToday(request.browserTimeZone, started), jiraTimeZone, sourceIssueCount: sources.size, sprints, tasks: [...tasks.values()].sort((a, b) => a.key.localeCompare(b.key)), jiraBaseUrl: dashboardJiraBaseUrl() }, request)
      let teamAttribution: ProjectsTeamAttribution
      if (selectedMembers) {
        teamAttribution = taskTeamAttribution(result.tasks, request.groups, selectedMembers)
      } else if (!result.tasks.length) {
        teamAttribution = { status: "available", byAssignee: [] }
      } else {
        const groups = DASHBOARD_TEAMS.map((team) => team.group)
        let members: Record<string, DashboardUser[]> | null = null
        check()
        try {
          members = await loadDashboardGroupMembers(groups, credentials, { useSharedCache: true, check })
          check()
        } catch (error) {
          check()
          // Only membership-only lookup failures may degrade presentation. Caller
          // cancellation/deadline and credential/configuration errors still fail.
          if (error instanceof JiraDashboardLookupError && error.code === "configuration") throw new JiraProjectsAnalysisError("configuration", "Jira 團隊設定不完整，請聯繫管理員。")
          if (error instanceof JiraAuthorizationError || error instanceof JiraProjectsAnalysisError || (error instanceof JiraDashboardLookupError && error.code === "reauthorize")) throw error
          if (!(error instanceof JiraDashboardLookupError)) throw error
        }
        teamAttribution = members ? taskTeamAttribution(result.tasks, groups, members) : { status: "unavailable", reason: "lookup_failed" }
      }
      check()
      return parseProjectsAnalysisResult({ ...result, generatedAt: new Date().toISOString(), teamAttribution }, request)
    } catch (error) {
      // Invalid source data/overflow is an upstream failure, not an invalid user selection.
      if (error instanceof ProjectsAnalysisValidationError) invalid()
      throw error
    }
  } catch (error) {
    const publicError = projectsAnalysisError(error)
    throw new JiraProjectsAnalysisError(publicError.code, publicError.message)
  }
}

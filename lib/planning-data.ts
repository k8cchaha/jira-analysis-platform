import "server-only"

import {
  getJiraToken,
  JiraAuthorizationError,
  type JiraCredentials,
} from "@/lib/jira-token"
import { searchJiraIssues, dashboardJiraBaseUrl } from "@/lib/jira-dashboard"
import {
  sprintParentIssuesJql,
  sprintDevTasksJql,
  sprintUnassignedJql,
  sprintUnestimatedJql,
} from "@/lib/jira-jql"
import { STORY_POINTS_FIELD } from "@/lib/jira-fields"
import type { MissingIssue } from "@/lib/jira-missing-data"
import type { SprintRecord } from "@/lib/jira-sprint-data"

export class JiraPlanningError extends Error {
  constructor(
    readonly code: "reauthorize" | "invalid_response" | "limit" | "request_failed",
    message: string
  ) {
    super(message)
    this.name = "JiraPlanningError"
  }
}

/**
 * Planning 明細表的一列 Dev-Task。與燃盡圖不同，這裡把「估計＋未估計」的單
 * 都放同一張表：未估計的 `points` 為 `null`（顯示「—」），不因此中斷。
 * `status` 是 Jira 目前的工作流狀態名稱（Planning 只展示，不做群組/圖表）。
 */
export interface PlanningTask {
  key: string
  summary: string | null
  /** 目前的 status 名稱；讀不到為 null。 */
  status: string | null
  /** 已估計的 Story Points；未估計（無法提供）為 null。 */
  points: number | null
  assigneeDisplayName: string | null
  assigneeAccountId: string | null
  parentIssueType: MissingIssue["parentIssueType"]
}

export interface PlanningData {
  taskCount: number
  tasks: PlanningTask[]
  /** 此 sprint 的母票 key 清單（供 Page 組 Planning 的 JQL 條件用）。 */
  parentKeys: string[]
}

const MAX_DEVTASKS = 5_000

/** Planning 彈窗的子集合種類：「未估時」或「未分派」。 */
export type PlanningSubsetKind = "unestimated" | "unassigned"

/**
 * Story Points 的寬鬆解析：非負有限數字才採用，否則回 null（未填或不可用）。
 * 這是明細列表，單一壞值不該打掛整頁，故不像燃盡圖的 `pointValue` 那樣拋錯。
 */
function pointsOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
  return Math.round(value * 10) / 10
}

/** 從 Jira assignee 物件取出顯示名稱（可能為 null）。 */
function assigneeDisplayName(value: unknown): string | null {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.displayName === "string" && record.displayName.trim().length > 0) {
      return record.displayName
    }
  }
  return null
}

/** 從 Jira assignee 物件取出 accountId（可能為 null）。 */
function assigneeAccountId(value: unknown): string | null {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.accountId === "string" && record.accountId.trim().length > 0) {
      return record.accountId
    }
  }
  return null
}

/** 從 Jira `parent` 欄位取出母票的 Issue Type（known / none / unknown）。 */
function parentIssueTypeOf(value: unknown): MissingIssue["parentIssueType"] {
  if (value === null || value === undefined) return { status: "none" }
  if (typeof value !== "object") return { status: "unknown" }
  const parent = value as Record<string, unknown>
  const nested = parent.fields
  const name = recordFieldName(nested)
  return name ? { status: "known", name } : { status: "unknown" }
}

function recordFieldName(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const issuetype = record.issuetype
  if (typeof issuetype === "object" && issuetype !== null) {
    const name = (issuetype as Record<string, unknown>).name
    if (typeof name === "string" && name.trim().length > 0) return name
  }
  return null
}

/** 從 Jira `status` 欄位取出狀態名稱（可能為 null）。 */
function statusName(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const name = (value as Record<string, unknown>).name
  return typeof name === "string" && name.trim().length > 0 ? name : null
}

/** Planning 主表與彈窗共用要請求的欄位。 */
const PLANNING_FIELDS = [
  "summary",
  "assignee",
  "parent",
  "status",
  STORY_POINTS_FIELD,
]

/** 把一筆 Jira issue 投影成 PlanningTask 列。 */
function projectPlanningTask(issue: {
  key: string
  fields: Record<string, unknown>
}): PlanningTask {
  return {
    key: issue.key,
    summary: typeof issue.fields.summary === "string" ? issue.fields.summary : null,
    status: statusName(issue.fields.status),
    points: pointsOrNull(issue.fields[STORY_POINTS_FIELD]),
    assigneeDisplayName: assigneeDisplayName(issue.fields.assignee),
    assigneeAccountId: assigneeAccountId(issue.fields.assignee),
    parentIssueType: parentIssueTypeOf(issue.fields.parent),
  }
}

/**
 * 撈此 sprint 的母票再撈其下全部 Dev-Task，回列表（估計＋未估計，含 status）。
 * 只重用 `sprintParentIssuesJql`／`sprintDevTasksJql`，不手刻 JQL。
 */
export async function getPlanningData(sprint: SprintRecord): Promise<PlanningData> {
  let credentials: JiraCredentials
  try {
    credentials = await getJiraToken()
  } catch (error) {
    if (error instanceof JiraAuthorizationError) {
      throw new JiraPlanningError(
        error.code === "invalid_configuration" ? "request_failed" : "reauthorize",
        "無法讀取 Jira 登入狀態，請重新授權。"
      )
    }
    throw new JiraPlanningError("request_failed", "無法取得 Jira 登入資料。")
  }

  // 1. 撈此 sprint 的母票（Story / Task / Bug）。
  const parentKeys = new Set<string>()
  let parents = 0
  for await (const issues of searchJiraIssues(
    credentials,
    sprintParentIssuesJql(sprint.id),
    []
  )) {
    for (const issue of issues) {
      parents += 1
      parentKeys.add(issue.key)
      if (parents > MAX_DEVTASKS) {
        throw new JiraPlanningError("limit", "此 Sprint 的票數過多，無法提供精確結果。")
      }
    }
  }

  // 2. 撈全部 Dev-Task，投影成 PlanningTask（含 status）。
  const tasks: PlanningTask[] = []
  if (parentKeys.size > 0) {
    for await (const issues of searchJiraIssues(
      credentials,
      sprintDevTasksJql([...parentKeys]),
      PLANNING_FIELDS
    )) {
      for (const issue of issues) {
        tasks.push(projectPlanningTask(issue))
        if (tasks.length > MAX_DEVTASKS) {
          throw new JiraPlanningError("limit", "此 Sprint 的票數過多，無法提供精確結果。")
        }
      }
    }
  }

  return { taskCount: tasks.length, tasks, parentKeys: [...parentKeys] }
}

export { dashboardJiraBaseUrl as planningJiraBaseUrl }

/**
 * 撈 Planning 彈窗的子集合（未估時／未分派）之 Dev-Task，投影成跟主表一致的
 * `PlanningTask[]`。只用 `sprintUnestimatedJql`／`sprintUnassignedJql`，不手刻 JQL。
 */
export async function getPlanningSubset(
  sprint: SprintRecord,
  kind: PlanningSubsetKind
): Promise<{ taskCount: number; tasks: PlanningTask[]; parentKeys: string[] }> {
  let credentials: JiraCredentials
  try {
    credentials = await getJiraToken()
  } catch (error) {
    if (error instanceof JiraAuthorizationError) {
      throw new JiraPlanningError(
        error.code === "invalid_configuration" ? "request_failed" : "reauthorize",
        "無法讀取 Jira 登入狀態，請重新授權。"
      )
    }
    throw new JiraPlanningError("request_failed", "無法取得 Jira 登入資料。")
  }

  // 先撈母票 key，再用對應 builder 撈子集合的 Dev-Task。
  const parentKeys = new Set<string>()
  let parents = 0
  for await (const issues of searchJiraIssues(
    credentials,
    sprintParentIssuesJql(sprint.id),
    []
  )) {
    for (const issue of issues) {
      parents += 1
      parentKeys.add(issue.key)
      if (parents > MAX_DEVTASKS) {
        throw new JiraPlanningError("limit", "此 Sprint 的票數過多，無法提供精確結果。")
      }
    }
  }

  const jql =
    kind === "unestimated"
      ? sprintUnestimatedJql([...parentKeys])
      : sprintUnassignedJql([...parentKeys])

  const tasks: PlanningTask[] = []
  if (parentKeys.size > 0) {
    for await (const issues of searchJiraIssues(credentials, jql, PLANNING_FIELDS)) {
      for (const issue of issues) {
        tasks.push(projectPlanningTask(issue))
        if (tasks.length > MAX_DEVTASKS) {
          throw new JiraPlanningError("limit", "此 Sprint 的票數過多，無法提供精確結果。")
        }
      }
    }
  }

  return { taskCount: tasks.length, tasks, parentKeys: [...parentKeys] }
}
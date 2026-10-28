import "server-only"

import {
  getJiraToken,
  JiraAuthorizationError,
  type JiraCredentials,
} from "@/lib/jira-token"
import { searchJiraIssues } from "@/lib/jira-dashboard"
import {
  sprintParentIssuesJql,
  sprintChildTasksJql,
  sprintChildTasksUnassignedJql,
  sprintChildTasksUnestimatedJql,
} from "@/lib/jira-jql"
import { STORY_POINTS_FIELD, DEV_TYPE_FIELD } from "@/lib/jira-fields"
import type { MissingIssue } from "@/lib/jira-missing-data"
import type { SprintRecord } from "@/lib/jira-sprint-data"
import type { PlanningTask } from "@/lib/planning-subset"

export class JiraPlanningError extends Error {
  constructor(
    readonly code: "reauthorize" | "invalid_response" | "limit" | "request_failed",
    message: string
  ) {
    super(message)
    this.name = "JiraPlanningError"
  }
}

export interface PlanningData {
  taskCount: number
  tasks: PlanningTask[]
  /** 此 sprint 的母票 key 清單（供 Page 組 Planning 的 JQL 條件用）。 */
  parentKeys: string[]
}

const MAX_DEVTASKS = 5_000

/**
 * Planning 彈窗的子集合種類：「未估時」、或「未分派」，或「未開子單」
 * （該 sprint 的 Story/Task/Bug 母票中，沒有任何 Dev-Task 子票的）。
 */
export type PlanningSubsetKind = "unestimated" | "unassigned" | "no-subtasks"

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

/** 從 Jira `components` 欄位取出名稱清單（可能為空陣列）。 */
function componentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === "object" && item !== null ? (item as Record<string, unknown>).name : null))
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
}

/**
 * 從 Jira option 型 custom field 取出其值名稱：可能是字串，或 `{ value }` 物件
 * （Select List）。讀不到、非字串為 null。
 */
function optionValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim().length > 0 ? value : null
  if (typeof value === "object" && value !== null) {
    const v = (value as Record<string, unknown>).value
    if (typeof v === "string" && v.trim().length > 0) return v
  }
  return null
}

/** Planning 主表與彈窗共用要請求的欄位。 */
const PLANNING_FIELDS = [
  "summary",
  "assignee",
  "reporter",
  "components",
  "parent",
  "status",
  "issuetype",
  STORY_POINTS_FIELD,
  DEV_TYPE_FIELD,
]

/** 母票（Story/Task/Bug）自身要請求的欄位：summary、issuetype、parent（＝其 Epic）。 */
const MOTHER_FIELDS = [
  "summary",
  "issuetype",
  "parent",
  STORY_POINTS_FIELD,
]

/** 一筆母票的投影（key 之外建立母票表頭／Epic 階層所需的欄位）。 */
interface MotherInfo {
  summary: string | null
  issueType: string | null
  epic: { key: string; summary: string | null } | null
}

/** 從 Jira response 的母票欄位物件取出其 Epic（`parent` 欄位的 `issuetype` 為 Epic）。 */
function epicOf(value: unknown): { key: string; summary: string | null } | null {
  if (typeof value !== "object" || value === null) return null
  const parent = value as Record<string, unknown>
  const nested = parent.fields
  const name = recordFieldName(nested)
  if (!name || !name.toLowerCase().includes("epic")) return null
  const key = parent.key
  if (typeof key !== "string" || key.length === 0) return null
  const summary =
    typeof nested === "object" && nested !== null
      ? (nested as Record<string, unknown>).summary
      : null
  return { key, summary: typeof summary === "string" ? summary : null }
}

/** 把一筆 Jira issue 投影成 PlanningTask 列。 */
function projectPlanningTask(
  issue: {
    key: string
    fields: Record<string, unknown>
  },
  motherMap?: ReadonlyMap<string, MotherInfo>
): PlanningTask {
  const parentKey = parentObjectKey(issue.fields.parent)
  const mother = parentKey !== null ? motherMap?.get(parentKey) : undefined
  return {
    key: issue.key,
    summary: typeof issue.fields.summary === "string" ? issue.fields.summary : null,
    status: statusName(issue.fields.status),
    points: pointsOrNull(issue.fields[STORY_POINTS_FIELD]),
    assigneeDisplayName: assigneeDisplayName(issue.fields.assignee),
    assigneeAccountId: assigneeAccountId(issue.fields.assignee),
    reporter: assigneeDisplayName(issue.fields.reporter),
    components: componentNames(issue.fields.components),
    issueType: recordFieldName(issue.fields),
    devType: optionValue(issue.fields[DEV_TYPE_FIELD]),
    parentKey,
    parentSummary: mother?.summary ?? null,
    epic: mother?.epic ?? null,
    parentIssueType: parentIssueTypeOf(issue.fields.parent),
  }
}

/**
 * 撈此 sprint 的母票（Story / Task / Bug）再撈其下全部工作單（Dev-Task + QA-Task），
 * 回列表（估計＋未估計，含 status）。只重用 `sprintParentIssuesJql`／
 * `sprintChildTasksJql`，不手刻 JQL。
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

  // 1. 撈此 sprint 的母票（Story / Task / Bug），連同其 Epic。
  const { parentKeys, motherMap } = await fetchSprintMothers(credentials, sprint)

  // 2. 撈全部工作單（Dev-Task + QA-Task），投影成 PlanningTask（含 status、母票/Epic）。
  const tasks: PlanningTask[] = []
  if (parentKeys.size > 0) {
    for await (const issues of searchJiraIssues(
      credentials,
      sprintChildTasksJql([...parentKeys]),
      PLANNING_FIELDS
    )) {
      for (const issue of issues) {
        tasks.push(projectPlanningTask(issue, motherMap))
        if (tasks.length > MAX_DEVTASKS) {
          throw new JiraPlanningError("limit", "此 Sprint 的票數過多，無法提供精確結果。")
        }
      }
    }
  }

  return { taskCount: tasks.length, tasks, parentKeys: [...parentKeys] }
}

/** 撈此 sprint 的母票（Story / Task / Bug）key 及其 Epic；超過限制拋 `JiraPlanningError`。 */
async function fetchSprintMothers(
  credentials: JiraCredentials,
  sprint: SprintRecord
): Promise<{ parentKeys: Set<string>; motherMap: Map<string, MotherInfo> }> {
  const parentKeys = new Set<string>()
  const motherMap = new Map<string, MotherInfo>()
  let parents = 0
  for await (const issues of searchJiraIssues(
    credentials,
    sprintParentIssuesJql(sprint.id),
    MOTHER_FIELDS
  )) {
    for (const issue of issues) {
      parents += 1
      parentKeys.add(issue.key)
      motherMap.set(issue.key, {
        summary: typeof issue.fields.summary === "string" ? issue.fields.summary : null,
        issueType: recordFieldName(issue.fields.issuetype),
        epic: epicOf(issue.fields.parent),
      })
      if (parents > MAX_DEVTASKS) {
        throw new JiraPlanningError("limit", "此 Sprint 的票數過多，無法提供精確結果。")
      }
    }
  }
  return { parentKeys, motherMap }
}

/**
 * 撈 Planning 彈窗的子集合：
 * - `unestimated`／`unassigned`：母票之下的工作單（分別為未估時／未分派，Dev+QA）；
 * - `no-subtasks`：該 sprint 的 Story/Task/Bug 母票中，**沒有**任何 Dev-Task 或
 *   QA-Task 子票的母票（Jira 原生 JQL 沒有「無子單」運算子，故由 server 端以
 *   「全部母票 − 有子票的母票」比對出來）。統一投影成跟主表一致的 `PlanningTask[]`，
 *   只重用既有 builder，不手刻 JQL。
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

  // 「未開子單」是母票層級的比對：撈全部母票與全部工作單（Dev+QA），把「沒有子票」
  // 的母票列出來（Jira 原生 JQL 沒有「無子單」運算子，故以集合差集在 server 端計算）。
  if (kind === "no-subtasks") {
    return fetchNoSubtaskParents(credentials, sprint)
  }

  // 先撈母票 key，再用對應 builder 撈子集合的工作單。
  const { parentKeys } = await fetchSprintMothers(credentials, sprint)
  const parentKeysList = [...parentKeys]

  const jql =
    kind === "unestimated"
      ? sprintChildTasksUnestimatedJql(parentKeysList)
      : sprintChildTasksUnassignedJql(parentKeysList)

  const tasks: PlanningTask[] = []
  if (parentKeysList.length > 0) {
    for await (const issues of searchJiraIssues(credentials, jql, PLANNING_FIELDS)) {
      for (const issue of issues) {
        tasks.push(projectPlanningTask(issue))
        if (tasks.length > MAX_DEVTASKS) {
          throw new JiraPlanningError("limit", "此 Sprint 的票數過多，無法提供精確結果。")
        }
      }
    }
  }

  return { taskCount: tasks.length, tasks, parentKeys: parentKeysList }
}

/**
 * 撈此 sprint 的母票（含明細欄位），再把「沒有任何工作單（Dev-Task 或 QA-Task）
 * 子票」的那些母票投影成 `PlanningTask[]`，供「未開子單」彈窗顯示。Jira 原生無
 * 「無子單」運算子，故以「全部母票 − 有子票的母票」的集合差集比對，只重用既有
 * builder，不手刻 JQL。
 */
async function fetchNoSubtaskParents(
  credentials: JiraCredentials,
  sprint: SprintRecord
): Promise<{ taskCount: number; tasks: PlanningTask[]; parentKeys: string[] }> {
  // 1. 撈全部母票（含明細），以 key 索引。
  const parents = new Map<string, PlanningTask>()
  for await (const issues of searchJiraIssues(
    credentials,
    sprintParentIssuesJql(sprint.id),
    PLANNING_FIELDS
  )) {
    for (const issue of issues) {
      const task = projectPlanningTask(issue)
      parents.set(task.key, task)
      if (parents.size > MAX_DEVTASKS) {
        throw new JiraPlanningError("limit", "此 Sprint 的票數過多，無法提供精確結果。")
      }
    }
  }
  const parentKeysList = [...parents.keys()]

  // 2. 撈全部工作單（Dev+QA），收集「有子票」的母票 key（以 parent.fields.issuetype.name 取母票 key）。
  const parentsWithSubtask = new Set<string>()
  if (parentKeysList.length > 0) {
    let devTaskCount = 0
    for await (const issues of searchJiraIssues(
      credentials,
      sprintChildTasksJql(parentKeysList),
      PLANNING_FIELDS
    )) {
      for (const issue of issues) {
        devTaskCount += 1
        if (devTaskCount > MAX_DEVTASKS) {
          throw new JiraPlanningError("limit", "此 Sprint 的票數過多，無法提供精確結果。")
        }
        const parentKey = parentObjectKey(issue.fields.parent)
        if (parentKey !== null) parentsWithSubtask.add(parentKey)
      }
    }
  }

  // 3. 母票中「沒有子票」的，按母票原順序列出。
  const tasks = parentKeysList
    .filter((key) => !parentsWithSubtask.has(key))
    .map((key) => parents.get(key)!)
  return { taskCount: tasks.length, tasks, parentKeys: parentKeysList }
}

/** 從 Jira `parent` 欄位取出母票 key；不是母票物件或無 key 回 null。 */
function parentObjectKey(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const key = (value as Record<string, unknown>).key
  return typeof key === "string" && key.length > 0 ? key : null
}
import "server-only"

import { STORY_POINTS_FIELD, ACTUAL_STORY_POINTS_FIELD, JIRA_FIELDS } from "@/lib/jira-fields"
import { searchJiraIssues } from "@/lib/jira-dashboard"
import { memberAnalysisDevTasksJql } from "@/lib/jira-jql"
import { analysisCalendarDate } from "@/lib/workload-heatmap"
import { JiraWorkloadError, workloadScope } from "@/lib/jira-workload"
import type { DashboardFilter } from "@/lib/jira-dashboard-filter"
import type { MemberAnalysisFilter } from "@/lib/member-analysis-filter"
import type { DateRange } from "@/lib/date-range"
import type { MemberAnalysisIssue, MemberAnalysisResult } from "@/lib/member-analysis"

/** 與管理者屏蔽清單一致：這些顯示名稱的票不計入成員分析（他們不參與開發）。 */
import { isExcludedMemberName } from "@/lib/jira-dashboard-filter"

const SELECTED_FIELDS = ["summary", "assignee", "resolutiondate", STORY_POINTS_FIELD, ACTUAL_STORY_POINTS_FIELD, JIRA_FIELDS.devType.id]

function pointValue(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new JiraWorkloadError("invalid_response", "Jira 回傳了無法識別的點數，無法提供精確結果。")
  }
  return value
}

function devTypeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "object" && !Array.isArray(value)) {
    const name = (value as Record<string, unknown>).value
    return typeof name === "string" && name.trim() ? name : null
  }
  throw new JiraWorkloadError("invalid_response", "Jira 回傳了無法識別的 Dev Type，無法提供精確結果。")
}

function assignee(value: unknown): { accountId: string | null; displayName: string | null } {
  if (typeof value !== "object" || value === null) return { accountId: null, displayName: null }
  const record = value as Record<string, unknown>
  const accountId = typeof record.accountId === "string" && record.accountId.trim() ? record.accountId : null
  const displayName = typeof record.displayName === "string" && record.displayName.trim() ? record.displayName : null
  return { accountId, displayName }
}

/**
 * 成員分析的唯一資料來源：一次完整分頁，取回所選成員在區間內 resolved 的 Dev-Task。
 * 以 `resolutiondate`（UTC+8 切日）落在區間內才保留；重複 key 只計一次。
 */
export async function getMemberAnalysis(filter: MemberAnalysisFilter, range: DateRange): Promise<MemberAnalysisResult> {
  // Dashboard serializer 只在日期等於 30 時才省略 `days`；`days` 不代表查詢範圍。
  const { scope, credentials } = await workloadScope({ mode: "team-project", groups: filter.groups, exclusions: filter.exclusions, projects: filter.projects, days: 30 } satisfies DashboardFilter)
  const jql = memberAnalysisDevTasksJql(scope, range)
  const seen = new Set<string>()
  const issues: MemberAnalysisIssue[] = []
  for await (const page of searchJiraIssues(credentials, jql, SELECTED_FIELDS)) {
    for (const issue of page) {
      if (seen.has(issue.key)) continue
      seen.add(issue.key)
      const person = assignee(issue.fields.assignee)
      // 主管屏蔽清單：即使被選進範圍（例如舊網址），他們的票也不計入。
      if (person.displayName && isExcludedMemberName(person.displayName)) continue
      // 查詢條件是「區間內 resolved 或區間內建立」：未完成的票沒有 Resolved 日期，保留為 null。
      const resolvedDate = analysisCalendarDate(issue.fields.resolutiondate)
      if (resolvedDate !== null && (resolvedDate < range.from || resolvedDate > range.to)) {
        throw new JiraWorkloadError("invalid_response", "Jira 回傳的 Resolved 日期與查詢條件不一致，無法提供精確結果。")
      }
      issues.push({
        key: issue.key,
        assigneeAccountId: person.accountId,
        assigneeDisplayName: person.displayName,
        devType: devTypeValue(issue.fields[JIRA_FIELDS.devType.id]),
        points: pointValue(issue.fields[STORY_POINTS_FIELD]),
        actualPoints: pointValue(issue.fields[ACTUAL_STORY_POINTS_FIELD]),
        resolvedDate,
      })
    }
  }
  return { issues, jql, jiraBaseUrl: jiraBaseUrlForDisplay(), from: range.from, to: range.to }
}

/** 顯示用的 Jira 站點（僅用於「在 Jira 開啟」連結，不參與查詢），與其他儀表板查詢同一設定。 */
function jiraBaseUrlForDisplay(): string | null {
  try {
    const url = new URL(process.env.ATLASSIAN_JIRA_CLOUD_URL ?? "")
    return url.protocol === "https:" ? url.origin : null
  } catch {
    return null
  }
}

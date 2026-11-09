import { PageHeader } from "@/components/page-header"
import { BurndownClient } from "@/app/(app)/sprint/burndown/burndown-client"
import {
  parseProjectKey,
  parseSprintId,
  resolveSprint,
  isValidLegacyByResolved,
  burndownQueryParams,
} from "@/lib/burndown-params"
import {
  getVisibleSprints,
  type SprintRecord,
} from "@/lib/jira-sprint-data"
import { burndownJiraBaseUrl } from "@/lib/jira-burndown"

export const metadata = {
  title: "開發狀況",
}

export default async function BurndownPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; sprint?: string; byResolved?: string | string[] }>
}) {
  const params = await searchParams
  const validLegacyFlag = isValidLegacyByResolved(params.byResolved)
  const project = parseProjectKey(params.project)
  const today = new Date().toISOString().slice(0, 10)

  const visibleSprints: SprintRecord[] = project
    ? [...getVisibleSprints(project, today)]
    : []
  const requestedSprintId = parseSprintId(params.sprint)
  const selectedSprint = resolveSprint(project, requestedSprintId, today)

  // 燃盡資料由 client 以 SSE 自 `/api/sprint/burndown/stream` 漸進取得；
  // page 不再阻塞式撈 Jira，只提供 shell 與串流端點。
  const endpoint =
    project && selectedSprint && validLegacyFlag
      ? `/api/sprint/burndown/stream?${burndownQueryParams(project, selectedSprint.id)}`
      : null
  const jiraBaseUrl = burndownJiraBaseUrl()

  return (
    <>
      <PageHeader
        title="開發狀況"
      />

      <BurndownClient
        project={project}
        sprints={visibleSprints}
        selectedSprintId={selectedSprint?.id ?? null}
        sprint={selectedSprint ?? null}
        endpoint={endpoint}
        filterError={validLegacyFlag ? null : "舊版完成日期參數無效，請移除 byResolved 後重試。"}
        jiraBaseUrl={jiraBaseUrl}
      />
    </>
  )
}
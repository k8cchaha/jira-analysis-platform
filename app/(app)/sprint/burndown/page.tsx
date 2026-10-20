import { PageHeader } from "@/components/page-header"
import { BurndownClient } from "@/app/(app)/sprint/burndown/burndown-client"
import {
  parseProjectKey,
  parseSprintId,
  resolveSprint,
} from "@/lib/burndown-params"
import {
  getVisibleSprints,
  type SprintRecord,
} from "@/lib/jira-sprint-data"
import { burndownJiraBaseUrl } from "@/lib/jira-burndown"

export const metadata = {
  title: "Burn Down Chart",
}

export default async function BurndownPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; sprint?: string }>
}) {
  const params = await searchParams
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
    project && selectedSprint
      ? `/api/sprint/burndown/stream?project=${encodeURIComponent(project)}&sprint=${selectedSprint.id}`
      : null
  const jiraBaseUrl = burndownJiraBaseUrl()

  return (
    <>
      <PageHeader
        title="Burn Down Chart"
      />

      <BurndownClient
        project={project}
        sprints={visibleSprints}
        selectedSprintId={selectedSprint?.id ?? null}
        sprint={selectedSprint ?? null}
        endpoint={endpoint}
        jiraBaseUrl={jiraBaseUrl}
      />
    </>
  )
}
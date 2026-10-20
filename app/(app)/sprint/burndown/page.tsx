import { PageHeader } from "@/components/page-header"
import { BurndownClient } from "@/app/(app)/sprint/burndown/burndown-client"
import { SPRINT_PROJECTS, type SprintProjectKey } from "@/lib/jira-jql"
import {
  currentSprint,
  getVisibleSprints,
  type SprintRecord,
} from "@/lib/jira-sprint-data"
import {
  burndownJiraBaseUrl,
  getBurndownData,
  JiraBurndownError,
} from "@/lib/jira-burndown"

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
  const ids = new Set(visibleSprints.map((sprint) => sprint.id))
  const requestedSprintId = parseSprintId(params.sprint)
  const selectedSprint =
    requestedSprintId !== null && ids.has(requestedSprintId)
      ? visibleSprints.find((sprint) => sprint.id === requestedSprintId) ?? null
      : currentSprint(visibleSprints, today)

  // 有選到 sprint 才撈燃盡資料（唯讀）。團隊過濾在站內由 BurndownClient 進行，不重發 JQL。
  const loaded = project && selectedSprint ? await loadBurndown(selectedSprint) : null
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
        data={loaded?.ok ? loaded.data : undefined}
        error={loaded && !loaded.ok ? loaded.error : undefined}
        jiraBaseUrl={jiraBaseUrl}
      />
    </>
  )
}

async function loadBurndown(sprint: SprintRecord): Promise<
  | { ok: true; data: Awaited<ReturnType<typeof getBurndownData>> }
  | { ok: false; error: string }
> {
  try {
    return { ok: true, data: await getBurndownData(sprint) }
  } catch (error) {
    const message =
      error instanceof JiraBurndownError
        ? error.message
        : "暫時無法取得燃盡圖資料，請稍後重試。"
    return { ok: false, error: message }
  }
}

function parseProjectKey(value: string | undefined): SprintProjectKey | null {
  if (typeof value !== "string") return null
  return (SPRINT_PROJECTS as readonly { key: string }[]).some(
    (option) => option.key === value
  )
    ? (value as SprintProjectKey)
    : null
}

function parseSprintId(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
import { PageHeader } from "@/components/page-header"
import { PlanningClient } from "@/app/(app)/sprint/planning/planning-client"
import {
  parseProjectKey,
  parseSprintId,
  resolvePlanningSprint,
} from "@/lib/burndown-params"
import {
  getPlanningSprints,
  type SprintRecord,
} from "@/lib/jira-sprint-data"
import {
  getPlanningData,
  JiraPlanningError,
} from "@/lib/planning-data"
import { dashboardJiraBaseUrl } from "@/lib/jira-dashboard"
import type { PlanningTask, ReporterParent } from "@/lib/planning-subset"

export const metadata = {
  title: "Planning",
}

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; sprint?: string }>
}) {
  const params = await searchParams
  const project = parseProjectKey(params.project)
  const today = new Date().toISOString().slice(0, 10)

  const planningSprints: SprintRecord[] = project
    ? [...getPlanningSprints(project, today)]
    : []
  const selectedSprint = resolvePlanningSprint(
    project,
    parseSprintId(params.sprint),
    today
  )

  let tasks: PlanningTask[] = []
  let parents: ReporterParent[] = []
  let pmFpmAccountIds: string[] = []
  let pmOpmAccountIds: string[] = []
  let dataError: { code: string; message: string } | null = null
  if (project && selectedSprint) {
    try {
      const data = await getPlanningData(selectedSprint)
      tasks = data.tasks
      parents = data.parents
      pmFpmAccountIds = data.pmRanking.fpmAccountIds
      pmOpmAccountIds = data.pmRanking.opmAccountIds
    } catch (error) {
      dataError =
        error instanceof JiraPlanningError
          ? { code: error.code, message: error.message }
          : { code: "request_failed", message: "暫時無法取得 Jira 資料。" }
    }
  }

  return (
    <>
      <PageHeader
        title="Planning"
      />

      <PlanningClient
        project={project}
        sprints={planningSprints}
        selectedSprintId={selectedSprint?.id ?? null}
        sprint={selectedSprint ?? null}
        tasks={tasks}
        parents={parents}
        pmFpmAccountIds={pmFpmAccountIds}
        pmOpmAccountIds={pmOpmAccountIds}
        dataError={dataError}
        jiraBaseUrl={dashboardJiraBaseUrl()}
      />
    </>
  )
}
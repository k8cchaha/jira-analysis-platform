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
  getPlanningSubset,
  JiraPlanningError,
  planningJiraBaseUrl,
  type PlanningTask,
} from "@/lib/planning-data"

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
  let dataError: { code: string; message: string } | null = null
  let unestimated: PlanningTask[] | null = null
  let unassigned: PlanningTask[] | null = null
  if (project && selectedSprint) {
    try {
      const data = await getPlanningData(selectedSprint)
      tasks = data.tasks
      // 「未估時／未分派」彈窗的單也在此 server 端撈好（見 lib/planning-data.ts
      // 的 getPlanningSubset），client 只顯示，不自行組 JQL / 撈 Jira。
      unestimated = (await getPlanningSubset(selectedSprint, "unestimated")).tasks
      unassigned = (await getPlanningSubset(selectedSprint, "unassigned")).tasks
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
        description="規劃衝刺內容與估算（列出所選 Sprint 的 Dev-Task 明細）。"
      />

      <PlanningClient
        project={project}
        sprints={planningSprints}
        selectedSprintId={selectedSprint?.id ?? null}
        sprint={selectedSprint ?? null}
        tasks={tasks}
        dataError={dataError}
        unestimated={unestimated}
        unassigned={unassigned}
        jiraBaseUrl={planningJiraBaseUrl()}
      />
    </>
  )
}
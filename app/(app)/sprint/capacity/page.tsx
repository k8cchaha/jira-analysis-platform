import { auth } from "@/auth"
import { PageHeader } from "@/components/page-header"
import { CapacityClient } from "@/app/(app)/sprint/capacity/capacity-client"
import { parseProjectKey, parseSprintId, resolvePlanningSprint } from "@/lib/burndown-params"
import { getPlanningSprints } from "@/lib/jira-sprint-data"

export const metadata = {
  title: "Capacity",
}

export default async function CapacityPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; sprint?: string }>
}) {
  const params = await searchParams
  const project = parseProjectKey(params.project)
  const today = new Date().toISOString().slice(0, 10)
  const sprints = project ? [...getPlanningSprints(project, today)] : []
  const sprint = resolvePlanningSprint(project, parseSprintId(params.sprint), today)
  const session = await auth()

  return (
    <>
      <PageHeader title="Capacity" />
      <CapacityClient
        project={project}
        sprints={sprints}
        selectedSprintId={sprint?.id ?? null}
        sprint={sprint}
        viewerAccountId={session?.user?.id ?? ""}
      />
    </>
  )
}

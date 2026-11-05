import { ComingSoon } from "@/components/coming-soon"
import { projectsFilterResult } from "@/lib/projects-filter"
import { ProjectsFilter } from "./projects-filter"

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const filter = projectsFilterResult(await searchParams)

  return (
    <ComingSoon
      title="專案分析"
      showDescription={false}
      description="檢視專案的 Jira 工作分析。"
      filters={<ProjectsFilter {...filter} />}
    />
  )
}

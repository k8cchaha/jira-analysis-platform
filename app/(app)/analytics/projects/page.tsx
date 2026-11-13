import { PageHeader } from "@/components/page-header"
import { projectsFilterResult } from "@/lib/projects-filter"
import { ProjectsQueryClient } from "./projects-query-client"

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const filter = projectsFilterResult(await searchParams)
  return <div className="min-w-0 space-y-6">
    <PageHeader title="專案回顧與趨勢" />
    <ProjectsQueryClient {...filter} />
  </div>
}

import { ComingSoon } from "@/components/coming-soon"
import { projectsFilterResult } from "@/lib/projects-filter"
import { ProjectsFilter } from "./projects-filter"

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const filter = projectsFilterResult(await searchParams)

  return (
    <ComingSoon
      title="專案回顧與趨勢"
      showDescription={false}
      description="回顧專案的 Jira 工作，觀察跨期趨勢並在相同條件下比較結果。"
      filters={<ProjectsFilter {...filter} />}
    />
  )
}

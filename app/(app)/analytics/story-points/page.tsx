import { ComingSoon } from "@/components/coming-soon"
import { teamAnalysisFilterResult } from "@/lib/team-analysis-filter"
import { TeamAnalysisFilter } from "./team-analysis-filter"

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const filter = teamAnalysisFilterResult(await searchParams)
  return <ComingSoon title="團隊分析" showDescription={false} description="檢視團隊的 Jira 工作分析。" filters={<TeamAnalysisFilter {...filter} />} />
}

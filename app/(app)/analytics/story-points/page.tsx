import { PageHeader } from "@/components/page-header"
import { teamAnalysisFilterResult } from "@/lib/team-analysis-filter"
import { TeamAnalysisFilter } from "./team-analysis-filter"

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // The filter owns the whole page below the header: it queries `/api/analytics/members` itself and renders the
  // member summary table, so no placeholder block follows it.
  const filter = teamAnalysisFilterResult(await searchParams)
  return <>
    <PageHeader title="成員分析" />
    <div className="mb-8"><TeamAnalysisFilter {...filter} /></div>
  </>
}

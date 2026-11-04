import { PageHeader } from "@/components/page-header"
import { dashboardJiraBaseUrl } from "@/lib/jira-dashboard"
import { dashboardSearchParams } from "@/lib/jira-dashboard-filter"
import { serializeWorkloadFilter, workloadFilterResult } from "@/lib/workload-filter"
import { WorkloadQueryClient } from "./workload-query-client"

export const metadata = { title: "工作量分析" }

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = dashboardSearchParams(await searchParams)
  const { filter, error } = workloadFilterResult(params)
  const key = error ? `invalid:${params.toString()}` : filter ? serializeWorkloadFilter(filter) : "empty"
  // 端點由 RSC 產生：client 不自行組查詢字串，只負責開流。
  const endpoint = filter ? `/api/analytics/workload/heatmap/stream?${serializeWorkloadFilter(filter)}` : null

  return (
    <>
      <PageHeader title="工作量分析" />
      {/* 協調元件不帶 key：URL 更新還原表單，但不能代替此次頁面的明確提交。 */}
      <WorkloadQueryClient filter={filter} error={error} filterKey={key} endpoint={endpoint} jiraBaseUrl={dashboardJiraBaseUrl()} />
    </>
  )
}

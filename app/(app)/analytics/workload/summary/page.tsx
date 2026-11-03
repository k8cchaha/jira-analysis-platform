import { PageHeader } from "@/components/page-header"
import { dashboardJiraBaseUrl } from "@/lib/jira-dashboard"
import { dashboardSearchParams } from "@/lib/jira-dashboard-filter"
import { serializeWorkloadFilter, workloadFilterResult } from "@/lib/workload-filter"
import { WorkloadFilterForm } from "./workload-filter"
import { WorkloadHeatmapClient } from "./workload-heatmap-client"

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
      {/* `key` 綁定查詢條件，讓表單草稿在條件變更時重設。 */}
      <WorkloadFilterForm key={key} initialFilter={filter} initialError={error} />
      {/* 不帶 key：`endpoint` 與表單的 key 同源，重設已由內部 `HeatmapStream`
          的 key 完成；這裡再掛一次 key 會與上面的表單變成同一個 fragment 下
          兩個相同 key 的 sibling，React 會警告重複 key。 */}
      {filter && <WorkloadHeatmapClient filter={filter} endpoint={endpoint} jiraBaseUrl={dashboardJiraBaseUrl()} />}
    </>
  )
}

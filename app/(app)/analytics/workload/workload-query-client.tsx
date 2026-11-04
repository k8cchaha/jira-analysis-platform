"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { serializeWorkloadFilter, workloadHref, type WorkloadFilter } from "@/lib/workload-filter"
import { WorkloadFilterForm } from "./workload-filter"
import { WorkloadHeatmapClient } from "./workload-heatmap-client"

/** URL 只還原條件；此次頁面上的明確提交才允許開啟工作量串流。 */
export function WorkloadQueryClient({ filter, error, filterKey, endpoint, jiraBaseUrl }: {
  filter: WorkloadFilter | null
  error: string | null
  filterKey: string
  endpoint: string | null
  jiraBaseUrl: string | null
}) {
  const router = useRouter()
  const [query, setQuery] = useState({ urlKey: filterKey, submittedKey: null as string | null, nonce: 0 })

  // 只保留明確提交自己的 origin → target 導航；其他條件變動一律取消，不能回切復活。
  // 在 render 階段調整本元件狀態，避免 effect 清理前短暫開啟未提交的串流。
  if (query.urlKey !== filterKey) {
    setQuery({ ...query, urlKey: filterKey, submittedKey: query.submittedKey === filterKey ? filterKey : null })
  }

  useEffect(() => {
    const cancelQuery = () => setQuery((current) => ({ ...current, submittedKey: null }))
    // 即使 history entry 的條件相同，返回／前進也不應重新執行查詢。
    window.addEventListener("popstate", cancelQuery)
    return () => window.removeEventListener("popstate", cancelQuery)
  }, [])

  function submit(next: WorkloadFilter) {
    const href = workloadHref(next)
    const submittedKey = serializeWorkloadFilter(next)
    setQuery((current) => ({ urlKey: filterKey, submittedKey, nonce: current.nonce + 1 }))
    router.push(href)
  }

  return (
    <>
      <WorkloadFilterForm key={filterKey} initialFilter={filter} initialError={error} onQuery={submit} />
      {filter && <WorkloadHeatmapClient
        filter={filter}
        endpoint={query.submittedKey === filterKey ? endpoint : null}
        queryNonce={query.nonce}
        jiraBaseUrl={jiraBaseUrl}
      />}
    </>
  )
}

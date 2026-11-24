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
  // `busyKey`: the submission waiting for navigation or stream completion.
  // `latestKey`: the most recent submission, so a rapid re-submit replaces the previous one instead of being
  // silently dropped while the first URL is still in flight.
  const [query, setQuery] = useState({ urlKey: filterKey, submittedKey: null as string | null, nonce: 0, busyKey: null as string | null, latestKey: null as string | null })

  // 只保留明確提交自己的 origin → target 導航；其他條件變動一律取消，不能回切復活。
  // 在 render 階段調整本元件狀態，避免 effect 清理前短暫開啟未提交的串流。
  if (query.urlKey !== filterKey) {
    setQuery({ ...query, urlKey: filterKey, submittedKey: query.submittedKey === filterKey ? filterKey : null, busyKey: query.submittedKey === filterKey ? query.busyKey : null, latestKey: query.latestKey === filterKey ? query.latestKey : null })
  }
  const pending = query.busyKey !== null
  const submit = (next: WorkloadFilter) => {
    const href = workloadHref(next)
    const key = serializeWorkloadFilter(next)
    // 只擋「完全相同條件的重送」，仍允許最新的另一筆提交取代前一筆（快速連按）。
    if (pending && key === query.latestKey) return
    setQuery((current) => ({ urlKey: current.urlKey, submittedKey: key, nonce: current.nonce + 1, busyKey: key, latestKey: key }))
    router.push(href)
  }

  useEffect(() => {
    const cancelQuery = () => setQuery((current) => ({ ...current, submittedKey: null, busyKey: null, latestKey: null }))
    // 即使 history entry 的條件相同，返回／前進也不應重新執行查詢。
    window.addEventListener("popstate", cancelQuery)
    return () => window.removeEventListener("popstate", cancelQuery)
  }, [])

  return (
    <>
      <WorkloadFilterForm key={filterKey} initialFilter={filter} initialError={error} onQuery={submit} loading={pending} />
      {filter && <WorkloadHeatmapClient
        filter={filter}
        endpoint={query.submittedKey === filterKey ? endpoint : null}
        queryNonce={query.nonce}
        jiraBaseUrl={jiraBaseUrl}
        onQuerySettled={() => setQuery((current) => current.nonce === query.nonce && current.busyKey === filterKey ? { ...current, busyKey: null, latestKey: null } : current)}
      />}
    </>
  )
}

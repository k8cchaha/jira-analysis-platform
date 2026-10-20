"use client"

import { useEffect, useState } from "react"
import { EditDialog } from "@/components/edit-dialog"
import { dashboardHref, serializeDashboardFilter, type DashboardFilter } from "@/lib/jira-dashboard-filter"
import { parseBugAlertDetailsResult, type BugAlertDetailsResult, type BugAlertIssue } from "@/lib/jira-dashboard-alerts"
import { reauthorizeDashboardAction } from "./actions"

const secondaryButton = "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"

export function BugAlertDialog({ filter, scopeChanged, onClose }: { filter: DashboardFilter; scopeChanged: boolean; onClose: () => void }) {
  const query = serializeDashboardFilter(filter)
  const showAssignee = filter.mode !== "self"
  const [request, setRequest] = useState(0)
  const [accepted, setAccepted] = useState<{ query: string; request: number; result: BugAlertDetailsResult } | null>(null)
  const [reauthorizing, setReauthorizing] = useState(false)
  const [authorizationError, setAuthorizationError] = useState("")
  const result = accepted?.query === query && accepted.request === request ? accepted.result : null
  const loading = result === null
  const data = result?.status === "success" ? result.data : null
  const error = result?.status === "error" ? result.error : null

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    queueMicrotask(async () => {
      if (!active) return
      try {
        const response = await fetch(`/api/dashboard/alerts/bugs${query ? `?${query}` : ""}`, { cache: "no-store", signal: controller.signal })
        const result = parseBugAlertDetailsResult(await response.json())
        if (!response.ok && result.status === "success") throw new Error("Invalid response")
        if (active) setAccepted({ query, request, result })
      } catch {
        if (active) setAccepted({ query, request, result: { status: "error", error: { code: "retry", message: "無法載入 Bug 明細，請重試。" } } })
      }
    })
    return () => { active = false; controller.abort() }
  }, [query, request])

  async function reauthorize() {
    if (reauthorizing) return
    setReauthorizing(true)
    setAuthorizationError("")
    try { await reauthorizeDashboardAction(dashboardHref(filter)) }
    catch { setAuthorizationError("無法開始重新授權，請稍後再試。") }
    finally { setReauthorizing(false) }
  }

  return (
    <EditDialog title="Bug 警示明細" description="S0／S1 與超過10天未更新的 S2 Bug，只讀明細。" count={data ? data.s0s1.length + data.s2.length : null} compact iconClose onClose={onClose}>
      {scopeChanged && <p role="status" className="shrink-0 border-b border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30">網址篩選已變更，此彈窗保留開啟時的範圍。關閉後再顯示新範圍。</p>}
      <div aria-busy={loading} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading ? <div role="status" className="space-y-4 p-4 sm:p-6"><span className="sr-only">正在載入 Bug 明細</span>{[1, 2, 3].map((index) => <div key={index} aria-hidden="true" className="h-24 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />)}</div> : error ? (
          <div role="alert" className="m-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            <p>{authorizationError || error.message}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" onClick={() => { setAuthorizationError(""); setRequest((current) => current + 1) }} className={secondaryButton}>重試載入</button>
              {(error.code === "reauthorize" || error.code === "forbidden") && <button type="button" disabled={reauthorizing} onClick={() => void reauthorize()} className={secondaryButton}>{reauthorizing ? "處理中…" : "重新授權 Jira"}</button>}
            </div>
          </div>
        ) : data && <>
          <BugGroup title="S0／S1" issues={data.s0s1} showAssignee={showAssignee} jiraBaseUrl={data.jiraBaseUrl} />
          <hr className="mx-4 border-t-2 border-slate-300 sm:mx-6 dark:border-slate-700" />
          <BugGroup title="S2 超過10天未更新" issues={data.s2} showAssignee={showAssignee} jiraBaseUrl={data.jiraBaseUrl} />
        </>}
      </div>
    </EditDialog>
  )
}

function BugGroup({ title, issues, showAssignee, jiraBaseUrl }: { title: string; issues: BugAlertIssue[]; showAssignee: boolean; jiraBaseUrl: string | null }) {
  return (
    <section className="py-4 sm:py-5" aria-label={title}>
      <h3 className="px-4 pb-3 text-sm font-semibold sm:px-6">{title} <span className="ml-2 text-slate-500 dark:text-slate-400">{issues.length.toLocaleString("zh-TW")} 張 Issue</span></h3>
      {issues.length === 0 ? <p className="px-4 py-4 text-sm text-slate-600 sm:px-6 dark:text-slate-400">目前沒有符合條件的 Bug。</p> : <>
        <div className="hidden overflow-x-auto px-4 sm:px-6 md:block">
          <table className="w-full min-w-[800px] table-fixed text-left text-sm">
            <caption className="sr-only">{title} Bug 明細</caption>
            <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <tr><th scope="col" className="w-32 px-3 py-3 font-medium">Ticket</th><th scope="col" className="w-36 px-3 py-3 font-medium">Priority</th><th scope="col" className="px-3 py-3 font-medium">Summary</th>{showAssignee && <th scope="col" className="w-36 px-3 py-3 font-medium">Assignee</th>}<th scope="col" className="w-32 px-3 py-3 font-medium">Status</th><th scope="col" className="w-28 px-3 py-3 font-medium">未更新天數</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {issues.map((issue) => <tr key={issue.id} className="align-top">
                <td className="px-3 py-3"><Ticket issue={issue} jiraBaseUrl={jiraBaseUrl} /></td><td className="break-words px-3 py-3">{issue.priority}</td><td className="break-words px-3 py-3">{issue.summary}</td>{showAssignee && <td className="break-words px-3 py-3">{issue.assigneeDisplayName || "—"}</td>}<td className="break-words px-3 py-3">{issue.status}</td><td className="px-3 py-3 tabular-nums">{issue.updatedDays === null ? "—" : `${issue.updatedDays} 天`}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 px-4 md:hidden">
          {issues.map((issue) => <article key={issue.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <p className="text-sm font-medium"><Ticket issue={issue} jiraBaseUrl={jiraBaseUrl} /></p>
            <dl className="mt-3 space-y-2 text-sm">
              <div><dt className="text-xs text-slate-500 dark:text-slate-400">Priority</dt><dd className="mt-1 break-words">{issue.priority}</dd></div>
              <div><dt className="text-xs text-slate-500 dark:text-slate-400">Summary</dt><dd className="mt-1 break-words">{issue.summary}</dd></div>
              {showAssignee && <div><dt className="text-xs text-slate-500 dark:text-slate-400">Assignee</dt><dd className="mt-1 break-words">{issue.assigneeDisplayName || "—"}</dd></div>}
              <div><dt className="text-xs text-slate-500 dark:text-slate-400">Status</dt><dd className="mt-1 break-words">{issue.status}</dd></div>
              <div><dt className="text-xs text-slate-500 dark:text-slate-400">未更新天數</dt><dd className="mt-1 tabular-nums">{issue.updatedDays === null ? "—" : `${issue.updatedDays} 天`}</dd></div>
            </dl>
          </article>)}
        </div>
      </>}
    </section>
  )
}

function Ticket({ issue, jiraBaseUrl }: { issue: BugAlertIssue; jiraBaseUrl: string | null }) {
  return jiraBaseUrl ? <a href={`${jiraBaseUrl}/browse/${encodeURIComponent(issue.key)}`} target="_blank" rel="noopener noreferrer" aria-label={`${issue.key}（另開 Jira 視窗）`} className="break-words font-medium text-blue-700 hover:underline dark:text-blue-300">{issue.key}</a> : <span className="break-words font-medium">{issue.key}</span>
}

"use client"

import { useEffect, useRef, useState } from "react"
import { dashboardHref, parseDashboardFilter } from "@/lib/jira-dashboard-filter"
import { parseDashboardAlertResult, type DashboardAlertKind, type DashboardAlertResult } from "@/lib/jira-dashboard-alerts"
import type { MissingDataError } from "@/lib/jira-missing-data"
import { reauthorizeDashboardAction } from "./actions"
import { BugAlertCard } from "./bug-alert-card"
import { PendingIssueCard } from "./pending-issue-card"
import { DueReminderCard } from "./due-reminder-card"

type AlertState = { status: "loading" } | DashboardAlertResult

function useAlertCounts(kind: DashboardAlertKind, query: string) {
  const [request, setRequest] = useState(0)
  const [accepted, setAccepted] = useState<{ query: string; request: number; state: AlertState }>({ query, request, state: { status: "loading" } })
  const sequence = useRef(0)

  useEffect(() => {
    const generation = ++sequence.current
    const controller = new AbortController()
    let active = true
    queueMicrotask(async () => {
      if (!active) return
      setAccepted({ query, request, state: { status: "loading" } })
      try {
        const params = new URLSearchParams(query)
        params.set("kind", kind)
        const response = await fetch(`/api/dashboard/alerts?${params}`, { cache: "no-store", signal: controller.signal })
        const state = parseDashboardAlertResult(kind, await response.json())
        if (!active || generation !== sequence.current) return
        if (!response.ok && state.status === "success") throw new Error("Invalid response")
        setAccepted({ query, request, state })
      } catch {
        if (!active || generation !== sequence.current) return
        setAccepted({ query, request, state: { status: "error", error: { code: "retry", message: "無法載入警示筆數，請重試。" } } })
      }
    })
    return () => { active = false; controller.abort() }
  }, [kind, query, request])

  return {
    state: accepted.query === query && accepted.request === request ? accepted.state : { status: "loading" } as AlertState,
    retry: () => setRequest((current) => current + 1),
  }
}

function AlertError({ error, query, retry }: { error: MissingDataError; query: string; retry: () => void }) {
  const [reauthorizing, setReauthorizing] = useState(false)
  const [authorizationError, setAuthorizationError] = useState("")
  async function reauthorize() {
    if (reauthorizing) return
    setReauthorizing(true)
    setAuthorizationError("")
    try { await reauthorizeDashboardAction(dashboardHref(parseDashboardFilter(new URLSearchParams(query)))) }
    catch { setAuthorizationError("無法開始重新授權，請稍後再試。") }
    finally { setReauthorizing(false) }
  }
  return (
    <div role="alert" className="mt-5 flex-1">
      <p className="text-sm leading-6 text-slate-800 dark:text-slate-200">無法取得精確筆數：{authorizationError || error.message}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={retry} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">重試</button>
        {(error.code === "reauthorize" || error.code === "forbidden") && <button type="button" disabled={reauthorizing} onClick={() => void reauthorize()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50">{reauthorizing ? "處理中…" : "重新授權 Jira"}</button>}
      </div>
    </div>
  )
}

export function DashboardAlertCards({ query, onOpenBugs, onOpenDue }: { query: string; onOpenBugs: () => void; onOpenDue: () => void }) {
  const bugs = useAlertCounts("bugs", query)
  const due = useAlertCounts("due", query)
  const pending = useAlertCounts("pending", query)
  const bugCounts = bugs.state.status === "success" && bugs.state.kind === "bugs" ? bugs.state.counts : null
  const pendingCounts = pending.state.status === "success" && pending.state.kind === "pending" ? pending.state.counts : null
  const dueCounts = due.state.status === "success" && due.state.kind === "due" ? due.state.counts : null
  return (
    <>
      <BugAlertCard onOpen={onOpenBugs} s0s1Count={bugCounts?.s0s1} s2Count={bugCounts?.s2} loading={bugs.state.status === "loading"} feedback={bugs.state.status === "error" ? <AlertError key={query} error={bugs.state.error} query={query} retry={bugs.retry} /> : null} />
      <DueReminderCard onOpen={onOpenDue} overdueCount={dueCounts?.overdue} upcomingCount={dueCounts?.upcoming} loading={due.state.status === "loading"} feedback={due.state.status === "error" ? <AlertError key={query} error={due.state.error} query={query} retry={due.retry} /> : null} />
      <PendingIssueCard inReviewCount={pendingCounts?.inReview} requestInfoCount={pendingCounts?.requestInfo} loading={pending.state.status === "loading"} feedback={pending.state.status === "error" ? <AlertError key={query} error={pending.state.error} query={query} retry={pending.retry} /> : null} />
    </>
  )
}

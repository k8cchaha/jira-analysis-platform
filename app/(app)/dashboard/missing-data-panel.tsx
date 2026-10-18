"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useNavigationBlocker } from "@/components/navigation-blocker"
import { DashboardFilter as DashboardFilterControls } from "./dashboard-filter"
import { SELF_FILTER, dashboardHref, serializeDashboardFilter, type DashboardFilter, type DashboardFilterResult } from "@/lib/jira-dashboard-filter"
import { MissingDataDialog } from "./missing-data-dialog"
import { reauthorizeDashboardAction } from "./actions"
import type { MissingDataKind, MissingDataSummaryResult } from "@/lib/jira-missing-data"

type CardState = { status: "loading" } | MissingDataSummaryResult
const kinds: MissingDataKind[] = ["points", "defect-cause"]

export function MissingDataPanel({ applied = { filter: SELF_FILTER, error: null }, viewerId = "" }: { applied?: DashboardFilterResult; viewerId?: string }) {
  const router = useRouter()
  const cardId = useId()
  const { isBlocked } = useNavigationBlocker()
  const [cards, setCards] = useState<Record<MissingDataKind, CardState>>({
    points: { status: "loading" }, "defect-cause": { status: "loading" },
  })
  const [activeDialog, setActiveDialog] = useState<{ kind: MissingDataKind; filter: DashboardFilter } | null>(null)
  // Keep the entire accepted scope stable until an open editor explicitly closes.
  const filter = activeDialog?.filter ?? applied.filter
  const query = filter ? serializeDashboardFilter(filter) : null
  const readOnly = filter?.mode !== "self"
  const [cardsQuery, setCardsQuery] = useState<string | null>(query)
  const scopeChanged = Boolean(activeDialog && (applied.filter ? serializeDashboardFilter(applied.filter) : null) !== query)
  const [reauthorizing, setReauthorizing] = useState(false)
  const requestSequence = useRef<Record<MissingDataKind, number>>({ points: 0, "defect-cause": 0 })
  const mounted = useRef(false)

  const loadSummary = useCallback(async (kind: MissingDataKind) => {
    if (query === null) return
    const sequence = ++requestSequence.current[kind]
    try {
      const params = new URLSearchParams(query)
      params.set("kind", kind)
      params.set("view", "summary")
      const response = await fetch(`/api/dashboard/missing-data?${params}`, { cache: "no-store" })
      const result: MissingDataSummaryResult = await response.json()
      if (!mounted.current || sequence !== requestSequence.current[kind]) return
      if (result.status !== "success" && result.status !== "error") throw new Error("Invalid response")
      setCards((current) => ({ ...current, [kind]: result }))
    } catch {
      if (mounted.current && sequence === requestSequence.current[kind]) {
        setCards((current) => ({ ...current, [kind]: { status: "error", error: { code: "retry", message: "無法載入缺失筆數，請重試。" } } }))
      }
    }
  }, [query])

  useEffect(() => {
    mounted.current = true
    const sequences = requestSequence.current
    let active = true
    // Independent GET requests: one slow/erroring category does not block the other.
    queueMicrotask(() => {
      if (!active) return
      setCardsQuery(query)
      setCards({ points: { status: "loading" }, "defect-cause": { status: "loading" } })
      if (query !== null) for (const kind of kinds) void loadSummary(kind)
    })
    return () => {
      active = false
      mounted.current = false
      for (const kind of kinds) sequences[kind] += 1
    }
  }, [loadSummary, query])

  function reloadSummary(kind: MissingDataKind) {
    setCards((current) => ({ ...current, [kind]: { status: "loading" } }))
    void loadSummary(kind)
  }

  async function reauthorize(kind: MissingDataKind) {
    if (reauthorizing) return
    setReauthorizing(true)
    try { await reauthorizeDashboardAction(dashboardHref(filter ?? SELF_FILTER)) }
    catch {
      if (mounted.current) setCards((current) => ({ ...current, [kind]: { status: "error", error: { code: "reauthorize", message: "無法開始重新授權，請稍後再試。" } } }))
    } finally {
      if (mounted.current) setReauthorizing(false)
    }
  }

  function applyFilter(next: DashboardFilter) {
    if (activeDialog || isBlocked) return
    if (next.mode === "self" && filter?.mode === "self") return
    router.push(dashboardHref(next))
  }

  return (
    <>
    <DashboardFilterControls key={`${viewerId}:${query ?? "invalid"}`} filter={filter} viewerId={viewerId} onApply={applyFilter} />
    {query === null ? <p role="alert" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30">{applied.error} 請重新設定上方篩選條件。</p> : <section aria-labelledby="missing-data-title">
      <div className="mb-4">
        <h2 id="missing-data-title" className="text-lg font-semibold text-slate-950 dark:text-white">待補資料</h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {kinds.map((kind) => {
          const card: CardState = cardsQuery === query ? cards[kind] : { status: "loading" }
          const title = kind === "points" ? "(Actual) Story Points 缺失" : "Defect Cause 缺失"
          return (
            <article key={kind} aria-busy={card.status === "loading"} className="relative flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
              <h3 id={`${cardId}-${kind}-title`} className="text-base font-semibold text-slate-950 dark:text-white">{title}</h3>
              {card.status === "loading" ? <MissingDataCardSkeleton /> : card.status === "error" ? (
                <div role="alert" className="mt-5 flex-1">
                  <p className="flex items-start gap-2 text-sm leading-6 text-slate-800 dark:text-slate-200"><WarningIcon /><span>無法取得精確筆數：{card.error.message}</span></p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" onClick={() => reloadSummary(kind)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">重試</button>
                    {(card.error.code === "reauthorize" || (readOnly && card.error.code === "forbidden")) && <button type="button" disabled={reauthorizing} onClick={() => void reauthorize(kind)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50">{reauthorizing ? "處理中…" : "重新授權 Jira"}</button>}
                  </div>
                </div>
              ) : (
                <>
                  <div className="mt-5 flex flex-1 flex-col items-start">
                    <p id={`${cardId}-${kind}-count`} className="flex items-baseline gap-2"><span className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">{card.summary.total.toLocaleString("zh-TW")}</span><span className="text-sm text-slate-600 dark:text-slate-400">張 Issue</span></p>
                    <div className="mt-auto w-full pt-5">
                      {card.summary.total === 0 ? (
                        <p className="flex items-center gap-2 text-sm font-semibold leading-6 text-green-600 dark:text-green-400"><svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg><span>資料完整，太棒了！</span></p>
                      ) : (
                        <p id={`${cardId}-${kind}-action`} className="text-sm font-semibold leading-6 text-blue-700 dark:text-blue-300">{readOnly ? "查看明細" : "查看明細與補填"} <span aria-hidden="true">→</span></p>
                      )}
                    </div>
                  </div>
                  {card.summary.total > 0 && <button type="button" aria-haspopup="dialog" aria-labelledby={`${cardId}-${kind}-title ${cardId}-${kind}-action`} aria-describedby={`${cardId}-${kind}-count`} onClick={() => { if (filter) setActiveDialog({ kind, filter }) }} className="absolute inset-0 cursor-pointer rounded-2xl transition-colors hover:bg-blue-50/40 active:bg-blue-100/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:hover:bg-blue-950/20 dark:active:bg-blue-900/30" />}
                </>
              )}
            </article>
          )
        })}
      </div>
      {activeDialog && <MissingDataDialog key={activeDialog.kind} kind={activeDialog.kind} filter={activeDialog.filter} scopeChanged={scopeChanged} onClose={() => setActiveDialog(null)} onSaved={() => reloadSummary(activeDialog.kind)} />}
    </section>}
    </>
  )
}

function WarningIcon() {
  return <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 10 18H2Z" /><path d="M12 9v5M12 17h.01" /></svg>
}

export function MissingDataCardSkeleton() {
  return <div role="status" className="mt-5 flex-1 space-y-4"><span className="sr-only">正在載入缺失筆數</span><div aria-hidden="true" className="h-10 w-28 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" /><div aria-hidden="true" className="h-4 w-40 animate-pulse rounded bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" /><div aria-hidden="true" className="h-16 w-full animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" /></div>
}

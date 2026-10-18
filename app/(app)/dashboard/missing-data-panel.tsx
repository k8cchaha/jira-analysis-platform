"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MissingDataDialog } from "./missing-data-dialog"
import { reauthorizeDashboardAction } from "./actions"
import type { MissingDataKind, MissingDataSummaryResult } from "@/lib/jira-missing-data"

type CardState = { status: "loading" } | MissingDataSummaryResult
const kinds: MissingDataKind[] = ["points", "defect-cause"]
const descriptions: Record<MissingDataKind, string> = {
  points: "指派給我、Done 的 DEV-Task / QA-Task，不限日期。SUN / TKK 僅納入 resolution 為 Done 或 Fixed。",
  "defect-cause": "SUN / TKK 指派給我的 Bug；排除 To Do 類別、In Progress 與 Dev Ready，resolution 為空、Done 或 Fixed。",
}

export function MissingDataPanel() {
  const [cards, setCards] = useState<Record<MissingDataKind, CardState>>({
    points: { status: "loading" }, "defect-cause": { status: "loading" },
  })
  const [activeKind, setActiveKind] = useState<MissingDataKind | null>(null)
  const [reauthorizing, setReauthorizing] = useState(false)
  const requestSequence = useRef<Record<MissingDataKind, number>>({ points: 0, "defect-cause": 0 })
  const mounted = useRef(false)

  const loadSummary = useCallback(async (kind: MissingDataKind) => {
    const sequence = ++requestSequence.current[kind]
    try {
      const params = new URLSearchParams({ kind, view: "summary" })
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
  }, [])

  useEffect(() => {
    mounted.current = true
    const sequences = requestSequence.current
    let active = true
    // Independent GET requests: one slow/erroring category does not block the other.
    queueMicrotask(() => {
      if (active) for (const kind of kinds) void loadSummary(kind)
    })
    return () => {
      active = false
      mounted.current = false
      for (const kind of kinds) sequences[kind] += 1
    }
  }, [loadSummary])

  function reloadSummary(kind: MissingDataKind) {
    setCards((current) => ({ ...current, [kind]: { status: "loading" } }))
    void loadSummary(kind)
  }

  async function reauthorize(kind: MissingDataKind) {
    if (reauthorizing) return
    setReauthorizing(true)
    try { await reauthorizeDashboardAction() }
    catch {
      if (mounted.current) setCards((current) => ({ ...current, [kind]: { status: "error", error: { code: "reauthorize", message: "無法開始重新授權，請稍後再試。" } } }))
    } finally {
      if (mounted.current) setReauthorizing(false)
    }
  }

  return (
    <section aria-labelledby="missing-data-title">
      <div className="mb-4">
        <h2 id="missing-data-title" className="text-lg font-semibold text-slate-950 dark:text-white">待補資料</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">查看目前缺失並直接補填 Jira。兩類獨立計算，筆數為 Issue 數量，而非欄位數量。</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {kinds.map((kind) => {
          const card = cards[kind]
          const title = kind === "points" ? "Points 缺失" : "Defect Cause 缺失"
          return (
            <article key={kind} aria-busy={card.status === "loading"} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-base font-semibold text-slate-950 dark:text-white">{title}</h3>
              <p className="mt-2 min-h-12 text-xs leading-5 text-slate-600 dark:text-slate-400">{descriptions[kind]}</p>
              {card.status === "loading" ? <MissingDataCardSkeleton /> : card.status === "error" ? (
                <div role="alert" className="mt-5 flex-1">
                  <p className="flex items-start gap-2 text-sm leading-6 text-slate-800 dark:text-slate-200"><WarningIcon /><span>無法取得精確筆數：{card.error.message}</span></p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" onClick={() => reloadSummary(kind)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">重試</button>
                    {card.error.code === "reauthorize" && <button type="button" disabled={reauthorizing} onClick={() => void reauthorize(kind)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50">{reauthorizing ? "處理中…" : "重新授權 Jira"}</button>}
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" aria-haspopup="dialog" onClick={() => setActiveKind(kind)} className="mt-5 flex flex-1 flex-col items-start rounded-xl p-1 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 dark:hover:bg-slate-800/50">
                    <span className="flex items-baseline gap-2"><span className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">{card.summary.total.toLocaleString("zh-TW")}</span><span className="text-sm text-slate-600 dark:text-slate-400">張 Issue</span></span>
                    <span className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">{card.summary.total > 0 && <WarningIcon />}<span>{card.summary.total > 0 ? "資料缺失，待補填" : "目前沒有符合範圍的資料缺失"}</span></span>
                    {kind === "points" && <span className="mt-4 space-y-1 text-xs leading-5 text-slate-600 dark:text-slate-400"><span className="block">Story Points 缺失：{card.summary.storyPointsMissing.toLocaleString("zh-TW")} 張</span><span className="block">Actual Story Points 缺失：{card.summary.actualStoryPointsMissing.toLocaleString("zh-TW")} 張</span><span className="block">兩欄皆缺失仍只算一張；上方總數為聯集，兩項不能直接相加。</span></span>}
                    <span className="mt-5 text-sm font-semibold text-blue-700 dark:text-blue-300">查看明細與補填 <span aria-hidden="true">→</span></span>
                  </button>
                </>
              )}
            </article>
          )
        })}
      </div>
      {activeKind && <MissingDataDialog key={activeKind} kind={activeKind} onClose={() => setActiveKind(null)} onSaved={() => reloadSummary(activeKind)} />}
    </section>
  )
}

function WarningIcon() {
  return <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 10 18H2Z" /><path d="M12 9v5M12 17h.01" /></svg>
}

export function MissingDataCardSkeleton() {
  return <div role="status" className="mt-5 flex-1 space-y-4"><span className="sr-only">正在載入缺失筆數</span><div aria-hidden="true" className="h-10 w-28 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" /><div aria-hidden="true" className="h-4 w-40 animate-pulse rounded bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" /><div aria-hidden="true" className="h-16 w-full animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" /></div>
}

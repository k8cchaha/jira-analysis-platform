"use client"

import { useEffect, useRef, useState } from "react"
import { useDefaultTeamGroups } from "@/components/filter-defaults-provider"
import { useTeamMembers } from "@/components/team-members-provider"
import { parseProjectsAnalysisRequest, parseProjectsAnalysisResult, projectsAnalysisFingerprint, projectsRecord, type ProjectsAnalysisRequest, type ProjectsAnalysisResult } from "@/lib/projects-analysis"
import type { ProjectsSelection } from "@/lib/projects-filter"
import { ProjectsFilter, type ProjectsFilterProps } from "./projects-filter"
import { ProjectsAnalysisView } from "./projects-analysis-view"

type QueryState = { scope: string; nonce: number; request: ProjectsAnalysisRequest | null; result: ProjectsAnalysisResult | null; loading: boolean; error: string | null }
const emptyQuery = (scope: string, nonce = 0): QueryState => ({ scope, nonce, request: null, result: null, loading: false, error: null })

/** 入頁／預設值／URL 還原不 fetch；取消與 render gate 都獨立防止舊結果復活。 */
export function ProjectsQueryClient(props: ProjectsFilterProps) {
  const [groups, changeGroups] = useDefaultTeamGroups(!props.error)
  const { groupStates } = useTeamMembers()
  const teamReady = groups.every((group) => groupStates[group]?.status === "success")
  const scope = JSON.stringify([props.project, props.selectedSprintIds, props.error, [...groups].sort()])
  const [query, setQuery] = useState<QueryState>(() => emptyQuery(scope))
  const controller = useRef<AbortController | null>(null)
  const nonce = useRef(0)

  // A→B→A 也會永久丟棄前次 A；不能只在渲染時隱藏舊結果。
  if (query.scope !== scope) setQuery(emptyQuery(scope, query.nonce + 1))
  const visible = query.scope === scope ? query : emptyQuery(scope)
  useEffect(() => {
    controller.current?.abort()
    const cancel = () => { controller.current?.abort(); nonce.current++; setQuery(emptyQuery(scope)) }
    window.addEventListener("popstate", cancel)
    return () => { controller.current?.abort(); window.removeEventListener("popstate", cancel) }
  }, [scope])

  function invalidate() {
    controller.current?.abort(); nonce.current++
    setQuery(emptyQuery(scope))
  }
  async function submit(selection: ProjectsSelection) {
    if (!teamReady || selection.error) return
    let request: ProjectsAnalysisRequest
    try { request = parseProjectsAnalysisRequest({ project: selection.project, sprintIds: selection.selectedSprintIds, groups, browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }
    catch (error) { setQuery({ ...emptyQuery(scope), error: error instanceof Error ? error.message : "篩選條件無效。" }); return }
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    const id = ++nonce.current
    const key = projectsAnalysisFingerprint(request)
    setQuery((previous) => ({ scope, nonce: id, request, result: previous.scope === scope && previous.result && projectsAnalysisFingerprint(previous.result.request) === key ? previous.result : null, loading: true, error: null }))
    try {
      const response = await fetch("/api/analytics/projects/query", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: current.signal })
      const raw: unknown = await response.json()
      if (!response.ok || !projectsRecord(raw) || raw.status !== "success") throw new Error(projectsRecord(raw) && projectsRecord(raw.error) && typeof raw.error.message === "string" ? raw.error.message : "分析查詢失敗，請重試。")
      const result = parseProjectsAnalysisResult(raw.data, request)
      if (current.signal.aborted || nonce.current !== id) return
      setQuery((previous) => previous.scope === scope && previous.nonce === id && previous.request ? { ...previous, result, loading: false, error: null } : previous)
    } catch (error) {
      if (current.signal.aborted || nonce.current !== id) return
      setQuery((previous) => previous.scope === scope && previous.nonce === id ? { ...previous, loading: false, error: error instanceof Error ? error.message : "分析查詢失敗，請重試。" } : previous)
    }
  }

  return <div className="min-w-0 space-y-6">
    <ProjectsFilter {...props} groups={groups} onGroupsChange={changeGroups} onDraftChange={invalidate} onQuery={submit} teamReady={teamReady} loading={visible.loading} />
    {visible.error ? <div role="alert" className="rounded-lg border border-rose-200 bg-white p-4 text-sm text-rose-700 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-300">
      <p>{visible.error}</p>
      {visible.request && <button type="button" disabled={!teamReady} onClick={() => submit({ project: visible.request!.project, selectedSprintIds: visible.request!.sprintIds, error: null })} className="mt-2 min-h-9 rounded px-3 text-slate-800 underline focus-visible:outline-2 dark:text-slate-100">重試相同條件</button>}
    </div> : null}
    {visible.loading ? <p role="status" className="text-sm text-slate-600 dark:text-slate-300">正在完整讀取 Sprint 工作單，完成全部分頁後顯示結果…</p> : null}
    {visible.result ? <div aria-busy={visible.loading} className={visible.loading ? "pointer-events-none opacity-50" : ""} inert={visible.loading}>
      <ProjectsAnalysisView key={`${visible.nonce}-${visible.result.generatedAt}`} result={visible.result} />
    </div> : !visible.loading && !visible.error ? <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
      選擇專案、已結束 Sprint 與選填團隊，按「查詢」比較六項指標。改變條件不會自動查詢；本版不比較 Capacity。
    </section> : null}
  </div>
}

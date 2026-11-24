"use client"

import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { TeamSelect } from "@/components/team-select"
import { useTeamMembers } from "@/components/team-members-provider"
import { FilterDropdown } from "@/components/filter-dropdown"
import { SearchButton } from "@/components/search-button"
import { DateRangeField, useBrowserToday } from "@/components/date-range-field"
import { useDefaultTeamGroups } from "@/components/filter-defaults-provider"
import { DASHBOARD_PROJECTS, includedDashboardMembers } from "@/lib/jira-dashboard-filter"
import type { DashboardUser } from "@/lib/jira-dashboard-filter"
import { DATE_RANGE_PRESET_LABEL, dateRangeForPreset, type DateRange, type DateRangeShortcut } from "@/lib/date-range"
import type { TeamAnalysisSelection } from "@/lib/team-analysis-filter"
import { serializeMemberAnalysisFilter } from "@/lib/member-analysis-filter"
import type { MemberAnalysisResult } from "@/lib/member-analysis"
import { MemberAnalysisTable } from "./member-analysis-table"

type QueryState = { loading: boolean; data: MemberAnalysisResult | null; error: string | null }

const choiceClass = "h-4 w-4 shrink-0 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"

/** Same shortcuts as 工作量分析: 近3月／近6月／今年. */
const TEAM_SHORTCUTS: readonly DateRangeShortcut[] = (["last3Months", "last6Months", "yearToDate"] as const).map((preset) => ({
  id: preset, label: DATE_RANGE_PRESET_LABEL[preset], preset,
}))

/**
 * 與工作量分析頁完全相同的篩選區塊（專案／團隊（含逐人選取）／分析區間／查詢），
 * 送出前仍走成員分析的 URL 驗證；查詢會呼叫 `/api/analytics/members` 讀取區間內
 * resolved 的 Dev-Task，成功後在下方顯示成員彙總表。
 */
export function TeamAnalysisFilter(input: TeamAnalysisSelection) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { error: pageError, ...props } = input
  const id = useId()
  const today = useBrowserToday()
  const [groups, setGroups] = useDefaultTeamGroups(!pageError)
  const { groupStates } = useTeamMembers()
  const [exclusions, setExclusions] = useState<Record<string, string[]>>({})
  const [projects, setProjects] = useState<string[]>(input.project ? [input.project] : [])
  const [projectOpen, setProjectOpen] = useState(false)
  const [range, setRange] = useState<DateRange>(input.dateRange ?? { from: "", to: "" })
  const [rangeTouched, setRangeTouched] = useState(Boolean(input.dateRange?.from && input.dateRange?.to))
  const [error, setError] = useState<string | null>(pageError)
  const [result, setResult] = useState<QueryState>({ loading: false, data: null, error: null })
  const requestSequence = useRef(0)
  // 沒有 URL 區間時，等瀏覽器本機今天才知道「近3月」是哪一段；這之前不自行讀時鐘。
  const initialPreset = useRef(false)

  // 與工作量分析相同的就緒判斷：所選團隊的完整成員名單都載入後才能查詢。
  const allGroupsLoaded = groups.length > 0 && groups.every((group) => groupStates[group]?.status === "success")
  const members: Record<string, DashboardUser[]> = {}
  for (const group of groups) {
    const state = groupStates[group]
    if (state?.status === "success") members[group] = state.members
  }
  let memberCount = 0
  let teamHint = ""
  if (allGroupsLoaded) {
    try {
      memberCount = includedDashboardMembers(groups, exclusions, members).length
      teamHint = `已選 ${groups.length} 個團隊、${memberCount} 名不重複成員`
    } catch (failure) {
      teamHint = failure instanceof Error ? failure.message : "請重新選擇團隊成員。"
    }
  } else if (groups.length) {
    teamHint = "所選團隊必須全部完整載入後才能套用，不會使用部分成員。"
  }

  function commitRange(next: DateRange) {
    if (!next.from || !next.to) return
    setRangeTouched(true)
    setError(null)
  }
  // DateRangeField 取得今天後才回報預設區間；沿用工作量分析的「近3月」起始值。
  useEffect(() => {
    if (initialPreset.current || rangeTouched || !today) return
    initialPreset.current = true
    setRange(dateRangeForPreset("last3Months", today))
  }, [today, rangeTouched])

  const projectLabel = DASHBOARD_PROJECTS.filter((project) => projects.includes(project.key)).map((project) => project.label).join(" · ") || "選擇專案…"

  function invalidateQuery() {
    requestSequence.current += 1
    setResult((previous) => previous.data || previous.error ? { ...previous, loading: false } : previous)
  }

  async function query(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      if (!allGroupsLoaded) throw new Error("請選擇團隊，並等待所選團隊的完整成員名單載入。")
      includedDashboardMembers(groups, exclusions, members)
      if (!rangeTouched || !range.from || !range.to) throw new Error("請先選擇分析區間。")
      const params = serializeMemberAnalysisFilter({ groups, exclusions, projects, from: range.from, to: range.to })
      setError(null)
      setProjectOpen(false)
      const sequence = ++requestSequence.current
      setResult((previous) => ({ ...previous, loading: true, error: null }))
      const response = await fetch(`/api/analytics/members?${params}`, { cache: "no-store", credentials: "same-origin" })
      const payload: unknown = await response.json().catch(() => null)
      if (sequence !== requestSequence.current) return
      if (!payload || typeof payload !== "object" || (payload as { status?: unknown }).status !== "success") {
        const message = (payload as { error?: { message?: unknown } } | null)?.error?.message
        throw new Error(typeof message === "string" ? message : "無法取得成員分析資料，請重試。")
      }
      setResult({ loading: false, data: (payload as { data: MemberAnalysisResult }).data, error: null })
    } catch (failure) {
      if (requestSequence.current < 0) return
      setResult({ loading: false, data: null, error: failure instanceof Error ? failure.message : "無法取得成員分析資料，請重試。" })
    }
  }

  return (
    <section aria-label="查詢範圍" className="mb-4 min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <form onSubmit={query} className="space-y-3">
        {/* Same single row as 工作量分析: 分析區間, 團隊, 專案 on the left, 查詢 alone on the right. */}
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="min-w-0 max-w-full">
            <DateRangeField
              value={range}
              // Any edit to the range drops the "ready" notice until 查詢 is pressed again.
              onChange={(next) => { setRange(next); invalidateQuery() }}
              onCommit={commitRange}
              shortcuts={TEAM_SHORTCUTS}
              defaultPreset="last3Months"
              idPrefix={`${id}-range`}
              required
            />
          </div>
          <TeamSelect
            groups={groups}
            initialExclusions={exclusions}
            onGroupsChange={(nextGroups) => { setGroups(nextGroups); setError(null); invalidateQuery() }}
            onExclusionsChange={(next) => { setExclusions(next); invalidateQuery() }}
            helpText="團隊與成員變更只更新草稿，按「查詢」套用篩選條件。"
            required
          />
          <FilterDropdown id={`${id}-projects`} kind="project" label="專案" value={projectLabel} open={projectOpen} onOpenChange={setProjectOpen} describedBy={`${id}-project-help`}>
            <fieldset className="min-w-0">
              <legend className="sr-only">專案（可複選）</legend>
              {DASHBOARD_PROJECTS.map((project) => (
                <label key={project.key} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                  <input type="checkbox" checked={projects.includes(project.key)} onChange={(event) => {
                    setError(null)
                    invalidateQuery()
                    setProjects(event.target.checked ? [...new Set([...projects, project.key])] : projects.filter((key) => key !== project.key))
                  }} className={choiceClass} />
                  <span>{project.label}</span>
                </label>
              ))}
            </fieldset>
            <p id={`${id}-project-help`} className="px-3 py-2 text-xs leading-5 text-slate-500 dark:text-slate-400">未選取專案時，不加專案限制。</p>
          </FilterDropdown>
          {/* Controls stay left-aligned; the query button alone sits at the row's right edge. */}
          {/* Same button as 專案回顧與趨勢: disabled and showing 查詢中… until the response arrives. */}
          <div className="ml-auto shrink-0"><SearchButton loading={result.loading} disabled={!allGroupsLoaded || memberCount === 0} aria-describedby={`${id}-team-help ${id}-help`} /></div>
        </div>
        {!rangeTouched && <p role="status" className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">尚未選擇分析區間，請按快捷鍵或點選日期欄位。</p>}
        <p id={`${id}-help`} className="sr-only">按「查詢」或 Enter 讀取區間內 resolved 的 Dev-Task；分析區間以瀏覽器本機時區的日曆日為準。</p>
        {teamHint && <p id={`${id}-team-help`} role="status" className="text-xs leading-5 text-slate-500 dark:text-slate-400">{teamHint}</p>}
        {error && <p role="alert" className="break-words text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {result.error && <p role="alert" className="break-words text-sm text-rose-600 dark:text-rose-400">{result.error}</p>}
      </form>
      {result.loading ? <p role="status" className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">正在讀取區間內 resolved 的 Dev-Task…</p> : null}
      {result.data ? <div className="mt-4"><MemberAnalysisTable result={result.data} /></div> : null}
    </section>
  )
}

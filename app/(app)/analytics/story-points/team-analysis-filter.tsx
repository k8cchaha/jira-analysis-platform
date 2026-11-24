"use client"

import { useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { DateRangeField, useBrowserToday } from "@/components/date-range-field"
import { FILTER_SELECT_WIDTH_CLASS } from "@/components/filter-dropdown"
import { ProjectSelector } from "@/components/project-selector"
import { SearchButton } from "@/components/search-button"
import { TeamSelect } from "@/components/team-select"
import { useDefaultTeamGroups } from "@/components/filter-defaults-provider"
import { useTeamMembers } from "@/components/team-members-provider"
import { DATE_RANGE_PRESET_LABEL, dateRangeForPreset, requireDateRange, sameDateRange, type DateRange, type DateRangeShortcut } from "@/lib/date-range"
import { teamAnalysisFilterHref, type TeamAnalysisSelection } from "@/lib/team-analysis-filter"
import type { SprintProjectKey } from "@/lib/jira-jql"

const TEAM_SHORTCUTS: readonly DateRangeShortcut[] = (["last1Month", "last2Months", "last3Months", "last6Months"] as const).map((preset) => ({
  id: preset, label: DATE_RANGE_PRESET_LABEL[preset], preset,
}))

/** 日期篩選與 URL 還原已接通；分析引擎尚未開放。 */
export function TeamAnalysisFilter(props: TeamAnalysisSelection) {
  const router = useRouter()
  const today = useBrowserToday()
  const [isPending, startTransition] = useTransition()
  const [groups, setGroups] = useDefaultTeamGroups(!props.error)
  const { groupStates } = useTeamMembers()
  const [selection, setSelection] = useOptimistic<TeamAnalysisSelection>(props)
  const [draft, setDraft] = useState<{ source: TeamAnalysisSelection; range: DateRange } | null>(null)
  const [notice, setNotice] = useState<{ selection: TeamAnalysisSelection; range: DateRange } | null>(null)
  const dateRange = draft?.source === selection ? draft.range : selection.dateRange ?? (today ? dateRangeForPreset("last1Month", today) : null)
  const latestSelection = useRef(selection)
  const latestRange = useRef(dateRange)
  const latestProps = useRef(props)
  useLayoutEffect(() => {
    latestSelection.current = selection
    latestRange.current = dateRange
    latestProps.current = props
  }, [selection, dateRange, props])
  const projectSelected = selection.project !== null
  // Team is required: analysis without a team would silently widen to the whole project.
  // The filter does not wait for rosters (the query only records the selection); a failed load is
  // surfaced by the hint below instead of silently blocking.
  const teamsSelected = groups.length > 0
  const teamsLoading = groups.some((group) => groupStates[group]?.status === "loading")

  function canQuery(current: TeamAnalysisSelection, range: DateRange | null) {
    if (!current.dateRange || !range || !teamsSelected) return false
    try { teamAnalysisFilterHref({ ...current, dateRange: range }); return true } catch { return false }
  }
  function navigate(next: TeamAnalysisSelection) {
    const href = teamAnalysisFilterHref(next)
    latestSelection.current = next
    latestRange.current = next.dateRange
    setNotice(null)
    startTransition(() => { setSelection(next); router.push(href) })
  }
  function changeProject(project: SprintProjectKey) {
    const current = latestSelection.current
    const range = latestRange.current
    if (current.project === project || !range) return
    navigate({ project, dateRange: range, error: null })
  }
  function acceptsDateEvent() {
    // 同次 render 的連續 commit 可累積；舊專案或 history 的月曆不得覆寫新 URL。
    return latestProps.current === props && selection.project !== null && latestSelection.current.project === selection.project
  }
  function validRange(range: DateRange) {
    try { return requireDateRange(range) } catch { return null }
  }
  function changeDates(range: DateRange) {
    if (!acceptsDateEvent()) return
    const valid = validRange(range)
    if (!valid) return
    latestRange.current = valid
    setDraft({ source: latestSelection.current, range: valid })
    setNotice(null)
  }
  function commitDates(range: DateRange) {
    if (!acceptsDateEvent()) return
    const valid = validRange(range)
    if (!valid) return
    const current = latestSelection.current
    latestRange.current = valid
    setDraft({ source: current, range: valid })
    if (!current.error && current.dateRange && sameDateRange(current.dateRange, valid)) return
    navigate({ project: current.project, dateRange: valid, error: null })
  }

  return (
    <form aria-busy={isPending} onSubmit={(event) => {
      event.preventDefault()
      const current = latestSelection.current
      const range = latestRange.current
      if (range && canQuery(current, range)) setNotice({ selection: current, range })
    }}>
      {/* Project · Team · 分析區間 · 查詢 sit on one row; the row only wraps when the viewport cannot fit them. */}
      <div className="flex min-w-0 flex-wrap items-end gap-4">
        <div className={FILTER_SELECT_WIDTH_CLASS.project}>
          <ProjectSelector project={selection.project} required onProjectChange={changeProject} idPrefix="team-analysis-project" />
        </div>
        <div inert={!projectSelected} aria-disabled={!projectSelected} className={`${FILTER_SELECT_WIDTH_CLASS.team} ${!projectSelected ? "opacity-50" : ""}`}>
          <TeamSelect key={projectSelected ? "ready" : "no-project"} required groups={groups} perMember={false} onGroupsChange={(nextGroups) => {
            if (latestSelection.current.project) { setGroups(nextGroups); setNotice(null) }
          }} helpText="團隊為必選；選取僅保留於本頁，不寫入網址。團隊分析功能尚未開放，目前不會查詢分析資料。" />
        </div>
        <fieldset disabled={!projectSelected} aria-disabled={!projectSelected} className="min-w-0 max-w-full flex-1 basis-80">
          <legend className="sr-only">分析區間</legend>
          <div inert={!projectSelected || !dateRange} aria-disabled={!projectSelected || !dateRange} className={`min-w-0 max-w-full ${!projectSelected ? "opacity-50" : ""}`}>
            {dateRange ? <DateRangeField key={`${selection.project}-${props.project}-${props.dateRange?.from}-${props.dateRange?.to}-${props.error}`} idPrefix="team-analysis-dates" value={dateRange} shortcuts={TEAM_SHORTCUTS} defaultPreset="last1Month" onChange={changeDates} onCommit={commitDates} />
              : <p className="py-2 text-sm text-slate-500 dark:text-slate-400">正在準備分析區間…</p>}
          </div>
        </fieldset>
        <div className="min-w-0 max-w-full shrink-0">
          <SearchButton disabled={!canQuery(selection, dateRange)} aria-describedby="team-analysis-query-help" />
        </div>
      </div>
      {selection.error ? <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">{selection.error}</p> : null}
      {isPending ? <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">正在更新篩選條件…</p> : null}
      {projectSelected && !teamsSelected ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">請至少選擇一個團隊。</p> : null}
      {teamsSelected && !teamsLoading ? <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">正在載入團隊成員資料；若載入失敗，請在團隊選單重試。</p> : null}
      <p id="team-analysis-query-help" className="sr-only">請選擇專案、至少一個團隊及有效分析區間。團隊分析功能尚未開放，目前不會查詢分析資料。</p>
      {notice?.selection === selection && notice.range === dateRange ? <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">篩選條件已就緒；團隊分析功能尚未開放，目前不會查詢分析資料。</p> : null}
    </form>
  )
}

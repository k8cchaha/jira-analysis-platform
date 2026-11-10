"use client"

import { useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { DateRangeField, useBrowserToday } from "@/components/date-range-field"
import { FILTER_SELECT_WIDTH_CLASS } from "@/components/filter-dropdown"
import { ProjectSelector } from "@/components/project-selector"
import { SearchButton } from "@/components/search-button"
import { TeamSelect } from "@/components/team-select"
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
  const [groups, setGroups] = useState<string[]>([])
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

  function canQuery(current: TeamAnalysisSelection, range: DateRange | null) {
    if (!current.dateRange || !range) return false
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
      <div className="flex min-w-0 flex-wrap items-end gap-4">
        <div className={FILTER_SELECT_WIDTH_CLASS.project}>
          <ProjectSelector project={selection.project} required onProjectChange={changeProject} idPrefix="team-analysis-project" />
        </div>
        <div inert={!projectSelected} aria-disabled={!projectSelected} className={`${FILTER_SELECT_WIDTH_CLASS.team} ${!projectSelected ? "opacity-50" : ""}`}>
          <TeamSelect key={projectSelected ? "ready" : "no-project"} groups={groups} perMember={false} onGroupsChange={(nextGroups) => {
            if (latestSelection.current.project) { setGroups(nextGroups); setNotice(null) }
          }} helpText="團隊選取僅保留於本頁，不寫入網址；團隊分析功能尚未開放，目前不會查詢分析資料。" />
        </div>
      </div>
      <fieldset disabled={!projectSelected} aria-disabled={!projectSelected} className="mt-4 min-w-0">
        <legend className="sr-only">分析區間</legend>
        <div className="flex min-w-0 flex-wrap items-start gap-6">
          <div inert={!projectSelected || !dateRange} aria-disabled={!projectSelected || !dateRange} className={`min-w-0 max-w-full flex-1 basis-80 ${!projectSelected ? "opacity-50" : ""}`}>
            {dateRange ? <DateRangeField key={`${selection.project}-${props.project}-${props.dateRange?.from}-${props.dateRange?.to}-${props.error}`} idPrefix="team-analysis-dates" value={dateRange} shortcuts={TEAM_SHORTCUTS} defaultPreset="last1Month" onChange={changeDates} onCommit={commitDates} />
              : <p className="py-2 text-sm text-slate-500 dark:text-slate-400">正在準備分析區間…</p>}
          </div>
          <div className="ml-auto min-w-0 max-w-full shrink-0 pt-5">
            <SearchButton disabled={!canQuery(selection, dateRange)} aria-describedby="team-analysis-query-help" />
          </div>
        </div>
      </fieldset>
      {selection.error ? <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">{selection.error}</p> : null}
      {isPending ? <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">正在更新篩選條件…</p> : null}
      <p id="team-analysis-query-help" className="sr-only">請先選擇專案及有效分析區間。團隊分析功能尚未開放，目前不會查詢分析資料。</p>
      {notice?.selection === selection && notice.range === dateRange ? <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">篩選條件已就緒；團隊分析功能尚未開放，目前不會查詢分析資料。</p> : null}
    </form>
  )
}

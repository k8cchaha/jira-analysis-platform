"use client"

import { useId, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { DateRangeField, useBrowserToday } from "@/components/date-range-field"
import { FilterDropdown, FILTER_SELECT_WIDTH_CLASS } from "@/components/filter-dropdown"
import { ProjectSelector } from "@/components/project-selector"
import { SearchButton } from "@/components/search-button"
import { TeamSelect } from "@/components/team-select"
import { DATE_RANGE_PRESET_LABEL, dateRangeForPreset, requireDateRange, sameDateRange, type DateRange, type DateRangeShortcut } from "@/lib/date-range"
import { projectsFilterHref, type ProjectsSelection } from "@/lib/projects-filter"
import type { SprintProjectKey } from "@/lib/jira-jql"
import type { SprintRecord } from "@/lib/jira-sprint-data"

const PROJECT_SHORTCUTS: readonly DateRangeShortcut[] = (["last1Month", "last2Months", "last3Months", "last6Months"] as const).map((preset) => ({
  id: preset,
  label: DATE_RANGE_PRESET_LABEL[preset],
  preset,
}))

/** 專案必選；Sprints／分析區間二選一，目前僅保存篩選狀態，不查詢分析資料。 */
export function ProjectsFilter(props: ProjectsSelection & { sprints: readonly SprintRecord[] }) {
  const router = useRouter()
  const radioName = useId()
  const today = useBrowserToday()
  const [isPending, startTransition] = useTransition()
  const [groups, setGroups] = useState<string[]>([])
  const [queryNotice, setQueryNotice] = useState<{ selection: ProjectsSelection; range: DateRange | null } | null>(null)
  const [sprintsOpen, setSprintsOpen] = useState(false)
  const [dateActivation, setDateActivation] = useState(0)
  const latestDateActivation = useRef(dateActivation)
  const [dateDraft, setDateDraft] = useState<{ source: ProjectsSelection; range: DateRange } | null>(() => props.mode === "dates" && props.dateRange ? { source: props, range: props.dateRange } : null)
  const [selection, setSelection] = useOptimistic<ProjectsSelection>(props)
  const latestSelection = useRef(selection)
  const latestDateDraft = useRef<DateRange | null>(null)
  const dateRange = selection.mode === "dates" && selection.dateRange
    ? dateDraft?.source === selection ? dateDraft.range : selection.dateRange
    : dateDraft?.range ?? (today ? dateRangeForPreset("last1Month", today) : null)
  const sprintDraft = useRef<{ project: SprintProjectKey | null; ids: readonly number[] }>({ project: selection.project, ids: [] })
  useLayoutEffect(() => {
    latestSelection.current = selection
    latestDateDraft.current = dateRange
    if (sprintDraft.current.project !== selection.project) sprintDraft.current = { project: selection.project, ids: [] }
    if (selection.mode === "sprints" && !selection.error) sprintDraft.current = { project: selection.project, ids: selection.selectedSprintIds }
  }, [selection, dateRange])

  const availableSprints = selection.project === props.project ? props.sprints : []
  const orderedSprints = [...availableSprints].sort((a, b) => b.startDate.localeCompare(a.startDate))
  // Inactive Sprint drafts need not be copied into the active date selection / URL.
  const [inactiveSprints, setInactiveSprints] = useState<{ project: SprintProjectKey | null; ids: readonly number[] }>({ project: props.project, ids: [] })
  const ids = selection.mode === "sprints" ? selection.selectedSprintIds : inactiveSprints.project === selection.project ? inactiveSprints.ids : []
  const selectedNames = orderedSprints.filter((sprint) => ids.includes(sprint.id)).map((sprint) => sprint.name)
  const projectSelected = selection.project !== null
  const value = !projectSelected ? "請先選擇專案" : selection.error && selection.mode === "sprints" ? "請重新選擇 Sprints" : selectedNames.join(" · ") || "選擇 Sprints"
  const queryEnabled = canQuery(selection, dateRange)

  function canQuery(current: ProjectsSelection, range: DateRange | null): boolean {
    if (current.mode === "sprints" && current.selectedSprintIds.length === 0) return false
    if (current.mode === "dates" && current.dateRange === null) return false
    try {
      projectsFilterHref(current.mode === "dates" ? { ...current, dateRange: range } : current)
      return true
    } catch { return false }
  }

  function navigate(next: ProjectsSelection) {
    if (!next.project) return
    const href = projectsFilterHref(next)
    latestSelection.current = next
    startTransition(() => { setSelection(next); router.push(href) })
  }

  function closePanels() {
    setSprintsOpen(false)
    latestDateActivation.current += 1
    setDateActivation(latestDateActivation.current)
  }

  function changeProject(project: SprintProjectKey) {
    const current = latestSelection.current
    if (current.project === project) return
    closePanels()
    sprintDraft.current = { project, ids: [] }
    setInactiveSprints({ project, ids: [] })
    if (current.mode === "dates") {
      const range = latestDateDraft.current ?? current.dateRange
      if (!range) return
      navigate({ project, mode: "dates", dateRange: range, error: null })
    } else { navigate({ project, mode: "sprints", selectedSprintIds: [], error: null }) }
  }

  function changeMode(mode: ProjectsSelection["mode"]) {
    const current = latestSelection.current
    if (!current.project || current.mode === mode) return
    const range = latestDateDraft.current ?? (current.mode === "dates" ? current.dateRange : null)
    if (mode === "dates" && !range) return
    closePanels()
    if (range) { latestDateDraft.current = range; setDateDraft({ source: current, range }) }
    if (current.mode === "sprints") {
      sprintDraft.current = { project: current.project, ids: current.selectedSprintIds }
      setInactiveSprints({ project: current.project, ids: current.selectedSprintIds })
    }
    navigate(mode === "dates"
      ? { project: current.project, mode, dateRange: range, error: null }
      : { project: current.project, mode, selectedSprintIds: sprintDraft.current.project === current.project ? sprintDraft.current.ids : [], error: null })
  }

  function toggleSprint(id: number, checked: boolean) {
    const current = latestSelection.current
    if (current.mode !== "sprints" || !current.project || current.project !== props.project || !availableSprints.some((sprint) => sprint.id === id)) return
    const nextIds = (checked ? [...new Set([...current.selectedSprintIds, id])] : current.selectedSprintIds.filter((value) => value !== id)).sort((a, b) => a - b)
    sprintDraft.current = { project: current.project, ids: nextIds }
    navigate({ project: current.project, mode: "sprints", selectedSprintIds: nextIds, error: null })
  }

  function validDateDraft(range: DateRange): DateRange | null {
    try { return requireDateRange(range) } catch { return null }
  }
  function acceptsDateEvent() {
    // 關閉／重掛前的 blur 或月曆 callbacks 不可改寫新模式／專案的區間。
    return latestSelection.current.project !== null && latestSelection.current.mode === "dates" && selection.mode === "dates"
      && latestSelection.current.project === selection.project && latestDateActivation.current === dateActivation
  }
  function changeDates(range: DateRange) {
    if (!acceptsDateEvent()) return
    const valid = validDateDraft(range)
    if (!valid) return
    latestDateDraft.current = valid
    setDateDraft({ source: latestSelection.current, range: valid })
  }
  function commitDates(range: DateRange) {
    const current = latestSelection.current
    if (!acceptsDateEvent() || current.mode !== "dates") return
    const valid = validDateDraft(range)
    if (!valid) return
    latestDateDraft.current = valid
    setDateDraft({ source: latestSelection.current, range: valid })
    if (!current.error && current.dateRange && sameDateRange(current.dateRange, valid)) return
    navigate({ project: current.project, mode: "dates", dateRange: valid, error: null })
  }

  return (
    <form aria-busy={isPending} onSubmit={(event) => {
      event.preventDefault()
      const current = latestSelection.current
      const range = latestDateDraft.current
      if (!canQuery(current, range)) return
      // 分析引擎尚未開放；僅確認條件，不發出 Jira 分析請求。
      setQueryNotice({ selection: current, range })
    }}>
      <div className="flex min-w-0 flex-wrap items-end gap-4">
        <div className={FILTER_SELECT_WIDTH_CLASS.project}>
          <ProjectSelector project={selection.project} required onProjectChange={changeProject} idPrefix="projects-project" />
        </div>
        <div inert={!projectSelected} aria-disabled={!projectSelected} className={`${FILTER_SELECT_WIDTH_CLASS.team} ${!projectSelected ? "opacity-50" : ""}`}>
          <TeamSelect key={projectSelected ? "ready" : "no-project"} groups={groups} onGroupsChange={(nextGroups) => { if (latestSelection.current.project) setGroups(nextGroups) }} perMember={false} helpText="團隊選取僅保留於本頁；專案回顧與趨勢功能尚未開放，目前不會查詢分析資料。" />
        </div>
      </div>
      <fieldset disabled={!projectSelected} aria-disabled={!projectSelected} className="mt-4 min-w-0">
        <legend className="sr-only">資料區間（Sprints 與分析區間二選一）</legend>
        <div className="flex min-w-0 flex-wrap items-start gap-6">
          <div className="flex min-w-0 max-w-full items-start gap-2">
            <input type="radio" name={radioName} value="sprints" aria-label="Sprints" checked={selection.mode === "sprints"} disabled={!projectSelected} onChange={() => changeMode("sprints")} className="mt-8 h-4 w-4 shrink-0 cursor-pointer accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50" />
            <div inert={!projectSelected || selection.mode !== "sprints"} aria-disabled={!projectSelected || selection.mode !== "sprints"} className={`min-w-0 ${!projectSelected || selection.mode !== "sprints" ? "opacity-50" : ""}`}>
              <FilterDropdown id="projects-sprints" kind="sprint" label="Sprints" value={value} open={projectSelected && selection.mode === "sprints" && sprintsOpen} onOpenChange={(open) => { if (latestSelection.current.project && latestSelection.current.mode === "sprints") setSprintsOpen(open) }} describedBy="projects-sprints-help">
                {!selection.project ? <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">請先選擇專案</p>
                  : selection.project !== props.project ? <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">正在載入 Sprints…</p>
                  : orderedSprints.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">此專案暫無可檢視的 Sprints</p>
                  : orderedSprints.map((sprint) => (
                    <label key={sprint.id} className="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={ids.includes(sprint.id)} onChange={(event) => toggleSprint(sprint.id, event.target.checked)} className="h-4 w-4 shrink-0 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
                      <span className="min-w-0 break-words">{sprint.name}</span>
                    </label>
                  ))}
              </FilterDropdown>
              <p id="projects-sprints-help" className="sr-only">可複選該專案的 Sprints；至少勾選一個 Sprint 才能啟用查詢。專案回顧與趨勢功能尚未開放。</p>
            </div>
          </div>
          <div className="flex min-w-0 max-w-full flex-1 basis-80 items-start gap-2">
            <input type="radio" name={radioName} value="dates" aria-label="分析區間" checked={selection.mode === "dates"} disabled={!projectSelected || !dateRange} onChange={() => changeMode("dates")} className="mt-8 h-4 w-4 shrink-0 cursor-pointer accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50" />
            <div inert={!projectSelected || selection.mode !== "dates" || !dateRange} aria-disabled={!projectSelected || selection.mode !== "dates" || !dateRange} className={`min-w-0 flex-1 ${!projectSelected || selection.mode !== "dates" ? "opacity-50" : ""}`}>
              {dateRange ? <DateRangeField key={`${selection.project}-${selection.mode}-${dateActivation}`} idPrefix="projects-dates" value={dateRange} shortcuts={PROJECT_SHORTCUTS} onChange={changeDates} onCommit={commitDates} />
                : <p className="py-2 text-sm text-slate-500 dark:text-slate-400">正在準備分析區間…</p>}
            </div>
          </div>
          <div className="ml-auto min-w-0 max-w-full shrink-0 pt-5">
            <SearchButton disabled={!queryEnabled} aria-describedby="projects-query-help" />
          </div>
        </div>
      </fieldset>
      {selection.error ? <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">{selection.error}</p> : null}
      {isPending ? <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">正在更新篩選條件…</p> : null}
      <p id="projects-query-help" className="sr-only">請先選擇專案；Sprints 模式需至少勾選一個 Sprint，分析區間模式需有效日期區間。專案回顧與趨勢功能尚未開放。</p>
      {queryNotice?.selection === selection && (selection.mode === "sprints" || queryNotice.range === dateRange)
        ? <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">篩選條件已就緒；專案回顧與趨勢功能尚未開放，目前不會查詢分析資料。</p>
        : null}
    </form>
  )
}

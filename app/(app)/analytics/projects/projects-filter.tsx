"use client"

import { useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FilterDropdown, FILTER_SELECT_WIDTH_CLASS } from "@/components/filter-dropdown"
import { GuardedLink } from "@/components/navigation-blocker"
import { ProjectSelector } from "@/components/project-selector"
import { SearchButton } from "@/components/search-button"
import { TeamSelect } from "@/components/team-select"
import { projectsFilterHref, type ProjectsSelection } from "@/lib/projects-filter"
import type { SprintProjectKey } from "@/lib/jira-jql"
import { closestSprint, type SprintRecord } from "@/lib/jira-sprint-data"
import { localDateFromOffset } from "@/lib/date-range"

/** 專案必選、Sprint 複選；目前只保存條件，不查詢分析資料。 */
export function ProjectsFilter(props: ProjectsSelection & { sprints: readonly SprintRecord[]; dateMigrationHref: string | null }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [groups, setGroups] = useState<string[]>([])
  const [queryNotice, setQueryNotice] = useState<ProjectsSelection | null>(null)
  const [sprintsOpen, setSprintsOpen] = useState(false)
  const sprintsFieldset = useRef<HTMLFieldSetElement>(null)
  const scrolledProject = useRef<SprintProjectKey | null>(null)
  const [selection, setSelection] = useOptimistic<ProjectsSelection>(props)
  const latestSelection = useRef(selection)
  useLayoutEffect(() => { latestSelection.current = selection }, [selection])
  const availableSprints = selection.project === props.project ? props.sprints : []
  const orderedSprints = [...availableSprints].sort((a, b) => b.startDate.localeCompare(a.startDate))
  const ids = selection.selectedSprintIds
  const selectedNames = orderedSprints.filter((sprint) => ids.includes(sprint.id)).map((sprint) => sprint.name)
  const projectSelected = selection.project !== null
  const sprintsVisible = projectSelected && selection.project === props.project && sprintsOpen
  const value = !projectSelected ? "請先選擇專案" : selection.error ? "請重新選擇 Sprints" : selectedNames.join(" · ") || "選擇 Sprints"

  // 每次真正開啟且選項就緒時定位；勾選／URL 更新不重置手動捲動。
  useEffect(() => {
    if (!sprintsVisible) { scrolledProject.current = null; return }
    if (scrolledProject.current === props.project) return
    const now = new Date()
    const sprint = closestSprint(props.sprints, localDateFromOffset(now, now.getTimezoneOffset()))
    if (!sprint) return
    const option = sprintsFieldset.current?.querySelector<HTMLElement>(`[data-sprint-id="${sprint.id}"]`)
    const panel = option?.parentElement
    if (!option || !panel || panel.hidden) return
    // 優先將目標置於面板頂端；置中會讓前幾項算出負值，被瀏覽器夾成 0。
    // 只捲動下拉面板，不使用會連帶捲動整頁的 scrollIntoView。
    panel.scrollTop += option.getBoundingClientRect().top - panel.getBoundingClientRect().top - panel.clientTop
    scrolledProject.current = props.project
  }, [sprintsVisible, props.project, props.sprints])

  function canQuery(current: ProjectsSelection) {
    if (!current.selectedSprintIds.length) return false
    try { projectsFilterHref(current); return true } catch { return false }
  }
  function navigate(next: ProjectsSelection) {
    const href = projectsFilterHref(next)
    latestSelection.current = next
    setQueryNotice(null)
    startTransition(() => { setSelection(next); router.push(href) })
  }
  function changeProject(project: SprintProjectKey) {
    if (latestSelection.current.project === project) return
    setSprintsOpen(false)
    navigate({ project, selectedSprintIds: [], error: null })
  }
  function toggleSprint(id: number, checked: boolean) {
    const current = latestSelection.current
    if (!current.project || current.project !== selection.project || current.project !== props.project || !availableSprints.some((sprint) => sprint.id === id)) return
    const nextIds = (checked ? [...new Set([...current.selectedSprintIds, id])] : current.selectedSprintIds.filter((value) => value !== id)).sort((a, b) => a - b)
    navigate({ project: current.project, selectedSprintIds: nextIds, error: null })
  }

  return (
    <form aria-busy={isPending} onSubmit={(event) => {
      event.preventDefault()
      const current = latestSelection.current
      if (canQuery(current)) setQueryNotice(current)
    }}>
      <div className="flex min-w-0 flex-wrap items-end gap-4">
        <div className={FILTER_SELECT_WIDTH_CLASS.project}>
          <ProjectSelector project={selection.project} required onProjectChange={changeProject} idPrefix="projects-project" />
        </div>
        <fieldset ref={sprintsFieldset} disabled={!projectSelected} aria-disabled={!projectSelected} className={FILTER_SELECT_WIDTH_CLASS.sprint}>
          <legend className="sr-only">Sprints</legend>
          <div inert={!projectSelected} aria-disabled={!projectSelected} className={`min-w-0 max-w-full ${!projectSelected ? "opacity-50" : ""}`}>
            <FilterDropdown id="projects-sprints" kind="sprint" label="Sprints" required value={value} open={sprintsVisible} onOpenChange={(open) => {
              if (!latestSelection.current.project || latestSelection.current.project !== selection.project) return
              setSprintsOpen(open)
            }} describedBy="projects-sprints-help">
              {!selection.project ? <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">請先選擇專案</p>
                : selection.project !== props.project ? <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">正在載入 Sprints…</p>
                : orderedSprints.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">此專案暫無可檢視的 Sprints</p>
                : orderedSprints.map((sprint) => (
                  <label key={sprint.id} data-sprint-id={sprint.id} className="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 py-0 text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={ids.includes(sprint.id)} onChange={(event) => toggleSprint(sprint.id, event.target.checked)} className="h-4 w-4 shrink-0 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words leading-5">{sprint.name}</span>
                      <span className="block truncate text-xs leading-4 tabular-nums text-slate-500 dark:text-slate-400" title={`${sprint.startDate} - ${sprint.endDate}`}>{sprint.startDate} - {sprint.endDate}</span>
                    </span>
                  </label>
                ))}
            </FilterDropdown>
            <p id="projects-sprints-help" className="sr-only">可複選該專案的 Sprints；至少勾選一個 Sprint 才能啟用查詢。專案回顧與趨勢功能尚未開放。</p>
          </div>
        </fieldset>
        <div inert={!projectSelected} aria-disabled={!projectSelected} className={`${FILTER_SELECT_WIDTH_CLASS.team} ${!projectSelected ? "opacity-50" : ""}`}>
          <TeamSelect key={projectSelected ? "ready" : "no-project"} groups={groups} onGroupsChange={(nextGroups) => {
            if (latestSelection.current.project) { setGroups(nextGroups); setQueryNotice(null) }
          }} perMember={false} helpText="團隊選取僅保留於本頁；專案回顧與趨勢功能尚未開放，目前不會查詢分析資料。" />
        </div>
        <div className="ml-auto min-w-0 max-w-full shrink-0">
          <SearchButton disabled={!projectSelected || !canQuery(selection)} aria-describedby="projects-query-help" />
        </div>
      </div>
      {selection.error ? <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">{selection.error}</p> : null}
      {isPending ? <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">正在更新篩選條件…</p> : null}
      {selection.error && props.dateMigrationHref ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">分析區間已移至團隊分析。<GuardedLink href={props.dateMigrationHref} className="ml-2 text-blue-600 underline dark:text-blue-400">前往團隊分析</GuardedLink></p> : null}
      <p id="projects-query-help" className="sr-only">請先選擇專案並至少勾選一個 Sprint。專案回顧與趨勢功能尚未開放。</p>
      {queryNotice === selection ? <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">篩選條件已就緒；專案回顧與趨勢功能尚未開放，目前不會查詢分析資料。</p> : null}
    </form>
  )
}

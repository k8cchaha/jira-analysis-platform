"use client"

import { useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { SprintSelector } from "@/app/(app)/sprint/burndown/sprint-selector"
import { FilterDropdown } from "@/components/filter-dropdown"
import { TeamSelect } from "@/components/team-select"
import { parseProjectKey } from "@/lib/burndown-params"
import { projectsFilterHref, type ProjectsSelection } from "@/lib/projects-filter"
import type { SprintRecord } from "@/lib/jira-sprint-data"

/** 專案必選、全部 Sprints 多選；分析資料尚未開放。 */
export function ProjectsFilter({ project, sprints, selectedSprintIds, error }: ProjectsSelection & {
  sprints: readonly SprintRecord[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [groups, setGroups] = useState<string[]>([])
  const [sprintsOpen, setSprintsOpen] = useState(false)
  const [selection, setSelection] = useOptimistic<ProjectsSelection>({ project, selectedSprintIds, error })
  // 事件連續發生在下一次 render 前，也從最新意圖組 URL；正式／歷史導航後回到 page props。
  const latestSelection = useRef(selection)
  useLayoutEffect(() => { latestSelection.current = selection }, [selection])

  const availableSprints = selection.project === project ? sprints : []
  const orderedSprints = [...availableSprints].sort((a, b) => b.startDate.localeCompare(a.startDate))
  const selectedNames = orderedSprints.filter((sprint) => selection.selectedSprintIds.includes(sprint.id)).map((sprint) => sprint.name)
  const value = selection.error ? "請重新選擇 Sprints" : selectedNames.join(" · ") || "選擇 Sprints"

  function navigate(next: ProjectsSelection) {
    if (!next.project) return
    const href = projectsFilterHref(next.project, next.selectedSprintIds)
    latestSelection.current = next
    startTransition(() => {
      setSelection(next)
      router.push(href)
    })
  }

  function toggleSprint(id: number, checked: boolean) {
    const current = latestSelection.current
    if (!current.project || current.project !== project || !availableSprints.some((sprint) => sprint.id === id)) return
    const ids = checked ? [...new Set([...current.selectedSprintIds, id])] : current.selectedSprintIds.filter((value) => value !== id)
    navigate({ project: current.project, selectedSprintIds: ids.sort((a, b) => a - b), error: null })
  }

  return (
    <div aria-busy={isPending}>
      <SprintSelector
        project={selection.project}
        projectRequired
        sprints={[]}
        selectedSprintId={null}
        basePath="/analytics/projects"
        onNavigate={(path) => {
          const nextProject = parseProjectKey(new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("project") ?? undefined)
          if (!nextProject) return
          setSprintsOpen(false)
          navigate({ project: nextProject, selectedSprintIds: [], error: null })
        }}
        sprintSlot={
          <>
            <FilterDropdown
              id="projects-sprints"
              kind="sprint"
              label="Sprints"
              value={value}
              open={sprintsOpen}
              onOpenChange={setSprintsOpen}
              describedBy="projects-sprints-help"
            >
              {!selection.project ? (
                <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">請先選擇專案</p>
              ) : selection.project !== project ? (
                <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">正在載入 Sprints…</p>
              ) : orderedSprints.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">此專案暫無可檢視的 Sprints</p>
              ) : orderedSprints.map((sprint) => (
                <label key={sprint.id} className="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                  <input
                    type="checkbox"
                    checked={selection.selectedSprintIds.includes(sprint.id)}
                    onChange={(event) => toggleSprint(sprint.id, event.target.checked)}
                    className="h-4 w-4 shrink-0 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  />
                  <span className="min-w-0 break-words">{sprint.name}</span>
                </label>
              ))}
            </FilterDropdown>
            <p id="projects-sprints-help" className="sr-only">可複選該專案的 Sprints；未勾選表示不限制 Sprint。專案分析功能尚未開放。</p>
          </>
        }
        teamSlot={
          <TeamSelect
            groups={groups}
            onGroupsChange={(nextGroups) => setGroups(nextGroups)}
            perMember={false}
            helpText="團隊選取僅保留於本頁；專案分析功能尚未開放，目前不會查詢分析資料。"
          />
        }
      />
      {selection.error ? <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">{selection.error}</p> : null}
      {isPending ? (
        <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">正在更新篩選條件…</p>
      ) : null}
    </div>
  )
}

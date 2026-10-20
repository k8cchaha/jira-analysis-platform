"use client"

import { useState, type ReactNode } from "react"
import { FilterDropdown } from "@/components/filter-dropdown"
import { SPRINT_PROJECTS, type SprintProjectKey } from "@/lib/jira-jql"
import type { SprintRecord } from "@/lib/jira-sprint-data"

export function SprintSelector({
  project,
  sprints,
  selectedSprintId,
  teamSlot,
  trailing,
  onNavigate,
}: {
  project: SprintProjectKey | null
  sprints: readonly SprintRecord[]
  selectedSprintId: number | null
  teamSlot?: ReactNode
  trailing?: ReactNode
  /** navigation 由呼叫端以 transition 執行；省略時此元件不觸發導航。 */
  onNavigate?: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [sprintOpen, setSprintOpen] = useState(false)

  const projectLabel = project
    ? SPRINT_PROJECTS.find((option) => option.key === project)?.label ?? project
    : "選擇專案"

  const selectedSprint = sprints.find(
    (sprint) => sprint.id === selectedSprintId
  )
  const sprintLabel =
    project === null || sprints.length === 0
      ? "選擇 Sprint"
      : selectedSprint
        ? selectedSprint.name
        : "選擇 Sprint"

  function pushSprint(sprintId: number) {
    setSprintOpen(false)
    const sprint = sprints.find((s) => s.id === sprintId)
    if (!sprint) return
    const params = new URLSearchParams({ project: project!, sprint: String(sprint.id) })
    onNavigate?.(`/sprint/burndown?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
      <div className="w-full min-w-0 lg:w-44 lg:shrink-0">
        <FilterDropdown
          id="sprint-project"
          label="專案"
          value={projectLabel}
          open={open}
          onOpenChange={setOpen}
          describedBy="sprint-project-help"
        >
          <div role="radiogroup" aria-label="選擇專案" className="py-1">
            {SPRINT_PROJECTS.map((option) => {
              const active = project === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setOpen(false)
                    if (!active) {
                      onNavigate?.(`/sprint/burndown?project=${option.key}`)
                    }
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? "border-blue-600" : "border-slate-300 dark:border-slate-600"}`}
                  >
                    {active ? <span className="h-2 w-2 rounded-full bg-blue-600" /> : null}
                  </span>
                  <span className="truncate">
                    {option.label}
                    <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">({option.key})</span>
                  </span>
                </button>
              )
            })}
          </div>
        </FilterDropdown>
        <p id="sprint-project-help" className="sr-only">
          選擇要查看燃盡圖的專案。
        </p>
      </div>

      <div className="w-full min-w-0 lg:w-40 lg:shrink-0">
        <FilterDropdown
          id="sprint"
          label="Sprint"
          value={sprintLabel}
          open={sprintOpen}
          onOpenChange={setSprintOpen}
          describedBy="sprint-help"
        >
          {project === null ? (
            <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
              請先選擇專案
            </div>
          ) : sprints.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
              此專案暫無已開始的 Sprint
            </div>
          ) : (
            <div role="listbox" aria-label="選擇 Sprint" className="py-1">
              {[...sprints]
                .sort((a, b) => b.startDate.localeCompare(a.startDate))
                .map((sprint) => {
                  const active = sprint.id === selectedSprintId
                  return (
                    <button
                      key={sprint.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => pushSprint(sprint.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <span className="truncate">{sprint.name}</span>
                    </button>
                  )
                })}
            </div>
          )}
        </FilterDropdown>
        <p id="sprint-help" className="sr-only">
          選擇要查看燃盡圖的 Sprint。
        </p>
      </div>
      {teamSlot ? <div className="w-full min-w-0 lg:w-56 lg:shrink-0">{teamSlot}</div> : null}
      {trailing ? <div className="w-auto lg:ml-auto">{trailing}</div> : null}
    </div>
  )
}
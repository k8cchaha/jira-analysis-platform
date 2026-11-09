"use client"

import { useId, useState } from "react"
import { FilterDropdown } from "@/components/filter-dropdown"
import { SPRINT_PROJECTS, type SprintProjectKey } from "@/lib/jira-jql"

/** 共用專案單選器；尺寸由 FilterDropdown 的 project kind 決定。 */
export function ProjectSelector({ project, required = false, onProjectChange, idPrefix }: {
  project: SprintProjectKey | null
  required?: boolean
  onProjectChange: (project: SprintProjectKey) => void
  idPrefix?: string
}) {
  const generated = useId()
  const id = idPrefix ?? generated
  const [open, setOpen] = useState(false)
  const value = project ? SPRINT_PROJECTS.find((option) => option.key === project)?.label ?? project : "選擇專案"

  return (
    <>
      <FilterDropdown kind="project" id={id} label="專案" required={required} value={value} open={open} onOpenChange={setOpen} describedBy={`${id}-help`}>
        <div role="radiogroup" aria-label="選擇專案" className="py-1">
          {SPRINT_PROJECTS.map((option) => {
            const active = project === option.key
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => { setOpen(false); if (!active) onProjectChange(option.key) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? "border-blue-600" : "border-slate-300 dark:border-slate-600"}`}>
                  {active ? <span className="h-2 w-2 rounded-full bg-blue-600" /> : null}
                </span>
                <span className="truncate">{option.label}<span className="ml-1 text-xs text-slate-500 dark:text-slate-400">({option.key})</span></span>
              </button>
            )
          })}
        </div>
      </FilterDropdown>
      <p id={`${id}-help`} className="sr-only">選擇要查看的專案。</p>
    </>
  )
}

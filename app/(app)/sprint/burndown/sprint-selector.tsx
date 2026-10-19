"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FilterDropdown } from "@/components/filter-dropdown"
import { SPRINT_PROJECTS, type SprintProjectKey } from "@/lib/jira-jql"

export function SprintSelector({
  project,
}: {
  project: SprintProjectKey | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const projectLabel = project
    ? SPRINT_PROJECTS.find((option) => option.key === project)?.label ?? project
    : "選擇專案"

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
      <div className="w-full min-w-0 lg:w-64">
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
                      router.push(`/sprint/burndown?project=${option.key}`)
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
    </div>
  )
}
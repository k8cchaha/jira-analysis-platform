"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { SprintSelector } from "@/app/(app)/sprint/burndown/sprint-selector"
import { CapacityPanel } from "@/app/(app)/sprint/capacity/capacity-panel"
import type { SprintProjectKey } from "@/lib/jira-jql"
import type { SprintRecord } from "@/lib/jira-sprint-data"

export function CapacityClient({
  project,
  sprints,
  selectedSprintId,
  sprint,
  viewerAccountId,
}: {
  project: SprintProjectKey | null
  sprints: readonly SprintRecord[]
  selectedSprintId: number | null
  sprint: SprintRecord | null
  viewerAccountId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function navigate(path: string) {
    startTransition(() => router.push(path))
  }

  return (
    <div className="relative">
      <SprintSelector
        project={project}
        sprints={sprints}
        selectedSprintId={selectedSprintId}
        basePath="/sprint/capacity"
        onNavigate={navigate}
      />

      {!project ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">請先選擇專案</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">從上方選擇專案後，將顯示該專案 Sprint 的人力 Capacity。</p>
        </div>
      ) : !sprint ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{project} 暫無進行中或未來的 Sprint</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">此專案目前沒有可查看 Capacity 的 Sprint。</p>
        </div>
      ) : (
        // Mock data belongs to the project, not the sprint; reset it on project changes only.
        <CapacityPanel key={project} project={project} viewerAccountId={viewerAccountId} />
      )}

      {isPending && (
        <div
          role="status"
          aria-label="正在更新 Capacity"
          aria-live="polite"
          className="fixed inset-0 z-50 flex cursor-wait items-center justify-center bg-slate-950/40 backdrop-blur-[1px]"
          data-pending=""
        >
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <svg aria-hidden="true" className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
            更新中…
          </div>
        </div>
      )}
    </div>
  )
}

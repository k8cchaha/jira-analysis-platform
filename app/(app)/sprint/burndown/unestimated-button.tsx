"use client"

import { useState } from "react"
import { UnestimatedDialog } from "@/app/(app)/sprint/burndown/unestimated-dialog"
import type { BurndownUnestimated } from "@/lib/jira-burndown"

export function UnestimatedButton({
  issues,
  jiraBaseUrl,
}: {
  issues: readonly BurndownUnestimated[]
  jiraBaseUrl: string | null
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50"
      >
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
        未估時的任務：<span className="font-semibold tabular-nums">{issues.length}</span>
      </button>
      {open && (
        <UnestimatedDialog
          issues={issues}
          jiraBaseUrl={jiraBaseUrl}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
import { useState, type ReactNode } from "react"
import type { SprintRecord } from "@/lib/jira-sprint-data"
import type { ProjectsAnalysisTask } from "@/lib/projects-analysis"
import { IssueTypeIcon } from "@/components/issue-type-icon"
import { TicketLink } from "@/components/ticket-link"
import { statusColorClass } from "@/lib/status-color"

type ParentStatusSort = "none" | "ascending" | "descending"
const SORT_LABELS: Record<ParentStatusSort, string> = {
  none: "目前依 Ticket 原序；點擊依母票狀態升冪排序",
  ascending: "目前依母票狀態升冪；點擊改為降冪排序",
  descending: "目前依母票狀態降冪；點擊取消排序並恢復原序",
}

/** The caller owns the chart's complete cohort; sorting only reorders a display copy. */
export function ProjectsUnfinishedDetail({ sprint, tasks, jiraBaseUrl, renderPoint }: {
  sprint: SprintRecord | null
  tasks: readonly ProjectsAnalysisTask[]
  jiraBaseUrl: string | null
  renderPoint: (task: ProjectsAnalysisTask) => ReactNode
}) {
  const [statusSort, setStatusSort] = useState<ParentStatusSort>("none")
  const label = sprint?.name ?? "全部已選 Sprint 加總"
  const rows = statusSort === "none" ? tasks : [...tasks].sort((a, b) => {
    const tie = a.key.localeCompare(b.key, "en") || a.id.localeCompare(b.id, "en")
    if (a.parentStatus === null) return b.parentStatus === null ? tie : 1
    if (b.parentStatus === null) return -1
    const order = a.parentStatus.localeCompare(b.parentStatus, "zh-Hant")
    return (statusSort === "ascending" ? order : -order) || tie
  })
  return <section id="unfinished-readout" data-unfinished-sprint={sprint?.id ?? "all"} aria-label={`${label} 目前未完成工作單`} className="mt-4 min-w-0 border-t border-slate-200 pt-4 dark:border-slate-700">
    <h3 className="mb-3 text-sm font-semibold">{label} · 目前未完成工作單（{tasks.length} 張）</h3>
    {tasks.length ? <div role="region" aria-label="未完成工作單明細表格，可左右捲動" tabIndex={0} className="min-w-0 overflow-x-auto focus-visible:outline-2 focus-visible:outline-blue-600"><table className="projects-unfinished-table">
      <caption className="sr-only">{label} 未完成工作單明細</caption>
      <thead><tr><th scope="col">母票類型</th><th scope="col" aria-sort={statusSort}><button type="button" aria-label={SORT_LABELS[statusSort]} title={SORT_LABELS[statusSort]} className="flex min-h-9 items-center gap-1 rounded hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-slate-800" onClick={() => setStatusSort((previous) => previous === "none" ? "ascending" : previous === "ascending" ? "descending" : "none")}>
        母票狀態<svg aria-hidden="true" className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d={statusSort === "none" ? "M5 13V3m-3 3 3-3 3 3m3-3v10m-3-3 3 3 3-3" : statusSort === "descending" ? "M8 3v10m-4-4 4 4 4-4" : "M8 13V3m-4 4 4-4 4 4"} /></svg>
      </button></th><th scope="col">Ticket</th><th scope="col">Summary</th><th scope="col">狀態</th><th scope="col">Assignee</th><th scope="col">SP</th></tr></thead>
      <tbody>{rows.map((task) => <tr key={task.id}>
        <td><span className="inline-flex items-center" title={`母票 ${task.parentKey}`}><IssueTypeIcon issueType={task.parentIssueType ?? null} /></span></td>
        <td><span className={statusColorClass(task.parentStatus)}>{task.parentStatus ?? "—"}</span></td>
        <td><TicketLink task={task} jiraBaseUrl={jiraBaseUrl} /></td>
        <td><div className="min-w-48 max-w-md whitespace-normal break-words">{task.summary}</div></td>
        <td>{task.statusName ?? "—"}</td>
        <td>{task.assigneeDisplayName ?? "未指派"}</td>
        <td>{task.points === null ? "-" : renderPoint(task)}</td>
      </tr>)}</tbody>
    </table></div> : <p role="status" className="text-sm text-slate-500 dark:text-slate-400">{sprint ? "此 Sprint" : "全部已選 Sprint"}目前沒有未完成工作單。</p>}
  </section>
}

"use client"

import { ParentIssueTypeIcon } from "@/app/(app)/dashboard/parent-issue-type-icon"
import { TicketLink } from "@/components/ticket-link"
import type { WorkloadCompletedTask, HeatmapWeek } from "@/lib/workload-heatmap"

const resolvedText = (date: string | null) => date === null ? "—" : date.slice(5).replace("-", "/")
const pointText = (value: number | null) => value === null ? "未填" : Number.isInteger(value) ? String(value) : value.toFixed(1)

/** 所選週格的唯讀原始任務，資料已在同一條 base 串流取得，不另查 Jira。 */
export function WorkloadIssueDetails({
  id, memberName, week, tasks, jiraBaseUrl, onClose,
}: {
  id: string
  memberName: string
  week: HeatmapWeek
  tasks: readonly WorkloadCompletedTask[]
  jiraBaseUrl: string | null
  onClose: () => void
}) {
  const totalPoints = Math.round(tasks.reduce((sum, task) => sum + (task.points ?? 0), 0) * 10) / 10
  const totalActualPoints = Math.round(tasks.reduce((sum, task) => sum + (task.actualPoints ?? 0), 0) * 10) / 10

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-4 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="break-words text-sm font-semibold text-slate-900 dark:text-white">
            {memberName}・{tasks.length} 張・SP 合計：{pointText(totalPoints)} 點 | Actual SP 合計：{pointText(totalActualPoints)} 點
          </h3>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">關閉明細</button>
      </div>
      <div className="hidden max-w-full overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">{memberName} 的每週單據明細，{week.from} ～ {week.to}</caption>
          <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <tr>
              <th scope="col" className="w-10 px-3 py-3"><span className="sr-only">Parent Type Icon</span></th>
              <th scope="col" className="px-3 py-3 font-medium">Ticket</th>
              <th scope="col" className="px-3 py-3 font-medium">Summary</th>
              <th scope="col" className="px-3 py-3 font-medium">Resolution</th>
              <th scope="col" className="px-3 py-3 font-medium">Resolved</th>
              <th scope="col" className="px-3 py-3 text-right font-medium" title="Story Points">SP</th>
              <th scope="col" className="px-3 py-3 text-right font-medium" title="Actual Story Points">Actual SP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {tasks.map((task) => (
              <tr key={task.key} className="align-top">
                <td className="px-3 py-3"><ParentIssueTypeIcon parent={task.parentIssueType} /></td>
                <td className="px-3 py-3"><TicketLink task={task} jiraBaseUrl={jiraBaseUrl} /></td>
                <td className="max-w-sm break-words px-3 py-3 text-slate-900 dark:text-white">{task.summary ?? "—"}</td>
                <td className="break-words px-3 py-3 text-slate-600 dark:text-slate-300">{task.resolution ?? "—"}</td>
                <td className="px-3 py-3 text-slate-600 tabular-nums dark:text-slate-300">{resolvedText(task.resolvedDate)}</td>
                <td className="px-3 py-3 text-right text-slate-600 tabular-nums dark:text-slate-300">{pointText(task.points)}</td>
                <td className="px-3 py-3 text-right text-slate-600 tabular-nums dark:text-slate-300">{pointText(task.actualPoints)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-slate-200 md:hidden dark:divide-slate-700">
        {tasks.map((task) => (
          <article key={task.key} className="min-w-0 p-4">
            <div className="flex items-center gap-2"><ParentIssueTypeIcon parent={task.parentIssueType} /><TicketLink task={task} jiraBaseUrl={jiraBaseUrl} /></div>
            <p className="mt-2 break-words text-sm text-slate-900 dark:text-white">{task.summary ?? "—"}</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
              <div className="min-w-0"><dt>Resolution</dt><dd className="break-words">{task.resolution ?? "—"}</dd></div>
              <div><dt>Resolved</dt><dd className="tabular-nums">{resolvedText(task.resolvedDate)}</dd></div>
              <div><dt title="Story Points">SP</dt><dd className="tabular-nums">{pointText(task.points)}</dd></div>
              <div><dt title="Actual Story Points">Actual SP</dt><dd className="tabular-nums">{pointText(task.actualPoints)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}

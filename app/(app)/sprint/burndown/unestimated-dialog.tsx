"use client"

import { useState } from "react"
import { EditDialog } from "@/components/edit-dialog"
import { ParentIssueTypeIcon } from "@/app/(app)/dashboard/parent-issue-type-icon"
import type { BurndownUnestimated } from "@/lib/jira-burndown"

export function UnestimatedDialog({
  issues,
  jiraBaseUrl,
  onClose,
}: {
  issues: readonly BurndownUnestimated[]
  jiraBaseUrl: string | null
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)

  return (
    <EditDialog
      title="未估計的 Dev-Task"
      description="這些 Dev-Task 尚未填寫 Story Points，未計入燃盡圖，請團隊補填。"
      count={issues.length}
      iconClose
      busy={busy}
      onClose={() => {
        if (busy) return
        onClose()
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {issues.length === 0 ? (
          <p role="status" className="p-8 text-center text-sm text-slate-600 dark:text-slate-400">目前沒有未估計的 Dev-Task。</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto px-4 sm:px-6 md:block">
              <table className="w-full table-fixed text-left text-sm min-w-[560px]">
                <caption className="sr-only">未估計的 Dev-Task</caption>
                <thead className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="w-10 py-3"><span className="sr-only">Parent Issue type</span></th>
                    <th scope="col" className="w-32 px-3 py-3 font-medium">Ticket</th>
                    <th scope="col" className="w-40 px-3 py-3 font-medium">Assignee</th>
                    <th scope="col" className="px-3 py-3 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {issues.map((issue) => (
                    <tr key={issue.key} className="align-top">
                      <td className="py-4 pl-4"><ParentIssueTypeIcon parent={issue.parentIssueType} /></td>
                      <td className="px-3 py-3">
                        {jiraBaseUrl ? (
                          <a
                            href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(issue.key)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`在 Jira 開啟 ${issue.key}（另開分頁）`}
                            className="break-words font-medium text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300"
                          >
                            {issue.key}
                          </a>
                        ) : (
                          <span className="break-words font-medium">{issue.key}</span>
                        )}
                      </td>
                      <td className="break-words px-3 py-3 text-slate-600 dark:text-slate-300">{issue.assigneeDisplayName || "—"}</td>
                      <td className="break-words px-3 py-3">{issue.summary || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-200 md:hidden dark:divide-slate-800">
              {issues.map((issue) => (
                <article key={issue.key} className="p-4">
                  <div className="flex items-center gap-2">
                    <ParentIssueTypeIcon parent={issue.parentIssueType} />
                    {jiraBaseUrl ? (
                      <a
                        href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(issue.key)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-words font-medium text-blue-600 hover:underline dark:text-blue-300"
                      >
                        {issue.key}
                      </a>
                    ) : (
                      <span className="break-words font-medium">{issue.key}</span>
                    )}
                  </div>
                  <p className="mt-2 break-words text-xs text-slate-500 dark:text-slate-400">Assignee：{issue.assigneeDisplayName || "—"}</p>
                  <p className="mt-1 break-words text-sm">{issue.summary || "—"}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </EditDialog>
  )
}
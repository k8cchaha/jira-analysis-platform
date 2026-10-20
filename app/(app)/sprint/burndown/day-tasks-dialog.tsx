"use client"

import { useMemo, useState } from "react"
import { EditDialog } from "@/components/edit-dialog"
import { ParentIssueTypeIcon } from "@/app/(app)/dashboard/parent-issue-type-icon"
import { TeamSelect } from "@/components/team-select"
import type { BurndownTask } from "@/lib/jira-burndown"

/**
 * 指定日期完成的 Dev-Task 清單。由 `burndown-client` 在點擊長條時開啟；
 * `tasks` 為已依主圖團隊過濾的任務。彈窗內另有獨立團隊 Filter，只縮小此清單
 * （站內 state、不重發 JQL、不影響主圖）。預設「全部」。
 */
export function DayTasksDialog({
  date,
  tasks,
  jiraBaseUrl,
  onClose,
}: {
  date: string
  tasks: readonly BurndownTask[]
  jiraBaseUrl: string | null
  onClose: () => void
}) {
  const [groups, setGroups] = useState<string[]>([])
  const [memberIds, setMemberIds] = useState<ReadonlySet<string> | null>(null)

  const done = useMemo(() => {
    const byDay = tasks.filter((task) => task.doneDate === date)
    if (memberIds === null) return byDay
    return byDay.filter((task) => task.assigneeAccountId !== null && memberIds.has(task.assigneeAccountId))
  }, [tasks, date, memberIds])

  return (
    <EditDialog
      title={`${date} 完成的 Dev-Task`}
      description=""
      count={done.length}
      compact
      iconClose
      onClose={onClose}
    >
      <div className="shrink-0 border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800">
        <div className="w-full max-w-xs">
          <TeamSelect
            groups={groups}
            perMember={false}
            onGroupsChange={(nextGroups, accountIds, ready) => {
              setGroups(nextGroups)
              setMemberIds(
                nextGroups.length > 0 && ready && accountIds.length > 0 ? new Set(accountIds) : null
              )
            }}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {done.length === 0 ? (
          <p role="status" className="p-8 text-center text-sm text-slate-600 dark:text-slate-400">
            當天沒有對應的 Dev-Task。
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full table-fixed text-left text-sm min-w-[560px]">
                <caption className="sr-only">{date} 完成的 Dev-Task</caption>
                <thead className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="w-10 py-3"><span className="sr-only">Parent Issue type</span></th>
                    <th scope="col" className="w-32 px-3 py-3 font-medium">Ticket</th>
                    <th scope="col" className="w-24 px-3 py-3 font-medium">Story Points</th>
                    <th scope="col" className="w-40 px-3 py-3 font-medium">Assignee</th>
                    <th scope="col" className="px-3 py-3 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {done.map((task) => (
                    <tr key={task.key} className="align-top">
                      <td className="py-3 pl-4"><ParentIssueTypeIcon parent={task.parentIssueType} /></td>
                      <td className="px-3 py-3">
                        {jiraBaseUrl ? (
                          <a
                            href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(task.key)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`在 Jira 開啟 ${task.key}（另開分頁）`}
                            className="break-words font-medium text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300"
                          >
                            {task.key}
                          </a>
                        ) : (
                          <span className="break-words font-medium">{task.key}</span>
                        )}
                      </td>
                      <td className="break-words px-3 py-3 tabular-nums text-slate-600 dark:text-slate-300">{task.points}</td>
                      <td className="break-words px-3 py-3 text-slate-600 dark:text-slate-300">{task.assigneeDisplayName || "—"}</td>
                      <td className="break-words px-3 py-3">{task.summary || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-200 md:hidden dark:divide-slate-800">
              {done.map((task) => (
                <article key={task.key} className="p-4">
                  <div className="flex items-center gap-2">
                    <ParentIssueTypeIcon parent={task.parentIssueType} />
                    {jiraBaseUrl ? (
                      <a
                        href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(task.key)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-words font-medium text-blue-600 hover:underline dark:text-blue-300"
                      >
                        {task.key}
                      </a>
                    ) : (
                      <span className="break-words font-medium">{task.key}</span>
                    )}
                    <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400">{task.points} 點</span>
                  </div>
                  <p className="mt-2 break-words text-xs text-slate-500 dark:text-slate-400">Assignee：{task.assigneeDisplayName || "—"}</p>
                  <p className="mt-1 break-words text-sm">{task.summary || "—"}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </EditDialog>
  )
}
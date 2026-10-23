"use client"

import { useMemo } from "react"
import { EditDialog } from "@/components/edit-dialog"
import { ParentIssueTypeIcon } from "@/app/(app)/dashboard/parent-issue-type-icon"
import type { BurndownTask } from "@/lib/jira-burndown"

/** 依 issue 目前狀態回傳文字顏色類別：In Review / In Progress 藍、Done 綠、其餘預設。 */
function statusColorClass(status: string | null): string {
  const value = status?.toLowerCase()
  if (value === "in review" || value === "in progress") {
    return "text-blue-600 dark:text-blue-300"
  }
  if (value === "done") {
    return "text-green-600 dark:text-green-400"
  }
  return "text-slate-600 dark:text-slate-300"
}

/**
 * 開發狀況彈窗：列出已依團隊＋指派＋完成狀態過濾好的 Dev-Task。
 * 由「成員開發狀況」點擊張數時開啟；`tasks` 已在呼叫端過濾、"今天" 的完成
 * 判定也已在呼叫端做好，此處只負責呈現清單與加總（不重發 JQL）。
 */
export function DevTaskListDialog({
  title,
  tasks,
  jiraBaseUrl,
  showStatus = false,
  onClose,
}: {
  title: string
  tasks: readonly BurndownTask[]
  jiraBaseUrl: string | null
  /** 顯示 Dev-Task 自身 Jira 狀態欄（目前僅「未完成」清單開啟）。 */
  showStatus?: boolean
  onClose: () => void
}) {
  const totalPoints = useMemo(() => tasks.reduce((sum, task) => sum + task.points, 0), [tasks])
  const totalActualPoints = useMemo(
    () => tasks.reduce((sum, task) => sum + (task.actualPoints ?? 0), 0),
    [tasks]
  )

  return (
    <EditDialog title={title} description="" count={tasks.length} compact iconClose onClose={onClose}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800">
        <dl className="flex items-center gap-4 text-sm" aria-label="此清單的點數加總">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">SP</dt>
            <dd className="tabular-nums font-semibold text-slate-900 dark:text-white">{totalPoints.toLocaleString("zh-TW")}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Actual SP</dt>
            <dd className="tabular-nums font-semibold text-slate-900 dark:text-white">{totalActualPoints ? totalActualPoints.toLocaleString("zh-TW") : "—"}</dd>
          </div>
        </dl>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tasks.length === 0 ? (
          <p role="status" className="p-8 text-center text-sm text-slate-600 dark:text-slate-400">
            沒有對應的 Dev-Task。
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto px-4 sm:px-6 md:block">
              <table className="w-full table-fixed text-left text-sm min-w-[560px]">
                <caption className="sr-only">{title}</caption>
                <thead className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="w-10 py-3"><span className="sr-only">Parent Issue type</span></th>
                    <th scope="col" className="w-28 px-3 py-3 font-medium">Ticket</th>
                    {showStatus && (
                      <th scope="col" className="w-28 px-3 py-3 font-medium">Status</th>
                    )}
                    <th scope="col" className="w-36 px-3 py-3 font-medium">Assignee</th>
                    <th scope="col" className="px-3 py-3 font-medium">Summary</th>
                    <th scope="col" className="w-24 px-3 py-3 text-right font-medium" title="Story Points">SP</th>
                    <th scope="col" className="w-24 px-3 py-3 text-right font-medium" title="Actual Story Points">Actual SP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {tasks.map((task) => (
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
                      {showStatus && (
                        <td className={`break-words px-3 py-3 ${statusColorClass(task.status)}`}>{task.status ?? "—"}</td>
                      )}
                      <td className="break-words px-3 py-3 text-slate-600 dark:text-slate-300">{task.assigneeDisplayName || "—"}</td>
                      <td className="break-words px-3 py-3">{task.summary || "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{task.points}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{task.actualPoints ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-200 md:hidden dark:divide-slate-800">
              {tasks.map((task) => (
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
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400" title="Story Points">SP {task.points}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400" title="Actual Story Points">Actual {task.actualPoints ?? "—"}</span>
                    </span>
                  </div>
                  <p className="mt-2 break-words text-xs text-slate-500 dark:text-slate-400">Assignee：{task.assigneeDisplayName || "—"}</p>
                  {showStatus && (
                    <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                      Status：<span className={statusColorClass(task.status)}>{task.status ?? "—"}</span>
                    </p>
                  )}
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
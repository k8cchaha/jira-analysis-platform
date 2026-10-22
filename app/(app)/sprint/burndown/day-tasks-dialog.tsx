"use client"

import { useMemo, useState } from "react"
import { EditDialog } from "@/components/edit-dialog"
import { ParentIssueTypeIcon } from "@/app/(app)/dashboard/parent-issue-type-icon"
import { TeamSelect } from "@/components/team-select"
import type { BurndownTask } from "@/lib/jira-burndown"

/** 開局格（sprint 開始前已完成）的對話框標題。 */
const OPENING_TITLE = "開局前已完成的 Dev-Task"

/**
 * 指定日期完成的 Dev-Task 清單。由 `burndown-client` 在點擊長條時開啟；
 * `tasks` 為已依主圖團隊過濾的任務。彈窗內另有獨立團隊 Filter，只縮小此清單
 * （站內 state、不重發 JQL、不影響主圖）。預設「全部」。
 *
 * `beforeStart` 為 true 時代表本次點擊的是「空起點格」的綠色長條：列出
 * sprint 開始前就已 Done（`doneBeforeStart`）的 Dev-Task；否則依 `date`
 * 當天完成（`doneDate === date`）過濾。
 */
export function DayTasksDialog({
  date,
  beforeStart = false,
  tasks,
  jiraBaseUrl,
  onClose,
}: {
  /** 一般日期的完成日；`beforeStart` 時此值僅用於見標題/無關內容。 */
  date: string
  /** 是否為「開局前已完成」檢視（綠色起點格）。 */
  beforeStart?: boolean
  tasks: readonly BurndownTask[]
  jiraBaseUrl: string | null
  onClose: () => void
}) {
  const [groups, setGroups] = useState<string[]>([])
  const [memberIds, setMemberIds] = useState<ReadonlySet<string> | null>(null)

  const done = useMemo(() => {
    const byDay = beforeStart
      ? tasks.filter((task) => task.doneBeforeStart)
      : tasks.filter((task) => task.doneDate === date)
    if (memberIds === null) return byDay
    return byDay.filter((task) => task.assigneeAccountId !== null && memberIds.has(task.assigneeAccountId))
  }, [tasks, date, memberIds, beforeStart])

  // 依團隊 Filter 縮小後的清單加總（Actual SP 視有值者累計；無值是 null 不進總計）。
  const totalPoints = useMemo(
    () => done.reduce((sum, task) => sum + task.points, 0),
    [done]
  )
  const totalActualPoints = useMemo(
    () => done.reduce((sum, task) => sum + (task.actualPoints ?? 0), 0),
    [done]
  )

  return (
    <EditDialog
      title={beforeStart ? OPENING_TITLE : `${date} 完成的 Dev-Task`}
      description={
        beforeStart
          ? "這些 Dev-Task 在 sprint 開始日之前就已 Done，屬於空起點格的綠色長條，也已計入總點數與剩餘。"
          : ""
      }
      count={done.length}
      compact
      iconClose
      onClose={onClose}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800">
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
        {done.length === 0 ? (
          <p role="status" className="p-8 text-center text-sm text-slate-600 dark:text-slate-400">
            {beforeStart ? "目前沒有開局前已完成的 Dev-Task。" : "當天沒有對應的 Dev-Task。"}
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto px-4 sm:px-6 md:block">
              <table className="w-full table-fixed text-left text-sm min-w-[560px]">
                <caption className="sr-only">{beforeStart ? OPENING_TITLE : `${date} 完成的 Dev-Task`}</caption>
                <thead className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="w-10 py-3"><span className="sr-only">Parent Issue type</span></th>
                    <th scope="col" className="w-28 px-3 py-3 font-medium">Ticket</th>
                    <th scope="col" className="w-36 px-3 py-3 font-medium">Assignee</th>
                    <th scope="col" className="px-3 py-3 font-medium">Summary</th>
                    <th scope="col" className="w-24 px-3 py-3 text-right font-medium" title="Story Points">SP</th>
                    <th scope="col" className="w-24 px-3 py-3 text-right font-medium" title="Actual Story Points">Actual SP</th>
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
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400" title="Story Points">SP {task.points}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400" title="Actual Story Points">Actual {task.actualPoints ?? "—"}</span>
                    </span>
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
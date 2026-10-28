"use client"

import { useMemo, useState } from "react"
import { computeBurndownStatus, type TeamStatus } from "@/lib/burndown-status"
import type { BurndownTask } from "@/lib/jira-burndown"
import { DevTaskListDialog } from "@/app/(app)/sprint/burndown/dev-task-list-dialog"

/** 點數一律顯示到小數第一位（與圖表一致）。 */
function formatPoints(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/** 完成度字串；null 回「—」。 */
function percent(value: number | null): string {
  return value === null ? "—" : `${value}%`
}

/** 可點擊的張數：以按鈕呈現，點擊回呼標題與已過濾任務。 */
function CountButton({
  count,
  label,
  title,
  onClick,
}: {
  count: number
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="font-semibold text-blue-600 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300"
    >
      {count} {label}
    </button>
  )
}

/**
 * 燃盡圖下方的「成員開發狀況」：每個團隊一個卡片、一排排兩個，團隊卡片內
 * 顯示團隊整體完成度與每位成員的完成/未完成統計。資料與圖表共用同一個
 * 已過濾的 `tasks`，不重發 JQL。所有張數可點擊，開啟對應的 Dev-Task 清單。
 */
export function DevelopmentStatus({
  teamOf,
  teamOrder,
  tasks,
  today,
  jiraBaseUrl,
  blockedParentStatuses,
}: {
  /** accountId → 團隊 label 的映射（由團隊選單載入）；缺省者歸「其他」。 */
  teamOf: Record<string, string>
  /** 團隊顯示順序（label，取自 DASHBOARD_TEAMS）。 */
  teamOrder: readonly string[]
  /** 已經過濾、已估計的 Dev-Task（與圖表同源）。 */
  tasks: readonly BurndownTask[]
  /** 今天（`YYYY-MM-DD`）。 */
  today: string | null
  /** Jira 主站 URL，供彈窗列內文開外連。 */
  jiraBaseUrl: string | null
  /** 母票目前狀態 ∈ 此集合的 Dev-Task 視為已完成（與圖表共用勾選）。 */
  blockedParentStatuses?: ReadonlySet<string> | null
}) {
  const [list, setList] = useState<{ title: string; tasks: BurndownTask[]; showStatus?: boolean } | null>(null)

  const teams = useMemo(
    () => (today ? computeBurndownStatus({ tasks, today, teamOf: (accountId) => (accountId === null ? undefined : teamOf[accountId]), teamOrder, blockedParentStatuses }) : []),
    [tasks, today, teamOf, teamOrder, blockedParentStatuses]
  )

  // 依 teamKey + assignee + 完成與否過濾原始 tasks（同一份 teamOf 判定）；
  // 完成判定須與計算一致（`computeBurndownStatus`）：開局前 Done（doneBeforeStart）、
  // 或 doneDate 今天以前（含）、或受阻母票在勾選時也視為已完成。
  const isTaskDone = (task: BurndownTask): boolean =>
    task.doneBeforeStart ||
    (task.doneDate !== null && task.doneDate <= (today ?? "")) ||
    (blockedParentStatuses !== null &&
      blockedParentStatuses !== undefined &&
      task.parentStatus !== null &&
      blockedParentStatuses.has(task.parentStatus))
  const filterTasks = (
    teamKey: string,
    assigneeAccountId: string | null | "all",
    done: "done" | "notDone" | "all"
  ): BurndownTask[] => {
    return tasks.filter((task) => {
      if (teamKey !== "other" && teamOf[task.assigneeAccountId ?? ""] !== teamKey) return false
      if (teamKey === "other" && (task.assigneeAccountId === null || teamOf[task.assigneeAccountId] !== undefined)) return false
      if (assigneeAccountId !== "all" && task.assigneeAccountId !== assigneeAccountId) return false
      const taskDone = isTaskDone(task)
      if (done === "done" && !taskDone) return false
      if (done === "notDone" && taskDone) return false
      return true
    })
  }

  if (!today || teams.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-2 font-semibold text-slate-900 dark:text-white">成員開發狀況</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {today ? "開發狀況資料載入中…" : "選擇 Sprint 後顯示開發狀況。"}
        </p>
      </div>
    )
  }

  const doneTotal = teams.reduce((sum, team) => sum + team.donePoints, 0)
  const totalTotal = teams.reduce((sum, team) => sum + team.donePoints + team.notDonePoints, 0)
  const overallPercent = totalTotal > 0 ? Math.round((doneTotal / totalTotal) * 1000) / 10 : null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900 dark:text-white">成員開發狀況</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          整體完成度：<span className="font-semibold text-slate-700 dark:text-slate-200">{overallPercent === null ? "—" : `${overallPercent}%`}</span>
          <span className="mx-1">，已完成 {formatPoints(doneTotal)} / {formatPoints(totalTotal)} SP</span>
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {teams.map((team) => (
          <TeamCard key={team.teamKey} team={team} onOpen={setList} filterTaskCounts={filterTasks} />
        ))}
      </div>

      {list && (
        <DevTaskListDialog
          title={list.title}
          tasks={list.tasks}
          jiraBaseUrl={jiraBaseUrl}
          showStatus={list.showStatus}
          onClose={() => setList(null)}
        />
      )}
    </div>
  )
}

function TeamCard({
  team,
  onOpen,
  filterTaskCounts,
}: {
  team: TeamStatus
  onOpen: (list: { title: string; tasks: BurndownTask[]; showStatus?: boolean }) => void
  filterTaskCounts: (
    teamKey: string,
    assigneeAccountId: string | null | "all",
    done: "done" | "notDone" | "all"
  ) => BurndownTask[]
}) {
  const doneTasks = filterTaskCounts(team.teamKey, "all", "done")
  const notDoneTasks = filterTaskCounts(team.teamKey, "all", "notDone")

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{team.label}</h3>
        <span
          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          title={`${team.label} 完成度`}
        >
          完成度 {percent(team.completionPercent)}
        </span>
      </header>
      {team.completionPercent !== null && (
        <div className="h-1 w-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full bg-blue-500 dark:bg-blue-400"
            style={{ width: `${Math.min(100, team.completionPercent)}%` }}
          />
        </div>
      )}
      {team.assignees.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
          此團隊沒有已估計的 Dev-Task。
        </p>
      ) : (
        <>
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{team.label} 成員開發狀況</caption>
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <th scope="col" className="py-2 pl-4 font-semibold">成員</th>
                <th scope="col" className="py-2 pr-2 text-right font-semibold">已完成 (SP)</th>
                <th scope="col" className="py-2 pr-2 text-right font-semibold">未完成 (SP)</th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">完成度</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {team.assignees.map((assignee) => {
                const assigneeDone = filterTaskCounts(team.teamKey, assignee.assigneeAccountId, "done")
                const assigneeNotDone = filterTaskCounts(team.teamKey, assignee.assigneeAccountId, "notDone")
                return (
                  <tr key={assignee.assigneeAccountId ?? "unassigned"} className="align-top">
                    <th scope="row" className="py-2.5 pl-4 pr-2 font-medium text-slate-900 dark:text-white">
                      {assignee.assigneeName}
                    </th>
                    <td className="py-2.5 pr-2 text-right tabular-nums">
                      <span className="whitespace-nowrap">
                        <CountButton
                          count={assignee.doneTasks}
                          label="張"
                          title={`檢視 ${assignee.assigneeName} 已完成的 Dev-Task`}
                          onClick={() => onOpen({ title: `${assignee.assigneeName} 已完成`, tasks: assigneeDone })}
                        />{" "}
                        <span className="text-slate-500 dark:text-slate-400">({formatPoints(assignee.donePoints)})</span>
                      </span>
                      {assignee.doneActualPoints > 0 && (
                        <div className="text-slate-400 dark:text-slate-500">Actual: {formatPoints(assignee.doneActualPoints)}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-2 text-right tabular-nums">
                      <span className="whitespace-nowrap">
                        <CountButton
                          count={assignee.notDoneTasks}
                          label="張"
                          title={`檢視 ${assignee.assigneeName} 未完成的 Dev-Task`}
                          onClick={() => onOpen({ title: `${assignee.assigneeName} 未完成`, tasks: assigneeNotDone, showStatus: true })}
                        />{" "}
                        <span className="text-slate-500 dark:text-slate-400">({formatPoints(assignee.notDonePoints)})</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums font-semibold text-slate-700 dark:text-slate-200">
                      {percent(assignee.completionPercent)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40">
                <th scope="row" className="py-2 pl-4 pr-2 font-semibold text-slate-700 dark:text-slate-200">
                  合計
                </th>
                <td className="py-2 pr-2 text-right tabular-nums">
                  <span className="whitespace-nowrap">
                    <CountButton
                      count={team.doneTasks}
                      label="張"
                      title={`檢視 ${team.label} 已完成的 Dev-Task`}
                      onClick={() => onOpen({ title: `${team.label} 已完成`, tasks: doneTasks })}
                    />{" "}
                    <span className="text-slate-500 dark:text-slate-400">({formatPoints(team.donePoints)})</span>
                  </span>
                  {team.doneActualPoints > 0 && (
                    <div className="text-slate-400 dark:text-slate-500">Actual: {formatPoints(team.doneActualPoints)}</div>
                  )}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  <span className="whitespace-nowrap">
                    <CountButton
                      count={team.notDoneTasks}
                      label="張"
                      title={`檢視 ${team.label} 未完成的 Dev-Task`}
                      onClick={() => onOpen({ title: `${team.label} 未完成`, tasks: notDoneTasks, showStatus: true })}
                    />{" "}
                    <span className="text-slate-500 dark:text-slate-400">({formatPoints(team.notDonePoints)})</span>
                  </span>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums font-semibold text-slate-700 dark:text-slate-200">
                  {percent(team.completionPercent)}
                </td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </section>
  )
}
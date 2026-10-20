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
}) {
  const [list, setList] = useState<{ title: string; tasks: BurndownTask[] } | null>(null)

  const teams = useMemo(
    () => (today ? computeBurndownStatus({ tasks, today, teamOf: (accountId) => (accountId === null ? undefined : teamOf[accountId]), teamOrder }) : []),
    [tasks, today, teamOf, teamOrder]
  )

  // 依 teamKey + assignee + 完成與否過濾原始 tasks（同一份 teamOf 判定）。
  const filterTasks = (
    teamKey: string,
    assigneeAccountId: string | null | "all",
    done: "done" | "notDone" | "all"
  ): BurndownTask[] => {
    return tasks.filter((task) => {
      if (teamKey !== "other" && teamOf[task.assigneeAccountId ?? ""] !== teamKey) return false
      if (teamKey === "other" && (task.assigneeAccountId === null || teamOf[task.assigneeAccountId] !== undefined)) return false
      if (assigneeAccountId !== "all" && task.assigneeAccountId !== assigneeAccountId) return false
      const isDone = task.doneDate !== null && task.doneDate <= (today ?? "")
      if (done === "done" && !isDone) return false
      if (done === "notDone" && isDone) return false
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
  onOpen: (list: { title: string; tasks: BurndownTask[] }) => void
  filterTaskCounts: (
    teamKey: string,
    assigneeAccountId: string | null | "all",
    done: "done" | "notDone" | "all"
  ) => BurndownTask[]
}) {
  const allTasks = filterTaskCounts(team.teamKey, "all", "all")
  const doneTasks = filterTaskCounts(team.teamKey, "all", "done")

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{team.label}</h3>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          完成度 {percent(team.completionPercent)}
        </span>
      </header>
      {team.completionPercent !== null && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-blue-500 dark:bg-blue-400"
            style={{ width: `${Math.min(100, team.completionPercent)}%` }}
          />
        </div>
      )}
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
        已完成{" "}
        <CountButton
          count={team.doneTasks}
          label="張"
          title={`檢視 ${team.label} 已完成的 Dev-Task`}
          onClick={() => onOpen({ title: `${team.label} 已完成`, tasks: doneTasks })}
        />
        <span className="mx-1">/</span>
        <CountButton
          count={team.totalTasks}
          label="張"
          title={`檢視 ${team.label} 的所有 Dev-Task`}
          onClick={() => onOpen({ title: `${team.label} 的 Dev-Task`, tasks: allTasks })}
        />
        <span className="mx-1">· 共</span>
        {formatPoints(team.donePoints)} / {formatPoints(team.donePoints + team.notDonePoints)} SP
      </p>
      {team.assignees.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">此團隊沒有已估計的 Dev-Task。</p>
      ) : (
        <ul className="space-y-2.5">
          {team.assignees.map((assignee) => {
            const assigneeDone = filterTaskCounts(team.teamKey, assignee.assigneeAccountId, "done")
            const assigneeNotDone = filterTaskCounts(team.teamKey, assignee.assigneeAccountId, "notDone")
            return (
              <li
                key={assignee.assigneeAccountId ?? "unassigned"}
                className="border-t border-slate-200 pt-2.5 dark:border-slate-800"
              >
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {assignee.assigneeName}
                  <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                    完成度 {percent(assignee.completionPercent)}
                  </span>
                </p>
                <div className="mt-0.5 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                  <p>
                    已完成｜{" "}
                    <CountButton
                      count={assignee.doneTasks}
                      label="張"
                      title={`檢視 ${assignee.assigneeName} 已完成的 Dev-Task`}
                      onClick={() => onOpen({ title: `${assignee.assigneeName} 已完成`, tasks: assigneeDone })}
                    />
                    <span className="mx-1">·</span> SP {formatPoints(assignee.donePoints)}
                    {assignee.doneActualPoints > 0 && ` · Actual ${formatPoints(assignee.doneActualPoints)}`}
                  </p>
                  <p>
                    未完成｜{" "}
                    <CountButton
                      count={assignee.notDoneTasks}
                      label="張"
                      title={`檢視 ${assignee.assigneeName} 未完成的 Dev-Task`}
                      onClick={() => onOpen({ title: `${assignee.assigneeName} 未完成`, tasks: assigneeNotDone })}
                    />
                    <span className="mx-1">·</span> SP {formatPoints(assignee.notDonePoints)}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
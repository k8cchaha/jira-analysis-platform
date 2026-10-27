"use client"

import { useMemo } from "react"
import type { PlanningTask } from "@/lib/planning-subset"
import type { SprintProjectKey } from "@/lib/jira-jql"
import {
  computeAssignmentStatus,
  OTHER_TEAM,
  type TeamAssignment,
} from "@/lib/assignment-status"

/**
 * 每人可用的點數（Capacity），依專案而定：Saku＝20、Telasa＝40。
 * Pride 尚未指定容量，暫時以 20 佔位（待確認後調整）。
 */
const PER_PERSON_CAPACITY: Record<SprintProjectKey, number> = {
  SUN: 20, // 專案 = Saku
  TKK: 40, // 專案 = Telasa
  PRIDE: 20, // 專案 = Pride（未設定，暫佔位）
}

/** 點數顯示：四捨五入到小數第一位。 */
function formatPoints(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/** 分配比例（%）：分母不大於 0 時回 null（顯示「—」）。 */
function ratio(assigned: number, capacity: number): number | null {
  if (!(capacity > 0)) return null
  return Math.round((assigned / capacity) * 1000) / 10
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value}%`
}

/** 總分配比例的文字顏色：<50% 綠、50~70% 藍、70~90% 黃、90~110% 紅、>110% 紫；null 用中性。 */
function ratioColor(value: number | null): string {
  if (value === null) return "text-slate-600 dark:text-slate-300"
  if (value < 50) return "text-emerald-600 dark:text-emerald-400"
  if (value < 70) return "text-blue-600 dark:text-blue-400"
  if (value < 90) return "text-amber-600 dark:text-amber-400"
  if (value <= 110) return "text-red-600 dark:text-red-400"
  return "text-purple-600 dark:text-purple-400"
}

/**
 * 任務分派狀況：仿燃盡圖「成員開發狀況」的呈現——每個團隊一個卡片、一排兩個，
 * 團隊卡片內顯示 Team Capacity／已配點數／分配比例，並列出每位成員的 Capacity
 * （可用點數）／已分派點數／分配比例。
 *
 * 成員即為該 sprint 內有 assignee 的 Dev-Task 指派人（依 `teamOf` 分組歸隊，
 * 未對應團隊／未指派歸「其他」）；每人 Capacity 依專案而定（Saku＝20、Telasa＝40）。
 * 派點來源是已過濾的真實 Dev-Task，不重發 JQL。
 */
export function AssignmentStatus({
  project,
  tasks,
  teamOf,
  teamOrder,
}: {
  project: SprintProjectKey
  /** 已經過濾的 Dev-Task（與主表同源）。 */
  tasks: readonly PlanningTask[]
  /** accountId → 團隊 label 映射（由團隊選單載入；缺省者歸「其他」）。 */
  teamOf: Record<string, string>
  /** 團隊顯示順序（label，取自 DASHBOARD_TEAMS）。 */
  teamOrder: readonly string[]
}) {
  const perPersonCapacity = PER_PERSON_CAPACITY[project]
  const teams = useMemo(
    () =>
      computeAssignmentStatus({
        tasks,
        teamOf: (accountId) =>
          accountId === null ? undefined : teamOf[accountId],
        teamOrder,
        perPersonCapacity,
      }),
    [tasks, teamOf, teamOrder, perPersonCapacity]
  )

  // 其他：若沒有已排入的點數（無實質分配）就不顯示，避免空卡片。
  const visibleTeams = teams.filter(
    (team) => team.teamKey !== OTHER_TEAM.teamKey || team.assignedPoints > 0
  )

  if (visibleTeams.length === 0) {
    return (
      <div>
        <h3 className="mb-2 font-semibold text-slate-900 dark:text-white">任務分派狀況</h3>
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          此 Sprint 尚無可分派的成員（沒有已指派 Dev-Task）。
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900 dark:text-white">任務分派狀況</h3>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {visibleTeams.map((team) => (
          <TeamCard key={team.teamKey} team={team} />
        ))}
      </div>
    </div>
  )
}

function TeamCard({ team }: { team: TeamAssignment }) {
  const teamRatio = ratio(team.assignedPoints, team.capacity)
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{team.label}</h4>
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            title={`${team.label} 已排入點數`}
          >
            已排入 {formatPoints(team.assignedPoints)} / {formatPoints(team.capacity)}
          </span>
          <span
            className={`rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium ${ratioColor(teamRatio)} dark:bg-slate-800`}
            title={`${team.label} 總分派比例`}
          >
            總分派比例 {percent(teamRatio)}
          </span>
        </div>
      </header>
      {teamRatio !== null && (
        <div className="h-1 w-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full bg-blue-500 dark:bg-blue-400"
            style={{ width: `${Math.min(100, teamRatio)}%` }}
          />
        </div>
      )}
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{team.label} 任務分派狀況</caption>
        <thead>
          <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
            <th scope="col" className="py-2 pl-4 font-semibold">成員</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold" title="可用點數">可用點數</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">已分派點數</th>
            <th scope="col" className="py-2 pr-4 text-right font-semibold">分派比例</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {team.members.map((member) => {
            const memberRatio =
              member.capacity === null
                ? null
                : ratio(member.assignedPoints, member.capacity)
            return (
              <tr key={member.assigneeAccountId ?? "unassigned"} className="align-top">
                <th scope="row" className="py-2.5 pl-4 pr-2 font-medium text-slate-900 dark:text-white">
                  {member.name}
                </th>
                <td className="py-2.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                  {member.capacity === null ? "—" : formatPoints(member.capacity)}
                </td>
                <td className="py-2.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                  {formatPoints(member.assignedPoints)}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums font-semibold text-slate-700 dark:text-slate-200">
                  {percent(memberRatio)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
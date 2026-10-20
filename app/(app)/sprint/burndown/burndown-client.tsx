"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { computeBurndownSeries } from "@/lib/burndown-series"
import type { BurndownData } from "@/lib/jira-burndown"
import type { SprintRecord } from "@/lib/jira-sprint-data"
import type { SprintProjectKey } from "@/lib/jira-jql"
import { SprintSelector } from "@/app/(app)/sprint/burndown/sprint-selector"
import { BurndownChart } from "@/app/(app)/sprint/burndown/burndown-chart"
import { UnestimatedButton } from "@/app/(app)/sprint/burndown/unestimated-button"
import { DayTasksDialog } from "@/app/(app)/sprint/burndown/day-tasks-dialog"
import { TeamSelect } from "@/components/team-select"

/**
 * Burn Down 的站內檢視。持有團隊選擇 state，把 server 已撈回的 Dev-Task 資料
 * 依所選團隊成員在站內重算（不重發 JQL），並渲染 selector 行＋燃盡圖＋未估計按鈕。
 *
 * 專案／Sprint 切換以 `useTransition` 包住 `router.push`，等待期間以全頁遮罩
 * 擋住反覆操作（避免疊發大量撈資料請求）。
 */
export function BurndownClient({
  project,
  sprints,
  selectedSprintId,
  sprint,
  data,
  error,
  jiraBaseUrl,
}: {
  project: SprintProjectKey | null
  sprints: readonly SprintRecord[]
  selectedSprintId: number | null
  /** 已選取的 sprint；無專案或無已開始 sprint 時為 null。 */
  sprint: SprintRecord | null
  /** 撈取成功時的燃盡資料；`error` 有值時可為 undefined。 */
  data?: BurndownData
  /** 撈取失敗訊息；`data` 有值時為 undefined。 */
  error?: string
  jiraBaseUrl: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [groups, setGroups] = useState<string[]>([])
  const [memberIds, setMemberIds] = useState<ReadonlySet<string> | null>(null)
  const [showLine, setShowLine] = useState(true)
  const [showBar, setShowBar] = useState(true)
  const [clickedDay, setClickedDay] = useState<string | null>(null)

  function navigate(path: string) {
    startTransition(() => router.push(path))
  }

  function onGroupsChange(nextGroups: string[], accountIds: string[], ready: boolean) {
    setGroups(nextGroups)
    // 未選任何團隊、或所選團隊尚未完整載入時，維持顯示全體。
    setMemberIds(nextGroups.length > 0 && ready && accountIds.length > 0 ? new Set(accountIds) : null)
  }

  const filtered = useMemo(() => {
    if (!data || !sprint) return null
    return computeBurndownSeries({
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      today: data.today,
      tasks: data.tasks,
      unestimated: data.unestimated,
      accountIds: memberIds,
    })
  }, [sprint, data, memberIds])

  return (
    <div className="relative">
      <SprintSelector
        project={project}
        sprints={sprints}
        selectedSprintId={selectedSprintId}
        onNavigate={navigate}
        teamSlot={<TeamSelect groups={groups} onGroupsChange={onGroupsChange} />}
        trailing={
          filtered ? (
            <UnestimatedButton issues={filtered.unestimated} jiraBaseUrl={jiraBaseUrl} />
          ) : undefined
        }
      />

      <div className="mt-8">
        {!project ? (
          <EmptyState
            title="請先選擇專案"
            body="從上方選擇專案後，將顯示該專案的燃盡圖。"
            emoji="👋"
          />
        ) : !sprint ? (
          <EmptyState
            title={`${project} 暫無已開始的 Sprint`}
            body="此專案目前沒有已開始的 Sprint。"
            emoji="🏗️"
          />
        ) : filtered ? (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-slate-900 dark:text-white">{sprint.name}</h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {sprint.startDate} → {sprint.endDate}
                  </span>
                  <div role="group" aria-label="圖形顯示" className="flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-800 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={showLine}
                        onChange={(event) => setShowLine(event.target.checked)}
                        className="h-4 w-4 shrink-0 accent-blue-600"
                      />
                      剩餘點數
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-800 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={showBar}
                        onChange={(event) => setShowBar(event.target.checked)}
                        className="h-4 w-4 shrink-0 accent-blue-600"
                      />
                      已完成
                    </label>
                  </div>
                </div>
              </div>
              <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                {groups.length > 0 ? (
                  <>
                    <span className="font-semibold text-slate-900 dark:text-white">{memberIds?.size ?? "—"}</span>
                    <span className="mx-1">名成員任務，共</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{filtered.totalPoints}</span>
                    <span className="mx-1">Story Points（已估計 Dev-Task）</span>
                  </>
                ) : (
                  <>
                    總共
                    <span className="mx-1 font-semibold text-slate-900 dark:text-white">{filtered.totalPoints}</span>
                    Story Points（已估計 Dev-Task）
                  </>
                )}
              </p>
              {data?.empty ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  此 Sprint 尚未有對應的 Story / Task / Bug。
                </p>
              ) : (
                <>
                  <BurndownChart
                    days={filtered.days}
                    totalPoints={filtered.totalPoints}
                    showLine={showLine}
                    showBar={showBar}
                    onBarClick={setClickedDay}
                  />
                  {clickedDay !== null && (
                    <DayTasksDialog
                      date={clickedDay}
                      tasks={filtered.tasks}
                      jiraBaseUrl={jiraBaseUrl}
                      onClose={() => setClickedDay(null)}
                    />
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-rose-600 dark:text-rose-400">
              {error ?? "暫時無法取得燃盡圖資料，請稍後重試。"}
            </p>
          </div>
        )}
      </div>

      {/* 專案／Sprint 切換等待期的全頁遮罩，擋住反覆操作。 */}
      {isPending && (
        <div
          role="status"
          aria-label="正在更新燃盡圖"
          aria-live="polite"
          className="fixed inset-0 z-50 flex cursor-wait items-center justify-center bg-slate-950/40 backdrop-blur-[1px]"
          data-pending=""
        >
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <svg aria-hidden="true" className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
            更新中…
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState({
  title,
  body,
  emoji,
}: {
  title: string
  body: string
  emoji: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div aria-hidden="true" className="mb-3 text-4xl">{emoji}</div>
      <h2 className="font-semibold text-slate-900 dark:text-white">{title}</h2>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{body}</p>
    </div>
  )
}
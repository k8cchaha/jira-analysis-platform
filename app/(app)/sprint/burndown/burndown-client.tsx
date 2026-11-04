"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { computeBurndownSeries } from "@/lib/burndown-series"
import type { BurndownTask, BurndownUnestimated } from "@/lib/jira-burndown"
import type { SprintRecord } from "@/lib/jira-sprint-data"
import type { SprintProjectKey } from "@/lib/jira-jql"
import { DASHBOARD_TEAMS } from "@/lib/jira-dashboard-filter"
import { SprintSelector } from "@/app/(app)/sprint/burndown/sprint-selector"
import { BurndownChart } from "@/app/(app)/sprint/burndown/burndown-chart"
import { UnestimatedButton } from "@/app/(app)/sprint/burndown/unestimated-button"
import { DayTasksDialog } from "@/app/(app)/sprint/burndown/day-tasks-dialog"
import { DevelopmentStatus } from "@/app/(app)/sprint/burndown/development-status"
import { TeamSelect } from "@/components/team-select"

type StreamPhase =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "streaming" }
  | { status: "complete" }
  | { status: "error"; message: string }

/** 母票處於這些狀態時，其 Dev-Task 在勾選「受阻母票計為已完成」後視為 Done。 */
const BLOCKED_PARENT_STATUSES: ReadonlySet<string> = new Set([
  "Request Info",
  "Pending",
  "Reproduce",
])

interface BasePayload {
  today: string
  empty: boolean
  totalPoints: number
  tasks: BurndownTask[]
  unestimated: BurndownUnestimated[]
}

interface DayPayload {
  date: string
  keys: string[]
}

/**
 * Burn Down 的站內檢視。持有團隊選擇 state，並以 `EventSource` 訂閱
 * `/api/sprint/burndown/stream`，把 server 漸進送回的 Dev-Task 資料依所選
 * 團隊成員在站內重算（不重發 JQL）。
 *
 * 串流順序：`base`（畫出骨架：總點數、理想線）→ `day` × N（逐日把實際線/
 * 長條「長」上去）→ `done`。任一天收到 `error` ＝ 串流中止：已畫的部分保留，
 * 顯示錯誤 banner，不偽裝成功。
 */
export function BurndownClient({
  project,
  sprints,
  selectedSprintId,
  sprint,
  endpoint,
  jiraBaseUrl,
}: {
  project: SprintProjectKey | null
  sprints: readonly SprintRecord[]
  selectedSprintId: number | null
  /** 已選取的 sprint；無專案或無已開始 sprint 時為 null。 */
  sprint: SprintRecord | null
  /** SSE 端點（server 依 project＋sprint 產生的開流 URL）；無 sprint 時為 null。 */
  endpoint: string | null
  jiraBaseUrl: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [groups, setGroups] = useState<string[]>([])
  const [memberIds, setMemberIds] = useState<ReadonlySet<string> | null>(null)
  /** accountId → 團隊 label 映射（由團隊選單載入，供下方開發狀況分組）。 */
  const [teamOf, setTeamOf] = useState<Record<string, string>>({})
  const [showLine, setShowLine] = useState(true)
  const [showBar, setShowBar] = useState(true)
  /** 勾選「受阻母票計為已完成」：母票受阻的 Dev-Task 在圖表與開發狀況都視為完成。預設勾選。 */
  const [countParentBlocked, setCountParentBlocked] = useState(true)
  /** 被點擊的長條（一般日完成／開局前已完成／受阻母票）；null 表示未開啟彈窗。 */
  const [clickedDay, setClickedDay] = useState<{ date: string; beforeStart?: boolean; blocked?: boolean } | null>(null)

  // 串流資料（由 `base`／`day` 事件驅動）。
  const [phase, setPhase] = useState<StreamPhase>({ status: "idle" })
  const [today, setToday] = useState<string | null>(null)
  const [empty, setEmpty] = useState(false)
  const [tasks, setTasks] = useState<BurndownTask[]>([])
  const [unestimated, setUnestimated] = useState<BurndownUnestimated[]>([])
  /** 已接收的天數（供串流進度顯示）。 */
  const [daysReceived, setDaysReceived] = useState(0)
  /** 串流已逐日掃描到的最新日期（含空天）；收到第一個 day 前為 null。 */
  const [lastStreamedDate, setLastStreamedDate] = useState<string | null>(null)
  /** 手動「重新載入」用的 nonce，bump 會觸發 effect 重開串流。 */
  const [retryNonce, setRetryNonce] = useState(0)

  function navigate(path: string) {
    startTransition(() => router.push(path))
  }

  function onGroupsChange(nextGroups: string[], accountIds: string[], ready: boolean) {
    setGroups(nextGroups)
    // 未選任何團隊、或所選團隊尚未完整載入時，維持顯示全體。
    setMemberIds(nextGroups.length > 0 && ready && accountIds.length > 0 ? new Set(accountIds) : null)
  }

  // 開啟／重開串流。endpoint 改變（切 sprint／專案）或手動重試時關舊開新；
  // 每次開流帶 nonce，並停用 EventSource 自動重連（避免重送回 base 造成雙算天數）。
  useEffect(() => {
    if (!endpoint) {
      setPhase({ status: "idle" })
      setToday(null)
      setTasks([])
      setUnestimated([])
      setEmpty(false)
      setDaysReceived(0)
      setLastStreamedDate(null)
      return
    }
    let active = true
    setPhase({ status: "loading" })
    setToday(null)
    setTasks([])
    setUnestimated([])
    setEmpty(false)
    setDaysReceived(0)
    setLastStreamedDate(null)
    setClickedDay(null)

    const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}t=${Date.now()}`
    const es = new EventSource(url)
    // 停用自動重連：指令碼不再重開相同 URL；連線結束／失敗由下方處理。
    es.onerror = () => {
      es.close()
      // EventSource 在「server 正常 close（done 已送完）」與「真斷線」都會觸發
      // 原生 error。我們只關心還沒收到 done 的異常中斷；已 complete 就保留成功。
      if (active) {
        setPhase((prev) =>
          prev.status === "complete" ? prev : { status: "error", message: "連線已中斷，資料可能不完整，請重新整理頁面。" }
        )
      }
    }

    es.addEventListener("base", (event) => {
      if (!active) return
      try {
        const payload = JSON.parse((event as MessageEvent).data) as BasePayload
        setToday(payload.today)
        setEmpty(payload.empty)
        setTasks(payload.tasks)
        setUnestimated(payload.unestimated)
        setPhase({ status: "streaming" })
      } catch {
        setPhase({ status: "error", message: "串流資料無法辨識，請重新整理頁面。" })
      }
    })

    es.addEventListener("day", (event) => {
      if (!active) return
      try {
        const payload = JSON.parse((event as MessageEvent).data) as DayPayload
        const stamp = new Set(payload.keys)
        setTasks((prev) =>
          prev.length > 0 && stamp.size > 0
            ? prev.map((task) =>
                stamp.has(task.key) ? { ...task, doneDate: payload.date } : task
              )
            : prev
        )
        setLastStreamedDate(payload.date)
        setDaysReceived((count) => count + 1)
      } catch {
        setPhase({ status: "error", message: "串流資料無法辨識，請重新整理頁面。" })
      }
    })

    es.addEventListener("done", () => {
      if (active) setPhase({ status: "complete" })
    })

    // Server 明確送的 `event: error` frame（帶 JSON data）。未送 close 的連線中斷
    // 交給 `es.onerror` 處理；這裡只認有實際 data 的致命錯誤。
    es.addEventListener("error", (event) => {
      if (!active) return
      const raw = (event as MessageEvent).data
      if (typeof raw !== "string" || raw.trim() === "") return
      try {
        const payload = JSON.parse(raw) as { code: string; message: string }
        setPhase({ status: "error", message: payload.message ?? "串流發生錯誤。" })
      } catch {
        setPhase({ status: "error", message: "串流發生錯誤，請重新整理頁面。" })
      }
      es.close()
    })

    return () => {
      active = false
      es.close()
    }
  }, [endpoint, retryNonce])

  const filtered = useMemo(() => {
    if (!sprint || !today) return null
    return computeBurndownSeries({
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      today,
      throughDate: lastStreamedDate,
      tasks,
      unestimated,
      accountIds: memberIds,
      blockedParentStatuses: countParentBlocked ? BLOCKED_PARENT_STATUSES : null,
    })
  }, [sprint, today, lastStreamedDate, tasks, unestimated, memberIds, countParentBlocked])

  return (
    <div className="relative">
      <SprintSelector
        project={project}
        sprints={sprints}
        selectedSprintId={selectedSprintId}
        onNavigate={navigate}
        teamSlot={
      <TeamSelect
        groups={groups}
        onGroupsChange={onGroupsChange}
        onMembersReady={setTeamOf}
      />
    }
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
                <h2 className="font-semibold text-slate-900 dark:text-white">
                      {sprint.name}
                      <span className="font-normal text-slate-500 dark:text-slate-400">
                        {" "}（{sprint.startDate} → {sprint.endDate}）
                      </span>
                    </h2>
                <div className="flex items-center gap-3">
                  <div role="group" aria-label="圖形顯示" className="flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-800 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={showLine}
                        onChange={(event) => setShowLine(event.target.checked)}
                        className="h-4 w-4 shrink-0 accent-rose-600"
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
                    <label
                      className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-800 dark:text-slate-200"
                      title="母票處於受阻狀態（如 Request Info）時，其 Dev-Task 視為已完成來計算剩餘與完成度。"
                    >
                      <input
                        type="checkbox"
                        checked={countParentBlocked}
                        onChange={(event) => setCountParentBlocked(event.target.checked)}
                        className="h-4 w-4 shrink-0 appearance-none rounded-sm border border-yellow-600 bg-white checked:border-yellow-600 checked:bg-yellow-600 checked:bg-[url('data:image/svg+xml;utf8,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2016%2016%27%20fill=%27none%27%20stroke=%27%23ffffff%27%20stroke-width=%272.4%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27M3.5%208.5l3%203L12.5%205.5%27/%3E%3C/svg%3E')] checked:bg-[length:0.9rem_0.9rem] checked:bg-center checked:bg-no-repeat dark:bg-slate-900"
                      />
                      受阻母票計為已完成
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
              {empty ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  此 Sprint 尚未有對應的 Story / Task / Bug。
                </p>
              ) : (
                <>
                  <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Burn Down Chart</h3>
                  <BurndownChart
                    days={filtered.days}
                    totalPoints={filtered.totalPoints}
                    showLine={showLine}
                    showBar={showBar}
                    onBarClick={(date, beforeStart, blocked) => setClickedDay({ date, beforeStart, blocked })}
                  />
                  {phase.status === "streaming" && (
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      串流中… 已接收 {daysReceived} 天
                    </p>
                  )}
                  {phase.status === "error" && (
                    <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-rose-600 dark:text-rose-400">
                      <span>{phase.message}</span>
                      <button
                        type="button"
                        onClick={() => setRetryNonce((n) => n + 1)}
                        className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                      >
                        重新載入
                      </button>
                    </p>
                  )}
                  {clickedDay !== null && (
                    <DayTasksDialog
                      date={clickedDay.date}
                      beforeStart={clickedDay.beforeStart}
                      blocked={clickedDay.blocked}
                      blockedParentStatuses={countParentBlocked ? BLOCKED_PARENT_STATUSES : null}
                      tasks={filtered.tasks}
                      jiraBaseUrl={jiraBaseUrl}
                      onClose={() => setClickedDay(null)}
                    />
                  )}
                </>
              )}
            </div>

            <div className="mt-6">
              <DevelopmentStatus
                teamOf={teamOf}
                teamOrder={DASHBOARD_TEAMS.map((team) => team.label)}
                tasks={filtered.tasks}
                today={today}
                jiraBaseUrl={jiraBaseUrl}
                blockedParentStatuses={countParentBlocked ? BLOCKED_PARENT_STATUSES : null}
              />
            </div>
          </>
        ) : phase.status === "error" ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-rose-600 dark:text-rose-400">{phase.message}</p>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="mt-3 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              重新載入
            </button>
          </div>
        ) : (
          // 連線取得資料階段 = 與 Planning 的「更新中」相同的全頁遮罩。
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
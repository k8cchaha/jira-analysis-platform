"use client"

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { useTeamMembers } from "@/components/team-members-provider"
import { DASHBOARD_TEAMS, includedDashboardMembers } from "@/lib/jira-dashboard-filter"
import {
  computeMetricWorkloadHeatmap, workloadCellTasks, WORKLOAD_METRIC_LABELS,
  type WorkloadCompletedTask, type WorkloadMetric, type WorkloadCellSelection, type HeatmapUnestimated,
} from "@/lib/workload-heatmap"
import type { TeamMembersSnapshot } from "@/lib/team-members-store"
import type { WorkloadFilter } from "@/lib/workload-filter"
import { WorkloadHeatmapGrid } from "./workload-heatmap-grid"
import { WorkloadIssueDetails } from "./workload-issue-details"

type StreamPhase =
  | { status: "loading" }
  | { status: "streaming" }
  | { status: "complete" }
  | { status: "error"; message: string }

interface BasePayload {
  today: string
  empty: boolean
  days: string[]
  tasks: WorkloadCompletedTask[]
  unestimated: HeatmapUnestimated[]
  actualUnestimated: HeatmapUnestimated[]
}

/**
 * 工作量熱點圖的站內檢視。以 `EventSource` 訂閱
 * `/api/analytics/workload/heatmap/stream`，依上方已套用的團隊／成員條件
 * 顯示每週完成點數；列表內不另設團隊篩選。
 *
 * 串流順序：`base`（區間內完成 Dev-Task 的雙點數，完成日已解好）→ `done`。
 * 沒有逐日 frame：`resolved` 是欄位值而非事件，逐日查詢換不到額外資訊。
 * 收到 `error` ＝ 串流中止：已畫的部分保留，顯示錯誤 banner，不偽裝成功。
 */
export function WorkloadHeatmapClient({ filter, endpoint, jiraBaseUrl }: {
  filter: WorkloadFilter
  /** SSE 端點（server 產生）；未套用篩選條件時為 null。 */
  endpoint: string | null
  jiraBaseUrl: string | null
}) {
  /** 手動「重新載入」用的 nonce，bump 會以新的 key 重掛串流（等同重開）。 */
  const [retryNonce, setRetryNonce] = useState(0)
  const [metric, setMetric] = useState<WorkloadMetric>("points")
  const isStoryPoints = metric === "points"
  const activeClass = "font-semibold text-slate-900 dark:text-white"
  const inactiveClass = "text-slate-400 dark:text-slate-500"

  const { groupStates } = useTeamMembers()

  // 保留原團隊排序映射，直接使用共用名單，不依賴另一個選擇器的 callback。
  const teamOf = useMemo(() => {
    const byAccountId: Record<string, string> = {}
    for (const team of DASHBOARD_TEAMS) {
      const state = groupStates[team.group]
      if (state?.status !== "success") continue
      for (const member of state.members) byAccountId[member.accountId] = team.label
    }
    return byAccountId
  }, [groupStates])

  const metricSwitch = (
    <div className="inline-flex max-w-full flex-wrap select-none items-center gap-2 text-sm" role="group" aria-label="點數指標">
      <span className={isStoryPoints ? activeClass : inactiveClass}>Story Points</span>
      <button
        type="button"
        role="switch"
        aria-checked={!isStoryPoints}
        aria-label="使用 Actual Story Points"
        onClick={() => setMetric(isStoryPoints ? "actualPoints" : "points")}
        className="relative h-6 w-12 shrink-0 rounded-full bg-slate-300 transition-colors duration-200 hover:bg-slate-400 focus-visible:outline-2 focus-visible:outline-blue-600 dark:bg-slate-700 dark:hover:bg-slate-600"
      >
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${isStoryPoints ? "translate-x-0" : "translate-x-6"}`} />
      </button>
      <span className={isStoryPoints ? inactiveClass : activeClass}>Actual Story Points</span>
    </div>
  )

  return (
    <div className="mt-4">
      <section aria-label={`每週完成 ${WORKLOAD_METRIC_LABELS[metric]}`} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {!endpoint ? (
          <>
            <div className="mb-3 flex justify-end">{metricSwitch}</div>
            <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              請先在上方選擇團隊與分析區間，再按「查詢」。
            </p>
          </>
        ) : (
          // key 綁定端點與重試次數：套用新條件或按「重新載入」時整棵子樹重掛，
          // 串流狀態自然回到初始值，不必在 effect 內同步 setState 重設。
          <HeatmapStream
            key={`${endpoint}\u0000${retryNonce}`}
            endpoint={endpoint}
            filter={filter}
            metric={metric}
            metricSwitch={metricSwitch}
            jiraBaseUrl={jiraBaseUrl}
            teamOf={teamOf}
            groupStates={groupStates}
            onRetry={() => setRetryNonce((n) => n + 1)}
          />
        )}
      </section>
    </div>
  )
}
/**
 * 單一串流的內容：訂閱 `endpoint`，把 server 漸進送回的完成日併進 tasks，
 * 並依上方已套用的團隊／成員條件計算週合計。
 *
 * 由外層以 `key`（端點＋重試次數）重掛，因此這裡的 state 只需處理「這條連線」
 * 的生命週期，不必在 effect 內重設任何狀態。
 */
function HeatmapStream({
  endpoint,
  filter,
  metric,
  metricSwitch,
  jiraBaseUrl,
  teamOf,
  groupStates,
  onRetry,
}: {
  endpoint: string
  filter: WorkloadFilter
  metric: WorkloadMetric
  metricSwitch: ReactNode
  jiraBaseUrl: string | null
  teamOf: Record<string, string>
  groupStates: TeamMembersSnapshot
  onRetry: () => void
}) {
  const [phase, setPhase] = useState<StreamPhase>({ status: "loading" })
  const [days, setDays] = useState<string[]>([])
  const [tasks, setTasks] = useState<WorkloadCompletedTask[]>([])
  const [unestimated, setUnestimated] = useState<HeatmapUnestimated[]>([])
  const [actualUnestimated, setActualUnestimated] = useState<HeatmapUnestimated[]>([])
  const [empty, setEmpty] = useState(false)
  const [selection, setSelection] = useState<WorkloadCellSelection | null>(null)
  const detailsId = useId()
  const gridRef = useRef<HTMLDivElement>(null)

  // 訂閱一次串流；卸載或端點改變時關閉連線。停用 EventSource 自動重連
  // （避免重送回 base 造成雙算），錯誤一律自行處理。
  useEffect(() => {
    let active = true
    // 使用 RSC 產生的合法端點；API 已設 no-store，重試靠重掛開新連線，無需追加參數。
    const es = new EventSource(endpoint)
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
        setDays(payload.days)
        setTasks(payload.tasks)
        setUnestimated(payload.unestimated)
        setActualUnestimated(payload.actualUnestimated)
        setEmpty(payload.empty)
        setPhase({ status: "streaming" })
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
  }, [endpoint])

  // 成員列來源與頁面查詢同一套計算：`groups` + `exclusions` 經
  // `includedDashboardMembers` 得出，確保「列出的人」與「查詢的人」一致。
  const members = useMemo(() => {
    const ready = filter.groups.every((group) => groupStates[group]?.status === "success")
    if (!ready) return null
    const loaded: Record<string, { accountId: string; displayName: string }[]> = {}
    const nameOf = new Map<string, string>()
    for (const group of filter.groups) {
      const state = groupStates[group]
      if (state?.status !== "success" || !state.members) continue
      loaded[group] = state.members
      for (const user of state.members) nameOf.set(user.accountId, user.displayName)
    }
    try {
      return includedDashboardMembers(filter.groups, filter.exclusions, loaded).map((accountId) => ({
        accountId,
        displayName: nameOf.get(accountId) ?? accountId,
      }))
    } catch {
      return null
    }
  }, [filter.groups, groupStates, filter.exclusions])

  const heatmap = useMemo(() => {
    // 完整名單保留無活動成員；載入前僅由 server 已限縮範圍的任務反推成員。
    const rows = members ?? deriveMembers(tasks)
    return computeMetricWorkloadHeatmap({
      from: filter.from,
      to: filter.to,
      days,
      tasks,
      members: rows,
      teamOf: (accountId) => (accountId === null ? undefined : teamOf[accountId]),
      teamOrder: DASHBOARD_TEAMS.map((team) => team.label),
      unestimated,
      actualUnestimated,
      metric,
    })
  }, [members, tasks, days, unestimated, actualUnestimated, metric, teamOf, filter.from, filter.to])

  const selectedRow = selection ? heatmap.rows.find((row) => row.accountId === selection.accountId) : undefined
  const selectedWeek = selection ? heatmap.weeks.find((week) => week.start === selection.weekStart) : undefined
  const selectedPoints = selectedRow && selectedWeek
    ? selectedRow.cells[heatmap.weeks.indexOf(selectedWeek)] : null
  const validSelection = selection && selectedPoints !== null && selectedPoints !== undefined ? selection : null
  // 切換到空白格時丟棄選取，回切不恢復舊明細；只調整本元件 state，不重訂閱串流。
  if (selection && !validSelection) setSelection(null)
  const detailTasks = useMemo(() => validSelection && selectedWeek ? workloadCellTasks({
    tasks, metric, selection: validSelection, week: selectedWeek, days, from: filter.from, to: filter.to,
  }) : [], [tasks, metric, validSelection, selectedWeek, days, filter.from, filter.to])

  function toggleSelection(next: WorkloadCellSelection) {
    setSelection((current) =>
      current?.accountId === next.accountId && current.weekStart === next.weekStart ? null : next
    )
  }

  function closeDetails() {
    // Grid 隨 metric 重掛，從目前 DOM 找同一格，避免保存已卸載的按鈕 ref。
    const button = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-workload-week]") ?? [])
      .find((node) => node.dataset.workloadAccount === (selection?.accountId ?? "") && node.dataset.workloadWeek === selection?.weekStart)
    setSelection(null)
    button?.focus()
  }

  // 是否已收到 `base`（畫得出格子）。收到之後才失敗者保留已收到的格子，只補一行
  // banner；尚未收到 base 就失敗者沒有任何可畫的內容，直接顯示錯誤區塊。
  // 以「資料是否已抵達」判斷，而非 phase：phase 一旦轉為 error 就不再是 streaming。
  const hasBase = days.length > 0
  const streamError = phase.status === "error" && hasBase ? phase.message : null

  if (phase.status === "loading") {
    return (
      <>
        <div className="mb-3 flex justify-end">{metricSwitch}</div>
        <div
          role="status"
          aria-label={`正在載入每週完成 ${WORKLOAD_METRIC_LABELS[metric]}`}
          aria-live="polite"
          className="flex items-center justify-center gap-3 py-16 text-sm font-medium text-slate-600 dark:text-slate-400"
        >
          <svg aria-hidden="true" className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
          載入中…
        </div>
      </>
    )
  }

  if (phase.status === "error" && !hasBase) {
    return (
      <>
        <div className="mb-3 flex justify-end">{metricSwitch}</div>
        <div className="py-10 text-center">
          <p className="text-sm text-rose-600 dark:text-rose-400">{phase.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            重新載入
          </button>
        </div>
      </>
    )
  }

  if (empty) {
    return (
      <>
        <div className="mb-3 flex justify-end">{metricSwitch}</div>
        <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          此分析區間內，所選成員沒有已完成的 Dev-Task。
        </p>
      </>
    )
  }

  return (
    <>
      <div ref={gridRef}>
        <WorkloadHeatmapGrid key={metric} heatmap={heatmap} metric={metric} metricSwitch={metricSwitch} selection={validSelection} detailsId={detailsId} onSelect={toggleSelection} />
      </div>
      {validSelection && selectedRow && selectedWeek && selectedPoints !== null && selectedPoints !== undefined && (
        <WorkloadIssueDetails id={detailsId} memberName={selectedRow.displayName} week={selectedWeek} metric={metric}
          points={selectedPoints} tasks={detailTasks} jiraBaseUrl={jiraBaseUrl} onClose={closeDetails} />
      )}
      {/* 串流中途失敗：已收到的格子保留，另以 banner 說明並提供重試。 */}
      {streamError && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-rose-600 dark:text-rose-400">
          <span>{streamError}</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            重新載入
          </button>
        </p>
      )}
    </>
  )
}

/** 名單尚未載入完成時，由已查詢範圍的任務反推指派人，暫不保證完整列數。 */
function deriveMembers(
  tasks: readonly WorkloadCompletedTask[]
): { accountId: string; displayName: string }[] {
  const byId = new Map<string, string>()
  for (const task of tasks) {
    if (task.assigneeAccountId === null) continue
    byId.set(task.assigneeAccountId, task.assigneeDisplayName ?? task.assigneeAccountId)
  }
  return [...byId].map(([accountId, displayName]) => ({ accountId, displayName }))
}
"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { SprintProjectKey } from "@/lib/jira-jql"
import type { SprintRecord } from "@/lib/jira-sprint-data"
import type { PlanningTab } from "@/lib/burndown-params"
import type { PlanningTask, ReporterParent } from "@/lib/planning-subset"
import { parsePlanningSubsetResult } from "@/lib/planning-subset"
import { SprintSelector } from "@/app/(app)/sprint/burndown/sprint-selector"
import { CapacityPanel } from "@/app/(app)/sprint/planning/capacity-panel"
import { AssignmentStatus } from "@/app/(app)/sprint/planning/assignment-status"
import { PlanningOverview } from "@/app/(app)/sprint/planning/planning-overview"
import { TeamSelect } from "@/components/team-select"
import { DASHBOARD_TEAMS } from "@/lib/jira-dashboard-filter"
import { ParentIssueTypeIcon } from "@/app/(app)/dashboard/parent-issue-type-icon"
import { EditDialog } from "@/components/edit-dialog"
import { TicketLink } from "@/components/ticket-link"

/** 點數顯示：未估計（null）顯示「—」，否則四捨五入到小數第一位。 */
function formatPoints(value: number | null): string {
  return value === null ? "—" : String(Math.round(value * 10) / 10)
}

/**
 * Planning 的站內檢視。持有專案／Sprint／團隊選取 state；工作單（Dev-Task + QA-Task）明細由
 * server（RSC）撈好經 props 傳入，團隊過濾在此站內重算，不重發 JQL。
 * Sprint 下拉只提供「當前＋下一個」的 planning 對。
 */
export function PlanningClient({
  project,
  sprints,
  selectedSprintId,
  sprint,
  tasks,
  dataError,
  jiraBaseUrl,
  viewerAccountId,
  parents,
  pmFpmAccountIds,
  pmOpmAccountIds,
}: {
  project: SprintProjectKey | null
  sprints: readonly SprintRecord[]
  selectedSprintId: number | null
  sprint: SprintRecord | null
  tasks: readonly PlanningTask[]
  dataError: { code: string; message: string } | null
  jiraBaseUrl: string | null
  viewerAccountId: string
  /** 全部母票（Story/Task/Bug，含無子單者），供 Reporter View。 */
  parents: readonly ReporterParent[]
  /** group ent-fpm 成員 accountId；fpm 優先於 opm。 */
  pmFpmAccountIds: readonly string[]
  /** group ent-opm 成員 accountId。 */
  pmOpmAccountIds: readonly string[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [groups, setGroups] = useState<string[]>([])
  const [memberIds, setMemberIds] = useState<ReadonlySet<string> | null>(null)
  /** accountId → 團隊 label 映射（由團隊選單載入，供「任務分派狀況」分組）。 */
  const [teamOf, setTeamOf] = useState<Record<string, string>>({})
  /** 內容區目前分頁（任務分派狀況／任務規劃總覽）。純 client 端 state，不改 URL。 */
  const [tab, setTab] = useState<PlanningTab>("assignment")

  // 切到「任務規劃總覽」時，直接以既有 `filtered`（工作單 Dev+QA）饋給總覽；
  // 不另發 API（總覽與分派狀況共用同一個工作單資料源，點數口徑一致）。

  function navigate(path: string) {
    startTransition(() => router.push(path))
  }

  /** 切換內容區分頁：純 client 端切換顯示的資料，不更新 URL。 */
  function switchTab(nextTab: PlanningTab) {
    setTab(nextTab)
  }

  function onGroupsChange(nextGroups: string[], accountIds: string[], ready: boolean) {
    setGroups(nextGroups)
    // 未選任何團隊、或所選團隊尚未完整載入時，維持顯示全體。
    setMemberIds(
      nextGroups.length > 0 && ready && accountIds.length > 0
        ? new Set(accountIds)
        : null
    )
  }

  // 團隊過濾：無選取（或未載入完成）→ 全列；否則只留「指派人在所選團隊內」
  // 且有指派人（未指派隱藏，與燃盡圖一致）。
  const filtered = useMemo(
    () =>
      memberIds === null
        ? tasks
        : tasks.filter(
            (task) =>
              task.assigneeAccountId !== null && memberIds.has(task.assigneeAccountId)
          ),
    [tasks, memberIds]
  )

  const totalPoints = useMemo(
    () => filtered.reduce((sum, task) => sum + (task.points ?? 0), 0),
    [filtered]
  )

  return (
    <div className="relative">
      <SprintSelector
        project={project}
        sprints={sprints}
        selectedSprintId={selectedSprintId}
        basePath="/sprint/planning"
        onNavigate={navigate}
        teamSlotClassName="w-full min-w-0 lg:w-40 lg:shrink-0"
        teamSlot={
          <TeamSelect groups={groups} onMembersReady={setTeamOf} onGroupsChange={onGroupsChange} perMember={false} />
        }
        trailing={
          <div className="flex items-center gap-2">
            <JqlButton
              label="未估時"
              kind="unestimated"
              project={project}
              sprintId={selectedSprintId}
              jiraBaseUrl={jiraBaseUrl}
              memberIds={memberIds}
            />
            <JqlButton
              label="未開子單"
              kind="no-subtasks"
              project={project}
              sprintId={selectedSprintId}
              jiraBaseUrl={jiraBaseUrl}
              memberIds={memberIds}
            />
            <JqlButton
              label="未分派"
              kind="unassigned"
              project={project}
              sprintId={selectedSprintId}
              jiraBaseUrl={jiraBaseUrl}
              memberIds={memberIds}
            />
          </div>
        }
      />

      {project && sprint && <CapacityPanel project={project} viewerAccountId={viewerAccountId} />}

      <div className="mt-8">
        {!project ? (
          <EmptyState
            title="請先選擇專案"
            body="從上方選擇專案後，將顯示該專案 Sprint 的 Capacity 與分派計畫。"
            emoji="👋"
          />
        ) : !sprint ? (
          <EmptyState
            title={`${project} 暫無進行中或未來的 Sprint`}
            body="此專案目前沒有可供規劃的 Sprint。"
            emoji="🏗️"
          />
        ) : dataError ? (
          <EmptyState
            title="無法載入資料"
            body={dataError.message}
            emoji="⚠️"
          />
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-slate-900 dark:text-white">
                {sprint.name}
                <span className="font-normal text-slate-500 dark:text-slate-400">
                  {" "}（{sprint.startDate} → {sprint.endDate}）
                </span>
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                共{" "}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {filtered.length}
                </span>{" "}
                個工作單 ·{" "}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {formatPoints(totalPoints)}
                </span>{" "}
                SP
              </p>
            </div>

            <PlanningTabs tab={tab} onSwitch={switchTab} />

            {tab === "overview" ? (
              <PlanningOverview
                teamOf={teamOf}
                teamOrder={DASHBOARD_TEAMS.map((team) => team.label)}
                jiraBaseUrl={jiraBaseUrl}
                sprintId={sprint?.id ?? null}
                tasks={filtered}
                parents={parents}
                pmFpmAccountIds={pmFpmAccountIds}
                pmOpmAccountIds={pmOpmAccountIds}
              />
            ) : (
              <>
                {tasks.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    此 Sprint 尚未有對應的工作單。
                  </p>
                ) : (
                  <>
                    {filtered.length === 0 && (
                      <p className="mb-4 text-center text-sm text-slate-500 dark:text-slate-400">
                        沒有符合所選團隊的工作單。
                      </p>
                    )}
                    <AssignmentStatus
                      project={project}
                      tasks={filtered}
                      teamOf={teamOf}
                      teamOrder={DASHBOARD_TEAMS.map((team) => team.label)}
                      jiraBaseUrl={jiraBaseUrl}
                    />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {isPending && (
        <div
          role="status"
          aria-label="正在更新 Planning"
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

/**
 * 內容區分頁切換：任務分派狀況／任務規劃總覽。純 client 端切換顯示的資料，
 * 不更新 URL，也不觸發 server 端重新撈取。
 */
function PlanningTabs({
  tab,
  onSwitch,
}: {
  tab: PlanningTab
  onSwitch: (next: PlanningTab) => void
}) {
  const tabs: { key: PlanningTab; label: string }[] = [
    { key: "assignment", label: "任務分派狀況" },
    { key: "overview", label: "任務規劃總覽" },
  ]
  return (
    <div
      role="tablist"
      aria-label="Planning 內容分頁"
      className="mb-6 flex w-full flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
    >
      {tabs.map((item) => {
        const active = item.key === tab
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSwitch(item.key)}
            className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              active
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
                : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
            }`}
          >
            {item.label}
          </button>
        )
      })}
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

/**
 * Filter 列右側的按鈕：點開彈出「JQL 撈出來的單」清單。為避免等全部資料才解除
 * 遮罩，這裡**自行**向 `/api/sprint/planning/subset` 撈各自子集合：載入中先顯示
 * 骨架，資料回來後顯示按鈕＋計數（計數 0 時停用、不可點）。`project`／`sprintId`
 * 為 null（無專案／無 sprint）時停用、不 fetch。
 *
 * 團隊過濾：**未估時**套用與主表相同的站內過濾（只列所選團隊成員的任務），
 * 不重發 JQL；**未分派**不受團隊過濾影響（其任務沒有指派人，無從以團隊判定）；
 * **未開子單**也不套團隊過濾（母票常為未指派狀態，套了可能整批消失）。
 */
function JqlButton({
  label,
  kind,
  project,
  sprintId,
  jiraBaseUrl,
  memberIds,
}: {
  label: string
  kind: "unestimated" | "unassigned" | "no-subtasks"
  project: SprintProjectKey | null
  sprintId: number | null
  jiraBaseUrl: string | null
  memberIds: ReadonlySet<string> | null
}) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ status: "loading" } | { status: "loaded"; tasks: PlanningTask[] } | { status: "error" }>({ status: "loading" })

  useEffect(() => {
    if (project === null || sprintId === null) {
      setState({ status: "loaded", tasks: [] })
      return
    }
    const controller = new AbortController()
    let active = true
    setState({ status: "loading" })
    queueMicrotask(async () => {
      if (!active) return
      try {
        const params = new URLSearchParams({ project, sprint: String(sprintId), kind })
        const response = await fetch(`/api/sprint/planning/subset?${params}`, { cache: "no-store", signal: controller.signal })
        const result = parsePlanningSubsetResult(await response.json())
        if (!response.ok && result.status === "success") throw new Error("Invalid response")
        if (active) setState(result.status === "success" ? { status: "loaded", tasks: result.data.tasks } : { status: "error" })
      } catch {
        if (active) setState({ status: "error" })
      }
    })
    return () => { active = false; controller.abort() }
  }, [project, sprintId, kind])

  const loading = state.status === "loading"
  const tasks = state.status === "loaded" ? state.tasks : null
  // 團隊過濾（站內重算，不重發 JQL）：未估時只列所選團隊成員的任務；未分派不受
  // 團隊影響。與主表同規則：無選取（memberIds === null）→ 全列。
  const visibleTasks = useMemo(() => {
    if (kind !== "unestimated" || memberIds === null || tasks === null) return tasks
    return tasks.filter(
      (task) =>
        task.assigneeAccountId !== null && memberIds.has(task.assigneeAccountId)
    )
  }, [tasks, kind, memberIds])
  const count = visibleTasks === null ? null : visibleTasks.length

  // 資料尚在載入時，先渲染與按鈕同尺寸的骨架，回來再換成真按鈕。
  if (loading) {
    return <JqlButtonSkeleton />
  }

  const disabled = count === null || count === 0
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex h-10 min-w-28 items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m16 16 5 5" />
        </svg>
        {label}
        {count !== null && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {count}
          </span>
        )}
      </button>
      {open && visibleTasks !== null && (
        <JqlDialog
          label={label}
          variant={kind === "no-subtasks" ? "parent" : "devtask"}
          tasks={visibleTasks}
          jiraBaseUrl={jiraBaseUrl}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** 載入中的骨架：與真按鈕接近的寬高動畫佔位，避免版面跳動。 */
function JqlButtonSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-10 w-28 animate-pulse items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-100 motion-reduce:animate-none dark:border-slate-800 dark:bg-slate-800"
    >
      <div className="h-3 w-12 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="h-4 w-5 rounded-full bg-slate-200 dark:bg-slate-700" />
    </div>
  )
}

/**
 * 顯示「JQL 撈出來的單」的唯讀彈窗：仿其他彈窗的 Table＋Mobile 卡片格式。
 *
 * `variant`：
 * - `devtask`＝未估時／未分派（工作單清單）：有母票 type icon，無 Reporter/Component；
 * - `parent`＝未開子單（母票清單）：不需要母票 type icon，多列 Reporter／Component。
 */
function JqlDialog({
  label,
  variant,
  tasks,
  jiraBaseUrl,
  onClose,
}: {
  label: string
  variant: "devtask" | "parent"
  tasks: readonly PlanningTask[]
  jiraBaseUrl: string | null
  onClose: () => void
}) {
  const isParent = variant === "parent"
  const captionText = isParent ? "母票" : "工作單"
  return (
    <EditDialog
      title={label}
      description=""
      count={tasks.length}
      iconClose
      onClose={onClose}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tasks.length === 0 ? (
          <p role="status" className="p-8 text-center text-sm text-slate-600 dark:text-slate-400">此 Sprint 沒有符合條件的{captionText}。</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto px-4 sm:px-6 md:block">
              <table className={`w-full table-fixed text-left text-sm ${isParent ? "min-w-[820px]" : "min-w-[640px]"}`}>
                <caption className="sr-only">{label} 的 {captionText}</caption>
                <thead className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <tr>
                    {!isParent && <th scope="col" className="w-10 py-3"><span className="sr-only">Parent Issue type</span></th>}
                    <th scope="col" className="w-32 px-3 py-3 font-medium">Ticket</th>
                    <th scope="col" className="w-24 px-3 py-3 font-medium">Status</th>
                    {isParent && <th scope="col" className="w-32 px-3 py-3 font-medium">Component</th>}
                    <th scope="col" className="px-3 py-3 font-medium">Summary</th>
                    {isParent && <th scope="col" className="w-28 px-3 py-3 font-medium">Reporter</th>}
                    <th scope="col" className="w-36 px-3 py-3 font-medium">Assignee</th>
                    <th scope="col" className="w-20 px-3 py-3 text-right font-medium" title="Story Points">SP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {tasks.map((task) => (
                    <tr key={task.key} className="align-top">
                      {!isParent && <td className="py-3 pl-4"><ParentIssueTypeIcon parent={task.parentIssueType} /></td>}
                      <td className="px-3 py-3"><TicketLink task={task} jiraBaseUrl={jiraBaseUrl} /></td>
                      <td className="break-words px-3 py-3 text-slate-600 dark:text-slate-300">{task.status ?? "—"}</td>
                      {isParent && <td className="break-words px-3 py-3 text-slate-600 dark:text-slate-300">{task.components.length ? task.components.join(", ") : "—"}</td>}
                      <td className="break-words px-3 py-3">{task.summary || "—"}</td>
                      {isParent && <td className="break-words px-3 py-3 text-slate-600 dark:text-slate-300">{task.reporter || "—"}</td>}
                      <td className="break-words px-3 py-3 text-slate-600 dark:text-slate-300">{task.assigneeDisplayName || "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatPoints(task.points)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-200 px-4 md:hidden dark:divide-slate-800">
              {tasks.map((task) => (
                <article key={task.key} className="py-4">
                  <div className="flex items-center gap-2">
                    {!isParent && <ParentIssueTypeIcon parent={task.parentIssueType} />}
                    <TicketLink task={task} jiraBaseUrl={jiraBaseUrl} />
                    <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400" title="Story Points">
                      SP {formatPoints(task.points)}
                    </span>
                  </div>
                  {isParent && (
                    <p className="mt-2 break-words text-xs text-slate-500 dark:text-slate-400">
                      Reporter：{task.reporter || "—"}
                      <span className="mx-1">·</span>
                      Assignee：{task.assigneeDisplayName || "—"}
                    </p>
                  )}
                  {isParent && (
                    <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                      Component：{task.components.length ? task.components.join(", ") : "—"}
                    </p>
                  )}
                  {!isParent && (
                    <p className="mt-2 break-words text-xs text-slate-500 dark:text-slate-400">
                      Assignee：{task.assigneeDisplayName || "—"}
                      <span className="mx-1">·</span>
                      Status：{task.status ?? "—"}
                    </p>
                  )}
                  {isParent && (
                    <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                      Status：{task.status ?? "—"}
                    </p>
                  )}
                  <p className="mt-1 break-words text-sm text-slate-800 dark:text-slate-200">{task.summary || "—"}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </EditDialog>
  )
}
"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { SprintProjectKey } from "@/lib/jira-jql"
import type { SprintRecord } from "@/lib/jira-sprint-data"
import type { PlanningTask } from "@/lib/planning-data"
import { SprintSelector } from "@/app/(app)/sprint/burndown/sprint-selector"
import { TeamSelect } from "@/components/team-select"
import { ParentIssueTypeIcon } from "@/app/(app)/dashboard/parent-issue-type-icon"
import { EditDialog } from "@/components/edit-dialog"

/** 點數顯示：未估計（null）顯示「—」，否則四捨五入到小數第一位。 */
function formatPoints(value: number | null): string {
  return value === null ? "—" : String(Math.round(value * 10) / 10)
}

/**
 * Planning 的站內檢視。持有專案／Sprint／團隊選取 state；Dev-Task 明細由
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
  unestimated,
  unassigned,
  jiraBaseUrl,
}: {
  project: SprintProjectKey | null
  sprints: readonly SprintRecord[]
  selectedSprintId: number | null
  sprint: SprintRecord | null
  tasks: readonly PlanningTask[]
  dataError: { code: string; message: string } | null
  /** 未估時的 Dev-Task（server 撈好；無 sprint/資料時為 null）。 */
  unestimated: readonly PlanningTask[] | null
  /** 未分派的 Dev-Task（同上）。 */
  unassigned: readonly PlanningTask[] | null
  jiraBaseUrl: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [groups, setGroups] = useState<string[]>([])
  const [memberIds, setMemberIds] = useState<ReadonlySet<string> | null>(null)

  function navigate(path: string) {
    startTransition(() => router.push(path))
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
        teamSlot={
          <TeamSelect groups={groups} onGroupsChange={onGroupsChange} perMember={false} />
        }
        trailing={
          <div className="flex items-center gap-2">
            <JqlButton
              label="未估時"
              tasks={unestimated}
              sprintName={sprint?.name ?? null}
              jiraBaseUrl={jiraBaseUrl}
            />
            <JqlButton
              label="未分派"
              tasks={unassigned}
              sprintName={sprint?.name ?? null}
              jiraBaseUrl={jiraBaseUrl}
            />
          </div>
        }
      />

      <div className="mt-8">
        {!project ? (
          <EmptyState
            title="請先選擇專案"
            body="從上方選擇專案後，將顯示該專案的 Dev-Task 明細。"
            emoji="👋"
          />
        ) : !sprint ? (
          <EmptyState
            title={`${project} 暫無進行中或下一個 Sprint`}
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
              <h2 className="font-semibold text-slate-900 dark:text-white">{sprint.name}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {sprint.startDate} → {sprint.endDate} · 共{" "}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {filtered.length}
                </span>{" "}
                個 Dev-Task ·{" "}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {formatPoints(totalPoints)}
                </span>{" "}
                SP
              </p>
            </div>

            {tasks.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                此 Sprint 尚未有對應的 Dev-Task。
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                沒有符合所選團隊的 Dev-Task。
              </p>
            ) : (
              <>
                {/* Desktop 表格 */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full table-fixed text-left text-sm">
                    <caption className="sr-only">{sprint.name} 的 Dev-Task 明細</caption>
                    <thead className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <tr>
                        <th scope="col" className="w-10 py-3"><span className="sr-only">Parent Issue type</span></th>
                        <th scope="col" className="w-28 px-3 py-3 font-medium">Ticket</th>
                        <th scope="col" className="px-3 py-3 font-medium">Summary</th>
                        <th scope="col" className="w-24 px-3 py-3 font-medium">Status</th>
                        <th scope="col" className="w-20 px-3 py-3 text-right font-medium" title="Story Points">SP</th>
                        <th scope="col" className="w-36 px-3 py-3 font-medium">Assignee</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {filtered.map((task) => (
                        <tr key={task.key} className="align-top">
                          <td className="py-3 pl-4"><ParentIssueTypeIcon parent={task.parentIssueType} /></td>
                          <td className="px-3 py-3">
                            <TicketLink task={task} jiraBaseUrl={jiraBaseUrl} />
                          </td>
                          <td className="break-words px-3 py-3 text-slate-800 dark:text-slate-200">
                            {task.summary || "—"}
                          </td>
                          <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                            {task.status ?? "—"}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {formatPoints(task.points)}
                          </td>
                          <td className="break-words px-3 py-3 text-slate-600 dark:text-slate-300">
                            {task.assigneeDisplayName || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile 卡片 */}
                <div className="divide-y divide-slate-200 md:hidden dark:divide-slate-800">
                  {filtered.map((task) => (
                    <article key={task.key} className="py-4">
                      <div className="flex items-center gap-2">
                        <ParentIssueTypeIcon parent={task.parentIssueType} />
                        <TicketLink task={task} jiraBaseUrl={jiraBaseUrl} />
                        <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400" title="Story Points">
                          SP {formatPoints(task.points)}
                        </span>
                      </div>
                      <p className="mt-2 break-words text-xs text-slate-500 dark:text-slate-400">
                        Assignee：{task.assigneeDisplayName || "—"}
                        <span className="mx-1">·</span>
                        Status：{task.status ?? "—"}
                      </p>
                      <p className="mt-1 break-words text-sm text-slate-800 dark:text-slate-200">
                        {task.summary || "—"}
                      </p>
                    </article>
                  ))}
                </div>
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

function TicketLink({
  task,
  jiraBaseUrl,
}: {
  task: PlanningTask
  jiraBaseUrl: string | null
}) {
  if (jiraBaseUrl) {
    return (
      <a
        href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(task.key)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`在 Jira 開啟 ${task.key}（另開分頁）`}
        className="break-words font-medium text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300"
      >
        {task.key}
      </a>
    )
  }
  return <span className="break-words font-medium">{task.key}</span>
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

/** Filter 列右側的按鈕：點開彈出「JQL 撈出來的單」清單；`tasks` 為 null（無 sprint/資料）時停用。 */
function JqlButton({
  label,
  tasks,
  sprintName,
  jiraBaseUrl,
}: {
  label: string
  tasks: readonly PlanningTask[] | null
  sprintName: string | null
  jiraBaseUrl: string | null
}) {
  const [open, setOpen] = useState(false)
  const disabled = tasks === null
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m16 16 5 5" />
        </svg>
        {label}
        {tasks !== null && tasks.length > 0 && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {tasks.length}
          </span>
        )}
      </button>
      {open && tasks !== null && (
        <JqlDialog
          label={label}
          tasks={tasks}
          sprintName={sprintName}
          jiraBaseUrl={jiraBaseUrl}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** 顯示「JQL 撈出來的單」的唯讀彈窗：清單 + 每張票可另開 Jira。 */
function JqlDialog({
  label,
  tasks,
  sprintName,
  jiraBaseUrl,
  onClose,
}: {
  label: string
  tasks: readonly PlanningTask[]
  sprintName: string | null
  jiraBaseUrl: string | null
  onClose: () => void
}) {
  return (
    <EditDialog title={label} description="" compact iconClose onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
        <p className="mb-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
          {sprintName ? `以下為「${label}」的 Dev-Task（${sprintName}）。` : `以下為「${label}」的 Dev-Task。`}
        </p>

        {tasks.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            此 Sprint 沒有符合條件的 Dev-Task。
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {tasks.map((task) => (
              <li key={task.key} className="flex items-center gap-3 py-2.5">
                <ParentIssueTypeIcon parent={task.parentIssueType} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <TicketLink task={task} jiraBaseUrl={jiraBaseUrl} />
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400" title="Story Points">
                      SP {formatPoints(task.points)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate break-words text-xs text-slate-500 dark:text-slate-400">
                    {task.summary || "—"}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs leading-5 text-slate-500 dark:text-slate-400">
                  <div>{task.status ?? "—"}</div>
                  <div className="max-w-32 truncate">{task.assigneeDisplayName || "—"}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </EditDialog>
  )
}
"use client"

import { Fragment, useMemo, useRef, useState, type ReactNode } from "react"
import type { PlanningTask, ReporterParent } from "@/lib/planning-subset"
import { projectReporterParents } from "@/lib/planning-subset"
import {
  buildPlanningDevTypeGroups,
  buildReporterHierarchy,
  buildDevTaskTypeTeamBreakdown,
  buildDevTypeLabelTeamBreakdown,
  countDevTaskTypes,
  countDevTypeLabels,
  sumDevTaskTypePoints,
  sumDevTypeLabelPoints,
  devTypeFamilyOf,
  DEV_TYPE_GROUP_LABELS,
  UNCLASSIFIED_DEV_TYPE_LABEL,
  type OverviewGroupMode,
  type OverviewMetric,
  type ReporterGroup,
  type TypeTeamBreakdown,
} from "@/lib/planning-overview"
import { ParentIssueTypeIcon } from "@/app/(app)/dashboard/parent-issue-type-icon"
import { TicketLink } from "@/components/ticket-link"
import { statusColorClass } from "@/lib/status-color"
import { sprintChildTasksOfParentTypeJql, sprintChildTasksOfDevTypeJql, sprintChildTasksUnclassifiedDevTypeJql } from "@/lib/jira-jql"

/** 點數顯示：未估計（null）顯示「—」。 */
function formatPoints(value: number | null): string {
  return value === null ? "—" : String(Math.round(value * 10) / 10)
}

/** 把數字無條件減去小數尾數，避免浮點殘留（如 3.3000000000000003）。 */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * 任務規劃總覽：左 2/3 任務清單、右 1/3 票種比例圓餅圖。
 *
 * - 左側任務清單：**Team 模式**吃 `PlanningClient` 已依團隊過濾好的工作單
 *   （Dev-Task + QA-Task，`filtered`，與「任務分派狀況」同源）；**Reporter 模式**
 *   吃 server 端 RSC 傳入的全量母票（`parents`，含無子單者，不受 Team 過濾影響）。
 * - **Team 模式**（預設）：顯示 **Team → Dev Type** 兩層，一列一張工作單；點數顯示在
 *   子票（Dev 與 QA 都有），子票附 Assignee 欄（放在 SP 左方）。
 * - **Reporter 模式**（以開單人為出發點、主要給 PM）：顯示 **Reporter → Epic → 母票**
 *   階層；Reporter 依 PM 群（`ent-fpm` → `ent-opm`）→ 其他（依顯示名）→ 未指定排序；
 *   母票列為 Issue type Icon | Ticket | Summary | Component | SP。
 */
export function PlanningOverview({
  teamOf,
  teamOrder,
  jiraBaseUrl,
  sprintId,
  tasks,
  parents,
  pmFpmAccountIds = [],
  pmOpmAccountIds = [],
}: {
  /** accountId → 團隊 label（由團隊選單載入；供 Team 分群）。 */
  teamOf: Record<string, string>
  /** 團隊顯示順序（label）。 */
  teamOrder: readonly string[]
  jiraBaseUrl: string | null
  /** 目前 sprint 的 id（圓餅圖 arc 的 Jira 深連結用來組 `sprint = X`）。 */
  sprintId: number | null
  /** 此 sprint 的工作單（已由 `PlanningClient` 依所選團隊過濾）。 */
  tasks: readonly PlanningTask[] | null
  /** 全部母票（Story/Task/Bug，含無子單者），供 Reporter View 依開單人（PM）分群。 */
  parents: readonly ReporterParent[] | null
  /** group ent-fpm 成員 accountId；供 Reporter View 判定 PM（fpm 優先）。 */
  pmFpmAccountIds?: readonly string[]
  /** group ent-opm 成員 accountId。 */
  pmOpmAccountIds?: readonly string[]
}) {
  const [mode, setMode] = useState<OverviewGroupMode>("team")

  // 資料已由 `PlanningClient` 依團隊過濾好；此處只防 null（仍以 useMemo 穩定參考）。
  const filtered = useMemo(() => tasks ?? [], [tasks])

  // Reporter View 的母票：由 server 端 RSC 傳入（全量、含無子單母票），不受 Team 過濾影響。
  // `parents` 是 server-trusted 的 typed 資料，此處只做寬鬆投影（壞值收斂成 null／[]），
  // 不跑嚴格解碼器——避免單一母票的邊界值讓整頁崩潰。
  const reporterParents = useMemo(() => projectReporterParents(parents ?? []), [parents])

  // Reporter 的 PM 位階：依母票的 Reporter accountId 判定是否為 fpm／opm。
  const pmRank = useMemo(() => {
    const fpm = new Set(pmFpmAccountIds)
    const opm = new Set(pmOpmAccountIds)
    return (accountId: string | null): "fpm" | "opm" | null => {
      if (accountId === null) return null
      if (fpm.has(accountId)) return "fpm"
      if (opm.has(accountId)) return "opm"
      return null
    }
  }, [pmFpmAccountIds, pmOpmAccountIds])

  const teamOfFn = useMemo(
    () => (accountId: string | null) => (accountId === null ? undefined : teamOf[accountId]),
    [teamOf]
  )

  // Reporter View 的階層（fpm→opm→其他→未指定；每群內 Epic→無 Epic）。
  const reporterGroups = useMemo(
    () => buildReporterHierarchy({ parents: reporterParents, pmRank }),
    [reporterParents, pmRank]
  )

  // Team 模式的「Team → Dev Type」兩層（Reporter 模式不走）。
  const devTypeGroups = useMemo(
    () => (mode === "team" ? buildPlanningDevTypeGroups({ tasks: filtered, teamOf: teamOfFn, teamOrder }) : []),
    [filtered, mode, teamOfFn, teamOrder]
  )

  // Reporter 模式吃「所有母票」（含無子單者），不受 Team 過濾影響；空狀態依各模式判斷。
  const isEmpty = mode === "reporter" ? reporterParents.length === 0 : filtered.length === 0

  // 每張卡各自的展開狀態：`openGroups[key]` 缺省視為展開；「收合」把所有卡設為收起，
  // 「展開」全設回展開。個別卡點開只影響那一張（修復「點一張全開」的 bug）。
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  const groupKeys = useMemo(
    () =>
      mode === "team"
        ? devTypeGroups.map((g) => g.label)
        : reporterGroups.map((g) => g.reporterAccountId ?? g.label),
    [mode, devTypeGroups, reporterGroups]
  )
  const isCardOpen = (key: string) => openGroups[key] !== false

  // 只有「目前全部卡片都收起」時顯示「展開」；任一卡片展開（含個別點開）就顯示「收合」。
  const allCollapsed = groupKeys.length > 0 && groupKeys.every((key) => openGroups[key] === false)

  const collapseAll = () => {
    setOpenGroups((prev) => {
      const next = { ...prev }
      for (const key of groupKeys) next[key] = false
      return next
    })
  }
  const expandAll = () => {
    setOpenGroups((prev) => {
      const next = { ...prev }
      for (const key of groupKeys) next[key] = true
      return next
    })
  }
  const toggleCard = (key: string) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !(prev[key] !== false) }))
  }

  const toolbar = (
    <div className="flex items-center justify-between gap-2">
      <RadioGroup mode={mode} onModeChange={setMode} />
      <button
        type="button"
        onClick={allCollapsed ? expandAll : collapseAll}
        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
      >
        {allCollapsed ? "展開" : "收合"}
      </button>
    </div>
  )

  return (
    <div>
      <div className="mb-4">{toolbar}</div>

      {isEmpty ? (
        <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {mode === "reporter" ? "此 Sprint 尚未有母票可供顯示。" : "此 Sprint 尚未有對應的工作單。"}
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {/* Team 模式＝Team→Dev Type 兩層；Reporter 模式＝依開單人(PM)分群的 Epic→母票階層。 */}
            {mode === "team"
              ? devTypeGroups.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    沒有符合所選團隊的工作單。
                  </p>
                ) : (
                  devTypeGroups.map((group) => (
                    <DevTypeGroupSection
                      key={group.label}
                      label={group.label}
                      typeGroups={group.typeGroups}
                      jiraBaseUrl={jiraBaseUrl}
                      open={isCardOpen(group.label)}
                      onToggle={() => toggleCard(group.label)}
                    />
                  ))
                )
              : reporterGroups.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    沒有母票可供顯示。
                  </p>
                ) : (
                  reporterGroups.map((group) => {
                    const key = group.reporterAccountId ?? group.label
                    return (
                      <ReporterGroupSection
                        key={key}
                        group={group}
                        jiraBaseUrl={jiraBaseUrl}
                        open={isCardOpen(key)}
                        onToggle={() => toggleCard(key)}
                      />
                    )
                  })
                )}
          </div>
          <div className="space-y-4">
            <PieChart
              tasks={filtered}
              jiraBaseUrl={jiraBaseUrl}
              sprintId={sprintId}
              teamOf={teamOf}
              teamOrder={teamOrder}
            />
            <DevTypePieChart
              tasks={filtered}
              jiraBaseUrl={jiraBaseUrl}
              sprintId={sprintId}
              teamOf={teamOf}
              teamOrder={teamOrder}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** Team / Reporter 分群切換（原生 radio，預設 Team）。 */
function RadioGroup({
  mode,
  onModeChange,
}: {
  mode: OverviewGroupMode
  onModeChange: (mode: OverviewGroupMode) => void
}) {
  const options: { value: OverviewGroupMode; label: string }[] = [
    { value: "team", label: "Team" },
    { value: "reporter", label: "Reporter" },
  ]
  return (
    <fieldset className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
      <legend className="sr-only">任務清單分群方式</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === option.value
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
              : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          }`}
        >
          <input
            type="radio"
            name="overview-group-mode"
            value={option.value}
            checked={mode === option.value}
            onChange={() => onModeChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}

/**
 * 一群工作單的可收合區塊（Team 版）：單張表、表頭只放最上方一次；依 Dev Type 分群，
 * 每個 Dev Type 為一個合併列表頭（其下 flat 列出該類型的工作單）。不再分母票／Epic。
 */
function DevTypeGroupSection({
  label,
  typeGroups,
  jiraBaseUrl,
  open,
  onToggle,
}: {
  label: string
  typeGroups: readonly {
    label: string
    tasks: readonly PlanningTask[]
  }[]
  jiraBaseUrl: string | null
  /** 此卡的展開狀態（由父層 `PlanningOverview` 控制，配合「收合／展開」全卡與個別點開）。 */
  open: boolean
  onToggle: () => void
}) {
  const count = typeGroups.reduce((sum, group) => sum + group.tasks.length, 0)
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-left dark:border-slate-800 dark:bg-slate-900/60"
        aria-expanded={open}
      >
        <svg
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform dark:text-slate-500 ${open ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 4 4 4-4 4" />
        </svg>
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{label}</h4>
        <span className="ml-auto tabular-nums text-xs text-slate-400 dark:text-slate-500">
          {count} 張
        </span>
      </button>
      {open && (
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{label} 的工作單</caption>
          <thead>
            <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <th scope="col" className="w-8 py-2 pl-4"><span className="sr-only">Parent Issue type</span></th>
              <th scope="col" className="w-24 py-2 pr-2 font-semibold">Ticket</th>
              <th scope="col" className="py-2 pr-2 font-semibold">Summary</th>
              <th scope="col" className="w-[5.5rem] py-2 pr-2 text-center font-semibold">Status</th>
              <th scope="col" className="w-28 py-2 pr-2 font-semibold">Assignee</th>
              <th scope="col" className="w-14 py-2 pr-4 text-right font-semibold" title="Story Points">SP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {typeGroups.map((group) => (
              <DevTypeGroupBlock key={group.label} group={group} jiraBaseUrl={jiraBaseUrl} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** 一個 Dev Type 群：合併列表頭（顯示 Dev Type，依色族著色）＋其下 flat 工作單列。 */
function DevTypeGroupBlock({
  group,
  jiraBaseUrl,
}: {
  group: {
    label: string
    tasks: readonly PlanningTask[]
  }
  jiraBaseUrl: string | null
}) {
  return (
    <Fragment>
      <tr>
        <td
          colSpan={6}
          className={`bg-slate-50/70 px-4 py-1.5 dark:bg-slate-900/40 ${devTypeColorClass(devTypeFamilyOf(group.label))}`}
        >
          <span className="text-xs font-semibold">{group.label}</span>
          <span className="ml-2 text-[11px] font-normal text-slate-400 dark:text-slate-500">
            {group.tasks.length} 張
          </span>
        </td>
      </tr>
      {group.tasks.map((task) => (
        <WorkItemRow key={task.key} task={task} jiraBaseUrl={jiraBaseUrl} />
      ))}
    </Fragment>
  )
}

/** 一位 Reporter 開的全部母票之可收合區塊（Reporter View）：header（Reporter＋角色徽章）
 * → 逐個 Epic 的表頭與母票 → 非空時附「無 Epic」區塊。 */
function ReporterGroupSection({
  group,
  jiraBaseUrl,
  open,
  onToggle,
}: {
  group: ReporterGroup
  jiraBaseUrl: string | null
  /** 此卡的展開狀態（由父層 `PlanningOverview` 控制，配合「收合／展開」全卡與個別點開）。 */
  open: boolean
  onToggle: () => void
}) {
  const allParents = group.epicGroups.flatMap((epic) => epic.parents).concat(group.noEpic)
  const count = allParents.length
  const points = round1(allParents.reduce((sum, parent) => sum + (parent.points ?? 0), 0))
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-left dark:border-slate-800 dark:bg-slate-900/60"
        aria-expanded={open}
      >
        <svg
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform dark:text-slate-500 ${open ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 4 4 4-4 4" />
        </svg>
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{group.label}</h4>
        {roleBadge(group.rank)}
        <span className="ml-auto tabular-nums text-xs text-slate-400 dark:text-slate-500">
          {count} 張 · {points} 點
        </span>
      </button>
      {open && (
        <table className="w-full table-fixed text-left text-xs">
          <caption className="sr-only">{group.label} 開的母票</caption>
          <thead>
            <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <th scope="col" className="w-[3rem] py-2 pl-4"><span className="sr-only">Issue type</span></th>
              <th scope="col" className="w-[7rem] py-2 pl-1 pr-2 text-center font-semibold">Ticket</th>
              <th scope="col" className="w-[38%] py-2 pr-2 text-center font-semibold">Summary</th>
              <th scope="col" className="w-[26%] py-2 pl-1 pr-2 text-center font-semibold">Component</th>
              <th scope="col" className="w-[3.5rem] py-2 pr-4 text-center font-semibold" title="Story Points">SP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {group.epicGroups.map((epicGroup) => (
              <EpicBlock key={epicGroup.epic.key} epicGroup={epicGroup} jiraBaseUrl={jiraBaseUrl} />
            ))}
            {group.noEpic.length > 0 && (
              <Fragment>
                <tr>
                  <td className="bg-slate-50/70 px-4 py-1.5 dark:bg-slate-900/40" colSpan={5}>
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">無 Epic</span>
                    <span className="ml-2 text-[11px] font-normal text-slate-400 dark:text-slate-500">
                      {group.noEpic.length} 張
                    </span>
                  </td>
                </tr>
                {group.noEpic.map((parent) => (
                  <ParentRow key={parent.key} parent={parent} jiraBaseUrl={jiraBaseUrl} />
                ))}
              </Fragment>
            )}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** Reporter 的角色徽章：fpm（rank 0）／opm（rank 1）／其他（無徽章）。 */
function roleBadge(rank: number): ReactNode {
  if (rank === 0) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        FPM
      </span>
    )
  }
  if (rank === 1) {
    return (
      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
        OPM
      </span>
    )
  }
  return null
}

/** 一個 Epic 下的母票：合併列表頭（Epic key＋summary）＋其下母票列。 */
function EpicBlock({
  epicGroup,
  jiraBaseUrl,
}: {
  epicGroup: {
    epic: { key: string; summary: string | null }
    parents: readonly ReporterParent[]
  }
  jiraBaseUrl: string | null
}) {
  return (
    <Fragment>
      <tr>
        <td colSpan={5} className="bg-slate-50/70 px-4 py-1.5 dark:bg-slate-900/40">
          <span className="flex min-w-0 items-center gap-1.5">
            {jiraBaseUrl ? (
              <a
                href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(epicGroup.epic.key)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 whitespace-nowrap text-xs font-semibold text-purple-600 hover:underline focus-visible:outline-2 dark:text-purple-400"
              >
                {epicGroup.epic.key}
              </a>
            ) : (
              <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-purple-600 dark:text-purple-400">{epicGroup.epic.key}</span>
            )}
            {epicGroup.epic.summary ? (
              <span
                title={epicGroup.epic.summary}
                className="min-w-0 truncate text-xs font-semibold text-purple-600 dark:text-purple-400"
              >{`· ${epicGroup.epic.summary}`}</span>
            ) : null}
            <span className="ml-auto shrink-0 text-[11px] font-normal text-slate-400 dark:text-slate-500">
              {epicGroup.parents.length} 張
            </span>
          </span>
        </td>
      </tr>
      {epicGroup.parents.map((parent) => (
        <ParentRow key={parent.key} parent={parent} jiraBaseUrl={jiraBaseUrl} />
      ))}
    </Fragment>
  )
}

/** 母票列（Reporter View）：Issue type icon | Ticket | Summary | Component | SP。 */
function ParentRow({
  parent,
  jiraBaseUrl,
}: {
  parent: ReporterParent
  jiraBaseUrl: string | null
}) {
  const type: { status: "known"; name: string } | { status: "unknown" } =
    parent.issueType !== null ? { status: "known", name: parent.issueType } : { status: "unknown" }
  return (
    <tr className="align-top">
      <td className="py-2 pl-4"><ParentIssueTypeIcon parent={type} /></td>
      <td className="py-2 pl-1 pr-2 text-center"><span className="block truncate"><TicketLink task={parent} jiraBaseUrl={jiraBaseUrl} /></span></td>
      <td className="truncate py-2 pr-2 text-center text-slate-700 dark:text-slate-200" title={parent.summary ?? ""}>{parent.summary || "—"}</td>
      <td className="truncate py-2 pl-1 pr-2 text-center text-slate-500 dark:text-slate-400">
        {parent.components.length ? (
          <span title={parent.components.join(", ")}>{parent.components.join(", ")}</span>
        ) : (
          "—"
        )}
      </td>
      <td className="py-2 pr-4 text-center tabular-nums text-slate-600 dark:text-slate-300">{formatPoints(parent.points)}</td>
    </tr>
  )
}

/** Dev Type 值 → 字色（Spike/Pre-Spike 深黃、OP-Task/OP-Bug 藍、Dev 綠、Bug 紅；其他中性）。 */
function devTypeColorClass(family: "spike" | "op" | "bug" | "dev" | null): string {
  switch (family) {
    case "spike":
      return "text-amber-700 dark:text-amber-400"
    case "op":
      return "text-sky-600 dark:text-sky-400"
    case "bug":
      return "text-red-600 dark:text-red-400"
    case "dev":
      return "text-emerald-600 dark:text-emerald-500"
    default:
      return "text-slate-500 dark:text-slate-400"
  }
}

/** Dev Type 群下的工作單列：Parent type icon | Ticket | Summary | Status | Assignee | SP。 */
function WorkItemRow({
  task,
  jiraBaseUrl,
}: {
  task: PlanningTask
  jiraBaseUrl: string | null
}) {
  return (
    <tr className="align-top">
      <td className="py-1.5 pl-4"><ParentIssueTypeIcon parent={task.parentIssueType} /></td>
      <td className="py-1.5 pl-1 pr-2"><TicketLink task={task} jiraBaseUrl={jiraBaseUrl} /></td>
      <td className="max-w-0 truncate py-1.5 pr-2 text-slate-700 dark:text-slate-200" title={task.summary ?? ""}>{task.summary || "—"}</td>
      <td className={`whitespace-nowrap py-1.5 pr-2 text-center ${statusColorClass(task.status)}`}>{task.status ?? "—"}</td>
      <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-slate-600 dark:text-slate-300">
        {task.assigneeDisplayName || "—"}
      </td>
      <td className="py-1.5 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatPoints(task.points)}</td>
    </tr>
  )
}

/** 圓餅圖中央/弧段的統計量：預設點數，可切到張數。 */
type PieMetric = OverviewMetric

/**
 * 票種分布圓餅圖（donut，依工作單的母票類型分 Story / Task / Bug）。
 *
 * - 圖下方：張數／點數 切換開關（預設點數——弧段比例依所選量算）。
 * - 圖下方：數據分析明細（各票種的顏色、數值、百分比）。
 * - 點任一弧段／明細列 → 在 Jira 以「該票種母票底下的工作單」開一個 search 分頁。
 * - hover 弧段 → 弧加粗、提亮，並在圖旁浮現「該票種 × 各團隊」比例（跟隨張數/點數）。
 */
function PieChart({
  tasks,
  jiraBaseUrl,
  sprintId,
  teamOf,
  teamOrder,
}: {
  tasks: readonly PlanningTask[]
  jiraBaseUrl: string | null
  sprintId: number | null
  teamOf: Record<string, string>
  teamOrder: readonly string[]
}) {
  const [metric, setMetric] = useState<PieMetric>("points")
  const [hoverType, setHoverType] = useState<"story" | "task" | "bug" | null>(null)
  /** tooltip 的 fixed 定位（視窗座標）；null = 不顯示。 */
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const counts = useMemo(() => countDevTaskTypes(tasks), [tasks])
  const sums = useMemo(() => sumDevTaskTypePoints(tasks), [tasks])

  const types = [
    { key: "story" as const, label: "Story", color: "stroke-[#27a665] dark:stroke-[#27a665]", dot: "bg-[#27a665] dark:bg-[#27a665]" },
    { key: "task" as const, label: "Task", color: "stroke-[#2a78d6] dark:stroke-[#3987e5]", dot: "bg-[#2a78d6] dark:bg-[#3987e5]" },
    { key: "bug" as const, label: "Bug", color: "stroke-[#e05252] dark:stroke-[#e05252]", dot: "bg-[#e05252] dark:bg-[#e05252]" },
  ]

  // 每個票種的「團隊 breakdown」（跟隨 metric：點數加總或張數）。
  const breakdowns = useMemo(() => {
    const teamOfFn = (accountId: string | null) => (accountId === null ? undefined : teamOf[accountId])
    return {
      story: buildDevTaskTypeTeamBreakdown({ tasks, issueType: "story", metric, teamOf: teamOfFn, teamOrder }),
      task: buildDevTaskTypeTeamBreakdown({ tasks, issueType: "task", metric, teamOf: teamOfFn, teamOrder }),
      bug: buildDevTaskTypeTeamBreakdown({ tasks, issueType: "bug", metric, teamOf: teamOfFn, teamOrder }),
    }
  }, [tasks, teamOf, teamOrder, metric])

  const totalCount = counts.story + counts.task + counts.bug
  const totalPoints = round1(sums.story + sums.task + sums.bug)
  const total = metric === "points" ? totalPoints : totalCount
  const unitLabel = metric === "points" ? "SP" : "張"
  const valueOf = (key: "story" | "task" | "bug") => (metric === "points" ? sums[key] : counts[key])
  const percentOf = (value: number) => (total === 0 ? 0 : round1((value / total) * 100))

  const metricValue = (value: number) => (metric === "points" ? round1(value) : value)

  // 依固定色序算弧段（各自扣除間隙，保留表面色斷開）。
  const radius = 44
  const circumference = 2 * Math.PI * radius
  const GAP = 2
  let offset = 0
  const arcs = types
    .filter((segment) => valueOf(segment.key) > 0)
    .map((segment) => {
      const fraction = total === 0 ? 0 : valueOf(segment.key) / total
      const drawn = Math.max(0, fraction * circumference - GAP)
      const start = offset / circumference * 360 // 自 12 點方向順時針的起始角
      const midDeg = start + (fraction * 360) / 2 // 弧段中點角
      const arc = { ...segment, value: valueOf(segment.key), percent: percentOf(valueOf(segment.key)), dasharray: `${drawn} ${circumference - drawn}`, offset, midDeg }
      offset += fraction * circumference
      return arc
    })

  // 深連結以「sprint + 母票票種」組查詢（與工作單資料同源），非逐張 key。
  const searchHref = (key: "story" | "task" | "bug") =>
    jiraBaseUrl && sprintId !== null
      ? issueSearchHref(jiraBaseUrl, sprintChildTasksOfParentTypeJql(sprintId, key))
      : null

  // hover 的票種 → 浮現「該票種 × 各團隊」的提示。當該票種無弧段（0 張/點）時
  // `arc` 為 undefined：此時也不產生 tooltip 定位，不顯示提示。
  const hovered = hoverType === null ? null : {
    type: types.find((t) => t.key === hoverType)!,
    breakdown: breakdowns[hoverType],
    arc: arcs.find((a) => a.key === hoverType) ?? null,
  }
  const teamPercent = (value: number, partTotal: number) =>
    partTotal === 0 ? 0 : round1((value / partTotal) * 100)

  // tooltip 依「被 hover 弧段的中點角」錨到該票種附近，並以 fixed 定位 + 視窗 clamp
  // 避免超出視窗（尤其右緣）。錨點取弧段中點角在圓外緣的 screen 座標，沿徑向向外推半個
  // 自身尺寸，讓 tooltip 貼著弧段又不遮圖；若超出視窗左右/上下，就整體壓回 margin 內。
  const TOOLTIP_W = 176 // w-44
  const TOOLTIP_H = 150
  const SCALE = 208 / 120 // 1 viewBox 單位 = 圖容器（208px）內幾 px
  const MARGIN = 8
  const computeTip = (midDeg: number): { left: number; top: number } | null => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return null
    const rad = (midDeg * Math.PI) / 180
    const anchorR = 58 // 圓心到弧段外緣的徑向距離（radius 44 + stroke 9 + 邊緣預留）
    const ax = 60 + anchorR * Math.sin(rad) // 圓上錨點（viewBox 座標）
    const ay = 60 - anchorR * Math.cos(rad)
    const screenX = rect.left + ax * SCALE
    const screenY = rect.top + ay * SCALE
    const ux = Math.sin(rad) // 由圓心指向錨點的單位向量
    const uy = -Math.cos(rad)
    // tooltip 的中心沿徑向往外推 ·半尺寸 + 間隙·。
    const cx = screenX + ux * (TOOLTIP_W / 2 + 12)
    const cy = screenY + uy * (TOOLTIP_H / 2 + 12)
    const left = Math.min(Math.max(cx - TOOLTIP_W / 2, MARGIN), window.innerWidth - TOOLTIP_W - MARGIN)
    const top = Math.min(Math.max(cy - TOOLTIP_H / 2, MARGIN), window.innerHeight - TOOLTIP_H - MARGIN)
    return { left, top }
  }
  const showTip = (key: "story" | "task" | "bug", midDeg: number) => {
    setHoverType(key)
    setTip(computeTip(midDeg))
  }
  const hideTip = () => {
    setHoverType(null)
    setTip(null)
  }

  return (
    <section className="relative rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">票種分布</h4>

      {/* 圓餅圖：置中、放大填滿卡片；弧段 hover 有加粗＋提亮動畫。
                外層 relative 容器與圖等寬高；`wrapRef` 供 tooltip 把弧段座標換成視窗座標。 */}
      <div ref={wrapRef} className="relative mx-auto block h-52 w-52">
      <svg
        role="img"
        aria-label={`票種分布圓餅圖（${metric === "points" ? "點數" : "張數"}），共 ${total} ${unitLabel}`}
        viewBox="0 0 120 120"
        className="block h-52 w-52"
      >
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="18" className="stroke-slate-100 dark:stroke-slate-800" />
        {arcs.map((arc) => {
          const href = searchHref(arc.key)
          const common = {
            cx: 60,
            cy: 60,
            r: radius,
            fill: "none",
            strokeWidth: 18,
            strokeDasharray: arc.dasharray,
            strokeDashoffset: -arc.offset,
            transform: "rotate(-90 60 60)",
          }
          const visible = (
            <circle
              {...common}
              className={`${arc.color} transition-[stroke-width,filter] duration-200 ease-out group-hover:[stroke-width:24] group-hover:brightness-110 group-hover:drop-shadow-[0_2px_6px_rgba(0,0,0,0.25)]`}
            />
          )
          const hitTarget = <circle {...common} strokeWidth={30} stroke="transparent" />
          const inner = href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`在 Jira 開啟 ${arc.label} 工作單（${arc.value} ${unitLabel}）`}
              className="group cursor-pointer"
            >
              {visible}
              {hitTarget}
            </a>
          ) : (
            <g className="group cursor-pointer">{visible}</g>
          )
          return (
            <g
              key={arc.key}
              onMouseEnter={() => showTip(arc.key, arc.midDeg)}
              onMouseLeave={hideTip}
            >
              {inner}
            </g>
          )
        })}
        <text x="60" y="57" textAnchor="middle" className="fill-slate-900 text-[22px] font-semibold dark:fill-white">
          {round1(total)}
        </text>
        <text x="60" y="73" textAnchor="middle" className="fill-slate-500 text-[10px] dark:fill-slate-400">
          {unitLabel}
        </text>
      </svg>

      {/* hover 某票種弧段時，浮現「該票種 × 各團隊」的比例（跟隨張數/點數）。
          fixed 定位依弧段中點角並 clamp 在視窗內；該票種無弧段時不顯示。 */}
      {hovered && hovered.arc && tip && (
        <div
          role="tooltip"
          style={{ left: tip.left, top: tip.top }}
          className="pointer-events-none fixed z-20 w-44 rounded-xl border border-slate-200 bg-white/95 p-2.5 text-xs shadow-xl backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95"
        >
          <div className="mb-1.5 flex items-center gap-2 border-b border-slate-100 pb-1.5 dark:border-slate-800">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${hovered.type.dot}`} aria-hidden="true" />
            <span className="font-semibold text-slate-800 dark:text-slate-200">{hovered.type.label} · 依團隊</span>
            <span className="ml-auto tabular-nums text-slate-500 dark:text-slate-400">
              {metricValue(hovered.breakdown.total)} {unitLabel}
            </span>
          </div>
          <ul className="space-y-1">
            {hovered.breakdown.teams.length === 0 ? (
              <li className="text-slate-400 dark:text-slate-500">此票種暫無工作單</li>
            ) : (
              hovered.breakdown.teams.map((team) => (
                <li key={team.label} className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">{team.label}</span>
                  <span className="ml-auto tabular-nums text-slate-700 dark:text-slate-200">{metricValue(team.value)}</span>
                  <span className="w-9 text-right tabular-nums text-slate-500 dark:text-slate-400">
                    {teamPercent(team.value, hovered.breakdown.total)}%
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
      </div>

      {/* 張數／點數 切換開關（預設點數），置右於圖下方。 */}
      <div className="mt-4 flex justify-end">
        <MetricSwitch metric={metric} onMetricChange={setMetric} />
      </div>

      {/* 數據分析：各票種明細（顏色、數值、百分比），點列開啟 Jira。 */}
      <ul className="mt-4 divide-y divide-slate-100 text-xs dark:divide-slate-800">
        {types.map((segment) => {
          const href = searchHref(segment.key)
          const value = valueOf(segment.key)
          const content = (
            <>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${segment.dot}`} aria-hidden="true" />
              <span className="text-slate-600 dark:text-slate-300">{segment.label}</span>
              <span className="ml-auto tabular-nums text-slate-700 dark:text-slate-200">
                {metric === "points" ? round1(value) : value}
              </span>
              <span className="w-10 text-right tabular-nums text-slate-500 dark:text-slate-400">
                {percentOf(value)}%
              </span>
            </>
          )
          const rowClass = "flex items-center gap-2 px-2 py-2"
          const rowProps = {
            // 資料列 hover 帶出同一票種的團隊 breakdown；無弧段（0 張/點）則只 highlight、不浮提示。
            onMouseEnter: () => {
              const arc = arcs.find((a) => a.key === segment.key)
              if (arc) showTip(segment.key, arc.midDeg)
              else hideTip()
            },
            onMouseLeave: hideTip,
          }
          if (!href) return (
            <li key={segment.key} className={rowClass} {...rowProps}>{content}</li>
          )
          return (
            <li key={segment.key}>
              <a
                {...rowProps}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`在 Jira 開啟 ${segment.label} 工作單`}
                className={`${rowClass} rounded transition-colors hover:bg-slate-50 hover:underline dark:hover:bg-slate-800/40`}
              >
                {content}
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 建構 Jira issue search 深連結（UI 導覽 href，非資料查詢）；JQL 由 `jira-jql.ts` 提供。 */
function issueSearchHref(jiraBaseUrl: string, jql: string): string {
  const base = jiraBaseUrl.replace(/\/$/, "")
  return `${base}/issues/?jql=${encodeURIComponent(jql)}`
}

/**
 * 開發類型分佈圓餅圖（donut，依工作單的 Dev Type 自訂欄位分群）。
 *
 * - 位於「票種分布」圖下方，統計量、hover、深連結結構與票種分布相同。
 * - 分段 = 依 `DEV_TYPE_GROUP_LABELS` 固定順序的 Dev Type 值（Pre-Spike → Spike → Dev →
 *   Bug → OP-Task → OP-Bug → 未分類；空段不繪）；色族沿用左側 Team View 的
 *   `devTypeFamilyOf`（Spike／Pre-Spike 深黃、OP-Task／OP-Bug 藍、Dev 綠、Bug 紅、未分類中性）。
 * - 點弧段／明細列 → 在 Jira 以「sprint + 該 Dev Type 值」開 search 分頁；未分類段以
 *   「Dev Type 欄位未填（`is EMPTY`）」表達（填了未知值者仍屬未分類段，但無法用單一值深連結）。
 */
function DevTypePieChart({
  tasks,
  jiraBaseUrl,
  sprintId,
  teamOf,
  teamOrder,
}: {
  tasks: readonly PlanningTask[]
  jiraBaseUrl: string | null
  sprintId: number | null
  teamOf: Record<string, string>
  teamOrder: readonly string[]
}) {
  const [metric, setMetric] = useState<PieMetric>("points")
  const [hoverLabel, setHoverLabel] = useState<string | null>(null)
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const counts = useMemo(() => countDevTypeLabels(tasks), [tasks])
  const sums = useMemo(() => sumDevTypeLabelPoints(tasks), [tasks])

  // 依固定順序列出 Dev Type 分段；色族共用 `devTypeFamilyOf`（未分類中性）。
  const segments = useMemo(() => {
    const labelColor = (label: string): { color: string; dot: string } => {
      switch (devTypeFamilyOf(label)) {
        case "spike":
          return { color: "stroke-[#d97706] dark:stroke-[#fbbf24]", dot: "bg-[#d97706] dark:bg-[#fbbf24]" }
        case "op":
          return { color: "stroke-[#0284c7] dark:stroke-[#38bdf8]", dot: "bg-[#0284c7] dark:bg-[#38bdf8]" }
        case "bug":
          return { color: "stroke-[#dc2626] dark:stroke-[#f87171]", dot: "bg-[#dc2626] dark:bg-[#f87171]" }
        case "dev":
          return { color: "stroke-[#059669] dark:stroke-[#34d399]", dot: "bg-[#059669] dark:bg-[#34d399]" }
        default:
          return { color: "stroke-[#64748b] dark:stroke-[#94a3b8]", dot: "bg-[#64748b] dark:bg-[#94a3b8]" }
      }
    }
    return ([...DEV_TYPE_GROUP_LABELS, UNCLASSIFIED_DEV_TYPE_LABEL] as string[]).map((label) => {
      const c = labelColor(label)
      return { label, color: c.color, dot: c.dot }
    })
  }, [])

  const teamOfFn = useMemo(
    () => (accountId: string | null) => (accountId === null ? undefined : teamOf[accountId]),
    [teamOf]
  )

  // 每個 Dev Type 分段的「團隊 breakdown」（跟隨 metric：點數加總或張數）。
  const breakdowns = useMemo(() => {
    const out: Record<string, TypeTeamBreakdown> = {}
    for (const segment of segments) {
      out[segment.label] = buildDevTypeLabelTeamBreakdown({
        tasks,
        label: segment.label,
        metric,
        teamOf: teamOfFn,
        teamOrder,
      })
    }
    return out
  }, [tasks, segments, metric, teamOfFn, teamOrder])

  const valueOf = (label: string) => (metric === "points" ? sums[label] ?? 0 : counts[label] ?? 0)
  const total = round1(
    metric === "points"
      ? Object.values(sums).reduce((sum, value) => sum + value, 0)
      : Object.values(counts).reduce((sum, value) => sum + value, 0)
  )
  const unitLabel = metric === "points" ? "SP" : "張"
  const percentOf = (value: number) => (total === 0 ? 0 : round1((value / total) * 100))

  const metricValue = (value: number) => (metric === "points" ? round1(value) : value)

  // 依固定色序算弧段（各自扣除間隙，保留表面色斷開）。
  const radius = 44
  const circumference = 2 * Math.PI * radius
  const GAP = 2
  let offset = 0
  const arcs = segments
    .filter((segment) => valueOf(segment.label) > 0)
    .map((segment) => {
      const fraction = total === 0 ? 0 : valueOf(segment.label) / total
      const drawn = Math.max(0, fraction * circumference - GAP)
      const start = offset / circumference * 360
      const midDeg = start + (fraction * 360) / 2
      const arc = { ...segment, value: valueOf(segment.label), percent: percentOf(valueOf(segment.label)), dasharray: `${drawn} ${circumference - drawn}`, offset, midDeg }
      offset += fraction * circumference
      return arc
    })

  // 深連結以「sprint + Dev Type 值」組查詢；未分類以「該欄未填」表達（`is EMPTY`），
  // 因此只涵蓋未填 Dev Type 的工作單（填了未知值的無法用單一值表達，仍留在未分類段）。
  const searchHref = (label: string) => {
    if (!jiraBaseUrl || sprintId === null) return null
    const jql =
      label === UNCLASSIFIED_DEV_TYPE_LABEL
        ? sprintChildTasksUnclassifiedDevTypeJql(sprintId)
        : sprintChildTasksOfDevTypeJql(sprintId, label)
    return issueSearchHref(jiraBaseUrl, jql)
  }

  const hovered = hoverLabel === null ? null : {
    label: hoverLabel,
    breakdown: breakdowns[hoverLabel],
    arc: arcs.find((a) => a.label === hoverLabel) ?? null,
  }
  const teamPercent = (value: number, partTotal: number) =>
    partTotal === 0 ? 0 : round1((value / partTotal) * 100)

  // tooltip 依被 hover 弧段的中點角錨到該段附近（與票種分布相同的定位方式）。
  const TOOLTIP_W = 176
  const TOOLTIP_H = 150
  const SCALE = 208 / 120
  const MARGIN = 8
  const computeTip = (midDeg: number): { left: number; top: number } | null => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return null
    const rad = (midDeg * Math.PI) / 180
    const anchorR = 58
    const ax = 60 + anchorR * Math.sin(rad)
    const ay = 60 - anchorR * Math.cos(rad)
    const screenX = rect.left + ax * SCALE
    const screenY = rect.top + ay * SCALE
    const ux = Math.sin(rad)
    const uy = -Math.cos(rad)
    const cx = screenX + ux * (TOOLTIP_W / 2 + 12)
    const cy = screenY + uy * (TOOLTIP_H / 2 + 12)
    const left = Math.min(Math.max(cx - TOOLTIP_W / 2, MARGIN), window.innerWidth - TOOLTIP_W - MARGIN)
    const top = Math.min(Math.max(cy - TOOLTIP_H / 2, MARGIN), window.innerHeight - TOOLTIP_H - MARGIN)
    return { left, top }
  }
  const showTip = (label: string, midDeg: number) => {
    setHoverLabel(label)
    setTip(computeTip(midDeg))
  }
  const hideTip = () => {
    setHoverLabel(null)
    setTip(null)
  }

  return (
    <section className="relative rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">開發類型分佈</h4>

      <div ref={wrapRef} className="relative mx-auto block h-52 w-52">
      <svg
        role="img"
        aria-label={`開發類型分佈圓餅圖（${metric === "points" ? "點數" : "張數"}），共 ${total} ${unitLabel}`}
        viewBox="0 0 120 120"
        className="block h-52 w-52"
      >
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="18" className="stroke-slate-100 dark:stroke-slate-800" />
        {arcs.map((arc) => {
          const href = searchHref(arc.label)
          const common = {
            cx: 60,
            cy: 60,
            r: radius,
            fill: "none",
            strokeWidth: 18,
            strokeDasharray: arc.dasharray,
            strokeDashoffset: -arc.offset,
            transform: "rotate(-90 60 60)",
          }
          const visible = (
            <circle
              {...common}
              className={`${arc.color} transition-[stroke-width,filter] duration-200 ease-out group-hover:[stroke-width:24] group-hover:brightness-110 group-hover:drop-shadow-[0_2px_6px_rgba(0,0,0,0.25)]`}
            />
          )
          const hitTarget = <circle {...common} strokeWidth={30} stroke="transparent" />
          const inner = href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`在 Jira 開啟 ${arc.label} 工作單（${arc.value} ${unitLabel}）`}
              className="group cursor-pointer"
            >
              {visible}
              {hitTarget}
            </a>
          ) : (
            <g className="group cursor-pointer">{visible}</g>
          )
          return (
            <g
              key={arc.label}
              onMouseEnter={() => showTip(arc.label, arc.midDeg)}
              onMouseLeave={hideTip}
            >
              {inner}
            </g>
          )
        })}
        <text x="60" y="57" textAnchor="middle" className="fill-slate-900 text-[22px] font-semibold dark:fill-white">
          {round1(total)}
        </text>
        <text x="60" y="73" textAnchor="middle" className="fill-slate-500 text-[10px] dark:fill-slate-400">
          {unitLabel}
        </text>
      </svg>

      {hovered && hovered.arc && tip && (
        <div
          role="tooltip"
          style={{ left: tip.left, top: tip.top }}
          className="pointer-events-none fixed z-20 w-44 rounded-xl border border-slate-200 bg-white/95 p-2.5 text-xs shadow-xl backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95"
        >
          <div className="mb-1.5 flex items-center gap-2 border-b border-slate-100 pb-1.5 dark:border-slate-800">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${hovered.arc.dot}`} aria-hidden="true" />
            <span className="font-semibold text-slate-800 dark:text-slate-200">{hovered.label} · 依團隊</span>
            <span className="ml-auto tabular-nums text-slate-500 dark:text-slate-400">
              {metricValue(hovered.breakdown.total)} {unitLabel}
            </span>
          </div>
          <ul className="space-y-1">
            {hovered.breakdown.teams.length === 0 ? (
              <li className="text-slate-400 dark:text-slate-500">此開發類型暫無工作單</li>
            ) : (
              hovered.breakdown.teams.map((team) => (
                <li key={team.label} className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">{team.label}</span>
                  <span className="ml-auto tabular-nums text-slate-700 dark:text-slate-200">{metricValue(team.value)}</span>
                  <span className="w-9 text-right tabular-nums text-slate-500 dark:text-slate-400">
                    {teamPercent(team.value, hovered.breakdown.total)}%
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
      </div>

      <div className="mt-4 flex justify-end">
        <MetricSwitch metric={metric} onMetricChange={setMetric} />
      </div>

      <ul className="mt-4 divide-y divide-slate-100 text-xs dark:divide-slate-800">
        {segments.map((segment) => {
          const href = searchHref(segment.label)
          const value = valueOf(segment.label)
          const content = (
            <>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${segment.dot}`} aria-hidden="true" />
              <span className="text-slate-600 dark:text-slate-300">{segment.label}</span>
              {segment.label === UNCLASSIFIED_DEV_TYPE_LABEL && (
                <span className="text-[10px] text-slate-400 dark:text-slate-500">未填／其他</span>
              )}
              <span className="ml-auto tabular-nums text-slate-700 dark:text-slate-200">
                {metric === "points" ? round1(value) : value}
              </span>
              <span className="w-10 text-right tabular-nums text-slate-500 dark:text-slate-400">
                {percentOf(value)}%
              </span>
            </>
          )
          const rowClass = "flex items-center gap-2 px-2 py-2"
          const rowProps = {
            onMouseEnter: () => {
              const arc = arcs.find((a) => a.label === segment.label)
              if (arc) showTip(segment.label, arc.midDeg)
              else hideTip()
            },
            onMouseLeave: hideTip,
          }
          if (!href) return (
            <li key={segment.label} className={rowClass} {...rowProps}>{content}</li>
          )
          return (
            <li key={segment.label}>
              <a
                {...rowProps}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`在 Jira 開啟 ${segment.label} 工作單`}
                className={`${rowClass} rounded transition-colors hover:bg-slate-50 hover:underline dark:hover:bg-slate-800/40`}
              >
                {content}
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 圓餅圖統計量的滑動式切換開關（點數／張數，預設點數在左＝開）。 */
function MetricSwitch({
  metric,
  onMetricChange,
}: {
  metric: PieMetric
  onMetricChange: (metric: PieMetric) => void
}) {
  const isPoints = metric === "points"
  const activeClass = "font-semibold text-slate-900 dark:text-white"
  const inactiveClass = "text-slate-400 dark:text-slate-500"
  return (
    <div className="inline-flex select-none items-center gap-2 text-sm" role="group" aria-label="統計量：點數／張數">
      <span className={`transition-colors ${isPoints ? activeClass : inactiveClass}`}>點數</span>
      <button
        type="button"
        role="switch"
        aria-checked={isPoints}
        aria-label="切換統計量：點數／張數"
        onClick={() => onMetricChange(isPoints ? "count" : "points")}
        className="relative h-6 w-12 rounded-full bg-slate-300 transition-colors duration-200 hover:bg-slate-400 focus-visible:outline-2 focus-visible:outline-blue-600 dark:bg-slate-700 dark:hover:bg-slate-600"
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
            isPoints ? "translate-x-0" : "translate-x-6"
          }`}
        />
      </button>
      <span className={`transition-colors ${isPoints ? inactiveClass : activeClass}`}>張數</span>
    </div>
  )
}
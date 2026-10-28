"use client"

import { useMemo, useState } from "react"
import type { PlanningOverviewItem } from "@/lib/planning-overview"
import {
  buildOverviewGroups,
  countIssueTypes,
  sumIssueTypePoints,
  type OverviewGroupMode,
} from "@/lib/planning-overview"
import { IssueTypeIcon } from "@/components/issue-type-icon"
import { TicketLink } from "@/components/ticket-link"
import { statusColorClass } from "@/lib/status-color"
import { sprintParentIssuesOfTypeJql } from "@/lib/jira-jql"

/** 點數顯示：未估計（null）顯示「—」。 */
function formatPoints(value: number | null): string {
  return value === null ? "—" : String(Math.round(value * 10) / 10)
}

/** 把數字無條件減去小數尾數，避免浮點殘留（如 3.3000000000000003）。 */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * 任務規劃總覽：左 2/3 任務清單（母票層級 Epic/Story/Task/Bug，Team ／Reporter 分群）、
 * 右 1/3 票種比例圓餅圖。
 *
 * 母票資料由 `PlanningClient` 遲載一次並快取（切 Tab 不重撈）；本組件只做
 * 團隊過濾、分群與繪製，不重發 JQL。
 */
export function PlanningOverview({
  teamOf,
  teamOrder,
  memberIds,
  jiraBaseUrl,
  sprintId,
  items,
  loading,
  error,
  onRetry,
}: {
  /** accountId → 團隊 label（由團隊選單載入；供 Team 分群）。 */
  teamOf: Record<string, string>
  /** 團隊顯示順序（label）。 */
  teamOrder: readonly string[]
  /** 團隊過濾：null＝顯示全部；否則只保留指派人在內的母票。 */
  memberIds: ReadonlySet<string> | null
  jiraBaseUrl: string | null
  /** 目前 sprint 的 id（圓餅圖 arc 的 Jira 深連結用來組 `sprint = X`）。 */
  sprintId: number | null
  items: PlanningOverviewItem[] | null
  loading: boolean
  error: { code: string; message: string } | null
  onRetry: () => void
}) {
  const [mode, setMode] = useState<OverviewGroupMode>("team")

  // 團隊過濾：與「任務分派狀況」一致——無選取顯示全部；否則只留指派人在所選團隊內。
  const filtered = useMemo(
    () =>
      memberIds === null
        ? items
        : items?.filter(
            (item) => item.assigneeAccountId !== null && memberIds.has(item.assigneeAccountId)
          ) ?? null,
    [items, memberIds]
  )

  const groups = useMemo(
    () =>
      filtered
        ? buildOverviewGroups({
            items: filtered,
            mode,
            teamOf: (accountId) => (accountId === null ? undefined : teamOf[accountId]),
            teamOrder,
          })
        : [],
    [filtered, mode, teamOf, teamOrder]
  )

  // 圖上方的標頭：總張數 + 總點數。
  const header = useMemo(() => {
    if (!filtered) return null
    const points = filtered.reduce((sum, item) => sum + (item.points ?? 0), 0)
    return { count: filtered.length, points: round1(points) }
  }, [filtered])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <RadioGroup mode={mode} onModeChange={setMode} />
        {header && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            共 <span className="font-semibold text-slate-900 dark:text-white">{header.count}</span> 張母票 · 總點數{" "}
            <span className="font-semibold text-slate-900 dark:text-white">{formatPoints(header.points)}</span> SP
          </p>
        )}
      </div>

      {loading ? (
        <div className="grid gap-6 py-6 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <div className="h-10 w-1/2 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" aria-hidden="true" />
            <div className="h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" aria-hidden="true" />
          </div>
          <div className="h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" aria-hidden="true" />
        </div>
      ) : error ? (
        <div className="py-10 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-300">{error.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            重試
          </button>
        </div>
      ) : !filtered || filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          此 Sprint 尚未有對應的母票。
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                沒有符合所選團隊的母票。
              </p>
            ) : (
              groups.map((group) => (
                <GroupSection
                  key={group.label}
                  label={group.label}
                  rows={group.rows}
                  jiraBaseUrl={jiraBaseUrl}
                />
              ))
            )}
          </div>
          <div>
            <PieChart items={filtered} jiraBaseUrl={jiraBaseUrl} sprintId={sprintId} />
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

function GroupSection({
  label,
  rows,
  jiraBaseUrl,
}: {
  label: string
  rows: Array<{ type: "epic"; epic: { key: string; summary: string | null }; children: PlanningOverviewItem[] } | { type: "item"; item: PlanningOverviewItem }>
  jiraBaseUrl: string | null
}) {
  const [open, setOpen] = useState(true)
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
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
      </button>
      {open && (
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{label} 的母票</caption>
          <thead>
            <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <th scope="col" className="w-8 py-2 pl-4"><span className="sr-only">Issue type</span></th>
              <th scope="col" className="w-24 py-2 pr-2 font-semibold">Ticket</th>
              <th scope="col" className="py-2 pr-2 font-semibold">Summary</th>
              <th scope="col" className="w-[5.5rem] py-2 pr-2 text-center font-semibold">Status</th>
              <th scope="col" className="w-10 py-2 pr-4 text-right font-semibold" title="Story Points">SP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row) =>
              row.type === "epic" ? (
                <EpicRows
                  key={row.epic.key}
                  epic={row.epic}
                  subitems={row.children}
                  jiraBaseUrl={jiraBaseUrl}
                />
              ) : (
                <ItemRow key={row.item.key} item={row.item} jiraBaseUrl={jiraBaseUrl} nest={false} />
              )
            )}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** Epic 表頭 + 其下母票（children 縮排，表頭紫色）。 */
function EpicRows({
  epic,
  subitems,
  jiraBaseUrl,
}: {
  epic: { key: string; summary: string | null }
  subitems: PlanningOverviewItem[]
  jiraBaseUrl: string | null
}) {
  return (
    <>
      <tr className="bg-slate-50/70 dark:bg-slate-900/40">
        <td className="py-2 pl-4"><IssueTypeIcon issueType="Epic" /></td>
        <td className="py-2 pr-2 font-semibold text-purple-700 dark:text-purple-300">{epic.key}</td>
        <td colSpan={3} className="max-w-0 truncate py-2 pr-2 font-medium text-purple-700 dark:text-purple-300" title={epic.summary ?? ""}>
          {epic.summary || "—"}
        </td>
      </tr>
      {subitems.map((item) => (
        <ItemRow key={item.key} item={item} jiraBaseUrl={jiraBaseUrl} nest />
      ))}
    </>
  )
}

function ItemRow({
  item,
  jiraBaseUrl,
  nest,
}: {
  item: PlanningOverviewItem
  jiraBaseUrl: string | null
  nest: boolean
}) {
  return (
    <tr className="align-top">
      <td className={`py-2 pl-4 ${nest ? "pl-8" : ""}`}><IssueTypeIcon issueType={item.issueType} /></td>
      <td className="py-2 pr-2"><TicketLink task={item} jiraBaseUrl={jiraBaseUrl} /></td>
      <td className="max-w-0 truncate py-2 pr-2 text-slate-700 dark:text-slate-200" title={item.summary ?? ""}>{item.summary || "—"}</td>
      <td className={`whitespace-nowrap py-2 pr-2 text-center ${statusColorClass(item.status)}`}>{item.status ?? "—"}</td>
      <td className="py-2 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatPoints(item.points)}</td>
    </tr>
  )
}

/** 圓餅圖中央/弧段的統計量：預設點數，可切到張數。 */
type PieMetric = "points" | "count"

/**
 * 票種比例圓餅圖（donut，只統計母票自身票種：Story / Task / Bug）。
 *
 * - 圖下方：張數／點數 切換開關（預設點數——弧段比例依所選量算）。
 * - 圖下方：數據分析明細（各票種的顏色、數值、百分比）。
 * - 點任一弧段／明細列 → 在 Jira 以該票種的母票 key 開一個 search 分頁。
 * - hover 弧段 → 弧加粗、提亮（CSS transition 動畫）。
 */
function PieChart({
  items,
  jiraBaseUrl,
  sprintId,
}: {
  items: PlanningOverviewItem[]
  jiraBaseUrl: string | null
  sprintId: number | null
}) {
  const [metric, setMetric] = useState<PieMetric>("points")

  const counts = useMemo(() => countIssueTypes(items), [items])
  const sums = useMemo(() => sumIssueTypePoints(items), [items])

  const types = [
    { key: "story" as const, label: "Story", color: "stroke-[#27a665] dark:stroke-[#27a665]", dot: "bg-[#27a665] dark:bg-[#27a665]" },
    { key: "task" as const, label: "Task", color: "stroke-[#2a78d6] dark:stroke-[#3987e5]", dot: "bg-[#2a78d6] dark:bg-[#3987e5]" },
    { key: "bug" as const, label: "Bug", color: "stroke-[#e05252] dark:stroke-[#e05252]", dot: "bg-[#e05252] dark:bg-[#e05252]" },
  ]

  const totalCount = counts.story + counts.task + counts.bug
  const totalPoints = round1(sums.story + sums.task + sums.bug)
  const total = metric === "points" ? totalPoints : totalCount
  const unitLabel = metric === "points" ? "SP" : "張"
  const valueOf = (key: "story" | "task" | "bug") => (metric === "points" ? sums[key] : counts[key])
  const percentOf = (value: number) => (total === 0 ? 0 : round1((value / total) * 100))

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
      const arc = { ...segment, value: valueOf(segment.key), percent: percentOf(valueOf(segment.key)), dasharray: `${drawn} ${circumference - drawn}`, offset }
      offset += fraction * circumference
      return arc
    })

  // 深連結以「sprint + issuetype」組查詢（與母票資料同源），非逐張 key。
  const searchHref = (key: "story" | "task" | "bug") =>
    jiraBaseUrl && sprintId !== null
      ? issueSearchHref(jiraBaseUrl, sprintParentIssuesOfTypeJql(sprintId, key))
      : null

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">票種比例</h4>

      {/* 圓餅圖：置中、放大填滿卡片；弧段 hover 有加粗＋提亮動畫。 */}
      <svg
        role="img"
        aria-label={`票種比例圓餅圖（${metric === "points" ? "點數" : "張數"}），共 ${total} ${unitLabel}`}
        viewBox="0 0 120 120"
        className="mx-auto block h-52 w-52"
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
          if (!href) return <g key={arc.key}>{visible}</g>
          return (
            <a
              key={arc.key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`在 Jira 開啟 ${arc.label} 母票（${arc.value} ${unitLabel}）`}
              className="group cursor-pointer"
            >
              {visible}
              {/* 加寬的透明 hit target，讓弧段區域範圍可點。 */}
              <circle {...common} strokeWidth={30} stroke="transparent" />
            </a>
          )
        })}
        <text x="60" y="57" textAnchor="middle" className="fill-slate-900 text-[22px] font-semibold dark:fill-white">
          {round1(total)}
        </text>
        <text x="60" y="73" textAnchor="middle" className="fill-slate-500 text-[10px] dark:fill-slate-400">
          {unitLabel}
        </text>
      </svg>

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
          if (!href) return <li key={segment.key} className={rowClass}>{content}</li>
          return (
            <li key={segment.key}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`在 Jira 開啟 ${segment.label} 母票`}
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
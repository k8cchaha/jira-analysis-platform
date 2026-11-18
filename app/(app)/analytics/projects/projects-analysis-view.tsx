"use client"

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { TicketLink } from "@/components/ticket-link"
import { projectsAnalysisIssueIdsJql } from "@/lib/jira-jql"
import { DASHBOARD_TEAMS, DashboardFilterError } from "@/lib/jira-dashboard-filter"
import { useTeamMembers } from "@/components/team-members-provider"
import { memberCapacity, teamCapacities } from "@/lib/projects-capacity"
import { isBlockedParentStatus } from "@/lib/blocked-parent"
import { ProjectsCommitmentDetail, ProjectsSprintDetail, sprintTeamBreakdown, type CommitmentTeamRow } from "./projects-sprint-detail"
import { ProjectsDevTypePie } from "./projects-dev-type-pie"
import { ProjectsUnfinishedDetail } from "./projects-unfinished-detail"
import { jiraIssueHref, jiraSearchHref } from "@/lib/jira-url"
import { filterProjectsMetricTasks, projectsEstimationDeviation, projectsPointTotal, projectsRatio, ProjectsAnalysisValidationError, PROJECTS_DEV_TYPES, projectsWorkTotals, selectProjectsMetricIssues, selectProjectsOutputTeamIssues, selectProjectsTeamIssues, type PointTotal, type ProjectsAnalysisResult, type ProjectsAnalysisTask, type ProjectsMetric, type ProjectsMetricFilter, type ProjectsRatio, type ProjectsSprintSummary, type WorkTotals } from "@/lib/projects-analysis"
import { ProjectsTrendChart, type TrendDatum, type TrendSeries } from "./projects-trend-chart"
import "./projects-analysis.css"

type Unit = "sp" | "actualSp" | "count"
type OutputTeamMetric = { kind: "output-teams"; teamIds: readonly string[] }
type DetailMetric = ProjectsMetric | readonly ProjectsMetric[] | OutputTeamMetric
// Seven fixed hue/shape pairs, then the same pairs with a distinct long dash.
// Registry positions follow the configured team order, not the selected/visible order.
const outputEncodings: { color: string; encoding: NonNullable<TrendSeries["encoding"]> }[] = [
  { color: "type-0", encoding: { shape: 0 } },
  { color: "type-1", encoding: { shape: 1 } },
  { color: "type-2", encoding: { shape: 2 } },
  { color: "type-3", encoding: { shape: 3 } },
  { color: "type-4", encoding: { shape: 4 } },
  { color: "type-5", encoding: { shape: 5 } },
  { color: "type-6", encoding: { shape: 6 } },
  { color: "type-0", encoding: { shape: 0, dash: "10 5" } },
  { color: "type-1", encoding: { shape: 1, dash: "10 5" } },
  { color: "type-2", encoding: { shape: 2, dash: "10 5" } },
  { color: "type-3", encoding: { shape: 3, dash: "10 5" } },
  { color: "type-4", encoding: { shape: 4, dash: "10 5" } },
  { color: "type-5", encoding: { shape: 5, dash: "10 5" } },
  { color: "type-6", encoding: { shape: 6, dash: "10 5" } },
]
const outputTeams = [...DASHBOARD_TEAMS.map((team, index) => ({ id: team.group, label: team.label, ...outputEncodings[index] })), { id: "other", label: "其他", ...outputEncodings[13] }]
const outputUnitLabels = { sp: "Story Points", actualSp: "Actual Story Points" }
const topics = [
  { id: "output", label: "總產出" },
  { id: "commitment", label: "負載率／完成率" },
  { id: "estimation-deviation", label: "估點偏差率" },
  { id: "types", label: "完成任務類型" },
  { id: "unfinished", label: "目前未完成" },
] as const
type Topic = typeof topics[number]["id"]
const unitLabels: Record<Unit, string> = { sp: "SP", actualSp: "Actual SP", count: "張數" }
type OutputView = "all-teams" | "by-team"
/** Sentinel: in 全團隊總覽 the chart sums the visible teams itself instead of waiting for a total series. */
const OVERVIEW_STACK = "__overview__"
const outputViewLabels: Record<OutputView, string> = { "all-teams": "全團隊總覽", "by-team": "各團隊產出" }
/** 完成率 = completed ÷ planned; 負載率 = planned ÷ capacity. Both share the same per-Sprint team population. */
type CommitmentView = "overview" | "team-load" | "team-completion"
const commitmentViewLabels: Record<CommitmentView, string> = { overview: "全團隊負載率／完成率", "team-load": "各團隊負載率", "team-completion": "各團隊完成率" }
const commitmentViewChoices = ["overview", "team-load", "team-completion"] as const
/** With one team in scope the same three views compare that team's members instead. */
const commitmentMemberViewLabels: Record<CommitmentView, string> = { overview: "全成員負載率／完成率", "team-load": "各成員負載率", "team-completion": "各成員完成率" }
/** A finished query opens every Sprint topic on the newest Sprint, so its detail panel is visible at once. */
const newestSprintId = (sprints: readonly { id: number; startDate: string }[]): number | null =>
  [...sprints].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id)[0]?.id ?? null
/** With one team in scope the same two views compare that team's members instead. */
const outputMemberViewLabels: Record<OutputView, string> = { "all-teams": "全成員總覽", "by-team": "各成員產出" }
type SegmentedValue = Unit | OutputView | CommitmentView
const pointFields = { sp: "points", actualSp: "actualPoints" } as const
const number = (value: number) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2, ...(Math.abs(value) > 0 && (Math.abs(value) < .01 || Math.abs(value) >= 1e12) ? { notation: "scientific" as const } : Math.abs(value) >= 10_000 ? { notation: "compact" as const } : {}) }).format(value)
const points = (value: PointTotal) => value.sum === null ? "—／未填" : number(value.sum)
const percentTick = (value: number) => value > 0 && value < .0005 ? "<0.1%" : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1, style: "percent", notation: value >= 1e4 ? "scientific" : "standard" }).format(value)
const percent = (value: ProjectsRatio) => value.value === null ? "—／不適用" : percentTick(value.value)
const numericLinkClass = "projects-number-link inline-flex min-h-6 items-center rounded underline decoration-dotted decoration-slate-400 underline-offset-4 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-blue-600 dark:decoration-slate-500"
function ExternalNumber({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={numericLinkClass} aria-label={`${label}，在 Jira 開啟工作單（另開分頁）`} title={`${label} · 在 Jira 開啟（另開分頁）`}>{children}</a>
}
function Coverage({ value, renderValue }: { value: PointTotal; renderValue: (value: number, display: ReactNode, subset: "all" | "known" | "missing") => ReactNode }) {
  const count = value.knownCount + value.missingCount
  return <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">已填 {renderValue(value.knownCount, number(value.knownCount), "known")}／未填 {renderValue(value.missingCount, number(value.missingCount), "missing")}{count > 0 && <> · {renderValue(value.knownCount / count, `${Math.round(value.knownCount / count * 100)}%`, "all")} 完整</>}</span>
}
function Ratio({ value, unit, main, numerator, denominator }: { value: ProjectsRatio; unit: string; main: ReactNode; numerator: ReactNode; denominator: ReactNode }) {
  return <>{main}<span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{numerator}／{denominator} {unit}{value.partial ? " · 已填點數比（有缺值）" : ""}</span></>
}
function Panel({ title, description, controls, children }: { title: ReactNode; description?: string; controls?: ReactNode; children: ReactNode }) {
  return <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>{controls && <div className="ml-auto min-w-0 max-w-full">{controls}</div>}</div>{description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}<div className="mt-4 min-w-0">{children}</div></section>
}
/** One segmented control; defaults to the SP／Actual SP／張數 unit set and can host any labelled choice set. */
function Units<V extends SegmentedValue = Unit>({ name, value, onChange, ratios = false, choices, labels, compact = false, disabled = false, groupLabel }: { name: string; value: V; onChange: (value: V) => void; ratios?: boolean; choices?: readonly V[]; labels?: Partial<Record<V, string>>; compact?: boolean; disabled?: boolean; groupLabel?: string }) {
  const items = (choices ?? ["sp", "actualSp", "count"] as unknown as readonly V[])
  const text = (item: V) => labels?.[item] ?? (ratios ? `${unitLabels[item as Unit]}比` : unitLabels[item as Unit])
  return <div role="group" aria-label={groupLabel ?? `${name}呈現單位`} aria-disabled={disabled || undefined} className={`${compact ? "" : "mb-4 "}flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-xs dark:bg-slate-800 ${disabled ? "opacity-60" : ""}`}>{items.map((item) => <button type="button" key={item} disabled={disabled} aria-label={labels?.[item]} aria-pressed={value === item} className="min-h-9 rounded-md px-3 py-1 font-medium focus-visible:outline-2 focus-visible:outline-blue-600 aria-pressed:bg-white aria-pressed:shadow-sm disabled:cursor-not-allowed dark:aria-pressed:bg-slate-700" onClick={() => onChange(item)}>{text(item)}</button>)}</div>
}

export function ProjectsAnalysisView({ result }: { result: ProjectsAnalysisResult }) {
  const topicId = useId()
  const [activeTopic, setActiveTopic] = useState<Topic>("output")
  const topicTabs = useRef<Partial<Record<Topic, HTMLButtonElement>>>({})
  const [detail, setDetail] = useState<{ id: number; metric: DetailMetric; label: string } | null>(null)
  const candidates = outputTeams.filter((team) => !result.request.groups.length || result.request.groups.includes(team.id))
  const [outputUnit, setOutputUnit] = useState<"sp" | "actualSp">("sp")
  const [unfinishedUnit, setUnfinishedUnit] = useState<"sp" | "count">("sp")
  const [includeUnfinishedQa, setIncludeUnfinishedQa] = useState(true)
  const [hideRequestInfoParent, setHideRequestInfoParent] = useState(false)
  // Like the other topics, seed the newest Sprint once; unit/filter changes must retain manual selection or dismissal.
  const [selectedUnfinishedSprint, setSelectedUnfinishedSprint] = useState<number | null>(() => newestSprintId(result.sprints))
  const [initialUnfinishedSprint] = useState(selectedUnfinishedSprint)
  const [visibleTeams, setVisibleTeams] = useState<string[]>(() => candidates.map((team) => team.id))
  // Members hidden from the single-team chart; empty means every member of that team is shown.
  const [hiddenMembers, setHiddenMembers] = useState<string[]>([])
  // Sprint rates: both aggregate curves for all teams, or one load / one completion curve per visible team.
  const [commitmentView, setCommitmentView] = useState<CommitmentView>("overview")
  // Sprint clicked in the 任務類型 chart; its own dev-type share donut renders below the chart.
  // Like 總產出, the newest Sprint starts selected; `initialTypesSprint` is set once so a cleared selection stays cleared.
  const [selectedTypesSprint, setSelectedTypesSprint] = useState<number | null>(() => newestSprintId(result.sprints))
  const [initialTypesSprint] = useState(selectedTypesSprint)
  // Same rule as the dev-status page: a Dev-Task whose parent is blocked counts as completed (ticked by default).
  const [countBlockedParent, setCountBlockedParent] = useState(true)
  // Sprint clicked in the 完成率 chart; its per-team bars render below the chart.
  // Same rule as 總產出: the newest Sprint starts selected, and clearing it stays cleared.
  const [selectedCommitmentSprint, setSelectedCommitmentSprint] = useState<number | null>(() => newestSprintId(result.sprints))
  const [initialCommitmentSprint] = useState(selectedCommitmentSprint)
  const [selectedEstimationSprint, setSelectedEstimationSprint] = useState<number | null>(() => newestSprintId(result.sprints))
  const [initialEstimationSprint] = useState(selectedEstimationSprint)
  // Teams switched off in the 完成率 legend. It keeps its own list: the chart only offers teams with a population,
  // so sharing the 總產出 team list would make hiding follow the wrong order and the button look like it vanished.
  const [hiddenCommitmentTeams, setHiddenCommitmentTeams] = useState<string[]>([])
  const toggleMember = (id: string) => { setHiddenMembers((previous) => previous.includes(id) ? previous.filter((member) => member !== id) : [...previous, id]); clearOutputDetail() }
  const [outputView, setOutputView] = useState<OutputView>("all-teams")
  const [includeQa, setIncludeQa] = useState(true)
  // Sprint picked in the 總產出 trend; the detail panel below the chart shows its team split and capacity realization.
  // A completed query opens with the newest Sprint already selected, so its detail panel is visible at once.
  // Selection is owned here; `initialSprintId` is set once so a cleared selection stays cleared.
  const [selectedOutputSprint, setSelectedOutputSprint] = useState<number | null>(() => newestSprintId(result.sprints))
  const [initialOutputSprint] = useState(selectedOutputSprint)
  const { groupStates } = useTeamMembers()
  const attribution = result.teamAttribution
  const hasAttribution = attribution?.status === "available"
  // Unchecked QA-Task filtering is display-only: it recomputes output cohorts locally and never rewrites the server summary.
  const outputFilter: ProjectsMetricFilter | undefined = includeQa ? undefined : { excludeQa: true }
  const unfinishedFilter: ProjectsMetricFilter = { excludeQa: !includeUnfinishedQa, excludeRequestInfoParent: hideRequestInfoParent }
  const clearOutputDetail = () => setDetail((previous) => previous && !Array.isArray(previous.metric) && (previous.metric as ProjectsMetric | OutputTeamMetric).kind === "output-teams" ? null : previous)
  const toggleTeam = (id: string) => {
    setVisibleTeams((previous) => previous.includes(id) ? previous.filter((team) => team !== id) : candidates.filter((team) => previous.includes(team.id) || team.id === id).map((team) => team.id))
    clearOutputDetail()
  }
  // Cache exact cohorts and their URLs within this render, never across result scopes.
  const cohorts = new Map<string, ProjectsAnalysisTask[]>()
  const links = new Map<string, { href: string | null; unavailable?: string }>()
  const issues = (id: number, metric: DetailMetric): ProjectsAnalysisTask[] => {
    const key = JSON.stringify([id, metric, includeQa, includeUnfinishedQa, hideRequestInfoParent])
    if (!cohorts.has(key)) {
      const sprint = result.sprints.find((item) => item.id === id)
      const metrics: readonly (ProjectsMetric | OutputTeamMetric)[] = Array.isArray(metric) ? metric : [metric as ProjectsMetric | OutputTeamMetric]
      const selected = sprint ? metrics.flatMap((item) => item.kind === "output-teams" ? selectProjectsOutputTeamIssues(result.tasks, sprint, attribution ?? { status: "unavailable", reason: "not_provided" }, item.teamIds, outputFilter) : selectProjectsMetricIssues(result.tasks, sprint, item, item.kind === "custom" ? outputFilter : item.kind === "unfinished" ? unfinishedFilter : undefined)) : []
      cohorts.set(key, [...new Map(selected.map((task) => [task.id, task])).values()])
    }
    return cohorts.get(key)!
  }
  const searchLink = (tasks: readonly ProjectsAnalysisTask[]): { href: string | null; unavailable?: string } => {
    if (!result.jiraBaseUrl || !tasks.length) return { href: null }
    const ids = tasks.map((task) => task.id), key = ids.join(",")
    if (!links.has(key)) {
      try {
        const jql = projectsAnalysisIssueIdsJql(ids)
        links.set(key, { href: jql ? jiraSearchHref(result.jiraBaseUrl, jql) : null })
      } catch (error) {
        if (!(error instanceof DashboardFilterError)) throw error
        links.set(key, { href: null, unavailable: "無法完整建立 Jira 查詢；請查看本站明細。" })
      }
    }
    return links.get(key)!
  }
  const valueLink = (value: number | null, display: ReactNode, tasks: readonly ProjectsAnalysisTask[], label: string): ReactNode => {
    if (value === null) return <span>{display}</span>
    const link = searchLink(tasks)
    return link.href ? <ExternalNumber href={link.href} label={label}>{display}</ExternalNumber> : <span title={link.unavailable}>{display}</span>
  }
  const metricValue = (id: number, metric: DetailMetric, label: string, value: number | null, display: ReactNode) => valueLink(value, display, issues(id, metric), `${result.sprints.find((s) => s.id === id)?.name} · ${label}`)
  const coverage = (id: number, metric: DetailMetric, label: string, value: PointTotal, unit: "sp" | "actualSp") => <Coverage value={value} renderValue={(amount, display, subset) => {
    const selected = issues(id, metric)
    const tasks = subset === "all" ? selected : selected.filter((task) => (task[pointFields[unit]] !== null) === (subset === "known"))
    return valueLink(amount, display, tasks, `${result.sprints.find((s) => s.id === id)?.name} · ${label} · ${subset === "all" ? "完整率母體" : subset === "known" ? "已填張數" : "未填張數"}`)
  }} />
  const show = (id: number, metric: DetailMetric, label: string) => setDetail({ id, metric, label })
  const button = (id: number, metric: DetailMetric, label: string, children: ReactNode = "本站明細") => <button type="button" className="min-h-9 rounded px-1 py-1 text-left text-xs underline decoration-slate-300 underline-offset-4 hover:decoration-slate-600 focus-visible:outline-2 focus-visible:outline-blue-600 dark:decoration-slate-600" aria-label={`${label}，查看工作單明細`} onClick={() => show(id, metric, label)}>{children}</button>
  const pointValue = (id: number, metric: DetailMetric, label: string, value: PointTotal) => metricValue(id, metric, label, value.sum, points(value))
  const countValue = (id: number, metric: DetailMetric, label: string, count: number) => metricValue(id, metric, label, count, `${number(count)} 張`)
  const sprint = detail ? result.sprints.find((item) => item.id === detail.id) : null
  const tasks = detail && sprint ? issues(sprint.id, detail.metric) : []
  const action = (id: number, metric: DetailMetric, label: string) => ({ label, onClick: () => show(id, metric, label) })
  // `paired` also carries the other point unit, so stacked bars can show Actual SP next to the Story Point estimate.
  const totalSeries = (id: string, label: string, color: string, select: (summary: ProjectsSprintSummary) => WorkTotals, unit: Unit, metric: DetailMetric, paired = false): TrendSeries => ({ id, label, color, values: result.summaries.map((summary) => {
    const total = select(summary), point = unit === "count" ? null : total[unit]
    return { value: unit === "count" ? total.count : point!.sum, points: paired ? total.sp.sum : undefined, actualPoints: paired ? total.actualSp.sum : undefined, display: unit === "count" ? number(total.count) : points(point!), readout: metricValue(summary.sprint.id, metric, `${label} ${unitLabels[unit]}`, unit === "count" ? total.count : point!.sum, unit === "count" ? number(total.count) : points(point!)), note: point ? coverage(summary.sprint.id, metric, `${label} ${unitLabels[unit]}`, point, unit as "sp" | "actualSp") : undefined, partial: point ? point.missingCount > 0 : false, actions: [action(summary.sprint.id, metric, `${label} ${unitLabels[unit]}，查看工作單明細`)] }
  }) })
  const estimationMetric: ProjectsMetric = { kind: "estimation-deviation" }
  const estimationRows = result.sprints.map((sprint) => ({ sprint, ...projectsEstimationDeviation(result.tasks, sprint) }))
  const estimationDisplay = (value: number | null) => value === null ? "—／不適用" : number(value)
  const estimationSeries: TrendSeries[] = [{ id: "estimation-deviation", label: "估點偏差率", color: "sp", values: estimationRows.map(({ sprint, value }) => ({ value, display: estimationDisplay(value), readout: metricValue(sprint.id, estimationMetric, "估點偏差率", value, estimationDisplay(value)), actions: [action(sprint.id, estimationMetric, "估點偏差率，查看工作單明細")] })) }]
  const ratioParts = (s: ProjectsSprintSummary, unit: Unit) => {
    const value = s.commitment
    const all: DetailMetric = { kind: "commitment-all" }, numerator: ProjectsMetric = { kind: "commitment-done" }, denominator: ProjectsMetric = { kind: "commitment-all" }
    const amount = (value: number | null) => value === null ? "未填" : number(value)
    return { value, main: metricValue(s.sprint.id, all, "負載率／完成率 · 全部 Dev-Task", value.value, percent(value)), numerator: metricValue(s.sprint.id, numerator, `負載率／完成率 分子 · ${unitLabels[unit]}`, value.numerator, amount(value.numerator)), denominator: metricValue(s.sprint.id, denominator, `負載率／完成率 分母 · ${unitLabels[unit]}`, value.denominator, amount(value.denominator)) }
  }
  const ratioView = (s: ProjectsSprintSummary, unit: Unit) => <Ratio {...ratioParts(s, unit)} unit={unitLabels[unit]} />
  const commitmentCoverage = (s: ProjectsSprintSummary) => <><span className="mt-1 block">分子完成 SP</span>{coverage(s.sprint.id, { kind: "commitment-done" }, "分子完成 SP", s.commitmentPoints.done, "sp")}<span className="block">分母全部 Dev-Task SP</span>{coverage(s.sprint.id, { kind: "commitment-all" }, "分母全部 Dev-Task SP", s.commitmentPoints.all, "sp")}</>
  const multi = result.sprints.length > 1
  const outputMetric = (teamIds: readonly string[]): OutputTeamMetric => ({ kind: "output-teams", teamIds })
  const teamTotals = (s: ProjectsSprintSummary, teamIds: readonly string[]) => projectsWorkTotals(issues(s.sprint.id, outputMetric(teamIds)))
  // Filter complete zero observations only; missing/partial points remain unknown, not zero.
  // Keep manual visibility preferences for every candidate so unit changes can restore eligibility.
  // QA filter is display-only: outputs are recomputed from the same filtered cohorts as their details and links.
  const outputTotal = (s: ProjectsSprintSummary) => projectsWorkTotals(issues(s.sprint.id, { kind: "custom" }))
  const scopeOutput = (s: ProjectsSprintSummary) => includeQa ? s.output : outputTotal(s)
  // A team is plotted only when it has nonzero output for the unit. The legend therefore reports eligible
  // teams as visible, so a hidden team is re-included when a filter (QA-Task, unit) makes it eligible again.
  const outputTeamSeries = hasAttribution ? candidates.map((team) => ({ ...totalSeries(team.id, team.label, team.color, (s) => teamTotals(s, [team.id]), outputUnit, outputMetric([team.id]), true), encoding: team.encoding })).filter((series) => !series.values.every((datum) => datum.value === 0 && !datum.partial)) : [totalSeries("scope-output", "全範圍總產出", "focus", scopeOutput, outputUnit, includeQa ? { kind: "output" } : { kind: "custom" })]
  // Placeholder capacity: members of each visible team × per-member points for this project (see lib/projects-capacity).
  const sprintDetailSprint = selectedOutputSprint === null ? null : result.sprints.find((sprint) => sprint.id === selectedOutputSprint) ?? null
  const memberCount = (teamId: string) => { const state = groupStates[teamId]; return state?.status === "success" ? state.members.length : 0 }
  // Story Points per visible team come from the chart's own team series, keeping QA filtering and attribution rules identical.
  const visibleCandidates = candidates.filter((team) => visibleTeams.includes(team.id))
  // Exactly one visible team: the output view and the Sprint panel both speak in terms of that team's members.
  const singleTeam = visibleCandidates.length === 1 ? visibleCandidates[0] : null
  const sprintIndex = sprintDetailSprint ? result.sprints.findIndex((sprint) => sprint.id === sprintDetailSprint.id) : -1
  const memberColors = ["sp", "actual", "type-2", "type-3", "type-4", "type-6"]
  // Member series for that single team: each member's completed SP per Sprint, with the same QA toggle as the chart.
  const memberSeries: TrendSeries[] = (() => {
    const roster = singleTeam ? groupStates[singleTeam.id] : undefined
    if (!singleTeam || roster?.status !== "success") return []
    const names = new Map(roster.members.map((member) => [member.accountId, member.displayName]))
    const cohortOf = (sprintId: number, accountId: string) => issues(sprintId, outputMetric([singleTeam.id])).filter((task) => (task.assigneeAccountId ?? "unassigned") === accountId)
    const accounts = [...new Set(result.sprints.flatMap((sprint) => issues(sprint.id, outputMetric([singleTeam.id])).map((task) => task.assigneeAccountId ?? "unassigned")))]
    const labelOf = (accountId: string) => names.get(accountId) ?? result.tasks.find((task) => task.assigneeAccountId === accountId)?.assigneeDisplayName ?? "未指派"
    // Members get their own colors from the token list so they stay distinguishable within one team's bars.
    return accounts.map((accountId, index) => {
      const values = result.summaries.map((summary) => {
        const totals = projectsWorkTotals(cohortOf(summary.sprint.id, accountId))
        const point = outputUnit === "sp" ? totals.sp : totals.actualSp
        return { value: point.sum, points: totals.sp.sum, actualPoints: totals.actualSp.sum, display: points(point), partial: point.missingCount > 0 }
      })
      return { id: `member:${accountId}`, label: labelOf(accountId), color: memberColors[index % memberColors.length], values }
    }).filter((series) => series.values.some((datum) => datum.points !== null))
  })()
  // One team in scope charts that team's members instead of the teams themselves.
  const outputSeries: TrendSeries[] = memberSeries.length ? memberSeries : outputTeamSeries
  const displayedTeams = memberSeries.length ? memberSeries.filter((series) => !hiddenMembers.includes(series.id)).map((series) => series.id) : outputSeries.filter((series) => visibleTeams.includes(series.id)).map((series) => series.id)
  const teamCapacityRows = teamCapacities(result.request.project, Object.fromEntries(candidates.map((team) => [team.id, memberCount(team.id)])))
  // Members of one team for this Sprint, newest-largest first; reused by the single-team view and by expanding a pie slice.
  const teamMembers = (teamId: string) => {
    const roster = groupStates[teamId]
    if (!sprintDetailSprint || roster?.status !== "success") return []
    const cohort = issues(sprintDetailSprint.id, outputMetric([teamId]))
    const byAccount = new Map<string, { name: string; sp: number; actualSp: number; tasks: ProjectsAnalysisTask[] }>()
    for (const task of cohort) {
      if (task.issueType === "QA-Task" && !includeQa) continue
      const accountId = task.assigneeAccountId ?? "unassigned"
      const entry = byAccount.get(accountId) ?? { name: task.assigneeDisplayName ?? "未指派", sp: 0, actualSp: 0, tasks: [] }
      entry.sp += task.points ?? 0
      entry.actualSp += task.actualPoints ?? 0
      entry.tasks.push(task)
      byAccount.set(accountId, entry)
    }
    const names = new Map(roster.members.map((member) => [member.accountId, member.displayName]))
    const capacity = memberCapacity(result.request.project)
    return [...byAccount.entries()]
      .sort((a, b) => b[1].sp - a[1].sp || a[1].name.localeCompare(b[1].name))
      .map(([accountId, entry], index) => ({ teamId: accountId, label: names.get(accountId) ?? entry.name, color: memberColors[index % memberColors.length], points: entry.sp, actualPoints: entry.actualSp, capacity, memberCount: 1, kind: "member" as const, href: searchLink(entry.tasks).href }))
  }
  // With exactly one team selected the panel compares that team's members instead of the teams.
  const memberBreakdown = () => visibleCandidates[0] ? teamMembers(visibleCandidates[0].id) : []
  const sprintBreakdown = sprintDetailSprint ? (singleTeam ? memberBreakdown() : sprintTeamBreakdown(visibleCandidates.map((team) => {
    const series = outputTeamSeries.find((entry) => entry.id === team.id)
    return { id: team.id, label: team.label, color: team.color, points: series?.values[sprintIndex]?.points ?? series?.values[sprintIndex]?.value ?? null }
  }), teamCapacityRows, (teamId) => outputTeams.find((team) => team.id === teamId)?.label ?? teamId).map((entry) => {
    // Without verified team attribution the cohort cannot be built; the row then simply has no Jira link.
    let tasks: ProjectsAnalysisTask[] = []
    try { tasks = issues(sprintDetailSprint.id, outputMetric([entry.teamId])) } catch (error) { if (!(error instanceof ProjectsAnalysisValidationError)) throw error }
    return { ...entry, href: searchLink(tasks).href, members: teamMembers(entry.teamId) }
  })) : []
  // Dev-type points split by team, for the share donuts. Tasks without attribution fall under 其他.
  const devTypeShares = (sprintIds: readonly number[]) => PROJECTS_DEV_TYPES.map((label) => {
    const byTeam = new Map<string, { key: string; label: string; points: number }>()
    let points = 0
    for (const sprintId of sprintIds) {
      for (const task of issues(sprintId, { kind: "type", value: label })) {
        if (task.points === null) continue
        const teamId = task.assigneeAccountId === null ? "other" : attribution?.status === "available" ? attribution.byAssignee.find((entry) => entry.accountId === task.assigneeAccountId)?.teamId ?? "other" : "other"
        const team = outputTeams.find((entry) => entry.id === teamId) ?? outputTeams[outputTeams.length - 1]
        const entry = byTeam.get(teamId) ?? { key: teamId, label: team.label, points: 0 }
        entry.points += task.points
        byTeam.set(teamId, entry)
        points += task.points
      }
    }
    return { label, points, teams: [...byTeam.values()].sort((a, b) => b.points - a.points || a.label.localeCompare(b.label)) }
  }).filter((share) => share.points > 0)
  const allSprintShares = devTypeShares(result.sprints.map((sprint) => sprint.id))
  const selectedTypeSprint = selectedTypesSprint === null ? null : result.sprints.find((sprint) => sprint.id === selectedTypesSprint) ?? null
  const selectedSprintShares = selectedTypeSprint ? devTypeShares([selectedTypeSprint.id]) : []
  const typeSeries = PROJECTS_DEV_TYPES.map((label, index) => totalSeries(label, label, `type-${index}`, (s) => s.devTypes.find((group) => group.label === label)!.totals, "sp", { kind: "type", value: label }))
  // Sprint completion: completed SP ÷ all SP of the Dev-Task population, with QA-Task included unless the
  // QA checkbox is off. 全團隊完成率 is one aggregate curve; 各團隊完成率 draws one curve per visible team.
  // A completion rate over a list of tasks, using the same window + blocked-parent rule as the team figures.
  const commitmentOf = (sprintId: number, tasks: readonly ProjectsAnalysisTask[]): ProjectsRatio => {
    const sprint = result.sprints.find((entry) => entry.id === sprintId)
    if (!sprint) return { numerator: null, denominator: null, value: null, partial: false }
    const all = filterProjectsMetricTasks(tasks, outputFilter)
    const done = all.filter((task) =>
      (task.resolvedDate !== null && task.resolvedDate >= sprint.startDate && task.resolvedDate <= sprint.endDate)
      || isBlockedParentStatus(task.parentStatus, countBlockedParent))
    return projectsRatio(projectsPointTotal(done, "points"), projectsPointTotal(all, "points"))
  }
  const commitmentRatioFor = (sprintId: number, teamIds: readonly string[] | null): ProjectsRatio => {
    const sprint = result.sprints.find((entry) => entry.id === sprintId)
    if (!sprint) return { numerator: null, denominator: null, value: null, partial: false }
    // Both modes use the completion population (all Dev-Task work, plus QA unless filtered) — never the output
    // cohort, which holds only finished work and would always read 100%.
    const population = teamIds
      ? selectProjectsTeamIssues(result.tasks, sprint, attribution ?? { status: "unavailable", reason: "not_provided" }, teamIds, { kind: "commitment-population" }, outputFilter)
      : selectProjectsMetricIssues(result.tasks, sprint, { kind: "commitment-population" }, outputFilter)
    const all = filterProjectsMetricTasks(population, outputFilter)
    // Completed strictly within the Sprint window, plus — when ticked — tasks whose parent is currently blocked.
    const done = all.filter((task) =>
      (task.resolvedDate !== null && task.resolvedDate >= sprint.startDate && task.resolvedDate <= sprint.endDate)
      || isBlockedParentStatus(task.parentStatus, countBlockedParent))
    return projectsRatio(projectsPointTotal(done, "points"), projectsPointTotal(all, "points"))
  }
  const commitmentDatum = (sprintId: number, teamIds: readonly string[] | null): TrendDatum => {
    const value = commitmentRatioFor(sprintId, teamIds)
    return { value: value.value, display: percent(value), readout: <>{percent(value)}</>, partial: value.partial, note: <><span>{number(value.numerator ?? 0)}／{number(value.denominator ?? 0)} SP（Sprint 期間完成{countBlockedParent ? "＋受阻母票" : ""}）{value.partial ? " · 已填點數比（有缺值）" : ""}</span></> }
  }
  // Each team with any population in the selected Sprints — assignees or the unassigned — gets its own curve,
  // ordered like the candidates. Unlike the output chart, a team is never dropped for having no finished work.
  const commitmentTeamIds = attribution?.status === "available"
    ? new Set(attribution.byAssignee.map((entry) => entry.teamId).concat(result.tasks.some((task) => task.assigneeAccountId === null) ? ["other"] : []))
    : new Set<string>()
  const commitmentTeams = outputTeams.filter((team) => commitmentTeamIds.has(team.id))
  const visibleCommitmentTeams = commitmentTeams.filter((team) => !hiddenCommitmentTeams.includes(team.id))
  // 負載率 = planned SP ÷ capacity, on the same population as 完成率. Only real roster data contributes capacity:
  // without a counted roster the point is unknown, never a fabricated zero.
  const loadRatio = (sprintId: number, teamIds: readonly string[] | null): ProjectsRatio => {
    const sprint = result.sprints.find((entry) => entry.id === sprintId)
    if (!sprint) return { numerator: null, denominator: null, value: null, partial: false }
    const population = teamIds
      ? selectProjectsTeamIssues(result.tasks, sprint, attribution ?? { status: "unavailable", reason: "not_provided" }, teamIds, { kind: "commitment-population" }, outputFilter)
      : selectProjectsMetricIssues(result.tasks, sprint, { kind: "commitment-population" }, outputFilter)
    const planned = projectsPointTotal(filterProjectsMetricTasks(population, outputFilter), "points")
    // Roster counts times the per-member points, over the teams in scope.
    const capacity = (teamIds ? candidates.filter((team) => teamIds.includes(team.id)) : commitmentTeamIds.size ? candidates : [])
      .reduce((sum, team) => sum + memberCount(team.id) * memberCapacity(result.request.project), 0)
    return projectsRatio(planned, { sum: capacity > 0 ? capacity : null, knownCount: capacity > 0 ? 1 : 0, missingCount: capacity > 0 ? 0 : 1 })
  }
  const loadDatum = (sprintId: number, teamIds: readonly string[] | null): TrendDatum => {
    const value = loadRatio(sprintId, teamIds)
    return { value: value.value, display: percent(value), readout: <>{percent(value)}</>, partial: value.partial, note: <span>{number(value.numerator ?? 0)}／{number(value.denominator ?? 0)} SP（計畫 ÷ Capacity）</span> }
  }
  const toggleCommitmentTeam = (id: string) => setHiddenCommitmentTeams((previous) => previous.includes(id) ? previous.filter((team) => team !== id) : [...previous, id])
  // Three views: both aggregate curves, 各團隊負載率, or 各團隊完成率. One team: the same three over its members.
  const commitmentByMember = singleTeam !== null
  const commitmentMemberSeries: { load: TrendSeries[]; completion: TrendSeries[] } = commitmentByMember ? (() => {
    const roster = groupStates[singleTeam.id]
    if (roster?.status !== "success") return { load: [], completion: [] }
    const names = new Map(roster.members.map((member) => [member.accountId, member.displayName]))
    // Only members who have any Dev-Task work in the selected Sprints can show a rate.
    const accounts = [...new Set(result.tasks
      .filter((task) => task.sprintIds.some((id) => result.sprints.some((sprint) => sprint.id === id)))
      .filter((task) => task.issueType !== "QA-Task" || includeQa)
      .map((task) => task.assigneeAccountId ?? "unassigned"))]
    // One set of member curves per view, each member's own load and completion rates.
    const seriesOf = (kind: "load" | "completion") => accounts.map((accountId, index) => {
      const values = result.sprints.map((sprint) => {
        const tasks = selectProjectsTeamIssues(result.tasks, sprint, attribution ?? { status: "unavailable", reason: "not_provided" }, [singleTeam.id], { kind: "commitment-population" }, outputFilter)
          .filter((task) => (task.assigneeAccountId ?? "unassigned") === accountId)
        const ratio = kind === "completion"
          ? commitmentOf(sprint.id, tasks)
          : projectsRatio(projectsPointTotal(filterProjectsMetricTasks(tasks, outputFilter), "points"), { sum: memberCapacity(result.request.project), knownCount: 1, missingCount: 0 })
        const note = kind === "completion" ? <span>{number(ratio.numerator ?? 0)}／{number(ratio.denominator ?? 0)} SP</span> : <span>{number(ratio.numerator ?? 0)}／{number(ratio.denominator ?? 0)} SP（計畫 ÷ Capacity）</span>
        return { value: ratio.value, display: percent(ratio), readout: <>{percent(ratio)}</>, partial: ratio.partial, note }
      })
      return { id: `commitment-member-${kind}-${accountId}`, label: names.get(accountId) ?? accountId, color: memberColors[index % memberColors.length], values }
    }).filter((series) => series.values.some((datum) => datum.value !== null || datum.partial))
    return { load: seriesOf("load"), completion: seriesOf("completion") }
  })() : { load: [], completion: [] }
  // Per-team rows for the clicked Sprint: planned SP (population), completed SP, capacity, and the resulting rate.
  const commitmentSprint = selectedCommitmentSprint === null ? null : result.sprints.find((sprint) => sprint.id === selectedCommitmentSprint) ?? null
  // One team in scope: the panel lists that team's members instead, each with their own planned/completed/capacity.
  // Per-team and per-member rows both need team attribution; without it the detail stays closed rather than
  // failing the render (the newest Sprint now opens this panel by default).
  const commitmentMemberRows: CommitmentTeamRow[] = commitmentSprint && singleTeam && hasAttribution ? (() => {
    const roster = groupStates[singleTeam.id]
    if (roster?.status !== "success") return []
    const names = new Map(roster.members.map((member) => [member.accountId, member.displayName]))
    const population = selectProjectsTeamIssues(result.tasks, commitmentSprint, attribution ?? { status: "unavailable", reason: "not_provided" }, [singleTeam.id], { kind: "commitment-population" }, outputFilter)
    const capacity = memberCapacity(result.request.project)
    const byAccount = new Map<string, ProjectsAnalysisTask[]>()
    for (const task of population) {
      const key = task.assigneeAccountId ?? "unassigned"
      byAccount.set(key, [...(byAccount.get(key) ?? []), task])
    }
    return [...byAccount.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([accountId, tasks], index) => {
        const ratio = commitmentOf(commitmentSprint.id, tasks)
        const done = tasks.filter((task) =>
          (task.resolvedDate !== null && task.resolvedDate >= commitmentSprint.startDate && task.resolvedDate <= commitmentSprint.endDate)
          || isBlockedParentStatus(task.parentStatus, countBlockedParent))
        return { teamId: accountId, label: names.get(accountId) ?? tasks.find((task) => task.assigneeDisplayName)?.assigneeDisplayName ?? "未指派", color: memberColors[index % memberColors.length], planned: ratio.denominator, completed: ratio.numerator, capacity, rate: ratio.value, plannedHref: searchLink(tasks).href, completedHref: searchLink(done).href }
      })
  })() : []
  const commitmentTeamRows: CommitmentTeamRow[] = commitmentSprint && !singleTeam && hasAttribution ? visibleCommitmentTeams.map((team) => {
    const population = selectProjectsTeamIssues(result.tasks, commitmentSprint, attribution ?? { status: "unavailable", reason: "not_provided" }, [team.id], { kind: "commitment-population" }, outputFilter)
    const ratio = commitmentOf(commitmentSprint.id, population)
    // Planned = the whole population; completed = the same window/blocked rule, so both link their exact issues.
    const done = population.filter((task) =>
      (task.resolvedDate !== null && task.resolvedDate >= commitmentSprint.startDate && task.resolvedDate <= commitmentSprint.endDate)
      || isBlockedParentStatus(task.parentStatus, countBlockedParent))
    return { teamId: team.id, label: team.label, color: team.color, planned: ratio.denominator, completed: ratio.numerator, capacity: teamCapacityRows.find((entry) => entry.teamId === team.id)?.capacity ?? null, rate: ratio.value, plannedHref: searchLink(population).href, completedHref: searchLink(done).href }
  }) : []
  // 全團隊負載率／完成率 plots both aggregate curves; the two 各團隊 views plot one rate per visible team.
  const aggregateLoad: TrendSeries = { id: "load", label: commitmentByMember ? "全成員負載率" : "全團隊負載率", color: "actual", values: result.sprints.map((sprint) => loadDatum(sprint.id, null)) }
  const aggregateCommitment: TrendSeries = { id: "commitment", label: commitmentByMember ? "全成員完成率" : "全團隊完成率", color: "sp", values: result.sprints.map((sprint) => commitmentDatum(sprint.id, null)) }
  const teamRateSeries = (kind: "load" | "completion"): TrendSeries[] => visibleCommitmentTeams
    .map((team) => ({ id: team.id, label: team.label, color: team.color, encoding: team.encoding, values: result.sprints.map((sprint) => kind === "load" ? loadDatum(sprint.id, [team.id]) : commitmentDatum(sprint.id, [team.id])) }))
    .filter((series) => !series.values.every((datum) => datum.value === null && !datum.partial))
  const commitmentSeries: TrendSeries[] = commitmentByMember
    ? commitmentView === "overview" ? [...commitmentMemberSeries.load, ...commitmentMemberSeries.completion] : commitmentMemberSeries[commitmentView === "team-load" ? "load" : "completion"]
    : commitmentView === "overview"
      ? [aggregateLoad, aggregateCommitment]
      : teamRateSeries(commitmentView === "team-load" ? "load" : "completion")
  // The legend offers every team with a population, hidden or not, so a hidden team's button stays to bring it
  // back. Values carry the same data as the plotted curve, so re-showing a team restores its line and labels.
  // A single-team scope charts members and has no team legend; 全團隊 plots its two fixed curves.
  const commitmentLegend: TrendSeries[] = commitmentView === "overview"
    ? []
    : commitmentByMember
      ? commitmentMemberSeries[commitmentView === "team-load" ? "load" : "completion"]
      : commitmentTeams.map((team) => ({ id: team.id, label: team.label, color: team.color, encoding: team.encoding, values: result.sprints.map((sprint) => commitmentView === "team-load" ? loadDatum(sprint.id, [team.id]) : commitmentDatum(sprint.id, [team.id])) }))
  const unfinishedTotal = (summary: ProjectsSprintSummary) => projectsWorkTotals(issues(summary.sprint.id, { kind: "unfinished" }))
  const unfinishedSprint = selectedUnfinishedSprint === null ? null : result.sprints.find((sprint) => sprint.id === selectedUnfinishedSprint) ?? null
  const unfinishedTasks = unfinishedSprint ? issues(unfinishedSprint.id, { kind: "unfinished" }) : (() => {
    const ids = new Set(result.sprints.flatMap((sprint) => issues(sprint.id, { kind: "unfinished" }).map((task) => task.id)))
    // A shared parent can put one issue in several Sprints; the aggregate lists it once, in original order.
    return result.tasks.filter((task) => ids.has(task.id))
  })()
  const first = result.summaries[0]
  const hasUnavailableSearch = result.sprints.some((s) => searchLink(issues(s.id, { kind: "population" })).unavailable)
  const issuePoint = (task: ProjectsAnalysisTask, unit: "sp" | "actualSp") => {
    const value = task[pointFields[unit]], display = value === null ? "—／未填" : number(value)
    return value !== null && result.jiraBaseUrl ? <ExternalNumber href={jiraIssueHref(result.jiraBaseUrl, task.key)} label={`${task.key} · ${unitLabels[unit]}`}>{display}</ExternalNumber> : <span>{display}</span>
  }
  const summaryTiles = multi ? [] : (() => {
    const s = first, id = s.sprint.id, unfinished = unfinishedTotal(s), estimation = estimationRows[0]
    return [
      { topic: "output", label: "全範圍總產出", metric: (includeQa ? { kind: "output" } : { kind: "custom" }) as DetailMetric, value: <>{pointValue(id, includeQa ? { kind: "output" } : { kind: "custom" }, `全範圍總產出 ${unitLabels[outputUnit]}`, scopeOutput(s)[outputUnit])} {unitLabels[outputUnit]}</>, extra: countValue(id, includeQa ? { kind: "output" } : { kind: "custom" }, "全範圍完成張數", scopeOutput(s).count) },
      { topic: "types", label: "完成任務類型", metric: { kind: "output" } as DetailMetric, value: countValue(id, { kind: "output" }, "完成的任務類型張數", s.output.count), extra: "六類 Dev Type＋未分類，詳見下方" },
      { topic: "commitment", label: "負載率／完成率", metric: { kind: "commitment-all" } as DetailMetric, value: ratioView(s, "sp"), extra: "分子當期完成／分母全部 Dev-Task" },
      { topic: "estimation-deviation", label: "估點偏差率", metric: estimationMetric as DetailMetric, value: <>{metricValue(id, estimationMetric, "估點偏差率", estimation.value, estimationDisplay(estimation.value))}{estimation.value !== null && " SP"}</>, extra: `${number(estimation.totals.count)} 張已完成且雙欄已填的 Dev-Task` },
      { topic: "unfinished", label: "目前未完成", metric: { kind: "unfinished" } as DetailMetric, value: countValue(id, { kind: "unfinished" }, "目前未完成張數", unfinished.count), extra: <>{pointValue(id, { kind: "unfinished" }, "目前未完成 SP", unfinished.sp)} SP · Resolved 空白</> },
    ]
  })()
  function selectTopic(next: Topic, trigger?: HTMLButtonElement) {
    if (next !== activeTopic) { setActiveTopic(next); setDetail(null) }
    trigger?.focus()
    trigger?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }
  function onTopicKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % topics.length
      : event.key === "ArrowLeft" ? (index + topics.length - 1) % topics.length
      : event.key === "Home" ? 0 : event.key === "End" ? topics.length - 1 : null
    if (next === null) return
    event.preventDefault()
    selectTopic(topics[next].id, topicTabs.current[topics[next].id])
  }
  const topicPanel = (topic: Topic, children: ReactNode) => {
    const tile = summaryTiles.find((item) => item.topic === topic)
    return <div key={topic} id={`${topicId}-${topic}-panel`} role="tabpanel" aria-labelledby={`${topicId}-${topic}-tab`} hidden={activeTopic !== topic} tabIndex={activeTopic === topic ? 0 : -1} data-topic={topic} className="projects-topic-panel min-w-0 space-y-4 rounded-xl focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-4">
      {tile && <article data-summary-tile className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><h3 className="text-sm text-slate-500 dark:text-slate-400">{tile.label}</h3><div className="mt-2 break-words text-2xl font-semibold">{tile.value}</div><div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{tile.extra}</div>{button(first.sprint.id, tile.metric, tile.label)}</article>}
      {children}
    </div>
  }
  return <div className="projects-analysis min-w-0 space-y-6 text-slate-900 dark:text-slate-100">
    {hasUnavailableSearch && <p role="note" className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">部分工作單清單無法完整建立 Jira 查詢；請使用「本站明細」。不會縮減清單或改查更大範圍。</p>}
    {result.tasks.length === 0 && <p role="status" className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">此範圍沒有 Dev-Task／QA-Task 工作單；空母體點數為 0，比率不適用。</p>}
    {!multi && <p className="text-sm text-slate-500 dark:text-slate-400">目前選擇一個 Sprint；選擇至少兩個 Sprint 可比較趨勢。</p>}
    <div role="tablist" aria-label="專案回顧分析主題" className="projects-topic-tabs flex min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {topics.map((topic, index) => <button key={topic.id} type="button" role="tab" id={`${topicId}-${topic.id}-tab`} aria-controls={`${topicId}-${topic.id}-panel`} aria-selected={activeTopic === topic.id} tabIndex={activeTopic === topic.id ? 0 : -1} ref={(element) => { if (element) topicTabs.current[topic.id] = element; else delete topicTabs.current[topic.id] }} onClick={(event) => selectTopic(topic.id, event.currentTarget)} onKeyDown={(event) => onTopicKeyDown(event, index)} className="min-h-11 shrink-0 rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-[-2px] aria-selected:bg-white aria-selected:text-slate-900 aria-selected:shadow-sm dark:text-slate-400 dark:hover:text-slate-100 dark:aria-selected:bg-slate-700 dark:aria-selected:text-slate-100">{topic.label}</button>)}
    </div>
    <div className="min-w-0">
    {topicPanel("output", <Panel title={multi ? "總產出趨勢" : "Sprint 總產出"} controls={<div className="projects-output-controls flex max-w-full flex-wrap items-center justify-end gap-3">{/* 全團隊總覽 always charts both units (two bars, two curves), so the unit switch only applies to 各團隊產出. */}{outputView === "by-team" || !hasAttribution ? <Units<Unit> name="總產出" value={outputUnit} onChange={(unit) => { if (unit !== "count" && unit !== outputUnit) { setOutputUnit(unit); clearOutputDetail() } }} choices={["sp", "actualSp"]} labels={outputUnitLabels} compact /> : null}<Units name="總產出顯示" value={outputView} onChange={(view) => { if (view !== outputView) { setOutputView(view); clearOutputDetail() } }} choices={["all-teams", "by-team"] as const} labels={singleTeam ? outputMemberViewLabels : outputViewLabels} disabled={!hasAttribution} compact /><label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={includeQa} onChange={(event) => { setIncludeQa(event.target.checked); clearOutputDetail() }} className="h-4 w-4 accent-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600" />含 QA-Task</label></div>}>
      {!hasAttribution && <p role="status" className="mb-3 text-sm text-slate-500 dark:text-slate-400">團隊歸屬資料無法取得；目前顯示全範圍總產出。</p>}
      <ProjectsTrendChart id="output" sprints={result.sprints} series={outputSeries} unit={unitLabels[outputUnit]} formatTick={number} stackedTotalId={hasAttribution && outputView === "all-teams" ? OVERVIEW_STACK : undefined} legendToggle={hasAttribution ? { visibleIds: displayedTeams, onToggle: memberSeries.length ? toggleMember : toggleTeam } : undefined} emptyMessage={hasAttribution && !outputSeries.length ? "所選 Sprint 的團隊點數皆為 0。" : undefined} onSprintSelect={(index) => setSelectedOutputSprint(index === null ? null : result.sprints[index]?.id ?? null)} initialSprintId={initialOutputSprint} labelPointValues={outputView === "all-teams" || !hasAttribution} />
      {sprintDetailSprint && <ProjectsSprintDetail sprint={sprintDetailSprint} teams={sprintBreakdown} />}
    </Panel>)}
    {topicPanel("commitment", <Panel title="負載率／完成率" controls={<div className="projects-output-controls flex max-w-full flex-wrap items-center justify-end gap-3">{/* Three views: both aggregate curves, then one of the two rates per team (per member for a single team). */}<Units name="比率範圍" value={commitmentView} onChange={(view) => { if (view !== commitmentView) setCommitmentView(view) }} choices={commitmentViewChoices} labels={commitmentByMember ? commitmentMemberViewLabels : commitmentViewLabels} disabled={!hasAttribution} compact /><label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={includeQa} onChange={(event) => setIncludeQa(event.target.checked)} className="h-4 w-4 accent-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600" />含 QA-Task</label><label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={countBlockedParent} onChange={(event) => setCountBlockedParent(event.target.checked)} className="h-4 w-4 accent-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600" />受阻母票計為已完成</label></div>}>
        {commitmentByMember
          ? <ProjectsTrendChart id="commitment" sprints={result.sprints} series={commitmentSeries} unit="%" formatTick={percentTick} emptyMessage={commitmentSeries.length ? undefined : "此團隊在此 Sprint 沒有可計算比率的工作單。"} onSprintSelect={(index) => setSelectedCommitmentSprint(index === null ? null : result.sprints[index]?.id ?? null)} initialSprintId={initialCommitmentSprint} labelPointValues={commitmentView === "overview"} />
          : (multi || commitmentView !== "overview")
            ? <ProjectsTrendChart id="commitment" sprints={result.sprints} series={commitmentSeries} unit="%" formatTick={percentTick} legendToggle={commitmentView === "overview" ? undefined : { visibleIds: visibleCommitmentTeams.map((team) => team.id), onToggle: toggleCommitmentTeam }} legendSeries={commitmentView === "overview" ? undefined : commitmentLegend} emptyMessage={commitmentView !== "overview" && !commitmentSeries.length ? "沒有可見團隊。" : undefined} onSprintSelect={(index) => setSelectedCommitmentSprint(index === null ? null : result.sprints[index]?.id ?? null)} initialSprintId={initialCommitmentSprint} labelPointValues={commitmentView === "overview"} />
            : <p className="text-sm">{percent(commitmentRatioFor(first.sprint.id, null))}（{number(commitmentRatioFor(first.sprint.id, null).numerator ?? 0)}／{number(commitmentRatioFor(first.sprint.id, null).denominator ?? 0)} SP）</p>}
      {commitmentSprint && <ProjectsCommitmentDetail sprint={commitmentSprint} teams={singleTeam ? commitmentMemberRows : commitmentTeamRows} kind={singleTeam ? "member" : "team"} />}
    </Panel>)}
    {topicPanel("estimation-deviation", <Panel title="估點偏差率" description="依公式 SP − Actual SP 加總點數差，不是百分比。僅計算完成日期在該 Sprint 內、SP 與 Actual SP 都已填的 Dev-Task；正值表示高估、負值表示低估。">
      <ProjectsTrendChart id="estimation-deviation" sprints={result.sprints} series={estimationSeries} unit="SP" signed formatTick={number} onSprintSelect={(index) => setSelectedEstimationSprint(index === null ? null : result.sprints[index]?.id ?? null)} initialSprintId={initialEstimationSprint} labelPointValues />
      {estimationRows.every((row) => row.totals.count === 0) && <p role="status" className="mt-3 text-sm text-slate-500 dark:text-slate-400">所選 Sprint 沒有符合計算條件的工作單。</p>}
      <div className="mt-4 min-w-0 overflow-x-auto"><table>
        <caption className="sr-only">估點偏差率計算核對</caption>
        <thead><tr><th>Sprint</th><th>符合條件張數</th><th>SP</th><th>Actual SP</th><th>SP − Actual SP</th><th>明細</th></tr></thead>
        <tbody>{estimationRows.map(({ sprint, value, totals }) => <tr key={sprint.id} aria-current={selectedEstimationSprint === sprint.id ? "true" : undefined} className={selectedEstimationSprint === sprint.id ? "bg-slate-50 dark:bg-slate-800" : undefined}>
          <th scope="row">{sprint.name}</th>
          <td>{countValue(sprint.id, estimationMetric, "估點偏差率符合條件張數", totals.count)}</td>
          <td>{pointValue(sprint.id, estimationMetric, "估點偏差率 SP", totals.sp)}</td>
          <td>{pointValue(sprint.id, estimationMetric, "估點偏差率 Actual SP", totals.actualSp)}</td>
          <td>{metricValue(sprint.id, estimationMetric, "估點偏差率", value, estimationDisplay(value))}</td>
          <td>{button(sprint.id, estimationMetric, "估點偏差率")}</td>
        </tr>)}</tbody>
      </table></div>
    </Panel>)}
    {topicPanel("types", <Panel title="完成任務類型">
      {/* The trend sits on top; the two donuts share the row beneath it — all-Sprint summary left, the clicked
          Sprint's own split right (it appears once a Sprint is clicked). */}
      <ProjectsTrendChart key="types-sp" id="types" sprints={result.sprints} series={typeSeries} unit={unitLabels.sp} formatTick={number} distribution={!multi} focusableLegend
        onSprintSelect={(index) => setSelectedTypesSprint(index === null ? null : result.sprints[index]?.id ?? null)} initialSprintId={initialTypesSprint} />
      {(multi || selectedTypeSprint) && <div className="mt-4 grid min-w-0 items-start gap-4 lg:grid-cols-2">
        {multi && <ProjectsDevTypePie shares={allSprintShares} title={`${result.sprints.length} 個 Sprint 加總類型佔比`} legend="right" />}
        {selectedTypeSprint && <ProjectsDevTypePie shares={selectedSprintShares} title={`${selectedTypeSprint.name} 類型佔比`} legend="right" />}
      </div>}
    </Panel>)}
    {topicPanel("unfinished", <Panel title="目前未完成" description="依 Sprint 母票歸屬，只看現行 Resolved 空白的工作單，不以狀態判完成。切換 SP／張數，點選 Sprint 查看未完成清單。" controls={<div className="projects-output-controls flex max-w-full flex-wrap items-center justify-end gap-3"><Units<"sp" | "count"> name="目前未完成" value={unfinishedUnit} onChange={setUnfinishedUnit} choices={["sp", "count"]} labels={unitLabels} compact /><label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={includeUnfinishedQa} onChange={(event) => setIncludeUnfinishedQa(event.target.checked)} className="h-4 w-4 accent-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600" />含 QA-Task</label><label title="只隱藏母票狀態為 Request Info 的工作單" className="flex min-h-11 cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={hideRequestInfoParent} onChange={(event) => setHideRequestInfoParent(event.target.checked)} className="h-4 w-4 accent-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600" />隱藏受阻母票</label></div>}>
      <ProjectsTrendChart id="unfinished" sprints={result.sprints} series={[totalSeries("unfinished", unfinishedUnit === "sp" ? "未完成 SP" : "未完成張數", "sp", unfinishedTotal, unfinishedUnit, { kind: "unfinished" })]} unit={unitLabels[unfinishedUnit]} formatTick={number} integer={unfinishedUnit === "count"} initialSprintId={initialUnfinishedSprint} onSprintSelect={(index) => setSelectedUnfinishedSprint(index === null ? null : result.sprints[index]?.id ?? null)} labelPointValues />
      <ProjectsUnfinishedDetail sprint={unfinishedSprint} tasks={unfinishedTasks} jiraBaseUrl={result.jiraBaseUrl} renderPoint={(task) => issuePoint(task, "sp")} />
    </Panel>)}
    </div>
    {detail && sprint && <Panel title={<>{sprint.name} · {detail.label} · {valueLink(tasks.length, number(tasks.length), tasks, `${sprint.name} · ${detail.label} 明細張數`)} 張工作單</>} description="本次完整查詢資料的唯讀明細，不會另查 Jira。">
      <button type="button" className="mb-3 min-h-9 rounded px-3 text-sm underline focus-visible:outline-2" onClick={() => setDetail(null)}>收合明細</button>
      <div className="grid gap-3 md:hidden">{tasks.map((task) => <article key={task.id} className="min-w-0 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"><p className="font-medium">{result.jiraBaseUrl ? <TicketLink task={task} jiraBaseUrl={result.jiraBaseUrl} /> : task.key} · {task.issueType}</p><p className="mt-1 break-words">{task.summary}</p><p className="mt-2 text-xs">{task.projectKey} · {task.devType ?? "未分類"} · {task.assigneeDisplayName ?? "未指派"}</p><p className="mt-1 text-xs">SP {issuePoint(task, "sp")} · Actual SP {issuePoint(task, "actualSp")} · Resolved {task.resolvedDate ?? "未完成"}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">母票 {task.parentKey}</p></article>)}</div>
      <div className="hidden overflow-x-auto md:block"><table><caption className="sr-only">{detail.label} 工作單明細</caption><thead><tr><th>Issue</th><th>摘要／母票</th><th>Project</th><th>Issue Type／Dev Type</th><th>SP</th><th>Actual SP</th><th>Resolved</th><th>負責人</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td>{result.jiraBaseUrl ? <TicketLink task={task} jiraBaseUrl={result.jiraBaseUrl} /> : task.key}</td><td className="max-w-md whitespace-normal break-words">{task.summary}<span className="block text-xs text-slate-500 dark:text-slate-400">母票 {task.parentKey}</span></td><td>{task.projectKey}</td><td>{task.issueType}<span className="block text-xs">{task.devType ?? "未分類"}</span></td><td>{issuePoint(task, "sp")}</td><td>{issuePoint(task, "actualSp")}</td><td>{task.resolvedDate ?? "未完成"}</td><td>{task.assigneeDisplayName ?? "未指派"}</td></tr>)}</tbody></table></div>
      {tasks.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">此指標沒有工作單。</p>}
    </Panel>}
  </div>
}

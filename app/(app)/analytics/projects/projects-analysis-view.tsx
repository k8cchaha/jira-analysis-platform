"use client"

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { TicketLink } from "@/components/ticket-link"
import { projectsAnalysisIssueIdsJql } from "@/lib/jira-jql"
import { DASHBOARD_TEAMS, DashboardFilterError } from "@/lib/jira-dashboard-filter"
import { jiraIssueHref, jiraSearchHref } from "@/lib/jira-url"
import { PROJECTS_DEV_TYPES, projectsWorkTotals, selectProjectsMetricIssues, selectProjectsOutputTeamIssues, type PointTotal, type ProjectsAnalysisResult, type ProjectsAnalysisTask, type ProjectsMetric, type ProjectsRatio, type ProjectsSprintSummary, type WorkTotals } from "@/lib/projects-analysis"
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
  { id: "output", label: "總輸出" },
  { id: "types", label: "完成的任務類型" },
  { id: "commitment", label: "Sprint 完成率" },
  { id: "quality", label: "開發品質" },
  { id: "pressure", label: "開發壓力" },
  { id: "unfinished", label: "目前未完成" },
] as const
type Topic = typeof topics[number]["id"]
const unitLabels: Record<Unit, string> = { sp: "SP", actualSp: "Actual SP", count: "張數" }
const pointFields = { sp: "points", actualSp: "actualPoints" } as const
const qualityMetrics: readonly ProjectsMetric[] = [{ kind: "type", value: "Bug" }, { kind: "type", value: "Dev" }]
const number = (value: number) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2, ...(value > 0 && (value < .01 || value >= 1e12) ? { notation: "scientific" as const } : value >= 10_000 ? { notation: "compact" as const } : {}) }).format(value)
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
function DataTable({ children, label = "查看數據表" }: { children: ReactNode; label?: string }) {
  return <details className="projects-data-table mt-5 border-t border-slate-200 pt-3 dark:border-slate-700"><summary className="min-h-9 cursor-pointer text-sm font-medium text-slate-600 focus-visible:outline-2 dark:text-slate-300">{label}</summary><div className="mt-3 overflow-x-auto">{children}</div></details>
}
function Units({ name, value, onChange, ratios = false, choices = ["sp", "actualSp", "count"], labels, compact = false }: { name: string; value: Unit; onChange: (value: Unit) => void; ratios?: boolean; choices?: readonly Unit[]; labels?: Partial<Record<Unit, string>>; compact?: boolean }) {
  return <div role="group" aria-label={`${name}呈現單位`} className={`${compact ? "" : "mb-4 "}flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-xs dark:bg-slate-800`}>{choices.map((unit) => <button type="button" key={unit} aria-label={labels?.[unit]} aria-pressed={value === unit} className="min-h-9 rounded-md px-3 py-1 font-medium focus-visible:outline-2 focus-visible:outline-blue-600 aria-pressed:bg-white aria-pressed:shadow-sm dark:aria-pressed:bg-slate-700" onClick={() => onChange(unit)}>{unitLabels[unit]}{ratios ? "比" : ""}</button>)}</div>
}

export function ProjectsAnalysisView({ result }: { result: ProjectsAnalysisResult }) {
  const topicId = useId()
  const [activeTopic, setActiveTopic] = useState<Topic>("output")
  const topicTabs = useRef<Partial<Record<Topic, HTMLButtonElement>>>({})
  const [detail, setDetail] = useState<{ id: number; metric: DetailMetric; label: string } | null>(null)
  const [typeUnit, setTypeUnit] = useState<Unit>("sp")
  const [qualityUnit, setQualityUnit] = useState<Unit>("count")
  const candidates = outputTeams.filter((team) => !result.request.groups.length || result.request.groups.includes(team.id))
  const [outputUnit, setOutputUnit] = useState<"sp" | "actualSp">("sp")
  const [visibleTeams, setVisibleTeams] = useState<string[]>(() => candidates.map((team) => team.id))
  const [showTotal, setShowTotal] = useState(false)
  const attribution = result.teamAttribution
  const hasAttribution = attribution?.status === "available"
  const clearOutputDetail = () => setDetail((previous) => previous && !Array.isArray(previous.metric) && (previous.metric as ProjectsMetric | OutputTeamMetric).kind === "output-teams" ? null : previous)
  const toggleTeam = (id: string) => {
    setVisibleTeams((previous) => previous.includes(id) ? previous.filter((team) => team !== id) : candidates.filter((team) => previous.includes(team.id) || team.id === id).map((team) => team.id))
    clearOutputDetail()
  }
  // Cache exact cohorts and their URLs within this render, never across result scopes.
  const cohorts = new Map<string, ProjectsAnalysisTask[]>()
  const links = new Map<string, { href: string | null; unavailable?: string }>()
  const issues = (id: number, metric: DetailMetric): ProjectsAnalysisTask[] => {
    const key = JSON.stringify([id, metric])
    if (!cohorts.has(key)) {
      const sprint = result.sprints.find((item) => item.id === id)
      const metrics: readonly (ProjectsMetric | OutputTeamMetric)[] = Array.isArray(metric) ? metric : [metric as ProjectsMetric | OutputTeamMetric]
      const selected = sprint ? metrics.flatMap((item) => item.kind === "output-teams" ? selectProjectsOutputTeamIssues(result.tasks, sprint, attribution ?? { status: "unavailable", reason: "not_provided" }, item.teamIds) : selectProjectsMetricIssues(result.tasks, sprint, item)) : []
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
  const pointCell = (id: number, metric: DetailMetric, label: string, value: PointTotal, unit: "sp" | "actualSp" = "sp") => <>{pointValue(id, metric, label, value)}{coverage(id, metric, label, value, unit)}{button(id, metric, label)}</>
  const countCell = (id: number, metric: DetailMetric, label: string, count: number) => <>{countValue(id, metric, label, count)}<span className="block">{button(id, metric, label)}</span></>
  const sprint = detail ? result.sprints.find((item) => item.id === detail.id) : null
  const tasks = detail && sprint ? issues(sprint.id, detail.metric) : []
  const totalsCells = (id: number, metric: DetailMetric, label: string, value: WorkTotals) => <><td>{pointCell(id, metric, `${label} SP`, value.sp)}</td><td>{pointCell(id, metric, `${label} Actual SP`, value.actualSp, "actualSp")}</td><td>{countCell(id, metric, `${label} 張數`, value.count)}</td></>
  const action = (id: number, metric: DetailMetric, label: string) => ({ label, onClick: () => show(id, metric, label) })
  const totalSeries = (id: string, label: string, color: string, select: (summary: ProjectsSprintSummary) => WorkTotals, unit: Unit, metric: DetailMetric): TrendSeries => ({ id, label, color, values: result.summaries.map((summary) => {
    const total = select(summary), point = unit === "count" ? null : total[unit]
    return { value: unit === "count" ? total.count : point!.sum, display: unit === "count" ? number(total.count) : points(point!), readout: metricValue(summary.sprint.id, metric, `${label} ${unitLabels[unit]}`, unit === "count" ? total.count : point!.sum, unit === "count" ? number(total.count) : points(point!)), note: point ? coverage(summary.sprint.id, metric, `${label} ${unitLabels[unit]}`, point, unit as "sp" | "actualSp") : undefined, partial: point ? point.missingCount > 0 : false, actions: [action(summary.sprint.id, metric, `${label} ${unitLabels[unit]}，查看工作單明細`)] }
  }) })
  const ratioParts = (s: ProjectsSprintSummary, kind: "commitment" | "quality", unit: Unit) => {
    const commitment = kind === "commitment", value = commitment ? s.commitment : s.quality[unit]
    const all: DetailMetric = commitment ? { kind: "commitment-all" } : qualityMetrics
    const numerator: ProjectsMetric = commitment ? { kind: "commitment-done" } : qualityMetrics[0]
    const denominator: ProjectsMetric = commitment ? { kind: "commitment-all" } : qualityMetrics[1]
    const label = commitment ? "Sprint 完成率" : "Bug／Dev"
    const amount = (value: number | null) => value === null ? "未填" : number(value)
    return { value, main: metricValue(s.sprint.id, all, `${label} · ${commitment ? "全部 Dev-Task" : "Bug＋Dev 比較母體"}`, value.value, percent(value)), numerator: metricValue(s.sprint.id, numerator, `${label} 分子 · ${unitLabels[unit]}`, value.numerator, amount(value.numerator)), denominator: metricValue(s.sprint.id, denominator, `${label} 分母 · ${unitLabels[unit]}`, value.denominator, amount(value.denominator)) }
  }
  const ratioView = (s: ProjectsSprintSummary, kind: "commitment" | "quality", unit: Unit) => <Ratio {...ratioParts(s, kind, unit)} unit={unitLabels[unit]} />
  const commitmentCoverage = (s: ProjectsSprintSummary) => <><span className="mt-1 block">分子完成 SP</span>{coverage(s.sprint.id, { kind: "commitment-done" }, "分子完成 SP", s.commitmentPoints.done, "sp")}<span className="block">分母全部 Dev-Task SP</span>{coverage(s.sprint.id, { kind: "commitment-all" }, "分母全部 Dev-Task SP", s.commitmentPoints.all, "sp")}</>
  const ratioDatum = (s: ProjectsSprintSummary, kind: "commitment" | "quality", unit: Unit): TrendDatum => {
    const parts = ratioParts(s, kind, unit)
    return { value: parts.value.value, display: percent(parts.value), readout: parts.main, partial: parts.value.partial, note: <><span>{parts.numerator}／{parts.denominator} {unitLabels[unit]}{parts.value.partial ? " · 已填點數比（有缺值）" : ""}</span>{kind === "commitment" && commitmentCoverage(s)}</>, actions: kind === "commitment" ? [action(s.sprint.id, { kind: "commitment-done" }, "Sprint 完成率 分子 · 完成明細"), action(s.sprint.id, { kind: "commitment-all" }, "Sprint 完成率 分母 · 全部明細")] : [action(s.sprint.id, qualityMetrics[0], "Bug 明細"), action(s.sprint.id, qualityMetrics[1], "Dev 明細")] }
  }
  const multi = result.sprints.length > 1
  const outputMetric = (teamIds: readonly string[]): OutputTeamMetric => ({ kind: "output-teams", teamIds })
  const teamTotals = (s: ProjectsSprintSummary, teamIds: readonly string[]) => projectsWorkTotals(issues(s.sprint.id, outputMetric(teamIds)))
  // Filter complete zero observations only; missing/partial points remain unknown, not zero.
  // Keep manual visibility preferences for every candidate so unit changes can restore eligibility.
  const outputSeries: TrendSeries[] = hasAttribution ? candidates.map((team) => ({ ...totalSeries(team.id, team.label, team.color, (s) => teamTotals(s, [team.id]), outputUnit, outputMetric([team.id])), encoding: team.encoding })).filter((series) => !series.values.every((datum) => datum.value === 0 && !datum.partial)) : [totalSeries("scope-output", "全範圍總輸出", "focus", (s) => s.output, outputUnit, { kind: "output" })]
  const displayedTeams = outputSeries.filter((series) => visibleTeams.includes(series.id)).map((series) => series.id)
  if (hasAttribution && showTotal && displayedTeams.length) outputSeries.push({ ...totalSeries("visible-total", "顯示團隊合計", "focus", (s) => teamTotals(s, displayedTeams), outputUnit, outputMetric(displayedTeams)), encoding: { shape: 0, dash: "2 4" }, toggleable: false })
  const typeSeries = PROJECTS_DEV_TYPES.map((label, index) => totalSeries(label, label, `type-${index}`, (s) => s.devTypes.find((group) => group.label === label)!.totals, typeUnit, { kind: "type", value: label }))
  const commitmentSeries: TrendSeries[] = [{ id: "commitment", label: "Sprint 完成率", color: "sp", values: result.summaries.map((s) => ratioDatum(s, "commitment", "sp")) }]
  const qualitySeries: TrendSeries[] = [{ id: "quality", label: `Bug／Dev · ${unitLabels[qualityUnit]}比`, color: "actual", values: result.summaries.map((s) => ratioDatum(s, "quality", qualityUnit)) }]
  const pressureSeries = [totalSeries("TKK", "TKK", "sp", (s) => s.pressure.TKK, "sp", { kind: "pressure", value: "TKK" }), totalSeries("SUN", "SUN", "actual", (s) => s.pressure.SUN, "sp", { kind: "pressure", value: "SUN" })]
  pressureSeries[1].values.forEach((datum, index) => { const s = result.summaries[index]; datum.note = <>{datum.note}<span className="mt-1 block">TKK＋SUN：{pointValue(s.sprint.id, { kind: "pressure" }, "TKK＋SUN SP", s.pressure.combined.sp)} SP</span>{coverage(s.sprint.id, { kind: "pressure" }, "TKK＋SUN SP", s.pressure.combined.sp, "sp")}</> })
  const trend = (id: string, series: TrendSeries[], unit: string, integer = false) => <ProjectsTrendChart id={id} sprints={result.sprints} series={series} unit={unit} integer={integer} formatTick={unit === "%" ? percentTick : number} />
  const first = result.summaries[0]
  const hasUnavailableSearch = result.sprints.some((s) => searchLink(issues(s.id, { kind: "population" })).unavailable)
  const issuePoint = (task: ProjectsAnalysisTask, unit: "sp" | "actualSp") => {
    const value = task[pointFields[unit]], display = value === null ? "—／未填" : number(value)
    return value !== null && result.jiraBaseUrl ? <ExternalNumber href={jiraIssueHref(result.jiraBaseUrl, task.key)} label={`${task.key} · ${unitLabels[unit]}`}>{display}</ExternalNumber> : <span>{display}</span>
  }
  const summaryTiles = multi ? [] : (() => {
    const s = first, id = s.sprint.id
    return [
      { topic: "output", label: "全範圍總輸出", metric: { kind: "output" } as DetailMetric, value: <>{pointValue(id, { kind: "output" }, `全範圍總輸出 ${unitLabels[outputUnit]}`, s.output[outputUnit])} {unitLabels[outputUnit]}</>, extra: countValue(id, { kind: "output" }, "全範圍完成張數", s.output.count) },
      { topic: "types", label: "完成的任務類型", metric: { kind: "output" } as DetailMetric, value: countValue(id, { kind: "output" }, "完成的任務類型張數", s.output.count), extra: "六類 Dev Type＋未分類，詳見下方" },
      { topic: "commitment", label: "Sprint 完成率", metric: { kind: "commitment-all" } as DetailMetric, value: ratioView(s, "commitment", "sp"), extra: "分子當期完成／分母全部 Dev-Task" },
      { topic: "quality", label: "開發品質 · Bug／Dev", metric: qualityMetrics, value: ratioView(s, "quality", "count"), extra: "Bug＋Dev 比較母體（非績效評等）" },
      { topic: "pressure", label: "開發壓力 · TKK＋SUN", metric: { kind: "pressure" } as DetailMetric, value: <>{pointValue(id, { kind: "pressure" }, "開發壓力 SP", s.pressure.combined.sp)} SP</>, extra: "範圍內全部工作單，不限完成日期" },
      { topic: "unfinished", label: "目前未完成", metric: { kind: "unfinished" } as DetailMetric, value: countValue(id, { kind: "unfinished" }, "目前未完成張數", s.unfinished.count), extra: <>{pointValue(id, { kind: "unfinished" }, "目前未完成 SP", s.unfinished.sp)} SP · Resolved 空白</> },
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
    {topicPanel("output", <Panel title={multi ? "總輸出趨勢" : "Sprint 總輸出"} controls={<div className="projects-output-controls flex max-w-full flex-wrap items-center justify-end gap-3"><Units name="總輸出" value={outputUnit} onChange={(unit) => { if (unit !== "count" && unit !== outputUnit) { setOutputUnit(unit); clearOutputDetail() } }} choices={["sp", "actualSp"]} labels={outputUnitLabels} compact /><label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs has-disabled:cursor-not-allowed has-disabled:opacity-60"><input type="checkbox" checked={showTotal} disabled={!hasAttribution} onChange={(event) => { setShowTotal(event.target.checked); clearOutputDetail() }} className="h-4 w-4 accent-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600" />顯示總量</label></div>}>
      {!hasAttribution && <p role="status" className="mb-3 text-sm text-slate-500 dark:text-slate-400">團隊歸屬資料無法取得；目前顯示全範圍總輸出。</p>}
      <ProjectsTrendChart id="output" sprints={result.sprints} series={outputSeries} unit={unitLabels[outputUnit]} formatTick={number} stackedTotalId={hasAttribution && showTotal ? "visible-total" : undefined} legendToggle={hasAttribution ? { visibleIds: displayedTeams, onToggle: toggleTeam } : undefined} emptyMessage={hasAttribution && !outputSeries.length ? "所選 Sprint 的團隊點數皆為 0。" : undefined} />
      {hasAttribution && <DataTable label="查看團隊數據表"><table><caption className="sr-only">各團隊完整輸出核對（不隨圖例隱藏）</caption><thead><tr><th>Sprint</th><th>團隊</th><th>SP</th><th>Actual SP</th><th>完成張數</th></tr></thead><tbody>{result.summaries.flatMap((summary) => candidates.map((team) => <tr key={`${summary.sprint.id}-${team.id}`}><th scope="row">{summary.sprint.name}</th><td>{team.label}</td>{totalsCells(summary.sprint.id, outputMetric([team.id]), team.label, teamTotals(summary, [team.id]))}</tr>))}</tbody></table></DataTable>}
      <DataTable label="查看全範圍數據表"><table><caption className="sr-only">全範圍總輸出與目前未完成比較（不隨圖例隱藏）</caption><thead><tr><th>Sprint</th><th>全範圍輸出 SP</th><th>全範圍輸出 Actual SP</th><th>完成張數</th><th>目前未完成</th><th>未完成 SP</th></tr></thead><tbody>{result.summaries.map((summary) => <tr key={summary.sprint.id}><th scope="row">{summary.sprint.name}</th>{totalsCells(summary.sprint.id, { kind: "output" }, "全範圍總輸出", summary.output)}<td>{countCell(summary.sprint.id, { kind: "unfinished" }, "目前未完成", summary.unfinished.count)}</td><td>{pointCell(summary.sprint.id, { kind: "unfinished" }, "未完成 SP", summary.unfinished.sp)}</td></tr>)}</tbody></table></DataTable>
    </Panel>)}
    {topicPanel("types", <Panel title="完成的任務類型" description="每種 Dev Type 一條趨勢線；與總輸出同一批工作單，保留未分類方便對帳。單一 Sprint 顯示類型分布。">
      <Units name="完成的任務類型" value={typeUnit} onChange={setTypeUnit} />
      <ProjectsTrendChart key={`types-${typeUnit}`} id="types" sprints={result.sprints} series={typeSeries} unit={unitLabels[typeUnit]} formatTick={number} integer={typeUnit === "count"} distribution={!multi} focusableLegend />
      <DataTable><table><caption className="sr-only">Sprint Dev Type 的 SP、Actual SP、張數</caption><thead><tr><th>Sprint</th><th>Dev Type</th><th>SP</th><th>Actual SP</th><th>張數</th></tr></thead><tbody>{result.summaries.flatMap((summary) => summary.devTypes.map(({ label, totals }) => <tr key={`${summary.sprint.id}-${label}`}><th scope="row">{summary.sprint.name}</th><td>{label}</td>{totalsCells(summary.sprint.id, { kind: "type", value: label }, label, totals)}</tr>))}</tbody></table></DataTable>
    </Panel>)}
    {topicPanel("commitment", <Panel title="Sprint 完成率" description="Issue Type Dev-Task（所有 Dev Type）的當期完成 SP／全部 SP。不是 Sprint 起始承諾快照。">
        {multi ? trend("commitment", commitmentSeries, "%") : ratioView(first, "commitment", "sp")}
        <DataTable><table><caption className="sr-only">Sprint 完成率 比率與分子分母</caption><thead><tr><th>Sprint</th><th>Sprint 完成率 · SP</th></tr></thead><tbody>{result.summaries.map((s) => <tr key={s.sprint.id}><th scope="row">{s.sprint.name}</th><td>{ratioView(s, "commitment", "sp")}<div className="mt-1 flex flex-wrap gap-2 text-xs">{button(s.sprint.id, { kind: "commitment-done" }, "Sprint 完成率 分子", "完成本站明細")}{button(s.sprint.id, { kind: "commitment-all" }, "Sprint 完成率 分母", "全部本站明細")}</div>{commitmentCoverage(s)}</td></tr>)}</tbody></table></DataTable>
    </Panel>)}
    {topicPanel("quality", <Panel title="開發品質 · Bug／Dev" description="完成工作單 Dev Type Bug／Dev；OP-Bug 不納入，不是 Bug／(Bug＋Dev)。比率可超過 100%，不代表績效評等。">
        <Units name="開發品質" value={qualityUnit} onChange={setQualityUnit} ratios />
        {multi ? <ProjectsTrendChart key={`quality-${qualityUnit}`} id="quality" sprints={result.sprints} series={qualitySeries} unit="%" formatTick={percentTick} /> : ratioView(first, "quality", qualityUnit)}
        <DataTable><table><caption className="sr-only">Bug／Dev 三種比率與分子分母</caption><thead><tr><th>Sprint</th><th>張數比</th><th>SP 比</th><th>Actual SP 比</th></tr></thead><tbody>{result.summaries.map((s) => <tr key={s.sprint.id}><th scope="row">{s.sprint.name}</th><td>{ratioView(s, "quality", "count")}<div className="mt-1 flex gap-2 text-xs">{button(s.sprint.id, qualityMetrics[0], "Bug", "Bug 本站明細")}{button(s.sprint.id, qualityMetrics[1], "Dev", "Dev 本站明細")}</div></td><td>{ratioView(s, "quality", "sp")}</td><td>{ratioView(s, "quality", "actualSp")}</td></tr>)}</tbody></table></DataTable>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">0 或未填分母不適用；有缺值的點數比只使用已填點數，非完整估算。</p>
    </Panel>)}
    {topicPanel("pressure", <Panel title="開發壓力" description="TKK／SUN 工作單自身 Project 的 SP，不加 Resolved 區間限制；不額外查全站資料。">
        {multi ? trend("pressure", pressureSeries, "SP") : <p className="text-sm">TKK {pointValue(first.sprint.id, { kind: "pressure", value: "TKK" }, "TKK SP", first.pressure.TKK.sp)} SP · SUN {pointValue(first.sprint.id, { kind: "pressure", value: "SUN" }, "SUN SP", first.pressure.SUN.sp)} SP · 合計 {pointValue(first.sprint.id, { kind: "pressure" }, "TKK＋SUN SP", first.pressure.combined.sp)} SP</p>}
        <DataTable><table><caption className="sr-only">工作單 Project 壓力及對帳</caption><thead><tr><th>Sprint</th><th>TKK SP</th><th>SUN SP</th><th>TKK＋SUN SP</th><th>母體 SP／張數</th><th>區間外完成</th></tr></thead><tbody>{result.summaries.map((s) => <tr key={s.sprint.id}><th scope="row">{s.sprint.name}</th>{([["TKK", s.pressure.TKK], ["SUN", s.pressure.SUN], [undefined, s.pressure.combined]] as const).map(([value, total]) => <td key={value ?? "combined"}>{pointCell(s.sprint.id, { kind: "pressure", value }, `${value ?? "TKK＋SUN"} SP`, total.sp)}</td>)}<td>{pointCell(s.sprint.id, { kind: "population" }, "母體 SP", s.population.sp)}<span className="block text-xs">{countValue(s.sprint.id, { kind: "population" }, "母體張數", s.population.count)}</span></td><td>{countCell(s.sprint.id, { kind: "outside" }, "區間外完成", s.outsideWindow.count)}<span className="block text-xs">{pointValue(s.sprint.id, { kind: "outside" }, "區間外完成 SP", s.outsideWindow.sp)} SP</span></td></tr>)}</tbody></table></DataTable>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Sub-task 通常與母票同 Project，壓力可能等於母體 SP；PRIDE 可能為 0。尚未與 Capacity 比較。</p>
    </Panel>)}
    {topicPanel("unfinished", <Panel title="目前未完成" description="只看現行 Resolved 空白，不限 Sprint 區間；區間外已完成不算未完成。SP／張數分開呈現。">
        {multi ? <div className="space-y-6"><div><h3 className="mb-2 text-sm font-medium">未完成 SP</h3>{trend("unfinished-sp", [totalSeries("unfinished-sp", "未完成 SP", "sp", (s) => s.unfinished, "sp", { kind: "unfinished" })], "SP")}</div><div className="border-t border-slate-200 pt-4 dark:border-slate-700"><h3 className="mb-2 text-sm font-medium">未完成張數</h3>{trend("unfinished-count", [totalSeries("unfinished-count", "未完成張數", "actual", (s) => s.unfinished, "count", { kind: "unfinished" })], "張數", true)}</div></div> : <p className="text-sm">{countValue(first.sprint.id, { kind: "unfinished" }, "目前未完成張數", first.unfinished.count)} · {pointValue(first.sprint.id, { kind: "unfinished" }, "目前未完成 SP", first.unfinished.sp)} SP</p>}
        <DataTable><table><caption className="sr-only">目前未完成張數及 SP</caption><thead><tr><th>Sprint</th><th>未完成張數</th><th>未完成 SP</th></tr></thead><tbody>{result.summaries.map((s) => <tr key={s.sprint.id}><th scope="row">{s.sprint.name}</th><td>{countCell(s.sprint.id, { kind: "unfinished" }, "目前未完成", s.unfinished.count)}</td><td>{pointCell(s.sprint.id, { kind: "unfinished" }, "未完成 SP", s.unfinished.sp)}</td></tr>)}</tbody></table></DataTable>
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

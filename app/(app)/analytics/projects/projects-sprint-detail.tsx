"use client"

import { useState } from "react"
import type { SprintRecord } from "@/lib/jira-sprint-data"
import type { TeamCapacity } from "@/lib/projects-capacity"

/** One row of the Sprint panel: a team normally, or a member when exactly one team is selected. */
export type SprintTeamBreakdown = {
  teamId: string
  label: string
  /** Color token: the team's chart color, or a roster color for a member within that team. */
  color: string
  /** Completed Story Points in this Sprint. */
  points: number | null
  capacity: number | null
  memberCount: number
  /** "team" or "member"; drives the labels only. */
  kind?: "team" | "member"
  /** Jira search for exactly this row's issues; null when the link cannot be built completely. */
  href?: string | null
  /** Completed Actual SP, and the team's members, both only filled in team mode. */
  actualPoints?: number | null
  members?: SprintMember[]
}

/** A team member's completed points in the selected Sprint, for the pie's drill-down bars. */
export type SprintMember = { teamId: string; label: string; color: string; points: number; actualPoints: number }

const dash = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(value)
const percent = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("zh-TW", { style: "percent", maximumFractionDigits: 1 }).format(value)

/**
 * Donut of each team's share of completed Story Points. Hovering a slice swells it slightly; clicking it locks that
 * slice open and grows a member bar chart underneath.
 */
function TeamPie({ teams, total }: { teams: readonly SprintTeamBreakdown[]; total: number }) {
  const slices = teams.filter((team) => (team.points ?? 0) > 0)
  const radius = 52, circumference = 2 * Math.PI * radius
  const [hovered, setHovered] = useState<string | null>(null)
  // The slice is "pinned" once clicked; clicking it again collapses the member chart.
  const [pinned, setPinned] = useState<string | null>(null)
  // Pre-compute each slice's running offset so rendering stays side-effect free.
  // Same construction as Planning's donut: a small gap between slices keeps the surface color visible.
  const gap = 2
  const arcs = total > 0 ? slices.reduce<{ team: SprintTeamBreakdown; drawn: number; offset: number }[]>((all, team) => {
    const length = (team.points ?? 0) / total * circumference
    const offset = all.length ? all[all.length - 1].offset + all[all.length - 1].drawn + gap : 0
    all.push({ team, drawn: Math.max(0, length - gap), offset })
    return all
  }, []) : []
  const expanded = pinned === null ? null : slices.find((team) => team.teamId === pinned) ?? null
  const members = expanded?.members ?? []
  const memberMax = Math.max(1, ...members.flatMap((member) => [member.points, member.actualPoints]))
  const SIZE = 196
  return <div className="min-w-0">
    <div className="flex min-w-0 flex-wrap items-center gap-5">
      <div className="relative shrink-0">
        <svg role="img" aria-label={total > 0 ? `完成 Story Points 依團隊佔比，共 ${dash(total)} 點` : "此 Sprint 沒有已填 Story Points"} width={SIZE} height={SIZE} viewBox="0 0 140 140" className="h-44 w-44 shrink-0">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--viz-grid)" strokeWidth="22" />
          {arcs.map(({ team, drawn, offset }) => {
            const active = pinned === team.teamId, lit = hovered === team.teamId
            const common = { cx: 70, cy: 70, r: radius, fill: "none", stroke: `var(--viz-${team.color})`, strokeWidth: active ? 28 : lit ? 26 : 22, strokeDasharray: `${drawn} ${circumference - drawn}`, strokeDashoffset: -offset, transform: "rotate(-90 70 70)", opacity: pinned && !active ? .45 : 1 }
            // The whole slice is a button so a click can drill down instead of leaving the page; Jira stays on the list.
            return <g key={team.teamId} role="button" tabIndex={0} data-pie-team={team.teamId} aria-pressed={active}
              aria-label={`${team.label}：${dash(team.points)} SP，${total > 0 ? percent((team.points ?? 0) / total) : "—"}；${active ? "收合" : "顯示"}成員點數`}
              className="cursor-pointer outline-none transition-opacity duration-200 focus-visible:opacity-80"
              onPointerEnter={() => setHovered(team.teamId)} onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(team.teamId)} onBlur={() => setHovered(null)}
              onClick={() => setPinned((previous) => previous === team.teamId ? null : team.teamId)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPinned((previous) => previous === team.teamId ? null : team.teamId) } }}>
              <circle {...common} className="transition-[stroke-width,opacity] duration-200" />
              <circle {...common} stroke="transparent" strokeWidth={30} />
            </g>
          })}
          <text x="70" y="66" textAnchor="middle" className="pointer-events-none fill-slate-900 text-lg font-semibold dark:fill-slate-100">{total > 0 ? dash(total) : "—"}</text>
          <text x="70" y="84" textAnchor="middle" className="pointer-events-none fill-slate-500 text-[11px] dark:fill-slate-400">完成 SP</text>
        </svg>
      </div>
      <ul className="min-w-0 flex-1 space-y-1 text-sm">
        {teams.map((team) => <li key={team.teamId} className={`flex items-center gap-2 ${pinned && pinned !== team.teamId ? "opacity-60" : ""}`}>
          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ background: `var(--viz-${team.color})` }} />
          <span className="min-w-0 flex-1 truncate">{team.label}</span>
          <span className="tabular-nums">{team.href ? <a href={team.href} target="_blank" rel="noopener noreferrer" aria-label={`在 Jira 開啟 ${team.label} 的 ${dash(team.points)} SP 工作單（另開分頁）`} className="underline decoration-dotted underline-offset-4 hover:decoration-solid">{dash(team.points)} SP</a> : <>{dash(team.points)} SP</>}</span>
          <span className="w-14 text-right tabular-nums text-slate-500 dark:text-slate-400">{total > 0 ? percent((team.points ?? 0) / total) : "—"}</span>
        </li>)}
      </ul>
    </div>
    {/* Member chart grows beneath the donut: Story Points in the light tint, Actual SP in the full team colour. */}
    {expanded && <div className="mt-1 rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-pie-members={expanded.teamId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{expanded.label} · 成員點數</p>
        {expanded.href && <a href={expanded.href} target="_blank" rel="noopener noreferrer" aria-label={`在 Jira 開啟 ${expanded.label} 的 ${dash(expanded.points)} SP 工作單（另開分頁）`} className="text-xs underline decoration-dotted underline-offset-4 hover:decoration-solid">在 Jira 開啟</a>}
      </div>
      {members.length ? <div className="mt-2 space-y-2">
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400"><span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(--viz-${expanded.color})`, opacity: .35 }} />SP</span><span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(--viz-${expanded.color})` }} />Actual SP</span></div>
        {members.map((member) => <div key={member.teamId} data-pie-member={member.teamId} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-xs"><span className="truncate">{member.label}</span><span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{dash(member.points)} SP · {dash(member.actualPoints)} Actual</span></div>
          <div className="mt-0.5 space-y-0.5">
            <div className="h-2 rounded" style={{ width: `${member.points / memberMax * 100}%`, minWidth: 2, background: `var(--viz-${expanded.color})`, opacity: .35 }} />
            <div className="h-2 rounded" style={{ width: `${member.actualPoints / memberMax * 100}%`, minWidth: 2, background: `var(--viz-${expanded.color})` }} />
          </div>
        </div>)}
      </div> : <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">此團隊在此 Sprint 沒有已填點數的成員。</p>}
    </div>}
  </div>
}

/**
 * Per-Sprint detail below the 總產出 chart: the Sprint's dates, the team share of completed Story Points, and the
 * capacity realization (completed SP ÷ team capacity). Capacity is placeholder data (see `lib/projects-capacity`).
 */
export function ProjectsSprintDetail({ sprint, teams }: { sprint: SprintRecord; teams: readonly SprintTeamBreakdown[] }) {
  const byMember = teams.some((team) => team.kind === "member")
  const noun = byMember ? "成員" : "團隊"
  // Teams without completed Story Points are meaningless for both the share and the realization rate.
  const withPoints = teams.filter((team) => (team.points ?? 0) > 0)
  const total = withPoints.reduce((sum, team) => sum + (team.points ?? 0), 0)
  // `projects-viz` carries the shared --viz color tokens; the panel sits outside the chart that defines them.
  return <section className="projects-viz mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700" aria-label={`${sprint.name} 詳細資料`} data-sprint-detail={sprint.id}>
    <h3 className="text-base font-semibold">{sprint.name} <span className="text-sm font-normal tabular-nums text-slate-500 dark:text-slate-400">（{sprint.startDate} — {sprint.endDate}）</span></h3>
    <div className="mt-4 grid gap-6 lg:grid-cols-2">
      <div className="min-w-0">
        <h4 className="mb-2 text-sm font-medium">{noun}完成點數佔比（Story Points）</h4>
        {withPoints.length ? <TeamPie teams={withPoints} total={total} /> : <p className="text-sm text-slate-500 dark:text-slate-400">此 Sprint 沒有已填 Story Points 的{noun}。</p>}
      </div>
      <div className="min-w-0">
        <h4 className="mb-2 text-sm font-medium">產能兌現率（完成 SP／{noun} Capacity）</h4>
        {withPoints.length ? (() => {
          // A 100% reference line keeps over- and under-realization readable when every bar shares one scale.
          const rates = withPoints.map((team) => team.capacity === null || team.capacity <= 0 || team.points === null ? 0 : team.points / team.capacity)
          const scale = Math.max(1, ...rates)
          return <div className="space-y-2">
            <ul className="space-y-2" aria-label={`各${noun}產能兌現率`}>
              {withPoints.map((team, index) => {
                const rate = team.capacity === null || team.capacity <= 0 || team.points === null ? null : team.points / team.capacity
                return <li key={team.teamId} data-capacity-team={team.teamId} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: `var(--viz-${team.color})` }} /><span className="truncate">{team.label}</span></span>
                    <span className="shrink-0 tabular-nums font-medium">{team.href ? <a href={team.href} target="_blank" rel="noopener noreferrer" data-capacity-rate={rate === null ? "" : Math.round(rate * 1000) / 10} aria-label={`在 Jira 開啟 ${team.label} 的工作單（另開分頁）`} className="underline decoration-dotted underline-offset-4 hover:decoration-solid">{percent(rate)}</a> : <span data-capacity-rate={rate === null ? "" : Math.round(rate * 1000) / 10}>{percent(rate)}</span>}</span>
                  </div>
                  {(() => {
                    const bar = <div className="relative mt-1 block h-3 rounded bg-slate-100 dark:bg-slate-800" role="img" aria-label={`${team.label}：完成 ${dash(team.points)} SP／Capacity ${dash(team.capacity)}，兌現率 ${percent(rate)}`}>
                      <div className="h-full rounded" style={{ width: `${Math.min(100, (rates[index] / scale) * 100)}%`, background: `var(--viz-${team.color})` }} />
                      <span aria-hidden="true" className="absolute inset-y-0 border-l border-dashed border-slate-400 dark:border-slate-500" style={{ left: `${100 / scale}%`, display: scale > 1 ? undefined : "none" }} />
                    </div>
                    // The whole bar is a Jira link when the exact issue set can be expressed completely.
                    return team.href ? <a href={team.href} target="_blank" rel="noopener noreferrer" aria-label={`在 Jira 開啟 ${team.label} 的工作單（另開分頁）`} className="block rounded hover:brightness-110 focus-visible:outline-2 focus-visible:outline-blue-600">{bar}</a> : bar
                  })()}
                  <p className="mt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">完成 {dash(team.points)} SP／Capacity {dash(team.capacity)}{team.kind === "member" ? "" : `（${team.memberCount} 人）`}</p>
                </li>
              })}
            </ul>
            {scale > 1 && <p className="text-xs text-slate-500 dark:text-slate-400">虛線為 100% 兌現；最長條為 {percent(scale)}。</p>}
          </div>
        })() : <p className="text-sm text-slate-500 dark:text-slate-400">此 Sprint 沒有已填 Story Points 的{noun}。</p>}
      </div>
    </div>
  </section>
}

/** Joins team capacities with the Sprint's completed Story Points, preserving the chart's team order. */
export function sprintTeamBreakdown(teams: readonly { id: string; label: string; color: string; points: number | null }[], capacities: readonly TeamCapacity[], labelOf: (teamId: string) => string): SprintTeamBreakdown[] {
  return teams.map((team) => {
    const capacity = capacities.find((entry) => entry.teamId === team.id)
    return { teamId: team.id, label: team.label || labelOf(team.id), color: team.color, points: team.points, capacity: capacity?.capacity ?? null, memberCount: capacity?.memberCount ?? 0 }
  })
}

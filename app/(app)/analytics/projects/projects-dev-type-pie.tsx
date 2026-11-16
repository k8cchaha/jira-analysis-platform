"use client"

import { useRef, useState } from "react"
import { devTypeFamilyOf } from "@/lib/planning-overview"

/** One dev type's slice: its share of Story Points and how those points split across teams. */
export type DevTypeShare = {
  label: string
  points: number
  teams: { key: string; label: string; points: number }[]
}

const number = (value: number) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value)
const percent = (value: number) => value > 0 && value < .0005 ? "<0.1%" : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1, style: "percent" }).format(value)

// Same palette as Planning's 開發類型分佈: one hue family per dev-type group, 未分類 neutral.
const FAMILY_FILL: Record<string, string> = {
  spike: "var(--viz-type-3)",
  op: "var(--viz-type-0)",
  bug: "var(--viz-type-1)",
  dev: "var(--viz-type-5)",
}
const fillOf = (label: string) => FAMILY_FILL[devTypeFamilyOf(label) ?? ""] ?? "var(--viz-text)"

/**
 * Dev-type share donut. The team split of a type is shown as a floating tooltip anchored to its slice, mirroring
 * Planning's 開發類型分佈; clicking a slice keeps that tooltip open.
 */
export function ProjectsDevTypePie({ shares, title, legend = "below", bordered = true }: { shares: readonly DevTypeShare[]; title: string; /** "below" stacks the per-type list under the donut; "right" puts it beside it. */ legend?: "below" | "right"; /** Draw the card frame; the summary widget inside a panel goes without one. */ bordered?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null)
  const slices = shares.filter((share) => share.points > 0)
  const total = slices.reduce((sum, share) => sum + share.points, 0)
  const radius = 46, circumference = 2 * Math.PI * radius, gap = 2
  let offset = 0
  const arcs = total > 0 ? slices.map((share) => {
    const fraction = share.points / total
    const drawn = Math.max(0, fraction * circumference - gap)
    // Mid-angle from 12 o'clock clockwise, matching each arc's rotate(-90).
    const midDeg = (offset + drawn / 2) / circumference * 360
    const arc = { share, drawn, offset, midDeg, percent: share.points / total }
    offset += fraction * circumference
    return arc
  }) : []
  const active = arcs.find((arc) => arc.share.label === (hovered ?? pinned)) ?? null
  // Anchor the tooltip to the circle, not along the slice normal: left-half slices open to the left and
  // right-half slices to the right, always tucked against the donut and kept inside the card so a menu or the
  // panel edge cannot cover it.
  const computeTip = (midDeg: number) => {
    const svg = wrap.current?.querySelector<SVGSVGElement>("svg")
    const rect = svg?.getBoundingClientRect()
    if (!rect) return null
    const TOOLTIP_W = 176, GAP = 8, MARGIN = 8
    const viewportWidth = typeof window === "undefined" ? rect.right + TOOLTIP_W : window.innerWidth
    const viewportHeight = typeof window === "undefined" ? rect.bottom + 150 : window.innerHeight
    const scale = rect.width / 120
    const rad = (midDeg * Math.PI) / 180
    const anchorY = rect.top + (60 - 34 * Math.cos(rad)) * scale
    const height = wrap.current?.querySelector<HTMLElement>("[data-pie-tooltip]")?.offsetHeight ?? 150
    // Left-half slices open leftwards, right-half rightwards; the viewport (not the narrow card) is the limit, so a
    // sideways menu can never cover it. Only when one side has no room does it flip to the other.
    const toLeft = Math.sin(rad) < 0
    let left = toLeft ? rect.left - TOOLTIP_W - GAP : rect.right + GAP
    if (toLeft && left < MARGIN) left = rect.right + GAP
    if (!toLeft && left + TOOLTIP_W > viewportWidth - MARGIN) left = rect.left - TOOLTIP_W - GAP
    left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, viewportWidth - TOOLTIP_W - MARGIN))
    const top = Math.min(Math.max(anchorY - height / 2, MARGIN), Math.max(MARGIN, viewportHeight - height - MARGIN))
    return { left, top }
  }
  const show = (label: string, midDeg: number) => { setHovered(label); setTip(computeTip(midDeg)) }
  const hide = () => { setHovered(null); setTip(null) }
  const dismiss = () => { setPinned(null); hide() }
  const toggle = (label: string, midDeg: number) => {
    if (pinned === label) { dismiss(); return }
    setPinned(label); show(label, midDeg)
  }
  return <section ref={wrap} className={`projects-viz relative ${legend === "right" ? "inline-block max-w-full" : "min-w-0"} ${bordered ? "rounded-xl border border-slate-200 dark:border-slate-700 " : ""}p-4`} aria-label={title}>
    <h4 className="text-sm font-semibold">{title}</h4>
    {/* "below" stacks the per-type list under the donut; "right" places it beside it. */}
    <div className={legend === "right" ? "mt-3 flex flex-wrap items-center justify-center gap-4" : "mt-3 flex flex-col items-center gap-3"}>
      <svg role="img" aria-label={total > 0 ? `${title}，共 ${number(total)} SP` : `${title}沒有已填 Story Points`} viewBox="0 0 120 120" className="h-44 w-44 shrink-0">
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="18" className="stroke-slate-100 dark:stroke-slate-800" />
        {arcs.map((arc) => <circle key={arc.share.label} data-pie-type={arc.share.label} data-pie-pinned={pinned === arc.share.label || undefined} cx="60" cy="60" r={radius} fill="none" stroke={fillOf(arc.share.label)} strokeWidth={active?.share.label === arc.share.label ? 24 : 18} strokeDasharray={`${arc.drawn} ${circumference - arc.drawn}`} strokeDashoffset={-arc.offset} transform="rotate(-90 60 60)" opacity={active && active.share.label !== arc.share.label ? .45 : 1}
          className="cursor-pointer outline-none transition-[stroke-width,opacity] duration-200"
          tabIndex={0}
          onPointerEnter={() => show(arc.share.label, arc.midDeg)} onPointerLeave={() => { if (!pinned) hide() }}
          onFocus={() => show(arc.share.label, arc.midDeg)} onBlur={() => { if (!pinned) hide() }}
          onClick={() => toggle(arc.share.label, arc.midDeg)}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(arc.share.label, arc.midDeg) } else if (event.key === "Escape") dismiss() }}
          aria-label={`${arc.share.label}：${number(arc.share.points)} SP，${percent(arc.percent)}`} />)}
        <text x="60" y="61" textAnchor="middle" className="pointer-events-none fill-slate-900 text-[22px] font-semibold dark:fill-white">{number(total)}</text>
        <text x="60" y="77" textAnchor="middle" className="pointer-events-none fill-slate-500 text-[10px] dark:fill-slate-400">SP</text>
      </svg>
      <ul className={legend === "right" ? "min-w-0 flex-1 space-y-1 text-xs" : "w-full min-w-0 max-w-[11rem] space-y-1 text-xs"}>
        {slices.length ? slices.map((share) => <li key={share.label} className={`flex items-center gap-2 ${active && active.share.label !== share.label ? "opacity-60" : ""}`}
          onPointerEnter={() => { const arc = arcs.find((entry) => entry.share.label === share.label); if (arc) show(share.label, arc.midDeg) }} onPointerLeave={() => { if (!pinned) hide() }}>
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: fillOf(share.label) }} />
          <span className="min-w-0 flex-1 truncate">{share.label}</span>
          <span className="tabular-nums">{number(share.points)}</span>
          <span className="w-12 text-right tabular-nums text-slate-500 dark:text-slate-400">{percent(share.points / total)}</span>
        </li>) : <li className="text-slate-500 dark:text-slate-400">沒有已填 Story Points 的任務。</li>}
      </ul>
    </div>
    {/* Floating tooltip: the hovered (or clicked) type's split across teams. */}
    {active && tip && <div role="tooltip" data-pie-tooltip={active.share.label} style={{ left: tip.left, top: tip.top }} className="pointer-events-none fixed z-50 w-44 rounded-xl border border-slate-200 bg-white/95 p-2.5 text-xs shadow-xl backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mb-1.5 flex items-center gap-2 border-b border-slate-100 pb-1.5 dark:border-slate-800">
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: fillOf(active.share.label) }} />
        <span className="font-semibold text-slate-800 dark:text-slate-200">{active.share.label} · 依團隊</span>
        <span className="ml-auto tabular-nums text-slate-500 dark:text-slate-400">{number(active.share.points)} SP</span>
      </div>
      <ul className="space-y-1">{active.share.teams.length ? active.share.teams.map((team) => <li key={team.key} className="flex items-center gap-2">
        <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">{team.label}</span>
        <span className="ml-auto tabular-nums text-slate-700 dark:text-slate-200">{number(team.points)}</span>
        <span className="w-9 text-right tabular-nums text-slate-500 dark:text-slate-400">{percent(team.points / active.share.points)}</span>
      </li>) : <li className="text-slate-400 dark:text-slate-500">此類型暫無工作單</li>}</ul>
    </div>}
  </section>
}

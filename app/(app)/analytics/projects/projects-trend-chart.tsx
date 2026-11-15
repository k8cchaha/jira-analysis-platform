"use client"

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react"
import type { SprintRecord } from "@/lib/jira-sprint-data"
import { buildStackGeometry, buildTrendGeometry, cleanAxisMaximum } from "./projects-trend-geometry"

export type TrendDatum = {
  value: number | null
  /** Story Points beside the charted value, for the side-by-side estimate bars. */
  points?: number | null
  /** Actual Story Points beside the charted value, for the side-by-side estimate bars. */
  actualPoints?: number | null
  display: string
  readout?: ReactNode
  note?: ReactNode
  partial?: boolean
  actions?: { label: string; onClick: () => void }[]
}
export type TrendSeries = { id: string; label: string; color: string; values: TrendDatum[]; encoding?: { shape: number; dash?: string }; toggleable?: boolean }
type LegendToggle = { visibleIds: readonly string[]; onToggle: (id: string) => void }
const dashes = [undefined, "8 4", "3 3", "10 3 2 3", "6 3 2 3 2 3", "2 5", "12 4"]
const seriesStyle = (color: string) => ({ "--series-color": `var(--viz-${color})` }) as CSSProperties
// Reserve conservative text bounds; the HTML pill uses native ellipsis for actual glyphs.
const labelWidth = (label: string) => Array.from(label).reduce((size, character) => size + (character.codePointAt(0)! > 255 ? 12 : 7), 0)
function axisSpan(center: number, size: number, minimum: number, maximum: number) {
  const width = Math.min(size, maximum - minimum)
  return { left: Math.max(minimum, Math.min(center - width / 2, maximum - width)), width }
}

function Marker({ x, y, shape, partial = false }: { x: number; y: number; shape: number; partial?: boolean }) {
  const common = { className: `projects-trend-marker${partial ? " is-partial" : ""}`, vectorEffect: "non-scaling-stroke" as const }
  switch (shape % 7) {
    case 1: return <rect {...common} x={x - 4} y={y - 4} width={8} height={8} rx={1} />
    case 2: return <path {...common} d={`M${x},${y - 5} L${x + 5},${y} L${x},${y + 5} L${x - 5},${y} Z`} />
    case 3: return <path {...common} d={`M${x},${y - 5} L${x + 5},${y + 4} L${x - 5},${y + 4} Z`} />
    case 4: return <path {...common} d={`M${x - 5},${y - 4} L${x + 5},${y - 4} L${x},${y + 5} Z`} />
    case 5: return <path {...common} d={`M${x - 5},${y - 2} L${x - 2},${y - 5} L${x + 2},${y - 5} L${x + 5},${y - 2} L${x + 5},${y + 2} L${x + 2},${y + 5} L${x - 2},${y + 5} L${x - 5},${y + 2} Z`} />
    case 6: return <ellipse {...common} cx={x} cy={y} rx={6} ry={4} />
    default: return <circle {...common} cx={x} cy={y} r={4} />
  }
}
function LineKey({ shape, dash, color }: { shape: number; dash?: string; color: string }) {
  return <svg aria-hidden="true" width="32" height="16" viewBox="0 0 32 16" style={seriesStyle(color)} className="projects-trend-series shrink-0"><line x1="0" x2="32" y1="8" y2="8" className="projects-trend-line" strokeDasharray={dash} /><Marker x={16} y={8} shape={shape} /></svg>
}

function FillKey({ shape, dash, color, patternId }: { shape: number; dash?: string; color: string; patternId: string }) {
  return <svg aria-hidden="true" width="32" height="16" viewBox="0 0 32 16" style={seriesStyle(color)} className="projects-trend-series shrink-0"><rect x={0} y={2} width={10} height={12} rx={2} className="projects-stack-fill" /><rect x={0} y={2} width={10} height={12} rx={2} className="projects-stack-texture" fill={`url(#${patternId})`} /><line x1={12} x2={32} y1={8} y2={8} className="projects-trend-line" strokeDasharray={dash} /><Marker x={22} y={8} shape={shape} /></svg>
}

/** Presentation only: all metric values and local detail actions are supplied by the view. */
export function ProjectsTrendChart({ id, sprints, series, unit, formatTick, integer = false, distribution = false, focusableLegend = false, legendToggle, stackedTotalId, emptyMessage, onSprintSelect }: {
  id: string
  sprints: readonly SprintRecord[]
  series: TrendSeries[]
  unit: string
  formatTick: (value: number) => string
  integer?: boolean
  distribution?: boolean
  focusableLegend?: boolean
  legendToggle?: LegendToggle
  stackedTotalId?: string
  emptyMessage?: string
  /** Reports the clicked Sprint, or null when a second click clears the selection. */
  onSprintSelect?: (index: number | null) => void
}) {
  const patternPrefix = `projects-stack-${useId().replace(/[^a-zA-Z0-9_-]/g, "_")}`
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const [selected, setSelected] = useState(0)
  const [committedVisual, setCommittedVisual] = useState(false)
  const [emphasis, setEmphasis] = useState<string | null>(null)
  const readoutFocused = useRef(false)
  // The last Sprint whose plot was clicked, and whether the pointer moved since that click.
  const clicked = useRef<number | null>(null)
  const moved = useRef(false)
  useEffect(() => {
    const element = container.current
    if (!element || typeof ResizeObserver === "undefined") return
    const measure = () => setWidth(Math.max(160, element.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // Resolve identity from the complete catalog, never from visible-series rank.
  const catalog = series.map((item, index) => ({ item, index, shape: item.encoding?.shape ?? index, dash: item.encoding ? item.encoding.dash : dashes[index % 7] }))
  const visibleIds = legendToggle ? new Set(legendToggle.visibleIds) : null
  const visible = catalog.filter(({ item }) => !visibleIds || item.toggleable === false || visibleIds.has(item.id))
  const active = visible.length ? focus ?? hover ?? pinned : null
  // Bar values follow the hovered Sprint, or the clicked one while the pointer is elsewhere.
  const labelledIndex = active ?? (visible.length ? pinned : null)
  const stacked = stackedTotalId !== undefined && !distribution
  const lineSeries = stacked ? visible.filter(({ item }) => item.id === stackedTotalId) : visible
  // 全團隊總覽 has no separate total series: both totals are the sum of the visible teams, per unit.
  const implicitTotal = stacked && !lineSeries.length
  const stackSeries = stacked ? (implicitTotal ? visible : visible.filter(({ item }) => item.id !== stackedTotalId)) : []
  const totalValues = (field: "points" | "actualPoints" | "value") => sprints.map((_, index) => {
    const amounts = stackSeries.map(({ item }) => item.values[index]?.[field]).filter((amount): amount is number => typeof amount === "number")
    return amounts.length ? amounts.reduce((sum, amount) => sum + amount, 0) : null
  })
  const totalMarkers = (field: "points" | "actualPoints") => sprints.map((_, index) => stackSeries.some(({ item }) => item.values[index]?.[field] !== null && item.values[index]?.[field] !== undefined))
  // Both side-by-side bars share the axis, so the taller unit (usually Actual SP) must fit it too.
  const maximum = cleanAxisMaximum(implicitTotal ? [...totalValues("points"), ...totalValues("actualPoints")] : lineSeries.flatMap(({ item }) => item.values.flatMap((value) => [value.value, value.points, value.actualPoints].filter((amount): amount is number | null => amount !== undefined))), integer)
  const left = 58, right = width >= 640 && lineSeries.length <= 4 ? 152 : 18, top = 22, plotHeight = 206, height = 276
  const endLabels = !implicitTotal && width >= 640 && lineSeries.length <= 4 ? lineSeries.map(({ item }) => ({ item, value: item.values.at(-1)?.value })).filter((entry) => entry.value !== null && entry.value !== undefined).map((entry) => ({ ...entry, y: top + (1 - entry.value! / maximum) * plotHeight })) : []
  const availableWidth = Math.max(1, width - left - right)
  // Stacked bars are drawn as two tight side-by-side bars — the Story Point estimate next to Actual SP — whose
  // centres are also where the two total curves are drawn; the pair must fit one slot on narrow or crowded charts.
  const slotWidth = Math.min(48, availableWidth / Math.max(1, sprints.length - 1))
  const barWidth = stacked ? Math.max(2, Math.min(24, slotWidth / 2.1)) : 0
  const barOffset = stacked ? barWidth / 2 + Math.min(1, barWidth * .12) : 0
  const plotLeft = left + slotWidth / 2
  const plotWidth = Math.max(1, availableWidth - slotWidth)
  const x = (index: number) => plotLeft + (sprints.length <= 1 ? plotWidth / 2 : index / (sprints.length - 1) * plotWidth)
  const columns = (field: "points" | "actualPoints") => stacked && stackSeries.length ? buildStackGeometry(stackSeries.map(({ item }) => item.values.map((datum) => datum[field] ?? null)), implicitTotal ? totalValues(field) : lineSeries[0].item.values.map((datum) => datum[field] ?? null), maximum, plotWidth, plotHeight) : []
  const actualColumns = columns("actualPoints")
  const pointColumns = columns("points")
  const keyFor = ({ item, index, shape, dash }: typeof catalog[number]) => stacked && (implicitTotal || item.id !== stackedTotalId) ? <FillKey shape={shape} dash={dash} color={item.color} patternId={`${patternPrefix}-${index}`} /> : <LineKey shape={shape} dash={dash} color={item.color} />
  const dismiss = () => { setHover(null); setFocus(null); setPinned(null); setCommittedVisual(false) }
  const select = (index: number, commit = true) => {
    setSelected(index); setPinned(index)
    if (commit) setCommittedVisual(true)
    else if (index !== selected) setCommittedVisual(false)
  }
  // A Sprint is "selected" only by a click. Hover and focus may preview it, but they never make a later
  // click look like a second one; only two clicks on the same Sprint (with no pointer motion between them) clear it.
  const toggle = (index: number) => {
    setSelected(index); setPinned(index)
    if (clicked.current === index && !moved.current && committedVisual) { setCommittedVisual(false); onSprintSelect?.(null); return }
    setCommittedVisual(true)
    onSprintSelect?.(index)
  }
  const observe = (index: number) => {
    if (!visible.length || readoutFocused.current || focus !== null) return
    // Any motion after a click ends that gesture, so the next click always selects.
    moved.current = true
    setHover(index); select(index, false)
  }
  const dismissReadout = () => {
    readoutFocused.current = false
    container.current?.querySelector<HTMLElement | SVGRectElement>(distribution ? `[data-distribution-index="${selected}"]` : `[data-sprint-index="${selected}"]`)?.focus()
    dismiss()
  }
  const ticks = integer && maximum <= 4 ? Array.from({ length: maximum + 1 }, (_, index) => index) : [0, .25, .5, .75, 1].map((fraction) => integer ? Math.round(maximum * fraction) : maximum * fraction)
  const selection = !distribution && committedVisual && active !== null && sprints[active] ? (() => {
    // Cover both side-by-side bars of the Sprint, not just its centre line.
    const center = x(active), halfBand = Math.min(40, Math.max(barWidth * 2, (sprints.length <= 1 ? plotWidth : plotWidth / (sprints.length - 1)) * .8)) / 2
    const bandLeft = Math.max(left, center - halfBand), bandRight = Math.min(width - right, center + halfBand)
    return { index: active, bandLeft, bandWidth: bandRight - bandLeft, pill: axisSpan(center, Math.min(160, labelWidth(sprints[active].name) + 24), left, width - right) }
  })() : null
  const axisLabel = (name: string) => name.length > 14 ? `${name.slice(0, 12)}…` : name
  const coveredLabel = (name: string, index: number) => {
    if (!selection) return false
    const size = labelWidth(axisLabel(name)) + 8
    const start = x(index) - (index === 0 ? 0 : index === sprints.length - 1 ? size : size / 2)
    return index === selection.index || (start < selection.pill.left + selection.pill.width + 8 && start + size > selection.pill.left - 8)
  }
  return <div ref={container} className="projects-viz projects-trend min-w-0" data-chart-id={id}>
    {(series.length > 1 || legendToggle) && <div aria-label="圖例" className={`projects-trend-legend mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs${legendToggle ? " is-toggle" : ""}`}>
      {catalog.map((entry) => {
        const { item } = entry
        return legendToggle && item.toggleable !== false ? <button type="button" key={item.id} aria-pressed={visibleIds!.has(item.id)} aria-label={`顯示 ${item.label} 產出`} className="flex min-h-9 items-center gap-2 rounded-md border border-transparent px-2 text-left focus-visible:outline-2 focus-visible:outline-blue-600" onClick={() => legendToggle.onToggle(item.id)}>{keyFor(entry)}<span>{item.label}</span>{!visibleIds!.has(item.id) && <span>· 已隱藏</span>}</button> : focusableLegend && !legendToggle ? <button type="button" key={item.id} aria-pressed={emphasis === item.id} aria-label={`聚焦 ${item.label} 趨勢`} className="flex min-h-9 items-center gap-2 rounded-md border border-transparent px-2 text-left focus-visible:outline-2 focus-visible:outline-blue-600" onClick={() => setEmphasis((previous) => previous === item.id ? null : item.id)}>{keyFor(entry)}<span>{item.label}</span>{emphasis === item.id && <span className="text-xs">· 聚焦</span>}</button> : <span key={item.id} className="flex min-h-8 items-center gap-2">{keyFor(entry)}{item.label}</span>
      })}
    </div>}
    {focusableLegend && <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">點選類型可聚焦其走勢，再點一次恢復全部；所有類型仍保留。{emphasis && `目前聚焦：${series.find((item) => item.id === emphasis)?.label}`}</p>}
    {distribution ? <div className="space-y-3" aria-label={`${sprints[0]?.name} 任務類型分布 · ${unit}`}>
      {visible.map(({ item, index, shape, dash }) => {
        const datum = item.values[0]
        return <div key={item.id} style={seriesStyle(item.color)} className={`projects-distribution-row ${emphasis && emphasis !== item.id ? "is-context" : ""}${emphasis === item.id ? " is-emphasized" : ""}`} data-series={item.id}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><LineKey shape={shape} dash={dash} color={item.color} />{item.label}</span><strong className="tabular-nums">{datum.readout ?? datum.display} <span className="font-normal text-xs">{unit}</span></strong></div>
          <button type="button" data-distribution-index={index} className="projects-distribution-track block h-6 w-full rounded text-left focus-visible:outline-2 focus-visible:outline-blue-600" aria-label={`${item.label} ${datum.display} ${unit}，查看工作單明細`} aria-controls={`${id}-${index}-readout`} aria-expanded={active === index} onPointerEnter={() => observe(index)} onPointerLeave={() => setHover(null)} onFocus={() => { setFocus(index); select(index) }} onBlur={() => setFocus(null)} onKeyDown={(event) => { if (event.key === "Escape") dismiss() }} onClick={datum.actions?.[0]?.onClick}><span className="projects-distribution-fill block h-3 rounded-r" style={{ width: `${datum.value === null ? 0 : datum.value / maximum * 100}%` }} /></button>
          {active === index && <div id={`${id}-${index}-readout`} role="region" aria-label={`${sprints[0]?.name} · ${item.label} 讀值`} className="mt-2 rounded border border-slate-200 p-2 text-xs dark:border-slate-700" onFocusCapture={() => { readoutFocused.current = true }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) readoutFocused.current = false }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); dismissReadout() } }}>{sprints[0]?.name} · {item.label}：{datum.readout ?? datum.display} {unit}<button type="button" className="mt-1 block min-h-9 underline focus-visible:outline-2" onClick={dismissReadout}>收合讀值</button></div>}
          {datum.note && <div className="text-xs text-slate-500 dark:text-slate-400">{datum.note}</div>}
        </div>
      })}
    </div> : <div className="relative">
      <svg className="projects-trend-svg block w-full overflow-visible" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label={`${unit} ${stacked ? "團隊堆疊長條與總量曲線" : "趨勢"}，X 軸為已選 Sprint，Y 軸從零開始`} onPointerMove={(event) => {
        if (event.pointerType === "touch") return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (!bounds.width) return
        const position = ((event.clientX - bounds.left) / bounds.width * width - plotLeft) / plotWidth
        const index = Math.max(0, Math.min(sprints.length - 1, Math.round(position * (sprints.length - 1))))
        observe(index)
      }} onPointerLeave={() => setHover(null)}>
        <g className="projects-trend-grid" aria-hidden="true">{[...new Set(ticks)].map((tick) => {
          const y = top + (1 - tick / maximum) * plotHeight
          return <g key={tick}><line x1={left} x2={width - right} y1={y} y2={y} /><text x={left - 9} y={y + 4} textAnchor="end">{formatTick(tick)}</text></g>
        })}</g>
        {/* Stacked mode charts both units, so it labels them together above the plot; other modes keep the unit at the axis. */}
        {stacked ? <text className="projects-trend-unit-title" x={left + (width - right - left) / 2} y={12} textAnchor="middle">SP / Actual SP</text> : <text className="projects-trend-unit-title" x={left} y={12}>{unit}</text>}
        {selection && <rect className="projects-trend-selection-band" data-selection-index={selection.index} x={selection.bandLeft} y={top} width={selection.bandWidth} height={plotHeight} rx={4} aria-hidden="true" />}
        {stacked && <defs>
          {catalog.map(({ index, shape, dash }) => <pattern key={index} id={`${patternPrefix}-${index}`} width={6 + shape % 7 * 2} height={6 + shape % 7 * 2} patternUnits="userSpaceOnUse" patternTransform={`rotate(${dash ? 135 : 45})`}><line x1={0} x2={0} y1={0} y2={6 + shape % 7 * 2} className="projects-stack-pattern" /></pattern>)}
          {[{ columns: actualColumns, offset: 1 as const, kind: "actual" }, { columns: pointColumns, offset: -1 as const, kind: "points" }].flatMap(({ columns, offset, kind }) => columns.filter((column) => column.height > 0).map((column) => {
            const radius = Math.min(4, barWidth / 2, column.height)
            const center = column.x + offset * barOffset
            const start = center - barWidth / 2, end = center + barWidth / 2
            return <clipPath key={`${kind}-${column.index}`} id={`${patternPrefix}-cap-${kind}-${column.index}`}><path d={`M ${start} ${plotHeight} V ${column.y + radius} Q ${start} ${column.y} ${start + radius} ${column.y} H ${end - radius} Q ${end} ${column.y} ${end} ${column.y + radius} V ${plotHeight} Z`} /></clipPath>
          }))}
        </defs>}
        {/* Actual Story Points in the team color; Story Points beside them in the same hue, tinted lighter because it is an estimate. */}
        {[{ columns: actualColumns, offset: 1 as const, kind: "actual" }, { columns: pointColumns, offset: -1 as const, kind: "points" }].flatMap(({ columns, offset, kind }) => columns.filter((column) => column.height > 0).map((column) => <g key={`${kind}-${column.index}`} data-stack-index={column.index} data-stack-kind={kind} className={`projects-stack-column projects-stack-column-${kind}${active === column.index ? " is-active" : ""}`} data-stack-total={(implicitTotal ? totalValues(kind === "points" ? "points" : "actualPoints") : lineSeries[0].item.values.map((datum) => datum[kind === "points" ? "points" : "actualPoints"] ?? null))[column.index]} transform={`translate(${plotLeft} ${top})`} clipPath={`url(#${patternPrefix}-cap-${kind}-${column.index})`} aria-hidden="true">
          {column.segments.map((segment) => {
            const { item, index } = stackSeries[segment.seriesIndex]
            const center = column.x + offset * barOffset
            const rect = { x: center - barWidth / 2, y: segment.y, width: barWidth, height: segment.height }
            return <g key={item.id} data-series={item.id} data-stack-value={segment.value} style={seriesStyle(item.color)} className={`projects-stack-segment projects-stack-segment-${kind}${item.values[column.index].partial ? " is-partial" : ""}`}><rect {...rect} className="projects-stack-fill" /><rect {...rect} className="projects-stack-texture" fill={`url(#${patternPrefix}-${index})`} /></g>
          })}
          {column.segments.slice(0, -1).map((segment, index) => {
            const gap = Math.min(2, segment.height / 2, column.segments[index + 1].height / 2)
            const center = column.x + offset * barOffset
            return <rect key={index} x={center - barWidth / 2} y={segment.y - gap / 2} width={barWidth} height={gap} className="projects-stack-gap" />
          })}
        </g>))}
        {/* The hovered/selected Sprint labels the top of both of its bars (estimate left, actual right). */}
        {labelledIndex !== null && stackSeries.length ? [{ columns: pointColumns, offset: -1 as const, kind: "points" }, { columns: actualColumns, offset: 1 as const, kind: "actual" }].flatMap(({ columns, offset, kind }) => {
          const column = columns.find((entry) => entry.index === labelledIndex)
          if (!column || column.height <= 0) return []
          const total = (implicitTotal ? totalValues(kind === "points" ? "points" : "actualPoints") : lineSeries[0].item.values.map((datum) => datum[kind === "points" ? "points" : "actualPoints"] ?? null))[column.index]
          if (total === null || total === undefined) return []
          return [<text key={`bar-value-${kind}`} data-bar-value={kind} className={`projects-stack-value projects-stack-value-${kind}`} x={plotLeft + column.x + offset * barOffset} y={top + column.y - 6} textAnchor="middle" aria-hidden="true">{formatTick(total)}</text>]
        }) : null}
        {/* Stacked mode draws both totals as curves, one per unit, each centred on its own bar; other modes draw one curve per series. */}
        {(stacked ? !visible.length ? [] : [
          // Fixed pair so the two curves stay distinguishable: the estimate is a light dashed blue, the actual result a solid blue.
          { key: "points", values: totalValues("points"), offset: -1, color: "points", shape: 0, dash: "6 4" as string | undefined, partial: totalMarkers("points") },
          { key: "actualPoints", values: totalValues("actualPoints"), offset: 1, color: "actual", shape: 1, dash: undefined as string | undefined, partial: totalMarkers("actualPoints") },
        ] : [...lineSeries].sort((a, b) => Number(a.item.id === emphasis) - Number(b.item.id === emphasis)).map(({ item, shape, dash }) => ({ key: item.id, values: item.values.map((datum) => datum.value), offset: 0, color: item.color, shape, dash, partial: item.values.map((datum) => datum.partial === true) }))).map(({ key, values, offset, color, shape, dash, partial }) => {
          const geometry = buildTrendGeometry(values, maximum, plotWidth, plotHeight)
          const centered = sprints.length <= 1
          return <g key={key} data-series={key} data-series-unit={stacked ? key : undefined} style={seriesStyle(color)} transform={`translate(${plotLeft + (centered ? offset * barOffset : 0)} ${top})`} className={`projects-trend-series${stacked ? ` projects-trend-series-${key === "points" ? "points" : "actual"}` : ""}${emphasis && emphasis !== key ? " is-context" : ""}${emphasis === key ? " is-emphasized" : ""}`} aria-hidden="true">
            {geometry.paths.map((path, segment) => <path key={segment} className="projects-trend-line" d={path} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />)}
            {/* In stacked mode the curve follows its bar's centre, except the single Sprint case where both share the axis centre. */}
            {geometry.points.map((point) => <Marker key={point.index} x={stacked && !centered ? point.x + offset * barOffset : point.x} y={point.y} shape={shape} partial={partial[point.index]} />)}
          </g>
        })}
        {endLabels.filter((entry) => !endLabels.some((other) => other !== entry && Math.abs(other.y - entry.y) < 22)).map(({ item, y }) => <text key={item.id} className="projects-trend-end-label" x={stacked && sprints.length === 1 ? x(0) + barWidth * .6 + barWidth / 2 + 8 : width - right + 12} y={y + 4} aria-hidden="true">{item.label.length > 20 ? `${item.label.slice(0, 18)}…` : item.label}</text>)}
        {active !== null && <line className="projects-trend-crosshair" x1={x(active)} x2={x(active)} y1={top} y2={top + plotHeight} aria-hidden="true" />}
        {sprints.map((sprint, index) => <g key={sprint.id}>
          {(width >= 480 || sprints.length <= 3 || index === 0 || index === sprints.length - 1) && <text className={`projects-trend-x-label${coveredLabel(sprint.name, index) ? " is-covered" : ""}`} x={x(index)} y={top + plotHeight + 27} textAnchor={index === 0 ? "start" : index === sprints.length - 1 ? "end" : "middle"} aria-hidden="true">{axisLabel(sprint.name)}</text>}
          {!!visible.length && <rect data-sprint-index={index} x={index === 0 ? plotLeft - 12 : (x(index - 1) + x(index)) / 2} y={top - 8} width={Math.max(24, sprints.length === 1 ? plotWidth + 24 : plotWidth / (sprints.length - 1) / (index === 0 || index === sprints.length - 1 ? 2 : 1) + (index === 0 || index === sprints.length - 1 ? 12 : 0))} height={plotHeight + 38} fill="transparent" role="button" tabIndex={index === selected ? 0 : -1} className="projects-trend-target" aria-label={`${sprint.name}，${sprint.startDate} 至 ${sprint.endDate}，查看 ${unit} 趨勢數值`} aria-controls={`${id}-readout`} aria-expanded={active === index} onFocus={() => { setHover(null); setFocus(index); select(index, false) }} onBlur={() => setFocus(null)} onClick={() => { clicked.current = index; moved.current = false; toggle(index) }} onKeyDown={(event) => {
            if (event.key === "Escape") dismiss()
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(index) }
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault()
              const next = Math.max(0, Math.min(sprints.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)))
              event.currentTarget.ownerSVGElement?.querySelector<SVGRectElement>(`[data-sprint-index="${next}"]`)?.focus()
            }
          }} />}
          {!!visible.length && <line className="projects-trend-focus-cue" x1={axisSpan(x(index), 24, left, width - right).left} x2={axisSpan(x(index), 24, left, width - right).left + Math.min(24, availableWidth)} y1={top + plotHeight + 41} y2={top + plotHeight + 41} aria-hidden="true" />}
        </g>)}
      </svg>
      {selection && <span className="projects-trend-sprint-pill" data-pill-index={selection.index} aria-hidden="true" title={sprints[selection.index].name} style={{ left: `${selection.pill.left / width * 100}%`, width: `${selection.pill.width / width * 100}%`, top: top + plotHeight + 12 }}>{sprints[selection.index].name}</span>}
    </div>}
    {!visible.length && <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">{emptyMessage ?? "尚未顯示團隊，請點選圖例加入。"}</p>}
  </div>
}

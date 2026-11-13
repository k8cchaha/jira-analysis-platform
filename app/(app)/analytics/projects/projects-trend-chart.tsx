"use client"

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react"
import type { SprintRecord } from "@/lib/jira-sprint-data"
import { buildStackGeometry, buildTrendGeometry, cleanAxisMaximum } from "./projects-trend-geometry"

export type TrendDatum = {
  value: number | null
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
export function ProjectsTrendChart({ id, sprints, series, unit, formatTick, integer = false, distribution = false, focusableLegend = false, legendToggle, stackedTotalId, emptyMessage }: {
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
  const stacked = stackedTotalId !== undefined && !distribution
  const lineSeries = stacked ? visible.filter(({ item }) => item.id === stackedTotalId) : visible
  const stackSeries = stacked ? visible.filter(({ item }) => item.id !== stackedTotalId) : []
  const maximum = cleanAxisMaximum(lineSeries.flatMap(({ item }) => item.values.map((value) => value.value)), integer)
  const left = 58, right = width >= 640 && lineSeries.length <= 4 ? 152 : 18, top = 22, plotHeight = 206, height = 276
  const endLabels = width >= 640 && lineSeries.length <= 4 ? lineSeries.map(({ item }) => ({ item, value: item.values.at(-1)?.value })).filter((entry) => entry.value !== null && entry.value !== undefined).map((entry) => ({ ...entry, y: top + (1 - entry.value! / maximum) * plotHeight })) : []
  const availableWidth = Math.max(1, width - left - right)
  const barWidth = stacked ? Math.min(24, availableWidth / Math.max(1, sprints.length) / 2) : 0
  const plotLeft = left + barWidth / 2
  const plotWidth = Math.max(1, availableWidth - barWidth)
  const x = (index: number) => plotLeft + (sprints.length <= 1 ? plotWidth / 2 : index / (sprints.length - 1) * plotWidth)
  const columns = stacked && lineSeries.length ? buildStackGeometry(stackSeries.map(({ item }) => item.values.map((datum) => datum.value)), lineSeries[0].item.values.map((datum) => datum.value), maximum, plotWidth, plotHeight) : []
  const keyFor = ({ item, index, shape, dash }: typeof catalog[number]) => stacked && item.id !== stackedTotalId ? <FillKey shape={shape} dash={dash} color={item.color} patternId={`${patternPrefix}-${index}`} /> : <LineKey shape={shape} dash={dash} color={item.color} />
  const dismiss = () => { setHover(null); setFocus(null); setPinned(null); setCommittedVisual(false) }
  const select = (index: number, commit = true) => {
    setSelected(index); setPinned(index)
    if (commit) setCommittedVisual(true)
    else if (index !== selected) setCommittedVisual(false)
  }
  const observe = (index: number) => {
    if (!visible.length || readoutFocused.current || focus !== null) return
    setHover(index); select(index, false)
  }
  const dismissReadout = () => {
    readoutFocused.current = false
    container.current?.querySelector<HTMLElement | SVGRectElement>(distribution ? `[data-distribution-index="${selected}"]` : `[data-sprint-index="${selected}"]`)?.focus()
    dismiss()
  }
  const ticks = integer && maximum <= 4 ? Array.from({ length: maximum + 1 }, (_, index) => index) : [0, .25, .5, .75, 1].map((fraction) => integer ? Math.round(maximum * fraction) : maximum * fraction)
  const anyValue = lineSeries.some(({ item }) => item.values.some((value) => value.value !== null))
  const selection = !distribution && committedVisual && active !== null && sprints[active] ? (() => {
    const center = x(active), halfBand = Math.min(40, (sprints.length <= 1 ? plotWidth : plotWidth / (sprints.length - 1)) * .8) / 2
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
        return legendToggle && item.toggleable !== false ? <button type="button" key={item.id} aria-pressed={visibleIds!.has(item.id)} aria-label={`顯示 ${item.label} 輸出`} className="flex min-h-9 items-center gap-2 rounded-md border border-transparent px-2 text-left focus-visible:outline-2 focus-visible:outline-blue-600" onClick={() => legendToggle.onToggle(item.id)}>{keyFor(entry)}<span>{item.label}</span>{!visibleIds!.has(item.id) && <span>· 已隱藏</span>}</button> : focusableLegend && !legendToggle ? <button type="button" key={item.id} aria-pressed={emphasis === item.id} aria-label={`聚焦 ${item.label} 趨勢`} className="flex min-h-9 items-center gap-2 rounded-md border border-transparent px-2 text-left focus-visible:outline-2 focus-visible:outline-blue-600" onClick={() => setEmphasis((previous) => previous === item.id ? null : item.id)}>{keyFor(entry)}<span>{item.label}</span>{emphasis === item.id && <span className="text-xs">· 聚焦</span>}</button> : <span key={item.id} className="flex min-h-8 items-center gap-2">{keyFor(entry)}{item.label}</span>
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
        })}<text x={left} y={12}>{unit}</text></g>
        {selection && <rect className="projects-trend-selection-band" data-selection-index={selection.index} x={selection.bandLeft} y={top} width={selection.bandWidth} height={plotHeight} rx={4} aria-hidden="true" />}
        {stacked && <defs>
          {catalog.map(({ index, shape, dash }) => <pattern key={index} id={`${patternPrefix}-${index}`} width={6 + shape % 7 * 2} height={6 + shape % 7 * 2} patternUnits="userSpaceOnUse" patternTransform={`rotate(${dash ? 135 : 45})`}><line x1={0} x2={0} y1={0} y2={6 + shape % 7 * 2} className="projects-stack-pattern" /></pattern>)}
          {columns.filter((column) => column.height > 0).map((column) => {
            const radius = Math.min(4, barWidth / 2, column.height)
            const start = column.x - barWidth / 2, end = column.x + barWidth / 2
            return <clipPath key={column.index} id={`${patternPrefix}-cap-${column.index}`}><path d={`M ${start} ${plotHeight} V ${column.y + radius} Q ${start} ${column.y} ${start + radius} ${column.y} H ${end - radius} Q ${end} ${column.y} ${end} ${column.y + radius} V ${plotHeight} Z`} /></clipPath>
          })}
        </defs>}
        {columns.filter((column) => column.height > 0).map((column) => <g key={column.index} data-stack-index={column.index} className={`projects-stack-column${active === column.index ? " is-active" : ""}`} data-stack-total={lineSeries[0].item.values[column.index].value} transform={`translate(${plotLeft} ${top})`} clipPath={`url(#${patternPrefix}-cap-${column.index})`} aria-hidden="true">
          {column.segments.map((segment) => {
            const { item, index } = stackSeries[segment.seriesIndex]
            const rect = { x: column.x - barWidth / 2, y: segment.y, width: barWidth, height: segment.height }
            return <g key={item.id} data-series={item.id} data-stack-value={segment.value} style={seriesStyle(item.color)} className={`projects-stack-segment${item.values[column.index].partial ? " is-partial" : ""}`}><rect {...rect} className="projects-stack-fill" /><rect {...rect} className="projects-stack-texture" fill={`url(#${patternPrefix}-${index})`} /></g>
          })}
          {column.segments.slice(0, -1).map((segment, index) => {
            const gap = Math.min(2, segment.height / 2, column.segments[index + 1].height / 2)
            return <rect key={index} x={column.x - barWidth / 2} y={segment.y - gap / 2} width={barWidth} height={gap} className="projects-stack-gap" />
          })}
        </g>)}
        {[...lineSeries].sort((a, b) => Number(a.item.id === emphasis) - Number(b.item.id === emphasis)).map(({ item, shape, dash }) => {
          const geometry = buildTrendGeometry(item.values.map((datum) => datum.value), maximum, plotWidth, plotHeight)
          return <g key={item.id} data-series={item.id} style={seriesStyle(item.color)} transform={`translate(${plotLeft} ${top})`} className={`projects-trend-series${emphasis && emphasis !== item.id ? " is-context" : ""}${emphasis === item.id ? " is-emphasized" : ""}`} aria-hidden="true">
            {geometry.paths.map((path, segment) => <path key={segment} className="projects-trend-line" d={path} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />)}
            {geometry.points.map((point) => <Marker key={point.index} x={point.x} y={point.y} shape={shape} partial={item.values[point.index].partial} />)}
          </g>
        })}
        {endLabels.filter((entry) => !endLabels.some((other) => other !== entry && Math.abs(other.y - entry.y) < 22)).map(({ item, y }) => <text key={item.id} className="projects-trend-end-label" x={stacked && sprints.length === 1 ? x(0) + barWidth / 2 + 8 : width - right + 12} y={y + 4} aria-hidden="true">{item.label.length > 20 ? `${item.label.slice(0, 18)}…` : item.label}</text>)}
        {active !== null && <line className="projects-trend-crosshair" x1={x(active)} x2={x(active)} y1={top} y2={top + plotHeight} aria-hidden="true" />}
        {sprints.map((sprint, index) => <g key={sprint.id}>
          {(width >= 480 || sprints.length <= 3 || index === 0 || index === sprints.length - 1) && <text className={`projects-trend-x-label${coveredLabel(sprint.name, index) ? " is-covered" : ""}`} x={x(index)} y={top + plotHeight + 27} textAnchor={index === 0 ? "start" : index === sprints.length - 1 ? "end" : "middle"} aria-hidden="true">{axisLabel(sprint.name)}</text>}
          {!!visible.length && <rect data-sprint-index={index} x={index === 0 ? plotLeft - 12 : (x(index - 1) + x(index)) / 2} y={top - 8} width={Math.max(24, sprints.length === 1 ? plotWidth + 24 : plotWidth / (sprints.length - 1) / (index === 0 || index === sprints.length - 1 ? 2 : 1) + (index === 0 || index === sprints.length - 1 ? 12 : 0))} height={plotHeight + 38} fill="transparent" role="button" tabIndex={index === selected ? 0 : -1} className="projects-trend-target" aria-label={`${sprint.name}，${sprint.startDate} 至 ${sprint.endDate}，查看 ${unit} 趨勢數值`} aria-controls={`${id}-readout`} aria-expanded={active === index} onFocus={() => { setHover(null); setFocus(index); select(index) }} onBlur={() => setFocus(null)} onClick={() => select(index)} onKeyDown={(event) => {
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
      {active !== null && sprints[active] && <div id={`${id}-readout`} role="region" aria-labelledby={`${id}-readout-title`} className="projects-trend-tooltip mt-3 rounded-lg border border-slate-300 bg-white p-3 text-xs shadow-sm dark:border-slate-600 dark:bg-slate-800" onFocusCapture={() => { readoutFocused.current = true }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) readoutFocused.current = false }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); dismissReadout() } }}>
        <p id={`${id}-readout-title`} className="font-semibold text-sm">{sprints[active].name} · 趨勢讀值</p><p className="mt-1 mb-3 text-slate-500 dark:text-slate-400">{sprints[active].startDate} — {sprints[active].endDate}</p>
        <div className="space-y-2">{visible.map((entry) => {
          const { item } = entry
          return <div key={item.id}><div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2">{keyFor(entry)}{item.label}</span><strong className="text-sm tabular-nums">{item.values[active].readout ?? item.values[active].display} <span className="text-xs font-normal">{unit}</span></strong></div>{item.values[active].note && <div className="ml-10 mt-1 text-slate-500 dark:text-slate-400">{item.values[active].note}</div>}</div>
        })}</div>
        <button type="button" className="mt-2 min-h-9 rounded px-2 underline focus-visible:outline-2 focus-visible:outline-blue-600" onClick={dismissReadout}>收合讀值</button>
      </div>}
    </div>}
    {!visible.length && <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">{emptyMessage ?? "尚未顯示團隊，請點選圖例加入。"}</p>}
    {!!visible.length && !anyValue && <p role="status" className="mt-2 text-sm text-slate-500 dark:text-slate-400">此指標全部未填或不適用，未畫成零值。</p>}
    {!distribution && <>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{stacked && "長條依可見團隊堆疊，曲線只顯示總量。"}已選 Sprint 順序 · {sprints.length < 2 ? "單一觀測值；選擇至少兩個 Sprint 可比較趨勢。" : "曲線僅連接觀測值，不代表 Sprint 內每日數值。"} {stacked ? "只畫已填點數，缺值不補零；有缺值的總量以空心標記表示。" : "缺值斷線，有缺估的點以空心標記表示。"}</p>
      <div className="projects-trend-actions mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
        <p className="text-xs text-slate-500 dark:text-slate-400">工作單明細 · {sprints[selected]?.name}（點選圖中觀測點以切換）</p>
        <div className="mt-2 flex flex-wrap gap-2">{visible.flatMap(({ item }) => (item.values[selected]?.actions ?? []).map((action) => <button key={`${item.id}-${action.label}`} type="button" className="min-h-9 rounded-md border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:hover:bg-slate-800" onClick={action.onClick}>{action.label}</button>))}</div>
      </div>
    </>}
  </div>
}

"use client"

import { useId, useState, type ReactNode } from "react"
import { heatmapLevel, WORKLOAD_METRIC_LABELS, type WorkloadMetric, type WorkloadCellSelection, type HeatmapWeek, type WeeklyWorkloadHeatmap } from "@/lib/workload-heatmap"

/** 暫沿用原有配色與級距；此次只調整每週數值與方格呈現。 */
const CELL_CLASS = [
  "bg-slate-100 dark:bg-slate-800",
  "bg-blue-200 dark:bg-blue-900",
  "bg-blue-400 dark:bg-blue-700",
  "bg-blue-600 dark:bg-blue-500",
  "bg-blue-800 dark:bg-blue-300",
] as const
const CELL_INK = [
  "text-slate-900 dark:text-white",
  "text-slate-900 dark:text-white",
  "text-slate-950 dark:text-white",
  "text-white dark:text-slate-950",
  "text-white dark:text-slate-950",
] as const
const SCALE_LABELS = ["0", "1-2", "3-5", "6-9", "10+"] as const
const HEADER_CLASS = "border-b border-r border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"

export type TotalSort = "none" | "descending" | "ascending"
const SORT_LABELS = {
  none: "目前依名稱排序；點擊依 Total 高→低排序",
  descending: "目前依 Total 高→低排序；點擊依 Total 低→高排序",
  ascending: "目前依 Total 低→高排序；點擊取消 Total 排序，改依名稱排序",
} as const

function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1)
}
function formatOutputPercent(totalPoints: number, weekCount: number): string {
  const percentage = (totalPoints / (weekCount * 10)) * 100
  return `${formatPoints(Math.round(percentage * 10) / 10)}%`
}
function weekDescription(week: HeatmapWeek): string {
  return `${week.from} ～ ${week.to}（${week.dayCount} 天）`
}

/** 成員 × 週的數值表格；null 留白、完成但零點顯示 0。 */
export function WorkloadHeatmapGrid({ heatmap, metric = "points", metricSwitch, totalSort = "none", onCycleTotalSort, selection, detailsId, onSelect }: {
  heatmap: WeeklyWorkloadHeatmap
  metric?: WorkloadMetric
  metricSwitch?: ReactNode
  totalSort?: TotalSort
  onCycleTotalSort: () => void
  selection: WorkloadCellSelection | null
  detailsId: string
  onSelect: (selection: WorkloadCellSelection) => void
}) {
  const metricLabel = WORKLOAD_METRIC_LABELS[metric]
  const missingLabel = `沒有可計入的 ${metricLabel}`
  const tooltipId = useId()
  const [hover, setHover] = useState<{ label: string; week: HeatmapWeek; points: number | null; x: number; y: number } | null>(null)

  if (heatmap.weeks.length === 0) {
    return (
      <div className="min-w-0">
        {metricSwitch && <div className="mb-3 flex justify-end">{metricSwitch}</div>}
        <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">此分析區間沒有可顯示的週，請調整分析區間。</p>
      </div>
    )
  }
  if (heatmap.rows.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">所選團隊沒有可顯示的成員。</p>
  }

  const years: { year: string; count: number }[] = []
  for (const week of heatmap.weeks) {
    const last = years.at(-1)
    if (last?.year === week.year) last.count += 1
    else years.push({ year: week.year, count: 1 })
  }
  const totalPoints = heatmap.rows.reduce((sum, row) => sum + row.totalPoints, 0)
  // 僅重排呈現用複本；不改計算資料、團隊 metadata 或以 accountId 識別的選取。
  const rows = [...heatmap.rows].sort((a, b) => {
    const pointsOrder = totalSort === "none" ? 0 : totalSort === "descending"
      ? b.totalPoints - a.totalPoints : a.totalPoints - b.totalPoints
    return pointsOrder || a.displayName.localeCompare(b.displayName, "zh-Hant") ||
      (a.accountId ?? "").localeCompare(b.accountId ?? "", "en")
  })

  return (
    <div className="min-w-0">
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p role="status" className="min-w-0 text-sm text-slate-600 dark:text-slate-400">
          共 <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{heatmap.rows.length}</span> 名成員、
          <span className="mx-1 font-semibold tabular-nums text-slate-900 dark:text-white">{heatmap.weeks.length}</span> 週，
          合計 <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{formatPoints(totalPoints)}</span> 點。
        </p>
        {metricSwitch && <div className="ml-auto max-w-full">{metricSwitch}</div>}
      </div>

      <div className="max-w-full overflow-x-auto overscroll-x-none rounded-lg border border-slate-200 dark:border-slate-700" tabIndex={0} role="region" aria-label={`成員每週完成 ${metricLabel} 熱點圖`}>
        <table className="w-full table-fixed border-separate border-spacing-0 font-mono text-xs tabular-nums" style={{ minWidth: 300 + heatmap.weeks.length * 52 }}>
          <caption className="sr-only">
            成員每週完成的 Dev-Task {metricLabel}。每列一位成員，每欄為週一到週日，表頭顯示週一日期。
            成員右側的 Total 為所選指標合計，Output% 為 Total ÷（顯示週數 × 10）× 100%。
            不顯示週一早於分析起日的週；最後一週只計入區間內已取得的日期。空格代表沒有可計入的 {metricLabel}（沒有完成或未填該欄），0 代表完成且該欄為零。
          </caption>
          <colgroup>
            <col style={{ width: 140 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 88 }} />
            {heatmap.weeks.map((week) => <col key={week.start} />)}
          </colgroup>
          <thead className="text-slate-600 dark:text-slate-300">
            <tr>
              <th rowSpan={2} scope="col" className={`sticky left-0 z-20 w-[140px] min-w-[140px] px-3 text-center font-medium ${HEADER_CLASS}`}>
                <span aria-hidden="true">Member</span><span className="sr-only">成員</span>
              </th>
              <th rowSpan={2} scope="col" aria-sort={totalSort} className={`sticky left-[140px] z-20 min-w-[72px] px-1 text-center font-medium ${HEADER_CLASS}`}>
                <span className="inline-flex items-center justify-center whitespace-nowrap">
                  Total
                  <button type="button" aria-label={SORT_LABELS[totalSort]} title={SORT_LABELS[totalSort]}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-slate-700"
                    onClick={() => { setHover(null); onCycleTotalSort() }}>
                    <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      {totalSort === "none" ? <path d="M5 13V3m-3 3 3-3 3 3m3-3v10m-3-3 3 3 3-3" /> :
                        <path d={totalSort === "descending" ? "M8 3v10m-4-4 4 4 4-4" : "M8 13V3m-4 4 4-4 4 4"} />}
                    </svg>
                  </button>
                </span>
              </th>
              <th rowSpan={2} scope="col" className={`sticky left-[212px] z-20 min-w-[88px] px-2 text-center font-medium ${HEADER_CLASS}`}>Output%</th>
              {years.map(({ year, count }) => (
                <th key={year} colSpan={count} scope="colgroup" className={`h-[28px] text-center font-medium ${HEADER_CLASS}`}>{year}</th>
              ))}
            </tr>
            <tr>
              {heatmap.weeks.map((week) => (
                <th key={week.start} scope="col" title={weekDescription(week)} className={`h-[30px] min-w-[52px] px-2 text-center font-semibold whitespace-nowrap ${HEADER_CLASS}`}>
                  <span aria-hidden="true">{week.start.slice(5).replace("-", "/")}</span>
                  <span className="sr-only">週一 {week.start}，涵蓋 {weekDescription(week)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.accountId ?? "\u0000unassigned"}>
                <th scope="row" title={row.displayName} className={`sticky left-0 z-10 h-[30px] px-3 text-right font-semibold text-slate-800 dark:text-slate-200 ${HEADER_CLASS}`}>
                  <span className="block max-w-[116px] truncate">{row.displayName}</span>
                </th>
                <td className={`sticky left-[140px] z-10 h-[30px] min-w-[72px] px-2 text-center font-semibold text-slate-900 dark:text-white ${HEADER_CLASS}`}>
                  {formatPoints(row.totalPoints)}
                </td>
                <td className={`sticky left-[212px] z-10 h-[30px] min-w-[88px] px-2 text-center font-semibold text-slate-900 dark:text-white ${HEADER_CLASS}`}>
                  {formatOutputPercent(row.totalPoints, heatmap.weeks.length)}
                </td>
                {row.cells.map((points, index) => {
                  const week = heatmap.weeks[index]
                  const level = heatmapLevel(points)
                  const label = `${row.displayName}・${weekDescription(week)}：${points === null ? missingLabel : `${metricLabel} 完成 ${formatPoints(points)} 點`}`
                  const selected = selection?.accountId === row.accountId && selection.weekStart === week.start
                  const interaction = {
                    tabIndex: 0,
                    "aria-label": label,
                    "aria-describedby": hover?.label === label ? tooltipId : undefined,
                    className: `flex h-[30px] min-w-[52px] w-full items-center justify-center px-2 font-semibold whitespace-nowrap ${selected ? "outline-3 outline-offset-[-3px] outline-amber-600 dark:outline-amber-300" : "outline-offset-[-2px] hover:outline-2 hover:outline-slate-400 focus-visible:outline-2 focus-visible:outline-blue-600"} ${CELL_CLASS[level]} ${CELL_INK[level]}`,
                    onMouseMove: (event: React.MouseEvent<HTMLElement>) => setHover({ label, week, points, x: event.clientX, y: event.clientY }),
                    onMouseLeave: () => setHover(null),
                    onFocus: (event: React.FocusEvent<HTMLElement>) => {
                      const rect = event.currentTarget.getBoundingClientRect()
                      setHover({ label, week, points, x: rect.left + rect.width / 2, y: rect.top })
                    },
                    onBlur: () => setHover(null),
                    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (event.key === "Escape") setHover(null) },
                  }
                  return (
                    <td key={week.start} className="border-r border-b border-slate-200 p-0 dark:border-slate-700">
                      {points === null ? (
                        <span {...interaction}><span className="sr-only">{missingLabel}</span></span>
                      ) : (
                        <button {...interaction} className={`${interaction.className} cursor-pointer`} type="button" aria-expanded={selected} aria-controls={detailsId}
                          data-workload-account={row.accountId ?? ""} data-workload-week={week.start}
                          onClick={() => { setHover(null); onSelect({ accountId: row.accountId, weekStart: week.start }) }}>
                          {formatPoints(points)}
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1">
          少
          {SCALE_LABELS.map((label, level) => (
            <span key={label} className="inline-flex items-center gap-1">
              <span className={`inline-block h-3 w-3 rounded-sm ${CELL_CLASS[level]}`} aria-hidden="true" />
              <span>{label}</span>
            </span>
          ))}
          多
        </span>
      </div>
      {hover && (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-md dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          style={{ left: `clamp(10rem, ${hover.x}px, calc(100vw - 10rem))`, top: Math.max(80, hover.y - 10) }}
        >
          {hover.label}
        </div>
      )}
    </div>
  )
}

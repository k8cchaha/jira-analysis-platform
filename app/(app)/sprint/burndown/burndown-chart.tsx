"use client"

import { useState } from "react"
import type { BurndownDay } from "@/lib/jira-burndown"

const W = 720
const H = 320
const PAD_L = 44
const PAD_R = 16
const PAD_T = 16
const PAD_B = 36

function niceCeil(value: number): number {
  if (value <= 0) return 10
  const pow = Math.pow(10, Math.floor(Math.log10(value)))
  const normalized = value / pow
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return factor * pow
}

/** 點數一律顯示到小數第一位（消除 0.1+0.2 等浮點誤差，如 20.599999… → 20.6）。 */
function formatPoints(value: number): string {
  return String(Math.round(value * 10) / 10)
}

export function BurndownChart({
  days,
  totalPoints,
  showLine,
  showBar,
  onBarClick,
}: {
  days: readonly BurndownDay[]
  totalPoints: number
  /** 是否畫實際剩餘點數曲線。 */
  showLine: boolean
  /** 是否畫每日完成點數長條。 */
  showBar: boolean
  /** 長條被點擊（或鍵盤啟動）時的回呼：日期＋是否為「開局前已完成」的綠色長條＋
   *  是否為「受阻母票」的深灰長條；未提供時長條不具互動。 */
  onBarClick?: (date: string, beforeStart?: boolean, blocked?: boolean) => void
}) {
  // 滑鼠即時顯示的 hint（原生 <title> 有約 1 秒延遲，改用 React state 立即浮現）。
  // `blocked` 標記是哪一根長條（false=藍色已完成、true=受阻深灰），各自的
  // tooltip 獨立顯示、互不覆蓋。
  const [hover, setHover] = useState<{ date: string; blocked: boolean; x: number; y: number } | null>(null)
  if (days.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Sprint 天數不足，無法繪製燃盡圖。
      </div>
    )
  }

  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const yMax = niceCeil(Math.max(totalPoints, 1))
  // 是否有受阻母票的深灰長條（決定是否顯示對應的圖例）。
  const hasBlockedBar = days.some((day) => (day.blockedPoints ?? 0) > 0)

  // x 軸起點（0 位置）就是 days 最前面的「空起點格」（remaining＝total），
  // 兩條線都從此格的 total 起步，與理想線初始值對齊。
  const step = (index: number) => (index / (days.length - 1)) * plotW
  const y = (points: number) => PAD_T + plotH - (points / yMax) * plotH

  // 理想線：從起點格（total）出發，逐日等速下降到 endDate 的 0。
  const idealPath = days
    .map(
      (day, index) =>
        `${index === 0 ? "M" : "L"}${PAD_L + step(index)},${y(day.idealPoints)}`
    )
    .join(" ")

  // 實際剩餘線：只有 remainingPoints 非 null 的連續日期才連線；
  // null（尚未到當天）處斷開，不跨空白連畫。起點格非 null（total），
  // 所以第一段天然從 total 起步，與理想線對齊。
  const actualPaths: string[] = []
  let commands: string[] = []
  const flush = () => {
    if (commands.length === 0) return
    actualPaths.push(commands.join(" "))
    commands = []
  }
  days.forEach((day, index) => {
    if (day.remainingPoints === null) {
      flush()
      return
    }
    const move = `${PAD_L + step(index)},${y(day.remainingPoints)}`
    commands.push(commands.length === 0 ? `M${move}` : `L${move}`)
  })
  flush()
  const actualPath = actualPaths.join(" ")

  const yTicks: number[] = []
  for (let tick = 0; tick <= 4; tick += 1) yTicks.push((yMax / 4) * tick)
  const xLabelStep = Math.max(1, Math.ceil(days.length / 6))

  return (
    <div>
      {/* 逐日長條的進場動畫：因 client 依日新增重繪、React 重用既有 key，只有新到當天才觸發。 */}
      <style>{`@keyframes burndown-bar-rise { from { transform: scaleY(0); } to { transform: scaleY(1); } } .burndown-bar-enter { transform-origin: bottom; animation: burndown-bar-rise 220ms ease-out; }`}</style>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="燃盡圖：剩餘點數與理想線隨時間變化"
        className="w-full"
      >
        {/* 背景格線與 Y 軸刻度 */}
        {yTicks.map((tick) => {
          const yy = y(tick)
          return (
            <g key={tick}>
              <line
                x1={PAD_L}
                y1={yy}
                x2={W - PAD_R}
                y2={yy}
                stroke="currentColor"
                className="text-slate-200 dark:text-slate-800"
                strokeWidth="1"
              />
              <text
                x={PAD_L - 6}
                y={yy + 4}
                textAnchor="end"
                className="fill-slate-500 text-[11px] dark:fill-slate-400"
              >
                {Number.isInteger(tick) ? String(tick) : formatPoints(tick)}
              </text>
            </g>
          )
        })}

        {/* X 軸日期標籤 */}{/* index 0 是空起點格（非真實 sprint 日），不標日期。 */}
        {days.map((day, index) =>
          index > 0 && index % xLabelStep === 0 ? (
            <text
              key={day.date}
              x={PAD_L + step(index)}
              y={H - PAD_B + 18}
              textAnchor="middle"
              className="fill-slate-500 text-[10px] dark:fill-slate-400"
            >
              {day.date.slice(5)}
            </text>
          ) : null
        )}

        {/* 每日完成點數長條（showBar 時）；點擊長條顯示當天完成的 Dev-Task。
            「受阻母票」的點數（blockedPoints）以深灰長條疊在當天藍色長條之上。 */}
        {showBar &&
          days.map((day, index) => {
            const barW = Math.max(2, step(1) * 0.6)
            const x = PAD_L + step(index) - barW / 2
            const bottom = y(0)
            // 空起點格（index 0）顯示「sprint 開始前就已 Done」的點數，用綠色。
            const openingCell = index === 0
            const hasBlue = !openingCell && day.donePoints > 0
            const blocked = openingCell ? 0 : day.blockedPoints ?? 0
            const hasGray = blocked > 0
            if (!openingCell && !hasBlue && !hasGray) return null

            // 各長條的 hover 處理：以 `blocked` 區分是「已完成(藍/綠)」或「受阻(灰)」，
            // 讓滑到哪根就顯示哪根自己的 tooltip，彼此獨立、各自清除。
            const hintHandlers = (isBlockedBar: boolean) => ({
              onMouseMove: (event: React.MouseEvent) =>
                setHover({ date: day.date, blocked: isBlockedBar, x: event.clientX, y: event.clientY }),
              onMouseLeave: () =>
                setHover((prev) =>
                  prev && prev.date === day.date && prev.blocked === isBlockedBar ? null : prev
                ),
            })

            // 主長條：空起點格＝綠色（開局前已完成）；其餘 sprint 日＝藍色（當天完成）。
            const mainRect = openingCell ? (
              <rect
                x={x}
                y={y(day.donePoints)}
                width={barW}
                height={Math.max(0, bottom - y(day.donePoints))}
                className="fill-green-600/70 dark:fill-green-400/70"
              />
            ) : (
              <rect
                x={x}
                y={y(day.donePoints)}
                width={barW}
                height={Math.max(0, bottom - y(day.donePoints))}
                className="fill-blue-600/70 dark:fill-blue-400/70"
              />
            )

            // 受阻長條：深灰，疊在藍色長條**之上**（灰底＝藍頂，向上延伸到受阻高度）。
            const grayRect = hasGray ? (
              <rect
                x={x}
                y={y(day.donePoints + blocked)}
                width={barW}
                height={Math.max(0, y(day.donePoints) - y(day.donePoints + blocked))}
                className="fill-slate-500/70 dark:fill-slate-300/70"
              />
            ) : null

            // 空起點格的綠色長條可點，列出「開局前已完成」的 Dev-Task。
            if (openingCell) {
              return (
                <g
                  key={day.date}
                  role="button"
                  tabIndex={0}
                  aria-label={`開局前已完成 ${formatPoints(day.donePoints)} 點，檢視開局前已完成的 Dev-Task 清單`}
                  className="burndown-bar-enter cursor-pointer outline-none focus-visible:opacity-80"
                  onClick={() => onBarClick?.(day.date, true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onBarClick?.(day.date, true)
                    }
                  }}
                  {...hintHandlers(false)}
                >
                  {mainRect}
                </g>
              )
            }

            const bars: React.ReactNode[] = []
            if (hasBlue) {
              bars.push(
                onBarClick ? (
                  <g
                    key={`${day.date}-done`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${day.date} 完成 ${formatPoints(day.donePoints)} 點，檢視當天 Dev-Task 清單`}
                    className="burndown-bar-enter cursor-pointer outline-none focus-visible:opacity-80"
                    onClick={() => onBarClick(day.date)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onBarClick(day.date)
                      }
                    }}
                    {...hintHandlers(false)}
                  >
                    {mainRect}
                  </g>
                ) : (
                  <g key={`${day.date}-done`} className="burndown-bar-enter" {...hintHandlers(false)}>{mainRect}</g>
                )
              )
            }
            // 受阻深灰長條，疊在藍色之上；點擊列出受阻母票的 Dev-Task。
            if (hasGray) {
              bars.push(
                onBarClick ? (
                  <g
                    key={`${day.date}-blocked`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${day.date} 受阻 ${formatPoints(blocked)} 點，檢視受阻母票的 Dev-Task 清單`}
                    className="burndown-bar-enter cursor-pointer outline-none focus-visible:opacity-80"
                    onClick={() => onBarClick(day.date, undefined, true)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onBarClick(day.date, undefined, true)
                      }
                    }}
                    {...hintHandlers(true)}
                  >
                    {grayRect}
                  </g>
                ) : (
                  <g key={`${day.date}-blocked`} className="burndown-bar-enter" {...hintHandlers(true)}>{grayRect}</g>
                )
              )
            }
            return <g key={day.date}>{bars}</g>
          })}

        {/* 理想線 */}
        <path
          d={idealPath}
          fill="none"
          stroke="currentColor"
          className="text-slate-400 dark:text-slate-500"
          strokeWidth="2"
          strokeDasharray="4 4"
        />
        {/* 實際剩餘線（showLine 時） */}
        {showLine && (
          <path
            d={actualPath}
            fill="none"
            stroke="currentColor"
            className="text-rose-600 dark:text-rose-400"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      <div className="mt-2 flex items-center gap-5 text-xs text-slate-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-slate-400" />
          理想線
        </span>
        {showLine && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 bg-rose-600 dark:bg-rose-400" />
            剩餘點數
          </span>
        )}
        {showBar && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 bg-blue-600/70 dark:bg-blue-400/70" />
              已完成
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 bg-green-600/70 dark:bg-green-400/70" />
              開局已完成（sprint 開始前就 Done）
            </span>
          </>
        )}
        {showBar && hasBlockedBar && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 bg-slate-500/70 dark:bg-slate-300/70" />
            受阻母票（計為已完成）
          </span>
        )}
      </div>

      {/* 滑鼠即時 hint：原生 <title> 有約 1 秒延遲，改以 fixed 定位浮現於游標旁。 */}
      {hover &&
        (() => {
          const day = days.find((item) => item.date === hover.date)
          if (!day) return null
          return (
            <div
              role="tooltip"
              className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-md dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              style={{ left: hover.x, top: hover.y - 10 }}
            >
              {day.date}：
              {hover.blocked
                ? `受阻 ${formatPoints(day.blockedPoints ?? 0)} 點（計為已完成）`
                : `完成 ${formatPoints(day.donePoints)} 點`}
            </div>
          )
        })()}
    </div>
  )
}
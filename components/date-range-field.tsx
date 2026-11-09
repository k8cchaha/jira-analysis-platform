"use client"

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react"
import {
  DEFAULT_DATE_RANGE_SHORTCUTS,
  dateRangeDayCount,
  dateRangeForPreset,
  dateRangeForShortcut,
  dateRangeValue,
  isValidDateRange,
  matchDateRangeShortcut,
  requireMonth,
  shiftDate,
  shiftMonth,
  type DateRange,
  type DateRangePresetKey,
  type DateRangeShortcut,
} from "@/lib/date-range"
import { Chevron } from "@/components/filter-dropdown"

/** 日曆格線起點：週一（`Date.getUTCDay()` 的 0 = 週日，換算為 0 = 週一）。 */
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"]
const MONDAY_FIRST_LABELS = [...WEEKDAY_LABELS.slice(1), WEEKDAY_LABELS[0]]

/**
 * 起訖日輸入：以文字樣貌呈現，不畫輸入框的邊框與底色。
 *
 * 視覺上的框由外層的 `role="group"` 容器統一提供（滑鼠與點選行為仍以容器為範圍），
 * 因此這裡只保留文字與焦點提示，讓「2026-09-20 - 2026-10-19」看起來是一段文字。
 */
const inputClass =
  "min-w-0 rounded border-0 bg-transparent px-1 py-1 text-sm text-slate-950 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-white"
const panelClass =
  "absolute top-full left-0 z-50 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900"
const cellClass =
  "flex h-8 w-8 items-center justify-center rounded text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-30"

/**
 * 「今天」以**瀏覽器本機時區**的日曆日為準，沿用 Dashboard 到期提醒／停留日數的慣例。
 *
 * 以 `useSyncExternalStore` 取得：server snapshot 為 `null`，client snapshot 為固定的
 * ISO 字串。同一個 snapshot 值在重繪間保持穩定，且首次 client render 一定不同於
 * server render（`null` → 日期），因此 React 會自然補上 hydration，不需在 effect 內
 * setState。訂閱為空函式：日曆日不需要在瀏覽器時區變更時即時重算。
 */
const noopSubscribe = () => () => {}
function clientToday(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
function serverToday(): null { return null }

export function useBrowserToday(): string | null {
  return useSyncExternalStore(noopSubscribe, clientToday, serverToday)
}

/** 將 `YYYY-MM` 轉為 `YYYY 年 M 月` 標題。 */
function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-")
  return `${year} 年 ${Number(monthNumber)} 月`
}

/** 展開某月的 6×7 日曆格（週一起算）；月外補格維持固定列數，避免換月時高度跳動。 */
function monthCells(month: string): { date: string; inMonth: boolean }[] {
  const first = `${month}-01`
  const weekday = (new Date(dateRangeValue(first)!).getUTCDay() + 6) % 7
  const start = shiftDate(first, -weekday)
  return Array.from({ length: 42 }, (_, index) => {
    const date = shiftDate(start, index)
    return { date, inMonth: date.startsWith(month) }
  })
}

function CalendarMonth({ month, selected, onSelect, onMonthChange }: {
  month: string
  selected: DateRange
  onSelect: (date: string) => void
  onMonthChange: (month: string) => void
}) {
  // 只有合法區間才畫選取範圍；不合法時仍可選日期修正，只是不標示。
  const selectedFrom = dateRangeValue(selected.from)
  const selectedTo = dateRangeValue(selected.to)
  const marked = isValidDateRange(selected) ? { from: selectedFrom!, to: selectedTo! } : null
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" aria-label="上一個月" onClick={() => onMonthChange(shiftMonth(month, -1))} className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-slate-400 dark:hover:bg-slate-800">
          <span className="block rotate-90"><Chevron open={false} /></span>
        </button>
        <span aria-live="polite" className="text-sm font-medium text-slate-800 dark:text-slate-200">{monthLabel(month)}</span>
        <button type="button" aria-label="下一個月" onClick={() => onMonthChange(shiftMonth(month, 1))} className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-slate-400 dark:hover:bg-slate-800">
          <span className="block -rotate-90"><Chevron open={false} /></span>
        </button>
      </div>
      <div role="grid" aria-label={monthLabel(month)}>
        <div role="row" className="grid grid-cols-7">
          {MONDAY_FIRST_LABELS.map((label) => (
            <span key={label} role="columnheader" className="flex h-8 w-8 items-center justify-center text-xs text-slate-500 dark:text-slate-400">{label}</span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, row) => (
          <div role="row" key={row} className="grid grid-cols-7">
            {monthCells(month).slice(row * 7, row * 7 + 7).map((cell) => {
              const value = dateRangeValue(cell.date)!
              const endpoints = cell.date === selected.from || cell.date === selected.to
              const inside = marked !== null && value >= marked.from && value <= marked.to
              return (
                <button
                  key={cell.date}
                  type="button"
                  role="gridcell"
                  aria-selected={endpoints || inside}
                  aria-label={cell.date}
                  tabIndex={-1}
                  onClick={() => onSelect(cell.date)}
                  className={`${cellClass} ${endpoints ? "bg-blue-600 font-semibold text-white hover:bg-blue-700" : inside ? "bg-blue-50 text-slate-900 dark:bg-slate-800 dark:text-slate-100" : cell.inMonth ? "text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800" : "text-slate-400 hover:bg-slate-100 dark:text-slate-600 dark:hover:bg-slate-800"}`}
                >
                  {Number(cell.date.slice(8))}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** 日期輸入：接受西元 `YYYY-MM-DD`，或省略年份的 `MM-DD`（以 `today` 的年份補齊）。 */
function DateInput({ id, label, value, today, describedBy, onCommit }: {
  id: string
  label: string
  value: string
  today: string | null
  describedBy: string
  onCommit: (date: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [edited, setEdited] = useState(false)
  const shown = edited ? draft : value

  function resolve(): string | null {
    const text = shown.trim()
    const year = today?.slice(0, 4)
    const candidate = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : year && /^\d{1,2}-\d{1,2}$/.test(text) ? `${year}-${text}` : null
    if (!candidate) return null
    if (dateRangeValue(candidate) === null) return null
    const [candidateYear, candidateMonth, candidateDay] = candidate.split("-")
    return `${candidateYear}-${candidateMonth.padStart(2, "0")}-${candidateDay.padStart(2, "0")}`
  }

  function commit() {
    const date = resolve()
    // 無法解析或尚未取得本機今天時，還原為目前生效的日期，不留下未套用的草稿。
    if (today === null || date === null) { setEdited(false); return }
    setEdited(false)
    onCommit(date)
  }

  return (
    <label htmlFor={id} className="min-w-0">
      <span className="sr-only">{label}</span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYY-MM-DD"
        value={shown}
        aria-describedby={describedBy}
        onChange={(event) => { setEdited(true); setDraft(event.target.value) }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); commit() }
          if (event.key === "Escape" && edited) { event.preventDefault(); setEdited(false) }
        }}
        className={`${inputClass} w-28 text-center`}
      />
    </label>
  )
}

/**
 * 「分析區間」：左側為 `YYYY-MM-DD - YYYY-MM-DD` 起訖輸入，右側為
 * 可由頁面配置的快捷鍵；預設為今日／本週／上週／本月／近 7 日／近 30 日。
 *
 * 點擊快捷鍵會依描述展開區間並回寫左側輸入；直接點擊輸入框則展開月曆範圍選擇器
 * （點第一下為起日、第二下為訖日）。為**受控元件**：本身不寫 URL、不發查詢，套用
 * 由外層頁面的「查詢」動作負責。
 *
 * 尚未取得本機今天時，快捷鍵停用、輸入框唯讀，避免 hydration 前後顯示不同日期；
 * 取得今天後若 `value` 仍是空區間，會以 `defaultPreset` 的區間補上並回報上層一次，
 * 讓首次載入就有一個可查的預設視窗（且只補一次，不會覆蓋使用者之後的選擇）。
 */
export function DateRangeField({ value, onChange, onCommit, shortcuts = DEFAULT_DATE_RANGE_SHORTCUTS, defaultPreset = "last7", helpText, idPrefix }: {
  value: DateRange
  onChange: (range: DateRange) => void
  /** 完成一次區間選取（快捷鍵、輸入框確認、月曆選滿）時呼叫；供上層即時套用。 */
  onCommit?: (range: DateRange) => void
  /** 頁面決定按鈕、順序與名稱；[] 隱藏快捷區。id 須唯一，配置只包含可序列化資料。 */
  shortcuts?: readonly DateRangeShortcut[]
  /** 空區間時取得本機今天後自動套用；獨立於快捷清單，預設近 7 日。 */
  defaultPreset?: DateRangePresetKey
  /** 顯示於輸入框下方的說明；未提供時不佔高度。 */
  helpText?: string
  idPrefix?: string
}) {
  const generated = useId()
  const base = idPrefix ?? generated
  const today = useBrowserToday()
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => value.from.slice(0, 7))
  const [anchor, setAnchor] = useState<string | null>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  // 取得本機今天後補上預設區間。以 ref 記錄已補過，之後即使上層把 value 清空也不再重補。
  const defaulted = useRef(false)
  useEffect(() => {
    if (today === null || defaulted.current) return
    defaulted.current = true
    if (value.from && value.to) return
    const range = dateRangeForPreset(defaultPreset, today)
    onChange(range)
    onCommit?.(range)
  })

  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent | FocusEvent) {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("focusin", outside)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("focusin", outside)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  // 開啟月曆的月份與游標狀態一律在 openCalendar／pick／commitInput 內明確設定，
  // 不用 effect 跟隨 value 變動，避免多一次連鎖重繪。

  const activeShortcut = today === null ? null : matchDateRangeShortcut(value, today, shortcuts)
  const days = dateRangeDayCount(value)
  const invalid = days === null

  function apply(range: DateRange, commit: boolean) {
    onChange(range)
    if (commit) onCommit?.(range)
  }

  function openCalendar() {
    if (today === null) return
    setMonth(value.from.slice(0, 7))
    setAnchor(null)
    setOpen(true)
  }

  function pick(date: string) {
    if (anchor === null) { setAnchor(date); return }
    // 第二下不必按時間順序：先點訖日再點起日也算同一段區間。
    const range = dateRangeValue(date)! < dateRangeValue(anchor)! ? { from: date, to: anchor } : { from: anchor, to: date }
    setAnchor(null)
    setOpen(false)
    apply(range, true)
  }

  // 手動選取時，讓游標所在的月份維持可見（僅在該月份確實改變時才動 state）。
  function showMonthOf(date: string) {
    const next = date.slice(0, 7)
    try { requireMonth(next) } catch { return }
    if (next !== month) setMonth(next)
  }

  function commitInput(which: "from" | "to", date: string) {
    showMonthOf(date)
    const range = which === "from" ? { from: date, to: date > value.to ? date : value.to } : { from: date < value.from ? date : value.from, to: date }
    apply(range, true)
  }

  const helpId = `${base}-help`
  const statusId = `${base}-status`

  return (
    <div ref={wrapper} className="relative min-w-0">
      <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        分析區間
        {days !== null && <span className="ml-1 font-normal tabular-nums">（共 {days} 天）</span>}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="分析區間起訖日"
          className={`flex h-10 min-w-0 items-center gap-1 rounded-lg border bg-white px-2 dark:bg-slate-950 ${invalid ? "border-rose-500 dark:border-rose-500" : "border-slate-300 dark:border-slate-700"}`}
        >
          <DateInput id={`${base}-from`} label="起始日" value={value.from} today={today} describedBy={helpId} onCommit={(date) => commitInput("from", date)} />
          <span aria-hidden="true" className="shrink-0 text-slate-400">-</span>
          <DateInput id={`${base}-to`} label="結束日" value={value.to} today={today} describedBy={helpId} onCommit={(date) => commitInput("to", date)} />
          <button
            ref={trigger}
            type="button"
            aria-label="開啟月曆選擇分析區間"
            aria-expanded={open}
            aria-controls={`${base}-calendar`}
            aria-describedby={helpId}
            disabled={today === null}
            onClick={() => (open ? setOpen(false) : openCalendar())}
            className="shrink-0 rounded p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
          </button>
        </div>
        {shortcuts.length > 0 && (
          <div role="group" aria-label="時間區間快捷鍵" className="flex min-w-0 flex-wrap items-center gap-1">
            {shortcuts.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={activeShortcut === option.id}
                disabled={today === null}
                onClick={() => apply(dateRangeForShortcut(option, today!), true)}
                className={`h-10 shrink-0 rounded-lg border px-3 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 ${activeShortcut === option.id ? "border-blue-600 bg-blue-50 font-semibold text-blue-700 dark:border-blue-500 dark:bg-slate-800 dark:text-blue-300" : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 僅異常狀態顯示文字；有效區間保留螢幕閱讀器播報，不佔下方空間。 */}
      <p id={statusId} role="status" className={invalid ? "mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400" : "sr-only"}>
        {invalid ? "結束日不可早於起始日。" : "分析區間已設定。"}
      </p>
      {helpText && <p id={helpId} className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{helpText}</p>}

      {open && today !== null && (
        <div id={`${base}-calendar`} className={panelClass}>
          <CalendarMonth month={month} selected={value} onSelect={pick} onMonthChange={setMonth} />
          <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
            {anchor === null ? (
              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">點選起始日，再點選結束日。</p>
            ) : (
              <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
                起始日 <span className="tabular-nums">{anchor}</span>，請點選結束日。
                {isValidDateRange({ from: anchor, to: anchor }) && (
                  <button type="button" onClick={() => pick(anchor)} className="ml-1 rounded px-1 text-blue-700 underline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300">選為單日</button>
                )}
              </p>
            )}
            <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">也可直接編輯左側日期，格式為 <span className="tabular-nums">YYYY-MM-DD</span>。</p>
          </div>
        </div>
      )}
    </div>
  )
}
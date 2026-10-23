"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { parseScrumBoardResult, type ScrumBoardCard, type ScrumColumnKey } from "@/lib/jira-scrum-board"
import { serializeDashboardFilter, type DashboardFilter } from "@/lib/jira-dashboard-filter"

const COLUMNS: { key: ScrumColumnKey; label: string }[] = [
  { key: "todo", label: "To Do" },
  { key: "inProgress", label: "In Progress" },
  { key: "inReview", label: "In Review" },
]

const BLANK_COLUMNS: Record<ScrumColumnKey, ScrumBoardCard[]> = {
  todo: [], inProgress: [], inReview: [],
}

/**
 * 依母票 issue type 回傳卡片外框/背景色（整圈 2px 框；左側另疊 5px 粗條）：
 * Story→綠、Task→藍、Bug→紅；unknown/none 用中性色。
 */
function typePalette(parent: ScrumBoardCard["parentIssueType"]): { border: string; bg: string } {
  const name = parent.status === "known" ? parent.name.toLowerCase() : ""
  // 外框直接用 Jira（Atlassian Design System）品牌色：#0052CC（藍）、#36B37E（綠）、#FF5630（紅）；
  // 深色模式改用對應亮色 token 以維持可讀性。
  if (name.includes("story")) {
    return { border: "border-[#36B37E] dark:border-[#57D9A3]", bg: "bg-emerald-50 dark:bg-emerald-950/20" }
  }
  if (name.includes("task")) {
    return { border: "border-[#0052CC] dark:border-[#4C9AFF]", bg: "bg-blue-50 dark:bg-blue-950/20" }
  }
  if (name.includes("bug")) {
    return { border: "border-[#FF5630] dark:border-[#FF8F73]", bg: "bg-red-50 dark:bg-red-950/20" }
  }
  return { border: "border-slate-300 dark:border-slate-600", bg: "bg-white dark:bg-slate-900" }
}

/**
 * 儀表板下方的開發任務看板：垂直三欄（To Do / In Progress / In Review）
 * 列出該 Dashboard scope（self / person / team）範圍內的 active Dev-Task。
 * Done 已移除欄位、不撈。看板右上角「近 X 天建立/更新」checkbox＋數字 input
 * 是額外疊加的重近條件。每張卡片依母票 issue type 上色，點擊後在新視窗開啟 Jira 單。
 */
export function DashboardScrumBoard({ filter, jiraBaseUrl }: { filter: DashboardFilter | null; jiraBaseUrl: string | null }) {
  const [nearEnabled, setNearEnabled] = useState(true)
  /** input 的數字（字串保留輸入樣式）；僅在 nearEnabled 且 filter 有效時送給 server。 */
  const [days, setDays] = useState("30")
  const [columns, setColumns] = useState<Record<ScrumColumnKey, ScrumBoardCard[]> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!filter) return
    const params = new URLSearchParams(serializeDashboardFilter(filter))
    if (nearEnabled && days.trim() !== "") params.set("boardDays", days)
    const sequence = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/dashboard/scrum-board?${params}`, { cache: "no-store" })
      const result: unknown = await response.json()
      if (sequence !== seq.current) return
      const parsed = parseScrumBoardResult(result)
      if (parsed.status !== "success") throw new Error(parsed.error.message)
      setColumns(parsed.data.columns)
    } catch {
      if (sequence === seq.current) {
        setError("無法載入開發任務看板，請重試。")
        setColumns(null)
      }
    } finally {
      if (sequence === seq.current) setLoading(false)
    }
  }, [filter, nearEnabled, days])

  useEffect(() => {
    void load()
    return () => { seq.current += 1 }
  }, [load])

  // 只允許數字輸入；清空時不送（等同未勾選），重填立即生效。
  function onDaysChange(value: string) {
    setDays(value.replace(/[^\d]/g, ""))
  }

  const effective = columns ?? BLANK_COLUMNS
  const total = COLUMNS.reduce((sum, { key }) => sum + effective[key].length, 0)

  return (
    <section aria-label="開發任務看板" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950 dark:text-white">
          開發任務看板 <span className="text-sm font-normal text-slate-500 dark:text-slate-400">（共 {total} 張 Dev-Task）</span>
        </h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
          <input
            type="checkbox"
            checked={nearEnabled}
            onChange={(event) => setNearEnabled(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-blue-600"
          />
          近
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={days}
            onChange={(event) => onDaysChange(event.target.value)}
            disabled={!nearEnabled}
            aria-label="近 X 天（X 為數字）"
            className="h-8 w-16 rounded border border-slate-300 bg-white px-2 text-sm tabular-nums text-slate-900 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          天建立/更新
        </label>
      </div>

      {!filter ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-slate-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-slate-200">
          開發任務看板需要有效的上方篩選條件才能載入。
        </p>
      ) : error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
          <span className="text-slate-800 dark:text-slate-200">{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            重試
          </button>
        </div>
      ) : loading && !columns ? (
        <ScrumBoardSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COLUMNS.map(({ key, label }) => {
            const cards = effective[key]
            return (
              <div key={key} className="flex min-w-0 flex-col rounded-xl border border-slate-200 dark:border-slate-800">
                <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{label}</h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {cards.length}
                  </span>
                </header>
                <ul className="max-h-[32rem] min-h-[6rem] flex-1 space-y-2 overflow-y-auto overscroll-contain p-2" aria-busy={loading}>
                  {cards.length === 0 && !loading ? (
                    <li className="px-2 py-6 text-center text-xs text-slate-400 dark:text-slate-500">沒有 Dev-Task</li>
                  ) : (
                    cards.map((card) => (
                      <li key={card.key}>
                        <CardLink card={card} jiraBaseUrl={jiraBaseUrl} />
                      </li>
                    ))
                  )}
                  {loading && <ScrumBoardColumnSkeleton />}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function CardLink({ card, jiraBaseUrl }: { card: ScrumBoardCard; jiraBaseUrl: string | null }) {
  const palette = typePalette(card.parentIssueType)
  const href = jiraBaseUrl ? `${jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(card.key)}` : null
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words font-medium text-slate-900 dark:text-slate-100">{card.key}</span>
        {card.assigneeDisplayName && (
          <span className="shrink-0 truncate text-xs text-slate-500 dark:text-slate-400" title={card.assigneeDisplayName}>{card.assigneeDisplayName}</span>
        )}
      </div>
      {/* summary 區塊恆為兩行高度（無值時空白），確保每張卡片高度一致；超過兩行以 line-clamp 遮斷。 */}
      <span className="mt-1 line-clamp-2 min-h-[2.5rem] break-words text-xs leading-5 text-slate-600 dark:text-slate-300">{card.summary ?? ""}</span>
    </>
  )
  if (!href) {
    return <div className={`rounded-lg border-2 border-l-[5px] ${palette.border} ${palette.bg} px-3 py-2`}>{body}</div>
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`在 Jira 開啟 ${card.key}（另開分頁）`}
      className={`block rounded-lg border-2 border-l-[5px] ${palette.border} ${palette.bg} px-3 py-2 transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600`}
    >
      {body}
    </a>
  )
}

function ScrumBoardSkeleton() {
  return (
    <div role="status" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <span className="sr-only">正在載入開發任務看板</span>
      {COLUMNS.map((_, i) => (
        <div key={i} aria-hidden="true" className="h-48 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
      ))}
    </div>
  )
}

function ScrumBoardColumnSkeleton() {
  return (
    <li aria-hidden="true">
      <div className="h-14 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
    </li>
  )
}
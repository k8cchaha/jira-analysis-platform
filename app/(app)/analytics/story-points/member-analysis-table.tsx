"use client"

import { useId } from "react"
import { MEMBER_ANALYSIS_CHART_CATEGORIES, summarizeMemberAnalysis, summarizeMemberAnalysisTotal, type MemberAnalysisResult, type MemberAnalysisRow } from "@/lib/member-analysis"
import { memberAnalysisWorkdays, pointsPerWorkday } from "@/lib/member-analysis-calendar"

const number = (value: number) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value)
/** 缺值顯示「—／未填」，不以 0 代替。 */
const points = (value: number | null) => value === null ? "—／未填" : number(value)
const perDay = (value: number | null) => value === null ? "—／不適用" : number(Math.round(value * 100) / 100)

/** 四大類的橫向長條（單位 SP），共用同一把尺，方便跨成員比較。 */
function CategoryBars({ row, scale }: { row: MemberAnalysisRow; scale: number }) {
  return <div className="w-[180px] space-y-1" role="img" aria-label={MEMBER_ANALYSIS_CHART_CATEGORIES.map((category) => `${category.label} ${number(row.categories.find((entry) => entry.id === category.id)?.points ?? 0)} SP`).join("、")}>
    {MEMBER_ANALYSIS_CHART_CATEGORIES.map((category) => {
      const value = row.categories.find((entry) => entry.id === category.id)?.points ?? 0
      return <div key={category.id} className="flex items-center gap-2 text-[11px] leading-3">
        <span className="w-9 shrink-0 text-slate-500 dark:text-slate-400">{category.label}</span>
        <span className="relative h-2.5 flex-1 rounded bg-slate-100 dark:bg-slate-800">
          <span className={`absolute inset-y-0 left-0 rounded ${category.className}`} style={{ width: `${scale > 0 ? Math.min(100, value / scale * 100) : 0}%` }} />
        </span>
        <span className="w-9 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-300">{number(value)}</span>
      </div>
    })}
  </div>
}

/** 四大類 SP 比例的圓餅圖（SVG，無外部套件）。 */
function CategoryPie({ row }: { row: MemberAnalysisRow }) {
  const slices = row.categories.filter((entry) => entry.points > 0)
  const total = slices.reduce((sum, entry) => sum + entry.points, 0)
  const radius = 22, circumference = 2 * Math.PI * radius
  // Each slice starts where the previous ones ended; computed up front so render never mutates shared state.
  const offsets = slices.map((_, index) => slices.slice(0, index).reduce((sum, entry) => sum + entry.points / total * circumference, 0))
  const label = slices.map((entry) => `${MEMBER_ANALYSIS_CHART_CATEGORIES.find((category) => category.id === entry.id)!.label} ${Math.round(entry.points / total * 1000) / 10}%`).join("、")
  return <div className="flex items-start gap-2">
    {total > 0 ? <svg viewBox="0 0 52 52" className="mt-[2px] h-[52px] w-[52px] shrink-0 -rotate-90" role="img" aria-label={label}>
      <circle cx="26" cy="26" r={radius} fill="none" strokeWidth="10" className="stroke-slate-100 dark:stroke-slate-800" />
      {slices.map((entry, index) => {
        const length = entry.points / total * circumference
        return <circle key={entry.id} cx="26" cy="26" r={radius} fill="none" strokeWidth="10" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offsets[index]} style={{ stroke: MEMBER_ANALYSIS_CHART_CATEGORIES.find((category) => category.id === entry.id)!.color }} />
      })}
    </svg> : <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">無 SP</span>}
    {total > 0
      // Same rhythm as the bars: a fixed label column per category, one line each, so the text lines up beside them.
      ? <span className="w-[92px] space-y-1 text-[11px] leading-3 text-slate-600 dark:text-slate-300">
        {slices.map((entry) => <span key={entry.id} className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-slate-500 dark:text-slate-400">{MEMBER_ANALYSIS_CHART_CATEGORIES.find((category) => category.id === entry.id)!.label}</span>
          <span className="flex-1 text-right tabular-nums">{Math.round(entry.points / total * 1000) / 10}%</span>
        </span>)}
      </span>
      : <span className="text-[11px] leading-4 text-slate-600 dark:text-slate-300">—／不適用</span>}
  </div>
}

/**
 * 成員分析結果表：Y 軸為成員，X 軸為張數、SP、Actual SP、SP/日、Actual SP/日、Type 比重（四大類橫條＋圓餅）。
 * Type 比重以 SP 計；Pre-Spike 併入 Spike、OP-Task 與 OP-Bug 併入 OP，未分類不畫。
 */
export function MemberAnalysisTable({ result }: { result: MemberAnalysisResult }) {
  const id = useId()
  const rows = summarizeMemberAnalysis(result.issues)
  const total = summarizeMemberAnalysisTotal(result.issues)
  const workdays = memberAnalysisWorkdays(result)
  const scale = Math.max(1, ...rows.flatMap((row) => row.categories.map((entry) => entry.points)))
  return <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900" aria-label="成員分析結果">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold">成員分析 ({result.from} ～ {result.to})</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">共 {number(result.issues.length)} 張 resolved Dev-Task · 工作日：{number(workdays)} 天</p>
    </div>
    {rows.length === 0 ? <p role="status" className="mt-4 text-sm text-slate-600 dark:text-slate-300">此區間沒有符合條件的 Dev-Task。</p> : <>
      <div className="mt-4 min-w-0 overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-sm">
        <caption className="sr-only">成員分析：每位成員的張數、Story Points、Actual Story Points、SP/日與 Dev Type 比重</caption>
        <thead className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <tr><th scope="col" className="px-3 py-3">Members</th><th scope="col" className="px-3 py-3 text-right">張數</th><th scope="col" className="px-3 py-3 text-right">SP 點數</th><th scope="col" className="px-3 py-3 text-right">Actual SP 點數</th><th scope="col" className="px-3 py-3 text-right">SP/日</th><th scope="col" className="px-3 py-3 text-right">Actual SP/日</th><th scope="col" className="px-3 py-3">Type 比重（SP）</th><th scope="col" className="px-3 py-3">比例</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map((row) => <tr key={row.accountId ?? "unassigned"}>
            <th scope="row" className="px-3 py-3 font-medium">{row.displayName}</th>
            <td className="px-3 py-3 text-right tabular-nums">{number(row.count)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{points(row.points)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{points(row.actualPoints)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{perDay(pointsPerWorkday(row.points, workdays))}</td>
            <td className="px-3 py-3 text-right tabular-nums">{perDay(pointsPerWorkday(row.actualPoints, workdays))}</td>
            <td className="px-3 py-3"><CategoryBars row={row} scale={scale} /></td>
            <td className="px-3 py-3"><CategoryPie row={row} /></td>
          </tr>)}
        </tbody>
        {total && <tfoot><tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-600">
          <th scope="row" className="px-3 py-3">合計</th>
          <td className="px-3 py-3 text-right tabular-nums">{number(total.count)}</td>
          <td className="px-3 py-3 text-right tabular-nums">{points(total.points)}</td>
          <td className="px-3 py-3 text-right tabular-nums">{points(total.actualPoints)}</td>
          <td className="px-3 py-3 text-right tabular-nums">{perDay(pointsPerWorkday(total.points, workdays))}</td>
          <td className="px-3 py-3 text-right tabular-nums">{perDay(pointsPerWorkday(total.actualPoints, workdays))}</td>
          <td className="px-3 py-3"><CategoryBars row={total} scale={Math.max(scale, ...total.categories.map((entry) => entry.points))} /></td>
          <td className="px-3 py-3"><CategoryPie row={total} /></td>
        </tr></tfoot>}
      </table></div>
      <details className="mt-4 min-w-0 text-xs text-slate-500 dark:text-slate-400">
        <summary className="min-h-9 cursor-pointer py-2">本次查詢的 JQL 與計算方式</summary>
        <p className="mt-2 break-words font-mono" id={`${id}-jql`}>{result.jql}</p>
        <p className="mt-2">Type 比重以 SP 計：Pre-Spike 併入 Spike、OP-Task 與 OP-Bug 併入 OP；未分類不列入。SP/日與 Actual SP/日＝各自加總 ÷ 工作日，工作日為區間內扣除週末與國定假日後的天數。</p>
      </details>
    </>}
  </section>
}

import type { ReactNode } from "react"

export function PendingIssueCard({ inReviewCount = null, requestInfoCount = null, loading = false, feedback = null, onOpen }: { inReviewCount?: number | null; requestInfoCount?: number | null; loading?: boolean; feedback?: ReactNode; onOpen?: () => void }) {
  const clickable = Boolean(onOpen && !loading && !feedback && inReviewCount !== null && requestInfoCount !== null && inReviewCount + requestInfoCount > 0)
  const border = loading || feedback || inReviewCount === null || requestInfoCount === null
    ? "border-slate-200 dark:border-slate-800"
    : inReviewCount === 0 && requestInfoCount === 0
      ? "border-green-500 dark:border-green-400"
      : "border-blue-500 dark:border-blue-400"
  return (
    <article aria-label="Issue 待處理" aria-busy={loading || undefined} className={`relative flex min-w-0 flex-col rounded-2xl border-2 bg-white p-5 shadow-sm sm:p-6 dark:bg-slate-900 ${border}`}>
      <h3 className="flex items-center gap-2 text-base font-semibold text-blue-600 dark:text-blue-400">
        <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-blue-500 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v2" /><circle cx="16" cy="16" r="6" /><path d="M16 13v3l2 1" /></svg>
        Issue 待處理
      </h3>
      {feedback || <ul className="mt-5 divide-y divide-slate-200 dark:divide-slate-800">
        <li className="pb-4">
          <h4 className="text-sm font-medium text-slate-950 dark:text-white">In Review</h4>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{inReviewCount === null || loading ? "載入中…" : `${inReviewCount.toLocaleString("zh-TW")} 張 Issue`}</p>
        </li>
        <li className="pt-4">
          <h4 className="text-sm font-medium text-slate-950 dark:text-white">Request Info</h4>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{requestInfoCount === null || loading ? "載入中…" : `${requestInfoCount.toLocaleString("zh-TW")} 張 Issue`}</p>
        </li>
      </ul>}
      {clickable && <button type="button" aria-label="查看 Issue 待處理明細" aria-haspopup="dialog" onClick={onOpen} className="absolute inset-0 cursor-pointer rounded-2xl transition-colors hover:bg-blue-50/40 active:bg-blue-100/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:hover:bg-blue-950/20 dark:active:bg-blue-900/30" />}
    </article>
  )
}

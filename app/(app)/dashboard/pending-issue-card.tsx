export function PendingIssueCard({ inReviewCount = null, requestInfoCount = null }: { inReviewCount?: number | null; requestInfoCount?: number | null }) {
  const border = inReviewCount === null || requestInfoCount === null
    ? "border-slate-200 dark:border-slate-800"
    : inReviewCount === 0 && requestInfoCount === 0
      ? "border-green-500 dark:border-green-400"
      : "border-yellow-500 dark:border-yellow-400"
  return (
    <article aria-label="Issue 待處理" className={`flex min-w-0 flex-col rounded-2xl border-2 bg-white p-5 shadow-sm sm:p-6 dark:bg-slate-900 ${border}`}>
      <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
        <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v2" /><circle cx="16" cy="16" r="6" /><path d="M16 13v3l2 1" /></svg>
        Issue 待處理
      </h3>
      <ul className="mt-5 divide-y divide-slate-200 dark:divide-slate-800">
        <li className="pb-4">
          <h4 className="text-sm font-medium text-slate-950 dark:text-white">In Review</h4>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{inReviewCount === null ? "待設定查詢" : `${inReviewCount.toLocaleString("zh-TW")} 張 Issue`}</p>
        </li>
        <li className="pt-4">
          <h4 className="text-sm font-medium text-slate-950 dark:text-white">Request Info</h4>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{requestInfoCount === null ? "待設定查詢" : `${requestInfoCount.toLocaleString("zh-TW")} 張 Issue`}</p>
        </li>
      </ul>
    </article>
  )
}

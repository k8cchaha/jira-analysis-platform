export function BugAlertCard({ s0s1Count = null, s2Count = null }: { s0s1Count?: number | null; s2Count?: number | null }) {
  const border = s0s1Count === null || s2Count === null
    ? "border-slate-200 dark:border-slate-800"
    : s0s1Count === 0 && s2Count === 0
      ? "border-green-500 dark:border-green-400"
      : "border-red-500 dark:border-red-400"
  return (
    <article aria-label="Bug 警示" className={`flex min-w-0 flex-col rounded-2xl border-2 bg-white p-5 shadow-sm sm:p-6 dark:bg-slate-900 ${border}`}>
      <h3 className="flex items-center gap-2 text-base font-semibold text-red-600 dark:text-red-400">
        <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-yellow-500 dark:text-yellow-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 10 18H2Z" /><path d="M12 9v5M12 17h.01" /></svg>
        Bug 警示
      </h3>
      <ul className="mt-5 divide-y divide-slate-200 dark:divide-slate-800">
        <li className="pb-4">
          <h4 className="text-sm font-medium text-slate-950 dark:text-white">S0／S1</h4>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{s0s1Count === null ? "待設定查詢" : `${s0s1Count.toLocaleString("zh-TW")} 張 Issue`}</p>
        </li>
        <li className="pt-4">
          <h4 className="text-sm font-medium text-slate-950 dark:text-white">S2 超過10天未更新</h4>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{s2Count === null ? "待設定查詢" : `${s2Count.toLocaleString("zh-TW")} 張 Issue`}</p>
        </li>
      </ul>
    </article>
  )
}

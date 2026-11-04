"use client"

/** 建構 Jira issue search 深連結（UI 導覽 href，非資料查詢）；JQL 由 `jira-jql.ts` 提供。 */
export function jiraSearchHref(jiraBaseUrl: string, jql: string): string {
  const base = jiraBaseUrl.replace(/\/$/, "")
  return `${base}/issues/?jql=${encodeURIComponent(jql)}`
}

/** 圓形 Jira 開啟按鈕：hover 卡片區塊時於右側（垂直置中）顯現，點擊用 Jira 開啟該區塊的查詢。 */
export function JiraOpenLink({ jiraBaseUrl, jql, label }: { jiraBaseUrl: string | null; jql: string; label: string }) {
  if (!jiraBaseUrl || !jql) return null
  return (
    <a
      href={jiraSearchHref(jiraBaseUrl, jql)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`用 Jira 開啟「${label}」查詢（另開分頁）`}
      title="用 Jira 開啟此查詢"
      className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 opacity-0 shadow-sm ring-1 ring-blue-600 transition-[opacity,background-color,box-shadow,color] duration-200 hover:bg-blue-600 hover:text-white hover:shadow-md hover:ring-blue-600 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 group-hover:opacity-100 dark:bg-slate-800 dark:text-slate-400 dark:ring-blue-500 dark:hover:bg-blue-600 dark:hover:text-white dark:hover:ring-blue-600"
    >
      <JiraIcon />
    </a>
  )
}

/** Jira 品牌縮寫記號；填色跟隨 currentColor。 */
function JiraIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z" />
    </svg>
  )
}
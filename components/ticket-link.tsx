/**
 * Issue 的 Ticket 連結：有 Jira base URL 時連到 Jira browse 頁（另開分頁），否則只顯示
 * Ticket（單號）。Planning 頁的彈窗、任務分派狀況展開清單、任務規劃總覽共用。
 * 只取 `key`，任何帶 key 的 DTO 都可用。
 */
export function TicketLink({
  task,
  jiraBaseUrl,
}: {
  task: { key: string }
  jiraBaseUrl: string | null
}) {
  if (jiraBaseUrl) {
    return (
      <a
        href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(task.key)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`在 Jira 開啟 ${task.key}（另開分頁）`}
        className="break-words font-medium text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300"
      >
        {task.key}
      </a>
    )
  }
  return <span className="break-words font-medium">{task.key}</span>
}
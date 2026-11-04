/**
 * Issue 的 Ticket 連結：有 Jira base URL 時連到 Jira browse 頁（另開分頁），否則只顯示
 * Ticket（單號）。Planning 頁的彈窗、任務分派狀況展開清單、任務規劃總覽共用。
 * 只取 `key`（＋可選的 `issueType`），任何帶 key 的 DTO 都可用。
 *
 * 著色：QA-Task 工作單顯示淡紅色（與 Dev-Task 的藍色區分）；其餘維持預設藍色連結。
 */
export function TicketLink({
  task,
  jiraBaseUrl,
}: {
  task: { key: string; issueType?: string | null }
  jiraBaseUrl: string | null
}) {
  const isQATask = task.issueType === "QA-Task"
  if (jiraBaseUrl) {
    return (
      <a
        href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(task.key)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`在 Jira 開啟 ${task.key}（另開分頁）`}
        className={`break-words font-medium hover:underline focus-visible:outline-2 ${
          isQATask
            ? "text-[#FF6670] focus-visible:outline-[#FF6670] dark:text-[#FF6670]"
            : "text-blue-600 focus-visible:outline-blue-600 dark:text-blue-300"
        }`}
      >
        {task.key}
      </a>
    )
  }
  return <span className="break-words font-medium">{task.key}</span>
}
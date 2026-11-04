/**
 * Issue 狀態的文字顏色（純函數）。全站狀態顯示共用，避免各彈窗各自複製同一份
 * 顏色對應：In Review / In Progress 藍、Done 綠、其餘預設。
 */
export function statusColorClass(status: string | null): string {
  const value = status?.toLowerCase()
  if (value === "in review" || value === "in progress") {
    return "text-blue-600 dark:text-blue-300"
  }
  if (value === "done") {
    return "text-green-600 dark:text-green-400"
  }
  return "text-slate-600 dark:text-slate-300"
}
"use server"

import { auth, signIn } from "@/auth"
import { dashboardError, updateMissingData } from "@/lib/jira-dashboard"
import { dashboardReturnPath } from "@/lib/jira-dashboard-filter"
import {
  parseMissingDataChanges,
  type MissingDataActionState,
  type MissingDataKind,
} from "@/lib/jira-missing-data"

export async function updateMissingDataAction(
  kind: MissingDataKind,
  _previousState: MissingDataActionState,
  formData: FormData
): Promise<MissingDataActionState> {
  const rawId = formData.get("submissionId")
  const submissionId = typeof rawId === "string" && rawId.length <= 10_000 ? rawId : null
  const errorState = (message: string): MissingDataActionState => ({
    submissionId, status: "error", message, succeededIssueIds: [], failures: [],
  })
  if (formData.getAll("mode").length > 1 || (formData.has("mode") && formData.get("mode") !== "self") || ["accountId", "group", "project", "exclude", "days"].some((key) => formData.has(key))) return errorState("只有自己模式可以補填資料。")
  if (kind !== "points" && kind !== "defect-cause") return errorState("不支援此更新類型。")
  const session = await auth()
  if (!session?.user?.id) return errorState("登入狀態已失效，請重新登入。")
  let changes
  try {
    changes = parseMissingDataChanges(kind, formData.get("changes"))
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "變更資料格式錯誤。")
  }
  try {
    const result = await updateMissingData(kind, changes)
    const succeeded = result.succeededIssueIds.length
    const failed = result.failures.length
    return {
      submissionId,
      status: failed === 0 ? "success" : succeeded > 0 ? "partial" : "error",
      message: failed === 0
        ? `已更新 ${succeeded} 張 Issue。`
        : `已更新 ${succeeded} 張，另有 ${failed} 張未更新；草稿已保留，請查看各列提示。`,
      ...result,
    }
  } catch (error) {
    return errorState(dashboardError(error).message)
  }
}

export async function reauthorizeDashboardAction(returnPath = "/dashboard") {
  const redirectTo = dashboardReturnPath(returnPath)
  await signIn("atlassian", { redirectTo })
}

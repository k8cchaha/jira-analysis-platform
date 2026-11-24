import { auth } from "@/auth"
import { parseMemberAnalysisParams } from "@/lib/member-analysis-filter"
import { getMemberAnalysis } from "@/lib/jira-member-analysis"
import { JiraWorkloadError } from "@/lib/jira-workload"
import { JiraAuthorizationError } from "@/lib/jira-token"
import { DashboardFilterError } from "@/lib/jira-dashboard-filter"
import { JiraDashboardError } from "@/lib/jira-dashboard"

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }

/**
 * 成員分析查詢：參數與頁面共用 `parseMemberAnalysisParams`，授權、scope 與 JQL
 * 都在服務層完成。一次完整分頁後回傳逐張 Dev-Task，前端只做彙總。
 */
export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json({ status: "error", error: { code: "reauthorize", message: "登入狀態已失效，請重新登入。" } }, { status: 401, headers })
    }
    let parsed
    try {
      parsed = parseMemberAnalysisParams(new URL(request.url).searchParams)
    } catch (error) {
      return Response.json({ status: "error", error: { code: "configuration", message: error instanceof Error ? error.message : "查詢參數無效。" } }, { status: 400, headers })
    }
    if (!parsed) {
      return Response.json({ status: "error", error: { code: "configuration", message: "請先選擇團隊與分析區間。" } }, { status: 400, headers })
    }
    const data = await getMemberAnalysis(parsed.filter, parsed.range)
    return Response.json({ status: "success", data }, { headers })
  } catch (error) {
    const mapped = failure(error)
    const status = mapped.code === "reauthorize" ? 401 : mapped.code === "limit" || mapped.code === "configuration" ? 400 : 502
    return Response.json({ status: "error", error: mapped }, { status, headers })
  }
}

function failure(error: unknown): { code: string; message: string } {
  if (error instanceof JiraAuthorizationError) return { code: "reauthorize", message: "Jira 授權已失效，請重新授權。" }
  if (error instanceof JiraWorkloadError) return { code: error.code, message: error.message }
  if (error instanceof DashboardFilterError) return { code: "configuration", message: error.message }
  if (error instanceof JiraDashboardError) return { code: error.code, message: error.message }
  return { code: "request_failed", message: "暫時無法取得成員分析資料，請稍後重試。" }
}

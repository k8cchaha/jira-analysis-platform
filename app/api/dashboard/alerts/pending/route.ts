import { auth } from "@/auth"
import { dashboardError } from "@/lib/jira-dashboard"
import { getPendingIssueDetails } from "@/lib/jira-dashboard-alerts-server"
import { DashboardFilterError, parseDashboardFilter } from "@/lib/jira-dashboard-filter"

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }
  try {
    const session = await auth()
    if (!session?.user?.id) return Response.json({ status: "error", error: { code: "reauthorize", message: "登入狀態已失效，請重新登入。" } }, { status: 401, headers })
    const filter = parseDashboardFilter(new URL(request.url).searchParams)
    return Response.json({ status: "success", data: await getPendingIssueDetails(filter) }, { headers })
  } catch (error) {
    const result = dashboardError(error)
    const status = error instanceof DashboardFilterError ? 400 : result.code === "reauthorize" ? 401 : result.code === "forbidden" ? 403 : 502
    return Response.json({ status: "error", error: result }, { status, headers })
  }
}

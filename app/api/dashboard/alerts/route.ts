import { auth } from "@/auth"
import { dashboardError } from "@/lib/jira-dashboard"
import { getDashboardAlertCounts } from "@/lib/jira-dashboard-alerts-server"
import { DashboardFilterError, parseDashboardFilter } from "@/lib/jira-dashboard-filter"

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json({ status: "error", error: { code: "reauthorize", message: "登入狀態已失效，請重新登入。" } }, { status: 401, headers })
    }
    const params = new URL(request.url).searchParams
    const kind = params.get("kind")
    if ((kind !== "bugs" && kind !== "pending" && kind !== "due") || params.getAll("kind").length !== 1) {
      return Response.json({ status: "error", error: { code: "configuration", message: "查詢參數無效。" } }, { status: 400, headers })
    }
    const filter = parseDashboardFilter(params, ["kind"])
    return Response.json({ status: "success", kind, counts: await getDashboardAlertCounts(kind, filter) }, { headers })
  } catch (error) {
    const result = dashboardError(error)
    const status = error instanceof DashboardFilterError ? 400 : result.code === "reauthorize" ? 401 : result.code === "forbidden" ? 403 : 502
    return Response.json({ status: "error", error: result }, { status, headers })
  }
}

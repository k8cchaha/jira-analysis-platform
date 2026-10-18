import { auth } from "@/auth"
import { dashboardError, getMissingDataPage, getMissingDataSummary } from "@/lib/jira-dashboard"
import { DashboardFilterError, parseDashboardFilter } from "@/lib/jira-dashboard-filter"

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json({ status: "error", error: { code: "reauthorize", message: "登入狀態已失效，請重新登入。" } }, { status: 401, headers })
    }
    const url = new URL(request.url)
    const kind = url.searchParams.get("kind")
    const view = url.searchParams.get("view")
    if ((kind !== "points" && kind !== "defect-cause") || (view !== "summary" && view !== "page")) {
      return Response.json({ status: "error", error: { code: "configuration", message: "查詢參數無效。" } }, { status: 400, headers })
    }
    if (["kind", "view", "pageToken"].some((key) => url.searchParams.getAll(key).length > 1)) {
      return Response.json({ status: "error", error: { code: "configuration", message: "查詢參數無效。" } }, { status: 400, headers })
    }
    const filter = parseDashboardFilter(url.searchParams, ["kind", "view", "pageToken"])
    if (view === "summary") {
      return Response.json({ status: "success", summary: await getMissingDataSummary(kind, filter) }, { headers })
    }
    const data = await getMissingDataPage(kind, url.searchParams.get("pageToken"), filter)
    return Response.json({ status: "success", data }, { headers })
  } catch (error) {
    const result = dashboardError(error)
    const status = error instanceof DashboardFilterError ? 400 : result.code === "reauthorize" ? 401 : result.code === "forbidden" ? 403 : result.code === "invalid_page" ? 400 : 502
    return Response.json({ status: "error", error: result }, { status, headers })
  }
}

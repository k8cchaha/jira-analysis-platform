import { auth } from "@/auth"
import { dashboardError } from "@/lib/jira-dashboard"
import { getScrumBoardData } from "@/lib/jira-scrum-board-server"
import { DashboardFilterError, parseDashboardFilter } from "@/lib/jira-dashboard-filter"

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json({ status: "error", error: { code: "reauthorize", message: "登入狀態已失效，請重新登入。" } }, { status: 401, headers })
    }
    const url = new URL(request.url)
    // `boardDays` 是看板自己的「近 X 天」參數；命名避開 filter 的 `days`，且不當 filter key。
    if (url.searchParams.getAll("boardDays").length > 1) {
      return Response.json({ status: "error", error: { code: "configuration", message: "查詢參數無效。" } }, { status: 400, headers })
    }
    const filter = parseDashboardFilter(url.searchParams, ["boardDays"])
    const rawBoardDays = url.searchParams.get("boardDays")
    // `boardDays` 參數存在＝套看板「近 X 天」；缺失＝不套（依 scope 顯示 active Dev-Task）。
    const boardDays = rawBoardDays === null ? null : parseDays(rawBoardDays)
    return Response.json({ status: "success", data: await getScrumBoardData(filter, boardDays) }, { headers })
  } catch (error) {
    const result = dashboardError(error)
    const status = error instanceof DashboardFilterError ? 400 : result.code === "reauthorize" ? 401 : result.code === "forbidden" ? 403 : 502
    return Response.json({ status: "error", error: result }, { status, headers })
  }
}

/** 把 query 的 boardDays 轉成正整數；非法值拋 DashboardFilterError。 */
function parseDays(value: string): number {
  const days = Number(value)
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(days)) {
    throw new DashboardFilterError("近 X 天必須是大於 0 的整數。")
  }
  return days
}
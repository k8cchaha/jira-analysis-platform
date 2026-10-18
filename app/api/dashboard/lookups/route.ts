import { auth } from "@/auth"
import { DASHBOARD_TEAMS, DashboardFilterError } from "@/lib/jira-dashboard-filter"
import { getDashboardGroupMembers, lookupError, searchDashboardUsers, validateDashboardUserQuery } from "@/lib/jira-dashboard-lookups"
import { getJiraToken } from "@/lib/jira-token"

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json({ status: "error", error: { code: "reauthorize", message: "登入狀態已失效，請重新登入。" } }, { status: 401, headers })
    }
    const params = new URL(request.url).searchParams
    if (params.toString().length > 2_048 || [...params].length !== 2 || params.getAll("view").length !== 1) throw new DashboardFilterError()
    const view = params.get("view")
    if (view === "users") {
      if ([...params.keys()].some((key) => key !== "view" && key !== "query") || params.getAll("query").length !== 1) throw new DashboardFilterError()
      const query = validateDashboardUserQuery(params.get("query")!)
      const credentials = await getJiraToken()
      return Response.json({ status: "success", users: await searchDashboardUsers(query, credentials) }, { headers })
    }
    if (view === "group") {
      if ([...params.keys()].some((key) => key !== "view" && key !== "group") || params.getAll("group").length !== 1) throw new DashboardFilterError()
      const group = params.get("group")!
      if (!DASHBOARD_TEAMS.some((team) => team.group === group)) throw new DashboardFilterError("請選擇有效的團隊。")
      const credentials = await getJiraToken()
      return Response.json({ status: "success", members: await getDashboardGroupMembers(group, credentials) }, { headers })
    }
    throw new DashboardFilterError()
  } catch (error) {
    const result = lookupError(error)
    const status = result.code === "reauthorize" ? 401 : result.code === "forbidden" ? 403 : result.code === "invalid_page" || result.code === "limit" ? 400 : 502
    return Response.json({ status: "error", error: result }, { status, headers })
  }
}

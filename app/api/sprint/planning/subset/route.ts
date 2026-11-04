import { auth } from "@/auth"
import { parseProjectKey, parseSprintId, resolvePlanningSprint } from "@/lib/burndown-params"
import {
  getPlanningSubset,
  JiraPlanningError,
  type PlanningSubsetKind,
} from "@/lib/planning-data"
import type { MissingDataError } from "@/lib/jira-missing-data"

const SUBSET_KINDS: readonly PlanningSubsetKind[] = ["unestimated", "unassigned", "no-subtasks"]

/** 把 Planning 的服務層錯誤轉成 HTTP 狀態 + `MissingDataError` envelope。 */
function planningError(error: unknown): { status: number; error: MissingDataError } {
  if (error instanceof JiraPlanningError) {
    if (error.code === "reauthorize") {
      return { status: 401, error: { code: "reauthorize", message: error.message } }
    }
    return { status: 502, error: { code: error.code === "limit" ? "limit" : "retry", message: error.message } }
  }
  return { status: 502, error: { code: "retry", message: "暫時無法取得 Jira 資料，請稍後重試。" } }
}

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }
  const params = new URL(request.url).searchParams
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json({ status: "error", error: { code: "reauthorize", message: "登入狀態已失效，請重新登入。" } }, { status: 401, headers })
    }

    for (const key of ["project", "sprint", "kind"]) {
      if (params.getAll(key).length > 1) {
        return Response.json({ status: "error", error: { code: "configuration", message: "查詢參數無效。" } }, { status: 400, headers })
      }
    }

    const project = parseProjectKey(params.get("project") ?? undefined)
    const sprintId = parseSprintId(params.get("sprint") ?? undefined)
    const kind = params.get("kind") as PlanningSubsetKind | null
    if (!project || kind === null || !SUBSET_KINDS.includes(kind)) {
      return Response.json({ status: "error", error: { code: "configuration", message: "查詢參數無效。" } }, { status: 400, headers })
    }
    const sprint = resolvePlanningSprint(project, sprintId, new Date().toISOString().slice(0, 10))
    if (sprint === null) {
      return Response.json({ status: "error", error: { code: "configuration", message: "查詢參數無效。" } }, { status: 400, headers })
    }

    const { tasks } = await getPlanningSubset(sprint, kind)
    return Response.json({ status: "success", data: { tasks } }, { headers })
  } catch (error) {
    const { status, error: mapped } = planningError(error)
    return Response.json({ status: "error", error: mapped }, { status, headers })
  }
}
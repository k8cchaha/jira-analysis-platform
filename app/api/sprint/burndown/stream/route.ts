import { auth } from "@/auth"
import {
  getJiraToken,
  JiraAuthorizationError,
} from "@/lib/jira-token"
import {
  getBurndownBase,
  iterateDoneDays,
  JiraBurndownError,
} from "@/lib/jira-burndown"
import { JiraDashboardError } from "@/lib/jira-dashboard"
import {
  getSprintById,
  parseProjectKey,
  parseSprintId,
} from "@/lib/burndown-params"
import {
  streamBurndownEvents,
  type BurndownEventSink,
  type BurndownStreamError,
} from "@/lib/burndown-stream"

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
}

/**
 * Burn Down 圖的漸進式 SSE 路由。
 *
 * 送出順序：`event: base`（steps 1+2 → 畫出圖表骨架）→ `event: day` × N
 * （逐日 completed Dev-Task，client 逐日把實際線/長條「長」上去）→
 * `event: done`。任一天中途拋錯 → `event: error` ＋ close，不偽裝 done。
 *
 * **fail-fast 規則**：auth、參數、credential，以及 `getBurndownBase`
 * （steps 1+2）都在開流前完成，其錯誤能以正常 HTTP 狀態碼回；開流之後
 * （step 3）的錯誤只能以 SSE error event 傳達，因為 headers/status 在送
 * 第一個 frame 後即鎖死。
 */
export async function GET(request: Request) {
  const baseHeaders = { ...SSE_HEADERS }
  const errorHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" }
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json(
        { status: "error", error: { code: "reauthorize", message: "登入狀態已失效，請重新登入。" } },
        { status: 401, headers: errorHeaders }
      )
    }

    const url = new URL(request.url)
    const project = parseProjectKey(url.searchParams.get("project") ?? undefined)
    const requestedSprintId = parseSprintId(
      url.searchParams.get("sprint") ?? undefined
    )
    if (!project) {
      return Response.json(
        { status: "error", error: { code: "configuration", message: "查詢參數無效。" } },
        { status: 400, headers: errorHeaders }
      )
    }
    const sprint =
      requestedSprintId !== null
        ? getSprintById(project, requestedSprintId)
        : null
    if (!sprint) {
      return Response.json(
        { status: "error", error: { code: "configuration", message: "查詢參數無效。" } },
        { status: 400, headers: errorHeaders }
      )
    }

    // 開流前建立 credential（refresh 提供長續串流內再簽發的可能性），並撈 base。
    // 兩者的錯誤都還能在開流前以 HTTP 狀態碼回傳。
    const credentials = await getJiraToken(true)
    const today = new Date().toISOString().slice(0, 10)
    const base = await getBurndownBase(sprint, today, credentials)

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sink: BurndownEventSink = {
          enqueue: (frame) => controller.enqueue(encoder.encode(frame)),
          close: () => {
            try {
              controller.close()
            } catch {
              // 已被 abort/error 接管時 close 會拋，忽略即可。
            }
          },
        }
        const dayIterator = iterateDoneDays(
          base.sprint,
          today,
          credentials,
          base.parentKeys
        )
        await streamBurndownEvents(
          sink,
          base,
          dayIterator,
          mapBurndownStreamError
        )
      },
    })

    return new Response(stream, { status: 200, headers: baseHeaders })
  } catch (error) {
    const mapped = mapBurndownStreamError(error)
    const status = mapped.code === "reauthorize" ? 401 : 502
    return Response.json(
      { status: "error", error: mapped },
      { status, headers: errorHeaders }
    )
  }
}

/** 把開流前/串流中的錯誤統一映射成 SSE `error` payload（code + message）。 */
function mapBurndownStreamError(error: unknown): BurndownStreamError {
  if (error instanceof JiraAuthorizationError) {
    if (error.code === "invalid_configuration") {
      return { code: "request_failed", message: "Jira OAuth 設定不完整，請聯繫管理員。" }
    }
    return { code: "reauthorize", message: "Jira 授權已失效，請重新授權。" }
  }
  if (error instanceof JiraBurndownError) {
    return { code: error.code, message: error.message }
  }
  // step-3 逐日查詢的錯誤（jira-dashboard 的 fetch／分頁），沿用其 code。
  if (error instanceof JiraDashboardError) {
    return { code: error.code, message: error.message }
  }
  return { code: "request_failed", message: "暫時無法取得燃盡圖資料，請稍後重試。" }
}
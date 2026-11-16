import { auth } from "@/auth"
import {
  getJiraToken,
  JiraAuthorizationError,
} from "@/lib/jira-token"
import {
  getBurndownBase,
  JiraBurndownError,
} from "@/lib/jira-burndown"
import { JiraDashboardError } from "@/lib/jira-dashboard"
import {
  getSprintById,
  parseProjectKey,
  parseSprintId,
  isValidLegacyByResolved,
} from "@/lib/burndown-params"
import {
  streamBurndownEvents,
  streamErrorResponse,
  type BurndownEventSink,
  type BurndownStreamError,
} from "@/lib/burndown-stream"

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
}

const EMPTY_DAYS = { async *[Symbol.asyncIterator]() {} }

/**
 * 完整載入後一次送出 `base → done`，不再逐日查 Jira 或傳送 day。
 * auth、參數、帳號時區與所有資料分頁都在開流前完成；失敗不送部分 base。
 */
export async function GET(request: Request) {
  const baseHeaders = { ...SSE_HEADERS }
  const errorHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" }
  // EventSource 讀不到非 2xx 的 body，開流前的失敗必須改用 200 + error frame。
  const fail = (error: BurndownStreamError, status: number) =>
    streamErrorResponse(request, error, status, errorHeaders)
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return fail({ code: "reauthorize", message: "登入狀態已失效，請重新登入。" }, 401)
    }

    const url = new URL(request.url)
    const values = url.searchParams.getAll("byResolved")
    if (!isValidLegacyByResolved(values.length === 0 ? undefined : values.length === 1 ? values[0] : values)) {
      return fail({ code: "configuration", message: "舊版完成日期參數無效，請移除 byResolved 後重試。" }, 400)
    }
    const project = parseProjectKey(url.searchParams.get("project") ?? undefined)
    const requestedSprintId = parseSprintId(
      url.searchParams.get("sprint") ?? undefined
    )
    if (!project) {
      return fail({ code: "configuration", message: "查詢參數無效。" }, 400)
    }
    const sprint =
      requestedSprintId !== null
        ? getSprintById(project, requestedSprintId)
        : null
    if (!sprint) {
      return fail({ code: "configuration", message: "查詢參數無效。" }, 400)
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
        await streamBurndownEvents(
          sink,
          base,
          EMPTY_DAYS,
          mapBurndownStreamError
        )
      },
    })

    return new Response(stream, { status: 200, headers: baseHeaders })
  } catch (error) {
    const mapped = mapBurndownStreamError(error)
    const status = mapped.code === "reauthorize" ? 401 : 502
    return fail(mapped, status)
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
  // 完整 search 的 fetch／分頁錯誤，沿用其 code。
  if (error instanceof JiraDashboardError) {
    return { code: error.code, message: error.message }
  }
  return { code: "request_failed", message: "暫時無法取得燃盡圖資料，請稍後重試。" }
}
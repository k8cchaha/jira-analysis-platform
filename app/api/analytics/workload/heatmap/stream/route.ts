import { auth } from "@/auth"
import { JiraAuthorizationError } from "@/lib/jira-token"
import {
  getWorkloadHeatmapBase,
  workloadScope,
  JiraWorkloadError,
} from "@/lib/jira-workload"
import { JiraDashboardError } from "@/lib/jira-dashboard"
import { DashboardFilterError } from "@/lib/jira-dashboard-filter"
import { parseWorkloadFilter } from "@/lib/workload-filter"
import { analysisCalendarDate } from "@/lib/workload-heatmap"
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

/**
 * Dashboard serializer 只在日期等於 30 時才省略 `days`；區間模型不需寫入天數，
 * 這裡以 30 代入只為通過驗證，實際查詢一律用 `filter.from` / `filter.to`。
 */
const SERIALIZED_DAYS = 30

/**
 * 熱點圖沒有逐日 frame：資料在一次查詢就全部到位，`base` 之後直接 `done`。
 * 沿用 `streamBurndownEvents` 的 framing 不變式，因此傳一個空的 day iterator。
 */
const EMPTY_DAYS: AsyncIterable<never> = { async *[Symbol.asyncIterator]() {} }

/**
 * 工作量熱點圖的 SSE 路由。
 *
 * 送出順序：`event: base`（完成 Dev-Task 的雙點數與缺值清單，完成日已解好）→
 * `event: done`。資料一次查完，沒有逐日 frame——`resolved` 是欄位值而非事件，
 * 逐日查詢換不到額外資訊，只會把一次請求拆成 N 次。
 *
 * **fail-fast 規則**：auth、參數、credential、scope 解析與唯一一次查詢都在開流前
 * 完成。開流之後的錯誤只能以 SSE error event 傳達，因為 headers/status 在送第一個
 * frame 後即鎖死；開流前的錯誤則交由 `streamErrorResponse` 決定要以 HTTP 狀態碼或
 * SSE frame 送出（見該函式說明：`EventSource` 讀不到非 2xx 的 body，必須以
 * 200 + error frame 才能顯示原因）。
 */
export async function GET(request: Request) {
  const errorHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" }
  const fail = (error: BurndownStreamError, status: number) =>
    streamErrorResponse(request, error, status, errorHeaders)
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return fail({ code: "reauthorize", message: "登入狀態已失效，請重新登入。" }, 401)
    }

    // 參數驗證與頁面共用 `parseWorkloadFilter`，避免兩地規則不一致。
    // 空參數（無條件）不開流：熱點圖沒有範圍就沒有可畫的內容。
    let filter
    try {
      filter = parseWorkloadFilter(new URL(request.url).searchParams)
    } catch (error) {
      return fail(
        {
          code: "configuration",
          message: error instanceof DashboardFilterError ? error.message : "查詢參數無效。",
        },
        400
      )
    }
    if (!filter) {
      return fail({ code: "configuration", message: "查詢參數無效。" }, 400)
    }

    // 開流前取得 credential 並解析已驗證的 scope（`workloadScope` 是授權與範圍的
    // 單一入口，失敗即失敗，不退回 self 或放大範圍），連同唯一一次查詢都在開流前
    // 完成，其錯誤才能以正常 HTTP 狀態碼回傳。
    // 日期上限與完成日同採 UTC+8，避免凌晨將當日任務誤當未來日排除。
    const today = analysisCalendarDate(new Date().toISOString())!
    const { scope, credentials } = await workloadScope({
      mode: "team-project",
      groups: filter.groups,
      exclusions: filter.exclusions,
      projects: filter.projects,
      days: SERIALIZED_DAYS,
    })
    const base = await getWorkloadHeatmapBase(scope, { from: filter.from, to: filter.to }, today, credentials)

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
        await streamBurndownEvents(sink, base, EMPTY_DAYS, mapWorkloadStreamError)
      },
    })

    return new Response(stream, { status: 200, headers: { ...SSE_HEADERS } })
  } catch (error) {
    const mapped = mapWorkloadStreamError(error)
    const status = mapped.code === "reauthorize" ? 401 : mapped.code === "limit" ? 400 : 502
    return fail(mapped, status)
  }
}

/** 把開流前／串流中的錯誤統一映射成 SSE `error` payload（code + message）。 */
function mapWorkloadStreamError(error: unknown): BurndownStreamError {
  if (error instanceof JiraAuthorizationError) {
    if (error.code === "invalid_configuration") {
      return { code: "request_failed", message: "Jira OAuth 設定不完整，請聯繫管理員。" }
    }
    return { code: "reauthorize", message: "Jira 授權已失效，請重新授權。" }
  }
  if (error instanceof JiraWorkloadError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof DashboardFilterError) {
    return { code: "configuration", message: error.message }
  }
  // 逐日查詢的錯誤（jira-dashboard 的 fetch／分頁），沿用其 code。
  if (error instanceof JiraDashboardError) {
    return { code: error.code, message: error.message }
  }
  return { code: "request_failed", message: "暫時無法取得工作量資料，請稍後重試。" }
}
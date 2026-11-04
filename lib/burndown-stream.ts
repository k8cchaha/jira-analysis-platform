/**
 * Burn Down 圖 SSE 串流的最小 framing（純函式，無 I/O、無 `server-only`）。
 *
 * 讓 route（`app/api/sprint/burndown/stream/route.ts`）只是薄薄一層 auth＋
 * fail-fast＋拿到 base＋接 `streamBurndownEvents`；frame 的產出與「base →
 * 逐日 day → done / error」的順序在此可被 vm harness 直接單測，不需真 HTTP。
 */

import type { BurndownTask, BurndownUnestimated } from "./burndown-series"

export interface BurndownBasePayload {
  today: string
  empty: boolean
  totalPoints: number
  tasks: BurndownTask[]
  unestimated: BurndownUnestimated[]
  sprint: { id: number; name: string; startDate: string; endDate: string }
}

export interface BurndownDayEvent {
  date: string
  keys: string[]
}

export interface BurndownStreamError {
  code: string
  message: string
}

/** 把一筆 SSE 事件包成 `event:` + `data:`（單行 JSON）+ `\n\n`。 */
export function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function baseEvent(data: BurndownBasePayload): string {
  return sse("base", data)
}

/** 非燃盡圖資料集的 `base` frame（同一組 framing 規則，payload 由呼叫端決定）。 */
export function sharedBaseEvent<Base>(data: Base): string {
  return sse("base", data)
}

export function dayEvent(data: BurndownDayEvent): string {
  return sse("day", data)
}

export function doneEvent(): string {
  return sse("done", {})
}

export function errorEvent(error: BurndownStreamError): string {
  return sse("error", error)
}

/** 路由 stream 寫入面的最小抽象（`ReadableStreamDefaultController` 的 subset）。 */
export interface BurndownEventSink {
  enqueue(frame: string): void
  close(): void
}

/**
 * 開流前失敗時的回應。
 *
 * **為什麼不能只回非 2xx**：`EventSource` 把任何非 2xx 一律視為連線失敗，
 * 既不讀取 body、也不觸發 `event: error` listener，只會讓 client 落到通用的
 * `onerror`（使用者看到「連線已中斷」，真正原因被丟掉）。
 *
 * 因此：瀏覽器 `EventSource`（`Accept: text/event-stream`）一律以 **200 +
 * `event: error` frame** 回覆，讓訊息確實送達畫面；其他呼叫端（curl、測試、
 * 監控）仍拿到正確的 HTTP 狀態碼與 JSON body，fail-fast 的診斷性留給他們。
 */
export function streamErrorResponse(
  request: Request,
  error: BurndownStreamError,
  status: number,
  errorHeaders: Record<string, string>
): Response {
  const accepts = request.headers.get("accept") ?? ""
  if (accepts.includes("text/event-stream")) {
    return new Response(errorEvent(error), {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform" },
    })
  }
  return Response.json({ status: "error", error }, { status, headers: errorHeaders })
}

/**
 * 依序把 `base`、逐日 `day`、最後 `done` 寫進 sink。
 *
 * - 任一天在串流中拋錯（例如 token 過期、分頁異常）：寫 `error` 並 `close`，
 *   **不寫 done**、不偽裝成功。
 * - `mapError` 由呼叫端（route）注入，把 server 錯誤碼映射到對應的 `{code,
 *   message}`；測試可替換成確定性的 stub。
 * - `close()` 恆在 finally 執行。
 *
 * `base` 以泛型承接，讓燃盡圖以外的資料集（例如工作量熱點圖）共用同一份
 * framing，而不必複製這段「base → day × N → done」的不變式。
 */
export async function streamBurndownEvents<Base>(
  sink: BurndownEventSink,
  base: Base,
  dayIterator: AsyncIterable<BurndownDayEvent>,
  mapError: (error: unknown) => BurndownStreamError
): Promise<void> {
  sink.enqueue(sharedBaseEvent(base))
  try {
    for await (const day of dayIterator) {
      sink.enqueue(dayEvent(day))
    }
    sink.enqueue(doneEvent())
  } catch (error) {
    sink.enqueue(errorEvent(mapError(error)))
  } finally {
    sink.close()
  }
}
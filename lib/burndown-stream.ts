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
 * 依序把 `base`、逐日 `day`、最後 `done` 寫進 sink。
 *
 * - 任一天在串流中拋錯（例如 token 過期、分頁異常）：寫 `error` 並 `close`，
 *   **不寫 done**、不偽裝成功。
 * - `mapError` 由呼叫端（route）注入，把 server 錯誤碼映射到對應的 `{code,
 *   message}`；測試可替換成確定性的 stub。
 * - `close()` 恆在 finally 執行。
 */
export async function streamBurndownEvents(
  sink: BurndownEventSink,
  base: BurndownBasePayload,
  dayIterator: AsyncIterable<BurndownDayEvent>,
  mapError: (error: unknown) => BurndownStreamError
): Promise<void> {
  sink.enqueue(baseEvent(base))
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
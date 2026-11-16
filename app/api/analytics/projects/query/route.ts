import { auth } from "@/auth"
import { getProjectsAnalysis, projectsAnalysisError } from "@/lib/jira-projects-analysis"
import { parseProjectsAnalysisRequest, resolveProjectsAnalysisSprints } from "@/lib/projects-analysis"

const BODY_LIMIT = 16 * 1024
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }
class BodyError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/** Count actual bytes, including bodies without Content-Length; reject malformed UTF-8. */
async function readJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length")
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) throw new BodyError(413, "查詢內容超過 16 KiB 上限。")
  if (!request.body) throw new BodyError(400, "查詢內容無效。")
  const reader = request.body.getReader()
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener("abort", cancel, { once: true })
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    if (signal.aborted) throw new BodyError(408, "查詢已取消或讀取逾時。")
    while (true) {
      const { value, done } = await reader.read()
      if (signal.aborted) throw new BodyError(408, "查詢已取消或讀取逾時。")
      if (done) break
      total += value.byteLength
      if (total > BODY_LIMIT) { await reader.cancel(); throw new BodyError(413, "查詢內容超過 16 KiB 上限。") }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    if (error instanceof BodyError) throw error
    throw new BodyError(400, "查詢內容必須是有效 JSON。")
  } finally {
    signal.removeEventListener("abort", cancel)
    reader.releaseLock()
  }
}

/** Read-only JSON POST: no CORS and no client JQL, dates, identities or issue overrides. */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return Response.json({ status: "error", error: { code: "reauthorize", message: "登入狀態已失效，請重新登入。" } }, { status: 401, headers })
    const origin = request.headers.get("origin")
    if (origin !== new URL(request.url).origin || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) throw new BodyError(403, "僅接受同來源查詢。")
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw new BodyError(415, "查詢內容必須使用 application/json。")
    const input = parseProjectsAnalysisRequest(await readJson(request))
    resolveProjectsAnalysisSprints(input, new Date())
    const data = await getProjectsAnalysis(input, { signal: request.signal })
    return Response.json({ status: "success", data }, { headers })
  } catch (error) {
    if (error instanceof BodyError) return Response.json({ status: "error", error: { code: "invalid_selection", message: error.message } }, { status: error.status, headers })
    const mapped = projectsAnalysisError(error)
    const status = mapped.code === "reauthorize" ? 401 : mapped.code === "forbidden" ? 403 : mapped.code === "invalid_selection" ? 400 : mapped.code === "limit" ? 422 : mapped.code === "cancelled" ? 408 : 502
    return Response.json({ status: "error", error: mapped }, { status, headers })
  }
}

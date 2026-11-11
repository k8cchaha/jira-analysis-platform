// k8s 探針與 ALB 健康檢查端點：不經 auth、不呼叫 Jira，只確認 Node server 可回應。
export const dynamic = "force-dynamic"

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } })
}

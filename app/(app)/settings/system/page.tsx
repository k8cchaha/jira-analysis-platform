import { connection } from "next/server"
import { PageHeader } from "@/components/page-header"
import { EnvironmentDiagnostics } from "./environment-diagnostics"
import { readEnvironmentSummary } from "./environment-server"

export default async function Page() {
  await connection()
  const entries = await readEnvironmentSummary()
  return <>
    <PageHeader title="系統設定" description="暫時檢視目前伺服器的環境設定；此頁不提供修改功能。" />
    {entries ? <EnvironmentDiagnostics entries={entries} /> : <p role="alert" className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">無權查看環境設定，請確認管理員登入狀態。</p>}
  </>
}
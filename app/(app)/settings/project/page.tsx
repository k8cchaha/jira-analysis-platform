import { ComingSoon } from "@/components/coming-soon"
export default function Page() {
  return (
    <>
      <ComingSoon title="專案設定" description="檢視與管理各專案的設定。" />
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">[ToDo]</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-400">
          <li>Sprint Capacity (該 Sprint 團隊可安排的點數)</li>
          <li>Sprint Resource (該 Sprint 團隊參與開發的成員, 主要是設定預設成員 + By Sprint 的彈性增減)</li>
          <li>Sprint Extended Days (該 Sprint 延伸開發的天數, Saku: 0, Telasa: 會多約一週解 Bug)</li>
        </ul>
      </section>
    </>
  )
}

import { GuardedLink } from "@/components/navigation-blocker"
import { PageHeader } from "@/components/page-header"
import { MissingDataPanel } from "./missing-data-panel"

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="儀表板"
        description="你的 Jira 資料工作區。查看指派給自己的缺失資料，並補填 Points 與 Defect Cause。"
        breadcrumbs={["總覽", "儀表板"]}
      />
      <MissingDataPanel />
      <div className="mt-6">
        <GuardedLink
          href="/issues/assigned/list"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-slate-800"
        >
          查看指派給我的 Issues
          <span aria-hidden="true">→</span>
        </GuardedLink>
      </div>
    </>
  )
}

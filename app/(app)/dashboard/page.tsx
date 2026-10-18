import { GuardedLink } from "@/components/navigation-blocker"
import { PageHeader } from "@/components/page-header"
import { MissingDataPanel } from "./missing-data-panel"
import { auth } from "@/auth"
import { dashboardFilterResult, dashboardSearchParams } from "@/lib/jira-dashboard-filter"

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const applied = dashboardFilterResult(dashboardSearchParams(await searchParams))
  const session = await auth()
  return (
    <>
      <PageHeader
        title="儀表板"
        breadcrumbs={["總覽", "儀表板"]}
      />
      <MissingDataPanel applied={applied} viewerId={session?.user?.id ?? ""} />
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

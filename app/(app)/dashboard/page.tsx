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
      />
      <MissingDataPanel applied={applied} viewerId={session?.user?.id ?? ""} />
    </>
  )
}

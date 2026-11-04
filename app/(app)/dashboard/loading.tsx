import { PageHeader } from "@/components/page-header"
import { BugAlertCard } from "./bug-alert-card"
import { PendingIssueCard } from "./pending-issue-card"
import { DueReminderCard } from "./due-reminder-card"

export default function DashboardLoading() {
  return (
    <>
      <PageHeader
        title="儀表板"
      />
      <section role="status" aria-label="正在載入儀表板">
        <div aria-hidden="true" className="mb-4 h-28 animate-pulse sm:h-24 rounded-2xl border border-slate-200 bg-slate-100 motion-reduce:animate-none dark:border-slate-800 dark:bg-slate-800" />
        <div className="mb-4 grid gap-4 lg:grid-cols-3">
          <BugAlertCard loading />
          <DueReminderCard loading />
          <PendingIssueCard loading />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {["points", "defect-cause"].map((kind) => (
            <div key={kind} aria-hidden="true" className="space-y-5 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
              <div className="h-5 w-40 animate-pulse rounded bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
              <div className="h-10 w-full animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
              <div className="h-10 w-28 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
              <div className="h-16 w-full animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

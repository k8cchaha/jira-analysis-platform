import { GuardedLink } from "@/components/navigation-blocker"
import { PageHeader } from "@/components/page-header"

type ComingSoonProps = {
  title: string
  description: string
  breadcrumbs?: readonly string[]
  plannedCapabilities?: readonly string[]
  unavailableReason?: string
  relatedLinks?: readonly { href: string; label: string }[]
}

export function ComingSoon({
  title,
  description,
  breadcrumbs,
  plannedCapabilities = [description],
  unavailableReason = "相關資料與操作功能仍在開發中，因此本次版本尚未開放。",
  relatedLinks = [
    {
      href: "/issues/assigned/list",
      label: "前往目前可用的指派 Issue 清單",
    },
  ],
}: ComingSoonProps) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={breadcrumbs}
      />
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="h-1 bg-blue-600" />
        <div className="px-6 py-12 sm:px-10 sm:py-16">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            <svg
              aria-hidden="true"
              className="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">
            即將推出
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
            此功能正在準備中
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            {unavailableReason}
          </p>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                規劃功能
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                {plannedCapabilities.map((capability) => (
                  <li key={capability} className="flex gap-2">
                    <span aria-hidden="true" className="text-blue-600 dark:text-blue-400">
                      •
                    </span>
                    <span>{capability}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                目前可用
              </h3>
              <div className="mt-3 flex flex-col items-start gap-2">
                {relatedLinks.map((link) => (
                  <GuardedLink
                    key={link.href}
                    href={link.href}
                    className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300"
                  >
                    {link.label}
                    <span aria-hidden="true"> →</span>
                  </GuardedLink>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

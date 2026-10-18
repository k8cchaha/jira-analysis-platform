type PageHeaderProps = {
  title: string
  description?: string
  breadcrumbs?: readonly string[]
}

export function PageHeader({
  title,
  description,
  breadcrumbs = [],
}: PageHeaderProps) {
  return (
    <header className="mb-8">
      {breadcrumbs.length > 0 ? (
        <nav aria-label="麵包屑導覽" className="mb-3">
          <ol className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            {breadcrumbs.map((breadcrumb, index) => (
              <li className="flex items-center gap-2" key={`${breadcrumb}-${index}`}>
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                <span>{breadcrumb}</span>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl dark:text-white">
        {title}
      </h1>
      {description ? (
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base dark:text-slate-400">
          {description}
        </p>
      ) : null}
    </header>
  )
}

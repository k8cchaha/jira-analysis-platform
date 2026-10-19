type PageHeaderProps = {
  title: string
  description?: string
}

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <header className="mb-8">
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

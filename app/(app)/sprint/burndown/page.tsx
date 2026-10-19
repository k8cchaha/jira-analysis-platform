import { PageHeader } from "@/components/page-header"
import { SprintSelector } from "@/app/(app)/sprint/burndown/sprint-selector"
import { SPRINT_PROJECTS, type SprintProjectKey } from "@/lib/jira-jql"

export const metadata = {
  title: "Burn Down Chart",
}

export default async function BurndownPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const params = await searchParams
  const project = parseProjectKey(params.project)

  return (
    <>
      <PageHeader
        title="Burn Down Chart"
        description="選擇專案，檢視剩餘工作量的燃盡趨勢。"
      />
      <SprintSelector project={project} />

      <div className="mt-8">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div aria-hidden="true" className="mb-3 text-4xl">🏗️</div>
          <h2 className="font-semibold text-slate-900 dark:text-white">
            {project
              ? `${project} 的燃盡圖尚未開放`
              : "請先選擇專案"}
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {project
              ? "此專案的燃盡圖功能正在建置中，敬請期待。"
              : "從上方選擇專案後，將顯示該專案的燃盡圖。"}
          </p>
        </div>
      </div>
    </>
  )
}

function parseProjectKey(value: string | undefined): SprintProjectKey | null {
  if (typeof value !== "string") return null
  return (SPRINT_PROJECTS as readonly { key: string }[]).some(
    (option) => option.key === value
  )
    ? (value as SprintProjectKey)
    : null
}
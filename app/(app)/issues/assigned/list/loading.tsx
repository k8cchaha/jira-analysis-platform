import { PageHeader } from "@/components/page-header"

export default function AssignedIssuesLoading() {
  return (
    <>
      <PageHeader
        title="指派給我的 Issues"
        description="正在載入最近指派給你的 Issues。"
      />
      <div
        aria-label="正在載入 Issues"
        aria-busy="true"
        className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
      >
        <div className="h-14 animate-pulse border-b border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-700" />
        <div className="space-y-px bg-gray-200 dark:bg-gray-700">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="h-20 animate-pulse bg-white p-5 dark:bg-gray-800"
            >
              <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-3 h-3 w-1/3 rounded bg-gray-100 dark:bg-gray-700/70" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

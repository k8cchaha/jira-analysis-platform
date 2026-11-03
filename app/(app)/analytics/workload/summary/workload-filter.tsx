"use client"

import { useId, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { TeamSelect } from "@/components/team-select"
import { useTeamMembers } from "@/components/team-members-provider"
import { FilterDropdown } from "@/components/filter-dropdown"
import { SearchButton } from "@/components/search-button"
import { DateRangeField } from "@/components/date-range-field"
import { DASHBOARD_PROJECTS, includedDashboardMembers } from "@/lib/jira-dashboard-filter"
import type { DashboardUser } from "@/lib/jira-dashboard-filter"
import { DATE_RANGE_PRESET_LABEL, type DateRange, type DateRangeShortcut } from "@/lib/date-range"
import { workloadHref } from "@/lib/workload-filter"
import type { WorkloadFilter } from "@/lib/workload-filter"

const choiceClass = "h-4 w-4 shrink-0 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"

const WORKLOAD_SHORTCUTS: readonly DateRangeShortcut[] = (["last1Month", "last2Months", "last3Months", "last6Months"] as const).map((preset) => ({
  id: preset,
  label: DATE_RANGE_PRESET_LABEL[preset],
  preset,
}))

/**
 * 分析區間的預設值：以「近1月」起始。
 *
 * 沒有 URL 區間時先帶入空區間；`DateRangeField` 取得瀏覽器本機今天後，會以預設的近1月
 * 補上並回報 `onCommit`。本元件不自行讀時鐘，避免 hydration 前後顯示不同日期。
 */
export function WorkloadFilterForm({ initialFilter, initialError, initialRange = null }: {
  initialFilter: WorkloadFilter | null
  initialError: string | null
  initialRange?: DateRange | null
}) {
  const id = useId()
  const router = useRouter()
  const [groups, setGroups] = useState<string[]>(initialFilter?.groups ?? [])
  const [exclusions, setExclusions] = useState<Record<string, string[]>>(initialFilter?.exclusions ?? {})
  const [projects, setProjects] = useState<string[]>(initialFilter?.projects ?? [])
  const [range, setRange] = useState<DateRange>(initialFilter ?? initialRange ?? { from: "", to: "" })
  // 「是否已有區間」看的是日期本身，而不是有沒有 initialFilter：URL 可能帶著完整
  // 團隊條件卻缺日期（此時整份條件不會被解析），表單仍必須等一個真正的區間才能查詢。
  const [rangeTouched, setRangeTouched] = useState(Boolean(initialFilter?.from && initialFilter?.to))
  const [projectOpen, setProjectOpen] = useState(false)
  const [error, setError] = useState(initialError)
  const { groupStates } = useTeamMembers()

  // Read current snapshots, not a stale callback's readiness, before allowing Apply.
  const allGroupsLoaded = groups.length > 0 && groups.every((group) => groupStates[group]?.status === "success")
  const members: Record<string, DashboardUser[]> = {}
  for (const group of groups) {
    const state = groupStates[group]
    if (state?.status === "success") members[group] = state.members
  }
  let memberCount = 0
  // 尚未選擇團隊時不顯示提示：這個狀態由團隊選單本身呈現，重複一段常駐文字只是佔位。
  let teamHint = ""
  if (allGroupsLoaded) {
    try {
      memberCount = includedDashboardMembers(groups, exclusions, members).length
      teamHint = `已選 ${groups.length} 個團隊、${memberCount} 名不重複成員`
    } catch (failure) {
      teamHint = failure instanceof Error ? failure.message : "請重新選擇團隊成員。"
    }
  } else if (groups.length) {
    teamHint = "所選團隊必須全部完整載入後才能套用，不會使用部分成員。"
  }

  function query(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      if (!allGroupsLoaded) throw new Error("請選擇團隊，並等待所選團隊的完整成員名單載入。")
      includedDashboardMembers(groups, exclusions, members)
      // 區間是查詢範圍的一部分：沒有它就沒有可查的視窗，不以任何預設值代替。
      if (!rangeTouched || !range.from || !range.to) throw new Error("請先選擇分析區間。")
      const href = workloadHref({ groups, exclusions, projects, from: range.from, to: range.to })
      setError(null)
      setProjectOpen(false)
      router.push(href)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "篩選條件無效。")
    }
  }

  // 快捷鍵或月曆完成一次選取時，納入草稿；草稿在按「查詢」前都不會寫入 URL。
  // 空區間只可能出現在取得本機今天之前，該階段不建立草稿，避免蓋掉首次的預設值。
  function commitRange(next: DateRange) {
    if (!next.from || !next.to) return
    setRangeTouched(true)
    setError(null)
  }

  const projectLabel = DASHBOARD_PROJECTS.filter((project) => projects.includes(project.key)).map((project) => project.label).join(" · ") || "選擇專案…"

  return (
    <>
      <section aria-label="查詢範圍" className="mb-4 min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <form onSubmit={query} className="space-y-3">
          <div>
            <DateRangeField
              value={range}
              onChange={setRange}
              onCommit={commitRange}
              shortcuts={WORKLOAD_SHORTCUTS}
              defaultPreset="last1Month"
              idPrefix={`${id}-range`}
            />
            {!rangeTouched && <p role="status" className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">尚未選擇分析區間，請按快捷鍵或點選日期欄位。</p>}
          </div>
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <TeamSelect
              groups={groups}
              initialExclusions={initialFilter?.exclusions}
              onGroupsChange={(nextGroups) => { setGroups(nextGroups); setError(null) }}
              onExclusionsChange={setExclusions}
              helpText="團隊與成員變更只更新草稿，按「查詢」套用篩選條件。"
            />
            <FilterDropdown id={`${id}-projects`} kind="project" label="專案" value={projectLabel} open={projectOpen} onOpenChange={setProjectOpen} describedBy={`${id}-project-help`}>
              <fieldset className="min-w-0">
                <legend className="sr-only">專案（可複選）</legend>
                {DASHBOARD_PROJECTS.map((project) => (
                  <label key={project.key} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={projects.includes(project.key)} onChange={(event) => {
                      setError(null)
                      setProjects(event.target.checked ? [...new Set([...projects, project.key])] : projects.filter((key) => key !== project.key))
                    }} className={choiceClass} />
                    <span>{project.label}</span>
                  </label>
                ))}
              </fieldset>
              <p id={`${id}-project-help`} className="px-3 py-2 text-xs leading-5 text-slate-500 dark:text-slate-400">未選取專案時，不加專案限制。</p>
            </FilterDropdown>
            <SearchButton disabled={!allGroupsLoaded || memberCount === 0} aria-describedby={`${id}-team-help ${id}-help`} />
          </div>
          <p id={`${id}-help`} className="sr-only">按「查詢」或 Enter 套用團隊、專案與分析區間；分析區間以瀏覽器本機時區的日曆日為準。</p>
          {teamHint && <p id={`${id}-team-help`} role="status" className="text-xs leading-5 text-slate-500 dark:text-slate-400">{teamHint}</p>}
          {error && <p role="alert" className="break-words text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </form>
      </section>
    </>
  )
}

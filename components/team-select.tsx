"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useTeamMembers } from "@/components/team-members-provider"
import {
  DASHBOARD_TEAMS,
  includedDashboardMembers,
  type DashboardUser,
} from "@/lib/jira-dashboard-filter"
import { Chevron, FilterDropdown } from "@/components/filter-dropdown"

const choiceClass = "h-4 w-4 shrink-0 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"

/**
 * 團隊選擇（站內過濾）。模型同儀表板的團隊下拉：多選 Jira group、可展開逐人
 * 排除；成員名單由登入區域預載並保存在共用記憶體 store，跨頁／彈窗重開沿用。
 *
 * 為受控元件：`groups` 由上層持有；每次變更以 `includedDashboardMembers` 算出
 * 命中的成員 accountId 集合，分別回傳給上層。**不發任何 JQL、不改 URL。**
 */
export function TeamSelect({
  groups,
  onGroupsChange,
  perMember = true,
  onMembersReady,
}: {
  groups: readonly string[]
  onGroupsChange: (groups: string[], memberAccountIds: string[], ready: boolean) => void
  /** false 時只顯示團隊層級的複選，不展開逐人勾選/排除。 */
  perMember?: boolean
  /** 依已成功載入的完整團隊名單，逐次回報全量 accountId → label 對照；僅供顯示分組，不代表篩選已完整。 */
  onMembersReady?: (byAccountId: Record<string, string>) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string[]>([])
  const [exclusions, setExclusions] = useState<Record<string, string[]>>({})
  const { groupStates, loadGroup, retryGroup } = useTeamMembers()
  const [error, setError] = useState<string | null>(null)

  // 已勾選團隊的成員全部載入成功後，以最新 groupStates 重新通知上層（同步 memberIds）。
  // 否則勾選後只有起初的 notify（當時未載入 → accountIds 空），載入完成不會再更新。
  const notifiedKeyRef = useRef<string>("")
  useEffect(() => {
    const allReady = groups.length > 0 && groups.every((group) => groupStates[group]?.status === "success")
    if (!allReady) {
      notifiedKeyRef.current = ""
      return
    }
    const key = [...groups].sort().join("\u0000")
    if (notifiedKeyRef.current === key) return
    notifiedKeyRef.current = key
    notify([...groups], exclusions)
  })

  function notify(groupsNext: string[], exclusionsNext: Record<string, string[]>) {
    try {
      const members: Record<string, DashboardUser[]> = {}
      const ready = groupsNext.every((group) => groupStates[group]?.status === "success")
      for (const group of groupsNext) {
        const state = groupStates[group]
        if (state?.status !== "success") continue
        members[group] = state.members
      }
      let accountIds: string[]
      if (!groupsNext.length || !ready) {
        accountIds = []
      } else {
        accountIds = includedDashboardMembers(groupsNext, exclusionsNext, members)
      }
      // 記錄已同步的選取，避免快取命中時 effect 重複通知並覆蓋當次排除結果。
      notifiedKeyRef.current = groupsNext.length && ready ? [...groupsNext].sort().join("\u0000") : ""
      onGroupsChange([...groupsNext], accountIds, ready)
      setError(null)
    } catch (failure) {
      onGroupsChange([...groupsNext], [], false)
      setError(failure instanceof Error ? failure.message : "團隊成員尚未完整載入。")
    }
  }

  // 登入區域已背景預載全部團隊；此處僅衍生成員分組，不擁有載入生命周期。
  const reportedKeyRef = useRef<string | null>(null)
  // 顯示分組可先使用成功名單；一組失敗不應阻擋其他團隊歸隊。
  // 每次按固定團隊順序重建全量對照，保留跨組成員的後者優先規則。
  useEffect(() => {
    if (!onMembersReady) return
    const byAccountId: Record<string, string> = {}
    for (const team of DASHBOARD_TEAMS) {
      const state = groupStates[team.group]
      if (state?.status !== "success") continue
      for (const member of state.members) byAccountId[member.accountId] = team.label
    }
    const key = JSON.stringify(Object.entries(byAccountId).sort(([a], [b]) => a.localeCompare(b)))
    if (reportedKeyRef.current === key) return
    reportedKeyRef.current = key
    onMembersReady(byAccountId)
  }, [onMembersReady, groupStates])

  function toggleGroup(group: string, checked: boolean) {
    const next = checked ? [...new Set([...groups, group])] : groups.filter((item) => item !== group)
    const exclusionsNext = { ...exclusions }
    delete exclusionsNext[group]
    setExclusions(exclusionsNext)
    notify(next, exclusionsNext)
    // 預載尚未完成時沿用共享請求；已成功時不再讀取 API。
    if (checked) void loadGroup(group)
  }

  function toggleMember(group: string, accountId: string, checked: boolean) {
    const state = groupStates[group]
    if (state?.status !== "success") return
    const excluded = new Set(groups.includes(group) ? exclusions[group] ?? [] : state.members.map((member) => member.accountId))
    if (checked) excluded.delete(accountId)
    else excluded.add(accountId)
    const next = { ...exclusions }
    let groupsNext = [...groups]
    if (state.members.every((member) => excluded.has(member.accountId))) {
      // 全數排除視同不選此團隊；留存其餘已選團隊。
      delete next[group]
      groupsNext = groupsNext.filter((item) => item !== group)
    } else {
      next[group] = excluded.size ? [...excluded] : []
      groupsNext = [...new Set([...groupsNext, group])]
    }
    setExclusions(next)
    notify(groupsNext, next)
  }

  const label = groups.length
    ? DASHBOARD_TEAMS.filter((team) => groups.includes(team.group)).map((team) => team.label).join(" · ")
    : "團隊"

  return (
    <FilterDropdown
      id={id}
      kind="team"
      label="團隊"
      value={label}
      open={open}
      onOpenChange={setOpen}
      describedBy={`${id}-help`}
    >
      {DASHBOARD_TEAMS.map((team) => {
        const selected = groups.includes(team.group)
        const isOpen = expanded.includes(team.group)
        const state = groupStates[team.group]
        const selectedCount = state?.status === "success" && selected ? state.members.filter((user) => !(exclusions[team.group] ?? []).includes(user.accountId)).length : 0
        return (
          <div key={team.group} className="min-w-0">
            <div className="flex min-w-0 items-stretch">
              {perMember && (
                <button
                  type="button"
                  aria-label={`${isOpen ? "收合" : "展開"} ${team.label} 成員`}
                  aria-expanded={isOpen}
                  onClick={() => {
                    setExpanded(isOpen ? expanded.filter((group) => group !== team.group) : [...expanded, team.group])
                    if (!isOpen) void loadGroup(team.group)
                  }}
                  className="shrink-0 rounded px-2 py-2 text-slate-500 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <Chevron open={isOpen} />
                </button>
              )}
              <label className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-2 text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={selected}
                  ref={(element) => { if (element) element.indeterminate = selected && state?.status === "success" && selectedCount > 0 && selectedCount < state.members.length }}
                  onChange={(event) => toggleGroup(team.group, event.target.checked)}
                  className={choiceClass}
                />
                <span>{team.label}</span>
                {selected && <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400">{state?.status === "success" ? `${selectedCount}/${state.members.length}` : state?.status === "error" ? "載入失敗" : "載入中…"}</span>}
              </label>
            </div>
            {!perMember && state?.status === "error" && (
              <div className="space-y-2 px-3 py-2">
                <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{state.error.message}</p>
                <button type="button" onClick={() => { void retryGroup(team.group) }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">重試 {team.label}</button>
              </div>
            )}
            {perMember && (
              <div hidden={!isOpen} className="space-y-2 py-2">
                {(!state || state.status === "loading") && <p role="status" className="pr-3 pl-10 text-xs text-slate-600 dark:text-slate-400">正在載入完整成員名單…</p>}
                {state?.status === "error" && (
                  <div className="space-y-2 pr-3 pl-10">
                    <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{state.error.message}</p>
                    <button type="button" onClick={() => { void retryGroup(team.group) }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">重試 {team.label}</button>
                  </div>
                )}
                {state?.status === "success" && (
                  <>
                    {!state.members.length && <p className="pr-3 pl-10 text-xs text-slate-600 dark:text-slate-400">此團隊沒有可選取的成員。</p>}
                    {state.members.map((user) => (
                      <label key={user.accountId} className="flex min-h-10 w-full min-w-0 cursor-pointer items-start gap-2 py-2 pr-3 pl-10 text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                        <input type="checkbox" checked={selected && !(exclusions[team.group] ?? []).includes(user.accountId)} onChange={(event) => toggleMember(team.group, user.accountId, event.target.checked)} className={`${choiceClass} mt-1`} />
                        <span className="min-w-0 break-words">{user.displayName}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
      {error && <p id={`${id}-error`} role="alert" className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <p id={`${id}-help`} className="sr-only">團隊變更只過濾站內已載入的燃盡資料，不會重新查詢 Jira。</p>
    </FilterDropdown>
  )
}
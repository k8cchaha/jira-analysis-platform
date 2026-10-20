"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import {
  DASHBOARD_TEAMS,
  includedDashboardMembers,
  isDashboardAccountId,
  type DashboardUser,
} from "@/lib/jira-dashboard-filter"
import { Chevron, FilterDropdown } from "@/components/filter-dropdown"

type LookupResult =
  | { status: "success"; members: DashboardUser[] }
  | { status: "error"; message: string }
type GroupState = { status: "loading" } | LookupResult

const choiceClass = "h-4 w-4 shrink-0 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"

/**
 * 團隊選擇（站內過濾）。模型同儀表板的團隊下拉：多選 Jira group、可展開逐人
 * 排除；成員名單經 `/api/dashboard/lookups?view=group` 讀取。
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
  /** 全部團隊的成員名單載入完成後回報一次（accountId → 團隊 label），供下方成員開發狀況分組。 */
  onMembersReady?: (byAccountId: Record<string, string>) => void
}) {
  const id = useId()
  const mounted = useRef(false)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string[]>([])
  const [exclusions, setExclusions] = useState<Record<string, string[]>>({})
  const [groupStates, setGroupStates] = useState<Record<string, GroupState>>({})
  const [error, setError] = useState<string | null>(null)

  const groupCache = useRef<Record<string, GroupState>>({})
  const groupControllers = useRef<Record<string, AbortController>>({})
  const groupRequests = useRef<Partial<Record<string, Promise<void>>>>({})
  const groupSequences = useRef<Record<string, number>>({})

  useEffect(() => {
    mounted.current = true
    const sequences = groupSequences.current
    const controllers = groupControllers.current
    const requests = groupRequests.current
    const cache = groupCache.current
    return () => {
      mounted.current = false
      for (const group of Object.keys(controllers)) {
        sequences[group] = (sequences[group] ?? 0) + 1
        controllers[group].abort()
        delete controllers[group]
        delete requests[group]
        delete cache[group]
      }
    }
  }, [])

  // 已勾選團隊的成員全部載入成功後，以最新 groupStates 重新通知上層（同步 memberIds）。
  // 否則勾選後只有起初的 notify（當時未載入 → accountIds 空），載入完成不會再更新。
  const notifiedKeyRef = useRef<string>("")
  useEffect(() => {
    if (groups.length === 0) return
    const allReady = groups.every((group) => groupStates[group]?.status === "success")
    if (!allReady) return
    const key = [...groups].sort().join("\u0000")
    if (notifiedKeyRef.current === key) return
    notifiedKeyRef.current = key
    notify([...groups], exclusions)
  })

  async function lookupGroup(group: string, signal: AbortSignal): Promise<LookupResult> {
    try {
      const response = await fetch(`/api/dashboard/lookups?view=group&group=${encodeURIComponent(group)}`, { cache: "no-store", signal })
      const value: unknown = await response.json()
      if (!value || typeof value !== "object") throw new Error("Invalid lookup response")
      const result = value as Record<string, unknown>
      if (result.status === "error" && result.error && typeof result.error === "object") {
        const message = (result.error as Record<string, unknown>).message
        return { status: "error", message: typeof message === "string" ? message : "無法載入團隊成員，請重試。" }
      }
      if (!response.ok || result.status !== "success" || !Array.isArray(result.members)) throw new Error("Invalid lookup response")
      const members = new Map<string, DashboardUser>()
      for (const item of result.members) {
        if (!item || typeof item !== "object" || !isDashboardAccountId((item as Record<string, unknown>).accountId) || typeof (item as Record<string, unknown>).displayName !== "string") throw new Error("Invalid lookup user")
        const member = item as DashboardUser
        members.set(member.accountId, member)
      }
      return { status: "success", members: [...members.values()] }
    } catch (cause) {
      if (signal.aborted) throw cause
      return { status: "error", message: "無法載入團隊成員，請重試。" }
    }
  }

  const loadGroup = useCallback((group: string, retry = false): Promise<void> => {
    if (!retry && groupCache.current[group]?.status === "success") return Promise.resolve()
    if (!retry && groupRequests.current[group]) return groupRequests.current[group]
    const sequence = (groupSequences.current[group] ?? 0) + 1
    groupSequences.current[group] = sequence
    groupControllers.current[group]?.abort()
    const controller = new AbortController()
    groupControllers.current[group] = controller
    groupCache.current[group] = { status: "loading" }
    setGroupStates((current) => ({ ...current, [group]: { status: "loading" } }))
    const request = Promise.resolve().then(async () => {
      try {
        const result = await lookupGroup(group, controller.signal)
        groupCache.current[group] = result
        if (mounted.current && groupSequences.current[group] === sequence) setGroupStates((current) => ({ ...current, [group]: result }))
      } catch {
        if (mounted.current && groupSequences.current[group] === sequence) {
          const result: GroupState = { status: "error", message: "無法載入團隊成員，請重試。" }
          groupCache.current[group] = result
          setGroupStates((current) => ({ ...current, [group]: result }))
        }
      } finally {
        if (groupSequences.current[group] === sequence) {
          delete groupRequests.current[group]
          delete groupControllers.current[group]
        }
      }
    })
    groupRequests.current[group] = request
    return request
  }, [])

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
      onGroupsChange([...groupsNext], accountIds, ready)
      setError(null)
    } catch (failure) {
      onGroupsChange([...groupsNext], [], false)
      setError(failure instanceof Error ? failure.message : "團隊成員尚未完整載入。")
    }
  }

  // 一次載入全部團隊的成員名單，供下方「成員開發狀況」以團隊分組顯示。
  const reportedKeyRef = useRef("")
  // 掛載時就預先載入所有團隊（不只已勾選的），否則「未選團隊＝顯示全體」時沒有可用的分組資料。
  useEffect(() => {
    if (!onMembersReady) return
    for (const team of DASHBOARD_TEAMS) {
      if (groupCache.current[team.group]?.status !== "success") void loadGroup(team.group)
    }
  }, [onMembersReady, loadGroup])
  // 當所有團隊的成員都載入成功時，組出 accountId → label 映射並回報一次。
  useEffect(() => {
    if (!onMembersReady) return
    const allReady = DASHBOARD_TEAMS.every((team) => groupStates[team.group]?.status === "success")
    if (!allReady) return
    const byAccountId: Record<string, string> = {}
    for (const team of DASHBOARD_TEAMS) {
      const state = groupStates[team.group]
      if (state?.status !== "success") continue
      for (const member of state.members) byAccountId[member.accountId] = team.label
    }
    const key = [...Object.keys(byAccountId)].sort().join("\u0000")
    if (!key || reportedKeyRef.current === key) return
    reportedKeyRef.current = key
    onMembersReady(byAccountId)
  }, [onMembersReady, groupStates])

  function toggleGroup(group: string, checked: boolean) {
    const next = checked ? [...new Set([...groups, group])] : groups.filter((item) => item !== group)
    const exclusionsNext = { ...exclusions }
    delete exclusionsNext[group]
    notify(next, exclusionsNext)
    // 勾選即載入成員名單，才能在團隊為單位時算出對應的 accountId。
    if (checked && groupCache.current[group]?.status !== "success") {
      void loadGroup(group)
    }
  }

  function toggleMember(group: string, accountId: string, checked: boolean) {
    const state = groupStates[group]
    if (state?.status !== "success") return
    const excluded = new Set(exclusions[group] ?? [])
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
      label="團隊"
      value={label}
      open={open}
      onOpenChange={setOpen}
      describedBy={`${id}-help`}
    >
      <p className="px-3 py-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{perMember ? "勾選團隊選取全部成員；展開可逐人排除。" : "勾選團隊，以團隊全體成員為單位過濾。"}</p>
      {DASHBOARD_TEAMS.map((team) => {
        const selected = groups.includes(team.group)
        const isOpen = expanded.includes(team.group)
        const state = groupStates[team.group]
        const selectedCount = state?.status === "success" && selected ? state.members.filter((user) => !(exclusions[team.group] ?? []).includes(user.accountId)).length : 0
        return (
          <div key={team.group} className="min-w-0">
            <div className="flex min-w-0 items-center gap-2 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800">
              {perMember && (
                <button
                  type="button"
                  aria-label={`${isOpen ? "收合" : "展開"} ${team.label} 成員`}
                  aria-expanded={isOpen}
                  onClick={() => {
                    setExpanded(isOpen ? expanded.filter((group) => group !== team.group) : [...expanded, team.group])
                    if (!isOpen) void loadGroup(team.group)
                  }}
                  className="shrink-0 rounded p-1 text-slate-500 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-slate-400"
                >
                  <Chevron open={isOpen} />
                </button>
              )}
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 text-sm text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(event) => toggleGroup(team.group, event.target.checked)}
                  className={choiceClass}
                />
                <span>{team.label}</span>
              </label>
              {selected && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400">{state?.status === "success" ? `${selectedCount}/${state.members.length}` : state?.status === "error" ? "載入失敗" : "載入中…"}</span>}
            </div>
            {perMember && (
              <div hidden={!isOpen} className="space-y-2 py-2 pr-3 pl-10">
                {(!state || state.status === "loading") && <p role="status" className="text-xs text-slate-600 dark:text-slate-400">正在載入完整成員名單…</p>}
                {state?.status === "error" && (
                  <div className="space-y-2">
                    <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{state.message}</p>
                    <button type="button" onClick={() => { void loadGroup(team.group, true) }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">重試 {team.label}</button>
                  </div>
                )}
                {state?.status === "success" && (
                  <>
                    {!state.members.length && <p className="text-xs text-slate-600 dark:text-slate-400">此團隊沒有可選取的成員。</p>}
                    {state.members.map((user) => (
                      <label key={user.accountId} className="flex min-w-0 cursor-pointer items-start gap-2 text-sm text-slate-800 dark:text-slate-200">
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
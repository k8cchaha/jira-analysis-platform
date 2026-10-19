"use client"

import { useCallback, useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react"
import {
  DASHBOARD_PROJECTS,
  DASHBOARD_TEAMS,
  SELF_FILTER,
  dashboardDays,
  dashboardHref,
  includedDashboardMembers,
  isDashboardAccountId,
  type DashboardFilter as DashboardFilterValue,
  type DashboardUser,
} from "@/lib/jira-dashboard-filter"
import { reauthorizeDashboardAction } from "./actions"

type LookupError = { code: string; message: string }
type LookupResult = { status: "success"; users: DashboardUser[] } | { status: "error"; error: LookupError }
type GroupState = { status: "loading" } | LookupResult
type RememberedDraft = {
  groups: string[]
  exclusions: Record<string, string[]>
  projects: string[]
}
type DashboardFilterProps = {
  filter: DashboardFilterValue | null
  viewerId: string
  onApply: (filter: DashboardFilterValue) => void
}

const inputClass = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
const buttonClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
const choiceClass = "h-4 w-4 shrink-0 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"

function rememberedDraft(value: unknown): RememberedDraft | null {
  if (!value || typeof value !== "object") return null
  const draft = value as Record<string, unknown>
  const savedGroups = Array.isArray(draft.groups) ? draft.groups : []
  const savedProjects = Array.isArray(draft.projects) ? draft.projects : []
  const groups = DASHBOARD_TEAMS.filter((team) => savedGroups.includes(team.group)).map((team) => team.group)
  const projects = DASHBOARD_PROJECTS.filter((project) => savedProjects.includes(project.key)).map((project) => project.key)
  const exclusions: Record<string, string[]> = {}
  if (draft.exclusions && typeof draft.exclusions === "object") {
    const saved = draft.exclusions as Record<string, unknown>
    for (const group of groups) {
      const ids = saved[group]
      if (Array.isArray(ids)) exclusions[group] = [...new Set(ids.filter(isDashboardAccountId))].slice(0, 1_000)
    }
  }
  return { groups, exclusions, projects }
}

async function lookupUsers(params: URLSearchParams, key: "users" | "members", signal: AbortSignal): Promise<LookupResult> {
  const response = await fetch(`/api/dashboard/lookups?${params}`, { cache: "no-store", signal })
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") throw new Error("Invalid lookup response")
  const result = value as Record<string, unknown>
  if (result.status === "error" && result.error && typeof result.error === "object") {
    const error = result.error as Record<string, unknown>
    if (typeof error.code === "string" && typeof error.message === "string") {
      return { status: "error", error: { code: error.code, message: error.message } }
    }
  }
  if (!response.ok || result.status !== "success" || !Array.isArray(result[key])) throw new Error("Invalid lookup response")
  const users = new Map<string, DashboardUser>()
  for (const item of result[key]) {
    if (!item || typeof item !== "object" || !isDashboardAccountId(item.accountId) || typeof item.displayName !== "string" || item.displayName.length > 200 || /[\u0000-\u001f]/.test(item.displayName)) {
      throw new Error("Invalid lookup user")
    }
    users.set(item.accountId, { accountId: item.accountId, displayName: item.displayName })
  }
  return { status: "success", users: [...users.values()] }
}

export function DashboardFilter({ filter, viewerId, onApply }: DashboardFilterProps) {
  // The parent keys this component by the serialized applied scope, including back/forward.
  const [appliedFilter] = useState(filter)
  const [mode, setMode] = useState<DashboardFilterValue["mode"]>(filter?.mode ?? "self")
  const [days, setDays] = useState(String(filter && filter.mode !== "self" ? filter.days : 30))
  const [name, setName] = useState(filter?.mode === "person" ? filter.name : "")
  const [selectedPerson, setSelectedPerson] = useState<DashboardUser | null>(filter?.mode === "person" ? { accountId: filter.accountId, displayName: filter.name } : null)
  const [candidates, setCandidates] = useState<DashboardUser[]>([])
  const [personLoading, setPersonLoading] = useState(false)
  const [groups, setGroups] = useState<string[]>(filter?.mode === "team-project" ? filter.groups : [])
  const [exclusions, setExclusions] = useState<Record<string, string[]>>(filter?.mode === "team-project" ? filter.exclusions : {})
  const [projects, setProjects] = useState<string[]>(filter?.mode === "team-project" ? filter.projects : [])
  const [expanded, setExpanded] = useState<string[]>([])
  const [dropdown, setDropdown] = useState<"teams" | "projects" | null>(null)
  const [groupStates, setGroupStates] = useState<Record<string, GroupState>>({})
  const [error, setError] = useState<LookupError | null>(null)
  const [storageReady, setStorageReady] = useState(false)
  const [reauthorizing, startReauthorization] = useTransition()
  const id = useId()
  const mounted = useRef(false)
  const edited = useRef(false)
  const personSequence = useRef(0)
  const personController = useRef<AbortController | null>(null)
  const groupSequences = useRef<Record<string, number>>({})
  const groupCache = useRef<Record<string, GroupState>>({})
  const groupControllers = useRef<Record<string, AbortController>>({})
  const groupRequests = useRef<Partial<Record<string, Promise<void>>>>({})
  const storageKey = `jira-dashboard-filter:${viewerId}`

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
        const result = await lookupUsers(new URLSearchParams({ view: "group", group }), "members", controller.signal)
        if (!mounted.current || groupSequences.current[group] !== sequence) return
        groupCache.current[group] = result
        setGroupStates((current) => ({ ...current, [group]: result }))
      } catch {
        if (!mounted.current || groupSequences.current[group] !== sequence) return
        const result: GroupState = { status: "error", error: { code: "retry", message: "無法完整載入團隊成員，請重試。" } }
        groupCache.current[group] = result
        setGroupStates((current) => ({ ...current, [group]: result }))
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

  useEffect(() => {
    mounted.current = true
    let active = true
    const sequences = groupSequences.current
    const controllers = groupControllers.current
    const requests = groupRequests.current
    const cache = groupCache.current
    queueMicrotask(() => {
      if (!active) return
      try {
        const raw = localStorage.getItem(storageKey)
        const saved = raw && raw.length <= 100_000 ? rememberedDraft(JSON.parse(raw)) : null
        if (saved && !edited.current) {
          // Remember inactive drafts only. The URL's active scope always wins; mode is never persisted.
          if (appliedFilter?.mode !== "team-project") {
            setGroups(saved.groups)
            setExclusions(saved.exclusions)
            setProjects(saved.projects)
          }
        }
      } catch { /* Storage may be unavailable or malformed; the URL/default still works. */ }
      setStorageReady(true)
    })
    return () => {
      active = false
      mounted.current = false
      personSequence.current += 1
      personController.current?.abort()
      for (const group of Object.keys(controllers)) {
        sequences[group] = (sequences[group] ?? 0) + 1
        controllers[group].abort()
        delete controllers[group]
        delete requests[group]
        delete cache[group]
      }
    }
  }, [appliedFilter, storageKey])

  useEffect(() => {
    if (!storageReady) return
    try { localStorage.setItem(storageKey, JSON.stringify({ groups, exclusions, projects })) }
    catch { /* Remembering a draft is optional, never required for a query. */ }
  }, [storageReady, storageKey, groups, exclusions, projects])

  useEffect(() => {
    if (mode !== "team-project") return
    let active = true
    // Sequential restore bounds requests even when all eleven URL groups are selected.
    queueMicrotask(() => {
      void (async () => {
        for (const group of groups) {
          if (!active) return
          await loadGroup(group)
        }
      })()
    })
    return () => { active = false }
  }, [mode, groups, loadGroup])

  function editDraft() {
    edited.current = true
    personSequence.current += 1
    personController.current?.abort()
    setPersonLoading(false)
    setError(null)
  }

  function changeMode(next: DashboardFilterValue["mode"]) {
    editDraft()
    // A late group failure must not leak into a newer mode/request.
    for (const group of Object.keys(groupControllers.current)) {
      groupSequences.current[group] = (groupSequences.current[group] ?? 0) + 1
      groupControllers.current[group].abort()
      delete groupControllers.current[group]
      delete groupRequests.current[group]
      delete groupCache.current[group]
    }
    setGroupStates((current) => Object.fromEntries(Object.entries(current).filter(([, state]) => state.status !== "loading")))
    setDropdown(null)
    setMode(next)
    if (next === "self") apply(SELF_FILTER)
  }

  function toggleGroup(group: string, checked: boolean) {
    editDraft()
    setGroups(checked ? [...new Set([...groups, group])] : groups.filter((item) => item !== group))
    const next = { ...exclusions }
    delete next[group]
    setExclusions(next)
  }

  function toggleMember(group: string, accountId: string, checked: boolean) {
    const state = groupStates[group]
    if (state?.status !== "success") return
    editDraft()
    const excluded = new Set(groups.includes(group) ? exclusions[group] ?? [] : state.users.map((user) => user.accountId))
    if (checked) excluded.delete(accountId)
    else excluded.add(accountId)
    const next = { ...exclusions }
    if (state.users.every((user) => excluded.has(user.accountId))) {
      setGroups(groups.filter((item) => item !== group))
      delete next[group]
    } else {
      setGroups([...new Set([...groups, group])])
      if (excluded.size) next[group] = [...excluded]
      else delete next[group]
    }
    setExclusions(next)
  }

  function apply(next: DashboardFilterValue) {
    try { dashboardHref(next) }
    catch (failure) {
      setError({ code: "validation", message: failure instanceof Error ? failure.message : "篩選條件無效。" })
      return
    }
    setDropdown(null)
    onApply(next)
  }

  async function query(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (mode === "self") {
      apply(SELF_FILTER)
      return
    }
    let parsedDays: number
    try { parsedDays = dashboardDays(days) }
    catch (failure) {
      setError({ code: "validation", message: failure instanceof Error ? failure.message : "近 X 天必須是大於 0 的整數。" })
      return
    }
    if (mode === "team-project") {
      try {
        if (!groups.length) throw new Error("請至少選擇一個團隊及一名成員。")
        const members: Record<string, DashboardUser[]> = {}
        for (const group of groups) {
          const state = groupStates[group]
          if (state?.status !== "success") throw new Error("所選團隊成員尚未完整載入，請等待載入完成或重試。")
          members[group] = state.users
        }
        includedDashboardMembers(groups, exclusions, members)
        const selectedExclusions: Record<string, string[]> = {}
        for (const group of groups) if (exclusions[group]?.length) selectedExclusions[group] = exclusions[group]
        apply({ mode, groups: [...groups], exclusions: selectedExclusions, projects: [...projects], days: parsedDays })
      } catch (failure) {
        setError({ code: "validation", message: failure instanceof Error ? failure.message : "請重新選擇團隊成員。" })
      }
      return
    }
    if (selectedPerson) {
      apply({ mode: "person", accountId: selectedPerson.accountId, name: selectedPerson.displayName, days: parsedDays })
      return
    }
    const queryName = name.trim()
    if (!queryName) {
      setError({ code: "validation", message: "請輸入 Jira 顯示名稱。" })
      return
    }
    const sequence = ++personSequence.current
    personController.current?.abort()
    const controller = new AbortController()
    personController.current = controller
    setCandidates([])
    setPersonLoading(true)
    let result: LookupResult
    try {
      result = await lookupUsers(new URLSearchParams({ view: "users", query: queryName }), "users", controller.signal)
    } catch {
      if (mounted.current && personSequence.current === sequence) {
        setPersonLoading(false)
        setError({ code: "retry", message: "無法查詢 Jira 使用者，請重試。" })
      }
      return
    }
    if (!mounted.current || personSequence.current !== sequence) return
    setPersonLoading(false)
    if (result.status === "error") {
      setError(result.error)
    } else if (!result.users.length) {
      setError({ code: "not_found", message: "找不到符合的 Jira 使用者，請確認顯示名稱後重試。" })
    } else if (result.users.length === 1) {
      const user = result.users[0]
      setSelectedPerson(user)
      apply({ mode: "person", accountId: user.accountId, name: user.displayName, days: parsedDays })
    } else {
      setCandidates(result.users)
    }
  }

  function reauthorize() {
    const sequence = personSequence.current
    startReauthorization(async () => {
      try { await reauthorizeDashboardAction(dashboardHref(appliedFilter ?? SELF_FILTER)) }
      catch {
        if (mounted.current && sequence === personSequence.current) {
          setError({ code: "reauthorize", message: "無法開始重新授權，請稍後再試。" })
        }
      }
    })
  }

  const allGroupsLoaded = groups.length > 0 && groups.every((group) => groupStates[group]?.status === "success")
  let memberCount = 0
  let teamHint = "請至少選擇一個團隊，並保留一名成員。"
  if (allGroupsLoaded) {
    try {
      const members: Record<string, DashboardUser[]> = {}
      for (const group of groups) {
        const state = groupStates[group]
        if (state.status === "success") members[group] = state.users
      }
      memberCount = includedDashboardMembers(groups, exclusions, members).length
      teamHint = `已選 ${groups.length} 個團隊、${memberCount} 名不重複成員`
    } catch (failure) {
      teamHint = failure instanceof Error ? failure.message : "請重新選擇團隊成員。"
    }
  } else if (groups.length) {
    teamHint = "所選團隊必須全部完整載入後才能查詢，不會以部分成員查詢。"
  }

  const selectedTeams = DASHBOARD_TEAMS.filter((team) => groups.includes(team.group))
  const teamLabel = selectedTeams.length > 3 ? `${selectedTeams.length} 個團隊` : selectedTeams.map((team) => team.label).join(" · ") || "選擇團隊…"
  const projectLabel = DASHBOARD_PROJECTS.filter((project) => projects.includes(project.key)).map((project) => project.label).join(" · ") || "選擇專案…"

  return (
    <section aria-label="查詢範圍" className="mb-4 min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <form onSubmit={(event) => void query(event)} className="space-y-3">
        <fieldset className="min-w-0">
          <legend className="sr-only">資料範圍</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {([
              { value: "self", label: "自己" },
              { value: "person", label: "指定人" },
              { value: "team-project", label: "團隊／專案" },
            ] as const).map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-800 dark:text-slate-200">
                <input type="radio" name={`${id}-scope`} value={option.value} checked={mode === option.value} onChange={() => changeMode(option.value)} className={choiceClass} />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {mode !== "self" && <div className={mode === "team-project" ? "grid min-w-0 grid-cols-2 items-end gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]" : "grid min-w-0 grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"}>
          {mode === "person" && (
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <label htmlFor={`${id}-name`} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Jira 顯示名稱</label>
              <input id={`${id}-name`} type="text" value={name} maxLength={200} autoComplete="off" placeholder="輸入 Jira 顯示名稱" onChange={(event) => { editDraft(); setName(event.target.value); setCandidates([]); setSelectedPerson(null) }} aria-describedby={`${id}-help`} className={inputClass} />
            </div>
          )}
          {mode === "team-project" && (
            <>
              <FilterDropdown id={`${id}-teams`} label="團隊" value={teamLabel} open={dropdown === "teams"} onOpenChange={(open) => setDropdown(open ? "teams" : null)} describedBy={`${id}-help ${id}-team-help`}>
                <p className="px-3 py-2 text-xs leading-5 text-slate-500 dark:text-slate-400">勾選團隊選取全部成員；展開可逐人勾選。</p>
                {DASHBOARD_TEAMS.map((team) => {
                  const selected = groups.includes(team.group)
                  const open = expanded.includes(team.group)
                  const state = groupStates[team.group]
                  const selectedCount = state?.status === "success" && selected ? state.users.filter((user) => !(exclusions[team.group] ?? []).includes(user.accountId)).length : 0
                  return (
                    <div key={team.group} className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <button type="button" aria-label={`${open ? "收合" : "展開"} ${team.label} 成員`} aria-expanded={open} aria-controls={`${id}-${team.group}-members`} onClick={() => {
                          setExpanded(open ? expanded.filter((group) => group !== team.group) : [...expanded, team.group])
                          if (!open) void loadGroup(team.group)
                        }} className="shrink-0 rounded p-1 text-slate-500 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-slate-400">
                          <Chevron open={open} sideways />
                        </button>
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 text-sm text-slate-800 dark:text-slate-200">
                          <input type="checkbox" checked={selected} ref={(element) => { if (element) element.indeterminate = selected && state?.status === "success" && selectedCount > 0 && selectedCount < state.users.length }} onChange={(event) => toggleGroup(team.group, event.target.checked)} className={choiceClass} />
                          <span>{team.label}</span>
                        </label>
                        {selected && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400">{state?.status === "success" ? `${selectedCount}/${state.users.length}` : state?.status === "error" ? "載入失敗" : "載入中…"}</span>}
                      </div>
                      <div id={`${id}-${team.group}-members`} hidden={!open} className="space-y-2 py-2 pr-3 pl-10">
                        {(!state || state.status === "loading") && <p role="status" className="text-xs text-slate-600 dark:text-slate-400">正在載入完整成員名單…</p>}
                        {state?.status === "error" && (
                          <div className="space-y-2">
                            <FilterError error={state.error} reauthorizing={reauthorizing} onReauthorize={reauthorize} />
                            <button type="button" onClick={() => { setError(null); void loadGroup(team.group, true) }} className={buttonClass}>重試 {team.label}</button>
                          </div>
                        )}
                        {state?.status === "success" && (
                          <>
                            {!state.users.length && <p className="text-xs text-slate-600 dark:text-slate-400">此團隊沒有可選取的成員。</p>}
                            {state.users.map((user) => (
                              <label key={user.accountId} className="flex min-w-0 cursor-pointer items-start gap-2 text-sm text-slate-800 dark:text-slate-200">
                                <input type="checkbox" checked={selected && !(exclusions[team.group] ?? []).includes(user.accountId)} onChange={(event) => toggleMember(team.group, user.accountId, event.target.checked)} className={`${choiceClass} mt-1`} />
                                <span className="min-w-0 break-words">{user.displayName}</span>
                              </label>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </FilterDropdown>
              <FilterDropdown id={`${id}-projects`} label="專案" value={projectLabel} open={dropdown === "projects"} onOpenChange={(open) => setDropdown(open ? "projects" : null)} describedBy={`${id}-project-help`}>
                {DASHBOARD_PROJECTS.map((project) => (
                  <label key={project.key} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={projects.includes(project.key)} onChange={(event) => { editDraft(); setProjects(event.target.checked ? [...projects, project.key] : projects.filter((key) => key !== project.key)) }} className={choiceClass} />
                    <span>{project.label}</span>
                  </label>
                ))}
                <p id={`${id}-project-help`} className="px-3 py-2 text-xs leading-5 text-slate-500 dark:text-slate-400">未選取專案時，不加專案限制。</p>
              </FilterDropdown>
            </>
          )}
          <div className="flex h-10 min-w-0 items-center gap-2">
            <label htmlFor={`${id}-days`} className="flex min-w-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <span aria-hidden="true">近</span>
              <span className="sr-only">近幾天</span>
              <span className="w-16 min-w-0">
                <input id={`${id}-days`} type="text" inputMode="numeric" value={days} onChange={(event) => { editDraft(); setDays(event.target.value) }} aria-describedby={`${id}-help`} className={inputClass} />
              </span>
              <span aria-hidden="true">天</span>
            </label>
          </div>
          <button type="submit" disabled={personLoading || (mode === "team-project" && (!allGroupsLoaded || memberCount === 0))} aria-describedby={mode === "team-project" ? `${id}-team-help` : `${id}-help`} className="h-10 cursor-pointer rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50">{personLoading ? "查詢中…" : "查詢"}</button>
        </div>}
        {mode !== "self" && <p id={`${id}-help`} className="sr-only">{mode === "person" ? "按「查詢」或 Enter 搜尋；多人時選擇後再查詢。近 X 天須為正整數，預設 30 天。" : "按「查詢」套用團隊與專案；近 X 天須為正整數，預設 30 天。"}</p>}

        {mode === "person" && (personLoading || candidates.length > 1 || selectedPerson) && (
          <div className="min-w-0 space-y-3" aria-busy={personLoading}>
            {personLoading && <p role="status" className="text-sm text-slate-600 dark:text-slate-400">正在查詢 Jira 使用者…</p>}
            {candidates.length > 1 && (
              <fieldset className="min-w-0 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <legend className="px-1 text-sm font-medium text-slate-800 dark:text-slate-200">找到多位使用者，請選擇一人</legend>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {candidates.map((user) => (
                    <label key={user.accountId} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                      <input type="radio" name={`${id}-person`} value={user.accountId} checked={selectedPerson?.accountId === user.accountId} onChange={() => { editDraft(); setSelectedPerson(user) }} className={`${choiceClass} mt-1`} />
                      <span className="min-w-0 break-words text-sm text-slate-800 dark:text-slate-200">{user.displayName}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {selectedPerson && <p role="status" className="break-words text-sm text-slate-600 dark:text-slate-400">已選擇：{selectedPerson.displayName || "Jira 使用者"}</p>}
          </div>
        )}

        {mode === "team-project" && (
          <>
            <p id={`${id}-team-help`} role="status" className="text-xs leading-5 text-slate-500 dark:text-slate-400">{teamHint}</p>
            {selectedTeams.map((team) => {
              const state = groupStates[team.group]
              if (state?.status !== "error") return null
              return (
                <div key={team.group} className="space-y-2">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{team.label} 成員載入失敗</p>
                  <FilterError error={state.error} reauthorizing={reauthorizing} onReauthorize={reauthorize} />
                  <button type="button" onClick={() => { setError(null); void loadGroup(team.group, true) }} className={buttonClass}>重試 {team.label}</button>
                </div>
              )
            })}
          </>
        )}
        {error && <FilterError error={error} reauthorizing={reauthorizing} onReauthorize={reauthorize} />}
      </form>
    </section>
  )
}

function Chevron({ open, sideways = false }: { open: boolean; sideways?: boolean }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={sideways ? (open ? "rotate-90" : "") : (open ? "rotate-180" : "")}>
      <path d={sideways ? "m9 5 7 7-7 7" : "m6 9 6 6 6-6"} />
    </svg>
  )
}

function FilterDropdown({ id, label, value, open, onOpenChange, describedBy, children }: {
  id: string
  label: string
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
  describedBy: string
  children: ReactNode
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent | FocusEvent) {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) onOpenChange(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      onOpenChange(false)
      trigger.current?.focus()
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("focusin", outside)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("focusin", outside)
      document.removeEventListener("keydown", escape)
    }
  }, [open, onOpenChange])

  return (
    <div ref={wrapper} className="relative min-w-0" onBlur={(event) => {
      if (open && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(false)
    }}>
      <span id={`${id}-label`} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      <button ref={trigger} id={`${id}-trigger`} type="button" aria-expanded={open} aria-controls={`${id}-options`} aria-labelledby={`${id}-label ${id}-value`} aria-describedby={describedBy} onClick={() => onOpenChange(!open)} className={`${inputClass} flex h-10 items-center justify-between gap-2 text-left`}>
        <span id={`${id}-value`} className="truncate" title={value}>{value}</span>
        <span className="shrink-0"><Chevron open={open} /></span>
      </button>
      <fieldset id={`${id}-options`} hidden={!open} className="absolute top-full z-50 mt-1 max-h-[300px] w-full min-w-0 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <legend className="sr-only">{label}（可複選）</legend>
        {children}
      </fieldset>
    </div>
  )
}

function FilterError({ error, reauthorizing, onReauthorize }: { error: LookupError; reauthorizing: boolean; onReauthorize: () => void }) {
  return (
    <div role="alert" className="min-w-0 space-y-2">
      <p className="break-words text-sm leading-6 text-slate-800 dark:text-slate-200">{error.message}</p>
      {(error.code === "reauthorize" || error.code === "reauthorization_required" || error.code === "forbidden") && <button type="button" disabled={reauthorizing} onClick={onReauthorize} className={buttonClass}>{reauthorizing ? "處理中…" : "重新授權 Jira"}</button>}
    </div>
  )
}

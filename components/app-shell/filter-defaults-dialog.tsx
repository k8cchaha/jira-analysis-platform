"use client"

import { useEffect, useId, useRef, useState } from "react"
import { EditDialog } from "@/components/edit-dialog"
import { ProjectSelector } from "@/components/project-selector"
import { TeamSelect } from "@/components/team-select"
import { useFilterDefaults } from "@/components/filter-defaults-provider"
import { useNavigationBlocker } from "@/components/navigation-blocker"
import { EMPTY_FILTER_DEFAULTS, normalizeFilterDefaults, type FilterDefaults } from "@/lib/filter-defaults"

/** Each opening owns a snapshot; later store updates never replace its draft. */
export function FilterDefaultsDialog({ onClose }: { onClose: () => void }) {
  const { defaults, ready, saveDefaults } = useFilterDefaults()
  const { setBlocked } = useNavigationBlocker()
  const source = `filter-defaults-${useId()}`
  const [session, setSession] = useState<{ initial: FilterDefaults; draft: FilterDefaults } | null>(() => {
    if (!ready) return null
    const initial = normalizeFilterDefaults(defaults)
    return { initial, draft: initial }
  })
  // Readiness can arrive after the modal opens. Capture once, before enabling edits.
  if (ready && session === null) {
    const initial = normalizeFilterDefaults(defaults)
    setSession({ initial, draft: initial })
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saving = useRef(false)
  const mounted = useRef(false)
  const draft = session?.draft ?? EMPTY_FILTER_DEFAULTS
  const dirty = session !== null && JSON.stringify(session.initial) !== JSON.stringify(draft)
  const blocked = dirty || busy
  const disabled = !ready || session === null || busy

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    setBlocked(source, blocked)
    return () => setBlocked(source, false)
  }, [blocked, setBlocked, source])

  useEffect(() => {
    if (!blocked) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [blocked])

  function close() {
    if (saving.current) return
    if (dirty && !window.confirm("你有尚未儲存的預設值變更，確定要放棄嗎？")) return
    onClose()
  }

  function edit(next: FilterDefaults) {
    if (disabled || saving.current || !session) return
    setSession({ ...session, draft: normalizeFilterDefaults(next) })
    setError(null)
  }

  async function save() {
    if (disabled || saving.current || !session) return
    saving.current = true
    setBusy(true)
    setError(null)
    try {
      const next = normalizeFilterDefaults(session.draft)
      await saveDefaults(next)
      if (!mounted.current) return
      setSession({ initial: next, draft: next })
      setBlocked(source, false)
      onClose()
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "無法儲存預設值，草稿已保留，請重試。")
    } finally {
      saving.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <EditDialog title="預設值設定" description="預設值只帶入之後進入頁面時尚未指定的條件" size="small" fitContent iconClose busy={busy} onClose={close}>
      {/* Keep open dropdowns in the content flow so a compact modal does not clip their options. */}
      <div className="min-h-0 overflow-y-auto p-4 sm:p-6 [&_[id$='-options']]:static">
        {!ready && <p role="status" className="mb-4 text-sm text-slate-600 dark:text-slate-400">正在載入預設值…</p>}
        <fieldset disabled={disabled} className="space-y-6 border-0 p-0 disabled:opacity-60">
          <legend className="sr-only">專案與團隊預設值</legend>
          <div>
            <ProjectSelector project={draft.project} onProjectChange={(project) => edit({ ...draft, project })} onClear={() => edit({ ...draft, project: null })} />
          </div>
          <div>
            <TeamSelect groups={draft.groups} perMember={false} onGroupsChange={(groups) => edit({ ...draft, groups })} helpText="選取整組團隊作為之後進入頁面時的預設值；不設定個別成員排除，也不會重新查詢 Jira。" />
          </div>
        </fieldset>
      </div>
      <footer className="shrink-0 border-t border-slate-200 p-4 sm:px-6 dark:border-slate-800">
        {error && <p role="alert" className="mb-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={close} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">取消</button>
          <button type="button" disabled={disabled} onClick={() => { void save() }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "儲存中…" : "儲存"}</button>
        </div>
      </footer>
    </EditDialog>
  )
}

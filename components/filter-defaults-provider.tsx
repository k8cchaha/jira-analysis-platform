"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { EMPTY_FILTER_DEFAULTS, canDefaultTeamGroups, filterDefaultsStorageKey, readFilterDefaults, writeFilterDefaults, type FilterDefaults } from "@/lib/filter-defaults"

interface FilterDefaultsContextValue {
  defaults: FilterDefaults
  ready: boolean
  saveDefaults: (next: FilterDefaults) => Promise<void>
}
const FilterDefaultsContext = createContext<FilterDefaultsContextValue>({
  defaults: EMPTY_FILTER_DEFAULTS,
  ready: true,
  saveDefaults: async () => { throw new Error("尚未登入，無法儲存預設值。") },
})

/** Mounted with a viewer key in the authenticated layout; no cross-account state. */
export function FilterDefaultsProvider({ viewerId, children }: { viewerId: string; children: ReactNode }) {
  const [defaults, setDefaults] = useState(EMPTY_FILTER_DEFAULTS)
  const [ready, setReady] = useState(false)
  const key = filterDefaultsStorageKey(viewerId)
  useEffect(() => {
    let active = true
    function read() {
      if (!active) return
      let next = EMPTY_FILTER_DEFAULTS
      try { next = readFilterDefaults(window.localStorage, viewerId) } catch { /* Private/blocked storage. */ }
      setDefaults(next)
      setReady(true)
    }
    function storage(event: StorageEvent) {
      if (event.key === key || event.key === null) read()
    }
    queueMicrotask(read)
    window.addEventListener("storage", storage)
    return () => { active = false; window.removeEventListener("storage", storage) }
  }, [key, viewerId])

  const saveDefaults = useCallback(async (next: FilterDefaults) => {
    if (!ready) throw new Error("正在載入預設值，請稍候。")
    let saved: FilterDefaults
    try { saved = writeFilterDefaults(window.localStorage, viewerId, next) }
    catch (error) { throw new Error(error instanceof Error ? error.message : "無法儲存預設值，請重試。") }
    setDefaults(saved)
  }, [ready, viewerId])
  const value = useMemo(() => ({ defaults, ready, saveDefaults }), [defaults, ready, saveDefaults])
  return <FilterDefaultsContext.Provider value={value}>{children}</FilterDefaultsContext.Provider>
}
export function useFilterDefaults() { return useContext(FilterDefaultsContext) }

/** An entry snapshot, not a live binding: saves must never overwrite active filters. */
export function useInitialFilterDefaults(apply: (defaults: FilterDefaults) => void, eligible = true, waiting = false) {
  const { defaults, ready } = useFilterDefaults()
  const initialized = useRef(false)
  const edited = useRef(false)
  useEffect(() => {
    if (initialized.current || !ready || waiting) return
    initialized.current = true
    if (eligible && !edited.current) apply(defaults)
  }, [apply, defaults, eligible, ready, waiting])
  return useCallback(() => { edited.current = true }, [])
}

/** Whole-team root filters share initialization; member readiness remains TeamSelect's job. */
export function useDefaultTeamGroups(eligible = true) {
  const [groups, setGroups] = useState<string[]>([])
  const markEdited = useInitialFilterDefaults((defaults) => {
    const params = currentFilterParams()
    if (params && canDefaultTeamGroups(window.location.pathname, params)) setGroups([...defaults.groups])
  }, eligible)
  const changeGroups = useCallback((next: string[]) => { markEdited(); setGroups(next) }, [markEdited])
  return [groups, changeGroups] as const
}

/** Read at the time of initialization; null means no browser location is available. */
export function currentFilterParams(): URLSearchParams | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search)
}

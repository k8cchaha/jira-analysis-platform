import { DASHBOARD_TEAMS, isDashboardAccountId, type DashboardUser } from "@/lib/jira-dashboard-filter"

export type TeamMembersState =
  | { status: "loading" }
  | { status: "success"; members: DashboardUser[] }
  | { status: "error"; error: { code: string; message: string } }
export type TeamMembersSnapshot = Readonly<Partial<Record<string, TeamMembersState>>>

const EMPTY: TeamMembersSnapshot = Object.freeze({})
const CONCURRENCY = 4
const retryError: TeamMembersState = {
  status: "error", error: { code: "retry", message: "無法完整載入團隊成員，請重試。" },
}

/** One authenticated application owns one store. No network during construction/SSR,
 * no browser persistence, and no server/module singleton containing user data. */
export function createTeamMembersStore(fetcher: typeof fetch = (...args) => fetch(...args)) {
  let snapshot: TeamMembersSnapshot = EMPTY
  let disposed = false
  let leases = 0
  let active = 0
  const listeners = new Set<() => void>()
  const allowed = new Set<string>(DASHBOARD_TEAMS.map((team) => team.group))
  const requests = new Map<string, { promise: Promise<void>; resolve: () => void; controller?: AbortController }>()
  const queue: string[] = []

  function publish(group: string, state: TeamMembersState) {
    snapshot = { ...snapshot, [group]: state }
    for (const listener of listeners) listener()
  }

  async function lookup(group: string, signal: AbortSignal): Promise<TeamMembersState> {
    try {
      const response = await fetcher(`/api/dashboard/lookups?view=group&group=${encodeURIComponent(group)}`, { cache: "no-store", signal })
      const value: unknown = await response.json()
      if (!value || typeof value !== "object") throw new Error("Invalid lookup response")
      const result = value as Record<string, unknown>
      if (result.status === "error" && result.error && typeof result.error === "object") {
        const error = result.error as Record<string, unknown>
        if (typeof error.code === "string" && typeof error.message === "string") {
          return { status: "error", error: { code: error.code, message: error.message } }
        }
      }
      if (!response.ok || result.status !== "success" || !Array.isArray(result.members)) throw new Error("Invalid lookup response")
      const members = new Map<string, DashboardUser>()
      for (const item of result.members) {
        if (!item || typeof item !== "object" || !isDashboardAccountId(item.accountId) || typeof item.displayName !== "string" || item.displayName.length > 200 || /[\u0000-\u001f]/.test(item.displayName)) {
          throw new Error("Invalid lookup member")
        }
        members.set(item.accountId, { accountId: item.accountId, displayName: item.displayName })
      }
      return { status: "success", members: [...members.values()] }
    } catch {
      return retryError
    }
  }

  function pump() {
    while (!disposed && active < CONCURRENCY && queue.length) {
      const group = queue.shift()!
      const request = requests.get(group)!
      const controller = new AbortController()
      request.controller = controller
      active++
      void lookup(group, controller.signal).then((result) => {
        if (!disposed) publish(group, result)
      }).finally(() => {
        active--
        requests.delete(group)
        request.resolve()
        pump()
      })
    }
  }

  function ensure(group: string, retry = false): Promise<void> {
    if (disposed) return Promise.resolve()
    if (!allowed.has(group)) throw new Error("Invalid team group")
    const pending = requests.get(group)
    if (pending) return pending.promise
    const state = snapshot[group]
    if (state?.status === "success" || (state?.status === "error" && !retry)) return Promise.resolve()
    let resolve!: () => void
    const promise = new Promise<void>((done) => { resolve = done })
    // Register before notifying subscribers: even reentrant ensures share this request.
    requests.set(group, { promise, resolve })
    queue.push(group)
    publish(group, { status: "loading" })
    pump()
    return promise
  }

  function preload() {
    return Promise.all(DASHBOARD_TEAMS.map((team) => ensure(team.group))).then(() => {})
  }

  function dispose() {
    disposed = true
    for (const request of requests.values()) {
      request.controller?.abort()
      request.resolve()
    }
    requests.clear()
    queue.length = 0
    snapshot = EMPTY
    listeners.clear()
  }

  return {
    subscribe(listener: () => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY,
    ensure,
    retry: (group: string) => ensure(group, true),
    preload,
    /** Consumer unmounts only unsubscribe. Only the application provider owns this lease.
     * Deferred disposal allows React StrictMode's immediate cleanup/setup to reuse work. */
    retain() {
      if (disposed) return () => {}
      leases++
      void preload()
      let released = false
      return () => {
        if (released) return
        released = true
        leases--
        queueMicrotask(() => { if (!leases && !disposed) dispose() })
      }
    },
  }
}

export type TeamMembersStore = ReturnType<typeof createTeamMembersStore>

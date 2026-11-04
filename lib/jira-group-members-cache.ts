import "server-only"

import { JiraAuthorizationError, type JiraCredentials } from "@/lib/jira-token"
import type { DashboardUser } from "@/lib/jira-dashboard-filter"

export const GROUP_MEMBERS_TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 256
const MAX_INFLIGHT = 32

type Members = DashboardUser[]
type Entry = { members: Members; expiresAt: number }
type Pending = { promise: Promise<Members> }

export class GroupMembersCacheCapacityError extends Error {
  readonly code = "group_members_cache_capacity"
  constructor() {
    super("Group member cache is busy")
    this.name = "GroupMembersCacheCapacityError"
  }
}

function copyMembers(members: Members): Members {
  return members.map(({ accountId, displayName }) => ({ accountId, displayName }))
}

/** Only a fully validated group loader may publish here; never cache a client population. */
export function createJiraGroupMembersCache({
  now = Date.now,
  ttlMs = GROUP_MEMBERS_TTL_MS,
  maxEntries = MAX_ENTRIES,
  maxInflight = MAX_INFLIGHT,
}: {
  now?: () => number
  ttlMs?: number
  maxEntries?: number
  maxInflight?: number
} = {}) {
  if (![ttlMs, maxEntries, maxInflight].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError("Group member cache limits must be positive integers")
  }
  const completed = new Map<string, Entry>()
  const inflight = new Map<string, Pending>()

  return {
    async get(credentials: JiraCredentials, group: string, load: () => Promise<Members>): Promise<Members> {
      const timestamp = now()
      // Even a warm entry requires current server-derived identity and usable credentials.
      if (typeof credentials.viewerId !== "string" || !credentials.viewerId.trim() ||
          typeof credentials.cloudId !== "string" || !credentials.cloudId.trim() ||
          typeof credentials.accessToken !== "string" || !credentials.accessToken.trim() ||
          !Number.isFinite(credentials.expiresAt) || credentials.expiresAt <= Math.floor(timestamp / 1000)) {
        throw new JiraAuthorizationError("Jira authorization must be renewed", "reauthorization_required")
      }
      const key = JSON.stringify([credentials.viewerId, credentials.cloudId, group])
      for (const [existingKey, entry] of completed) {
        if (entry.expiresAt <= timestamp) completed.delete(existingKey)
      }
      const hit = completed.get(key)
      if (hit) {
        completed.delete(key)
        completed.set(key, hit) // LRU only; a hit never extends the hard expiry.
        return copyMembers(hit.members)
      }
      const pending = inflight.get(key)
      if (pending) return copyMembers(await pending.promise)
      if (inflight.size >= maxInflight) throw new GroupMembersCacheCapacityError()

      // Register before invoking the loader, including synchronously throwing/reentrant loaders.
      const entry: Pending = { promise: Promise.resolve().then(load) }
      inflight.set(key, entry)
      try {
        const members = copyMembers(await entry.promise)
        if (inflight.get(key) === entry) {
          while (completed.size >= maxEntries) {
            const oldest = completed.keys().next().value
            if (oldest === undefined) break
            completed.delete(oldest)
          }
          completed.set(key, { members, expiresAt: now() + ttlMs })
        }
        return copyMembers(members)
      } finally {
        // Failed or incomplete loads leave neither a cached value nor a rejected promise.
        if (inflight.get(key) === entry) inflight.delete(key)
      }
    },
  }
}

type GroupMembersCache = ReturnType<typeof createJiraGroupMembersCache>
const CACHE_KEY = Symbol.for("jira-analysis-platform.group-members-cache.v1")

/** Separate route bundles share a cache within this realm, not across workers/cold starts. */
export function getSharedJiraGroupMembersCache(): GroupMembersCache {
  const registry = globalThis as typeof globalThis & { [key: symbol]: GroupMembersCache | undefined }
  return registry[CACHE_KEY] ??= createJiraGroupMembersCache()
}

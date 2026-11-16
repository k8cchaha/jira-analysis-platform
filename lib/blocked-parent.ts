/**
 * Parent statuses that count as "blocked". A Dev-Task whose parent sits in one of these is treated as completed
 * once 「受阻母票計為已完成」 is ticked, on both the Burndown/dev-status page and 專案回顧.
 */
export const BLOCKED_PARENT_STATUSES: ReadonlySet<string> = new Set(["Request Info", "Pending", "Reproduce"])

/** Ticked (or omitted) → blocked parents count as done; explicitly null → they do not. */
export function isBlockedParentStatus(parentStatus: string | null | undefined, enabled: boolean): boolean {
  return enabled && typeof parentStatus === "string" && BLOCKED_PARENT_STATUSES.has(parentStatus)
}

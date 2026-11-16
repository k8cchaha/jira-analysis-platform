import type { SprintProjectKey } from "./jira-jql"

/**
 * Placeholder team capacity until a real capacity API exists.
 * Every member is assumed to have the same per-Sprint points: Saku 20, Telasa 40 (other projects follow Saku).
 */
export const CAPACITY_POINTS_PER_MEMBER: Record<SprintProjectKey, number> = { SUN: 20, TKK: 40, PRIDE: 20 }

export type TeamCapacity = {
  /** Team id used by the dashboard team registry. */
  teamId: string
  /** Members counted for this team; capacity is this count times the per-member points. */
  memberCount: number
  capacity: number
}

/** Capacity per team for one project, from the member counts of the teams actually present. */
export function teamCapacities(project: SprintProjectKey, memberCounts: Readonly<Record<string, number>>): TeamCapacity[] {
  // Unknown or missing project keys fall back to the Saku default instead of producing NaN capacity.
  const points = CAPACITY_POINTS_PER_MEMBER[project] ?? CAPACITY_POINTS_PER_MEMBER.SUN
  return Object.entries(memberCounts)
    .filter(([, count]) => count > 0)
    .map(([teamId, memberCount]) => ({ teamId, memberCount, capacity: memberCount * points }))
    .sort((a, b) => a.teamId.localeCompare(b.teamId))
}

/** Completed Story Points divided by team capacity; null when the team has no capacity to divide by. */
export function capacityRealization(completedPoints: number | null, capacity: number | null): number | null {
  if (completedPoints === null || capacity === null || capacity <= 0) return null
  return completedPoints / capacity
}

/** Placeholder per-member capacity for one project and Sprint: the same flat points every member gets. */
export function memberCapacity(project: SprintProjectKey): number {
  return CAPACITY_POINTS_PER_MEMBER[project] ?? CAPACITY_POINTS_PER_MEMBER.SUN
}

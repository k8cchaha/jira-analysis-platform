import { SPRINT_PROJECTS, type SprintProjectKey } from "./jira-jql"

/**
 * Sprint 資料（手動填寫）。
 *
 * 這是各專案進行中 Sprint 的靜態資料，目前由人工維護，取代尚未接通的
 * Jira Agile API。欄位與 Jira Agile `board/{id}/sprint` 回傳的屬性對應，
 * 方便日後無痛切回 API。
 *
 * 結構：以專案 key（SUN / TKK / PRIDE）為第一層，底下是該專案的 sprint 陣列。
 * 日期一律使用 `YYYY-MM-DD`（Jira sprint 的 startDate/endDate 格式）。
 */

export interface SprintRecord {
  /** Jira 的 sprint id（Agile API 的 `id`，數字）。 */
  id: number
  /** Sprint 名稱，例如 `"Sprint 24"`。 */
  name: string
  /** 開始日，`YYYY-MM-DD`。 */
  startDate: string
  /** 結束日，`YYYY-MM-DD`。 */
  endDate: string
}

/** 以專案為 key 的 sprint 資料映射。填入你各專案的 sprint。 */
export const SPRINT_DATA = {
  SUN: [
    { id: 6823, name: "Sprint 58", startDate: "2026-04-28", endDate: "2026-05-11" },
    { id: 6824, name: "Sprint 59", startDate: "2026-05-12", endDate: "2026-05-25" },
    { id: 6825, name: "Sprint 60", startDate: "2026-05-26", endDate: "2026-06-08" },
    { id: 7323, name: "Sprint 61", startDate: "2026-06-09", endDate: "2026-06-22" },
    { id: 7324, name: "Sprint 62", startDate: "2026-06-23", endDate: "2026-07-06" },
    { id: 7510, name: "Sprint 63", startDate: "2026-07-07", endDate: "2026-07-20" },
    { id: 7511, name: "Sprint 64", startDate: "2026-07-21", endDate: "2026-08-03" },
    { id: 7512, name: "Sprint 65", startDate: "2026-08-04", endDate: "2026-08-17" },
    { id: 7513, name: "Sprint 66", startDate: "2026-08-18", endDate: "2026-08-31" },
    { id: 7514, name: "Sprint 67", startDate: "2026-09-01", endDate: "2026-09-14" },
    { id: 7515, name: "Sprint 68", startDate: "2026-09-15", endDate: "2026-09-28" },
    { id: 7516, name: "Sprint 69", startDate: "2026-09-29", endDate: "2026-10-12" },
    { id: 7517, name: "Sprint 70", startDate: "2026-10-13", endDate: "2026-10-25" },
    { id: 7518, name: "Sprint 71", startDate: "2026-10-26", endDate: "2026-11-08" },
    { id: 7519, name: "Sprint 72", startDate: "2026-11-09", endDate: "2026-11-22" },
    { id: 7520, name: "Sprint 73", startDate: "2026-11-23", endDate: "2026-12-06" },
    { id: 7521, name: "Sprint 74", startDate: "2026-12-07", endDate: "2026-12-20" },
    { id: 7522, name: "Sprint 75", startDate: "2026-12-21", endDate: "2027-01-04" },
  ],
  TKK: [
    { id: 6619, name: "S128", startDate: "2026-05-17", endDate: "2026-06-11" },
    { id: 6620, name: "S129", startDate: "2026-06-17", endDate: "2026-07-19" },
    { id: 7358, name: "S130", startDate: "2026-07-23", endDate: "2026-08-16" },
    { id: 7400, name: "S131", startDate: "2026-08-17", endDate: "2026-09-20" },
    { id: 7401, name: "S132", startDate: "2026-09-21", endDate: "2026-10-25" },
    { id: 7402, name: "S133", startDate: "2026-10-26", endDate: "2026-11-22" },
    { id: 7403, name: "S134", startDate: "2026-11-23", endDate: "2026-12-20" },
    { id: 7404, name: "S135", startDate: "2026-12-21", endDate: "2027-01-24" },
  ],
  PRIDE: [
    { id: 7362, name: "Sprint 19", startDate: "2026-05-05", endDate: "2026-05-17" },
    { id: 7406, name: "Sprint 20", startDate: "2026-05-19", endDate: "2026-05-31" },
    { id: 7440, name: "Sprint 21", startDate: "2026-06-02", endDate: "2026-06-14" },
    { id: 7474, name: "Sprint 22", startDate: "2026-06-16", endDate: "2026-06-28" },
    { id: 7526, name: "Sprint 23", startDate: "2026-06-30", endDate: "2026-07-12" },
    { id: 7527, name: "Sprint 24", startDate: "2026-07-14", endDate: "2026-07-26" },
    { id: 7565, name: "Sprint 25", startDate: "2026-07-28", endDate: "2026-08-09" },
    { id: 7598, name: "Sprint 26", startDate: "2026-08-13", endDate: "2026-08-24" },
    { id: 7601, name: "Sprint 27", startDate: "2026-08-25", endDate: "2026-09-06" },
    { id: 7634, name: "Sprint 28", startDate: "2026-09-08", endDate: "2026-09-21" },
    { id: 7640, name: "Sprint 29", startDate: "2026-09-22", endDate: "2026-10-05" },
    { id: 7676, name: "Sprint 30", startDate: "2026-10-06", endDate: "2026-10-19" },
  ],
} as const satisfies Record<SprintProjectKey, readonly SprintRecord[]>

/** 取得某專案的所有 sprint（照 startDate 排序）。 */
export function getProjectSprints(
  projectKey: SprintProjectKey
): readonly SprintRecord[] {
  return [...SPRINT_DATA[projectKey]].sort((a, b) =>
    a.startDate.localeCompare(b.startDate)
  )
}

/**
 * 取得某專案「已開始」的 sprint（過濾尚未發生的）：`startDate <= today`。
 * 未發生的 sprint（未來尚未開始）不會顯示。照 startDate 排序。
 */
export function getVisibleSprints(
  projectKey: SprintProjectKey,
  today = new Date().toISOString().slice(0, 10)
): readonly SprintRecord[] {
  return [...SPRINT_DATA[projectKey]]
    .filter((sprint) => sprint.startDate <= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}

/**
 * 目前的 sprint：startDate <= today <= endDate。
 * 若有多個重疊（例如跨 board），取最早開始、同始 tie 到最小 id。
 */
export function currentSprint(
  sprints: readonly SprintRecord[],
  today = new Date().toISOString().slice(0, 10)
): SprintRecord | null {
  let match: SprintRecord | null = null
  for (const sprint of sprints) {
    if (sprint.startDate > today || sprint.endDate < today) continue
    if (
      match === null ||
      sprint.startDate < match.startDate ||
      (sprint.startDate === match.startDate && sprint.id < match.id)
    ) {
      match = sprint
    }
  }
  return match
}

/**
 * Sprint 管理 → Planning 的下拉選項：只提供「當前 Sprint ＋ 下一個 Sprint」。
 *
 * 以「目前進行中的 sprint」為焦點，取它在 `getProjectSprints`（照 startDate
 * 升序）之後緊接著的一棒為「下一個」。若目前沒有進行中的 sprint（例如專案
 * 的 sprint 都還沒開始、或最後一個已結束於今天之前），回空陣列——不退回
 * 顯示已過去的 sprint（使用者明確要求顯示空狀態）。
 */
export function getPlanningSprints(
  projectKey: SprintProjectKey,
  today = new Date().toISOString().slice(0, 10)
): readonly SprintRecord[] {
  const all = getProjectSprints(projectKey)
  const current = currentSprint(all, today)
  if (current === null) return []
  const next = all.find((sprint) => sprint.startDate > current.startDate) ?? null
  return next ? [current, next] : [current]
}
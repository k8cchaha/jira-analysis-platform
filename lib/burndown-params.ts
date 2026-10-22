import { SPRINT_PROJECTS, type SprintProjectKey } from "./jira-jql"
import {
  currentSprint,
  getPlanningSprints,
  getProjectSprints,
  getVisibleSprints,
  type SprintRecord,
} from "./jira-sprint-data"

/**
 * Burndown 查詢參數的共用解析/驗證（純模組，無 I/O、無 `server-only`）。
 *
 * `page.tsx`（RSC）與 SSE 路由 `app/api/sprint/burndown/stream/route.ts`
 * 共用同一份參數驗證，避免兩地複製邏輯而導致驗證規則不一致。
 */

/** 把 URL 上的專案參數解析成 `SprintProjectKey`；無效或缺失回 `null`。 */
export function parseProjectKey(value: string | undefined): SprintProjectKey | null {
  if (typeof value !== "string") return null
  return (SPRINT_PROJECTS as readonly { key: string }[]).some(
    (option) => option.key === value
  )
    ? (value as SprintProjectKey)
    : null
}

/** 把 URL 上的 sprint 參數解析成正整數 id；無效或缺失回 `null`。 */
export function parseSprintId(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 依專案與 sprint id 從寫死的 `SPRINT_DATA` 抓完整 `SprintRecord`；不存在回 `null`。 */
export function getSprintById(
  projectKey: SprintProjectKey,
  sprintId: number
): SprintRecord | null {
  return (
    getProjectSprints(projectKey).find((sprint) => sprint.id === sprintId) ?? null
  )
}

/**
 * 決定要顯示的 sprint：
 * - `requestedSprintId` 是該專案可見（已開始）sprint 之一 → 用 select 該 id；
 * - 否則回目前 sprint（`startDate <= today <= endDate`）；
 * - 無專案或無已開始 sprint → `null`。
 */
export function resolveSprint(
  projectKey: SprintProjectKey | null,
  requestedSprintId: number | null,
  today: string
): SprintRecord | null {
  if (!projectKey) return null
  const visibleSprints = getVisibleSprints(projectKey, today)
  if (requestedSprintId !== null) {
    const match = visibleSprints.find((sprint) => sprint.id === requestedSprintId)
    if (match) return match
  }
  return currentSprint(visibleSprints, today)
}

/**
 * 決定 Planning 頁面要顯示的 sprint（只允許「當前＋下一個」這對）：
 * - `requestedSprintId` 是該專案 planning 對之一 → 選它；
 * - 否則回 planning 對的第一個（當前 sprint）；
 * - 無專案、或該專案沒有進行中／未來的 sprint（planning 對為空）→ `null`。
 */
export function resolvePlanningSprint(
  projectKey: SprintProjectKey | null,
  requestedSprintId: number | null,
  today: string
): SprintRecord | null {
  if (!projectKey) return null
  const planning = getPlanningSprints(projectKey, today)
  if (planning.length === 0) return null
  if (requestedSprintId !== null) {
    const match = planning.find((sprint) => sprint.id === requestedSprintId)
    if (match) return match
  }
  return planning[0]
}
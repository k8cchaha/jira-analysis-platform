"use client"

import type { DashboardFilter } from "@/lib/jira-dashboard-filter"
import { MissingDataDialog } from "./missing-data-dialog"

/** Reuse the guarded editor lifecycle; nonself scopes remain read-only. */
export function ImpactScopeDialog({ filter, scopeChanged, onClose, onSaved }: {
  filter: DashboardFilter
  scopeChanged: boolean
  onClose: () => void
  onSaved: () => void
}) {
  return <MissingDataDialog kind="impact-scope" filter={filter} scopeChanged={scopeChanged} onClose={onClose} onSaved={onSaved} />
}

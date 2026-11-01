"use client"

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { createTeamMembersStore, type TeamMembersStore } from "@/lib/team-members-store"

const TeamMembersContext = createContext<TeamMembersStore | null>(null)

export function TeamMembersProvider({ viewerId, children }: { viewerId: string; children: ReactNode }) {
  // A new viewer gets a new store even if a parent reuses this provider component.
  return <ViewerTeamMembersProvider key={viewerId}>{children}</ViewerTeamMembersProvider>
}

function ViewerTeamMembersProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createTeamMembersStore)
  useEffect(() => store.retain(), [store])
  return <TeamMembersContext.Provider value={store}>{children}</TeamMembersContext.Provider>
}

export function useTeamMembers() {
  const store = useContext(TeamMembersContext)
  if (!store) throw new Error("TeamMembersProvider is required")
  const groupStates = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  return { groupStates, loadGroup: store.ensure, retryGroup: store.retry }
}

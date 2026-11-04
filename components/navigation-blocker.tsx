"use client"

import Link from "next/link"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"

type NavigationBlockerContextValue = {
  isBlocked: boolean
  setBlocked: (source: string, blocked: boolean) => void
}

const NavigationBlockerContext = createContext<NavigationBlockerContextValue>({
  isBlocked: false,
  setBlocked: () => {},
})

export function NavigationBlockerProvider({ children }: { children: ReactNode }) {
  const [blockedSources, setBlockedSources] = useState<Set<string>>(
    () => new Set()
  )
  const setBlocked = useCallback((source: string, blocked: boolean) => {
    setBlockedSources((current) => {
      const next = new Set(current)
      if (blocked) next.add(source)
      else next.delete(source)
      return next
    })
  }, [])
  const value = useMemo(
    () => ({ isBlocked: blockedSources.size > 0, setBlocked }),
    [blockedSources, setBlocked]
  )

  return (
    <NavigationBlockerContext.Provider value={value}>
      {children}
    </NavigationBlockerContext.Provider>
  )
}

export function useNavigationBlocker() {
  return useContext(NavigationBlockerContext)
}

export function GuardedLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  const { isBlocked } = useNavigationBlocker()

  return (
    <Link
      {...props}
      onNavigate={(event) => {
        if (
          isBlocked &&
          !window.confirm("你有尚未儲存的變更，確定要離開此頁面嗎？")
        ) {
          event.preventDefault()
          return
        }

        onNavigate?.(event)
      }}
    />
  )
}

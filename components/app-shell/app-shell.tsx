"use client"

import { usePathname } from "next/navigation"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { MenuIcon, NavigationIconGlyph } from "@/components/app-shell/icons"
import {
  dashboardNavigation,
  getNavigationState,
  navigationCategories,
  type NavigationFeature,
} from "@/components/app-shell/navigation"
import { logout } from "@/components/app-shell/logout-action"
import { GuardedLink } from "@/components/navigation-blocker"

const SIDEBAR_KEY = "jira-analysis:sidebar-collapsed"
const GROUPS_KEY = "jira-analysis:sidebar-groups"
const PREFERENCES_EVENT = "jira-analysis:sidebar-preferences"
const DEFAULT_GROUPS = "[]"

let collapsedFallback = false
let groupsFallback = DEFAULT_GROUPS

type SafeUser = {
  name: string
  email?: string
  image?: string
}

type AppShellProps = {
  children: ReactNode
  user: SafeUser
}

export function AppShell({ children, user }: AppShellProps) {
  const pathname = usePathname()
  const navigationState = useMemo(() => getNavigationState(pathname), [pathname])
  const collapsed = useSyncExternalStore(
    subscribeToPreferences,
    readCollapsedPreference,
    getDefaultCollapsedPreference
  )
  const serializedGroups = useSyncExternalStore(
    subscribeToPreferences,
    readExpandedGroupsPreference,
    getDefaultExpandedGroupsPreference
  )
  const expandedGroups = useMemo(
    () => new Set<string>(JSON.parse(serializedGroups)),
    [serializedGroups]
  )
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileDrawerRef = useRef<HTMLElement>(null)

  const closeMobileDrawer = useCallback((restoreFocus = true) => {
    setMobileOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => mobileTriggerRef.current?.focus())
    }
  }, [])

  useEffect(() => {
    if (!mobileOpen) return

    const desktopQuery = window.matchMedia("(min-width: 64rem)")
    function handleDesktopViewport(event: MediaQueryListEvent) {
      if (event.matches) closeMobileDrawer(false)
    }
    desktopQuery.addEventListener("change", handleDesktopViewport)

    const drawer = mobileDrawerRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const focusableElements = getFocusableElements(drawer)
    focusableElements[0]?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        closeMobileDrawer()
        return
      }

      if (event.key !== "Tab") return

      const elements = getFocusableElements(drawer)
      const first = elements[0]
      const last = elements.at(-1)
      if (!first || !last) {
        event.preventDefault()
        return
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
      desktopQuery.removeEventListener("change", handleDesktopViewport)
    }
  }, [closeMobileDrawer, mobileOpen])

  function toggleCollapsed() {
    writeCollapsedPreference(!collapsed)
  }

  function toggleGroup(groupId: string) {
    if (groupId === navigationState.categoryId) return

    const next = new Set(expandedGroups)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    writeExpandedGroupsPreference(next)
  }

  const initials =
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U"

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <aside
        className={`fixed inset-y-0 left-0 z-50 hidden border-r border-slate-200 bg-white transition-[width] duration-200 lg:block dark:border-slate-800 dark:bg-slate-900 ${collapsed ? "w-20" : "w-72"}`}
      >
        <SidebarContent
          collapsed={collapsed}
          expandedGroups={expandedGroups}
          pathname={pathname}
          currentCategoryId={navigationState.categoryId}
          toggleGroup={toggleGroup}
        />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="關閉導覽選單"
            className="absolute inset-0 bg-slate-950/55"
            onClick={() => closeMobileDrawer()}
          />
          <aside
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="導覽選單"
            className="relative h-full w-[min(18rem,calc(100vw-3rem))] border-r border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <SidebarContent
              collapsed={false}
              expandedGroups={expandedGroups}
              pathname={pathname}
              currentCategoryId={navigationState.categoryId}
              toggleGroup={toggleGroup}
              onClose={closeMobileDrawer}
              onNavigate={() => closeMobileDrawer(false)}
            />
          </aside>
        </div>
      ) : null}

      <div
        className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-20" : "lg:pl-72"}`}
      >
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
          <button
            ref={mobileTriggerRef}
            type="button"
            aria-label="開啟導覽選單"
            aria-expanded={mobileOpen}
            className="app-icon-button lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <MenuIcon />
          </button>
          <button
            type="button"
            aria-label={collapsed ? "展開側邊欄" : "收合側邊欄"}
            className="app-icon-button hidden lg:inline-flex"
            onClick={toggleCollapsed}
          >
            <MenuIcon open={!collapsed} />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white">
            {navigationState.title}
          </p>
          <div className="flex items-center gap-2 border-l border-slate-200 pl-3 dark:border-slate-700">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="max-w-40 truncate text-sm font-medium text-slate-900 dark:text-white">
                {user.name}
              </p>
              {user.email ? (
                <p className="max-w-40 truncate text-xs text-slate-500 dark:text-slate-400">
                  {user.email}
                </p>
              ) : null}
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="app-icon-button"
                aria-label="登出"
                title="登出"
              >
                <svg
                  aria-hidden="true"
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 17l5-5-5-5M15 12H3" />
                  <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
                </svg>
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  )
}

function SidebarContent({
  collapsed,
  expandedGroups,
  pathname,
  currentCategoryId,
  toggleGroup,
  onClose,
  onNavigate,
}: {
  collapsed: boolean
  expandedGroups: Set<string>
  pathname: string
  currentCategoryId: string | null
  toggleGroup: (groupId: string) => void
  onClose?: (restoreFocus?: boolean) => void
  onNavigate?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div
        className={`flex h-16 items-center border-b border-slate-200 dark:border-slate-800 ${collapsed ? "justify-center px-3" : "px-5"}`}
      >
        <GuardedLink
          href="/dashboard"
          className="flex min-w-0 flex-1 items-center gap-3"
          title="Jira Analysis"
          onNavigate={onNavigate}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 18V9M12 18V5M19 18v-6" />
            </svg>
          </span>
          {!collapsed ? (
            <span className="truncate text-sm font-semibold tracking-tight text-slate-950 dark:text-white">
              Jira Analysis
            </span>
          ) : null}
        </GuardedLink>
        {onClose ? (
          <button
            type="button"
            className="app-icon-button shrink-0"
            aria-label="關閉導覽選單"
            onClick={() => onClose()}
          >
            <MenuIcon open />
          </button>
        ) : null}
      </div>
      <nav aria-label="主要導覽" className="app-scrollbar flex-1 overflow-y-auto px-3 py-4">
        <GuardedLink
          href={dashboardNavigation.href}
          title={collapsed ? dashboardNavigation.label : undefined}
          aria-current={pathname === dashboardNavigation.href ? "page" : undefined}
          className={`app-nav-item ${pathname === dashboardNavigation.href ? "app-nav-item-active" : ""} ${collapsed ? "justify-center px-2" : ""}`}
          onNavigate={onNavigate}
        >
          <NavigationIconGlyph name={dashboardNavigation.icon} />
          {!collapsed ? <span>{dashboardNavigation.label}</span> : null}
        </GuardedLink>
        <div className="mt-5 space-y-4">
          {navigationCategories.map((category) => {
            const open =
              currentCategoryId === category.id || expandedGroups.has(category.id)
            return (
              <section key={category.id}>
                {collapsed ? (
                  <div className="mx-auto mb-2 h-px w-8 bg-slate-200 dark:bg-slate-700" />
                ) : (
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-500 hover:text-slate-800 disabled:cursor-default disabled:hover:text-slate-500 dark:text-slate-400 dark:hover:text-slate-100 dark:disabled:hover:text-slate-400"
                    aria-expanded={open}
                    aria-controls={`navigation-group-${category.id}`}
                    aria-disabled={currentCategoryId === category.id}
                    disabled={currentCategoryId === category.id}
                    onClick={() => toggleGroup(category.id)}
                  >
                    <span>{category.label}</span>
                    <svg
                      aria-hidden="true"
                      className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                )}
                <div
                  id={`navigation-group-${category.id}`}
                  className={`${collapsed || open ? "mt-1 space-y-1" : "hidden"}`}
                >
                  {category.features.map((feature) => (
                    <FeatureNavigation
                      key={feature.id}
                      feature={feature}
                      pathname={pathname}
                      collapsed={collapsed}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

function FeatureNavigation({
  feature,
  pathname,
  collapsed,
  onNavigate,
}: {
  feature: NavigationFeature
  pathname: string
  collapsed: boolean
  onNavigate?: () => void
}) {
  const canonical = feature.routes[0]
  const active = feature.routes.some((route) => route.href === pathname)

  return (
    <div>
      <GuardedLink
        href={canonical.href}
        title={collapsed ? feature.label : undefined}
        aria-current={pathname === canonical.href ? "page" : undefined}
        className={`app-nav-item ${active ? "app-nav-item-active" : ""} ${collapsed ? "justify-center px-2" : ""}`}
        onNavigate={onNavigate}
      >
        <NavigationIconGlyph name={feature.icon} />
        {!collapsed ? <span className="truncate">{feature.label}</span> : null}
      </GuardedLink>
      {!collapsed && feature.routes.length > 1 && active ? (
        <div className="ml-6 mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-700">
          {feature.routes.map((route) => (
            <GuardedLink
              key={route.href}
              href={route.href}
              aria-current={pathname === route.href ? "page" : undefined}
              className={`block rounded-md px-2 py-1.5 text-xs transition-colors ${pathname === route.href ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-200" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"}`}
              onNavigate={onNavigate}
            >
              {route.label}
            </GuardedLink>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function subscribeToPreferences(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(PREFERENCES_EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(PREFERENCES_EVENT, callback)
  }
}

function getDefaultCollapsedPreference() {
  return false
}

function readCollapsedPreference() {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_KEY)
    return stored === null ? collapsedFallback : stored === "true"
  } catch {
    return collapsedFallback
  }
}

function writeCollapsedPreference(value: boolean) {
  collapsedFallback = value
  try {
    window.localStorage.setItem(SIDEBAR_KEY, String(value))
  } catch {}
  window.dispatchEvent(new Event(PREFERENCES_EVENT))
}

function getDefaultExpandedGroupsPreference() {
  return DEFAULT_GROUPS
}

function readExpandedGroupsPreference() {
  try {
    const stored = window.localStorage.getItem(GROUPS_KEY)
    return stored === null ? groupsFallback : normalizeExpandedGroups(stored)
  } catch {
    return groupsFallback
  }
}

function writeExpandedGroupsPreference(groups: Set<string>) {
  const serialized = JSON.stringify([...groups])
  groupsFallback = serialized
  try {
    window.localStorage.setItem(GROUPS_KEY, serialized)
  } catch {}
  window.dispatchEvent(new Event(PREFERENCES_EVENT))
}

function normalizeExpandedGroups(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return DEFAULT_GROUPS

    const validIds = new Set<string>(
      navigationCategories.map((category) => category.id)
    )
    return JSON.stringify(
      parsed.filter(
        (item): item is string =>
          typeof item === "string" && validIds.has(item)
      )
    )
  } catch {
    return DEFAULT_GROUPS
  }
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return []
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  )
}

export type AppRoute =
  | "/dashboard"
  | "/sprint/planning"
  | "/sprint/burndown"
  | "/sprint/capacity"
  | "/analytics/workload"
  | "/analytics/story-points"
  | "/analytics/projects"
  | "/analytics/trends"
  | "/analytics/comparison"
  | "/analytics/members"
  | "/reports/saved/list"
  | "/reports/exports/list"
  | "/settings/jira"
  | "/settings/system"
  | "/settings/project"

export type NavigationIcon =
  | "dashboard"
  | "edit"
  | "workload"
  | "points"
  | "trends"
  | "members"
  | "person"
  | "projects"
  | "saved"
  | "export"
  | "settings"
  | "burndown"
  | "planning"
  | "capacity"
  | "comparison"

export type NavigationRoute = Readonly<{
  href: AppRoute
  label: string
}>

export type NavigationFeature = Readonly<{
  id: string
  label: string
  icon: NavigationIcon
  routes: readonly [NavigationRoute, ...NavigationRoute[]]
}>

export type NavigationCategory = Readonly<{
  id: string
  label: string
  features: readonly NavigationFeature[]
}>

/** 擁有全部頁面權限的管理員 email 清單。非管理員僅能看到儀表板（其餘類別一律隱藏）。 */
export const ADMIN_EMAILS = ["alexwcwang@kkcompany.com", "kennylin@kkcompany.com", "nickchen@kkcompany.com"]

/** 依使用者權限回傳應顯示的導覽類別：在管理員清單內看全部，其餘一律不顯示任何類別（只剩儀表板）。 */
export function visibleNavigationCategories(
  categories: readonly NavigationCategory[],
  email: string | undefined
): readonly NavigationCategory[] {
  const isAdmin =
    email !== undefined &&
    ADMIN_EMAILS.some(
      (adminEmail) => adminEmail.toLowerCase() === email.trim().toLowerCase()
    )
  if (isAdmin) return categories
  return []
}

export const dashboardNavigation = {
  href: "/dashboard",
  label: "儀表板",
  icon: "dashboard",
} as const satisfies NavigationRoute & { icon: NavigationIcon }

export const navigationCategories = [
  {
    id: "sprint",
    label: "Sprint 管理",
    features: [
      {
        id: "planning",
        label: "Planning",
        icon: "planning",
        routes: [{ href: "/sprint/planning", label: "Planning" }],
      },
      {
        id: "burndown",
        label: "開發狀況",
        icon: "burndown",
        routes: [{ href: "/sprint/burndown", label: "開發狀況" }],
      },
      {
        id: "capacity",
        label: "Capacity",
        icon: "capacity",
        routes: [{ href: "/sprint/capacity", label: "Capacity" }],
      },
    ],
  },
  {
    id: "analytics",
    label: "分析",
    features: [
      {
        id: "workload",
        label: "工作量分析",
        icon: "workload",
        routes: [{ href: "/analytics/workload", label: "工作量分析" }],
      },
      {
        id: "projects",
        label: "專案分析",
        icon: "projects",
        routes: [{ href: "/analytics/projects", label: "專案分析" }],
      },
      {
        id: "story-points",
        label: "團隊分析",
        icon: "members",
        routes: [{ href: "/analytics/story-points", label: "團隊分析" }],
      },
      {
        id: "members",
        label: "成員分析",
        icon: "person",
        routes: [{ href: "/analytics/members", label: "成員分析" }],
      },
      {
        id: "trends",
        label: "趨勢分析",
        icon: "trends",
        routes: [{ href: "/analytics/trends", label: "趨勢分析" }],
      },
      {
        id: "comparison",
        label: "比較分析",
        icon: "comparison",
        routes: [{ href: "/analytics/comparison", label: "比較分析" }],
      },
    ],
  },
  {
    id: "reports",
    label: "報表",
    features: [
      {
        id: "saved-reports",
        label: "儲存的報表",
        icon: "saved",
        routes: [{ href: "/reports/saved/list", label: "報表清單" }],
      },
      {
        id: "exports",
        label: "匯出紀錄",
        icon: "export",
        routes: [{ href: "/reports/exports/list", label: "匯出清單" }],
      },
    ],
  },
  {
    id: "settings",
    label: "設定",
    features: [
      {
        id: "system-settings",
        label: "系統設定",
        icon: "settings",
        routes: [{ href: "/settings/system", label: "系統設定" }],
      },
      {
        id: "project-settings",
        label: "專案設定",
        icon: "edit",
        routes: [{ href: "/settings/project", label: "專案設定" }],
      },
    ],
  },
] as const satisfies readonly NavigationCategory[]

export function getNavigationState(pathname: string) {
  if (pathname === dashboardNavigation.href) {
    return { title: dashboardNavigation.label, categoryId: null }
  }

  for (const category of navigationCategories) {
    for (const feature of category.features) {
      const route = feature.routes.find((item) => item.href === pathname)
      if (route) return { title: feature.label, categoryId: category.id }
    }
  }

  return { title: "Jira Analysis", categoryId: null }
}

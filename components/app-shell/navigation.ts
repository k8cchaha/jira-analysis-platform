export type AppRoute =
  | "/dashboard"
  | "/sprint/planning"
  | "/sprint/burndown"
  | "/issues/assigned/list"
  | "/issues/assigned/summary"
  | "/issues/search/filter"
  | "/issues/search/jql"
  | "/analytics/workload/summary"
  | "/analytics/workload/breakdown"
  | "/analytics/workload/detail"
  | "/analytics/story-points/summary"
  | "/analytics/story-points/distribution"
  | "/analytics/story-points/detail"
  | "/analytics/trends/summary"
  | "/analytics/trends/comparison"
  | "/analytics/trends/detail"
  | "/analytics/members/summary"
  | "/analytics/members/comparison"
  | "/analytics/members/detail"
  | "/reports/saved/list"
  | "/reports/exports/list"
  | "/settings/jira"

export type NavigationIcon =
  | "dashboard"
  | "issues"
  | "search"
  | "edit"
  | "workload"
  | "points"
  | "trends"
  | "members"
  | "saved"
  | "export"
  | "settings"
  | "burndown"
  | "planning"

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

/** 擁有全部頁面權限的管理員 email 清單。非管理員僅能看到儀表板與 Sprint 管理。 */
export const ADMIN_EMAILS = ["alexwcwang@kkcompany.com", "kennylin@kkcompany.com"]

/** 依使用者權限回傳應顯示的導覽類別：在管理員清單內看全部，其餘只留「Sprint 管理」。 */
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
  return categories.filter((category) => category.id === "sprint")
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
        label: "Burn Down Chart",
        icon: "burndown",
        routes: [{ href: "/sprint/burndown", label: "Burn Down Chart" }],
      },
    ],
  },
  {
    id: "issues",
    label: "Issue 管理",
    features: [
      {
        id: "assigned",
        label: "指派給我的 Issues",
        icon: "issues",
        routes: [
          { href: "/issues/assigned/list", label: "Issue 清單" },
          { href: "/issues/assigned/summary", label: "摘要" },
        ],
      },
      {
        id: "issue-search",
        label: "Issue 查詢",
        icon: "search",
        routes: [
          { href: "/issues/search/filter", label: "篩選器查詢" },
          { href: "/issues/search/jql", label: "JQL 查詢" },
        ],
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
        routes: [
          { href: "/analytics/workload/summary", label: "摘要" },
          { href: "/analytics/workload/breakdown", label: "分佈" },
          { href: "/analytics/workload/detail", label: "明細" },
        ],
      },
      {
        id: "story-points",
        label: "Story Points 分析",
        icon: "points",
        routes: [
          { href: "/analytics/story-points/summary", label: "摘要" },
          { href: "/analytics/story-points/distribution", label: "分佈" },
          { href: "/analytics/story-points/detail", label: "明細" },
        ],
      },
      {
        id: "trends",
        label: "趨勢分析",
        icon: "trends",
        routes: [
          { href: "/analytics/trends/summary", label: "摘要" },
          { href: "/analytics/trends/comparison", label: "比較" },
          { href: "/analytics/trends/detail", label: "明細" },
        ],
      },
      {
        id: "members",
        label: "成員分析",
        icon: "members",
        routes: [
          { href: "/analytics/members/summary", label: "摘要" },
          { href: "/analytics/members/comparison", label: "比較" },
          { href: "/analytics/members/detail", label: "明細" },
        ],
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

"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { currentFilterParams, useInitialFilterDefaults } from "@/components/filter-defaults-provider"
import { defaultProjectHref } from "@/lib/filter-defaults"
import { localDateFromOffset } from "@/lib/date-range"

/** One initialization per page entry, outside individual server-driven selectors. */
export function FilterDefaultsNavigation() {
  const pathname = usePathname()
  return <PageEntry key={pathname} pathname={pathname} />
}
function PageEntry({ pathname }: { pathname: string }) {
  const router = useRouter()
  const markEdited = useInitialFilterDefaults((defaults) => {
    if (window.location.pathname !== pathname) return
    const params = currentFilterParams()
    if (!params) return
    const now = new Date()
    const href = defaultProjectHref(pathname, params, defaults.project, localDateFromOffset(now, now.getTimezoneOffset()))
    if (href) router.replace(href, { scroll: false })
  })
  useEffect(() => {
    // A user who interacts before storage is ready owns the current page selection.
    document.addEventListener("pointerdown", markEdited, true)
    document.addEventListener("keydown", markEdited, true)
    return () => {
      document.removeEventListener("pointerdown", markEdited, true)
      document.removeEventListener("keydown", markEdited, true)
    }
  }, [markEdited])
  return null
}

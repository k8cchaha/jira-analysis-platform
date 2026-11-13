"use client"

import { useEffect, useId, useRef, useState } from "react"
import { logout } from "@/components/app-shell/logout-action"
import { useNavigationBlocker } from "@/components/navigation-blocker"
import { NavigationIconGlyph } from "@/components/app-shell/icons"
import { FilterDefaultsDialog } from "@/components/app-shell/filter-defaults-dialog"

export function AccountMenu({ user }: { user: { name: string; image?: string } }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const openingIndex = useRef(0)
  const wasDefaultsOpen = useRef(false)
  const { isBlocked } = useNavigationBlocker()

  // Restore only after the native modal has unmounted; its backdrop makes the avatar inert while open.
  useEffect(() => {
    if (!defaultsOpen && wasDefaultsOpen.current) trigger.current?.focus()
    wasDefaultsOpen.current = defaultsOpen
  }, [defaultsOpen])
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U"

  useEffect(() => {
    if (!open) return
    items.current[openingIndex.current]?.focus()
    function outside(event: PointerEvent | FocusEvent) {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("focusin", outside)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("focusin", outside)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  function showMenu(index: number) {
    openingIndex.current = index
    if (open) items.current[index]?.focus()
    else setOpen(true)
  }

  return (
    <div ref={wrapper} className="relative shrink-0">
      <button
        ref={trigger}
        id={`${id}-trigger`}
        type="button"
        aria-label="帳號選單"
        title="帳號選單"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={() => { if (open) setOpen(false); else showMenu(0) }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          event.preventDefault()
          showMenu(event.key === "ArrowUp" ? 1 : 0)
        }}
        className="flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-blue-100 text-xs font-semibold text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-blue-950 dark:text-blue-200"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-full w-full object-cover" />
        ) : initials}
      </button>
      {open ? (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-trigger`}
          className="absolute top-full right-0 z-50 mt-2 w-48 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          onKeyDown={(event) => {
            const current = items.current.findIndex((item) => item === document.activeElement)
            let next: number
            switch (event.key) {
              case "ArrowDown": next = (current + 1) % 2; break
              case "ArrowUp": next = (current - 1 + 2) % 2; break
              case "Home": next = 0; break
              case "End": next = 1; break
              default: {
                if (event.key.length !== 1) return
                next = ["預設值設定", "登出"].findIndex((label) => label.startsWith(event.key))
                if (next === -1) return
              }
            }
            event.preventDefault()
            items.current[next]?.focus()
          }}
        >
          <button
            ref={(element) => { items.current[0] = element }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => { setOpen(false); setDefaultsOpen(true) }}
            className="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <NavigationIconGlyph name="settings" />
            預設值設定
          </button>
          <div role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" />
          <form action={logout} onSubmit={(event) => {
            if (isBlocked && !window.confirm("你有尚未儲存的變更，確定要離開此頁面嗎？")) event.preventDefault()
          }}>
            <button
              ref={(element) => { items.current[1] = element }}
              type="submit"
              role="menuitem"
              tabIndex={-1}
              className="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium text-rose-600 hover:bg-rose-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-rose-600 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 17l5-5-5-5M15 12H3" />
                <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
              </svg>
              登出
            </button>
          </form>
        </div>
      ) : null}
      {defaultsOpen && <FilterDefaultsDialog onClose={() => setDefaultsOpen(false)} />}
    </div>
  )
}

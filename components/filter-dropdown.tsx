"use client"

import { useEffect, useRef, type ReactNode } from "react"

/** Same selector kind uses the same width everywhere; narrow containers may clamp it. */
export const FILTER_SELECT_WIDTH_CLASS = {
  team: "w-56 max-w-full min-w-0 shrink-0",
  project: "w-40 max-w-full min-w-0 shrink-0",
  sprint: "w-56 max-w-full min-w-0 shrink-0",
} as const
export type FilterSelectKind = keyof typeof FILTER_SELECT_WIDTH_CLASS

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={open ? "rotate-180" : ""}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function FilterDropdown({ id, label, required = false, value, open, onOpenChange, describedBy, kind, children }: {
  id: string
  label: string
  required?: boolean
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
  describedBy: string
  kind: FilterSelectKind
  children: ReactNode
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent | FocusEvent) {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) onOpenChange(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      onOpenChange(false)
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
  }, [open, onOpenChange])

  return (
    <div ref={wrapper} className={`relative ${FILTER_SELECT_WIDTH_CLASS[kind]}`} onBlur={(event) => {
      // Clicking non-focusable label text/padding briefly blurs to null before the
      // browser activates its checkbox. Do not hide the row before that click.
      // Outside pointerdown/focusin listeners still close the dropdown normally.
      if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(false)
    }}>
      <span id={`${id}-label`} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}{required ? <><span aria-hidden="true" className="ml-1 text-rose-600 dark:text-rose-400">*</span><span className="sr-only">（必選）</span></> : null}
      </span>
      <button ref={trigger} id={`${id}-trigger`} type="button" aria-expanded={open} aria-controls={`${id}-options`} aria-labelledby={`${id}-label ${id}-value`} aria-describedby={describedBy} onClick={() => onOpenChange(!open)} className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
        <span id={`${id}-value`} className="truncate" title={value}>{value}</span>
        <span className="shrink-0"><Chevron open={open} /></span>
      </button>
      <div id={`${id}-options`} hidden={!open} className="absolute top-full z-50 mt-1 max-h-[300px] w-full min-w-0 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
        {children}
      </div>
    </div>
  )
}
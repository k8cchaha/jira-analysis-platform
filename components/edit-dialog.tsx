"use client"

import { useEffect, useId, useRef, type ReactNode } from "react"

/** A strict editor modal: only its explicit close controls can dismiss it. */
export function EditDialog({
  title,
  description,
  count,
  compact = false,
  iconClose = false,
  busy = false,
  onClose,
  children,
}: {
  title: string
  description: string
  count?: number | null
  compact?: boolean
  iconClose?: boolean
  busy?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previouslyFocused = document.activeElement
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = "hidden"
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus()
      }
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => event.preventDefault()}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/60 open:flex md:m-auto md:h-auto md:max-h-[90dvh] md:w-[calc(100%-4rem)] md:max-w-6xl md:rounded-2xl dark:bg-slate-900 dark:text-white"
    >
      <header className={`flex shrink-0 justify-between gap-4 border-b border-slate-200 p-4 sm:px-6 dark:border-slate-800 ${compact ? "items-center sm:py-5" : "items-start sm:py-6"}`}>
        <div className="min-w-0">
          <h2 id={titleId} className="flex flex-wrap items-center gap-3 text-lg font-semibold sm:text-xl">{title}{count !== undefined && <span aria-label={count === null ? "正在載入張數" : `${count} 張 Issue`} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-base font-semibold tabular-nums text-amber-800 dark:bg-amber-950 dark:text-amber-300">{count === null ? "…" : count.toLocaleString("zh-TW")}</span>}</h2>
          <p id={descriptionId} className={compact ? "sr-only" : "mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400"}>{description}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          aria-label="關閉"
          title="關閉"
          className={iconClose ? "flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800" : "shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"}
        >
          {iconClose ? <><svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m5 5 14 14M19 5 5 19" /></svg><span className="sr-only">關閉</span></> : "關閉"}
        </button>
      </header>
      {children}
    </dialog>
  )
}

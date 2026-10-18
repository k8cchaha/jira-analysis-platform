"use client"

import { useEffect, useId, useRef, type ReactNode } from "react"

/** A strict editor modal: only its explicit close controls can dismiss it. */
export function EditDialog({
  title,
  description,
  busy = false,
  onClose,
  children,
}: {
  title: string
  description: string
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
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-6 dark:border-slate-800">
        <div>
          <h2 id={titleId} className="text-lg font-semibold sm:text-xl">{title}</h2>
          <p id={descriptionId} className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          關閉
        </button>
      </header>
      {children}
    </dialog>
  )
}

"use client"

import type { ButtonHTMLAttributes } from "react"

type SearchButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "children" | "type"> & {
  loading?: boolean
  label?: string
  loadingLabel?: string
}

/** Search/query actions stay 96px wide, including while loading. */
export function SearchButton({ loading = false, disabled, label = "查詢", loadingLabel = "查詢中…", ...props }: SearchButtonProps) {
  return (
    <button
      {...props}
      type="submit"
      disabled={disabled || loading}
      aria-busy={loading}
      className="h-10 w-24 max-w-full min-w-0 shrink-0 cursor-pointer rounded-lg bg-blue-600 px-3 text-sm font-semibold whitespace-nowrap text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? loadingLabel : label}
    </button>
  )
}

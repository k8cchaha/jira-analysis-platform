/**
 * Issue 自身票種的圖示（Epic / Story / Task / Bug / 未知）。任務規劃總覽
 * 的任務清單用它標示「這張母票是哪一種票」——與 `ParentIssueTypeIcon`
 * （標示母票 type）不同，這裡標示的是票本身。色系與既有圖示一致：
 * Epic 紫、Story 綠、Task 藍、Bug 紅、未知中性。
 */
export function IssueTypeIcon({ issueType }: { issueType: string | null }) {
  const type = issueType?.toLowerCase() ?? ""
  const common = { role: "img", className: "h-4 w-4 shrink-0", viewBox: "0 0 16 16" }

  if (type.includes("epic")) {
    const label = "Issue type：Epic"
    return (
      <svg {...common} fill="none" aria-label={label}>
        <title>{label}</title>
        <path d="M8 1.5 13.5 4v4.2c0 3.6-2.5 5.6-5.5 6.3-3-.7-5.5-2.7-5.5-6.3V4Z" fill="#7c3aed" stroke="#5b21b6" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="m6 8 1.4 1.6L10 6.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (type.includes("bug")) {
    const label = "Issue type：Bug"
    return (
      <svg {...common} fill="none" aria-label={label}>
        <title>{label}</title>
        <g fill="#e05252" stroke="#e05252" strokeWidth="1.4" strokeLinecap="round">
          <ellipse cx="8" cy="10" rx="3.5" ry="4.5" />
          <circle cx="8" cy="4.5" r="2" />
          <path d="m4.5 7.5-3-2M4.5 10h-3m3 2.5-3 1.5m10-6.5 3-2M11.5 10h3m-3 2.5 3 1.5" />
        </g>
      </svg>
    )
  }
  if (type.includes("story")) {
    const label = "Issue type：Story"
    return (
      <svg {...common} fill="#27a665" aria-label={label}>
        <title>{label}</title>
        <path d="M3 2h10v12.5l-5-3-5 3Z" />
      </svg>
    )
  }
  if (type.includes("task")) {
    const label = "Issue type：Task"
    return (
      <svg {...common} fill="none" aria-label={label}>
        <title>{label}</title>
        <rect x="2" y="2" width="12" height="12" rx="2.5" fill="#2a78d6" />
        <path d="m5 8 2.2 2.5L11 5.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  const label = "Issue type 未知"
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.4" className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-label={label}>
      <title>{label}</title>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5 8h6" />
    </svg>
  )
}
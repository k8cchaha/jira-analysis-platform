import type { MissingIssue } from "@/lib/jira-missing-data"

export function ParentIssueTypeIcon({ parent }: { parent: MissingIssue["parentIssueType"] }) {
  const name = parent.status === "known" ? parent.name : ""
  const type = name.toLowerCase()
  const label = parent.status === "known" ? `Parent Issue type：${name}` : parent.status === "none" ? "沒有 Parent Issue" : "Parent Issue type 未知"
  const common = { role: "img", "aria-label": label, className: "h-4 w-4 shrink-0", viewBox: "0 0 16 16" }
  if (type.includes("bug")) return <svg {...common} fill="none"><title>{label}</title><g fill="#e05252" stroke="#e05252" strokeWidth="1.4" strokeLinecap="round"><ellipse cx="8" cy="10" rx="3.5" ry="4.5" /><circle cx="8" cy="4.5" r="2" /><path d="m4.5 7.5-3-2M4.5 10h-3m3 2.5-3 1.5m10-6.5 3-2M11.5 10h3m-3 2.5 3 1.5" /></g></svg>
  if (type.includes("story")) return <svg {...common} fill="#27a665"><title>{label}</title><path d="M3 2h10v12.5l-5-3-5 3Z" /></svg>
  if (type.includes("task")) return <svg {...common} fill="none"><title>{label}</title><rect x="2" y="2" width="12" height="12" rx="2.5" fill="#2a78d6" /><path d="m5 8 2.2 2.5L11 5.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  return <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.4" className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500"><title>{label}</title><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M5 8h6" /></svg>
}

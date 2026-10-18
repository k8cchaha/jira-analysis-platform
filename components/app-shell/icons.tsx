import type { NavigationIcon } from "@/components/app-shell/navigation"

type IconProps = {
  name: NavigationIcon
  className?: string
}

export function NavigationIconGlyph({ name, className = "h-5 w-5" }: IconProps) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  }

  switch (name) {
    case "dashboard":
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="4" rx="1" /><rect x="14" y="11" width="7" height="10" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>
    case "issues":
      return <svg {...common}><path d="M8 6h11M8 12h11M8 18h7" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
    case "search":
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
    case "edit":
      return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>
    case "workload":
      return <svg {...common}><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /></svg>
    case "points":
      return <svg {...common}><path d="m12 3 3 6 6 .9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.9 9 9Z" /></svg>
    case "trends":
      return <svg {...common}><path d="m3 17 6-6 4 4 8-9" /><path d="M15 6h6v6" /></svg>
    case "members":
      return <svg {...common}><circle cx="9" cy="8" r="4" /><path d="M3 21a6 6 0 0 1 12 0M16 4.5a4 4 0 0 1 0 7M17 15a6 6 0 0 1 4 6" /></svg>
    case "saved":
      return <svg {...common}><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" /></svg>
    case "export":
      return <svg {...common}><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 14v6h14v-6" /></svg>
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></svg>
  }
}

export function MenuIcon({ open = false }: { open?: boolean }) {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {open ? <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></> : <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>}
    </svg>
  )
}

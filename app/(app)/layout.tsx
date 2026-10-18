import { auth } from "@/auth"
import { AppShell } from "@/components/app-shell/app-shell"
import { NavigationBlockerProvider } from "@/components/navigation-blocker"
import { redirect } from "next/navigation"

export default async function ApplicationLayout({ children }: LayoutProps<"/">) {
  let session = null

  try {
    session = await auth()
  } catch {
    redirect("/login")
  }

  if (!session?.user) redirect("/login")

  const user = {
    name: session.user.name?.trim() || "Jira user",
    email: session.user.email || undefined,
    image: session.user.image || undefined,
  }

  return (
    <NavigationBlockerProvider>
      <AppShell user={user}>{children}</AppShell>
    </NavigationBlockerProvider>
  )
}

import { auth } from "@/auth"
import { AppShell } from "@/components/app-shell/app-shell"
import { NavigationBlockerProvider } from "@/components/navigation-blocker"
import { TeamMembersProvider } from "@/components/team-members-provider"
import { redirect } from "next/navigation"

export default async function ApplicationLayout({ children }: LayoutProps<"/">) {
  let session = null

  try {
    session = await auth()
  } catch {
    redirect("/login")
  }

  if (!session?.user?.id) redirect("/login")

  const user = {
    name: session.user.name?.trim() || "Jira user",
    email: session.user.email || undefined,
    image: session.user.image || undefined,
  }

  return (
    <NavigationBlockerProvider>
      <TeamMembersProvider viewerId={session.user.id}>
        <AppShell user={user}>{children}</AppShell>
      </TeamMembersProvider>
    </NavigationBlockerProvider>
  )
}

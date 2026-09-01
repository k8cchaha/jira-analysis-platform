import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const JIRA_CLOUD_URL = process.env.ATLASSIAN_JIRA_CLOUD_URL!

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL))
  }

  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")
  const storedState = request.cookies.get("atlassian_oauth_state")?.value

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${error}`, process.env.NEXTAUTH_URL)
    )
  }

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_state", process.env.NEXTAUTH_URL)
    )
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: process.env.ATLASSIAN_CLIENT_ID!,
      client_secret: process.env.ATLASSIAN_CLIENT_SECRET!,
      code,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/auth/jira/callback`,
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(
      new URL("/login?error=token_exchange_failed", process.env.NEXTAUTH_URL)
    )
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json()

  // Find the correct cloudId for our Jira domain
  const resourcesRes = await fetch(
    "https://api.atlassian.com/oauth/token/accessible-resources",
    { headers: { Authorization: `Bearer ${access_token}` } }
  )

  if (!resourcesRes.ok) {
    return NextResponse.redirect(
      new URL("/login?error=resources_fetch_failed", process.env.NEXTAUTH_URL)
    )
  }

  const resources: { id: string; url: string; name: string }[] =
    await resourcesRes.json()

  const cloudHostname = new URL(JIRA_CLOUD_URL).hostname
  const site = resources.find((r) => new URL(r.url).hostname === cloudHostname)

  if (!site) {
    return NextResponse.redirect(
      new URL("/login?error=site_not_found", process.env.NEXTAUTH_URL)
    )
  }

  // Store token in DB
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  })

  if (!user) {
    return NextResponse.redirect(
      new URL("/login?error=user_not_found", process.env.NEXTAUTH_URL)
    )
  }

  await prisma.jiraToken.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      accessToken: access_token,
      refreshToken: refresh_token,
      cloudId: site.id,
      expiresAt: new Date(Date.now() + expires_in * 1000),
    },
    update: {
      accessToken: access_token,
      refreshToken: refresh_token,
      cloudId: site.id,
      expiresAt: new Date(Date.now() + expires_in * 1000),
    },
  })

  const response = NextResponse.redirect(
    new URL("/dashboard", process.env.NEXTAUTH_URL)
  )
  response.cookies.delete("atlassian_oauth_state")
  return response
}

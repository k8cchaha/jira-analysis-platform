import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { randomBytes } from "crypto"

const SCOPES = [
  "read:issue:jira",
  "write:issue:jira",
  "read:project:jira",
  "read:user:jira",
  "read:status:jira",
  "read:sprint:jira-software",
  "offline_access",
].join(" ")

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL))
  }

  const state = randomBytes(16).toString("hex")

  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: process.env.ATLASSIAN_CLIENT_ID!,
    scope: SCOPES,
    redirect_uri: `${process.env.NEXTAUTH_URL}/api/auth/jira/callback`,
    state,
    response_type: "code",
    prompt: "consent",
  })

  const response = NextResponse.redirect(
    `https://auth.atlassian.com/authorize?${params.toString()}`
  )

  response.cookies.set("atlassian_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  })

  return response
}

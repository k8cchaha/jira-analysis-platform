import { prisma } from "@/lib/prisma"
import { JiraToken } from "@prisma/client"

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min before expiry

export async function getJiraToken(userId: string): Promise<JiraToken | null> {
  const token = await prisma.jiraToken.findUnique({ where: { userId } })
  if (!token) return null

  const isExpiringSoon =
    token.expiresAt < new Date(Date.now() + TOKEN_REFRESH_BUFFER_MS)

  if (isExpiringSoon) {
    return refreshJiraToken(token)
  }

  return token
}

async function refreshJiraToken(token: JiraToken): Promise<JiraToken | null> {
  const res = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: process.env.ATLASSIAN_CLIENT_ID!,
      client_secret: process.env.ATLASSIAN_CLIENT_SECRET!,
      refresh_token: token.refreshToken,
    }),
  })

  if (!res.ok) return null

  const data = await res.json()

  return prisma.jiraToken.update({
    where: { id: token.id },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  })
}

import "server-only"

import { prisma } from "@/lib/prisma"
import { parseRefreshedTokens } from "@/lib/atlassian-oauth"

const TOKEN_REFRESH_BUFFER_SECONDS = 5 * 60

export interface JiraCredentials {
  accessToken: string
  cloudId: string
  expiresAt: number
}

export class JiraAuthorizationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_connected"
      | "reauthorization_required"
      | "refresh_failed"
      | "invalid_configuration"
  ) {
    super(message)
    this.name = "JiraAuthorizationError"
  }
}

const refreshes = new Map<string, Promise<JiraCredentials>>()

export async function getJiraToken(userId: string): Promise<JiraCredentials> {
  const credentials = await getStoredCredentials(userId)

  if (
    credentials.expiresAt >
    Math.floor(Date.now() / 1000) + TOKEN_REFRESH_BUFFER_SECONDS
  ) {
    return toJiraCredentials(credentials)
  }

  const inProgress = refreshes.get(credentials.accountId)
  if (inProgress) return inProgress

  const refresh = refreshJiraToken(userId, credentials.accountId).finally(() => {
    refreshes.delete(credentials.accountId)
  })
  refreshes.set(credentials.accountId, refresh)

  return refresh
}

async function refreshJiraToken(userId: string, accountId: string) {
  const current = await getStoredCredentials(userId)
  if (current.accountId !== accountId) {
    throw new JiraAuthorizationError(
      "The Jira account changed while refreshing",
      "reauthorization_required"
    )
  }

  if (
    current.expiresAt >
    Math.floor(Date.now() / 1000) + TOKEN_REFRESH_BUFFER_SECONDS
  ) {
    return toJiraCredentials(current)
  }

  const clientId = process.env.AUTH_ATLASSIAN_ID
  const clientSecret = process.env.AUTH_ATLASSIAN_SECRET
  if (!clientId || !clientSecret) {
    throw new JiraAuthorizationError(
      "Atlassian OAuth is not configured",
      "invalid_configuration"
    )
  }

  if (!current.refreshToken) {
    throw new JiraAuthorizationError(
      "Jira authorization must be renewed",
      "reauthorization_required"
    )
  }

  const response = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: current.refreshToken,
    }),
  })

  if (!response.ok) {
    throw new JiraAuthorizationError(
      `Atlassian token refresh failed (${response.status})`,
      response.status === 400 || response.status === 401
        ? "reauthorization_required"
        : "refresh_failed"
    )
  }

  let refreshed
  try {
    refreshed = parseRefreshedTokens(await response.json())
  } catch {
    throw new JiraAuthorizationError(
      "Atlassian returned an invalid token response",
      "refresh_failed"
    )
  }

  const updateResult = await prisma.account.updateMany({
    where: {
      id: current.accountId,
      refresh_token: current.refreshToken,
    },
    data: {
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken ?? current.refreshToken,
      expires_at: refreshed.expiresAt,
    },
  })

  if (updateResult.count === 0) {
    return toJiraCredentials(await getStoredCredentials(userId))
  }

  return {
    accessToken: refreshed.accessToken,
    cloudId: current.cloudId,
    expiresAt: refreshed.expiresAt,
  }
}

async function getStoredCredentials(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "atlassian" },
    select: {
      id: true,
      access_token: true,
      refresh_token: true,
      expires_at: true,
      user: { select: { jiraCloudId: true } },
    },
  })

  if (!account?.access_token || !account.expires_at) {
    throw new JiraAuthorizationError(
      "No Jira authorization was found",
      "not_connected"
    )
  }

  return {
    accountId: account.id,
    accessToken: account.access_token,
    refreshToken: account.refresh_token,
    expiresAt: account.expires_at,
    cloudId: account.user.jiraCloudId,
  }
}

function toJiraCredentials(credentials: {
  accessToken: string
  cloudId: string
  expiresAt: number
}): JiraCredentials {
  return {
    accessToken: credentials.accessToken,
    cloudId: credentials.cloudId,
    expiresAt: credentials.expiresAt,
  }
}

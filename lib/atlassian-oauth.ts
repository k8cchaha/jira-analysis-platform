import type { AtlassianProfile } from "next-auth/providers/atlassian"

const ATLASSIAN_ME_URL = "https://api.atlassian.com/me"
const ATLASSIAN_RESOURCES_URL =
  "https://api.atlassian.com/oauth/token/accessible-resources"

export const ATLASSIAN_SCOPES = [
  "read:me",
  "read:jira-work",
  "read:jira-user",
  "read:group:jira",
  "read:user:jira",
  "read:avatar:jira",
  "read:issue:jira",
  "write:jira-work",
  "read:sprint:jira-software",
  "offline_access",
].join(" ")

export interface JiraAtlassianProfile extends AtlassianProfile {
  jiraCloudId: string
}

interface OAuthTokens {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  expires_at?: unknown
}

interface AccessibleResource {
  id?: unknown
  url?: unknown
}

export interface RefreshedAtlassianTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export class AtlassianOAuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_configuration"
      | "invalid_token_response"
      | "profile_fetch_failed"
      | "resources_fetch_failed"
      | "site_not_found"
  ) {
    super(message)
    this.name = "AtlassianOAuthError"
  }
}

export function getConfiguredJiraHostname() {
  const configuredUrl = process.env.ATLASSIAN_JIRA_CLOUD_URL

  if (!configuredUrl) {
    throw new AtlassianOAuthError(
      "ATLASSIAN_JIRA_CLOUD_URL is not configured",
      "invalid_configuration"
    )
  }

  try {
    return new URL(configuredUrl).hostname.toLowerCase()
  } catch {
    throw new AtlassianOAuthError(
      "ATLASSIAN_JIRA_CLOUD_URL is invalid",
      "invalid_configuration"
    )
  }
}

export async function fetchAtlassianProfile(
  tokens: OAuthTokens
): Promise<JiraAtlassianProfile> {
  const accessToken = requireString(tokens.access_token)
  const refreshToken = requireString(tokens.refresh_token)
  if (!accessToken || !refreshToken || !getTokenExpiry(tokens)) {
    throw new AtlassianOAuthError(
      "Atlassian returned an incomplete token response",
      "invalid_token_response"
    )
  }

  const headers = { Authorization: `Bearer ${accessToken}` }
  const [profileResponse, resourcesResponse] = await Promise.all([
    fetch(ATLASSIAN_ME_URL, { headers }),
    fetch(ATLASSIAN_RESOURCES_URL, { headers }),
  ])

  if (!profileResponse.ok) {
    throw new AtlassianOAuthError(
      `Atlassian profile request failed (${profileResponse.status})`,
      "profile_fetch_failed"
    )
  }

  if (!resourcesResponse.ok) {
    throw new AtlassianOAuthError(
      `Atlassian resources request failed (${resourcesResponse.status})`,
      "resources_fetch_failed"
    )
  }

  const [profile, resources] = await Promise.all([
    profileResponse.json() as Promise<Partial<AtlassianProfile>>,
    resourcesResponse.json() as Promise<AccessibleResource[]>,
  ])

  const accountId = requireString(profile.account_id)
  const email = requireString(profile.email)
  if (!accountId || !email || !Array.isArray(resources)) {
    throw new AtlassianOAuthError(
      "Atlassian returned an invalid profile or resources response",
      "profile_fetch_failed"
    )
  }

  const configuredHostname = getConfiguredJiraHostname()
  const matchingSites = resources.filter((resource) => {
    const resourceUrl = requireString(resource.url)
    if (!resourceUrl) return false

    try {
      return new URL(resourceUrl).hostname.toLowerCase() === configuredHostname
    } catch {
      return false
    }
  })
  const jiraCloudId = requireString(matchingSites[0]?.id)

  if (matchingSites.length !== 1 || !jiraCloudId) {
    throw new AtlassianOAuthError(
      "The configured Jira site is not uniquely accessible",
      "site_not_found"
    )
  }

  return {
    account_id: accountId,
    name: requireString(profile.name) ?? email,
    email,
    picture: requireString(profile.picture) ?? "",
    jiraCloudId,
  }
}

export function parseRefreshedTokens(
  data: OAuthTokens
): RefreshedAtlassianTokens {
  const accessToken = requireString(data.access_token)
  const expiresAt = getTokenExpiry(data)

  const refreshToken = requireString(data.refresh_token)
  if (!accessToken || !refreshToken || !expiresAt) {
    throw new AtlassianOAuthError(
      "Atlassian returned an incomplete refresh response",
      "invalid_token_response"
    )
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
  }
}

function getTokenExpiry(tokens: OAuthTokens) {
  if (
    typeof tokens.expires_at === "number" &&
    Number.isFinite(tokens.expires_at) &&
    tokens.expires_at > 0
  ) {
    return Math.floor(tokens.expires_at)
  }

  if (
    typeof tokens.expires_in === "number" &&
    Number.isFinite(tokens.expires_in) &&
    tokens.expires_in > 0
  ) {
    return Math.floor(Date.now() / 1000 + tokens.expires_in)
  }

  return null
}

function requireString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

import "server-only"

import {
  getInternalAuthSession,
  refreshAuthSession,
  type InternalJiraSession,
} from "@/auth"

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

export async function getJiraToken(
  persistRefresh = false
): Promise<JiraCredentials> {
  const session = persistRefresh
    ? await refreshAuthSession()
    : await getInternalAuthSession()
  return getCredentialsFromSession(session)
}

function getCredentialsFromSession(
  session: InternalJiraSession | null
): JiraCredentials {
  if (!session?.user?.id) {
    throw new JiraAuthorizationError(
      "No Jira authorization was found",
      "not_connected"
    )
  }

  if (session.jiraAuthorizationError) {
    throw new JiraAuthorizationError(
      "Jira authorization is unavailable",
      session.jiraAuthorizationError
    )
  }

  if (
    !session.jiraAccessToken ||
    !session.jiraCloudId ||
    typeof session.jiraExpiresAt !== "number" ||
    !Number.isFinite(session.jiraExpiresAt) ||
    session.jiraExpiresAt <= Math.floor(Date.now() / 1000)
  ) {
    throw new JiraAuthorizationError(
      "Jira authorization must be renewed",
      "reauthorization_required"
    )
  }

  return {
    accessToken: session.jiraAccessToken,
    cloudId: session.jiraCloudId,
    expiresAt: session.jiraExpiresAt,
  }
}

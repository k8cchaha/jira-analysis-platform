import type { DefaultSession } from "next-auth"

type JiraAuthorizationError =
  | "reauthorization_required"
  | "refresh_failed"
  | "invalid_configuration"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
    } & DefaultSession["user"]
    jiraAuthorizationError?: JiraAuthorizationError
    jiraAccessToken?: string
    jiraCloudId?: string
    jiraExpiresAt?: number
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    atlassianAccessToken?: string
    atlassianRefreshToken?: string
    atlassianExpiresAt?: number
    jiraCloudId?: string
    jiraAuthError?: JiraAuthorizationError
  }
}

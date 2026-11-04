import NextAuth, { type NextAuthConfig, type Session } from "next-auth"
import Atlassian from "next-auth/providers/atlassian"
import type { TokenSet } from "@auth/core/types"
import {
  ATLASSIAN_SCOPES,
  fetchAtlassianProfile,
  parseRefreshedTokens,
  type JiraAtlassianProfile,
  type RefreshedAtlassianTokens,
} from "@/lib/atlassian-oauth"

const TOKEN_REFRESH_BUFFER_SECONDS = 5 * 60
const REFRESH_RESULT_TTL_MS = 30_000
const MAX_REFRESH_CACHE_ENTRIES = 100

type JiraAuthError =
  | "reauthorization_required"
  | "refresh_failed"
  | "invalid_configuration"

class AtlassianTokenRefreshError extends Error {
  constructor(readonly code: JiraAuthError) {
    super(code)
    this.name = "AtlassianTokenRefreshError"
  }
}

const refreshResults = new Map<
  string,
  { expiresAt: number; promise: Promise<RefreshedAtlassianTokens> }
>()

function createAuthConfig(internalSession: boolean): NextAuthConfig {
  return {
    session: {
      strategy: "jwt",
      maxAge: 30 * 24 * 60 * 60,
    },
    providers: [
      Atlassian({
        clientId: process.env.AUTH_ATLASSIAN_ID,
        clientSecret: process.env.AUTH_ATLASSIAN_SECRET,
        authorization: {
          params: {
            audience: "api.atlassian.com",
            scope: ATLASSIAN_SCOPES,
            prompt: "consent",
          },
        },
        userinfo: {
          async request({ tokens }: { tokens: TokenSet }) {
            return fetchAtlassianProfile(tokens)
          },
        },
        profile(profile) {
          const atlassianProfile = profile as JiraAtlassianProfile
          return {
            id: atlassianProfile.account_id,
            name: atlassianProfile.name,
            email: atlassianProfile.email,
            image: atlassianProfile.picture,
          }
        },
      }),
    ],
    callbacks: {
      signIn({ account, profile }) {
        if (account?.provider !== "atlassian") return false

        const atlassianProfile = profile as JiraAtlassianProfile | undefined
        return Boolean(
          account.access_token &&
            account.refresh_token &&
            account.expires_at &&
            atlassianProfile?.jiraCloudId
        )
      },
      async jwt({ token, account, profile }) {
        if (account?.provider === "atlassian") {
          const atlassianProfile = profile as JiraAtlassianProfile | undefined
          if (
            !account.access_token ||
            !account.refresh_token ||
            !account.expires_at ||
            !atlassianProfile?.jiraCloudId
          ) {
            token.jiraAuthError = "reauthorization_required"
            return token
          }

          token.sub = account.providerAccountId
          token.atlassianAccessToken = account.access_token
          token.atlassianRefreshToken = account.refresh_token
          token.atlassianExpiresAt = account.expires_at
          token.jiraCloudId = atlassianProfile.jiraCloudId
          delete token.jiraAuthError
          return token
        }

        const accessToken = getString(token.atlassianAccessToken)
        const refreshToken = getString(token.atlassianRefreshToken)
        const expiresAt = getPositiveNumber(token.atlassianExpiresAt)
        if (
          accessToken &&
          expiresAt &&
          expiresAt >
            Math.floor(Date.now() / 1000) + TOKEN_REFRESH_BUFFER_SECONDS
        ) {
          return token
        }

        if (!refreshToken) {
          token.jiraAuthError = "reauthorization_required"
          return token
        }

        try {
          const refreshed = await refreshAtlassianToken(refreshToken)
          token.atlassianAccessToken = refreshed.accessToken
          token.atlassianRefreshToken = refreshed.refreshToken
          token.atlassianExpiresAt = refreshed.expiresAt
          delete token.jiraAuthError
        } catch (error) {
          token.jiraAuthError =
            error instanceof AtlassianTokenRefreshError
              ? error.code
              : "refresh_failed"
        }

        return token
      },
      session({ session, token }) {
        if (session.user && token.sub) session.user.id = token.sub
        session.jiraAuthorizationError = getJiraAuthError(token.jiraAuthError)

        if (internalSession) {
          const internal = session as InternalJiraSession
          internal.jiraAccessToken = getString(token.atlassianAccessToken)
          internal.jiraCloudId = getString(token.jiraCloudId)
          internal.jiraExpiresAt = getPositiveNumber(token.atlassianExpiresAt)
        }

        return session
      },
    },
    pages: {
      signIn: "/login",
      error: "/login",
    },
  }
}

export interface InternalJiraSession extends Session {
  jiraAccessToken?: string
  jiraCloudId?: string
  jiraExpiresAt?: number
}

const publicAuth = NextAuth(createAuthConfig(false))
const internalAuth = NextAuth(createAuthConfig(true))

export const handlers = publicAuth.handlers
export const { auth, signIn, signOut } = publicAuth

export async function getInternalAuthSession(): Promise<InternalJiraSession | null> {
  return (await internalAuth.auth()) as InternalJiraSession | null
}

export async function refreshAuthSession(): Promise<InternalJiraSession | null> {
  return (await internalAuth.unstable_update({})) as InternalJiraSession | null
}

async function refreshAtlassianToken(refreshToken: string) {
  const key = await hashToken(refreshToken)
  const now = Date.now()
  pruneRefreshCache(now)

  const cached = refreshResults.get(key)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = requestRefreshedTokens(refreshToken)
  refreshResults.set(key, {
    expiresAt: now + REFRESH_RESULT_TTL_MS,
    promise,
  })
  return promise
}

async function requestRefreshedTokens(refreshToken: string) {
  const clientId = process.env.AUTH_ATLASSIAN_ID
  const clientSecret = process.env.AUTH_ATLASSIAN_SECRET
  if (!clientId || !clientSecret) {
    throw new AtlassianTokenRefreshError("invalid_configuration")
  }

  let response: Response
  try {
    response = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
      cache: "no-store",
    })
  } catch {
    throw new AtlassianTokenRefreshError("refresh_failed")
  }

  if (!response.ok) {
    throw new AtlassianTokenRefreshError(
      response.status === 400 ||
        response.status === 401 ||
        response.status === 403
        ? "reauthorization_required"
        : "refresh_failed"
    )
  }

  try {
    return parseRefreshedTokens(await response.json())
  } catch {
    throw new AtlassianTokenRefreshError("refresh_failed")
  }
}

async function hashToken(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function getPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function getJiraAuthError(value: unknown): JiraAuthError | undefined {
  return value === "reauthorization_required" ||
    value === "refresh_failed" ||
    value === "invalid_configuration"
    ? value
    : undefined
}

function pruneRefreshCache(now: number) {
  for (const [key, entry] of refreshResults) {
    if (entry.expiresAt <= now) refreshResults.delete(key)
  }

  while (refreshResults.size >= MAX_REFRESH_CACHE_ENTRIES) {
    const oldestKey = refreshResults.keys().next().value
    if (typeof oldestKey !== "string") break
    refreshResults.delete(oldestKey)
  }
}

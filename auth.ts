import NextAuth from "next-auth"
import Atlassian from "next-auth/providers/atlassian"
import type { TokenSet } from "@auth/core/types"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import {
  ATLASSIAN_SCOPES,
  fetchAtlassianProfile,
  type JiraAtlassianProfile,
} from "@/lib/atlassian-oauth"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
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
          jiraCloudId: atlassianProfile.jiraCloudId,
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "atlassian") return false

      const atlassianProfile = profile as JiraAtlassianProfile | undefined
      if (
        !account.access_token ||
        !account.expires_at ||
        !atlassianProfile?.jiraCloudId
      ) {
        return false
      }

      const existingAccount = await prisma.account.findUnique({
        where: {
          provider_providerAccountId: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
        },
      })

      if (!existingAccount) {
        return !!account.refresh_token
      }

      await prisma.$transaction([
        prisma.account.update({
          where: { id: existingAccount.id },
          data: {
            access_token: account.access_token,
            refresh_token:
              account.refresh_token ?? existingAccount.refresh_token,
            expires_at: account.expires_at,
            scope: account.scope,
            token_type: account.token_type,
          },
        }),
        prisma.user.update({
          where: { id: existingAccount.userId },
          data: { jiraCloudId: atlassianProfile.jiraCloudId },
        }),
      ])

      return true
    },
    session({ session, user }) {
      session.user.id = user.id
      return session
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
})

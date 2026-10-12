import { IssueStoryPointsForm } from "@/app/dashboard/issue-story-points-form"
import { auth, signIn, signOut } from "@/auth"
import {
  getRecentAssignedIssues,
  JiraIssueSearchError,
  type JiraIssueSearchResult,
} from "@/lib/jira-issues"
import { JiraAuthorizationError } from "@/lib/jira-token"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      jiraCloudId: true,
      accounts: {
        where: { provider: "atlassian" },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!user?.jiraCloudId || user.accounts.length === 0) {
    await signOut({ redirectTo: "/login?error=Configuration" })
  }

  const jiraBaseUrl = getJiraBaseUrl()
  let result: JiraIssueSearchResult | null = null
  let errorState: "reauthorize" | "forbidden" | "retry" | "configuration" | null =
    null

  try {
    result = await getRecentAssignedIssues(session.user.id)
  } catch (error) {
    if (error instanceof JiraAuthorizationError) {
      errorState =
        error.code === "invalid_configuration" ? "configuration" : "reauthorize"
    } else if (error instanceof JiraIssueSearchError) {
      if (error.code === "reauthorization_required") {
        errorState = "reauthorize"
      } else if (error.code === "forbidden") {
        errorState = "forbidden"
      } else {
        errorState = "retry"
      }
    } else {
      throw error
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          <span className="font-semibold text-gray-900 dark:text-white">
            Jira Analysis Platform
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {session.user.name ?? session.user.email}
          </span>
          <form
            action={async () => {
              "use server"
              await signOut({ redirectTo: "/login" })
            }}
          >
            <button
              type="submit"
              className="cursor-pointer text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              登出
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            最近 30 天指派給我的 Issues
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            JQL：assignee = currentUser() AND created &gt;= -30d ORDER BY created DESC
          </p>
        </div>

        {errorState ? (
          <IssueErrorState state={errorState} />
        ) : result && result.issues.length > 0 ? (
          <IssueStoryPointsForm
            issues={result.issues}
            hasMore={result.hasMore}
            jiraBaseUrl={jiraBaseUrl}
          />
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-14 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-3 text-4xl">📭</div>
            <h2 className="font-semibold text-gray-900 dark:text-white">
              近 30 天沒有指派給你的 Issue
            </h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              目前沒有符合這組 JQL 的結果。
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

function IssueErrorState({
  state,
}: {
  state: "reauthorize" | "forbidden" | "retry" | "configuration"
}) {
  const messages = {
    reauthorize: {
      title: "Jira 授權已失效",
      description: "請重新授權 Atlassian 帳號後再載入 Issues。",
    },
    forbidden: {
      title: "沒有權限查詢 Issues",
      description: "請確認 Atlassian App 具有 read:jira-work 權限。",
    },
    retry: {
      title: "暫時無法取得 Jira Issues",
      description: "Jira 服務可能暫時忙碌，請稍後重新整理頁面。",
    },
    configuration: {
      title: "Jira 設定不完整",
      description: "請聯繫管理員檢查 Jira OAuth 與站台設定。",
    },
  } as const
  const message = messages[state]

  return (
    <div className="rounded-2xl border border-red-200 bg-white px-6 py-12 text-center shadow-sm dark:border-red-900 dark:bg-gray-800">
      <div className="mb-3 text-4xl">⚠️</div>
      <h2 className="font-semibold text-gray-900 dark:text-white">
        {message.title}
      </h2>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        {message.description}
      </p>
      {state === "reauthorize" ? (
        <form
          className="mt-6"
          action={async () => {
            "use server"
            await signIn("atlassian", { redirectTo: "/dashboard" })
          }}
        >
          <button
            type="submit"
            className="cursor-pointer rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            重新授權 Jira
          </button>
        </form>
      ) : (
        <a
          href="/dashboard"
          className="mt-6 inline-flex cursor-pointer rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          重新載入
        </a>
      )}
    </div>
  )
}

function getJiraBaseUrl() {
  try {
    return new URL(process.env.ATLASSIAN_JIRA_CLOUD_URL!).origin
  } catch {
    return null
  }
}

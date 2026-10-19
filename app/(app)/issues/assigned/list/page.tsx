import Link from "next/link"
import { IssueStoryPointsForm } from "@/app/(app)/issues/assigned/list/issue-story-points-form"
import { signIn } from "@/auth"
import { PageHeader } from "@/components/page-header"
import {
  getRecentAssignedIssues,
  JiraIssueSearchError,
  type JiraIssueSearchResult,
} from "@/lib/jira-issues"
import { JiraAuthorizationError } from "@/lib/jira-token"
import { RECENT_ASSIGNED_ISSUES_JQL } from "@/lib/jira-jql"

export default async function AssignedIssuesPage() {
  const jiraBaseUrl = getJiraBaseUrl()
  let result: JiraIssueSearchResult | null = null
  let errorState: "reauthorize" | "forbidden" | "retry" | "configuration" | null =
    null

  try {
    result = await getRecentAssignedIssues()
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
    <>
      <PageHeader
        title="指派給我的 Issues"
        description="最近 30 天建立並指派給你的 Issues，可直接更新 Story Points。"
        breadcrumbs={["Issue 管理", "指派給我的 Issues"]}
      />
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        JQL：{RECENT_ASSIGNED_ISSUES_JQL}
      </p>

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
          <div aria-hidden="true" className="mb-3 text-4xl">📭</div>
          <h2 className="font-semibold text-gray-900 dark:text-white">
            近 30 天沒有指派給你的 Issue
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            目前沒有符合這組 JQL 的結果。
          </p>
        </div>
      )}
    </>
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
      <div aria-hidden="true" className="mb-3 text-4xl">⚠️</div>
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
            await signIn("atlassian", {
              redirectTo: "/issues/assigned/list",
            })
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
        <Link
          href="/issues/assigned/list"
          className="mt-6 inline-flex cursor-pointer rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          重新載入
        </Link>
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

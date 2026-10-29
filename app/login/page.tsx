import { auth, signIn } from "@/auth"
import { redirect } from "next/navigation"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string }>
}) {
  const session = await auth()
  if (session) redirect("/dashboard")

  const { error, code } = await searchParams
  const errorKey = code ?? error
  const jiraHostname = getJiraHostname()
  const errorMessages: Record<string, string> = {
    AccessDenied: "Jira 授權遭拒，請允許存取後再試一次。",
    OAuthAccountNotLinked: "此信箱已連結其他登入方式，請聯繫管理員。",
    OAuthCallbackError: "無法完成 Jira 授權，請確認帳號權限後重試。",
    OAuthCreateAccount: "無法建立登入帳號，請稍後再試。",
    Configuration: "Jira 登入設定有誤，請聯繫管理員。",
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-indigo-950">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-10 w-full max-w-sm text-center">
        <div className="mb-4 flex justify-center">
          <svg
            aria-hidden="true"
            className="h-14 w-14"
            viewBox="0 0 64 64"
            role="img"
            aria-label="分析圖標誌"
          >
            <rect width="64" height="64" rx="14" fill="#4f46e5"/>
            <g fill="none" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 46 V28" stroke="#f87171"/>
              <path d="M32 46 V20" stroke="#facc15"/>
              <path d="M44 46 V34" stroke="#4ade80"/>
            </g>
            <path d="M16 50 H48" stroke="#c7d2fe" stroke-width="4" stroke-linecap="round"/>
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Jira Analysis Platform
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
          使用 Atlassian 帳號登入並授權 Jira 存取
        </p>

        {errorKey && (
          <div className="mb-6 px-4 py-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-sm">
            {errorMessages[errorKey] ?? "登入時發生錯誤，請重試。"}
          </div>
        )}

        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            授權時請選擇正確的 Jira 站台
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            在「Install app on」選擇「
            <span className="font-semibold text-red-600 dark:text-red-400">{jiraHostname}</span>」。
          </p>
        </div>

        <form
          action={async () => {
            "use server"
            await signIn("atlassian", { redirectTo: "/dashboard" })
          }}
        >
          <button
            type="submit"
            className="w-full cursor-pointer flex items-center justify-center gap-3 px-6 py-3 bg-[#1868DB] rounded-xl text-white font-medium hover:bg-[#0C66E4] transition-colors shadow-sm"
          >
            <svg
              aria-hidden="true"
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                fill="currentColor"
                d="M11.57 3.45c-.36-.6-.88-.55-1.13.09L5.1 17.18h3.73l3.13-7.92 2.07 4.97H12.2l-1.14 2.95h8.35L11.57 3.45Z"
              />
            </svg>
            使用 Jira 登入
          </button>
        </form>
      </div>
    </div>
  )
}

function getJiraHostname() {
  try {
    return new URL(process.env.ATLASSIAN_JIRA_CLOUD_URL!).hostname
  } catch {
    return "公司指定的 Jira 站台"
  }
}

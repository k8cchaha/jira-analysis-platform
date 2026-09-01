import { auth, signOut } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { redirect } from "next/navigation"

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.email) redirect("/login")

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { jiraToken: true },
  })

  const hasJiraToken = !!user?.jiraToken

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
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
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              登出
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16 text-center">
        {hasJiraToken ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-10 border border-gray-200 dark:border-gray-700">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Jira 已成功連結
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              你的帳號已連結 kkvideo.atlassian.net，後續功能開發中。
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-10 border border-gray-200 dark:border-gray-700">
            <div className="text-5xl mb-4">🔗</div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              需要授權 Jira 存取
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
              首次使用需要授權一次，之後登入不需再重複操作。
            </p>
            <Link
              href="/api/auth/jira"
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors"
            >
              授權 Jira 存取
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}

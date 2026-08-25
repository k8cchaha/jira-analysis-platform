export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-indigo-950">
      <main className="text-center px-8">
        <div className="mb-6">
          <span className="text-6xl">📊</span>
        </div>
        <h1 className="text-5xl font-bold text-indigo-700 dark:text-indigo-300 mb-4">
          Jira Analysis Platform
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-400 mb-2">
          多維度 Jira 數據分析平台
        </p>
        <p className="text-gray-500 dark:text-gray-500 text-sm mt-8">
          開發中 — 更多功能即將推出
        </p>
      </main>
    </div>
  );
}

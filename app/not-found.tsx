import Link from "next/link"

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
          找不到頁面
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
          此頁面可能已移動，或網址不正確。
        </p>
        <Link
          href="/dashboard"
          className="mt-7 inline-flex rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          返回儀表板
        </Link>
      </div>
    </main>
  )
}

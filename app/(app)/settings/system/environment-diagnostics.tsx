"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { revealEnvironmentSecretAction } from "./actions"
import { ENVIRONMENT_STATE_LABELS, type EnvironmentEntry, type EnvironmentRevealResult, type SecretEnvironmentName } from "./environment"

type Reveal =
  | { name: SecretEnvironmentName; phase: "confirm" | "pending" }
  | { name: SecretEnvironmentName; phase: "result"; result: EnvironmentRevealResult }

const buttonClass = "rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"

export function EnvironmentDiagnostics({ entries }: { entries: readonly EnvironmentEntry[] }) {
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [, startTransition] = useTransition()
  const mounted = useRef(true)
  const intent = useRef<{ name: SecretEnvironmentName; phase: "confirm" | "pending" | "result" } | null>(null)

  const hide = useCallback(() => {
    intent.current = null
    setReveal(null)
  }, [])

  useEffect(() => {
    mounted.current = true
    const onVisibility = () => { if (document.visibilityState === "hidden") hide() }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", hide)
    return () => {
      mounted.current = false
      intent.current = null
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", hide)
    }
  }, [hide])

  function choose(name: SecretEnvironmentName) {
    if (!mounted.current || document.visibilityState === "hidden") return
    hide()
    intent.current = { name, phase: "confirm" }
    setReveal({ name, phase: "confirm" })
  }

  function confirm(name: SecretEnvironmentName) {
    if (!mounted.current || document.visibilityState === "hidden" || intent.current?.name !== name || intent.current.phase !== "confirm") return
    const request = { name, phase: "pending" } as const
    intent.current = request
    setReveal({ name, phase: "pending" })
    startTransition(async () => {
      let result: EnvironmentRevealResult
      try {
        result = await revealEnvironmentSecretAction(name)
      } catch {
        result = { ok: false, message: "暫時無法讀取環境值，請稍後再試。" }
      }
      // 隱藏／改選／離頁後只忽略回應，不能撤回已送出的 request。
      if (!mounted.current || intent.current !== request || document.visibilityState === "hidden") return
      if (result.ok && result.name !== name) result = { ok: false, message: "環境值回應不符，請重新操作。" }
      intent.current = { name, phase: "result" }
      setReveal({ name, phase: "result", result })
    })
  }

  return <section aria-label="暫時環境診斷" className="min-w-0 space-y-4">
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-semibold">暫時性診斷 · 唯讀 · 僅限管理員</p>
      <p>顯示目前伺服器執行環境的值，不讀取憑證檔，也不修改設定。敏感值預設完全遮蔽；一次只顯示一項。</p>
      <p>確認顯示後，憑證會傳到瀏覽器，可被開發者工具或螢幕分享看見。隱藏、切換分頁或離開此頁只會清除介面暫存，無法撤回已收到的網路回應。診斷完成後請移除此功能。</p>
    </div>
    <dl className="min-w-0 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
      {entries.map((entry) => {
        const active = reveal?.name === entry.name ? reveal : null
        const result = active?.phase === "result" ? active.result : null
        const state = result?.ok ? result.state : entry.state
        const value = entry.sensitive ? (result?.ok ? result.value : null) : entry.value
        return <div key={entry.name} className="grid min-w-0 gap-3 p-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <dt className="min-w-0">
            <code className="break-all text-sm font-semibold text-slate-950 dark:text-white">{entry.name}</code>
            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{entry.purpose}</p>
          </dt>
          <dd className="min-w-0 space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">{ENVIRONMENT_STATE_LABELS[state]}{entry.sensitive ? " · 敏感憑證" : ""}</p>
            <code className="block min-w-0 whitespace-pre-wrap break-all rounded-md bg-slate-100 p-3 text-sm text-slate-900 dark:bg-slate-950 dark:text-slate-100">
              {entry.sensitive && !result?.ok ? (state === "set" ? "••••••••（已遮蔽）" : ENVIRONMENT_STATE_LABELS[state]) : state === "set" ? value : ENVIRONMENT_STATE_LABELS[state]}
            </code>
            {entry.sensitive && entry.state === "set" && <div className="flex flex-wrap items-center gap-2">
              {!active && <button type="button" className={buttonClass} onClick={() => choose(entry.name)} aria-label={`顯示 ${entry.name}`}>顯示敏感值</button>}
              {active?.phase === "confirm" && <>
                <p className="w-full text-sm text-amber-800 dark:text-amber-200">確認將 {entry.name} 的完整值傳到此瀏覽器？</p>
                <button type="button" className={buttonClass} onClick={() => confirm(entry.name)}>確認顯示</button>
                <button type="button" className={buttonClass} onClick={hide}>取消</button>
              </>}
              {active?.phase === "pending" && <p role="status" className="text-sm text-slate-600 dark:text-slate-400">讀取中…</p>}
              {active && active.phase !== "confirm" && <button type="button" className={buttonClass} onClick={hide}>隱藏／清除</button>}
              {result && !result.ok && <p role="alert" className="w-full text-sm text-red-700 dark:text-red-300">{result.message}</p>}
            </div>}
          </dd>
        </div>
      })}
    </dl>
  </section>
}

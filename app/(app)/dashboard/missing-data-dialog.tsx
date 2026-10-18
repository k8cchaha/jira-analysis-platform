"use client"

import { useActionState, useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { EditDialog } from "@/components/edit-dialog"
import { useNavigationBlocker } from "@/components/navigation-blocker"
import {
  isMissingPoint,
  type MissingDataActionState,
  type MissingDataChange,
  type MissingDataError,
  type MissingDataKind,
  type MissingDataPage,
  type MissingDataPageResult,
  type MissingIssue,
} from "@/lib/jira-missing-data"
import { reauthorizeDashboardAction, updateMissingDataAction } from "./actions"

type PointField = "storyPoints" | "actualStoryPoints"
type Draft = { storyPoints?: string; actualStoryPoints?: string; defectCause?: string[] }
type Drafts = Record<string, Draft>
type Confirmation = { action: "close" } | { action: "page"; token: string | null }

const initialState: MissingDataActionState = {
  submissionId: null, status: "idle", message: "", succeededIssueIds: [], failures: [],
}
const secondaryButton = "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
const primaryButton = "rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"

export function MissingDataDialog({ kind, onClose, onSaved }: {
  kind: MissingDataKind
  onClose: () => void
  onSaved: () => void
}) {
  const [data, setData] = useState<MissingDataPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<MissingDataError | null>(null)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [saving, setSaving] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [reauthorizing, setReauthorizing] = useState(false)
  const requestSequence = useRef(0)
  const pageToken = useRef<string | null>(null)
  const mounted = useRef(false)
  const snapshot = useRef<{ id: string; drafts: Drafts; changes: MissingDataChange[] } | null>(null)
  const { setBlocked } = useNavigationBlocker()
  const hasDrafts = Object.keys(drafts).length > 0

  const loadPage = useCallback(async (token: string | null) => {
    const sequence = ++requestSequence.current
    pageToken.current = token
    try {
      const params = new URLSearchParams({ kind, view: "page" })
      if (token) params.set("pageToken", token)
      const response = await fetch(`/api/dashboard/missing-data?${params}`, { cache: "no-store" })
      const result: MissingDataPageResult = await response.json()
      if (!mounted.current || sequence !== requestSequence.current) return
      if (result.status === "success") setData(result.data)
      else if (result.status === "error") setError(result.error)
      else throw new Error("Invalid response")
    } catch {
      if (mounted.current && sequence === requestSequence.current) {
        setError({ code: "retry", message: "無法載入明細，請重試。尚未儲存的草稿不會被移除。" })
      }
    } finally {
      if (mounted.current && sequence === requestSequence.current) setLoading(false)
    }
  }, [kind])

  useEffect(() => {
    mounted.current = true
    let active = true
    queueMicrotask(() => { if (active) void loadPage(null) })
    return () => { active = false; mounted.current = false; requestSequence.current += 1 }
  }, [loadPage])

  const boundAction = updateMissingDataAction.bind(null, kind)
  const [state, formAction, pending] = useActionState(async (previous: MissingDataActionState, formData: FormData): Promise<MissingDataActionState> => {
    const submitted = snapshot.current
    let result: MissingDataActionState
    try {
      result = await boundAction(previous, formData)
    } catch {
      result = {
        ...initialState,
        submissionId: submitted?.id ?? null,
        status: "error",
        message: "儲存失敗，草稿已保留。請重試；如 Jira 已收到更新，會重新檢查當下值。",
      }
    }
    if (!mounted.current) return result
    setSaving(false)
    if (!submitted || submitted.id !== result.submissionId) {
      return { ...result, succeededIssueIds: [], status: "error", message: "無法核對儲存結果，草稿已保留。請重試。" }
    }
    const succeeded = new Set(result.succeededIssueIds)
    const remaining = Object.fromEntries(Object.entries(submitted.drafts).filter(([id]) => !succeeded.has(id)))
    // Apply the submitted snapshot, never a later draft or a freshly fetched row.
    setDrafts(remaining)
    if (succeeded.size > 0) {
      setData((current) => current ? {
        ...current,
        issues: current.issues.flatMap((issue) => {
          const change = submitted.changes.find((item) => item.issueId === issue.id)
          if (!succeeded.has(issue.id) || !change) return [issue]
          const updated = {
            ...issue,
            ...(change.storyPoints !== undefined ? { storyPoints: change.storyPoints, storyPointsEditable: false } : {}),
            ...(change.actualStoryPoints !== undefined ? { actualStoryPoints: change.actualStoryPoints, actualStoryPointsEditable: false } : {}),
            ...(change.defectCause ? { defectCause: change.defectCause, defectCauseEditable: false } : {}),
          }
          const stillMissing = kind === "points"
            ? isMissingPoint(updated.storyPoints) || isMissingPoint(updated.actualStoryPoints)
            : updated.defectCause.length === 0
          return stillMissing ? [updated] : []
        }),
      } : current)
      onSaved()
      // Refetch only when it cannot hide failed rows or remaining drafts.
      if (Object.keys(remaining).length === 0) reloadPage(pageToken.current)
    }
    return result
  }, initialState)
  const busy = pending || saving || reauthorizing
  const blocked = hasDrafts || busy

  useEffect(() => {
    setBlocked(`dashboard-${kind}`, blocked)
    return () => setBlocked(`dashboard-${kind}`, false)
  }, [blocked, kind, setBlocked])

  useEffect(() => {
    if (!blocked) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [blocked])

  const changes: MissingDataChange[] = []
  let invalid = false
  for (const issue of data?.issues ?? []) {
    const draft = drafts[issue.id]
    if (!draft) continue
    const change: MissingDataChange = { issueId: issue.id }
    for (const field of ["storyPoints", "actualStoryPoints"] as const) {
      if (draft[field] === undefined) continue
      const value = parsePositivePoints(draft[field])
      const editable = field === "storyPoints" ? issue.storyPointsEditable : issue.actualStoryPointsEditable
      if (value === null || !editable || !isMissingPoint(issue[field])) { invalid = true; continue }
      change[field] = value
      if (field === "storyPoints") change.expectedStoryPoints = issue.storyPoints
      else change.expectedActualStoryPoints = issue.actualStoryPoints
    }
    if (draft.defectCause) {
      if (!issue.defectCauseEditable || draft.defectCause.length === 0 || draft.defectCause.some((id) => !issue.defectCauseOptions.some((option) => option.id === id))) invalid = true
      else change.defectCause = draft.defectCause
    }
    if (Object.keys(change).length > 1) changes.push(change)
  }
  const changesJson = JSON.stringify(changes)
  const draftsId = JSON.stringify(drafts)
  const payloadTooLarge = changesJson.length > 10_000 || draftsId.length > 10_000
  const canSubmit = changes.length > 0 && !invalid && !payloadTooLarge && !busy && !loading && !confirmation
  const failureByIssue = new Map(state.failures.map((failure) => [failure.issueId, failure.message]))

  function editDraft(issue: MissingIssue, field: PointField | "defectCause", value: string | string[]) {
    if (busy || confirmation || loading) return
    setDrafts((current) => {
      const next = { ...current, [issue.id]: { ...current[issue.id] } }
      if (value.length === 0) delete next[issue.id][field]
      else if (field === "defectCause" && Array.isArray(value)) next[issue.id].defectCause = value
      else if (field !== "defectCause" && typeof value === "string") next[issue.id][field] = value
      if (Object.keys(next[issue.id]).length === 0) delete next[issue.id]
      return next
    })
  }

  function requestClose() {
    if (busy) return
    if (hasDrafts) setConfirmation({ action: "close" })
    else { requestSequence.current += 1; onClose() }
  }

  function reloadPage(token: string | null) {
    setLoading(true)
    setError(null)
    void loadPage(token)
  }

  function requestPage(token: string | null) {
    if (busy || loading) return
    if (hasDrafts) setConfirmation({ action: "page", token })
    else reloadPage(token)
  }

  function discard() {
    if (!confirmation || busy) return
    setDrafts({})
    const next = confirmation
    setConfirmation(null)
    if (next.action === "close") { requestSequence.current += 1; onClose() }
    else reloadPage(next.token)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (!canSubmit) { event.preventDefault(); return }
    snapshot.current = { id: draftsId, drafts, changes }
    requestSequence.current += 1
    setSaving(true)
  }

  async function reauthorize() {
    if (hasDrafts || busy) return
    setReauthorizing(true)
    try { await reauthorizeDashboardAction() }
    catch { setError({ code: "retry", message: "無法開始重新授權，請重試。" }); setReauthorizing(false) }
  }

  function issueFields(issue: MissingIssue, layout: string) {
    if (kind === "defect-cause") return (
      <DefectCauseInput issue={issue} value={drafts[issue.id]?.defectCause ?? issue.defectCause} disabled={busy || loading || Boolean(confirmation)} prefix={layout} onChange={(value) => editDraft(issue, "defectCause", value)} />
    )
    return (["storyPoints", "actualStoryPoints"] as const).map((field) => (
      <PointInput key={field} issue={issue} field={field} raw={drafts[issue.id]?.[field]} disabled={busy || loading || Boolean(confirmation)} prefix={layout} onChange={(value) => editDraft(issue, field, value)} />
    ))
  }

  return (
    <EditDialog title={kind === "points" ? "補填缺失 Points" : "補填 Defect Cause"} description={kind === "points" ? "只可補填空值或 0；已有正值不會被覆寫。請輸入大於 0 的有限數值，可含小數。" : "Root Cause 與 Solution 為唯讀；Defect Cause 可多選，選項依各張 Issue 的 Jira 設定。"} busy={busy} onClose={requestClose}>
      {confirmation && (
        <section role="alert" className="shrink-0 border-b border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <h3 className="font-semibold">放棄尚未儲存的變更？</h3>
          <p className="mt-1 text-sm">{confirmation.action === "close" ? "關閉後" : "重新載入或換頁後"}，目前的草稿將被移除；已成功儲存的資料不受影響。</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" autoFocus onClick={() => setConfirmation(null)} className={secondaryButton}>繼續編輯</button>
            <button type="button" onClick={discard} className={primaryButton}>放棄變更並{confirmation.action === "close" ? "關閉" : "繼續"}</button>
          </div>
        </section>
      )}
      <form action={formAction} onSubmit={submit} noValidate inert={Boolean(confirmation)} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="changes" value={changesJson} />
        <input type="hidden" name="submissionId" value={draftsId} />
        <div aria-busy={loading} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {error && (
            <div role="alert" className="m-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30">
              <p className="flex items-start gap-2 font-medium"><WarningIcon /><span>{error.message}</span></p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" disabled={busy || loading} onClick={() => requestPage(error.code === "invalid_page" ? null : pageToken.current)} className={secondaryButton}>{error.code === "invalid_page" ? "重新載入第一頁" : "重試載入"}</button>
                {error.code === "reauthorize" && <button type="button" disabled={hasDrafts || busy} onClick={() => void reauthorize()} className={primaryButton}>重新授權 Jira</button>}
              </div>
              {error.code === "reauthorize" && hasDrafts && <p className="mt-2">請先關閉並確認放棄草稿，再重新授權。</p>}
            </div>
          )}
          {loading ? (
            <div role="status" className="space-y-4 p-4 sm:p-6">
              <span className="sr-only">正在載入明細</span>
              {[1, 2, 3].map((index) => <div key={index} aria-hidden="true" className="h-24 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />)}
            </div>
          ) : data ? (
            <>
              <div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-600 sm:px-6 dark:border-slate-800 dark:text-slate-400">第 {data.page} 頁 · 本頁 {data.issues.length} 張 Issue · 每頁最多 50 張</div>
              {data.warnings.map((warning, index) => <p key={index} className="m-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30"><WarningIcon /><span>{warning}</span></p>)}
              {data.issues.length === 0 ? <p role="status" className="p-8 text-center text-sm text-slate-600 dark:text-slate-400">本頁沒有待補資料。可重新載入第一頁，查看目前的缺失清單。</p> : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full table-fixed text-left text-sm">
                      <caption className="sr-only">{kind === "points" ? "Points 缺失 Issue" : "Defect Cause 缺失 Issue"}</caption>
                      <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                        <tr><th scope="col" className="w-[32%] px-6 py-3">Issue / Summary</th>{kind === "points" ? <><th scope="col" className="px-4 py-3">Story Points</th><th scope="col" className="px-4 py-3">Actual Story Points</th></> : <><th scope="col" className="px-4 py-3">Root Cause</th><th scope="col" className="px-4 py-3">Solution</th><th scope="col" className="w-[24%] px-4 py-3">Defect Cause</th></>}</tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {data.issues.map((issue) => <tr key={issue.id} className="align-top">
                          <td className="px-6 py-4"><IssueHeading issue={issue} jiraBaseUrl={data.jiraBaseUrl} /><RowNotice issue={issue} error={failureByIssue.get(issue.id)} modified={Boolean(drafts[issue.id])} /></td>
                          {kind === "points" ? (issueFields(issue, "desktop") as React.ReactNode[]).map((field, index) => <td key={index} className="px-4 py-4">{field}</td>) : <><td className="whitespace-pre-wrap break-words px-4 py-4 text-slate-600 dark:text-slate-300">{issue.rootCause || "—"}</td><td className="whitespace-pre-wrap break-words px-4 py-4 text-slate-600 dark:text-slate-300">{issue.solution || "—"}</td><td className="px-4 py-4">{issueFields(issue, "desktop")}</td></>}
                        </tr>)}
                      </tbody>
                    </table>
                  </div>
                  <div className="divide-y divide-slate-200 md:hidden dark:divide-slate-800">
                    {data.issues.map((issue) => <article key={issue.id} className="p-4">
                      <IssueHeading issue={issue} jiraBaseUrl={data.jiraBaseUrl} />
                      <RowNotice issue={issue} error={failureByIssue.get(issue.id)} modified={Boolean(drafts[issue.id])} />
                      {kind === "defect-cause" && <dl className="mt-4 space-y-3 text-sm"><div><dt className="font-medium">Root Cause</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">{issue.rootCause || "—"}</dd></div><div><dt className="font-medium">Solution</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">{issue.solution || "—"}</dd></div></dl>}
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">{issueFields(issue, "mobile")}</div>
                    </article>)}
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
        <footer className="shrink-0 space-y-3 border-t border-slate-200 p-4 sm:p-6 dark:border-slate-800">
          {state.message && <p role="status" className="text-sm leading-6">{state.message}</p>}
          {invalid && <p role="alert" className="text-sm text-red-700 dark:text-red-300">請修正標記的欄位；只接受大於 0 的有限數值，Defect Cause 至少需選一項。</p>}
          {payloadTooLarge && <p role="alert" className="text-sm">本次變更資料過大，請減少變更筆數後再儲存。</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || loading || !data?.previousPageToken} onClick={() => requestPage(data?.previousPageToken ?? null)} className={secondaryButton}>上一頁</button>
              <button type="button" disabled={busy || loading || !data?.nextPageToken} onClick={() => requestPage(data?.nextPageToken ?? null)} className={secondaryButton}>下一頁</button>
              <button type="button" disabled={busy || loading} onClick={() => requestPage(null)} className={secondaryButton}>重新載入第一頁</button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-600 dark:text-slate-400">{Object.keys(drafts).length} 張未儲存</span>
              <button type="submit" disabled={!canSubmit} className={primaryButton}>{busy ? "處理中…" : "確認儲存"}</button>
            </div>
          </div>
        </footer>
      </form>
    </EditDialog>
  )
}

function parsePositivePoints(raw: string): number | null {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function PointInput({ issue, field, raw, disabled, prefix, onChange }: {
  issue: MissingIssue; field: PointField; raw?: string; disabled: boolean; prefix: string; onChange: (value: string) => void
}) {
  const label = field === "storyPoints" ? "Story Points" : "Actual Story Points"
  const editable = isMissingPoint(issue[field]) && (field === "storyPoints" ? issue.storyPointsEditable : issue.actualStoryPointsEditable)
  const id = `${prefix}-${issue.id}-${field}`
  const invalid = raw !== undefined && parsePositivePoints(raw) === null
  return <div>
    <label htmlFor={editable ? id : undefined} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</label>
    {editable ? <>
      <input id={id} type="text" inputMode="decimal" value={raw ?? ""} disabled={disabled} placeholder={issue[field] === 0 ? "0（待補填）" : "空值（待補填）"} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)} className={`w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:opacity-50 dark:bg-slate-950 dark:focus:ring-blue-900 ${raw !== undefined ? "border-amber-500" : "border-slate-300 dark:border-slate-700"}`} />
      {invalid && <p id={`${id}-error`} className="mt-1 text-xs text-red-700 dark:text-red-300">請輸入大於 0 的有限數值，可含小數。</p>}
    </> : <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">{isMissingPoint(issue[field]) ? "缺失（不可編輯）" : `${issue[field]}（唯讀）`}</p>}
  </div>
}

function DefectCauseInput({ issue, value, disabled, prefix, onChange }: {
  issue: MissingIssue; value: string[]; disabled: boolean; prefix: string; onChange: (value: string[]) => void
}) {
  const id = `${prefix}-${issue.id}-defect-cause`
  const unavailable = !issue.defectCauseEditable || issue.defectCauseOptions.length === 0
  const selected = issue.defectCauseOptions.filter((option) => value.includes(option.id)).map((option) => option.value)
  return <div>
    <span id={`${id}-label`} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Defect Cause（可多選）</span>
    {unavailable ? <p className="text-sm text-slate-600 dark:text-slate-400">{selected.join("、") || "沒有可用選項或無編輯權限"}</p> : <details className="rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950" onToggle={(event) => { if (disabled && event.currentTarget.open) event.currentTarget.open = false }}>
      <summary aria-labelledby={`${id}-label ${id}-value`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onClick={(event) => { if (disabled) event.preventDefault() }} className="cursor-pointer break-words px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-600"><span id={`${id}-value`}>{selected.length ? selected.join("、") : "選擇原因"}</span></summary>
      <fieldset disabled={disabled} className="max-h-56 space-y-1 overflow-y-auto border-t border-slate-200 p-2 dark:border-slate-800">
        <legend className="sr-only">{issue.key} Defect Cause，可選擇多個原因</legend>
        {issue.defectCauseOptions.map((option) => <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"><input type="checkbox" checked={value.includes(option.id)} onChange={(event) => onChange(event.target.checked ? [...value, option.id] : value.filter((id) => id !== option.id))} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" /><span className="break-words">{option.value}</span></label>)}
      </fieldset>
    </details>}
  </div>
}

function IssueHeading({ issue, jiraBaseUrl }: { issue: MissingIssue; jiraBaseUrl: string | null }) {
  return <div className="min-w-0 break-words">
    {jiraBaseUrl ? <a href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(issue.key)}`} target="_blank" rel="noopener noreferrer" aria-label={`在 Jira 開啟 ${issue.key}（另開分頁）`} className="text-xs font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300">{issue.key} <span aria-hidden="true">↗</span></a> : <span className="text-xs font-semibold">{issue.key}</span>}
    <p className="mt-1 font-medium">{issue.summary}</p>
  </div>
}

function WarningIcon() {
  return <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 10 18H2Z" /><path d="M12 9v5M12 17h.01" /></svg>
}

function RowNotice({ issue, error, modified }: { issue: MissingIssue; error?: string; modified: boolean }) {
  return <>
    {issue.unavailableReason && <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{issue.unavailableReason}</p>}
    {modified && <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-300">尚未儲存</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">儲存失敗：{error}</p>}
  </>
}

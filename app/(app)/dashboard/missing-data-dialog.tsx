"use client"

import { useActionState, useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { EditDialog } from "@/components/edit-dialog"
import { ParentIssueTypeIcon } from "./parent-issue-type-icon"
import { useNavigationBlocker } from "@/components/navigation-blocker"
import {
  isMissingPoint,
  missingPoints,
  MISSING_DATA_PAGE_SIZE,
  type MissingDataActionState,
  type MissingDataChange,
  type MissingDataError,
  type MissingDataKind,
  type MissingDataPageResult,
  type MissingIssue,
} from "@/lib/jira-missing-data"
import { loadMissingDataList, MissingDataListError, type MissingDataList } from "@/lib/jira-missing-data-list"
import { reauthorizeDashboardAction, updateMissingDataAction } from "./actions"
import { SELF_FILTER, dashboardHref, serializeDashboardFilter, type DashboardFilter } from "@/lib/jira-dashboard-filter"

type PointField = "storyPoints" | "actualStoryPoints"
type Draft = { storyPoints?: string; actualStoryPoints?: string; defectCause?: string[] }
type Drafts = Record<string, Draft>
type Confirmation = { action: "close" | "reload" }

const initialState: MissingDataActionState = {
  submissionId: null, status: "idle", message: "", succeededIssueIds: [], failures: [],
}
const secondaryButton = "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
const primaryButton = "rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"

export function MissingDataDialog({ kind, filter = SELF_FILTER, scopeChanged = false, onClose, onSaved }: {
  kind: MissingDataKind
  filter?: DashboardFilter
  scopeChanged?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const query = serializeDashboardFilter(filter)
  const scopeReadOnly = filter.mode !== "self"
  const [data, setData] = useState<MissingDataList | null>(null)
  const readOnly = scopeReadOnly || data?.readOnly === true
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<MissingDataError | null>(null)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [saving, setSaving] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [reauthorizing, setReauthorizing] = useState(false)
  const requestSequence = useRef(0)
  const loadController = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const snapshot = useRef<{ id: string; drafts: Drafts; changes: MissingDataChange[] } | null>(null)
  const { setBlocked } = useNavigationBlocker()
  const hasDrafts = Object.keys(drafts).length > 0

  const loadList = useCallback(async (discardDrafts = false) => {
    const sequence = ++requestSequence.current
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    try {
      const result = await loadMissingDataList(async (token) => {
        const params = new URLSearchParams(query)
        params.set("kind", kind)
        params.set("view", "page")
        if (token) params.set("pageToken", token)
        const response = await fetch(`/api/dashboard/missing-data?${params}`, { cache: "no-store", signal: controller.signal })
        return await response.json() as MissingDataPageResult
      }, controller.signal)
      if (!mounted.current || sequence !== requestSequence.current) return
      setData(result)
      if (discardDrafts) setDrafts({})
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && sequence === requestSequence.current) {
        setError(error instanceof MissingDataListError ? error.detail : { code: "retry", message: "無法載入完整明細，請重試。尚未儲存的草稿不會被移除。" })
      }
    } finally {
      if (mounted.current && sequence === requestSequence.current) setLoading(false)
    }
  }, [kind, query])

  useEffect(() => {
    mounted.current = true
    let active = true
    queueMicrotask(() => { if (active) void loadList() })
    return () => { active = false; mounted.current = false; requestSequence.current += 1; loadController.current?.abort() }
  }, [loadList])

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
            ...(change.storyPoints !== undefined ? { storyPoints: change.storyPoints } : {}),
            ...(change.actualStoryPoints !== undefined ? { actualStoryPoints: change.actualStoryPoints } : {}),
            ...(change.defectCause ? { defectCause: change.defectCause, defectCauseEditable: false } : {}),
          }
          const missing = missingPoints(updated)
          const stillMissing = kind === "points"
            ? missing.storyPointsMissing || missing.actualStoryPointsMissing
            : updated.defectCause.length === 0
          return stillMissing ? [updated] : []
        }),
      } : current)
      onSaved()
      // Refetch only when it cannot hide failed rows or remaining drafts.
      if (Object.keys(remaining).length === 0) reloadList()
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
      if (value === null || !editable) { invalid = true; continue }
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
  const draftCount = Object.keys(drafts).length
  const draftLimitReached = draftCount >= MISSING_DATA_PAGE_SIZE
  const payloadTooLarge = changes.length > MISSING_DATA_PAGE_SIZE || changesJson.length > 10_000 || draftsId.length > 10_000
  const canSubmit = !readOnly && changes.length > 0 && !invalid && !payloadTooLarge && !busy && !loading && !confirmation
  const failureByIssue = new Map(state.failures.map((failure) => [failure.issueId, failure.message]))

  function editDraft(issue: MissingIssue, field: PointField | "defectCause", value: string | string[]) {
    if (readOnly || busy || confirmation || loading) return
    setDrafts((current) => {
      if (!current[issue.id] && Object.keys(current).length >= MISSING_DATA_PAGE_SIZE) return current
      const next = { ...current, [issue.id]: { ...current[issue.id] } }
      if (field === "defectCause" && Array.isArray(value)) {
        if (value.length === 0) delete next[issue.id].defectCause
        else next[issue.id].defectCause = value
      } else if (field !== "defectCause" && typeof value === "string") {
        const parsed = parsePositivePoints(value)
        if ((value === "" && isMissingPoint(issue[field])) || (parsed !== null && parsed === issue[field])) delete next[issue.id][field]
        else next[issue.id][field] = value
      }
      if (Object.keys(next[issue.id]).length === 0) delete next[issue.id]
      return next
    })
  }

  function requestClose() {
    if (busy) return
    if (hasDrafts) setConfirmation({ action: "close" })
    else { requestSequence.current += 1; loadController.current?.abort(); onClose() }
  }

  function reloadList(discardDrafts = false) {
    setLoading(true)
    setError(null)
    void loadList(discardDrafts)
  }

  function requestReload() {
    if (busy || loading) return
    if (hasDrafts) setConfirmation({ action: "reload" })
    else reloadList()
  }

  function discard() {
    if (!confirmation || busy) return
    const next = confirmation
    setConfirmation(null)
    if (next.action === "close") { setDrafts({}); requestSequence.current += 1; loadController.current?.abort(); onClose() }
    else reloadList(true)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (!canSubmit) { event.preventDefault(); return }
    snapshot.current = { id: draftsId, drafts, changes }
    requestSequence.current += 1
    loadController.current?.abort()
    setSaving(true)
  }

  async function reauthorize() {
    if (hasDrafts || busy) return
    setReauthorizing(true)
    try { await reauthorizeDashboardAction(dashboardHref(filter)) }
    catch { setError({ code: "retry", message: "無法開始重新授權，請重試。" }); setReauthorizing(false) }
  }

  function issueFields(issue: MissingIssue, layout: string) {
    if (readOnly) {
      if (kind === "defect-cause") return <div><span className="sr-only">{issue.key} Defect Cause</span><p className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">缺失（唯讀）</p></div>
      return (["storyPoints", "actualStoryPoints"] as const).map((field) => <div key={field}><span className={layout === "desktop" ? "sr-only" : "mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400"}>{field === "storyPoints" ? "Story Points" : "Actual Story Points"}</span><p className="flex h-[30px] w-20 items-center justify-center text-sm tabular-nums text-slate-600 dark:text-slate-300">{isMissingPoint(issue[field]) ? "—" : issue[field]}<span className="sr-only">{(field === "storyPoints" ? missingPoints(issue).storyPointsMissing : missingPoints(issue).actualStoryPointsMissing) ? "（缺失 · 唯讀）" : "（唯讀）"}</span></p></div>)
    }
    const disabled = busy || loading || Boolean(confirmation) || (draftLimitReached && !drafts[issue.id])
    if (kind === "defect-cause") return (
      <DefectCauseInput issue={issue} value={drafts[issue.id]?.defectCause ?? issue.defectCause} disabled={disabled} prefix={layout} onChange={(value) => editDraft(issue, "defectCause", value)} />
    )
    return (["storyPoints", "actualStoryPoints"] as const).map((field) => (
      <PointInput key={field} issue={issue} field={field} raw={drafts[issue.id]?.[field]} disabled={disabled} prefix={layout} onChange={(value) => editDraft(issue, field, value)} />
    ))
  }

  return (
    <EditDialog title={readOnly ? (kind === "points" ? "(Actual) Story Points 缺失明細" : "Defect Cause 缺失明細") : (kind === "points" ? "補填 (Actual) Story Points" : "補填 Defect Cause")} description={readOnly ? "缺失欄位明細。" : (kind === "points" ? "SP 與 Actual SP 可補填或調整已有值；請輸入大於 0 的有限數值，可含小數。儲存時會核對原值與 Jira 權限。" : "Root Cause 與 Solution 為唯讀；Defect Cause 可多選，選項依各張 Issue 的 Jira 設定。")} count={loading ? null : data?.issues.length ?? null} compact iconClose busy={busy} onClose={requestClose}>
      {scopeChanged && <p role="status" className="shrink-0 border-b border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30">網址篩選已變更，此彈窗仍保留開啟時的範圍與草稿。請關閉彈窗（有草稿時需先確認）後再顯示新範圍。</p>}
      {confirmation && (
        <section role="alert" className="shrink-0 border-b border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <h3 className="font-semibold">放棄尚未儲存的變更？</h3>
          <p className="mt-1 text-sm">{confirmation.action === "close" ? "關閉後" : "完整清單重新載入成功後"}，目前的草稿將被移除；已成功儲存的資料不受影響。</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" autoFocus onClick={() => setConfirmation(null)} className={secondaryButton}>繼續編輯</button>
            <button type="button" onClick={discard} className={primaryButton}>放棄變更並{confirmation.action === "close" ? "關閉" : "繼續"}</button>
          </div>
        </section>
      )}
      <form action={formAction} onSubmit={submit} noValidate inert={Boolean(confirmation)} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="mode" value={filter.mode} />
        <input type="hidden" name="changes" value={changesJson} />
        <input type="hidden" name="submissionId" value={draftsId} />
        <div aria-busy={loading} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {error && (
            <div role="alert" className="m-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30">
              <p className="flex items-start gap-2 font-medium"><WarningIcon /><span>{error.message}</span></p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" disabled={busy || loading} onClick={requestReload} className={secondaryButton}>重試載入</button>
                {(error.code === "reauthorize" || (readOnly && error.code === "forbidden")) && <button type="button" disabled={hasDrafts || busy} onClick={() => void reauthorize()} className={primaryButton}>重新授權 Jira</button>}
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
              {data.warnings.map((warning, index) => <p key={index} className="m-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30"><WarningIcon /><span>{warning}</span></p>)}
              {data.issues.length === 0 ? <p role="status" className="p-8 text-center text-sm text-slate-600 dark:text-slate-400">目前沒有待補資料。</p> : (
                <>
                  <div className="hidden overflow-x-auto px-4 sm:px-6 md:block">
                    <table className={`w-full table-fixed text-left text-sm ${kind === "points" ? "min-w-[720px]" : "min-w-[1080px]"}`}>
                      <caption className="sr-only">{kind === "points" ? "Points 缺失 Issue" : "Defect Cause 缺失 Issue"}</caption>
                      <thead className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <tr>
                          {kind === "points" && <th scope="col" className="w-10 py-3"><span className="sr-only">Parent Issue type</span></th>}
                          <th scope="col" className="w-32 px-3 py-3 font-medium">Ticket</th>
                          {readOnly && <th scope="col" className="w-36 px-3 py-3 font-medium">Assignee</th>}
                          <th scope="col" className="px-3 py-3 font-medium">Summary</th>
                          {kind === "points" ? <><th scope="col" className="w-28 px-3 py-3 font-medium">SP</th><th scope="col" className="w-28 px-3 py-3 font-medium">Actual SP</th></> : <><th scope="col" className="w-40 px-3 py-3 font-medium">Root Cause</th><th scope="col" className="w-40 px-3 py-3 font-medium">Solution</th><th scope="col" className="w-44 px-3 py-3 font-medium">Defect Cause</th></>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {data.issues.map((issue) => <tr key={issue.id} className="align-top">
                          {kind === "points" && <td className="py-4 pl-4"><ParentIssueTypeIcon parent={issue.parentIssueType} /></td>}
                          <td className="px-3 py-3"><IssueLink issue={issue} jiraBaseUrl={data.jiraBaseUrl} /></td>
                          {readOnly && <td className="break-words px-3 py-3 text-slate-600 dark:text-slate-300">{issue.assigneeDisplayName || "—"}</td>}
                          <td className="break-words px-3 py-3"><p>{issue.summary}</p><RowNotice issue={issue} error={failureByIssue.get(issue.id)} /></td>
                          {kind === "points" ? (issueFields(issue, "desktop") as React.ReactNode[]).map((field, index) => <td key={index} className="px-3 py-3">{field}</td>) : <><td className="whitespace-pre-wrap break-words px-3 py-3 text-slate-600 dark:text-slate-300">{issue.rootCause || "—"}</td><td className="whitespace-pre-wrap break-words px-3 py-3 text-slate-600 dark:text-slate-300">{issue.solution || "—"}</td><td className="px-3 py-3">{issueFields(issue, "desktop")}</td></>}
                        </tr>)}
                      </tbody>
                    </table>
                  </div>
                  <div className="divide-y divide-slate-200 md:hidden dark:divide-slate-800">
                    {data.issues.map((issue) => <article key={issue.id} className="p-4">
                      <div className="flex items-center gap-2">{kind === "points" && <ParentIssueTypeIcon parent={issue.parentIssueType} />}<IssueLink issue={issue} jiraBaseUrl={data.jiraBaseUrl} /></div>
                      {readOnly && <p className="mt-2 break-words text-xs text-slate-500 dark:text-slate-400">Assignee：{issue.assigneeDisplayName || "—"}</p>}
                      <p className="mt-2 break-words text-sm">{issue.summary}</p>
                      <RowNotice issue={issue} error={failureByIssue.get(issue.id)} />
                      {kind === "defect-cause" && <dl className="mt-4 space-y-3 text-sm"><div><dt className="font-medium">Root Cause</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">{issue.rootCause || "—"}</dd></div><div><dt className="font-medium">Solution</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">{issue.solution || "—"}</dd></div></dl>}
                      <div className={`mt-4 grid gap-4 ${kind === "points" ? "grid-cols-[max-content_max-content]" : "grid-cols-1"}`}>{issueFields(issue, "mobile")}</div>
                    </article>)}
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
        <footer className="shrink-0 space-y-3 border-t border-slate-200 p-4 sm:p-6 dark:border-slate-800">
          {state.message && <p role="status" className="text-sm leading-6">{state.message}</p>}
          {invalid && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{kind === "points" ? "請修正標記的欄位；只接受大於 0 的有限數值。" : "請修正標記的欄位；Defect Cause 至少需選一項有效選項。"}</p>}
          {payloadTooLarge && <p role="alert" className="text-sm">本次變更資料過大，請減少變更筆數後再儲存。</p>}
          {!readOnly && draftLimitReached && <p role="status" className="text-sm">一次最多補填 {MISSING_DATA_PAGE_SIZE} 張 Issue；請先儲存或清除部分草稿。</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || loading} onClick={requestReload} className={secondaryButton}>重新載入</button>
            </div>
            {!readOnly && <div className="flex items-center gap-3">
              <span className="text-xs text-slate-600 dark:text-slate-400">{Object.keys(drafts).length} 張未儲存</span>
              <button type="submit" disabled={!canSubmit} className={primaryButton}>{busy ? "處理中…" : "確認儲存"}</button>
            </div>}
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
  const editable = field === "storyPoints" ? issue.storyPointsEditable : issue.actualStoryPointsEditable
  const id = `${prefix}-${issue.id}-${field}`
  const inputRef = useRef<HTMLInputElement>(null)
  function step(direction: "up" | "down") {
    const input = inputRef.current
    if (!input || disabled) return
    if (direction === "up") input.stepUp()
    else {
      input.stepDown()
      if (!input.value || input.valueAsNumber < 0.1) input.value = "0.1"
    }
    onChange(input.value)
  }
  const value = raw ?? (isMissingPoint(issue[field]) ? "" : String(issue[field]))
  const invalid = raw !== undefined && parsePositivePoints(raw) === null
  const required = field === "storyPoints" ? issue.storyPointsRequired : issue.actualStoryPointsRequired
  const missing = invalid || (required && parsePositivePoints(value) === null)
  const modified = raw !== undefined && parsePositivePoints(raw) !== issue[field]
  return <div>
    <label htmlFor={editable ? id : undefined} className={prefix === "desktop" ? "sr-only" : "mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400"}><span className="sr-only">{issue.key} </span>{label}</label>
    {editable ? <>
      <div className="relative h-[30px] w-20">
        <input ref={inputRef} id={id} type="number" inputMode="decimal" step="1" min="0" value={value} disabled={disabled} placeholder="—" aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); step(event.key === "ArrowUp" ? "up" : "down") } }} className={`h-full w-full appearance-none rounded-md border-[1.5px] bg-slate-50 pl-1.5 pr-5 text-center text-sm tabular-nums outline-none focus:ring-2 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950 ${missing ? "border-red-400 focus:ring-red-200 dark:focus:ring-red-950" : modified ? "border-green-500 focus:ring-green-200 dark:focus:ring-green-950" : "border-black focus:ring-slate-200 dark:border-slate-400 dark:focus:ring-slate-700"}`} />
        <div className="absolute inset-y-[2px] right-[2px] flex w-4 flex-col overflow-hidden rounded-r-sm bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {(["up", "down"] as const).map((direction) => <button key={direction} type="button" disabled={disabled} aria-label={`${issue.key} ${label} ${direction === "up" ? "增加" : "減少"}`} onClick={() => step(direction)} className="flex min-h-0 flex-1 cursor-pointer items-center justify-center hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-700"><svg aria-hidden="true" className="h-2 w-2" viewBox="0 0 8 8" fill="currentColor"><path d={direction === "up" ? "M1 5.5 4 2l3 3.5Z" : "M1 2.5 4 6l3-3.5Z"} /></svg></button>)}
        </div>
      </div>
      {invalid && <p id={`${id}-error`} className="mt-1 text-xs text-red-700 dark:text-red-300">請輸入大於 0 的有限數值。</p>}
    </> : <p title={editable ? undefined : "Jira 欄位無編輯權限"} className="flex h-[30px] w-20 items-center justify-center text-sm tabular-nums text-slate-600 dark:text-slate-300">{isMissingPoint(issue[field]) ? "—" : issue[field]}</p>}
  </div>
}

function DefectCauseInput({ issue, value, disabled, prefix, onChange }: {
  issue: MissingIssue; value: string[]; disabled: boolean; prefix: string; onChange: (value: string[]) => void
}) {
  const id = `${prefix}-${issue.id}-defect-cause`
  const unavailable = !issue.defectCauseEditable || issue.defectCauseOptions.length === 0
  const selected = issue.defectCauseOptions.filter((option) => value.includes(option.id)).map((option) => option.value)
  return <div>
    <span id={`${id}-label`} className="sr-only">{issue.key} Defect Cause（可多選）</span>
    {unavailable ? <p className="text-sm text-slate-600 dark:text-slate-400">{selected.join("、") || "沒有可用選項或無編輯權限"}</p> : <details className="min-w-0 max-w-full overflow-hidden rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950" onToggle={(event) => { if (disabled && event.currentTarget.open) event.currentTarget.open = false }}>
      <summary aria-labelledby={`${id}-label ${id}-value`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onClick={(event) => { if (disabled) event.preventDefault() }} className="min-w-0 cursor-pointer px-3 py-2 text-sm [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-blue-600"><span id={`${id}-value`}>{selected.length ? selected.join("、") : "選擇原因"}</span></summary>
      <fieldset disabled={disabled} className="min-w-0 max-w-full max-h-56 space-y-1 overflow-x-hidden overflow-y-auto overscroll-contain border-t border-slate-200 p-2 dark:border-slate-800">
        <legend className="sr-only">{issue.key} Defect Cause，可選擇多個原因</legend>
        {issue.defectCauseOptions.map((option) => <label key={option.id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md p-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"><input type="checkbox" checked={value.includes(option.id)} onChange={(event) => onChange(event.target.checked ? [...value, option.id] : value.filter((id) => id !== option.id))} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" /><span className="min-w-0 [overflow-wrap:anywhere]">{option.value}</span></label>)}
      </fieldset>
    </details>}
  </div>
}

function IssueLink({ issue, jiraBaseUrl }: { issue: MissingIssue; jiraBaseUrl: string | null }) {
  return jiraBaseUrl ? <a href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(issue.key)}`} target="_blank" rel="noopener noreferrer" aria-label={`在 Jira 開啟 ${issue.key}（另開分頁）`} className="break-words font-medium text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300">{issue.key}</a> : <span className="break-words font-medium">{issue.key}</span>
}

function WarningIcon() {
  return <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 10 18H2Z" /><path d="M12 9v5M12 17h.01" /></svg>
}

function RowNotice({ issue, error }: { issue: MissingIssue; error?: string }) {
  return <>
    {issue.unavailableReason && <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{issue.unavailableReason}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">儲存失敗：{error}</p>}
  </>
}

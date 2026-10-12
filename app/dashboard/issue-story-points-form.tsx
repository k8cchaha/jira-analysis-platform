"use client"

import {
  updateStoryPointsAction,
  type StoryPointsActionState,
} from "@/app/dashboard/actions"
import type { JiraIssueSummary } from "@/lib/jira-issues"
import { useActionState, useMemo, useState } from "react"

interface IssueStoryPointsFormProps {
  issues: JiraIssueSummary[]
  hasMore: boolean
  jiraBaseUrl: string | null
}

type Drafts = Record<string, string>

const initialStoryPointsActionState: StoryPointsActionState = {
  submissionId: null,
  status: "idle",
  message: "",
  succeededIssueIds: [],
  failures: [],
}

export function IssueStoryPointsForm({
  issues,
  hasMore,
  jiraBaseUrl,
}: IssueStoryPointsFormProps) {
  const [drafts, setDrafts] = useState<Drafts>({})
  const [state, formAction, pending] = useActionState(
    updateStoryPointsAction,
    initialStoryPointsActionState
  )
  const succeededIssueIds = state.succeededIssueIds
  const draftsId = useMemo(() => JSON.stringify(drafts), [drafts])
  const visibleDrafts = useMemo(() => {
    if (state.submissionId !== draftsId) return drafts

    const succeeded = new Set(succeededIssueIds)
    return Object.fromEntries(
      Object.entries(drafts).filter(([issueId]) => !succeeded.has(issueId))
    )
  }, [drafts, draftsId, state.submissionId, succeededIssueIds])

  const parsedDrafts = issues.map((issue) => {
    const raw = visibleDrafts[issue.id]
    if (raw === undefined) return { issue, dirty: false as const }

    const parsed = parseStoryPoints(raw)
    if (!parsed.valid) return { issue, dirty: true as const, error: parsed.error }
    if (parsed.value === issue.storyPoints) return { issue, dirty: false as const }

    return { issue, dirty: true as const, value: parsed.value }
  })
  const hasInvalidDraft = parsedDrafts.some((draft) => "error" in draft)
  const changes = parsedDrafts.flatMap((draft) =>
    draft.dirty && "value" in draft
      ? [{ issueId: draft.issue.id, value: draft.value }]
      : []
  )
  const failureByIssue = new Map(
    state.failures.map((failure) => [failure.issueId, failure.message])
  )
  const canSubmit = changes.length > 0 && !hasInvalidDraft && !pending

  function updateDraft(issue: JiraIssueSummary, raw: string) {
    if (!/^\d*(?:\.\d*)?$/.test(raw)) return

    const parsed = parseStoryPoints(raw)
    setDrafts((current) => {
      const base = clearSubmittedDrafts(
        current,
        state.submissionId,
        state.succeededIssueIds
      )
      if (parsed.valid && parsed.value === issue.storyPoints) {
        return removeKey(base, issue.id)
      }
      return { ...base, [issue.id]: raw }
    })
  }

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="changes" value={JSON.stringify(changes)} />
      <input type="hidden" name="submissionId" value={draftsId} />

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <p className="font-medium text-gray-900 dark:text-white">
            共 {issues.length} 筆
          </p>
          {hasMore && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              僅顯示最新 50 筆
            </p>
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
              <tr>
                <th className="px-5 py-3 font-medium">Issue</th>
                <th className="px-4 py-3 font-medium">類型</th>
                <th className="px-4 py-3 font-medium">狀態</th>
                <th className="px-4 py-3 font-medium">優先度</th>
                <th className="px-4 py-3 font-medium">專案</th>
                <th className="px-4 py-3 font-medium">Story Points</th>
                <th className="px-5 py-3 font-medium">建立時間</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {issues.map((issue) => (
                <tr key={issue.id}>
                  <td className="max-w-md px-5 py-4">
                    <IssueLink issue={issue} jiraBaseUrl={jiraBaseUrl} />
                  </td>
                  <td className="px-4 py-4 text-gray-600 dark:text-gray-300">
                    {issue.issueType}
                  </td>
                  <td className="px-4 py-4"><Badge>{issue.status}</Badge></td>
                  <td className="px-4 py-4 text-gray-600 dark:text-gray-300">
                    {issue.priority}
                  </td>
                  <td className="px-4 py-4 text-gray-600 dark:text-gray-300">
                    {issue.project}
                  </td>
                  <td className="w-40 px-4 py-4">
                    <StoryPointsInput
                      issue={issue}
                      rawValue={getRawValue(issue, visibleDrafts)}
                      inputId={`desktop-story-points-${issue.id}`}
                      pending={pending}
                      isModified={Object.prototype.hasOwnProperty.call(
                        visibleDrafts,
                        issue.id
                      )}
                      actionError={failureByIssue.get(issue.id)}
                      onChange={(raw) => updateDraft(issue, raw)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-gray-500 dark:text-gray-400">
                    {formatCreatedDate(issue.created)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-gray-200 md:hidden dark:divide-gray-700">
          {issues.map((issue) => (
            <article key={issue.id} className="p-5">
              <IssueLink issue={issue} jiraBaseUrl={jiraBaseUrl} />
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <IssueDetail label="類型" value={issue.issueType} />
                <IssueDetail label="狀態" value={issue.status} />
                <IssueDetail label="優先度" value={issue.priority} />
                <IssueDetail label="專案" value={issue.project} />
                <IssueDetail
                  label="建立時間"
                  value={formatCreatedDate(issue.created)}
                />
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">
                    Story Points
                  </dt>
                  <dd className="mt-1">
                    <StoryPointsInput
                      issue={issue}
                      rawValue={getRawValue(issue, visibleDrafts)}
                      inputId={`mobile-story-points-${issue.id}`}
                      pending={pending}
                      isModified={Object.prototype.hasOwnProperty.call(
                        visibleDrafts,
                        issue.id
                      )}
                      actionError={failureByIssue.get(issue.id)}
                      onChange={(raw) => updateDraft(issue, raw)}
                    />
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>

        <div className="border-t border-gray-200 px-5 py-5 dark:border-gray-700">
          {state.message && (
            <p
              aria-live="polite"
              className={`mb-3 text-sm ${
                state.status === "success"
                  ? "text-green-700 dark:text-green-400"
                  : state.status === "partial"
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400"
              }`}
            >
              {state.message}
            </p>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full cursor-pointer rounded-xl bg-blue-600 px-5 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-400 sm:w-auto"
          >
            {pending ? "更新中…" : "確認更新"}
          </button>
        </div>
      </section>
    </form>
  )
}

function StoryPointsInput({
  issue,
  rawValue,
  inputId,
  pending,
  isModified,
  actionError,
  onChange,
}: {
  issue: JiraIssueSummary
  rawValue: string
  inputId: string
  pending: boolean
  isModified: boolean
  actionError?: string
  onChange: (raw: string) => void
}) {
  const parsed = parseStoryPoints(rawValue)
  const validationError = parsed.valid ? undefined : parsed.error
  const disabled = !issue.storyPointsSupported || pending
  const description = issue.storyPointsUnavailableReason ?? actionError ?? validationError

  return (
    <div>
      <label htmlFor={inputId} className="sr-only">
        {issue.key} Story Points
      </label>
      <input
        id={inputId}
        type="number"
        min={0}
        step={1}
        inputMode="decimal"
        value={rawValue}
        disabled={disabled}
        aria-invalid={Boolean(validationError)}
        aria-describedby={description ? `${inputId}-description` : undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (rawValue === "" && event.key === "ArrowUp") {
            event.preventDefault()
            onChange("1")
          }
          if (rawValue === "" && event.key === "ArrowDown") {
            event.preventDefault()
            onChange("0")
          }
        }}
        className={`w-full rounded-lg border px-3 py-2 text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:text-white dark:focus:ring-blue-900 dark:disabled:bg-gray-700 ${
          isModified
            ? "border-amber-400 bg-amber-50 ring-2 ring-amber-200 dark:border-amber-500 dark:bg-amber-950/30 dark:ring-amber-900"
            : "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900"
        }`}
        placeholder="—"
      />
      {isModified && !description && (
        <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          已修改，尚未儲存
        </p>
      )}
      {description && (
        <p
          id={`${inputId}-description`}
          className={`mt-1 text-xs ${
            actionError || validationError
              ? "text-red-600 dark:text-red-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {description}
        </p>
      )}
    </div>
  )
}

function parseStoryPoints(raw: string):
  | { valid: true; value: number | null }
  | { valid: false; error: string } {
  if (raw === "") return { valid: true, value: null }
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) {
    return { valid: false, error: "請輸入零或正數" }
  }

  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    return { valid: false, error: "請輸入有限的零或正數" }
  }
  return { valid: true, value }
}

function getRawValue(issue: JiraIssueSummary, drafts: Drafts) {
  return drafts[issue.id] ?? (issue.storyPoints === null ? "" : String(issue.storyPoints))
}

function clearSubmittedDrafts(
  drafts: Drafts,
  submissionId: string | null,
  succeededIssueIds: string[]
) {
  if (submissionId !== JSON.stringify(drafts)) return drafts

  const succeeded = new Set(succeededIssueIds)
  return Object.fromEntries(
    Object.entries(drafts).filter(([issueId]) => !succeeded.has(issueId))
  )
}

function removeKey(values: Drafts, key: string) {
  const next = { ...values }
  delete next[key]
  return next
}

function IssueLink({
  issue,
  jiraBaseUrl,
}: {
  issue: JiraIssueSummary
  jiraBaseUrl: string | null
}) {
  const content = (
    <>
      <span className="block text-xs font-semibold text-blue-600 dark:text-blue-400">
        {issue.key}
      </span>
      <span className="mt-1 block font-medium text-gray-900 dark:text-white">
        {issue.summary}
      </span>
    </>
  )

  if (!jiraBaseUrl) return <div>{content}</div>

  return (
    <a
      href={`${jiraBaseUrl}/browse/${encodeURIComponent(issue.key)}`}
      target="_blank"
      rel="noreferrer"
      className="cursor-pointer hover:underline"
      aria-label={`在 Jira 開啟 ${issue.key}: ${issue.summary}`}
    >
      {content}
    </a>
  )
}

function Badge({ children }: { children: string }) {
  return (
    <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
      {children}
    </span>
  )
}

function IssueDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 text-gray-800 dark:text-gray-200">{value}</dd>
    </div>
  )
}

function formatCreatedDate(value: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(date)
}

"use server"

import { auth } from "@/auth"
import {
  JiraStoryPointsError,
  updateJiraStoryPoints,
  type StoryPointsChange,
} from "@/lib/jira-story-points"
import { JiraAuthorizationError } from "@/lib/jira-token"
import { refresh } from "next/cache"

const MAX_CHANGES = 50
const MAX_PAYLOAD_LENGTH = 10_000
const JIRA_ISSUE_ID_PATTERN = /^\d{1,30}$/

export interface StoryPointsActionState {
  submissionId: string | null
  status: "idle" | "success" | "partial" | "error"
  message: string
  succeededIssueIds: string[]
  failures: Array<{ issueId: string; message: string }>
}

export async function updateStoryPointsAction(
  _previousState: StoryPointsActionState,
  formData: FormData
): Promise<StoryPointsActionState> {
  const submissionId = getSubmissionId(formData.get("submissionId"))
  const session = await auth()
  if (!session?.user?.id) {
    return errorState(submissionId, "登入狀態已失效，請重新登入後再試。")
  }

  const parsed = parseChanges(formData.get("changes"))
  if ("error" in parsed) return errorState(submissionId, parsed.error)

  try {
    const result = await updateJiraStoryPoints(parsed.changes)
    if (result.succeededIssueIds.length > 0) refresh()

    if (result.failures.length === 0) {
      return {
        submissionId,
        status: "success",
        message: `已完成 ${result.succeededIssueIds.length} 張 Issue 的更新。`,
        succeededIssueIds: result.succeededIssueIds,
        failures: [],
      }
    }

    if (result.succeededIssueIds.length > 0) {
      return {
        submissionId,
        status: "partial",
        message: `已完成 ${result.succeededIssueIds.length} 張，另有 ${result.failures.length} 張未更新。`,
        succeededIssueIds: result.succeededIssueIds,
        failures: result.failures,
      }
    }

    return {
      submissionId,
      status: "error",
      message: "所有變更都未能更新，請查看各 Issue 的提示。",
      succeededIssueIds: [],
      failures: result.failures,
    }
  } catch (error) {
    if (error instanceof JiraAuthorizationError) {
      return errorState(submissionId, "Jira 授權已失效，請重新登入後再試。")
    }
    if (error instanceof JiraStoryPointsError) {
      return errorState(submissionId, getJiraErrorMessage(error.code))
    }
    console.error("Unexpected Story Points batch update failure")
    return errorState(submissionId, "更新時發生未預期的錯誤，請稍後再試。")
  }
}

function parseChanges(value: FormDataEntryValue | null):
  | { changes: StoryPointsChange[] }
  | { error: string } {
  if (typeof value !== "string" || value.length === 0) {
    return { error: "沒有可送出的變更。" }
  }
  if (value.length > MAX_PAYLOAD_LENGTH) {
    return { error: "送出的變更資料過大。" }
  }

  let data: unknown
  try {
    data = JSON.parse(value)
  } catch {
    return { error: "變更資料格式錯誤。" }
  }

  if (!Array.isArray(data) || data.length === 0 || data.length > MAX_CHANGES) {
    return { error: "一次必須更新 1 到 50 張 Issue。" }
  }

  const seen = new Set<string>()
  const changes: StoryPointsChange[] = []
  for (const item of data) {
    if (!isRecord(item)) return { error: "變更資料格式錯誤。" }

    const issueId = item.issueId
    const storyPoints = item.value
    if (typeof issueId !== "string" || !JIRA_ISSUE_ID_PATTERN.test(issueId)) {
      return { error: "Issue ID 格式錯誤。" }
    }
    if (seen.has(issueId)) return { error: "變更資料包含重複的 Issue。" }
    if (
      storyPoints !== null &&
      (typeof storyPoints !== "number" ||
        !Number.isFinite(storyPoints) ||
        storyPoints < 0)
    ) {
      return { error: "Story Points 必須是零或正數。" }
    }

    seen.add(issueId)
    changes.push({ issueId, value: storyPoints })
  }

  return { changes }
}

function getSubmissionId(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.length <= 100 ? value : null
}

function getJiraErrorMessage(code: JiraStoryPointsError["code"]) {
  if (code === "reauthorization_required") {
    return "Jira 授權已失效，請重新登入後再試。"
  }
  if (code === "forbidden") return "目前沒有權限更新 Jira Issues。"
  if (code === "rate_limited") return "Jira 請求過於頻繁，請稍後再試。"
  return "Jira 暫時無法完成更新，請稍後再試。"
}

function errorState(
  submissionId: string | null,
  message: string
): StoryPointsActionState {
  return {
    submissionId,
    status: "error",
    message,
    succeededIssueIds: [],
    failures: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

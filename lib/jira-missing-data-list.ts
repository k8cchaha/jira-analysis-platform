import { MISSING_DATA_LIMIT, MISSING_DATA_PAGE_SIZE, type MissingDataError, type MissingDataPage, type MissingDataPageResult, type MissingIssue } from "./jira-missing-data.ts"

export type MissingDataList = Pick<MissingDataPage, "readOnly" | "issues" | "jiraBaseUrl" | "warnings">

export class MissingDataListError extends Error {
  readonly detail: MissingDataError

  constructor(detail: MissingDataError) {
    super(detail.message)
    this.name = "MissingDataListError"
    this.detail = detail
  }
}

function incompleteList(): never {
  throw new MissingDataListError({ code: "retry", message: "明細資料不完整，請重新載入。" })
}

/** Jira stays paginated internally; only a complete list is accepted by the dialog. */
export async function loadMissingDataList(
  readPage: (token: string | null) => Promise<MissingDataPageResult>,
  signal: AbortSignal
): Promise<MissingDataList> {
  const issues: MissingIssue[] = []
  const ids = new Set<string>()
  const tokens = new Set<string>()
  const warnings = new Set<string>()
  let first: MissingDataPage | null = null
  let token: string | null = null
  const maxPages = MISSING_DATA_LIMIT / MISSING_DATA_PAGE_SIZE

  for (let page = 1; page <= maxPages; page += 1) {
    signal.throwIfAborted()
    const result = await readPage(token)
    signal.throwIfAborted()
    if (result?.status === "error") throw new MissingDataListError(result.error)
    if (result?.status !== "success" || !result.data) incompleteList()
    const data = result.data
    if (data.page !== page || typeof data.readOnly !== "boolean" ||
      !(data.jiraBaseUrl === null || typeof data.jiraBaseUrl === "string") ||
      !Array.isArray(data.issues) || data.issues.length > MISSING_DATA_PAGE_SIZE ||
      !Array.isArray(data.warnings) || data.warnings.some((warning) => typeof warning !== "string") ||
      !(data.nextPageToken === null || (typeof data.nextPageToken === "string" && data.nextPageToken.length > 0 && data.nextPageToken.length <= 250_000))) incompleteList()
    if (first && (data.readOnly !== first.readOnly || data.jiraBaseUrl !== first.jiraBaseUrl)) incompleteList()
    first ??= data
    for (const issue of data.issues) {
      if (!issue || typeof issue.id !== "string" || !/^\d{1,30}$/.test(issue.id) || ids.has(issue.id) ||
        typeof issue.storyPointsRequired !== "boolean" || typeof issue.actualStoryPointsRequired !== "boolean") incompleteList()
      ids.add(issue.id)
      issues.push(issue)
    }
    for (const warning of data.warnings) warnings.add(warning)
    if (data.nextPageToken === null) {
      return { readOnly: first.readOnly, issues, jiraBaseUrl: first.jiraBaseUrl, warnings: [...warnings] }
    }
    if (tokens.has(data.nextPageToken)) incompleteList()
    tokens.add(data.nextPageToken)
    token = data.nextPageToken
  }
  throw new MissingDataListError({ code: "limit", message: "明細超過可完整讀取的範圍，請縮小篩選範圍。" })
}

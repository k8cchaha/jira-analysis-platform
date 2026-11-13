/** Jira navigation href only; JQL comes from the named definitions in `jira-jql.ts`. */
export function jiraSearchHref(jiraBaseUrl: string, jql: string): string {
  const base = jiraBaseUrl.replace(/\/$/, "")
  return `${base}/issues/?jql=${encodeURIComponent(jql)}`
}

/** Browse an issue at the caller-provided Jira base URL, encoding its key as one path segment. */
export function jiraIssueHref(jiraBaseUrl: string, issueKey: string): string {
  const base = jiraBaseUrl.replace(/\/$/, "")
  return `${base}/browse/${encodeURIComponent(issueKey)}`
}

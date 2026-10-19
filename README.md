# Jira Analysis Platform

Next.js application that uses Atlassian OAuth 2.0 (3LO) for both application login and Jira Cloud API access.

## Requirements

- Node.js 20.9 or newer
- An Atlassian developer app with OAuth 2.0 (3LO)
- Access to the configured Jira Cloud site

No application database is required. Auth.js stores the signed-in user's minimal Atlassian credentials in an encrypted, HttpOnly session cookie. Browser JavaScript cannot read the cookie or OAuth tokens.

## Atlassian configuration

In the [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/), configure this callback URL for local development:

```text
http://localhost:3000/api/auth/callback/atlassian
```

Use the exact production origin when deploying, for example:

```text
https://your-app.example.com/api/auth/callback/atlassian
```

Enable these OAuth scopes:

```text
read:me
read:jira-work
read:jira-user
read:group:jira
read:user:jira
read:avatar:jira
read:issue:jira
write:jira-work
offline_access
```

Copy `.env.example` to `.env.local`, then set the Auth.js secret, Atlassian client credentials, and target Jira Cloud URL. Never commit `.env.local` or real credentials.

## Local setup

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the origin configured in `AUTH_URL`. The Jira login button performs one Atlassian authorization flow that creates an encrypted JWT session and grants Jira API access.

After login, `/dashboard` is the personal summary landing page. The application shell exposes the complete planned navigation; unfinished destinations are explicit development-in-progress pages rather than simulated features.

The working Issue editor is available at `/issues/assigned/list` and shows up to the latest 50 issues returned by:

```jql
assignee = currentUser() AND created >= -30d ORDER BY created DESC
```

The Assigned Issues page uses Jira field `customfield_10005` for Story Points. You can edit non-negative integer or decimal values, clear a value, and submit only the issues that changed. In JQL this field can also be referenced as `cf[10005]`; Jira REST request and response bodies use `customfield_10005`.

Custom field mappings are centralized in `lib/jira-fields.ts`: Story Points and Actual Story Points have fixed IDs; Defect Cause, Root Cause, and Solution are resolved from Jira metadata by name and required schema. Both the Assigned Issues editor and dashboard use these shared definitions. Project-scoped resolution and per-issue edit permissions/options are still checked at runtime. Complete queries and query builders are centralized separately in `lib/jira-jql.ts`.

Reading issues requires `read:jira-work`; saving fields also requires `write:jira-work`.

## Jira 開發規則：欄位與 JQL 分工

**所有人與 AI 開發工具都必須遵循 [AGENTS.md](AGENTS.md) 的開發規則。** 使用 AI 工具時，先確認工具已載入該檔案；不會自動讀取 `AGENTS.md` 的工具，請明確將它提供為專案指引。`CLAUDE.md` 已透過 `@AGENTS.md` 引入相同規則，不另維護一份重複規則。

核心原則：**欄位是什麼，定義在 `jira-fields.ts`；要查哪些 Issue，定義在 `jira-jql.ts`；如何安全讀寫 Jira，留在 server service。**

| 責任 | 唯一管理位置 | 不應放入的內容 |
| --- | --- | --- |
| Custom field REST ID、名稱、schema、欄位級 JQL 引用與共用 helpers | [`lib/jira-fields.ts`](lib/jira-fields.ts) | 完整 JQL、功能查詢條件、HTTP 或登入處理 |
| 完整固定 JQL 與動態組合：assignee、project、日期、排序、更新資格的 Issue ID 限制 | [`lib/jira-jql.ts`](lib/jira-jql.ts) | Token、session、環境變數、Jira HTTP、server-only 依賴 |
| 授權、Filter 範圍解析、欄位 metadata discovery、分頁、DTO、寫入驗證 | 各 Jira server service | 另行定義或拼接 JQL、重複 custom-field mapping |
| UI／API 使用查詢 | 引用 `jira-jql.ts` 的具名 constant／builder | 複製查詢文字或自行追加條件；接受任意 client JQL |

`jira-fields.ts` 中的 `jql` 屬性只是**欄位引用**，不是完整查詢；沒有固定 ID 的欄位仍由 service 依 metadata 名稱與 schema 解析，不可猜測 ID。

### 正確的引用方式

以下是現有引用方式的示意，不是另一份查詢定義。Custom field JQL 必須從欄位管理檔取得，不能再硬寫一份 `cf[...]` 或欄位名稱：

```ts
// lib/jira-jql.ts：引用欄位定義，再於此檔組合完整查詢。
import { JIRA_FIELDS, customFieldJql } from "./jira-fields.ts"

const storyPointsJql = customFieldJql(JIRA_FIELDS.storyPoints.id)
const defectCauseJql = JIRA_FIELDS.defectCause.jql
```

```ts
// Server service：使用集中管理的完整查詢，不自行拼接字串。
import { dashboardAlertJql } from "@/lib/jira-jql"

const jql = dashboardAlertJql("overdue", scope) // scope 已由 server 驗證及解析
```

頁面若要顯示查詢文字，也應直接使用匯入的 constant，例如 `RECENT_ASSIGNED_ISSUES_JQL`。既有功能模組可以保留相容性 re-export，但不能在原檔案重新定義查詢；新功能直接從兩個管理檔匯入。

### 新增或修改功能時

1. **欄位 ID／名稱／schema 改變：**修改 `jira-fields.ts`，保留 service 的 runtime discovery 與 schema／權限檢查。
2. **查詢條件改變：**修改 `jira-jql.ts`，包括動態條件、排序與更新資格查詢；service、route、page 只使用具名匯出，不在外部做 JQL concatenation／replace。
3. **讀寫流程改變：**修改對應 server service；`jira-jql.ts` 維持純常數／函式，type-only 相依使用 `import type`。
4. **保留安全與範圍：**不可移除 server 驗證、專案交集、群組完整分頁／排除／去重、查詢長度限制，或放寬更新資格與 Issue ID 限制。集中管理不取代授權、原值比對與 Jira 編輯權限檢查。
5. **同步維護文件與測試預期：**測試可保留查詢 literal 作為預期值、合成欄位 fixtures；文件可展示查詢，但兩者都不是 production 的第二份定義。依使用者授權執行驗證，未執行必須說明。

Dashboard 的 **指定人／團隊・專案**模式，所有查詢都加上 `created >= -Nd`（預設 30 天）；**自己**不加這個近 N 天條件，但保留原始 JQL 自帶的 `updated`／`duedate` 等條件。這個例外不影響「指派給我的 Issues」頁面本來固定的 30 天查詢。Counts 與明細共用 builder；補填更新維持本人原始資格範圍並與提交的 Issue IDs 取交集。

以上是 repository 文件規則，並非新增 CI／hook 的自動強制檢查。

## Dashboard alerts

The first dashboard row shows exact, independently loaded Bug, due-reminder and pending-Issue counts. All six queries are defined in `lib/jira-jql.ts` and use the applied filter's assignee: `currentUser()` for self, a server-verified account ID for person, or the resolved and deduplicated included members for team. Selected projects intersect the base query. In person/team modes, **近 N 天** adds `created >= -Nd` to every query; self does not add this condition. The explicit `updated` and `duedate` conditions below still apply. Due dates use Jira's `startOfDay()` boundaries: overdue is before today; upcoming includes today until, but not including, the start of the day three days ahead. Both due queries restrict status to the `To Do` category or `In Progress` / `In Review`, without an issue-type restriction.

| Check | Base JQL (before assignee, nonself created-date and project conditions) |
| --- | --- |
| S0／S1 | `project in (sun, tkk, jiratry, pride) and issuetype = "Bug" AND priority IN ("Critical (P0)", "High (P1)") AND (statusCategory = "To Do" or status = "In Progress")` |
| S2 超過10天未更新 | `project in (sun, tkk, jiratry, pride) and issuetype = "Bug" AND priority IN ("Medium (P2)") AND (statusCategory = "To Do" or status = "In Progress") and updated < -10d` |
| In Review | `issuetype in (DEV-Task, QA-Task) and status = "In Review"` |
| Request Info | `status = "Request Info"` |
| 已逾期 | `duedate < startOfDay() AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))` |
| 即將到期 | `duedate >= startOfDay() AND duedate < startOfDay("+3d") AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))` |

Bug, due-reminder and pending-Issue borders are green when both totals are zero; positive totals use red, amber and blue borders respectively. Both missing-data cards retain neutral borders. Loading and failed queries retain neutral borders and never imply zero. All three alert cards are read-only; successfully loaded positive totals open their detail dialogs:

- **Bug:** S0/S1 first, a divider, then S2 stale for more than ten days. Columns are Ticket (external Jira link), Priority, Summary, Status and complete 24-hour days since the last update.
- **Due reminders:** overdue first, a divider, then upcoming. Columns are Ticket, Issue Type, Summary, Status, optional Assignee and 逾期日. The last column shows calendar days overdue or until due, using browser-local today; overdue values are red, today is `0 天`, and the Jira due date remains in the tooltip. Jira JQL determines the group, which may use a different timezone from the browser.
- **Pending Issues:** In Review first, a divider, then Request Info. Columns are Ticket, Issue Type, Summary, Status, optional Assignee and 停留日數. This is the browser-local calendar-day difference between Updated and today, not time since entering the status; updated today is `0 天`, and future dates show `—`.

Due and pending Issue Type text is purple for Epic, green for Story, red for Bug/QA-Task, blue for Task/DEV-Task, and neutral for other types. Their `In Progress` / `In Review` statuses use blue text. All three dialogs show Assignee only for nonself filters, retain the opening filter, have no visible pagination and offer no editing or save controls.

Each group resolves its scope once and runs at most two count searches concurrently, with sequential pagination per query, a 5,000-issue cap and at most 100 search pages. No approximate-count API is used. Errors do not publish partial group counts. Separate Jira searches are not an atomic snapshot. The client rejects malformed counts and obsolete filter responses.

## Dashboard missing-data completion

`/dashboard` shows two independently loaded, exact missing-data counts. The top filter uses three radio modes: **自己** (default), **指定人**, and **團隊／專案**. Selecting **自己** immediately applies the self scope; if the displayed data is already self-scoped, selecting it again does not reload. **指定人** and **團隊／專案** draft changes only apply after Query. Applied state is encoded in a canonical URL, including repeated group/project/exclusion parameters. Browser history and reload restore the applied scope. Optional remembered team/project selections are per-viewer browser conveniences, not authoritative membership or permissions. Person names are not stored in browser preferences; an applied person scope is restored only from the URL.

- **自己:** both queries below remain date-free; only scope radios are shown, with no days control or Query button. Missing values can be filled and existing Points values can be adjusted on still-missing issues in the dialog, subject to Jira edit permissions.
- **指定人:** search the Jira display name, prefer exact matches, and select an account when multiple candidates exist. The server verifies the account ID. No project restrictions from team mode carry over.
- **團隊／專案:** select configured Jira groups, optionally exclude individual members per group, and optionally intersect projects. Groups are unioned and deduplicated by account ID; exclusion in one group does not remove an inclusion from another. At least one group and included member are required; no selected project means no additional project restriction. Static group/project choices are in `lib/jira-dashboard-filter.ts`, matching `dev-type-chart`.

Days defaults to **30**, shown only outside self mode. Both nonself missing-data queries add `created >= -Nd`, just like every dashboard alert query; Points does not use a historical Done-transition condition. These conditions are composed in `lib/jira-jql.ts` and evaluated by Jira. Selected projects intersect the original scope, so Pride-only has no SUN/TKK/JIRATRY Defect Cause results. **All nonself dialogs are read-only**, even when the selected person is the viewer; they do not request editing metadata or expose Save. The mutation service still authorizes only the current user's original date-free missing-data scope. No Jira credentials are sent to browser JavaScript.

Group lookup requires the three granular read scopes listed above (`read:group:jira`, `read:user:jira`, `read:avatar:jira`) and Jira's **Browse users and groups** or **Administer Jira** permission. Enable those scopes in the Atlassian Developer Console and have existing users reauthorize; adding scopes in code does not update an existing grant or grant Jira permissions. No broad `manage:jira-configuration` scope is requested. HTTP 403 is displayed as a permission error, never interpreted as an empty group.

The server fully resolves membership on each read, with bounded concurrency and explicit limits (1,000 included users, 100 group pages, 16 KiB filter URL and 32 KiB JQL). Incomplete pagination, oversized selections and lookup failures produce errors rather than partial populations. Changed group membership or filter scope invalidates old encrypted page tokens; reload the first page. Counts and dialogs are point-in-time reads, not a frozen issue dataset. An open dialog retains its original scope and drafts during dashboard URL changes; close it explicitly before the new scope appears.

- **Missing Points:** your DEV-Task / QA-Task issues, without a date restriction, with resolution empty, `Done`, or `Fixed` across all projects. Actual Story Points (`customfield_13736`) being empty or zero qualifies when status is `Done`; Story Points (`customfield_10005`) being empty or zero qualifies when status category is not `To Do`. These missing-value rules apply **in this completion workflow only**. The headline counts unique issues matching either branch. In self mode, either numeric field can be adjusted on a still-missing issue if Jira permits editing, including a field that already has a positive value. Submitted replacements must remain positive finite numbers; this workflow does not allow clearing or writing zero.

```jql
issuetype in (DEV-Task, QA-Task) and resolution in (EMPTY, Done, Fixed) and ((status = Done and cf[13736] in (EMPTY, 0)) or (statusCategory not in ("To Do") and cf[10005] in (EMPTY, 0))) and assignee = currentUser()
```

- **Missing Defect Cause:** uses the following fixed query. Its dialog shows the Jira issue link, summary, read-only Root Cause / Solution, and a multi-select populated from that issue's current editable Defect Cause options.

```jql
project in (sun, tkk, jiratry) and issuetype = bug and assignee = currentUser() and statusCategory != "To Do" and status not in ("In Progress", "Dev Ready") and resolution in (EMPTY, Done, Fixed) and "Defect Cause[Select List (multiple choices)]" is EMPTY
```

Nonself detail dialogs display the assignee's display name; self dialogs omit it. Only the Points dialog displays the actual parent Issue type, with explicit neutral fallbacks when parent metadata is absent or unavailable. Only the display name and parent type name are projected to the client, not raw user profiles or external icon URLs. The modal header badge is the loaded Issue count, not a day window.

Counts require complete Jira pagination and stop with an explicit error above 5,000 source issues or when data is incomplete. Dialogs automatically read all result batches and display one scrollable list without pagination controls. If any batch fails, the incomplete replacement is rejected and existing drafts are retained. Each save is limited to 50 changed issues and the existing payload-size bound; save or clear drafts before editing further issues. Application pagination tokens are encrypted, bound to the user/site/query, and expire after 15 minutes. Missing or ambiguous custom-field metadata is surfaced rather than treated as a zero count.

Updates recheck issue eligibility, current values, edit permissions, and allowed option IDs on the server, and preserve failed drafts on partial success. Points updates require the issue to remain in the current user's date-free status-dependent missing-value union when reread. Status metadata is validated, and list/count/live-update checks apply the same independent SP/Actual branches. Filling SP on a non-Done issue removes it from the list even if Actual remains empty; filling SP on a Done issue retains it while Actual is still missing. Every submitted numeric field must match its expected original value exactly, including existing positive values; a changed original or a fully completed issue is rejected without a PUT. All submitted fields are validated before a field-only write. Already-filled Defect Cause values remain protected from overwrite. Jira's read-then-write API does not provide an atomic guarantee against another edit made simultaneously after these checks.

Focused offline tests (Node.js 24, no live Jira writes):

```bash
node --experimental-strip-types --test tests/*.test.mjs
```

## Session storage

Auth.js encrypts the JWT session with `AUTH_SECRET` and stores it in its default HttpOnly cookie. The encrypted session contains the minimum Jira credentials needed by server-side requests; `/api/auth/session`, React client props, and local storage never receive the OAuth tokens.

Keep `AUTH_SECRET` stable and identical across all production instances. Changing it, clearing browser cookies, or signing out requires the user to authorize Atlassian again. Stateless sessions cannot be centrally revoked before expiry; revoke the Atlassian app authorization when immediate credential revocation is required.

## Vercel deployment

Set these environment variables in Vercel:

```text
AUTH_SECRET
AUTH_URL
AUTH_ATLASSIAN_ID
AUTH_ATLASSIAN_SECRET
ATLASSIAN_JIRA_CLOUD_URL
```

Set `AUTH_URL` to the stable production origin and register its exact callback URL in the Atlassian Developer Console. Preview deployments require their own registered callback strategy.

## Validation

```bash
npx tsc --noEmit
npm run lint
npm run build
```


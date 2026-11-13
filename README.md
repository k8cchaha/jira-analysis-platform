# Jira Analysis Platform

Next.js application that uses Atlassian OAuth 2.0 (3LO) for both application login and Jira Cloud API access.

## 功能說明文件

從 [功能總覽](docs/README.md) 查看各頁的目的、解決的問題、Insight 與實作狀態。各功能的指標、使用方式及限制整理在 [`docs/features/`](docs/features/)；JQL、REST API、欄位與日期口徑集中於 [Jira 技術參考](docs/jira-reference.md)。新增文件可使用 [功能頁模板](docs/feature-template.md)。

## 帳號選單

點擊右上角頭像可開啟帳號選單，依序顯示帶設定圖示的「預設值設定」、分隔線，以及帶圖示的紅色「登出」。原本頁首的獨立登出按鈕已移入此選單。選單支援鍵盤操作、Escape 與點擊外部關閉；如有未儲存變更，登出前會先確認是否離開，取消不會登出。

「預設值設定」彈窗可設定一個專案（可清除）與多個整組團隊，按「儲存」才保存；取消不保存，未儲存變更關閉前須確認放棄。資料僅以 localStorage 保存於同一瀏覽器，依登入帳號隔離，不跨裝置同步，也不保存團隊成員或憑證。

預設值只在之後進入相容頁面時帶入尚未指定的條件，不覆蓋 URL、使用者操作或儀表板既有記憶草稿，儲存當下不重設目前篩選。儀表板仍預設「自己」；工作量、專案回顧與團隊分析不自動執行查詢。Planning、Burn Down、Capacity 帶入專案後沿用原本自動解析 Sprint／載入的行為。詳見 [預設值設定](docs/filter-defaults.md)。

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

After login, `/dashboard` is the personal summary landing page. The application shell's visible navigation depends on the signed-in user's configuration; hiding a destination is not server-side API authorization. The current application has 12 product page routes (11 main-navigation destinations plus the supplemental `/settings/jira` page), documented in the [feature and route overview](docs/README.md#功能總覽). Dashboard, Planning, Burn Down, workload analysis and Sprint project review have active Jira data flows; Capacity is a mock demonstration, and Team analysis, report and settings capabilities remain partial or ComingSoon. Project review, trends and comparison share `/analytics/projects`; the former trends/comparison URLs redirect there and are not separate pages.

The former `/issues/assigned/list` route is not present in the current application. Its Story Points service and fixed recent-assignee query remain in the library, but are not a working editor:

```jql
assignee = currentUser() AND created >= -30d ORDER BY created DESC
```

See [Assigned Issues — retained legacy service](docs/features/legacy-assigned-issues.md). Its former non-negative/clear-value behavior must not be confused with the active Dashboard supplementation workflow, which requires positive submitted point values.

Custom field mappings are centralized in `lib/jira-fields.ts`: Story Points, Actual Story Points, Dev Type, Impact Scope (`customfield_14848`) and Release Package (`customfield_13476`) have fixed IDs; Defect Cause, Root Cause, and Solution are resolved from Jira metadata by name and required schema. The Dashboard and retained legacy Assigned Issues service use these shared definitions. Project-scoped resolution and per-issue edit permissions/options are still checked at runtime. Complete queries and query builders are centralized separately in `lib/jira-jql.ts`.

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

Dashboard 的 **指定人／團隊・專案**模式，所有查詢都加上 `created >= -Nd`（預設 30 天）；**自己**不加這個近 N 天條件，但保留原始 JQL 自帶的 `updated`／`duedate` 等條件。這個例外不影響保留的舊「指派給我的 Issues」查詢本來固定的 30 天條件；目前沒有該頁面路由。Counts 與明細共用 builder；補填更新維持本人原始資格範圍並與提交的 Issue IDs 取交集。

以上是 repository 文件規則，並非新增 CI／hook 的自動強制檢查。

## Dashboard alerts

The first dashboard row shows exact, independently loaded Bug, due-reminder and pending-Issue counts. All six queries are defined in `lib/jira-jql.ts` and use the applied filter's assignee: `currentUser()` for self, a server-verified account ID for person, or the resolved and deduplicated included members for team. Selected projects intersect the base query. In person/team modes, **近 N 天** adds `created >= -Nd` to every query; self does not add this condition. The explicit `updated` and `duedate` conditions below still apply. Due dates use Jira's `startOfDay()` boundaries: overdue is before today; upcoming includes today until, but not including, the start of the day three days ahead. Both due queries restrict status to the `To Do` category or `In Progress` / `In Review`, without an issue-type restriction.

| Check | Base JQL (before assignee, nonself created-date and project conditions) |
| --- | --- |
| S0／S1 | `issuetype = "Bug" AND priority IN ("Critical (P0)", "High (P1)") AND (statusCategory = "To Do" or status = "In Progress")` |
| S2 超過10天未更新 | `issuetype = "Bug" AND priority IN ("Medium (P2)") AND (statusCategory = "To Do" or status = "In Progress") and updated < -10d` |
| In Review | `status = "In Review"` |
| Request Info | `status = "Request Info"` |
| 已逾期 | `duedate < startOfDay() AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))` |
| 即將到期 | `duedate >= startOfDay() AND duedate < startOfDay("+3d") AND (statusCategory = "To Do" or status in ("In Progress", "In Review"))` |

Bug, due-reminder and pending-Issue borders are green when both totals are zero; positive totals use red, amber and blue borders respectively. All three missing-data cards retain neutral borders. Loading and failed queries retain neutral borders and never imply zero. All three alert cards are read-only; successfully loaded positive totals open their detail dialogs:

- **Bug:** S0/S1 first, a divider, then S2 stale for more than ten days. Columns are Ticket (external Jira link), Priority, Summary, Status and complete 24-hour days since the last update.
- **Due reminders:** overdue first, a divider, then upcoming. Columns are Ticket, Issue Type, Summary, Status, optional Assignee and 逾期日. The last column shows calendar days overdue or until due, using browser-local today; overdue values are red, today is `0 天`, and the Jira due date remains in the tooltip. Jira JQL determines the group, which may use a different timezone from the browser.
- **Pending Issues:** In Review first, a divider, then Request Info. Columns are Ticket, Issue Type, Summary, Status, optional Assignee and 停留日數. This is the browser-local calendar-day difference between Updated and today, not time since entering the status; updated today is `0 天`, and future dates show `—`.

Due and pending Issue Type text is purple for Epic, green for Story, red for Bug/QA-Task, blue for Task/DEV-Task, and neutral for other types. Their `In Progress` / `In Review` statuses use blue text. All three dialogs show Assignee only for nonself filters, retain the opening filter, have no visible pagination and offer no editing or save controls.

Each group resolves its scope once and runs at most two count searches concurrently, with sequential pagination per query, a 5,000-issue cap and at most 100 search pages. No approximate-count API is used. Errors do not publish partial group counts. Separate Jira searches are not an atomic snapshot. The client rejects malformed counts and obsolete filter responses.

### Impact Scope 缺失

The missing-data row is ordered **(Actual) Story Points 缺失 → Defect Cause 缺失 → Impact Scope 缺失**, with three columns on large screens and stacked cards on narrow screens. The Impact Scope card independently loads an exact count and opens complete details (Ticket, Summary, Status, Impact Scope, plus Assignee in nonself modes). Self mode can supplement an empty Impact Scope field using issue-specific Jira options; person/team modes remain **read-only**. Standard single-/multi-select types are discovered at runtime, not assumed. Unsupported metadata, unavailable options or missing edit permissions never enable saving.

Its centralized base query is `project = sun and issuetype in (story, task, bug) and cf[14848] is EMPTY and (created >= "2026-11-01" or cf[13476] = "Sprint9") and cf[13476] is not EMPTY`. There is no status/status-category exclusion, so To Do issues are also eligible. Status displays Jira's current status name (or `—` when unavailable), using the shared `statusColorClass` palette on desktop and mobile: In Progress/In Review blue, Done green, and other/unknown statuses neutral. The parenthesized OR selects issues created on/after 2026-11-01 or in Release Package Sprint9; both branches additionally require a nonempty Release Package, and neither branch bypasses the other base conditions or Dashboard scope. Dashboard assignee restrictions and nonself `created >= -Nd` still apply as described above; self keeps the fixed-date/release condition but adds no near-N window. Selected projects intersect, rather than replace, SUN. Counts and details share `missingDataListJql`; the exact count remains independent of field/edit metadata. Details resolve the fixed field ID and applicable schema; self additionally reads each issue's edit metadata for its enabled options and `set` permission, while nonself uses search-returned values without edit metadata. Updates intersect the original self eligibility query with submitted issue IDs, then recheck the empty live value, schema, permission and allowed option IDs before a field-only PUT. Populated values are never intentionally overwritten or cleared; separate Jira GET/PUT requests are not atomic. The shared editor retains drafts on partial failure, protects unsaved navigation/closing, and refreshes the count after successful supplementation. Existing Points and Defect Cause supplementation remains unchanged.

## Analysis navigation

The Analysis menu is ordered as 工作量分析 → 專案回顧與趨勢 → 團隊分析. 團隊分析 keeps its group icon and `/analytics/story-points`; Capacity keeps its person-with-clock icon for available staffing and work hours. 專案回顧與趨勢 uses the History icon and `/analytics/projects`, consolidating project review, cross-Sprint trends and same-condition comparisons. Projects provides **readonly Sprint analytics**, while Team analysis receives the calendar-date filters and remains **partially implemented, with results ComingSoon**. Workload and Projects analysis have active Jira read pipelines. The former member-analysis page, AppRoute and menu entry are removed, not delivered as a new member-analysis capability. See the [feature overview](docs/README.md) for purposes, Insights and current implementation status.

The three canonical Analysis page routes are `/analytics/workload`, `/analytics/projects` and `/analytics/story-points`. There are no summary/detail/distribution/breakdown/comparison-view subpages. Exactly **17 known legacy URLs** use literal single-hop 307 redirects: the former `/analytics/trends` and `/analytics/comparison` roots and known subpages go directly to `/analytics/projects`; `/analytics/members` and its `summary`, `comparison` and `detail` aliases go directly to `/analytics/story-points`; other legacy subpages go to their feature root. All query values pass through, including repeated Sprint selections, dates and invalid or unknown parameters, so the destination validates them without redirect-layer normalization. No redirect chains or wildcards are added; unknown subpaths and API routes are unchanged. Old Projects date URLs stay on Projects with an error and a **manual** migration link to Team analysis; they do not automatically redirect. These descriptions document the implementation, not a verified deployment.

## Workload analysis filters

`/analytics/workload` now provides the Dashboard-style team/member multiselect, optional project multiselect, an **分析區間** date-range field and a Query button. This page configures exactly four shortcuts in order: **近1月／近2月／近3月／近6月**, with **近1月** as its browser-initialized default. These are rolling calendar-month windows, not fixed multiples of 30 days: subtract N calendar months from local today (clamping to that month's final day), then begin on the following day and end on today, inclusively. For example, local today `2026-11-03` yields `2026-10-04`–`2026-11-03` for 近1月 and `2026-05-04`–`2026-11-03` for 近6月. Restored URL dates still take precedence; selecting a shortcut only changes the draft. It reuses `TeamSelect`, `FilterDropdown` and `SearchButton` with their central widths. Draft changes apply only after Query/Enter; the canonical URL uses repeated group/project/per-group exclusion parameters plus `from`/`to`. Reload, direct links and browser history restore selections **without running the workload query**; Query/Enter must explicitly activate it in the current page. The activation is page-local and never persisted in the URL or browser storage. Re-submitting identical filters starts a new query, while back/forward cancels activation and cannot silently reopen an earlier query. Invalid URLs are not applied, and incomplete memberships or empty included populations cannot be submitted. Existing shared membership metadata preloads are unchanged. Applying a query renders the [heatmap](#workload-heatmap) below the filters. The team/member selector appears only in this search form, not inside the results; changing the data scope requires applying a new query.

## 分析區間 (analysis date range)

`components/date-range-field.tsx` is the shared 分析區間 control: a `YYYY-MM-DD - YYYY-MM-DD` inclusive range beside the 今日／本週／上週／本月／近 7 日／近 30 日 shortcuts. Clicking a shortcut writes the described range into the inputs; clicking the inputs (or the calendar button) opens a two-click month-grid range picker. Shortcuts are marked selected only when the shown range still equals one of them; hand-edited dates clear stale highlights without displaying a 自訂區間 label. Valid-range status is screen-reader-only and occupies no space below the control; invalid-range feedback remains visible. It is controlled — it never writes the URL or issues a query; the page's Query action applies the draft. The day count is shown in the label as 分析區間（共 N 天）. When no range is restored from the URL, the field fills in **近 7 日** once the browser's local date is known (the `defaultPreset` prop; the field is empty and its shortcuts disabled until then, so server and client never disagree), and that filled range becomes the draft like any other selection.

Pages can customize buttons using `shortcuts?: readonly DateRangeShortcut[]`, imported as a type from `lib/date-range.ts`. Each option has a unique stable `id`, a `label`, and either an existing `preset` or a validated absolute `range`; list order is display order. Omitting `shortcuts` preserves the six defaults; `shortcuts={[]}` hides the shortcut group. Only displayed options are matched for highlighting, with the first exact match winning. `defaultPreset` remains independent of that list: an empty range still initializes to `last7` unless a different built-in default is specified. Page-specific dates such as Sprint boundaries must be resolved by the caller, not fetched by the control. Configuration is serializable data, not resolver functions, so it can cross the Next.js Server/Client boundary.

```tsx
import type { DateRangeShortcut } from "@/lib/date-range"

const shortcuts: readonly DateRangeShortcut[] = [
  { id: "last7", label: "近 7 日", preset: "last7" },
  { id: "last30", label: "近 30 日", preset: "last30" },
  // Example only: a page supplies its own actual Sprint dates.
  { id: "sprint", label: "指定 Sprint", range: { from: "2026-10-19", to: "2026-11-01" } },
]
// Inside a client form, using its controlled draft state:
<DateRangeField value={range} onChange={setRange} shortcuts={shortcuts} />
```

Ranges are plain `YYYY-MM-DD` calendar days in the **browser's local timezone**, matching the Dashboard due-reminder and pending-issue convention; no UTC conversion is applied, so a day never shifts while serializing. 本週／上週 are Monday-to-Sunday ISO weeks and 本月 is a whole calendar month; 近 N 日 counts N days **including** today. Because the range is resolved to absolute dates in the browser before it reaches the URL, the server never recomputes a relative window from its own timezone and never needs to know which shortcut was pressed.

`lib/date-range.ts` holds the pure date arithmetic (parsing, shifting, preset expansion, matching, the 3,660-day ceiling) with no I/O or React. Analysis JQL lives in `lib/jira-jql.ts`: `analysisDateJql` emits the inclusive bounds (`created` compares through `23:59` because it carries a time; `<= "YYYY-MM-DD"` suffices for date-only fields) and `analysisRangeJql` composes it over a centrally defined query with a single stable sort. Per [AGENTS.md](AGENTS.md#jira-fields-and-jql--mandatory-ownership), consumers import these builders and must not concatenate date conditions themselves. Invalid, reversed, malformed and oversized ranges fail rather than widening.

These controls provide the applied scope and date range for the workload heatmap below. Legacy workload subpage URLs redirect to this canonical page; this page adds no Jira write behavior.

## Workload heatmap

Below the filters, `/analytics/workload` renders a dense numeric heatmap table: one row per searched member (globally sorted by member name by default), one rectangular column per **Monday–Sunday week**, and weekly completed Dev-Task points inside each cell. The visible heading/date range has been removed; a **Story Points / Actual Story Points** switch defaults to Story Points and sits right-aligned on the same row as the member/week/total summary (wrapping when the container is narrow). Switching updates cells, totals, tooltips and accessible labels from the same loaded dataset, without another Jira query, EventSource connection or URL parameter. Two header rows group columns by the Monday's calendar year and show its `MM/DD`. Weeks whose Monday precedes the analysis start are excluded from both cells and totals. The final week may be incomplete and includes only actually retrieved in-range dates, also respecting the today cap; coverage is stated in tooltips. For `2026-10-04`–`2026-11-03`, columns are `10/05`, `10/12`, `10/19`, `10/26`, `11/02` (five weeks), with the last covering only `11/02`–`11/03`; the `09/28` week and its points are excluded. No seven-day completeness requirement or missing-date filling is applied. When no eligible week exists, an explanatory empty state retains the metric switch. Empty cells mean no countable value for the selected field (no completion or the field is missing), while completed work with an explicit zero prints `0`. Actual is never replaced with Story Points or zero. `computeMetricWorkloadHeatmap` projects the selected non-null field into `computeWeeklyWorkloadHeatmap`, which sums the received task values before rounding each weekly sum to one decimal; the existing service-level one-decimal projection is unchanged. Every selected member gets a row even with no countable points. The palette, query population, authorization and completion-date rules are unchanged.

The existing `workloadDevTasksJql` builder supplies one range-wide query (with complete pagination), requesting both central numeric fields plus assignee, `resolutiondate`, updated, summary, parent, status and resolution. The REST date key is `fields.resolutiondate`, not the JQL name `resolved`. It does not issue one query per day or impose a 60-day cap; the shared analysis-range validation and existing source limits still apply. Dates shown stop at today in the same UTC+8 calendar used for completion dates, including the midnight boundary. Completion remains the existing `resolveCompletionDate` policy: use `resolutiondate`, then updated, with UTC+8 calendar dates; dates before the range are omitted, dates after it clamp to its end, and unusable dates fall back to its end. This is the current field-based projection, not a reconstructed historical transition timestamp.

The completed-task DTO retains both nullable fields, including Actual-only and both-null tasks; missing one field does not exclude the other metric. Each field has an independent missing-value list, preserving the existing data-quality collection before completion-date filtering. Non-numeric, non-finite or negative values fail explicitly rather than being guessed; omitted fields and null are missing, not zero. Unassigned work retains its own 未指派 row, even if its selected metric is missing. The aggregation retains `DASHBOARD_TEAMS` metadata, with unrecognised teams recorded as 其他; the grid applies its own display-only name/Total ordering without changing this dataset.

Immediately to the right of each member name, before the weekly columns, **Total** displays that member's selected-metric total and **Output%** displays `Total / (displayed week count × 10) × 100%`, rounded to at most one decimal. All displayed weeks count, including blank and partial final weeks; active weeks and days are not substituted, and percentages above 100% are not capped. For example, 50 points over five displayed weeks is 100%. Both columns update locally with SP/Actual SP, include inactive and unassigned rows, and do not open issue details. A small icon beside the Total header cycles **high → low, low → high, none (member-name order)**; the initial state is none. Ordering applies globally across teams using the selected metric's existing totals, with ties resolved by name and then account ID. It sorts a copy of the rows, keeps inactive/unassigned members and the selected cell/details, and does not query Jira, reconnect EventSource or change the URL. Switching SP/Actual SP preserves the sort direction; a new query or retry resets it to name order. The header exposes `aria-sort` and the icon is a keyboard-accessible button describing its next action. Member, Total and Output% are frozen together during horizontal scrolling in both the header and body. Their fixed widths are 140/72/88px, with left offsets 0/140/212px; a fixed-layout colgroup prevents stretching from misaligning those offsets. Only weekly columns scroll behind the opaque frozen cells; narrow containers retain an internal horizontal scroller. The heatmap scroller uses `overscroll-behavior-x: none` to stop horizontal scroll chaining and edge overscroll from moving the outer page; normal vertical page scrolling is unchanged. No eligible weeks still yields the existing empty state, not division by zero.

The visible blank/zero explanation, week-boundary footnote and missing-field count notice are omitted; the colour-scale legend, accessible caption and cell tooltips remain. Missing-value lists are still retained in the dataset.

The cell scale is **one global legend shared by all members** (`HEATMAP_SCALE` = 0, 1–2, 3–5, 6–9, 10+), not per-member normalization, so cells are comparable across people. `lib/workload-heatmap.ts` holds the pure aggregation and the level function. The browser calculates weekly cells from the streamed tasks under the applied query conditions; the shared member cache supplies inactive rows and team ordering without a second team selector. Colour sits in the grid component as paired light/dark Tailwind classes. The grid is a real `<table>` with a `sr-only` caption, sticky member/Total/Output% columns, a horizontal scroller for weekly columns, and hover/focus cell details; it carries a text summary of the whole chart so screen-reader users are not forced through every cell.

Numeric cells (including `0`) are keyboard-accessible buttons that open an inline issue list **below** the heatmap. Its columns are **Parent Type Icon, Ticket, Summary, Resolution, Resolved, SP, Actual SP**; desktop uses a table and mobile uses cards, neither showing Status. The compact title is `Member name・N 張・SP 合計：Y 點 | Actual SP 合計：X 點`, with both sums calculated from the currently listed tasks (missing values add no points, zero is preserved, and totals use at most one decimal). The week/date and 單據明細 subtitle are no longer visible; the table's accessible caption retains the selected date range. `workloadCellTasks` selects only the original tasks contributing to that member/week/metric on actually retrieved dates, so the selected metric's sum reconciles to the cell. Switching metrics recalculates the same selected member/week; if its new cell is blank, selection is cleared and does not revive on switching back. Clicking another cell replaces the list; clicking the selected cell again clears its frame and closes the list. Closing with the detail button restores focus to the selected cell. New queries and retries reset selection. None of these local actions opens another query or EventSource. Parent type is safely projected from nested parent issuetype, not the Dev-Task's own type; absent metadata remains unknown. Resolution is the current field name, not a historical snapshot; Status remains in the DTO but is not displayed. Resolved displays only `MM/DD`, using the raw REST `resolutiondate` field's UTC+8 calendar date without the completion resolver's clamping/updated fallback; missing or invalid `resolutiondate` shows `—`. Point fields use `未填` for null and preserve `0`. Ticket links reuse the server-validated HTTPS origin and `TicketLink`, otherwise displaying plain keys.

Data arrives over SSE at `/api/analytics/workload/heatmap/stream` (`base` → `done`), reusing the framing in `lib/burndown-stream.ts`. Both metrics arrive in the same base frame; a failure never fabricates a `done`, and already-received data remains visible with an error banner. Authorization, parameter validation, scope resolution and the range-wide query all complete **before** the stream opens. EventSource callers receive a fatal SSE error frame so the UI can display its message; other callers receive the corresponding HTTP status and JSON error. The client uses the exact canonical endpoint (no cache-busting parameter); the route is `no-store`. Only a validated explicit form submission enables that endpoint; URL restoration alone never creates an EventSource. A changed-filter submission waits for the matching server-validated URL conditions, and unrelated/stale navigation cancels pending activation rather than querying the wrong scope. The local submit sequence remounts only the stream, preserving the selected metric. The result's explicit retry action still reruns its already submitted conditions; shared member metadata preloads are unaffected.

## Burn Down complete loading

Dev-Task completion on this page always uses Jira's current **Resolved / resolutiondate**. The **By Resolved** checkbox and the old Burn Down Done-transition queries have been removed. New navigation and SSE endpoints contain only Project/Sprint conditions. Old links with a single `byResolved=1` remain valid as a no-op; absent flags use the same Resolved rule. Invalid or repeated legacy flags fail closed before Jira queries. Changing Project/Sprint or retrying reloads the stream and closes old completion details while retaining team/display preferences. Workload analysis keeps its independent Done-transition population query.

The server completely paginates Sprint parents and their Dev-Tasks, requesting REST `fields.resolutiondate` alongside the existing fields. It groups each explicit-offset timestamp into a calendar date using the same Jira account's timezone, read once through `GET /rest/api/3/myself` and verified against the server credentials' account ID. Pre-Sprint dates set the opening marker; dates within the visible interval set daily markers. The last visible date is `min(UTC today, Sprint.endDate, Sprint.startDate + 59 days)`; later/future completion is not moved to the final day. Empty Resolved means unfinished under the ordinary date rule: a reopened issue with a cleared date no longer counts, while a retained date still counts regardless of current status. Invalid nonempty timestamps, missing/invalid account timezone, identity mismatch and lookup failures produce controlled errors rather than guessed dates. There is no `updated` fallback, UTC+8 fallback or historical resolution reconstruction. Dev-only tasks under Sprint parents, SP totals, team filtering and ideal-line calculations remain unchanged; chart, daily details and member completion statistics share the Resolved task markers. The separate **受阻母票計為已完成** override remains enabled by default: blocked-parent tasks can count as complete even with empty Resolved. Uncheck it to inspect completion based purely on Resolved.

Only after all search pages and completion projections succeed does `/api/sprint/burndown/stream` send `base → done`. The client waits for both frames before displaying the complete elapsed curve, member status and detail data together. There are no per-day Jira queries, daily SSE updates or progressive red-line extension; request count depends on dataset pagination, not Sprint duration. Failed/incomplete loads show a retryable error without a partial chart. The 60-day display limit remains, and the blocked-parent bar is anchored to the last visible date (the end date or cap for historical Sprints). Future points and an actual line with no genuine completion record remain undrawn.

The **中途加入的票** checkbox is temporarily hidden, with its unchecked placeholder implementation retained. The three existing display controls (剩餘點數／已完成／受阻母票計為已完成) remain available. The alternate chart is not implemented; hiding this placeholder does not change calculations, URLs or streaming.

## 專案回顧與趨勢：Sprint 分析

`/analytics/projects` is **Sprint-only**: required single Project, local whole-Team selection, multi-select Sprints and the shared 96px **查詢** button. There are no interval-mode radios, date inputs or date shortcuts. Before choosing Project, Team, Sprints and Query are disabled. Project reuses `ProjectSelector`; Team offers whole groups without individual exclusions and remains page-local, never serialized to the analysis URL or persisted on reload. Central selector widths, responsive clamping and shared membership lookups remain unchanged; Planning, Burn Down and Capacity retain their own single-Sprint layouts.

The native-checkbox Sprints selector contains **only ended project Sprints (`endDate < browser-local today`)**, newest first, from `lib/jira-sprint-data.ts`, not Jira Agile. Sprints ending today, ongoing Sprints and future Sprints are excluded; existing unpadded dates are normalized for comparison. Server rendering waits for browser-date hydration instead of guessing from the server timezone. Opening the dropdown locates the closest ended Sprint without selecting it. No Sprint is automatically selected. Query requires at least one Sprint and every selected Sprint must belong to the required Project and meet the ended-date rule. A restored URL containing a not-yet-ended Sprint shows an error and disables Query without automatically rewriting the URL; explicitly choosing an eligible Sprint removes unavailable old selections. Project/Sprint selections immediately update a URL containing only `project` and repeated `sprint`, for example `/analytics/projects?project=SUN&sprint=6823&sprint=7518`. Changing Project clears its previous Sprint draft but retains local Team; history restores validated Project/Sprints without analysis. A single legacy `mode=sprints` remains readable, but new URLs omit `mode`. Each explicit Query analyzes 1–6 ended Sprints; selected Teams must have complete membership metadata. The read-only POST sends only Project, Sprint IDs, group names and browser timezone; server authentication, complete Team resolution and full Jira pagination determine the actual population. Draft/history changes cancel the active request and clear obsolete results; only same-scope retries may retain a dimmed previous result. Invalid parameters, repeated scalar values, foreign Sprints and old date conditions fail closed.

Old Projects date URLs stay on Projects with an error and a manual **移至團隊分析** link. A fully valid legacy `mode=dates` plus `project`/`from`/`to` retains the Project and absolute range at `/analytics/story-points?project=SUN&from=2026-10-01&to=2026-10-21`, dropping the old mode flag. Invalid, repeated, unknown or mixed conditions link only to the clean `/analytics/story-points` entry rather than guessing a partial scope. Neither this link nor raw legacy redirects activate analysis.

每個 Sprint 的共同母體是所選 Project＋Sprint 的 Story／Task／Bug 母票下之 Dev-Task＋QA-Task 工作單；沿母票取得 Sprint，母票點數不計。未選 Team 納入範圍內全部可讀工作單（含未指派），選 Team 則用 server 完整解析的當前 assignee 聯集，不接受 browser member IDs 作授權。

| 六項指標 | 首版口徑 |
| --- | --- |
| 總輸出 | Resolved 日在 Sprint 起迄日內（含兩端）的 SP／Actual SP，各自加總。 |
| 完成任務類型 | 同批完成工作單按 Pre-Spike／Spike／Dev／Bug／OP-Task／OP-Bug＋未分類，列 SP／Actual SP／張數。 |
| Sprint 完成率 | Issue Type=Dev-Task（不限 Dev Type）的區間內完成 SP／全部 SP。 |
| 開發品質 | 完成工作單 Dev Type Bug／Dev；張數為主並列 SP／Actual 比，OP-Bug 不納入，不是 Bug／(Bug＋Dev)。 |
| 開發壓力 | 同一母體中工作單自身 Project=TKK／SUN 的全部 SP，不限完成日期。 |
| 目前未完成 | 現行 Resolved 空白的張數／SP，不限 Sprint 日期；迄日後已完成者不算未完成。 |

六項指標以本地頁籤切換，預設總輸出，一次顯示一個主題；切換不改 URL、不重新查詢，各主題圖表／單位／數據表狀態保留，切換主題收合舊明細。頁籤支援左右鍵與 Home／End，手機頁籤列可水平捲動；列印呈現全部六個主題與核對表。多 Sprint 採**趨勢圖優先**：總輸出每個候選團隊一條線，圖右上方切 SP／Actual SP（預設 SP），「顯示總量」預設不勾，勾選改為每 Sprint 一根依團隊顏色分段的堆疊長條，僅以可見團隊工作單聯集合計的曲線連接各長條頂點，不再畫團隊曲線；取消勾選恢復團隊曲線。堆疊只畫已填量，缺值不補零；目前點數單位下所有已選 Sprint 都完整為 0 的團隊自動從圖表／圖例排除，未填或部分缺值不當成 0；其餘團隊圖例可獨立隱藏／加入，切換單位保留手動顯示偏好，保留完整核對表與全範圍總輸出；每個 Dev Type（含未分類）一條線，可切換 SP／Actual SP／張數；Sprint 完成率 與 Bug／Dev 百分比線（品質可切三種比率）；TKK／SUN 壓力 SP 雙線；目前未完成 SP／張數分成兩圖。X 軸只包含已選 Sprint，依開始日升序等距排列；曲線連接觀測值，不代表每日變化或歷史快照。三個以上連續值使用有界曲線，兩值直線、一值標記，缺值斷線、不當成零。Dev Type 圖例可聚焦但不隱藏其他系列；單位／聚焦不改 URL、不重查。每個指標都有可展開的同源數據表；最近 Sprint 讀值支援 pointer、鍵盤與觸控，同一個持續互動讀值區可 Tab 進入數字連結、Escape 收合；可對帳的數字以本次完整結果的 Issue IDs 另開 Jira，分子／分母分別連結，超長清單不截取或放寬。「本站明細」在圖下／表格獨立展開。單 Sprint 的六項摘要各放在對應頁籤，任務類型改為橫條分布。Resolved 使用驗證 Jira 帳號時區，已結束資格使用 browser timezone＋server clock；沒有 Updated fallback、60日截點或受阻母票覆寫。0 有效、雙點數缺值不互補、部分已填附完整率與空心標記，分母0／全未填比率不適用，不夾 100%。

總輸出團隊分類使用 server 完整驗證的現行群組：選 Team 只在選取群組內分隊，未選則分類全部 13 隊，但不把原可讀母體改為 roster 聯集；重疊成員按設定順序後者優先，未指派／無歸屬保留「其他」。DTO 僅傳本次工作單帳號的唯一歸屬，不傳完整 roster；未選 Team 的分類專用查詢失敗明示 unavailable、停用總量並保留全範圍輸出與其他指標，不假造 Other。取消／總期限／身分／憑證／configuration 錯誤及 selected-scope 不完整仍失敗。單 Sprint 未勾總量時使用團隊觀測點，勾選時是一根堆疊長條與總量標記、不製造連線；全範圍摘要只隨點數單位切換。

這是查詢當下欄位、父子關係與 Sprint／assignee／Resolved **現值，不是歷史快照**；不相加跨 Sprint 的重複票、不做 Capacity 比較。完整分頁、metadata或5,000張唯一來源（含母票）限制失敗不交部分成功結果。詳見 [六指標與安全資料流](docs/features/analytics-projects.md)；本機合成元件／mock 驗證不代表已登入 live Jira 或部署驗證。

## 團隊分析 filters

`/analytics/story-points` receives the calendar-date filters: required single Project, local whole-Team selection, **分析區間** and Query, with no Sprint or mode controls. Before choosing Project, non-project controls are disabled. Team has no individual exclusions, is not written to the URL or retained on reload, and is not a server authorization boundary. Project changes retain local Team and the date draft. The async server page awaits `searchParams`, passes `teamAnalysisFilterResult` to the client `TeamAnalysisFilter`, and places it in ComingSoon's filters slot.

`DateRangeField` defaults to **近1月** after browser-local initialization and offers **近1月／近2月／近3月／近6月** plus custom dates. These are rolling calendar months, not 30-day multiples; restored URL dates take precedence, and initializing the default only seeds the draft without navigating. Bounds are inclusive real `YYYY-MM-DD` dates in order, at most 3,660 days. Project and completed valid dates immediately update a fixed `project`/`from`/`to` URL; `mode`, `sprint`, group/member parameters, unknown keys, repeated scalar values and invalid ranges are rejected rather than silently normalized. Query requires a valid Project and range and currently only displays the analysis-not-yet-available message. URL restoration, reload, direct links and history never automatically analyze. Team remains a partially implemented filter interface, not a delivered analysis engine or member-performance metric; Projects has its separate readonly Sprint analysis described above. All three analysis pages have no header subtitle; Team's description stays in ComingSoon content, and other categories are unchanged.

## Planning chart breakdowns

Planning's 票種分布 and 開發類型分佈 charts continue to summarize the same filtered Dev/QA work items. With exactly one team selected and its member filter active, hover/focus shows member shares (`依成員`) by each work item's Assignee account ID; no selection, multiple teams, or incomplete membership retains the team breakdown (`依團隊`). Points mode divides each member's points by the hovered category's points; count mode divides their work-item count by that category's count, not the entire chart total. Unestimated points contribute zero, and same-name members are not merged.

Each chart offers a collapsed 成員明細 list in single-team mode with all category/member values and shares, accessible by keyboard or touch. The tooltip shows all rows that fit its viewport budget; longer lists explicitly show the remaining-member count and refer to 成員明細. Chart geometry, colors, totals, independent metric switches and existing Jira search links are unchanged.

Planning's **總分派比例** badge uses the displayed one-decimal percentage: **<70% blue**, **70–90% green**, **>90–100% amber**, and **>100% red**, with matching light/dark text colors. An undefined ratio remains neutral (`—`). Per-member ratio styling, Capacity calculations and progress-bar geometry are unchanged.

## Sprint Capacity

`/sprint/capacity` contains the Capacity block formerly shown on Planning, including team Capacity buttons, total leave days, member leave-hour details/editing and the read-only Sprint Note dialog. It reuses Planning's project and ongoing/future Sprint selection rules; Planning no longer displays this block. Assignment Status's existing per-person Capacity calculation is unchanged.

Capacity and Sprint Note still use mock data. Capacity data is project-specific, not Sprint-specific. Web and QA are the mock editable teams for a signed-in viewer; this is not real Jira group authorization. Submitting or updating only changes local React state, does not change the mock submission status, and does not persist or write to Jira. Changing projects or leaving/reloading the page discards these local changes; changing Sprint within the same project retains the project mock state. Sprint Note remains read-only.

## Dashboard missing-data completion

`/dashboard` shows three independently loaded, exact missing-data counts. The top filter uses three radio modes: **自己** (default), **指定人**, and **團隊／專案**. Selecting **自己** immediately applies the self scope; selecting an identical self filter again does not reload. **指定人** and **團隊／專案** draft changes only apply after Query. Applied state is encoded in a canonical URL, including repeated group/project/exclusion parameters. Browser history and reload restore the applied scope. Optional remembered team/project selections are per-viewer browser conveniences, not authoritative membership or permissions. Person names are not stored in browser preferences; an applied person scope is restored only from the URL.

- **自己:** both queries below remain date-free; scope radios and the checkbox below are shown, with no days control or Query button. Missing values can be filled and existing Points values can be adjusted on still-missing issues in the dialog, subject to Jira edit permissions.
- **指定人:** search the Jira display name, prefer exact matches, and select an account when multiple candidates exist. The server verifies the account ID. No project restrictions from team mode carry over.
- **團隊／專案:** select configured Jira groups, optionally exclude individual members per group, and optionally intersect projects. Groups are unioned and deduplicated by account ID; exclusion in one group does not remove an inclusion from another. At least one group and included member are required; no selected project means no additional project restriction. Static group/project choices are in `lib/jira-dashboard-filter.ts`. The shared team choices include AndroidTV (`ent-androidtv`), QA1 (`ent-qa1`) and QA2 (`ent-qa2`); the former QA (`ent-qa`) choice has been removed. Saved Dashboard drafts discard retired groups, while applied URLs containing a retired group fail validation and must be reselected; they are never silently mapped to a new or broader scope. In both Dashboard and Sprint team selectors, team/member rows use full-width native checkbox labels: clicking the text, blank space or team count toggles selection; the team expansion arrow is a separate control and never toggles selection. Selecting a member of an unselected team includes only that member; partial teams show an indeterminate checkbox, deselecting the final member clears that team, and selecting the whole team resets prior member exclusions. Widths are consistent by control kind across Dashboard, Burn Down, Planning and Capacity (including team selectors in dialogs): team and Sprint selectors are 224px, project selectors are 160px, and search/query buttons are 96px even while loading. Dropdown panels match their triggers; narrow containers clamp controls to available space and long selections truncate. Selector widths are built into `FilterDropdown` by its required `kind`, and search submits reuse `SearchButton`; future uses must follow [AGENTS.md](AGENTS.md#selector-and-search-action-widths), rather than specifying per-page widths.

Days defaults to **30**, shown only outside self mode. Both nonself missing-data queries add `created >= -Nd`, just like every dashboard alert query; Points does not use a historical Done-transition condition. These conditions are composed in `lib/jira-jql.ts` and evaluated by Jira. Selected projects intersect the original scope, so Pride-only has no SUN/TKK/JIRATRY Defect Cause results. **All nonself dialogs are read-only**, even when the selected person is the viewer; they do not request editing metadata or expose Save. The mutation service still authorizes only the current user's original date-free missing-data scope. No Jira credentials are sent to browser JavaScript.

Group lookup requires the three granular read scopes listed above (`read:group:jira`, `read:user:jira`, `read:avatar:jira`) and Jira's **Browse users and groups** or **Administer Jira** permission. Enable those scopes in the Atlassian Developer Console and have existing users reauthorize; adding scopes in code does not update an existing grant or grant Jira permissions. No broad `manage:jira-configuration` scope is requested. HTTP 403 is displayed as a permission error, never interpreted as an empty group.

After the authenticated application mounts in the browser, a shared in-memory store preloads all configured teams in the background, with at most four group lookups active at once. Both Sprint `TeamSelect` modes and the Dashboard team filter reuse the same complete member lists and in-flight requests across client-side navigation and dialog remounts. Successful lists remain cached until a full page reload; logout/leaving the authenticated application or changing viewers discards the cache earlier. Member lists are never persisted in browser storage. Opening a filter before preload completes still shows loading, and failed groups retain their error and an explicit retry action. Selection state and Dashboard's Query/URL/remembered-draft behavior are unchanged. This cache is only a UI convenience, not an authorization or query-scope cache. Planning and Burndown display grouping receives a full account-to-team map built from all successfully loaded complete group lists, updating as more groups arrive or retries succeed; an unrelated failed group does not block known teams from appearing. Duplicate members retain the configured team-order precedence, regardless of response order. This display map is independent of selection readiness: selected member IDs still require every selected group's complete list, and server authorization/scope resolution is unchanged. Planning shows loading/failure and retry controls when team lists are incomplete; during that time, 「其他」 may include members whose team has not yet been confirmed. Planning's Team View filters work items by their own Assignee, and Reporter View filters mother issues by the mother's own Assignee using the same selected member IDs (not Reporter, Epic ownership, child Assignees or Components). With no team filter all mothers remain visible, including unassigned mothers and mothers without children; an active member filter excludes unassigned mothers and removes empty Reporter/Epic groups. Both distribution charts continue to summarize filtered work items. Each Team View card header shows both the work-item count and summed Dev/QA Story Points across its Dev Type groups (`N 張 · X 點`); unestimated points contribute zero, and totals remain visible when collapsed.

Group preload lookups, workload analysis and Projects analysis share a separate **server-side verified member cache** with a hard **30-minute TTL**, starting after complete pagination succeeds; hits do not extend it. It is isolated by the authenticated viewer, Jira cloud/site and group, retains only account IDs/display names (never OAuth tokens), and shares in-flight loads. The same server runtime shares the cache across route bundles; different workers or cold starts may independently reload. Storage is bounded to 256 completed lists and 32 active loads. Authentication and usable credentials are still required before every cache read, and workload scope still applies per-group exclusions before union/deduplication and project restrictions. Failures/incomplete pagination are not cached, and an expired list is never returned after a failed refresh. Membership or Jira lookup permission changes may remain unobserved until expiry; browser-successful lists retain their existing lifetime and are not automatically refreshed by this server TTL. Issue searches, user searches, Planning's private ranking groups, and write validation are not cached by this change.

Other server scope readers—including Dashboard missing-data counts/dialogs, alerts and Scrum Board—continue to fully resolve membership on each read, with bounded concurrency and explicit limits (1,000 included users, 100 group pages, 16 KiB filter URL and 32 KiB JQL). Incomplete pagination, oversized selections and lookup failures produce errors rather than partial populations. Changed group membership or filter scope invalidates old encrypted page tokens; reload the first page. Counts and dialogs are point-in-time reads, not a frozen issue dataset. An open dialog retains its original scope and drafts during dashboard URL changes; close it explicitly before the new scope appears.

- **Missing Points:** your DEV-Task / QA-Task issues, without a date restriction, with resolution empty, `Done`, or `Fixed` across all projects. Actual Story Points (`customfield_13736`) being empty or zero qualifies when status is `Done`; Story Points (`customfield_10005`) being empty or zero qualifies when status category is not `To Do`. These missing-value rules apply **in this completion workflow only**. The headline counts unique issues matching either branch. In self mode, either numeric field can be adjusted on a still-missing issue if Jira permits editing, including a field that already has a positive value. Submitted replacements must remain positive finite numbers; this workflow does not allow clearing or writing zero.

```jql
issuetype in (DEV-Task, QA-Task) and resolution in (EMPTY, Done, Fixed) and ((status = Done and cf[13736] in (EMPTY, 0)) or (statusCategory not in ("To Do") and cf[10005] in (EMPTY, 0))) and assignee = currentUser()
```

The first filter row's far-right native checkbox **顯示非預期關閉的票** defaults to unchecked (wrapping on narrow screens). It affects only the Points count, details and Jira search link: checking it removes the `resolution in (EMPTY, Done, Fixed)` restriction, using this exact base population:

```jql
issuetype in (DEV-Task, QA-Task) and ((status = Done and cf[13736] in (EMPTY, 0)) or (statusCategory not in ("To Do") and cf[10005] in (EMPTY, 0)))
```

The existing authorized assignee scope, selected-project intersections and nonself `created >= -Nd` remain. Self adds `assignee = currentUser()` without a near-N window. A nonliteral-Done closed issue is not included solely because Actual SP is missing; the status-dependent OR is unchanged. Counts and details share the centralized read builder. Defect Cause, Impact Scope, alerts and Scrum Board query definitions are unchanged (their existing full-filter lifecycle may re-fetch them).

Self checkbox changes apply immediately; person/team changes remain drafts until Query/Enter. The value survives mode switches and is restored from URL history, reload and reauthorization through canonical `includeUnexpectedClosed=1`; unchecked is omitted. Duplicate or non-`1` URL values are rejected, and the checkbox is not stored in localStorage. Page tokens bind both the exact query and complete filter identity, so they cannot be reused across checkbox states. Open dialogs retain their accepted filter until explicitly closed.

**Expanded reads do not expand write eligibility.** In checked self details, the server intersects each page's IDs with the unchanged original self supplementation query. Originally eligible rows still use per-issue schema/edit permission checks; newly included rows are read-only, do not request edit metadata, and explain that they are outside the original supplementation scope. The self list can contain both editable and read-only rows. Forged updates to newly included issues are still rejected by the original self query plus submitted IDs; person/team lists remain entirely read-only.

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

## Settings pages

`/settings/project` and `/settings/system` currently retain only their page titles, with no settings content or operations. The temporary environment diagnostics and its secret-reveal Server Action have been removed; these pages do not read or display runtime environment values. Authentication and deployment configuration remain unchanged. See [Project Settings](docs/features/settings-project.md) and [System Settings](docs/features/settings-system.md).

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


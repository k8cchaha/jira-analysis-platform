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

Custom field mappings are centralized in `lib/jira-fields.ts`: Story Points and Actual Story Points have fixed IDs; Defect Cause, Root Cause, and Solution are resolved from Jira metadata by name and required schema. Both the Assigned Issues editor and dashboard use these shared definitions. Project-scoped resolution and per-issue edit permissions/options are still checked at runtime.

Reading issues requires `read:jira-work`; saving fields also requires `write:jira-work`.

## Dashboard missing-data completion

`/dashboard` shows two independently loaded, exact missing-data counts. The top filter uses three radio modes: **自己** (default), **指定人**, and **團隊／專案**. Selecting **自己** immediately applies the self scope; if the displayed data is already self-scoped, selecting it again does not reload. **指定人** and **團隊／專案** draft changes only apply after Query. Applied state is encoded in a canonical URL, including repeated group/project/exclusion parameters. Browser history and reload restore the applied scope. Optional remembered team/project selections are per-viewer browser conveniences, not authoritative membership or permissions. Person names are not stored in browser preferences; an applied person scope is restored only from the URL.

- **自己:** both queries below remain date-free; only scope radios are shown, with no days control or Query button. Missing values can be filled and existing Points values can be adjusted on still-missing issues in the dialog, subject to Jira edit permissions.
- **指定人:** search the Jira display name, prefer exact matches, and select an account when multiple candidates exist. The server verifies the account ID. No project restrictions from team mode carry over.
- **團隊／專案:** select configured Jira groups, optionally exclude individual members per group, and optionally intersect projects. Groups are unioned and deduplicated by account ID; exclusion in one group does not remove an inclusion from another. At least one group and included member are required; no selected project means no additional project restriction. Static group/project choices are in `lib/jira-dashboard-filter.ts`, matching `dev-type-chart`.

Days defaults to **30**, shown only outside self mode. Nonself Points adds `status CHANGED TO Done AFTER -Xd` to the status-dependent missing-value union below (including reopened tasks if they still match the union); nonself Bugs use `created >= -Xd`. These are different time bases, evaluated by Jira. Selected projects intersect the original scope, so Pride-only has no SUN/TKK/JIRATRY Defect Cause results. **All nonself dialogs are read-only**, even when the selected person is the viewer; they do not request editing metadata or expose Save. The mutation service still authorizes only the current user's original date-free missing-data scope. No Jira credentials are sent to browser JavaScript.

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


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

Reading issues requires `read:jira-work`; saving fields also requires `write:jira-work`.

## Dashboard missing-data completion

`/dashboard` shows two independently loaded, exact missing-data counts. Clicking a card opens an editable dialog; no Jira credentials are sent to browser JavaScript.

- **Missing Points:** your currently `Done` DEV-Task / QA-Task issues, without a date restriction. SUN / TKK issues additionally require a `Done` or `Fixed` resolution. Story Points (`customfield_10005`) or Actual Story Points (`customfield_13736`) being empty or zero counts as missing **in this completion workflow only**. The headline counts unique issues; the two field subtotals overlap. Existing positive values are read-only, and missing values can be filled with positive decimals.
- **Missing Defect Cause:** uses the following fixed query. Its dialog shows the Jira issue link, summary, read-only Root Cause / Solution, and a multi-select populated from that issue's current editable Defect Cause options.

```jql
project in (sun, tkk) and issuetype = bug and assignee = currentUser() and statusCategory != "To Do" and status not in ("In Progress", "Dev Ready") and resolution in (EMPTY, Done, Fixed) and "Defect Cause[Select List (multiple choices)]" is EMPTY
```

Counts require complete Jira pagination and stop with an explicit error above 5,000 source issues or when data is incomplete. Dialogs show at most 50 issues per page. Application pagination tokens are encrypted, bound to the user/site/query, and expire after 15 minutes. Missing or ambiguous custom-field metadata is surfaced rather than treated as a zero count.

Updates recheck issue eligibility, current values, edit permissions, and allowed option IDs on the server, and preserve failed drafts on partial success. Fields already filled when reread are not overwritten; Jira's read-then-write API does not provide an atomic guarantee against another edit made simultaneously after that check.

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


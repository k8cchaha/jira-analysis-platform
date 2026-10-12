# Jira Analysis Platform

Next.js application that uses Atlassian OAuth 2.0 (3LO) for both application login and Jira Cloud API access.

## Requirements

- Node.js 20.9 or newer
- An Atlassian developer app with OAuth 2.0 (3LO)
- Access to the configured Jira Cloud site

## Atlassian configuration

In the [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/), configure this callback URL for local development:

```text
http://localhost:3000/api/auth/callback/atlassian
```

Use the equivalent application origin in production. Enable these OAuth scopes:

```text
read:me
read:jira-work
read:jira-user
write:jira-work
offline_access
```

Copy `.env.example` to `.env.local`, then set the Auth.js secret, Atlassian client credentials, and target Jira Cloud URL. Never commit `.env.local` or real credentials.

## Local setup

Install dependencies and initialize the database:

```bash
npm install
npx prisma migrate dev
npx prisma generate
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The Jira login button performs one Atlassian authorization flow that creates the application session and grants Jira API access.

After login, the dashboard shows up to the latest 50 issues returned by:

```jql
assignee = currentUser() AND created >= -30d ORDER BY created DESC
```

The dashboard uses Jira field `customfield_10005` for Story Points. You can edit non-negative integer or decimal values, clear a value, and submit only the issues that changed. In JQL this field can also be referenced as `cf[10005]`; Jira REST request and response bodies use `customfield_10005`.

Reading issues requires `read:jira-work`; saving Story Points also requires `write:jira-work`.

### Reset development data

The migration to Jira-only authentication does not link existing Google accounts. Reset the local SQLite database when upgrading an existing development checkout:

```bash
npx prisma migrate reset
```

This deletes local development data and reapplies all migrations.

## Validation

```bash
npx prisma validate
npx tsc --noEmit
npm run lint
npm run build
```

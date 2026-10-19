# Project development rules

These rules apply to human contributors and AI coding agents. Read [README.md](README.md#jira-開發規則欄位與-jql-分工) before changing Jira fields or queries. `CLAUDE.md` imports this file; keep the rules here rather than maintaining separate copies for different AI tools.

## Jira fields and JQL — mandatory ownership

- `lib/jira-fields.ts` is the single source of truth for custom-field REST IDs, names, schemas, field-level JQL references, and helpers such as `customFieldJql()` and `matchesJiraFieldSchema()`. Keep its current role; do not put complete queries or feature scope builders here.
- `lib/jira-jql.ts` is the single source of truth for complete production JQL constants and query composition: assignee, project, date, sorting, and issue-ID restrictions for update eligibility.
- Custom-field references in JQL MUST come from `JIRA_FIELDS` / `customFieldJql()` imported from `jira-fields.ts`. Do not hardcode another `customfield_...`, `cf[...]`, field name, or schema mapping in production feature modules.
- Services, API routes, and pages MUST import named queries/builders from `jira-jql.ts`. Do not define, concatenate, replace, or append JQL clauses in those consumers. A page displaying JQL must display the imported definition, not a separate literal.
- Existing compatibility re-exports are allowed, but must only forward exports from the authoritative module. New consumers should import directly from `jira-jql.ts` or `jira-fields.ts` as appropriate.
- Keep `jira-jql.ts` pure and usable by shared code: no credentials, auth/session access, environment access, Jira HTTP requests, or server-only imports. Use `import type` for type-only dependencies.
- Jira services remain responsible for server authorization, scope resolution, runtime field discovery, transport, complete pagination, DTO projection, and write validation. Centralized JQL is not authorization by itself.
- Tests may contain literal expected queries or synthetic field fixtures; documentation may show query examples. These are not alternative production definitions and must be updated when the intended contract changes.

## Preserve query and security contracts

- Dashboard **person** and **team/project** modes add `created >= -Nd` to every dashboard query; N defaults to 30. **Self** does not add this near-N condition. Existing base-query conditions such as `updated < -10d` and `duedate` boundaries still apply. The Assigned Issues page's fixed 30-day query is a separate contract.
- Keep server-verified account IDs, complete group membership with per-group exclusions before union/deduplication, project intersections, and existing member/JQL-length limits. Invalid or incomplete scopes must fail, not fall back to self or a wider query.
- Counts and details must share the same query builder. Updates must retain their original self eligibility query AND the submitted issue-ID restriction, plus existing original-value, field-schema, permission, and option validation. Do not broaden write eligibility while refactoring queries.
- Do not accept arbitrary client-supplied JQL or interpolate unvalidated client values. Query builders consume validated/resolved inputs; preserve caller validation as well as builder checks.

## Change checklist

1. Field mapping change → edit `jira-fields.ts`; retain runtime discovery/schema checks.
2. Query or composition change → edit `jira-jql.ts`; consumers only call/import it.
3. Jira I/O or authorization change → edit the server service, not the query/field definition modules.
4. Update relevant documentation and test expectations for intentional behavior changes. Respect the user's requested verification scope; report checks that were not run rather than claiming they passed.
5. Review the diff for duplicated production field mappings or JQL and for unintended scope/write changes.

## Credentials and live writes

- Do not read .env.local or any credential files.
- live PUT 僅在使用者指定可修改 Issue 或明確授權後測試，否則以 mock 驗證並說明未做真實寫入。
- Never commit `.env.local` or real credentials.
- Commit and push only when explicitly requested by the user.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

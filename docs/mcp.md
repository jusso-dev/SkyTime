# API and MCP automation

SkyTime's action registry is the source of truth for both REST and MCP. Actions use the same schemas, tenant permissions, approval/billing locks, and audit trail.

## Connect

1. Sign in to SkyTime and open **API & MCP**.
2. Create a personal access token with a descriptive name, **read only** or **read and write**, and an expiry of 1–365 days.
3. Copy the token once and store it in your client's secret configuration. The database stores only its SHA-256 hash and display prefix.
4. Configure an MCP client that supports Streamable HTTP and bearer headers:

```json
{
  "mcpServers": {
    "skytime": {
      "url": "https://your-skytime.example/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

Client configuration formats vary. The server endpoint is `/api/mcp`, the transport is **Streamable HTTP**, and the Authorization header uses **Bearer**. OAuth discovery/login and legacy SSE sessions are not implemented. The server is stateless; initialize and subsequent requests must carry authorization. GET and DELETE at the transport endpoint return 405 intentionally. Tool annotations describe reads, writes, destructive operations and external invitation email effects.

A token belongs to one user and one organization. Every request rechecks current membership and role. Revocation, expiry, and role changes take effect immediately. A read-only token cannot mutate data, including via MCP tools. Creating new credentials requires a signed-in browser session; bearer tokens cannot mint more credentials. Tokens can list and revoke their owner's tokens.

## Discover

- `GET /api/v1/actions`: all action names, descriptions, routes and JSON Schemas.
- `GET /api/v1/openapi.json`: generated OpenAPI 3.1 specification.
- MCP `tools/list`: the identical action catalog.
- MCP `resources/read` at `skytime://actions`: catalog resource.

All workspace actions are exposed. Account registration, sign-in, MFA enrollment and invitation acceptance remain on the existing authentication/onboarding API; these are not agent workspace tools.

## Typical workflows

- `clients_create` → `projects_create` → `tasks_create` → `timer_start` → `timer_get` → `timer_stop`.
- `time_entries_create`, `time_entries_update`, `time_entries_duplicate`, `time_entries_resume`, `time_entries_bulk_update`, `time_entries_import`.
- `timesheets_create` with any date in a UTC week → `timesheets_transition` with `submit` → admin `approve`, `reject`, or `reopen`.
- `reports_summary` → `saved_reports_create` → `reports_export` with `pdf` or `csv`.
- `expenses_create` → admin `invoices_create` → `invoices_export` → `invoices_update`.
- Admin `members_update` for capacity → `allocations_create` → `workload_report`; members can `time_off_create` and admins `time_off_review`.

PDF/CSV tools return an embedded MCP resource with MIME type and base64 file content. REST exports return binary downloads. MCP errors use `isError: true`; REST returns `{ "error": "…", "code": "…" }` with a corresponding HTTP status. Do not retry a mutating request blindly after a network timeout: read current state first. Timer stop requires the timer ID and cannot create a second entry if retried. Other create operations do not accept idempotency keys.

## REST examples

Set `SKYTIME_URL` and `SKYTIME_TOKEN` in your own secure execution environment:

```sh
curl "$SKYTIME_URL/api/v1/projects" \
  -H "Authorization: Bearer $SKYTIME_TOKEN"

curl "$SKYTIME_URL/api/v1/timer" \
  -H "Authorization: Bearer $SKYTIME_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"projectId":"<project-id>","task":"Discovery workshop","billable":true}'

curl "$SKYTIME_URL/api/v1/reports/export?from=2026-09-01&to=2026-09-30&format=pdf" \
  -H "Authorization: Bearer $SKYTIME_TOKEN" \
  --output september-timesheet.pdf
```

Durations are integer milliseconds (1–2147483647). Timestamps are ISO 8601 with an offset. Report dates are inclusive in the configured organization timezone. Approval dates are UTC. Amounts remain separated by currency. Report rounding rounds each entry **up** to the specified interval without changing stored time. JSON imports and bulk edits allow at most 100 entries and are atomic. Report tag groups can overlap; grand totals count each entry once.

## Upgrade and verification

From `src/client/next-landing-page`, with `DATABASE_URL` pointing to the intended database and `BETTER_AUTH_SECRET` set to a strong secret for production builds/runtime:

```sh
npm ci
npm run auth:migrate
npm run db:migrate
npm run type-check
npm run build
```

Both migrations are required, including new Better Auth two-factor lockout columns. Stop/restart the running application after migrating. The schema is additive and repeatable. Test migrations against a backup before production rollout.

If this browser has a running timer from an older release, open its original workspace and choose **Recover timer**. Recovery preserves its start time, project, description, notes and billable setting. The browser copy stays in place until the server confirms recovery. If another timer is running, stop and save that timer first; recovery never replaces it.

Set `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL` to the actual public URL behind your reverse proxy, and set a strong `BETTER_AUTH_SECRET`. The public URL is used for browser/MCP origin validation. Use HTTPS for remote credentials.

Integration tests create fictional users and organizations. Use a dedicated test database, migrate it first, then run:

```sh
npx playwright install chromium
npm run test:integration
```

`DATABASE_URL` must be the same for the app and tests. `PLAYWRIGHT_BASE_URL` can override the default `http://127.0.0.1:3100`; `PLAYWRIGHT_SKIP_WEB_SERVER=1` uses a server you've already started. Tests run against a freshly migrated schema (CI proves the migrations themselves are repeatable by running them twice) and cover authorization, timer races, rollback, approval/invoice locks, rate snapshots, currencies, planning, MCP SDK interoperability, PDF content/pagination, and responsive UI. They generate fictional example reports/screenshots under `docs/`.

Regression coverage also exercises mutations beyond the database pool's capacity, linked-task moves, duplicate tags, decimal-hour browser entries, local-date CSV/PDF downloads in Sydney and Los Angeles, and legacy timer recovery through conflicts and lost responses.

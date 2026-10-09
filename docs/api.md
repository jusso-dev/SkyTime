# API and MCP v1

The current automation surface is `/api/v1/*`, generated from the same action registry as `/api/mcp`. See [setup, authentication, schemas and examples](mcp.md). The live `GET /api/v1/actions` catalog and `GET /api/v1/openapi.json` are authoritative. All requests require a browser session or an organization-scoped bearer token, except the health endpoint.

The unversioned endpoints below remain compatible with the existing UI. Both surfaces now enforce tenant relationships, captured entry rates, approval/invoice locks and transactional audit records. New features use the versioned surface. Account authentication/MFA and organization onboarding retain their existing endpoints.

## Legacy endpoint reference

## Conventions

- **Auth.** Cookie-based sessions issued by `/api/auth/*` (better-auth), or personal bearer tokens for tenant endpoints.
  All non-auth endpoints require a signed-in user and an organization
  membership, unless noted as admin-only.
- **Tenancy.** Every record is scoped to the caller's organization. Cross-org
  references are rejected; item lookups return `404 not_found`.
- **Errors.** Failed requests return `{ "error": string, "code": string }`
  with the HTTP status set to the appropriate 4xx/5xx code. Common codes are
  `validation_failed`, `not_found`, `forbidden`, `conflict`, and `server_error`.
- **Audit.** All mutating actions on tenant resources are written to the
  `audit_log` table and surfaced via `/api/audit-log` to admins.
- **Errors captured.** Server-side exceptions are written to `error_log` and
  surfaced via `/api/error-log` to admins.

## Health

`GET /api/v1/health` — public liveness probe. Returns `version`, `status`,
and a `database` field. Returns 503 when the database is unreachable.

## Identity

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/me` | Current user and primary organization |
| `POST` | `/api/auth/sign-in/email` | Email + password sign-in |
| `POST` | `/api/auth/sign-up/email` | Email + password sign-up |
| `POST` | `/api/auth/two-factor/*` | better-auth two-factor flows |
| `POST` | `/api/organizations` | Create the caller's first organization |

## Workspace data

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/workspace` | Bootstrap payload — user, org, clients, projects, entries, tasks, settings, current period |
| `GET` `POST` | `/api/clients` | List or create clients |
| `PATCH` `DELETE` | `/api/clients/:id` | Update or archive a client (soft delete) |
| `GET` `POST` | `/api/projects` | List or create projects (project may reference `clientId`) |
| `PATCH` `DELETE` | `/api/projects/:id` | Update or delete a project |
| `GET` `POST` | `/api/time-entries` | List or create time entries (auto-stamped with `userId`) |
| `PATCH` `DELETE` | `/api/time-entries/:id` | Update or delete an entry. Refuses to mutate entries inside an approved period. |
| `GET` `POST` | `/api/tasks` | List or create board tasks |
| `PATCH` `DELETE` | `/api/tasks/:id` | Update or delete a board task |
| `GET` `PATCH` | `/api/settings` | Read or update workspace settings |

## Approvals

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/timesheets` | List own periods. Admins may pass `?scope=all` |
| `GET` | `/api/timesheets/:id` | Single period (members can only see their own) |
| `POST` | `/api/timesheets/:id` | `{ action }` — `submit` (owner), `approve` (admin), `reject` (admin), `reopen` (admin) |

Entries inside an approved period are locked: PATCH and DELETE on those
entries return `409 conflict` until an admin reopens the period.

## Admin observability

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/audit-log` | Last N audit events. Query: `limit`, `action`, `entity` |
| `GET` | `/api/error-log` | Last N captured errors. Query: `limit`, `level` |
| `GET` `POST` | `/api/invitations` | List or create invites (admin) |
| `DELETE` | `/api/invitations/:id` | Revoke an invite (admin) |

## Versioning policy

`/api/*` is the active v1 surface. Breaking changes will ship under
`/api/v2/*` with a deprecation window. Add new fields as optional rather
than introducing a new version.

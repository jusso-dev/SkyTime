<p align="center">
  <img src="src/client/next-landing-page/public/skytime-logo.svg" alt="SkyTime" width="420" />
</p>

# SkyTime

Clean multi-tenant time tracking software with projects, clients, task boards,
browser reminders, weekly timesheet approvals, polished CSV/PDF timesheet
exports, full audit logging, captured server errors, and Postgres-backed
workspace data.

## Features

- **Time tracking.** Start/stop timer, manual entries, billable flag, project
  rates, weekly/monthly/financial year/custom period filters, CSV and PDF
  export with configurable GST.
- **Clients & projects.** Clients as first-class entities (contact, address,
  currency, default rate). Projects reference a client so renames flow through
  to historical entries.
- **Approvals.** Weekly timesheet periods per user with `draft → submitted →
  approved/rejected` lifecycle. Entries inside an approved week are locked
  until an admin reopens the period.
- **Audit log.** Every mutating action on tenant data is recorded
  (`who, what, when, before, after`) and visible to admins in-app and via
  `/api/audit-log`.
- **Error log.** Server-side exceptions are captured to `error_log` and
  surfaced to admins for incident triage.
- **Multi-tenant.** Organizations with admin/member roles, invite flow with
  email delivery via Resend, two-factor authentication via better-auth.
- **API.** Documented JSON API under `/api/*` (current v1 surface) — see
  [`docs/api.md`](docs/api.md). `/api/v1/health` provides a liveness probe.

## Local development

```bash
docker compose up -d
cd src/client/next-landing-page
npm install
npm run auth:migrate   # better-auth tables
npm run db:migrate     # SkyTime schema
npm run dev
```

The app boots at <http://localhost:3000>. Sign up creates a user; the first
sign-in prompts for an organization name.

## Backups

SkyTime includes Docker-based Postgres backups. Backups are written as custom-format `pg_dump` files so they can be restored with `pg_restore`.

Create a local file-backed backup:

```bash
docker compose --profile backup run --rm backup-local
```

The dump and `.sha256` checksum are persisted under `./backups`, which is ignored by git except for the placeholder directory.

For S3-compatible storage, copy the example env file and fill in your bucket, endpoint, and credentials:

```bash
cp .env.backup.example .env.backup
```

Then run:

```bash
docker compose --env-file .env.backup --profile backup-s3 run --rm backup-s3
```

`S3_ENDPOINT_URL` supports S3-compatible providers such as MinIO, Cloudflare R2, Backblaze B2, and Wasabi. Leave it empty for AWS S3. `S3_FORCE_PATH_STYLE=true` is useful for MinIO and many self-hosted S3-compatible services.

Restore from a local backup file:

```bash
RESTORE_FILE=skytime-skytime-20260511T010000Z.dump \
CONFIRM_RESTORE=true \
docker compose --profile restore run --rm restore
```

Restore directly from S3-compatible storage:

```bash
RESTORE_FILE=s3://your-bucket/skytime/postgres/skytime-skytime-20260511T010000Z.dump \
CONFIRM_RESTORE=true \
docker compose --env-file .env.backup --profile restore run --rm restore
```

Restores replace objects in the configured Postgres database. Stop the app process before restoring into a live environment.

## Demo Screenshots

Regenerate the seeded demo account, organization, projects, tasks, timesheets, and screenshots with:

```bash
cd src/client/next-landing-page
npm run demo:screenshots
```

The script signs up fictional users, creates fictional organizations, adds sample projects, tasks, and time entries, then captures light and dark mode screenshots into `docs/screenshots`.

### Desktop

| View | Light | Dark |
| --- | --- | --- |
| Dashboard | <img src="docs/screenshots/skytime-desktop-light-dashboard.png" alt="SkyTime desktop dashboard in light mode" width="420" /> | <img src="docs/screenshots/skytime-desktop-dark-dashboard.png" alt="SkyTime desktop dashboard in dark mode" width="420" /> |
| Projects | <img src="docs/screenshots/skytime-desktop-light-projects.png" alt="SkyTime desktop projects in light mode" width="420" /> | <img src="docs/screenshots/skytime-desktop-dark-projects.png" alt="SkyTime desktop projects in dark mode" width="420" /> |
| Board | <img src="docs/screenshots/skytime-desktop-light-board.png" alt="SkyTime desktop task board in light mode" width="420" /> | <img src="docs/screenshots/skytime-desktop-dark-board.png" alt="SkyTime desktop task board in dark mode" width="420" /> |
| Timesheets | <img src="docs/screenshots/skytime-desktop-light-timesheets.png" alt="SkyTime desktop timesheets in light mode" width="420" /> | <img src="docs/screenshots/skytime-desktop-dark-timesheets.png" alt="SkyTime desktop timesheets in dark mode" width="420" /> |
| Settings | <img src="docs/screenshots/skytime-desktop-light-settings.png" alt="SkyTime desktop settings in light mode" width="420" /> | <img src="docs/screenshots/skytime-desktop-dark-settings.png" alt="SkyTime desktop settings in dark mode" width="420" /> |

### Mobile

| View | Light | Dark |
| --- | --- | --- |
| Dashboard | <img src="docs/screenshots/skytime-mobile-light-dashboard.png" alt="SkyTime mobile dashboard in light mode" width="180" /> | <img src="docs/screenshots/skytime-mobile-dark-dashboard.png" alt="SkyTime mobile dashboard in dark mode" width="180" /> |
| Projects | <img src="docs/screenshots/skytime-mobile-light-projects.png" alt="SkyTime mobile projects in light mode" width="180" /> | <img src="docs/screenshots/skytime-mobile-dark-projects.png" alt="SkyTime mobile projects in dark mode" width="180" /> |
| Board | <img src="docs/screenshots/skytime-mobile-light-board.png" alt="SkyTime mobile task board in light mode" width="180" /> | <img src="docs/screenshots/skytime-mobile-dark-board.png" alt="SkyTime mobile task board in dark mode" width="180" /> |
| Timesheets | <img src="docs/screenshots/skytime-mobile-light-timesheets.png" alt="SkyTime mobile timesheets in light mode" width="180" /> | <img src="docs/screenshots/skytime-mobile-dark-timesheets.png" alt="SkyTime mobile timesheets in dark mode" width="180" /> |
| Settings | <img src="docs/screenshots/skytime-mobile-light-settings.png" alt="SkyTime mobile settings in light mode" width="180" /> | <img src="docs/screenshots/skytime-mobile-dark-settings.png" alt="SkyTime mobile settings in dark mode" width="180" /> |

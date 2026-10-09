<p align="center">
  <img src="src/client/next-landing-page/public/skytime-logo.svg" alt="SkyTime" width="420" />
</p>

# SkyTime

Clean multi-tenant time tracking software with projects, clients, task boards,
browser reminders, weekly timesheet approvals, polished CSV/PDF timesheet
exports, full audit logging, captured server errors, and Postgres-backed
workspace data.

## Features

- **MCP and API first.** A shared action registry exposes time tracking, clients, projects, tasks, approvals, reports, billing and planning through REST and Streamable HTTP MCP. Includes an action directory, OpenAPI 3.1, scoped personal tokens and transactional audit logs. See [MCP setup](docs/mcp.md).
- **Time tracking.** Persistent cross-device timers, manual entries, duplicate/resume, tags, task links, atomic bulk edits and imports, captured rates/currencies, and approved/invoiced entry locks.
- **Projects and clients.** Contact and billing details, project templates, rates and costs, hours/fee budgets, deadlines, notes, task boards and profitability/budget views.
- **Reporting.** Filter by period, project, client, member, tag and billing state; group by project/client/member/day/tag; save views; inspect daily grids; round entries for reporting. Export detailed multipage PDFs with the SkyTime logo or your uploaded logo, business identity and tax settings, plus spreadsheet-safe CSVs.
- **Billing.** Project expenses and invoices from unbilled time/expenses. Draft, issued, paid and void lifecycle; immutable line/client snapshots; atomic reservation prevents double billing; branded invoice PDFs.
- **Planning.** Schedule project work, configure weekly member capacity, compare planned/actual utilization and overbooking, and request/review time off.
- **Approvals and team controls.** Weekly submission/review/reopening, admin/member roles, invitations, two-factor authentication, audit/error logs and strict tenant validation.

See the [feature review and explicit limits](docs/feature-research.md). This expansion does not claim full parity with every edition of Toggl, Harvest or Clockify.

[Sample branded report](docs/reports/skytime-sample-report.pdf) · [API reference](docs/api.md) · [MCP setup](docs/mcp.md)

## Local development

```bash
docker compose up -d
cd src/client/next-landing-page
npm ci
npm run auth:migrate   # better-auth tables
npm run db:migrate     # SkyTime schema
npm run dev
```

The app boots at <http://localhost:3000>. Sign up creates a user; the first
sign-in prompts for an organization name.

## Optional integrations

- **Google Places address autocomplete.** Set
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to a Google Maps JavaScript API key with
  the Places library enabled. When set, the client address field offers
  type-ahead address suggestions. When unset, the field behaves as a plain
  text input.
- **Email delivery.** Configure `RESEND_API_KEY` and `RESEND_FROM` for invite
  emails. Invites are still created without these — only the email send is
  skipped.

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

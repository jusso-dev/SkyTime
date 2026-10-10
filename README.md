<p align="center">
  <img src="src/client/next-landing-page/public/skytime-logo.svg" alt="SkyTime" width="420" />
</p>

# SkyTime

Clean multi-tenant time tracking software with projects, clients, task boards,
browser reminders, weekly timesheet approvals, polished CSV/PDF timesheet
exports, full audit logging, captured server errors, and a SQLite
workspace. Production uses Cloudflare D1. Logos live in R2.

## Features

- **MCP and API first.** A shared action registry exposes time tracking, clients, projects, tasks, approvals, reports, billing and planning through REST and Streamable HTTP MCP. Includes an action directory, OpenAPI 3.1, scoped personal tokens and transactional audit logs. See [MCP setup](docs/mcp.md).
- **Time tracking.** Persistent cross-device timers, manual entries, duplicate/resume, tags, task links, atomic bulk edits and imports, captured rates/currencies, and approved/invoiced entry locks.
- **Projects and clients.** Contact and billing details, project templates, rates and costs, hours/fee budgets, deadlines, notes, task boards and profitability/budget views.
- **Reporting.** Filter by period, project, client, member, tag and billing state; group by project/client/member/day/tag; save views; inspect daily grids; round entries for reporting. Export detailed multipage PDFs with the SkyTime logo or your uploaded logo, business identity and tax settings, plus spreadsheet-safe CSVs.
- **Billing.** Project expenses and invoices from unbilled time/expenses. Draft, issued, paid and void lifecycle; immutable line/client snapshots; invoice creation claims only rows that are still unbilled; branded invoice PDFs.
- **Planning.** Schedule project work, configure weekly member capacity, compare planned/actual utilization and overbooking, and request/review time off.
- **Approvals and team controls.** Weekly submission/review/reopening, admin/member roles, invitations, two-factor authentication, audit/error logs and strict tenant validation.

See the [feature review and explicit limits](docs/feature-research.md). This expansion does not claim full parity with every edition of Toggl, Harvest or Clockify.

[Sample branded report](docs/reports/skytime-sample-report.pdf) · [API reference](docs/api.md) · [MCP setup](docs/mcp.md)

## Local development

```bash
cd src/client/next-landing-page
npm ci
npm run auth:migrate   # better-auth tables in data/skytime.sqlite
npm run db:migrate     # SkyTime schema
npm run dev
```

The app boots at <http://localhost:3000> and stores data in `data/skytime.sqlite`. Set `SKYTIME_SQLITE` to use another file. Sign up creates a user; the first sign-in prompts for an organization name. Logos are written under `data/attachments/`.

## Cloudflare Workers

Production runs the same Next.js app on Cloudflare Workers through [vinext](https://vinext.dev/). The database is a D1 binding named `DB`. Report logos use an R2 binding named `ATTACHMENTS`. Local `next dev`, CI, and `npm start` use Node's `node:sqlite` against the same schema. The first request also applies the schema and better-auth tables.

From `src/client/next-landing-page`:

```bash
npm run dev:vinext    # Workers runtime on port 3001, local D1 and R2
npm run build:vinext
npm run deploy:vinext
```

Create the remote D1 database and R2 bucket before deploy, then set `CLOUDFLARE_D1_ID` to the database id. The bucket name is `skytime-attachments` and the D1 name is `skytime`. Put `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `NEXT_PUBLIC_APP_URL` in the Worker environment. `RESEND_API_KEY` and `RESEND_FROM` are optional. `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL` must be the public Workers origin in production.

D1 has no interactive transactions. Each statement commits on its own. Row rules (approved weeks, invoiced locks, project ownership) are SQLite triggers. Invoice creation only updates rows whose `invoice_id` is still null.

## Continuous integration

[CI](.github/workflows/ci.yml) runs on pushes to `main` and pull requests. It installs the lockfile with Node.js 22, audits dependencies for high/critical vulnerabilities, generates Next.js types, checks TypeScript, builds production assets, and applies the SQLite schema twice. The audit currently fails on unpatched `braces` pulled in by vinext. The API/MCP/browser integration tests and desktop/mobile smoke tests run against the production server and a separate `data/skytime-test.sqlite` file. Failed browser runs retain reports and traces for seven days. Trivy scanning runs in its existing workflow.

To reproduce CI tests locally, configure `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` for `http://127.0.0.1:3100`, run `npm run build`, then run `CI=1 npm run test:integration` and `CI=1 npm run demo:screenshots` from the Next.js app directory. Each suite starts and stops its own production server.

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

The app database is the SQLite file locally and D1 in production. Copy `data/skytime.sqlite` (and `data/attachments/` for logos) to back up a local workspace. Production backups are D1 and R2 exports. The Docker Postgres backup scripts in this repo are not the app database.

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

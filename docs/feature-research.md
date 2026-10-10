# Time tracking feature review

Reviewed official product pages on 9 October 2026:

- [Toggl](https://toggl.com/features): timers/manual time, approvals, billable rates, rounding, project estimates and budgets, profitability, tags, filtered reports, capacity planning, templates, and MCP/API access.
- [Harvest](https://www.getharvest.com/features): time and expenses, project budgets, team capacity, reporting, and invoicing.
- [Clockify](https://clockify.me/features): timer/timesheets, projects and clients, reports and exports, approvals, scheduling, time off, expenses, and invoices.

These are reference workflows, not a claim of exact product parity. SkyTime implements them around its multi-tenant SQLite workspace (D1 in production).

| Workflow | SkyTime implementation |
| --- | --- |
| Time capture | Persistent cross-device timer; manual entries; duplicate/resume; notes, billable flag, task links, tags; atomic imports and bulk changes |
| Clients | Contact and address records, currency/default rate, update/archive/restore, preserved history |
| Projects | Client association, rates, cost rates, hours/fee budgets, deadlines, notes, pause/resume, template duplication with task estimates |
| Task management | Existing Kanban board, task estimates and project association; entries can reference task IDs |
| Approvals | Weekly UTC periods, owner submission, admin approval/rejection/reopening; database-enforced locks |
| Reports | Client/project/member/day/tag groups; member attribution; date, search, tag, billable and invoice filters; optional per-entry rounding; saved views; daily time grid |
| Financial accuracy | Captured entry rates/currencies; separately reported currency totals; rounded line amounts; project labor costs/profit and budget consumption |
| Branded documents | Server-generated multipage PDF time reports and invoices; SkyTime logo by default; uploaded PNG/JPEG logo, organization identity, accent, footer and tax settings; CSV formula escaping |
| Billing | Expenses; draft invoices from unbilled time/expenses; atomic item reservation; issued/paid/void states; void releases items; PDF downloads |
| Planning | Daily project allocations, weekly member capacity, actual/planned utilization and overbooking, time-off requests/review/cancellation |
| Automation | Shared REST/MCP action catalog; Zod input schemas; OpenAPI 3.1; Streamable HTTP MCP with embedded export resources; hashed, expiring/revocable personal tokens |
| Controls | Tenant reference checks, current membership/role checks, read-only credentials, origin checks, transactional mutations/audits, last-admin protection |

## Deliberate limits

This is a substantial web-workspace expansion, not a replacement for every product edition and device client. The following are **not implemented**: native desktop/mobile clients, browser extensions, offline synchronization, automatic app/idle tracking, Google/Outlook calendar OAuth sync, external accounting/payments integrations, receipt file storage, XLSX export, recurring project/retainer automation, public report links, scheduled report email delivery, public-holiday calendars, custom workweek schedules, SSO/SCIM, granular project-private roles, and an MCP OAuth authorization server. MCP uses personal bearer credentials.

Invoice state changes do not send email or collect payments. Rates for pre-existing entries are backfilled from the project's rate at migration time because historical rates were not previously stored. Reports use the configured timezone; approval periods retain the application's Monday–Sunday UTC convention. Workload capacity assumes an even Monday–Friday schedule and deducts approved leave, not public holidays. A project fee budget measures billable time revenue; it is not a fixed-fee recognition or retainer engine. Money uses two decimal places; foreign exchange conversion is not performed.

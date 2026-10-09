import { isTrustedOrigin } from "@/lib/request-origin";
import { withResolvedTenant } from "@/lib/tenant";
import { tenantMutation } from "@/lib/db";
import { z } from "zod";
import * as s from "./schemas";
import * as planning from "./planning";
import * as service from "./services";
import {
  ForbiddenError,
  HttpError,
  ValidationError,
  NotFoundError,
} from "@/lib/errors";
import { reportCsv } from "@/lib/reports/data";
import { reportPdf, invoicePdf } from "@/lib/reports/pdf";
import * as workspace from "@/app/api/workspace/route";
import * as clients from "@/app/api/clients/route";
import * as clientItem from "@/app/api/clients/[id]/route";
import * as projects from "@/app/api/projects/route";
import * as projectItem from "@/app/api/projects/[id]/route";
import * as entries from "@/app/api/time-entries/route";
import * as entryItem from "@/app/api/time-entries/[id]/route";
import * as tasks from "@/app/api/tasks/route";
import * as taskItem from "@/app/api/tasks/[id]/route";
import * as periods from "@/app/api/timesheets/route";
import * as periodItem from "@/app/api/timesheets/[id]/route";
import * as settings from "@/app/api/settings/route";
import * as invitations from "@/app/api/invitations/route";
import * as inviteItem from "@/app/api/invitations/[id]/route";
import * as audit from "@/app/api/audit-log/route";
import * as errors from "@/app/api/error-log/route";
export type Action = {
  name: string;
  description: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  schema: z.ZodObject;
  admin?: boolean;
  destructive?: boolean;
  run: (c: service.Context, a: Record<string, unknown>) => Promise<unknown>;
};
function define<S extends z.ZodObject>(
  name: string,
  description: string,
  method: Action["method"],
  path: string,
  schema: S,
  run: (c: service.Context, a: z.infer<S>) => Promise<unknown>,
  options: Pick<Action, "admin" | "destructive"> = {},
): Action {
  return {
    name,
    description,
    method,
    path,
    schema,
    run: run as Action["run"],
    ...options,
  };
}
type Handler = (
  request: Request,
  context?: { params: Promise<{ id: string }> },
) => Promise<Response>;
function legacy(handler: unknown, method: string, path: string) {
  return async (c: service.Context, a: Record<string, unknown>) => {
    const { id, ...body } = a;
    const url = new URL(
      "/api/" + path.replace(":id", String(id ?? "")),
      c.request.url,
    );
    const headers = new Headers(c.request.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    if (method === "GET")
      for (const [k, v] of Object.entries(body))
        if (v !== undefined) url.searchParams.set(k, String(v));
    const request = new Request(url, {
      method,
      headers,
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
    const response = await withResolvedTenant(request, c.tenant, () =>
      (handler as Handler)(request, {
        params: Promise.resolve({ id: String(id ?? "") }),
      }),
    );
    const result = await response.json();
    if (!response.ok)
      throw new HttpError(
        response.status,
        result.error ?? "Request failed",
        result.code,
      );
    return result;
  };
}
const empty = z.object({});
const identity = z.object({ id: s.id });
export const actions: Action[] = [
  define(
    "members_update",
    "Update a member role or weekly capacity. At least one admin must remain.",
    "PATCH",
    "members/:id",
    z.object({
      id: z.string().min(1).max(200),
      role: z.enum(["admin", "member"]).optional(),
      weeklyCapacity: z.number().min(0).max(168).optional(),
    }),
    planning.membersUpdate,
    { admin: true },
  ),
  define(
    "workload_report",
    "Compare scheduled and actual hours with weekday capacity minus approved leave. Dates use the workspace report timezone.",
    "GET",
    "workload",
    z.object({ from: s.date, to: s.date }),
    planning.workload,
  ),
  define(
    "allocations_list",
    "List scheduled project work by member and day.",
    "GET",
    "allocations",
    empty,
    planning.allocationsList,
  ),
  define(
    "allocations_create",
    "Schedule project hours for a workspace member on a date. Admin only.",
    "POST",
    "allocations",
    z.object({
      projectId: s.id,
      userId: z.string().min(1).max(200),
      date: s.date,
      hours: z.number().positive().max(24),
      note: z.string().max(2000).optional(),
    }),
    planning.allocationsCreate,
    { admin: true },
  ),
  define(
    "allocations_delete",
    "Remove scheduled project work. Admin only.",
    "DELETE",
    "allocations/:id",
    identity,
    planning.allocationsDelete,
    { admin: true, destructive: true },
  ),
  define(
    "time_off_list",
    "List your time-off requests; admins see all members.",
    "GET",
    "time-off",
    empty,
    planning.leaveList,
  ),
  define(
    "time_off_create",
    "Request time off for yourself. Overlapping pending/approved requests are rejected.",
    "POST",
    "time-off",
    z.object({
      from: s.date,
      to: s.date,
      note: z.string().max(2000).optional(),
    }),
    planning.leaveCreate,
  ),
  define(
    "time_off_review",
    "Approve or reject a pending time-off request. Approved leave reduces capacity.",
    "PATCH",
    "time-off/:id",
    z.object({ id: s.id, status: z.enum(["approved", "rejected"]) }),
    planning.leaveUpdate,
    { admin: true },
  ),
  define(
    "time_off_cancel",
    "Cancel your time-off request; admins can cancel any request.",
    "DELETE",
    "time-off/:id",
    identity,
    planning.leaveDelete,
    { destructive: true },
  ),
  define(
    "projects_duplicate",
    "Use an existing project as a template: copy budgets, rates, client, notes and tasks. No time or invoices are copied.",
    "POST",
    "projects/:id/duplicate",
    z.object({ id: s.id, name: s.text }),
    service.projectDuplicate,
  ),
  define(
    "time_entries_duplicate",
    "Copy an entry to a new start timestamp under your own account and current project rates.",
    "POST",
    "time-entries/:id/duplicate",
    z.object({ id: s.id, startedAt: z.string().datetime({ offset: true }) }),
    service.entryDuplicate,
  ),
  define(
    "time_entries_resume",
    "Start a new running timer using an existing entry description, project and tags.",
    "POST",
    "time-entries/:id/resume",
    identity,
    service.entryResume,
  ),
  define(
    "clients_get",
    "Read one clients record by id.",
    "GET",
    "clients/:id",
    identity,
    async (c, a) => {
      const rows = await legacy(clients.GET, "GET", "clients")(c, {});
      const row = rows.find((r: { id: string }) => r.id === a.id);
      if (!row) throw new NotFoundError();
      return row;
    },
  ),
  define(
    "projects_get",
    "Read one projects record by id.",
    "GET",
    "projects/:id",
    identity,
    async (c, a) => {
      const rows = await legacy(projects.GET, "GET", "projects")(c, {});
      const row = rows.find((r: { id: string }) => r.id === a.id);
      if (!row) throw new NotFoundError();
      return row;
    },
  ),
  define(
    "time_entries_get",
    "Read one time entries record by id.",
    "GET",
    "time-entries/:id",
    identity,
    async (c, a) => {
      const rows = await legacy(entries.GET, "GET", "time-entries")(c, {});
      const row = rows.find((r: { id: string }) => r.id === a.id);
      if (!row) throw new NotFoundError();
      return row;
    },
  ),
  define(
    "tasks_get",
    "Read one tasks record by id.",
    "GET",
    "tasks/:id",
    identity,
    async (c, a) => {
      const rows = await legacy(tasks.GET, "GET", "tasks")(c, {});
      const row = rows.find((r: { id: string }) => r.id === a.id);
      if (!row) throw new NotFoundError();
      return row;
    },
  ),
  define(
    "workspace_get",
    "Read workspace, projects, clients, tasks, entries, settings, and current approval period.",
    "GET",
    "workspace",
    empty,
    legacy(workspace.GET, "GET", "workspace"),
  ),
  define(
    "clients_list",
    "List active and archived clients.",
    "GET",
    "clients",
    empty,
    legacy(clients.GET, "GET", "clients"),
  ),
  define(
    "clients_create",
    "Create a client with contact, address, currency, and default rate.",
    "POST",
    "clients",
    s.client,
    legacy(clients.POST, "POST", "clients"),
  ),
  define(
    "clients_update",
    "Update or archive/restore a client.",
    "PATCH",
    "clients/:id",
    s.client.partial().extend({ id: s.id }),
    legacy(clientItem.PATCH, "PATCH", "clients/:id"),
  ),
  define(
    "clients_archive",
    "Archive a client while preserving historical records.",
    "DELETE",
    "clients/:id",
    identity,
    legacy(clientItem.DELETE, "DELETE", "clients/:id"),
    { destructive: true },
  ),
  define(
    "projects_list",
    "List projects including budgets, costs, deadlines, and client relationships.",
    "GET",
    "projects",
    empty,
    legacy(projects.GET, "GET", "projects"),
  ),
  define(
    "projects_create",
    "Create a project with client, hourly rate, cost rate, budgets, deadline and notes.",
    "POST",
    "projects",
    s.project,
    legacy(projects.POST, "POST", "projects"),
  ),
  define(
    "projects_update",
    "Update project details, budgets, or pause/resume a project.",
    "PATCH",
    "projects/:id",
    s.project.partial().extend({ id: s.id }),
    legacy(projectItem.PATCH, "PATCH", "projects/:id"),
  ),
  define(
    "projects_delete",
    "Delete a project without recorded time. Pause projects with history instead.",
    "DELETE",
    "projects/:id",
    identity,
    legacy(projectItem.DELETE, "DELETE", "projects/:id"),
    { destructive: true },
  ),
  define(
    "projects_insights",
    "Project hours, revenue, cost, profit, budget consumption, and task progress.",
    "GET",
    "project-insights",
    empty,
    service.projectInsights,
  ),
  define(
    "time_entries_list",
    "Search and filter entries by date, client, project, member, tag, billable/invoiced state. Dates use the workspace timezone.",
    "GET",
    "time-entries",
    s.filters,
    async (c, a) => (await service.buildReport(c.tenant, a)).entries,
  ),
  define(
    "time_entries_create",
    "Log a manual entry. Duration is integer milliseconds. Rates are snapshotted; approved weeks are locked.",
    "POST",
    "time-entries",
    s.entry,
    legacy(entries.POST, "POST", "time-entries"),
  ),
  define(
    "time_entries_update",
    "Edit an unlocked time entry you own (admins may edit any member).",
    "PATCH",
    "time-entries/:id",
    s.entry.partial().extend({ id: s.id }),
    legacy(entryItem.PATCH, "PATCH", "time-entries/:id"),
  ),
  define(
    "time_entries_delete",
    "Delete an unlocked time entry you own.",
    "DELETE",
    "time-entries/:id",
    identity,
    legacy(entryItem.DELETE, "DELETE", "time-entries/:id"),
    { destructive: true },
  ),
  define(
    "time_entries_bulk_update",
    "Atomically edit up to 100 entries; any permission or lock failure rolls back the whole batch.",
    "PATCH",
    "time-entries",
    z.object({
      ids: z.array(s.id).min(1).max(100),
      billable: z.boolean().optional(),
      projectId: s.id.optional(),
      tags: s.tags.optional(),
    }),
    service.entriesBulk,
  ),
  define(
    "time_entries_import",
    "Atomically import up to 100 manual entries. All records must pass validation.",
    "POST",
    "time-entries/import",
    z.object({ entries: z.array(s.entry).min(1).max(100) }),
    service.entriesImport,
  ),
  define(
    "timer_get",
    "Get your persistent running timer, shared across browser and agents.",
    "GET",
    "timer",
    empty,
    service.timerGet,
  ),
  define(
    "timer_start",
    "Start your timer. Only one timer per user and workspace; starting another returns a conflict.",
    "POST",
    "timer",
    z.object({
      projectId: s.id,
      task: z.string().trim().min(1).max(500),
      notes: z.string().max(5000).optional(),
      billable: z.boolean().optional(),
      tags: s.tags.optional(),
      startedAt: z.string().datetime({ offset: true }).optional(),
    }),
    service.timerStart,
  ),
  define(
    "timer_stop",
    "Stop a specific running timer and save one time entry atomically. Use its id from timer_get/start.",
    "POST",
    "timer/stop",
    z.object({
      id: s.id,
      stoppedAt: z.string().datetime({ offset: true }).optional(),
      task: z.string().trim().min(1).max(500).optional(),
      notes: z.string().max(5000).optional(),
      billable: z.boolean().optional(),
      projectId: s.id.optional(),
    }),
    service.timerStop,
  ),
  define(
    "timer_discard",
    "Discard a specific running timer without logging time.",
    "DELETE",
    "timer/:id",
    identity,
    service.timerDiscard,
    { destructive: true },
  ),
  define(
    "tasks_list",
    "List the project task board.",
    "GET",
    "tasks",
    empty,
    legacy(tasks.GET, "GET", "tasks"),
  ),
  define(
    "tasks_create",
    "Create a project task with estimate and board status.",
    "POST",
    "tasks",
    s.task,
    legacy(tasks.POST, "POST", "tasks"),
  ),
  define(
    "tasks_update",
    "Update, reassign, estimate, or move a task across board columns.",
    "PATCH",
    "tasks/:id",
    s.task.partial().extend({ id: s.id }),
    legacy(taskItem.PATCH, "PATCH", "tasks/:id"),
  ),
  define(
    "tasks_delete",
    "Delete a task.",
    "DELETE",
    "tasks/:id",
    identity,
    legacy(taskItem.DELETE, "DELETE", "tasks/:id"),
    { destructive: true },
  ),
  define(
    "tags_list",
    "List the workspace tag catalog.",
    "GET",
    "tags",
    empty,
    service.tagsList,
  ),
  define(
    "tags_create",
    "Create a reusable tag. Entry tags are labels and retain history.",
    "POST",
    "tags",
    z.object({
      name: s.text.max(60),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    }),
    service.tagsCreate,
  ),
  define(
    "tags_delete",
    "Remove a tag from the catalog; historical entry labels are retained.",
    "DELETE",
    "tags/:id",
    identity,
    service.tagsDelete,
    { destructive: true },
  ),
  define(
    "timesheets_list",
    "List your weekly timesheets, or all members for admins with scope=all.",
    "GET",
    "timesheets",
    z.object({
      scope: z.enum(["mine", "all"]).optional(),
      status: z.enum(["draft", "submitted", "approved", "rejected"]).optional(),
    }),
    legacy(periods.GET, "GET", "timesheets"),
  ),
  define(
    "timesheets_create",
    "Get or create your Monday–Sunday UTC approval week containing a date.",
    "POST",
    "timesheets",
    z.object({ date: s.date }),
    service.periodCreate,
  ),
  define(
    "timesheets_get",
    "Read a weekly timesheet.",
    "GET",
    "timesheets/:id",
    identity,
    legacy(periodItem.GET, "GET", "timesheets/:id"),
  ),
  define(
    "timesheets_transition",
    "Submit your timesheet; admins can approve, reject, or reopen. Stop the timer before approval.",
    "POST",
    "timesheets/:id",
    z.object({
      id: s.id,
      action: z.enum(["submit", "approve", "reject", "reopen"]),
      note: z.string().max(2000).optional(),
    }),
    legacy(periodItem.POST, "POST", "timesheets/:id"),
  ),
  define(
    "reports_summary",
    "Build a detailed report with summary groups, exact entry data, and separate currency totals.",
    "GET",
    "reports",
    s.filters,
    async (c, a) => service.buildReport(c.tenant, a),
  ),
  define(
    "reports_export",
    "Generate a branded, paginated PDF or spreadsheet-safe CSV. MCP returns an embedded file resource.",
    "GET",
    "reports/export",
    s.filters.extend({ format: z.enum(["pdf", "csv"]) }),
    async (c, a) => {
      const r = await service.buildReport(c.tenant, a);
      const pdf = a.format === "pdf";
      const buffer = pdf ? await reportPdf(r) : Buffer.from(reportCsv(r));
      return new Response(new Uint8Array(buffer), {
        headers: {
          "content-type": pdf ? "application/pdf" : "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="skytime-report.${a.format}"`,
          "cache-control": "private, no-store",
        },
      });
    },
  ),
  define(
    "saved_reports_list",
    "List your saved report filters.",
    "GET",
    "saved-reports",
    empty,
    service.savedList,
  ),
  define(
    "saved_reports_create",
    "Save a named report filter for reuse.",
    "POST",
    "saved-reports",
    z.object({ name: s.text, filters: s.filters }),
    service.savedCreate,
  ),
  define(
    "saved_reports_delete",
    "Delete one of your saved report presets.",
    "DELETE",
    "saved-reports/:id",
    identity,
    service.savedDelete,
    { destructive: true },
  ),
  define(
    "branding_get",
    "Read organization report identity, logo, tax, currency and timezone.",
    "GET",
    "branding",
    empty,
    async (c) => service.getBranding(c.tenant),
  ),
  define(
    "branding_update",
    "Configure report branding. Logo accepts a PNG/JPEG data URL up to 1 MB. Admin only.",
    "PATCH",
    "branding",
    s.branding,
    service.brandingUpdate,
    { admin: true },
  ),
  define(
    "expenses_list",
    "List project expenses and their invoice state.",
    "GET",
    "expenses",
    empty,
    service.expensesList,
  ),
  define(
    "expenses_create",
    "Record a billable or non-billable project expense.",
    "POST",
    "expenses",
    z.object({
      projectId: s.id,
      date: s.date,
      description: s.text,
      category: s.text.optional(),
      amount: s.money.positive(),
      currency: s.currency,
      billable: z.boolean().optional(),
    }),
    service.expensesCreate,
  ),
  define(
    "expenses_delete",
    "Delete your uninvoiced expense (or any uninvoiced expense as admin).",
    "DELETE",
    "expenses/:id",
    identity,
    service.expensesDelete,
    { destructive: true },
  ),
  define(
    "invoices_list",
    "List invoices with immutable billing snapshots. Admin only.",
    "GET",
    "invoices",
    empty,
    service.invoicesList,
    { admin: true },
  ),
  define(
    "invoices_get",
    "Read invoice line items, client snapshot, tax and totals. Admin only.",
    "GET",
    "invoices/:id",
    identity,
    service.invoiceGet,
    { admin: true },
  ),
  define(
    "invoices_create",
    "Create a draft invoice from all unbilled time and expenses for a client and period. Atomically reserves items to prevent double billing. Admin only.",
    "POST",
    "invoices",
    z.object({
      clientId: s.id,
      number: s.text,
      from: s.date,
      to: s.date,
      issuedDate: s.date,
      dueDate: s.date,
      taxPercent: z.number().min(0).max(100).multipleOf(0.01),
      notes: z.string().max(5000).optional(),
    }),
    service.invoiceCreate,
    { admin: true },
  ),
  define(
    "invoices_update",
    "Mark draft as issued, issued as paid, or draft/issued as void. Voiding releases items. This does not send email or collect payments.",
    "PATCH",
    "invoices/:id",
    z.object({ id: s.id, status: z.enum(["issued", "paid", "void"]) }),
    service.invoiceUpdate,
    { admin: true },
  ),
  define(
    "invoices_export",
    "Download a branded invoice PDF. Admin only.",
    "GET",
    "invoices/:id/pdf",
    identity,
    async (c, a) => {
      const i = await service.invoiceGet(c, a);
      const b = i.branding_snapshot ?? (await service.getBranding(c.tenant));
      return new Response(new Uint8Array(await invoicePdf(i, b)), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="skytime-invoice.pdf"',
          "cache-control": "private, no-store",
        },
      });
    },
    { admin: true },
  ),
  define(
    "members_list",
    "List workspace members and roles.",
    "GET",
    "members",
    empty,
    service.membersList,
  ),
  define(
    "invitations_list",
    "List organization invitations. Admin only.",
    "GET",
    "invitations",
    empty,
    legacy(invitations.GET, "GET", "invitations"),
    { admin: true },
  ),
  define(
    "invitations_create",
    "Invite a member or admin. Sends an invitation email when email delivery is configured.",
    "POST",
    "invitations",
    z.object({
      email: z.string().email(),
      role: z.enum(["admin", "member"]).optional(),
    }),
    legacy(invitations.POST, "POST", "invitations"),
    { admin: true },
  ),
  define(
    "invitations_revoke",
    "Revoke an invitation. Admin only.",
    "DELETE",
    "invitations/:id",
    identity,
    legacy(inviteItem.DELETE, "DELETE", "invitations/:id"),
    { admin: true, destructive: true },
  ),
  define(
    "settings_get",
    "Read reminder and financial year settings.",
    "GET",
    "settings",
    empty,
    legacy(settings.GET, "GET", "settings"),
  ),
  define(
    "settings_update",
    "Update reminder cadence and financial year settings.",
    "PATCH",
    "settings",
    z.object({
      fyStartMonth: z.number().int().min(1).max(12).optional(),
      reminders: z
        .object({
          enabled: z.boolean().optional(),
          cadenceMinutes: z.number().int().min(5).max(1440).optional(),
          lastSentAt: z.string().datetime({ offset: true }).optional(),
        })
        .optional(),
    }),
    legacy(settings.PATCH, "PATCH", "settings"),
  ),
  define(
    "audit_log_list",
    "Read audit trail. Admin only.",
    "GET",
    "audit-log",
    z.object({ limit: z.number().int().min(1).max(200).optional() }),
    legacy(audit.GET, "GET", "audit-log"),
    { admin: true },
  ),
  define(
    "error_log_list",
    "Read captured application errors. Admin only.",
    "GET",
    "error-log",
    z.object({ limit: z.number().int().min(1).max(200).optional() }),
    legacy(errors.GET, "GET", "error-log"),
    { admin: true },
  ),
  define(
    "tokens_list",
    "List your automation credentials without exposing their secrets.",
    "GET",
    "tokens",
    empty,
    service.tokensList,
  ),
  define(
    "tokens_create",
    "Create an expiring read or write token. Requires browser session; bearer credentials cannot mint new credentials. Secret returned once.",
    "POST",
    "tokens",
    z.object({
      name: s.text,
      scope: z.enum(["read", "write"]),
      expiresInDays: z.number().int().min(1).max(365),
    }),
    service.tokensCreate,
  ),
  define(
    "tokens_revoke",
    "Revoke one of your automation credentials immediately.",
    "DELETE",
    "tokens/:id",
    identity,
    service.tokensRevoke,
    { destructive: true },
  ),
];
export async function executeAction(
  action: Action,
  c: service.Context,
  input: unknown,
) {
  if (action.admin) service.admin(c);
  if (c.tenant.tokenScope === "read" && action.method !== "GET")
    throw new ForbiddenError("This API token is read-only");
  const origin = c.request.headers.get("origin");
  if (
    !c.tenant.tokenScope &&
    action.method !== "GET" &&
    origin &&
    !isTrustedOrigin(c.request)
  )
    throw new ForbiddenError("Cross-origin mutation rejected");
  const parsed = action.schema.strict().safeParse(input);
  if (!parsed.success)
    throw new ValidationError(
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return action.method === "GET"
    ? action.run(c, parsed.data)
    : tenantMutation(c.tenant.organization.id, () =>
        action.run(c, parsed.data),
      );
}
export function actionCatalog() {
  return actions.map((a) => ({
    name: a.name,
    description: a.description,
    method: a.method,
    path: "/api/v1/" + a.path,
    admin: a.admin ?? false,
    inputSchema: z.toJSONSchema(a.schema),
  }));
}

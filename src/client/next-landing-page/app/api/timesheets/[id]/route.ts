import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTenant } from "@/lib/route";
import { optString, readJson, requireUuid } from "@/lib/validation";
import { PERIOD_COLUMNS, periodFromRow, refreshPeriodTotals, type TimesheetPeriodRow } from "@/lib/workspace-repository";

export const runtime = "nodejs";

type Params = { id: string };

async function loadPeriod(organizationId: string, periodId: string) {
  const result = await query<TimesheetPeriodRow & { user_email: string | null }>(
    `select tp.id, tp.user_id, tp.reviewer_email, tp.period_start, tp.period_end,
            tp.status, tp.submitted_at, tp.reviewed_at, tp.reviewed_by, tp.note, tp.total_ms,
            u.email as user_email
     from timesheet_periods tp
     left join "user" u on u.id = tp.user_id
     where tp.id = $1 and tp.organization_id = $2`,
    [periodId, organizationId],
  );
  if (!result.rows[0]) throw new NotFoundError("Timesheet period not found");
  return result.rows[0];
}

export const GET = withTenant<Params>(async ({ tenant, params }) => {
  const id = requireUuid(params.id, "Period id");
  const row = await loadPeriod(tenant.organization.id, id);
  if (row.user_id !== tenant.user.id && tenant.organization.role !== "admin") {
    throw new ForbiddenError("You can only view your own timesheets");
  }
  return periodFromRow(row, row.user_email);
});

export const POST = withTenant<Params>(async ({ tenant, request, params }) => {
  const id = requireUuid(params.id, "Period id");
  const body = await readJson(request);
  const action = String(body.action ?? "").toLowerCase();
  const note = optString(body.note, "Note", 2000);

  const row = await loadPeriod(tenant.organization.id, id);
  const isOwner = row.user_id === tenant.user.id;
  const isAdmin = tenant.organization.role === "admin";

  if (action === "submit") {
    if (!isOwner) throw new ForbiddenError("Only the owner can submit a timesheet");
    if (row.status === "approved") throw new ConflictError("Timesheet is already approved");
    await refreshPeriodTotals(tenant.organization.id, row.user_id, row.period_start.toISOString().slice(0, 10));
    const updated = await query<TimesheetPeriodRow & { user_email: string | null }>(
      `update timesheet_periods
       set status = 'submitted', submitted_at = now(), note = $3, updated_at = now()
       where id = $1 and organization_id = $2
       returning ${PERIOD_COLUMNS}, null::text as user_email`,
      [id, tenant.organization.id, note],
    );
    await recordAudit({
      tenant,
      request,
      action: "submit",
      entityType: "timesheet_period",
      entityId: id,
      summary: `Submitted week ${updated.rows[0].period_start.toISOString().slice(0, 10)}`,
      before: periodFromRow(row, row.user_email),
      after: periodFromRow(updated.rows[0]),
    });
    return periodFromRow(updated.rows[0], row.user_email);
  }

  if (action === "approve" || action === "reject") {
    if (!isAdmin) throw new ForbiddenError("Only admins can review timesheets");
    if (row.status !== "submitted" && action === "approve") {
      throw new ConflictError("Only submitted timesheets can be approved");
    }
    if (row.status !== "submitted" && action === "reject") {
      throw new ConflictError("Only submitted timesheets can be rejected");
    }
    const nextStatus = action === "approve" ? "approved" : "rejected";
    const updated = await query<TimesheetPeriodRow & { user_email: string | null }>(
      `update timesheet_periods
       set status = $3,
           reviewed_at = now(),
           reviewed_by = $4,
           reviewer_email = $5,
           note = case when $6 = '' then note else $6 end,
           updated_at = now()
       where id = $1 and organization_id = $2
       returning ${PERIOD_COLUMNS}, null::text as user_email`,
      [id, tenant.organization.id, nextStatus, tenant.user.id, tenant.user.email, note],
    );
    await recordAudit({
      tenant,
      request,
      action: action === "approve" ? "approve" : "reject",
      entityType: "timesheet_period",
      entityId: id,
      summary: `${action === "approve" ? "Approved" : "Rejected"} week ${updated.rows[0].period_start
        .toISOString()
        .slice(0, 10)} for ${row.user_email ?? row.user_id}`,
      before: periodFromRow(row, row.user_email),
      after: periodFromRow(updated.rows[0]),
    });
    return periodFromRow(updated.rows[0], row.user_email);
  }

  if (action === "reopen") {
    if (!isAdmin) throw new ForbiddenError("Only admins can reopen timesheets");
    if (row.status === "draft") throw new ConflictError("Timesheet is already open");
    const updated = await query<TimesheetPeriodRow & { user_email: string | null }>(
      `update timesheet_periods
       set status = 'draft', submitted_at = null, reviewed_at = null, reviewed_by = null,
           reviewer_email = null, note = '', updated_at = now()
       where id = $1 and organization_id = $2
       returning ${PERIOD_COLUMNS}, null::text as user_email`,
      [id, tenant.organization.id],
    );
    await recordAudit({
      tenant,
      request,
      action: "update",
      entityType: "timesheet_period",
      entityId: id,
      summary: `Reopened week ${updated.rows[0].period_start.toISOString().slice(0, 10)}`,
      before: periodFromRow(row, row.user_email),
      after: periodFromRow(updated.rows[0]),
    });
    return periodFromRow(updated.rows[0], row.user_email);
  }

  throw new ValidationError("Unknown action. Use submit, approve, reject, or reopen.");
});

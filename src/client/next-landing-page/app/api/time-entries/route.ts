import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { withTenant } from "@/lib/route";
import { optBoolean, optString, readJson, requirePositiveNumber, requireString, requireUuid } from "@/lib/validation";
import {
  currentPeriodWindow,
  entryFromRow,
  isEntryLocked,
  listEntries,
  refreshPeriodTotals,
  TIME_ENTRY_COLUMNS,
  type TimeEntryRow,
} from "@/lib/workspace-repository";

export const runtime = "nodejs";

export const GET = withTenant(async ({ tenant }) => {
  return listEntries(tenant.organization.id);
});

export const POST = withTenant(async ({ tenant, request }) => {
  const body = await readJson(request);
  const projectId = requireUuid(body.projectId, "Project");
  const task = requireString(body.task, "Task", 500);
  const notes = optString(body.notes, "Notes", 5000);
  const startedAtRaw = requireString(body.startedAt, "Start time", 64);
  const startedAt = new Date(startedAtRaw);
  if (Number.isNaN(startedAt.getTime())) {
    throw new ValidationError("Start time is invalid");
  }
  const durationMs = Math.round(requirePositiveNumber(body.durationMs, "Duration"));
  const billable = optBoolean(body.billable, "Billable") ?? true;

  if (await isEntryLocked(tenant.organization.id, tenant.user.id, startedAt)) {
    throw new ValidationError("This week is approved and locked. Ask an admin to reopen it.");
  }

  const result = await query<TimeEntryRow>(
    `insert into time_entries
        (organization_id, project_id, user_id, task, notes, started_at, duration_ms, billable)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning ${TIME_ENTRY_COLUMNS}`,
    [
      tenant.organization.id,
      projectId,
      tenant.user.id,
      task,
      notes,
      startedAt.toISOString(),
      durationMs,
      billable,
    ],
  );

  const entry = entryFromRow(result.rows[0]);
  const window = currentPeriodWindow(startedAt);
  await refreshPeriodTotals(tenant.organization.id, tenant.user.id, window.start);

  await recordAudit({
    tenant,
    request,
    action: "create",
    entityType: "time_entry",
    entityId: entry.id,
    summary: `Logged ${task}`,
    after: entry,
  });

  return new Response(JSON.stringify(entry), { status: 201, headers: { "content-type": "application/json" } });
});

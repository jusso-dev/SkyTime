import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTenant } from "@/lib/route";
import { optBoolean, readJson, requireUuid } from "@/lib/validation";
import {
  currentPeriodWindow,
  entryFromRow,
  isEntryLocked,
  refreshPeriodTotals,
  TIME_ENTRY_COLUMNS,
  type TimeEntryRow,
} from "@/lib/workspace-repository";

export const runtime = "nodejs";

type Params = { id: string };

async function loadEntry(organizationId: string, entryId: string) {
  const current = await query<TimeEntryRow>(
    `select ${TIME_ENTRY_COLUMNS} from time_entries where id = $1 and organization_id = $2`,
    [entryId, organizationId],
  );
  if (!current.rows[0]) throw new NotFoundError("Entry not found");
  return current.rows[0];
}

export const PATCH = withTenant<Params>(async ({ tenant, request, params }) => {
  const id = requireUuid(params.id, "Entry id");
  const body = await readJson(request);
  const existing = await loadEntry(tenant.organization.id, id);

  if (existing.user_id && existing.user_id !== tenant.user.id && tenant.organization.role !== "admin") {
    throw new ConflictError("Only admins can edit other people's entries");
  }

  const lockUserId = existing.user_id;
  if (await isEntryLocked(tenant.organization.id, lockUserId, existing.started_at)) {
    throw new ConflictError("Entry is part of an approved week and is locked");
  }

  if (body.task !== undefined && (typeof body.task !== "string" || !body.task.trim())) {
    throw new ValidationError("Task is required");
  }

  const before = entryFromRow(existing);
  const newStartedAt =
    body.startedAt === undefined ? existing.started_at : new Date(String(body.startedAt));
  if (newStartedAt instanceof Date && Number.isNaN(newStartedAt.getTime())) {
    throw new ValidationError("Start time is invalid");
  }
  if (body.startedAt !== undefined && lockUserId &&
      await isEntryLocked(tenant.organization.id, lockUserId, newStartedAt as Date)) {
    throw new ConflictError("Cannot move entry into an approved week");
  }

  const result = await query<TimeEntryRow>(
    `update time_entries
     set project_id = $2, task = $3, notes = $4, started_at = $5, duration_ms = $6, billable = $7, updated_at = now()
     where id = $1 and organization_id = $8
     returning ${TIME_ENTRY_COLUMNS}`,
    [
      id,
      body.projectId ?? existing.project_id,
      typeof body.task === "string" && body.task.trim() ? body.task.trim() : existing.task,
      typeof body.notes === "string" ? body.notes.trim() : existing.notes,
      newStartedAt,
      body.durationMs === undefined ? existing.duration_ms : Math.max(1, Math.round(Number(body.durationMs))),
      optBoolean(body.billable, "Billable") ?? existing.billable,
      tenant.organization.id,
    ],
  );

  const updated = entryFromRow(result.rows[0]);
  if (lockUserId) {
    const window = currentPeriodWindow(
      typeof newStartedAt === "string" ? new Date(newStartedAt) : newStartedAt,
    );
    await refreshPeriodTotals(tenant.organization.id, lockUserId, window.start);
  }

  await recordAudit({
    tenant,
    request,
    action: "update",
    entityType: "time_entry",
    entityId: updated.id,
    summary: `Updated entry ${updated.task}`,
    before,
    after: updated,
  });

  return updated;
});

export const DELETE = withTenant<Params>(async ({ tenant, request, params }) => {
  const id = requireUuid(params.id, "Entry id");
  const existing = await loadEntry(tenant.organization.id, id);
  if (existing.user_id && existing.user_id !== tenant.user.id && tenant.organization.role !== "admin") {
    throw new ConflictError("Only admins can delete other people's entries");
  }
  if (await isEntryLocked(tenant.organization.id, existing.user_id, existing.started_at)) {
    throw new ConflictError("Entry is part of an approved week and is locked");
  }

  const result = await query<TimeEntryRow>(
    `delete from time_entries where id = $1 and organization_id = $2 returning ${TIME_ENTRY_COLUMNS}`,
    [id, tenant.organization.id],
  );
  if (!result.rows[0]) throw new NotFoundError("Entry not found");
  const removed = entryFromRow(result.rows[0]);

  if (removed.userId) {
    const window = currentPeriodWindow(new Date(removed.startedAt));
    await refreshPeriodTotals(tenant.organization.id, removed.userId, window.start);
  }

  await recordAudit({
    tenant,
    request,
    action: "delete",
    entityType: "time_entry",
    entityId: removed.id,
    summary: `Deleted entry ${removed.task}`,
    before: removed,
  });

  return { ok: true };
});

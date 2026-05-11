import { NextResponse } from "next/server";
import { badRequest, notFound, serverError } from "@/lib/api-response";
import { query } from "@/lib/db";
import { entryFromRow, type TimeEntryRow } from "@/lib/workspace-repository";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenant, error } = await requireTenant(request);
    if (error || !tenant) return error;

    const { id } = await context.params;
    const body = await request.json();
    if (body.task !== undefined && !body.task.trim()) return badRequest("Task is required");

    const current = await query<TimeEntryRow>(
      "select id, project_id, task, notes, started_at, duration_ms, billable from time_entries where id = $1 and organization_id = $2",
      [id, tenant.organization.id],
    );
    if (!current.rows[0]) return notFound("Entry not found");

    const existing = current.rows[0];
    const result = await query<TimeEntryRow>(
      `update time_entries
       set project_id = $2, task = $3, notes = $4, started_at = $5, duration_ms = $6, billable = $7, updated_at = now()
       where id = $1 and organization_id = $8
       returning id, project_id, task, notes, started_at, duration_ms, billable`,
      [
        id,
        body.projectId ?? existing.project_id,
        body.task?.trim() ?? existing.task,
        body.notes?.trim() ?? existing.notes,
        body.startedAt ?? existing.started_at,
        body.durationMs === undefined ? existing.duration_ms : Math.max(1, Math.round(Number(body.durationMs))),
        body.billable === undefined ? existing.billable : Boolean(body.billable),
        tenant.organization.id,
      ],
    );

    return NextResponse.json(entryFromRow(result.rows[0]));
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { tenant, error } = await requireTenant(_request);
    if (error || !tenant) return error;

    const { id } = await context.params;
    const result = await query("delete from time_entries where id = $1 and organization_id = $2 returning id", [id, tenant.organization.id]);
    if (!result.rows[0]) return notFound("Entry not found");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

import { NextResponse } from "next/server";
import { badRequest, serverError } from "@/lib/api-response";
import { query } from "@/lib/db";
import { entryFromRow, listEntries, type TimeEntryRow } from "@/lib/workspace-repository";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { tenant, error } = await requireTenant(request);
    if (error || !tenant) return error;
    return NextResponse.json(await listEntries(tenant.organization.id));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { tenant, error } = await requireTenant(request);
    if (error || !tenant) return error;

    const body = await request.json();
    if (!body.projectId) return badRequest("Project is required");
    if (!body.task?.trim()) return badRequest("Task is required");
    if (!body.startedAt) return badRequest("Start time is required");

    const durationMs = Math.round(Number(body.durationMs));
    if (!durationMs || durationMs <= 0) return badRequest("Duration must be greater than zero");

    const result = await query<TimeEntryRow>(
      `insert into time_entries (organization_id, project_id, task, notes, started_at, duration_ms, billable)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, project_id, task, notes, started_at, duration_ms, billable`,
      [tenant.organization.id, body.projectId, body.task.trim(), body.notes?.trim() ?? "", body.startedAt, durationMs, body.billable !== false],
    );

    return NextResponse.json(entryFromRow(result.rows[0]), { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

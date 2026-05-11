import { NextResponse } from "next/server";
import { badRequest, serverError } from "@/lib/api-response";
import { query } from "@/lib/db";
import { listTasks, taskFromRow, type BoardTaskRow } from "@/lib/workspace-repository";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { tenant, error } = await requireTenant(request);
    if (error || !tenant) return error;
    return NextResponse.json(await listTasks(tenant.organization.id));
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
    if (!body.title?.trim()) return badRequest("Task title is required");

    const result = await query<BoardTaskRow>(
      `insert into board_tasks (organization_id, project_id, title, status, estimate_hours)
       values ($1, $2, $3, $4, $5)
       returning id, project_id, title, status, estimate_hours`,
      [tenant.organization.id, body.projectId, body.title.trim(), body.status ?? "Backlog", Number(body.estimateHours) || 1],
    );

    return NextResponse.json(taskFromRow(result.rows[0]), { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

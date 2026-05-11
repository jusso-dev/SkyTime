import { NextResponse } from "next/server";
import { badRequest, notFound, serverError } from "@/lib/api-response";
import { query } from "@/lib/db";
import { taskFromRow, type BoardTaskRow } from "@/lib/workspace-repository";
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
    if (body.title !== undefined && !body.title.trim()) return badRequest("Task title is required");

    const current = await query<BoardTaskRow>(
      "select id, project_id, title, status, estimate_hours from board_tasks where id = $1 and organization_id = $2",
      [id, tenant.organization.id],
    );
    if (!current.rows[0]) return notFound("Task not found");

    const existing = current.rows[0];
    const result = await query<BoardTaskRow>(
      `update board_tasks
       set project_id = $2, title = $3, status = $4, estimate_hours = $5, updated_at = now()
       where id = $1 and organization_id = $6
       returning id, project_id, title, status, estimate_hours`,
      [
        id,
        body.projectId ?? existing.project_id,
        body.title?.trim() ?? existing.title,
        body.status ?? existing.status,
        body.estimateHours === undefined ? existing.estimate_hours : Number(body.estimateHours) || 1,
        tenant.organization.id,
      ],
    );

    return NextResponse.json(taskFromRow(result.rows[0]));
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { tenant, error } = await requireTenant(_request);
    if (error || !tenant) return error;

    const { id } = await context.params;
    const result = await query("delete from board_tasks where id = $1 and organization_id = $2 returning id", [id, tenant.organization.id]);
    if (!result.rows[0]) return notFound("Task not found");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

import { NextResponse } from "next/server";
import { badRequest, notFound, serverError } from "@/lib/api-response";
import { query } from "@/lib/db";
import { projectFromRow, type ProjectRow } from "@/lib/workspace-repository";
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
    if (body.name !== undefined && !body.name.trim()) return badRequest("Project name is required");

    const current = await query<ProjectRow>(
      "select id, name, client, rate, color, status from projects where id = $1 and organization_id = $2",
      [id, tenant.organization.id],
    );
    if (!current.rows[0]) return notFound("Project not found");

    const existing = current.rows[0];
    const result = await query<ProjectRow>(
      `update projects
       set name = $2, client = $3, rate = $4, color = $5, status = $6, updated_at = now()
       where id = $1 and organization_id = $7
       returning id, name, client, rate, color, status`,
      [
        id,
        body.name?.trim() ?? existing.name,
        body.client?.trim() ?? existing.client,
        body.rate === undefined ? existing.rate : Number(body.rate) || 0,
        body.color ?? existing.color,
        body.status === "Paused" || body.status === "Active" ? body.status : existing.status,
        tenant.organization.id,
      ],
    );

    return NextResponse.json(projectFromRow(result.rows[0]));
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { tenant, error } = await requireTenant(_request);
    if (error || !tenant) return error;

    const { id } = await context.params;
    const result = await query("delete from projects where id = $1 and organization_id = $2 returning id", [id, tenant.organization.id]);
    if (!result.rows[0]) return notFound("Project not found");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

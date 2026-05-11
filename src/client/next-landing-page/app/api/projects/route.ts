import { NextResponse } from "next/server";
import { badRequest, serverError } from "@/lib/api-response";
import { query } from "@/lib/db";
import { listProjects, projectFromRow, type ProjectRow } from "@/lib/workspace-repository";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { tenant, error } = await requireTenant(request);
    if (error || !tenant) return error;
    return NextResponse.json(await listProjects(tenant.organization.id));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { tenant, error } = await requireTenant(request);
    if (error || !tenant) return error;

    const body = await request.json();
    if (!body.name?.trim()) return badRequest("Project name is required");

    const result = await query<ProjectRow>(
      `insert into projects (organization_id, name, client, rate, color, status)
       values ($1, $2, $3, $4, $5, $6)
       returning id, name, client, rate, color, status`,
      [
        tenant.organization.id,
        body.name.trim(),
        body.client?.trim() || "No client",
        Number(body.rate) || 0,
        body.color || "oklch(0.56 0.13 155)",
        body.status === "Paused" ? "Paused" : "Active",
      ],
    );

    return NextResponse.json(projectFromRow(result.rows[0]), { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

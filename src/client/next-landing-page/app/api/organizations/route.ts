import { NextResponse } from "next/server";
import { badRequest, serverError } from "@/lib/api-response";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { user, error } = await requireUser(request);
    if (error || !user) return error;

    const body = await request.json();
    if (!body.name?.trim()) return badRequest("Organization name is required");

    const existing = await query("select id from organization_memberships where user_id = $1 limit 1", [user.id]);
    if (existing.rows[0]) return badRequest("User already belongs to an organization");

    const org = await query<{ id: string; name: string }>(
      "insert into organizations (name) values ($1) returning id, name",
      [body.name.trim()],
    );

    await query(
      "insert into organization_memberships (organization_id, user_id, role) values ($1, $2, 'admin')",
      [org.rows[0].id, user.id],
    );

    await query("insert into workspace_settings (organization_id) values ($1) on conflict do nothing", [org.rows[0].id]);

    return NextResponse.json({ organization: { ...org.rows[0], role: "admin" } }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

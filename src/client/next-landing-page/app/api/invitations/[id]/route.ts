import { NextResponse } from "next/server";
import { notFound, serverError } from "@/lib/api-response";
import { query } from "@/lib/db";
import { requireAdmin, requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { tenant, error } = await requireTenant(_request);
    if (error || !tenant) return error;

    const adminError = requireAdmin(tenant);
    if (adminError) return adminError;

    const { id } = await context.params;
    const result = await query(
      "update organization_invites set status = 'revoked' where id = $1 and organization_id = $2 returning id",
      [id, tenant.organization.id],
    );
    if (!result.rows[0]) return notFound("Invite not found");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

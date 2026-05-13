import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { captureError, errorResponse, HttpError } from "@/lib/errors";
import { getSessionUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return NextResponse.json({ user: null, organization: null });

    const membership = await query<{ id: string; name: string; role: "admin" | "member" }>(
      `select o.id, o.name, m.role
       from organization_memberships m
       join organizations o on o.id = m.organization_id
       where m.user_id = $1
       order by m.created_at asc
       limit 1`,
      [user.id],
    );

    return NextResponse.json({ user, organization: membership.rows[0] ?? null });
  } catch (error) {
    await captureError(error, {
      request,
      status: error instanceof HttpError ? error.status : 500,
    });
    return errorResponse(error);
  }
}

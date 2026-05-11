import { NextResponse } from "next/server";
import { badRequest, serverError } from "@/lib/api-response";
import { query } from "@/lib/db";
import { getAppUrl, sendOrganizationInviteEmail } from "@/lib/email";
import { requireAdmin, requireTenant } from "@/lib/tenant";
import type { OrganizationInvite } from "@/lib/workspace-types";

export const runtime = "nodejs";

type InviteRow = {
  id: string;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "revoked";
  created_at: Date;
};

function inviteFromRow(row: InviteRow): OrganizationInvite {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const { tenant, error } = await requireTenant(request);
    if (error || !tenant) return error;

    const adminError = requireAdmin(tenant);
    if (adminError) return adminError;

    const result = await query<InviteRow>(
      `select id, email, role, status, created_at
       from organization_invites
       where organization_id = $1
       order by created_at desc`,
      [tenant.organization.id],
    );

    return NextResponse.json(result.rows.map(inviteFromRow));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { tenant, error } = await requireTenant(request);
    if (error || !tenant) return error;

    const adminError = requireAdmin(tenant);
    if (adminError) return adminError;

    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) return badRequest("A valid invite email is required");

    const role = body.role === "admin" ? "admin" : "member";
    const result = await query<InviteRow>(
      `insert into organization_invites (organization_id, email, role, invited_by)
       values ($1, $2, $3, $4)
       on conflict (organization_id, email)
       do update set role = excluded.role, status = 'pending', invited_by = excluded.invited_by, created_at = now(), accepted_at = null
       returning id, email, role, status, created_at`,
      [tenant.organization.id, email, role, tenant.user.id],
    );

    const invite = inviteFromRow(result.rows[0]);
    const inviteUrl = `${getAppUrl(request.url)}/?invite=${invite.id}`;
    const delivery = await sendOrganizationInviteEmail({
      acceptUrl: inviteUrl,
      email: invite.email,
      invitedBy: tenant.user.name || tenant.user.email,
      organizationName: tenant.organization.name,
      role: invite.role,
    });

    return NextResponse.json({ ...invite, emailSent: delivery.sent, inviteUrl }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

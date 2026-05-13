import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { getAppUrl, sendOrganizationInviteEmail } from "@/lib/email";
import { withTenant } from "@/lib/route";
import { readJson } from "@/lib/validation";
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

export const GET = withTenant(async ({ tenant }) => {
  const result = await query<InviteRow>(
    `select id, email, role, status, created_at
     from organization_invites
     where organization_id = $1
     order by created_at desc`,
    [tenant.organization.id],
  );
  return result.rows.map(inviteFromRow);
}, { admin: true });

export const POST = withTenant(async ({ tenant, request }) => {
  const body = await readJson(request);
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new ValidationError("A valid invite email is required");
  }
  const role = body.role === "admin" ? "admin" : "member";

  const result = await query<InviteRow>(
    `insert into organization_invites (organization_id, email, role, invited_by)
     values ($1, $2, $3, $4)
     on conflict (organization_id, email)
     do update set role = excluded.role, status = 'pending', invited_by = excluded.invited_by,
                   created_at = now(), accepted_at = null
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

  await recordAudit({
    tenant,
    request,
    action: "invite",
    entityType: "invite",
    entityId: invite.id,
    summary: `Invited ${invite.email} as ${invite.role}`,
    after: invite,
  });

  return new Response(
    JSON.stringify({ ...invite, emailSent: delivery.sent, inviteUrl }),
    { status: 201, headers: { "content-type": "application/json" } },
  );
}, { admin: true });

import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { transaction } from "@/lib/db";
import { captureError, errorResponse, HttpError, ValidationError } from "@/lib/errors";
import { requireUser } from "@/lib/tenant";
import { readJson, requireUuid } from "@/lib/validation";

export const runtime = "nodejs";

type InviteRow = {
  id: string;
  organization_id: string;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "revoked";
};

type OrgRow = { id: string; name: string };

export async function POST(request: Request) {
  try {
    const { user, error } = await requireUser(request);
    if (error || !user) return error;

    const body = await readJson(request);
    const inviteId = requireUuid(body.inviteId, "Invite token");

    const organization = await transaction(async (client) => {
      const inviteResult = await client.query<InviteRow>(
        `select id, organization_id, email, role, status
         from organization_invites
         where id = $1`,
        [inviteId],
      );
      const invite = inviteResult.rows[0];
      if (!invite) throw new ValidationError("Invite not found");
      if (invite.status !== "pending") {
        throw new ValidationError(`Invite is ${invite.status}`);
      }
      if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new ValidationError("Sign in with the email address that received this invite");
      }
      const existingMembership = await client.query<{ organization_id: string }>(
        "select organization_id from organization_memberships where user_id = $1 limit 1",
        [user.id],
      );
      const existingOrganizationId = existingMembership.rows[0]?.organization_id;
      if (existingOrganizationId && existingOrganizationId !== invite.organization_id) {
        throw new ValidationError("This account already belongs to another organization");
      }
      await client.query(
        `insert into organization_memberships (organization_id, user_id, role)
         values ($1, $2, $3)
         on conflict (organization_id, user_id) do update set role = excluded.role`,
        [invite.organization_id, user.id, invite.role],
      );
      await client.query(
        "update organization_invites set status = 'accepted', accepted_at = now() where id = $1",
        [invite.id],
      );
      const orgResult = await client.query<OrgRow>(
        "select id, name from organizations where id = $1",
        [invite.organization_id],
      );
      return orgResult.rows[0]
        ? { ...orgResult.rows[0], role: invite.role }
        : null;
    });

    if (organization) {
      await recordAudit({
        tenant: { user, organization },
        request,
        action: "invite",
        entityType: "user",
        entityId: user.id,
        summary: `${user.email} joined ${organization.name} as ${organization.role}`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    await captureError(error, {
      request,
      status: error instanceof HttpError ? error.status : 500,
    });
    return errorResponse(error);
  }
}

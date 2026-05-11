import { NextResponse } from "next/server";
import { badRequest, serverError } from "@/lib/api-response";
import { pool } from "@/lib/db";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

type InviteRow = {
  id: string;
  organization_id: string;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "revoked";
};

export async function POST(request: Request) {
  const client = await pool.connect();

  try {
    const { user, error } = await requireUser(request);
    if (error || !user) return error;

    const body = await request.json();
    const inviteId = String(body.inviteId ?? "").trim();
    if (!inviteId) return badRequest("Invite token is required");

    await client.query("begin");

    const inviteResult = await client.query<InviteRow>(
      `select id, organization_id, email, role, status
       from organization_invites
       where id = $1
       for update`,
      [inviteId],
    );
    const invite = inviteResult.rows[0];
    if (!invite) {
      await client.query("rollback");
      return badRequest("Invite not found");
    }

    if (invite.status !== "pending") {
      await client.query("rollback");
      return badRequest(`Invite is ${invite.status}`);
    }

    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      await client.query("rollback");
      return badRequest("Sign in with the email address that received this invite");
    }

    const existingMembership = await client.query<{ organization_id: string }>(
      "select organization_id from organization_memberships where user_id = $1 limit 1",
      [user.id],
    );
    const existingOrganizationId = existingMembership.rows[0]?.organization_id;
    if (existingOrganizationId && existingOrganizationId !== invite.organization_id) {
      await client.query("rollback");
      return badRequest("This account already belongs to another organization");
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
    await client.query("commit");

    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    return serverError(error);
  } finally {
    client.release();
  }
}

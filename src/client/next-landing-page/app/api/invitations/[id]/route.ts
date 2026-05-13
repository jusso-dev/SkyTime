import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { withTenant } from "@/lib/route";
import { requireUuid } from "@/lib/validation";

export const runtime = "nodejs";

type Params = { id: string };

export const DELETE = withTenant<Params>(async ({ tenant, request, params }) => {
  const id = requireUuid(params.id, "Invite id");
  const result = await query<{ id: string; email: string }>(
    `update organization_invites set status = 'revoked'
     where id = $1 and organization_id = $2
     returning id, email`,
    [id, tenant.organization.id],
  );
  if (!result.rows[0]) throw new NotFoundError("Invite not found");
  await recordAudit({
    tenant,
    request,
    action: "revoke",
    entityType: "invite",
    entityId: id,
    summary: `Revoked invite for ${result.rows[0].email}`,
  });
  return { ok: true };
}, { admin: true });

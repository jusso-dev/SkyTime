import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { withUser } from "@/lib/route";
import { readJson, requireString } from "@/lib/validation";

export const runtime = "nodejs";

export const POST = withUser(async ({ user, request }) => {
  const body = await readJson(request);
  const name = requireString(body.name, "Organization name", 200);

  const existing = await query("select id from organization_memberships where user_id = $1 limit 1", [user.id]);
  if (existing.rows[0]) {
    throw new ConflictError("User already belongs to an organization");
  }

  const org = await query<{ id: string; name: string }>(
    "insert into organizations (name) values ($1) returning id, name",
    [name],
  );
  await query(
    "insert into organization_memberships (organization_id, user_id, role) values ($1, $2, 'admin')",
    [org.rows[0].id, user.id],
  );
  await query("insert into workspace_settings (organization_id) values ($1) on conflict do nothing", [org.rows[0].id]);

  const tenant = { user, organization: { ...org.rows[0], role: "admin" as const } };
  await recordAudit({
    tenant,
    request,
    action: "create",
    entityType: "organization",
    entityId: org.rows[0].id,
    summary: `Created organization ${org.rows[0].name}`,
    after: org.rows[0],
  });

  return new Response(
    JSON.stringify({ organization: { ...org.rows[0], role: "admin" } }),
    { status: 201, headers: { "content-type": "application/json" } },
  );
});

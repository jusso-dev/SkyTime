import { recordAudit } from "@/lib/audit";
import { withTenant } from "@/lib/route";
import { optString, optUuid, readJson, requireString } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";
import { query } from "@/lib/db";
import {
  clientFromRow,
  listProjects,
  PROJECT_COLUMNS,
  projectFromRow,
  type ClientRow,
  type ProjectRow,
} from "@/lib/workspace-repository";

export const runtime = "nodejs";

export const GET = withTenant(async ({ tenant }) => {
  return listProjects(tenant.organization.id);
});

export const POST = withTenant(async ({ tenant, request }) => {
  const body = await readJson(request);
  const name = requireString(body.name, "Project name", 200);
  const clientId = optUuid(body.clientId, "Client id");
  const rate = body.rate === undefined ? 0 : Number(body.rate) || 0;
  const color = optString(body.color, "Color", 80) || "oklch(0.56 0.13 155)";
  const status = body.status === "Paused" ? "Paused" : "Active";

  let clientName = optString(body.client, "Client", 200);
  if (clientId) {
    const clientRow = await query<ClientRow>(
      `select id, name, contact_name, contact_email, address, currency, default_rate, notes, archived_at
       from clients where id = $1 and organization_id = $2`,
      [clientId, tenant.organization.id],
    );
    if (!clientRow.rows[0]) throw new ValidationError("Client not found");
    clientName = clientFromRow(clientRow.rows[0]).name;
  } else if (!clientName) {
    clientName = "No client";
  }

  const result = await query<ProjectRow>(
    `insert into projects (organization_id, name, client, client_id, rate, color, status)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning ${PROJECT_COLUMNS}`,
    [tenant.organization.id, name, clientName, clientId, rate, color, status],
  );

  const project = projectFromRow(result.rows[0]);
  await recordAudit({
    tenant,
    request,
    action: "create",
    entityType: "project",
    entityId: project.id,
    summary: `Created project ${project.name}`,
    after: project,
  });
  return new Response(JSON.stringify(project), { status: 201, headers: { "content-type": "application/json" } });
});

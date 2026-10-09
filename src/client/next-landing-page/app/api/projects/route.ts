import { optNumber, requireDateOnly } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";
import { withTenant } from "@/lib/route";
import { optColor, optString, optUuid, readJson, requireString } from "@/lib/validation";
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
  let rate = body.rate === undefined ? 0 : (optNumber(body.rate, "Rate") ?? 0);
  const color = optColor(body.color, "Color", "oklch(0.56 0.13 155)");
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
    if (body.rate === undefined) rate = Number(clientRow.rows[0].default_rate);
  } else if (!clientName) {
    clientName = "No client";
  }

  const result = await query<ProjectRow>(
    `insert into projects (organization_id, name, client, client_id, rate, color, status, budget_hours, budget_amount, cost_rate, deadline, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning ${PROJECT_COLUMNS}`,
    [
      tenant.organization.id,
      name,
      clientName,
      clientId,
      rate,
      color,
      status,
      optNumber(body.budgetHours, "Budget hours") ?? 0,
      optNumber(body.budgetAmount, "Budget amount") ?? 0,
      optNumber(body.costRate, "Cost rate") ?? 0,
      body.deadline ? requireDateOnly(body.deadline, "Deadline") : null,
      String(body.notes ?? "").slice(0, 5000),
    ],
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
  return new Response(JSON.stringify(project), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
});

import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { withTenant } from "@/lib/route";
import { optUuid, readJson, requireUuid } from "@/lib/validation";
import {
  clientFromRow,
  PROJECT_COLUMNS,
  projectFromRow,
  type ClientRow,
  type ProjectRow,
} from "@/lib/workspace-repository";

export const runtime = "nodejs";

type Params = { id: string };

export const PATCH = withTenant<Params>(async ({ tenant, request, params }) => {
  const id = requireUuid(params.id, "Project id");
  const body = await readJson(request);

  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
    throw new ValidationError("Project name is required");
  }

  const current = await query<ProjectRow>(
    `select ${PROJECT_COLUMNS} from projects where id = $1 and organization_id = $2`,
    [id, tenant.organization.id],
  );
  if (!current.rows[0]) throw new NotFoundError("Project not found");
  const existing = current.rows[0];
  const before = projectFromRow(existing);

  let clientName = body.client === undefined ? existing.client : String(body.client).trim();
  let clientId: string | null = existing.client_id;
  if (body.clientId !== undefined) {
    clientId = optUuid(body.clientId, "Client id");
    if (clientId) {
      const clientRow = await query<ClientRow>(
        `select id, name, contact_name, contact_email, address, currency, default_rate, notes, archived_at
         from clients where id = $1 and organization_id = $2`,
        [clientId, tenant.organization.id],
      );
      if (!clientRow.rows[0]) throw new ValidationError("Client not found");
      clientName = clientFromRow(clientRow.rows[0]).name;
    }
  }

  const result = await query<ProjectRow>(
    `update projects
     set name = $2, client = $3, client_id = $4, rate = $5, color = $6, status = $7, updated_at = now()
     where id = $1 and organization_id = $8
     returning ${PROJECT_COLUMNS}`,
    [
      id,
      typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name,
      clientName || "No client",
      clientId,
      body.rate === undefined ? existing.rate : Number(body.rate) || 0,
      typeof body.color === "string" && body.color ? body.color : existing.color,
      body.status === "Paused" || body.status === "Active" ? body.status : existing.status,
      tenant.organization.id,
    ],
  );

  const updated = projectFromRow(result.rows[0]);
  await recordAudit({
    tenant,
    request,
    action: "update",
    entityType: "project",
    entityId: updated.id,
    summary: `Updated project ${updated.name}`,
    before,
    after: updated,
  });
  return updated;
});

export const DELETE = withTenant<Params>(async ({ tenant, request, params }) => {
  const id = requireUuid(params.id, "Project id");
  const result = await query<ProjectRow>(
    `delete from projects where id = $1 and organization_id = $2 returning ${PROJECT_COLUMNS}`,
    [id, tenant.organization.id],
  );
  if (!result.rows[0]) throw new NotFoundError("Project not found");
  const removed = projectFromRow(result.rows[0]);
  await recordAudit({
    tenant,
    request,
    action: "delete",
    entityType: "project",
    entityId: removed.id,
    summary: `Deleted project ${removed.name}`,
    before: removed,
  });
  return { ok: true };
});

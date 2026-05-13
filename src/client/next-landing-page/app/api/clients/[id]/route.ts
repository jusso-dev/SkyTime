import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { withTenant } from "@/lib/route";
import { optNumber, optString, readJson, requireUuid } from "@/lib/validation";
import { CLIENT_COLUMNS, clientFromRow, type ClientRow } from "@/lib/workspace-repository";

export const runtime = "nodejs";

type Params = { id: string };

async function loadClient(organizationId: string, clientId: string) {
  const result = await query<ClientRow>(
    `select ${CLIENT_COLUMNS} from clients where id = $1 and organization_id = $2`,
    [clientId, organizationId],
  );
  if (!result.rows[0]) throw new NotFoundError("Client not found");
  return result.rows[0];
}

export const PATCH = withTenant<Params>(async ({ tenant, request, params }) => {
  const id = requireUuid(params.id, "Client id");
  const body = await readJson(request);
  const existing = await loadClient(tenant.organization.id, id);
  const before = clientFromRow(existing);

  const name = body.name === undefined ? existing.name : optString(body.name, "Client name", 200) || existing.name;
  const contactName = body.contactName === undefined ? existing.contact_name : optString(body.contactName, "Contact name", 200);
  const contactEmail = body.contactEmail === undefined ? existing.contact_email : optString(body.contactEmail, "Contact email", 200);
  const address = body.address === undefined ? existing.address : optString(body.address, "Address", 500);
  const currency = body.currency === undefined ? existing.currency : (optString(body.currency, "Currency", 8) || existing.currency).toUpperCase();
  const defaultRate = body.defaultRate === undefined ? Number(existing.default_rate) : optNumber(body.defaultRate, "Default rate") ?? 0;
  const notes = body.notes === undefined ? existing.notes : optString(body.notes, "Notes", 5000);
  const archivedAt =
    body.archived === undefined
      ? existing.archived_at
      : body.archived
      ? new Date()
      : null;

  const result = await query<ClientRow>(
    `update clients
     set name = $2, contact_name = $3, contact_email = $4, address = $5,
         currency = $6, default_rate = $7, notes = $8, archived_at = $9, updated_at = now()
     where id = $1 and organization_id = $10
     returning ${CLIENT_COLUMNS}`,
    [id, name, contactName, contactEmail, address, currency, defaultRate, notes, archivedAt, tenant.organization.id],
  );
  const updated = clientFromRow(result.rows[0]);

  if (existing.name !== updated.name) {
    await query(
      `update projects set client = $1 where client_id = $2 and organization_id = $3`,
      [updated.name, updated.id, tenant.organization.id],
    );
  }

  await recordAudit({
    tenant,
    request,
    action: "update",
    entityType: "client",
    entityId: updated.id,
    summary: `Updated client ${updated.name}`,
    before,
    after: updated,
  });
  return updated;
});

export const DELETE = withTenant<Params>(async ({ tenant, request, params }) => {
  const id = requireUuid(params.id, "Client id");
  const existing = await loadClient(tenant.organization.id, id);
  const before = clientFromRow(existing);

  // Soft-delete (archive) so historical projects keep their reference intact.
  const result = await query<ClientRow>(
    `update clients set archived_at = now(), updated_at = now()
     where id = $1 and organization_id = $2
     returning ${CLIENT_COLUMNS}`,
    [id, tenant.organization.id],
  );
  await recordAudit({
    tenant,
    request,
    action: "delete",
    entityType: "client",
    entityId: id,
    summary: `Archived client ${before.name}`,
    before,
    after: clientFromRow(result.rows[0]),
  });
  return { ok: true };
});

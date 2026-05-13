import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { withTenant } from "@/lib/route";
import { optNumber, optString, readJson, requireString } from "@/lib/validation";
import { CLIENT_COLUMNS, clientFromRow, listClients, type ClientRow } from "@/lib/workspace-repository";

export const runtime = "nodejs";

export const GET = withTenant(async ({ tenant }) => {
  return listClients(tenant.organization.id);
});

export const POST = withTenant(async ({ tenant, request }) => {
  const body = await readJson(request);
  const name = requireString(body.name, "Client name", 200);
  const contactName = optString(body.contactName, "Contact name", 200);
  const contactEmail = optString(body.contactEmail, "Contact email", 200);
  const address = optString(body.address, "Address", 500);
  const currency = (optString(body.currency, "Currency", 8) || "AUD").toUpperCase();
  const defaultRate = optNumber(body.defaultRate, "Default rate") ?? 0;
  const notes = optString(body.notes, "Notes", 5000);

  try {
    const result = await query<ClientRow>(
      `insert into clients
        (organization_id, name, contact_name, contact_email, address, currency, default_rate, notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning ${CLIENT_COLUMNS}`,
      [tenant.organization.id, name, contactName, contactEmail, address, currency, defaultRate, notes],
    );
    const client = clientFromRow(result.rows[0]);
    await recordAudit({
      tenant,
      request,
      action: "create",
      entityType: "client",
      entityId: client.id,
      summary: `Created client ${client.name}`,
      after: client,
    });
    return new Response(JSON.stringify(client), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error: unknown) {
    if (error && typeof error === "object" && (error as { code?: string }).code === "23505") {
      throw new ConflictError("A client with that name already exists");
    }
    throw error;
  }
});

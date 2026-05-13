import { query } from "@/lib/db";
import { withTenant } from "@/lib/route";
import type { AuditLogEntry } from "@/lib/workspace-types";

export const runtime = "nodejs";

type Row = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: Date;
};

const MAX_LIMIT = 200;

export const GET = withTenant(async ({ tenant, request }) => {
  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(MAX_LIMIT, Math.round(limitParam))) : 100;
  const action = url.searchParams.get("action");
  const entityType = url.searchParams.get("entity");

  const params: unknown[] = [tenant.organization.id];
  const whereParts = ["organization_id = $1"];
  if (action) {
    params.push(action);
    whereParts.push(`action = $${params.length}`);
  }
  if (entityType) {
    params.push(entityType);
    whereParts.push(`entity_type = $${params.length}`);
  }
  params.push(limit);

  const result = await query<Row>(
    `select id, user_id, user_email, action, entity_type, entity_id, summary, created_at
     from audit_log
     where ${whereParts.join(" and ")}
     order by created_at desc
     limit $${params.length}`,
    params,
  );

  return result.rows.map<AuditLogEntry>((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
  }));
}, { admin: true });

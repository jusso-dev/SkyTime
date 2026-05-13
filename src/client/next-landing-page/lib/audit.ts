import { query } from "@/lib/db";
import type { Tenant } from "@/lib/tenant";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "submit"
  | "approve"
  | "reject"
  | "invite"
  | "revoke"
  | "sign_in"
  | "sign_out";

export type AuditEntityType =
  | "project"
  | "client"
  | "time_entry"
  | "board_task"
  | "timesheet_period"
  | "invite"
  | "organization"
  | "settings"
  | "user";

export type RecordAuditOptions = {
  tenant: Tenant;
  request?: Request;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
};

export async function recordAudit(options: RecordAuditOptions) {
  const { tenant, request, action, entityType, entityId, summary, before, after } = options;
  try {
    await query(
      `insert into audit_log
        (organization_id, user_id, user_email, action, entity_type, entity_id, summary, before_data, after_data, ip, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        tenant.organization.id,
        tenant.user.id,
        tenant.user.email,
        action,
        entityType,
        entityId ?? null,
        summary,
        before === undefined ? null : JSON.stringify(before),
        after === undefined ? null : JSON.stringify(after),
        request ? clientIp(request) : null,
        request?.headers.get("user-agent") ?? null,
      ],
    );
  } catch (error) {
    // Auditing must never crash a mutation. Log and continue.
    console.error("[skytime] audit write failed", error);
  }
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}

import { query } from "@/lib/db";
import { withTenant } from "@/lib/route";
import type { ErrorLogEntry } from "@/lib/workspace-types";

export const runtime = "nodejs";

type Row = {
  id: string;
  level: "error" | "warn" | "info";
  message: string;
  path: string | null;
  method: string | null;
  status_code: number | null;
  created_at: Date;
};

const MAX_LIMIT = 200;

export const GET = withTenant(async ({ request }) => {
  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(MAX_LIMIT, Math.round(limitParam))) : 100;
  const level = url.searchParams.get("level");

  const params: unknown[] = [];
  let whereClause = "";
  if (level) {
    params.push(level);
    whereClause = `where level = $${params.length}`;
  }
  params.push(limit);

  // Errors capture even when no tenant context is available (e.g. unauth requests),
  // so the admin error log shows global errors. Admin gate is enforced by withTenant.
  const result = await query<Row>(
    `select id, level, message, path, method, status_code, created_at
     from error_log
     ${whereClause}
     order by created_at desc
     limit $${params.length}`,
    params,
  );

  return result.rows.map<ErrorLogEntry>((row) => ({
    id: row.id,
    level: row.level,
    message: row.message,
    path: row.path,
    method: row.method,
    statusCode: row.status_code,
    createdAt: row.created_at.toISOString(),
  }));
}, { admin: true });

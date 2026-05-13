import { query } from "@/lib/db";
import { withTenant } from "@/lib/route";
import { periodFromRow, type TimesheetPeriodRow } from "@/lib/workspace-repository";

export const runtime = "nodejs";

type Row = TimesheetPeriodRow & { user_email: string | null };

export const GET = withTenant(async ({ tenant, request }) => {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const status = url.searchParams.get("status");
  const isAdmin = tenant.organization.role === "admin";
  const wantsAll = scope === "all" && isAdmin;

  const params: unknown[] = [tenant.organization.id];
  let whereClause = "where tp.organization_id = $1";
  if (!wantsAll) {
    params.push(tenant.user.id);
    whereClause += ` and tp.user_id = $${params.length}`;
  }
  if (status) {
    params.push(status);
    whereClause += ` and tp.status = $${params.length}`;
  }

  const result = await query<Row>(
    `select tp.id, tp.user_id, tp.reviewer_email, tp.period_start, tp.period_end,
            tp.status, tp.submitted_at, tp.reviewed_at, tp.reviewed_by, tp.note, tp.total_ms,
            u.email as user_email
     from timesheet_periods tp
     left join "user" u on u.id = tp.user_id
     ${whereClause}
     order by tp.period_start desc, u.email asc nulls last`,
    params,
  );
  return result.rows.map((row) => periodFromRow(row, row.user_email));
});

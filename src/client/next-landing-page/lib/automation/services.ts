import PDFDocument from "pdfkit";
import { entryTags } from "@/lib/validation";
import { createHash, randomBytes } from "node:crypto";
import { query, transaction } from "@/lib/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { recordAudit, type AuditEntityType } from "@/lib/audit";
import type { Tenant } from "@/lib/tenant";
import {
  entryFromRow,
  TIME_ENTRY_COLUMNS,
  currentPeriodWindow,
  PERIOD_COLUMNS,
  periodFromRow,
  refreshPeriodTotals,
  type TimesheetPeriodRow,
} from "@/lib/workspace-repository";
import {
  buildReport,
  getBranding,
  validateTimezone,
  type ReportFilters,
} from "@/lib/reports/data";
import { branding as brandingSchema } from "./schemas";
import type { PoolClient } from "pg";
export type Context = { tenant: Tenant; request: Request };
export function admin(c: Context) {
  if (c.tenant.organization.role !== "admin")
    throw new ForbiddenError("Admin access required");
}
export async function audit(
  c: Context,
  entityType: AuditEntityType,
  action: "create" | "update" | "delete",
  entityId: string | undefined,
  summary: string,
  after?: unknown,
) {
  await recordAudit({ ...c, entityType, action, entityId, summary, after });
}
async function lock(client: PoolClient, c: Context) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    c.tenant.organization.id + c.tenant.user.id,
  ]);
}
export async function timerGet(c: Context) {
  const r = await query(
    "select * from running_timers where organization_id=$1 and user_id=$2",
    [c.tenant.organization.id, c.tenant.user.id],
  );
  const t = r.rows[0];
  return t
    ? {
        id: t.id,
        running: true,
        projectId: t.project_id,
        task: t.task,
        notes: t.notes,
        billable: t.billable,
        tags: t.tags,
        startedAt: t.started_at.toISOString(),
      }
    : null;
}
export async function timerStart(
  c: Context,
  a: {
    projectId: string;
    task: string;
    notes?: string;
    billable?: boolean;
    tags?: string[];
    startedAt?: string;
  },
) {
  const startedAt = a.startedAt ?? new Date().toISOString();
  if (Date.parse(startedAt) > Date.now() + 1000)
    throw new ValidationError("Timer cannot start in the future");
  await transaction(async (db) => {
    await lock(db, c);
    const project = await db.query(
      "select id from projects where id=$1 and organization_id=$2 and status='Active'",
      [a.projectId, c.tenant.organization.id],
    );
    if (!project.rows[0])
      throw new ValidationError("Choose an active project in this workspace");
    const approved = await db.query(
      "select id from timesheet_periods where organization_id=$1 and user_id=$2 and status='approved' and $3::timestamptz>=period_start and $3::timestamptz<period_end+interval '1 day'",
      [c.tenant.organization.id, c.tenant.user.id, startedAt],
    );
    if (approved.rows[0]) throw new ConflictError("This week is approved");
    const r = await db.query(
      "insert into running_timers(organization_id,user_id,project_id,task,notes,billable,tags,started_at) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(organization_id,user_id) do nothing returning id",
      [
        c.tenant.organization.id,
        c.tenant.user.id,
        a.projectId,
        a.task,
        a.notes ?? "",
        a.billable ?? true,
        entryTags(a.tags),
        startedAt,
      ],
    );
    if (!r.rows[0])
      throw new ConflictError(
        "A timer is already running. Stop or discard it first",
      );
  });
  const t = await timerGet(c);
  await audit(c, "timer", "create", t?.id, "Started timer", t);
  return t;
}
export async function timerStop(
  c: Context,
  a: {
    id: string;
    stoppedAt?: string;
    task?: string;
    notes?: string;
    billable?: boolean;
    projectId?: string;
  },
) {
  const entry = await transaction(async (db) => {
    await lock(db, c);
    const r = await db.query(
      "select * from running_timers where id=$1 and organization_id=$2 and user_id=$3 for update",
      [a.id, c.tenant.organization.id, c.tenant.user.id],
    );
    const t = r.rows[0];
    if (!t) throw new NotFoundError("Timer is no longer running");
    const stop = a.stoppedAt ? Date.parse(a.stoppedAt) : Date.now();
    const duration = stop - t.started_at.getTime();
    if (duration <= 0 || duration > 2147483647 || stop > Date.now() + 1000)
      throw new ValidationError(
        "Stop must be after start, not in the future, and within 24 days",
      );
    const result = await db.query(
      `insert into time_entries(organization_id,user_id,project_id,task,notes,billable,tags,started_at,duration_ms) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${TIME_ENTRY_COLUMNS}`,
      [
        c.tenant.organization.id,
        c.tenant.user.id,
        a.projectId ?? t.project_id,
        a.task ?? t.task,
        a.notes ?? t.notes,
        a.billable ?? t.billable,
        entryTags(t.tags),
        t.started_at,
        duration,
      ],
    );
    await db.query("delete from running_timers where id=$1", [a.id]);
    return entryFromRow(result.rows[0]);
  });
  await audit(
    c,
    "time_entry",
    "create",
    entry.id,
    "Stopped timer and recorded time",
    entry,
  );
  return entry;
}
export async function timerDiscard(c: Context, a: { id: string }) {
  const r = await query(
    "delete from running_timers where id=$1 and organization_id=$2 and user_id=$3 returning id",
    [a.id, c.tenant.organization.id, c.tenant.user.id],
  );
  if (!r.rows[0]) throw new NotFoundError("Timer not found");
  await audit(c, "timer", "delete", a.id, "Discarded timer");
  return { ok: true };
}
export async function tokensList(c: Context) {
  return (
    await query(
      "select id,name,prefix,scope,created_at,expires_at,last_used_at,revoked_at from api_tokens where organization_id=$1 and user_id=$2 order by created_at desc",
      [c.tenant.organization.id, c.tenant.user.id],
    )
  ).rows;
}
export async function tokensCreate(
  c: Context,
  a: { name: string; scope: "read" | "write"; expiresInDays: number },
) {
  if (c.tenant.tokenScope)
    throw new ForbiddenError(
      "Create credentials from a signed-in browser session",
    );
  const token = "st_" + randomBytes(32).toString("base64url");
  const r = await query(
    "insert into api_tokens(organization_id,user_id,name,token_hash,prefix,scope,expires_at) values($1,$2,$3,$4,$5,$6,now()+$7*interval '1 day') returning id,name,prefix,scope,expires_at",
    [
      c.tenant.organization.id,
      c.tenant.user.id,
      a.name,
      createHash("sha256").update(token).digest("hex"),
      token.slice(0, 11),
      a.scope,
      a.expiresInDays,
    ],
  );
  await audit(
    c,
    "api_token",
    "create",
    r.rows[0].id,
    "Created automation credential",
    { name: a.name, scope: a.scope },
  );
  return { ...r.rows[0], token };
}
export async function tokensRevoke(c: Context, a: { id: string }) {
  const r = await query(
    "update api_tokens set revoked_at=now() where id=$1 and organization_id=$2 and user_id=$3 returning id",
    [a.id, c.tenant.organization.id, c.tenant.user.id],
  );
  if (!r.rows[0]) throw new NotFoundError();
  await audit(c, "api_token", "delete", a.id, "Revoked automation credential");
  return { ok: true };
}
export async function brandingUpdate(c: Context, input: unknown) {
  admin(c);
  const a = brandingSchema.parse(input);
  if (a.timezone) validateTimezone(a.timezone);
  const current = await getBranding(c.tenant);
  const b = { ...current, ...a };
  if (b.logoDataUrl) {
    const data = Buffer.from(b.logoDataUrl.split(",")[1], "base64");
    const png = data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpg = data[0] === 255 && data[1] === 216;
    if ((!png && !jpg) || data.length > 1000000)
      throw new ValidationError(
        "Logo must be a valid PNG or JPEG smaller than 1 MB",
      );
    const probe = new PDFDocument({ size: [10, 10], margin: 0 });
    probe.on("data", () => {});
    try {
      probe.image(data, 0, 0, { fit: [10, 10] });
    } catch {
      throw new ValidationError("Logo image could not be decoded");
    } finally {
      probe.end();
    }
  }
  await query(
    `insert into report_branding(organization_id,company_name,address,email,tax_id,footer,logo_data_url,accent_color,tax_percent,currency,timezone) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(organization_id) do update set company_name=$2,address=$3,email=$4,tax_id=$5,footer=$6,logo_data_url=$7,accent_color=$8,tax_percent=$9,currency=$10,timezone=$11`,
    [
      c.tenant.organization.id,
      b.companyName,
      b.address,
      b.email,
      b.taxId,
      b.footer,
      b.logoDataUrl,
      b.accentColor,
      b.taxPercent,
      b.currency,
      b.timezone,
    ],
  );
  await audit(c, "branding", "update", undefined, "Updated report branding", {
    ...b,
    logoDataUrl: b.logoDataUrl ? "[image]" : null,
  });
  return b;
}
export async function tagsList(c: Context) {
  return (
    await query(
      "select id,name,color from tags where organization_id=$1 order by name",
      [c.tenant.organization.id],
    )
  ).rows;
}
export async function tagsCreate(
  c: Context,
  a: { name: string; color?: string },
) {
  const r = await query(
    "insert into tags(organization_id,name,color) values($1,$2,$3) returning id,name,color",
    [c.tenant.organization.id, a.name, a.color ?? "#2563eb"],
  );
  await audit(c, "tag", "create", r.rows[0].id, "Created tag", r.rows[0]);
  return r.rows[0];
}
export async function tagsDelete(c: Context, a: { id: string }) {
  const r = await query(
    "delete from tags where id=$1 and organization_id=$2 returning id",
    [a.id, c.tenant.organization.id],
  );
  if (!r.rows[0]) throw new NotFoundError();
  await audit(
    c,
    "tag",
    "delete",
    a.id,
    "Removed tag from catalog; historical entry tags retained",
  );
  return { ok: true };
}
export async function savedList(c: Context) {
  return (
    await query(
      "select id,name,filters from saved_reports where organization_id=$1 and user_id=$2 order by name",
      [c.tenant.organization.id, c.tenant.user.id],
    )
  ).rows;
}
export async function savedCreate(
  c: Context,
  a: { name: string; filters: ReportFilters },
) {
  const r = await query(
    "insert into saved_reports(organization_id,user_id,name,filters) values($1,$2,$3,$4) returning id,name,filters",
    [
      c.tenant.organization.id,
      c.tenant.user.id,
      a.name,
      JSON.stringify(a.filters),
    ],
  );
  await audit(
    c,
    "saved_report",
    "create",
    r.rows[0].id,
    "Saved report filters",
    a,
  );
  return r.rows[0];
}
export async function savedDelete(c: Context, a: { id: string }) {
  const r = await query(
    "delete from saved_reports where id=$1 and organization_id=$2 and user_id=$3 returning id",
    [a.id, c.tenant.organization.id, c.tenant.user.id],
  );
  if (!r.rows[0]) throw new NotFoundError();
  await audit(c, "saved_report", "delete", a.id, "Deleted saved report");
  return { ok: true };
}
export async function projectInsights(c: Context) {
  const rows = (
    await query(
      `select p.id,p.name,p.status,p.budget_hours,p.budget_amount,p.deadline,
    coalesce((select sum(duration_ms)/3600000.0 from time_entries where project_id=p.id),0)::float as hours,
    coalesce(cl.currency,b.currency,'AUD') as currency,
    (select coalesce(jsonb_agg(f),'[]'::jsonb) from (
      select currency,coalesce(sum(case when billable then round(duration_ms/3600000.0*hourly_rate,2) else 0 end),0)::float as revenue,
      coalesce(sum(round(duration_ms/3600000.0*cost_rate,2)),0)::float as cost
      from time_entries where project_id=p.id group by currency
    ) f) as financials,
    (select count(*)::int from board_tasks where project_id=p.id and status='Done') as completed_tasks,
    (select count(*)::int from board_tasks where project_id=p.id) as total_tasks
    from projects p left join clients cl on cl.id=p.client_id left join report_branding b on b.organization_id=p.organization_id
    where p.organization_id=$1 order by p.name`,
      [c.tenant.organization.id],
    )
  ).rows;
  return rows.map((p) => {
    const financials = (
      p.financials as { currency: string; revenue: number; cost: number }[]
    ).map((f) => ({ ...f, profit: f.revenue - f.cost }));
    const single = financials.length <= 1;
    const revenue = single ? (financials[0]?.revenue ?? 0) : null;
    const cost = single ? (financials[0]?.cost ?? 0) : null;
    return {
      ...p,
      financials,
      revenue,
      cost,
      profit: single ? (revenue ?? 0) - (cost ?? 0) : null,
      budget_hours: Number(p.budget_hours),
      budget_amount: Number(p.budget_amount),
      budgetUsedPercent:
        Number(p.budget_hours) > 0
          ? (p.hours / Number(p.budget_hours)) * 100
          : null,
      amountUsedPercent:
        single &&
        Number(p.budget_amount) > 0 &&
        (!financials[0] || financials[0].currency === p.currency)
          ? ((revenue ?? 0) / Number(p.budget_amount)) * 100
          : null,
    };
  });
}

export async function membersList(c: Context) {
  return (
    await query(
      'select u.id,u.name,u.email,m.role,m.weekly_capacity as "weeklyCapacity" from organization_memberships m join "user" u on u.id=m.user_id where m.organization_id=$1 order by u.name',
      [c.tenant.organization.id],
    )
  ).rows;
}
export async function expensesList(c: Context) {
  return (
    await query(
      "select e.*,p.name as project from expenses e join projects p on p.id=e.project_id where e.organization_id=$1 order by e.date desc",
      [c.tenant.organization.id],
    )
  ).rows;
}
export async function expensesCreate(
  c: Context,
  a: {
    projectId: string;
    date: string;
    description: string;
    category?: string;
    amount: number;
    currency: string;
    billable?: boolean;
  },
) {
  const r = await query(
    "insert into expenses(organization_id,user_id,project_id,date,description,category,amount,currency,billable) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *",
    [
      c.tenant.organization.id,
      c.tenant.user.id,
      a.projectId,
      a.date,
      a.description,
      a.category ?? "Other",
      a.amount,
      a.currency,
      a.billable ?? true,
    ],
  );
  await audit(
    c,
    "expense",
    "create",
    r.rows[0].id,
    "Recorded expense",
    r.rows[0],
  );
  return r.rows[0];
}
export async function expensesDelete(c: Context, a: { id: string }) {
  const r = await query(
    "delete from expenses where id=$1 and organization_id=$2 and invoice_id is null and (user_id=$3 or $4) returning id",
    [
      a.id,
      c.tenant.organization.id,
      c.tenant.user.id,
      c.tenant.organization.role === "admin",
    ],
  );
  if (!r.rows[0])
    throw new ConflictError(
      "Expense not found, not owned by you, or already invoiced",
    );
  await audit(c, "expense", "delete", a.id, "Deleted expense");
  return { ok: true };
}
export async function invoicesList(c: Context) {
  admin(c);
  return (
    await query(
      "select i.*,c.name as client from invoices i join clients c on c.id=i.client_id where i.organization_id=$1 order by i.created_at desc",
      [c.tenant.organization.id],
    )
  ).rows;
}
export async function invoiceGet(c: Context, a: { id: string }) {
  admin(c);
  const r = await query(
    "select *,to_char(issued_date,'YYYY-MM-DD') as issued_date,to_char(due_date,'YYYY-MM-DD') as due_date from invoices where id=$1 and organization_id=$2",
    [a.id, c.tenant.organization.id],
  );
  if (!r.rows[0]) throw new NotFoundError();
  return r.rows[0];
}
export async function invoiceCreate(
  c: Context,
  a: {
    clientId: string;
    number: string;
    from: string;
    to: string;
    issuedDate: string;
    dueDate: string;
    taxPercent: number;
    notes?: string;
  },
) {
  admin(c);
  if (a.from > a.to || a.issuedDate > a.dueDate)
    throw new ValidationError("Invalid invoice date range");
  const branding = await getBranding(c.tenant);
  const invoice = await transaction(async (db) => {
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,1))", [
      c.tenant.organization.id,
    ]);
    const client = (
      await db.query(
        "select * from clients where id=$1 and organization_id=$2",
        [a.clientId, c.tenant.organization.id],
      )
    ).rows[0];
    if (!client) throw new NotFoundError("Client not found");
    const entries = (
      await db.query(
        `select e.*,p.name as project from time_entries e join projects p on p.id=e.project_id where e.organization_id=$1 and p.client_id=$2 and e.billable and e.invoice_id is null and (e.started_at at time zone $5)::date between $3::date and $4::date order by e.started_at for update of e`,
        [c.tenant.organization.id, a.clientId, a.from, a.to, branding.timezone],
      )
    ).rows;
    const expenses = (
      await db.query(
        `select e.* from expenses e join projects p on p.id=e.project_id where e.organization_id=$1 and p.client_id=$2 and e.billable and e.invoice_id is null and e.date between $3::date and $4::date for update of e`,
        [c.tenant.organization.id, a.clientId, a.from, a.to],
      )
    ).rows;
    if (!entries.length && !expenses.length)
      throw new ValidationError("No unbilled time or expenses in this period");
    if ([...entries, ...expenses].some((e) => e.currency !== client.currency))
      throw new ValidationError(
        "Client currency differs from recorded items. Invoice only a single currency.",
      );
    const lines = [
      ...entries.map((e) => ({
        type: "time",
        id: e.id,
        description: `${e.project}: ${e.task}`,
        quantity: e.duration_ms / 3600000,
        rate: Number(e.hourly_rate),
        amount:
          Math.round((e.duration_ms / 3600000) * Number(e.hourly_rate) * 100) /
          100,
      })),
      ...expenses.map((e) => ({
        type: "expense",
        id: e.id,
        description: e.description,
        quantity: 1,
        rate: Number(e.amount),
        amount: Number(e.amount),
      })),
    ];
    const subtotal =
      Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const tax = Math.round(subtotal * a.taxPercent) / 100;
    const r = await db.query(
      "insert into invoices(organization_id,client_id,number,issued_date,due_date,currency,subtotal,tax_percent,tax,total,notes,lines,client_snapshot,branding_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *",
      [
        c.tenant.organization.id,
        a.clientId,
        a.number,
        a.issuedDate,
        a.dueDate,
        client.currency,
        subtotal,
        a.taxPercent,
        tax,
        Math.round((subtotal + tax) * 100) / 100,
        a.notes ?? "",
        JSON.stringify(lines),
        JSON.stringify(client),
        JSON.stringify(branding),
      ],
    );
    await db.query(
      "update time_entries set invoice_id=$1 where id=any($2::uuid[])",
      [r.rows[0].id, entries.map((e) => e.id)],
    );
    await db.query(
      "update expenses set invoice_id=$1 where id=any($2::uuid[])",
      [r.rows[0].id, expenses.map((e) => e.id)],
    );
    return r.rows[0];
  });
  await audit(
    c,
    "invoice",
    "create",
    invoice.id,
    "Created invoice from unbilled items",
    { number: a.number, total: invoice.total },
  );
  return invoice;
}
export async function invoiceUpdate(
  c: Context,
  a: { id: string; status: "issued" | "paid" | "void" },
) {
  admin(c);
  const invoice = await transaction(async (db) => {
    const r = await db.query(
      "select * from invoices where id=$1 and organization_id=$2 for update",
      [a.id, c.tenant.organization.id],
    );
    const i = r.rows[0];
    if (!i) throw new NotFoundError();
    if (
      !(
        {
          draft: ["issued", "void"],
          issued: ["paid", "void"],
          paid: [],
          void: [],
        } as Record<string, string[]>
      )[i.status].includes(a.status)
    )
      throw new ConflictError("Invalid invoice status transition");
    if (a.status === "void") {
      await db.query(
        "update time_entries set invoice_id=null where invoice_id=$1",
        [a.id],
      );
      await db.query(
        "update expenses set invoice_id=null where invoice_id=$1",
        [a.id],
      );
    }
    return (
      await db.query("update invoices set status=$2 where id=$1 returning *", [
        a.id,
        a.status,
      ])
    ).rows[0];
  });
  await audit(c, "invoice", "update", a.id, `Marked invoice ${a.status}`, {
    status: a.status,
  });
  return invoice;
}
export async function periodCreate(c: Context, a: { date: string }) {
  const w = currentPeriodWindow(new Date(a.date));
  const r = await query<TimesheetPeriodRow>(
    `insert into timesheet_periods(organization_id,user_id,period_start,period_end) values($1,$2,$3,$4) on conflict(organization_id,user_id,period_start) do update set updated_at=now() returning ${PERIOD_COLUMNS}`,
    [c.tenant.organization.id, c.tenant.user.id, w.start, w.end],
  );
  await refreshPeriodTotals(
    c.tenant.organization.id,
    c.tenant.user.id,
    w.start,
  );
  const refreshed = await query<TimesheetPeriodRow>(
    `select ${PERIOD_COLUMNS} from timesheet_periods where id=$1`,
    [r.rows[0].id],
  );
  await audit(
    c,
    "timesheet_period",
    "create",
    r.rows[0].id,
    `Opened timesheet week ${w.start}`,
  );
  return periodFromRow(refreshed.rows[0], c.tenant.user.email);
}
export async function entriesBulk(
  c: Context,
  a: { ids: string[]; billable?: boolean; projectId?: string; tags?: string[] },
) {
  const entries = await transaction(async (db) => {
    await lock(db, c);
    const r = await db.query(
      "select * from time_entries where id=any($1::uuid[]) and organization_id=$2 order by id for update",
      [a.ids, c.tenant.organization.id],
    );
    if (r.rows.length !== new Set(a.ids).size)
      throw new NotFoundError("One or more entries not found");
    if (
      r.rows.some(
        (e) =>
          e.user_id !== c.tenant.user.id &&
          c.tenant.organization.role !== "admin",
      )
    )
      throw new ForbiddenError("Only admins can update other members’ entries");
    const updated = await db.query(
      `update time_entries set billable=coalesce($3,billable),project_id=coalesce($4,project_id),tags=coalesce($5,tags),updated_at=now() where id=any($1::uuid[]) and organization_id=$2 returning ${TIME_ENTRY_COLUMNS}`,
      [
        a.ids,
        c.tenant.organization.id,
        a.billable ?? null,
        a.projectId ?? null,
        a.tags === undefined ? null : entryTags(a.tags),
      ],
    );
    return updated.rows.map((e) => entryFromRow(e));
  });
  await audit(c, "time_entry", "update", undefined, "Bulk updated entries", {
    ids: a.ids,
  });
  return entries;
}
export async function entriesImport(
  c: Context,
  a: {
    entries: {
      projectId: string;
      task: string;
      notes?: string;
      startedAt: string;
      durationMs: number;
      billable?: boolean;
      tags?: string[];
      taskId?: string | null;
    }[];
  },
) {
  const entries = await transaction(async (db) => {
    await lock(db, c);
    const results = [];
    for (const e of a.entries) {
      const r = await db.query(
        `insert into time_entries(organization_id,user_id,project_id,task,notes,started_at,duration_ms,billable,tags,task_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning ${TIME_ENTRY_COLUMNS}`,
        [
          c.tenant.organization.id,
          c.tenant.user.id,
          e.projectId,
          e.task,
          e.notes ?? "",
          e.startedAt,
          e.durationMs,
          e.billable ?? true,
          entryTags(e.tags),
          e.taskId ?? null,
        ],
      );
      results.push(entryFromRow(r.rows[0]));
    }
    return results;
  });
  await audit(c, "time_entry", "create", undefined, "Imported entries", {
    count: entries.length,
  });
  return entries;
}
export { buildReport, getBranding };

export async function projectDuplicate(
  c: Context,
  a: { id: string; name: string },
) {
  const p = (
    await query("select * from projects where id=$1 and organization_id=$2", [
      a.id,
      c.tenant.organization.id,
    ])
  ).rows[0];
  if (!p) throw new NotFoundError("Project not found");
  const r = await query(
    "insert into projects(organization_id,name,client,client_id,rate,color,status,budget_hours,budget_amount,cost_rate,notes) values($1,$2,$3,$4,$5,$6,'Active',$7,$8,$9,$10) returning id",
    [
      c.tenant.organization.id,
      a.name,
      p.client,
      p.client_id,
      p.rate,
      p.color,
      p.budget_hours,
      p.budget_amount,
      p.cost_rate,
      p.notes,
    ],
  );
  const id = r.rows[0].id;
  await query(
    "insert into board_tasks(organization_id,project_id,title,status,estimate_hours) select organization_id,$2,title,'Backlog',estimate_hours from board_tasks where organization_id=$1 and project_id=$3",
    [c.tenant.organization.id, id, a.id],
  );
  await audit(c, "project", "create", id, "Created project from template", {
    sourceProjectId: a.id,
    name: a.name,
  });
  return { id };
}
export async function entryDuplicate(
  c: Context,
  a: { id: string; startedAt: string },
) {
  const e = (
    await query(
      "select * from time_entries where id=$1 and organization_id=$2",
      [a.id, c.tenant.organization.id],
    )
  ).rows[0];
  if (!e) throw new NotFoundError();
  return (
    await entriesImport(c, {
      entries: [
        {
          projectId: e.project_id,
          task: e.task,
          notes: e.notes,
          startedAt: a.startedAt,
          durationMs: e.duration_ms,
          billable: e.billable,
          tags: e.tags,
          taskId: e.task_id,
        },
      ],
    })
  )[0];
}
export async function entryResume(c: Context, a: { id: string }) {
  const e = (
    await query(
      "select * from time_entries where id=$1 and organization_id=$2",
      [a.id, c.tenant.organization.id],
    )
  ).rows[0];
  if (!e) throw new NotFoundError();
  return timerStart(c, {
    projectId: e.project_id,
    task: e.task,
    notes: e.notes,
    billable: e.billable,
    tags: e.tags,
  });
}

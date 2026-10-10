import { getLogo } from "@/lib/attachments";
import { query } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import type { Tenant } from "@/lib/tenant";
import { localDate, nextUtcDay, zonedMidnightUtc } from "@/lib/zoned-day";
import { filters } from "@/lib/automation/schemas";
import type { z } from "zod";
export type ReportFilters = z.infer<typeof filters>;
export type Branding = {
  companyName: string;
  address: string;
  email: string;
  taxId: string;
  footer: string;
  logoDataUrl: string | null;
  accentColor: string;
  taxPercent: number;
  currency: string;
  timezone: string;
};
export async function getBranding(tenant: Tenant): Promise<Branding> {
  const r = await query(
    "select * from report_branding where organization_id=$1",
    [tenant.organization.id],
  );
  const b = r.rows[0];
  let logoDataUrl: string | null = null;
  if (b?.logo_key) {
    const logo = await getLogo(String(b.logo_key));
    if (logo) {
      logoDataUrl = `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}`;
    }
  }
  if (!logoDataUrl && typeof b?.logo_data_url === "string" && b.logo_data_url.startsWith("data:")) {
    logoDataUrl = b.logo_data_url;
  }
  return {
    companyName: b?.company_name || tenant.organization.name,
    address: b?.address ?? "",
    email: b?.email ?? "",
    taxId: b?.tax_id ?? "",
    footer: b?.footer ?? "Thank you for working with us.",
    logoDataUrl,
    accentColor: b?.accent_color ?? "#2563eb",
    taxPercent: Number(b?.tax_percent ?? 10),
    currency: b?.currency ?? "AUD",
    timezone: b?.timezone ?? "Australia/Sydney",
  };
}
export function validateTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
  } catch {
    throw new ValidationError("Invalid timezone");
  }
  return value;
}
export type ReportEntry = {
  id: string;
  projectId: string;
  project: string;
  clientId: string | null;
  client: string;
  member: string;
  userId: string | null;
  task: string;
  notes: string;
  startedAt: string;
  date: string;
  durationMs: number;
  roundedMs: number;
  billable: boolean;
  rate: number;
  costRate: number;
  currency: string;
  amount: number;
  cost: number;
  tags: string[];
  invoiced: boolean;
};
export function summarize(
  entries: ReportEntry[],
  groupBy: NonNullable<ReportFilters["groupBy"]> = "project",
) {
  const groups = new Map<
    string,
    {
      name: string;
      currency: string;
      durationMs: number;
      billableMs: number;
      amount: number;
      cost: number;
      entries: number;
    }
  >();
  for (const e of entries) {
    const labels =
      groupBy === "tag"
        ? e.tags.length
          ? [...new Set(e.tags)]
          : ["Untagged"]
        : [
            groupBy === "project"
              ? e.project
              : groupBy === "client"
                ? e.client
                : groupBy === "member"
                  ? e.member
                  : e.date,
          ];
    for (const name of labels) {
      const identity =
        groupBy === "project"
          ? e.projectId
          : groupBy === "client"
            ? (e.clientId ?? e.client)
            : groupBy === "member"
              ? (e.userId ?? e.member)
              : name;
      const key = `${identity}\0${e.currency}`;
      const g = groups.get(key) ?? {
        name,
        currency: e.currency,
        durationMs: 0,
        billableMs: 0,
        amount: 0,
        cost: 0,
        entries: 0,
      };
      g.durationMs += e.roundedMs;
      g.billableMs += e.billable ? e.roundedMs : 0;
      g.amount += e.amount;
      g.cost += e.cost;
      g.entries++;
      groups.set(key, g);
    }
  }
  return [...groups.values()].sort((a, b) => b.durationMs - a.durationMs);
}
export async function buildReport(tenant: Tenant, input: ReportFilters) {
  const f = filters.parse(input);
  const branding = await getBranding(tenant);
  const timezone = validateTimezone(f.timezone ?? branding.timezone);
  if (f.from && f.to && f.from > f.to)
    throw new ValidationError("From date must be before To date");
  const params: unknown[] = [tenant.organization.id];
  const where = ["e.organization_id=$1"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.from) add("e.started_at >= ?", zonedMidnightUtc(f.from, timezone));
  if (f.to) add("e.started_at < ?", zonedMidnightUtc(nextUtcDay(f.to), timezone));
  if (f.projectId) add("e.project_id=?", f.projectId);
  if (f.clientId) add("p.client_id=?", f.clientId);
  if (f.userId) add("e.user_id=?", f.userId);
  if (f.tag) add("?=any(e.tags)", f.tag);
  if (f.billable !== undefined) add("e.billable=?", f.billable);
  if (f.invoiced !== undefined)
    where.push(`e.invoice_id is ${f.invoiced ? "not " : ""}null`);
  if (f.search)
    add(
      "(coalesce(e.task,'') || ' ' || coalesce(e.notes,'') || ' ' || coalesce(p.name,'') || ' ' || coalesce(c.name,'')) like ? escape '\\'",
      `%${f.search.replace(/[\\%_]/g, "\\$&")}%`,
    );
  const r = await query(
    `select e.*,p.name as project,c.id as client_id,coalesce(c.name,p.client,'No client') as client,coalesce(u.name,u.email,'Unassigned') as member
 from time_entries e join projects p on p.id=e.project_id left join clients c on c.id=p.client_id left join "user" u on u.id=e.user_id where ${where.join(" and ")} order by e.started_at asc,e.id`,
    params,
  );
  const entries: ReportEntry[] = r.rows.map((e) => {
    const increment = (f.roundMinutes ?? 0) * 60000;
    const roundedMs = increment
      ? Math.ceil(e.duration_ms / increment) * increment
      : e.duration_ms;
    return {
      id: e.id,
      projectId: e.project_id,
      project: e.project,
      clientId: e.client_id,
      client: e.client,
      member: e.member,
      userId: e.user_id,
      task: e.task,
      notes: e.notes,
      startedAt: e.started_at.toISOString(),
      date: localDate(e.started_at, timezone),
      durationMs: e.duration_ms,
      roundedMs,
      billable: e.billable,
      rate: Number(e.hourly_rate),
      costRate: Number(e.cost_rate),
      currency: e.currency ?? branding.currency,
      amount: e.billable
        ? Math.round((roundedMs / 3600000) * Number(e.hourly_rate) * 100) / 100
        : 0,
      cost: Math.round((roundedMs / 3600000) * Number(e.cost_rate) * 100) / 100,
      tags: e.tags,
      invoiced: !!e.invoice_id,
    };
  });
  const totals = summarize(
    entries.map((e) => ({ ...e, project: "Total", projectId: "total" })),
  );
  return {
    title: "Time & project report",
    generatedAt: new Date().toISOString(),
    organization: tenant.organization.name,
    filters: { ...f, timezone },
    branding,
    entries,
    groups: summarize(entries, f.groupBy),
    totals,
    totalMs: entries.reduce((s, e) => s + e.roundedMs, 0),
    billableMs: entries.reduce((s, e) => s + (e.billable ? e.roundedMs : 0), 0),
  };
}
export type Report = Awaited<ReturnType<typeof buildReport>>;
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+\-@]|^[\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function reportCsv(report: Report) {
  const rows: unknown[][] = [
    [
      "Date",
      "Member",
      "Client",
      "Project",
      "Task",
      "Notes",
      "Tags",
      "Hours",
      "Billable",
      "Rate",
      "Currency",
      "Amount",
      "Invoiced",
    ],
  ];
  for (const e of report.entries)
    rows.push([
      e.date,
      e.member,
      e.client,
      e.project,
      e.task,
      e.notes,
      e.tags.join("; "),
      (e.roundedMs / 3600000).toFixed(4),
      e.billable,
      e.rate,
      e.currency,
      e.amount,
      e.invoiced,
    ]);
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

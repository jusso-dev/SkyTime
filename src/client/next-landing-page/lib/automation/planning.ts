import { query } from "@/lib/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { admin, audit, type Context } from "./services";
import { getBranding } from "@/lib/reports/data";
export function weekdays(from: string, to: string) {
  const start = Date.parse(from),
    end = Date.parse(to);
  let count = 0;
  for (let n = start; n <= end; n += 86400000) {
    const d = new Date(n).getUTCDay();
    if (d !== 0 && d !== 6) count++;
  }
  return count;
}
function range(a: { from: string; to: string }) {
  if (a.from > a.to || (Date.parse(a.to) - Date.parse(a.from)) / 86400000 > 366)
    throw new ValidationError("Choose a date range up to one year");
}
async function member(c: Context, userId: string) {
  const r = await query(
    "select user_id from organization_memberships where organization_id=$1 and user_id=$2",
    [c.tenant.organization.id, userId],
  );
  if (!r.rows[0])
    throw new ValidationError("Member not found in this workspace");
}
export async function membersUpdate(
  c: Context,
  a: { id: string; role?: "admin" | "member"; weeklyCapacity?: number },
) {
  admin(c);
  await member(c, a.id);
  if (a.role === "member") {
    const admins = await query(
      "select user_id from organization_memberships where organization_id=$1 and role='admin'",
      [c.tenant.organization.id],
    );
    if (admins.rows.length === 1 && admins.rows[0].user_id === a.id)
      throw new ConflictError("The workspace must keep at least one admin");
  }
  await query(
    "update organization_memberships set role=coalesce($3,role),weekly_capacity=coalesce($4,weekly_capacity) where organization_id=$1 and user_id=$2",
    [c.tenant.organization.id, a.id, a.role ?? null, a.weeklyCapacity ?? null],
  );
  await audit(c, "user", "update", a.id, "Updated member role or capacity", a);
  return { ok: true };
}
export async function allocationsList(c: Context) {
  return (
    await query(
      'select a.*,p.name as project,u.name as member from allocations a join projects p on p.id=a.project_id join "user" u on u.id=a.user_id where a.organization_id=$1 order by a.date,a.id',
      [c.tenant.organization.id],
    )
  ).rows;
}
export async function allocationsCreate(
  c: Context,
  a: {
    projectId: string;
    userId: string;
    date: string;
    hours: number;
    note?: string;
  },
) {
  admin(c);
  await member(c, a.userId);
  const r = await query(
    "insert into allocations(organization_id,user_id,project_id,date,hours,note) values($1,$2,$3,$4,$5,$6) returning *",
    [
      c.tenant.organization.id,
      a.userId,
      a.projectId,
      a.date,
      a.hours,
      a.note ?? "",
    ],
  );
  await audit(
    c,
    "allocation",
    "create",
    r.rows[0].id,
    "Scheduled project work",
    a,
  );
  return r.rows[0];
}
export async function allocationsDelete(c: Context, a: { id: string }) {
  admin(c);
  const r = await query(
    "delete from allocations where id=$1 and organization_id=$2 returning id",
    [a.id, c.tenant.organization.id],
  );
  if (!r.rows[0]) throw new NotFoundError();
  await audit(c, "allocation", "delete", a.id, "Removed scheduled work");
  return { ok: true };
}
export async function leaveList(c: Context) {
  return (
    await query(
      'select t.*,u.name as member from time_off t join "user" u on u.id=t.user_id where t.organization_id=$1 and (t.user_id=$2 or $3) order by t.start_date desc',
      [
        c.tenant.organization.id,
        c.tenant.user.id,
        c.tenant.organization.role === "admin",
      ],
    )
  ).rows;
}
export async function leaveCreate(
  c: Context,
  a: { from: string; to: string; note?: string },
) {
  range(a);
  const overlaps = await query(
    "select id from time_off where organization_id=$1 and user_id=$2 and status in ('pending','approved') and start_date <= $4::date and end_date >= $3::date",
    [c.tenant.organization.id, c.tenant.user.id, a.from, a.to],
  );
  if (overlaps.rows[0])
    throw new ConflictError(
      "A pending or approved leave request overlaps this period",
    );
  const r = await query(
    "insert into time_off(organization_id,user_id,start_date,end_date,note) values($1,$2,$3,$4,$5) returning *",
    [c.tenant.organization.id, c.tenant.user.id, a.from, a.to, a.note ?? ""],
  );
  await audit(c, "time_off", "create", r.rows[0].id, "Requested time off", a);
  return r.rows[0];
}
export async function leaveUpdate(
  c: Context,
  a: { id: string; status: "approved" | "rejected" },
) {
  admin(c);
  const r = await query(
    "update time_off set status=$3 where id=$1 and organization_id=$2 and status='pending' returning *",
    [a.id, c.tenant.organization.id, a.status],
  );
  if (!r.rows[0])
    throw new ConflictError("Only pending requests can be reviewed");
  await audit(c, "time_off", "update", a.id, `Time off ${a.status}`, a);
  return r.rows[0];
}
export async function leaveDelete(c: Context, a: { id: string }) {
  const r = await query(
    "delete from time_off where id=$1 and organization_id=$2 and (user_id=$3 or $4) returning id",
    [
      a.id,
      c.tenant.organization.id,
      c.tenant.user.id,
      c.tenant.organization.role === "admin",
    ],
  );
  if (!r.rows[0])
    throw new ForbiddenError("Request not found or not owned by you");
  await audit(c, "time_off", "delete", a.id, "Cancelled time off");
  return { ok: true };
}
export async function workload(c: Context, a: { from: string; to: string }) {
  range(a);
  const b = await getBranding(c.tenant);
  const members = (
    await query(
      'select m.user_id as id,u.name,m.weekly_capacity from organization_memberships m join "user" u on u.id=m.user_id where m.organization_id=$1 order by u.name',
      [c.tenant.organization.id],
    )
  ).rows;
  const allocations = (
    await query(
      "select user_id,sum(hours)::float as hours from allocations where organization_id=$1 and date between $2::date and $3::date group by user_id",
      [c.tenant.organization.id, a.from, a.to],
    )
  ).rows;
  const actual = (
    await query(
      "select user_id,sum(duration_ms)/3600000.0 as hours,sum(case when billable then duration_ms else 0 end)/3600000.0 as billable from time_entries where organization_id=$1 and (started_at at time zone $4)::date between $2::date and $3::date group by user_id",
      [c.tenant.organization.id, a.from, a.to, b.timezone],
    )
  ).rows;
  const leave = (
    await query(
      "select user_id,to_char(greatest(start_date,$2::date),'YYYY-MM-DD') as start,to_char(least(end_date,$3::date),'YYYY-MM-DD') as end from time_off where organization_id=$1 and status='approved' and start_date<=$3::date and end_date>=$2::date",
      [c.tenant.organization.id, a.from, a.to],
    )
  ).rows;
  return members.map((m) => {
    const capacity = (Number(m.weekly_capacity) / 5) * weekdays(a.from, a.to);
    const leaveHours = leave
      .filter((l) => l.user_id === m.id)
      .reduce(
        (sum, l) =>
          sum + (weekdays(l.start, l.end) * Number(m.weekly_capacity)) / 5,
        0,
      );
    const available = Math.max(0, capacity - leaveHours);
    const planned = allocations.find((p) => p.user_id === m.id)?.hours ?? 0;
    const tracked = Number(actual.find((t) => t.user_id === m.id)?.hours ?? 0);
    const billable = Number(
      actual.find((t) => t.user_id === m.id)?.billable ?? 0,
    );
    return {
      id: m.id,
      name: m.name,
      weeklyCapacity: Number(m.weekly_capacity),
      capacity,
      leaveHours,
      available,
      planned,
      tracked,
      billable,
      remaining: available - planned,
      utilization: available ? (billable / available) * 100 : null,
    };
  });
}

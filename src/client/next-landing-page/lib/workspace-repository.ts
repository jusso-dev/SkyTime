import { query, toNumber } from "@/lib/db";
import type {
  BoardTask,
  Client,
  Project,
  TimeEntry,
  TimesheetPeriod,
  TimesheetPeriodStatus,
  WorkspaceSettings,
} from "@/lib/workspace-types";

export type ProjectRow = {
  id: string;
  name: string;
  client: string;
  client_id: string | null;
  rate: string | number;
  color: string;
  status: Project["status"];
};

export type TimeEntryRow = {
  id: string;
  project_id: string;
  user_id: string | null;
  task: string;
  notes: string;
  started_at: Date;
  duration_ms: number;
  billable: boolean;
};

export type BoardTaskRow = {
  id: string;
  project_id: string;
  title: string;
  status: BoardTask["status"];
  estimate_hours: string | number;
};

export type ClientRow = {
  id: string;
  name: string;
  contact_name: string;
  contact_email: string;
  address: string;
  currency: string;
  default_rate: string | number;
  notes: string;
  archived_at: Date | null;
};

export type TimesheetPeriodRow = {
  id: string;
  user_id: string;
  reviewer_email: string | null;
  period_start: Date;
  period_end: Date;
  status: TimesheetPeriodStatus;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  note: string;
  total_ms: string | number;
};

export type SettingsRow = {
  reminder_enabled: boolean;
  reminder_cadence_minutes: number;
  reminder_last_sent_at: Date | null;
  fy_start_month: number;
};

export function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    clientId: row.client_id,
    rate: toNumber(row.rate),
    color: row.color,
    status: row.status,
  };
}

export function entryFromRow(row: TimeEntryRow, locked = false): TimeEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    task: row.task,
    notes: row.notes,
    startedAt: row.started_at.toISOString(),
    durationMs: row.duration_ms,
    billable: row.billable,
    locked,
  };
}

export function taskFromRow(row: BoardTaskRow): BoardTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    estimateHours: toNumber(row.estimate_hours),
  };
}

export function clientFromRow(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    address: row.address,
    currency: row.currency,
    defaultRate: toNumber(row.default_rate),
    notes: row.notes,
    archivedAt: row.archived_at?.toISOString() ?? null,
  };
}

export function periodFromRow(
  row: TimesheetPeriodRow,
  userEmail: string | null = null,
): TimesheetPeriod {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail,
    periodStart: row.period_start.toISOString().slice(0, 10),
    periodEnd: row.period_end.toISOString().slice(0, 10),
    status: row.status,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewedBy: row.reviewed_by,
    reviewerEmail: row.reviewer_email,
    note: row.note,
    totalMs: toNumber(row.total_ms),
  };
}

export function settingsFromRow(row: SettingsRow): WorkspaceSettings {
  return {
    reminders: {
      enabled: row.reminder_enabled,
      cadenceMinutes: row.reminder_cadence_minutes,
      lastSentAt: row.reminder_last_sent_at?.toISOString(),
    },
    fyStartMonth: row.fy_start_month,
  };
}

const PROJECT_COLUMNS = "id, name, client, client_id, rate, color, status";
const TIME_ENTRY_COLUMNS = "id, project_id, user_id, task, notes, started_at, duration_ms, billable";
const TASK_COLUMNS = "id, project_id, title, status, estimate_hours";
const CLIENT_COLUMNS =
  "id, name, contact_name, contact_email, address, currency, default_rate, notes, archived_at";
const PERIOD_COLUMNS =
  "id, user_id, reviewer_email, period_start, period_end, status, submitted_at, reviewed_at, reviewed_by, note, total_ms";

export async function listProjects(organizationId: string) {
  const result = await query<ProjectRow>(
    `select ${PROJECT_COLUMNS} from projects where organization_id = $1 order by created_at desc`,
    [organizationId],
  );
  return result.rows.map(projectFromRow);
}

export async function listClients(organizationId: string) {
  const result = await query<ClientRow>(
    `select ${CLIENT_COLUMNS}
     from clients
     where organization_id = $1
     order by archived_at nulls first, name asc`,
    [organizationId],
  );
  return result.rows.map(clientFromRow);
}

type EntryWithLockRow = TimeEntryRow & { locked: boolean };

export async function listEntries(organizationId: string) {
  const result = await query<EntryWithLockRow>(
    `select te.id, te.project_id, te.user_id, te.task, te.notes,
            te.started_at, te.duration_ms, te.billable,
            exists (
              select 1
              from timesheet_periods tp
              where tp.organization_id = te.organization_id
                and tp.user_id is not null
                and tp.user_id = te.user_id
                and tp.status = 'approved'
                and te.started_at >= tp.period_start
                and te.started_at < tp.period_end + interval '1 day'
            ) as locked
     from time_entries te
     where te.organization_id = $1
     order by te.started_at desc, te.created_at desc`,
    [organizationId],
  );
  return result.rows.map((row: EntryWithLockRow) => entryFromRow(row, row.locked));
}

export async function listTasks(organizationId: string) {
  const result = await query<BoardTaskRow>(
    `select ${TASK_COLUMNS} from board_tasks where organization_id = $1 order by created_at asc`,
    [organizationId],
  );
  return result.rows.map(taskFromRow);
}

export async function getSettings(organizationId: string) {
  const result = await query<SettingsRow>(
    `insert into workspace_settings (organization_id)
     values ($1)
     on conflict (organization_id) do update set organization_id = excluded.organization_id
     returning reminder_enabled, reminder_cadence_minutes, reminder_last_sent_at, fy_start_month`,
    [organizationId],
  );
  return settingsFromRow(result.rows[0]);
}

export type PeriodWindow = { start: string; end: string };

export function currentPeriodWindow(now = new Date()): PeriodWindow {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  const dayOfWeek = date.getUTCDay();
  const offsetToMonday = (dayOfWeek + 6) % 7;
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - offsetToMonday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export async function getOrCreateCurrentPeriod(
  organizationId: string,
  userId: string,
  userEmail: string | null,
) {
  const window = currentPeriodWindow();
  const result = await query<TimesheetPeriodRow>(
    `insert into timesheet_periods (organization_id, user_id, period_start, period_end)
     values ($1, $2, $3, $4)
     on conflict (organization_id, user_id, period_start)
     do update set updated_at = now()
     returning ${PERIOD_COLUMNS}`,
    [organizationId, userId, window.start, window.end],
  );
  await refreshPeriodTotals(organizationId, userId, window.start);
  const refreshed = await query<TimesheetPeriodRow>(
    `select ${PERIOD_COLUMNS} from timesheet_periods where id = $1`,
    [result.rows[0].id],
  );
  return periodFromRow(refreshed.rows[0], userEmail);
}

export async function refreshPeriodTotals(
  organizationId: string,
  userId: string,
  periodStart: string,
) {
  await query(
    `update timesheet_periods tp
     set total_ms = coalesce((
       select sum(te.duration_ms)::bigint
       from time_entries te
       where te.organization_id = tp.organization_id
         and te.user_id = tp.user_id
         and te.started_at >= tp.period_start
         and te.started_at < tp.period_end + interval '1 day'
     ), 0),
     updated_at = now()
     where tp.organization_id = $1 and tp.user_id = $2 and tp.period_start = $3`,
    [organizationId, userId, periodStart],
  );
}

export async function isEntryLocked(
  organizationId: string,
  userId: string | null,
  startedAt: Date,
): Promise<boolean> {
  if (!userId) return false;
  const result = await query<{ locked: boolean }>(
    `select exists (
       select 1 from timesheet_periods
       where organization_id = $1
         and user_id = $2
         and status = 'approved'
         and $3::timestamptz >= period_start
         and $3::timestamptz < period_end + interval '1 day'
     ) as locked`,
    [organizationId, userId, startedAt.toISOString()],
  );
  return result.rows[0]?.locked === true;
}

export async function getWorkspace(
  organizationId: string,
  userId: string,
  userEmail: string | null,
) {
  const [projects, entries, tasks, clients, settings, currentPeriod] = await Promise.all([
    listProjects(organizationId),
    listEntries(organizationId),
    listTasks(organizationId),
    listClients(organizationId),
    getSettings(organizationId),
    getOrCreateCurrentPeriod(organizationId, userId, userEmail),
  ]);

  return { projects, entries, tasks, clients, settings, currentPeriod };
}

export { PROJECT_COLUMNS, TIME_ENTRY_COLUMNS, TASK_COLUMNS, CLIENT_COLUMNS, PERIOD_COLUMNS };

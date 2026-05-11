import { query, toNumber } from "@/lib/db";
import type { BoardTask, Project, TimeEntry, WorkspaceSettings } from "@/lib/workspace-types";

export type ProjectRow = {
  id: string;
  name: string;
  client: string;
  rate: string | number;
  color: string;
  status: Project["status"];
};

export type TimeEntryRow = {
  id: string;
  project_id: string;
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
    rate: toNumber(row.rate),
    color: row.color,
    status: row.status,
  };
}

export function entryFromRow(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    task: row.task,
    notes: row.notes,
    startedAt: row.started_at.toISOString(),
    durationMs: row.duration_ms,
    billable: row.billable,
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

export async function listProjects(organizationId: string) {
  const result = await query<ProjectRow>(
    "select id, name, client, rate, color, status from projects where organization_id = $1 order by created_at desc",
    [organizationId],
  );
  return result.rows.map(projectFromRow);
}

export async function listEntries(organizationId: string) {
  const result = await query<TimeEntryRow>(
    "select id, project_id, task, notes, started_at, duration_ms, billable from time_entries where organization_id = $1 order by started_at desc, created_at desc",
    [organizationId],
  );
  return result.rows.map(entryFromRow);
}

export async function listTasks(organizationId: string) {
  const result = await query<BoardTaskRow>(
    "select id, project_id, title, status, estimate_hours from board_tasks where organization_id = $1 order by created_at asc",
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

export async function getWorkspace(organizationId: string) {
  const [projects, entries, tasks, settings] = await Promise.all([
    listProjects(organizationId),
    listEntries(organizationId),
    listTasks(organizationId),
    getSettings(organizationId),
  ]);

  return { projects, entries, tasks, settings };
}

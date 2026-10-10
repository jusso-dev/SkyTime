-- SkyTime schema for SQLite / Cloudflare D1. Idempotent.

create table if not exists organizations (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  name text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists organization_memberships (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  user_id text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  weekly_capacity real not null default 40 check (weekly_capacity between 0 and 168),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (organization_id, user_id)
);

create table if not exists organization_invites (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  accepted_at text,
  unique (organization_id, email)
);

create table if not exists clients (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  name text not null,
  contact_name text not null default '',
  contact_email text not null default '',
  address text not null default '',
  currency text not null default 'AUD',
  default_rate real not null default 0,
  notes text not null default '',
  archived_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (organization_id, name)
);

create table if not exists projects (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text references organizations(id) on delete cascade,
  name text not null,
  client text not null default '',
  client_id text references clients(id) on delete set null,
  rate real not null default 0,
  cost_rate real not null default 0 check (cost_rate >= 0),
  color text not null default 'oklch(0.56 0.13 155)',
  status text not null default 'Active' check (status in ('Active', 'Paused')),
  budget_hours real not null default 0 check (budget_hours >= 0),
  budget_amount real not null default 0 check (budget_amount >= 0),
  deadline text,
  notes text not null default '',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists board_tasks (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text references organizations(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  title text not null,
  status text not null default 'Backlog' check (status in ('Backlog', 'Today', 'Doing', 'Done')),
  estimate_hours real not null default 1,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists time_entries (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text references organizations(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  user_id text,
  task text not null,
  notes text not null default '',
  started_at text not null,
  duration_ms integer not null check (duration_ms > 0),
  billable integer not null default 1 check (billable in (0, 1)),
  tags text not null default '[]',
  task_id text references board_tasks(id) on delete set null,
  hourly_rate real,
  cost_rate real,
  currency text,
  invoice_id text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists workspace_settings (
  organization_id text primary key references organizations(id) on delete cascade,
  reminder_enabled integer not null default 0 check (reminder_enabled in (0, 1)),
  reminder_cadence_minutes integer not null default 60,
  reminder_last_sent_at text,
  fy_start_month integer not null default 7 check (fy_start_month between 1 and 12),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists timesheet_periods (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  user_id text not null,
  period_start text not null,
  period_end text not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at text,
  reviewed_at text,
  reviewed_by text,
  reviewer_email text,
  note text not null default '',
  total_ms integer not null default 0,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (organization_id, user_id, period_start)
);

create table if not exists audit_log (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text references organizations(id) on delete cascade,
  user_id text,
  user_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null default '',
  before_data text,
  after_data text,
  ip text,
  user_agent text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists error_log (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text references organizations(id) on delete cascade,
  user_id text,
  level text not null default 'error' check (level in ('error', 'warn', 'info')),
  message text not null,
  stack text,
  context text,
  path text,
  method text,
  status_code integer,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists api_tokens (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  user_id text not null,
  name text not null,
  token_hash text not null unique,
  prefix text not null,
  scope text not null check (scope in ('read', 'write')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at text not null,
  last_used_at text,
  revoked_at text
);

create table if not exists running_timers (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  user_id text not null,
  project_id text not null references projects(id),
  task text not null,
  notes text not null default '',
  billable integer not null default 1 check (billable in (0, 1)),
  tags text not null default '[]',
  started_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (organization_id, user_id)
);

create table if not exists tags (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  name text not null,
  color text not null default '#2563eb',
  unique (organization_id, name)
);

create table if not exists report_branding (
  organization_id text primary key references organizations(id) on delete cascade,
  company_name text not null default '',
  address text not null default '',
  email text not null default '',
  tax_id text not null default '',
  footer text not null default 'Thank you for working with us.',
  logo_data_url text,
  logo_key text,
  accent_color text not null default '#2563eb',
  tax_percent real not null default 10,
  currency text not null default 'AUD',
  timezone text not null default 'Australia/Sydney'
);

create table if not exists saved_reports (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  user_id text not null,
  name text not null,
  filters text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists expenses (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  user_id text not null,
  project_id text not null references projects(id),
  date text not null,
  description text not null,
  category text not null default 'Other',
  amount real not null check (amount > 0),
  currency text not null default 'AUD',
  billable integer not null default 1 check (billable in (0, 1)),
  invoice_id text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists invoices (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  client_id text not null references clients(id),
  number text not null,
  status text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'void')),
  issued_date text not null,
  due_date text not null,
  currency text not null,
  subtotal real not null,
  tax_percent real not null,
  tax real not null,
  total real not null,
  notes text not null default '',
  lines text not null,
  client_snapshot text not null,
  branding_snapshot text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (organization_id, number)
);

create table if not exists allocations (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  user_id text not null,
  project_id text not null references projects(id),
  date text not null,
  hours real not null check (hours > 0 and hours <= 24),
  note text not null default '',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists time_off (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  organization_id text not null references organizations(id) on delete cascade,
  user_id text not null,
  start_date text not null,
  end_date text not null,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check (end_date >= start_date)
);

create index if not exists projects_organization_id_idx on projects(organization_id);
create index if not exists projects_client_id_idx on projects(client_id);
create index if not exists time_entries_organization_id_idx on time_entries(organization_id);
create index if not exists time_entries_user_id_idx on time_entries(user_id);
create index if not exists time_entries_started_at_idx on time_entries(organization_id, started_at);
create index if not exists time_entries_invoice_idx on time_entries(organization_id, invoice_id);
create index if not exists board_tasks_organization_id_idx on board_tasks(organization_id);
create index if not exists clients_organization_id_idx on clients(organization_id);
create index if not exists clients_archived_idx on clients(organization_id, archived_at);
create index if not exists timesheet_periods_org_status_idx on timesheet_periods(organization_id, status);
create index if not exists timesheet_periods_user_idx on timesheet_periods(organization_id, user_id, period_start desc);
create index if not exists audit_log_org_created_idx on audit_log(organization_id, created_at desc);
create index if not exists audit_log_entity_idx on audit_log(entity_type, entity_id);
create index if not exists error_log_org_created_idx on error_log(organization_id, created_at desc);
create index if not exists error_log_level_idx on error_log(level, created_at desc);

drop trigger if exists board_tasks_project_ins;
drop trigger if exists board_tasks_project_upd;
drop trigger if exists running_timers_project_ins;
drop trigger if exists running_timers_project_upd;
drop trigger if exists expenses_project_ins;
drop trigger if exists expenses_project_upd;
drop trigger if exists allocations_project_ins;
drop trigger if exists allocations_project_upd;
drop trigger if exists time_entries_guard_ins;
drop trigger if exists time_entries_guard_upd;
drop trigger if exists time_entries_guard_del;
drop trigger if exists time_entries_rates_ins;
drop trigger if exists time_entries_rates_upd;
drop trigger if exists time_entries_refresh_ins;
drop trigger if exists time_entries_refresh_upd;
drop trigger if exists time_entries_refresh_del;
drop trigger if exists timesheet_periods_guard_ins;
drop trigger if exists timesheet_periods_guard_upd;

create trigger board_tasks_project_ins before insert on board_tasks begin
  select raise(abort, 'Project does not belong to this organization')
  where not exists (select 1 from projects where id = new.project_id and organization_id = new.organization_id);
end;
create trigger board_tasks_project_upd before update on board_tasks begin
  select raise(abort, 'Project does not belong to this organization')
  where not exists (select 1 from projects where id = new.project_id and organization_id = new.organization_id);
end;
create trigger running_timers_project_ins before insert on running_timers begin
  select raise(abort, 'Project does not belong to this organization')
  where not exists (select 1 from projects where id = new.project_id and organization_id = new.organization_id);
end;
create trigger running_timers_project_upd before update on running_timers begin
  select raise(abort, 'Project does not belong to this organization')
  where not exists (select 1 from projects where id = new.project_id and organization_id = new.organization_id);
end;
create trigger expenses_project_ins before insert on expenses begin
  select raise(abort, 'Project does not belong to this organization')
  where not exists (select 1 from projects where id = new.project_id and organization_id = new.organization_id);
end;
create trigger expenses_project_upd before update on expenses begin
  select raise(abort, 'Project does not belong to this organization')
  where not exists (select 1 from projects where id = new.project_id and organization_id = new.organization_id);
end;
create trigger allocations_project_ins before insert on allocations begin
  select raise(abort, 'Project does not belong to this organization')
  where not exists (select 1 from projects where id = new.project_id and organization_id = new.organization_id);
end;
create trigger allocations_project_upd before update on allocations begin
  select raise(abort, 'Project does not belong to this organization')
  where not exists (select 1 from projects where id = new.project_id and organization_id = new.organization_id);
end;

create trigger time_entries_guard_ins before insert on time_entries begin
  select raise(abort, 'Approved week is locked')
  where exists (
    select 1 from timesheet_periods
    where organization_id = new.organization_id and user_id = new.user_id and status = 'approved'
      and new.started_at >= period_start and new.started_at < date(period_end, '+1 day')
  );
  select raise(abort, 'Project does not belong to this organization')
  where not exists (select 1 from projects where id = new.project_id and organization_id = new.organization_id);
  select raise(abort, 'Task does not belong to this project')
  where new.task_id is not null and not exists (
    select 1 from board_tasks where id = new.task_id and project_id = new.project_id and organization_id = new.organization_id
  );
end;

create trigger time_entries_guard_upd before update on time_entries begin
  select raise(abort, 'Invoiced entries are locked')
  where old.invoice_id is not null and new.invoice_id is not null;
  select raise(abort, 'Approved entries are locked')
  where exists (
    select 1 from timesheet_periods
    where organization_id = old.organization_id and user_id = old.user_id and status = 'approved'
      and old.started_at >= period_start and old.started_at < date(period_end, '+1 day')
  ) and (
    new.organization_id is not old.organization_id or new.project_id is not old.project_id
    or new.user_id is not old.user_id or new.task is not old.task or new.notes is not old.notes
    or new.started_at is not old.started_at or new.duration_ms is not old.duration_ms
    or new.billable is not old.billable or new.tags is not old.tags or new.task_id is not old.task_id
    or new.hourly_rate is not old.hourly_rate or new.cost_rate is not old.cost_rate
    or new.currency is not old.currency
  );
  select raise(abort, 'Approved week is locked')
  where new.started_at is not old.started_at and exists (
    select 1 from timesheet_periods
    where organization_id = new.organization_id and user_id = new.user_id and status = 'approved'
      and new.started_at >= period_start and new.started_at < date(period_end, '+1 day')
  );
  select raise(abort, 'Project does not belong to this organization')
  where not exists (select 1 from projects where id = new.project_id and organization_id = new.organization_id);
  select raise(abort, 'Task does not belong to this project')
  where new.task_id is not null and not exists (
    select 1 from board_tasks where id = new.task_id and project_id = new.project_id and organization_id = new.organization_id
  );
end;

create trigger time_entries_guard_del before delete on time_entries begin
  select raise(abort, 'Invoiced entries are locked') where old.invoice_id is not null;
  select raise(abort, 'Approved entries are locked')
  where exists (
    select 1 from timesheet_periods
    where organization_id = old.organization_id and user_id = old.user_id and status = 'approved'
      and old.started_at >= period_start and old.started_at < date(period_end, '+1 day')
  );
end;

create trigger time_entries_rates_ins after insert on time_entries
when new.hourly_rate is null
begin
  update time_entries
  set hourly_rate = (select rate from projects where id = new.project_id),
      cost_rate = (select cost_rate from projects where id = new.project_id),
      currency = (
        select coalesce(c.currency, (select currency from report_branding where organization_id = new.organization_id), 'AUD')
        from projects p left join clients c on c.id = p.client_id
        where p.id = new.project_id
      )
  where id = new.id;
end;

create trigger time_entries_rates_upd after update of project_id on time_entries
begin
  update time_entries
  set hourly_rate = (select rate from projects where id = new.project_id),
      cost_rate = (select cost_rate from projects where id = new.project_id),
      currency = (
        select coalesce(c.currency, (select currency from report_branding where organization_id = new.organization_id), 'AUD')
        from projects p left join clients c on c.id = p.client_id
        where p.id = new.project_id
      )
  where id = new.id;
end;

create trigger time_entries_refresh_ins after insert on time_entries begin
  update timesheet_periods
  set total_ms = coalesce((
    select sum(e.duration_ms) from time_entries e
    where e.organization_id = timesheet_periods.organization_id
      and e.user_id = timesheet_periods.user_id
      and e.started_at >= timesheet_periods.period_start
      and e.started_at < date(timesheet_periods.period_end, '+1 day')
  ), 0)
  where organization_id = new.organization_id and user_id = new.user_id
    and new.started_at >= period_start and new.started_at < date(period_end, '+1 day');
end;

create trigger time_entries_refresh_upd after update on time_entries begin
  update timesheet_periods
  set total_ms = coalesce((
    select sum(e.duration_ms) from time_entries e
    where e.organization_id = timesheet_periods.organization_id
      and e.user_id = timesheet_periods.user_id
      and e.started_at >= timesheet_periods.period_start
      and e.started_at < date(timesheet_periods.period_end, '+1 day')
  ), 0)
  where organization_id = old.organization_id and user_id = old.user_id
    and old.started_at >= period_start and old.started_at < date(period_end, '+1 day');
  update timesheet_periods
  set total_ms = coalesce((
    select sum(e.duration_ms) from time_entries e
    where e.organization_id = timesheet_periods.organization_id
      and e.user_id = timesheet_periods.user_id
      and e.started_at >= timesheet_periods.period_start
      and e.started_at < date(timesheet_periods.period_end, '+1 day')
  ), 0)
  where organization_id = new.organization_id and user_id = new.user_id
    and new.started_at >= period_start and new.started_at < date(period_end, '+1 day');
end;

create trigger time_entries_refresh_del after delete on time_entries begin
  update timesheet_periods
  set total_ms = coalesce((
    select sum(e.duration_ms) from time_entries e
    where e.organization_id = timesheet_periods.organization_id
      and e.user_id = timesheet_periods.user_id
      and e.started_at >= timesheet_periods.period_start
      and e.started_at < date(timesheet_periods.period_end, '+1 day')
  ), 0)
  where organization_id = old.organization_id and user_id = old.user_id
    and old.started_at >= period_start and old.started_at < date(period_end, '+1 day');
end;

create trigger timesheet_periods_guard_ins before insert on timesheet_periods
when new.status in ('submitted', 'approved')
begin
  select raise(abort, 'Stop the running timer before submitting or approving')
  where exists (
    select 1 from running_timers
    where organization_id = new.organization_id and user_id = new.user_id
      and started_at >= new.period_start and started_at < date(new.period_end, '+1 day')
  );
end;

create trigger timesheet_periods_guard_upd before update on timesheet_periods
when new.status in ('submitted', 'approved') and new.status is not old.status
begin
  select raise(abort, 'Stop the running timer before submitting or approving')
  where exists (
    select 1 from running_timers
    where organization_id = new.organization_id and user_id = new.user_id
      and started_at >= new.period_start and started_at < date(new.period_end, '+1 day')
  );
end;

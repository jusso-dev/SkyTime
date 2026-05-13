create extension if not exists "pgcrypto";

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by text not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (organization_id, email)
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  client text not null default '',
  rate numeric(10, 2) not null default 0,
  color text not null default 'oklch(0.56 0.13 155)',
  status text not null default 'Active' check (status in ('Active', 'Paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  task text not null,
  notes text not null default '',
  started_at timestamptz not null,
  duration_ms integer not null check (duration_ms > 0),
  billable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists board_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  status text not null default 'Backlog' check (status in ('Backlog', 'Today', 'Doing', 'Done')),
  estimate_hours numeric(6, 2) not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  reminder_enabled boolean not null default false,
  reminder_cadence_minutes integer not null default 60,
  reminder_last_sent_at timestamptz,
  fy_start_month integer not null default 7 check (fy_start_month between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table projects add column if not exists organization_id uuid references organizations(id) on delete cascade;
alter table time_entries add column if not exists organization_id uuid references organizations(id) on delete cascade;
alter table board_tasks add column if not exists organization_id uuid references organizations(id) on delete cascade;

create index if not exists projects_organization_id_idx on projects(organization_id);
create index if not exists time_entries_organization_id_idx on time_entries(organization_id);
create index if not exists board_tasks_organization_id_idx on board_tasks(organization_id);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  contact_name text not null default '',
  contact_email text not null default '',
  address text not null default '',
  currency text not null default 'AUD',
  default_rate numeric(10, 2) not null default 0,
  notes text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists clients_organization_id_idx on clients(organization_id);
create index if not exists clients_archived_idx on clients(organization_id, archived_at);

alter table projects add column if not exists client_id uuid references clients(id) on delete set null;
create index if not exists projects_client_id_idx on projects(client_id);

alter table time_entries add column if not exists user_id text;
create index if not exists time_entries_user_id_idx on time_entries(user_id);
create index if not exists time_entries_started_at_idx on time_entries(organization_id, started_at);

create table if not exists timesheet_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  reviewer_email text,
  note text not null default '',
  total_ms bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, period_start)
);

create index if not exists timesheet_periods_org_status_idx on timesheet_periods(organization_id, status);
create index if not exists timesheet_periods_user_idx on timesheet_periods(organization_id, user_id, period_start desc);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  user_id text,
  user_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null default '',
  before_data jsonb,
  after_data jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_org_created_idx on audit_log(organization_id, created_at desc);
create index if not exists audit_log_entity_idx on audit_log(entity_type, entity_id);

create table if not exists error_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  user_id text,
  level text not null default 'error' check (level in ('error', 'warn', 'info')),
  message text not null,
  stack text,
  context jsonb,
  path text,
  method text,
  status_code integer,
  created_at timestamptz not null default now()
);

create index if not exists error_log_org_created_idx on error_log(organization_id, created_at desc);
create index if not exists error_log_level_idx on error_log(level, created_at desc);

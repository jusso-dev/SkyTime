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

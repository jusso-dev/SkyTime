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


-- Automation and reporting expansion. Additive and safe to run repeatedly.
alter table projects add column if not exists budget_hours numeric(12,2) not null default 0 check (budget_hours >= 0);
alter table projects add column if not exists budget_amount numeric(12,2) not null default 0 check (budget_amount >= 0);
alter table projects add column if not exists cost_rate numeric(10,2) not null default 0 check (cost_rate >= 0);
alter table projects add column if not exists deadline date;
alter table projects add column if not exists notes text not null default '';
alter table time_entries add column if not exists tags text[] not null default '{}';
alter table time_entries add column if not exists task_id uuid references board_tasks(id) on delete set null;
alter table time_entries add column if not exists hourly_rate numeric(10,2);
alter table time_entries add column if not exists cost_rate numeric(10,2);
alter table time_entries add column if not exists currency text;
update time_entries e set hourly_rate = p.rate, cost_rate = p.cost_rate, currency = coalesce(c.currency, 'AUD')
from projects p left join clients c on c.id = p.client_id
where p.id = e.project_id and e.hourly_rate is null;

create table if not exists api_tokens (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 user_id text not null, name text not null, token_hash text not null unique, prefix text not null,
 scope text not null check (scope in ('read','write')), created_at timestamptz not null default now(),
 expires_at timestamptz not null, last_used_at timestamptz, revoked_at timestamptz
);
create table if not exists running_timers (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 user_id text not null, project_id uuid not null references projects(id), task text not null, notes text not null default '',
 billable boolean not null default true, tags text[] not null default '{}', started_at timestamptz not null default now(),
 unique (organization_id, user_id)
);
create table if not exists tags (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, color text not null default '#2563eb', unique(organization_id,name)
);
create table if not exists report_branding (
 organization_id uuid primary key references organizations(id) on delete cascade,
 company_name text not null default '', address text not null default '', email text not null default '',
 tax_id text not null default '', footer text not null default 'Thank you for working with us.',
 logo_data_url text, accent_color text not null default '#2563eb', tax_percent numeric(5,2) not null default 10,
 currency text not null default 'AUD', timezone text not null default 'Australia/Sydney'
);
create table if not exists saved_reports (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 user_id text not null, name text not null, filters jsonb not null, created_at timestamptz not null default now()
);
create table if not exists expenses (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 user_id text not null, project_id uuid not null references projects(id), date date not null,
 description text not null, category text not null default 'Other', amount numeric(12,2) not null check(amount > 0),
 currency text not null default 'AUD', billable boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists invoices (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 client_id uuid not null references clients(id), number text not null, status text not null default 'draft'
 check(status in ('draft','issued','paid','void')), issued_date date not null, due_date date not null,
 currency text not null, subtotal numeric(12,2) not null, tax_percent numeric(5,2) not null, tax numeric(12,2) not null,
 total numeric(12,2) not null, notes text not null default '', lines jsonb not null, client_snapshot jsonb not null,
 created_at timestamptz not null default now(), unique(organization_id,number)
);
alter table time_entries add column if not exists invoice_id uuid references invoices(id);
alter table expenses add column if not exists invoice_id uuid references invoices(id);
create index if not exists time_entries_invoice_idx on time_entries(organization_id,invoice_id);

-- Enforce tenant boundaries even when records are written via legacy API routes.
create or replace function skytime_check_project_tenant() returns trigger language plpgsql as $$
begin
 if not exists(select 1 from projects where id=new.project_id and organization_id=new.organization_id) then
  raise exception 'Project does not belong to this organization' using errcode='23514';
 end if;
 return new;
end $$;
drop trigger if exists check_project_tenant on board_tasks;
create trigger check_project_tenant before insert or update on board_tasks for each row execute function skytime_check_project_tenant();
drop trigger if exists check_project_tenant on running_timers;
create trigger check_project_tenant before insert or update on running_timers for each row execute function skytime_check_project_tenant();
drop trigger if exists check_project_tenant on expenses;
create trigger check_project_tenant before insert or update on expenses for each row execute function skytime_check_project_tenant();

create or replace function skytime_guard_entry() returns trigger language plpgsql as $$
declare org uuid; owner_id text; moment timestamptz;
begin
 if TG_OP='DELETE' then org:=old.organization_id; owner_id:=old.user_id; else org:=new.organization_id; owner_id:=new.user_id; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text || coalesce(owner_id,''),0));
 if TG_OP in ('DELETE','UPDATE') then
  if old.invoice_id is not null and (TG_OP='DELETE' or new.invoice_id is not null) then
   raise exception 'Invoiced entries are locked' using errcode='23514';
  end if;
  if exists(select 1 from timesheet_periods where organization_id=org and user_id=owner_id and status='approved'
   and old.started_at >= period_start and old.started_at < period_end + interval '1 day') then
   -- Invoice assignment does not change approved time.
   if TG_OP='DELETE' or (to_jsonb(new)-'invoice_id'-'updated_at') is distinct from (to_jsonb(old)-'invoice_id'-'updated_at') then
    raise exception 'Approved entries are locked' using errcode='23514';
   end if;
  end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 if TG_OP='INSERT' or new.started_at is distinct from old.started_at then
  if exists(select 1 from timesheet_periods where organization_id=org and user_id=owner_id and status='approved'
   and new.started_at >= period_start and new.started_at < period_end + interval '1 day') then
   raise exception 'Approved week is locked' using errcode='23514';
  end if;
 end if;
 if not exists(select 1 from projects where id=new.project_id and organization_id=org) then
  raise exception 'Project does not belong to this organization' using errcode='23514';
 end if;
 if new.task_id is not null and not exists(select 1 from board_tasks where id=new.task_id and project_id=new.project_id and organization_id=org) then
  raise exception 'Task does not belong to this project' using errcode='23514';
 end if;
 if new.hourly_rate is null or TG_OP='INSERT' or new.project_id is distinct from old.project_id then
  select p.rate,p.cost_rate,coalesce(c.currency,(select currency from report_branding where organization_id=org),'AUD') into new.hourly_rate,new.cost_rate,new.currency
   from projects p left join clients c on c.id=p.client_id where p.id=new.project_id;
 end if;
 return new;
end $$;
drop trigger if exists guard_entry on time_entries;
create trigger guard_entry before insert or update or delete on time_entries for each row execute function skytime_guard_entry();

create or replace function skytime_guard_period() returns trigger language plpgsql as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || new.user_id,0));
 if new.status in ('submitted','approved') and (TG_OP='INSERT' or new.status is distinct from old.status) then
  if exists(select 1 from running_timers where organization_id=new.organization_id and user_id=new.user_id
   and started_at >= new.period_start and started_at < new.period_end + interval '1 day') then
   raise exception 'Stop the running timer before submitting or approving' using errcode='23514';
  end if;
  select coalesce(sum(duration_ms),0) into new.total_ms from time_entries where organization_id=new.organization_id
   and user_id=new.user_id and started_at >= new.period_start and started_at < new.period_end + interval '1 day';
 end if;
 return new;
end $$;
drop trigger if exists guard_period on timesheet_periods;
create trigger guard_period before insert or update on timesheet_periods for each row execute function skytime_guard_period();

-- Keep historical approval totals correct after imports, bulk edits and timers.
create or replace function skytime_refresh_entry_periods() returns trigger language plpgsql as $$
begin
 if TG_OP in ('UPDATE','DELETE') then
  update timesheet_periods tp set total_ms=coalesce((select sum(e.duration_ms) from time_entries e
   where e.organization_id=tp.organization_id and e.user_id=tp.user_id and e.started_at>=tp.period_start and e.started_at<tp.period_end+interval '1 day'),0)
   where tp.organization_id=old.organization_id and tp.user_id=old.user_id and old.started_at>=tp.period_start and old.started_at<tp.period_end+interval '1 day';
 end if;
 if TG_OP in ('INSERT','UPDATE') then
  update timesheet_periods tp set total_ms=coalesce((select sum(e.duration_ms) from time_entries e
   where e.organization_id=tp.organization_id and e.user_id=tp.user_id and e.started_at>=tp.period_start and e.started_at<tp.period_end+interval '1 day'),0)
   where tp.organization_id=new.organization_id and tp.user_id=new.user_id and new.started_at>=tp.period_start and new.started_at<tp.period_end+interval '1 day';
 end if;
 return null;
end $$;
drop trigger if exists refresh_entry_periods on time_entries;
create trigger refresh_entry_periods after insert or update or delete on time_entries for each row execute function skytime_refresh_entry_periods();

alter table organization_memberships add column if not exists weekly_capacity numeric(6,2) not null default 40 check(weekly_capacity between 0 and 168);
create table if not exists allocations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 user_id text not null, project_id uuid not null references projects(id), date date not null, hours numeric(6,2) not null check(hours > 0 and hours <= 24),
 note text not null default '', created_at timestamptz not null default now()
);
create table if not exists time_off (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 user_id text not null, start_date date not null, end_date date not null, note text not null default '',
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(), check(end_date>=start_date)
);
drop trigger if exists check_project_tenant on allocations;
create trigger check_project_tenant before insert or update on allocations for each row execute function skytime_check_project_tenant();

-- Preserve issuer identity as well as client and line details on invoices.
alter table invoices add column if not exists branding_snapshot jsonb;

-- EOD Report Dashboard schema
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query)

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  total_profit numeric,
  total_converted_jobs integer,
  total_job_amount numeric,
  total_vendor_payment numeric,
  total_refunded_to_client numeric,
  total_completed_jobs integer,
  total_cancelled_jobs integer,
  platform_breakdown jsonb,
  call_que_breakdown jsonb,
  job_status_breakdown jsonb
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  row_number integer,
  agent text,
  dispatcher text,
  job_number text,
  job_amount numeric,
  vendors_fee numeric,
  refunded_to_client numeric,
  profit numeric,
  customer_charged_via text,
  vendor_paid_via text,
  vendor_name text,
  last4_vpc text,
  job_status text,
  dispatched_time timestamptz,
  vendor_eta_minutes integer,
  reviewed_by text,
  state text,
  customer_phone text,
  call_que text,
  notes text
);

create index if not exists jobs_report_id_idx on jobs(report_id);
create index if not exists reports_report_date_idx on reports(report_date desc);

alter table reports enable row level security;
alter table jobs enable row level security;

-- Only signed-in team members can read or write. No public/anon access.
create policy "authenticated can read reports" on reports
  for select to authenticated using (true);

create policy "authenticated can insert reports" on reports
  for insert to authenticated with check (true);

create policy "authenticated can read jobs" on jobs
  for select to authenticated using (true);

create policy "authenticated can insert jobs" on jobs
  for insert to authenticated with check (true);

-- Follow-up fixes after inspecting real data more closely:
-- dispatched_time / vendor's ETA are free-text scheduling notes, not clean timestamps.
-- Also adding the check-off columns (BREX/SLASH/WC/final check) that were missed initially.
alter table jobs alter column dispatched_time type text using dispatched_time::text;
alter table jobs drop column if exists vendor_eta_minutes;
alter table jobs add column if not exists vendor_eta text;
alter table jobs add column if not exists brex_check text;
alter table jobs add column if not exists slash_check text;
alter table jobs add column if not exists wc_entered_by_jon text;
alter table jobs add column if not exists final_checked_by_zumi text;

-- Allow re-uploading a report for the same date to replace/update it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_report_date_key'
  ) then
    alter table reports add constraint reports_report_date_key unique (report_date);
  end if;
end $$;

-- Live team entry: source column, same-day edit/delete RLS, realtime.
alter table jobs add column if not exists source text not null default 'manual';
update jobs set source = 'upload' where source = 'manual';
-- (the update above assumes all rows so far came from Excel upload; safe one-time backfill)

alter table jobs add column if not exists created_by uuid references auth.users(id);

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'jobs' and policyname = 'authenticated can update same-day jobs'
  ) then
    create policy "authenticated can update same-day jobs" on jobs
      for update to authenticated
      using (report_id in (select id from reports where report_date = current_date))
      with check (report_id in (select id from reports where report_date = current_date));
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'jobs' and policyname = 'authenticated can delete same-day jobs'
  ) then
    create policy "authenticated can delete same-day jobs" on jobs
      for delete to authenticated
      using (report_id in (select id from reports where report_date = current_date));
  end if;

  -- Missing since day one: upsert-by-report_date (used by both upload and
  -- getOrCreateTodaysReport) needs UPDATE, not just INSERT, on reports.
  if not exists (
    select 1 from pg_policies where tablename = 'reports' and policyname = 'authenticated can update reports'
  ) then
    create policy "authenticated can update reports" on reports
      for update to authenticated
      using (true)
      with check (true);
  end if;

  -- The same-day restriction above only protects manual entries. Re-uploading
  -- an Excel file for any date (including past ones) must still be able to
  -- delete-and-replace its own 'upload'-sourced rows regardless of date.
  if not exists (
    select 1 from pg_policies where tablename = 'jobs' and policyname = 'authenticated can delete upload-sourced jobs'
  ) then
    create policy "authenticated can delete upload-sourced jobs" on jobs
      for delete to authenticated
      using (source = 'upload');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'jobs'
  ) then
    alter publication supabase_realtime add table jobs;
  end if;

  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'reports'
  ) then
    alter publication supabase_realtime add table reports;
  end if;
end $$;

-- Dispatched-job ETA countdown feature.
alter table jobs add column if not exists eta_minutes integer;
alter table jobs add column if not exists dispatched_at timestamptz;

-- Align same-day edit/delete cutoff with the team's Philippine Time
-- working day instead of the database's default UTC clock.
alter policy "authenticated can update same-day jobs" on jobs
  using (report_id in (
    select id from reports where report_date = ((now() at time zone 'Asia/Manila')::date)
  ))
  with check (report_id in (
    select id from reports where report_date = ((now() at time zone 'Asia/Manila')::date)
  ));

alter policy "authenticated can delete same-day jobs" on jobs
  using (report_id in (
    select id from reports where report_date = ((now() at time zone 'Asia/Manila')::date)
  ));

-- Field edits (and deletes) should no longer be limited to the day a
-- job was entered — allow any authenticated user to update/delete any
-- job regardless of date. (Cancel/Refund/Delete on the job detail page
-- already bypassed this via the admin client; this makes the regular
-- edit/delete paths consistent with that.)
alter policy "authenticated can update same-day jobs" on jobs
  using (true)
  with check (true);

alter policy "authenticated can delete same-day jobs" on jobs
  using (true);

-- Capture why a job was cancelled.
alter table jobs add column if not exists cancellation_reason text;

-- Roles: agents (field workers, new logins) vs managers (existing dispatcher
-- accounts). Backfill sets every account that exists before this migration
-- to manager; anyone created afterward defaults to agent.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'agent' check (role in ('agent', 'manager')),
  agent_name text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create or replace function is_manager() returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'manager');
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'profiles' and policyname = 'users read own profile or managers read all'
  ) then
    create policy "users read own profile or managers read all" on profiles
      for select to authenticated using (id = auth.uid() or is_manager());
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'profiles' and policyname = 'managers insert profiles'
  ) then
    create policy "managers insert profiles" on profiles
      for insert to authenticated with check (is_manager());
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'profiles' and policyname = 'managers update profiles'
  ) then
    create policy "managers update profiles" on profiles
      for update to authenticated using (is_manager()) with check (is_manager());
  end if;
end $$;

-- Backfill: every account that already exists is a manager (dispatcher team).
insert into profiles (id, role)
select id, 'manager' from auth.users
on conflict (id) do nothing;

-- Only managers can delete jobs; adding/editing stays open to agents too.
alter policy "authenticated can delete same-day jobs" on jobs
  using (is_manager());

alter policy "authenticated can delete upload-sourced jobs" on jobs
  using (is_manager());

-- Clock in/out hour tracking.
create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  created_at timestamptz not null default now()
);

alter table time_entries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'time_entries' and policyname = 'users read own entries or managers read all'
  ) then
    create policy "users read own entries or managers read all" on time_entries
      for select to authenticated using (user_id = auth.uid() or is_manager());
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'time_entries' and policyname = 'users insert own entries'
  ) then
    create policy "users insert own entries" on time_entries
      for insert to authenticated with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'time_entries' and policyname = 'users update own entries'
  ) then
    create policy "users update own entries" on time_entries
      for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'time_entries'
  ) then
    alter publication supabase_realtime add table time_entries;
  end if;
end $$;

-- Store email on profiles for display (avoids needing an admin API call
-- just to list agents on the manager-only /agents page).
alter table profiles add column if not exists email text;

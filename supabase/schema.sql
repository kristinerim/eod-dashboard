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

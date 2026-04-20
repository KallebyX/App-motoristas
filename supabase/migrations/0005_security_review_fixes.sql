-- =====================================================================
-- 0005_security_review_fixes.sql
-- =====================================================================
-- Addresses critical findings from the code review:
--  1. RLS recursion on company_members via current_company_id()
--  2. View v_driver_latest_session bypasses RLS (missing security_invoker)
--  3. Storage buckets without RLS isolation
--  4. Sessions can reference a driver from another company (composite FK)
--  5. drivers not linked to auth.users (session auth is broken today)
--  6. persist_session_score without search_path + service_role grant
-- =====================================================================

-- 1. Break the RLS recursion: make current_company_id() SECURITY DEFINER
--    so it reads company_members outside the caller's RLS context.
create or replace function current_company_id() returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select company_id from company_members where user_id = auth.uid() limit 1;
$$;

-- 2. Recreate the view with security_invoker so RLS of base tables applies.
drop view if exists v_driver_latest_session;
create view v_driver_latest_session
with (security_invoker = true)
as
select distinct on (d.id)
  d.id as driver_id,
  d.company_id,
  d.full_name,
  d.status as driver_status,
  s.id as session_id,
  s.started_at,
  s.status as session_status,
  ss.traffic_light,
  ss.final_score,
  ss.blocked
from drivers d
left join sessions s on s.driver_id = d.id
left join session_scores ss on ss.session_id = s.id
order by d.id, s.started_at desc nulls last;

-- 3. Composite FK: sessions.driver_id MUST match a driver in the same company.
--    Add a unique on (id, company_id) that the FK can reference.
alter table drivers
  drop constraint if exists drivers_id_company_id_key;
alter table drivers
  add constraint drivers_id_company_id_key unique (id, company_id);

alter table sessions
  drop constraint if exists sessions_driver_company_fk;
alter table sessions
  add constraint sessions_driver_company_fk
  foreign key (driver_id, company_id)
  references drivers (id, company_id)
  on delete restrict;

-- 4. Link drivers to auth.users. Nullable for backwards compatibility with
--    rows created before this migration (including the pilot seed). New
--    drivers must get user_id populated during onboarding.
alter table drivers
  add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists drivers_user_id_uniq on drivers (user_id)
  where user_id is not null;

-- 5. Harden persist_session_score: fix search_path + grant execute to service_role.
--    We RE-create the function because `set search_path` can't be added via alter.
create or replace function persist_session_score(
  p_session_id uuid,
  p_driver_id uuid,
  p_company_id uuid,
  p_payload jsonb,
  p_output jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_block jsonb;
  v_metrics jsonb;
  v_block_name text;
begin
  insert into sessions (
    id, driver_id, company_id, started_at, completed_at,
    status, geo_lat, geo_lng, device_fingerprint, app_version,
    liveness_video_ref, liveness_match_score
  )
  values (
    p_session_id, p_driver_id, p_company_id,
    (p_payload->>'startedAt')::timestamptz,
    (p_payload->>'completedAt')::timestamptz,
    'completed',
    nullif(p_payload->'geo'->>'lat','')::numeric,
    nullif(p_payload->'geo'->>'lng','')::numeric,
    p_payload->>'deviceFingerprint',
    p_payload->>'appVersion',
    p_payload->>'livenessVideoRef',
    nullif(p_payload->>'livenessMatchScore','')::numeric
  )
  on conflict (id) do update set
    completed_at = excluded.completed_at,
    status = excluded.status,
    liveness_video_ref = coalesce(excluded.liveness_video_ref, sessions.liveness_video_ref),
    liveness_match_score = coalesce(excluded.liveness_match_score, sessions.liveness_match_score);

  for v_block in select * from jsonb_array_elements(p_payload->'blocks')
  loop
    v_block_name := v_block->>'block';
    v_metrics := p_output->'blockMetrics'->v_block_name;
    insert into cognitive_results (session_id, block, raw_data, median_rt_ms, lapse_rate, cv_rt, z_score)
    values (
      p_session_id,
      v_block_name::test_block,
      v_block,
      (v_metrics->>'medianRtMs')::numeric,
      (v_metrics->>'lapseRate')::numeric,
      (v_metrics->>'cvRt')::numeric,
      (v_metrics->>'zScore')::numeric
    )
    on conflict (session_id, block) do update set
      raw_data = excluded.raw_data,
      median_rt_ms = excluded.median_rt_ms,
      lapse_rate = excluded.lapse_rate,
      cv_rt = excluded.cv_rt,
      z_score = excluded.z_score;
  end loop;

  insert into subjective_results (session_id, kss, samn_perelli, hours_slept)
  values (
    p_session_id,
    (p_payload->'subjective'->>'kss')::smallint,
    (p_payload->'subjective'->>'samnPerelli')::smallint,
    nullif(p_payload->'subjective'->>'hoursSlept','')::numeric
  )
  on conflict (session_id) do update set
    kss = excluded.kss,
    samn_perelli = excluded.samn_perelli,
    hours_slept = excluded.hours_slept;

  insert into session_scores (
    session_id, objective_score, subjective_score, final_score,
    traffic_light, blocked, algorithm_version
  )
  values (
    p_session_id,
    (p_output->>'objectiveScore')::numeric,
    (p_output->>'subjectiveScore')::numeric,
    (p_output->>'finalScore')::numeric,
    (p_output->>'trafficLight')::traffic_light,
    (p_output->>'blocked')::boolean,
    coalesce(p_output->>'algorithmVersion','v1')
  )
  on conflict (session_id) do update set
    objective_score = excluded.objective_score,
    subjective_score = excluded.subjective_score,
    final_score = excluded.final_score,
    traffic_light = excluded.traffic_light,
    blocked = excluded.blocked,
    algorithm_version = excluded.algorithm_version;
end;
$$;

revoke all on function persist_session_score(uuid, uuid, uuid, jsonb, jsonb) from public;
grant execute on function persist_session_score(uuid, uuid, uuid, jsonb, jsonb) to service_role;

-- 6. Storage RLS: isolate by the first path segment matching auth.uid().
--    Drivers upload under `<auth.uid()>/...` and can only read their own files.
--    Managers read anything in their company via a join on drivers.user_id.
alter table storage.objects enable row level security;

drop policy if exists "drivers upload cnh own folder" on storage.objects;
create policy "drivers upload cnh own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cnh-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "drivers read cnh own folder" on storage.objects;
create policy "drivers read cnh own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cnh-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "drivers upload liveness own folder" on storage.objects;
create policy "drivers upload liveness own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'liveness-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "drivers read liveness own folder" on storage.objects;
create policy "drivers read liveness own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'liveness-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Managers (company_members) can read any file in their company. They look
-- up drivers by user_id and match against the folder prefix.
drop policy if exists "managers read company cnh" on storage.objects;
create policy "managers read company cnh" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('cnh-photos', 'liveness-videos')
    and exists (
      select 1 from drivers d
      where d.user_id::text = (storage.foldername(name))[1]
        and d.company_id = current_company_id()
    )
  );

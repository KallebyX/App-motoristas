-- RPC used by the compute-session-score edge function.
-- Wraps all writes (session upsert, block results, subjective, score) into
-- a single implicit transaction so a partial write never leaves the DB in
-- an inconsistent state.
create or replace function persist_session_score(
  p_session_id uuid,
  p_driver_id uuid,
  p_company_id uuid,
  p_payload jsonb,
  p_output jsonb
) returns void
language plpgsql security definer as $$
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

  -- Cognitive block results.
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

  -- Subjective.
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

  -- Final score.
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

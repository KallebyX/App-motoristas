-- =====================================================================
-- 0006_shadow_pilot.sql — Infraestrutura para piloto-sombra 30 dias
-- =====================================================================
-- Objetivo: coletar distribuições reais de RT/lapse/score de uma
-- transportadora-parceira com política warn-warn antes de ligar o
-- bloqueio real em produção.
-- Ver: docs/scoring-methodology.md § 10 (Piloto-sombra / calibração BR)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Persistir hard_red_reasons no banco (até agora só vivia no output
--    do engine de scoring; adicionar aqui permite análise SQL direta).
-- ---------------------------------------------------------------------
alter table session_scores
  add column if not exists hard_red_reasons text[] not null default '{}';

-- Atualizar persist_session_score para gravar hard_red_reasons.
create or replace function persist_session_score(
  p_session_id   uuid,
  p_driver_id    uuid,
  p_company_id   uuid,
  p_payload      jsonb,
  p_output       jsonb
) returns void
language plpgsql security definer as $$
declare
  v_block        jsonb;
  v_metrics      jsonb;
  v_block_name   text;
  v_hard_reasons text[];
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
    completed_at         = excluded.completed_at,
    status               = excluded.status,
    liveness_video_ref   = coalesce(excluded.liveness_video_ref,   sessions.liveness_video_ref),
    liveness_match_score = coalesce(excluded.liveness_match_score, sessions.liveness_match_score);

  -- Cognitive block results.
  for v_block in select * from jsonb_array_elements(p_payload->'blocks')
  loop
    v_block_name := v_block->>'block';
    v_metrics    := p_output->'blockMetrics'->v_block_name;
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
      raw_data     = excluded.raw_data,
      median_rt_ms = excluded.median_rt_ms,
      lapse_rate   = excluded.lapse_rate,
      cv_rt        = excluded.cv_rt,
      z_score      = excluded.z_score;
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
    kss          = excluded.kss,
    samn_perelli = excluded.samn_perelli,
    hours_slept  = excluded.hours_slept;

  -- Parse hard_red_reasons array from output JSON.
  select array_agg(r.value #>> '{}')
    into v_hard_reasons
    from jsonb_array_elements(
      coalesce(p_output->'hardRedReasons', '[]'::jsonb)
    ) r;

  -- Final score.
  insert into session_scores (
    session_id, objective_score, subjective_score, final_score,
    traffic_light, blocked, algorithm_version, hard_red_reasons
  )
  values (
    p_session_id,
    (p_output->>'objectiveScore')::numeric,
    (p_output->>'subjectiveScore')::numeric,
    (p_output->>'finalScore')::numeric,
    (p_output->>'trafficLight')::traffic_light,
    (p_output->>'blocked')::boolean,
    coalesce(p_output->>'algorithmVersion','v1'),
    coalesce(v_hard_reasons, '{}')
  )
  on conflict (session_id) do update set
    objective_score  = excluded.objective_score,
    subjective_score = excluded.subjective_score,
    final_score      = excluded.final_score,
    traffic_light    = excluded.traffic_light,
    blocked          = excluded.blocked,
    algorithm_version = excluded.algorithm_version,
    hard_red_reasons  = excluded.hard_red_reasons;
end;
$$;

revoke all on function persist_session_score(uuid, uuid, uuid, jsonb, jsonb) from public;

-- ---------------------------------------------------------------------
-- 2. View de distribuições para o painel do piloto-sombra.
--    Retorna uma linha por sessão completa com métricas PVT-B e o
--    período do dia (madrugada / manhã / tarde / noite).
-- ---------------------------------------------------------------------
create or replace view v_pilot_distributions as
select
  s.company_id,
  s.id                                              as session_id,
  s.started_at,
  -- Período do dia (horário local UTC-3 simplificado: -3 h offset)
  case
    when extract(hour from s.started_at at time zone 'America/Sao_Paulo') between  5 and 11 then 'manha'
    when extract(hour from s.started_at at time zone 'America/Sao_Paulo') between 12 and 17 then 'tarde'
    when extract(hour from s.started_at at time zone 'America/Sao_Paulo') between 18 and 22 then 'noite'
    else 'madrugada'
  end                                               as periodo_dia,
  cr.median_rt_ms,
  cr.lapse_rate,
  cr.cv_rt,
  cr.z_score,
  sr.kss,
  sr.samn_perelli,
  sr.hours_slept,
  ss.objective_score,
  ss.subjective_score,
  ss.final_score,
  ss.traffic_light,
  ss.hard_red_reasons,
  ss.algorithm_version
from sessions          s
join cognitive_results cr on cr.session_id = s.id and cr.block = 'pvt_b'
join session_scores    ss on ss.session_id = s.id
left join subjective_results sr on sr.session_id = s.id
where s.status = 'completed';

-- RLS: gestores só veem a própria empresa.
create policy pilot_dist_company_r on session_scores
  for select using (
    session_id in (select id from sessions where company_id = current_company_id())
  );

-- ---------------------------------------------------------------------
-- 3. Função de exportação CSV para download diário.
--    Retorna texto CSV com todas as sessões completas de uma empresa.
--    Chamada pela edge function export-pilot-csv com service_role.
-- ---------------------------------------------------------------------
create or replace function export_pilot_csv(p_company_id uuid)
returns text
language plpgsql security definer as $$
declare
  v_csv      text;
  v_row      record;
  v_header   text;
  v_lines    text[] := '{}';
begin
  v_header := 'session_id,started_at,periodo_dia,median_rt_ms,lapse_rate,cv_rt,'
           || 'z_score,kss,samn_perelli,hours_slept,objective_score,subjective_score,'
           || 'final_score,traffic_light,hard_red_reasons,algorithm_version';

  v_lines := array_append(v_lines, v_header);

  for v_row in
    select * from v_pilot_distributions
    where company_id = p_company_id
    order by started_at
  loop
    v_lines := array_append(v_lines,
      v_row.session_id                              || ','  ||
      to_char(v_row.started_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') || ','  ||
      v_row.periodo_dia                             || ','  ||
      coalesce(v_row.median_rt_ms::text, '')        || ','  ||
      coalesce(v_row.lapse_rate::text,  '')         || ','  ||
      coalesce(v_row.cv_rt::text,       '')         || ','  ||
      coalesce(v_row.z_score::text,     '')         || ','  ||
      coalesce(v_row.kss::text,         '')         || ','  ||
      coalesce(v_row.samn_perelli::text,'')         || ','  ||
      coalesce(v_row.hours_slept::text, '')         || ','  ||
      coalesce(v_row.objective_score::text,  '')    || ','  ||
      coalesce(v_row.subjective_score::text, '')    || ','  ||
      coalesce(v_row.final_score::text,      '')    || ','  ||
      coalesce(v_row.traffic_light::text,    '')    || ','  ||
      '"' || array_to_string(v_row.hard_red_reasons, '|') || '"' || ','  ||
      coalesce(v_row.algorithm_version, '')
    );
  end loop;

  v_csv := array_to_string(v_lines, E'\n');
  return v_csv;
end;
$$;

revoke all on function export_pilot_csv(uuid) from public;

-- ---------------------------------------------------------------------
-- 4. View de sumário estatístico para o dashboard (percentis por
--    período do dia e por semáforo).  Usada pela página /pilot.
-- ---------------------------------------------------------------------
create or replace view v_pilot_summary as
select
  company_id,
  periodo_dia,
  traffic_light,
  count(*)                                                  as n_sessions,
  round(avg(median_rt_ms)::numeric, 1)                      as avg_median_rt_ms,
  round(percentile_cont(0.25) within group (order by median_rt_ms)::numeric, 1) as p25_rt_ms,
  round(percentile_cont(0.50) within group (order by median_rt_ms)::numeric, 1) as p50_rt_ms,
  round(percentile_cont(0.75) within group (order by median_rt_ms)::numeric, 1) as p75_rt_ms,
  round(avg(lapse_rate)::numeric, 4)                        as avg_lapse_rate,
  round(percentile_cont(0.50) within group (order by lapse_rate)::numeric, 4)   as p50_lapse_rate,
  round(avg(final_score)::numeric, 2)                       as avg_final_score,
  round(percentile_cont(0.50) within group (order by final_score)::numeric, 2)  as p50_final_score
from v_pilot_distributions
group by company_id, periodo_dia, traffic_light;

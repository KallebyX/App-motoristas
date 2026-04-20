-- Fake session data for the demo company so the dashboard + /analytics
-- render something believable. Idempotent: wrapped in a guard that only
-- inserts when the demo company has zero sessions. Safe to re-run.
--
-- Remove this file when the first real pilot data lands.

do $$
declare
  v_company_id uuid := '00000000-0000-0000-0000-000000000001';
  v_driver record;
  v_day int;
  v_session_id uuid;
  v_score numeric;
  v_light traffic_light;
  v_rt_mean numeric;
  v_lapse numeric;
  v_kss int;
  v_sp int;
  v_start timestamptz;
begin
  -- Guard: skip if the demo company already has sessions (avoids duplication).
  if exists (select 1 from sessions where company_id = v_company_id) then
    raise notice 'seed: company % already has sessions — skipping', v_company_id;
    return;
  end if;

  -- Ensure we have 10 drivers on the demo company (already 2 from seed.sql).
  for i in 3..10 loop
    insert into drivers (company_id, full_name, cpf, cnh_number, phone, status, unico_match_score, unico_verified_at)
    values (
      v_company_id,
      'Motorista Demo ' || i,
      lpad((10000000000 + i)::text, 11, '0'),
      'CNH-' || lpad(i::text, 6, '0'),
      '+551199999' || lpad(i::text, 4, '0'),
      'active',
      92 + (i % 8)::numeric,
      now() - (i || ' days')::interval
    )
    on conflict (company_id, cpf) do nothing;
  end loop;

  -- 50 sessions distributed across 10 drivers over the last 14 days.
  for v_driver in
    select id from drivers where company_id = v_company_id order by created_at limit 10
  loop
    for v_day in 0..13 loop
      -- ~80% chance of a session per driver per day
      if random() < 0.8 then
        v_session_id := gen_random_uuid();
        -- Random baseline: 260-340ms RT, 0-15% lapses, 2-8 KSS
        v_rt_mean := 260 + random() * 80;
        v_lapse := random() * 0.15;
        v_kss := 2 + floor(random() * 7)::int;
        v_sp := 1 + floor(random() * 6)::int;
        v_start := now() - (v_day || ' days')::interval - (floor(random() * 12) || ' hours')::interval;

        -- Simple traffic light logic matching scorer cutoffs
        v_score := greatest(0, least(100,
          100 - (v_rt_mean - 280) * 0.5 - v_lapse * 150 - (v_kss - 3) * 4 - (v_sp - 2) * 3
        ));
        v_light := case
          when v_score >= 75 then 'green'::traffic_light
          when v_score >= 55 then 'yellow'::traffic_light
          else 'red'::traffic_light
        end;

        insert into sessions (id, driver_id, company_id, started_at, completed_at, status, device_fingerprint, app_version)
        values (v_session_id, v_driver.id, v_company_id, v_start, v_start + interval '90 seconds', 'completed', 'seed-device-' || v_driver.id::text, '0.1.0');

        insert into cognitive_results (session_id, block, raw_data, median_rt_ms, lapse_rate, cv_rt, z_score)
        values (v_session_id, 'pvt_b',
          jsonb_build_object('trials', jsonb_build_array()),
          v_rt_mean, v_lapse, 0.15 + random() * 0.1, (280 - v_rt_mean) / 45
        );

        insert into subjective_results (session_id, kss, samn_perelli, hours_slept)
        values (v_session_id, v_kss, v_sp, 5 + random() * 3);

        insert into session_scores (session_id, objective_score, subjective_score, final_score, traffic_light, blocked, algorithm_version)
        values (v_session_id,
          greatest(0, least(100, 100 - (v_rt_mean - 280) * 0.7 - v_lapse * 180)),
          greatest(0, least(100, 100 - (v_kss - 1) * 12 - (v_sp - 1) * 14)),
          v_score, v_light, v_light = 'red', 'v1'
        );
      end if;
    end loop;
  end loop;

  raise notice 'seed: inserted fake sessions for company %', v_company_id;
end $$;

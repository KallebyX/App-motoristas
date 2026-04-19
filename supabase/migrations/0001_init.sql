-- =====================================================================
-- 0001_init.sql — Schema inicial App Motoristas
-- =====================================================================
-- Domínio: prontidão cognitiva pré-jornada B2B.
-- Multi-tenant por company_id via RLS. Biometria é sensível (LGPD art. 5º II),
-- por isso nenhuma foto bruta é armazenada aqui — só referências a assets
-- criptografados em storage e o score retornado pelo provider antifraude.
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type traffic_light as enum ('green', 'yellow', 'red');
create type session_status as enum (
  'started',       -- iniciou liveness
  'liveness_ok',   -- liveness aprovado
  'in_test',       -- bateria cognitiva em andamento
  'completed',     -- score calculado
  'aborted',       -- motorista cancelou
  'fraud_suspect'  -- liveness/reverificação falhou
);
create type driver_status as enum ('pending_match', 'active', 'blocked', 'archived');
create type test_block as enum ('pvt_b', 'divided_attention', 'vigilance');

-- ---------------------------------------------------------------------
-- Tenants (empresas)
-- ---------------------------------------------------------------------
create table companies (
  id              uuid primary key default uuid_generate_v4(),
  cnpj            varchar(14) not null unique,
  legal_name      text not null,
  trade_name      text,
  created_at      timestamptz not null default now(),
  -- Política de bloqueio configurável (JSON) — ex.: {"yellow":"warn","red":"block"}
  block_policy    jsonb not null default '{"yellow":"warn","red":"block"}'::jsonb,
  -- Geofencing opcional: { "lat": -23.5, "lng": -46.6, "radius_m": 500 }
  geofence        jsonb,
  active          boolean not null default true
);

-- ---------------------------------------------------------------------
-- Gestores (usuários do painel) — mapeados para auth.users do Supabase
-- ---------------------------------------------------------------------
create table company_members (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,
  role        text not null check (role in ('owner', 'manager', 'viewer')),
  created_at  timestamptz not null default now()
);
create index on company_members (company_id);

-- ---------------------------------------------------------------------
-- Motoristas
-- ---------------------------------------------------------------------
create table drivers (
  id                    uuid primary key default uuid_generate_v4(),
  company_id            uuid not null references companies(id) on delete cascade,
  full_name             text not null,
  cpf                   varchar(11) not null,
  cnh_number            varchar(20) not null,
  cnh_category          varchar(5),
  phone                 varchar(20) not null,
  -- Asset criptografado no Storage (bucket "cnh-photos"); NUNCA a imagem em si.
  cnh_photo_ref         text,
  -- Score de similaridade retornado pelo provider antifraude no onboarding.
  unico_match_score     numeric(5,2),
  unico_verified_at     timestamptz,
  -- Device binding: hash do hardware + push token (rotacionado).
  device_fingerprint    text,
  device_bound_at       timestamptz,
  status                driver_status not null default 'pending_match',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, cpf)
);
create index on drivers (company_id, status);

-- ---------------------------------------------------------------------
-- Sessões (uma tentativa de teste pré-jornada)
-- ---------------------------------------------------------------------
create table sessions (
  id                     uuid primary key default uuid_generate_v4(),
  driver_id              uuid not null references drivers(id) on delete restrict,
  company_id             uuid not null references companies(id) on delete restrict,
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  status                 session_status not null default 'started',
  -- Geolocalização no momento do teste (PostGIS seria ideal, mas mantendo simples).
  geo_lat                numeric(9,6),
  geo_lng                numeric(9,6),
  inside_geofence        boolean,
  device_fingerprint     text not null,
  app_version            text,
  -- Asset do vídeo de liveness (bucket privado, TTL 90 dias).
  liveness_video_ref     text,
  liveness_match_score   numeric(5,2),
  -- Sessão-pai quando é um reteste (máx 1 retry após amarelo).
  retry_of_session_id    uuid references sessions(id) on delete set null,
  -- Hash SHA-256 da sessão fechada — usado para detectar tampering no audit_log.
  integrity_hash         text
);
create index on sessions (driver_id, started_at desc);
create index on sessions (company_id, started_at desc);
create index on sessions (company_id, status);

-- ---------------------------------------------------------------------
-- Resultados dos blocos cognitivos
-- ---------------------------------------------------------------------
create table cognitive_results (
  id           uuid primary key default uuid_generate_v4(),
  session_id   uuid not null references sessions(id) on delete cascade,
  block        test_block not null,
  -- Série temporal crua: [{stimulus_at, response_at, rt_ms, is_lapse, is_false_start}, ...]
  raw_data     jsonb not null,
  median_rt_ms numeric(7,2),
  lapse_rate   numeric(5,4), -- fração de respostas >500 ms
  cv_rt        numeric(5,4), -- coeficiente de variação (σ/μ)
  z_score      numeric(6,3),
  unique (session_id, block)
);
create index on cognitive_results (session_id);

-- ---------------------------------------------------------------------
-- Questionário subjetivo (KSS + Samn-Perelli)
-- ---------------------------------------------------------------------
create table subjective_results (
  session_id      uuid primary key references sessions(id) on delete cascade,
  -- Karolinska Sleepiness Scale (1-9, onde 9 = extremamente sonolento)
  kss             smallint not null check (kss between 1 and 9),
  -- Samn-Perelli Fatigue Scale (1-7, onde 7 = completely exhausted)
  samn_perelli    smallint not null check (samn_perelli between 1 and 7),
  -- Horas de sono auto-reportadas na última noite.
  hours_slept     numeric(3,1),
  answered_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Score agregado da sessão
-- ---------------------------------------------------------------------
create table session_scores (
  session_id       uuid primary key references sessions(id) on delete cascade,
  objective_score  numeric(5,2) not null, -- 0-100 derivado do Z-score PVT
  subjective_score numeric(5,2) not null, -- 0-100 derivado do KSS/Samn-Perelli
  final_score      numeric(5,2) not null, -- 60/40 weighted
  traffic_light    traffic_light not null,
  blocked          boolean not null,
  computed_at      timestamptz not null default now(),
  -- Versão do algoritmo para reprocessamento futuro.
  algorithm_version text not null default 'v1'
);

-- ---------------------------------------------------------------------
-- Audit log append-only (LGPD / SST)
-- ---------------------------------------------------------------------
create table audit_log (
  id           bigserial primary key,
  occurred_at  timestamptz not null default now(),
  actor        text not null,   -- 'driver:<uuid>' | 'manager:<uuid>' | 'system'
  company_id   uuid,
  entity_type  text not null,   -- 'session' | 'driver' | 'company' | 'score'
  entity_id    uuid not null,
  action       text not null,   -- 'created' | 'updated' | 'blocked' | 'exported' | 'deleted'
  payload      jsonb not null
);
create index on audit_log (company_id, occurred_at desc);
create index on audit_log (entity_type, entity_id);

-- Bloquear updates/deletes no audit_log (apenas INSERTs via trigger ou role service).
revoke update, delete on audit_log from public;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger drivers_touch before update on drivers
  for each row execute procedure touch_updated_at();

create or replace function log_session_mutation() returns trigger
language plpgsql security definer as $$
begin
  insert into audit_log (actor, company_id, entity_type, entity_id, action, payload)
  values (
    coalesce(current_setting('app.actor', true), 'system'),
    coalesce(new.company_id, old.company_id),
    'session',
    coalesce(new.id, old.id),
    tg_op,
    jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
  );
  return coalesce(new, old);
end;
$$;

create trigger sessions_audit
  after insert or update or delete on sessions
  for each row execute procedure log_session_mutation();

-- ---------------------------------------------------------------------
-- Row Level Security — isolamento multi-tenant
-- ---------------------------------------------------------------------
alter table companies         enable row level security;
alter table company_members   enable row level security;
alter table drivers           enable row level security;
alter table sessions          enable row level security;
alter table cognitive_results enable row level security;
alter table subjective_results enable row level security;
alter table session_scores    enable row level security;
alter table audit_log         enable row level security;

-- Helper: empresa do usuário autenticado.
create or replace function current_company_id() returns uuid
language sql stable as $$
  select company_id from company_members where user_id = auth.uid() limit 1;
$$;

-- Gestores só veem a própria empresa.
create policy company_self_select on companies
  for select using (id = current_company_id());

create policy members_self_select on company_members
  for select using (company_id = current_company_id());

create policy drivers_company_rw on drivers
  for all using (company_id = current_company_id())
  with check (company_id = current_company_id());

create policy sessions_company_r on sessions
  for select using (company_id = current_company_id());

create policy cognitive_results_company_r on cognitive_results
  for select using (
    session_id in (select id from sessions where company_id = current_company_id())
  );

create policy subjective_results_company_r on subjective_results
  for select using (
    session_id in (select id from sessions where company_id = current_company_id())
  );

create policy session_scores_company_r on session_scores
  for select using (
    session_id in (select id from sessions where company_id = current_company_id())
  );

create policy audit_company_r on audit_log
  for select using (company_id = current_company_id());

-- Writes de sessão vêm do app motorista via edge function com service_role,
-- então não criamos políticas de INSERT/UPDATE para anon/authenticated aqui.

-- ---------------------------------------------------------------------
-- Views utilitárias para o dashboard
-- ---------------------------------------------------------------------
create or replace view v_driver_latest_session as
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

-- Seed/template for shadow-pilot companies.
-- Safe to run repeatedly: uses ON CONFLICT on cnpj.
-- The policy is warn/warn so NO driver is ever auto-blocked during the pilot.
-- Change the CNPJ/name when onboarding a real partner.

insert into companies (cnpj, legal_name, trade_name, block_policy)
values (
  '00000000000000',
  'Piloto Sombra (template)',
  'Shadow Pilot',
  '{"yellow":"warn","red":"warn"}'::jsonb
)
on conflict (cnpj) do update set
  block_policy = '{"yellow":"warn","red":"warn"}'::jsonb;

-- NOTE: removed the (company_id, date_trunc('day', started_at)) index —
-- date_trunc(timestamptz) is STABLE not IMMUTABLE so Postgres refuses it
-- in index expressions. The existing (company_id, started_at desc) index
-- from 0001_init already covers the daily report queries.

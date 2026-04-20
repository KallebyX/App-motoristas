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

-- Index to speed up pilot reports (sessions by day/company).
create index if not exists sessions_company_started_idx
  on sessions (company_id, date_trunc('day', started_at));

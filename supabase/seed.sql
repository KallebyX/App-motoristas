-- Seed de desenvolvimento — NÃO usar em produção.
insert into companies (id, cnpj, legal_name, trade_name)
values
  ('00000000-0000-0000-0000-000000000001', '12345678000100', 'Transportadora Demo LTDA', 'Demo Transp');

insert into drivers (id, company_id, full_name, cpf, cnh_number, phone, status, unico_match_score, unico_verified_at)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'João da Silva', '11122233344', 'CNH-123456', '+5511999990001', 'active', 96.4, now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'Maria Oliveira', '55566677788', 'CNH-654321', '+5511999990002', 'active', 93.2, now());

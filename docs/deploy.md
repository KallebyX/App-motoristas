# Guia de Deploy

## 1. Local (desenvolvimento)

### Pré-requisitos
- Node 20+, `pnpm`, Docker, `supabase` CLI (`npm i -g supabase`).

### Passos
```bash
pnpm install
./scripts/supabase-setup.sh           # sobe Supabase local + gera .env.local nos apps
pnpm dashboard:dev                     # http://localhost:3000
pnpm mobile:start                      # abre Expo DevTools
```

## 2. Produção

Temos dois workflows de deploy automáticos disparados por push em `main`:

### Supabase (schema + edge functions) — `.github/workflows/deploy-supabase.yml`
Secrets necessários no GitHub Actions:
- `SUPABASE_ACCESS_TOKEN` — personal token do dono da org (**Settings → Access Tokens**)
- `SUPABASE_PROJECT_REF` — ex.: `abcdxyz`
- `SUPABASE_DB_PASSWORD`
- `BIOMETRIC_WEBHOOK_SECRET` — setado via `supabase secrets set` (CLI), não via GH

### Dashboard (Vercel) — `.github/workflows/deploy-dashboard.yml`
Secrets necessários:
- `VERCEL_TOKEN` (**Vercel → Account → Tokens**)
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID_DASHBOARD`

Variáveis de ambiente do projeto Vercel (preencher no painel):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Mobile (EAS Build — não automatizado no CI ainda)
```bash
cd apps/mobile
eas login
eas build --platform android --profile preview     # APK para piloto
eas submit --platform android                      # Play Store
```

## 3. Ordem de operação no go-live

1. Destravar billing do GitHub Actions (issue #2).
2. Criar projeto Supabase e rodar `deploy-supabase.yml` (issue #3).
3. Configurar provider biométrico e setar `BIOMETRIC_WEBHOOK_SECRET` via `supabase secrets set` (issue #4).
4. Subir dashboard na Vercel (`deploy-dashboard.yml`).
5. Gerar APK de piloto via EAS e distribuir para a transportadora-parceira.
6. Rodar 30 dias de coleta-sombra com `block_policy = warn/warn` (issue #5).
7. Recalibrar cutoffs e só então ligar bloqueio.

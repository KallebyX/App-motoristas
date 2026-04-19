# App Motoristas — Prontidão Cognitiva Pré-Jornada

Plataforma B2B para transportadoras aferirem a prontidão cognitiva de motoristas **antes** do início da jornada. Uma bateria rápida (~75 s) baseada em PVT (Psychomotor Vigilance Test) mais questionário subjetivo de sono/fadiga gera um score semafórico e — conforme política da empresa — pode bloquear a liberação do veículo.

> Status: MVP em desenvolvimento. Ver [`/root/.claude/plans/ja-peguei-uns-dados-quizzical-barto.md`](./docs/plan.md) ou o plano de implementação para contexto completo.

## Arquitetura

```
apps/mobile        Expo (React Native) — app do motorista
apps/dashboard     Next.js — painel do gestor da frota
packages/shared-types    Contratos Zod compartilhados
packages/scoring         Motor de scoring (Z-score, cutoffs) — testável puro
packages/cognitive-tests Componentes RN de teste cognitivo (PVT, atenção, vigilância)
supabase/migrations      Schema + RLS
supabase/functions       Edge functions (scoring, webhook Unico)
docs/                    DPIA/LGPD, metodologia de scoring, controles antifraude
```

Stack: React Native + Expo · Next.js 15 · Supabase (Postgres + Auth + Storage + Edge Functions) · Biometria via SaaS BR (Unico/Idwall/Serpro) · TypeScript fim-a-fim.

## Quickstart

```bash
pnpm install
pnpm test              # roda suíte unitária dos pacotes puros
pnpm dashboard:dev     # next dev
pnpm mobile:start      # expo start
```

Aplicar schema local:

```bash
supabase start
supabase db reset      # aplica migrations em supabase/migrations
```

## Bateria cognitiva

| Bloco | Duração | Métrica |
|---|---|---|
| PVT-B (reação) | 30 s | Mediana RT, lapsos (>500 ms), false starts |
| Atenção dividida | 20 s | Acertos, omissões, falsos positivos |
| Vigilância/consistência | 25 s | Coeficiente de variação do RT |

Scoring: 60 % PVT normalizado (Z-score) + 40 % subjetivo (KSS + Samn-Perelli) → semáforo.

## Compliance

Biometria é dado pessoal sensível (LGPD art. 5º II). Ver:
- [`docs/lgpd-dpia.md`](./docs/lgpd-dpia.md) — Data Protection Impact Assessment
- [`docs/antifraud-controls.md`](./docs/antifraud-controls.md) — matriz de controles
- [`docs/scoring-methodology.md`](./docs/scoring-methodology.md) — detalhes do motor de scoring

## Licença

Proprietário — todos os direitos reservados.

# Metodologia de Scoring

Este documento detalha como o `packages/scoring` transforma uma sessão crua
(blocos cognitivos + questionário) em um semáforo de prontidão operacional.

## Visão geral

```
        PVT-B raw            KSS + Samn-Perelli
           │                          │
           ▼                          ▼
    métricas por bloco        normalização 0-100
  (median, lapse, CV RT)             │
           │                          │
        Z-score contra norma          │
           │                          │
           ▼                          ▼
       objective (0-100)       subjective (0-100)
               \        /
                \      /
                 combine 60/40
                     │
                     ▼
               finalScore (0-100)
                     │
              cutoffs + hard-red rules
                     │
                     ▼
              traffic_light (🟢🟡🔴)
```

## 1. Bloco PVT-B (Psychomotor Vigilance Test — Brief)

Referência: Basner M, Dinges DF. "Validity and Sensitivity of a Brief PVT
(PVT-B) to Total and Partial Sleep Deprivation." Acta Astronautica 69 (2011).

### Métricas

- **Mediana do RT (ms):** mediana de todas as respostas válidas.
- **Lapse rate:** fração de respostas > 500 ms (ou miss).
- **CV RT:** coeficiente de variação (σ/μ) dos RTs válidos.
- **False start rate:** taps antes do estímulo / total.

### Normalização (Z-score)

Cada métrica é convertida em Z contra a população de referência:

| Métrica | μ | σ | Fonte |
|---|---|---|---|
| Mediana RT | 280 ms | 45 ms | PVT-B literatura (ajustar com dados BR) |
| Lapse rate | 0.05 | 0.04 | idem |
| CV RT | 0.18 | 0.05 | idem |

O Z é **negado** antes de agregar (latência/lapsos maiores = pior), então
Z positivo ⇒ melhor performance.

### Escala para score 0-100

```
score_bloco = clamp(50 + z * 25, 0, 100)
```

Onde `z` é a média dos três Zs (RT, lapsos, CV) do bloco.

### Blocos múltiplos

Quando há mais de um bloco, `objective_score` é a média aritmética dos
`score_bloco`.

## 2. Questionário subjetivo

### KSS (Karolinska Sleepiness Scale, 1-9)

1 = extremamente alerta … 9 = extremamente sonolento.
Normaliza para `kss_norm = 1 - (kss - 1) / 8` (maior é melhor).

### Samn-Perelli Fatigue (1-7)

1 = totalmente alerta … 7 = completamente exausto.
Normaliza para `sp_norm = 1 - (sp - 1) / 6`.

### Agregação

```
subjective_score = ((kss_norm + sp_norm) / 2) * 100
```

## 3. Score combinado

```
final_score = 0.6 * objective_score + 0.4 * subjective_score
```

Peso maior no objetivo para reduzir vieses de auto-reporte; peso subjetivo
existe porque o próprio motorista é a melhor fonte de sinal quando o PVT
não capta sono parcial crônico.

## 4. Cutoffs do semáforo

| Semáforo | Critério |
|---|---|
| 🟢 Verde | final ≥ 75 e sem hard-red |
| 🟡 Amarelo | 55 ≤ final < 75 e sem hard-red |
| 🔴 Vermelho | final < 55 **ou** hard-red acionado |

## 5. Regras hard-red (independem do score)

| Regra | Limiar |
|---|---|
| Taxa de lapsos | > 20 % em qualquer bloco |
| KSS | ≥ 8 |
| Samn-Perelli | ≥ 6 |

Essas regras existem porque a literatura mostra que motoristas com >20 %
lapsos em PVT têm risco de acidente comparável a >0.08 % de alcoolemia
(Dawson & Reid, Nature 1997).

## 6. Política da empresa

O score **descreve** prontidão; a empresa **decide** consequência via
`companies.block_policy`:

```json
{ "yellow": "warn", "red": "block" }  // default
{ "yellow": "block", "red": "block" } // regime severo (cargas perigosas)
{ "yellow": "warn", "red": "warn" }   // piloto / coleta-sombra
```

## 7. Baseline pessoal (Fase 2 — roadmap)

Após ≥ 7 sessões por motorista, substituímos a norma populacional por um
**baseline pessoal** (mediana das últimas 20 sessões verdes). Isso reduz
falsos positivos em motoristas naturalmente lentos e aumenta sensibilidade
para motoristas naturalmente rápidos que estão degradando.

## 8. Versionamento

Toda saída carrega `algorithmVersion`. Mudança de cutoff, peso ou norma
incrementa a versão e é registrada na migration + CHANGELOG. O score é
reprocessado em lote com a nova versão (rodando `persist_session_score` via
worker) mantendo o score antigo no audit_log.

## 9. Calibração com dados reais

Plano da Fase 1 → Fase 2:

1. **30 dias de coleta-sombra** com política `warn-warn` (app nunca bloqueia).
2. Distribuição de `median_rt_ms` dos ~4 primeiros turnos do dia = baseline
   BR; recalcular μ/σ.
3. Validar contra incidentes reportados (micro-sinistros, quase-acidentes
   auto-declarados) via correlação bivariada.
4. Ajustar cutoffs para atingir taxa-alvo de falso vermelho ≤ 5 %.

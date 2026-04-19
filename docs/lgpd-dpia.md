# DPIA — Relatório de Impacto à Proteção de Dados

> Este é um **rascunho técnico** do DPIA exigido pela LGPD (art. 38). Antes de
> produção, precisa passar por revisão jurídica e pelo Encarregado (DPO) da
> controladora.

## 1. Identificação do tratamento

- **Sistema:** App Motoristas — avaliação de prontidão cognitiva pré-jornada.
- **Controladora:** a transportadora (empregadora) contratante.
- **Operadora:** fornecedora da plataforma (nós).
- **Sub-operadores:** Supabase (hospedagem BR/EUA), provedor de biometria
  (Unico / Idwall / Serpro), AWS (storage dos vídeos de liveness).

## 2. Finalidade e base legal

- **Finalidade:** aferir objetiva e subjetivamente a prontidão cognitiva do
  motorista antes do início da jornada, compondo o sistema de gestão de SST
  (art. 157 CLT) e reduzindo risco operacional.
- **Base legal:**
  - Art. 11, II, "a" LGPD — cumprimento de obrigação legal pela controladora
    (NR-17 / NR-1 / gestão de riscos ocupacionais).
  - Art. 7º, V e IX — execução de contrato de trabalho e legítimo interesse
    do empregador, com balanceamento.
  - **Consentimento específico e destacado** no primeiro acesso, com opção
    real de negar (em caso de negativa, a empresa decide alocar o motorista
    em função compatível sem teste — a negativa não pode ser retaliada).

## 3. Dados tratados (inventário)

| Dado | Categoria | Sensível? | Armazenamento |
|---|---|---|---|
| Nome, CPF, CNH, telefone | Pessoal comum | Não | `drivers` (Postgres) |
| Foto da CNH (referência) | Pessoal comum | Não | Storage privado + provider |
| Resultado match facial (score numérico) | Pessoal comum | **Sim** (biometria como processo) | `drivers.unico_match_score` |
| Vídeo de liveness | Biometria | **Sim** | Storage privado, TTL 90d |
| Tempo de reação, lapsos, CV | Saúde (prontidão) | **Sim** | `cognitive_results` |
| KSS / Samn-Perelli | Saúde (sono/fadiga) | **Sim** | `subjective_results` |
| Score final + semáforo | Saúde (inferência) | **Sim** | `session_scores` |
| Geolocalização no teste | Pessoal comum | Não | `sessions` |
| Device fingerprint (hash) | Pessoal comum | Não | `sessions` |

## 4. Ciclo de vida e retenção

- **Sessão bruta** (cognitive_results + subjective_results + session_scores):
  5 anos (prazo de guarda de registros de SST).
- **Vídeo de liveness:** 90 dias após a sessão — prazo suficiente para
  responder contestação do motorista e auditoria do sistema antifraude.
- **Foto da CNH:** somente a referência (ID) fica conosco; a imagem em si
  permanece com o provider de biometria conforme contrato dele.
- **Audit log:** 10 anos (art. 68 Código Civil — documentação hábil).
- **Após baixa do motorista:** dados pessoais são pseudonimizados em até
  30 dias; audit_log é preservado conforme prazo acima.

## 5. Fluxo de dados

```
Motorista (app)
  │  consentimento + foto CNH
  ▼
Provider biometria  ──score──▶  Backend (edge function unico-webhook)
                                      │
Motorista (app)  ──submissão──▶  Edge function compute-session-score
                                      │ score
                                      ▼
                                 Postgres (RLS por company_id)
                                      │
                                      ▼
                            Dashboard gestor (Next.js)
```

## 6. Direitos do titular (art. 18 LGPD)

Todos os direitos implementados:

| Direito | Como é atendido |
|---|---|
| Confirmação de tratamento | Tela "Meus dados" no app + canal de contato do DPO |
| Acesso | Endpoint `/drivers/{id}/export` no dashboard (JSON assinado) |
| Correção | O motorista pode corrigir nome/telefone/CNH no app; dados objetivos do teste não — é registro clínico-legal |
| Anonimização / bloqueio | Se o motorista sair da empresa, pseudonimização automática após 30d |
| Portabilidade | Mesmo endpoint de acesso, em JSON estruturado |
| Eliminação | Só após fim do prazo legal de retenção (5 anos). Até lá, pseudonimizamos. |
| Revogação de consentimento | Motorista pode revogar; consequência: não poderá mais realizar teste (e a empresa decide a alocação) |

## 7. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Vazamento de vídeo de liveness | Baixa | Alto | Bucket privado, presigned URL curta, criptografia em repouso, TTL 90d |
| Vazamento de score de saúde | Baixa | Alto | RLS obrigatório por company_id, service role só em edge functions |
| Falso positivo biométrico bloqueia motorista legítimo | Média | Médio | Revisão manual <90% de similaridade + contato humano |
| Discriminação por score reiterado | Média | Alto | Contrato proíbe uso exclusivo do score para decisão de desligamento; sempre revisão humana |
| Motorista coagido a aceitar consentimento | Alta | Alto | Consentimento separado, reversível; via paralela sem teste documentada |
| Transferência internacional (Supabase EUA) | Média | Médio | Cláusulas padrão LGPD no contrato; região `sa-east-1` sempre que possível |

## 8. Decisões automatizadas (art. 20)

O score **não** é decisão totalmente automatizada: a "blockagem" é uma
*recomendação operacional*. A liberação final é da empresa/supervisor, que
tem o dever de registrar o motivo em caso de override. O motorista tem
direito a solicitar revisão por pessoa natural — canal no app.

## 9. Pontos abertos para revisão jurídica

- [ ] Modelo de contrato com o provider de biometria (operadora × sub-operadora)
- [ ] Texto de consentimento com revisão da comunicação
- [ ] Política específica para motoristas de aplicativo (quando sair do B2B)
- [ ] Acordo coletivo / sindical, onde aplicável

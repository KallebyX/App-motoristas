# Matriz de Controles Antifraude

Objetivo: impedir que um motorista contorne o teste fazendo com que outra
pessoa o realize, ou automatize respostas. Inspirado no método do Detran para
validação de cursos EAD de reciclagem (captura facial + match contra base CNH
+ reverificação periódica + score mínimo de similaridade para aprovação
automática).

## Quadro-resumo

| Vetor de ataque | Controle | Camada | Severidade |
|---|---|---|---|
| Motorista passa o celular pra outra pessoa | Liveness ativo + match CNH no onboarding + reverificação silenciosa | Mobile + SaaS | Crítica |
| Foto estática na frente da câmera | Liveness ativo (piscar / mover cabeça) certificado iBeta L2 | SaaS | Crítica |
| Vídeo pré-gravado | Prompts aleatórios na sessão + checagem de frescor (fresh random nonce no prompt) | Mobile | Crítica |
| Deepfake em tempo real | Provider certificado (Unico/Idwall) com detecção de depth/IR em devices compatíveis; fallback para análise de textura e motion | SaaS | Alta |
| Emulador / bot tapping | Detecção de emulador (SafetyNet / Play Integrity / DeviceCheck) + entropia de toque (pressão, área, variação angular) | Mobile | Alta |
| Reprodução do app em desktop com Frida | Attestation de integridade do APK + cert pinning + obfuscação | Mobile | Média |
| 1 motorista testa de 2 celulares | Device binding: 1 motorista ↔ 1 device; troca exige nova aprovação | Backend | Alta |
| Teste feito fora do ponto de partida | Geofence por empresa (lat/lng + raio) validada no backend | Backend | Média |
| Resposta fora do aparelho (console wireshark/replay) | Assinatura HMAC da submissão + nonce de sessão | Backend | Alta |
| Tampering do registro (ex.: gestor editar resultado) | audit_log append-only + hash de integridade da sessão | DB | Crítica |
| Tentativa de burlar por retry | Máx 1 retry após amarelo, 10 min cooldown, vermelho bloqueia retry | Backend | Média |

## Detalhes por controle

### 1) Match facial CNH (onboarding)

- Provider: Unico Check (ou Idwall / Serpro Datavalid).
- Threshold automático: **≥ 90 %** aprova; 80–89 % vai para análise manual
  pelo gestor; <80 % rejeita.
- Falha aberta: se o provider estiver indisponível por mais de 1 h, o
  motorista **não** é liberado — não tentamos bypass local.

### 2) Liveness ativo (pré-teste)

- Sequência aleatória de 2–3 prompts (piscar, virar a cabeça, sorrir).
- Timeouts agressivos: 8 s para completar a sequência.
- Rejeitar se o provider retornar score < 0.85.

### 3) Reverificação silenciosa durante o teste

- A cada 15 s do teste cognitivo a câmera frontal captura 1 frame.
- O frame é enviado ao provider (async, fire-and-forget).
- Se 2 frames consecutivos retornarem < 0.75 → sessão marcada
  `fraud_suspect` e invalidada (não gera score).
- Frames são **descartados** após a conferência; não persistimos.

### 4) Device binding

- Primeiro login após match facial: `device_fingerprint` (hash SHA-256 de
  install id + model + OS) vira o device autorizado.
- Login de outro device exige revalidação biométrica + aprovação do gestor.
- Cooldown de 30 dias para rotação não-supervisionada.

### 5) Geofence

- `companies.geofence` define `{ lat, lng, radius_m }` (ou polygonos futuros).
- Edge function rejeita submissões com `inside_geofence = false` quando a
  política da empresa exige. O painel sinaliza a exceção.

### 6) Integridade do dispositivo

- Android: Google Play Integrity API (`device`, `basic` e `strong`).
- iOS: DeviceCheck + App Attest.
- Sessão iniciada em device comprometido (emulador, root/jailbreak) é
  automaticamente marcada `fraud_suspect` — o teste não roda.

### 7) Audit log imutável

- Trigger `log_session_mutation` grava toda mudança em `sessions`.
- Hash SHA-256 do registro final armazenado em `sessions.integrity_hash` e
  duplicado no log — qualquer edição divergente é detectada.
- `revoke update, delete on audit_log from public` impede edição via RLS.

### 8) HMAC e assinatura

- Webhook do provider assinado com `BIOMETRIC_WEBHOOK_SECRET` (HMAC-SHA256).
- Submissões mobile ganham um `sessionNonce` emitido pelo backend no início
  da sessão — evita replay.

## Métricas a monitorar (dashboards)

- Taxa de `fraud_suspect` por empresa e por motorista.
- Distribuição de similaridade de reverificação (alerta se > 5 % abaixo de
  0.75 no dia).
- Rotação de device > 1 por motorista/mês.
- Overrides de bloqueio pelo gestor (obrigatório justificativa).
- Latência p95 do provider biométrico.

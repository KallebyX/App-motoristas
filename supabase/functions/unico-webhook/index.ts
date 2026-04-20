// Webhook handler for the biometric provider (Unico Check / Idwall / Serpro).
// Called server-to-server when the provider completes an identity verification
// against the CNH database. On a successful match (>= 90%), we flip the
// driver status to "active" so they can take tests; otherwise the driver is
// flagged for manual review in the dashboard.
//
// Security:
//   - Verifies an HMAC-SHA256 signature using BIOMETRIC_WEBHOOK_SECRET.
//   - Only the service role client is used here (no RLS bypass risk because
//     the function is gated by the shared secret).

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import { z } from 'https://esm.sh/zod@3.23.8';

// deno-lint-ignore no-explicit-any
const Deno: any = (globalThis as any).Deno;

const Payload = z.object({
  driverId: z.string().uuid(),
  provider: z.enum(['unico', 'idwall', 'serpro']),
  providerTxId: z.string().min(1),
  matchScore: z.number().min(0).max(100),
  verifiedAt: z.string().datetime(),
  livenessPassed: z.boolean(),
  reason: z.string().optional(),
});

const AUTO_APPROVE_THRESHOLD = 90;

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const raw = await req.text();
  const signature = req.headers.get('x-webhook-signature');
  const secret = Deno.env.get('BIOMETRIC_WEBHOOK_SECRET');
  if (!signature || !secret) return new Response('unauthorized', { status: 401 });
  if (!(await verifyHmac(raw, secret, signature))) {
    return new Response('invalid signature', { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const parsed = Payload.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify(parsed.error.issues), { status: 400 });
  }
  const p = parsed.data;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('server misconfigured', { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const autoApprove = p.livenessPassed && p.matchScore >= AUTO_APPROVE_THRESHOLD;
  const newStatus = autoApprove ? 'active' : 'pending_match';

  const { error } = await admin
    .from('drivers')
    .update({
      unico_match_score: p.matchScore,
      unico_verified_at: p.verifiedAt,
      status: newStatus,
    })
    .eq('id', p.driverId);

  if (error) return new Response(error.message, { status: 500 });

  await admin.from('audit_log').insert({
    actor: `provider:${p.provider}`,
    company_id: null,
    entity_type: 'driver',
    entity_id: p.driverId,
    action: 'biometric_verified',
    payload: { ...p, autoApprove },
  });

  return new Response(JSON.stringify({ ok: true, autoApprove }), {
    headers: { 'content-type': 'application/json' },
  });
});

async function verifyHmac(body: string, secret: string, hex: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  // timing-safe compare
  if (expected.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ hex.charCodeAt(i);
  return diff === 0;
}

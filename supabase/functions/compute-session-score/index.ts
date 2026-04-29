// Edge function: receives a SessionSubmission from the mobile app, runs the
// scoring engine, persists every artefact (session, cognitive_results,
// subjective_results, session_scores) inside a single RPC-style transaction
// and returns the SessionScore so the app can render the traffic light.
//
// Auth: the function is invoked with the driver's anon JWT — we trust the
// claim for driver_id, but we re-read the company_id + block_policy from the
// drivers / companies tables before scoring, so the client cannot spoof them.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import { z } from 'https://esm.sh/zod@3.23.8';
import { scoreSession } from 'npm:@app-motoristas/scoring@0.1.0';
import {
  SessionSubmissionSchema,
  BlockPolicySchema,
} from 'npm:@app-motoristas/shared-types@0.1.0';

// Deno + Supabase function runtime types are provided by the platform.
// deno-lint-ignore no-explicit-any
const Deno: any = (globalThis as any).Deno;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = req.headers.get('authorization');
  if (!auth) return json({ error: 'missing authorization' }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const parsed = SessionSubmissionSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid payload', details: parsed.error.issues }, 400);
  const submission = parsed.data;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const userJwt = auth.replace(/^Bearer /i, '');

  // 1) Authenticate the driver via their JWT (anon key path).
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) return json({ error: 'unauthorized' }, 401);
  if (userRes.user.id !== submission.driverId)
    return json({ error: 'driver id mismatch with JWT' }, 403);

  // 2) Service-role client for privileged writes (bypasses RLS — safe here
  //    because we just verified the driver above).
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // 3) Resolve driver + company policy.
  const { data: driver, error: dErr } = await admin
    .from('drivers')
    .select('id, company_id, status, companies!inner(block_policy)')
    .eq('id', submission.driverId)
    .single();
  if (dErr || !driver) return json({ error: 'driver not found' }, 404);
  if (driver.status !== 'active') return json({ error: `driver status ${driver.status}` }, 403);

  const policy = BlockPolicySchema.parse(
    (driver as { companies: { block_policy: unknown } }).companies.block_policy ?? {},
  );

  // 4) Score.
  const output = scoreSession({ submission, policy });

  // 5) Persist in one round-trip via RPC stored on the DB.
  const { error: rpcErr } = await admin.rpc('persist_session_score', {
    p_session_id: submission.sessionId,
    p_driver_id: submission.driverId,
    p_company_id: driver.company_id,
    p_payload: submission,
    p_output: output,
  });
  if (rpcErr) return json({ error: 'persist failed', details: rpcErr.message }, 500);

  return json(
    {
      sessionId: output.sessionId,
      objectiveScore: output.objectiveScore,
      subjectiveScore: output.subjectiveScore,
      finalScore: output.finalScore,
      trafficLight: output.trafficLight,
      blocked: output.blocked,
      algorithmVersion: output.algorithmVersion,
    },
    200,
  );
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

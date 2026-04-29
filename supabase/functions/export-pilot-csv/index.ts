// Edge function: gera e devolve um CSV com todos os dados de sessão do
// piloto-sombra para a empresa autenticada. Chamada diariamente por um
// scheduler externo (ou manualmente pelo gestor via painel).
//
// Auth: requer JWT de um membro da empresa (manager/owner).  O
// company_id é resolvido a partir do JWT — o cliente não pode forçar
// outro tenant.
//
// Resposta: text/csv com Content-Disposition para download directo.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

// Deno + Supabase function runtime types are provided by the platform.
// deno-lint-ignore no-explicit-any
const Deno: any = (globalThis as any).Deno;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const auth = req.headers.get('authorization');
  if (!auth) return json({ error: 'missing authorization' }, 401);

  const supabaseUrl     = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey         = Deno.env.get('SUPABASE_ANON_KEY');
  const userJwt         = auth.replace(/^Bearer /i, '');

  // 1) Verify caller identity.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) return json({ error: 'unauthorized' }, 401);

  // 2) Resolve company_id from company_members (RLS-safe lookup).
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: member, error: memberErr } = await admin
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', userRes.user.id)
    .single();

  if (memberErr || !member) return json({ error: 'user is not a company member' }, 403);
  if (!['owner', 'manager'].includes(member.role)) {
    return json({ error: 'only owner/manager may export data' }, 403);
  }

  // 3) Generate CSV via DB function.
  const { data: csv, error: csvErr } = await admin.rpc('export_pilot_csv', {
    p_company_id: member.company_id,
  });

  if (csvErr) return json({ error: 'export failed', details: csvErr.message }, 500);

  // 4) Log the export in audit_log.
  await admin.from('audit_log').insert({
    actor: `manager:${userRes.user.id}`,
    company_id: member.company_id,
    entity_type: 'company',
    entity_id: member.company_id,
    action: 'exported',
    payload: { type: 'pilot_csv', requested_at: new Date().toISOString() },
  });

  const today = new Date().toISOString().slice(0, 10);
  return new Response(csv ?? '', {
    status: 200,
    headers: {
      ...corsHeaders,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="piloto_pvt_${today}.csv"`,
    },
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

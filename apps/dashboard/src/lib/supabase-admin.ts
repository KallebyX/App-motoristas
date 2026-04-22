import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role client. NEVER import this file from anything that gets
// bundled for the browser — the service key bypasses RLS and would be a
// critical leak. Server-only paths: server actions, route handlers, RSC
// fetches gated behind an auth check.
export function getSupabaseAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'Set SUPABASE_SERVICE_ROLE_KEY in the server environment (Vercel → Settings → Environment Variables).',
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

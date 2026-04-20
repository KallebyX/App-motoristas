import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server';

interface Row {
  driver_id: string;
  full_name: string;
  driver_status: string;
  session_id: string | null;
  started_at: string | null;
  traffic_light: 'green' | 'yellow' | 'red' | null;
  final_score: number | null;
  blocked: boolean | null;
}

export default async function DriversPage() {
  const supabase = await getSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const { data, error } = await supabase
    .from('v_driver_latest_session')
    .select('*')
    .order('started_at', { ascending: false, nullsFirst: false });

  const rows = (data ?? []) as Row[];

  return (
    <main className="page">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Motoristas</h1>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>Prontidão do último teste.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/analytics" className="badge badge-neutral" style={{ padding: '8px 14px' }}>
            📊 Analytics
          </Link>
          <Link href="/drivers/new" className="badge badge-neutral" style={{ padding: '8px 14px' }}>
            + Convidar motorista
          </Link>
        </div>
      </header>

      {error ? (
        <div className="card" style={{ color: 'var(--red)' }}>
          Erro ao carregar: {error.message}
        </div>
      ) : null}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Motorista</th>
              <th>Status</th>
              <th>Último teste</th>
              <th>Score</th>
              <th>Semáforo</th>
              <th>Bloqueado?</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.driver_id}>
                <td>{r.full_name}</td>
                <td>
                  <span className={`badge badge-${r.driver_status === 'active' ? 'green' : 'neutral'}`}>
                    {r.driver_status}
                  </span>
                </td>
                <td>{r.started_at ? new Date(r.started_at).toLocaleString('pt-BR') : '—'}</td>
                <td>{r.final_score != null ? Math.round(r.final_score) : '—'}</td>
                <td>
                  {r.traffic_light ? <span className={`badge badge-${r.traffic_light}`}>{r.traffic_light}</span> : '—'}
                </td>
                <td>
                  {r.blocked === true ? (
                    <span className="badge badge-red">sim</span>
                  ) : r.blocked === false ? (
                    <span className="badge badge-green">não</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {r.session_id ? <Link href={`/sessions/${r.session_id}`}>Ver sessão →</Link> : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>
                  Nenhum motorista cadastrado ainda.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const [{ data: session }, { data: score }, { data: cognitive }, { data: subjective }] =
    await Promise.all([
      supabase.from('sessions').select('*, drivers(full_name,cpf,cnh_number)').eq('id', id).maybeSingle(),
      supabase.from('session_scores').select('*').eq('session_id', id).maybeSingle(),
      supabase.from('cognitive_results').select('*').eq('session_id', id),
      supabase.from('subjective_results').select('*').eq('session_id', id).maybeSingle(),
    ]);

  if (!session) notFound();

  const light = (score?.traffic_light ?? 'neutral') as 'green' | 'yellow' | 'red' | 'neutral';

  return (
    <main className="page">
      <Link href="/drivers" style={{ color: 'var(--muted)' }}>
        ← Voltar
      </Link>
      <header style={{ marginTop: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>{session.drivers?.full_name ?? 'Motorista'}</h1>
        <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>
          Sessão {id.slice(0, 8)} · {new Date(session.started_at).toLocaleString('pt-BR')}
        </p>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <div style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>Score final</div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>
            {score?.final_score != null ? Math.round(score.final_score) : '—'}
          </div>
          <span className={`badge badge-${light}`}>{light}</span>
        </div>
        <div className="card">
          <div style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>Objetivo (PVT)</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>
            {score?.objective_score != null ? Math.round(score.objective_score) : '—'}
          </div>
        </div>
        <div className="card">
          <div style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>Subjetivo</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>
            {score?.subjective_score != null ? Math.round(score.subjective_score) : '—'}
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18 }}>Blocos cognitivos</h2>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Bloco</th>
                <th>Mediana RT (ms)</th>
                <th>Lapsos (%)</th>
                <th>CV RT</th>
                <th>Z-score</th>
              </tr>
            </thead>
            <tbody>
              {(cognitive ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.block}</td>
                  <td>{Math.round(Number(row.median_rt_ms))}</td>
                  <td>{(Number(row.lapse_rate) * 100).toFixed(1)}</td>
                  <td>{Number(row.cv_rt).toFixed(3)}</td>
                  <td>{Number(row.z_score).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18 }}>Questionário subjetivo</h2>
        <div className="card">
          <p style={{ margin: 0 }}>
            KSS (sonolência): <strong>{subjective?.kss ?? '—'} / 9</strong>
          </p>
          <p style={{ margin: '8px 0 0' }}>
            Samn-Perelli (cansaço): <strong>{subjective?.samn_perelli ?? '—'} / 7</strong>
          </p>
          {subjective?.hours_slept != null ? (
            <p style={{ margin: '8px 0 0' }}>Horas de sono relatadas: {subjective.hours_slept}h</p>
          ) : null}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 18 }}>Antifraude</h2>
        <div className="card">
          <p style={{ margin: 0 }}>
            Liveness: <strong>{session.liveness_match_score ?? '—'}%</strong>
          </p>
          <p style={{ margin: '8px 0 0' }}>
            Device: {session.device_fingerprint ? `${session.device_fingerprint.slice(0, 16)}…` : '—'}
          </p>
          <p style={{ margin: '8px 0 0' }}>
            Geofence: <strong>{session.inside_geofence == null ? '—' : session.inside_geofence ? 'OK' : 'FORA'}</strong>
          </p>
          {session.liveness_video_ref ? (
            <p style={{ margin: '8px 0 0' }}>
              Vídeo de liveness:{' '}
              <code style={{ color: 'var(--muted)' }}>{session.liveness_video_ref}</code>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

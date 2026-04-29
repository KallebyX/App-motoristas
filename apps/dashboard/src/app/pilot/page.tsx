import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server';

interface SummaryRow {
  company_id: string;
  periodo_dia: 'manha' | 'tarde' | 'noite' | 'madrugada';
  traffic_light: 'green' | 'yellow' | 'red' | null;
  n_sessions: number;
  avg_median_rt_ms: number | null;
  p25_rt_ms: number | null;
  p50_rt_ms: number | null;
  p75_rt_ms: number | null;
  avg_lapse_rate: number | null;
  p50_lapse_rate: number | null;
  avg_final_score: number | null;
  p50_final_score: number | null;
}

interface DistRow {
  session_id: string;
  started_at: string;
  periodo_dia: string;
  median_rt_ms: number | null;
  lapse_rate: number | null;
  final_score: number | null;
  traffic_light: 'green' | 'yellow' | 'red' | null;
  hard_red_reasons: string[] | null;
}

const PERIOD_LABEL: Record<string, string> = {
  manha: '🌅 Manhã (05–11h)',
  tarde: '☀️ Tarde (12–17h)',
  noite: '🌙 Noite (18–22h)',
  madrugada: '🌃 Madrugada (23–04h)',
};

const PERIOD_ORDER = ['madrugada', 'manha', 'tarde', 'noite'];

export default async function PilotPage() {
  const supabase = await getSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const [{ data: summaryData, error: summaryErr }, { data: recentData, error: recentErr }] =
    await Promise.all([
      supabase
        .from('v_pilot_summary')
        .select('*')
        .order('periodo_dia'),
      supabase
        .from('v_pilot_distributions')
        .select(
          'session_id,started_at,periodo_dia,median_rt_ms,lapse_rate,final_score,traffic_light,hard_red_reasons',
        )
        .order('started_at', { ascending: false })
        .limit(50),
    ]);

  const summary = (summaryData ?? []) as SummaryRow[];
  const recent = (recentData ?? []) as DistRow[];

  // Group summary by period for easier rendering.
  const byPeriod = PERIOD_ORDER.map((p) => ({
    period: p,
    rows: summary.filter((r) => r.periodo_dia === p),
  })).filter((g) => g.rows.length > 0);

  // Aggregate totals per period (all traffic lights combined).
  const totals = PERIOD_ORDER.map((p) => {
    const rows = summary.filter((r) => r.periodo_dia === p);
    if (rows.length === 0) return null;
    const n = rows.reduce((s, r) => s + Number(r.n_sessions), 0);
    const greenN = rows.find((r) => r.traffic_light === 'green')?.n_sessions ?? 0;
    const yellowN = rows.find((r) => r.traffic_light === 'yellow')?.n_sessions ?? 0;
    const redN = rows.find((r) => r.traffic_light === 'red')?.n_sessions ?? 0;
    const p50rt = rows.find((r) => r.traffic_light === null)?.p50_rt_ms
      ?? rows[0]?.p50_rt_ms;
    return { period: p, n, greenN, yellowN, redN, p50rt };
  }).filter(Boolean);

  return (
    <main className="page">
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Piloto-sombra — Distribuições PVT</h1>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>
            Política activa: <code>{'{ "yellow": "warn", "red": "warn" }'}</code> — app nunca
            bloqueia.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link href="/pilot/export" className="badge badge-neutral" style={{ padding: '8px 14px' }}>
            ⬇ Exportar CSV
          </Link>
          <Link href="/drivers" className="badge badge-neutral" style={{ padding: '8px 14px' }}>
            ← Motoristas
          </Link>
        </div>
      </header>

      {(summaryErr ?? recentErr) ? (
        <div className="card" style={{ color: 'var(--red)', marginBottom: 16 }}>
          Erro ao carregar dados:{' '}
          {(summaryErr ?? recentErr)?.message}
        </div>
      ) : null}

      {/* --- Totals banner --- */}
      {totals.length > 0 && (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}
        >
          {totals.map((t) =>
            t ? (
              <div className="card" key={t.period}>
                <div
                  style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase', marginBottom: 8 }}
                >
                  {PERIOD_LABEL[t.period] ?? t.period}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{t.n}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>sessões</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="badge badge-green">{t.greenN} verde</span>
                  <span className="badge badge-yellow">{t.yellowN} amarelo</span>
                  <span className="badge badge-red">{t.redN} vermelho</span>
                </div>
              </div>
            ) : null,
          )}
        </section>
      )}

      {/* --- Distribution table by period --- */}
      {byPeriod.map(({ period, rows }) => (
        <section key={period} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>{PERIOD_LABEL[period] ?? period}</h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th>Semáforo</th>
                  <th>Sessões (n)</th>
                  <th>RT mediana p50 (ms)</th>
                  <th>RT IQR p25–p75 (ms)</th>
                  <th>Lapse rate p50</th>
                  <th>Score médio</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .sort((a, b) => {
                    const order = { green: 0, yellow: 1, red: 2, null: 3 };
                    return (order[a.traffic_light ?? 'null'] ?? 3) -
                      (order[b.traffic_light ?? 'null'] ?? 3);
                  })
                  .map((row) => (
                    <tr key={`${period}-${row.traffic_light ?? 'all'}`}>
                      <td>
                        {row.traffic_light ? (
                          <span className={`badge badge-${row.traffic_light}`}>
                            {row.traffic_light}
                          </span>
                        ) : (
                          <span className="badge badge-neutral">todos</span>
                        )}
                      </td>
                      <td>{row.n_sessions}</td>
                      <td>{row.p50_rt_ms != null ? Math.round(Number(row.p50_rt_ms)) : '—'}</td>
                      <td>
                        {row.p25_rt_ms != null && row.p75_rt_ms != null
                          ? `${Math.round(Number(row.p25_rt_ms))}–${Math.round(Number(row.p75_rt_ms))}`
                          : '—'}
                      </td>
                      <td>
                        {row.p50_lapse_rate != null
                          ? `${(Number(row.p50_lapse_rate) * 100).toFixed(1)} %`
                          : '—'}
                      </td>
                      <td>
                        {row.avg_final_score != null
                          ? Math.round(Number(row.avg_final_score))
                          : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {byPeriod.length === 0 && !summaryErr && (
        <div
          className="card"
          style={{ textAlign: 'center', color: 'var(--muted)', padding: 48, marginBottom: 32 }}
        >
          Nenhum dado de sessão disponível ainda. O piloto começa quando os primeiros motoristas
          completarem testes com a política <code>warn-warn</code>.
        </div>
      )}

      {/* --- Last 50 sessions --- */}
      <section>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Últimas 50 sessões</h2>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Data/hora</th>
                <th>Período</th>
                <th>RT mediana (ms)</th>
                <th>Lapse rate</th>
                <th>Score final</th>
                <th>Semáforo</th>
                <th>Hard-red</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.session_id}>
                  <td>{new Date(r.started_at).toLocaleString('pt-BR')}</td>
                  <td>
                    <span className="badge badge-neutral">
                      {PERIOD_LABEL[r.periodo_dia] ?? r.periodo_dia}
                    </span>
                  </td>
                  <td>
                    {r.median_rt_ms != null ? Math.round(Number(r.median_rt_ms)) : '—'}
                  </td>
                  <td>
                    {r.lapse_rate != null
                      ? `${(Number(r.lapse_rate) * 100).toFixed(1)} %`
                      : '—'}
                  </td>
                  <td>
                    {r.final_score != null ? Math.round(Number(r.final_score)) : '—'}
                  </td>
                  <td>
                    {r.traffic_light ? (
                      <span className={`badge badge-${r.traffic_light}`}>{r.traffic_light}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {r.hard_red_reasons && r.hard_red_reasons.length > 0 ? (
                      <span
                        className="badge badge-red"
                        title={r.hard_red_reasons.join(', ')}
                      >
                        {r.hard_red_reasons.length}× hard-red
                      </span>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href={`/sessions/${r.session_id}`}>Ver →</Link>
                  </td>
                </tr>
              ))}
              {recent.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}
                  >
                    Nenhuma sessão ainda.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- Calibration targets reminder --- */}
      <section style={{ marginTop: 32 }}>
        <div
          className="card"
          style={{ borderLeft: '4px solid var(--yellow)', borderRadius: '4px 12px 12px 4px' }}
        >
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
            🎯 Metas de calibração (ao fim dos 30 dias)
          </h3>
          <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--muted)', lineHeight: 1.8 }}>
            <li>
              Recalcular <code>PVT_B_NORMS.medianRtMs</code> e{' '}
              <code>PVT_B_NORMS.lapseRate</code> com médias BR.
            </li>
            <li>
              Ajustar <code>TRAFFIC_LIGHT_CUTOFFS</code> para <strong>falso-vermelho ≤ 5 %</strong>{' '}
              e <strong>sensibilidade a incidentes ≥ 80 %</strong>.
            </li>
            <li>
              Bump <code>ALGORITHM_VERSION = &apos;v2&apos;</code> e reprocessar scores históricos.
            </li>
            <li>
              Só então mudar <code>block_policy</code> padrão para{' '}
              <code>{'{ "yellow": "warn", "red": "block" }'}</code>.
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}

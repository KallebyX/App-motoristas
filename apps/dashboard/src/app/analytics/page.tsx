import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

interface CognitiveRow {
  median_rt_ms: number | null;
  lapse_rate: number | null;
  cv_rt: number | null;
}

export default async function AnalyticsPage() {
  const supabase = await getSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const since = new Date();
  since.setDate(since.getDate() - 14);

  const [{ data: cognitive }, { data: scores }] = await Promise.all([
    supabase
      .from('cognitive_results')
      .select('median_rt_ms, lapse_rate, cv_rt, sessions!inner(started_at)')
      .gte('sessions.started_at', since.toISOString())
      .eq('block', 'pvt_b') as unknown as Promise<{ data: CognitiveRow[] | null }>,
    supabase
      .from('session_scores')
      .select('final_score, traffic_light, sessions!inner(started_at, driver_id)')
      .gte('sessions.started_at', since.toISOString()) as unknown as Promise<{
      data: { final_score: number | null; traffic_light: string | null; sessions: { driver_id: string } }[] | null;
    }>,
  ]);

  const scoreRows = scores ?? [];
  const trafficLightCounts = {
    green: scoreRows.filter((r) => r.traffic_light === 'green').length,
    yellow: scoreRows.filter((r) => r.traffic_light === 'yellow').length,
    red: scoreRows.filter((r) => r.traffic_light === 'red').length,
  };
  const total = trafficLightCounts.green + trafficLightCounts.yellow + trafficLightCounts.red;
  const redRate = total === 0 ? 0 : trafficLightCounts.red / total;

  const rtBuckets = histogram(
    (cognitive ?? [])
      .filter((r) => r.median_rt_ms != null)
      .map((r) => Number(r.median_rt_ms))
      .filter((v) => !isNaN(v)),
    [200, 250, 300, 350, 400, 450, 500, 600],
  );
  const lapseBuckets = histogram(
    (cognitive ?? [])
      .filter((r) => r.lapse_rate != null)
      .map((r) => Number(r.lapse_rate) * 100)
      .filter((v) => !isNaN(v)),
    [0, 2, 5, 10, 15, 20, 30, 50],
  );

  const finalScores = scoreRows
    .filter((r) => r.final_score != null)
    .map((r) => Number(r.final_score))
    .filter((v) => !isNaN(v));
  const avgScore = finalScores.length === 0 ? 0 : finalScores.reduce((a, b) => a + b, 0) / finalScores.length;

  // Distinct driver_ids, not rows.
  const activeDrivers = new Set(scoreRows.map((r) => r.sessions?.driver_id).filter(Boolean)).size;

  const goNoGo = {
    sampleSize: { value: total, target: 500, ok: total >= 500 },
    falseRed: { value: redRate, target: 0.05, ok: redRate <= 0.05 },
  };

  return (
    <main className="page">
      <Link href="/drivers" style={{ color: 'var(--muted)' }}>
        ← Voltar
      </Link>
      <header style={{ marginTop: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Analytics — últimos 14 dias</h1>
        <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>
          Distribuições e critérios go/no-go para o piloto-sombra.
        </p>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <Stat label="Sessões" value={total.toString()} />
        <Stat label="Score médio" value={avgScore.toFixed(1)} />
        <Stat label="Taxa de vermelho" value={`${(redRate * 100).toFixed(1)}%`} />
        <Stat label="Motoristas ativos" value={activeDrivers.toString()} />
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18 }}>Go / no-go (issue #5)</h2>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Métrica</th>
                <th>Valor atual</th>
                <th>Meta</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Tamanho amostral</td>
                <td>{goNoGo.sampleSize.value}</td>
                <td>≥ {goNoGo.sampleSize.target}</td>
                <td><Pill ok={goNoGo.sampleSize.ok} /></td>
              </tr>
              <tr>
                <td>Falso-vermelho</td>
                <td>{(goNoGo.falseRed.value * 100).toFixed(1)}%</td>
                <td>≤ {(goNoGo.falseRed.target * 100).toFixed(0)}%</td>
                <td><Pill ok={goNoGo.falseRed.ok} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <Card title="Distribuição de semáforo">
          <LightBar counts={trafficLightCounts} />
        </Card>
        <Card title="Mediana do RT (ms)">
          <Histogram buckets={rtBuckets} unit="ms" />
        </Card>
        <Card title="Lapse rate (%)">
          <Histogram buckets={lapseBuckets} unit="%" />
        </Card>
        <Card title="Dicas">
          <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
            <li>Quando o tamanho amostral bater a meta, rode <code>scripts/analyze-pilot.ts</code> para calibrar cutoffs.</li>
            <li>Se o falso-vermelho ficar alto com RTs ok, provavelmente o KSS/Samn-Perelli do piloto diverge da norma — ajustar os pesos.</li>
            <li>Sessões sem score = liveness falhou ou app abortou.</li>
          </ul>
        </Card>
      </section>
    </main>
  );
}

function histogram(values: number[], edges: number[]): { label: string; count: number }[] {
  const out = edges.slice(0, -1).map((e, i) => ({ label: `${e}–${edges[i + 1]}`, count: 0 }));
  for (const v of values) {
    for (let i = 0; i < edges.length - 1; i++) {
      if (v >= edges[i]! && v < edges[i + 1]!) {
        out[i]!.count += 1;
        break;
      }
    }
  }
  return out;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Pill({ ok }: { ok: boolean }) {
  return <span className={`badge badge-${ok ? 'green' : 'red'}`}>{ok ? 'atingido' : 'pendente'}</span>;
}

function LightBar({ counts }: { counts: { green: number; yellow: number; red: number } }) {
  const total = counts.green + counts.yellow + counts.red;
  if (total === 0) return <p style={{ color: 'var(--muted)' }}>Sem dados.</p>;
  const pct = (n: number) => ((n / total) * 100).toFixed(1);
  return (
    <div>
      <div style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ width: `${pct(counts.green)}%`, background: 'var(--green)' }} />
        <div style={{ width: `${pct(counts.yellow)}%`, background: 'var(--yellow)' }} />
        <div style={{ width: `${pct(counts.red)}%`, background: 'var(--red)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
        <span style={{ color: 'var(--green)' }}>🟢 {counts.green} ({pct(counts.green)}%)</span>
        <span style={{ color: 'var(--yellow)' }}>🟡 {counts.yellow} ({pct(counts.yellow)}%)</span>
        <span style={{ color: 'var(--red)' }}>🔴 {counts.red} ({pct(counts.red)}%)</span>
      </div>
    </div>
  );
}

function Histogram({ buckets, unit }: { buckets: { label: string; count: number }[]; unit: string }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div>
      {buckets.map((b) => (
        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 70, fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
            {b.label} {unit}
          </span>
          <div style={{ flex: 1, height: 14, background: 'var(--bg)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(b.count / max) * 100}%`, height: '100%', background: 'var(--primary)' }} />
          </div>
          <span style={{ width: 30, fontSize: 11, textAlign: 'right' }}>{b.count}</span>
        </div>
      ))}
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server';

export default async function InviteDriverPage() {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');

  return (
    <main className="page" style={{ maxWidth: 640 }}>
      <Link href="/drivers" style={{ color: 'var(--muted)' }}>
        ← Voltar
      </Link>
      <header style={{ marginTop: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Convidar motorista</h1>
        <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>
          Em MVP: onboarding é manual via Supabase.
        </p>
      </header>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Passo a passo</h2>
        <ol style={{ paddingLeft: 20, margin: 0, lineHeight: 1.7 }}>
          <li>
            Criar usuário em{' '}
            <a href="https://supabase.com/dashboard/project/wekycrnahqcpnmlmfdvv/auth/users" target="_blank" rel="noreferrer">
              Supabase Auth → Add user
            </a>{' '}
            (telefone + senha).
          </li>
          <li>
            No SQL Editor, inserir em <code>drivers</code>:
            <pre style={preStyle}>
{`insert into drivers (company_id, full_name, cpf, cnh_number, phone, status)
values (
  '<company_id>',
  'Nome Completo',
  '00000000000',
  'CNH-XXXX',
  '+55...',
  'active'
);`}
            </pre>
          </li>
          <li>Compartilhar o APK/Expo Go + telefone com o motorista.</li>
        </ol>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Próximo</h2>
        <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>
          Fluxo automático (convite por SMS + auto-provisionamento) está no roadmap. Por ora, esse processo manual
          é intencional para permitir validação humana de identidade durante o piloto-sombra.
        </p>
      </section>
    </main>
  );
}

const preStyle: React.CSSProperties = {
  background: 'var(--bg)',
  padding: 12,
  borderRadius: 8,
  fontSize: 12,
  overflow: 'auto',
};

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { inviteDriver, type InviteInput, type InviteResult } from './actions';

export default function InviteDriverPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<InviteResult | null>(null);
  const [fieldErr, setFieldErr] = useState<keyof InviteInput | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    setFieldErr(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await inviteDriver(fd);
      setResult(r);
      if (r.ok) {
        setTimeout(() => router.push('/drivers'), 1500);
      } else if (r.field) {
        setFieldErr(r.field);
      }
    });
  }

  return (
    <main className="page" style={{ maxWidth: 640 }}>
      <Link href="/drivers" style={{ color: 'var(--muted)' }}>
        ← Voltar
      </Link>
      <header style={{ marginTop: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Convidar motorista</h1>
        <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>
          Cria o usuário no Supabase Auth + a ficha em <code>drivers</code> em uma única ação.
        </p>
      </header>

      {result?.ok ? (
        <section className="card badge-green" style={{ marginBottom: 16 }}>
          ✅ Motorista criado. user_id <code>{result.user_id.slice(0, 8)}…</code>. Login por{' '}
          <strong>{result.login === 'email' ? 'e-mail' : 'telefone'}</strong>. Redirecionando…
        </section>
      ) : null}

      {result && !result.ok ? (
        <section className="card" style={{ marginBottom: 16, color: 'var(--red)' }}>
          ❌ {result.error}
        </section>
      ) : null}

      <form onSubmit={onSubmit} className="card" style={{ display: 'grid', gap: 12 }}>
        <Field label="Nome completo" name="full_name" invalid={fieldErr === 'full_name'} required placeholder="José da Silva" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="CPF (só números)" name="cpf" invalid={fieldErr === 'cpf'} required placeholder="00000000000" maxLength={11} pattern="\d{11}" inputMode="numeric" />
          <Field label="Telefone (E.164)" name="phone" invalid={fieldErr === 'phone'} required placeholder="+5551999998888" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Field label="CNH" name="cnh_number" invalid={fieldErr === 'cnh_number'} required placeholder="CNH-123456" />
          <Field label="Categoria" name="cnh_category" invalid={fieldErr === 'cnh_category'} placeholder="D" maxLength={5} />
        </div>
        <Field label="E-mail (opcional)" name="email" invalid={fieldErr === 'email'} type="email" placeholder="motorista@frota.com.br" />
        <Field
          label="Senha temporária"
          name="password"
          invalid={fieldErr === 'password'}
          type="password"
          required
          placeholder="mínimo 6 caracteres"
          minLength={6}
          helper="O motorista troca no primeiro acesso. Use algo fácil pro piloto (ex.: data + CPF)."
        />

        <button
          type="submit"
          disabled={pending}
          style={{
            background: 'var(--primary)',
            color: '#fff',
            padding: '10px 16px',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            cursor: pending ? 'wait' : 'pointer',
            marginTop: 4,
          }}
        >
          {pending ? 'Criando…' : 'Criar motorista'}
        </button>
      </form>

      <section style={{ marginTop: 16, color: 'var(--muted)', fontSize: 12 }}>
        <p style={{ margin: 0 }}>
          O fluxo roda via Server Action + <code>SUPABASE_SERVICE_ROLE_KEY</code> (server-only). A senha é
          gravada pelo Supabase Auth com hash — não fica em log.
        </p>
      </section>
    </main>
  );
}

interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name'> {
  label: string;
  name: keyof InviteInput;
  invalid?: boolean;
  helper?: string;
}

function Field({ label, name, invalid, helper, ...rest }: FieldProps) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{label}</span>
      <input
        name={name}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 8,
          border: `1px solid ${invalid ? 'var(--red)' : 'var(--border)'}`,
          background: 'var(--bg)',
          color: 'var(--text)',
          fontSize: 14,
        }}
        {...rest}
      />
      {helper ? <span style={{ color: 'var(--muted)', fontSize: 11 }}>{helper}</span> : null}
    </label>
  );
}

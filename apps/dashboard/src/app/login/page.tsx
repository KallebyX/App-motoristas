'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) {
        throw new Error(
          'Config ausente: NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY não estão no bundle. ' +
            'Defina em vercel.com → Settings → Environment Variables e refaça o deploy.',
        );
      }
      const supabase = createBrowserClient(url, key);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        return;
      }
      router.push('/drivers');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function fillDemo() {
    setEmail('gestor.demo@appmotoristas.dev');
    setPassword('AppMotoristas!2026');
  }

  return (
    <main className="page" style={{ maxWidth: 420 }}>
      <h1>Entrar no painel</h1>
      <div
        className="card"
        style={{
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          marginBottom: 16,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <strong>Acesso demo (piloto-sombra)</strong>
        <div style={{ color: 'var(--muted)', marginTop: 4 }}>
          Email: <code>gestor.demo@appmotoristas.dev</code>
          <br />
          Senha: <code>AppMotoristas!2026</code>
        </div>
        <button
          type="button"
          onClick={fillDemo}
          style={{
            marginTop: 8,
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Preencher campos
        </button>
      </div>
      <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 12 }}>
        <label>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>E-mail</div>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>Senha</div>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>
        {error ? <p style={{ color: 'var(--red)' }}>{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          style={{
            background: 'var(--primary)',
            color: '#fff',
            padding: '10px 16px',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 14,
};

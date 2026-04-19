import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server';

export default async function Home() {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  redirect('/drivers');
  return (
    <div className="page">
      <Link href="/drivers">Ir para motoristas</Link>
    </div>
  );
}

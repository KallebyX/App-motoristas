'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';

const InviteSchema = z.object({
  full_name: z.string().trim().min(3, 'Nome muito curto'),
  cpf: z.string().trim().regex(/^\d{11}$/, 'CPF deve ter 11 dígitos'),
  cnh_number: z.string().trim().min(3, 'CNH obrigatória'),
  cnh_category: z.string().trim().max(5).optional().or(z.literal('').transform(() => undefined)),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, 'Telefone precisa estar em E.164 (ex.: +5551999998888)'),
  email: z
    .string()
    .trim()
    .email('E-mail inválido')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  password: z.string().min(6, 'Senha mínima de 6 caracteres'),
});

export type InviteInput = z.input<typeof InviteSchema>;
export type InviteResult =
  | { ok: true; driver_id: string; user_id: string; login: 'email' | 'phone' }
  | { ok: false; error: string; field?: keyof InviteInput };

export async function inviteDriver(formData: FormData): Promise<InviteResult> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = InviteSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path[0] as keyof InviteInput | undefined;
    return field
      ? { ok: false, error: first?.message ?? 'Input inválido', field }
      : { ok: false, error: first?.message ?? 'Input inválido' };
  }
  const input = parsed.data;

  // 1. Authenticate the gestor and resolve their company.
  const ssr = await getSupabaseServerClient();
  const { data: auth } = await ssr.auth.getUser();
  if (!auth.user) return { ok: false, error: 'Sessão expirada. Faça login novamente.' };

  const { data: member, error: memberErr } = await ssr
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (memberErr) return { ok: false, error: `Erro ao resolver empresa: ${memberErr.message}` };
  if (!member) return { ok: false, error: 'Usuário não está vinculado a uma empresa.' };
  if (!['owner', 'manager'].includes(member.role)) {
    return { ok: false, error: 'Somente owner/manager pode convidar motoristas.' };
  }

  // 2. Create the auth user with service-role so the session refresh is
  //    skipped (the mobile app does phone+OTP or phone+password login).
  const admin = getSupabaseAdminClient();
  const createPayload = input.email
    ? { email: input.email, phone: input.phone, password: input.password, email_confirm: true, phone_confirm: true }
    : { phone: input.phone, password: input.password, phone_confirm: true };

  const { data: created, error: createErr } = await admin.auth.admin.createUser(createPayload);
  if (createErr || !created.user) {
    return { ok: false, error: `Auth: ${createErr?.message ?? 'falha ao criar usuário'}` };
  }

  // 3. Insert the driver row linked to the new auth user. On failure,
  //    roll back the auth user so we don't leave orphans.
  const { data: driver, error: insertErr } = await admin
    .from('drivers')
    .insert({
      company_id: member.company_id,
      user_id: created.user.id,
      full_name: input.full_name,
      cpf: input.cpf,
      cnh_number: input.cnh_number,
      cnh_category: input.cnh_category ?? null,
      phone: input.phone,
      status: 'active',
    })
    .select('id')
    .single();

  if (insertErr || !driver) {
    await admin.auth.admin.deleteUser(created.user.id);
    const msg = insertErr?.message ?? 'insert failed';
    return {
      ok: false,
      error: msg.includes('drivers_company_id_cpf_key')
        ? 'CPF já cadastrado nesta empresa.'
        : `Driver: ${msg}`,
    };
  }

  revalidatePath('/drivers');
  return {
    ok: true,
    driver_id: driver.id,
    user_id: created.user.id,
    login: input.email ? 'email' : 'phone',
  };
}

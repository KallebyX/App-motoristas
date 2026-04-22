#!/usr/bin/env node
// Seed test users + drivers into Supabase for pilot testing.
//
// Creates:
//   - 1 gestor (dashboard manager): email login, role=owner, linked to
//     the demo company (CNPJ 00000000000000, created by migration 0003).
//   - 3 motoristas (mobile app drivers): phone+password login, linked to
//     drivers rows in the demo company.
//
// Idempotent: checks existence before creating and links existing rows
// when they already match (by email for gestor, by phone for motoristas).
// Safe to re-run.
//
// Required env:
//   SEED_SUPABASE_URL           — Supabase project URL (https://<ref>.supabase.co)
//   SEED_SUPABASE_SERVICE_ROLE  — service_role key (NOT the anon key)
// Optional env:
//   SEED_GESTOR_EMAIL           — default: gestor.demo@appmotoristas.dev
//   SEED_GESTOR_PASSWORD        — if unset, a 16-byte base64 value is generated
//                                  and printed once (never persisted anywhere).
//
// Usage: node scripts/seed-test-users.mjs

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const url = process.env.SEED_SUPABASE_URL;
const serviceKey = process.env.SEED_SUPABASE_SERVICE_ROLE;
if (!url || !serviceKey) {
  console.error('Missing SEED_SUPABASE_URL or SEED_SUPABASE_SERVICE_ROLE');
  process.exit(1);
}

// Randomly generated per-run; printed once at the end. Not hardcoded so
// secret scanners don't flag this file as containing a real credential.
const randPw = () => randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 14) + '!a';
const gestorEmail = process.env.SEED_GESTOR_EMAIL || 'gestor.demo@appmotoristas.dev';
const gestorPassword = process.env.SEED_GESTOR_PASSWORD || randPw();
const DEMO_CNPJ = '00000000000000';

const sb = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MOTORISTAS = [
  { full_name: 'João Teste (demo)', cpf: '11111111111', cnh_number: 'CNH-DEMO-001', phone: '+5551988880001', password: randPw() },
  { full_name: 'Maria Teste (demo)', cpf: '22222222222', cnh_number: 'CNH-DEMO-002', phone: '+5551988880002', password: randPw() },
  { full_name: 'Carlos Teste (demo)', cpf: '33333333333', cnh_number: 'CNH-DEMO-003', phone: '+5551988880003', password: randPw() },
];

async function resolveCompanyId() {
  const { data, error } = await sb.from('companies').select('id').eq('cnpj', DEMO_CNPJ).maybeSingle();
  if (error) throw new Error(`companies lookup: ${error.message}`);
  if (!data) throw new Error(`demo company (CNPJ ${DEMO_CNPJ}) not found — run migration 0003 first`);
  return data.id;
}

async function listAllUsers() {
  // listUsers paginates; we only need the first page for lookups at this scale.
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  return data.users;
}

function findUser(users, { email, phone }) {
  return users.find((u) => (email && u.email === email) || (phone && u.phone === phone.replace(/^\+/, ''))) || null;
}

async function upsertGestor(companyId, users) {
  const existing = findUser(users, { email: gestorEmail });
  let userId;
  if (existing) {
    userId = existing.id;
    console.log(`  gestor ${gestorEmail}: already in auth.users (id=${userId.slice(0, 8)}…)`);
  } else {
    const { data, error } = await sb.auth.admin.createUser({
      email: gestorEmail,
      password: gestorPassword,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`create gestor: ${error?.message}`);
    userId = data.user.id;
    console.log(`  gestor ${gestorEmail}: created (id=${userId.slice(0, 8)}…)`);
  }

  const { data: existingMember, error: memberErr } = await sb
    .from('company_members')
    .select('user_id, role, company_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (memberErr) throw new Error(`company_members lookup: ${memberErr.message}`);

  if (!existingMember) {
    const { error: insertErr } = await sb.from('company_members').insert({
      user_id: userId,
      company_id: companyId,
      role: 'owner',
    });
    if (insertErr) throw new Error(`link gestor: ${insertErr.message}`);
    console.log(`  gestor linked to company as owner`);
  } else if (existingMember.company_id !== companyId) {
    console.log(`  gestor already linked to different company ${existingMember.company_id.slice(0, 8)}… — skipping`);
  } else {
    console.log(`  gestor already linked as ${existingMember.role}`);
  }
  return { userId, login: gestorEmail, password: gestorPassword };
}

async function upsertMotorista(companyId, users, spec) {
  const existing = findUser(users, { phone: spec.phone });
  let userId;
  if (existing) {
    userId = existing.id;
    console.log(`  ${spec.phone}: auth.users exists (id=${userId.slice(0, 8)}…)`);
  } else {
    const { data, error } = await sb.auth.admin.createUser({
      phone: spec.phone,
      password: spec.password,
      phone_confirm: true,
    });
    if (error || !data.user) throw new Error(`create ${spec.phone}: ${error?.message}`);
    userId = data.user.id;
    console.log(`  ${spec.phone}: created (id=${userId.slice(0, 8)}…)`);
  }

  const { data: existingDriver } = await sb
    .from('drivers')
    .select('id, user_id')
    .eq('company_id', companyId)
    .eq('cpf', spec.cpf)
    .maybeSingle();

  if (existingDriver) {
    if (existingDriver.user_id !== userId) {
      const { error } = await sb.from('drivers').update({ user_id: userId }).eq('id', existingDriver.id);
      if (error) throw new Error(`relink driver ${spec.cpf}: ${error.message}`);
      console.log(`  driver ${spec.cpf}: user_id relinked`);
    } else {
      console.log(`  driver ${spec.cpf}: already linked`);
    }
  } else {
    const { error } = await sb.from('drivers').insert({
      company_id: companyId,
      user_id: userId,
      full_name: spec.full_name,
      cpf: spec.cpf,
      cnh_number: spec.cnh_number,
      phone: spec.phone,
      status: 'active',
    });
    if (error) throw new Error(`insert driver ${spec.cpf}: ${error.message}`);
    console.log(`  driver ${spec.cpf}: inserted`);
  }
  return { phone: spec.phone, password: spec.password };
}

async function main() {
  console.log('== Resolving demo company ==');
  const companyId = await resolveCompanyId();
  console.log(`  company_id=${companyId}`);

  console.log('\n== Listing existing auth users ==');
  const users = await listAllUsers();
  console.log(`  ${users.length} users on this project`);

  console.log('\n== Seeding gestor ==');
  const gestor = await upsertGestor(companyId, users);

  console.log('\n== Seeding motoristas ==');
  const motoristas = [];
  for (const m of MOTORISTAS) {
    motoristas.push(await upsertMotorista(companyId, users, m));
  }

  console.log('\n== Credentials (DEMO — do not reuse in prod) ==');
  console.log('Dashboard (gestor):');
  console.log(`  email    : ${gestor.login}`);
  console.log(`  password : ${gestor.password}`);
  console.log('\nMobile (motoristas):');
  for (const m of motoristas) {
    console.log(`  phone: ${m.phone}  password: ${m.password}`);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});

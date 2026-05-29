// Wrapper del cliente Supabase del frontend.
// La libreria @supabase/supabase-js se carga via CDN en index.html
// (mismo patron que XLSX y Chart.js) y queda disponible como window.supabase.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

let _client = null;

function ensureClient() {
  if (_client) return _client;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase JS no cargo. Verifica el <script> en index.html.');
  }
  _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
  return _client;
}

export function getSupabaseClient() {
  return ensureClient();
}

// ===== Autenticacion =====

export async function signIn(email, password) {
  const { data, error } = await ensureClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await ensureClient().auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session }, error } = await ensureClient().auth.getSession();
  if (error) {
    console.warn('getSession error', error);
    return null;
  }
  return session;
}

export function onAuthStateChange(cb) {
  return ensureClient().auth.onAuthStateChange(cb);
}

// ===== Tenant + rol del usuario logueado =====

// Lee tenant_users + tenants para saber a que tenant pertenece el usuario
// actual y con que rol. Devuelve null si no esta logueado o no tiene tenant.
export async function fetchCurrentTenantInfo() {
  const session = await getSession();
  if (!session) return null;

  const { data, error } = await ensureClient()
    .from('tenant_users')
    .select('role, tenant_id, activo, tenants(nombre, slug)')
    .eq('user_id', session.user.id)
    .eq('activo', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('fetchCurrentTenantInfo error', error);
    return null;
  }
  if (!data) {
    console.warn('Usuario logueado pero sin tenant asignado:', session.user.email);
    return {
      userId: session.user.id,
      email: session.user.email,
      tenantId: null,
      tenantNombre: null,
      role: null,
      orphan: true
    };
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    tenantId: data.tenant_id,
    tenantNombre: data.tenants?.nombre || '',
    role: data.role,
    orphan: false
  };
}

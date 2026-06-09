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
// actual y con que rol.
//
// Devuelve:
//  - null si no hay sesion o si hubo error (consulta consola para detalles)
//  - { ..., orphan: true } si esta logueado pero sin tenant asignado
//  - { ..., orphan: false } caso normal
//
// IMPORTANTE: hace dos queries separadas en vez de un join PostgREST.
// El join `tenants(nombre, slug)` puede romper por RLS recursiva sobre
// tenants — esto lo evita y es mas debuggeable.
// IMPORTANTE: si se le pasa `sessionArg`, NO llama getSession(). Esto evita un
// deadlock de Supabase: este método se invoca desde dentro del callback de
// onAuthStateChange, que corre sosteniendo un lock interno (navigator.locks);
// llamar getSession() ahí re-intenta el lock y nunca resuelve → app en negro.
// El callback ya recibe la `session`, así que se la pasamos directo.
export async function fetchCurrentTenantInfo(sessionArg) {
  let session = sessionArg;
  if (session === undefined) {
    console.log('🔐 fetchCurrentTenantInfo: getSession...');
    session = await getSession();
  } else {
    console.log('🔐 fetchCurrentTenantInfo: usando session del listener (sin getSession)');
  }
  if (!session) {
    console.log('  → sin sesion');
    return null;
  }
  console.log('  → session OK, user:', session.user.email, 'id:', session.user.id);

  const client = ensureClient();

  // ---------- Query 1: tenant_users ----------
  console.log('🔐 fetchCurrentTenantInfo: query tenant_users...');
  const { data: tuRow, error: tuError } = await client
    .from('tenant_users')
    .select('role, tenant_id, activo')
    .eq('user_id', session.user.id)
    .eq('activo', true)
    .limit(1)
    .maybeSingle();

  if (tuError) {
    console.error('  → tenant_users error:', tuError);
    return null;
  }
  console.log('  → tenant_users data:', tuRow);

  if (!tuRow) {
    console.warn('  → Usuario sin fila en tenant_users (orphan)');
    return {
      userId: session.user.id,
      email: session.user.email,
      tenantId: null,
      tenantNombre: null,
      role: null,
      orphan: true
    };
  }

  // ---------- Query 2: tenants (solo para el nombre, opcional) ----------
  console.log('🔐 fetchCurrentTenantInfo: query tenants...');
  let tenantNombre = '';
  if (tuRow.tenant_id) {
    const { data: tRow, error: tError } = await client
      .from('tenants')
      .select('nombre')
      .eq('id', tuRow.tenant_id)
      .maybeSingle();

    if (tError) {
      console.warn('  → tenants error (no critico, seguimos sin nombre):', tError);
    } else {
      console.log('  → tenants data:', tRow);
      tenantNombre = tRow?.nombre || '';
    }
  }

  const info = {
    userId: session.user.id,
    email: session.user.email,
    tenantId: tuRow.tenant_id,
    tenantNombre,
    role: tuRow.role,
    orphan: false
  };
  console.log('✓ tenant info ready:', info);
  return info;
}

// ===== Aviso de mantenimiento (banner self-serve a nivel tenant) =====

// Lee el flag de mantenimiento del tenant. RESILIENTE: si las columnas aún no
// existen (SQL no corrido) o falla, devuelve apagado — nunca rompe la app.
export async function fetchMantenimiento(tenantId) {
  if (!tenantId) return { activo: false, msg: '' };
  try {
    const { data, error } = await ensureClient()
      .from('tenants')
      .select('mantenimiento, mantenimiento_msg')
      .eq('id', tenantId)
      .maybeSingle();
    if (error) { console.warn('fetchMantenimiento:', error.message); return { activo: false, msg: '' }; }
    return { activo: !!data?.mantenimiento, msg: data?.mantenimiento_msg || '' };
  } catch (e) {
    console.warn('fetchMantenimiento excepción:', e);
    return { activo: false, msg: '' };
  }
}

// Prende/apaga el aviso (escribe en tenants). Solo el admin puede por la RLS
// "tenants_update_admin"; si no es admin, Supabase rechaza y esto lanza.
export async function setMantenimiento(tenantId, activo, msg) {
  if (!tenantId) throw new Error('Sin tenant');
  const { error } = await ensureClient()
    .from('tenants')
    .update({ mantenimiento: !!activo, mantenimiento_msg: msg || '' })
    .eq('id', tenantId);
  if (error) throw error;
}

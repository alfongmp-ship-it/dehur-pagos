// Configuracion publica de Supabase para el frontend.
//
// IMPORTANTE: estos valores son PUBLICOS por diseno de Supabase.
// - SUPABASE_URL: endpoint del proyecto
// - SUPABASE_PUBLISHABLE_KEY: anon/publishable key (antes "anon key")
//
// La proteccion de datos NO viene de ocultar esta key — viene de:
//   1) Row Level Security (RLS) en cada tabla de Postgres
//   2) Autenticacion obligatoria via Supabase Auth
//   3) JWT claims (tenant_id + role) que RLS evalua por query
//
// La service_role key NUNCA va aqui — solo en .secrets/ y solo se usa
// en scripts locales o Edge Functions del lado servidor.

export const SUPABASE_URL = 'https://kqvzuzymvpzyhnzmsmuu.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mB1wf48Z3ecMLgzWCumKqQ_ypORdytE';

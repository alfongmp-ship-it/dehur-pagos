// Capa de datos genérica sobre Supabase (Postgres) para las tablas de la app.
//
// Estos helpers son reutilizables por TODAS las entidades de la migración
// (Etapa B). Supabase es un ESPEJO "tonto": guarda lo que la app le manda, con
// los mismos IDs. Toda la lógica de negocio (saldos, asignaciones, orden) se
// queda en el JavaScript — aquí solo hay lectura/escritura cruda por tenant.
//
// El tenant_id sale de la sesión Supabase del usuario logueado (state.session).
// La RLS de Postgres además lo refuerza del lado servidor.

import { getSupabaseClient } from './supabase.js';
import { state } from '../state.js';

function tenantId() {
  return state.session && state.session.tenantId ? state.session.tenantId : null;
}

// Reemplaza TODAS las filas del tenant en `tabla` por `rows` (espejo de
// gsClearAndWrite: borrar lo del tenant + insertar lo nuevo).
//
// - `rows`: array de objetos con las columnas de la tabla (SIN tenant_id; se
//   inyecta aquí). Si viene vacío, deja la tabla del tenant vacía.
// - Lanza Error si no hay tenant o si Supabase falla. El caller decide cómo
//   manejarlo (en dual-write se atrapa y NO se rompe el guardado a Sheets).
export async function sbReplaceTable(tabla, rows) {
  const tid = tenantId();
  if (!tid) throw new Error('Sin tenant en sesión Supabase; no se puede escribir.');
  const client = getSupabaseClient();

  // 1) Borrar lo existente del tenant.
  const { error: delErr } = await client.from(tabla).delete().eq('tenant_id', tid);
  if (delErr) throw delErr;

  // 2) Insertar lo nuevo con tenant_id inyectado.
  if (rows && rows.length) {
    const withTenant = rows.map(r => ({ ...r, tenant_id: tid }));
    const { error: insErr } = await client.from(tabla).insert(withTenant);
    if (insErr) throw insErr;
  }
  return (rows && rows.length) || 0;
}

// Lee TODAS las filas del tenant en `tabla`. Devuelve un array, o `null` si
// falla o no hay tenant (para que el caller pueda caer a Sheets — Fase 1).
//
// PAGINA de 1000 en 1000: PostgREST limita cada consulta a 1000 filas, así que
// sin paginar el historial (1045+) cargaría incompleto. Ordena por `orderCol`
// (id único de la tabla) para que la paginación NO duplique ni salte filas.
export async function sbLoadTable(tabla, orderCol) {
  const tid = tenantId();
  if (!tid) return null;
  try {
    const client = getSupabaseClient();
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
      let q = client.from(tabla).select('*').eq('tenant_id', tid);
      if (orderCol) q = q.order(orderCol, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) {
        console.warn(`sbLoadTable(${tabla}) error:`, error);
        return null;
      }
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < PAGE) break; // última página
      from += PAGE;
    }
    return all;
  } catch (e) {
    console.warn(`sbLoadTable(${tabla}) excepción:`, e);
    return null;
  }
}

// ¿Hay sesión Supabase con tenant? Útil para decidir si intentar el espejo.
export function sbReady() {
  return !!tenantId();
}

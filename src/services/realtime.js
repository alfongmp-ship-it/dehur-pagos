// ============================================================================
// Tiempo real (Fase 3) — suscripciones a cambios de Supabase.
//
// Cuando otro usuario (u otra pestaña) inserta/edita/borra una fila, Supabase
// envía el cambio por WebSocket; aquí lo aplicamos a state.* y re-renderizamos
// lo afectado. Así todos ven la última versión SIN apretar 🔄 Refrescar.
//
// REVERSIBLE: controlado por REALTIME_ON / ENTIDADES_REALTIME en google-sync.js.
// Con REALTIME_ON=false, esto ni se inicia (bootstrap no lo llama).
//
// PILOTO: solo 'proveedores'. Para desplegar a otra entidad: agrega su entrada
// en RT (tabla, idField, cómo mapear la fila entrante, qué re-renderizar) y mete
// la entidad en ENTIDADES_REALTIME + corre el `alter publication ... add table`.
//
// SEGURIDAD: cada canal filtra por tenant_id (solo recibes lo de tu empresa) y
// la RLS de la tabla lo refuerza del lado servidor. NO se llaman métodos de auth
// dentro de los callbacks (los canales no usan el lock de navigator.locks).
// ============================================================================

import { getSupabaseClient } from './supabase.js';
import { state } from '../state.js';
import { normalizeBanco } from '../config/bancos.js';
import { ENTIDADES_REALTIME } from './google-sync.js';

const toInt = v => parseInt(v) || 0;

// Registro de entidades para tiempo real. Una entrada por entidad suscrita.
// - tabla:    tabla en Supabase
// - stateKey: arreglo en state (state[stateKey])
// - idField:  campo id del objeto en state (para encontrar/reemplazar)
// - mapRow:   fila entrante de Supabase → objeto con la forma de state.*
//             (DEBE calcar el mapeo de carga en sbLoadAll para que todo cuadre)
// - rerender: qué re-pintar tras aplicar el cambio
const RT = {
  proveedores: {
    tabla: 'proveedores',
    stateKey: 'proveedores',
    idField: 'id',
    mapRow: r => ({
      id: toInt(r.id), nombre: r.nombre || '', rfc: r.rfc || '', banco: normalizeBanco(r.banco || ''),
      tipo_cuenta: r.tipo_cuenta || '', cuenta: r.cuenta || '', clabe: r.clabe || '', num_cuenta: r.cuenta || '',
      categoria: r.categoria || '', subcategoria: r.subcategoria || '',
      proyectos: Array.isArray(r.proyectos) ? r.proyectos : [], activo: r.activo !== false,
      bloqueada_para_pago: !!r.bloqueada_para_pago, aliases: Array.isArray(r.aliases) ? r.aliases : []
    }),
    rerender: () => {
      if (window.renderProveedores) window.renderProveedores();
      if (window.refreshProyectosEnSelects) window.refreshProyectosEnSelects();
      const c = document.getElementById('cnt-prov');
      if (c) c.textContent = state.proveedores.length;
    }
  }
};

let _canales = [];

// Aplica un cambio entrante (INSERT/UPDATE/DELETE) al state. Idempotente: si es
// el eco de tu propio cambio, reemplaza la misma fila por sí misma (inofensivo).
function aplicarCambio(def, payload) {
  const arr = state[def.stateKey];
  if (!Array.isArray(arr)) return;
  if (payload.eventType === 'DELETE') {
    const id = payload.old ? payload.old[def.idField] : null;
    if (id == null) return;
    const i = arr.findIndex(x => String(x[def.idField]) === String(id));
    if (i !== -1) arr.splice(i, 1);
  } else {
    // INSERT o UPDATE
    if (!payload.new) return;
    const obj = def.mapRow(payload.new);
    const i = arr.findIndex(x => String(x[def.idField]) === String(obj[def.idField]));
    if (i !== -1) arr[i] = obj;
    else arr.push(obj);
  }
  try { def.rerender(); } catch (e) { console.warn('Realtime rerender falló:', e); }
}

// Arranca las suscripciones para las entidades en ENTIDADES_REALTIME.
// Idempotente: si ya hay canales abiertos, no duplica.
export async function iniciarRealtime() {
  if (_canales.length) return;
  const tid = state.session && state.session.tenantId;
  if (!tid) { console.warn('Realtime: sin tenant; no suscribo'); return; }
  const client = getSupabaseClient();

  for (const key of ENTIDADES_REALTIME) {
    const def = RT[key];
    if (!def) { console.warn('Realtime: sin definición para', key); continue; }
    const canal = client
      .channel('rt-' + def.tabla)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: def.tabla, filter: `tenant_id=eq.${tid}` },
        payload => aplicarCambio(def, payload))
      .subscribe(status => console.log(`Realtime ${def.tabla}:`, status));
    _canales.push(canal);
  }
  console.log('✓ Realtime iniciado para:', [...ENTIDADES_REALTIME].join(', ') || '(ninguna)');
}

// Cierra las suscripciones (para revertir o al cerrar sesión).
export function detenerRealtime() {
  try {
    const client = getSupabaseClient();
    _canales.forEach(c => { try { client.removeChannel(c); } catch (e) {} });
  } catch (e) { /* sin cliente, nada que cerrar */ }
  _canales = [];
}

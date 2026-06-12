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
const toNum = v => parseFloat(v) || 0;

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
  },
  empleados: {
    tabla: 'empleados',
    stateKey: 'empleados',
    idField: 'id',
    mapRow: r => ({
      id: toInt(r.id), nombre: r.nombre || '', puesto: r.puesto || '', empresa: r.empresa || '',
      banco: r.banco || 'BBVA', tipo_cuenta: r.tipo_cuenta || '', cuenta: r.cuenta || '',
      clabe: r.clabe || '', rfc: r.rfc || '', activo: r.activo !== false
    }),
    rerender: () => {
      if (window.renderNomina) window.renderNomina();
      const c = document.getElementById('cnt-nom');
      if (c) c.textContent = state.empleados.length;
    }
  },
  partidasCatalogo: {
    tabla: 'partidas_catalogo',
    stateKey: 'partidasCatalogo',
    idField: 'id', // en el objeto de state el id vive en .id (la columna es partida_id)
    mapRow: r => ({
      id: r.partida_id || '', partida: r.partida || '',
      subpartidas: Array.isArray(r.subpartidas) ? r.subpartidas : [],
      orden: toInt(r.orden), activa: r.activa !== false
    }),
    rerender: () => { if (window.renderConfigPartidas) window.renderConfigPartidas(); }
  },
  partidasObra: {
    tabla: 'partidas_obra',
    stateKey: 'partidasObra',
    idField: 'id', // el id vive en .id (la columna es partida_obra_id)
    mapRow: r => ({
      id: r.partida_obra_id || '', nombre: r.nombre || '', proyecto: r.proyecto || '',
      partidaAdmin: r.partida_admin || '', subPartidaAdmin: r.sub_partida_admin || '',
      orden: toInt(r.orden), activa: r.activa !== false
    }),
    rerender: () => { if (window.renderConfigPartidasObra) window.renderConfigPartidasObra(); }
  },
  creditos: {
    tabla: 'creditos',
    stateKey: 'creditos',
    idField: 'credito_id',
    mapRow: r => ({
      credito_id: toInt(r.credito_id), nombre: r.nombre || '', banco: r.banco || '',
      tipo_credito: r.tipo_credito || 'Puente', monto_autorizado: toNum(r.monto_autorizado),
      tasa_base: toNum(r.tasa_base), proyecto: r.proyecto || '', cuenta_pago: r.cuenta_pago || '',
      estatus: r.estatus || 'Activo', activo: r.activo !== false
    }),
    rerender: () => { if (window.renderCreditos) window.renderCreditos(); }
  },
  pagares: {
    tabla: 'pagares',
    stateKey: 'pagares',
    idField: 'pagare_id',
    mapRow: r => ({
      pagare_id: toInt(r.pagare_id), credito_id: toInt(r.credito_id), numero_pagare: r.numero_pagare || '',
      monto: toNum(r.monto), fecha_disposicion: r.fecha_disposicion || '', fecha_vencimiento: r.fecha_vencimiento || '',
      tasa: toNum(r.tasa), estatus: r.estatus || 'Vigente', activo: r.activo !== false
    }),
    rerender: () => { if (window.renderCreditos) window.renderCreditos(); }
  },
  unidades: {
    tabla: 'unidades',
    stateKey: 'unidades',
    idField: 'unidad_id',
    mapRow: r => {
      const plano = v => (v === null || v === undefined || v === '' ? null : (parseFloat(v) || 0));
      return {
        unidad_id: toInt(r.unidad_id), proyecto: r.proyecto || '', nombre: r.nombre || '', tipo: r.tipo || '',
        indiviso_pct: toNum(r.indiviso_pct), superficie_m2: toNum(r.superficie_m2), estatus: r.estatus || 'En obra',
        orden: toInt(r.orden), activo: r.activo !== false,
        plano_x: plano(r.plano_x), plano_y: plano(r.plano_y), plano_w: plano(r.plano_w), plano_h: plano(r.plano_h)
      };
    },
    rerender: () => { if (window.renderCostosFiscales) window.renderCostosFiscales(); }
  },
  facturas: {
    tabla: 'facturas',
    stateKey: 'facturas',
    idField: 'factura_id',
    mapRow: r => ({
      factura_id: toInt(r.factura_id), numero_factura: r.numero_factura || '', razon_social: r.razon_social || '',
      proveedor_id: toInt(r.proveedor_id), nombre_proveedor: r.nombre_proveedor || '', fecha_factura: r.fecha_factura || '',
      fecha_vencimiento: r.fecha_vencimiento || '', fecha_pago_total: r.fecha_pago_total || '',
      monto_total: toNum(r.monto_total), monto_pagado: toNum(r.monto_pagado), saldo_pendiente: toNum(r.saldo_pendiente),
      estatus_factura: r.estatus_factura || 'pendiente', proyecto: r.proyecto || '', observaciones: r.observaciones || '',
      activo: r.activo !== false, uuid: r.uuid || ''
    }),
    rerender: () => {
      if (window.renderFacturas) window.renderFacturas();
      const c = document.getElementById('cnt-fact');
      if (c) c.textContent = state.facturas.length;
    }
  },
  facturaPagos: {
    tabla: 'factura_pagos',
    stateKey: 'facturaPagos',
    idField: 'factura_pago_id',
    mapRow: r => ({
      factura_pago_id: toInt(r.factura_pago_id), factura_id: toInt(r.factura_id), pago_id: toInt(r.pago_id),
      proveedor_id: toInt(r.proveedor_id), monto_aplicado: toNum(r.monto_aplicado), fecha_pago: r.fecha_pago || '',
      estatus: r.estatus || '', observaciones: r.observaciones || ''
    }),
    rerender: () => {
      if (window.renderFacturaPagos) window.renderFacturaPagos();
      const c = document.getElementById('cnt-fp');
      if (c) c.textContent = state.facturaPagos.length;
    }
  },
  traspasos: {
    tabla: 'traspasos',
    stateKey: 'traspasos',
    idField: 'traspaso_id',
    mapRow: r => ({
      traspaso_id: toInt(r.traspaso_id), tipo: r.tipo || '', cuenta_origen_id: r.cuenta_origen_id || '',
      cuenta_origen_tipo: r.cuenta_origen_tipo || 'proyecto', cuenta_origen_nombre: r.cuenta_origen_nombre || '',
      proyecto_origen: r.proyecto_origen || '', cuenta_destino_id: r.cuenta_destino_id || '',
      cuenta_destino_tipo: r.cuenta_destino_tipo || 'proyecto', cuenta_destino_nombre: r.cuenta_destino_nombre || '',
      proyecto_destino: r.proyecto_destino || '', monto: toNum(r.monto), fecha: r.fecha || '',
      concepto: r.concepto || '', referencia: r.referencia || '', estatus: r.estatus || 'pendiente',
      fecha_registro: r.fecha_registro || ''
    }),
    rerender: () => {
      if (window.renderTraspasos) window.renderTraspasos();
      if (window.renderResumenTraspasos) window.renderResumenTraspasos();
      const c = document.getElementById('cnt-traspasos');
      if (c) c.textContent = state.traspasos.length;
    }
  },
  movimientosInternos: {
    tabla: 'movimientos_internos',
    stateKey: 'movimientosInternos',
    idField: 'id',
    mapRow: r => ({
      id: toInt(r.id), fecha: r.fecha || '', tipo: r.tipo || '', origen: r.origen || '',
      destino: r.destino || '', monto: toNum(r.monto), concepto: r.concepto || '', referencia: r.referencia || ''
    }),
    rerender: () => { if (window.renderFlujoSalida) window.renderFlujoSalida(); }
  }
};

let _canales = [];

// Aplica un cambio entrante (INSERT/UPDATE/DELETE) al state. Idempotente: si es
// el eco de tu propio cambio, reemplaza la misma fila por sí misma (inofensivo).
function aplicarCambio(def, payload) {
  const arr = state[def.stateKey];
  if (!Array.isArray(arr)) return;
  if (payload.eventType === 'DELETE') {
    if (!payload.old) return;
    // payload.old trae las columnas del replica-identity (la PK). Lo pasamos por
    // mapRow para traducir la COLUMNA (ej. partida_id) al CAMPO del estado (id);
    // si usáramos payload.old[idField] directo fallaría cuando difieren.
    const id = def.mapRow(payload.old)[def.idField];
    if (id == null || id === '') return;
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

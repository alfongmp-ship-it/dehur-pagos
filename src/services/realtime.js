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
  // ⚠️ mapRow CALCA el loader de sbLoadAll campo por campo (incluido avance_fisico):
  // un campo omitido aquí se pondría en cero al recibir cualquier evento.
  presupuestoUnidad: {
    tabla: 'presupuesto_unidad',
    stateKey: 'presupuestoUnidad',
    idField: 'presupuesto_id',
    mapRow: r => ({
      presupuesto_id: r.presupuesto_id != null ? String(r.presupuesto_id) : '',
      unidad_id: toInt(r.unidad_id), partida: r.partida || '',
      sub_partida: r.sub_partida || '', monto_presupuestado: toNum(r.monto_presupuestado),
      costo_inicial: toNum(r.costo_inicial), notas: r.notas || '',
      avance_fisico: toNum(r.avance_fisico)
    }),
    rerender: () => {
      // No pisar una captura EN CURSO: guardar una celda de avance dispara el eco
      // realtime del propio upsert ~0.5s después; re-renderizar aquí destruiría lo
      // que el residente esté tecleando en la siguiente celda. El state ya quedó
      // actualizado; la UI se refresca en el siguiente render natural.
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT') && ae.closest('#page-costos-fiscales')) return;
      if (window.renderCostosFiscales) window.renderCostosFiscales();
    }
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
        orden: toInt(r.orden), activo: r.activo !== false, fecha_termino: r.fecha_termino || '',
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
      estatus_factura: r.estatus_factura || 'pendiente', proyecto: r.proyecto || '', empresa: r.empresa || '', observaciones: r.observaciones || '',
      activo: r.activo !== false, uuid: r.uuid || '',
      // Fase 2: campos fiscales (CFDI). SIN esto, un evento realtime reconstruía la factura
      // sin estos datos → quedaban en cero en memoria y se perdían al siguiente guardado.
      // Debe calzar con la carga inicial (sbLoadAll) y _rowFactura.
      subtotal: toNum(r.subtotal), descuento: toNum(r.descuento), iva_trasladado: toNum(r.iva_trasladado),
      retencion_iva: toNum(r.retencion_iva), retencion_isr: toNum(r.retencion_isr),
      nc_subtotal: toNum(r.nc_subtotal), nc_iva: toNum(r.nc_iva),
      rfc_emisor: r.rfc_emisor || '', estado_sat: r.estado_sat || 'Vigente', tipo_comprobante: r.tipo_comprobante || 'Factura'
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
      factura_pago_id: r.factura_pago_id != null ? String(r.factura_pago_id) : '', factura_id: toInt(r.factura_id), pago_id: toInt(r.pago_id),
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
  },
  // pendientesConfirmacion va SOLO en realtime (no en ENTIDADES_POR_FILA): el
  // guardado sigue siendo whole-table (es una tabla chica, la cola de pagos por
  // confirmar). Así dos admins ven la MISMA cola en vivo sin tocar confirmar-pagos.
  pendientesConfirmacion: {
    tabla: 'pendientes_confirmacion',
    stateKey: 'pendientesConfirmacion',
    idField: 'id',
    mapRow: r => {
      const ap = r.asignaciones_planificadas || {};
      return {
        id: parseInt(r.id) || r.id, proveedor_id: r.proveedor_id || '', factura_id: r.factura_id || '',
        nombre: r.nombre || '', cuenta: r.cuenta || '', banco: normalizeBanco(r.banco || ''),
        tipo: r.tipo || '', concepto: r.concepto || '', importe: parseFloat(r.importe) || 0,
        proyecto: r.proyecto || '', partida: r.partida || '', cuenta_cargo: r.cuenta_cargo || '',
        fechaGen: r.fecha_gen || '', confirmado: r.confirmado !== false, sub_partida: r.sub_partida || '',
        asignacionesPlanificadas: Array.isArray(ap.a) ? ap.a : [], repartoMetodo: ap.m || null,
        partidaObra: r.partida_obra || ''
      };
    },
    rerender: () => {
      if (window.renderConfirmarPagos) window.renderConfirmarPagos();
      const c = document.getElementById('cnt-confirmar');
      if (c) c.textContent = state.pendientesConfirmacion.length;
    }
  },
  // proyectos y cuentasPropias: tablas chicas. Sus ediciones de CONFIG van por
  // fila; los cambios de saldo por pagos (confirmar/traspasos/borrados) siguen
  // whole-table (espejo trivial por ser pocas filas) -> saldos en vivo igual.
  proyectos: {
    tabla: 'proyectos',
    stateKey: 'proyectos',
    idField: 'id',
    mapRow: r => ({
      id: r.id || '', nombre: r.nombre || '', empresa: r.empresa || '', cuenta: r.cuenta || '',
      clabe: r.clabe || '', color: r.color || '#C8A96E', activo: r.activo !== false,
      saldo: (parseFloat(r.saldo) || 0), ultima_act_saldo: r.ultima_act_saldo || '',
      es_concentradora: !!r.es_concentradora
    }),
    rerender: () => {
      if (window.renderConfigProyectos) window.renderConfigProyectos();
      if (window.renderCuentasPropias) window.renderCuentasPropias();
      if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
      if (window.renderHeaderBadges) window.renderHeaderBadges();
      if (window.refreshProyectosEnSelects) window.refreshProyectosEnSelects();
    }
  },
  cuentasPropias: {
    tabla: 'cuentas_propias',
    stateKey: 'cuentasPropias',
    idField: 'cuenta_id',
    mapRow: r => ({
      cuenta_id: toInt(r.cuenta_id), nombre: r.nombre || '', banco: r.banco || '', clabe: r.clabe || '',
      numero_cuenta: r.numero_cuenta || '', proyecto: r.proyecto || '', tipo: r.tipo || 'General',
      saldo: (parseFloat(r.saldo) || 0), ultima_actualizacion: r.ultima_actualizacion || '',
      activo: r.activo !== false
    }),
    rerender: () => {
      if (window.renderCuentasPropias) window.renderCuentasPropias();
      if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
      if (window.renderHeaderBadges) window.renderHeaderBadges();
    }
  },
  pagosPagare: {
    tabla: 'pagos_pagare',
    stateKey: 'pagosPagare',
    idField: 'pago_id',
    mapRow: r => ({
      pago_id: toInt(r.pago_id), pagare_id: toInt(r.pagare_id), credito_id: toInt(r.credito_id),
      fecha_pago: r.fecha_pago || '', monto_intereses: toNum(r.monto_intereses), concepto: r.concepto || '',
      estatus: r.estatus || 'Pendiente', fecha_real_pago: r.fecha_real_pago || ''
    }),
    rerender: () => {
      if (window.renderCreditos) window.renderCreditos();
      if (window.renderHistorial) window.renderHistorial();
    }
  },
  historial: {
    tabla: 'historial',
    stateKey: 'historial',
    idField: 'id',
    mapRow: r => ({
      proveedor_id: r.proveedor_id || '', factura_id: r.factura_id || '', fecha: r.fecha || '',
      nombre: r.nombre || '', banco: normalizeBanco(r.banco || ''), tipo: r.tipo || '', concepto: r.concepto || '',
      importe: toNum(r.importe), proyecto: r.proyecto || '', cuenta_origen: r.cuenta_origen || '',
      tipo_registro: r.tipo_registro || 'Pago', partida: r.partida || '', sub_partida: r.sub_partida || '',
      id: r.id || ''
    }),
    rerender: () => {
      if (window.renderHistorial) window.renderHistorial();
      if (window.renderCostosFiscales) window.renderCostosFiscales();
      if (window.renderFlujoSalida) window.renderFlujoSalida();
      const c = document.getElementById('cnt-hist');
      if (c) c.textContent = state.historial.length;
    }
  },
  // ===== INGRESOS (Fase 1) — mapRow CALCA sbLoadAll (ids con String, ventas con derivados) =====
  clientes: {
    tabla: 'clientes',
    stateKey: 'clientes',
    idField: 'cliente_id',
    mapRow: r => ({
      cliente_id: r.cliente_id != null ? String(r.cliente_id) : '',
      nombre: r.nombre || '', rfc: r.rfc || '', telefono: r.telefono || '',
      email: r.email || '', observaciones: r.observaciones || '', activo: r.activo !== false
    }),
    rerender: () => { if (window.renderClientes) window.renderClientes(); }
  },
  ventas: {
    tabla: 'ventas',
    stateKey: 'ventas',
    idField: 'venta_id',
    mapRow: r => ({
      venta_id: r.venta_id != null ? String(r.venta_id) : '',
      unidad_id: r.unidad_id != null ? String(r.unidad_id) : '', proyecto: r.proyecto || '',
      cliente_id: r.cliente_id != null ? String(r.cliente_id) : '',
      precio_venta: toNum(r.precio_venta), tipo_credito: r.tipo_credito || '',
      estatus_comercial: r.estatus_comercial || 'apartada', fecha_apartado: r.fecha_apartado || '',
      fecha_escritura_estimada: r.fecha_escritura_estimada || '', fecha_escritura_real: r.fecha_escritura_real || '',
      valor_liberacion: toNum(r.valor_liberacion), credito_id: r.credito_id != null ? String(r.credito_id) : '',
      // DERIVADOS: sin estos, un evento realtime dejaría la venta con cobrado/saldo en cero.
      monto_cobrado: toNum(r.monto_cobrado), saldo_cliente: toNum(r.saldo_cliente),
      observaciones: r.observaciones || '', activo: r.activo !== false
    }),
    rerender: () => {
      if (window.renderVentas) window.renderVentas();
      if (window.renderEstadoCuenta) window.renderEstadoCuenta();
    }
  },
  cobros: {
    tabla: 'cobros',
    stateKey: 'cobros',
    idField: 'cobro_id',
    mapRow: r => ({
      cobro_id: r.cobro_id != null ? String(r.cobro_id) : '',
      venta_id: r.venta_id != null ? String(r.venta_id) : '', cliente_id: r.cliente_id != null ? String(r.cliente_id) : '',
      proyecto: r.proyecto || '', fecha: r.fecha || '', monto: toNum(r.monto),
      tipo_cobro: r.tipo_cobro || 'abono', metodo: r.metodo || 'transferencia',
      cuenta_destino_tipo: r.cuenta_destino_tipo || '', cuenta_destino_id: r.cuenta_destino_id != null ? String(r.cuenta_destino_id) : '',
      referencia: r.referencia || '', concepto: r.concepto || '', observaciones: r.observaciones || '', activo: r.activo !== false
    }),
    rerender: () => {
      // Un cobro entrante mueve el saldo de su venta: recomputar local (contra el
      // race de orden de eventos) y re-pintar cobranza + ventas + estado de cuenta.
      if (window.recalcularVentasDesdeCobros) window.recalcularVentasDesdeCobros();
      if (window.renderCobros) window.renderCobros();
      if (window.renderVentas) window.renderVentas();
      if (window.renderEstadoCuenta) window.renderEstadoCuenta();
    }
  },
  // ===== ESTRATEGIA (Fase 2) — mapRow CALCA sbLoadAll. Un cambio de config o de
  // marca re-pinta también el TABLERO (el ranking depende de ambos). =====
  estrategiaConfig: {
    tabla: 'estrategia_config',
    stateKey: 'estrategiaConfig',
    idField: 'clave',
    mapRow: r => ({
      clave: r.clave != null ? String(r.clave) : '',
      valor: r.valor,                       // jsonb → JS nativo (igual que la carga)
      descripcion: r.descripcion || '', grupo: r.grupo || 'general'
    }),
    rerender: () => {
      if (window.renderEstrategiaConfig) window.renderEstrategiaConfig();
      if (window.renderEstrategiaTablero) window.renderEstrategiaTablero();
    }
  },
  estrategiaFlags: {
    tabla: 'estrategia_flags_unidad',
    stateKey: 'estrategiaFlags',
    idField: 'flag_id',
    mapRow: r => ({
      flag_id: r.flag_id != null ? String(r.flag_id) : '',
      unidad_id: r.unidad_id != null ? String(r.unidad_id) : '', proyecto: r.proyecto || '',
      tipo: r.tipo || 'bloqueo', categoria: r.categoria || '',
      fecha_compromiso: r.fecha_compromiso || '', nota: r.nota || '', activo: r.activo !== false
    }),
    rerender: () => {
      if (window.renderEstrategiaFlags) window.renderEstrategiaFlags();
      if (window.renderEstrategiaTablero) window.renderEstrategiaTablero();
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

  // CRÍTICO: autenticar la conexión de realtime con el JWT del usuario ANTES de
  // suscribir. Sin esto, realtime corre con la llave pública (anon) y la RLS de
  // las tablas BLOQUEA todos los eventos → los canales dicen SUBSCRIBED pero no
  // llega nada. getSession aquí es seguro: iniciarRealtime corre en bootstrap,
  // FUERA del callback de onAuthStateChange (no re-entra el lock de auth).
  try {
    const { data: { session } } = await client.auth.getSession();
    if (session && session.access_token) client.realtime.setAuth(session.access_token);
  } catch (e) { console.warn('Realtime setAuth falló:', e); }

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

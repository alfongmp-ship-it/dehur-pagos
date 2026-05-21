import { state } from '../state.js';
import { notify } from '../ui/notify.js';
import { gsReadSheet, gsWriteRange, gsClearAndWrite, gsAppendRow } from './google-sheets.js';
import { normalizeBanco } from '../config/bancos.js';
import { SUB_PARTIDAS_CONSTRUCCION } from '../config/sub-partidas.js';

// ===== BLINDAJE CONTRA PÉRDIDA DE DATOS =====
// Entidades con función de guardado que sobrescribe su hoja completa.
const ENTIDADES_GUARDABLES = [
  'proveedores', 'empleados', 'historial', 'proyectos', 'facturas', 'facturaPagos',
  'cuentasPropias', 'traspasos', 'creditos', 'pagares', 'pagosPagare',
  'movimientosInternos', 'pendientesConfirmacion', 'unidades', 'presupuestoUnidad',
  'costoAsignaciones', 'partidasCatalogo'
];
const ETIQUETA = {
  proveedores: 'Proveedores', empleados: 'Empleados', historial: 'Historial de pagos',
  proyectos: 'Proyectos', facturas: 'Facturas', facturaPagos: 'Pagos de facturas',
  cuentasPropias: 'Cuentas propias', traspasos: 'Traspasos', creditos: 'Créditos',
  pagares: 'Pagarés', pagosPagare: 'Pagos de pagaré', movimientosInternos: 'Movimientos internos',
  pendientesConfirmacion: 'Pagos por confirmar', unidades: 'Unidades',
  presupuestoUnidad: 'Presupuestos', costoAsignaciones: 'Asignaciones de costo',
  partidasCatalogo: 'Catálogo de partidas'
};

// Lee una hoja y marca si la entidad cargó con éxito. `gsReadSheet` devuelve
// null SOLO ante error de lectura (una hoja vacía devuelve []), así que null
// marca la entidad como NO cargada y bloquea su guardado esta sesión.
async function leerHoja(sheet, entidad) {
  const rows = await gsReadSheet(sheet);
  state.cargado[entidad] = (rows !== null);
  return rows;
}

// Decide si se permite guardar una entidad. Bloquea si no se cargó esta sesión
// (evita sobrescribir la hoja con datos vacíos por una carga fallida) y pide
// confirmación si el guardado dejaría la hoja sin ningún registro.
function guardarPermitido(entidad, arr, puedeVaciarse = false) {
  if (state.cargado[entidad] !== true) {
    notify(`Guardado bloqueado: "${ETIQUETA[entidad] || entidad}" no se cargó correctamente esta sesión. Recarga la página antes de guardar.`, 'error');
    return false;
  }
  if (!puedeVaciarse && (!arr || arr.length === 0)) {
    return confirm(`Vas a guardar "${ETIQUETA[entidad] || entidad}" SIN NINGÚN registro.\n\nSi no es intencional, presiona Cancelar para no perder datos.\n\n¿Continuar de todos modos?`);
  }
  return true;
}

// Muestra u oculta el banner de advertencia según haya entidades sin cargar.
function actualizarBannerCarga() {
  const banner = document.getElementById('data-warning-banner');
  if (!banner) return;
  const fallos = ENTIDADES_GUARDABLES.filter(e => state.cargado[e] !== true);
  if (fallos.length) {
    banner.textContent = '⚠ No se cargaron correctamente: ' + fallos.map(e => ETIQUETA[e] || e).join(', ')
      + '. Recarga la página y vuelve a conectar. El guardado de esos datos está bloqueado por seguridad para no sobrescribirlos.';
    banner.style.display = '';
  } else {
    banner.style.display = 'none';
  }
}

export async function gsLoadAll() {
  state.cargado = {};
  try {
    // Load proveedores from Sheets (Sheets is source of truth)
    const pRows = await leerHoja('proveedores', 'proveedores');
    if (pRows && pRows.length > 1) {
      const loaded = pRows.slice(1).filter(r => r[0]).map(r => ({
        id: parseInt(r[0]) || 0,
        nombre: r[1] || '',
        rfc: r[2] || '',
        banco: normalizeBanco(r[3] || ''),
        tipo_cuenta: (r[6] || '').replace(/\D/g, '').length === 18 ? 'CLABE' : 'Cuenta',
        cuenta: r[5] || '',
        clabe: r[6] || '',
        categoria: r[7] || '',
        subcategoria: r[8] || '',
        proyectos: (r[9] || '').split('|').filter(Boolean),
        activo: r[10] !== 'FALSE' && r[10] !== 'false',
        bloqueada_para_pago: r[11] === 'TRUE' || r[11] === 'true',
        aliases: []
      }));
      if (loaded.length) {
        state.proveedores = loaded;
        document.getElementById('cnt-prov').textContent = loaded.length;
      }
    } else if (pRows !== null && state.proveedores.length) {
      await gsSaveProveedores();
    }

    // Load pendientes confirmacion
    const pcRows = await leerHoja('pendientes_confirmacion', 'pendientesConfirmacion');
    if (pcRows && pcRows.length > 1) {
      state.pendientesConfirmacion = pcRows.slice(1).filter(r => r[0]).map(r => ({
        id: parseInt(r[0]) || Date.now(),
        proveedor_id: r[1] || '',
        factura_id: r[2] || '',
        nombre: r[3] || '',
        cuenta: r[4] || '',
        banco: normalizeBanco(r[5] || ''),
        tipo: r[6] || '',
        concepto: r[7] || '',
        importe: parseFloat(r[8]) || 0,
        proyecto: r[9] || '',
        partida: r[10] || '',
        cuenta_cargo: r[11] || '',
        fechaGen: r[12] || '',
        confirmado: r[13] !== 'false',
        sub_partida: r[14] || ''
      }));
    }

    // Load empleados
    const eRows = await leerHoja('empleados', 'empleados');
    if (eRows && eRows.length > 1) {
      state.empleados = eRows.slice(1).filter(r => r[0]).map(r => ({
        id: parseInt(r[0]) || 0,
        nombre: r[1] || '',
        puesto: r[2] || '',
        empresa: r[3] || '',
        banco: r[4] || 'BBVA',
        tipo_cuenta: r[5] || '',
        cuenta: r[6] || '',
        clabe: r[7] || '',
        rfc: r[8] || '',
        activo: r[9] !== 'false'
      }));
    } else if (eRows !== null && state.empleados.length) {
      // Hoja vacía — auto-popular desde JSON seed
      await gsSaveEmpleados();
    }

    // Load historial
    const hRows = await leerHoja('historial_pagos', 'historial');
    if (hRows && hRows.length > 1) {
      state.historial = hRows.slice(1).filter(r => r[0] || r[2]).map(r => ({
        proveedor_id: r[0] || '',
        factura_id: r[1] || '',
        fecha: r[2] || '',
        nombre: r[3] || '',
        banco: normalizeBanco(r[4] || ''),
        tipo: r[5] || '',
        concepto: r[6] || '',
        importe: parseFloat(r[7]) || 0,
        proyecto: r[8] || '',
        cuenta_origen: r[9] || '',
        tipo_registro: r[10] || 'Pago',
        partida: r[11] || '',
        sub_partida: r[12] || '',
        id: r[13] || ''
      }));
      // Backfill de IDs estables para la capa de costos fiscales.
      // Si se asignó algún ID nuevo, se persiste una sola vez (migración idempotente).
      if (ensureHistorialIds()) {
        await gsSaveHistorial();
      }
    }

    // Load proyectos
    const prRows = await leerHoja('proyectos', 'proyectos');
    if (prRows && prRows.length > 1) {
      const loaded = prRows.slice(1).filter(r => r[0]).map(r => ({
        id: r[0] || '',
        nombre: r[1] || '',
        empresa: r[2] || '',
        cuenta: r[3] || '',
        clabe: r[4] || '',
        color: r[5] || '#C8A96E',
        activo: r[6] !== 'false',
        saldo: parseFloat(r[7]) || 0,
        ultima_act_saldo: r[8] || '',
        es_concentradora: String(r[9]).toLowerCase() === 'true'
      }));
      if (loaded.length) state.proyectos = loaded;
    }

    // Load aliases
    const aRows = await gsReadSheet('aliases');
    if (aRows && aRows.length > 1) {
      aRows.slice(1).filter(r => r[0]).forEach(r => {
        const prov = state.proveedores.find(p => p.id === parseInt(r[1]));
        if (prov) {
          if (!prov.aliases) prov.aliases = [];
          if (!prov.aliases.includes(r[0])) prov.aliases.push(r[0]);
        }
      });
    }

    // Load facturas
    const fRows = await leerHoja('facturas', 'facturas');
    if (fRows && fRows.length > 1) {
      state.facturas = fRows.slice(1).filter(r => r[0]).map(r => ({
        factura_id: parseInt(r[0]) || 0,
        numero_factura: r[1] || '',
        razon_social: r[2] || '',
        proveedor_id: parseInt(r[3]) || 0,
        nombre_proveedor: r[4] || '',
        fecha_factura: r[5] || '',
        fecha_vencimiento: r[6] || '',
        fecha_pago_total: r[7] || '',
        monto_total: parseFloat(String(r[8]).replace(/,/g, '')) || 0,
        monto_pagado: parseFloat(String(r[9]).replace(/,/g, '')) || 0,
        saldo_pendiente: (parseFloat(String(r[8]).replace(/,/g, '')) || 0) - (parseFloat(String(r[9]).replace(/,/g, '')) || 0),
        estatus_factura: r[11] || 'pendiente',
        proyecto: r[12] || '',
        observaciones: r[13] || '',
        activo: r[14] !== 'false',
        uuid: r[15] || ''
      }));
    }

    // Load cuentas_propias
    const cpRows = await leerHoja('cuentas_propias', 'cuentasPropias');
    if (cpRows && cpRows.length > 1) {
      state.cuentasPropias = cpRows.slice(1).filter(r => r[0]).map(r => ({
        cuenta_id: parseInt(r[0]) || 0,
        nombre: r[1] || '',
        banco: r[2] || '',
        clabe: r[3] || '',
        numero_cuenta: r[4] || '',
        proyecto: r[5] || '',
        tipo: r[6] || 'General',
        saldo: parseFloat(r[7]) || 0,
        ultima_actualizacion: r[8] || '',
        activo: r[9] !== 'false'
      }));
    }

    // Load historial_saldos
    const hsRows = await gsReadSheet('historial_saldos');
    if (hsRows && hsRows.length > 1) {
      state.historialSaldos = hsRows.slice(1).filter(r => r[0]).map(r => ({
        fecha: r[0] || '',
        cuenta_id: r[1] || '',
        cuenta_nombre: r[2] || '',
        cuenta_tipo: r[3] || '',
        saldo: parseFloat(r[4]) || 0,
        saldo_total: parseFloat(r[5]) || 0
      }));
    }

    // Load traspasos
    const tRows = await leerHoja('traspasos', 'traspasos');
    if (tRows && tRows.length > 1) {
      state.traspasos = tRows.slice(1).filter(r => r[0]).map(r => ({
        traspaso_id: parseInt(r[0]) || 0,
        tipo: r[1] || '',
        cuenta_origen_id: r[2] || '',
        cuenta_origen_tipo: r[3] || 'proyecto',
        cuenta_origen_nombre: r[4] || '',
        proyecto_origen: r[5] || '',
        cuenta_destino_id: r[6] || '',
        cuenta_destino_tipo: r[7] || 'proyecto',
        cuenta_destino_nombre: r[8] || '',
        proyecto_destino: r[9] || '',
        monto: parseFloat(r[10]) || 0,
        fecha: r[11] || '',
        concepto: r[12] || '',
        referencia: r[13] || '',
        estatus: r[14] || 'pendiente',
        fecha_registro: r[15] || ''
      }));
    }

    // Load creditos
    const crRows = await leerHoja('creditos', 'creditos');
    if (crRows && crRows.length > 1) {
      state.creditos = crRows.slice(1).filter(r => r[0]).map(r => ({
        credito_id: parseInt(r[0]) || 0,
        nombre: r[1] || '',
        banco: r[2] || '',
        tipo_credito: r[3] || 'Puente',
        monto_autorizado: parseFloat(r[4]) || 0,
        tasa_base: parseFloat(r[5]) || 0,
        proyecto: r[6] || '',
        cuenta_pago: r[7] || '',
        estatus: r[8] || 'Activo',
        activo: r[9] !== 'false'
      }));
    }

    // Load pagares
    const pgRows = await leerHoja('pagares', 'pagares');
    if (pgRows && pgRows.length > 1) {
      state.pagares = pgRows.slice(1).filter(r => r[0]).map(r => ({
        pagare_id: parseInt(r[0]) || 0,
        credito_id: parseInt(r[1]) || 0,
        numero_pagare: r[2] || '',
        monto: parseFloat(r[3]) || 0,
        fecha_disposicion: r[4] || '',
        fecha_vencimiento: r[5] || '',
        tasa: parseFloat(r[6]) || 0,
        estatus: r[7] || 'Vigente',
        activo: r[8] !== 'false'
      }));
    }

    // Load pagos_pagare
    const ppRows = await leerHoja('pagos_pagare', 'pagosPagare');
    if (ppRows && ppRows.length > 1) {
      state.pagosPagare = ppRows.slice(1).filter(r => r[0]).map(r => ({
        pago_id: parseInt(r[0]) || 0,
        pagare_id: parseInt(r[1]) || 0,
        credito_id: parseInt(r[2]) || 0,
        fecha_pago: r[3] || '',
        monto_intereses: parseFloat(r[4]) || 0,
        concepto: r[5] || '',
        estatus: r[6] || 'Pendiente',
        fecha_real_pago: r[7] || ''
      }));
    }

    // Load movimientos_internos
    const miRows = await leerHoja('movimientos_internos', 'movimientosInternos');
    if (miRows && miRows.length > 1) {
      state.movimientosInternos = miRows.slice(1).filter(r => r[0]).map(r => ({
        id: parseInt(r[0]) || 0,
        fecha: r[1] || '',
        tipo: r[2] || '',
        origen: r[3] || '',
        destino: r[4] || '',
        monto: parseFloat(r[5]) || 0,
        concepto: r[6] || '',
        referencia: r[7] || ''
      }));
    }

    // Load factura_pagos
    const fpRows = await leerHoja('factura_pagos', 'facturaPagos');
    if (fpRows && fpRows.length > 1) {
      state.facturaPagos = fpRows.slice(1).filter(r => r[0]).map(r => ({
        factura_pago_id: parseInt(r[0]) || 0,
        factura_id: parseInt(r[1]) || 0,
        pago_id: parseInt(r[2]) || 0,
        proveedor_id: parseInt(r[3]) || 0,
        monto_aplicado: parseFloat(r[4]) || 0,
        fecha_pago: r[5] || '',
        estatus: r[6] || '',
        observaciones: r[7] || ''
      }));
    }

    // Load unidades (costos fiscales)
    const uRows = await leerHoja('unidades', 'unidades');
    if (uRows && uRows.length > 1) {
      state.unidades = uRows.slice(1).filter(r => r[0]).map(r => ({
        unidad_id: parseInt(r[0]) || 0,
        proyecto: r[1] || '',
        nombre: r[2] || '',
        tipo: r[3] || '',
        indiviso_pct: parseFloat(r[4]) || 0,
        superficie_m2: parseFloat(r[5]) || 0,
        estatus: r[6] || 'En obra',
        orden: parseInt(r[7]) || 0,
        activo: r[8] !== 'false' && r[8] !== 'FALSE',
        plano_x: (r[9] === undefined || r[9] === '') ? null : parseFloat(r[9]),
        plano_y: (r[10] === undefined || r[10] === '') ? null : parseFloat(r[10]),
        plano_w: (r[11] === undefined || r[11] === '') ? null : parseFloat(r[11]),
        plano_h: (r[12] === undefined || r[12] === '') ? null : parseFloat(r[12])
      }));
      state.nextUnidadId = state.unidades.reduce((m, u) => Math.max(m, u.unidad_id), 0) + 1;
    }

    // Load presupuesto_unidad
    const buRows = await leerHoja('presupuesto_unidad', 'presupuestoUnidad');
    if (buRows && buRows.length > 1) {
      state.presupuestoUnidad = buRows.slice(1).filter(r => r[0]).map(r => ({
        presupuesto_id: parseInt(r[0]) || 0,
        unidad_id: parseInt(r[1]) || 0,
        partida: r[2] || '',
        sub_partida: r[3] || '',
        monto_presupuestado: parseFloat(r[4]) || 0,
        costo_inicial: parseFloat(r[5]) || 0,
        notas: r[6] || ''
      }));
      state.nextPresupuestoId = state.presupuestoUnidad.reduce((m, p) => Math.max(m, p.presupuesto_id), 0) + 1;
    }

    // Load costo_asignaciones
    const caRows = await leerHoja('costo_asignaciones', 'costoAsignaciones');
    if (caRows && caRows.length > 1) {
      state.costoAsignaciones = caRows.slice(1).filter(r => r[0]).map(r => ({
        asignacion_id: parseInt(r[0]) || 0,
        pago_id: r[1] || '',
        unidad_id: parseInt(r[2]) || 0,
        proyecto: r[3] || '',
        metodo: r[4] || 'directo',
        monto_asignado: parseFloat(r[5]) || 0,
        factor: parseFloat(r[6]) || 0,
        fecha_asignacion: r[7] || '',
        partida_override: r[8] || ''
      }));
      state.nextAsignacionId = state.costoAsignaciones.reduce((m, a) => Math.max(m, a.asignacion_id), 0) + 1;
    }

    // Load partidas_catalogo (catálogo editable de partidas y subpartidas)
    const pcatRows = await leerHoja('partidas_catalogo', 'partidasCatalogo');
    if (pcatRows && pcatRows.length > 1) {
      state.partidasCatalogo = pcatRows.slice(1).filter(r => r[0] || r[1]).map(r => ({
        id: r[0] || '',
        partida: r[1] || '',
        subpartidas: (r[2] || '').split('|').map(s => s.trim()).filter(Boolean),
        orden: parseInt(r[3]) || 0,
        activa: r[4] !== 'false' && r[4] !== 'FALSE' && r[4] !== false
      }));
    }
    // Migración: si la hoja está vacía, sembrar con partidas únicas del
    // historial + subpartidas hardcoded de CONSTRUCCION. Se ejecuta una vez.
    if (pcatRows !== null && (!state.partidasCatalogo || state.partidasCatalogo.length === 0)) {
      const partidasSet = new Set();
      state.historial.forEach(h => {
        const p = (h.partida || '').trim();
        if (p) partidasSet.add(p);
      });
      partidasSet.add('CONSTRUCCION');
      const slug = s => 'p_' + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) + '_' + Date.now();
      let orden = 0;
      state.partidasCatalogo = [...partidasSet].map(p => {
        orden++;
        const esConstr = p.toLowerCase() === 'construccion' || p.toLowerCase() === 'construcción';
        return {
          id: slug(p) + '_' + orden,
          partida: p,
          subpartidas: esConstr ? [...SUB_PARTIDAS_CONSTRUCCION] : [],
          orden,
          activa: true
        };
      });
      await gsSavePartidasCatalogo();
    }

    // Recalcular nextId con el máximo entre proveedores y empleados
    const maxProv = state.proveedores.reduce((max, p) => Math.max(max, p.id || 0), 0);
    const maxEmp = state.empleados.reduce((max, e) => Math.max(max, e.id || 0), 0);
    state.nextId = Math.max(maxProv, maxEmp, state.nextId || 0) + 1;

    // Re-render everything
    if (window.renderCreditos) window.renderCreditos();
    if (window.renderTraspasos) window.renderTraspasos();
    if (window.renderResumenTraspasos) window.renderResumenTraspasos();
    if (window.renderCuentasPropias) window.renderCuentasPropias();
    if (window.renderProveedores) window.renderProveedores();
    if (window.renderNomina) window.renderNomina();
    if (window.renderHistorial) window.renderHistorial();
    if (window.renderConfigProyectos) window.renderConfigProyectos();
    if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
    if (window.renderHeaderBadges) window.renderHeaderBadges();
    if (window.refreshProyectosEnSelects) window.refreshProyectosEnSelects();
    if (window.renderCostosFiscales) window.renderCostosFiscales();
    if (window.renderConfigPartidas) window.renderConfigPartidas();
    document.getElementById('cnt-hist').textContent = state.historial.length;
    document.getElementById('cnt-fact').textContent = state.facturas.length;
    document.getElementById('cnt-fp').textContent = state.facturaPagos.length;
  } catch (e) {
    console.error('gsLoadAll error', e);
    notify('Error cargando datos: ' + e.message, 'error');
  } finally {
    // Aviso visible si alguna hoja no cargó (y bloqueo de su guardado).
    actualizarBannerCarga();
  }
}

// Asigna un ID único y estable a cada registro del historial que no lo tenga.
// Nunca sobrescribe un ID existente -> garantiza estabilidad de referencias.
// Devuelve true si asignó al menos un ID nuevo.
export function ensureHistorialIds() {
  let maxId = 0;
  state.historial.forEach(h => {
    const n = parseInt(h.id, 10);
    if (!isNaN(n) && n > maxId) maxId = n;
  });
  if (maxId >= (state.histSeq || 1)) state.histSeq = maxId + 1;
  let changed = false;
  state.historial.forEach(h => {
    if (!h.id) { h.id = String(state.histSeq++); changed = true; }
  });
  return changed;
}

// Elimina las asignaciones de costo ligadas a un pago borrado (evita huérfanas).
export async function purgarAsignacionesDePago(pagoId) {
  if (!pagoId || !state.gsToken) return;
  const antes = state.costoAsignaciones.length;
  state.costoAsignaciones = state.costoAsignaciones.filter(a => String(a.pago_id) !== String(pagoId));
  if (state.costoAsignaciones.length !== antes) {
    await gsSaveCostoAsignaciones();
  }
}

export async function saveData(count = 1) {
  if (!state.gsToken) return;
  try {
    ensureHistorialIds();
    const n = Math.min(count, state.historial.length);
    for (let i = 0; i < n; i++) {
      const h = state.historial[i];
      await gsAppendRow('historial_pagos', [h.proveedor_id || '', h.factura_id || '', h.fecha, h.nombre, h.banco, h.tipo, h.concepto, h.importe, h.proyecto, h.cuenta_origen || '', h.tipo_registro || 'Pago', h.partida || '', h.sub_partida || '', h.id || '']);
    }
  } catch (e) { console.error('saveData error', e); }
}

const HS_HEADERS = ['fecha', 'cuenta_id', 'cuenta_nombre', 'cuenta_tipo', 'saldo', 'saldo_total'];
let hsHeadersOk = false;

export async function gsAppendHistorialSaldo(registro) {
  if (!state.gsToken) return;
  try {
    if (!hsHeadersOk) {
      const rows = await gsReadSheet('historial_saldos');
      if (!rows || !rows.length || rows[0][0] !== 'fecha') {
        await gsWriteRange('historial_saldos!A1', [HS_HEADERS]);
      }
      hsHeadersOk = true;
    }
    await gsAppendRow('historial_saldos', [
      registro.fecha, registro.cuenta_id, registro.cuenta_nombre,
      registro.cuenta_tipo, registro.saldo, registro.saldo_total
    ]);
  } catch (e) { console.error('gsAppendHistorialSaldo', e); }
}

export async function gsSavePendientes() {
  if (!state.gsToken) return;
  // Los pagos por confirmar se vacían de forma normal al confirmar la cola.
  if (!guardarPermitido('pendientesConfirmacion', state.pendientesConfirmacion, true)) return;
  try {
    const rows = state.pendientesConfirmacion.map(p => [
      p.id, p.proveedor_id || '', p.factura_id || '', p.nombre, p.cuenta || '',
      p.banco, p.tipo, p.concepto, p.importe, p.proyecto, p.partida || '',
      p.cuenta_cargo || '', p.fechaGen || '', p.confirmado, p.sub_partida || ''
    ]);
    await gsClearAndWrite('pendientes_confirmacion', rows, [
      'id', 'proveedor_id', 'factura_id', 'nombre', 'cuenta', 'banco',
      'tipo', 'concepto', 'importe', 'proyecto', 'partida', 'cuenta_cargo',
      'fechaGen', 'confirmado', 'sub_partida'
    ]);
  } catch (e) { console.error('gsSavePendientes', e); }
}

export async function gsSaveHistorial() {
  if (!state.gsToken) return;
  if (!guardarPermitido('historial', state.historial, true)) return;
  // Salvaguarda: nunca sobrescribir el historial con cero filas (evita vaciarlo
  // por accidente si el estado en memoria está vacío).
  if (!state.historial.length) return;
  try {
    ensureHistorialIds();
    const rows = state.historial.map(h => [
      h.proveedor_id || '', h.factura_id || '', h.fecha, h.nombre, h.banco,
      h.tipo, h.concepto, h.importe, h.proyecto, h.cuenta_origen || '',
      h.tipo_registro || 'Pago', h.partida || '', h.sub_partida || '', h.id || ''
    ]);
    await gsClearAndWrite('historial_pagos', rows, [
      'proveedor_id', 'factura_id', 'fecha', 'nombre', 'banco',
      'tipo', 'concepto', 'importe', 'proyecto', 'cuenta_origen',
      'tipo_registro', 'partida', 'sub_partida', 'id'
    ]);
  } catch (e) { console.error('gsSaveHistorial', e); }
}

export async function gsSaveUnidades() {
  if (!state.gsToken) return;
  if (!guardarPermitido('unidades', state.unidades)) return;
  try {
    const rows = state.unidades.map(u => [
      u.unidad_id, u.proyecto, u.nombre, u.tipo || '', u.indiviso_pct || 0,
      u.superficie_m2 || 0, u.estatus || 'En obra', u.orden || 0, u.activo,
      u.plano_x == null ? '' : u.plano_x, u.plano_y == null ? '' : u.plano_y,
      u.plano_w == null ? '' : u.plano_w, u.plano_h == null ? '' : u.plano_h
    ]);
    await gsClearAndWrite('unidades', rows, [
      'unidad_id', 'proyecto', 'nombre', 'tipo', 'indiviso_pct',
      'superficie_m2', 'estatus', 'orden', 'activo', 'plano_x', 'plano_y',
      'plano_w', 'plano_h'
    ]);
  } catch (e) { console.error('gsSaveUnidades', e); }
}

export async function gsSavePresupuestoUnidad() {
  if (!state.gsToken) return;
  if (!guardarPermitido('presupuestoUnidad', state.presupuestoUnidad)) return;
  try {
    const rows = state.presupuestoUnidad.map(p => [
      p.presupuesto_id, p.unidad_id, p.partida || '', p.sub_partida || '',
      p.monto_presupuestado || 0, p.costo_inicial || 0, p.notas || ''
    ]);
    await gsClearAndWrite('presupuesto_unidad', rows, [
      'presupuesto_id', 'unidad_id', 'partida', 'sub_partida',
      'monto_presupuestado', 'costo_inicial', 'notas'
    ]);
  } catch (e) { console.error('gsSavePresupuestoUnidad', e); }
}

export async function gsSaveCostoAsignaciones() {
  if (!state.gsToken) return;
  if (!guardarPermitido('costoAsignaciones', state.costoAsignaciones)) return;
  try {
    const rows = state.costoAsignaciones.map(a => [
      a.asignacion_id, a.pago_id, a.unidad_id, a.proyecto || '', a.metodo || 'directo',
      a.monto_asignado || 0, a.factor || 0, a.fecha_asignacion || '', a.partida_override || ''
    ]);
    await gsClearAndWrite('costo_asignaciones', rows, [
      'asignacion_id', 'pago_id', 'unidad_id', 'proyecto', 'metodo',
      'monto_asignado', 'factor', 'fecha_asignacion', 'partida_override'
    ]);
  } catch (e) { console.error('gsSaveCostoAsignaciones', e); }
}

export async function gsSaveProveedores() {
  if (!state.gsToken) return;
  if (!guardarPermitido('proveedores', state.proveedores)) return;
  try {
    const rows = state.proveedores.map(p => [p.id, p.nombre, p.rfc || '', p.banco, p.tipo_cuenta, p.cuenta, p.clabe || '', p.categoria, p.subcategoria || '', (p.proyectos || []).join('|'), p.activo, p.bloqueada_para_pago || false]);
    await gsClearAndWrite('proveedores', rows, ['proveedor_id', 'nombre', 'rfc', 'banco', 'tipo_cuenta', 'cuenta', 'clabe', 'categoria', 'Subcategoria', 'proyectos', 'activo', 'bloqueada_para_pago']);
    notify('✅ Proveedores guardados en Sheets');
  } catch (e) { notify('Error guardando proveedores: ' + e.message, 'error'); }
}

export async function gsSaveAlias(nombreOriginal, provId) {
  if (!state.gsToken) return;
  try {
    const fecha = new Date().toISOString().split('T')[0];
    await gsAppendRow('aliases', [nombreOriginal, provId, fecha]);
  } catch (e) { console.error('gsSaveAlias error', e); }
}

export async function gsSaveEmpleados() {
  if (!state.gsToken) return;
  if (!guardarPermitido('empleados', state.empleados)) return;
  try {
    const rows = state.empleados.map(e => [e.id, e.nombre, e.puesto || '', e.empresa || '', e.banco, e.tipo_cuenta, e.cuenta, e.clabe || '', e.rfc || '', e.activo]);
    await gsClearAndWrite('empleados', rows, ['id', 'nombre', 'puesto', 'empresa', 'banco', 'tipo_cuenta', 'cuenta', 'clabe', 'rfc', 'activo']);
    notify('✅ Empleados guardados en Sheets');
  } catch (e) { console.error('gsSaveEmpleados', e); }
}

export async function gsSaveFacturas() {
  if (!state.gsToken) return;
  if (!guardarPermitido('facturas', state.facturas)) return;
  try {
    const rows = state.facturas.map(f => [f.factura_id, f.numero_factura || '', f.razon_social || '', f.proveedor_id, f.nombre_proveedor || '', f.fecha_factura, f.fecha_vencimiento || '', f.fecha_pago_total || '', f.monto_total, f.monto_pagado, f.saldo_pendiente, f.estatus_factura, f.proyecto, f.observaciones, f.activo, f.uuid || '']);
    await gsClearAndWrite('facturas', rows, ['factura_id', 'Numero_Fcatura', 'razon_social', 'proveedor_id', 'nombre_proveedor', 'fecha_factura', 'fecha_vencimiento', 'fecha_pago_total', 'monto_total', 'monto_pagado', 'saldo_pendiente', 'estatus_factura', 'proyecto', 'observaciones', 'activo', 'uuid']);
  } catch (e) { console.error('gsSaveFacturas', e); }
}

export async function gsSaveFacturaPagos() {
  if (!state.gsToken) return;
  if (!guardarPermitido('facturaPagos', state.facturaPagos)) return;
  try {
    const rows = state.facturaPagos.map(fp => [fp.factura_pago_id, fp.factura_id, fp.pago_id, fp.proveedor_id, fp.monto_aplicado, fp.fecha_pago, fp.estatus, fp.observaciones]);
    await gsClearAndWrite('factura_pagos', rows, ['factura_pago_id', 'factura_id', 'pago_id', 'proveedor_id', 'monto_aplicado', 'fecha_pago', 'estatus', 'observaciones']);
  } catch (e) { console.error('gsSaveFacturaPagos', e); }
}

export async function gsSaveCuentasPropias() {
  if (!state.gsToken) return;
  if (!guardarPermitido('cuentasPropias', state.cuentasPropias)) return;
  try {
    const rows = state.cuentasPropias.map(c => [c.cuenta_id, c.nombre, c.banco, c.clabe || '', c.numero_cuenta || '', c.proyecto || '', c.tipo || 'General', c.saldo, c.ultima_actualizacion || '', c.activo]);
    await gsClearAndWrite('cuentas_propias', rows, ['cuenta_id', 'nombre', 'banco', 'clabe', 'numero_cuenta', 'proyecto', 'tipo', 'saldo', 'ultima_actualizacion', 'activo']);
  } catch (e) { console.error('gsSaveCuentasPropias', e); }
}

export async function gsSaveTraspasos() {
  if (!state.gsToken) return;
  if (!guardarPermitido('traspasos', state.traspasos)) return;
  try {
    const rows = state.traspasos.map(t => [
      t.traspaso_id, t.tipo,
      t.cuenta_origen_id, t.cuenta_origen_tipo, t.cuenta_origen_nombre, t.proyecto_origen,
      t.cuenta_destino_id, t.cuenta_destino_tipo, t.cuenta_destino_nombre, t.proyecto_destino,
      t.monto, t.fecha, t.concepto, t.referencia, t.estatus, t.fecha_registro
    ]);
    await gsClearAndWrite('traspasos', rows, [
      'traspaso_id', 'tipo',
      'cuenta_origen_id', 'cuenta_origen_tipo', 'cuenta_origen_nombre', 'proyecto_origen',
      'cuenta_destino_id', 'cuenta_destino_tipo', 'cuenta_destino_nombre', 'proyecto_destino',
      'monto', 'fecha', 'concepto', 'referencia', 'estatus', 'fecha_registro'
    ]);
  } catch (e) { console.error('gsSaveTraspasos', e); }
}

export async function gsSaveCreditos() {
  if (!state.gsToken) return;
  if (!guardarPermitido('creditos', state.creditos)) return;
  try {
    const rows = state.creditos.map(c => [
      c.credito_id, c.nombre, c.banco, c.tipo_credito, c.monto_autorizado,
      c.tasa_base, c.proyecto || '', c.cuenta_pago || '', c.estatus, c.activo
    ]);
    await gsClearAndWrite('creditos', rows, [
      'credito_id', 'nombre', 'banco', 'tipo_credito', 'monto_autorizado',
      'tasa_base', 'proyecto', 'cuenta_pago', 'estatus', 'activo'
    ]);
  } catch (e) { console.error('gsSaveCreditos', e); }
}

export async function gsSavePagares() {
  if (!state.gsToken) return;
  if (!guardarPermitido('pagares', state.pagares)) return;
  try {
    const rows = state.pagares.map(p => [
      p.pagare_id, p.credito_id, p.numero_pagare, p.monto,
      p.fecha_disposicion, p.fecha_vencimiento, p.tasa, p.estatus, p.activo
    ]);
    await gsClearAndWrite('pagares', rows, [
      'pagare_id', 'credito_id', 'numero_pagare', 'monto',
      'fecha_disposicion', 'fecha_vencimiento', 'tasa', 'estatus', 'activo'
    ]);
  } catch (e) { console.error('gsSavePagares', e); }
}

export async function gsSavePagosPagare() {
  if (!state.gsToken) return;
  if (!guardarPermitido('pagosPagare', state.pagosPagare)) return;
  try {
    const rows = state.pagosPagare.map(p => [
      p.pago_id, p.pagare_id, p.credito_id, p.fecha_pago,
      p.monto_intereses, p.concepto || '', p.estatus, p.fecha_real_pago || ''
    ]);
    await gsClearAndWrite('pagos_pagare', rows, [
      'pago_id', 'pagare_id', 'credito_id', 'fecha_pago',
      'monto_intereses', 'concepto', 'estatus', 'fecha_real_pago'
    ]);
  } catch (e) { console.error('gsSavePagosPagare', e); }
}

export async function gsSaveMovimientosInternos() {
  if (!state.gsToken) return;
  if (!guardarPermitido('movimientosInternos', state.movimientosInternos)) return;
  const rows = state.movimientosInternos.map(m => [m.id, m.fecha, m.tipo, m.origen, m.destino, m.monto, m.concepto, m.referencia]);
  await gsClearAndWrite('movimientos_internos', rows, ['id', 'fecha', 'tipo', 'origen', 'destino', 'monto', 'concepto', 'referencia']);
}

export async function gsSavePartidasCatalogo() {
  if (!state.gsToken) return;
  if (!guardarPermitido('partidasCatalogo', state.partidasCatalogo, true)) return;
  try {
    const rows = state.partidasCatalogo.map(p => [
      p.id || '', p.partida || '', (p.subpartidas || []).join('|'),
      p.orden || 0, p.activa === false ? 'false' : 'true'
    ]);
    await gsClearAndWrite('partidas_catalogo', rows, ['partida_id', 'partida', 'subpartidas', 'orden', 'activa']);
  } catch (e) { console.error('gsSavePartidasCatalogo', e); }
}

export async function gsSaveProyectos() {
  if (!state.gsToken) return;
  if (!guardarPermitido('proyectos', state.proyectos)) return;
  try {
    const rows = state.proyectos.map(p => [p.id, p.nombre, p.empresa || '', p.cuenta || '', p.clabe || '', p.color || '', p.activo, p.saldo || 0, p.ultima_act_saldo || '', p.es_concentradora || false]);
    await gsClearAndWrite('proyectos', rows, ['id', 'nombre', 'empresa', 'cuenta', 'clabe', 'color', 'activo', 'saldo', 'ultima_act_saldo', 'es_concentradora']);
    notify('✅ Proyectos guardados en Sheets');
  } catch (e) { console.error('gsSaveProyectos', e); }
}

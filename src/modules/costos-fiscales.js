// ===== COSTOS FISCALES POR UNIDAD =====
// Capa nueva y aislada: asigna los pagos del historial a unidades (casas)
// para conocer el costo real por casa. No toca el flujo de pagos existente.

import { state, datosListos, puedeEditar, puedeLigarPagos, puedeFacturas, puedeCapturarObra } from '../state.js';
import { fmt, fmtFecha, escapeHtml } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { proyectoMatch } from '../config/proyectos.js';
import { ESTATUS_UNIDAD, METODO_LABEL, unidadEnIndivisoAFecha } from '../config/costos-fiscales.js';
import { chartTheme } from '../ui/chart-theme.js';
import { planoDeProyecto } from '../config/planos.js';
import { parseFechaHist } from './historial.js';
import { gsSaveUnidades, gsSavePresupuestoUnidad, gsSaveCostoAsignaciones, esPorFila, sbGuardarFila } from '../services/google-sync.js';
import { nuevoAsignacionId } from '../state.js';
import { auditarRepartos, aplicarReparacionRepartos } from './confirmar-pagos.js';
import { aplicarPagoAFactura, restantePago } from './facturas.js';

const PALETA = ['#c8a96e', '#5a9be0', '#4caf7d', '#e07a3a', '#9b7fe8', '#e05a5a', '#27ae60', '#3498db'];

let cfProyecto = '';        // proyecto activo
let cfTab = 'unidades';     // sub-pestaña: unidades | asignar | presupuestos | reportes
let cfUnidadDetalle = null; // unidad_id seleccionada en presupuestos/reportes
let cfPagoAsignar = null;   // pago_id en proceso de asignación
let cfFacturaAsignar = null; // factura_id en proceso de reparto (devengado)
let cfFacturaRestante = 0;   // monto que falta por repartir de la factura (reparto por partes/sub-partidas)
let cfMostrarEstimado = false; // toggle: ver estimado por indiviso de pagos sin asignar (SOLO display)
let cfCustomModo = 'pct';   // método Personalizado: 'pct' (%) | 'monto' ($). Default %.
let cfChartUnidad = null;
let cfPlanoModo = 'vista';      // 'vista' | 'editor'
let cfPlanoColor = 'avance';     // 'avance' | 'estatus'
let cfPlanoEditMode = 'pines';   // 'pines' | 'zonas'  — solo en modo editor

const ESTATUS_COLOR = {
  'En obra': '#e07a3a',
  'Terminada': '#5a9be0',
  'Entregada': '#4caf7d',
  'Vendida': '#9b7fe8',
};

// ---------- utilidades ----------
function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

function unidadesDeProyecto(incluirInactivas = false) {
  return state.unidades
    .filter(u => u.proyecto === cfProyecto && (incluirInactivas || u.activo !== false))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.unidad_id - b.unidad_id);
}

function unidadById(id) { return state.unidades.find(u => u.unidad_id === id); }

function historialIdSet() { return new Set(state.historial.map(h => h.id).filter(Boolean)); }

function pagoById(id) { return state.historial.find(h => String(h.id) === String(id)); }
function facturaById(id) { return state.facturas.find(f => String(f.factura_id) === String(id)); }

// El modal de reparto sirve a un PAGO (cfPagoAsignar) o a una FACTURA (cfFacturaAsignar,
// devengado sobre su monto_total). Estos helpers aíslan la diferencia.
function cfEsFactura() { return cfFacturaAsignar != null; }
function cfImporteObjetivo() {
  if (cfEsFactura()) {
    const f = facturaById(cfFacturaAsignar); if (!f) return 0;
    // Reparto POR PARTES: si existe el input "monto de esta parte", se reparte SOLO esa
    // parte (para partir una factura entre sub-partidas). Si no, el total de la factura.
    const parteEl = document.getElementById('rf-monto-parte');
    if (parteEl) { const v = parseFloat(parteEl.value); return (isFinite(v) && v > 0) ? r2(v) : (cfFacturaRestante || 0); }
    return f.monto_total || 0;
  }
  const p = pagoById(cfPagoAsignar); return p ? (p.importe || 0) : 0;
}
// Fecha (ISO) del documento que se reparte (factura o pago). El indiviso solo usa las casas
// que seguían en obra a esa fecha (ver unidadEnIndivisoAFecha).
function cfFechaObjetivo() {
  if (cfEsFactura()) { const f = facturaById(cfFacturaAsignar); return f ? parseFechaHist(f.fecha_factura) : ''; }
  const p = pagoById(cfPagoAsignar); return p ? parseFechaHist(p.fecha) : '';
}
function cfObjetivoValido() {
  return cfEsFactura() ? !!facturaById(cfFacturaAsignar) : !!pagoById(cfPagoAsignar);
}

// Catálogo ADMIN activo (partida + sub-partidas): la ÚNICA taxonomía del sistema
// — presupuesto, facturas y pagos usan estas mismas etiquetas (Control de Obra v2).
function _catAdminActivas() {
  return (state.partidasCatalogo || []).filter(p => p.activa !== false);
}
function _subsAdminDe(partida) {
  const cat = _catAdminActivas().find(p => p.partida === partida);
  return (cat && Array.isArray(cat.subpartidas)) ? cat.subpartidas : [];
}

function partidaDeAsignacion(a) {
  if (a.partida_override) return a.partida_override;
  const p = pagoById(a.pago_id);
  return (p && p.partida) || 'Sin partida';
}

// ---------- cálculos ----------
function asignacionesDeUnidad(unidadId) {
  return state.costoAsignaciones.filter(a => a.unidad_id === unidadId);
}

// ===== Devengado vs Pagado-sin-factura =====
// Una asignación de FACTURA (factura_id lleno) = DEVENGADO (salvo factura Cancelada).
// Una asignación de PAGO (pago_id) = PAGADO. El reparto del pago SOLO se suprime (para no
// duplicar) cuando su costo YA lo aporta el devengado de la factura, es decir cuando esa
// factura está REPARTIDA (tiene asignaciones propias) y NO está cancelada. Un pago con
// factura_id cuya factura no está repartida (o está cancelada) SIGUE contando como
// 'pagado': de lo contrario su costo desaparecería del reporte aunque el reparto exista.
function _facturasRepartidasSet() {
  return new Set(state.costoAsignaciones.filter(a => a.factura_id).map(a => String(a.factura_id)));
}
function _facturasCanceladasSet() {
  return new Set((state.facturas || []).filter(f => f.estado_sat === 'Cancelada').map(f => String(f.factura_id)));
}
// Pagos cuyo costo ya cubre el devengado de su factura → no se recuentan (evita DOBLE conteo).
// Cubre dos vías: el marcador directo del pago (h.factura_id) y las facturas a las que el pago se
// aplicó POR PARTES (facturaPagos). Basta que ALGUNA factura ligada esté repartida y no cancelada.
// Trade-off elegido a favor de NUNCA duplicar: si un pago se aplica a una factura repartida Y a
// otra que aún NO se reparte, se suprime completo → la parte de la factura sin repartir aporta su
// costo por su DEVENGADO (0 hasta que la repartas). O sea puede subcontar TEMPORALMENTE, nunca
// sobrecontar; se corrige repartiendo cada factura ligada.
function _pagosCubiertosPorFacturaSet() {
  const repartidas = _facturasRepartidasSet();
  const canceladas = _facturasCanceladasSet();
  const cubierta = fid => fid != null && String(fid) !== '' && repartidas.has(String(fid)) && !canceladas.has(String(fid));
  const set = new Set();
  state.historial.forEach(h => { if (cubierta(h.factura_id)) set.add(String(h.id)); });
  (state.facturaPagos || []).forEach(fp => { if (String(fp.pago_id || '') !== '' && cubierta(fp.factura_id)) set.add(String(fp.pago_id)); });
  return set;
}
// Facturas ligadas a un pago (ambas vías: bandera h.factura_id + aplicaciones por
// partes en facturaPagos). Set de factura_ids como String.
function _facturasLigadasAPago(h) {
  const set = new Set();
  if (h.factura_id != null && String(h.factura_id) !== '') set.add(String(h.factura_id));
  (state.facturaPagos || []).forEach(fp => {
    if (String(fp.pago_id || '') === String(h.id)) set.add(String(fp.factura_id));
  });
  return set;
}
// Sets de factura_ids / pago_ids que EXISTEN (o null si esa tabla aún no cargó con datos, para
// NO vaciar el reporte en una carga parcial). Sirven para no contar asignaciones huérfanas.
function _factExistSet() { return (state.facturas && state.facturas.length) ? new Set(state.facturas.map(f => String(f.factura_id))) : null; }
function _pagoExistSet() { return (state.historial && state.historial.length) ? new Set(state.historial.map(h => String(h.id))) : null; }
// ===== Capital de crédito ≠ costo =====
// Regla fiscal: de las filas tipo_registro='Crédito' SOLO los INTERESES son costo
// (partida que contenga "interes", sin acentos/mayúsculas). El CAPITAL (p.ej.
// partida "Pago de Deuda") es devolución de deuda: JAMÁS cuenta ni se reparte a
// unidades. Misma convención que _cuentaJP del Reporte JP (resumen-costos.js).
const _normPartCap = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function _esCreditoNoInteres(h) {
  return h.tipo_registro === 'Crédito' && !_normPartCap(h.partida).includes('interes');
}
// Ids de pagos de CAPITAL: sus asignaciones (si alguna existiera) dejan de contar.
function _pagosCapitalSet() {
  const set = new Set();
  state.historial.forEach(h => { if (h.id && _esCreditoNoInteres(h)) set.add(String(h.id)); });
  return set;
}
// 'devengado' | 'pagado' | null. null = no cuenta: factura cancelada, pago ya cubierto por su
// factura repartida, o HUÉRFANA (su factura/pago ya no existe). Las huérfanas NO se borran (para
// no perder reparto válido en edición simultánea), solo se dejan de contar → no inflan el costo.
function _tipoAsignacion(a, pagosCubiertos, factCanceladas, factExist, pagoExist, pagosCapital) {
  if (a.factura_id) {
    if (factExist && !factExist.has(String(a.factura_id))) return null; // huérfana: su factura ya no existe
    return factCanceladas.has(String(a.factura_id)) ? null : 'devengado';
  }
  if (pagoExist && !pagoExist.has(String(a.pago_id))) return null; // huérfana: su pago ya no existe
  if (pagosCapital && pagosCapital.has(String(a.pago_id))) return null; // capital de crédito: deuda, jamás costo
  return pagosCubiertos.has(String(a.pago_id)) ? null : 'pagado';
}

// Devuelve { devengado, pagadoSinFactura, total } de una unidad.
function costoAsignadoDesglose(unidadId) {
  const pcf = _pagosCubiertosPorFacturaSet();
  const fc = _facturasCanceladasSet();
  const fe = _factExistSet(); const pe = _pagoExistSet();
  const pcap = _pagosCapitalSet();
  let devengado = 0, pagadoSinFactura = 0;
  asignacionesDeUnidad(unidadId).forEach(a => {
    const t = _tipoAsignacion(a, pcf, fc, fe, pe, pcap);
    if (t === 'devengado') devengado += a.monto_asignado || 0;
    else if (t === 'pagado') pagadoSinFactura += a.monto_asignado || 0;
  });
  return { devengado, pagadoSinFactura, total: devengado + pagadoSinFactura };
}

function costoAsignadoUnidad(unidadId) {
  return costoAsignadoDesglose(unidadId).total;
}

function presupuestoRowsUnidad(unidadId) {
  return state.presupuestoUnidad.filter(p => p.unidad_id === unidadId);
}

function presupuestoTotalUnidad(unidadId) {
  return presupuestoRowsUnidad(unidadId).reduce((s, p) => s + (p.monto_presupuestado || 0), 0);
}

function costoInicialUnidad(unidadId) {
  return presupuestoRowsUnidad(unidadId).reduce((s, p) => s + (p.costo_inicial || 0), 0);
}

function costoRealUnidad(unidadId) {
  return costoInicialUnidad(unidadId) + costoAsignadoUnidad(unidadId);
}

function avancePct(real, presupuesto) {
  if (!presupuesto || presupuesto <= 0) return null;
  return (real / presupuesto) * 100;
}

// ===== ESTRATEGIA (Fase 2) — lectura BATCH para el tablero =====
// Costo real / presupuesto / avance de TODAS las unidades en UNA pasada. Los
// helpers de arriba reconstruyen los Sets por llamada (cuadrático si se llaman
// en bucle); aquí se construyen UNA vez y se reusa la MISMA regla
// _tipoAsignacion (devengado vs pagado, supresión por factura repartida,
// huérfanas) → el tablero cuadra con lo que muestra Costos por Unidad.
// SOLO LECTURA: no muta nada. Devuelve Map<String(unidad_id), {real, presupuesto, avance}>.
export function costosPresupuestosBatch() {
  const pcf = _pagosCubiertosPorFacturaSet();
  const fc = _facturasCanceladasSet();
  const fe = _factExistSet(); const pe = _pagoExistSet();
  const pcap = _pagosCapitalSet();
  const asignado = new Map();
  state.costoAsignaciones.forEach(a => {
    const t = _tipoAsignacion(a, pcf, fc, fe, pe, pcap);
    if (!t) return;
    const k = String(a.unidad_id);
    asignado.set(k, (asignado.get(k) || 0) + (a.monto_asignado || 0));
  });
  const presu = new Map();
  state.presupuestoUnidad.forEach(p => {
    const k = String(p.unidad_id);
    const acc = presu.get(k) || { presupuesto: 0, costoInicial: 0 };
    acc.presupuesto += p.monto_presupuestado || 0;
    acc.costoInicial += p.costo_inicial || 0;
    presu.set(k, acc);
  });
  const out = new Map();
  state.unidades.forEach(u => {
    const k = String(u.unidad_id);
    const pr = presu.get(k) || { presupuesto: 0, costoInicial: 0 };
    const real = pr.costoInicial + (asignado.get(k) || 0);
    out.set(k, { real, presupuesto: pr.presupuesto, avance: avancePct(real, pr.presupuesto) });
  });
  return out;
}

// ===== Control de Obra: presupuesto vs costo real por partida+sub ADMIN =====
// UNA pasada para TODAS las unidades del proyecto (los 5 Sets se construyen una
// sola vez — patrón batch obligatorio; jamás llamar esto en bucle por unidad).
// Llave = norm(partida)+'|'+norm(sub). Devuelve:
//   porUnidad: Map<String(unidad_id), Map<llave, fila>>
//   totales:   Map<llave, fila>   (todo el proyecto)
//   etiquetas: Map<llave, {partida, sub}>   (texto para mostrar)
// fila = { presupuestado, costoInicial, devengado, pagadoSinFactura, asignado, real, avanceFisico }
export function desgloseAdminBatch(proyecto) {
  const uids = new Set(state.unidades
    .filter(u => u.activo !== false && proyectoMatch(u.proyecto, proyecto))
    .map(u => String(u.unidad_id)));
  const pcf = _pagosCubiertosPorFacturaSet();
  const fc = _facturasCanceladasSet();
  const fe = _factExistSet(); const pe = _pagoExistSet();
  const pcap = _pagosCapitalSet();
  const porUnidad = new Map(); const totales = new Map(); const etiquetas = new Map();
  const filaDe = (mapa, k) => {
    let f = mapa.get(k);
    if (!f) { f = { presupuestado: 0, costoInicial: 0, devengado: 0, pagadoSinFactura: 0, asignado: 0, real: 0, avanceFisico: 0 }; mapa.set(k, f); }
    return f;
  };
  const reg = (uid, partida, sub, cb) => {
    const k = _normPartCap(partida) + '|' + _normPartCap(sub);
    if (!etiquetas.has(k)) etiquetas.set(k, { partida: (partida || '').trim() || 'Sin partida', sub: (sub || '').trim() });
    let mU = porUnidad.get(uid);
    if (!mU) { mU = new Map(); porUnidad.set(uid, mU); }
    cb(filaDe(mU, k)); cb(filaDe(totales, k));
  };
  // Lado PRESUPUESTO (una fila por llave por unidad tras el merge del grid).
  state.presupuestoUnidad.forEach(p => {
    const uid = String(p.unidad_id);
    if (!uids.has(uid)) return;
    reg(uid, p.partida, p.sub_partida, f => {
      f.presupuestado += p.monto_presupuestado || 0;
      f.costoInicial += p.costo_inicial || 0;
      f.avanceFisico = p.avance_fisico || 0;   // % físico capturado en esa fila (F4)
    });
  });
  // Lado COSTO REAL: misma regla canónica de siempre (_tipoAsignacion).
  state.costoAsignaciones.forEach(a => {
    const uid = String(a.unidad_id);
    if (!uids.has(uid)) return;
    const t = _tipoAsignacion(a, pcf, fc, fe, pe, pcap);
    if (!t) return;
    const p = pagoById(a.pago_id);
    const partida = a.partida_override || (p && p.partida) || '';
    const sub = a.sub_partida_override || (p && p.sub_partida) || '';
    reg(uid, partida, sub, f => {
      if (t === 'devengado') f.devengado += a.monto_asignado || 0;
      else f.pagadoSinFactura += a.monto_asignado || 0;
      f.asignado += a.monto_asignado || 0;
    });
  });
  porUnidad.forEach(m => m.forEach(f => { f.real = f.costoInicial + f.asignado; }));
  totales.forEach(f => { f.real = f.costoInicial + f.asignado; });
  return { porUnidad, totales, etiquetas };
}

// Devuelve { partida: {presupuestado, costoInicial, devengado, pagadoSinFactura, asignado, real} }
function desglosePorPartida(unidadId) {
  const out = {};
  const get = k => (out[k] = out[k] || { presupuestado: 0, costoInicial: 0, devengado: 0, pagadoSinFactura: 0, asignado: 0, real: 0 });
  presupuestoRowsUnidad(unidadId).forEach(p => {
    const k = p.partida || 'Sin partida';
    get(k).presupuestado += p.monto_presupuestado || 0;
    get(k).costoInicial += p.costo_inicial || 0;
  });
  const pcf = _pagosCubiertosPorFacturaSet();
  const fc = _facturasCanceladasSet();
  const fe = _factExistSet(); const pe = _pagoExistSet();
  const pcap = _pagosCapitalSet();
  asignacionesDeUnidad(unidadId).forEach(a => {
    const t = _tipoAsignacion(a, pcf, fc, fe, pe, pcap);
    if (!t) return; // no cuenta (doble conteo evitado, cancelada, huérfana o capital)
    const row = get(partidaDeAsignacion(a));
    if (t === 'devengado') row.devengado += a.monto_asignado || 0;
    else row.pagadoSinFactura += a.monto_asignado || 0;
    row.asignado += a.monto_asignado || 0;
  });
  Object.values(out).forEach(v => { v.real = v.costoInicial + v.asignado; });
  return out;
}

// Un movimiento del historial cuenta como costo asignable a unidades.
// Se EXCLUYEN: los Traspasos internos y Préstamos entre proyectos (no son costo
// de construcción) y el CAPITAL de crédito (Crédito sin partida de intereses —
// es pago de deuda, fiscalmente no es costo). Sí cuentan: Pagos, Aportaciones y
// los INTERESES de crédito.
function esCostoAsignable(h) {
  if (h.tipo_registro === 'Traspaso' && h.tipo !== 'Aportación') return false;
  if (_esCreditoNoInteres(h)) return false;
  return true;
}

function pagosSinAsignar() {
  const asignados = new Set(state.costoAsignaciones.map(a => String(a.pago_id)));
  return state.historial.filter(h =>
    esCostoAsignable(h) && h.id &&
    proyectoMatch(h.proyecto, cfProyecto) &&
    !asignados.has(String(h.id))
  );
}

function pagosAsignados() {
  const asignados = new Set(state.costoAsignaciones.map(a => String(a.pago_id)));
  return state.historial.filter(h =>
    esCostoAsignable(h) && h.id &&
    proyectoMatch(h.proyecto, cfProyecto) &&
    asignados.has(String(h.id))
  );
}

// Estimado de SOLO-VISUALIZACIÓN: reparte por indiviso (respetando la fecha del pago) los
// pagos del proyecto SIN factura ligada y SIN reparto, para ver su impacto provisional por
// casa mientras se asignan. NO crea asignaciones reales → no afecta el costo real ni duplica.
// Devuelve { porUnidad: Map(unidad_id→monto), total, count }.
function estimadoIndivisoPorUnidad() {
  const porUnidad = new Map();
  const asignados = new Set(state.costoAsignaciones.map(a => String(a.pago_id)));
  const activas = unidadesDeProyecto();
  // Excluir pagos ligados a factura por CUALQUIER vía (bandera directa o
  // facturaPagos por partes): su costo va por el devengado de la factura.
  const ligadosFp = new Set();
  (state.facturaPagos || []).forEach(fp => { if (String(fp.pago_id || '') !== '') ligadosFp.add(String(fp.pago_id)); });
  const pend = state.historial.filter(h =>
    esCostoAsignable(h) && h.id &&
    proyectoMatch(h.proyecto, cfProyecto) &&
    !asignados.has(String(h.id)) &&
    !(h.factura_id && String(h.factura_id) !== '') &&
    !ligadosFp.has(String(h.id))
  );
  let total = 0;
  pend.forEach(h => { total += h.importe || 0; });
  if (activas.length) {
    const poolCache = new Map(); // fecha ISO → { casas, sumInd } (pool de indiviso a esa fecha)
    pend.forEach(h => {
      const imp = h.importe || 0;
      if (!imp) return;
      const fIso = parseFechaHist(h.fecha) || '';
      let pool = poolCache.get(fIso);
      if (!pool) {
        const inObra = activas.filter(u => unidadEnIndivisoAFecha(u, fIso));
        const casas = inObra.length ? inObra : activas;
        pool = { casas, sumInd: casas.reduce((s, u) => s + (u.indiviso_pct || 0), 0) };
        poolCache.set(fIso, pool);
      }
      if (!pool.casas.length) return;
      pool.casas.forEach(u => {
        const factor = pool.sumInd > 0 ? (u.indiviso_pct || 0) / pool.sumInd : 1 / pool.casas.length;
        porUnidad.set(u.unidad_id, (porUnidad.get(u.unidad_id) || 0) + imp * factor);
      });
    });
  }
  return { porUnidad, total, count: pend.length };
}

function asignacionesHuerfanas() {
  const ids = historialIdSet();
  const factIds = new Set((state.facturas || []).map(f => String(f.factura_id)).filter(Boolean));
  // Una asignación de factura es huérfana solo si su factura ya no existe; una de
  // pago, solo si su pago ya no existe.
  return state.costoAsignaciones.filter(a =>
    a.factura_id ? !factIds.has(String(a.factura_id)) : !ids.has(String(a.pago_id))
  );
}

// ---------- render principal ----------
export function renderCostosFiscales() {
  const cont = document.getElementById('cf-contenido');
  const empty = document.getElementById('cf-empty');
  if (!cont) return;

  if (!datosListos()) {
    cont.style.display = 'none';
    if (empty) empty.style.display = '';
    return;
  }
  cont.style.display = '';
  if (empty) empty.style.display = 'none';

  const activos = state.proyectos.filter(p => p.activo !== false);
  if (!cfProyecto || !activos.find(p => p.nombre === cfProyecto)) {
    cfProyecto = activos.length ? activos[0].nombre : '';
  }

  renderProyTabs(activos);
  renderSubTabs();
  renderPanel();
}

function renderProyTabs(activos) {
  const cont = document.getElementById('cf-proy-tabs');
  if (!cont) return;
  cont.innerHTML = activos.map(p => {
    const act = p.nombre === cfProyecto;
    return `<button class="re-tab${act ? ' active' : ''}" data-proy="${escapeHtml(p.nombre)}"
      style="${act ? `border-color:${p.color || 'var(--accent)'};color:${p.color || 'var(--accent)'};` : ''}">${escapeHtml(p.nombre)}</button>`;
  }).join('') || '<div style="color:var(--muted);font-size:12px;">Sin proyectos activos</div>';
  cont.querySelectorAll('.re-tab').forEach(b => {
    b.addEventListener('click', () => { cfProyecto = b.dataset.proy; cfUnidadDetalle = null; renderCostosFiscales(); });
  });
}

function renderSubTabs() {
  const cont = document.getElementById('cf-tabs');
  if (!cont) return;
  const tabs = [
    { id: 'unidades', label: '🏠 Unidades' },
    { id: 'asignar', label: '🔗 Asignar Pagos' },
    { id: 'asignados', label: '✅ Pagos Asignados' },
    { id: 'presupuestos', label: '📋 Presupuestos' },
    { id: 'reportes', label: '📊 Costo por Unidad' },
    { id: 'plano', label: '🗺️ Plano' },
  ];
  cont.innerHTML = tabs.map(t =>
    `<button class="cf-subtab${cfTab === t.id ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
  ).join('');
  cont.querySelectorAll('.cf-subtab').forEach(b => {
    b.addEventListener('click', () => {
      cfTab = b.dataset.tab;
      cont.querySelectorAll('.cf-subtab').forEach(x => x.classList.toggle('active', x.dataset.tab === cfTab));
      renderPanel();
    });
  });
}

function renderPanel() {
  const panel = document.getElementById('cf-panel');
  if (!panel) return;
  if (cfTab === 'unidades') renderUnidadesTab(panel);
  else if (cfTab === 'asignar') renderAsignarTab(panel);
  else if (cfTab === 'asignados') renderAsignadosTab(panel);
  else if (cfTab === 'presupuestos') renderPresupuestosTab(panel);
  else if (cfTab === 'reportes') renderReportesTab(panel);
  else if (cfTab === 'plano') renderPlanoTab(panel);
}

// ========== TAB: UNIDADES ==========
function renderUnidadesTab(panel) {
  const unidades = unidadesDeProyecto(true);
  // Auto-consistencia: una casa con fecha de terminación pero aún 'En obra' (p.ej.
  // capturada antes de esta lógica, o llegada por import) se marca Terminada y se
  // persiste UNA sola vez (tras sanar ya no hay discrepancia → no vuelve a guardar).
  if (puedeEditar()) {
    const _fix = unidades.filter(u => u.fecha_termino && u.estatus === 'En obra');
    if (_fix.length) {
      const _pf = esPorFila('unidades');
      _fix.forEach(u => { u.estatus = 'Terminada'; if (_pf) sbGuardarFila('unidades', u); });
      gsSaveUnidades({ porFila: _pf });
    }
  }
  const sumaInd = unidades.filter(u => u.activo !== false).reduce((s, u) => s + (u.indiviso_pct || 0), 0);
  const indOk = Math.abs(sumaInd - 100) < 0.05;
  const estim = cfMostrarEstimado ? estimadoIndivisoPorUnidad() : null;

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
      <div style="font-size:12px;color:var(--muted);">
        ${unidades.length} unidad${unidades.length !== 1 ? 'es' : ''} ·
        Suma indiviso: <strong style="color:${indOk ? 'var(--green)' : 'var(--orange)'};">${sumaInd.toFixed(2)}%</strong>
        ${indOk ? '' : ' (debería ser 100%)'}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);cursor:pointer;" title="Reparte por indiviso (respetando fechas) los pagos sin factura ni reparto, SOLO para verlos. No crea asignaciones reales ni afecta el costo real.">
          <input type="checkbox" ${cfMostrarEstimado ? 'checked' : ''} onchange="cfToggleEstimado(this.checked)" style="cursor:pointer;"> Estimado por asignar
        </label>
        <button class="btn btn-ghost req-editor" onclick="abrirLoteUnidades()">+ Crear en lote</button>
        <button class="btn btn-primary req-editor" onclick="abrirNuevaUnidad()">+ Nueva Unidad</button>
      </div>
    </div>
    ${estim ? `<div style="font-size:12px;color:var(--accent);background:rgba(200,169,110,.08);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:12px;">📊 Pendiente por asignar: <strong>${fmt(estim.total)}</strong> en ${estim.count} pago(s) — repartido por indiviso (estimado; no afecta el costo real)</div>` : ''}
    ${unidades.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Unidad</th><th>Tipo</th><th style="text-align:right">% Indiviso</th>
          <th style="text-align:right">Superficie</th><th>Estatus</th><th>Terminación</th>
          <th style="text-align:right">Costo real</th>${estim ? '<th style="text-align:right">Estimado (por asignar)</th><th style="text-align:right" title="Costo real + estimado por asignar: lo que costará la casa cuando se reparta todo lo pendiente (si se reparte por indiviso)">Costo proyectado</th>' : ''}<th style="text-align:right">Acciones</th>
        </tr></thead>
        <tbody>${unidades.map(u => {
          const real = costoRealUnidad(u.unidad_id);
          return `<tr style="${u.activo === false ? 'opacity:.5;' : ''}">
            <td style="font-weight:600;">${escapeHtml(u.nombre)}</td>
            <td style="color:var(--muted);">${escapeHtml(u.tipo) || '—'}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;">${(u.indiviso_pct || 0).toFixed(2)}%</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--muted);">${u.superficie_m2 ? u.superficie_m2 + ' m²' : '—'}</td>
            <td>${puedeCapturarObra()
              ? `<select id="estatus-u-${u.unidad_id}" onchange="setEstatusUnidad(${u.unidad_id}, this.value)" title="Estatus de la casa" style="font-size:11px;padding:2px 4px;">${ESTATUS_UNIDAD.map(e => `<option${(u.estatus || 'En obra') === e ? ' selected' : ''}>${e}</option>`).join('')}</select>`
              : `<span id="estatus-u-${u.unidad_id}" style="font-size:11px;color:var(--muted);">${escapeHtml(u.estatus) || '—'}</span>`}</td>
            <td>${puedeCapturarObra()
              ? `<input type="date" id="fecha-u-${u.unidad_id}" value="${escapeHtml(u.fecha_termino || '')}" onchange="setFechaTermino(${u.unidad_id}, this.value)" title="Fecha en que la casa salió del indiviso (vacío = sigue en obra)" style="font-size:11px;padding:2px 4px;width:130px;">`
              : `<span style="font-size:11px;color:var(--muted);">${escapeHtml(u.fecha_termino) || '—'}</span>`}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(real)}</td>
            ${estim ? `<td style="text-align:right;font-family:'DM Mono',monospace;color:var(--muted);">${fmt(estim.porUnidad.get(u.unidad_id) || 0)}</td><td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--green);">${fmt(real + (estim.porUnidad.get(u.unidad_id) || 0))}</td>` : ''}
            <td style="text-align:right;white-space:nowrap;">
              <button class="btn btn-ghost btn-sm req-editor" onclick="editarUnidad(${u.unidad_id})">Editar</button>
              <button class="btn btn-ghost btn-sm req-editor" onclick="toggleUnidad(${u.unidad_id})" style="color:${u.activo === false ? 'var(--green)' : 'var(--red)'};">${u.activo === false ? 'Activar' : 'Baja'}</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : `<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🏠</div><div>Sin unidades en ${escapeHtml(cfProyecto)}. Crea las casas para empezar.</div></div>`}
  `;
}

// Prende/apaga el estimado por indiviso de pagos sin asignar (solo display).
export function cfToggleEstimado(on) {
  cfMostrarEstimado = on === true || on === 'true' || on === '1';
  renderCostosFiscales();
}

export function abrirNuevaUnidad() {
  if (!cfProyecto) { notify('Selecciona un proyecto', 'error'); return; }
  state.editUnidadId = null;
  document.getElementById('modal-unidad-title').textContent = 'Nueva Unidad · ' + cfProyecto;
  document.getElementById('un-nombre').value = '';
  document.getElementById('un-tipo').value = '';
  document.getElementById('un-indiviso').value = '';
  document.getElementById('un-superficie').value = '';
  document.getElementById('un-fecha-termino').value = '';
  document.getElementById('un-estatus').innerHTML = ESTATUS_UNIDAD.map(e => `<option>${e}</option>`).join('');
  document.getElementById('modal-unidad').classList.add('open');
}

export function editarUnidad(id) {
  const u = unidadById(id);
  if (!u) return;
  state.editUnidadId = id;
  document.getElementById('modal-unidad-title').textContent = 'Editar ' + u.nombre;
  document.getElementById('un-nombre').value = u.nombre;
  document.getElementById('un-tipo').value = u.tipo || '';
  document.getElementById('un-indiviso').value = u.indiviso_pct || '';
  document.getElementById('un-superficie').value = u.superficie_m2 || '';
  document.getElementById('un-fecha-termino').value = u.fecha_termino || '';
  document.getElementById('un-estatus').innerHTML = ESTATUS_UNIDAD.map(e => `<option${e === u.estatus ? ' selected' : ''}>${e}</option>`).join('');
  document.getElementById('modal-unidad').classList.add('open');
}

export async function guardarUnidad() {
  if (!(puedeEditar())) { notify('No tienes permiso para esta accion', 'error'); return; }
  const nombre = document.getElementById('un-nombre').value.trim();
  if (!nombre) { notify('El nombre es obligatorio', 'error'); return; }
  const indiviso = parseFloat(document.getElementById('un-indiviso').value) || 0;
  const obj = {
    nombre,
    tipo: document.getElementById('un-tipo').value.trim(),
    indiviso_pct: indiviso,
    superficie_m2: parseFloat(document.getElementById('un-superficie').value) || 0,
    fecha_termino: document.getElementById('un-fecha-termino').value || '',
    estatus: document.getElementById('un-estatus').value,
  };
  let _uEdit = null, _fechaAntes = '';
  if (state.editUnidadId) {
    _uEdit = unidadById(state.editUnidadId);
    _fechaAntes = _uEdit ? (_uEdit.fecha_termino || '') : '';
    if (_uEdit) Object.assign(_uEdit, obj);
  } else {
    state.unidades.push({
      unidad_id: state.nextUnidadId++,
      proyecto: cfProyecto,
      orden: unidadesDeProyecto(true).length + 1,
      activo: true,
      ...obj
    });
  }
  // Fase 3: guarda solo esta unidad (add o edit) en modo 'fila'. Capturar el
  // item ANTES de cerrar el modal (no vaya a resetear state.editUnidadId).
  const porFila = esPorFila('unidades');
  const _u = state.editUnidadId ? unidadById(state.editUnidadId) : state.unidades[state.unidades.length - 1];
  cerrar('modal-unidad');
  await gsSaveUnidades({ porFila });
  if (porFila && _u) sbGuardarFila('unidades', _u);
  notify('Unidad guardada');
  renderCostosFiscales();
  // Si el modal cambió la fecha de terminación, ofrecer recolocar los repartos.
  if (_uEdit) _ofrecerReparacionPorUnidad(_uEdit, _fechaAntes);
}

export async function toggleUnidad(id) {
  if (!(puedeEditar())) { notify('No tienes permiso para esta accion', 'error'); return; }
  const u = unidadById(id);
  if (!u) return;
  u.activo = u.activo === false;
  const porFila = esPorFila('unidades');
  await gsSaveUnidades({ porFila });
  if (porFila) sbGuardarFila('unidades', u);
  renderCostosFiscales();
}

// Captura rápida de la fecha de terminación (sale del pool de indiviso) desde la
// tabla de unidades. Guarda solo esa casa; sin re-render para no perder el scroll
// al capturar varias seguidas. gsSaveUnidades ya valida puedeEditar() por dentro.
// Al capturar/cambiar la fecha de terminación de una casa, detectar los repartos
// automáticos que la incluyeron cuando ya no debía (la foto del reparto se toma
// al registrar el pago y NO se recalcula sola) y OFRECER recolocarlos, con
// confirmación. Los editados a mano solo se reportan — jamás se tocan.
function _ofrecerReparacionPorUnidad(u, fechaAntes) {
  try {
    // Recolocar repartos reescribe asignaciones de PAGOS: es de editores. Al
    // residente de obra no se le pregunta nada (el admin lo corrige con ♻️).
    if (!puedeEditar()) return;
    if ((u.fecha_termino || '') === (fechaAntes || '')) return;
    if (!u.fecha_termino) return;   // quitar la fecha no expulsa a nadie del pool
    const res = auditarRepartos();
    const k = String(u.unidad_id);
    const mios = res.corregibles.filter(c => c.asigs.some(a => String(a.unidad_id) === k));
    const manuales = res.manuales.filter(c => c.asigs.some(a => String(a.unidad_id) === k));
    if (mios.length) {
      const totalCasa = mios.reduce((s, c) =>
        s + c.asigs.filter(a => String(a.unidad_id) === k).reduce((x, a) => x + (a.monto_asignado || 0), 0), 0);
      // Detalle VISIBLE ANTES de decidir (consola F12), con el pool resultante.
      console.table(mios.map(c => {
        const sigue = new Set((c.esperado?.filas || []).map(f => String(f.unidad_id)));
        return { PROYECTO: c.h.proyecto, FECHA: c.h.fecha, IMPORTE: c.h.importe,
          CASAS_HOY: c.asigs.length, CASAS_DESPUES: sigue.size,
          SALEN: c.asigs.filter(a => !sigue.has(String(a.unidad_id))).length,
          CONCEPTO: (c.h.concepto || '').slice(0, 45) };
      }));
      if (confirm(`⚠️ ${mios.length} pago(s) le repartieron ${fmt(totalCasa)} a "${u.nombre}" después de su fecha de terminación.\n\n¿Recolocar esos repartos SOLO entre las casas en obra de ${u.proyecto || 'su proyecto'}? (los editados a mano no se tocan; detalle en consola F12)`)) {
        const n = aplicarReparacionRepartos(mios);
        notify(`♻️ ${n} reparto(s) recolocados — el costo de "${u.nombre}" se ajustó`);
        renderCostosFiscales();
      }
    }
    if (manuales.length) {
      notify(`✋ ${manuales.length} reparto(s) EDITADOS A MANO incluyen a "${u.nombre}" con fecha posterior — revísalos con "Reasignar"`, 'error');
      console.table(manuales.map(c => ({ FECHA: c.h.fecha, IMPORTE: c.h.importe, CONCEPTO: (c.h.concepto || '').slice(0, 45) })));
    }
  } catch (e) { console.error('reparacionRepartos', e); }
}

// Auditoría GLOBAL de repartos congelados (botón ♻️ de la página). Idempotente:
// en estado limpio solo avisa que todo cuadra.
export function revisarRepartos() {
  if (!puedeEditar()) { notify('No tienes permiso para editar', 'error'); return; }
  const res = auditarRepartos();
  if (!res.corregibles.length && !res.manuales.length && !res.sinPool.length) {
    notify('✅ No hay repartos por corregir — todo cuadra con las fechas actuales');
    return;
  }
  if (res.corregibles.length) {
    // Detalle VISIBLE ANTES de decidir (consola F12): qué pagos, de qué proyecto,
    // cuánto, y a cuántas casas queda el reparto tras corregir (y cuántas salen).
    console.table(res.corregibles.map(c => {
      const sigue = new Set((c.esperado?.filas || []).map(f => String(f.unidad_id)));
      return { PROYECTO: c.h.proyecto, FECHA: c.h.fecha, IMPORTE: c.h.importe,
        CASAS_HOY: c.asigs.length, CASAS_DESPUES: sigue.size,
        SALEN: c.asigs.filter(a => !sigue.has(String(a.unidad_id))).length,
        CONCEPTO: (c.h.concepto || '').slice(0, 45) };
    }));
    const porProy = new Map();
    res.corregibles.forEach(c => {
      const p = c.h.proyecto || '(sin proyecto)';
      const acc = porProy.get(p) || { n: 0, total: 0 };
      acc.n++; acc.total += c.h.importe || 0;
      porProy.set(p, acc);
    });
    const desglose = [...porProy.entries()].map(([p, v]) => `· ${p}: ${v.n} pago(s) (${fmt(v.total)})`).join('\n');
    if (confirm(`♻️ ${res.corregibles.length} reparto(s) automáticos quedaron con una foto vieja:\n\n${desglose}\n\nCada pago se recoloca SOLO entre casas de SU propio proyecto (el total por proyecto no cambia). Los editados a mano no se tocan. Detalle en la consola (F12).\n\n¿Recolocarlos con las fechas de terminación actuales?`)) {
      const n = aplicarReparacionRepartos(res.corregibles);
      notify(`♻️ ${n} reparto(s) recolocados`);
      renderCostosFiscales();
    }
  }
  if (res.manuales.length) {
    notify(`✋ ${res.manuales.length} reparto(s) editados a mano incluyen casas ya terminadas — revísalos con "Reasignar" (detalle en consola F12)`, 'error');
    console.table(res.manuales.map(c => ({ FECHA: c.h.fecha, IMPORTE: c.h.importe, CONCEPTO: (c.h.concepto || '').slice(0, 45) })));
  }
  if (res.sinPool.length) notify(`ℹ️ ${res.sinPool.length} pago(s) en proyectos 100% terminados — no hay casas en obra a quién recolocar (quedan como están)`);
}

// Estatus de la casa (En obra → Terminada → Entregada → Vendida). Captura de OBRA:
// se edita en línea, sin abrir el modal de unidad (que tocaría indiviso y nombre).
export async function setEstatusUnidad(id, value) {
  if (!puedeCapturarObra()) { notify('No tienes permiso para cambiar el estatus', 'error'); return; }
  const u = unidadById(id);
  if (!u || !ESTATUS_UNIDAD.includes(value)) return;
  const inpFecha = document.getElementById('fecha-u-' + id);
  const estatusAntes = u.estatus || 'En obra';
  // El motor de indiviso decide SOLO por fecha_termino (el estatus no lo mira),
  // así que estatus y fecha se mantienen coherentes o el costo se reparte mal:
  //  - salir de obra SIN fecha ⇒ la casa seguiría absorbiendo costo → se pone hoy
  //    (el residente ajusta la fecha real en la celda de al lado si terminó antes);
  //  - regresar a 'En obra' BORRA la fecha (la devuelve al reparto) ⇒ se confirma.
  let aviso = '';
  if (value === 'En obra') {
    if (u.fecha_termino) {
      if (!confirm(`"${u.nombre}" tiene fecha de terminación ${u.fecha_termino}.\n\nRegresarla a "En obra" BORRA esa fecha y la casa vuelve a recibir costos por indiviso.\n\n¿Continuar?`)) {
        const sel = document.getElementById('estatus-u-' + id);
        if (sel) sel.value = estatusAntes;   // revertir el select, no se guarda nada
        return;
      }
      u.fecha_termino = '';
      if (inpFecha) inpFecha.value = '';
      aviso = ' · se borró su fecha de terminación';
    }
  } else if (!u.fecha_termino) {
    u.fecha_termino = new Date().toISOString().slice(0, 10);
    if (inpFecha) inpFecha.value = u.fecha_termino;
    aviso = ` · se puso fecha de terminación ${u.fecha_termino} (ajústala si terminó antes)`;
  }
  u.estatus = value;
  const porFila = esPorFila('unidades');
  await gsSaveUnidades({ porFila });
  if (porFila) sbGuardarFila('unidades', u);
  notify(`${u.nombre}: ${value}${aviso}`);
}

export async function setFechaTermino(id, value) {
  if (!puedeCapturarObra()) { notify('No tienes permiso para capturar la fecha de terminación', 'error'); return; }
  const u = unidadById(id);
  if (!u) return;
  const fechaAntes = u.fecha_termino || '';
  u.fecha_termino = value || '';
  // La fecha marca que la casa salió de obra → refleja el estatus en automático.
  // No tocamos 'Entregada'/'Vendida' (ya están más allá de 'Terminada').
  if (value && u.estatus === 'En obra') u.estatus = 'Terminada';
  else if (!value && u.estatus === 'Terminada') u.estatus = 'En obra';
  // La celda de estatus es <select> para quien captura obra y <span> para el resto:
  // escribirle textContent a un <select> le borraría las opciones.
  const cell = document.getElementById('estatus-u-' + id);
  if (cell) {
    if (cell.tagName === 'SELECT') cell.value = u.estatus || 'En obra';
    else cell.textContent = u.estatus || '—';
  }
  const porFila = esPorFila('unidades');
  await gsSaveUnidades({ porFila });
  if (porFila) sbGuardarFila('unidades', u);
  notify(value ? `Terminación: ${u.nombre} → ${value} · ${u.estatus}` : `${u.nombre}: sin fecha · ${u.estatus}`);
  _ofrecerReparacionPorUnidad(u, fechaAntes);
}

export function abrirLoteUnidades() {
  if (!cfProyecto) { notify('Selecciona un proyecto', 'error'); return; }
  document.getElementById('lote-prefijo').value = 'Casa ';
  document.getElementById('lote-desde').value = '1';
  document.getElementById('lote-cantidad').value = '10';
  document.getElementById('lote-indiviso-auto').checked = true;
  document.getElementById('modal-unidades-lote').classList.add('open');
}

export async function guardarLoteUnidades() {
  if (!(puedeEditar())) { notify('No tienes permiso para esta accion', 'error'); return; }
  const prefijo = document.getElementById('lote-prefijo').value;
  const desde = parseInt(document.getElementById('lote-desde').value) || 1;
  const cantidad = parseInt(document.getElementById('lote-cantidad').value) || 0;
  if (cantidad < 1 || cantidad > 500) { notify('Cantidad inválida (1-500)', 'error'); return; }
  const autoIndiviso = document.getElementById('lote-indiviso-auto').checked;

  const existentes = unidadesDeProyecto(true).length;
  // Reparte 100% entre el total de unidades activas resultante
  const totalFinal = existentes + cantidad;
  const indivisoCada = autoIndiviso ? r2(100 / totalFinal) : 0;

  for (let i = 0; i < cantidad; i++) {
    state.unidades.push({
      unidad_id: state.nextUnidadId++,
      proyecto: cfProyecto,
      nombre: prefijo + (desde + i),
      tipo: '',
      indiviso_pct: indivisoCada,
      superficie_m2: 0,
      estatus: 'En obra',
      orden: existentes + i + 1,
      activo: true,
    });
  }
  // Si auto-indiviso, re-nivelar también las unidades previas para que sume 100
  if (autoIndiviso) {
    unidadesDeProyecto(true).forEach(u => { u.indiviso_pct = indivisoCada; });
  }
  cerrar('modal-unidades-lote');
  await gsSaveUnidades();
  notify(`${cantidad} unidades creadas`);
  renderCostosFiscales();
}

// Estado de un pago pendiente respecto a facturas (única fuente de verdad para
// la lista Y el export a Excel): 'libre' | 'sin_repartir' | 'parcial' | 'muerta'.
function _estadoFacturaPago(h, cubiertosSet) {
  const ligadas = _facturasLigadasAPago(h);
  let fid = null, fLig = null, fMuerta = null;
  for (const cand of ligadas) {
    const f = facturaById(cand);
    if (f && f.estado_sat !== 'Cancelada' && f.estatus_factura !== 'cancelada') {
      if (!state.costoAsignaciones.some(a => String(a.factura_id) === String(cand))) { fid = cand; fLig = f; break; }
    } else if (!fMuerta) { fMuerta = cand; }
  }
  if (fid) return { tipo: 'sin_repartir', fid, fLig, rest: restantePago(h) };
  if (cubiertosSet.has(String(h.id))) return { tipo: 'parcial', fid: null, fLig: null, rest: restantePago(h) };
  if (ligadas.size && fMuerta) return { tipo: 'muerta', fid: fMuerta, fLig: null, rest: restantePago(h) };
  return { tipo: 'libre', fid: null, fLig: null, rest: h.importe || 0 };
}

// ========== TAB: ASIGNAR PAGOS ==========
function renderAsignarTab(panel) {
  const todosPend = pagosSinAsignar();
  const asignados = pagosAsignados();
  const huerfanas = asignacionesHuerfanas();

  // Clasificación por vínculo con facturas (modelo devengado):
  // - CUBIERTOS: ligados a factura REPARTIDA (no cancelada) → su costo YA está en
  //   el devengado de la factura; NO son pendientes (antes inflaban la tarjeta y
  //   la lista, aunque el costo por casa nunca se duplicó gracias a la supresión).
  // - LIGADOS a factura SIN repartir → la acción correcta es repartir la FACTURA.
  // - LIBRES: sin factura → reparto propio o ligarlo a una factura (📎).
  const cubiertosSet = _pagosCubiertosPorFacturaSet();
  const cubiertos = [], pendientes = [];
  todosPend.forEach(h => {
    // Cubierto DE VERDAD = alguna factura repartida lo cubre Y ya no le queda
    // restante por aplicar. Un pago aplicado PARCIALMENTE sigue pendiente por su
    // restante (se liga a otra factura con 📎) — si saliera de la lista, ese
    // restante se volvería invisible.
    if (cubiertosSet.has(String(h.id)) && restantePago(h) <= 0.01) cubiertos.push(h);
    else pendientes.push(h);
  });

  panel.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-label">Pagos sin asignar</div><div class="stat-value" style="color:var(--orange);">${pendientes.length}</div><div class="stat-sub">${fmt(pendientes.reduce((s, h) => s + (h.importe || 0), 0))}</div></div>
      <div class="stat-card"><div class="stat-label">Pagos asignados</div><div class="stat-value" style="color:var(--green);">${asignados.length}</div><div class="stat-sub">${fmt(asignados.reduce((s, h) => s + (h.importe || 0), 0))}</div></div>
      <div class="stat-card" title="Pagos aplicados POR COMPLETO a facturas ya repartidas: su costo entra por el devengado de la factura, por eso no están pendientes"><div class="stat-label">Cubiertos por factura</div><div class="stat-value" style="color:var(--blue);">${cubiertos.length}</div><div class="stat-sub">${fmt(cubiertos.reduce((s, h) => s + (h.importe || 0), 0))}</div></div>
      <div class="stat-card"><div class="stat-label">Asignaciones huérfanas</div><div class="stat-value" style="color:${huerfanas.length ? 'var(--red)' : 'var(--muted)'};">${huerfanas.length}</div><div class="stat-sub">${huerfanas.length ? '<a href="#" class="req-editor" onclick="cfLimpiarHuerfanas();return false;" style="color:var(--accent);">Limpiar</a>' : 'Sin problemas'}</div></div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;">Pendientes de asignar</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-ghost btn-sm" onclick="exportarPendientesExcel()" title="Exporta los pendientes con su estado de factura + columnas para que contabilidad indique la factura de cada pago">⬇ Excel</button>
        <input type="text" id="cf-pend-search" placeholder="🔍 Buscar beneficiario, concepto..." oninput="cfFiltrarPendientes()" style="width:280px;">
      </div>
    </div>

    ${pendientes.length ? `
    <div id="cf-pend-count" style="font-size:11px;color:var(--muted);margin-bottom:6px;"></div>
    <div class="table-wrap cf-tabla-scroll" style="margin-bottom:24px;">
      <table>
        <thead><tr><th>Fecha</th><th>Beneficiario</th><th>Concepto</th><th>Partida</th><th style="text-align:right">Importe</th><th style="text-align:right">Acción</th></tr></thead>
        <tbody id="cf-pend-tbody">${pendientes.map(h => {
          const e = _estadoFacturaPago(h, cubiertosSet);
          const _bdg = (txt, color, title) => `<span style="display:inline-block;padding:1px 7px;border-radius:6px;font-size:10px;font-weight:600;background:${color};" title="${escapeHtml(title)}">${txt}</span><br>`;
          const btnAsignar = `<button class="btn btn-primary btn-sm req-editor" onclick="abrirAsignarCosto('${h.id}')">Asignar</button>`;
          const btnLigar = `<button class="btn btn-ghost btn-sm req-ligar-pagos" onclick="abrirLigarFactura('${h.id}')" title="Aplicar este pago a una factura; el reparto vivirá en la factura (devengado)">📎 Factura</button>`;
          let badge = '', accion = '';
          if (e.tipo === 'sin_repartir') {
            badge = _bdg(`📎 Fac ${escapeHtml(String(e.fid))} sin repartir`, 'rgba(90,155,224,.15);color:var(--blue)', `Este pago está aplicado a la factura ${e.fid}${e.fLig && e.fLig.numero_factura ? ' (' + e.fLig.numero_factura + ')' : ''} pero la factura AÚN no se reparte a las casas — repártela y este pago quedará cubierto`);
            accion = `<button class="btn btn-primary btn-sm req-facturas" onclick="abrirRepartirFactura('${escapeHtml(String(e.fid))}')" title="El costo debe vivir en la factura (devengado)">Repartir factura</button>`;
          } else if (e.tipo === 'parcial') {
            badge = _bdg(`📎 parcial · restante ${fmt(e.rest)}`, 'rgba(90,155,224,.15);color:var(--blue)', `Este pago ya está aplicado en parte a factura(s) repartida(s); le quedan ${fmt(e.rest)} por aplicar a otra factura`);
            accion = btnLigar;
          } else if (e.tipo === 'muerta') {
            badge = _bdg(`⚠ Fac ${escapeHtml(String(e.fid))} cancelada/inexistente`, 'rgba(224,122,58,.15);color:var(--orange)', 'La factura ligada está cancelada o ya no existe: asigna reparto propio al pago o lígalo a otra factura');
            accion = `${btnAsignar} ${btnLigar}`;
          } else {
            accion = `${btnAsignar} ${btnLigar}`;
          }
          return `
          <tr class="cf-pend-row" data-buscar="${escapeHtml(`${h.nombre || ''} ${h.concepto || ''} ${h.partida || ''}`.toLowerCase().replace(/"/g, ''))}">
            <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(h.fecha)}</td>
            <td style="font-weight:500;">${escapeHtml(h.nombre) || '—'}</td>
            <td style="color:var(--muted);font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.concepto) || '—'}</td>
            <td style="color:var(--muted);font-size:12px;">${badge}${escapeHtml(h.partida) || 'Sin partida'}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(h.importe || 0)}</td>
            <td style="text-align:right;white-space:nowrap;">${accion}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '<div class="empty-state" style="margin-bottom:24px;"><div style="font-size:28px;opacity:.4;margin-bottom:8px;">✅</div><div>Todos los pagos de ' + escapeHtml(cfProyecto) + ' están asignados o cubiertos por facturas</div></div>'}
  `;
  cfFiltrarPendientes();
}

// Exporta a Excel los pagos de la pestaña Asignar (para CONTABILIDAD): hoja de
// pendientes con su estado de factura + columnas en blanco para que contabilidad
// indique la factura de cada pago, y hoja de cubiertos como referencia.
export function exportarPendientesExcel() {
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const todosPend = pagosSinAsignar();
  const cubiertosSet = _pagosCubiertosPorFacturaSet();
  const pendientes = [], cubiertos = [];
  todosPend.forEach(h => {
    if (cubiertosSet.has(String(h.id)) && restantePago(h) <= 0.01) cubiertos.push(h);
    else pendientes.push(h);
  });
  if (!pendientes.length && !cubiertos.length) { notify('No hay pagos que exportar en este proyecto', 'error'); return; }

  const ESTADO = { libre: 'SIN FACTURA', sin_repartir: 'Ligado a factura SIN repartir', parcial: 'Aplicado PARCIAL a factura', muerta: 'Factura cancelada/inexistente' };
  const hoyISO = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  const aoa = [
    [`Pagos por asignar — ${cfProyecto}`],
    [`Generado: ${fmtFecha(hoyISO)} · ${pendientes.length} pago(s) pendientes`],
    ['Para contabilidad: indicar en las columnas finales a qué factura corresponde cada pago (o confirmar que no tiene factura).'],
    [],
    ['ID pago', 'Fecha', 'Beneficiario', 'Concepto', 'Partida', 'Importe', 'Restante por aplicar', 'Estado', 'Factura ligada', 'N° Factura (contabilidad)', 'UUID (contabilidad)', 'Comentarios']
  ];
  pendientes.forEach(h => {
    const e = _estadoFacturaPago(h, cubiertosSet);
    const fRef = e.fid ? `Fac ${e.fid}${e.fLig && e.fLig.numero_factura ? ' · ' + e.fLig.numero_factura : ''}` : '';
    aoa.push([h.id, fmtFecha(h.fecha), h.nombre || '', h.concepto || '', h.partida || 'Sin partida', h.importe || 0, e.rest, ESTADO[e.tipo] || '', fRef, '', '', '']);
  });
  aoa.push([]);
  aoa.push(['TOTAL', '', '', '', '', pendientes.reduce((s, h) => s + (h.importe || 0), 0), '', '', '', '', '', '']);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 8 }, { wch: 11 }, { wch: 34 }, { wch: 42 }, { wch: 20 }, { wch: 14 }, { wch: 15 }, { wch: 26 }, { wch: 18 }, { wch: 20 }, { wch: 38 }, { wch: 30 }];
  for (let r = 5; r < aoa.length; r++) {
    [5, 6].forEach(c => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00';
    });
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Pendientes');

  if (cubiertos.length) {
    const aoa2 = [
      [`Cubiertos por factura (referencia) — ${cfProyecto}`],
      ['Su costo ya entra por el devengado de su factura repartida; no requieren acción.'],
      [],
      ['ID pago', 'Fecha', 'Beneficiario', 'Concepto', 'Importe', 'Factura(s)']
    ];
    cubiertos.forEach(h => {
      aoa2.push([h.id, fmtFecha(h.fecha), h.nombre || '', h.concepto || '', h.importe || 0, [..._facturasLigadasAPago(h)].map(x => 'Fac ' + x).join(', ')]);
    });
    aoa2.push([]);
    aoa2.push(['TOTAL', '', '', '', cubiertos.reduce((s, h) => s + (h.importe || 0), 0), '']);
    const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
    ws2['!cols'] = [{ wch: 8 }, { wch: 11 }, { wch: 34 }, { wch: 42 }, { wch: 14 }, { wch: 26 }];
    for (let r = 4; r < aoa2.length; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: 4 });
      if (ws2[ref] && typeof ws2[ref].v === 'number') ws2[ref].z = '"$"#,##0.00';
    }
    XLSX.utils.book_append_sheet(wb, ws2, 'Cubiertos por factura');
  }

  XLSX.writeFile(wb, `Pagos_por_asignar_${String(cfProyecto || 'proyecto').replace(/[\\/:*?"<>|\s]+/g, '_')}_${hoyISO}.xlsx`);
  notify(`✅ Excel generado: ${pendientes.length} pendiente(s)${cubiertos.length ? ` + ${cubiertos.length} cubiertos` : ''}`);
}

// ---- Ligar pago a factura (📎, desde la lista de pendientes) ----
let _lfPagoId = null;

export function abrirLigarFactura(pagoId) {
  // Ligar pagos↔facturas es un permiso APARTE del de capturar facturas:
  // 'facturas_obra' (Anahi) y 'obra' (Gustavo) no ligan.
  if (!puedeLigarPagos()) { notify('Tu perfil no puede ligar pagos a facturas', 'error'); return; }
  const h = state.historial.find(x => String(x.id) === String(pagoId));
  if (!h) return;
  _lfPagoId = String(pagoId);
  const rest = restantePago(h);
  const info = document.getElementById('lf-pago-info');
  if (info) info.innerHTML = `<b>${escapeHtml(h.nombre || '')}</b> · ${fmtFecha(h.fecha)} · ${fmt(h.importe || 0)}${rest < (h.importe || 0) ? ` · restante ${fmt(rest)}` : ''}<br><span style="font-size:11px;color:var(--muted);">${escapeHtml(h.concepto || '')}</span>`;

  // Candidatas: con saldo real por aplicar, no canceladas, no ligadas ya a este
  // pago. Espejo del flujo de Facturas: mismo proveedor primero (por cercanía de
  // monto), luego otros con monto igual/cercano, y las de OTRO proyecto al fondo
  // con advertencia.
  const yaLigadas = _facturasLigadasAPago(h);
  const saldoDe = f => Math.round(((f.monto_total || 0) - (f.monto_pagado || 0)) * 100) / 100;
  const cand = (state.facturas || []).filter(f =>
    f.estatus_factura !== 'cancelada' && f.estado_sat !== 'Cancelada' &&
    !yaLigadas.has(String(f.factura_id)) && saldoDe(f) > 0.01);
  const provId = parseInt(h.proveedor_id) || 0;
  const mismoProy = f => !f.proyecto || !h.proyecto || proyectoMatch(h.proyecto, f.proyecto);
  const diff = f => Math.min(Math.abs((f.monto_total || 0) - rest), Math.abs(saldoDe(f) - rest));
  const g1 = cand.filter(f => f.proveedor_id === provId && mismoProy(f)).sort((a, b) => diff(a) - diff(b)).slice(0, 25);
  const g2 = cand.filter(f => f.proveedor_id !== provId && mismoProy(f) && diff(f) <= Math.max(1, rest * 0.01)).sort((a, b) => diff(a) - diff(b)).slice(0, 10);
  const g3 = cand.filter(f => !mismoProy(f)).sort((a, b) => ((a.proveedor_id === provId ? 0 : 1) - (b.proveedor_id === provId ? 0 : 1)) || (diff(a) - diff(b))).slice(0, 12);

  const fila = (f, warn) => {
    const saldo = saldoDe(f);
    const repartida = state.costoAsignaciones.some(a => String(a.factura_id) === String(f.factura_id));
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border);">
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Fac ${escapeHtml(String(f.factura_id))}${f.numero_factura ? ' · ' + escapeHtml(f.numero_factura) : ''} · ${escapeHtml(f.razon_social || f.nombre_proveedor || '')}</div>
        <div style="font-size:11px;color:var(--muted);">${escapeHtml(f.proyecto || 'sin proyecto')} · total ${fmt(f.monto_total || 0)} · saldo ${fmt(saldo)} · ${repartida ? '<span style="color:var(--green);">repartida ✓</span>' : '<span style="color:var(--orange);">sin repartir</span>'}${warn ? ' · <span style="color:var(--orange);font-weight:700;">⚠ otro proyecto</span>' : ''}</div>
      </div>
      <input type="number" step="0.01" min="0" id="lf-m-${escapeHtml(String(f.factura_id))}" value="${Math.min(saldo, rest).toFixed(2)}" style="width:110px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;">
      <button class="btn btn-primary btn-sm" onclick="lfAplicar('${escapeHtml(String(f.factura_id))}')">Aplicar</button>
    </div>`;
  };
  const secc = (titulo, arr, warn) => arr.length
    ? `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:8px 10px 2px;">${titulo}</div>` + arr.map(f => fila(f, warn)).join('')
    : '';
  const lista = document.getElementById('lf-lista');
  if (lista) {
    const html = secc('Del mismo proveedor', g1, false)
      + secc('Otros proveedores con monto igual o cercano', g2, false)
      + secc('⚠ De OTRO proyecto (verifica antes de aplicar)', g3, true);
    lista.innerHTML = html || '<div class="empty-state" style="padding:20px;"><div>No hay facturas con saldo por aplicar para este pago</div></div>';
  }
  document.getElementById('modal-ligar-factura')?.classList.add('open');
}

export function lfAplicar(facturaId) {
  if (!_lfPagoId) return;
  const monto = parseFloat(document.getElementById('lf-m-' + facturaId)?.value);
  const res = aplicarPagoAFactura(_lfPagoId, facturaId, monto);
  if (!res || !res.ok) return;
  cerrar('modal-ligar-factura');
  renderCostosFiscales();   // el pago sale de pendientes si quedó cubierto, o muestra su badge 📎
  const repartida = state.costoAsignaciones.some(a => String(a.factura_id) === String(facturaId));
  if (!repartida) {
    if (confirm('La factura aún NO está repartida a las casas.\n\n¿Repartirla ahora (devengado)? Al completar su reparto, este pago (y todos los aplicados a ella) quedan cubiertos y salen de pendientes.')) {
      abrirRepartirFactura(facturaId);
    }
  }
}

// Filtra la lista de pagos pendientes por beneficiario, concepto o partida.
export function cfFiltrarPendientes() {
  const search = document.getElementById('cf-pend-search');
  const tbody = document.getElementById('cf-pend-tbody');
  const countEl = document.getElementById('cf-pend-count');
  if (!tbody) return;
  const q = (search ? search.value : '').trim().toLowerCase();
  const rows = tbody.querySelectorAll('.cf-pend-row');
  let visibles = 0;
  rows.forEach(row => {
    const match = !q || (row.dataset.buscar || '').includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visibles++;
  });
  if (countEl) {
    countEl.textContent = q
      ? `Mostrando ${visibles} de ${rows.length} pagos pendientes`
      : `${rows.length} pagos pendientes`;
  }
}

// ========== TAB: PAGOS ASIGNADOS ==========
function renderAsignadosTab(panel) {
  const asignados = pagosAsignados();
  const huerfanas = asignacionesHuerfanas();
  const totalAsig = asignados.reduce((s, h) => s + (h.importe || 0), 0);

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="font-size:12px;color:var(--muted);">
        ${asignados.length} pago${asignados.length !== 1 ? 's' : ''} asignado${asignados.length !== 1 ? 's' : ''} · ${fmt(totalAsig)}
        ${huerfanas.length ? ` · <span style="color:var(--red);">${huerfanas.length} huérfana(s)</span> <a href="#" class="req-editor" onclick="cfLimpiarHuerfanas();return false;" style="color:var(--accent);">Limpiar</a>` : ''}
      </div>
      <input type="text" id="cf-asig-search" placeholder="🔍 Buscar beneficiario, concepto..." oninput="cfFiltrarAsignados()" style="width:280px;">
    </div>
    ${asignados.length ? `
    <div id="cf-asig-count" style="font-size:11px;color:var(--muted);margin-bottom:6px;"></div>
    <div class="table-wrap cf-tabla-scroll">
      <table>
        <thead><tr><th>Fecha</th><th>Beneficiario</th><th style="text-align:right">Importe</th><th>Reparto</th><th style="text-align:right">Acción</th></tr></thead>
        <tbody id="cf-asig-tbody">${asignados.map(h => {
          const asigs = state.costoAsignaciones.filter(a => String(a.pago_id) === String(h.id));
          const detalle = asigs.map(a => {
            const u = unidadById(a.unidad_id);
            return `${escapeHtml(u ? u.nombre : '#' + a.unidad_id)}: ${fmt(a.monto_asignado)}`;
          }).join(' · ');
          const metodo = asigs[0] ? METODO_LABEL[asigs[0].metodo] || asigs[0].metodo : '';
          return `<tr class="cf-asig-row" data-buscar="${escapeHtml(`${h.nombre || ''} ${h.concepto || ''}`.toLowerCase().replace(/"/g, ''))}">
            <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(h.fecha)}</td>
            <td style="font-weight:500;">${escapeHtml(h.nombre) || '—'}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(h.importe || 0)}</td>
            <td style="font-size:11px;color:var(--muted);"><div style="color:var(--text);font-weight:500;">${escapeHtml(metodo)}</div>${detalle}</td>
            <td style="text-align:right;white-space:nowrap;">
              <button class="btn btn-ghost btn-sm req-editor" onclick="reasignarCosto('${h.id}')">Reasignar</button>
              <button class="btn btn-ghost btn-sm req-editor" onclick="eliminarAsignacionCosto('${h.id}')" style="color:var(--red);">Quitar</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">📭</div><div>Aún no hay pagos asignados en ' + escapeHtml(cfProyecto) + '</div></div>'}
  `;
  cfFiltrarAsignados();
}

// Filtra la lista de pagos asignados por beneficiario o concepto.
export function cfFiltrarAsignados() {
  const search = document.getElementById('cf-asig-search');
  const tbody = document.getElementById('cf-asig-tbody');
  const countEl = document.getElementById('cf-asig-count');
  if (!tbody) return;
  const q = (search ? search.value : '').trim().toLowerCase();
  const rows = tbody.querySelectorAll('.cf-asig-row');
  let visibles = 0;
  rows.forEach(row => {
    const match = !q || (row.dataset.buscar || '').includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visibles++;
  });
  if (countEl) {
    countEl.textContent = q
      ? `Mostrando ${visibles} de ${rows.length} pagos asignados`
      : `${rows.length} pagos asignados`;
  }
}

export async function cfLimpiarHuerfanas() {
  if (!(puedeEditar())) { notify('No tienes permiso para esta accion', 'error'); return; }
  const huerfanas = asignacionesHuerfanas();
  if (!huerfanas.length) return;
  if (!confirm(`¿Eliminar ${huerfanas.length} asignación(es) huérfana(s)? Corresponden a pagos o facturas que ya no existen.`)) return;
  const ids = historialIdSet();
  const factIds = new Set((state.facturas || []).map(f => String(f.factura_id)).filter(Boolean));
  state.costoAsignaciones = state.costoAsignaciones.filter(a =>
    a.factura_id ? factIds.has(String(a.factura_id)) : ids.has(String(a.pago_id))
  );
  await gsSaveCostoAsignaciones();
  notify('Asignaciones huérfanas eliminadas');
  renderPanel();
}

export function abrirAsignarCosto(pagoId) {
  if (!(puedeEditar())) { notify('No tienes permiso para esta accion', 'error'); return; }
  const pago = pagoById(pagoId);
  if (!pago) { notify('Pago no encontrado', 'error'); return; }
  if (!unidadesDeProyecto().length) { notify('Primero crea unidades en este proyecto', 'error'); return; }
  cfPagoAsignar = pagoId;
  cfFacturaAsignar = null;
  cfCustomModo = 'pct';
  const tit = document.getElementById('asignar-titulo'); if (tit) tit.textContent = 'Asignar Costo a Unidades';

  document.getElementById('asignar-info').innerHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px;">
      <div style="font-weight:600;">${escapeHtml(pago.nombre) || '—'}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${fmtFecha(pago.fecha)} · ${escapeHtml(pago.concepto) || 'Sin concepto'} · ${escapeHtml(pago.partida) || 'Sin partida'}</div>
      <div style="font-family:'DM Mono',monospace;font-size:18px;color:var(--accent);font-weight:700;margin-top:6px;">${fmt(pago.importe || 0)}</div>
    </div>`;

  document.querySelector('input[name="cf-metodo"][value="directo"]').checked = true;
  renderMetodoBody();
  document.getElementById('modal-asignar-costo').classList.add('open');
}

export function reasignarCosto(pagoId) {
  if (!(puedeEditar())) { notify('No tienes permiso para esta accion', 'error'); return; }
  // Reabre el modal; guardarAsignacionCosto reemplaza las asignaciones previas.
  // No se borra nada hasta confirmar, así cancelar no pierde datos.
  abrirAsignarCosto(pagoId);
}

// Devengado (Fase B): reparte el costo de una FACTURA (sobre su monto_total) a las
// casas de su proyecto. Reusa el mismo modal que el reparto de pagos.
export function abrirRepartirFactura(facturaId) {
  if (!(puedeFacturas())) { notify('Tu perfil no puede repartir facturas', 'error'); return; }
  const f = facturaById(facturaId);
  if (!f) { notify('Factura no encontrada', 'error'); return; }
  if (!f.proyecto) { notify('La factura no tiene proyecto; asígnale uno para repartir su costo', 'error'); return; }
  if (!(f.monto_total > 0)) { notify('La factura no tiene monto para repartir', 'error'); return; }
  cfProyecto = f.proyecto;                 // el reparto va a las unidades de ese proyecto
  if (!unidadesDeProyecto().length) { notify('El proyecto "' + f.proyecto + '" no tiene unidades', 'error'); return; }
  cfFacturaAsignar = facturaId;
  cfPagoAsignar = null;
  cfCustomModo = 'pct';
  const tit = document.getElementById('asignar-titulo'); if (tit) tit.textContent = 'Repartir Factura (devengado)';

  const prov = f.nombre_proveedor || f.razon_social || ('ID ' + f.proveedor_id);
  // Reparto POR PARTES: lo ya repartido (puede venir de varias sub-partidas) y el restante.
  const asigsF = state.costoAsignaciones.filter(a => String(a.factura_id) === String(facturaId));
  const totalF = f.monto_total || 0;
  const yaRep = r2(asigsF.reduce((s, a) => s + (a.monto_asignado || 0), 0));
  const restante = r2(totalF - yaRep);
  cfFacturaRestante = restante > 0 ? restante : 0;
  const completa = restante <= 0.01;

  // Partes ya repartidas, agrupadas por sub-partida (o partida) para mostrarlas.
  const partesMap = new Map();
  asigsF.forEach(a => {
    const k = a.sub_partida_override || a.partida_override || '—';
    partesMap.set(k, r2((partesMap.get(k) || 0) + (a.monto_asignado || 0)));
  });
  const partesHTML = partesMap.size
    ? `<div style="margin-top:8px;font-size:11px;border-top:1px solid var(--border);padding-top:6px;">
         <div style="color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Partes ya repartidas</div>
         ${[...partesMap].map(([k, m]) => `<div style="display:flex;justify-content:space-between;"><span>${escapeHtml(k)}</span><span style="font-family:'DM Mono',monospace;">${fmt(m)}</span></div>`).join('')}
         <button type="button" class="btn btn-ghost btn-sm req-facturas" style="margin-top:6px;color:var(--red);" onclick="cfLimpiarRepartoFactura()">🗑 Limpiar reparto y rehacer</button>
       </div>`
    : '';

  document.getElementById('asignar-info').innerHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px;">
      <div style="font-weight:600;">🧾 Factura ${escapeHtml(f.numero_factura) || ''} · ${escapeHtml(prov)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(f.proyecto)} · devengado sobre el total de la factura</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px;font-size:12px;">
        <span>Total: <strong style="font-family:'DM Mono',monospace;">${fmt(totalF)}</strong></span>
        <span>Repartido: <strong style="font-family:'DM Mono',monospace;">${fmt(yaRep)}</strong></span>
        <span>Restante: <strong style="font-family:'DM Mono',monospace;color:${completa ? 'var(--green)' : 'var(--accent)'};">${fmt(restante)}</strong></span>
      </div>
      ${partesHTML}
    </div>
    ${completa
      ? '<div style="background:rgba(39,174,96,.1);border:1px solid rgba(39,174,96,.3);border-radius:8px;padding:10px;font-size:12px;">✅ Esta factura ya está 100% repartida. Para rehacerla usa "Limpiar reparto".</div>'
      : `<div style="margin-bottom:12px;">
           <label style="font-size:12px;color:var(--muted);">Monto a repartir en esta parte</label>
           <input id="rf-monto-parte" type="number" step="0.01" value="${restante}" oninput="cfPreviewReparto()" class="filter-select" style="width:170px;margin-top:4px;font-family:'DM Mono',monospace;text-align:right;">
           <div style="font-size:10px;color:var(--muted);margin-top:3px;">Si la factura es de UNA sola sub-partida, déjalo completo. Si se reparte entre varias, pon el monto de ESTA y repite con el resto.</div>
         </div>
         ${_repartoFacturaPartidaHTML('')}`}`;

  const radio = document.querySelector('input[name="cf-metodo"][value="directo"]');
  if (radio) radio.checked = true;
  renderMetodoBody();
  cfFacturaPartidaChange();                // arma la cascada de sub-partida (si hay selector)
  // Factura YA repartida en UNA sola parte: reconstruir el reparto original para verificarlo
  // (en vez del default "Directo"). Multi-parte se verifica con "Partes ya repartidas".
  if (completa && partesMap.size === 1) cfReconstruirRepartoFactura(asigsF);
  document.getElementById('modal-asignar-costo').classList.add('open');
}

// Selector de partida (+ sub-partida en cascada) para el reparto de factura.
function _repartoFacturaPartidaHTML(partidaSel) {
  const cats = (state.partidasCatalogo || []).filter(p => p.activa !== false);
  const opts = cats.map(p => `<option value="${escapeHtml(p.partida)}" ${p.partida === partidaSel ? 'selected' : ''}>${escapeHtml(p.partida)}</option>`).join('');
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
      <div><label style="font-size:12px;color:var(--muted);">Partida *</label>
        <select id="rf-partida" class="filter-select" style="width:100%;margin-top:4px;" onchange="cfFacturaPartidaChange()">
          <option value="">— Selecciona —</option>${opts}
        </select></div>
      <div id="rf-subpartida-wrap" style="display:none;"><label style="font-size:12px;color:var(--muted);">Sub-partida *</label>
        <select id="rf-subpartida" class="filter-select" style="width:100%;margin-top:4px;"></select></div>
    </div>`;
}

// Cascada: al elegir partida, puebla sub-partida si esa partida tiene sub-partidas.
export function cfFacturaPartidaChange() {
  const partSel = document.getElementById('rf-partida');
  const subWrap = document.getElementById('rf-subpartida-wrap');
  const subSel = document.getElementById('rf-subpartida');
  if (!partSel || !subSel) return;
  const cat = (state.partidasCatalogo || []).find(p => p.partida === partSel.value);
  const subs = (cat && Array.isArray(cat.subpartidas)) ? cat.subpartidas : [];
  if (subs.length) {
    subSel.innerHTML = '<option value="">— Selecciona —</option>' + subs.map(s => `<option>${escapeHtml(s)}</option>`).join('');
    if (subWrap) subWrap.style.display = '';
  } else {
    subSel.innerHTML = '';
    if (subWrap) subWrap.style.display = 'none';
  }
}

export async function eliminarAsignacionCosto(pagoId) {
  if (!(puedeEditar())) { notify('No tienes permiso para esta accion', 'error'); return; }
  if (!confirm('¿Quitar la asignación de costos de este pago?')) return;
  state.costoAsignaciones = state.costoAsignaciones.filter(a => String(a.pago_id) !== String(pagoId));
  await gsSaveCostoAsignaciones();
  notify('Asignación eliminada');
  renderPanel();
}

// Borra TODO el reparto (todas las partes/sub-partidas) de la factura abierta, para
// rehacerlo desde cero. Refresca el modal (restante vuelve al total).
export async function cfLimpiarRepartoFactura() {
  if (!(puedeFacturas())) { notify('Tu perfil no puede repartir facturas', 'error'); return; }
  if (!cfEsFactura()) return;
  if (!confirm('¿Borrar TODO el reparto de costos de esta factura para rehacerlo?')) return;
  const fid = cfFacturaAsignar;
  state.costoAsignaciones = state.costoAsignaciones.filter(a => String(a.factura_id) !== String(fid));
  await gsSaveCostoAsignaciones();
  if (window.renderFacturas) window.renderFacturas();
  abrirRepartirFactura(fid);   // reabre con restante = total
  notify('Reparto borrado. Puedes rehacerlo.');
}

export function cfCambiarMetodo() {
  renderMetodoBody();
}

function metodoSeleccionado() {
  const el = document.querySelector('input[name="cf-metodo"]:checked');
  return el ? el.value : 'directo';
}

function renderMetodoBody() {
  const body = document.getElementById('asignar-metodo-body');
  if (!body) return;
  const metodo = metodoSeleccionado();
  const unidades = unidadesDeProyecto();

  if (!unidades.length) {
    body.innerHTML = '<div class="cf-picker-vacio">No hay casas activas en este proyecto. Crea unidades primero.</div>';
    cfPreviewReparto();
    return;
  }

  if (metodo === 'directo') {
    body.innerHTML = `
      <label style="font-size:12px;color:var(--muted);">Casa que recibe el costo completo</label>
      <select id="asignar-unidad-directo" class="filter-select" style="width:100%;margin-top:4px;" onchange="cfPreviewReparto()">
        <option value="">— Selecciona la casa —</option>
        ${unidades.map(u => `<option value="${u.unidad_id}">${escapeHtml(u.nombre)}</option>`).join('')}
      </select>`;
  } else if (metodo === 'equitativo') {
    body.innerHTML = `
      <div class="cf-picker-tools">
        <input type="text" class="cf-picker-search" placeholder="🔍 Buscar casa..." oninput="cfFiltrarUnidades()">
        <button type="button" class="btn btn-ghost btn-sm" onclick="cfSelTodas(true)">Todas</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="cfSelTodas(false)">Ninguna</button>
      </div>
      <div class="cf-picker cols" id="cf-picker-lista">
        ${unidades.map(u => `
          <div class="cf-pick-row" data-nombre="${escapeHtml((u.nombre || '').toLowerCase().replace(/"/g, ''))}">
            <input type="checkbox" class="cf-unidad-check" value="${u.unidad_id}" id="cfchk-${u.unidad_id}" onchange="cfPreviewReparto()">
            <label for="cfchk-${u.unidad_id}">${escapeHtml(u.nombre)}</label>
          </div>`).join('')}
      </div>
      <div class="cf-picker-count" id="cf-picker-count"></div>`;
  } else if (metodo === 'custom') {
    const esPct = cfCustomModo !== 'monto';
    const btnModo = (val, etiq) => `<button type="button" class="btn btn-sm" onclick="cfCustomSetModo('${val}')" style="border:1px solid var(--border);border-radius:6px;${(esPct ? 'pct' : 'monto') === val ? 'background:var(--accent);color:#1d1d1d;font-weight:700;border-color:var(--accent);' : 'background:transparent;color:var(--muted);'}">${etiq}</button>`;
    body.innerHTML = `
      <div class="cf-picker-tools" style="flex-wrap:wrap;">
        <div style="display:flex;gap:4px;">${btnModo('pct', '% Porcentaje')}${btnModo('monto', '$ Monto')}</div>
        <input type="text" class="cf-picker-search" placeholder="🔍 Buscar casa..." oninput="cfFiltrarUnidades()">
        <button type="button" class="btn btn-ghost btn-sm" onclick="cfRepartirResto()">Repartir resto entre vacías</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="cfRepartirRestoIndiviso()">Repartir resto por indiviso</button>
      </div>
      <div class="cf-picker" id="cf-picker-lista">
        ${unidades.map(u => `
          <div class="cf-pick-row" data-nombre="${escapeHtml((u.nombre || '').toLowerCase().replace(/"/g, ''))}">
            <label>${escapeHtml(u.nombre)}</label>
            <input type="number" step="0.01" class="cf-custom-monto" data-uid="${u.unidad_id}" placeholder="${esPct ? '0.00 %' : '0.00'}"
              oninput="cfPreviewReparto()" style="text-align:right;font-family:'DM Mono',monospace;">
          </div>`).join('')}
      </div>
      <div class="cf-picker-count">${esPct ? 'Los porcentajes deben sumar <strong>100%</strong>' : 'Importe a repartir: <strong>' + fmt(cfImporteObjetivo()) + '</strong>'}</div>`;
  } else if (metodo === 'indiviso') {
    // Mostrar el pool REAL (mismo criterio que calcularReparto): solo las casas que seguían
    // en obra a la fecha del documento. El texto debe coincidir con lo que de verdad reparte.
    const fechaDoc = cfFechaObjetivo();
    const enObra = unidades.filter(u => unidadEnIndivisoAFecha(u, fechaDoc));
    const pool = enObra.length ? enObra : unidades;
    const fechaTxt = fechaDoc ? fmtFecha(fechaDoc) : 'hoy';
    const nota = pool.length === unidades.length ? ''
      : ` (de ${unidades.length} activas; las terminadas antes de esa fecha NO reciben costo)`;
    body.innerHTML = `
      <div style="font-size:12px;color:var(--muted);background:rgba(155,127,232,.1);border:1px solid rgba(155,127,232,.3);border-radius:8px;padding:10px;">
        El costo se repartirá por indiviso entre las <strong>${pool.length}</strong> casa(s) de ${escapeHtml(cfProyecto)}
        que seguían en obra al <strong>${fechaTxt}</strong>${nota}, según su % de indiviso.
      </div>`;
  }
  cfPreviewReparto();
}

// Al ABRIR una factura YA repartida en UNA sola parte, reconstruye en el formulario el
// reparto ORIGINAL (método + casas + montos) para poder verificarlo, en vez de dejar el
// default "Directo + primera casa". Solo LEE las asignaciones y pinta el DOM: NO toca
// costoAsignaciones ni el guardado (que además queda bloqueado al estar 100% repartida,
// ver guard en guardarAsignacionCosto). El método se guarda por fila
// ('directo'|'equitativo'|'custom'|'indiviso') y viaja a Supabase/Sheets, así que se
// reconstruye EXACTO sin adivinar. Devuelve true si reconstruyó.
function cfReconstruirRepartoFactura(asigsF) {
  const grupo = (asigsF || []).filter(a => (a.monto_asignado || 0) > 0);
  if (!grupo.length) return false;
  let metodo = grupo[0].metodo || 'directo';
  // Dato legacy sin método: 'directo' no puede repartirse a varias casas → mostrar como Personalizado.
  if (metodo === 'directo' && grupo.length > 1) metodo = 'custom';
  if (metodo === 'custom') cfCustomModo = 'monto';   // mostrar los montos exactos guardados

  const radio = document.querySelector(`input[name="cf-metodo"][value="${metodo}"]`);
  if (!radio) return false;
  radio.checked = true;
  renderMetodoBody();

  if (metodo === 'directo') {
    const sel = document.getElementById('asignar-unidad-directo');
    if (sel) sel.value = String(grupo[0].unidad_id);
  } else if (metodo === 'equitativo') {
    grupo.forEach(a => { const c = document.getElementById('cfchk-' + a.unidad_id); if (c) c.checked = true; });
  } else if (metodo === 'custom') {
    grupo.forEach(a => {
      const inp = document.querySelector(`.cf-custom-monto[data-uid="${a.unidad_id}"]`);
      if (inp) inp.value = r2(a.monto_asignado || 0);
    });
  }
  // 'indiviso': el cuerpo es informativo y el cálculo por indiviso se reproduce solo.
  cfPreviewReparto();
  return true;
}

// Cambia el modo de captura del método Personalizado entre % y $ (re-renderiza,
// lo que limpia los valores escritos). Default %.
export function cfCustomSetModo(modo) {
  cfCustomModo = (modo === 'monto') ? 'monto' : 'pct';
  renderMetodoBody();
}

// Filtra las casas del picker por nombre según lo escrito en el buscador.
export function cfFiltrarUnidades() {
  const lista = document.getElementById('cf-picker-lista');
  const search = document.querySelector('.cf-picker-search');
  if (!lista || !search) return;
  const q = search.value.trim().toLowerCase();
  lista.querySelectorAll('.cf-pick-row').forEach(row => {
    const match = !q || (row.dataset.nombre || '').includes(q);
    row.classList.toggle('oculto', !match);
  });
}

// Marca o desmarca todas las casas (método equitativo).
export function cfSelTodas(valor) {
  document.querySelectorAll('.cf-unidad-check').forEach(c => { c.checked = valor; });
  cfPreviewReparto();
}

function calcularReparto() {
  if (!cfObjetivoValido()) return [];
  const importe = cfImporteObjetivo();
  const metodo = metodoSeleccionado();
  const unidades = unidadesDeProyecto();

  if (metodo === 'directo') {
    const sel = document.getElementById('asignar-unidad-directo');
    const uid = sel ? parseInt(sel.value) : null;
    if (!uid) return [];
    return [{ unidad_id: uid, factor: 1, monto: r2(importe) }];
  }
  if (metodo === 'equitativo') {
    const sel = [...document.querySelectorAll('.cf-unidad-check:checked')].map(c => parseInt(c.value));
    if (!sel.length) return [];
    const n = sel.length;
    const base = r2(importe / n);
    const arr = sel.map((uid, i) => ({ unidad_id: uid, factor: 1 / n, monto: base }));
    const suma = r2(base * n);
    arr[n - 1].monto = r2(arr[n - 1].monto + (importe - suma));
    return arr;
  }
  if (metodo === 'custom') {
    const esPct = cfCustomModo !== 'monto';
    const arr = [];
    let suma = 0;
    document.querySelectorAll('.cf-custom-monto').forEach(inp => {
      const v = parseFloat(inp.value) || 0;
      if (v > 0) {
        const monto = esPct ? r2(importe * v / 100) : r2(v);
        arr.push({ unidad_id: parseInt(inp.dataset.uid), factor: importe > 0 ? monto / importe : 0, monto });
        suma += monto;
      }
    });
    // En modo %, si los porcentajes suman 100, ajusta el redondeo de la última casa para
    // que los montos cuadren EXACTO con el importe (si no suman 100, se deja para que la
    // validación marque el faltante).
    if (esPct && arr.length) {
      const sumaPct = [...document.querySelectorAll('.cf-custom-monto')].reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
      if (Math.abs(sumaPct - 100) < 0.01) arr[arr.length - 1].monto = r2(arr[arr.length - 1].monto + (importe - r2(suma)));
    }
    return arr;
  }
  if (metodo === 'indiviso') {
    // Pool de indiviso A LA FECHA del documento: solo las casas que seguían en obra entonces.
    // Si ninguna calificó (fecha rara), cae a todas las activas para no perder el reparto.
    const fechaDoc = cfFechaObjetivo();
    const pool0 = unidades.filter(u => unidadEnIndivisoAFecha(u, fechaDoc));
    const pool = pool0.length ? pool0 : unidades;
    if (!pool.length) return [];
    const totalPct = pool.reduce((s, u) => s + (u.indiviso_pct || 0), 0);
    let arr;
    if (totalPct <= 0) {
      const n = pool.length;
      const base = r2(importe / n);
      arr = pool.map(u => ({ unidad_id: u.unidad_id, factor: 1 / n, monto: base }));
    } else {
      arr = pool.map(u => {
        const factor = (u.indiviso_pct || 0) / totalPct;
        return { unidad_id: u.unidad_id, factor, monto: r2(importe * factor) };
      });
    }
    const suma = r2(arr.reduce((s, x) => s + x.monto, 0));
    if (arr.length) arr[arr.length - 1].monto = r2(arr[arr.length - 1].monto + (importe - suma));
    return arr;
  }
  return [];
}

// Reparte el monto restante del pago en partes iguales entre las casas
// que aún no tienen monto capturado (método personalizado).
export function cfRepartirResto() {
  if (!cfObjetivoValido()) return;
  const esPct = cfCustomModo !== 'monto';
  const inputs = [...document.querySelectorAll('.cf-custom-monto')];
  let asignado = 0;
  const vacias = [];
  inputs.forEach(inp => {
    const v = parseFloat(inp.value) || 0;
    if (v > 0) asignado += v;
    else vacias.push(inp);
  });
  if (!vacias.length) { notify('No hay casas vacías para repartir el resto', 'error'); return; }
  const total = esPct ? 100 : cfImporteObjetivo();
  const resto = r2(total - asignado);
  if (resto <= 0) { notify('Ya no queda ' + (esPct ? 'porcentaje' : 'monto') + ' por repartir', 'error'); return; }
  const base = r2(resto / vacias.length);
  vacias.forEach((inp, i) => {
    inp.value = (i === vacias.length - 1) ? r2(resto - base * (vacias.length - 1)) : base;
  });
  cfPreviewReparto();
}

// Reparte el monto restante por INDIVISO entre TODAS las casas activas, sumándolo a lo
// ya capturado (método personalizado). Sirve para repartos MIXTOS: parte directa a una
// casa + el resto al área común por indiviso (ej. factura "101 directo / resto amenidades").
export function cfRepartirRestoIndiviso() {
  if (!cfObjetivoValido()) return;
  const esPct = cfCustomModo !== 'monto';
  const inputs = [...document.querySelectorAll('.cf-custom-monto')];
  if (!inputs.length) return;
  let capturado = 0;
  inputs.forEach(inp => { capturado += parseFloat(inp.value) || 0; });
  const total = esPct ? 100 : cfImporteObjetivo();
  const resto = r2(total - capturado);
  if (resto <= 0) { notify('Ya no queda ' + (esPct ? 'porcentaje' : 'monto') + ' por repartir', 'error'); return; }
  // Pool de indiviso a la fecha del documento; cae a todas las activas si ninguna calificó.
  const fechaDoc = cfFechaObjetivo();
  const activas = unidadesDeProyecto();
  const pool = activas.filter(u => unidadEnIndivisoAFecha(u, fechaDoc));
  const unidades = pool.length ? pool : activas;
  if (!unidades.length) { notify('No hay casas activas en este proyecto', 'error'); return; }
  const totalPct = unidades.reduce((s, u) => s + (u.indiviso_pct || 0), 0);
  const byUid = new Map(inputs.map(inp => [parseInt(inp.dataset.uid), inp]));
  let suma = 0;
  const partes = unidades.map(u => {
    const factor = totalPct > 0 ? (u.indiviso_pct || 0) / totalPct : 1 / unidades.length;
    const val = r2(resto * factor);
    suma += val;
    return { uid: u.unidad_id, val };
  });
  // Ajuste de redondeo en la última casa para que cuadre exacto con el resto.
  if (partes.length) partes[partes.length - 1].val = r2(partes[partes.length - 1].val + (resto - suma));
  partes.forEach(p => {
    const inp = byUid.get(p.uid);
    if (inp) inp.value = r2((parseFloat(inp.value) || 0) + p.val);
  });
  cfPreviewReparto();
}

export function cfPreviewReparto() {
  // Contador de selección (método equitativo)
  const countEl = document.getElementById('cf-picker-count');
  if (countEl && metodoSeleccionado() === 'equitativo') {
    const total = document.querySelectorAll('.cf-unidad-check').length;
    const sel = document.querySelectorAll('.cf-unidad-check:checked').length;
    countEl.textContent = `${sel} de ${total} casa${total !== 1 ? 's' : ''} seleccionada${sel !== 1 ? 's' : ''}`;
  }
  const cont = document.getElementById('asignar-preview');
  if (!cont) return;
  const reparto = calcularReparto();
  if (!reparto.length) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0;">Selecciona al menos una unidad.</div>';
    return;
  }
  const suma = r2(reparto.reduce((s, x) => s + x.monto, 0));
  const ok = Math.abs(suma - cfImporteObjetivo()) < 0.01;
  cont.innerHTML = `
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 4px;">Vista previa del reparto</div>
    <div style="max-height:150px;overflow:auto;border:1px solid var(--border);border-radius:8px;">
      ${reparto.map(x => {
        const u = unidadById(x.unidad_id);
        return `<div style="display:flex;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--border);font-size:12px;">
          <span>${escapeHtml(u ? u.nombre : '#' + x.unidad_id)} <span style="color:var(--muted);">(${(x.factor * 100).toFixed(2)}%)</span></span>
          <span style="font-family:'DM Mono',monospace;">${fmt(x.monto)}</span>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:6px;font-weight:600;">
      <span>Total repartido</span>
      <span style="font-family:'DM Mono',monospace;color:${ok ? 'var(--green)' : 'var(--red)'};">${fmt(suma)}</span>
    </div>`;
}

export async function guardarAsignacionCosto() {
  if (!(puedeEditar() || puedeFacturas())) { notify('No tienes permiso para repartir costos', 'error'); return; }
  if (!cfObjetivoValido()) return;
  const esFact = cfEsFactura();
  const reparto = calcularReparto();
  if (!reparto.length) { notify('Selecciona al menos una unidad', 'error'); return; }
  const metodo = metodoSeleccionado();
  const importe = cfImporteObjetivo();

  // El método personalizado debe cuadrar exactamente (100% en modo %, o el importe en modo $).
  if (metodo === 'custom') {
    const suma = r2(reparto.reduce((s, x) => s + x.monto, 0));
    if (Math.abs(suma - importe) > 0.01) {
      if (cfCustomModo !== 'monto') {
        const sumaPct = [...document.querySelectorAll('.cf-custom-monto')].reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
        notify(`Los porcentajes deben sumar 100% (suman ${sumaPct.toFixed(2)}%)`, 'error');
      } else {
        notify(`La suma asignada (${fmt(suma)}) debe ser igual al importe a repartir (${fmt(importe)})`, 'error');
      }
      return;
    }
  }

  // Reparto de FACTURA: exige partida (y sub-partida si la partida la tiene).
  let partidaOv = '', subPartidaOv = '';
  if (esFact) {
    partidaOv = (document.getElementById('rf-partida')?.value || '').trim();
    if (!partidaOv) { notify('Selecciona la partida de la factura', 'error'); return; }
    const subWrap = document.getElementById('rf-subpartida-wrap');
    if (subWrap && subWrap.style.display !== 'none') {
      subPartidaOv = (document.getElementById('rf-subpartida')?.value || '').trim();
      if (!subPartidaOv) { notify('Selecciona la sub-partida', 'error'); return; }
    }
    // Reparto POR PARTES: la suma de partes NO puede pasar del total de la factura
    // (evita doble conteo). Cada parte ACUMULA; para rehacer, usa "Limpiar reparto".
    const fAct = facturaById(cfFacturaAsignar);
    const totalF = fAct ? (fAct.monto_total || 0) : 0;
    const yaRep = r2(state.costoAsignaciones.filter(a => String(a.factura_id) === String(cfFacturaAsignar)).reduce((s, a) => s + (a.monto_asignado || 0), 0));
    const parte = r2(reparto.reduce((s, x) => s + x.monto, 0));
    if (yaRep >= totalF - 0.01) { notify('Esta factura ya está 100% repartida. Usa "Limpiar reparto" para rehacerla.', 'error'); return; }
    if (r2(yaRep + parte) > r2(totalF) + 0.01) {
      notify(`Esta parte (${fmt(parte)}) excede el restante de la factura (${fmt(r2(totalF - yaRep))}).`, 'error');
      return;
    }
  }

  const hoy = new Date().toISOString().slice(0, 10);
  // Quitar reparto previo del MISMO objetivo (reasignación), sin tocar el otro tipo.
  // FACTURA: NO se borra — acumula por partes/sub-partidas (el guard de arriba evita pasar del total).
  if (!esFact) {
    state.costoAsignaciones = state.costoAsignaciones.filter(a => a.factura_id || String(a.pago_id) !== String(cfPagoAsignar));
  }

  reparto.forEach(x => {
    state.costoAsignaciones.push({
      asignacion_id: nuevoAsignacionId(),
      pago_id: esFact ? '' : String(cfPagoAsignar),
      factura_id: esFact ? String(cfFacturaAsignar) : '',
      unidad_id: x.unidad_id,
      proyecto: cfProyecto,
      metodo,
      monto_asignado: x.monto,
      factor: x.factor,
      fecha_asignacion: hoy,
      partida_override: partidaOv,
      sub_partida_override: subPartidaOv,
      partida_obra: '',   // Fase 2 (Control de Obra): el reparto de factura la elegirá
    });
  });

  await gsSaveCostoAsignaciones();
  if (esFact && window.renderFacturas) window.renderFacturas();
  if (esFact) {
    // Reparto por partes: si aún falta, reabre el modal para continuar con la siguiente
    // sub-partida; si ya quedó el total, cierra.
    const fNow = facturaById(cfFacturaAsignar);
    const yaNow = r2(state.costoAsignaciones.filter(a => String(a.factura_id) === String(cfFacturaAsignar)).reduce((s, a) => s + (a.monto_asignado || 0), 0));
    const restaNow = r2((fNow ? (fNow.monto_total || 0) : 0) - yaNow);
    if (restaNow > 0.01) {
      abrirRepartirFactura(cfFacturaAsignar);
      notify(`Parte repartida · falta repartir ${fmt(restaNow)}`);
    } else {
      cerrar('modal-asignar-costo');
      notify('✅ Factura 100% repartida');
    }
  } else {
    cerrar('modal-asignar-costo');
    notify('Costo asignado a ' + reparto.length + ' unidad(es)');
  }
  renderPanel();
}

// ========== TAB: PRESUPUESTOS ==========
function renderPresupuestosTab(panel) {
  const unidades = unidadesDeProyecto();
  if (!unidades.length) {
    panel.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">📋</div><div>Crea unidades antes de capturar presupuestos.</div></div>';
    return;
  }
  if (!cfUnidadDetalle || !unidades.find(u => u.unidad_id === cfUnidadDetalle)) {
    cfUnidadDetalle = unidades[0].unidad_id;
  }

  panel.innerHTML = `
    <div style="background:rgba(90,155,224,.07);border:1px solid rgba(90,155,224,.2);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <div style="font-size:12px;color:var(--muted);">Captura masiva (${escapeHtml(cfProyecto)}):</div>
      <button class="btn btn-ghost btn-sm" onclick="descargarPlantillaPresupuesto('${(cfProyecto || '').replace(/'/g, "\\'")}')">📥 Descargar plantilla</button>
      <label class="btn btn-ghost btn-sm req-obra" style="cursor:pointer;">
        📤 Subir plantilla
        <input type="file" accept=".xlsx,.xls" style="display:none;" onchange="handleSubirPlantillaPresupuesto(event)">
      </label>
      <div style="font-size:11px;color:var(--muted);flex:1;min-width:0;">Excel con 2 hojas (Presupuesto / Costo Inicial). Merge no destructivo.</div>
    </div>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
      <label style="font-size:12px;color:var(--muted);">Unidad:</label>
      <select id="cf-presup-unidad" class="filter-select">
        ${unidades.map(u => `<option value="${u.unidad_id}"${u.unidad_id === cfUnidadDetalle ? ' selected' : ''}>${escapeHtml(u.nombre)}</option>`).join('')}
      </select>
    </div>
    <div id="cf-presup-grid"></div>
  `;
  document.getElementById('cf-presup-unidad').addEventListener('change', e => {
    cfUnidadDetalle = parseInt(e.target.value);
    renderPresupuestoGrid();
  });
  renderPresupuestoGrid();
}

function renderPresupuestoGrid() {
  const cont = document.getElementById('cf-presup-grid');
  if (!cont) return;
  const rows = presupuestoRowsUnidad(cfUnidadDetalle);

  cont.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Partida</th>
          <th>Sub-partida</th>
          <th style="text-align:right">Presupuesto total</th>
          <th style="text-align:right">Costo inicial (saldo apertura)</th>
          <th></th>
        </tr></thead>
        <tbody id="cf-presup-tbody">
          ${rows.map((p, i) => presupuestoFilaHTML(p.partida, p.sub_partida, p.monto_presupuestado, p.costo_inicial, i)).join('')}
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap;">
      <button class="btn btn-ghost req-obra" onclick="cfAgregarPartidaPresup()">+ Agregar partida</button>
      <button class="btn btn-primary req-obra" onclick="guardarPresupuestoUnidad()">💾 Guardar presupuesto</button>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:8px;">
      Las partidas y sub-partidas son las del <strong>catálogo de admin</strong> — las mismas con que se clasifican facturas y pagos, para que el comparativo cruce directo.
      El <strong>costo inicial</strong> es lo ya gastado en esa partida antes de usar el sistema (proyectos empezados); para proyectos nuevos déjalo en 0.
    </div>
  `;
}

// Fila del grid: selects del catálogo ADMIN (sub-partida en cascada). Las filas
// legacy con nombres fuera del catálogo (p.ej. partidas de obra viejas) se
// muestran marcadas, con montos editables, para poder corregirlas o borrarlas.
function presupuestoFilaHTML(partida, sub, monto, costoIni, idx) {
  const cats = _catAdminActivas();
  const enCat = !partida || cats.some(p => p.partida === partida);
  const subs = partida ? _subsAdminDe(partida) : [];
  const partidaCell = enCat
    ? `<select class="cf-p-partida req-obra" style="width:100%;" onchange="cfPresupPartidaChange(this)">
        <option value="">— Selecciona —</option>
        ${cats.map(p => `<option value="${escapeHtml(p.partida)}"${p.partida === partida ? ' selected' : ''}>${escapeHtml(p.partida)}</option>`).join('')}
      </select>`
    : `<input type="hidden" class="cf-p-partida" value="${escapeHtml(partida)}"><span style="font-size:12px;">${escapeHtml(partida)}</span> <span style="font-size:10px;color:var(--orange);" title="Este nombre no está en el catálogo de admin: el comparativo no lo cruza con los costos. Bórralo y recaptúralo con el catálogo.">(fuera de catálogo)</span>`;
  const subCell = enCat
    ? `<select class="cf-p-sub req-obra" style="width:100%;${subs.length ? '' : 'display:none;'}">
        <option value="">— Selecciona —</option>
        ${subs.map(s => `<option${s === sub ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}
      </select>`
    : `<input type="hidden" class="cf-p-sub" value="${escapeHtml(sub || '')}"><span style="font-size:11px;color:var(--muted);">${escapeHtml(sub || '')}</span>`;
  return `<tr data-fila="${idx}">
    <td style="min-width:180px;">${partidaCell}</td>
    <td style="min-width:160px;">${subCell}</td>
    <td><input type="number" step="0.01" class="cf-p-monto req-obra" value="${monto || ''}" placeholder="0.00" style="width:130px;text-align:right;font-family:'DM Mono',monospace;"></td>
    <td><input type="number" step="0.01" class="cf-p-inicial req-obra" value="${costoIni || ''}" placeholder="0.00" style="width:130px;text-align:right;font-family:'DM Mono',monospace;"></td>
    <td style="text-align:right;"><button class="btn btn-ghost btn-sm req-obra" onclick="this.closest('tr').remove()" style="color:var(--red);">✕</button></td>
  </tr>`;
}

// Cascada del grid: al cambiar la partida de una fila, repuebla su sub-partida.
export function cfPresupPartidaChange(sel) {
  const tr = sel.closest('tr');
  const subSel = tr ? tr.querySelector('.cf-p-sub') : null;
  if (!subSel || subSel.tagName !== 'SELECT') return;
  const subs = _subsAdminDe(sel.value);
  if (subs.length) {
    subSel.innerHTML = '<option value="">— Selecciona —</option>' + subs.map(s => `<option>${escapeHtml(s)}</option>`).join('');
    subSel.style.display = '';
  } else {
    subSel.innerHTML = '';
    subSel.style.display = 'none';
  }
}

export function cfAgregarPartidaPresup() {
  if (!(puedeCapturarObra())) { notify('No tienes permiso para capturar presupuestos', 'error'); return; }
  const tbody = document.getElementById('cf-presup-tbody');
  if (!tbody) return;
  tbody.insertAdjacentHTML('beforeend', presupuestoFilaHTML('', '', 0, 0, tbody.children.length));
}

export async function guardarPresupuestoUnidad() {
  if (!(puedeCapturarObra())) { notify('No tienes permiso para capturar presupuestos', 'error'); return; }
  const tbody = document.getElementById('cf-presup-tbody');
  if (!tbody) return;
  const filas = [];
  let error = null;
  [...tbody.children].forEach(tr => {
    const pEl = tr.querySelector('.cf-p-partida');
    const partida = (pEl && pEl.value || '').trim();
    if (!partida) return;   // fila sin partida elegida: se ignora
    let sub = ((tr.querySelector('.cf-p-sub') || {}).value || '').trim();
    if (pEl.tagName === 'SELECT') {
      const subs = _subsAdminDe(partida);
      if (subs.length && !sub) { error = `Elige la sub-partida de "${partida}"`; return; }
      if (!subs.length) sub = '';
    }
    const monto = parseFloat((tr.querySelector('.cf-p-monto') || {}).value) || 0;
    const inicial = parseFloat((tr.querySelector('.cf-p-inicial') || {}).value) || 0;
    filas.push({ partida, sub, monto, inicial });
  });
  if (error) { notify(error, 'error'); return; }
  const llaveDe = (p, s) => _normPartCap(p) + '|' + _normPartCap(s);
  const llaves = new Set();
  for (const f of filas) {
    const k = llaveDe(f.partida, f.sub);
    if (llaves.has(k)) { notify(`Partida repetida en la captura: ${f.partida}${f.sub ? ' / ' + f.sub : ''}`, 'error'); return; }
    llaves.add(k);
  }
  // MERGE no destructivo por (unidad, partida, sub): actualiza EN SITIO conservando
  // presupuesto_id (nada de regenerar ids), crea solo las filas nuevas y elimina
  // únicamente las quitadas de la captura (también dedupe de llaves repetidas legacy).
  const previas = state.presupuestoUnidad.filter(p => p.unidad_id === cfUnidadDetalle);
  const porLlave = new Map(previas.map(p => [llaveDe(p.partida, p.sub_partida), p]));
  state.presupuestoUnidad = state.presupuestoUnidad.filter(p => {
    if (p.unidad_id !== cfUnidadDetalle) return true;
    const k = llaveDe(p.partida, p.sub_partida);
    return llaves.has(k) && porLlave.get(k) === p;
  });
  filas.forEach(f => {
    const ex = porLlave.get(llaveDe(f.partida, f.sub));
    if (ex) {
      ex.partida = f.partida; ex.sub_partida = f.sub;   // canonicaliza el texto al catálogo
      ex.monto_presupuestado = f.monto; ex.costo_inicial = f.inicial;
    } else {
      state.presupuestoUnidad.push({
        presupuesto_id: state.nextPresupuestoId++,
        unidad_id: cfUnidadDetalle,
        partida: f.partida,
        sub_partida: f.sub,
        monto_presupuestado: f.monto,
        costo_inicial: f.inicial,
        notas: '',
      });
    }
  });
  await gsSavePresupuestoUnidad();
  notify('Presupuesto guardado');
  renderPresupuestoGrid();   // refleja canonicalización y orden estable
}

// ========== TAB: REPORTES ==========
function renderReportesTab(panel) {
  const unidades = unidadesDeProyecto();
  if (!unidades.length) {
    panel.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">📊</div><div>Sin unidades en ' + escapeHtml(cfProyecto) + '.</div></div>';
    return;
  }

  const filas = unidades.map(u => {
    const presu = presupuestoTotalUnidad(u.unidad_id);
    const ini = costoInicialUnidad(u.unidad_id);
    const des = costoAsignadoDesglose(u.unidad_id);
    const real = ini + des.total;
    const av = avancePct(real, presu);
    return { u, presu, real, devengado: des.devengado, pagado: des.pagadoSinFactura, av, variacion: presu - real };
  });
  const totPresu = filas.reduce((s, f) => s + f.presu, 0);
  const totReal = filas.reduce((s, f) => s + f.real, 0);
  const totDev = filas.reduce((s, f) => s + f.devengado, 0);
  const totPag = filas.reduce((s, f) => s + f.pagado, 0);

  panel.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-label">Presupuesto total</div><div class="stat-value" style="color:var(--blue);">${fmt(totPresu)}</div><div class="stat-sub">${unidades.length} unidades</div></div>
      <div class="stat-card"><div class="stat-label">Devengado (facturas)</div><div class="stat-value" style="color:var(--accent);">${fmt(totDev)}</div><div class="stat-sub">Costo facturado</div></div>
      <div class="stat-card"><div class="stat-label">Pagado sin factura</div><div class="stat-value" style="color:var(--green);">${fmt(totPag)}</div><div class="stat-sub">Pagos sin CFDI</div></div>
      <div class="stat-card"><div class="stat-label">Costo real</div><div class="stat-value" style="color:var(--accent);">${fmt(totReal)}</div><div class="stat-sub">${totPresu > 0 ? 'Avance ' + (totReal / totPresu * 100).toFixed(1) + '%' : 'Inicial + asignaciones'}</div></div>
    </div>

    <div class="table-wrap" style="margin-bottom:20px;">
      <table>
        <thead><tr>
          <th>Unidad</th>
          <th style="text-align:right">Presupuesto</th>
          <th style="text-align:right">Devengado</th>
          <th style="text-align:right">Pagado s/fact</th>
          <th style="text-align:right">Costo real</th>
          <th style="text-align:right">Variación</th>
          <th style="width:140px;">% Avance</th>
          <th></th>
        </tr></thead>
        <tbody>${filas.map(f => `
          <tr>
            <td style="font-weight:600;">${escapeHtml(f.u.nombre)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(f.presu)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(f.devengado)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--green);">${fmt(f.pagado)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:600;">${fmt(f.real)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:${f.variacion < 0 ? 'var(--red)' : 'var(--green)'};">${fmt(f.variacion)}</td>
            <td>${barraAvance(f.av)}</td>
            <td style="text-align:right;"><button class="btn btn-ghost btn-sm" onclick="cfVerUnidad(${f.u.unidad_id})">Detalle</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    <div id="cf-detalle-unidad"></div>
  `;

  if (cfUnidadDetalle && unidades.find(u => u.unidad_id === cfUnidadDetalle)) {
    renderDetalleUnidad(cfUnidadDetalle);
  }
}

function avanceColor(pct) {
  if (pct === null) return 'var(--muted)';
  if (pct > 100) return 'var(--red)';
  if (pct >= 90) return 'var(--orange)';
  return 'var(--green)';
}

function barraAvance(pct) {
  if (pct === null) return '<span style="font-size:11px;color:var(--muted);">Sin presupuesto</span>';
  const w = Math.min(pct, 100);
  const color = avanceColor(pct);
  return `<div style="display:flex;align-items:center;gap:6px;">
    <div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${w}%;background:${color};"></div>
    </div>
    <span style="font-size:11px;font-family:'DM Mono',monospace;color:${color};min-width:42px;text-align:right;">${pct.toFixed(1)}%</span>
  </div>`;
}

export function cfVerUnidad(id) {
  cfUnidadDetalle = id;
  renderDetalleUnidad(id);
  const det = document.getElementById('cf-detalle-unidad');
  if (det) det.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderDetalleUnidad(id) {
  const cont = document.getElementById('cf-detalle-unidad');
  const u = unidadById(id);
  if (!cont || !u) return;

  const desg = desglosePorPartida(id);
  const partidas = Object.entries(desg).sort((a, b) => b[1].real - a[1].real);

  cont.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700;">${escapeHtml(u.nombre)} · desglose por partida</div>
        <div style="font-size:11px;color:var(--muted);">Indiviso ${(u.indiviso_pct || 0).toFixed(2)}%</div>
      </div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:18px;">
        <div>
          ${partidas.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Partida</th><th style="text-align:right">Presupuesto</th><th style="text-align:right">Real</th><th style="width:130px;">Avance</th></tr></thead>
              <tbody>${partidas.map(([p, v]) => `
                <tr>
                  <td style="font-size:12px;">${escapeHtml(p)}</td>
                  <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${fmt(v.presupuestado)}</td>
                  <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--accent);">${fmt(v.real)}${v.costoInicial > 0 ? `<div style="font-size:9px;color:var(--muted);">incl. ${fmt(v.costoInicial)} apertura</div>` : ''}</td>
                  <td>${barraAvance(avancePct(v.real, v.presupuestado))}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>` : '<div style="color:var(--muted);font-size:12px;">Sin partidas con presupuesto o costo.</div>'}
        </div>
        <div style="position:relative;height:240px;"><canvas id="cf-chart-unidad"></canvas></div>
      </div>
    </div>
  `;
  renderChartUnidad(partidas);
}

function renderChartUnidad(partidas) {
  const canvas = document.getElementById('cf-chart-unidad');
  if (!canvas) return;
  if (cfChartUnidad) { cfChartUnidad.destroy(); cfChartUnidad = null; }
  if (typeof Chart === 'undefined') return;
  const conCosto = partidas.filter(([, v]) => v.real > 0);
  if (!conCosto.length) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const th = chartTheme();   // var(--bg) NO funciona en canvas → color resuelto del tema
  cfChartUnidad = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: conCosto.map(e => e[0]),
      datasets: [{
        data: conCosto.map(e => e[1].real),
        backgroundColor: conCosto.map((_, i) => PALETA[i % PALETA.length]),
        borderColor: th.donutBorder, borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: th.ticksSoft, font: { size: 10 }, boxWidth: 10, padding: 6 } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.parsed)}` } }
      }
    }
  });
}

// ========== TAB: PLANO VISUAL ==========
let cfFormaArrastrada = false; // evita colocar pin tras soltar un arrastre

function colorDePin(u) {
  if (cfPlanoColor === 'estatus') return ESTATUS_COLOR[u.estatus] || '#888';
  const real = costoRealUnidad(u.unidad_id);
  const presu = presupuestoTotalUnidad(u.unidad_id);
  const pct = avancePct(real, presu);
  if (pct === null) return '#7a7570';
  if (pct > 100) return '#e05a5a';
  if (pct >= 90) return '#e07a3a';
  return '#4caf7d';
}

function renderPlanoTab(panel) {
  const plano = planoDeProyecto(cfProyecto);
  if (!plano) {
    panel.innerHTML = `<div class="empty-state">
      <div style="font-size:32px;margin-bottom:10px;opacity:.4">🗺️</div>
      <div>Aún no hay un plano cargado para <strong>${escapeHtml(cfProyecto)}</strong>.</div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px;">Envía la imagen del plano del desarrollo para activar esta vista.</div>
    </div>`;
    return;
  }
  const unidades = unidadesDeProyecto();
  const sinUbicar = unidades.filter(u => u.plano_x == null || u.plano_y == null);
  const sinZona = unidades.filter(u => !(u.plano_w > 0 && u.plano_h > 0));
  const editor = cfPlanoModo === 'editor';
  const editPines = editor && cfPlanoEditMode === 'pines';
  const editZonas = editor && cfPlanoEditMode === 'zonas';

  let indicador = '';
  let hint = '';
  if (editPines) {
    indicador = sinUbicar.length
      ? `Faltan <strong>${sinUbicar.length}</strong> · Siguiente: <strong>${escapeHtml(sinUbicar[0].nombre)}</strong> — haz clic en el plano para ubicarla`
      : 'Todas las casas tienen pin ✓';
    hint = 'Clic sobre el plano para colocar el siguiente pin · arrastra un pin para moverlo · ✕ lo quita · no olvides Guardar.';
  } else if (editZonas) {
    indicador = sinZona.length
      ? `<strong>${sinZona.length}</strong> sin zona · Siguiente: <strong>${escapeHtml(sinZona[0].nombre)}</strong> — clic-arrastra sobre el plano para dibujarla`
      : 'Todas las casas tienen zona ✓';
    hint = 'Clic-arrastra sobre el plano para dibujar una zona · clic en un pin lo convierte en zona · arrastra una zona para moverla, sus esquinas para redimensionarla, ✕ para quitarla.';
  }

  panel.innerHTML = `
    <div class="cf-plano-toolbar">
      <div class="cf-plano-modos">
        <button class="cf-plano-btn${!editor ? ' active' : ''}" data-modo="vista">👁 Vista</button>
        <button class="cf-plano-btn req-editor${editor ? ' active' : ''}" data-modo="editor">✏️ Editar</button>
      </div>
      ${editor ? `
        <div class="cf-plano-modos">
          <span style="font-size:11px;color:var(--muted);">Edit:</span>
          <button class="cf-plano-btn${editPines ? ' active' : ''}" data-editmode="pines">📍 Pines</button>
          <button class="cf-plano-btn${editZonas ? ' active' : ''}" data-editmode="zonas">▭ Zonas</button>
        </div>
        <div class="cf-plano-editor-info">${indicador}</div>
        <button class="btn btn-primary btn-sm" id="cf-plano-guardar">💾 Guardar</button>
      ` : `
        <div class="cf-plano-color">
          <span style="font-size:11px;color:var(--muted);">Color:</span>
          <button class="cf-plano-btn${cfPlanoColor === 'avance' ? ' active' : ''}" data-color="avance">% Avance</button>
          <button class="cf-plano-btn${cfPlanoColor === 'estatus' ? ' active' : ''}" data-color="estatus">Estatus</button>
        </div>
        <div id="cf-plano-leyenda" class="cf-plano-leyenda"></div>
      `}
    </div>
    ${!editor && sinUbicar.length ? `<div style="font-size:11px;color:var(--orange);margin-bottom:8px;">⚠ ${sinUbicar.length} casa(s) sin ubicar en el plano (usa "Editar").</div>` : ''}
    <div class="cf-plano-cont${editor ? ' editor' : ''}${editZonas ? ' zonas' : ''}" id="cf-plano-cont">
      <img src="${plano.img}" class="cf-plano-img" alt="Plano ${escapeHtml(cfProyecto)}" draggable="false">
      <div id="cf-plano-pins"></div>
      <div id="cf-plano-fantasma" class="cf-zona-fantasma" style="display:none;"></div>
      <div id="cf-plano-tooltip" class="cf-plano-tooltip" style="display:none;"></div>
    </div>
    ${editor
      ? `<div style="font-size:11px;color:var(--muted);margin-top:8px;">${hint}</div>`
      : '<div id="cf-detalle-unidad" style="margin-top:16px;"></div>'}
  `;
  renderPlanoFormas();
  setupPlanoInteraction();
}

// Renderiza pines y zonas. Una casa con plano_w/plano_h se dibuja como rectángulo;
// si solo tiene plano_x/plano_y se dibuja como pin (compatibilidad).
function renderPlanoFormas() {
  const cont = document.getElementById('cf-plano-pins');
  if (!cont) return;
  const editor = cfPlanoModo === 'editor';
  const editZonas = editor && cfPlanoEditMode === 'zonas';
  const editPines = editor && cfPlanoEditMode === 'pines';
  cont.innerHTML = unidadesDeProyecto()
    .filter(u => u.plano_x != null && u.plano_y != null)
    .map(u => {
      const color = colorDePin(u);
      const nombre = escapeHtml(u.nombre || '');
      // Zona (rectángulo)
      if (u.plano_w != null && u.plano_h != null && u.plano_w > 0 && u.plano_h > 0) {
        const left = u.plano_x - u.plano_w / 2;
        const top = u.plano_y - u.plano_h / 2;
        return `<div class="cf-zona${editZonas ? ' editable' : ''}" data-uid="${u.unidad_id}"
          style="left:${left}%;top:${top}%;width:${u.plano_w}%;height:${u.plano_h}%;border-color:${color};background:${color}33;"
          title="${nombre}">
          ${editZonas ? `
            <span class="cf-zona-label">${nombre}</span>
            <span class="cf-zona-handle nw" data-corner="nw"></span>
            <span class="cf-zona-handle ne" data-corner="ne"></span>
            <span class="cf-zona-handle sw" data-corner="sw"></span>
            <span class="cf-zona-handle se" data-corner="se"></span>
          ` : ''}
        </div>`;
      }
      // Pin (fallback)
      const pinTitle = editZonas ? 'Clic para convertir a zona' : nombre;
      return `<div class="cf-pin${editPines ? ' editable' : ''}${editZonas ? ' convertir' : ''}" data-uid="${u.unidad_id}"
        style="left:${u.plano_x}%;top:${u.plano_y}%;background:${color};" title="${pinTitle}"></div>`;
    }).join('');
}

function setupPlanoInteraction() {
  document.querySelectorAll('.cf-plano-btn[data-modo]').forEach(b => {
    b.addEventListener('click', () => { cfPlanoModo = b.dataset.modo; renderPanel(); });
  });
  document.querySelectorAll('.cf-plano-btn[data-editmode]').forEach(b => {
    b.addEventListener('click', () => { cfPlanoEditMode = b.dataset.editmode; renderPanel(); });
  });
  document.querySelectorAll('.cf-plano-btn[data-color]').forEach(b => {
    b.addEventListener('click', () => { cfPlanoColor = b.dataset.color; renderPanel(); });
  });
  const guardar = document.getElementById('cf-plano-guardar');
  if (guardar) guardar.addEventListener('click', cfGuardarPlano);

  const cont = document.getElementById('cf-plano-cont');
  if (!cont) return;

  // Hover/tooltip y click (detalle) — funcionan tanto en vista como en editor
  // (sin estorbar a drag/click-de-edición porque mouseenter/leave son neutros).
  cont.querySelectorAll('.cf-pin, .cf-zona').forEach(el => {
    const uid = parseInt(el.dataset.uid);
    el.addEventListener('mouseenter', () => mostrarTooltipPin(uid, el));
    el.addEventListener('mouseleave', ocultarTooltipPin);
  });

  if (cfPlanoModo === 'editor') {
    if (cfPlanoEditMode === 'pines') {
      // Colocar pin con clic sobre el plano vacío
      cont.addEventListener('click', e => {
        if (cfFormaArrastrada) { cfFormaArrastrada = false; return; }
        if (e.target.closest('.cf-pin') || e.target.closest('.cf-zona')) return;
        const sinUbicar = unidadesDeProyecto().filter(u => u.plano_x == null || u.plano_y == null);
        if (!sinUbicar.length) { notify('Todas las casas ya están ubicadas', 'error'); return; }
        const rect = cont.getBoundingClientRect();
        const u = sinUbicar[0];
        u.plano_x = r2(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
        u.plano_y = r2(Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)));
        renderPanel();
      });
      cont.querySelectorAll('.cf-pin').forEach(pin => {
        const uid = parseInt(pin.dataset.uid);
        pin.addEventListener('mousedown', e => {
          e.preventDefault();
          iniciarDragPin(uid, pin, cont);
        });
        pin.addEventListener('click', e => {
          if (cfFormaArrastrada) { cfFormaArrastrada = false; return; }
          e.stopPropagation();
          abrirPopupForma(uid, pin);
        });
      });
    } else if (cfPlanoEditMode === 'zonas') {
      // Clic en pin = convertir a zona
      cont.querySelectorAll('.cf-pin.convertir').forEach(pin => {
        const uid = parseInt(pin.dataset.uid);
        pin.addEventListener('click', e => {
          e.stopPropagation();
          cfConvertirPinAZona(uid);
        });
      });
      // Zonas: drag para mover, handles para redimensionar, clic para popup
      cont.querySelectorAll('.cf-zona').forEach(zona => {
        const uid = parseInt(zona.dataset.uid);
        zona.querySelectorAll('.cf-zona-handle').forEach(h => {
          h.addEventListener('mousedown', e => {
            e.stopPropagation();
            e.preventDefault();
            iniciarResizeZona(uid, h.dataset.corner, cont);
          });
        });
        zona.addEventListener('mousedown', e => {
          if (e.target.classList.contains('cf-zona-handle')) return;
          e.preventDefault();
          iniciarMoverZona(uid, zona, cont, e);
        });
        zona.addEventListener('click', e => {
          if (cfFormaArrastrada) { cfFormaArrastrada = false; return; }
          if (e.target.classList.contains('cf-zona-handle')) return;
          e.stopPropagation();
          abrirPopupForma(uid, zona);
        });
      });
      // Drag-to-draw sobre el plano vacío → siguiente casa sin zona
      cont.addEventListener('mousedown', e => {
        if (e.target.closest('.cf-zona') || e.target.closest('.cf-pin')) return;
        e.preventDefault();
        iniciarDibujoZona(cont, e);
      });
    }
  } else {
    // Vista: clic abre desglose
    cont.querySelectorAll('.cf-pin, .cf-zona').forEach(el => {
      const uid = parseInt(el.dataset.uid);
      el.addEventListener('click', () => {
        cfUnidadDetalle = uid;
        renderDetalleUnidad(uid);
        const d = document.getElementById('cf-detalle-unidad');
        if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
    renderLeyendaPlano();
  }
}

function iniciarDragPin(uid, pin, cont) {
  const u = unidadById(uid);
  if (!u) return;
  const rect = cont.getBoundingClientRect();
  let movido = false;
  function mover(ev) {
    movido = true;
    const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
    pin.style.left = x + '%';
    pin.style.top = y + '%';
    u.plano_x = r2(x);
    u.plano_y = r2(y);
  }
  function soltar() {
    document.removeEventListener('mousemove', mover);
    document.removeEventListener('mouseup', soltar);
    if (movido) cfFormaArrastrada = true;
  }
  document.addEventListener('mousemove', mover);
  document.addEventListener('mouseup', soltar);
}

// Dibuja una nueva zona con drag-to-draw sobre el plano y la asigna a la
// siguiente casa sin zona. Muestra un rectángulo "fantasma" durante el arrastre.
function iniciarDibujoZona(cont, eDown) {
  const sinZona = unidadesDeProyecto().filter(u => !(u.plano_w > 0 && u.plano_h > 0));
  if (!sinZona.length) { notify('Todas las casas ya tienen zona', 'error'); return; }
  const u = sinZona[0];
  const fantasma = document.getElementById('cf-plano-fantasma');
  const rect = cont.getBoundingClientRect();
  const startX = ((eDown.clientX - rect.left) / rect.width) * 100;
  const startY = ((eDown.clientY - rect.top) / rect.height) * 100;
  let curX = startX, curY = startY;
  function pintarFantasma() {
    const left = Math.max(0, Math.min(startX, curX));
    const top = Math.max(0, Math.min(startY, curY));
    const w = Math.min(100 - left, Math.abs(curX - startX));
    const h = Math.min(100 - top, Math.abs(curY - startY));
    if (!fantasma) return;
    fantasma.style.left = left + '%';
    fantasma.style.top = top + '%';
    fantasma.style.width = w + '%';
    fantasma.style.height = h + '%';
    fantasma.style.display = '';
  }
  function mover(ev) {
    curX = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    curY = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
    pintarFantasma();
  }
  function soltar() {
    document.removeEventListener('mousemove', mover);
    document.removeEventListener('mouseup', soltar);
    if (fantasma) fantasma.style.display = 'none';
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    // descartar rectángulos demasiado pequeños (probable clic accidental)
    if (w < 0.5 || h < 0.5) return;
    u.plano_x = r2((startX + curX) / 2);
    u.plano_y = r2((startY + curY) / 2);
    u.plano_w = r2(w);
    u.plano_h = r2(h);
    renderPanel();
  }
  pintarFantasma();
  document.addEventListener('mousemove', mover);
  document.addEventListener('mouseup', soltar);
}

// Mueve una zona existente arrastrando su interior. Mantiene w/h, ajusta x/y.
function iniciarMoverZona(uid, zonaEl, cont, eDown) {
  const u = unidadById(uid);
  if (!u) return;
  const rect = cont.getBoundingClientRect();
  const offsetX = ((eDown.clientX - rect.left) / rect.width) * 100 - u.plano_x;
  const offsetY = ((eDown.clientY - rect.top) / rect.height) * 100 - u.plano_y;
  const halfW = u.plano_w / 2;
  const halfH = u.plano_h / 2;
  let movido = false;
  function mover(ev) {
    movido = true;
    const mx = ((ev.clientX - rect.left) / rect.width) * 100 - offsetX;
    const my = ((ev.clientY - rect.top) / rect.height) * 100 - offsetY;
    const x = Math.max(halfW, Math.min(100 - halfW, mx));
    const y = Math.max(halfH, Math.min(100 - halfH, my));
    u.plano_x = r2(x);
    u.plano_y = r2(y);
    zonaEl.style.left = (x - halfW) + '%';
    zonaEl.style.top = (y - halfH) + '%';
  }
  function soltar() {
    document.removeEventListener('mousemove', mover);
    document.removeEventListener('mouseup', soltar);
    if (movido) cfFormaArrastrada = true;
  }
  document.addEventListener('mousemove', mover);
  document.addEventListener('mouseup', soltar);
}

// Redimensiona una zona arrastrando una esquina; la esquina opuesta queda fija.
function iniciarResizeZona(uid, corner, cont) {
  const u = unidadById(uid);
  if (!u) return;
  const rect = cont.getBoundingClientRect();
  // Coordenadas iniciales de la esquina FIJA (la opuesta a la que se arrastra)
  const halfW = u.plano_w / 2;
  const halfH = u.plano_h / 2;
  let fixX, fixY;
  if (corner === 'nw') { fixX = u.plano_x + halfW; fixY = u.plano_y + halfH; }
  else if (corner === 'ne') { fixX = u.plano_x - halfW; fixY = u.plano_y + halfH; }
  else if (corner === 'sw') { fixX = u.plano_x + halfW; fixY = u.plano_y - halfH; }
  else { fixX = u.plano_x - halfW; fixY = u.plano_y - halfH; } // 'se'

  let movido = false;
  function mover(ev) {
    movido = true;
    const cx = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    const cy = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
    const w = Math.max(0.5, Math.abs(cx - fixX));
    const h = Math.max(0.5, Math.abs(cy - fixY));
    u.plano_x = r2((fixX + cx) / 2);
    u.plano_y = r2((fixY + cy) / 2);
    u.plano_w = r2(w);
    u.plano_h = r2(h);
    // re-render solo de las formas (más fluido sin re-render del panel)
    renderPlanoFormas();
    // re-conectar handles a su zona (necesario porque innerHTML los reemplaza)
    setupPlanoInteraction();
  }
  function soltar() {
    document.removeEventListener('mousemove', mover);
    document.removeEventListener('mouseup', soltar);
    if (movido) cfFormaArrastrada = true;
  }
  document.addEventListener('mousemove', mover);
  document.addEventListener('mouseup', soltar);
}

// Quita la zona de una unidad por completo: limpia tamaño Y posición, así la
// casa queda "sin ubicar" en el plano (sin pin colgado).
function cfQuitarZona(uid) {
  const u = unidadById(uid);
  if (!u) return;
  u.plano_x = null;
  u.plano_y = null;
  u.plano_w = null;
  u.plano_h = null;
  renderPanel();
}

// Convierte el pin de una unidad en una zona default (4% × 3%) centrada en el pin.
function cfConvertirPinAZona(uid) {
  const u = unidadById(uid);
  if (!u || u.plano_x == null || u.plano_y == null) return;
  u.plano_w = 4;
  u.plano_h = 3;
  // asegurar que la zona quepa dentro del plano
  if (u.plano_x - u.plano_w / 2 < 0) u.plano_x = u.plano_w / 2;
  if (u.plano_x + u.plano_w / 2 > 100) u.plano_x = 100 - u.plano_w / 2;
  if (u.plano_y - u.plano_h / 2 < 0) u.plano_y = u.plano_h / 2;
  if (u.plano_y + u.plano_h / 2 > 100) u.plano_y = 100 - u.plano_h / 2;
  renderPanel();
}

// Popup contextual al hacer clic sobre un pin o una zona en modo editor.
// Reemplaza visualmente al ✕ colgante. Anclado al elemento clickeado.
function popupOutsideClick(e) {
  const popup = document.getElementById('cf-plano-popup');
  if (popup && !popup.contains(e.target)) cerrarPopupForma();
}
function popupEscHandler(e) {
  if (e.key === 'Escape') cerrarPopupForma();
}

function cerrarPopupForma() {
  const popup = document.getElementById('cf-plano-popup');
  if (popup) popup.remove();
  document.removeEventListener('mousedown', popupOutsideClick);
  document.removeEventListener('keydown', popupEscHandler);
}

function abrirPopupForma(uid, refEl) {
  const u = unidadById(uid);
  if (!u) return;
  cerrarPopupForma();

  const esZona = u.plano_w > 0 && u.plano_h > 0;
  const nombre = escapeHtml(u.nombre || '—');
  const tipo = escapeHtml(u.tipo || '');
  const estatus = escapeHtml(u.estatus || '—');

  const popup = document.createElement('div');
  popup.id = 'cf-plano-popup';
  popup.className = 'cf-plano-popup';
  popup.innerHTML = `
    <div class="cf-popup-header">
      <span class="cf-popup-dot" style="background:${colorDePin(u)};"></span>
      <span class="cf-popup-nombre">${nombre}</span>
      <button class="cf-popup-close" type="button" title="Cerrar">✕</button>
    </div>
    <div class="cf-popup-datos">
      ${tipo ? `<div><span>Tipo:</span> ${tipo}</div>` : ''}
      <div><span>Estatus:</span> ${estatus}</div>
      <div><span>Indiviso:</span> ${(u.indiviso_pct || 0).toFixed(2)}%</div>
      ${u.superficie_m2 ? `<div><span>Superficie:</span> ${u.superficie_m2} m²</div>` : ''}
    </div>
    <div class="cf-popup-acciones">
      <button class="btn btn-ghost btn-sm" type="button" data-action="editar">✏️ Editar</button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="quitar" style="color:var(--red);">🗑️ Quitar del plano</button>
    </div>`;
  document.body.appendChild(popup);

  // Anclar al lado derecho del elemento; si se sale, voltear al lado izquierdo.
  const r = refEl.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.left = (r.right + 8) + 'px';
  popup.style.top = r.top + 'px';
  // Clamp dentro del viewport tras medir
  setTimeout(() => {
    const pr = popup.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) {
      popup.style.left = Math.max(8, r.left - pr.width - 8) + 'px';
    }
    if (pr.bottom > window.innerHeight - 8) {
      popup.style.top = (window.innerHeight - pr.height - 8) + 'px';
    }
    if (parseFloat(popup.style.top) < 8) popup.style.top = '8px';
  }, 0);

  popup.querySelector('.cf-popup-close').addEventListener('click', cerrarPopupForma);
  popup.querySelector('[data-action="editar"]').addEventListener('click', () => {
    cerrarPopupForma();
    editarUnidad(uid);
  });
  popup.querySelector('[data-action="quitar"]').addEventListener('click', () => {
    cerrarPopupForma();
    if (esZona) cfQuitarZona(uid);
    else cfQuitarPin(uid);
  });

  // Cerrar al hacer clic fuera o con ESC (en el próximo tick para no atrapar el clic actual)
  setTimeout(() => {
    document.addEventListener('mousedown', popupOutsideClick);
    document.addEventListener('keydown', popupEscHandler);
  }, 0);
}

function mostrarTooltipPin(uid, pin) {
  const u = unidadById(uid);
  const tip = document.getElementById('cf-plano-tooltip');
  const cont = document.getElementById('cf-plano-cont');
  if (!u || !tip || !cont) return;
  const real = costoRealUnidad(u.unidad_id);
  const presu = presupuestoTotalUnidad(u.unidad_id);
  const av = avancePct(real, presu);
  tip.innerHTML = `<strong>${escapeHtml(u.nombre)}</strong><br>`
    + `Costo real: ${fmt(real)}<br>`
    + (presu > 0 ? `Presupuesto: ${fmt(presu)}<br>Avance: ${av.toFixed(1)}%<br>` : 'Sin presupuesto<br>')
    + `Estatus: ${escapeHtml(u.estatus) || '—'}`;
  const pinRect = pin.getBoundingClientRect();
  const contRect = cont.getBoundingClientRect();
  tip.style.left = (pinRect.left - contRect.left + pinRect.width / 2) + 'px';
  tip.style.top = (pinRect.top - contRect.top - 8) + 'px';
  tip.style.display = '';
}

function ocultarTooltipPin() {
  const tip = document.getElementById('cf-plano-tooltip');
  if (tip) tip.style.display = 'none';
}

function renderLeyendaPlano() {
  const el = document.getElementById('cf-plano-leyenda');
  if (!el) return;
  const items = cfPlanoColor === 'estatus'
    ? ESTATUS_UNIDAD.map(e => [e, ESTATUS_COLOR[e] || '#888'])
    : [['En presupuesto', '#4caf7d'], ['Cerca del límite', '#e07a3a'], ['Sobre presupuesto', '#e05a5a'], ['Sin presupuesto', 'var(--muted)']];
  el.innerHTML = items.map(([t, c]) =>
    `<span class="cf-ley-item"><span class="cf-ley-dot" style="background:${c};"></span>${t}</span>`).join('');
}

function cfQuitarPin(uid) {
  const u = unidadById(uid);
  if (!u) return;
  u.plano_x = null;
  u.plano_y = null;
  renderPanel();
}

async function cfGuardarPlano() {
  if (!puedeEditar()) { notify('No tienes permiso para editar el plano', 'error'); return; }
  await gsSaveUnidades();
  notify('Plano guardado');
}

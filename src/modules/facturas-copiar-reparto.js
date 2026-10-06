// ============================================================================
// 📋 Copiar reparto de pagos (solo admin) — reparte facturas SIN reparto copiando el
// reparto de sus pagos ligados, casa por casa. Motor puro en
// services/copiar-reparto-pago.js; aquí: datos de la app, candados, Excel de vista
// previa, confirmación y guardado.
//
// Blindajes:
//   - Solo admin; un solo proceso a la vez (sin doble clic); exige datos cargados.
//   - Solo las facturas 100% claras (los pagos cubren la factura completa, mismo
//     proyecto, repartidos completos, sin casas escrituradas a la fecha, partida del
//     catálogo); lo demás va a "Revisar" / "Parciales" y no se toca.
//   - El costo por casa no cambia (el Excel lo compara casa por casa).
//   - Al aplicar se vuelve a calcular: si una factura cambió desde la vista previa, se salta.
//   - Los repartos de los pagos NO se borran. Re-correr no duplica (ya tienen reparto).
// ============================================================================

import { state, esAdmin, nuevoAsignacionId } from '../state.js';
import { fmt, fmtFecha } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { gsSaveCostoAsignaciones } from '../services/google-sync.js';
import { parseFechaHist } from './historial.js';
import { _pagosCapitalSet, _tipoAsignacion, _pagosCubiertosPorFacturaSet, _facturasCanceladasSet, _factExistSet, _pagoExistSet } from './costos-fiscales.js';
import { unidadEnIndivisoAFecha, fechaCierreUnidad } from '../config/costos-fiscales.js';
import { planCopiarReparto, limitarPorGrupos } from '../services/copiar-reparto-pago.js';

const S = v => String(v == null ? '' : v);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const TOPE = 150;   // facturas por corrida (sin partir grupos que comparten pago); re-correr sigue con el resto
const NECESARIOS = { facturas: 'Facturas', costoAsignaciones: 'Repartos', historial: 'Historial de pagos', facturaPagos: 'Pagos de facturas', unidades: 'Unidades', partidasCatalogo: 'Partidas' };

let _enCurso = false;
let _pendiente = null;   // { partes } si el guardado quedó incompleto (lo pendiente sigue en memoria)

function _sello() {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return { txt: `${fmtFecha(iso)} ${p2(d.getHours())}:${p2(d.getMinutes())}`, archivo: `${iso}_${p2(d.getHours())}${p2(d.getMinutes())}` };
}

function _progreso(texto) {
  let el = document.getElementById('copiarrep-progreso-flotante');
  if (texto == null) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'copiarrep-progreso-flotante';
    el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#1a1a1a;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.3);';
    document.body.appendChild(el);
  }
  el.textContent = texto;
}

// Datos de la app para el motor (todo leído de state; nada se modifica).
function _datos() {
  const capital = _pagosCapitalSet();
  const repartidas = new Set((state.costoAsignaciones || []).filter(a => a.factura_id).map(a => S(a.factura_id)));
  const uById = new Map((state.unidades || []).map(u => [S(u.unidad_id), u]));
  const ligas = [];
  (state.facturaPagos || []).forEach(fp => {
    if (S(fp.pago_id) === '' || S(fp.factura_id) === '') return;
    ligas.push({ facturaId: S(fp.factura_id), pagoId: S(fp.pago_id), aplicado: Number(fp.monto_aplicado) || 0 });
  });
  (state.historial || []).forEach(h => {
    if (h.factura_id != null && S(h.factura_id) !== '' && S(h.id) !== '') ligas.push({ facturaId: S(h.factura_id), pagoId: S(h.id), aplicado: null });
  });
  return {
    facturas: (state.facturas || []).map(f => ({
      id: S(f.factura_id), proyecto: S(f.proyecto), total: Number(f.monto_total) || 0, fecha: parseFechaHist(f.fecha_factura),
      valida: (f.tipo_comprobante || 'Factura') === 'Factura' && f.estado_sat !== 'Cancelada' && f.estatus_factura !== 'cancelada' && (Number(f.monto_total) || 0) > 0 && !!S(f.proyecto),
      repartida: repartidas.has(S(f.factura_id)),
    })),
    pagos: (state.historial || []).map(h => ({ id: S(h.id), proyecto: S(h.proyecto), importe: Number(h.importe) || 0, partida: S(h.partida), sub: S(h.sub_partida), capital: capital.has(S(h.id)) })),
    ligas,
    asigPagos: (state.costoAsignaciones || []).filter(a => S(a.pago_id) !== '' && !a.factura_id).map(a => ({
      pagoId: S(a.pago_id), unidadId: S(a.unidad_id), monto: Number(a.monto_asignado) || 0, metodo: S(a.metodo),
      partidaOv: S(a.partida_override), subOv: S(a.sub_partida_override),
    })),
    unidades: (state.unidades || []).map(u => ({ id: S(u.unidad_id), nombre: S(u.nombre), proyecto: S(u.proyecto) })),
    cerradaA: (uid, fecha) => {
      const u = uById.get(S(uid));
      if (!u || !fecha || unidadEnIndivisoAFecha(u, fecha)) return '';
      return fechaCierreUnidad(u) ? `escriturada ${fmtFecha(fechaCierreUnidad(u))}` : 'dada de baja';
    },
    catalogo: state.partidasCatalogo || [],
  };
}

// Asignación de factura a partir de una fila del plan.
function _asignacion(f, o, hoyISO, unidadOrig) {
  return {
    asignacion_id: nuevoAsignacionId(),
    pago_id: '',
    factura_id: S(f.factura_id),
    unidad_id: unidadOrig.has(o.unidadId) ? unidadOrig.get(o.unidadId) : o.unidadId,
    proyecto: f.proyecto,
    metodo: o.metodo,
    monto_asignado: o.monto,
    factor: o.factor,
    fecha_asignacion: hoyISO,
    partida_override: o.partida,
    sub_partida_override: o.sub,
    partida_obra: ''
  };
}

// Costo por casa con la MISMA lógica de Costos por Unidad (_tipoAsignacion: devengado de
// facturas + pagos no cubiertos). Cálculo síncrono sobre una lista dada; no guarda nada.
function _costoPorCasaApp(asigs) {
  const prev = state.costoAsignaciones;
  try {
    state.costoAsignaciones = asigs;   // los Sets de abajo leen state.costoAsignaciones
    const cub = _pagosCubiertosPorFacturaSet(), canc = _facturasCanceladasSet(), fe = _factExistSet(), pe = _pagoExistSet(), cap = _pagosCapitalSet();
    const m = new Map();
    asigs.forEach(a => { if (_tipoAsignacion(a, cub, canc, fe, pe, cap)) m.set(S(a.unidad_id), (m.get(S(a.unidad_id)) || 0) + (Number(a.monto_asignado) || 0)); });
    return m;
  } finally {
    state.costoAsignaciones = prev;
  }
}

// Comprobación independiente: costo por casa ANTES vs DESPUÉS de copiar (solo casas tocadas).
function _chequeoCosto(lim) {
  const fById = new Map((state.facturas || []).map(f => [S(f.factura_id), f]));
  const unidadOrig = new Map((state.unidades || []).map(u => [S(u.unidad_id), u.unidad_id]));
  const hoyISO = new Date().toISOString().slice(0, 10);
  const nuevas = lim.ahora.flatMap(c => c.filas.map(o => _asignacion(fById.get(S(c.factura.id)), o, hoyISO, unidadOrig)));
  const antes = _costoPorCasaApp(state.costoAsignaciones);
  const despues = _costoPorCasaApp([...state.costoAsignaciones, ...nuevas]);
  const casas = [...new Set(lim.ahora.flatMap(c => c.filas.map(o => S(o.unidadId))))];
  const uById = new Map((state.unidades || []).map(u => [S(u.unidad_id), u]));
  return casas.map(u => ({
    casa: S((uById.get(u) || {}).nombre) || u, proyecto: S((uById.get(u) || {}).proyecto),
    antes: r2(antes.get(u) || 0), despues: r2(despues.get(u) || 0), dif: r2((despues.get(u) || 0) - (antes.get(u) || 0)),
  })).sort((a, b) => a.proyecto.localeCompare(b.proyecto) || a.casa.localeCompare(b.casa, undefined, { numeric: true }));
}

// ---------- Excel de vista previa ----------
function _excel(plan, lim, sello, chequeo) {
  const wb = XLSX.utils.book_new();
  const hoja = (nombre, aoa, anchos, cMoney = [], filtro = true) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = anchos.map(w => ({ wch: w }));
    for (let r = 1; r < aoa.length; r++) cMoney.forEach(c => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00';
    });
    if (filtro && aoa.length > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  };
  const fById = new Map((state.facturas || []).map(f => [S(f.factura_id), f]));
  const nomU = new Map((state.unidades || []).map(u => [S(u.unidad_id), S(u.nombre)]));
  const fac = id => { const f = fById.get(S(id)) || {}; return [S(id), S(f.numero_factura), S(f.nombre_proveedor || f.razon_social), fmtFecha(f.fecha_factura), S(f.proyecto), Number(f.monto_total) || 0]; };
  const encFac = ['Factura (ID)', 'Folio', 'Proveedor', 'Fecha', 'Proyecto', 'Total'];
  const pagosTxt = partes => partes.map(p => `#${p.pagoId} ${fmt(p.aplicado)}`).join(' · ');
  const totLista = l => r2(l.reduce((s, x) => s + (Number(x.factura.total) || 0), 0));
  const difMax = c => c.comparacion.reduce((m, x) => Math.max(m, Math.abs(x.dif)), 0);
  const ligasDe = new Map();
  (state.facturaPagos || []).forEach(fp => ligasDe.set(S(fp.factura_id), [...(ligasDe.get(S(fp.factura_id)) || []), `#${fp.pago_id} ${fmt(Number(fp.monto_aplicado) || 0)}`]));
  (state.historial || []).forEach(h => { if (h.factura_id != null && S(h.factura_id) !== '') ligasDe.set(S(h.factura_id), [...(ligasDe.get(S(h.factura_id)) || []), `#${h.id} (marcador)`]); });

  const difTotal = r2(chequeo.reduce((s, x) => s + Math.abs(x.dif), 0));
  hoja('Resumen', [
    ['Copiar reparto de pagos a facturas sin reparto — vista previa'],
    [`Corte: ${sello.txt} · Solo se copian las facturas 100% claras; lo demás NO se toca. Los repartos de los pagos no se borran.`],
    [],
    ['Grupo', 'Facturas', 'Total facturas'],
    ['Se copian en esta corrida', lim.ahora.length, totLista(lim.ahora)],
    ['Se copian en la siguiente corrida (tope por corrida)', lim.despues.length, totLista(lim.despues)],
    ['Parciales (los pagos cubren solo una parte) — no se tocan', plan.parciales.length, totLista(plan.parciales)],
    ['Revisar (cualquier duda) — no se tocan', plan.revisar.length, totLista(plan.revisar)],
    [],
    ['Cambio en el costo por casa (suma de diferencias, debe ser ≈ $0)', difTotal],
  ], [62, 12, 18], [1, 2], false);
  hoja('Se copian', [[...encFac, 'Pagos (aplicado)', 'Partes por partida', 'Filas', 'Mayor diferencia por casa'],
    ...lim.ahora.map(c => [...fac(c.factura.id), pagosTxt(c.partes), c.porPartida.map(p => `${p.partida}: ${fmt(p.monto)}`).join(' · '), c.filas.length, r2(difMax(c))])],
  [10, 14, 32, 11, 18, 14, 50, 70, 7, 14], [5, 9]);
  hoja('Reparto por casa', [['Factura (ID)', 'Casa', 'Partida', 'Sub-partida', 'Método', 'Monto', '% de la factura'],
    ...lim.ahora.flatMap(c => c.filas.map(o => [S(c.factura.id), nomU.get(o.unidadId) || o.unidadId, o.partida, o.sub, o.metodo, o.monto, Math.round(o.factor * 1000000) / 10000]))],
  [10, 8, 18, 28, 11, 14, 14], [5]);
  hoja('Costo antes vs después', [['Proyecto', 'Casa', 'Costo por casa ANTES', 'Costo por casa DESPUÉS', 'Diferencia'],
    ...chequeo.map(x => [x.proyecto, x.casa, x.antes, x.despues, x.dif])],
  [22, 8, 20, 22, 12], [2, 3, 4]);
  hoja('Parciales', [[...encFac, 'Cubren los pagos', 'Motivo', 'Pagos'],
    ...plan.parciales.map(p => [...fac(p.factura.id), r2(p.cubierto), p.motivo, pagosTxt(p.partes.map(x => ({ pagoId: x.pagoId, aplicado: x.aplicado })))])],
  [10, 14, 32, 11, 18, 14, 16, 50, 50], [5, 6]);
  hoja('Revisar', [[...encFac, 'Motivo (no se copia)', 'Pagos ligados'],
    ...plan.revisar.map(r => [...fac(r.factura.id), r.motivo, (ligasDe.get(S(r.factura.id)) || []).join(' · ')])],
  [10, 14, 32, 11, 18, 14, 90, 50], [5]);
  if (lim.despues.length) hoja('Siguiente corrida', [[...encFac, 'Pagos (aplicado)'], ...lim.despues.map(c => [...fac(c.factura.id), pagosTxt(c.partes)])], [10, 14, 32, 11, 18, 14, 50], [5]);
  XLSX.writeFile(wb, `Copiar_reparto_pagos_vista_previa_${sello.archivo}.xlsx`);
}

// ---------- Aplicar y guardar ----------
function _aplicar(lim) {
  // Re-cálculo AL APLICAR: solo se copia lo que sigue idéntico a la vista previa.
  const fresco = planCopiarReparto(_datos());
  const huellas = new Map(fresco.copiar.map(c => [S(c.factura.id), c.huella]));
  const unidadOrig = new Map((state.unidades || []).map(u => [S(u.unidad_id), u.unidad_id]));
  const hoyISO = new Date().toISOString().slice(0, 10);
  const saltadas = [], nuevas = [];
  let facturas = 0;
  lim.ahora.forEach(c => {
    const id = S(c.factura.id);
    const f = (state.facturas || []).find(x => S(x.factura_id) === id);
    if (!f || huellas.get(id) !== c.huella) { saltadas.push(`Fac ${id}: cambió desde la vista previa`); return; }
    c.filas.forEach(o => nuevas.push(_asignacion(f, o, hoyISO, unidadOrig)));
    huellas.delete(id);   // ya repartida: no se repite en esta misma corrida
    facturas++;
  });
  // Todo o nada en memoria: se agregan juntas al final (si algo fallara antes, no queda nada a medias).
  if (nuevas.length) state.costoAsignaciones.push(...nuevas);
  return { facturas, filas: nuevas.length, saltadas };
}

async function _guardar(partes) {
  _progreso('Guardando repartos… no cierres ni recargues la app');
  try {
    const res = await gsSaveCostoAsignaciones({
      onProgress: (k, n) => _progreso(`Guardando ${k} de ${n} asignaciones… no cierres ni recargues la app`)
    });
    if (res && res.ok) {
      _pendiente = null;
      notify([...partes, `${res.subidas} asignaciones guardadas`].join(' · '));
    } else {
      _pendiente = { partes };
      notify(`⛔ ${res ? res.pendientes : '?'} asignaciones NO se guardaron (${res ? (res.error || res.motivo || 'error') : 'sin respuesta'}). No recargues: vuelve a pulsar "📋 Copiar reparto de pagos" para reintentar el guardado.`, 'error');
    }
  } catch (e) {
    _pendiente = { partes };
    notify(`⛔ Se cortó el guardado (${(e && e.message) || e}). No recargues: vuelve a pulsar "📋 Copiar reparto de pagos" para reintentar.`, 'error');
  } finally {
    _progreso(null);
    if (window.renderFacturas) window.renderFacturas();
  }
}

export async function copiarRepartoPagos() {
  if (!esAdmin()) { notify('Solo el admin puede copiar repartos de pagos', 'error'); return; }
  if (_enCurso) { notify('Ya hay una copia de repartos en curso; espera a que termine', 'error'); return; }
  _enCurso = true;
  try {
    if (_pendiente) { await _guardar(_pendiente.partes); return; }   // reintenta SOLO lo pendiente
    const falta = Object.keys(NECESARIOS).filter(e => !state.cargado || state.cargado[e] !== true);
    if (falta.length) { notify(`No se cargaron bien: ${falta.map(e => NECESARIOS[e]).join(', ')}. Recarga la página antes de copiar repartos.`, 'error'); return; }
    if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
    _progreso('Buscando facturas sin reparto con pagos repartidos…');
    const datos = _datos();
    const plan = planCopiarReparto(datos);
    const lim = limitarPorGrupos(plan.copiar, TOPE, datos.ligas);
    const chequeo = _chequeoCosto(lim);
    _excel(plan, lim, _sello(), chequeo);
    _progreso(null);
    // Candado: si la comprobación independiente (lógica de Costos por Unidad) encuentra
    // cualquier casa con más de $1 de diferencia, NO se aplica nada.
    const malas = chequeo.filter(x => Math.abs(x.dif) > 1);
    if (malas.length) {
      notify(`⛔ La comprobación encontró ${malas.length} casa(s) cuyo costo cambiaría (p. ej. ${malas[0].casa}: ${fmt(malas[0].dif)}). No se aplica nada; revisa la hoja "Costo antes vs después" del Excel.`, 'error');
      return;
    }
    const tot = l => fmt(r2(l.reduce((s, x) => s + (Number(x.factura.total) || 0), 0)));
    const resumen = `• Se copian: ${lim.ahora.length} (${tot(lim.ahora)})${lim.despues.length ? `\n• En la siguiente corrida: ${lim.despues.length}` : ''}\n`
      + `• Parciales (no se tocan): ${plan.parciales.length}\n• Revisar (no se tocan): ${plan.revisar.length}`;
    if (!lim.ahora.length) { notify(`Nada que copiar.\n${resumen}\nSe descargó el Excel con el detalle.`, 'error'); return; }
    const texto = `📋 Copiar reparto de pagos a facturas sin reparto\n\n${resumen}\n\n`
      + `Comprobación con la lógica de Costos por Unidad: el costo de las ${chequeo.length} casa(s) tocadas cambia en total ${fmt(r2(chequeo.reduce((s, x) => s + Math.abs(x.dif), 0)))} (centavos de redondeo): el costo por casa no cambia.\n`
      + 'Se descargó un Excel con el detalle (hoja "Costo antes vs después").\n'
      + 'Cada factura recibe el MISMO reparto de sus pagos (casas, montos y partida). Los repartos de los pagos no se borran; todo queda en la bitácora.\n\n'
      + `¿Copiar el reparto a ${lim.ahora.length} factura(s)?`;
    if (!confirm(texto)) return;
    const res = _aplicar(lim);
    const partes = [`✓ ${res.facturas} factura(s) repartida(s) con el reparto de sus pagos`];
    if (res.saltadas.length) partes.push(`saltadas: ${res.saltadas.length} (${res.saltadas[0]}${res.saltadas.length > 1 ? '…' : ''})`);
    if (!res.filas) { notify(partes.join(' · '), 'error'); return; }
    await _guardar(partes);
  } catch (e) {
    console.error('Copiar reparto de pagos:', e);
    notify(`⛔ Algo falló (${(e && e.message) || e}). No se cambió nada.`, 'error');
  } finally {
    _enCurso = false;
    _progreso(null);
  }
}

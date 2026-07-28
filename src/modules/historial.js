import { state, datosListos, puedeEditar, esAdmin } from '../state.js';
import { fmt, dl, fmtFecha, escapeHtml } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { proyTag, catTag } from '../ui/badges.js';
import { gsSaveHistorial, gsSaveProyectos, gsSaveCuentasPropias, gsSaveTraspasos, gsSaveCostoAsignaciones, gsSaveFacturaPagos, purgarAsignacionesDePago, purgarFacturaPagosDePagos, esPorFila, sbGuardarFila, sbBorrarFila } from '../services/google-sync.js';
import { saveProy, proyectoMatch } from '../config/proyectos.js';
import { getPartidasParaSelect, getSubPartidas, subPartidaObligatoria } from '../config/sub-partidas.js';

// Selección para borrado en bloque del historial (por id estable del pago).
const histSel = new Set();

export function renderHistorial() {
  const el = document.getElementById('historial-lista');
  if (!el) return;

  if (!datosListos()) {
    el.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div>';
    const sub = document.getElementById('hist-subtitulo'); if (sub) sub.textContent = '';
    const cnt = document.getElementById('cnt-hist'); if (cnt) cnt.textContent = '0';
    return;
  }

  refreshHistProyectos();
  refreshHistPartidas();
  refreshHistSubPartidas();
  if (!state.historial.length) {
    el.innerHTML = `<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">📋</div><div>Sin registros aún</div></div>`;
    document.getElementById('hist-subtitulo').textContent = '';
    return;
  }

  const fil = getFilteredHistorial();

  // Total sumado de lo que quedó tras los filtros (vacío = $0.00).
  const _htot = document.getElementById('hist-total');
  if (_htot) {
    const total = fil.reduce((s, h) => s + (parseFloat(h.importe) || 0), 0);
    _htot.innerHTML = `Total filtrado: <b style="color:var(--accent);font-family:'DM Mono',monospace;">${fmt(total)}</b>`;
  }

  const sub = document.getElementById('hist-subtitulo');
  if (fil.length !== state.historial.length) {
    sub.textContent = `${fil.length} de ${state.historial.length} registros`;
  } else {
    sub.textContent = `${state.historial.length} registros`;
  }

  if (!fil.length) {
    el.innerHTML = `<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin resultados con los filtros actuales</div></div>`;
    return;
  }

  const TRUNC = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
  el.innerHTML = fil.map(h => {
    const badgeColors = { 'Crédito': 'rgba(142,68,173,.15);color:#8e44ad', 'Pago': 'rgba(200,169,110,.15);color:var(--accent)', 'Préstamo': 'rgba(200,169,110,.15);color:var(--accent)', 'Aportación': 'rgba(39,174,96,.15);color:#27ae60', 'Traspaso': 'rgba(52,152,219,.15);color:#3498db' };
    const tipoLabel = h.tipo_registro === 'Crédito' ? 'Crédito' : h.tipo_registro !== 'Traspaso' ? 'Pago' : (h.tipo || 'Traspaso');
    const trBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${badgeColors[tipoLabel] || badgeColors['Pago']};">${tipoLabel}</span>`;
    const prov = (h.proveedor_id && h.tipo_registro !== 'Traspaso' && h.tipo_registro !== 'Crédito') ? state.proveedores.find(p => p.id === parseInt(h.proveedor_id)) : null;
    const tipoProv = prov?.categoria || '—';
    const subcat = (prov?.categoria === 'Proveedor' && prov?.subcategoria) ? prov.subcategoria : '—';
    const partidaVal = h.partida || '—';
    const subPartidaVal = h.sub_partida || '—';
    const conceptoVal = h.concepto || '';
    return `<div class="hist-row"><div style="text-align:center;"><input type="checkbox" class="req-admin" ${histSel.has(String(h.id)) ? 'checked' : ''} onclick="toggleHistSel('${String(h.id).replace(/'/g, "\\'")}', event)" style="cursor:pointer;" title="Seleccionar"></div><div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${h.proveedor_id || '—'}</div><div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${h.factura_id || '—'}</div><div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(h.fecha)}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${escapeHtml(h.cuenta_origen || '')}">${escapeHtml(h.cuenta_origen || '—')}</div><div style="${TRUNC}"><div style="font-weight:500;font-size:12px;${TRUNC}" title="${escapeHtml(h.nombre)}">${escapeHtml(h.nombre)}</div><div style="font-size:11px;color:var(--muted);${TRUNC}">${escapeHtml(h.banco)} · ${escapeHtml(h.tipo)}</div></div><div>${trBadge}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${escapeHtml(tipoProv)}">${escapeHtml(tipoProv)}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${escapeHtml(subcat)}">${escapeHtml(subcat)}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${escapeHtml(partidaVal)}">${escapeHtml(partidaVal)}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${escapeHtml(subPartidaVal)}">${escapeHtml(subPartidaVal)}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${escapeHtml(conceptoVal)}">${escapeHtml(conceptoVal || '—')}</div><div style="font-family:'DM Mono',monospace;font-weight:500;color:var(--accent);text-align:right;">${fmt(h.importe)}</div><div>${proyTag(h.proyecto)}</div><div style="text-align:right;display:flex;gap:2px;justify-content:flex-end;"><button class="btn btn-ghost btn-sm" onclick="editarPartidaPago(${state.historial.indexOf(h)})" style="font-size:11px;padding:2px 5px;" title="Editar partida / sub-partida">✏️</button><button class="btn btn-ghost btn-sm" onclick="eliminarHistorial(${state.historial.indexOf(h)})" style="color:#e74c3c;font-size:11px;padding:2px 5px;" title="Eliminar">✕</button></div></div>`;
  }).join('');

  // Borrado en bloque: descarta de la selección ids que ya no existen y refresca la barra.
  const idsActuales = new Set(state.historial.map(h => String(h.id)));
  [...histSel].forEach(id => { if (!idsActuales.has(id)) histSel.delete(id); });
  actualizarBarraSelHist();
}

function refreshHistProyectos() {
  const sel = document.getElementById('fh-proy');
  if (!sel) return;
  const val = sel.value;
  const opts = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
  sel.innerHTML = '<option value="">Todos los proyectos</option>' + opts.map(n => `<option>${escapeHtml(n)}</option>`).join('');
  sel.value = val;
}

function refreshHistPartidas() {
  const sel = document.getElementById('fh-partida');
  if (!sel) return;
  const val = sel.value;
  // Partidas del catálogo activo + las que aparezcan en historial pero no en
  // catálogo (legacy) para no perder filtro de pagos viejos.
  const enHistorial = [...new Set(state.historial.map(h => h.partida).filter(Boolean))];
  const opts = getPartidasParaSelect(enHistorial);
  sel.innerHTML = '<option value="">Todas las partidas</option>' +
    opts.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
  sel.value = val;
}

function refreshHistSubPartidas() {
  const sel = document.getElementById('fh-subpartida');
  if (!sel) return;
  const val = sel.value;
  // Cascada del catálogo ACTIVO: las sub-partidas dependen de la partida elegida.
  // Solo CONSTRUCCION tiene sub-partidas (getSubPartidas devuelve [] para las demás),
  // así que el filtro se deshabilita y se resetea cuando no aplica.
  const partidaSel = document.getElementById('fh-partida')?.value || '';
  const subs = getSubPartidas(partidaSel);
  if (!subs.length) {
    sel.innerHTML = '<option value="">Todas las sub-partidas</option>';
    sel.value = '';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.innerHTML = '<option value="">Todas las sub-partidas</option>' +
    subs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  sel.value = subs.includes(val) ? val : '';
}

export function exportarHistorial() {
  if (!state.historial.length) { notify('Sin historial', 'error'); return; }
  const data = getFilteredHistorial();
  if (!data.length) { notify('Sin registros con los filtros actuales', 'error'); return; }
  let csv = 'ID Prov,ID Fact,Fecha,Origen,Beneficiario,Banco,Tipo Cuenta,Tipo,Categoria,Subcategoria,Partida,Sub-partida,Concepto,Importe,Proyecto\n';
  csv += data.map(h => {
    const prov = (h.proveedor_id && h.tipo_registro !== 'Traspaso' && h.tipo_registro !== 'Crédito') ? state.proveedores.find(p => p.id === parseInt(h.proveedor_id)) : null;
    const tipo = h.tipo_registro === 'Crédito' ? 'Crédito' : h.tipo_registro === 'Traspaso' ? (h.tipo === 'Préstamo' ? 'Préstamo' : 'Aportación') : 'Pago';
    const categoria = prov?.categoria || '';
    const subcat = (prov?.categoria === 'Proveedor' && prov?.subcategoria) ? prov.subcategoria : '';
    return `${h.proveedor_id || ''},${h.factura_id || ''},${fmtFecha(h.fecha)},"${h.cuenta_origen || ''}","${h.nombre}",${h.banco},${h.tipo},${tipo},${categoria},${subcat},"${h.partida || ''}","${h.sub_partida || ''}","${h.concepto}",${h.importe},"${h.proyecto}"`;
  }).join('\n');
  dl(csv, 'historial_pagos_dehur.csv');
  notify('Historial exportado (' + data.length + ' registros)');
}

function getFilteredHistorial() {
  const q = (document.getElementById('buscar-hist')?.value || '').toLowerCase();
  const ft = document.getElementById('fh-tipo')?.value || '';
  const fp = document.getElementById('fh-proy')?.value || '';
  const fpart = document.getElementById('fh-partida')?.value || '';
  const fsub = document.getElementById('fh-subpartida')?.value || '';
  const fd = document.getElementById('fh-desde')?.value || '';
  const fh2 = document.getElementById('fh-hasta')?.value || '';
  return state.historial.filter(h => {
    if (q && !(/^\d+$/.test(q) ? String(h.proveedor_id) === q : h.nombre.toLowerCase().includes(q))) return false;
    if (ft) {
      const tipoLabel = h.tipo_registro === 'Crédito' ? 'Crédito'
                      : h.tipo_registro !== 'Traspaso' ? 'Pago'
                      : (h.tipo || 'Traspaso');
      if (tipoLabel !== ft) return false;
    }
    if (fp && !proyectoMatch(h.proyecto, fp)) return false;
    if (fpart && (h.partida || '') !== fpart) return false;
    if (fsub && (h.sub_partida || '') !== fsub) return false;
    if (fd || fh2) {
      const iso = parseFechaHist(h.fecha);
      if (fd && iso < fd) return false;
      if (fh2 && iso > fh2) return false;
    }
    return true;
  });
}

// ---- ELIMINAR REGISTRO DE HISTORIAL ----
export function revertirSaldo(nombreCuenta, monto, fechaISO) {
  if (!nombreCuenta) return false;
  const proy = state.proyectos.find(x => x.nombre === nombreCuenta);
  if (proy && proy.ultima_act_saldo) {
    if (fechaISO >= proy.ultima_act_saldo.slice(0, 10)) {
      proy.saldo = (proy.saldo || 0) + monto;
      return true;
    }
    return false;
  }
  const extra = state.cuentasPropias.find(x => x.nombre === nombreCuenta || x.proyecto === nombreCuenta);
  if (extra && extra.ultima_actualizacion) {
    if (fechaISO >= extra.ultima_actualizacion.slice(0, 10)) {
      extra.saldo = (extra.saldo || 0) + monto;
      return true;
    }
  }
  return false;
}

// Ordena state.historial in-place por fecha descendente (más reciente arriba),
// con desempate por id descendente. Filas con fecha inválida/vacía van al inicio.
export function sortHistorialByFecha() {
  state.historial.sort((a, b) => {
    const isoA = parseFechaHist(a.fecha);
    const isoB = parseFechaHist(b.fecha);
    const invA = !isoA;
    const invB = !isoB;
    if (invA && !invB) return -1;
    if (!invA && invB) return 1;
    if (isoA !== isoB) return isoB.localeCompare(isoA);
    return (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0);
  });
}

export function parseFechaHist(fecha) {
  if (!fecha) return '';
  fecha = String(fecha);   // blindaje: un dato no-string jamás debe tronar renders/filtros
  if (fecha.includes('-') && fecha.length >= 10) return fecha.slice(0, 10);
  const parts = fecha.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return '';
}

export function eliminarHistorial(idx) {
  const h = state.historial[idx];
  if (!h) return;
  if (!confirm(`¿Eliminar este registro?\n${h.nombre} — $${fmt(h.importe)}`)) return;

  const fechaISO = parseFechaHist(h.fecha);
  let saldoChanged = false;

  if (h.tipo_registro === 'Traspaso') {
    if (revertirSaldo(h.cuenta_origen, +h.importe, fechaISO)) saldoChanged = true;
    if (revertirSaldo(h.cuenta_destino, -h.importe, fechaISO)) saldoChanged = true;
  } else if (h.tipo_registro === 'Pago' && h.cuenta_origen) {
    if (revertirSaldo(h.cuenta_origen, +h.importe, fechaISO)) saldoChanged = true;
  }

  if (saldoChanged) {
    saveProy(state.proyectos);
    gsSaveProyectos();
    gsSaveCuentasPropias();
    if (window.renderCuentasPropias) window.renderCuentasPropias();
    if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
    if (window.renderHeaderBadges) window.renderHeaderBadges();
  }

  // Eliminar traspaso correspondiente en módulo de Traspasos. La FECHA (normalizada
  // a ISO en ambos lados) va en la llave: sin ella, con montos recurrentes se
  // borraba el traspaso de OTRO mes (mismo defecto que el sync, fix 87a6b56).
  if (h.tipo_registro === 'Traspaso') {
    const _fH = parseFechaHist(h.fecha) || h.fecha || '';
    const ti = state.traspasos.findIndex(t =>
      t.proyecto_origen === h.cuenta_origen &&
      t.cuenta_destino_nombre === h.nombre &&
      t.monto === h.importe &&
      (parseFechaHist(t.fecha) || t.fecha || '') === _fH
    );
    if (ti !== -1) {
      const _tid = state.traspasos[ti].traspaso_id;
      state.traspasos.splice(ti, 1);
      // POR FILA: el espejo de tabla completa (DELETE×N + INSERT×N en Supabase)
      // generaba una tormenta de eventos realtime que hacía rebotar la lista.
      const _pfT = esPorFila('traspasos');
      gsSaveTraspasos({ porFila: _pfT });
      if (_pfT) sbBorrarFila('traspasos', _tid);
      if (window.renderTraspasos) window.renderTraspasos();
      if (window.renderResumenTraspasos) window.renderResumenTraspasos();
      const cntT = document.getElementById('cnt-traspasos');
      if (cntT) cntT.textContent = state.traspasos.length;
    }
  }

  state.historial.splice(idx, 1);
  const _pfHist = esPorFila('historial');
  gsSaveHistorial({ porFila: _pfHist });
  if (_pfHist && h.id) sbBorrarFila('historial', h.id);
  // Limpiar asignaciones de costo fiscal ligadas a este pago (evita huérfanas)
  if (h.id) purgarAsignacionesDePago(h.id);
  // Si estaba ligado a una factura: quitar su facturaPago y revertir la factura.
  if (h.id) purgarFacturaPagosDePagos([h.id]);
  document.getElementById('cnt-hist').textContent = state.historial.length;
  renderHistorial();
  if (window.renderCostosFiscales) window.renderCostosFiscales();
  notify('Registro eliminado del historial');
}

// ---- BORRADO EN BLOQUE ----
// Marca/desmarca un pago en la selección (por id estable). No re-renderiza la
// lista entera (solo refresca la barra) para que sea ágil al clickear varios.
export function toggleHistSel(id, ev) {
  if (ev) ev.stopPropagation();
  const key = String(id);
  if (histSel.has(key)) histSel.delete(key); else histSel.add(key);
  actualizarBarraSelHist();
}

// Checkbox "seleccionar todos": marca/desmarca todos los registros VISIBLES
// (los que pasan los filtros actuales).
export function toggleHistSelAll(check) {
  const fil = getFilteredHistorial();
  fil.forEach(h => {
    const key = String(h.id);
    if (check) histSel.add(key); else histSel.delete(key);
  });
  renderHistorial();
}

// Muestra/oculta los botones de acción en bloque (eliminar / cambiar partida)
// según la selección.
function actualizarBarraSelHist() {
  const n = histSel.size;
  const btn = document.getElementById('hist-bulk-del');
  if (btn) { btn.style.display = n > 0 ? '' : 'none'; btn.textContent = `🗑 Eliminar seleccionados (${n})`; }
  const btnCp = document.getElementById('hist-bulk-partida');
  if (btnCp) { btnCp.style.display = n > 0 ? '' : 'none'; btnCp.textContent = `🏷 Cambiar partida (${n})`; }
}

// ---- CAMBIAR PARTIDA / SUB-PARTIDA ----
// Objetivo del modal: { modo:'single'|'bulk', id? }.
let _cpTarget = null;

// Editar la partida/sub de UN pago (por índice en state.historial).
export function editarPartidaPago(idx) {
  const h = state.historial[idx];
  if (!h) return;
  _cpTarget = { modo: 'single', id: String(h.id) };
  const t = document.getElementById('cp-titulo');
  if (t) t.textContent = `Editar pago — ${h.nombre || ''}`;
  _poblarModalPartida(h.partida || '', h.sub_partida || '');
  // Editor de PROVEEDOR (solo single): buscador con el proveedor ACTUAL precargado. Al cambiarlo
  // se arrastra beneficiario/banco/tipo (ver aplicarCambiarPartida).
  const pvw = document.getElementById('cp-prov-wrap');
  const pvb = document.getElementById('cp-prov-buscar');
  const pvi = document.getElementById('cp-proveedor-id');
  const pvd = document.getElementById('cp-prov-dd');
  if (pvw) pvw.style.display = '';
  if (pvb) pvb.value = h.nombre || '';
  if (pvi) pvi.value = h.proveedor_id != null ? String(h.proveedor_id) : '';
  if (pvd) pvd.style.display = 'none';
  // Editor de fecha (solo modo single): mostrar y pre-llenar con la fecha actual
  // en ISO (lo que pide el input type=date).
  const fw = document.getElementById('cp-fecha-wrap');
  const fi = document.getElementById('cp-fecha');
  if (fw) fw.style.display = '';
  if (fi) fi.value = parseFechaHist(h.fecha) || '';
  document.getElementById('modal-cambiar-partida').classList.add('open');
}

// Poner la MISMA partida/sub a todos los seleccionados.
export function abrirCambiarPartidaBulk() {
  if (!esAdmin()) { notify('Solo el admin puede cambiar partida en bloque', 'error'); return; }
  if (!histSel.size) { notify('No hay pagos seleccionados', 'error'); return; }
  { const _pvw = document.getElementById('cp-prov-wrap'); if (_pvw) _pvw.style.display = 'none'; }  // bulk: sin editor de proveedor
  _cpTarget = { modo: 'bulk' };
  const t = document.getElementById('cp-titulo');
  if (t) t.textContent = `Cambiar partida — ${histSel.size} pago(s) seleccionado(s)`;
  _poblarModalPartida('', '');
  // En bulk NO se edita la fecha (no tiene sentido la misma fecha para todos).
  const fw = document.getElementById('cp-fecha-wrap'); if (fw) fw.style.display = 'none';
  document.getElementById('modal-cambiar-partida').classList.add('open');
}

// Pagos involucrados según el modo (single = ese id; bulk = los seleccionados).
function _pagosObjetivo() {
  if (!_cpTarget) return [];
  return _cpTarget.modo === 'bulk'
    ? state.historial.filter(h => histSel.has(String(h.id)))
    : state.historial.filter(h => String(h.id) === _cpTarget.id);
}

// Llena el select de partidas (catálogo + legacy de los pagos involucrados) y la
// cascada de subpartida. partidaActual/subActual pre-seleccionan (modo single).
function _poblarModalPartida(partidaActual, subActual) {
  const selP = document.getElementById('cp-partida');
  if (!selP) return;
  const legacy = [...new Set(_pagosObjetivo().map(h => h.partida).filter(Boolean))];
  if (partidaActual) legacy.push(partidaActual);
  const opts = getPartidasParaSelect(legacy);
  selP.innerHTML = '<option value="">— Selecciona partida —</option>' +
    opts.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
  selP.value = partidaActual || '';
  selP.dataset.subActual = subActual || '';
  actualizarSubpartidaCambiar();
}

// Cascada: la sub-partida solo aplica/se muestra si la partida es CONSTRUCCION.
export function actualizarSubpartidaCambiar() {
  const selP = document.getElementById('cp-partida');
  const wrap = document.getElementById('cp-sub-wrap');
  const selS = document.getElementById('cp-subpartida');
  if (!selP || !wrap || !selS) return;
  if (subPartidaObligatoria(selP.value)) {
    const subs = getSubPartidas(selP.value);
    selS.innerHTML = '<option value="">— Selecciona sub-partida —</option>' +
      subs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    selS.value = selP.dataset.subActual || '';
    wrap.style.display = '';
  } else {
    selS.innerHTML = '';
    wrap.style.display = 'none';
  }
}

// Buscador de PROVEEDOR para el modal de editar pago (mismo patrón que facturas.js).
// onmousedown en los items (no onclick) para que corra ANTES del blur del input.
export function cpFiltrarProv() {
  const input = document.getElementById('cp-prov-buscar');
  const dd = document.getElementById('cp-prov-dd');
  if (!input || !dd) return;
  const q = input.value.trim().toLowerCase();
  if (!q) { dd.style.display = 'none'; return; }
  const results = state.proveedores.filter(p => p.activo !== false &&
    (/^\d+$/.test(q) ? String(p.id).includes(q) : (p.nombre || '').toLowerCase().includes(q))
  ).slice(0, 15);
  if (!results.length) {
    dd.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--muted);">Sin resultados</div>';
    dd.style.display = 'block'; return;
  }
  dd.innerHTML = results.map(p =>
    `<div onmousedown="cpSelProv(${p.id})" style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border);" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='transparent'"><span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);margin-right:6px;">${p.id}</span>${escapeHtml(p.nombre)}</div>`
  ).join('');
  dd.style.display = 'block';
}

export function cpSelProv(id) {
  const p = state.proveedores.find(x => x.id === id);
  if (!p) return;
  const input = document.getElementById('cp-prov-buscar');
  const hid = document.getElementById('cp-proveedor-id');
  const dd = document.getElementById('cp-prov-dd');
  if (input) input.value = p.nombre || '';
  if (hid) hid.value = String(p.id);
  if (dd) dd.style.display = 'none';
}

// Aplica la partida/sub elegida al pago (single) o a los seleccionados (bulk),
// guarda en Sheets + Supabase, y refresca historial + costos.
export function aplicarCambiarPartida() {
  if (!_cpTarget) return;
  if (!puedeEditar()) { notify('No tienes permiso para editar', 'error'); return; }
  if (_cpTarget.modo === 'bulk' && !esAdmin()) { notify('Solo el admin puede cambiar partida en bloque', 'error'); return; }
  const partida = document.getElementById('cp-partida').value;
  if (!partida) { notify('Elige una partida', 'error'); return; }
  let sub = '';
  if (subPartidaObligatoria(partida)) {
    sub = document.getElementById('cp-subpartida').value;
    if (!sub) { notify('CONSTRUCCION requiere elegir una sub-partida', 'error'); return; }
  }
  const objetivos = _pagosObjetivo();
  if (!objetivos.length) { notify('No encontré los pagos a cambiar', 'error'); return; }
  objetivos.forEach(h => { h.partida = partida; h.sub_partida = sub; });

  // Editor de PROVEEDOR (solo single): al cambiar el proveedor, arrastra beneficiario/banco/tipo del
  // proveedor elegido y SINCRONIZA el proveedor_id de los facturaPagos ligados (para no dejar el
  // enlace con el proveedor viejo). NO toca importe ni saldos.
  if (_cpTarget.modo === 'single') {
    const nuevoProvId = (document.getElementById('cp-proveedor-id')?.value || '').trim();
    const h0 = objetivos[0];
    if (h0 && nuevoProvId && String(nuevoProvId) !== String(h0.proveedor_id)) {
      const prov = state.proveedores.find(p => String(p.id) === String(nuevoProvId));
      if (prov) {
        h0.proveedor_id = String(prov.id);
        h0.nombre = prov.nombre || '';
        h0.banco = prov.banco || '';
        h0.tipo = prov.tipo_cuenta || '';
        const _pfFp = esPorFila('facturaPagos');
        let _fpTocados = 0;
        state.facturaPagos.forEach(fp => {
          if (String(fp.pago_id) === String(h0.id)) {
            fp.proveedor_id = parseInt(prov.id) || 0;
            if (_pfFp) sbGuardarFila('facturaPagos', fp);
            _fpTocados++;
          }
        });
        if (_fpTocados) gsSaveFacturaPagos({ porFila: _pfFp });
      }
    }
  }

  // Editor de fecha (solo single): si el usuario puso una fecha distinta, la
  // aplicamos en DD/MM/YYYY (como el resto). NO toca saldos — solo corrige el dato
  // de la fila (sirve para arreglar fechas volteadas por la importación).
  let fechaCambiada = false;
  if (_cpTarget.modo === 'single') {
    const fi = document.getElementById('cp-fecha');
    const nuevoISO = fi ? fi.value : '';
    if (nuevoISO) {
      const nuevaFecha = fmtFecha(nuevoISO);  // ISO → DD/MM/YYYY
      objetivos.forEach(h => { if (h.fecha !== nuevaFecha) { h.fecha = nuevaFecha; fechaCambiada = true; } });
    }
  }

  const _pfHist = esPorFila('historial');
  if (fechaCambiada) sortHistorialByFecha();  // reubica la fila por su nueva fecha
  gsSaveHistorial({ porFila: _pfHist });
  if (_pfHist) objetivos.forEach(h => sbGuardarFila('historial', h));
  histSel.clear();
  document.getElementById('modal-cambiar-partida').classList.remove('open');
  renderHistorial();
  if (window.renderCostosFiscales) window.renderCostosFiscales();
  if (window.renderConfigPartidas) window.renderConfigPartidas();
  notify(`✓ ${objetivos.length} pago(s) actualizado(s)`);
  // Si cambió la FECHA, el reparto automático del pago quedó con el pool de la
  // fecha VIEJA (la foto del reparto no se recalcula sola) → recolocarlo con el
  // pool correcto. Import dinámico para no tocar los imports de arriba. Lo
  // editado a mano JAMÁS se toca — solo se reporta.
  if (fechaCambiada) {
    import('./confirmar-pagos.js').then(m => {
      let rec = 0, manual = 0;
      objetivos.forEach(h => {
        if (m.esRepartoAutoIntactoDePago(h)) { if (m.reRepartirPago(h) === 'recolocado') rec++; }
        else if (state.costoAsignaciones.some(a => !a.factura_id && String(a.pago_id) === String(h.id))) manual++;
      });
      if (rec > 0) {
        gsSaveCostoAsignaciones();
        notify(`♻️ ${rec} reparto(s) recolocados a la fecha corregida`);
        if (window.renderCostosFiscales) window.renderCostosFiscales();
      }
      if (manual > 0) notify(`✋ Reparto editado a mano en ${manual} pago(s): revísalo con "Reasignar" en Costos por Unidad`, 'error');
    }).catch(e => console.error('recolocarPorFecha', e));
  }
}

// Elimina TODOS los seleccionados de una vez, reutilizando la misma lógica de
// eliminarHistorial (revierte saldos, quita el traspaso ligado, purga
// asignaciones), pero guardando UNA sola vez al final.
export function eliminarHistorialBulk() {
  if (!esAdmin()) { notify('Solo el admin puede borrar en bloque', 'error'); return; }
  const ids = new Set([...histSel]);
  const aBorrar = state.historial.filter(h => ids.has(String(h.id)));
  if (!aBorrar.length) { notify('No hay registros seleccionados', 'error'); return; }
  const total = aBorrar.reduce((s, h) => s + (+h.importe || 0), 0);
  if (!confirm(`¿Eliminar ${aBorrar.length} registro(s) seleccionado(s)?\nSuma: $${fmt(total)}\n\nSe revierten los saldos afectados. Esta acción no se puede deshacer.`)) return;

  let saldoChanged = false;
  let traspasosChanged = false;
  const traspasosBorrados = [];   // ids → borrado POR FILA (sin tormenta de espejo)
  aBorrar.forEach(h => {
    const fechaISO = parseFechaHist(h.fecha);
    if (h.tipo_registro === 'Traspaso') {
      if (revertirSaldo(h.cuenta_origen, +h.importe, fechaISO)) saldoChanged = true;
      if (revertirSaldo(h.cuenta_destino, -h.importe, fechaISO)) saldoChanged = true;
      // Llave CON fecha (ver comentario en eliminarHistorial): no borrar el
      // traspaso de otro mes cuando hay montos recurrentes.
      const ti = state.traspasos.findIndex(t =>
        t.proyecto_origen === h.cuenta_origen &&
        t.cuenta_destino_nombre === h.nombre &&
        t.monto === h.importe &&
        (parseFechaHist(t.fecha) || t.fecha || '') === (fechaISO || h.fecha || '')
      );
      if (ti !== -1) { traspasosBorrados.push(state.traspasos[ti].traspaso_id); state.traspasos.splice(ti, 1); traspasosChanged = true; }
    } else if (h.tipo_registro === 'Pago' && h.cuenta_origen) {
      if (revertirSaldo(h.cuenta_origen, +h.importe, fechaISO)) saldoChanged = true;
    }
  });

  // Quitar del historial en una sola pasada.
  state.historial = state.historial.filter(h => !ids.has(String(h.id)));

  // Purgar asignaciones de costo ligadas a los pagos borrados (en bloque).
  const antesAsig = state.costoAsignaciones.length;
  state.costoAsignaciones = state.costoAsignaciones.filter(a => !ids.has(String(a.pago_id)));
  const asigChanged = state.costoAsignaciones.length !== antesAsig;

  histSel.clear();

  // Guardar UNA sola vez cada cosa que cambió (cada gsSaveX espeja a Supabase).
  const _pfHist = esPorFila('historial');
  gsSaveHistorial({ porFila: _pfHist });
  if (_pfHist) aBorrar.forEach(h => { if (h.id) sbBorrarFila('historial', h.id); });
  if (saldoChanged) { saveProy(state.proyectos); gsSaveProyectos(); gsSaveCuentasPropias(); }
  if (traspasosChanged) {
    // POR FILA (sin espejo whole-table → sin tormenta realtime).
    const _pfT = esPorFila('traspasos');
    gsSaveTraspasos({ porFila: _pfT });
    if (_pfT) traspasosBorrados.forEach(id => sbBorrarFila('traspasos', id));
  }
  if (asigChanged) gsSaveCostoAsignaciones();
  // Revertir facturas ligadas a los pagos borrados (quita facturaPagos + saldo/estatus).
  purgarFacturaPagosDePagos([...ids]);

  // Render una sola vez.
  const cnt = document.getElementById('cnt-hist'); if (cnt) cnt.textContent = state.historial.length;
  renderHistorial();
  if (saldoChanged) {
    if (window.renderCuentasPropias) window.renderCuentasPropias();
    if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
    if (window.renderHeaderBadges) window.renderHeaderBadges();
  }
  if (traspasosChanged) {
    if (window.renderTraspasos) window.renderTraspasos();
    if (window.renderResumenTraspasos) window.renderResumenTraspasos();
    const cntT = document.getElementById('cnt-traspasos'); if (cntT) cntT.textContent = state.traspasos.length;
  }
  if (window.renderCostosFiscales) window.renderCostosFiscales();
  notify(`${aBorrar.length} registro(s) eliminado(s)`);
}

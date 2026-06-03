import { state } from '../state.js';
import { fmt, dl, fmtFecha } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { proyTag, catTag } from '../ui/badges.js';
import { gsSaveHistorial, gsSaveProyectos, gsSaveCuentasPropias, gsSaveTraspasos, gsSaveCostoAsignaciones, purgarAsignacionesDePago } from '../services/google-sync.js';
import { saveProy, proyectoMatch } from '../config/proyectos.js';
import { getPartidasParaSelect, SUB_PARTIDAS_CONSTRUCCION } from '../config/sub-partidas.js';

// Selección para borrado en bloque del historial (por id estable del pago).
const histSel = new Set();

export function renderHistorial() {
  const el = document.getElementById('historial-lista');
  if (!el) return;

  if (!state.gsToken) {
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
    const badgeColors = { 'Crédito': 'rgba(142,68,173,.15);color:#8e44ad', 'Pago': 'rgba(200,169,110,.15);color:#C8A96E', 'Préstamo': 'rgba(200,169,110,.15);color:#C8A96E', 'Aportación': 'rgba(39,174,96,.15);color:#27ae60', 'Traspaso': 'rgba(52,152,219,.15);color:#3498db' };
    const tipoLabel = h.tipo_registro === 'Crédito' ? 'Crédito' : h.tipo_registro !== 'Traspaso' ? 'Pago' : (h.tipo || 'Traspaso');
    const trBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${badgeColors[tipoLabel] || badgeColors['Pago']};">${tipoLabel}</span>`;
    const prov = (h.proveedor_id && h.tipo_registro !== 'Traspaso' && h.tipo_registro !== 'Crédito') ? state.proveedores.find(p => p.id === parseInt(h.proveedor_id)) : null;
    const tipoProv = prov?.categoria || '—';
    const subcat = (prov?.categoria === 'Proveedor' && prov?.subcategoria) ? prov.subcategoria : '—';
    const partidaVal = h.partida || '—';
    const subPartidaVal = h.sub_partida || '—';
    const conceptoVal = h.concepto || '';
    return `<div class="hist-row"><div style="text-align:center;"><input type="checkbox" ${histSel.has(String(h.id)) ? 'checked' : ''} onclick="toggleHistSel('${String(h.id).replace(/'/g, "\\'")}', event)" style="cursor:pointer;" title="Seleccionar"></div><div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${h.proveedor_id || '—'}</div><div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${h.factura_id || '—'}</div><div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(h.fecha)}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${h.cuenta_origen || ''}">${h.cuenta_origen || '—'}</div><div style="${TRUNC}"><div style="font-weight:500;font-size:12px;${TRUNC}" title="${h.nombre}">${h.nombre}</div><div style="font-size:11px;color:var(--muted);${TRUNC}">${h.banco} · ${h.tipo}</div></div><div>${trBadge}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${tipoProv}">${tipoProv}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${subcat}">${subcat}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${partidaVal}">${partidaVal}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${subPartidaVal}">${subPartidaVal}</div><div style="font-size:11px;color:var(--muted);${TRUNC}" title="${conceptoVal.replace(/"/g, '&quot;')}">${conceptoVal || '—'}</div><div style="font-family:'DM Mono',monospace;font-weight:500;color:var(--accent);text-align:right;">${fmt(h.importe)}</div><div>${proyTag(h.proyecto)}</div><div style="text-align:right;"><button class="btn btn-ghost btn-sm" onclick="eliminarHistorial(${state.historial.indexOf(h)})" style="color:#e74c3c;font-size:11px;padding:2px 6px;" title="Eliminar">✕</button></div></div>`;
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
  sel.innerHTML = '<option value="">Todos los proyectos</option>' + opts.map(n => `<option>${n}</option>`).join('');
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
    opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  sel.value = val;
}

function refreshHistSubPartidas() {
  const sel = document.getElementById('fh-subpartida');
  if (!sel) return;
  const val = sel.value;
  // Catálogo canónico de subpartidas (CONSTRUCCION) + cualquier valor legacy
  // del historial que no esté en el catálogo.
  const enHistorial = [...new Set(state.historial.map(h => h.sub_partida).filter(Boolean))];
  const canonical = new Set(SUB_PARTIDAS_CONSTRUCCION);
  const ordered = [...SUB_PARTIDAS_CONSTRUCCION];
  enHistorial.forEach(s => { if (!canonical.has(s)) ordered.push(s + ' (legacy)'); });
  sel.innerHTML = '<option value="">Todas las sub-partidas</option>' +
    ordered.map(s => {
      const value = s.endsWith(' (legacy)') ? s.replace(/ \(legacy\)$/, '') : s;
      return `<option value="${value}">${s}</option>`;
    }).join('');
  sel.value = val;
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
  const fc = document.getElementById('fh-cat')?.value || '';
  const ft = document.getElementById('fh-tipo')?.value || '';
  const fp = document.getElementById('fh-proy')?.value || '';
  const fpart = document.getElementById('fh-partida')?.value || '';
  const fsub = document.getElementById('fh-subpartida')?.value || '';
  const fd = document.getElementById('fh-desde')?.value || '';
  const fh2 = document.getElementById('fh-hasta')?.value || '';
  return state.historial.filter(h => {
    if (q && !(/^\d+$/.test(q) ? String(h.proveedor_id) === q : h.nombre.toLowerCase().includes(q))) return false;
    if (fc) {
      const prov = h.proveedor_id ? state.proveedores.find(p => p.id === parseInt(h.proveedor_id)) : null;
      if (!prov || prov.categoria !== fc) return false;
    }
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

  // Eliminar traspaso correspondiente en módulo de Traspasos
  if (h.tipo_registro === 'Traspaso') {
    const ti = state.traspasos.findIndex(t =>
      t.proyecto_origen === h.cuenta_origen &&
      t.cuenta_destino_nombre === h.nombre &&
      t.monto === h.importe
    );
    if (ti !== -1) {
      state.traspasos.splice(ti, 1);
      gsSaveTraspasos();
      if (window.renderTraspasos) window.renderTraspasos();
      if (window.renderResumenTraspasos) window.renderResumenTraspasos();
      const cntT = document.getElementById('cnt-traspasos');
      if (cntT) cntT.textContent = state.traspasos.length;
    }
  }

  state.historial.splice(idx, 1);
  gsSaveHistorial();
  // Limpiar asignaciones de costo fiscal ligadas a este pago (evita huérfanas)
  if (h.id) purgarAsignacionesDePago(h.id);
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

// Muestra/oculta el botón "Eliminar seleccionados (N)" según la selección.
function actualizarBarraSelHist() {
  const btn = document.getElementById('hist-bulk-del');
  if (!btn) return;
  const n = histSel.size;
  btn.style.display = n > 0 ? '' : 'none';
  btn.textContent = `🗑 Eliminar seleccionados (${n})`;
}

// Elimina TODOS los seleccionados de una vez, reutilizando la misma lógica de
// eliminarHistorial (revierte saldos, quita el traspaso ligado, purga
// asignaciones), pero guardando UNA sola vez al final.
export function eliminarHistorialBulk() {
  const ids = new Set([...histSel]);
  const aBorrar = state.historial.filter(h => ids.has(String(h.id)));
  if (!aBorrar.length) { notify('No hay registros seleccionados', 'error'); return; }
  const total = aBorrar.reduce((s, h) => s + (+h.importe || 0), 0);
  if (!confirm(`¿Eliminar ${aBorrar.length} registro(s) seleccionado(s)?\nSuma: $${fmt(total)}\n\nSe revierten los saldos afectados. Esta acción no se puede deshacer.`)) return;

  let saldoChanged = false;
  let traspasosChanged = false;
  aBorrar.forEach(h => {
    const fechaISO = parseFechaHist(h.fecha);
    if (h.tipo_registro === 'Traspaso') {
      if (revertirSaldo(h.cuenta_origen, +h.importe, fechaISO)) saldoChanged = true;
      if (revertirSaldo(h.cuenta_destino, -h.importe, fechaISO)) saldoChanged = true;
      const ti = state.traspasos.findIndex(t =>
        t.proyecto_origen === h.cuenta_origen &&
        t.cuenta_destino_nombre === h.nombre &&
        t.monto === h.importe
      );
      if (ti !== -1) { state.traspasos.splice(ti, 1); traspasosChanged = true; }
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
  gsSaveHistorial();
  if (saldoChanged) { saveProy(state.proyectos); gsSaveProyectos(); gsSaveCuentasPropias(); }
  if (traspasosChanged) gsSaveTraspasos();
  if (asigChanged) gsSaveCostoAsignaciones();

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

import { state } from '../state.js';
import { fmt, dl } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { proyTag } from '../ui/badges.js';
import { saveData } from '../services/google-sync.js';

export function renderHistorial() {
  const el = document.getElementById('historial-lista');
  if (!state.historial.length) {
    el.innerHTML = `<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">📋</div><div>Sin registros aún</div></div>`;
    return;
  }
  el.innerHTML = state.historial.map(h =>
    `<div class="hist-row"><div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${h.fecha}</div><div><div style="font-weight:500;font-size:12px;">${h.nombre}</div><div style="font-size:11px;color:var(--muted);">${h.banco} · ${h.tipo}</div></div><div style="font-size:11px;color:var(--muted);">${h.concepto.substring(0, 35)}</div><div style="font-family:'DM Mono',monospace;font-weight:500;color:var(--accent);text-align:right;">${fmt(h.importe)}</div><div>${proyTag(h.proyecto)}</div></div>`
  ).join('');
}

export function exportarHistorial() {
  if (!state.historial.length) { notify('Sin historial', 'error'); return; }
  let csv = 'Fecha,Beneficiario,Banco,Tipo Cuenta,Concepto,Importe,Proyecto\n';
  csv += state.historial.map(h =>
    `${h.fecha},"${h.nombre}",${h.banco},${h.tipo},"${h.concepto}",${h.importe},"${h.proyecto}"`
  ).join('\n');
  dl(csv, 'historial_pagos_dehur.csv');
  notify('Historial exportado');
}

export function renderModalConf() {
  const tbody = document.getElementById('tbody-conf');
  state.pendientesConfirmacion.forEach(d => { if (d.confirmado === undefined) d.confirmado = true; });
  const total = state.pendientesConfirmacion.reduce((s, d) => s + d.importe, 0);
  const selTotal = state.pendientesConfirmacion.filter(d => d.confirmado).reduce((s, d) => s + d.importe, 0);

  document.getElementById('conf-resumen').innerHTML =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;">' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">TOTAL GENERADO</div>' +
    '<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:700;">' + fmt(total) + '</div></div>' +
    '<div style="background:rgba(39,174,96,.08);border:1px solid rgba(39,174,96,.3);border-radius:10px;padding:14px;">' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">CONFIRMADO A REGISTRAR</div>' +
    '<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:700;color:var(--green);">' + fmt(selTotal) + '</div></div>';

  tbody.innerHTML = state.pendientesConfirmacion.map((d, i) =>
    '<tr><td><input type="checkbox" ' + (d.confirmado ? 'checked' : '') + ' onchange="pendientesConfirmacion[' + i + '].confirmado=this.checked;renderModalConf()" style="width:14px;height:14px;cursor:pointer;"></td>' +
    '<td style="font-size:12px;font-weight:500;">' + d.nombre + '</td>' +
    '<td style="font-size:11px;color:var(--muted);">' + d.concepto + '</td>' +
    '<td style="font-family:DM Mono,monospace;font-size:12px;font-weight:600;text-align:right;">' + fmt(d.importe) + '</td>' +
    '<td>' + proyTag(d.proyecto) + '</td></tr>'
  ).join('');
}

export function toggleAllConf(v) {
  state.pendientesConfirmacion.forEach(d => d.confirmado = v);
  renderModalConf();
}

export function abrirModalConfirmarPagos() {
  if (!state.pendientesConfirmacion.length) { notify('No hay pagos pendientes de confirmar', 'error'); return; }
  renderModalConf();
  document.getElementById('modal-confirmar-pagos').classList.add('open');
}

export function confirmarPagos() {
  const confirmados = state.pendientesConfirmacion.filter(d => d.confirmado);
  if (!confirmados.length) { notify('Selecciona al menos un pago confirmado', 'error'); return; }
  const fecha = new Date().toLocaleDateString('es-MX');
  confirmados.forEach(d => {
    state.historial.unshift({ fecha, nombre: d.nombre, concepto: d.concepto, importe: d.importe, proyecto: d.proyecto, banco: d.banco, tipo: d.tipo || d.cuenta });
  });
  document.getElementById('cnt-hist').textContent = state.historial.length;
  saveData();
  notify('✅ ' + confirmados.length + ' pago(s) registrados en historial');
  state.pendientesConfirmacion = [];
  cerrar('modal-confirmar-pagos');
}

import { state } from '../state.js';
import { fmt, dl } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { proyTag, catTag } from '../ui/badges.js';
import { saveData, gsSaveProyectos } from '../services/google-sync.js';
import { saveProy } from '../config/proyectos.js';

export function renderHistorial() {
  const el = document.getElementById('historial-lista');
  refreshHistProyectos();
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

  el.innerHTML = fil.map(h => {
    const trBadge = h.tipo_registro === 'Crédito'
      ? '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(142,68,173,.15);color:#8e44ad;">Crédito</span>'
      : h.tipo_registro !== 'Traspaso'
        ? '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(200,169,110,.15);color:#C8A96E;">Pago</span>'
        : h.tipo === 'Préstamo'
          ? '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(231,76,60,.15);color:#e74c3c;">Préstamo</span>'
          : '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(52,152,219,.15);color:#3498db;">Aportación</span>';
    const tipoProv = (h.tipo_registro !== 'Traspaso' && h.tipo_registro !== 'Crédito' && h.proveedor_id)
      ? (state.proveedores.find(p => p.id === parseInt(h.proveedor_id))?.categoria || '—')
      : '—';
    return `<div class="hist-row"><div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${h.proveedor_id || '—'}</div><div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${h.factura_id || '—'}</div><div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${h.fecha}</div><div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.cuenta_origen || '—'}</div><div><div style="font-weight:500;font-size:12px;">${h.nombre}</div><div style="font-size:11px;color:var(--muted);">${h.banco} · ${h.tipo}</div></div><div>${trBadge}</div><div style="font-size:11px;color:var(--muted);">${tipoProv}</div><div style="font-size:11px;color:var(--muted);">${h.concepto.substring(0, 35)}</div><div style="font-family:'DM Mono',monospace;font-weight:500;color:var(--accent);text-align:right;">${fmt(h.importe)}</div><div>${proyTag(h.proyecto)}</div></div>`;
  }).join('');
}

function refreshHistProyectos() {
  const sel = document.getElementById('fh-proy');
  if (!sel) return;
  const val = sel.value;
  const opts = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
  sel.innerHTML = '<option value="">Todos los proyectos</option>' + opts.map(n => `<option>${n}</option>`).join('');
  sel.value = val;
}

export function exportarHistorial() {
  if (!state.historial.length) { notify('Sin historial', 'error'); return; }
  const data = getFilteredHistorial();
  if (!data.length) { notify('Sin registros con los filtros actuales', 'error'); return; }
  let csv = 'Proveedor_ID,Factura_ID,Fecha,Origen,Beneficiario,Banco,Tipo Cuenta,Categoria,Tipo,Concepto,Importe,Proyecto\n';
  csv += data.map(h => {
    const tipoProv = (h.tipo_registro !== 'Traspaso' && h.proveedor_id) ? (state.proveedores.find(p => p.id === parseInt(h.proveedor_id))?.categoria || '') : '';
    const cat = h.tipo_registro === 'Traspaso' ? h.tipo : 'Pago';
    return `${h.proveedor_id || ''},${h.factura_id || ''},${h.fecha},"${h.cuenta_origen || ''}","${h.nombre}",${h.banco},${h.tipo},${cat},${tipoProv},"${h.concepto}",${h.importe},"${h.proyecto}"`;
  }).join('\n');
  dl(csv, 'historial_pagos_dehur.csv');
  notify('Historial exportado (' + data.length + ' registros)');
}

function getFilteredHistorial() {
  const q = (document.getElementById('buscar-hist')?.value || '').toLowerCase();
  const fc = document.getElementById('fh-cat')?.value || '';
  const fp = document.getElementById('fh-proy')?.value || '';
  const fd = document.getElementById('fh-desde')?.value || '';
  const fh2 = document.getElementById('fh-hasta')?.value || '';
  return state.historial.filter(h => {
    if (q && !(/^\d+$/.test(q) ? String(h.proveedor_id) === q : h.nombre.toLowerCase().includes(q))) return false;
    if (fc) {
      const prov = h.proveedor_id ? state.proveedores.find(p => p.id === parseInt(h.proveedor_id)) : null;
      if (!prov || prov.categoria !== fc) return false;
    }
    if (fp && h.proyecto !== fp) return false;
    if (fd && h.fecha < fd) return false;
    if (fh2 && h.fecha > fh2) return false;
    return true;
  });
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
    state.historial.unshift({ fecha, nombre: d.nombre, concepto: d.concepto, importe: d.importe, proyecto: d.cuenta_cargo || d.proyecto, banco: d.banco, tipo: d.tipo || d.cuenta, proveedor_id: d.proveedor_id || '', factura_id: d.factura_id || '', cuenta_origen: d.cuenta_cargo || '', tipo_registro: 'Pago' });
  });
  document.getElementById('cnt-hist').textContent = state.historial.length;
  saveData();

  // Restar saldo del proyecto por cada pago confirmado
  const todayISO = new Date().toISOString().split('T')[0];
  let saldoChanged = false;
  confirmados.forEach(d => {
    const proyNombre = d.cuenta_cargo || d.proyecto;
    if (!proyNombre || !d.importe) return;
    const p = state.proyectos.find(x => x.nombre === proyNombre);
    if (!p || !p.ultima_act_saldo) return;
    if (todayISO >= p.ultima_act_saldo.slice(0, 10)) {
      p.saldo = (p.saldo || 0) - d.importe;
      saldoChanged = true;
    }
  });
  if (saldoChanged) {
    saveProy(state.proyectos);
    gsSaveProyectos();
    if (window.renderCuentasPropias) window.renderCuentasPropias();
    if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
  }

  notify('✅ ' + confirmados.length + ' pago(s) registrados en historial');
  state.pendientesConfirmacion = [];
  const btnConf = document.getElementById('btn-confirmar-hist');
  if (btnConf) btnConf.style.display = 'none';
  cerrar('modal-confirmar-pagos');
  renderHistorial();
}

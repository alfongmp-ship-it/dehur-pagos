import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveFacturas } from '../services/google-sync.js';

export function renderFacturas() {
  const tb = document.getElementById('tbody-fact');
  refreshFactProyectos();

  if (!state.facturas.length) {
    tb.innerHTML = '<tr><td colspan="11"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🧾</div><div>Sin facturas registradas</div></div></td></tr>';
    document.getElementById('fact-subtitulo').textContent = '';
    return;
  }

  const fil = getFilteredFacturas();
  const sub = document.getElementById('fact-subtitulo');
  sub.textContent = fil.length !== state.facturas.length
    ? `${fil.length} de ${state.facturas.length} facturas`
    : `${state.facturas.length} facturas`;

  if (!fil.length) {
    tb.innerHTML = '<tr><td colspan="11"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin resultados con los filtros actuales</div></div></td></tr>';
    return;
  }

  tb.innerHTML = fil.map(f => {
    const prov = state.proveedores.find(p => p.id === f.proveedor_id);
    const provNombre = prov ? prov.nombre : `ID ${f.proveedor_id}`;
    const estBadge = estatusBadge(f.estatus_factura);
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${f.factura_id}</td>
      <td><div style="font-weight:500;font-size:12px;">${provNombre}</div></td>
      <td style="font-size:11px;">${f.folio_factura}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${f.fecha_factura}</td>
      <td style="font-size:11px;">${f.moneda}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;">${fmt(f.monto_total)}</td>
      <td style="font-family:'DM Mono',monospace;text-align:right;color:var(--green);">${fmt(f.monto_pagado)}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;color:${f.saldo_pendiente > 0 ? 'var(--accent)' : 'var(--muted)'};">${fmt(f.saldo_pendiente)}</td>
      <td>${estBadge}</td>
      <td>${proyTag(f.proyecto)}</td>
      <td style="text-align:right;"><button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="editarFactura(${f.factura_id})">Editar</button></td>
    </tr>`;
  }).join('');
}

function getFilteredFacturas() {
  const q = (document.getElementById('buscar-fact')?.value || '').toLowerCase();
  const fe = document.getElementById('ff-estatus')?.value || '';
  const fp = document.getElementById('ff-proy')?.value || '';
  return state.facturas.filter(f => {
    if (q) {
      const prov = state.proveedores.find(p => p.id === f.proveedor_id);
      const provNombre = prov ? prov.nombre.toLowerCase() : '';
      if (!(/^\d+$/.test(q) ? String(f.factura_id) === q || String(f.proveedor_id) === q : provNombre.includes(q) || f.folio_factura.toLowerCase().includes(q))) return false;
    }
    if (fe && f.estatus_factura !== fe) return false;
    if (fp && f.proyecto !== fp) return false;
    return true;
  });
}

function refreshFactProyectos() {
  const sel = document.getElementById('ff-proy');
  if (!sel) return;
  const val = sel.value;
  const opts = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
  sel.innerHTML = '<option value="">Todos los proyectos</option>' + opts.map(n => `<option>${n}</option>`).join('');
  sel.value = val;
}

function estatusBadge(estatus) {
  const colors = {
    pendiente: 'rgba(200,169,110,.15);color:#C8A96E',
    parcial: 'rgba(52,152,219,.15);color:#3498db',
    pagada: 'rgba(39,174,96,.15);color:#27ae60',
    cancelada: 'rgba(231,76,60,.15);color:#e74c3c'
  };
  const style = colors[estatus] || 'rgba(200,169,110,.15);color:#C8A96E';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${style};">${estatus}</span>`;
}

// ===== CRUD Facturas =====

function populateFacturaSelects() {
  const selProy = document.getElementById('f-proyecto');
  selProy.innerHTML = '<option value="">— Sin proyecto —</option>' +
    state.proyectos.filter(p => p.activo !== false).map(p => `<option>${p.nombre}</option>`).join('');
}

export function filtrarProvFactura() {
  const input = document.getElementById('f-proveedor');
  const dd = document.getElementById('f-prov-dropdown');
  const q = input.value.trim().toLowerCase();
  if (!q) {
    dd.style.display = 'none';
    document.getElementById('f-proveedor-id').value = '';
    return;
  }
  const results = state.proveedores.filter(p => p.activo &&
    (/^\d+$/.test(q) ? String(p.id).includes(q) : p.nombre.toLowerCase().includes(q))
  ).slice(0, 15);
  if (!results.length) {
    dd.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--muted);">Sin resultados</div>';
    dd.style.display = 'block';
    return;
  }
  dd.innerHTML = results.map(p =>
    `<div onclick="selProvFactura(${p.id})" style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border);" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='transparent'">
      <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);margin-right:6px;">${p.id}</span>${p.nombre}
    </div>`
  ).join('');
  dd.style.display = 'block';
}

export function selProvFactura(id) {
  const p = state.proveedores.find(x => x.id === id);
  if (!p) return;
  document.getElementById('f-proveedor').value = p.nombre;
  document.getElementById('f-proveedor-id').value = id;
  document.getElementById('f-prov-dropdown').style.display = 'none';
}

export function abrirNuevaFactura() {
  state.editFactId = null;
  document.getElementById('modal-fact-title').textContent = 'Nueva Factura';
  document.getElementById('f-proveedor').value = '';
  document.getElementById('f-proveedor-id').value = '';
  document.getElementById('f-prov-dropdown').style.display = 'none';
  document.getElementById('f-folio').value = '';
  document.getElementById('f-uuid').value = '';
  document.getElementById('f-fecha-factura').value = '';
  document.getElementById('f-fecha-registro').value = new Date().toISOString().split('T')[0];
  document.getElementById('f-moneda').value = 'MXN';
  document.getElementById('f-monto').value = '';
  document.getElementById('f-estatus').value = 'pendiente';
  document.getElementById('f-proyecto').value = '';
  document.getElementById('f-obs').value = '';
  populateFacturaSelects();
  document.getElementById('modal-factura').classList.add('open');
}

export function editarFactura(id) {
  const f = state.facturas.find(x => x.factura_id === id);
  if (!f) return;
  state.editFactId = id;
  populateFacturaSelects();
  document.getElementById('modal-fact-title').textContent = 'Editar Factura #' + id;
  const prov = state.proveedores.find(p => p.id === f.proveedor_id);
  document.getElementById('f-proveedor').value = prov ? prov.nombre : `ID ${f.proveedor_id}`;
  document.getElementById('f-proveedor-id').value = f.proveedor_id;
  document.getElementById('f-prov-dropdown').style.display = 'none';
  document.getElementById('f-folio').value = f.folio_factura;
  document.getElementById('f-uuid').value = f.uuid || '';
  document.getElementById('f-fecha-factura').value = f.fecha_factura;
  document.getElementById('f-fecha-registro').value = f.fecha_registro;
  document.getElementById('f-moneda').value = f.moneda;
  document.getElementById('f-monto').value = f.monto_total;
  document.getElementById('f-estatus').value = f.estatus_factura;
  document.getElementById('f-proyecto').value = f.proyecto;
  document.getElementById('f-obs').value = f.observaciones || '';
  document.getElementById('modal-factura').classList.add('open');
}

export function guardarFactura() {
  const provId = parseInt(document.getElementById('f-proveedor-id').value);
  const folio = document.getElementById('f-folio').value.trim();
  const fechaFact = document.getElementById('f-fecha-factura').value;
  const monto = parseFloat(document.getElementById('f-monto').value) || 0;

  if (!provId) { notify('Selecciona un proveedor', 'error'); return; }
  if (!folio) { notify('El folio es obligatorio', 'error'); return; }
  if (!fechaFact) { notify('La fecha de factura es obligatoria', 'error'); return; }
  if (monto <= 0) { notify('El monto debe ser mayor a 0', 'error'); return; }

  const existing = state.editFactId ? state.facturas.find(f => f.factura_id === state.editFactId) : null;
  const pagado = existing ? existing.monto_pagado : 0;

  const obj = {
    factura_id: state.editFactId || (state.facturas.reduce((max, f) => Math.max(max, f.factura_id), 0) + 1),
    proveedor_id: provId,
    folio_factura: folio,
    uuid: document.getElementById('f-uuid').value.trim(),
    fecha_factura: fechaFact,
    fecha_registro: document.getElementById('f-fecha-registro').value || new Date().toISOString().split('T')[0],
    moneda: document.getElementById('f-moneda').value,
    monto_total: monto,
    monto_pagado: pagado,
    saldo_pendiente: monto - pagado,
    estatus_factura: document.getElementById('f-estatus').value,
    proyecto: document.getElementById('f-proyecto').value,
    observaciones: document.getElementById('f-obs').value.trim(),
    activo: true
  };

  if (state.editFactId) {
    const i = state.facturas.findIndex(f => f.factura_id === state.editFactId);
    state.facturas[i] = obj;
  } else {
    state.facturas.push(obj);
  }

  cerrar('modal-factura');
  renderFacturas();
  document.getElementById('cnt-fact').textContent = state.facturas.length;
  notify(state.editFactId ? 'Factura actualizada' : 'Factura registrada');
  gsSaveFacturas();
}

// ===== Factura Pagos (solo lectura) =====

export function renderFacturaPagos() {
  const tb = document.getElementById('tbody-fp');

  if (!state.facturaPagos.length) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">💳</div><div>Sin pagos a facturas registrados</div></div></td></tr>';
    document.getElementById('fp-subtitulo').textContent = '';
    return;
  }

  const q = (document.getElementById('buscar-fp')?.value || '').toLowerCase();
  const fil = state.facturaPagos.filter(fp => {
    if (!q) return true;
    if (/^\d+$/.test(q)) return String(fp.factura_pago_id) === q || String(fp.factura_id) === q || String(fp.proveedor_id) === q;
    const prov = state.proveedores.find(p => p.id === fp.proveedor_id);
    return prov && prov.nombre.toLowerCase().includes(q);
  });

  const sub = document.getElementById('fp-subtitulo');
  sub.textContent = fil.length !== state.facturaPagos.length
    ? `${fil.length} de ${state.facturaPagos.length} registros`
    : `${state.facturaPagos.length} registros`;

  if (!fil.length) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin resultados</div></div></td></tr>';
    return;
  }

  tb.innerHTML = fil.map(fp => {
    const prov = state.proveedores.find(p => p.id === fp.proveedor_id);
    const provNombre = prov ? prov.nombre : `ID ${fp.proveedor_id}`;
    const estBadge = estatusBadge(fp.estatus);
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fp.factura_pago_id}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;">${fp.factura_id}</td>
      <td><div style="font-weight:500;font-size:12px;">${provNombre}</div></td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;color:var(--accent);">${fmt(fp.monto_aplicado)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fp.fecha_pago}</td>
      <td>${estBadge}</td>
      <td style="font-size:11px;color:var(--muted);">${(fp.observaciones || '').substring(0, 40)}</td>
    </tr>`;
  }).join('');
}

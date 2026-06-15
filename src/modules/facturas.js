import { state, datosListos } from '../state.js';
import { fmt, fmtFecha } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveFacturas, gsSaveFacturaPagos, esPorFila, sbGuardarFila, sbBorrarFila } from '../services/google-sync.js';
import { proyectoMatch } from '../config/proyectos.js';

function diasAlVencimiento(fechaVenc) {
  if (!fechaVenc) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const venc = new Date(fechaVenc + 'T00:00:00');
  if (isNaN(venc)) return null;
  return Math.ceil((venc - hoy) / 86400000);
}

function vencimientoBadge(f) {
  if (f.estatus_factura === 'pagada' || f.estatus_factura === 'cancelada') return '';
  const dias = diasAlVencimiento(f.fecha_vencimiento);
  if (dias === null) return '';
  if (dias < 0) return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:600;background:rgba(224,90,90,.15);color:#e05a5a;">Vencida ${Math.abs(dias)}d</span>`;
  if (dias <= 7) return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:600;background:rgba(224,122,58,.15);color:#e07a3a;">Vence ${dias}d</span>`;
  return '';
}

function vencimientoColor(f) {
  if (f.estatus_factura === 'pagada' || f.estatus_factura === 'cancelada') return 'var(--muted)';
  const dias = diasAlVencimiento(f.fecha_vencimiento);
  if (dias === null) return 'var(--muted)';
  if (dias < 0) return '#e05a5a';
  if (dias <= 7) return '#e07a3a';
  return 'var(--muted)';
}

function renderFactStats() {
  const el = document.getElementById('fact-stats');
  if (!el) return;

  const pendientes = state.facturas.filter(f => f.estatus_factura === 'pendiente' || f.estatus_factura === 'parcial');
  const vencidas = pendientes.filter(f => { const d = diasAlVencimiento(f.fecha_vencimiento); return d !== null && d < 0; });
  const porVencer = pendientes.filter(f => { const d = diasAlVencimiento(f.fecha_vencimiento); return d !== null && d >= 0 && d <= 7; });
  const montoVencido = vencidas.reduce((s, f) => s + f.saldo_pendiente, 0);
  const montoPorVencer = porVencer.reduce((s, f) => s + f.saldo_pendiente, 0);

  if (!pendientes.length) { el.style.display = 'none'; return; }
  el.style.display = '';

  el.innerHTML = `
    <div class="stat-card" style="border-left:3px solid var(--red);">
      <div class="stat-label">Vencidas</div>
      <div class="stat-value" style="color:var(--red);">${vencidas.length}</div>
      <div class="stat-sub">${fmt(montoVencido)} pendiente</div>
    </div>
    <div class="stat-card" style="border-left:3px solid var(--orange);">
      <div class="stat-label">Vencen en 7 d</div>
      <div class="stat-value" style="color:var(--orange);">${porVencer.length}</div>
      <div class="stat-sub">${fmt(montoPorVencer)} pendiente</div>
    </div>
    <div class="stat-card" style="border-left:3px solid var(--accent);">
      <div class="stat-label">Pendientes</div>
      <div class="stat-value stat-accent">${pendientes.length}</div>
      <div class="stat-sub">${fmt(pendientes.reduce((s, f) => s + f.saldo_pendiente, 0))} total</div>
    </div>
    <div class="stat-card" style="border-left:3px solid var(--green);">
      <div class="stat-label">Al corriente</div>
      <div class="stat-value stat-green">${pendientes.length - vencidas.length - porVencer.length}</div>
      <div class="stat-sub">Sin urgencia</div>
    </div>`;
}

export function renderFacturas() {
  const tb = document.getElementById('tbody-fact');
  if (!tb) return;

  if (!datosListos()) {
    tb.innerHTML = '<tr><td colspan="11"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div></td></tr>';
    const sub = document.getElementById('fact-subtitulo'); if (sub) sub.textContent = '';
    const cnt = document.getElementById('cnt-fact'); if (cnt) cnt.textContent = '0';
    return;
  }

  refreshFactProyectos();
  renderFactStats();

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
    const provNombre = f.nombre_proveedor || f.razon_social || `ID ${f.proveedor_id}`;
    const estBadge = estatusBadge(f.estatus_factura);
    const vBadge = vencimientoBadge(f);
    const vColor = vencimientoColor(f);
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${f.factura_id}</td>
      <td style="font-size:11px;">${f.numero_factura || '—'}</td>
      <td><div style="font-weight:500;font-size:12px;">${provNombre}</div><div style="font-size:10px;color:var(--muted);">${f.razon_social && f.nombre_proveedor ? f.razon_social : ''}</div></td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(f.fecha_factura)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:${vColor};font-weight:${vColor !== 'var(--muted)' ? '600' : '400'};">${fmtFecha(f.fecha_vencimiento) || '—'} ${vBadge}</td>
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
      if (!(/^\d+$/.test(q) ? String(f.factura_id) === q || String(f.proveedor_id) === q : provNombre.includes(q) || (f.numero_factura || '').toLowerCase().includes(q) || (f.nombre_proveedor || '').toLowerCase().includes(q))) return false;
    }
    if (fe && f.estatus_factura !== fe) return false;
    if (fp && !proyectoMatch(f.proyecto, fp)) return false;
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
  document.getElementById('f-razon-social').value = '';
  document.getElementById('f-proveedor').value = '';
  document.getElementById('f-proveedor-id').value = '';
  document.getElementById('f-prov-dropdown').style.display = 'none';
  document.getElementById('f-folio').value = '';
  document.getElementById('f-uuid').value = '';
  document.getElementById('f-fecha-factura').value = '';
  document.getElementById('f-fecha-vencimiento').value = '';
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
  document.getElementById('f-razon-social').value = f.razon_social || '';
  const prov = state.proveedores.find(p => p.id === f.proveedor_id);
  document.getElementById('f-proveedor').value = prov ? prov.nombre : `ID ${f.proveedor_id}`;
  document.getElementById('f-proveedor-id').value = f.proveedor_id;
  document.getElementById('f-prov-dropdown').style.display = 'none';
  document.getElementById('f-folio').value = f.numero_factura || f.folio_factura || '';
  document.getElementById('f-uuid').value = f.uuid || '';
  document.getElementById('f-fecha-factura').value = f.fecha_factura;
  document.getElementById('f-fecha-vencimiento').value = f.fecha_vencimiento || '';
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

  const prov = state.proveedores.find(p => p.id === provId);
  const obj = {
    factura_id: state.editFactId || (state.facturas.reduce((max, f) => Math.max(max, f.factura_id), 0) + 1),
    numero_factura: folio,
    razon_social: document.getElementById('f-razon-social').value.trim(),
    proveedor_id: provId,
    nombre_proveedor: prov ? prov.nombre : '',
    fecha_factura: fechaFact,
    fecha_vencimiento: document.getElementById('f-fecha-vencimiento').value || '',
    fecha_pago_total: existing ? existing.fecha_pago_total || '' : '',
    monto_total: monto,
    monto_pagado: pagado,
    saldo_pendiente: monto - pagado,
    estatus_factura: document.getElementById('f-estatus').value,
    proyecto: document.getElementById('f-proyecto').value,
    observaciones: document.getElementById('f-obs').value.trim(),
    activo: true,
    uuid: document.getElementById('f-uuid').value.trim()
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
  // Fase 3: guarda solo esta factura (upsert por factura_id, add/edit).
  const porFila = esPorFila('facturas');
  gsSaveFacturas({ porFila });
  if (porFila) sbGuardarFila('facturas', obj);
}

// ===== Factura Pagos (solo lectura) =====

export function renderFacturaPagos() {
  const tb = document.getElementById('tbody-fp');
  if (!tb) return;

  if (!datosListos()) {
    tb.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div></td></tr>';
    const sub = document.getElementById('fp-subtitulo'); if (sub) sub.textContent = '';
    const cnt = document.getElementById('cnt-fp'); if (cnt) cnt.textContent = '0';
    return;
  }

  if (!state.facturaPagos.length) {
    tb.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">💳</div><div>Sin pagos a facturas registrados</div></div></td></tr>';
    document.getElementById('fp-subtitulo').textContent = '';
    return;
  }

  const q = (document.getElementById('buscar-fp')?.value || '').toLowerCase();
  const ffId = document.getElementById('fp-factura-id')?.value || '';
  const fd = document.getElementById('fp-desde')?.value || '';
  const fh = document.getElementById('fp-hasta')?.value || '';
  const fil = state.facturaPagos.filter(fp => {
    if (q) {
      if (/^\d+$/.test(q)) {
        if (String(fp.factura_pago_id) !== q && String(fp.factura_id) !== q && String(fp.proveedor_id) !== q) return false;
      } else {
        const prov = state.proveedores.find(p => p.id === fp.proveedor_id);
        if (!prov || !prov.nombre.toLowerCase().includes(q)) return false;
      }
    }
    if (ffId && String(fp.factura_id) !== ffId) return false;
    if (fd && fp.fecha_pago < fd) return false;
    if (fh && fp.fecha_pago > fh) return false;
    return true;
  });

  const sub = document.getElementById('fp-subtitulo');
  sub.textContent = fil.length !== state.facturaPagos.length
    ? `${fil.length} de ${state.facturaPagos.length} registros`
    : `${state.facturaPagos.length} registros`;

  if (!fil.length) {
    tb.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin resultados</div></div></td></tr>';
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
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(fp.fecha_pago)}</td>
      <td>${estBadge}</td>
      <td style="font-size:11px;color:var(--muted);">${(fp.observaciones || '').substring(0, 40)}</td>
      <td style="text-align:right;"><button class="btn btn-ghost" style="padding:4px 6px;font-size:11px;color:#e74c3c;" onclick="eliminarPagoFactura(${fp.factura_pago_id})">✕</button></td>
    </tr>`;
  }).join('');
}

export function eliminarPagoFactura(fpId) {
  const fp = state.facturaPagos.find(x => x.factura_pago_id === fpId);
  if (!fp) return;
  if (!confirm(`¿Eliminar pago de ${fmt(fp.monto_aplicado)} a factura ${fp.factura_id}?`)) return;

  const fact = state.facturas.find(f => f.factura_id === fp.factura_id);
  if (fact) {
    fact.monto_pagado = Math.max(0, (fact.monto_pagado || 0) - fp.monto_aplicado);
    fact.saldo_pendiente = fact.monto_total - fact.monto_pagado;
    if (fact.monto_pagado <= 0) {
      fact.estatus_factura = 'pendiente';
      fact.fecha_pago_total = '';
    } else if (fact.saldo_pendiente > 0) {
      fact.estatus_factura = 'parcial';
      fact.fecha_pago_total = '';
    }
  }

  state.facturaPagos = state.facturaPagos.filter(x => x.factura_pago_id !== fpId);
  // Fase 3: la factura padre se re-guarda por fila (saldo recalculado) y el pago
  // borrado se quita por fila.
  const porFilaF = esPorFila('facturas');
  const porFilaFp = esPorFila('facturaPagos');
  gsSaveFacturas({ porFila: porFilaF });
  gsSaveFacturaPagos({ porFila: porFilaFp });
  if (porFilaF && fact) sbGuardarFila('facturas', fact);
  if (porFilaFp) sbBorrarFila('facturaPagos', fpId);
  renderFacturas();
  renderFacturaPagos();
  document.getElementById('cnt-fact').textContent = state.facturas.length;
  document.getElementById('cnt-fp').textContent = state.facturaPagos.length;
  notify('Pago a factura eliminado');
}

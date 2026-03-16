import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';

export function renderFacturas() {
  const tb = document.getElementById('tbody-fact');
  refreshFactProyectos();

  if (!state.facturas.length) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🧾</div><div>Sin facturas registradas</div></div></td></tr>';
    document.getElementById('fact-subtitulo').textContent = '';
    return;
  }

  const fil = getFilteredFacturas();
  const sub = document.getElementById('fact-subtitulo');
  sub.textContent = fil.length !== state.facturas.length
    ? `${fil.length} de ${state.facturas.length} facturas`
    : `${state.facturas.length} facturas`;

  if (!fil.length) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin resultados con los filtros actuales</div></div></td></tr>';
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

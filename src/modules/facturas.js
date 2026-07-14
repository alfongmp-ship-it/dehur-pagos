import { state, datosListos, puedeBorrarFacturas, nuevoFacturaPagoId } from '../state.js';
import { fmt, fmtFecha, hoyFecha, escapeHtml } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveFacturas, gsSaveFacturaPagos, esPorFila, sbGuardarFila, sbBorrarFila, ensureHistorialIds, gsSaveCostoAsignaciones, purgarAsignacionesDeFactura } from '../services/google-sync.js';
import { proyectoMatch } from '../config/proyectos.js';
import { parseFechaHist } from './historial.js';

// Empresas propias a las que se factura (receptor del CFDI). Lista corta editable:
// agrega aquí si en el futuro facturan a otra razón social.
const EMPRESAS_FACTURA = ['Dehur', 'Dehur Territorial'];

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
    tb.innerHTML = '<tr><td colspan="12"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div></td></tr>';
    const sub = document.getElementById('fact-subtitulo'); if (sub) sub.textContent = '';
    const cnt = document.getElementById('cnt-fact'); if (cnt) cnt.textContent = '0';
    return;
  }

  refreshFactProyectos();
  renderFactStats();

  if (!state.facturas.length) {
    tb.innerHTML = '<tr><td colspan="12"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🧾</div><div>Sin facturas registradas</div></div></td></tr>';
    document.getElementById('fact-subtitulo').textContent = '';
    return;
  }

  const fil = getFilteredFacturas();
  const sub = document.getElementById('fact-subtitulo');
  sub.textContent = fil.length !== state.facturas.length
    ? `${fil.length} de ${state.facturas.length} facturas`
    : `${state.facturas.length} facturas`;

  if (!fil.length) {
    tb.innerHTML = '<tr><td colspan="12"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin resultados con los filtros actuales</div></div></td></tr>';
    return;
  }

  // Suma del reparto (devengado) por factura, para mostrar completo / parcial / falta.
  const repartoSum = new Map();
  state.costoAsignaciones.forEach(a => { if (a.factura_id) repartoSum.set(String(a.factura_id), (repartoSum.get(String(a.factura_id)) || 0) + (a.monto_asignado || 0)); });
  tb.innerHTML = fil.map(f => {
    const provNombre = f.nombre_proveedor || f.razon_social || `ID ${f.proveedor_id}`;
    const estBadge = estatusBadge(f.estatus_factura);
    const vBadge = vencimientoBadge(f);
    const vColor = vencimientoColor(f);
    const sumR = repartoSum.get(String(f.factura_id)) || 0;
    const totalR = f.monto_total || 0;
    let repTxt, repTit, repCss;
    if (sumR <= 0.01) { repTxt = '⚠ Repartir'; repTit = 'Falta repartir el costo a unidades'; repCss = 'color:var(--orange);'; }
    else if (sumR < totalR - 0.5) { repTxt = `Parcial ${Math.round(sumR / totalR * 100)}%`; repTit = `Repartido ${fmt(sumR)} de ${fmt(totalR)} — falta ${fmt(totalR - sumR)}`; repCss = 'color:var(--orange);'; }
    else { repTxt = 'Reparto ✓'; repTit = 'Reparto del costo (devengado) completo'; repCss = ''; }
    const btnRepartir = `<button class="btn btn-ghost req-facturas" style="padding:4px 8px;font-size:11px;${repCss}" onclick="abrirRepartirFactura(${f.factura_id})" title="${repTit}">${repTxt}</button>`;
    // Total: si hay nota de crédito, monto_total ya es el NETO (factura − NC). Mostramos el
    // neto y, debajo, el total ORIGINAL (antes de NC) + el monto de la NC, solo informativo.
    const ncTotal = (f.nc_subtotal || 0) + (f.nc_iva || 0);
    const totalCell = ncTotal > 0.005
      ? `${fmt(f.monto_total)}<div style="font-size:9px;color:var(--muted);font-weight:400;">orig. ${fmt((f.monto_total || 0) + ncTotal)} · NC −${fmt(ncTotal)}</div>`
      : fmt(f.monto_total);
    return `<tr ondblclick="abrirDetalleFactura(${f.factura_id})" style="cursor:pointer;" title="Doble click para ver el detalle y los pagos">
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${f.factura_id}</td>
      <td style="font-size:11px;"><span style="font-family:'DM Mono',monospace;" title="${escapeHtml(f.uuid)}">${escapeHtml((f.uuid || '').split('-')[0]) || '—'}</span><div style="font-size:9px;color:var(--muted);">Núm: ${escapeHtml(f.numero_factura) || '—'}</div></td>
      <td><div style="font-weight:500;font-size:12px;">${escapeHtml(provNombre)}</div><div style="font-size:10px;color:var(--muted);">${f.razon_social && f.nombre_proveedor ? escapeHtml(f.razon_social) : ''}</div></td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(f.fecha_factura)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:${vColor};font-weight:${vColor !== 'var(--muted)' ? '600' : '400'};">${fmtFecha(f.fecha_vencimiento) || '—'} ${vBadge}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;">${totalCell}</td>
      <td style="font-family:'DM Mono',monospace;text-align:right;color:var(--green);">${fmt(f.monto_pagado)}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;color:${f.saldo_pendiente > 0 ? 'var(--accent)' : 'var(--muted)'};">${fmt(f.saldo_pendiente)}</td>
      <td>${estBadge}</td>
      <td>${estadoSatBadge(f.estado_sat)}</td>
      <td>${proyTag(f.proyecto)}</td>
      <td style="text-align:right;white-space:nowrap;">${btnRepartir} <button class="btn btn-ghost req-facturas" style="padding:4px 8px;font-size:11px;" onclick="editarFactura(${f.factura_id})">Editar</button></td>
    </tr>`;
  }).join('');
}

// Cambia el campo de búsqueda (Todo/ID/N°/UUID) y ajusta el placeholder de ayuda.
export function cambiarBuscarPorFactura() {
  const modo = document.getElementById('ff-buscar-por')?.value || 'todo';
  const inp = document.getElementById('buscar-fact');
  if (inp) {
    inp.placeholder = modo === 'id' ? 'Escribe el ID interno…'
      : modo === 'numero' ? 'Escribe el Número de Factura…'
      : modo === 'uuid' ? 'Escribe el UUID (folio fiscal)…'
      : 'Buscar por ID, folio o proveedor…';
  }
  renderFacturas();
}

function getFilteredFacturas() {
  const q = (document.getElementById('buscar-fact')?.value || '').trim().toLowerCase();
  const modo = document.getElementById('ff-buscar-por')?.value || 'todo';
  const fe = document.getElementById('ff-estatus')?.value || '';
  const fes = document.getElementById('ff-estado-sat')?.value || '';
  const fp = document.getElementById('ff-proy')?.value || '';
  const fil = state.facturas.filter(f => {
    if (q) {
      // Búsqueda por CAMPO elegido → así un número no se confunde entre ID, N° de
      // factura y UUID. 'todo' conserva el buscador amplio de siempre.
      if (modo === 'id') {
        if (!String(f.factura_id).toLowerCase().includes(q)) return false;
      } else if (modo === 'numero') {
        if (!(f.numero_factura || '').toLowerCase().includes(q)) return false;
      } else if (modo === 'uuid') {
        if (!(f.uuid || '').toLowerCase().includes(q)) return false;
      } else {
        const prov = state.proveedores.find(p => p.id === f.proveedor_id);
        const provNombre = prov ? prov.nombre.toLowerCase() : '';
        if (!(/^\d+$/.test(q) ? String(f.factura_id) === q || String(f.proveedor_id) === q : provNombre.includes(q) || (f.numero_factura || '').toLowerCase().includes(q) || (f.nombre_proveedor || '').toLowerCase().includes(q) || (f.rfc_emisor || '').toLowerCase().includes(q) || (f.uuid || '').toLowerCase().includes(q))) return false;
      }
    }
    if (fe && f.estatus_factura !== fe) return false;
    if (fes && (f.estado_sat || 'Vigente') !== fes) return false;
    if (fp && !proyectoMatch(f.proyecto, fp)) return false;
    return true;
  });
  // Orden: primero las que AÚN requieren acción (pendiente/parcial) — por VENCIMIENTO ascendente
  // (las más vencidas / próximas a vencer arriba; sin vencimiento al fondo de su grupo), desempate
  // por FECHA DE FACTURA descendente. Las ya cerradas (pagada/cancelada) se van ABAJO, y entre
  // ellas la más VIEJA hasta el fondo (fecha de factura descendente). Aplica a la lista y al export.
  const _cerrada = f => f.estatus_factura === 'pagada' || f.estatus_factura === 'cancelada';
  fil.sort((a, b) => {
    const ca = _cerrada(a), cb = _cerrada(b);
    if (ca !== cb) return ca ? 1 : -1;                       // pagadas/canceladas al fondo
    const fa = parseFechaHist(a.fecha_factura) || '';
    const fb = parseFechaHist(b.fecha_factura) || '';
    if (!ca) {                                               // activas: por vencimiento ascendente
      const va = parseFechaHist(a.fecha_vencimiento) || '9999-12-31';
      const vb = parseFechaHist(b.fecha_vencimiento) || '9999-12-31';
      if (va !== vb) return va < vb ? -1 : 1;
      return fa < fb ? 1 : (fa > fb ? -1 : 0);               // desempate: factura más reciente arriba
    }
    return fa < fb ? 1 : (fa > fb ? -1 : 0);                 // pagadas: más vieja abajo (fecha desc)
  });
  return fil;
}

// Exporta el reporte de facturas (lo FILTRADO que se ve en pantalla) a un Excel real
// (.xlsx) usando la librería XLSX ya cargada. Solo-lectura: no toca datos. Montos van como
// números para que Excel los sume; incluye nota de crédito y el total neto.
export function exportarFacturasExcel() {
  if (!state.facturas.length) { notify('No hay facturas para exportar', 'error'); return; }
  const fil = getFilteredFacturas();
  if (!fil.length) { notify('No hay facturas con los filtros actuales', 'error'); return; }
  const headers = ['ID', 'Folio', 'UUID', 'Proveedor', 'Razón social', 'RFC emisor',
    'Fecha factura', 'Vencimiento', 'Subtotal', 'Descuento', 'IVA', 'Ret. IVA', 'Ret. ISR',
    'NC monto', 'NC IVA', 'Total neto', 'Pagado', 'Saldo', 'Estatus pago', 'Estado SAT',
    'Tipo comprobante', 'Proyecto', 'Empresa facturada', 'Observaciones'];
  const rows = fil.map(f => {
    const prov = state.proveedores.find(p => p.id === f.proveedor_id);
    const provNombre = f.nombre_proveedor || (prov ? prov.nombre : '') || f.razon_social || `ID ${f.proveedor_id}`;
    return [
      f.factura_id, f.numero_factura || '', f.uuid || '', provNombre, f.razon_social || '',
      f.rfc_emisor || '', fmtFecha(f.fecha_factura), fmtFecha(f.fecha_vencimiento) || '',
      f.subtotal || 0, f.descuento || 0, f.iva_trasladado || 0, f.retencion_iva || 0, f.retencion_isr || 0,
      f.nc_subtotal || 0, f.nc_iva || 0, f.monto_total || 0, f.monto_pagado || 0, f.saldo_pendiente || 0,
      f.estatus_factura || '', f.estado_sat || 'Vigente', f.tipo_comprobante || 'Factura',
      f.proyecto || '', f.empresa || '', f.observaciones || ''
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
  XLSX.writeFile(wb, `facturas_dehur_${hoyFecha().replace(/\//g, '-')}.xlsx`);
  notify(`Reporte exportado (${fil.length} factura${fil.length !== 1 ? 's' : ''})`);
}

function refreshFactProyectos() {
  const sel = document.getElementById('ff-proy');
  if (!sel) return;
  const val = sel.value;
  const opts = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
  sel.innerHTML = '<option value="">Todos los proyectos</option>' + opts.map(n => `<option>${escapeHtml(n)}</option>`).join('');
  sel.value = val;
}

function estatusBadge(estatus) {
  const colors = {
    pendiente: 'rgba(200,169,110,.15);color:var(--accent)',
    parcial: 'rgba(52,152,219,.15);color:#3498db',
    pagada: 'rgba(39,174,96,.15);color:#27ae60',
    cancelada: 'rgba(231,76,60,.15);color:#e74c3c'
  };
  const style = colors[estatus] || 'rgba(200,169,110,.15);color:var(--accent)';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${style};">${estatus}</span>`;
}

// Recalcula saldo_pendiente y estatus_factura (estado de PAGO) a partir de
// monto_total y monto_pagado. Fuente ÚNICA usada por guardar/vincular/eliminar
// para que las 3 rutas no diverjan (saldo siempre clampado a 0; estatus coherente
// con lo pagado). NO toca estado_sat (fiscal, independiente) ni respeta 'cancelada'
// aquí — eso solo aplica a facturas sin pagos (ver guardarFactura).
function recalcularSaldoEstatus(fact) {
  fact.saldo_pendiente = Math.max(0, (fact.monto_total || 0) - (fact.monto_pagado || 0));
  if ((fact.monto_pagado || 0) <= 0) {
    fact.estatus_factura = 'pendiente';
    fact.fecha_pago_total = '';
  } else if (fact.saldo_pendiente <= 1) {   // tolerancia de redondeo: ≤ $1 (el banco paga en pesos cerrados) → pagada
    fact.estatus_factura = 'pagada';
    if (!fact.fecha_pago_total) fact.fecha_pago_total = new Date().toISOString().split('T')[0];
  } else {
    fact.estatus_factura = 'parcial';
    fact.fecha_pago_total = '';
  }
}

// Estado fiscal del CFDI (Vigente/Cancelada) — distinto del estatus de PAGO.
function estadoSatBadge(estado) {
  const e = estado || 'Vigente';
  const style = e === 'Cancelada'
    ? 'rgba(231,76,60,.15);color:#e74c3c'
    : 'rgba(39,174,96,.15);color:#27ae60';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${style};">${e}</span>`;
}

// ===== CRUD Facturas =====

function populateFacturaSelects() {
  const selProy = document.getElementById('f-proyecto');
  selProy.innerHTML = '<option value="">— Sin proyecto —</option>' +
    state.proyectos.filter(p => p.activo !== false).map(p => `<option>${escapeHtml(p.nombre)}</option>`).join('');
  const selEmp = document.getElementById('f-empresa');
  if (selEmp) selEmp.innerHTML = '<option value="">— Sin especificar —</option>' +
    EMPRESAS_FACTURA.map(e => `<option>${escapeHtml(e)}</option>`).join('');
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
      <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);margin-right:6px;">${p.id}</span>${escapeHtml(p.nombre)}
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
  // Autollenar datos fiscales del emisor desde el proveedor (solo si están vacíos,
  // para no pisar lo que ya se capturó del XML).
  const rfcEl = document.getElementById('f-rfc-emisor');
  if (rfcEl && !rfcEl.value) rfcEl.value = (p.rfc || '').toUpperCase();
  const rsEl = document.getElementById('f-razon-social');
  if (rsEl && !rsEl.value) rsEl.value = p.nombre || '';
}

// Recalcula IVA sugerido y el Total a partir del desglose fiscal. IVA = (subtotal -
// descuento) * 0.16, pero NO se pisa si el usuario lo editó a mano (dataset.touched).
// El Total solo se autocalcula cuando hay subtotal (>0): así no machaca el monto de
// facturas viejas que solo tienen Total.
export function recalcularTotalFactura() {
  const num = id => { const el = document.getElementById(id); return el ? (parseFloat(el.value) || 0) : 0; };
  const round2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
  const subtotal = num('f-subtotal');
  const ivaEl = document.getElementById('f-iva');
  if (ivaEl && !ivaEl.dataset.touched) {
    ivaEl.value = round2((subtotal - num('f-descuento')) * 0.16);
  }
  // Nota de crédito: el IVA de la NC se autocalcula al 16% del monto NC (editable) y,
  // junto con el monto NC, se RESTA del total → monto_total queda como el NETO a pagar.
  const ncSub = num('f-nc-subtotal');
  const ncIvaEl = document.getElementById('f-nc-iva');
  if (ncIvaEl && !ncIvaEl.dataset.touched) {
    ncIvaEl.value = ncSub > 0 ? round2(ncSub * 0.16) : 0;
  }
  if (subtotal > 0) {
    const total = subtotal - num('f-descuento') + num('f-iva') - num('f-retiva') - num('f-retisr')
                  - num('f-nc-subtotal') - num('f-nc-iva');
    document.getElementById('f-monto').value = round2(total);
  }
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
  // Campos fiscales (CFDI) nuevos.
  document.getElementById('f-tipo-comprobante').value = 'Factura';
  document.getElementById('f-estado-sat').value = 'Vigente';
  document.getElementById('f-rfc-emisor').value = '';
  document.getElementById('f-subtotal').value = '';
  document.getElementById('f-descuento').value = '0';
  const ivaNew = document.getElementById('f-iva'); ivaNew.value = ''; delete ivaNew.dataset.touched;
  document.getElementById('f-retiva').value = '0';
  document.getElementById('f-retisr').value = '0';
  document.getElementById('f-nc-subtotal').value = '0';
  const ncIvaNew = document.getElementById('f-nc-iva'); ncIvaNew.value = '0'; delete ncIvaNew.dataset.touched;
  // Vincular pagos existentes solo aplica a una factura YA creada (necesita saldo).
  ocultarBuscadorPagosFactura();
  document.getElementById('fact-pagos-vinc').style.display = 'none';
  document.getElementById('fact-eliminar-btn').style.display = 'none'; // no se borra algo que no existe
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
  document.getElementById('f-empresa').value = f.empresa || '';
  document.getElementById('f-obs').value = f.observaciones || '';
  // Campos fiscales (CFDI). El RFC cae al del proveedor si la factura no lo trae.
  document.getElementById('f-tipo-comprobante').value = f.tipo_comprobante || 'Factura';
  document.getElementById('f-estado-sat').value = f.estado_sat || 'Vigente';
  document.getElementById('f-rfc-emisor').value = (f.rfc_emisor || (prov && prov.rfc) || '').toUpperCase();
  document.getElementById('f-subtotal').value = f.subtotal || 0;
  document.getElementById('f-descuento').value = f.descuento || 0;
  const ivaEdit = document.getElementById('f-iva'); ivaEdit.value = f.iva_trasladado || 0; ivaEdit.dataset.touched = '1';
  document.getElementById('f-retiva').value = f.retencion_iva || 0;
  document.getElementById('f-retisr').value = f.retencion_isr || 0;
  document.getElementById('f-nc-subtotal').value = f.nc_subtotal || 0;
  // Marcar "touched" SOLO si la factura ya traía IVA de NC (para preservarlo). Si no traía NC,
  // dejarlo SIN touched para que al agregar una NC en edición el IVA se autollene (16%) y el total
  // baje solo — igual que en "Nueva factura". (Sin esto, editar dejaba muerto el autocálculo de NC.)
  const ncIvaEdit = document.getElementById('f-nc-iva'); ncIvaEdit.value = f.nc_iva || 0;
  if (f.nc_iva > 0) ncIvaEdit.dataset.touched = '1'; else delete ncIvaEdit.dataset.touched;
  // En edición sí se puede vincular pagos del historial a esta factura.
  document.getElementById('fact-pagos-vinc').style.display = '';
  // El botón Eliminar aparece al editar; el CSS (.req-borrar-factura) decide si el rol lo ve.
  document.getElementById('fact-eliminar-btn').style.display = '';
  ocultarBuscadorPagosFactura();
  document.getElementById('modal-factura').classList.add('open');
}

// Detalle de factura SOLO LECTURA (doble click en la fila). Para roles de solo lectura
// (p.ej. contabilidad/Ericka) que no ven el botón Editar: ver datos + pagos ligados.
export function abrirDetalleFactura(id) {
  const f = state.facturas.find(x => x.factura_id === id);
  if (!f) return;
  const prov = state.proveedores.find(p => p.id === f.proveedor_id);
  const provNombre = f.nombre_proveedor || (prov && prov.nombre) || f.razon_social || ('ID ' + f.proveedor_id);
  const ncTotal = (f.nc_subtotal || 0) + (f.nc_iva || 0);
  const fila = (k, v) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:4px 0;border-bottom:1px solid var(--border);font-size:12px;"><span style="color:var(--muted);">${k}</span><span style="text-align:right;font-weight:500;">${v}</span></div>`;
  const filaMonto = (k, v, color) => fila(k, `<span style="font-family:'DM Mono',monospace;${color ? 'color:' + color + ';' : ''}">${fmt(v)}</span>`);

  const fps = state.facturaPagos.filter(fp => String(fp.factura_id) === String(id));
  const pagosHTML = fps.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px;">
         <thead><tr style="color:var(--muted);text-align:left;border-bottom:1px solid var(--border);">
           <th style="padding:4px 6px;">Fecha</th><th style="padding:4px 6px;text-align:right;">Monto aplicado</th><th style="padding:4px 6px;">Concepto</th></tr></thead>
         <tbody>${fps.map(fp => {
           const pago = state.historial.find(p => String(p.id) === String(fp.pago_id));
           const concepto = fp.observaciones || (pago && pago.concepto) || '';
           return `<tr style="border-bottom:1px solid var(--border);">
             <td style="padding:4px 6px;font-family:'DM Mono',monospace;color:var(--muted);">${fmtFecha(fp.fecha_pago)}</td>
             <td style="padding:4px 6px;text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(fp.monto_aplicado)}</td>
             <td style="padding:4px 6px;color:var(--muted);">${escapeHtml(concepto)}</td>
           </tr>`;
         }).join('')}</tbody>
       </table>
       <div style="font-size:11px;color:var(--muted);margin-top:4px;">${fps.length} pago(s) · aplicado ${fmt(fps.reduce((s, fp) => s + (fp.monto_aplicado || 0), 0))}</div>`
    : '<div style="font-size:12px;color:var(--muted);padding:6px 0;">Sin pagos ligados a esta factura.</div>';

  document.getElementById('detalle-factura-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px;">
      <div>
        ${fila('Factura (ID)', '#' + f.factura_id)}
        ${fila('Número', escapeHtml(f.numero_factura) || '—')}
        ${fila('UUID (folio fiscal)', `<span style="font-family:'DM Mono',monospace;font-size:11px;">${escapeHtml(f.uuid) || '—'}</span>`)}
        ${fila('RFC emisor', escapeHtml(f.rfc_emisor) || '—')}
        ${fila('Proveedor', escapeHtml(provNombre))}
        ${fila('Razón social', escapeHtml(f.razon_social) || '—')}
        ${fila('Empresa facturada', escapeHtml(f.empresa) || '—')}
        ${fila('Proyecto', escapeHtml(f.proyecto) || '—')}
        ${fila('Tipo comprobante', escapeHtml(f.tipo_comprobante) || '—')}
        ${fila('Estado SAT', escapeHtml(f.estado_sat) || 'Vigente')}
        ${fila('Estatus de pago', escapeHtml(f.estatus_factura) || '—')}
      </div>
      <div>
        ${fila('Fecha factura', fmtFecha(f.fecha_factura) || '—')}
        ${fila('Vencimiento', fmtFecha(f.fecha_vencimiento) || '—')}
        ${filaMonto('Subtotal', f.subtotal || 0)}
        ${filaMonto('Descuento', f.descuento || 0)}
        ${filaMonto('IVA', f.iva_trasladado || 0)}
        ${filaMonto('Retención IVA', f.retencion_iva || 0)}
        ${filaMonto('Retención ISR', f.retencion_isr || 0)}
        ${ncTotal > 0.005 ? filaMonto('Nota de crédito', ncTotal, 'var(--red)') : ''}
        ${filaMonto('Total neto', f.monto_total || 0)}
        ${filaMonto('Pagado', f.monto_pagado || 0, 'var(--green)')}
        ${filaMonto('Saldo', f.saldo_pendiente || 0, (f.saldo_pendiente || 0) > 0 ? 'var(--accent)' : 'var(--muted)')}
      </div>
    </div>
    ${f.observaciones ? `<div style="margin-top:10px;font-size:12px;"><span style="color:var(--muted);">Observaciones:</span> ${escapeHtml(f.observaciones)}</div>` : ''}
    <div style="margin-top:14px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-top:1px solid var(--border);padding-top:8px;">Pagos ligados a esta factura</div>
    ${pagosHTML}`;
  const tit = document.getElementById('modal-detalle-fact-title');
  if (tit) tit.textContent = 'Detalle · Factura #' + f.factura_id;
  document.getElementById('modal-detalle-factura').classList.add('open');
}

export function guardarFactura() {
  const esNueva = !state.editFactId;
  const provId = parseInt(document.getElementById('f-proveedor-id').value);
  const folio = document.getElementById('f-folio').value.trim();
  const fechaFact = document.getElementById('f-fecha-factura').value;
  const monto = parseFloat(document.getElementById('f-monto').value) || 0;
  const subtotal = parseFloat(document.getElementById('f-subtotal').value) || 0;
  const uuid = document.getElementById('f-uuid').value.trim();

  if (!provId) { notify('Selecciona un proveedor', 'error'); return; }
  if (!folio) { notify('El folio es obligatorio', 'error'); return; }
  if (!uuid) { notify('El UUID (folio fiscal) es obligatorio', 'error'); return; }
  if (!fechaFact) { notify('La fecha de factura es obligatoria', 'error'); return; }
  if (subtotal <= 0) { notify('El subtotal es obligatorio', 'error'); return; }
  if (monto <= 0) { notify('El total debe ser mayor a 0', 'error'); return; }

  // Anti-duplicados: evita registrar dos veces la misma factura. Al editar se
  // compara contra las DEMÁS (se excluye la propia por factura_id). Misma lógica
  // de detección que la importación por Excel (facturas-import.js).
  const norm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const otras = state.facturas.filter(f => f.factura_id !== state.editFactId);
  // UUID idéntico = es la misma factura (folio fiscal único en el SAT) → bloquea.
  const dupUuid = otras.find(f => f.uuid && norm(f.uuid) === norm(uuid));
  if (dupUuid) { notify(`Ya existe una factura con ese UUID (folio fiscal): #${dupUuid.factura_id} · ${dupUuid.numero_factura || ''}`, 'error'); return; }
  // Señales fuertes (no idénticas) → avisa y deja continuar si el usuario confirma.
  const dupFolio = otras.find(f => String(f.proveedor_id) === String(provId) && norm(f.numero_factura) === norm(folio));
  const dupMfp = otras.find(f => String(f.proveedor_id) === String(provId)
    && (+f.monto_total || 0).toFixed(2) === monto.toFixed(2)
    && (f.fecha_factura || '') === fechaFact);
  if (dupFolio || dupMfp) {
    const motivos = [];
    if (dupFolio) motivos.push(`• Mismo folio "${folio}" y proveedor (factura #${dupFolio.factura_id}, ${dupFolio.fecha_factura})`);
    if (dupMfp && dupMfp !== dupFolio) motivos.push(`• Mismo monto, fecha y proveedor (factura #${dupMfp.factura_id})`);
    if (!confirm(`⚠️ Posible factura duplicada:\n\n${motivos.join('\n')}\n\n¿Guardar de todos modos?`)) return;
  }

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
    saldo_pendiente: Math.max(0, monto - pagado),
    estatus_factura: document.getElementById('f-estatus').value,
    proyecto: document.getElementById('f-proyecto').value,
    empresa: document.getElementById('f-empresa').value,
    observaciones: document.getElementById('f-obs').value.trim(),
    activo: true,
    uuid,
    // Datos fiscales del CFDI (Fase 2).
    subtotal,
    descuento: parseFloat(document.getElementById('f-descuento').value) || 0,
    iva_trasladado: parseFloat(document.getElementById('f-iva').value) || 0,
    retencion_iva: parseFloat(document.getElementById('f-retiva').value) || 0,
    retencion_isr: parseFloat(document.getElementById('f-retisr').value) || 0,
    // Nota de crédito (acumulada): resta del total → monto_total ya es el neto a pagar.
    nc_subtotal: parseFloat(document.getElementById('f-nc-subtotal').value) || 0,
    nc_iva: parseFloat(document.getElementById('f-nc-iva').value) || 0,
    rfc_emisor: document.getElementById('f-rfc-emisor').value.trim().toUpperCase(),
    estado_sat: document.getElementById('f-estado-sat').value,
    tipo_comprobante: document.getElementById('f-tipo-comprobante').value
  };

  // Si la factura YA tiene pagos, el saldo y el estatus de PAGO se DERIVAN de lo
  // pagado (no se leen del menú) para que no queden incoherentes al editar el
  // desglose. Sin pagos se respeta lo elegido en el menú (p.ej. 'cancelada').
  if (pagado > 0) recalcularSaldoEstatus(obj);

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

  // Devengado (Fase B): si cambió el total y la factura ya estaba repartida,
  // recalcula los montos del reparto manteniendo las proporciones (factor).
  if (state.editFactId && existing && (existing.monto_total || 0) !== monto) {
    const asigs = state.costoAsignaciones.filter(a => String(a.factura_id) === String(obj.factura_id));
    if (asigs.length) {
      asigs.forEach(a => { a.monto_asignado = Math.round((monto * (a.factor || 0) + Number.EPSILON) * 100) / 100; });
      gsSaveCostoAsignaciones();
    }
  }

  // Al CREAR una factura nueva con proyecto y casas activas, abre el repartidor de
  // inmediato para asignar el costo (devengado) de corrido, sin que sea un paso aparte.
  // Si no hay proyecto/casas o está cancelada, no se abre: queda el "⚠ Repartir" para
  // después. No se bloquea: la factura ya quedó guardada pase lo que pase.
  if (esNueva && obj.proyecto && obj.estado_sat !== 'Cancelada'
      && state.unidades.some(u => u.activo !== false && u.proyecto === obj.proyecto)
      && window.abrirRepartirFactura) {
    window.abrirRepartirFactura(obj.factura_id);
  }
}

// Borrar una factura (corregir errores). Solo admin + rol 'facturas'. Limpia su
// cascada: pagos a factura (los pagos del historial se conservan, solo se
// desvinculan), su devengado (asignaciones de costo) y la propia factura.
export function eliminarFactura() {
  if (!puedeBorrarFacturas()) { notify('No tienes permiso para borrar facturas', 'error'); return; }
  const id = state.editFactId;
  const fact = state.facturas.find(f => f.factura_id === id);
  if (!fact) { notify('Abre una factura primero', 'error'); return; }

  const fps = state.facturaPagos.filter(fp => fp.factura_id === id);
  const aviso = fps.length
    ? `Esta factura tiene ${fps.length} pago(s) aplicados: se DESVINCULARÁN (los pagos del historial se conservan).\n\n`
    : '';
  if (!confirm(`${aviso}¿Eliminar la factura ${fact.numero_factura || ''} (#${id})? No se puede deshacer.`)) return;

  const porFilaF = esPorFila('facturas');
  const porFilaFp = esPorFila('facturaPagos');
  const porFilaH = esPorFila('historial');

  // 1) Quitar los pagos aplicados a esta factura (el pago del historial NO se borra).
  fps.forEach(fp => { if (porFilaFp) sbBorrarFila('facturaPagos', fp.factura_pago_id); });
  state.facturaPagos = state.facturaPagos.filter(fp => fp.factura_id !== id);

  // 2) Desvincular del historial los pagos que apuntaban a esta factura.
  state.historial.forEach(h => {
    if (h.factura_id && String(h.factura_id) === String(id)) {
      h.factura_id = '';
      if (porFilaH) sbGuardarFila('historial', h);
    }
  });

  // 3) Borrar el devengado (reparto a unidades) de esta factura.
  purgarAsignacionesDeFactura(id);

  // 4) Quitar la factura.
  state.facturas = state.facturas.filter(f => f.factura_id !== id);
  if (porFilaF) sbBorrarFila('facturas', id);

  // 5) Guardar (a Sheets) y refrescar.
  gsSaveFacturas({ porFila: porFilaF });
  gsSaveFacturaPagos({ porFila: porFilaFp });
  cerrar('modal-factura');
  state.editFactId = null;
  renderFacturas();
  renderFacturaPagos();
  document.getElementById('cnt-fact').textContent = state.facturas.length;
  document.getElementById('cnt-fp').textContent = state.facturaPagos.length;
  if (window.renderHistorial) window.renderHistorial();
  notify('Factura eliminada');
}

// ===== Factura Pagos (solo lectura) =====

export function renderFacturaPagos() {
  const tb = document.getElementById('tbody-fp');
  if (!tb) return;

  if (!datosListos()) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div></td></tr>';
    const sub = document.getElementById('fp-subtitulo'); if (sub) sub.textContent = '';
    const cnt = document.getElementById('cnt-fp'); if (cnt) cnt.textContent = '0';
    return;
  }

  if (!state.facturaPagos.length) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">💳</div><div>Sin pagos a facturas registrados</div></div></td></tr>';
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
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin resultados</div></div></td></tr>';
    return;
  }

  tb.innerHTML = fil.map(fp => {
    const prov = state.proveedores.find(p => p.id === fp.proveedor_id);
    const provNombre = prov ? prov.nombre : `ID ${fp.proveedor_id}`;
    const estBadge = estatusBadge(fp.estatus);
    const fact = state.facturas.find(f => f.factura_id === fp.factura_id);
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${String(fp.factura_pago_id).slice(0, 8)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;">${fp.factura_id}</td>
      <td><div style="font-weight:500;font-size:12px;">${escapeHtml(provNombre)}</div></td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;color:var(--accent);">${fmt(fp.monto_aplicado)}</td>
      <td style="font-family:'DM Mono',monospace;text-align:right;color:${fact && fact.saldo_pendiente > 0 ? 'var(--accent)' : 'var(--muted)'};">${fact ? fmt(fact.saldo_pendiente) : '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(fp.fecha_pago)}</td>
      <td>${estBadge}</td>
      <td style="font-size:11px;color:var(--muted);">${escapeHtml((fp.observaciones || '').substring(0, 40))}</td>
      <td style="text-align:right;"><button class="btn btn-ghost req-facturas" style="padding:4px 6px;font-size:11px;color:#e74c3c;" onclick="eliminarPagoFactura('${fp.factura_pago_id}')">✕</button></td>
    </tr>`;
  }).join('');
}

// Restante de un pago = su importe menos lo YA aplicado a facturas (suma de sus facturaPagos).
// Con esto un mismo pago se puede repartir POR PARTES entre varias facturas sin pasarse.
function restantePago(pago) {
  if (!pago) return 0;
  const aplicado = state.facturaPagos
    .filter(fp => String(fp.pago_id) === String(pago.id))
    .reduce((s, fp) => s + (fp.monto_aplicado || 0), 0);
  return Math.round(((pago.importe || 0) - aplicado) * 100) / 100;
}

export function eliminarPagoFactura(fpId) {
  const fp = state.facturaPagos.find(x => String(x.factura_pago_id) === String(fpId));
  if (!fp) return;
  if (!confirm(`¿Eliminar pago de ${fmt(fp.monto_aplicado)} a factura ${fp.factura_id}?`)) return;

  const fact = state.facturas.find(f => f.factura_id === fp.factura_id);
  if (fact) {
    fact.monto_pagado = Math.max(0, (fact.monto_pagado || 0) - fp.monto_aplicado);
    recalcularSaldoEstatus(fact);
  }

  state.facturaPagos = state.facturaPagos.filter(x => String(x.factura_pago_id) !== String(fpId));

  // Desligar el pago del historial SOLO si ya no le queda NINGUNA otra factura aplicada
  // (con multi-factura un pago puede seguir cubriendo otras). Si le quedan, deja el
  // marcador (factura_id) apuntando a una de ellas para que su costo siga suprimiéndose.
  const porFilaH = esPorFila('historial');
  let pagoDesligado = null;
  if (fp.pago_id) {
    pagoDesligado = state.historial.find(p => String(p.id) === String(fp.pago_id));
    if (pagoDesligado) {
      const otras = state.facturaPagos.filter(x => String(x.pago_id) === String(fp.pago_id));
      pagoDesligado.factura_id = otras.length ? String(otras[0].factura_id) : '';
      if (porFilaH) sbGuardarFila('historial', pagoDesligado);
    }
  }
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
  if (pagoDesligado) {
    if (window.renderHistorial) window.renderHistorial();
    if (window.renderCostosFiscales) window.renderCostosFiscales();
  }
  document.getElementById('cnt-fact').textContent = state.facturas.length;
  document.getElementById('cnt-fp').textContent = state.facturaPagos.length;
  notify('Pago a factura eliminado');
}

// ===== Vincular un pago YA existente del historial → factura (Fase 1) =====
// Reutiliza la lógica del auto-enlace de confirmar-pagos.js (al confirmar un pago
// con factura_id): crea el facturaPago, actualiza saldo/estatus de la factura y
// marca factura_id en el pago. NO toca costoAsignaciones: en Fase 1 el reparto de
// costo sigue viviendo en el pago; la factura todavía no es fuente de costo (eso
// es Fase 2), así que no hay doble conteo.

function ocultarBuscadorPagosFactura() {
  const panel = document.getElementById('fact-pagos-vinc-panel');
  if (panel) panel.style.display = 'none';
}

export function abrirBuscadorPagosFactura() {
  const panel = document.getElementById('fact-pagos-vinc-panel');
  if (panel) panel.style.display = '';
  const inp = document.getElementById('fact-pagos-buscar');
  if (inp) inp.value = '';
  filtrarPagosParaFactura();
}

export function filtrarPagosParaFactura() {
  const cont = document.getElementById('fact-pagos-result');
  if (!cont) return;
  const f = state.facturas.find(x => x.factura_id === state.editFactId);
  if (!f) { cont.innerHTML = ''; return; }
  const q = (document.getElementById('fact-pagos-buscar')?.value || '').toLowerCase().trim();

  // Match inteligente: ordena por cercanía de MONTO (luego FECHA) y separa "mismo proveedor"
  // de "otros con el mismo monto" (estos surgen aunque el pago tenga el proveedor mal puesto).
  const _toDays = iso => { const t = new Date((iso || '') + 'T00:00:00').getTime(); return isNaN(t) ? null : t / 86400000; };
  const fRefDays = _toDays(parseFechaHist(f.fecha_vencimiento) || parseFechaHist(f.fecha_factura) || '');
  const tol = Math.max(1, (f.monto_total || 0) * 0.01);
  const targets = [f.monto_total || 0];
  if ((f.saldo_pendiente || 0) > 0.01) targets.push(f.saldo_pendiente);
  const matchQ = h => !q ||
    (h.concepto || '').toLowerCase().includes(q) || (h.nombre || '').toLowerCase().includes(q) ||
    String(h.importe).includes(q) || (h.fecha || '').includes(q);

  // Candidatos: pagos con RESTANTE por aplicar (importe − lo ya aplicado a facturas) y que NO
  // estén ya aplicados a ESTA factura. Así un pago se reparte por partes entre varias facturas.
  const base = state.historial
    .filter(h => h.id && restantePago(h) > 0.01 && matchQ(h)
      && !state.facturaPagos.some(fp => String(fp.pago_id) === String(h.id) && String(fp.factura_id) === String(f.factura_id)))
    .map(h => {
      const rest = restantePago(h);
      const montoDiff = Math.min(...targets.map(t => Math.abs(rest - t)));
      const pDays = _toDays(parseFechaHist(h.fecha) || '');
      const fechaDiff = (fRefDays != null && pDays != null) ? Math.abs(pDays - fRefDays) : 99999;
      return { h, rest, montoDiff, fechaDiff, mismoProv: parseInt(h.proveedor_id) === f.proveedor_id, exacto: montoDiff < 0.01, cercano: montoDiff <= tol };
    });
  const ordenar = arr => arr.sort((a, b) => (a.montoDiff - b.montoDiff) || (a.fechaDiff - b.fechaDiff));
  const mismoProv = ordenar(base.filter(x => x.mismoProv)).slice(0, 25);
  const otros = ordenar(base.filter(x => !x.mismoProv && x.cercano)).slice(0, 10);

  if (!mismoProv.length && !otros.length) {
    cont.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--muted);">Sin pagos con saldo por aplicar que coincidan</div>';
    return;
  }

  const saldoF = Math.max(0, (f.monto_total || 0) - (f.monto_pagado || 0));
  const fila = x => {
    const h = x.h;
    const badge = x.exacto ? '<span style="font-size:9px;font-weight:700;color:var(--green);background:rgba(39,174,96,.12);padding:1px 6px;border-radius:4px;">✓ mismo monto</span>'
      : x.cercano ? '<span style="font-size:9px;color:var(--accent);background:rgba(200,169,110,.14);padding:1px 6px;border-radius:4px;">monto similar</span>' : '';
    const fechaB = x.fechaDiff <= 10 ? ' <span style="font-size:9px;color:var(--muted);">· fecha cercana</span>' : '';
    const defMonto = Math.round(Math.min(saldoF, x.rest) * 100) / 100;
    const inpId = 'fp-aplicar-' + h.id;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border);">
      <div style="min-width:0;">
        <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(h.concepto || h.nombre || '—')} ${badge}${fechaB}</div>
        <div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;">${fmtFecha(h.fecha)} · ${fmt(h.importe)}${h.proyecto ? ' · ' + escapeHtml(h.proyecto) : ''} · restante ${fmt(x.rest)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        <span style="font-size:10px;color:var(--muted);">Aplicar $</span>
        <input type="number" step="0.01" min="0" max="${defMonto}" id="${inpId}" value="${defMonto}" style="width:88px;text-align:right;font-family:'DM Mono',monospace;font-size:11px;padding:3px 6px;">
        <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px;" onclick="vincularPagoAFactura('${h.id}', document.getElementById('${inpId}').value)">Vincular</button>
      </div>
    </div>`;
  };
  const header = txt => `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:6px 10px;background:var(--surface2);border-bottom:1px solid var(--border);">${txt}</div>`;
  let html = '';
  if (mismoProv.length) html += header('Del mismo proveedor (más probables arriba)') + mismoProv.map(fila).join('');
  if (otros.length) html += header('Otros con el mismo monto (otro proveedor)') + otros.map(fila).join('');
  cont.innerHTML = html;
}

export function vincularPagoAFactura(pagoId, montoAplicado) {
  const fact = state.facturas.find(x => x.factura_id === state.editFactId);
  if (!fact) { notify('Abre una factura primero', 'error'); return; }
  if (fact.estatus_factura === 'cancelada') {
    notify('La factura está cancelada', 'error'); return;
  }
  // Se permite ligar aunque el estatus diga "pagada" (p.ej. facturas viejas capturadas como
  // pagadas): lo que importa es que quede SALDO REAL por aplicar (total − pagado), no la etiqueta.
  // Al ligar el pago, recalcularSaldoEstatus deja el estatus consistente.
  const saldoReal = Math.round(((fact.monto_total || 0) - (fact.monto_pagado || 0)) * 100) / 100;
  if (saldoReal <= 0.01) {
    notify('La factura ya no tiene saldo por aplicar', 'error'); return;
  }
  ensureHistorialIds(); // asegura pago.id estable para guardar la fila
  const pago = state.historial.find(h => String(h.id) === String(pagoId));
  if (!pago) { notify('No se encontró el pago', 'error'); return; }
  // Un pago se puede aplicar POR PARTES a VARIAS facturas. Solo se evita aplicar el MISMO
  // pago a la MISMA factura dos veces (duplicaría el monto_pagado). Para corregir un monto,
  // borra la línea en "Pagos a Facturas" y vuelve a aplicar.
  if (state.facturaPagos.some(fp => String(fp.pago_id) === String(pago.id) && String(fp.factura_id) === String(fact.factura_id))) {
    notify('Ese pago ya está aplicado a esta factura', 'error'); return;
  }
  const restante = restantePago(pago);
  if (restante <= 0.01) { notify('Ese pago ya está aplicado por completo a otras facturas', 'error'); return; }
  if (parseInt(pago.proveedor_id) !== fact.proveedor_id) {
    if (!confirm('El proveedor del pago no coincide con el de la factura. ¿Vincular de todos modos?')) return;
  }
  // Monto a aplicar EN ESTA factura: lo que pida el usuario, topado al saldo de la factura y
  // al restante del pago → imposible sobrepagar la factura ni pasar del importe del pago.
  const tope = Math.round(Math.min(saldoReal, restante) * 100) / 100;
  let monto = parseFloat(montoAplicado);
  if (!isFinite(monto) || monto <= 0) monto = tope;
  monto = Math.round(Math.min(monto, tope) * 100) / 100;
  if (monto <= 0) { notify('No hay saldo por aplicar en esta factura', 'error'); return; }

  const fpId = nuevoFacturaPagoId();
  const nuevoFp = {
    factura_pago_id: fpId,
    factura_id: fact.factura_id,
    pago_id: pago.id || 0,
    proveedor_id: parseInt(pago.proveedor_id) || 0,
    monto_aplicado: monto,
    fecha_pago: pago.fecha || hoyFecha(),
    estatus: 'aplicado',
    observaciones: pago.concepto || ''
  };
  state.facturaPagos.push(nuevoFp);

  fact.monto_pagado = (fact.monto_pagado || 0) + monto;
  recalcularSaldoEstatus(fact);

  // Marca en el pago que ya está aplicado a (al menos) una factura. Es la bandera para la
  // supresión de costo; con varias facturas apunta a la primera (el detalle vive en facturaPagos).
  if (!(pago.factura_id && String(pago.factura_id) !== '')) pago.factura_id = String(fact.factura_id);

  // Guardado por fila (Fase 3).
  const pfF = esPorFila('facturas');
  const pfFp = esPorFila('facturaPagos');
  const pfH = esPorFila('historial');
  gsSaveFacturas({ porFila: pfF });
  gsSaveFacturaPagos({ porFila: pfFp });
  if (pfF) sbGuardarFila('facturas', fact);
  if (pfFp) sbGuardarFila('facturaPagos', nuevoFp);
  if (pfH) sbGuardarFila('historial', pago);

  renderFacturas();
  renderFacturaPagos();
  filtrarPagosParaFactura();              // desaparece de ESTA factura; sigue en otras si le queda restante
  const sel = document.getElementById('f-estatus');
  if (sel) sel.value = fact.estatus_factura; // refleja el estatus nuevo en el modal abierto
  document.getElementById('cnt-fp').textContent = state.facturaPagos.length;
  if (window.renderHistorial) window.renderHistorial();
  const rest2 = restantePago(pago);
  notify(rest2 > 0.01
    ? `Aplicado ${fmt(monto)} a la factura · restante del pago ${fmt(rest2)}`
    : `Aplicado ${fmt(monto)} · pago aplicado por completo`);
}

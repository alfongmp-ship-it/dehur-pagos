import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveCreditos, gsSavePagares, gsSavePagosPagare, saveData } from '../services/google-sync.js';

// ===== RENDER PRINCIPAL =====
export function renderCreditos() {
  const tabs = document.getElementById('creditos-tabs');
  const content = document.getElementById('creditos-content');
  if (!tabs || !content) return;

  const activos = state.creditos.filter(c => c.activo !== false);
  document.getElementById('cnt-creditos').textContent = activos.length;
  document.getElementById('creditos-subtitulo').textContent = activos.length ? `${activos.length} crédito${activos.length !== 1 ? 's' : ''}` : '';

  // Si no hay tab activo o el activo ya no existe, seleccionar el primero
  if (!state.creditoTabActivo || !activos.find(c => c.credito_id === state.creditoTabActivo)) {
    state.creditoTabActivo = activos.length ? activos[0].credito_id : null;
  }

  // Render tabs
  tabs.innerHTML = activos.map(c => {
    const isActive = c.credito_id === state.creditoTabActivo;
    return `<button onclick="seleccionarCredito(${c.credito_id})" style="padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};background:${isActive ? 'rgba(200,169,110,.15)' : 'var(--surface2)'};color:${isActive ? 'var(--accent)' : 'var(--muted)'};">${c.nombre}</button>`;
  }).join('') + `<button onclick="abrirNuevoCredito()" style="padding:8px 16px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;border:1px dashed var(--border);background:transparent;color:var(--muted);">+ Nuevo</button>`;

  if (!activos.length) {
    content.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🏛</div><div>Sin créditos registrados</div></div>';
    return;
  }

  const c = activos.find(x => x.credito_id === state.creditoTabActivo);
  if (!c) { content.innerHTML = ''; return; }

  const pagares = state.pagares.filter(p => p.credito_id === c.credito_id && p.activo !== false);
  const totalDispuesto = pagares.reduce((s, p) => s + p.monto, 0);
  const disponible = c.monto_autorizado - totalDispuesto;

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">${c.nombre} – ${c.banco}</div>
          <div style="display:flex;gap:24px;flex-wrap:wrap;font-size:12px;color:var(--muted);">
            <div>Tipo: <strong style="color:var(--text-primary);">${c.tipo_credito}</strong></div>
            <div>Monto autorizado: <strong style="color:var(--text-primary);">${fmt(c.monto_autorizado)}</strong></div>
            <div>Tasa base: <strong style="color:var(--text-primary);">${c.tasa_base}%</strong></div>
            <div>Proyecto: ${proyTag(c.proyecto)}</div>
            <div>Cuenta pago: <strong style="color:var(--text-primary);">${c.cuenta_pago || '—'}</strong></div>
          </div>
          <div style="display:flex;gap:24px;margin-top:8px;font-size:12px;">
            <div style="color:var(--accent);">Disponible: <strong>${fmt(disponible)}</strong></div>
            <div style="color:var(--muted);">Dispuesto: <strong>${fmt(totalDispuesto)}</strong></div>
          </div>
        </div>
        <button class="btn btn-ghost" style="font-size:11px;" onclick="editarCredito(${c.credito_id})">Editar</button>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <div style="font-size:14px;font-weight:600;">Disposiciones / Pagarés</div>
      <button class="btn btn-primary" style="font-size:11px;padding:6px 12px;" onclick="abrirNuevaDisposicion(${c.credito_id})">+ Nueva Disposición</button>
    </div>

    <div class="card" style="padding:0;">
      <table class="table">
        <thead><tr>
          <th style="width:30px;"></th>
          <th># Pagaré</th><th style="text-align:right">Monto</th><th>Fecha Disp.</th>
          <th>Vencimiento</th><th style="text-align:center">Tasa</th><th>Estatus</th>
        </tr></thead>
        <tbody id="tbody-pagares">${renderPagaresRows(pagares)}</tbody>
      </table>
    </div>
  `;
}

function renderPagaresRows(pagares) {
  if (!pagares.length) return '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">Sin disposiciones</td></tr>';

  return pagares.map(p => {
    const pagos = state.pagosPagare.filter(pp => pp.pagare_id === p.pagare_id);
    const isOpen = state._pagareOpen === p.pagare_id;
    const estBadge = p.estatus === 'Vigente'
      ? '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(39,174,96,.15);color:#27ae60;">Vigente</span>'
      : '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(150,150,150,.15);color:#aaa;">Pagado</span>';

    let rows = `<tr style="cursor:pointer;" onclick="togglePagare(${p.pagare_id})">
      <td style="text-align:center;font-size:10px;color:var(--muted);">${isOpen ? '▼' : '▶'}</td>
      <td style="font-weight:600;font-family:'DM Mono',monospace;">${p.numero_pagare}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;">${fmt(p.monto)}</td>
      <td style="font-size:11px;color:var(--muted);">${p.fecha_disposicion}</td>
      <td style="font-size:11px;color:var(--muted);">${p.fecha_vencimiento}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;text-align:center;">${p.tasa}%</td>
      <td>${estBadge}</td>
    </tr>`;

    if (isOpen) {
      rows += `<tr><td colspan="7" style="padding:0 0 0 30px;background:rgba(0,0,0,.15);">
        <div style="padding:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-size:12px;font-weight:600;color:var(--muted);">Fechas de Pago de Intereses</div>
            <button class="btn btn-ghost" style="font-size:10px;padding:4px 8px;" onclick="event.stopPropagation();abrirNuevaFechaPago(${p.pagare_id})">+ Agregar fecha</button>
          </div>
          ${renderFechasPago(pagos)}
        </div>
      </td></tr>`;
    }

    return rows;
  }).join('');
}

function renderFechasPago(pagos) {
  if (!pagos.length) return '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px;">Sin fechas de pago registradas</div>';

  const sorted = [...pagos].sort((a, b) => (a.fecha_pago || '').localeCompare(b.fecha_pago || ''));
  return `<table style="width:100%;font-size:11px;">
    <thead><tr style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em;">
      <th style="padding:4px 8px;">Fecha</th><th style="padding:4px 8px;text-align:right;">Monto Intereses</th>
      <th style="padding:4px 8px;">Concepto</th><th style="padding:4px 8px;">Estatus</th><th style="padding:4px 8px;"></th>
    </tr></thead>
    <tbody>${sorted.map(pp => {
      const estColor = pp.estatus === 'Pagado' ? '#27ae60' : '#e07a3a';
      const estIcon = pp.estatus === 'Pagado' ? '✓' : '⏳';
      return `<tr style="border-top:1px solid rgba(42,42,42,.5);">
        <td style="padding:6px 8px;font-family:'DM Mono',monospace;">${pp.fecha_pago}</td>
        <td style="padding:6px 8px;font-family:'DM Mono',monospace;text-align:right;font-weight:500;">${pp.monto_intereses ? fmt(pp.monto_intereses) : '—'}</td>
        <td style="padding:6px 8px;color:var(--muted);">${pp.concepto || '—'}</td>
        <td style="padding:6px 8px;"><span style="color:${estColor};font-weight:600;">${estIcon} ${pp.estatus}</span></td>
        <td style="padding:6px 8px;text-align:right;">${pp.estatus !== 'Pagado' ? `<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px;" onclick="event.stopPropagation();marcarPagoPagado(${pp.pago_id})">Marcar pagado</button>` : ''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

export function seleccionarCredito(id) {
  state.creditoTabActivo = id;
  renderCreditos();
}

// ===== CRÉDITOS CRUD =====
function populateSelects() {
  const selProy = document.getElementById('cred-proyecto');
  const selCta = document.getElementById('cred-cuenta-pago');
  if (selProy) {
    selProy.innerHTML = '<option value="">—</option>' +
      state.proyectos.filter(p => p.activo !== false).map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join('');
  }
  if (selCta) {
    const proyOpts = state.proyectos.filter(p => p.activo !== false && p.cuenta).map(p => `<option value="${p.nombre}">${p.nombre} – BBVA ···${p.cuenta.slice(-4)}</option>`).join('');
    const extraOpts = state.cuentasPropias.filter(c => c.activo !== false).map(c => `<option value="${c.nombre}">${c.nombre} – ${c.banco}${c.numero_cuenta ? ' ···' + c.numero_cuenta.slice(-4) : ''}</option>`).join('');
    selCta.innerHTML = '<option value="">—</option>' + proyOpts + extraOpts;
  }
}

export function abrirNuevoCredito() {
  state.editCreditoId = null;
  document.getElementById('modal-credito-title').textContent = 'Nuevo Crédito';
  document.getElementById('cred-nombre').value = '';
  document.getElementById('cred-banco').value = '';
  document.getElementById('cred-tipo').value = 'Puente';
  document.getElementById('cred-monto').value = '';
  document.getElementById('cred-tasa').value = '';
  populateSelects();
  document.getElementById('modal-credito').classList.add('open');
}

export function editarCredito(id) {
  const c = state.creditos.find(x => x.credito_id === id);
  if (!c) return;
  state.editCreditoId = id;
  document.getElementById('modal-credito-title').textContent = 'Editar Crédito';
  document.getElementById('cred-nombre').value = c.nombre;
  document.getElementById('cred-banco').value = c.banco;
  document.getElementById('cred-tipo').value = c.tipo_credito;
  document.getElementById('cred-monto').value = c.monto_autorizado;
  document.getElementById('cred-tasa').value = c.tasa_base || '';
  populateSelects();
  document.getElementById('cred-proyecto').value = c.proyecto || '';
  document.getElementById('cred-cuenta-pago').value = c.cuenta_pago || '';
  document.getElementById('modal-credito').classList.add('open');
}

export function guardarCredito() {
  const nombre = document.getElementById('cred-nombre').value.trim();
  const banco = document.getElementById('cred-banco').value.trim();
  if (!nombre) { notify('El nombre es obligatorio', 'error'); return; }
  if (!banco) { notify('El banco es obligatorio', 'error'); return; }
  const monto = parseFloat(document.getElementById('cred-monto').value) || 0;
  if (!monto) { notify('El monto autorizado es obligatorio', 'error'); return; }

  const obj = {
    credito_id: state.editCreditoId || (state.creditos.reduce((max, c) => Math.max(max, c.credito_id), 0) + 1),
    nombre, banco,
    tipo_credito: document.getElementById('cred-tipo').value,
    monto_autorizado: monto,
    tasa_base: parseFloat(document.getElementById('cred-tasa').value) || 0,
    proyecto: document.getElementById('cred-proyecto').value,
    cuenta_pago: document.getElementById('cred-cuenta-pago').value,
    estatus: 'Activo',
    activo: true
  };

  if (state.editCreditoId) {
    const i = state.creditos.findIndex(c => c.credito_id === state.editCreditoId);
    state.creditos[i] = obj;
  } else {
    state.creditos.push(obj);
    state.creditoTabActivo = obj.credito_id;
  }

  cerrar('modal-credito');
  renderCreditos();
  gsSaveCreditos();
  notify(state.editCreditoId ? 'Crédito actualizado' : 'Crédito registrado');
}

// ===== DISPOSICIONES / PAGARÉS =====
export function abrirNuevaDisposicion(creditoId) {
  state._dispCreditoId = creditoId;
  state._editPagareId = null;
  const c = state.creditos.find(x => x.credito_id === creditoId);
  document.getElementById('modal-disp-title').textContent = `Nueva Disposición – ${c?.nombre || ''}`;
  document.getElementById('disp-numero').value = '';
  document.getElementById('disp-monto').value = '';
  document.getElementById('disp-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('disp-venc').value = '';
  document.getElementById('disp-tasa').value = c?.tasa_base || '';
  document.getElementById('modal-disposicion').classList.add('open');
}

export function guardarDisposicion() {
  const numero = document.getElementById('disp-numero').value.trim();
  const monto = parseFloat(document.getElementById('disp-monto').value) || 0;
  const fecha = document.getElementById('disp-fecha').value;
  const venc = document.getElementById('disp-venc').value;
  const tasa = parseFloat(document.getElementById('disp-tasa').value) || 0;
  if (!numero) { notify('El número de pagaré es obligatorio', 'error'); return; }
  if (!monto) { notify('El monto es obligatorio', 'error'); return; }
  if (!fecha || !venc) { notify('Las fechas son obligatorias', 'error'); return; }

  const obj = {
    pagare_id: state.pagares.reduce((max, p) => Math.max(max, p.pagare_id), 0) + 1,
    credito_id: state._dispCreditoId,
    numero_pagare: numero,
    monto, fecha_disposicion: fecha, fecha_vencimiento: venc, tasa,
    estatus: 'Vigente', activo: true
  };

  state.pagares.push(obj);
  cerrar('modal-disposicion');
  renderCreditos();
  gsSavePagares();
  notify('Disposición registrada – Pagaré ' + numero);
}

export function togglePagare(pagareId) {
  state._pagareOpen = state._pagareOpen === pagareId ? null : pagareId;
  renderCreditos();
}

// ===== FECHAS DE PAGO =====
export function abrirNuevaFechaPago(pagareId) {
  state._fpPagareId = pagareId;
  const p = state.pagares.find(x => x.pagare_id === pagareId);
  document.getElementById('fp-fecha').value = '';
  document.getElementById('fp-monto').value = '';
  document.getElementById('fp-concepto').value = '';
  document.getElementById('modal-fecha-pago').classList.add('open');
}

export function guardarFechaPago() {
  const fecha = document.getElementById('fp-fecha').value;
  if (!fecha) { notify('La fecha es obligatoria', 'error'); return; }
  const p = state.pagares.find(x => x.pagare_id === state._fpPagareId);

  const obj = {
    pago_id: state.pagosPagare.reduce((max, pp) => Math.max(max, pp.pago_id), 0) + 1,
    pagare_id: state._fpPagareId,
    credito_id: p ? p.credito_id : 0,
    fecha_pago: fecha,
    monto_intereses: parseFloat(document.getElementById('fp-monto').value) || 0,
    concepto: document.getElementById('fp-concepto').value.trim(),
    estatus: 'Pendiente',
    fecha_real_pago: ''
  };

  state.pagosPagare.push(obj);
  cerrar('modal-fecha-pago');
  renderCreditos();
  gsSavePagosPagare();
  notify('Fecha de pago agregada');
}

export function marcarPagoPagado(pagoId) {
  const pp = state.pagosPagare.find(x => x.pago_id === pagoId);
  if (!pp) return;
  pp.estatus = 'Pagado';
  pp.fecha_real_pago = new Date().toISOString().split('T')[0];

  // Registrar en historial
  const p = state.pagares.find(x => x.pagare_id === pp.pagare_id);
  const c = state.creditos.find(x => x.credito_id === pp.credito_id);
  const fecha = new Date().toLocaleDateString('es-MX');

  state.historial.unshift({
    fecha,
    nombre: `${c?.banco || ''} – Pagaré ${p?.numero_pagare || ''}`,
    concepto: pp.concepto || `Pago intereses ${c?.nombre || ''}`,
    importe: pp.monto_intereses,
    proyecto: c?.proyecto || '',
    banco: c?.banco || '',
    tipo: 'Crédito',
    proveedor_id: '', factura_id: '',
    cuenta_origen: c?.cuenta_pago || '',
    tipo_registro: 'Crédito'
  });

  document.getElementById('cnt-hist').textContent = state.historial.length;
  saveData();
  gsSavePagosPagare();
  renderCreditos();
  if (window.renderHistorial) window.renderHistorial();
  notify(`Pago de ${fmt(pp.monto_intereses)} marcado como pagado`);
}

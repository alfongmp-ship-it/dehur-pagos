import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveCreditos, saveData } from '../services/google-sync.js';
import { saveProy } from '../config/proyectos.js';

const ESTATUS_COLORS = {
  'Activo': 'rgba(39,174,96,.15);color:#27ae60',
  'Liquidado': 'rgba(150,150,150,.15);color:#aaa'
};

function estatusBadge(est) {
  const style = ESTATUS_COLORS[est] || ESTATUS_COLORS['Activo'];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${style};">${est}</span>`;
}

export function renderCreditos() {
  const tb = document.getElementById('tbody-creditos');
  if (!tb) return;

  const activos = state.creditos.filter(c => c.activo !== false);

  if (!activos.length) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🏛</div><div>Sin créditos registrados</div></div></td></tr>';
    document.getElementById('creditos-subtitulo').textContent = '';
    document.getElementById('cnt-creditos').textContent = '0';
    return;
  }

  tb.innerHTML = activos.map(c => `<tr>
    <td style="font-weight:500;font-size:12px;">${c.banco}</td>
    <td style="font-size:11px;">${c.tipo_credito}</td>
    <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;">${fmt(c.monto_total)}</td>
    <td style="font-family:'DM Mono',monospace;font-size:11px;text-align:center;">${c.tasa_interes ? c.tasa_interes + '%' : '—'}</td>
    <td style="font-size:11px;text-align:center;">${c.plazo_meses ? c.plazo_meses + ' meses' : '—'}</td>
    <td style="font-family:'DM Mono',monospace;font-size:11px;text-align:right;">${c.pago_mensual ? fmt(c.pago_mensual) : '—'}</td>
    <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;color:${c.saldo_pendiente > 0 ? '#e74c3c' : 'var(--muted)'};">${fmt(c.saldo_pendiente)}</td>
    <td>${proyTag(c.proyecto)}</td>
    <td>${estatusBadge(c.estatus)}</td>
    <td style="text-align:right;white-space:nowrap;">
      <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="abrirPagoCredito(${c.credito_id})">Pagar</button>
      <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="editarCredito(${c.credito_id})">Editar</button>
      <button class="btn btn-ghost" style="padding:4px 6px;font-size:11px;color:#e74c3c;" onclick="eliminarCredito(${c.credito_id})">✕</button>
    </td>
  </tr>`).join('');

  document.getElementById('creditos-subtitulo').textContent = `${activos.length} crédito${activos.length !== 1 ? 's' : ''}`;
  document.getElementById('cnt-creditos').textContent = activos.length;
}

function populateProyectoSelect() {
  const sel = document.getElementById('cred-proyecto');
  if (!sel) return;
  sel.innerHTML = '<option value="">Sin proyecto</option>' +
    state.proyectos.filter(p => p.activo !== false).map(p =>
      `<option value="${p.nombre}">${p.nombre}</option>`
    ).join('');
}

export function abrirNuevoCredito() {
  state.editCreditoId = null;
  document.getElementById('modal-credito-title').textContent = 'Nuevo Crédito';
  document.getElementById('cred-banco').value = '';
  document.getElementById('cred-tipo').value = 'Préstamo';
  document.getElementById('cred-monto').value = '';
  document.getElementById('cred-tasa').value = '';
  document.getElementById('cred-plazo').value = '';
  document.getElementById('cred-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('cred-pago-mensual').value = '';
  document.getElementById('cred-concepto').value = '';
  document.getElementById('cred-estatus').value = 'Activo';
  populateProyectoSelect();
  document.getElementById('modal-credito').classList.add('open');
}

export function editarCredito(id) {
  const c = state.creditos.find(x => x.credito_id === id);
  if (!c) return;
  state.editCreditoId = id;
  document.getElementById('modal-credito-title').textContent = 'Editar Crédito';
  document.getElementById('cred-banco').value = c.banco;
  document.getElementById('cred-tipo').value = c.tipo_credito;
  document.getElementById('cred-monto').value = c.monto_total;
  document.getElementById('cred-tasa').value = c.tasa_interes || '';
  document.getElementById('cred-plazo').value = c.plazo_meses || '';
  document.getElementById('cred-fecha').value = c.fecha_inicio || '';
  document.getElementById('cred-pago-mensual').value = c.pago_mensual || '';
  document.getElementById('cred-concepto').value = c.concepto || '';
  document.getElementById('cred-estatus').value = c.estatus || 'Activo';
  populateProyectoSelect();
  document.getElementById('cred-proyecto').value = c.proyecto || '';
  document.getElementById('modal-credito').classList.add('open');
}

export function guardarCredito() {
  const banco = document.getElementById('cred-banco').value.trim();
  if (!banco) { notify('El banco es obligatorio', 'error'); return; }
  const montoTotal = parseFloat(document.getElementById('cred-monto').value) || 0;
  if (!montoTotal) { notify('El monto total es obligatorio', 'error'); return; }

  const obj = {
    credito_id: state.editCreditoId || (state.creditos.reduce((max, c) => Math.max(max, c.credito_id), 0) + 1),
    banco,
    tipo_credito: document.getElementById('cred-tipo').value,
    monto_total: montoTotal,
    tasa_interes: parseFloat(document.getElementById('cred-tasa').value) || 0,
    plazo_meses: parseInt(document.getElementById('cred-plazo').value) || 0,
    fecha_inicio: document.getElementById('cred-fecha').value,
    pago_mensual: parseFloat(document.getElementById('cred-pago-mensual').value) || 0,
    saldo_pendiente: montoTotal,
    proyecto: document.getElementById('cred-proyecto').value,
    concepto: document.getElementById('cred-concepto').value.trim(),
    estatus: document.getElementById('cred-estatus').value,
    activo: true
  };

  if (state.editCreditoId) {
    const i = state.creditos.findIndex(c => c.credito_id === state.editCreditoId);
    obj.saldo_pendiente = state.creditos[i].saldo_pendiente;
    state.creditos[i] = obj;
  } else {
    state.creditos.push(obj);
  }

  cerrar('modal-credito');
  renderCreditos();
  gsSaveCreditos();
  notify(state.editCreditoId ? 'Crédito actualizado' : 'Crédito registrado');
}

export function eliminarCredito(id) {
  const c = state.creditos.find(x => x.credito_id === id);
  if (!c) return;
  if (!confirm(`¿Eliminar crédito ${c.banco} – ${c.tipo_credito}?`)) return;
  c.activo = false;
  renderCreditos();
  gsSaveCreditos();
  notify('Crédito eliminado');
}

export function abrirPagoCredito(id) {
  const c = state.creditos.find(x => x.credito_id === id);
  if (!c) return;
  state._pagoCreditoId = id;
  document.getElementById('pago-cred-title').textContent = `Pago – ${c.banco} (${c.tipo_credito})`;
  document.getElementById('pago-cred-saldo').textContent = fmt(c.saldo_pendiente);
  document.getElementById('pago-cred-monto').value = c.pago_mensual || '';
  document.getElementById('pago-cred-concepto').value = '';
  document.getElementById('modal-pago-credito').classList.add('open');
}

export function confirmarPagoCredito() {
  const c = state.creditos.find(x => x.credito_id === state._pagoCreditoId);
  if (!c) return;
  const monto = parseFloat(document.getElementById('pago-cred-monto').value) || 0;
  if (!monto || monto <= 0) { notify('Ingresa un monto válido', 'error'); return; }

  c.saldo_pendiente = Math.max(0, (c.saldo_pendiente || 0) - monto);
  if (c.saldo_pendiente === 0) c.estatus = 'Liquidado';

  const fecha = new Date().toLocaleDateString('es-MX');
  const concepto = document.getElementById('pago-cred-concepto').value.trim() || `Pago crédito ${c.banco}`;

  state.historial.unshift({
    fecha,
    nombre: `${c.banco} – ${c.tipo_credito}`,
    concepto,
    importe: monto,
    proyecto: c.proyecto || '',
    banco: c.banco,
    tipo: 'Crédito',
    proveedor_id: '',
    factura_id: '',
    cuenta_origen: c.proyecto || '',
    tipo_registro: 'Crédito'
  });

  document.getElementById('cnt-hist').textContent = state.historial.length;
  saveData();
  gsSaveCreditos();
  cerrar('modal-pago-credito');
  renderCreditos();
  if (window.renderHistorial) window.renderHistorial();
  notify(`Pago de ${fmt(monto)} registrado. Saldo: ${fmt(c.saldo_pendiente)}`);
}

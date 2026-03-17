import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveCuentasPropias } from '../services/google-sync.js';

export function renderCuentasPropias() {
  const tb = document.getElementById('tbody-cp');
  if (!tb) return;

  if (!state.cuentasPropias.length) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🏦</div><div>Sin cuentas registradas</div></div></td></tr>';
    document.getElementById('cp-subtitulo').textContent = '';
    return;
  }

  const activas = state.cuentasPropias.filter(c => c.activo !== false);
  document.getElementById('cp-subtitulo').textContent = `${activas.length} cuenta${activas.length !== 1 ? 's' : ''}`;

  tb.innerHTML = activas.map(c => `<tr>
    <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${c.cuenta_id}</td>
    <td><div style="font-weight:500;font-size:12px;">${c.nombre}</div></td>
    <td style="font-size:11px;">${c.banco}</td>
    <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${c.clabe || '—'}</td>
    <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${c.numero_cuenta || '—'}</td>
    <td>${proyTag(c.proyecto)}</td>
    <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;color:var(--accent);">${fmt(c.saldo)}</td>
    <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${c.ultima_actualizacion || '—'}</td>
    <td style="text-align:right;"><button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="editarCuenta(${c.cuenta_id})">Editar</button></td>
  </tr>`).join('');

  document.getElementById('cnt-cp').textContent = activas.length;
}

function populateCuentaSelects() {
  const sel = document.getElementById('cp-proyecto');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Sin proyecto —</option>' +
    state.proyectos.filter(p => p.activo !== false).map(p => `<option>${p.nombre}</option>`).join('');
}

export function abrirNuevaCuenta() {
  state.editCuentaId = null;
  document.getElementById('modal-cuenta-title').textContent = 'Nueva Cuenta';
  document.getElementById('cp-nombre').value = '';
  document.getElementById('cp-banco').value = '';
  document.getElementById('cp-clabe').value = '';
  document.getElementById('cp-numero-cuenta').value = '';
  document.getElementById('cp-saldo').value = '';
  document.getElementById('cp-ultima-act').value = new Date().toISOString().split('T')[0];
  populateCuentaSelects();
  document.getElementById('cp-proyecto').value = '';
  document.getElementById('modal-cuenta').classList.add('open');
}

export function editarCuenta(id) {
  const c = state.cuentasPropias.find(x => x.cuenta_id === id);
  if (!c) return;
  state.editCuentaId = id;
  populateCuentaSelects();
  document.getElementById('modal-cuenta-title').textContent = 'Editar Cuenta #' + id;
  document.getElementById('cp-nombre').value = c.nombre;
  document.getElementById('cp-banco').value = c.banco;
  document.getElementById('cp-clabe').value = c.clabe || '';
  document.getElementById('cp-numero-cuenta').value = c.numero_cuenta || '';
  document.getElementById('cp-saldo').value = c.saldo;
  document.getElementById('cp-ultima-act').value = c.ultima_actualizacion || '';
  document.getElementById('cp-proyecto').value = c.proyecto || '';
  document.getElementById('modal-cuenta').classList.add('open');
}

export function guardarCuenta() {
  const nombre = document.getElementById('cp-nombre').value.trim();
  const banco = document.getElementById('cp-banco').value.trim();
  if (!nombre) { notify('El nombre es obligatorio', 'error'); return; }
  if (!banco) { notify('El banco es obligatorio', 'error'); return; }

  const obj = {
    cuenta_id: state.editCuentaId || (state.cuentasPropias.reduce((max, c) => Math.max(max, c.cuenta_id), 0) + 1),
    nombre,
    banco,
    clabe: document.getElementById('cp-clabe').value.trim(),
    numero_cuenta: document.getElementById('cp-numero-cuenta').value.trim(),
    proyecto: document.getElementById('cp-proyecto').value,
    saldo: parseFloat(document.getElementById('cp-saldo').value) || 0,
    ultima_actualizacion: document.getElementById('cp-ultima-act').value || new Date().toISOString().split('T')[0],
    activo: true
  };

  if (state.editCuentaId) {
    const i = state.cuentasPropias.findIndex(c => c.cuenta_id === state.editCuentaId);
    state.cuentasPropias[i] = obj;
  } else {
    state.cuentasPropias.push(obj);
  }

  cerrar('modal-cuenta');
  renderCuentasPropias();
  notify(state.editCuentaId ? 'Cuenta actualizada' : 'Cuenta registrada');
  gsSaveCuentasPropias();
}

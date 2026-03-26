import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveTraspasos, saveData, gsSaveProyectos, gsSaveCuentasPropias } from '../services/google-sync.js';
import { saveProy } from '../config/proyectos.js';

function getAllCuentas() {
  const deProy = state.proyectos.filter(p => p.activo !== false && p.cuenta).map(p => ({
    id: p.id,
    tipo: 'proyecto',
    nombre: p.nombre + ' – BBVA ···' + p.cuenta.slice(-4),
    proyecto: p.nombre,
    es_concentradora: p.es_concentradora || false
  }));
  const deExtra = state.cuentasPropias.filter(c => c.activo !== false).map(c => ({
    id: String(c.cuenta_id),
    tipo: 'cuenta',
    nombre: c.nombre + ' – ' + c.banco + (c.numero_cuenta ? ' ···' + c.numero_cuenta.slice(-4) : ''),
    proyecto: c.proyecto || ''
  }));
  return [...deProy, ...deExtra];
}

function detectarTipo(origenId, destinoId) {
  const cuentas = getAllCuentas();
  const o = cuentas.find(c => String(c.id) === String(origenId));
  const d = cuentas.find(c => String(c.id) === String(destinoId));
  if (!o || !d) return '';
  if (o.es_concentradora || d.es_concentradora) return 'Aportación';
  if (!o.proyecto || !d.proyecto) return 'Préstamo';
  return o.proyecto === d.proyecto ? 'Traspaso' : 'Préstamo';
}

function tipoBadge(tipo) {
  if (!tipo) return '<span style="color:var(--muted);font-size:11px;">—</span>';
  const colorMap = {
    'Traspaso':  'rgba(52,152,219,.15);color:#3498db',
    'Préstamo':  'rgba(200,169,110,.15);color:#C8A96E',
    'Aportación':'rgba(39,174,96,.15);color:#27ae60'
  };
  const color = colorMap[tipo] || colorMap['Préstamo'];
  return `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:600;background:${color};">${tipo}</span>`;
}

function estatusBadge(estatus) {
  const map = {
    completado: 'rgba(39,174,96,.15);color:#27ae60',
    pendiente:  'rgba(224,122,58,.15);color:#e07a3a',
    cancelado:  'rgba(150,150,150,.15);color:#aaa'
  };
  const style = map[estatus] || map.pendiente;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${style};">${estatus}</span>`;
}

export function renderTraspasos() {
  const tb = document.getElementById('tbody-traspasos');
  if (!tb) return;

  if (!state.gsToken) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div></td></tr>';
    const cnt = document.getElementById('cnt-traspasos'); if (cnt) cnt.textContent = '0';
    return;
  }

  const cnt = document.getElementById('cnt-traspasos');
  if (cnt) cnt.textContent = state.traspasos.length;

  if (!state.traspasos.length) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">↔</div><div>Sin traspasos o préstamos registrados</div></div></td></tr>';
    return;
  }

  const sorted = [...state.traspasos].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  tb.innerHTML = sorted.map(t => `
    <tr>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${t.fecha || '—'}</td>
      <td>${tipoBadge(t.tipo)}</td>
      <td style="font-size:12px;font-weight:500;">${t.cuenta_origen_nombre || '—'}</td>
      <td style="font-size:12px;color:var(--muted);">${t.cuenta_destino_nombre || '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:600;text-align:right;color:var(--accent);">${fmt(t.monto)}</td>
      <td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.concepto || '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${t.referencia || '—'}</td>
      <td>${estatusBadge(t.estatus)}</td>
      <td style="text-align:right;display:flex;gap:4px;justify-content:flex-end;">
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="editarTraspaso(${t.traspaso_id})">Editar</button>
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;color:var(--red);" onclick="eliminarTraspaso(${t.traspaso_id})">✕</button>
      </td>
    </tr>
  `).join('');
}

function populateTraspasoSelects() {
  const cuentas = getAllCuentas();
  const opts = '<option value="">— Seleccionar cuenta —</option>' +
    cuentas.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  const origen = document.getElementById('tr-origen');
  const destino = document.getElementById('tr-destino');
  if (origen) origen.innerHTML = opts;
  if (destino) destino.innerHTML = opts;
}

export function actualizarTipoDetectado() {
  const origenId = document.getElementById('tr-origen')?.value;
  const destinoId = document.getElementById('tr-destino')?.value;
  const badge = document.getElementById('tr-tipo-badge');
  if (!badge) return;
  if (!origenId || !destinoId || origenId === destinoId) {
    badge.innerHTML = '<span style="color:var(--muted);font-size:12px;">Selecciona ambas cuentas</span>';
    return;
  }
  const tipo = detectarTipo(origenId, destinoId);
  badge.innerHTML = tipoBadge(tipo);
}

export function abrirNuevoTraspaso() {
  state.editTraspasoId = null;
  document.getElementById('modal-traspaso-title').textContent = 'Nuevo Traspaso / Préstamo';
  populateTraspasoSelects();
  document.getElementById('tr-origen').value = '';
  document.getElementById('tr-destino').value = '';
  document.getElementById('tr-tipo-badge').innerHTML = '<span style="color:var(--muted);font-size:12px;">Selecciona ambas cuentas</span>';
  document.getElementById('tr-monto').value = '';
  document.getElementById('tr-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('tr-concepto').value = '';
  document.getElementById('tr-referencia').value = '';
  document.getElementById('tr-estatus').value = 'pendiente';
  document.getElementById('modal-traspaso').classList.add('open');
}

export function editarTraspaso(id) {
  const t = state.traspasos.find(x => x.traspaso_id === id);
  if (!t) return;
  state.editTraspasoId = id;
  document.getElementById('modal-traspaso-title').textContent = 'Editar Traspaso #' + id;
  populateTraspasoSelects();
  document.getElementById('tr-origen').value = t.cuenta_origen_id;
  document.getElementById('tr-destino').value = t.cuenta_destino_id;
  actualizarTipoDetectado();
  document.getElementById('tr-monto').value = t.monto;
  document.getElementById('tr-fecha').value = t.fecha;
  document.getElementById('tr-concepto').value = t.concepto || '';
  document.getElementById('tr-referencia').value = t.referencia || '';
  document.getElementById('tr-estatus').value = t.estatus || 'pendiente';
  document.getElementById('modal-traspaso').classList.add('open');
}

export function guardarTraspaso() {
  const origenId = document.getElementById('tr-origen').value;
  const destinoId = document.getElementById('tr-destino').value;
  const monto = parseFloat(document.getElementById('tr-monto').value) || 0;
  const fecha = document.getElementById('tr-fecha').value;

  if (!origenId) { notify('Selecciona la cuenta origen', 'error'); return; }
  if (!destinoId) { notify('Selecciona la cuenta destino', 'error'); return; }
  if (origenId === destinoId) { notify('La cuenta origen y destino no pueden ser la misma', 'error'); return; }
  if (!monto) { notify('El monto es obligatorio', 'error'); return; }
  if (!fecha) { notify('La fecha es obligatoria', 'error'); return; }

  const cuentas = getAllCuentas();
  const o = cuentas.find(c => String(c.id) === String(origenId));
  const d = cuentas.find(c => String(c.id) === String(destinoId));
  const tipo = detectarTipo(origenId, destinoId);

  const obj = {
    traspaso_id: state.editTraspasoId || (state.traspasos.reduce((max, t) => Math.max(max, t.traspaso_id), 0) + 1),
    tipo,
    cuenta_origen_id: origenId,
    cuenta_origen_tipo: o?.tipo || 'proyecto',
    cuenta_origen_nombre: o?.nombre || '',
    proyecto_origen: o?.proyecto || '',
    cuenta_destino_id: destinoId,
    cuenta_destino_tipo: d?.tipo || 'proyecto',
    cuenta_destino_nombre: d?.nombre || '',
    proyecto_destino: d?.proyecto || '',
    monto,
    fecha,
    concepto: document.getElementById('tr-concepto').value.trim(),
    referencia: document.getElementById('tr-referencia').value.trim(),
    estatus: document.getElementById('tr-estatus').value,
    fecha_registro: state.editTraspasoId
      ? (state.traspasos.find(t => t.traspaso_id === state.editTraspasoId)?.fecha_registro || fecha)
      : new Date().toISOString().split('T')[0]
  };

  if (state.editTraspasoId) {
    const i = state.traspasos.findIndex(t => t.traspaso_id === state.editTraspasoId);
    state.traspasos[i] = obj;
  } else {
    state.traspasos.push(obj);

    // Registrar en historial y mover saldos para todos los traspasos completados
    if (obj.estatus === 'completado' && o?.proyecto) {
      const fechaHist = new Date(fecha + 'T12:00:00').toLocaleDateString('es-MX');
      state.historial.unshift({
        fecha: fechaHist,
        nombre: d.nombre,
        concepto: obj.concepto || `${obj.tipo} a ${d.nombre}`,
        importe: monto,
        proyecto: o.proyecto,
        banco: 'BBVA',
        tipo: obj.tipo,
        proveedor_id: '',
        factura_id: '',
        cuenta_origen: o.proyecto,
        cuenta_destino: d?.proyecto || '',
        tipo_registro: 'Traspaso'
      });
      saveData();
      const cntHist = document.getElementById('cnt-hist');
      if (cntHist) cntHist.textContent = state.historial.length;
      if (window.renderHistorial) window.renderHistorial();

      // Helper: buscar cuenta en proyectos O cuentasPropias y ajustar saldo
      const todayISO = new Date().toISOString().split('T')[0];
      let saldoProyChanged = false;
      let saldoExtraChanged = false;

      function ajustarSaldo(nombre, delta) {
        const proy = state.proyectos.find(x => x.nombre === nombre);
        if (proy && proy.ultima_act_saldo && todayISO >= proy.ultima_act_saldo.slice(0, 10)) {
          proy.saldo = (proy.saldo || 0) + delta;
          saldoProyChanged = true;
          return;
        }
        const extra = state.cuentasPropias.find(x => x.nombre === nombre);
        if (extra && extra.ultima_actualizacion && todayISO >= extra.ultima_actualizacion.slice(0, 10)) {
          extra.saldo = (extra.saldo || 0) + delta;
          saldoExtraChanged = true;
        }
      }

      ajustarSaldo(o.proyecto, -monto);
      if (d?.proyecto) ajustarSaldo(d.proyecto, monto);

      if (saldoProyChanged) {
        saveProy(state.proyectos);
        gsSaveProyectos();
      }
      if (saldoExtraChanged) {
        gsSaveCuentasPropias();
      }
      if (saldoProyChanged || saldoExtraChanged) {
        if (window.renderCuentasPropias) window.renderCuentasPropias();
        if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
      }
    }
  }

  cerrar('modal-traspaso');
  renderTraspasos();
  if (window.renderResumenTraspasos) window.renderResumenTraspasos();
  notify(state.editTraspasoId ? 'Traspaso actualizado' : `${tipo} registrado ✓`);
  gsSaveTraspasos();
}

export function eliminarTraspaso(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  state.traspasos = state.traspasos.filter(t => t.traspaso_id !== id);
  renderTraspasos();
  if (window.renderResumenTraspasos) window.renderResumenTraspasos();
  notify('Registro eliminado');
  gsSaveTraspasos();
}

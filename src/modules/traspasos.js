import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveTraspasos, saveData, gsSaveHistorial, gsSaveProyectos, gsSaveCuentasPropias, gsSaveMovimientosInternos } from '../services/google-sync.js';
import { saveProy } from '../config/proyectos.js';
import { revertirSaldo, parseFechaHist } from './historial.js';

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

export function togglePartidaTraspaso() {
  const tipo = document.getElementById('tr-tipo-select')?.value;
  const wrap = document.getElementById('tr-partida-wrap');
  if (wrap) wrap.style.display = tipo === 'Aportación' ? '' : 'none';
}

export function actualizarTipoDetectado() {
  const origenId = document.getElementById('tr-origen')?.value;
  const destinoId = document.getElementById('tr-destino')?.value;
  const sel = document.getElementById('tr-tipo-select');
  if (!sel) return;
  if (!origenId || !destinoId || origenId === destinoId) {
    sel.value = '';
    togglePartidaTraspaso();
    return;
  }
  const tipo = detectarTipo(origenId, destinoId);
  sel.value = tipo;
  togglePartidaTraspaso();
}

export function abrirNuevoTraspaso() {
  state.editTraspasoId = null;
  document.getElementById('modal-traspaso-title').textContent = 'Nuevo Traspaso / Préstamo';
  populateTraspasoSelects();
  document.getElementById('tr-origen').value = '';
  document.getElementById('tr-destino').value = '';
  document.getElementById('tr-tipo-select').value = '';
  document.getElementById('tr-monto').value = '';
  document.getElementById('tr-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('tr-concepto').value = '';
  document.getElementById('tr-referencia').value = '';
  document.getElementById('tr-estatus').value = 'pendiente';
  document.getElementById('tr-no-historial').checked = false;
  document.getElementById('tr-partida').value = '';
  document.getElementById('tr-partida-wrap').style.display = 'none';
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
  document.getElementById('tr-tipo-select').value = t.tipo || '';
  if (!t.tipo) actualizarTipoDetectado();
  document.getElementById('tr-monto').value = t.monto;
  document.getElementById('tr-fecha').value = t.fecha;
  document.getElementById('tr-concepto').value = t.concepto || '';
  document.getElementById('tr-referencia').value = t.referencia || '';
  document.getElementById('tr-estatus').value = t.estatus || 'pendiente';
  document.getElementById('tr-partida').value = t.partida || '';
  togglePartidaTraspaso();
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
  const tipoSel = document.getElementById('tr-tipo-select')?.value;
  const partida = document.getElementById('tr-partida')?.value?.trim() || '';
  if (tipoSel === 'Aportación' && !partida) { notify('La partida es obligatoria para Aportaciones', 'error'); return; }

  const cuentas = getAllCuentas();
  const o = cuentas.find(c => String(c.id) === String(origenId));
  const d = cuentas.find(c => String(c.id) === String(destinoId));
  const tipo = document.getElementById('tr-tipo-select')?.value || detectarTipo(origenId, destinoId);

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
    partida,
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
    const noHistorial = document.getElementById('tr-no-historial')?.checked;
    if (obj.estatus === 'completado' && o?.proyecto) {
      if (!noHistorial) {
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
          tipo_registro: 'Traspaso',
          partida: partida || ''
        });
        saveData();
        const cntHist = document.getElementById('cnt-hist');
        if (cntHist) cntHist.textContent = state.historial.length;
        if (window.renderHistorial) window.renderHistorial();
      }

      if (noHistorial) {
        state.movimientosInternos.push({
          id: state.movimientosInternos.reduce((max, m) => Math.max(max, m.id || 0), 0) + 1,
          fecha: fecha,
          tipo: tipo,
          origen: o?.nombre || '',
          destino: d?.nombre || '',
          monto: monto,
          concepto: obj.concepto || '',
          referencia: obj.referencia || ''
        });
        gsSaveMovimientosInternos();
      }

      // Helper: buscar cuenta por ID y tipo, ajustar saldo
      const todayISO = new Date().toISOString().split('T')[0];
      let saldoProyChanged = false;
      let saldoExtraChanged = false;

      function ajustarSaldo(cuentaId, cuentaTipo, delta) {
        if (cuentaTipo === 'proyecto') {
          const proy = state.proyectos.find(x => x.id === cuentaId);
          if (proy && proy.ultima_act_saldo && todayISO >= proy.ultima_act_saldo.slice(0, 10)) {
            proy.saldo = (proy.saldo || 0) + delta;
            saldoProyChanged = true;
          }
        } else {
          const extra = state.cuentasPropias.find(x => String(x.cuenta_id) === String(cuentaId));
          if (extra && extra.ultima_actualizacion && todayISO >= extra.ultima_actualizacion.slice(0, 10)) {
            extra.saldo = (extra.saldo || 0) + delta;
            saldoExtraChanged = true;
          }
        }
      }

      ajustarSaldo(origenId, o?.tipo, -monto);
      ajustarSaldo(destinoId, d?.tipo, monto);

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
        if (window.renderHeaderBadges) window.renderHeaderBadges();
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
  const t = state.traspasos.find(x => x.traspaso_id === id);
  if (!t) return;
  if (!confirm('¿Eliminar este registro?')) return;

  // Buscar y eliminar historial correspondiente
  if (t.estatus === 'completado') {
    const hi = state.historial.findIndex(h =>
      h.tipo_registro === 'Traspaso' &&
      h.cuenta_origen === t.proyecto_origen &&
      h.nombre === t.cuenta_destino_nombre &&
      h.importe === t.monto
    );
    if (hi !== -1) {
      const h = state.historial[hi];
      const fechaISO = parseFechaHist(h.fecha);
      let saldoChanged = false;
      if (revertirSaldo(h.cuenta_origen, +h.importe, fechaISO)) saldoChanged = true;
      if (revertirSaldo(h.cuenta_destino, -h.importe, fechaISO)) saldoChanged = true;
      if (saldoChanged) {
        saveProy(state.proyectos);
        gsSaveProyectos();
        gsSaveCuentasPropias();
        if (window.renderCuentasPropias) window.renderCuentasPropias();
        if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
        if (window.renderHeaderBadges) window.renderHeaderBadges();
      }
      state.historial.splice(hi, 1);
      gsSaveHistorial();
      document.getElementById('cnt-hist').textContent = state.historial.length;
      if (window.renderHistorial) window.renderHistorial();
    }
  }

  state.traspasos = state.traspasos.filter(x => x.traspaso_id !== id);
  renderTraspasos();
  if (window.renderResumenTraspasos) window.renderResumenTraspasos();
  notify('Registro eliminado');
  gsSaveTraspasos();
}

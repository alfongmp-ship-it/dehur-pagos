import { state, datosListos } from '../state.js';
import { fmt, fmtFecha } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveTraspasos, saveData, gsSaveHistorial, gsSaveProyectos, gsSaveCuentasPropias, gsSaveMovimientosInternos, ensureHistorialIds, esPorFila, sbGuardarFila, sbBorrarFila } from '../services/google-sync.js';
import { saveProy } from '../config/proyectos.js';
import { getPartidasParaSelect } from '../config/sub-partidas.js';

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

// Construye un registro de traspaso a partir de una fila de historial que es
// Aportación (tipo_registro='Traspaso', tipo='Aportación'). Lo usan: el botón
// "Sincronizar aportaciones a Traspasos" (backfill de lo importado por plantilla)
// y el importador de Historial hacia adelante. Calca la heurística de ligado de
// eliminarHistorial: proyecto_origen===h.cuenta_origen, cuenta_destino_nombre===
// h.nombre, monto===h.importe. NO mueve saldos (igual que cualquier import).
export function traspasoDesdeAportacionHistorial(h, id) {
  const cuentas = getAllCuentas();
  // Resolver la cuenta origen (el proyecto) para id/nombre bonito en la tabla.
  const o = cuentas.find(c => c.proyecto && c.proyecto === h.cuenta_origen);
  return {
    traspaso_id: id,
    tipo: 'Aportación',
    cuenta_origen_id: o ? o.id : '',
    cuenta_origen_tipo: o ? o.tipo : 'proyecto',
    cuenta_origen_nombre: o ? o.nombre : (h.cuenta_origen || ''),
    proyecto_origen: h.cuenta_origen || '',   // debe = h.cuenta_origen (heurística de ligado)
    cuenta_destino_id: '',
    cuenta_destino_tipo: '',
    cuenta_destino_nombre: h.nombre || '',     // debe = h.nombre (heurística de ligado)
    proyecto_destino: h.cuenta_destino || '',
    monto: +h.importe || 0,                     // debe = h.importe (heurística de ligado)
    fecha: h.fecha || '',
    concepto: h.concepto || '',
    partida: h.partida || '',
    referencia: '',
    estatus: 'completado',
    fecha_registro: new Date().toISOString().split('T')[0]
  };
}

// ¿Esta aportación del historial ya tiene su traspaso ligado? (misma heurística)
function _aportacionTieneTraspaso(h) {
  return state.traspasos.some(t =>
    t.proyecto_origen === h.cuenta_origen &&
    t.cuenta_destino_nombre === h.nombre &&
    (+t.monto) === (+h.importe)
  );
}

// Backfill: crea en state.traspasos los registros faltantes de las aportaciones
// que viven solo en el historial (típicamente subidas por la plantilla de
// Historial). NO borra nada, NO toca saldos. Idempotente.
export function sincronizarAportacionesATraspasos() {
  if (!state.gsToken) { notify('Conecta Google Sheets para guardar', 'error'); return; }
  const aportaciones = state.historial.filter(h => h.tipo_registro === 'Traspaso' && h.tipo === 'Aportación');
  let maxId = state.traspasos.reduce((m, t) => Math.max(m, t.traspaso_id || 0), 0);
  let creados = 0;
  aportaciones.forEach(h => {
    if (_aportacionTieneTraspaso(h)) return;
    state.traspasos.push(traspasoDesdeAportacionHistorial(h, ++maxId));
    creados++;
  });
  if (creados > 0) {
    gsSaveTraspasos();
    if (window.renderTraspasos) window.renderTraspasos();
    if (window.renderResumenTraspasos) window.renderResumenTraspasos();
    const cnt = document.getElementById('cnt-traspasos');
    if (cnt) cnt.textContent = state.traspasos.length;
    notify(`✅ ${creados} aportación(es) sincronizada(s) a Traspasos`);
  } else {
    notify('No hay aportaciones del historial pendientes de sincronizar');
  }
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

  if (!datosListos()) {
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
  if (!wrap) return;
  wrap.style.display = tipo === 'Aportación' ? '' : 'none';
  if (tipo === 'Aportación') refreshPartidaTraspasoSelect();
}

function refreshPartidaTraspasoSelect() {
  const sel = document.getElementById('tr-partida');
  if (!sel) return;
  const actual = sel.value || '';
  // Si editamos un traspaso con una partida que ya no está en el catálogo, la
  // incluimos como legacy para no perder el valor histórico.
  const legacy = [];
  if (state.editTraspasoId) {
    const t = state.traspasos.find(x => x.traspaso_id === state.editTraspasoId);
    if (t?.partida) legacy.push(t.partida);
  }
  const opts = getPartidasParaSelect(legacy);
  sel.innerHTML = '<option value="">— selecciona —</option>' +
    opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  if (actual && opts.some(o => o.value === actual)) sel.value = actual;
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
  togglePartidaTraspaso();
  // Setear partida después de poblar el select (si es Aportación).
  document.getElementById('tr-partida').value = t.partida || '';
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

    if (obj.estatus === 'completado') {
      // Ajuste de saldos bancarios SIEMPRE (aplica a Aportación, Préstamo y Traspaso)
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

      if (saldoProyChanged) { saveProy(state.proyectos); gsSaveProyectos(); }
      if (saldoExtraChanged) { gsSaveCuentasPropias(); }
      if (saldoProyChanged || saldoExtraChanged) {
        if (window.renderCuentasPropias) window.renderCuentasPropias();
        if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
        if (window.renderHeaderBadges) window.renderHeaderBadges();
      }

      // Registro contable: solo Aportación genera costo en historial.
      // Préstamo y Traspaso son movimientos internos (sin costo).
      const noHistorial = document.getElementById('tr-no-historial')?.checked;
      const registrarHistorial = obj.tipo === 'Aportación' && o?.proyecto && !noHistorial;

      if (registrarHistorial) {
        const fechaHist = fmtFecha(fecha);
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
        // Fase 3: la fila de aportación nace sin id (unshift); ensureHistorialIds
        // la numera y se guarda por fila a Supabase.
        ensureHistorialIds();
        if (esPorFila('historial')) sbGuardarFila('historial', state.historial[0]);
        const cntHist = document.getElementById('cnt-hist');
        if (cntHist) cntHist.textContent = state.historial.length;
        if (window.renderHistorial) window.renderHistorial();
      } else {
        const _mi = {
          id: state.movimientosInternos.reduce((max, m) => Math.max(max, m.id || 0), 0) + 1,
          fecha: fecha,
          tipo: tipo,
          origen: o?.nombre || '',
          destino: d?.nombre || '',
          monto: monto,
          concepto: obj.concepto || '',
          referencia: obj.referencia || ''
        };
        state.movimientosInternos.push(_mi);
        const _pfMi = esPorFila('movimientosInternos');
        gsSaveMovimientosInternos({ porFila: _pfMi });
        if (_pfMi) sbGuardarFila('movimientosInternos', _mi);
      }
    }
  }

  cerrar('modal-traspaso');
  renderTraspasos();
  if (window.renderResumenTraspasos) window.renderResumenTraspasos();
  notify(state.editTraspasoId ? 'Traspaso actualizado' : `${tipo} registrado ✓`);
  // Fase 3: guarda solo este traspaso (upsert por traspaso_id, add/edit). Las
  // cascadas de saldos (proyectos/cuentas) e historial siguen whole-table.
  const porFila = esPorFila('traspasos');
  gsSaveTraspasos({ porFila });
  if (porFila) sbGuardarFila('traspasos', obj);
}

export function eliminarTraspaso(id) {
  const t = state.traspasos.find(x => x.traspaso_id === id);
  if (!t) return;
  if (!confirm('¿Eliminar este registro?')) return;

  if (t.estatus === 'completado') {
    // Revertir saldos directamente desde los datos del traspaso (no dependen de historial)
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

    ajustarSaldo(t.cuenta_origen_id, t.cuenta_origen_tipo, +t.monto);
    ajustarSaldo(t.cuenta_destino_id, t.cuenta_destino_tipo, -t.monto);

    if (saldoProyChanged) { saveProy(state.proyectos); gsSaveProyectos(); }
    if (saldoExtraChanged) { gsSaveCuentasPropias(); }
    if (saldoProyChanged || saldoExtraChanged) {
      if (window.renderCuentasPropias) window.renderCuentasPropias();
      if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
      if (window.renderHeaderBadges) window.renderHeaderBadges();
    }

    // Solo Aportación tiene entrada en historial que haya que eliminar
    if (t.tipo === 'Aportación') {
      const hi = state.historial.findIndex(h =>
        h.tipo_registro === 'Traspaso' &&
        h.cuenta_origen === t.proyecto_origen &&
        h.nombre === t.cuenta_destino_nombre &&
        h.importe === t.monto
      );
      if (hi !== -1) {
        const _hid = state.historial[hi].id;
        state.historial.splice(hi, 1);
        const _pfHist = esPorFila('historial');
        gsSaveHistorial({ porFila: _pfHist });
        if (_pfHist && _hid) sbBorrarFila('historial', _hid);
        const cntHist = document.getElementById('cnt-hist');
        if (cntHist) cntHist.textContent = state.historial.length;
        if (window.renderHistorial) window.renderHistorial();
      }
    }
  }

  state.traspasos = state.traspasos.filter(x => x.traspaso_id !== id);
  renderTraspasos();
  if (window.renderResumenTraspasos) window.renderResumenTraspasos();
  notify('Registro eliminado');
  const porFila = esPorFila('traspasos');
  gsSaveTraspasos({ porFila });
  if (porFila) sbBorrarFila('traspasos', id);
}

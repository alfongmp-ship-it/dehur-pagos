import { state, datosListos, puedeEditar, esAdmin } from '../state.js';
import { fmt, fmtFecha, escapeHtml } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveTraspasos, saveData, gsSaveHistorial, gsSaveProyectos, gsSaveCuentasPropias, gsSaveMovimientosInternos, ensureHistorialIds, esPorFila, sbGuardarFila, sbBorrarFila, gsSaveCostoAsignaciones } from '../services/google-sync.js';
import { aplicarAutoIndiviso } from './confirmar-pagos.js';
import { saveProy, proyectoMatch } from '../config/proyectos.js';
import { getPartidasParaSelect } from '../config/sub-partidas.js';
import { parseFechaHist } from './historial.js';

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
    // ISO (YYYY-MM-DD), como los traspasos normales: el filtro por fechas del
    // Resumen compara texto contra inputs date (ISO). NO toca la fecha del
    // historial; solo normaliza el campo propio de este registro de traspaso.
    fecha: parseFechaHist(h.fecha) || h.fecha || '',
    concepto: h.concepto || '',
    partida: h.partida || '',
    referencia: '',
    estatus: 'completado',
    fecha_registro: new Date().toISOString().split('T')[0]
  };
}

// Backfill: crea en state.traspasos los registros faltantes de las aportaciones
// que viven solo en el historial (típicamente subidas por la plantilla de
// Historial). NO borra nada, NO toca saldos. Idempotente.
export function sincronizarAportacionesATraspasos() {
  if (!puedeEditar()) { notify('No tienes permiso para editar', 'error'); return; }
  const aportaciones = state.historial.filter(h => h.tipo_registro === 'Traspaso' && h.tipo === 'Aportación');
  let maxId = state.traspasos.reduce((m, t) => Math.max(m, t.traspaso_id || 0), 0);
  let creados = 0, reparados = 0;
  aportaciones.forEach(h => {
    const fechaISO = parseFechaHist(h.fecha);
    // La fecha (normalizada a ISO en ambos lados) va en la llave: sin ella, varias
    // aportaciones del mismo origen/destino/monto pero fecha distinta caían sobre el
    // MISMO traspaso y se reescribían la fecha en cada pasada (flip-flop infinito, y
    // las extras nunca se creaban). Con la fecha, cada aportación empareja su propio
    // traspaso (o ninguno → se crea) y la reparación de fecha converge.
    const existente = state.traspasos.find(t =>
      t.proyecto_origen === h.cuenta_origen &&
      t.cuenta_destino_nombre === h.nombre &&
      (+t.monto) === (+h.importe) &&
      (parseFechaHist(t.fecha) || t.fecha || '') === (fechaISO || h.fecha || '')
    );
    if (existente) {
      // Reparar la fecha a ISO si quedó en otro formato (DD/MM/YYYY de una
      // sincronización anterior) → para que el filtro por fechas las encuentre.
      if (fechaISO && existente.fecha !== fechaISO) { existente.fecha = fechaISO; reparados++; }
      return;
    }
    state.traspasos.push(traspasoDesdeAportacionHistorial(h, ++maxId));
    creados++;
  });
  if (creados > 0 || reparados > 0) {
    gsSaveTraspasos();
    if (window.renderTraspasos) window.renderTraspasos();
    if (window.renderResumenTraspasos) window.renderResumenTraspasos();
    const cnt = document.getElementById('cnt-traspasos');
    if (cnt) cnt.textContent = state.traspasos.length;
    const partes = [];
    if (creados > 0) partes.push(`${creados} creada(s)`);
    if (reparados > 0) partes.push(`${reparados} con fecha corregida`);
    notify(`✅ Traspasos sincronizados: ${partes.join(', ')}`);
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
    'Préstamo':  'rgba(200,169,110,.15);color:var(--accent)',
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

// ---- Filtros + selección para borrado en bloque (patrón de Historial) ----
const trasSel = new Set();   // traspaso_id (como String) seleccionados

function refreshTraspasosProyectos() {
  const sel = document.getElementById('ft-proy');
  if (!sel) return;
  const val = sel.value;
  const opts = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
  sel.innerHTML = '<option value="">Todos los proyectos</option>' + opts.map(n => `<option>${escapeHtml(n)}</option>`).join('');
  sel.value = val;
}

function getFilteredTraspasos() {
  const tipo = document.getElementById('ft-tipo')?.value || '';
  const proy = document.getElementById('ft-proy')?.value || '';
  const est = document.getElementById('ft-estatus')?.value || '';
  const desde = document.getElementById('ft-desde')?.value || '';
  const hasta = document.getElementById('ft-hasta')?.value || '';
  return state.traspasos.filter(t => {
    if (tipo && t.tipo !== tipo) return false;
    if (est && (t.estatus || 'pendiente') !== est) return false;
    if (proy && !(proyectoMatch(t.proyecto_origen, proy) || proyectoMatch(t.proyecto_destino, proy))) return false;
    if (desde || hasta) {
      const f = parseFechaHist(t.fecha) || t.fecha || '';
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
    }
    return true;
  });
}

export function limpiarFiltrosTraspasos() {
  ['ft-tipo', 'ft-proy', 'ft-estatus', 'ft-desde', 'ft-hasta'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  renderTraspasos();
}

export function toggleTrasSel(id, ev) {
  if (ev) ev.stopPropagation();
  const k = String(id);
  if (trasSel.has(k)) trasSel.delete(k); else trasSel.add(k);
  actualizarBarraSelTras();
}

export function toggleTrasSelAll(check) {
  getFilteredTraspasos().forEach(t => {
    const k = String(t.traspaso_id);
    if (check) trasSel.add(k); else trasSel.delete(k);
  });
  renderTraspasos();
}

function actualizarBarraSelTras() {
  const n = trasSel.size;
  const btn = document.getElementById('tras-bulk-del');
  if (btn) { btn.style.display = n > 0 ? '' : 'none'; btn.textContent = `🗑 Eliminar seleccionados (${n})`; }
}

// Checkbox maestro del thead: marcado solo si TODOS los visibles están seleccionados.
function _syncSelAllTras(fil) {
  const cb = document.getElementById('tras-sel-all');
  if (cb) cb.checked = fil.length > 0 && fil.every(t => trasSel.has(String(t.traspaso_id)));
}

export function renderTraspasos() {
  const tb = document.getElementById('tbody-traspasos');
  if (!tb) return;

  if (!datosListos()) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div></td></tr>';
    const cnt = document.getElementById('cnt-traspasos'); if (cnt) cnt.textContent = '0';
    const sub = document.getElementById('cnt-traspasos-sub'); if (sub) sub.textContent = '';
    return;
  }

  refreshTraspasosProyectos();
  const cnt = document.getElementById('cnt-traspasos');
  if (cnt) cnt.textContent = state.traspasos.length;

  if (!state.traspasos.length) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">↔</div><div>Sin traspasos o préstamos registrados</div></div></td></tr>';
    const sub0 = document.getElementById('cnt-traspasos-sub'); if (sub0) sub0.textContent = '0 registros';
    trasSel.clear();
    actualizarBarraSelTras();
    _syncSelAllTras([]);
    return;
  }

  const fil = getFilteredTraspasos();
  const sub = document.getElementById('cnt-traspasos-sub');
  if (sub) {
    const totalFil = fil.reduce((s, t) => s + (+t.monto || 0), 0);
    sub.textContent = (fil.length !== state.traspasos.length)
      ? `${fil.length} de ${state.traspasos.length} registros · ${fmt(totalFil)}`
      : `${state.traspasos.length} registros · ${fmt(totalFil)}`;
  }

  // Depurar de la selección ids que ya no existen y refrescar barra + maestro.
  const idsActuales = new Set(state.traspasos.map(t => String(t.traspaso_id)));
  [...trasSel].forEach(k => { if (!idsActuales.has(k)) trasSel.delete(k); });
  actualizarBarraSelTras();
  _syncSelAllTras(fil);

  if (!fil.length) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin resultados con los filtros actuales</div></div></td></tr>';
    return;
  }

  const sorted = [...fil].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  tb.innerHTML = sorted.map(t => `
    <tr>
      <td style="text-align:center;"><input type="checkbox" class="req-admin" ${trasSel.has(String(t.traspaso_id)) ? 'checked' : ''} onclick="toggleTrasSel('${t.traspaso_id}', event)" style="cursor:pointer;" title="Seleccionar"></td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(t.fecha) || '—'}</td>
      <td>${tipoBadge(t.tipo)}</td>
      <td style="font-size:12px;font-weight:500;">${escapeHtml(t.cuenta_origen_nombre) || '—'}</td>
      <td style="font-size:12px;color:var(--muted);">${escapeHtml(t.cuenta_destino_nombre) || '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:600;text-align:right;color:var(--accent);">${fmt(t.monto)}</td>
      <td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.concepto) || '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${escapeHtml(t.referencia) || '—'}</td>
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
    cuentas.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nombre)}</option>`).join('');
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
    opts.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
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

// Efectos de un traspaso COMPLETADO: ajuste de saldos + registro contable (espejo
// de Aportación en historial, o movimiento interno). Usado por la CREACIÓN (igual
// que siempre) y por la TRANSICIÓN pendiente/cancelado→completado al EDITAR —
// antes ese camino no hacía NADA (ni saldos ni espejo → aportaciones fantasma).
// evitarEspejoDuplicado: solo en la transición — si el espejo ya existe por llave
// exacta CON fecha, no se duplica (en creación se conserva el comportamiento de
// siempre: el espejo se crea sin chequeo).
function _aplicarEfectosCompletado(obj, o, d, noHistorial, evitarEspejoDuplicado) {
  const monto = obj.monto;
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

  ajustarSaldo(obj.cuenta_origen_id, o?.tipo, -monto);
  ajustarSaldo(obj.cuenta_destino_id, d?.tipo, monto);

  if (saldoProyChanged) { saveProy(state.proyectos); gsSaveProyectos(); }
  if (saldoExtraChanged) { gsSaveCuentasPropias(); }
  if (saldoProyChanged || saldoExtraChanged) {
    if (window.renderCuentasPropias) window.renderCuentasPropias();
    if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
    if (window.renderHeaderBadges) window.renderHeaderBadges();
  }

  // Registro contable: solo Aportación genera costo en historial.
  // Préstamo y Traspaso son movimientos internos (sin costo).
  const registrarHistorial = obj.tipo === 'Aportación' && o?.proyecto && !noHistorial;

  if (registrarHistorial) {
    if (evitarEspejoDuplicado) {
      const fISO = parseFechaHist(obj.fecha) || obj.fecha || '';
      const yaEspejo = state.historial.some(h =>
        h.tipo_registro === 'Traspaso' && h.tipo === 'Aportación' &&
        h.cuenta_origen === o.proyecto && h.nombre === d.nombre &&
        (+h.importe) === (+monto) &&
        (parseFechaHist(h.fecha) || h.fecha || '') === fISO
      );
      if (yaEspejo) return;
    }
    const fechaHist = fmtFecha(obj.fecha);
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
      partida: obj.partida || ''
    });
    saveData();
    // Fase 3: la fila de aportación nace sin id (unshift); ensureHistorialIds
    // la numera y se guarda por fila a Supabase.
    ensureHistorialIds();
    if (esPorFila('historial')) sbGuardarFila('historial', state.historial[0]);
    // Devengado/reparto: las APORTACIONES (nómina, impuestos, etc.) afectan SIEMPRE
    // por indiviso a TODAS las unidades activas del proyecto. Se reparte automático
    // al registrarla (de aquí en adelante); las históricas se asignan a mano.
    if (aplicarAutoIndiviso(state.historial[0], null, true) > 0) gsSaveCostoAsignaciones();
    const cntHist = document.getElementById('cnt-hist');
    if (cntHist) cntHist.textContent = state.historial.length;
    if (window.renderHistorial) window.renderHistorial();
  } else {
    const _mi = {
      id: state.movimientosInternos.reduce((max, m) => Math.max(max, m.id || 0), 0) + 1,
      fecha: obj.fecha,
      tipo: obj.tipo,
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
    const estatusAntes = state.traspasos[i]?.estatus || 'pendiente';
    // Revertir un completado editándole el estatus dejaría los saldos aplicados sin
    // revertir: se bloquea (la ruta correcta es eliminarlo con ✕, que SÍ los regresa).
    if (estatusAntes === 'completado' && obj.estatus !== 'completado') {
      notify('Para revertir un traspaso completado, elimínalo (✕ — eso sí regresa los saldos) y recréalo', 'error');
      return;
    }
    state.traspasos[i] = obj;
    // Transición pendiente/cancelado → completado: aplicar los MISMOS efectos que la
    // creación (saldos + espejo en historial o movimiento interno). Antes este camino
    // no hacía NADA → traspasos "completados" sin saldos ni historial (fantasmas).
    // (Editar monto/fecha de uno YA completado sigue sin re-ajustar saldos — limitación conocida.)
    if (estatusAntes !== 'completado' && obj.estatus === 'completado') {
      const noHistorial = document.getElementById('tr-no-historial')?.checked;
      _aplicarEfectosCompletado(obj, o, d, noHistorial, true);
    }
  } else {
    state.traspasos.push(obj);
    if (obj.estatus === 'completado') {
      const noHistorial = document.getElementById('tr-no-historial')?.checked;
      _aplicarEfectosCompletado(obj, o, d, noHistorial, false);
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

// Revierte los efectos de UN traspaso COMPLETADO: saldos (guard de fecha) y, en
// Aportación, su espejo del historial (emparejado CON fecha, fix 67db88f). NO
// persiste nada: acumula en `fx` lo que cambió para que el llamador (borrado
// individual o en BLOQUE) guarde una sola vez.
function _revertirEfectosTraspaso(t, fx) {
  if (t.estatus !== 'completado') return;
  const todayISO = new Date().toISOString().split('T')[0];

  function ajustarSaldo(cuentaId, cuentaTipo, delta) {
    if (cuentaTipo === 'proyecto') {
      const proy = state.proyectos.find(x => x.id === cuentaId);
      if (proy && proy.ultima_act_saldo && todayISO >= proy.ultima_act_saldo.slice(0, 10)) {
        proy.saldo = (proy.saldo || 0) + delta;
        fx.saldoProy = true;
      }
    } else {
      const extra = state.cuentasPropias.find(x => String(x.cuenta_id) === String(cuentaId));
      if (extra && extra.ultima_actualizacion && todayISO >= extra.ultima_actualizacion.slice(0, 10)) {
        extra.saldo = (extra.saldo || 0) + delta;
        fx.saldoExtra = true;
      }
    }
  }

  ajustarSaldo(t.cuenta_origen_id, t.cuenta_origen_tipo, +t.monto);
  ajustarSaldo(t.cuenta_destino_id, t.cuenta_destino_tipo, -t.monto);

  // Solo Aportación tiene entrada en historial que haya que eliminar.
  if (t.tipo === 'Aportación') {
    const _fT = parseFechaHist(t.fecha) || t.fecha || '';
    const hi = state.historial.findIndex(h =>
      h.tipo_registro === 'Traspaso' &&
      h.cuenta_origen === t.proyecto_origen &&
      h.nombre === t.cuenta_destino_nombre &&
      h.importe === t.monto &&
      (parseFechaHist(h.fecha) || h.fecha || '') === _fT
    );
    if (hi !== -1) {
      fx.histIds.push(state.historial[hi].id);
      state.historial.splice(hi, 1);
      fx.histChanged = true;
    }
  }
}

// Persiste lo acumulado por _revertirEfectosTraspaso (saldos + historial) UNA vez.
function _persistirReversion(fx) {
  if (fx.saldoProy) { saveProy(state.proyectos); gsSaveProyectos(); }
  if (fx.saldoExtra) { gsSaveCuentasPropias(); }
  if (fx.saldoProy || fx.saldoExtra) {
    if (window.renderCuentasPropias) window.renderCuentasPropias();
    if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
    if (window.renderHeaderBadges) window.renderHeaderBadges();
  }
  if (fx.histChanged) {
    const _pfHist = esPorFila('historial');
    gsSaveHistorial({ porFila: _pfHist });
    if (_pfHist) fx.histIds.forEach(hid => { if (hid) sbBorrarFila('historial', hid); });
    const cntHist = document.getElementById('cnt-hist');
    if (cntHist) cntHist.textContent = state.historial.length;
    if (window.renderHistorial) window.renderHistorial();
  }
}

export function eliminarTraspaso(id) {
  const t = state.traspasos.find(x => x.traspaso_id === id);
  if (!t) return;
  if (!confirm('¿Eliminar este registro?')) return;

  const fx = { saldoProy: false, saldoExtra: false, histIds: [], histChanged: false };
  _revertirEfectosTraspaso(t, fx);
  _persistirReversion(fx);

  state.traspasos = state.traspasos.filter(x => x.traspaso_id !== id);
  renderTraspasos();
  if (window.renderResumenTraspasos) window.renderResumenTraspasos();
  notify('Registro eliminado');
  const porFila = esPorFila('traspasos');
  gsSaveTraspasos({ porFila });
  if (porFila) sbBorrarFila('traspasos', id);
}

// Borrado en BLOQUE de los traspasos seleccionados (solo admin, como el bulk del
// historial): revierte saldos de los completados y el espejo del historial de las
// aportaciones (llaves CON fecha), y persiste todo en una sola pasada.
export function eliminarTraspasosBulk() {
  if (!esAdmin()) { notify('Solo el admin puede borrar en bloque', 'error'); return; }
  const ids = new Set([...trasSel]);
  const aBorrar = state.traspasos.filter(t => ids.has(String(t.traspaso_id)));
  if (!aBorrar.length) { notify('No hay traspasos seleccionados', 'error'); return; }
  const total = aBorrar.reduce((s, t) => s + (+t.monto || 0), 0);
  if (!confirm(`¿Eliminar ${aBorrar.length} traspaso(s)/préstamo(s) seleccionado(s)?\nSuma: ${fmt(total)}\n\nSe revierten los saldos de los completados y se borra el registro en historial de las aportaciones. Esta acción no se puede deshacer.`)) return;

  const fx = { saldoProy: false, saldoExtra: false, histIds: [], histChanged: false };
  aBorrar.forEach(t => _revertirEfectosTraspaso(t, fx));
  state.traspasos = state.traspasos.filter(t => !ids.has(String(t.traspaso_id)));
  trasSel.clear();
  _persistirReversion(fx);

  renderTraspasos();
  if (window.renderResumenTraspasos) window.renderResumenTraspasos();
  const porFila = esPorFila('traspasos');
  gsSaveTraspasos({ porFila });
  if (porFila) aBorrar.forEach(t => sbBorrarFila('traspasos', t.traspaso_id));
  notify(`✅ ${aBorrar.length} registro(s) eliminados`);
}

// ============================================================================
// ingresos.js — MÓDULO INGRESOS (Fase 1, cartera pura)
// ============================================================================
// Espacio de trabajo separado (Pagos | Ingresos) con sidebar propio. NO toca
// nada de Pagos: lee state.* propio (clientes/ventas/cobros) y, en solo lectura,
// state.unidades/proyectos para dropdowns (eso llega en etapas siguientes).
//
// Etapa 2: switcher + sidebar + páginas vacías + carga (gated). El CRUD y el
// estado de cuenta llegan en las etapas 3–5. Todo detrás de INGRESOS_ON + el
// candado de vista previa (?ingresos=1), así los usuarios reales no ven nada.
// ============================================================================

import { state, nuevoClienteId, nuevoVentaId, nuevoCobroId } from '../state.js';
import { ingresosActivo, esPorFila, sbGuardarFila, sbBorrarFila, gsSaveClientes, gsSaveVentas, gsSaveCobros } from '../services/google-sync.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { fmt, fmtFecha, dl, escapeHtml } from '../ui/format.js';

// Páginas que pertenecen al espacio de Ingresos (el resto es Pagos).
const PAGINAS_INGRESOS = new Set(['clientes', 'ventas', 'cobros', 'estado-cuenta']);
const PAGINA_DEFAULT = { pagos: 'proveedores', ingresos: 'clientes' };

let _workspace = 'pagos';
// Recuerda la última página abierta en cada espacio, para no perder el lugar al
// alternar Pagos↔Ingresos.
const _ultimaPagina = { pagos: PAGINA_DEFAULT.pagos, ingresos: PAGINA_DEFAULT.ingresos };

function _paginaVisible() {
  const pages = document.querySelectorAll('[id^="page-"]');
  for (const p of pages) { if (p.style.display !== 'none') return p.id.replace(/^page-/, ''); }
  return null;
}

// Cambia de espacio de trabajo: alterna qué sidebar se ve y navega a la última
// página (o la default) de ese espacio. El mecanismo de navegación es el mismo
// showPage de siempre; el workspace solo decide qué sidebar y qué página default.
export function setWorkspace(ws) {
  if (ws !== 'ingresos') ws = 'pagos';

  // Recordar la página del espacio que estamos dejando.
  const actual = _paginaVisible();
  if (actual) {
    const wsActual = PAGINAS_INGRESOS.has(actual) ? 'ingresos' : 'pagos';
    _ultimaPagina[wsActual] = actual;
  }

  _workspace = ws;
  try { localStorage.setItem('dt-workspace', ws); } catch (_) { /* ignore */ }

  const sp = document.getElementById('sidebar-pagos');
  const si = document.getElementById('sidebar-ingresos');
  if (sp) sp.style.display = (ws === 'pagos') ? '' : 'none';
  if (si) si.style.display = (ws === 'ingresos') ? '' : 'none';

  document.querySelectorAll('#ws-switch .ws-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.ws === ws);
  });

  const page = _ultimaPagina[ws] || PAGINA_DEFAULT[ws];
  if (window.showPage) window.showPage(page, document.getElementById('nav-' + page));
}

// Inyecta el switcher en el header SOLO si Ingresos está activo (master + vista
// previa). Si no, no toca nada → header/sidebar idénticos a hoy.
export function initIngresosUI() {
  // Sticky del candado de vista previa: ?ingresos=1 lo prende, ?ingresos=0 lo apaga.
  // Mismo candado para Estrategia (?estrategia=1/0 → dt-estrategia).
  try {
    const s = location.search || '';
    if (/[?&]ingresos=1(\b|&|$)/.test(s)) localStorage.setItem('dt-ingresos', '1');
    else if (/[?&]ingresos=0(\b|&|$)/.test(s)) localStorage.removeItem('dt-ingresos');
    if (/[?&]estrategia=1(\b|&|$)/.test(s)) localStorage.setItem('dt-estrategia', '1');
    else if (/[?&]estrategia=0(\b|&|$)/.test(s)) localStorage.removeItem('dt-estrategia');
  } catch (_) { /* ignore */ }

  if (!ingresosActivo()) return;   // usuarios normales / flag off → nada

  _inyectarEstilos();
  const mount = document.getElementById('ws-switch');
  if (mount) {
    mount.style.display = '';
    mount.innerHTML =
      '<button type="button" class="ws-btn active" data-ws="pagos" onclick="setWorkspace(\'pagos\')">Pagos</button>' +
      '<button type="button" class="ws-btn" data-ws="ingresos" onclick="setWorkspace(\'ingresos\')">Ingresos</button>';
  }

  actualizarContadoresIngresos();

  let ws = 'pagos';
  try { ws = localStorage.getItem('dt-workspace') || 'pagos'; } catch (_) { /* ignore */ }
  setWorkspace(ws);
}

// Contadores del sidebar de Ingresos (se ven aunque no estés en cada página).
export function actualizarContadoresIngresos() {
  const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  set('cnt-clientes', state.clientes.length);
  set('cnt-ventas', state.ventas.length);
  set('cnt-cobros', state.cobros.length);
}

function _emptyState(icon, titulo, sub) {
  return `<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">${icon}</div>` +
    `<div>${titulo}</div>` +
    (sub ? `<div style="font-size:12px;color:var(--muted);margin-top:6px;">${sub}</div>` : '') + `</div>`;
}

// ---- Clientes (Etapa 3) -----------------------------------------------------
export function renderClientes() {
  actualizarContadoresIngresos();
  const s = document.getElementById('sub-clientes'); if (s) s.textContent = `${state.clientes.length} registros`;
  const el = document.getElementById('lista-clientes');
  if (!el) return;
  if (!state.clientes.length) {
    el.innerHTML = _emptyState('🧑‍💼', 'Sin clientes aún', 'Usa "+ Nuevo" para dar de alta el primero.');
    return;
  }
  const filas = state.clientes.map(c => {
    const inact = c.activo === false ? ' <span style="font-size:10px;color:var(--muted);">(inactivo)</span>' : '';
    const id = String(c.cliente_id).replace(/'/g, "\\'");
    return `<tr><td><div class="name-cell">${escapeHtml(c.nombre)}${inact}</div>${c.email ? `<div class="name-sub">${escapeHtml(c.email)}</div>` : ''}</td>` +
      `<td style="font-size:12px;">${escapeHtml(c.rfc || '—')}</td>` +
      `<td style="font-size:12px;">${escapeHtml(c.telefono || '—')}</td>` +
      `<td style="font-size:12px;color:var(--muted);${'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;'}" title="${escapeHtml(c.observaciones || '')}">${escapeHtml(c.observaciones || '—')}</td>` +
      `<td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-ghost btn-sm" onclick="editarCliente('${id}')">Editar</button><button class="btn btn-ghost btn-sm req-editor danger" onclick="eliminarCliente('${id}')">✕</button></div></td></tr>`;
  }).join('');
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>RFC</th><th>Teléfono</th><th>Observaciones</th><th style="text-align:right">Acciones</th></tr></thead><tbody>${filas}</tbody></table></div>`;
}

export function abrirNuevoCliente() {
  state.editClienteId = null;
  limpiarFormCliente();
  const t = document.getElementById('modal-cliente-title'); if (t) t.textContent = 'Nuevo Cliente';
  document.getElementById('modal-cliente').classList.add('open');
}

export function editarCliente(id) {
  const c = state.clientes.find(x => String(x.cliente_id) === String(id));
  if (!c) return;
  state.editClienteId = c.cliente_id;
  const t = document.getElementById('modal-cliente-title'); if (t) t.textContent = 'Editar Cliente';
  document.getElementById('c-nombre').value = c.nombre || '';
  document.getElementById('c-rfc').value = c.rfc || '';
  document.getElementById('c-telefono').value = c.telefono || '';
  document.getElementById('c-email').value = c.email || '';
  document.getElementById('c-observaciones').value = c.observaciones || '';
  document.getElementById('c-activo').value = c.activo === false ? 'false' : 'true';
  document.getElementById('modal-cliente').classList.add('open');
}

function limpiarFormCliente() {
  ['c-nombre', 'c-rfc', 'c-telefono', 'c-email', 'c-observaciones'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const a = document.getElementById('c-activo'); if (a) a.value = 'true';
}

export function guardarCliente() {
  const nombre = document.getElementById('c-nombre').value.trim();
  if (!nombre) { notify('El nombre del cliente es obligatorio', 'error'); return; }
  const existing = state.editClienteId ? state.clientes.find(c => String(c.cliente_id) === String(state.editClienteId)) : null;
  const obj = {
    cliente_id: existing ? existing.cliente_id : nuevoClienteId(),
    nombre,
    rfc: document.getElementById('c-rfc').value.trim().toUpperCase(),
    telefono: document.getElementById('c-telefono').value.trim(),
    email: document.getElementById('c-email').value.trim(),
    observaciones: document.getElementById('c-observaciones').value.trim(),
    activo: document.getElementById('c-activo').value === 'true'
  };
  if (existing) {
    const i = state.clientes.findIndex(c => String(c.cliente_id) === String(state.editClienteId));
    state.clientes[i] = obj;
  } else {
    state.clientes.push(obj);
  }
  cerrar('modal-cliente');
  renderClientes();
  notify(existing ? 'Cliente actualizado' : 'Cliente agregado');
  const porFila = esPorFila('clientes');
  gsSaveClientes({ porFila });
  if (porFila) sbGuardarFila('clientes', obj);
}

export function eliminarCliente(id) {
  const c = state.clientes.find(x => String(x.cliente_id) === String(id));
  if (!c) return;
  // Candado: no borrar un cliente que ya tenga ventas activas (protege desde Etapa 4).
  const conVentas = state.ventas.some(v => String(v.cliente_id) === String(id) && v.activo !== false);
  if (conVentas) { notify('No se puede eliminar: el cliente tiene ventas registradas.', 'error'); return; }
  if (!confirm(`¿Eliminar al cliente "${c.nombre}"?`)) return;
  state.clientes = state.clientes.filter(x => String(x.cliente_id) !== String(id));
  renderClientes();
  notify('Cliente eliminado');
  const porFila = esPorFila('clientes');
  gsSaveClientes({ porFila });
  if (porFila) sbBorrarFila('clientes', id);
}
// ---- Ventas por Unidad (Etapa 4) --------------------------------------------
const _ESTATUS_COLOR = {
  apartada: 'rgba(200,169,110,.15);color:var(--accent)',
  vendida: 'rgba(52,152,219,.15);color:#3498db',
  escriturada: 'rgba(39,174,96,.15);color:#27ae60',
  cancelada: 'rgba(231,76,60,.15);color:#e74c3c'
};

function _unidadLabel(unidadId) {
  const u = state.unidades.find(x => String(x.unidad_id) === String(unidadId));
  return u ? (u.nombre || `Unidad ${u.unidad_id}`) : '—';
}
function _clienteLabel(clienteId) {
  const c = state.clientes.find(x => String(x.cliente_id) === String(clienteId));
  return c ? c.nombre : '—';
}

export function renderVentas() {
  actualizarContadoresIngresos();
  const s = document.getElementById('sub-ventas'); if (s) s.textContent = `${state.ventas.length} registros`;
  const el = document.getElementById('lista-ventas');
  if (!el) return;
  if (!state.ventas.length) {
    el.innerHTML = _emptyState('🏘️', 'Sin ventas aún', 'Usa "+ Nueva venta" para registrar la primera.');
    return;
  }
  const filas = state.ventas.map(v => {
    const id = String(v.venta_id).replace(/'/g, "\\'");
    const est = v.estatus_comercial || 'apartada';
    const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${_ESTATUS_COLOR[est] || _ESTATUS_COLOR.apartada};">${escapeHtml(est)}</span>`;
    const inact = v.activo === false ? ' <span style="font-size:10px;color:var(--muted);">(inactiva)</span>' : '';
    return `<tr><td><div class="name-cell">${escapeHtml(_unidadLabel(v.unidad_id))}${inact}</div><div class="name-sub">${escapeHtml(v.proyecto || '—')}</div></td>` +
      `<td style="font-size:12px;">${escapeHtml(_clienteLabel(v.cliente_id))}</td>` +
      `<td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;">${fmt(v.precio_venta || 0)}</td>` +
      `<td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;color:#27ae60;">${fmt(v.monto_cobrado || 0)}</td>` +
      `<td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;font-weight:600;">${fmt(v.saldo_cliente != null ? v.saldo_cliente : (v.precio_venta || 0))}</td>` +
      `<td>${badge}</td>` +
      `<td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-ghost btn-sm" onclick="editarVenta('${id}')">Editar</button><button class="btn btn-ghost btn-sm req-editor danger" onclick="eliminarVenta('${id}')">✕</button></div></td></tr>`;
  }).join('');
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Unidad</th><th>Cliente</th><th style="text-align:right">Precio</th><th style="text-align:right">Cobrado</th><th style="text-align:right">Saldo</th><th>Estatus</th><th style="text-align:right">Acciones</th></tr></thead><tbody>${filas}</tbody></table></div>`;
}

// Puebla los selects de proyecto y cliente del modal (activos).
function _poblarSelectsVenta() {
  const py = document.getElementById('v-proyecto');
  if (py) py.innerHTML = state.proyectos.filter(p => p.activo).map(p => `<option value="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)}</option>`).join('');
  const cl = document.getElementById('v-cliente');
  if (cl) {
    const activos = state.clientes.filter(c => c.activo !== false);
    cl.innerHTML = '<option value="">— Selecciona cliente —</option>' +
      activos.map(c => `<option value="${escapeHtml(String(c.cliente_id))}">${escapeHtml(c.nombre)}</option>`).join('');
  }
  const cr = document.getElementById('v-credito');
  if (cr) cr.innerHTML = '<option value="">— Ninguno —</option>' +
    state.creditos.filter(c => c.activo !== false).map(c => `<option value="${escapeHtml(String(c.credito_id))}">${escapeHtml(c.nombre || ('Crédito ' + c.credito_id))}</option>`).join('');
}

// Puebla el select de unidades según el proyecto elegido (solo activas).
export function vPoblarUnidades() {
  const proy = document.getElementById('v-proyecto')?.value || '';
  const un = document.getElementById('v-unidad');
  if (!un) return;
  const unidades = state.unidades.filter(u => u.proyecto === proy && u.activo !== false)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  if (!unidades.length) {
    un.innerHTML = '<option value="">(sin unidades activas en este proyecto)</option>';
    return;
  }
  un.innerHTML = '<option value="">— Selecciona unidad —</option>' +
    unidades.map(u => `<option value="${escapeHtml(String(u.unidad_id))}">${escapeHtml(u.nombre || ('Unidad ' + u.unidad_id))}</option>`).join('');
}

export function abrirNuevaVenta() {
  state.editVentaId = null;
  _poblarSelectsVenta();
  limpiarFormVenta();
  const t = document.getElementById('modal-venta-title'); if (t) t.textContent = 'Nueva Venta';
  document.getElementById('modal-venta').classList.add('open');
}

export function editarVenta(id) {
  const v = state.ventas.find(x => String(x.venta_id) === String(id));
  if (!v) return;
  state.editVentaId = v.venta_id;
  _poblarSelectsVenta();
  const t = document.getElementById('modal-venta-title'); if (t) t.textContent = 'Editar Venta';
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  set('v-proyecto', v.proyecto || '');
  vPoblarUnidades();
  set('v-unidad', String(v.unidad_id || ''));
  set('v-cliente', String(v.cliente_id || ''));
  set('v-precio', v.precio_venta != null ? v.precio_venta : '');
  set('v-tipo-credito', v.tipo_credito || '');
  set('v-estatus', v.estatus_comercial || 'apartada');
  set('v-fecha-apartado', v.fecha_apartado || '');
  set('v-fecha-escritura-estimada', v.fecha_escritura_estimada || '');
  set('v-fecha-escritura-real', v.fecha_escritura_real || '');
  set('v-valor-liberacion', v.valor_liberacion != null ? v.valor_liberacion : '');
  set('v-credito', String(v.credito_id || ''));
  set('v-obs', v.observaciones || '');
  document.getElementById('modal-venta').classList.add('open');
}

function limpiarFormVenta() {
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  // v-proyecto ya quedó con el primer proyecto activo tras _poblarSelectsVenta.
  vPoblarUnidades();
  set('v-cliente', '');
  set('v-precio', '');
  set('v-tipo-credito', '');
  set('v-estatus', 'apartada');
  set('v-fecha-apartado', '');
  set('v-fecha-escritura-estimada', '');
  set('v-fecha-escritura-real', '');
  set('v-valor-liberacion', '');
  set('v-credito', '');
  set('v-obs', '');
}

export function guardarVenta() {
  const unidad_id = (document.getElementById('v-unidad').value || '').trim();
  const cliente_id = (document.getElementById('v-cliente').value || '').trim();
  const proyecto = (document.getElementById('v-proyecto').value || '').trim();
  const precio_venta = parseFloat(document.getElementById('v-precio').value) || 0;
  const estatus_comercial = document.getElementById('v-estatus').value || 'apartada';
  if (!proyecto) { notify('Elige el proyecto', 'error'); return; }
  if (!unidad_id) { notify('Elige la unidad', 'error'); return; }
  if (!cliente_id) { notify('Elige el cliente', 'error'); return; }
  if (precio_venta <= 0) { notify('El precio de venta debe ser mayor a 0', 'error'); return; }
  // Una unidad no puede tener dos ventas activas no canceladas (excluye la propia en edición).
  const dup = state.ventas.some(v =>
    String(v.venta_id) !== String(state.editVentaId) &&
    String(v.unidad_id) === String(unidad_id) &&
    v.estatus_comercial !== 'cancelada' && v.activo !== false
  );
  if (dup && estatus_comercial !== 'cancelada') {
    notify('Esa unidad ya tiene una venta activa. Cancélala primero o elige otra unidad.', 'error');
    return;
  }
  const existing = state.editVentaId ? state.ventas.find(v => String(v.venta_id) === String(state.editVentaId)) : null;
  const obj = {
    venta_id: existing ? existing.venta_id : nuevoVentaId(),
    unidad_id, proyecto, cliente_id, precio_venta,
    tipo_credito: document.getElementById('v-tipo-credito').value || '',
    estatus_comercial,
    fecha_apartado: document.getElementById('v-fecha-apartado').value || '',
    fecha_escritura_estimada: document.getElementById('v-fecha-escritura-estimada').value || '',
    fecha_escritura_real: document.getElementById('v-fecha-escritura-real').value || '',
    valor_liberacion: parseFloat(document.getElementById('v-valor-liberacion').value) || 0,
    credito_id: document.getElementById('v-credito').value || '',
    monto_cobrado: 0,
    saldo_cliente: 0,
    observaciones: document.getElementById('v-obs').value.trim(),
    activo: existing ? existing.activo !== false : true
  };
  recalcularVenta(obj);   // re-suma los cobros existentes de esta venta (0 si es nueva)
  if (existing) {
    const i = state.ventas.findIndex(v => String(v.venta_id) === String(state.editVentaId));
    state.ventas[i] = obj;
  } else {
    state.ventas.push(obj);
  }
  cerrar('modal-venta');
  renderVentas();
  notify(existing ? 'Venta actualizada' : 'Venta registrada');
  const porFila = esPorFila('ventas');
  gsSaveVentas({ porFila });
  if (porFila) sbGuardarFila('ventas', obj);
}

export function eliminarVenta(id) {
  const v = state.ventas.find(x => String(x.venta_id) === String(id));
  if (!v) return;
  // Candado: no borrar una venta que ya tenga cobros (protege desde Etapa 5).
  const conCobros = state.cobros.some(c => String(c.venta_id) === String(id) && c.activo !== false);
  if (conCobros) { notify('No se puede eliminar: la venta tiene cobros registrados.', 'error'); return; }
  if (!confirm(`¿Eliminar la venta de "${_unidadLabel(v.unidad_id)}"?`)) return;
  state.ventas = state.ventas.filter(x => String(x.venta_id) !== String(id));
  renderVentas();
  notify('Venta eliminada');
  const porFila = esPorFila('ventas');
  gsSaveVentas({ porFila });
  if (porFila) sbBorrarFila('ventas', id);
}
// ---- Cobranza (Etapa 5) -----------------------------------------------------
const _TIPO_COBRO_LABEL = { enganche: 'Enganche', mensualidad: 'Mensualidad', liquidacion: 'Liquidación', adeudo: 'Adeudo', abono: 'Abono', otro: 'Otro' };

// DERIVADO: re-suma los cobros activos de una venta → monto_cobrado + saldo_cliente.
// Única fuente de verdad de esos campos (se llama en cada alta/edición/baja de cobro
// y al guardar la venta). Sin acumulador incremental → sin drift.
function recalcularVenta(venta) {
  if (!venta) return;
  const cobrado = state.cobros
    .filter(c => String(c.venta_id) === String(venta.venta_id) && c.activo !== false)
    .reduce((s, c) => s + (parseFloat(c.monto) || 0), 0);
  venta.monto_cobrado = cobrado;
  venta.saldo_cliente = Math.max(0, (venta.precio_venta || 0) - cobrado);
}

// Recalcula TODAS las ventas desde los cobros (Map una vez). La usa el realtime al
// recibir un cobro de otro usuario (evita depender del orden en que llegan los
// eventos cobro/venta). NO persiste: solo corrige el estado local para mostrar.
export function recalcularVentasDesdeCobros() {
  const m = new Map();
  for (const c of state.cobros) {
    if (c.activo === false) continue;
    const k = String(c.venta_id);
    m.set(k, (m.get(k) || 0) + (parseFloat(c.monto) || 0));
  }
  for (const v of state.ventas) {
    const cobrado = m.get(String(v.venta_id)) || 0;
    v.monto_cobrado = cobrado;
    v.saldo_cliente = Math.max(0, (v.precio_venta || 0) - cobrado);
  }
}

// Persiste una venta por fila (tras recalcular sus derivados por un cobro).
function _persistVenta(venta) {
  if (!venta) return;
  const porFila = esPorFila('ventas');
  gsSaveVentas({ porFila });
  if (porFila) sbGuardarFila('ventas', venta);
}

function _ventaLabel(ventaId) {
  const v = state.ventas.find(x => String(x.venta_id) === String(ventaId));
  if (!v) return '—';
  return `${_unidadLabel(v.unidad_id)} · ${_clienteLabel(v.cliente_id)}`;
}

export function renderCobros() {
  actualizarContadoresIngresos();
  const s = document.getElementById('sub-cobros'); if (s) s.textContent = `${state.cobros.length} registros`;
  const el = document.getElementById('lista-cobros');
  if (!el) return;
  if (!state.cobros.length) {
    el.innerHTML = _emptyState('💵', 'Sin cobros aún', 'Usa "+ Nuevo cobro" para registrar el primero.');
    return;
  }
  const orden = [...state.cobros].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const filas = orden.map(c => {
    const id = String(c.cobro_id).replace(/'/g, "\\'");
    return `<tr><td style="font-size:12px;">${escapeHtml(fmtFecha(c.fecha))}</td>` +
      `<td style="font-size:12px;"><div class="name-cell" style="font-size:12px;">${escapeHtml(_ventaLabel(c.venta_id))}</div></td>` +
      `<td style="font-size:11px;color:var(--muted);">${escapeHtml(_TIPO_COBRO_LABEL[c.tipo_cobro] || c.tipo_cobro || '—')}</td>` +
      `<td style="font-size:11px;color:var(--muted);">${escapeHtml(c.metodo || '—')}</td>` +
      `<td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;color:#27ae60;font-weight:600;">${fmt(c.monto || 0)}</td>` +
      `<td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-ghost btn-sm" onclick="editarCobro('${id}')">Editar</button><button class="btn btn-ghost btn-sm req-editor danger" onclick="eliminarCobro('${id}')">✕</button></div></td></tr>`;
  }).join('');
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Venta (unidad · cliente)</th><th>Tipo</th><th>Método</th><th style="text-align:right">Monto</th><th style="text-align:right">Acciones</th></tr></thead><tbody>${filas}</tbody></table></div>`;
}

// Puebla el select de ventas del modal de cobro (activas, no canceladas), con saldo.
function _poblarSelectVentasCobro() {
  const sel = document.getElementById('co-venta');
  if (!sel) return;
  const activas = state.ventas.filter(v => v.activo !== false && v.estatus_comercial !== 'cancelada');
  sel.innerHTML = '<option value="">— Selecciona venta —</option>' +
    activas.map(v => `<option value="${escapeHtml(String(v.venta_id))}">${escapeHtml(_unidadLabel(v.unidad_id))} · ${escapeHtml(_clienteLabel(v.cliente_id))} · saldo ${fmt(v.saldo_cliente != null ? v.saldo_cliente : (v.precio_venta || 0))}</option>`).join('');
}

export function abrirNuevoCobro(ventaId) {
  state.editCobroId = null;
  _poblarSelectVentasCobro();
  limpiarFormCobro();
  if (ventaId) { const s = document.getElementById('co-venta'); if (s) s.value = String(ventaId); }
  const t = document.getElementById('modal-cobro-title'); if (t) t.textContent = 'Nuevo Cobro';
  document.getElementById('modal-cobro').classList.add('open');
}

export function editarCobro(id) {
  const c = state.cobros.find(x => String(x.cobro_id) === String(id));
  if (!c) return;
  state.editCobroId = c.cobro_id;
  _poblarSelectVentasCobro();
  const t = document.getElementById('modal-cobro-title'); if (t) t.textContent = 'Editar Cobro';
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  set('co-venta', String(c.venta_id || ''));
  set('co-fecha', _isoDeFecha(c.fecha));
  set('co-monto', c.monto != null ? c.monto : '');
  set('co-tipo', c.tipo_cobro || 'abono');
  set('co-metodo', c.metodo || 'transferencia');
  set('co-referencia', c.referencia || '');
  set('co-concepto', c.concepto || '');
  set('co-obs', c.observaciones || '');
  document.getElementById('modal-cobro').classList.add('open');
}

function limpiarFormCobro() {
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  set('co-venta', '');
  set('co-fecha', new Date().toISOString().slice(0, 10));   // hoy por defecto
  set('co-monto', '');
  set('co-tipo', 'abono');
  set('co-metodo', 'transferencia');
  set('co-referencia', '');
  set('co-concepto', '');
  set('co-obs', '');
}

export function guardarCobro() {
  const venta_id = (document.getElementById('co-venta').value || '').trim();
  const monto = parseFloat(document.getElementById('co-monto').value) || 0;
  const fecha = (document.getElementById('co-fecha').value || '').trim();
  if (!venta_id) { notify('Elige la venta a la que aplica el cobro', 'error'); return; }
  if (monto <= 0) { notify('El monto del cobro debe ser mayor a 0', 'error'); return; }
  if (!fecha) { notify('Pon la fecha del cobro', 'error'); return; }
  const venta = state.ventas.find(v => String(v.venta_id) === String(venta_id));
  if (!venta) { notify('No se encontró la venta', 'error'); return; }
  // Tope suave: avisar si el cobro excede el saldo (puede ser válido: intereses, ajustes).
  const saldoActual = venta.saldo_cliente != null ? venta.saldo_cliente : (venta.precio_venta || 0);
  const existingMonto = state.editCobroId ? (state.cobros.find(c => String(c.cobro_id) === String(state.editCobroId))?.monto || 0) : 0;
  if (monto - existingMonto > saldoActual + 0.005) {
    if (!confirm(`Este cobro (${fmt(monto)}) excede el saldo del cliente (${fmt(saldoActual)}). ¿Registrarlo de todos modos?`)) return;
  }
  const existing = state.editCobroId ? state.cobros.find(c => String(c.cobro_id) === String(state.editCobroId)) : null;
  const ventaAnteriorId = existing ? existing.venta_id : null;
  const obj = {
    cobro_id: existing ? existing.cobro_id : nuevoCobroId(),
    venta_id, cliente_id: venta.cliente_id || '', proyecto: venta.proyecto || '',
    fecha, monto,
    tipo_cobro: document.getElementById('co-tipo').value || 'abono',
    metodo: document.getElementById('co-metodo').value || 'transferencia',
    cuenta_destino_tipo: '', cuenta_destino_id: '',   // Fase 1: sin efecto en saldo (diferido)
    referencia: document.getElementById('co-referencia').value.trim(),
    concepto: document.getElementById('co-concepto').value.trim(),
    observaciones: document.getElementById('co-obs').value.trim(),
    activo: existing ? existing.activo !== false : true
  };
  if (existing) {
    const i = state.cobros.findIndex(c => String(c.cobro_id) === String(state.editCobroId));
    state.cobros[i] = obj;
  } else {
    state.cobros.push(obj);
  }
  // Recalcular derivados de la(s) venta(s) afectada(s) y persistirlas.
  recalcularVenta(venta); _persistVenta(venta);
  if (ventaAnteriorId && String(ventaAnteriorId) !== String(venta_id)) {
    const va = state.ventas.find(v => String(v.venta_id) === String(ventaAnteriorId));
    if (va) { recalcularVenta(va); _persistVenta(va); }
  }
  cerrar('modal-cobro');
  renderCobros(); renderVentas(); renderEstadoCuenta();
  notify(existing ? 'Cobro actualizado' : 'Cobro registrado');
  const porFila = esPorFila('cobros');
  gsSaveCobros({ porFila });
  if (porFila) sbGuardarFila('cobros', obj);
}

export function eliminarCobro(id) {
  const c = state.cobros.find(x => String(x.cobro_id) === String(id));
  if (!c) return;
  if (!confirm(`¿Eliminar este cobro de ${fmt(c.monto || 0)}?`)) return;
  const venta = state.ventas.find(v => String(v.venta_id) === String(c.venta_id));
  state.cobros = state.cobros.filter(x => String(x.cobro_id) !== String(id));
  if (venta) { recalcularVenta(venta); _persistVenta(venta); }
  renderCobros(); renderVentas(); renderEstadoCuenta();
  notify('Cobro eliminado');
  const porFila = esPorFila('cobros');
  gsSaveCobros({ porFila });
  if (porFila) sbBorrarFila('cobros', id);
}

// ---- Estado de Cuenta + KPIs (Etapa 5) --------------------------------------
// Normaliza una fecha (ISO o DD/MM/YYYY) a YYYY-MM-DD para inputs; y a YYYY-MM para KPIs.
function _isoDeFecha(f) {
  if (!f) return '';
  if (f.includes('-')) return f.slice(0, 10);
  const p = f.split('/'); if (p.length === 3) return `${p[2]}-${String(p[1]).padStart(2, '0')}-${String(p[0]).padStart(2, '0')}`;
  return '';
}
function _ymDeFecha(f) { const iso = _isoDeFecha(f); return iso ? iso.slice(0, 7) : ''; }

function _renderKpisIngresos() {
  const ventasVivas = state.ventas.filter(v => v.activo !== false && v.estatus_comercial !== 'cancelada');
  const cartera = ventasVivas.reduce((s, v) => s + (v.saldo_cliente != null ? v.saldo_cliente : (v.precio_venta || 0)), 0);
  const ym = new Date().toISOString().slice(0, 7);
  const cobradoMes = state.cobros.filter(c => c.activo !== false && _ymDeFecha(c.fecha) === ym).reduce((s, c) => s + (c.monto || 0), 0);
  const adeudoEscri = ventasVivas.filter(v => v.estatus_comercial === 'escriturada' && (v.saldo_cliente || 0) > 0).reduce((s, v) => s + (v.saldo_cliente || 0), 0);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('st-ing-cartera', fmt(cartera));
  set('st-ing-mes', fmt(cobradoMes));
  set('st-ing-ventas', String(ventasVivas.length));
  set('st-ing-adeudo', fmt(adeudoEscri));
}

export function renderEstadoCuenta() {
  _renderKpisIngresos();
  const el = document.getElementById('lista-estado-cuenta');
  if (!el) return;
  const ventasVivas = state.ventas.filter(v => v.activo !== false);
  if (!ventasVivas.length) {
    el.innerHTML = _emptyState('📄', 'Sin movimientos aún', 'Registra ventas y cobros para ver el estado de cuenta.');
    return;
  }
  // Agrupar por cliente.
  const porCliente = new Map();
  for (const v of ventasVivas) {
    const k = String(v.cliente_id || '');
    if (!porCliente.has(k)) porCliente.set(k, []);
    porCliente.get(k).push(v);
  }
  const bloques = [...porCliente.entries()].map(([clienteId, ventas]) => {
    const nombre = _clienteLabel(clienteId);
    const tPrecio = ventas.reduce((s, v) => s + (v.precio_venta || 0), 0);
    const tCobrado = ventas.reduce((s, v) => s + (v.monto_cobrado || 0), 0);
    const tSaldo = ventas.reduce((s, v) => s + (v.saldo_cliente != null ? v.saldo_cliente : (v.precio_venta || 0)), 0);
    const filas = ventas.map(v => {
      const est = v.estatus_comercial || 'apartada';
      const badge = `<span style="display:inline-block;padding:1px 7px;border-radius:6px;font-size:10px;font-weight:600;background:${_ESTATUS_COLOR[est] || _ESTATUS_COLOR.apartada};">${escapeHtml(est)}</span>`;
      const adeudo = (est === 'escriturada' && (v.saldo_cliente || 0) > 0)
        ? ' <span style="display:inline-block;padding:1px 7px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(231,76,60,.15);color:#e74c3c;">adeudo post-escritura</span>' : '';
      const cobros = state.cobros.filter(c => String(c.venta_id) === String(v.venta_id) && c.activo !== false)
        .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
      const detalle = cobros.length
        ? `<div style="font-size:11px;color:var(--muted);margin-top:3px;padding-left:2px;">${cobros.map(c => `${escapeHtml(fmtFecha(c.fecha))} · ${escapeHtml(_TIPO_COBRO_LABEL[c.tipo_cobro] || c.tipo_cobro || '')} · ${fmt(c.monto || 0)}`).join(' &nbsp;·&nbsp; ')}</div>`
        : '';
      return `<tr><td style="font-size:12px;"><div class="name-cell" style="font-size:12px;">${escapeHtml(_unidadLabel(v.unidad_id))} ${badge}${adeudo}</div><div class="name-sub">${escapeHtml(v.proyecto || '')}</div>${detalle}</td>` +
        `<td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;">${fmt(v.precio_venta || 0)}</td>` +
        `<td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;color:#27ae60;">${fmt(v.monto_cobrado || 0)}</td>` +
        `<td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;font-weight:600;">${fmt(v.saldo_cliente != null ? v.saldo_cliente : (v.precio_venta || 0))}</td></tr>`;
    }).join('');
    return `<div style="margin-bottom:18px;border:1px solid var(--border);border-radius:12px;overflow:hidden;">` +
      `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;background:var(--surface);">` +
      `<div style="font-weight:700;font-family:'Syne',sans-serif;">${escapeHtml(nombre)}</div>` +
      `<div style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;">Precio ${fmt(tPrecio)} · Cobrado <span style="color:#27ae60;">${fmt(tCobrado)}</span> · Saldo <span style="font-weight:700;color:var(--text);">${fmt(tSaldo)}</span></div></div>` +
      `<div class="table-wrap"><table><thead><tr><th>Unidad</th><th style="text-align:right">Precio</th><th style="text-align:right">Cobrado</th><th style="text-align:right">Saldo</th></tr></thead><tbody>${filas}</tbody></table></div></div>`;
  }).join('');
  el.innerHTML = bloques;
}

export function exportarEstadoCuentaCSV() {
  let csv = 'Cliente,Unidad,Proyecto,Precio,Cobrado,Saldo,Estatus\n';
  csv += state.ventas.filter(v => v.activo !== false).map(v => {
    const saldo = v.saldo_cliente != null ? v.saldo_cliente : (v.precio_venta || 0);
    return `"${_clienteLabel(v.cliente_id)}","${_unidadLabel(v.unidad_id)}","${v.proyecto || ''}",${v.precio_venta || 0},${v.monto_cobrado || 0},${saldo},"${v.estatus_comercial || ''}"`;
  }).join('\n');
  dl(csv, 'estado_de_cuenta.csv');
  notify('Estado de cuenta exportado');
}

// Estilos del switcher, inyectados una sola vez (sin tocar el CSS de Pagos).
function _inyectarEstilos() {
  if (document.getElementById('ingresos-css')) return;
  const st = document.createElement('style');
  st.id = 'ingresos-css';
  st.textContent =
    '.ws-switch{display:inline-flex;gap:2px;padding:3px;border-radius:10px;background:var(--surface2,var(--surface));border:1px solid var(--border);}' +
    '.ws-btn{appearance:none;border:none;background:transparent;color:var(--muted);font-family:inherit;font-size:12px;font-weight:600;padding:5px 14px;border-radius:8px;cursor:pointer;transition:background .15s,color .15s;}' +
    '.ws-btn:hover{color:var(--text);}' +
    '.ws-btn.active{background:var(--accent);color:#1a1a1a;}';
  document.head.appendChild(st);
}

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

import { state, nuevoClienteId, nuevoVentaId } from '../state.js';
import { ingresosActivo, esPorFila, sbGuardarFila, sbBorrarFila, gsSaveClientes, gsSaveVentas } from '../services/google-sync.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { fmt, escapeHtml } from '../ui/format.js';

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
  try {
    const s = location.search || '';
    if (/[?&]ingresos=1(\b|&|$)/.test(s)) localStorage.setItem('dt-ingresos', '1');
    else if (/[?&]ingresos=0(\b|&|$)/.test(s)) localStorage.removeItem('dt-ingresos');
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
      `<td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-ghost btn-sm" onclick="editarCliente('${id}')">Editar</button><button class="btn btn-ghost btn-sm req-editor" style="color:#e74c3c;" onclick="eliminarCliente('${id}')">✕</button></div></td></tr>`;
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
      `<td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-ghost btn-sm" onclick="editarVenta('${id}')">Editar</button><button class="btn btn-ghost btn-sm req-editor" style="color:#e74c3c;" onclick="eliminarVenta('${id}')">✕</button></div></td></tr>`;
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
  const monto_cobrado = existing ? (existing.monto_cobrado || 0) : 0;   // los cobros lo mueven en Etapa 5
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
    monto_cobrado,
    saldo_cliente: Math.max(0, precio_venta - monto_cobrado),
    observaciones: document.getElementById('v-obs').value.trim(),
    activo: existing ? existing.activo !== false : true
  };
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
export function renderCobros() {
  const s = document.getElementById('sub-cobros'); if (s) s.textContent = `${state.cobros.length} registros`;
  actualizarContadoresIngresos();
  const el = document.getElementById('lista-cobros');
  if (el && !state.cobros.length) el.innerHTML = _emptyState('💵', 'Sin cobros aún', 'El registro de cobranza llega pronto.');
}
export function renderEstadoCuenta() {
  const el = document.getElementById('lista-estado-cuenta');
  if (el) el.innerHTML = _emptyState('📄', 'Estado de cuenta', 'Se llena cuando existan ventas y cobros.');
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

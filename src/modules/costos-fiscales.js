// ===== COSTOS FISCALES POR UNIDAD =====
// Capa nueva y aislada: asigna los pagos del historial a unidades (casas)
// para conocer el costo real por casa. No toca el flujo de pagos existente.

import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { proyectoMatch } from '../config/proyectos.js';
import { ESTATUS_UNIDAD, METODO_LABEL } from '../config/costos-fiscales.js';
import { gsSaveUnidades, gsSavePresupuestoUnidad, gsSaveCostoAsignaciones } from '../services/google-sync.js';

const PALETA = ['#c8a96e', '#5a9be0', '#4caf7d', '#e07a3a', '#9b7fe8', '#e05a5a', '#27ae60', '#3498db'];

let cfProyecto = '';        // proyecto activo
let cfTab = 'unidades';     // sub-pestaña: unidades | asignar | presupuestos | reportes
let cfUnidadDetalle = null; // unidad_id seleccionada en presupuestos/reportes
let cfPagoAsignar = null;   // pago_id en proceso de asignación
let cfChartUnidad = null;

// ---------- utilidades ----------
function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

function unidadesDeProyecto(incluirInactivas = false) {
  return state.unidades
    .filter(u => u.proyecto === cfProyecto && (incluirInactivas || u.activo !== false))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.unidad_id - b.unidad_id);
}

function unidadById(id) { return state.unidades.find(u => u.unidad_id === id); }

function historialIdSet() { return new Set(state.historial.map(h => h.id).filter(Boolean)); }

function pagoById(id) { return state.historial.find(h => String(h.id) === String(id)); }

function partidasConocidas() {
  const set = new Set();
  state.historial.forEach(h => { if (h.partida) set.add(h.partida); });
  state.presupuestoUnidad.forEach(p => { if (p.partida) set.add(p.partida); });
  return [...set].sort();
}

function partidaDeAsignacion(a) {
  if (a.partida_override) return a.partida_override;
  const p = pagoById(a.pago_id);
  return (p && p.partida) || 'Sin partida';
}

// ---------- cálculos ----------
function asignacionesDeUnidad(unidadId) {
  return state.costoAsignaciones.filter(a => a.unidad_id === unidadId);
}

function costoAsignadoUnidad(unidadId) {
  return asignacionesDeUnidad(unidadId).reduce((s, a) => s + (a.monto_asignado || 0), 0);
}

function presupuestoRowsUnidad(unidadId) {
  return state.presupuestoUnidad.filter(p => p.unidad_id === unidadId);
}

function presupuestoTotalUnidad(unidadId) {
  return presupuestoRowsUnidad(unidadId).reduce((s, p) => s + (p.monto_presupuestado || 0), 0);
}

function costoInicialUnidad(unidadId) {
  return presupuestoRowsUnidad(unidadId).reduce((s, p) => s + (p.costo_inicial || 0), 0);
}

function costoRealUnidad(unidadId) {
  return costoInicialUnidad(unidadId) + costoAsignadoUnidad(unidadId);
}

function avancePct(real, presupuesto) {
  if (!presupuesto || presupuesto <= 0) return null;
  return (real / presupuesto) * 100;
}

// Devuelve { partida: {presupuestado, costoInicial, asignado, real} }
function desglosePorPartida(unidadId) {
  const out = {};
  const get = k => (out[k] = out[k] || { presupuestado: 0, costoInicial: 0, asignado: 0, real: 0 });
  presupuestoRowsUnidad(unidadId).forEach(p => {
    const k = p.partida || 'Sin partida';
    get(k).presupuestado += p.monto_presupuestado || 0;
    get(k).costoInicial += p.costo_inicial || 0;
  });
  asignacionesDeUnidad(unidadId).forEach(a => {
    get(partidaDeAsignacion(a)).asignado += a.monto_asignado || 0;
  });
  Object.values(out).forEach(v => { v.real = v.costoInicial + v.asignado; });
  return out;
}

function pagosSinAsignar() {
  const asignados = new Set(state.costoAsignaciones.map(a => String(a.pago_id)));
  return state.historial.filter(h =>
    h.tipo_registro === 'Pago' && h.id &&
    proyectoMatch(h.proyecto, cfProyecto) &&
    !asignados.has(String(h.id))
  );
}

function pagosAsignados() {
  const asignados = new Set(state.costoAsignaciones.map(a => String(a.pago_id)));
  return state.historial.filter(h =>
    h.tipo_registro === 'Pago' && h.id &&
    proyectoMatch(h.proyecto, cfProyecto) &&
    asignados.has(String(h.id))
  );
}

function asignacionesHuerfanas() {
  const ids = historialIdSet();
  return state.costoAsignaciones.filter(a => !ids.has(String(a.pago_id)));
}

// ---------- render principal ----------
export function renderCostosFiscales() {
  const cont = document.getElementById('cf-contenido');
  const empty = document.getElementById('cf-empty');
  if (!cont) return;

  if (!state.gsToken) {
    cont.style.display = 'none';
    if (empty) empty.style.display = '';
    return;
  }
  cont.style.display = '';
  if (empty) empty.style.display = 'none';

  const activos = state.proyectos.filter(p => p.activo !== false);
  if (!cfProyecto || !activos.find(p => p.nombre === cfProyecto)) {
    cfProyecto = activos.length ? activos[0].nombre : '';
  }

  renderProyTabs(activos);
  renderSubTabs();
  renderPanel();
}

function renderProyTabs(activos) {
  const cont = document.getElementById('cf-proy-tabs');
  if (!cont) return;
  cont.innerHTML = activos.map(p => {
    const act = p.nombre === cfProyecto;
    return `<button class="re-tab${act ? ' active' : ''}" data-proy="${p.nombre.replace(/"/g, '&quot;')}"
      style="${act ? `border-color:${p.color || 'var(--accent)'};color:${p.color || 'var(--accent)'};` : ''}">${p.nombre}</button>`;
  }).join('') || '<div style="color:var(--muted);font-size:12px;">Sin proyectos activos</div>';
  cont.querySelectorAll('.re-tab').forEach(b => {
    b.addEventListener('click', () => { cfProyecto = b.dataset.proy; cfUnidadDetalle = null; renderCostosFiscales(); });
  });
}

function renderSubTabs() {
  const cont = document.getElementById('cf-tabs');
  if (!cont) return;
  const tabs = [
    { id: 'unidades', label: '🏠 Unidades' },
    { id: 'asignar', label: '🔗 Asignar Pagos' },
    { id: 'presupuestos', label: '📋 Presupuestos' },
    { id: 'reportes', label: '📊 Costo por Unidad' },
  ];
  cont.innerHTML = tabs.map(t =>
    `<button class="cf-subtab${cfTab === t.id ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
  ).join('');
  cont.querySelectorAll('.cf-subtab').forEach(b => {
    b.addEventListener('click', () => {
      cfTab = b.dataset.tab;
      cont.querySelectorAll('.cf-subtab').forEach(x => x.classList.toggle('active', x.dataset.tab === cfTab));
      renderPanel();
    });
  });
}

function renderPanel() {
  const panel = document.getElementById('cf-panel');
  if (!panel) return;
  if (cfTab === 'unidades') renderUnidadesTab(panel);
  else if (cfTab === 'asignar') renderAsignarTab(panel);
  else if (cfTab === 'presupuestos') renderPresupuestosTab(panel);
  else if (cfTab === 'reportes') renderReportesTab(panel);
}

// ========== TAB: UNIDADES ==========
function renderUnidadesTab(panel) {
  const unidades = unidadesDeProyecto(true);
  const sumaInd = unidades.filter(u => u.activo !== false).reduce((s, u) => s + (u.indiviso_pct || 0), 0);
  const indOk = Math.abs(sumaInd - 100) < 0.05;

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
      <div style="font-size:12px;color:var(--muted);">
        ${unidades.length} unidad${unidades.length !== 1 ? 'es' : ''} ·
        Suma indiviso: <strong style="color:${indOk ? 'var(--green)' : 'var(--orange)'};">${sumaInd.toFixed(2)}%</strong>
        ${indOk ? '' : ' (debería ser 100%)'}
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" onclick="abrirLoteUnidades()">+ Crear en lote</button>
        <button class="btn btn-primary" onclick="abrirNuevaUnidad()">+ Nueva Unidad</button>
      </div>
    </div>
    ${unidades.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Unidad</th><th>Tipo</th><th style="text-align:right">% Indiviso</th>
          <th style="text-align:right">Superficie</th><th>Estatus</th>
          <th style="text-align:right">Costo real</th><th style="text-align:right">Acciones</th>
        </tr></thead>
        <tbody>${unidades.map(u => {
          const real = costoRealUnidad(u.unidad_id);
          return `<tr style="${u.activo === false ? 'opacity:.5;' : ''}">
            <td style="font-weight:600;">${u.nombre}</td>
            <td style="color:var(--muted);">${u.tipo || '—'}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;">${(u.indiviso_pct || 0).toFixed(2)}%</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--muted);">${u.superficie_m2 ? u.superficie_m2 + ' m²' : '—'}</td>
            <td><span style="font-size:11px;color:var(--muted);">${u.estatus || '—'}</span></td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(real)}</td>
            <td style="text-align:right;white-space:nowrap;">
              <button class="btn btn-ghost btn-sm" onclick="editarUnidad(${u.unidad_id})">Editar</button>
              <button class="btn btn-ghost btn-sm" onclick="toggleUnidad(${u.unidad_id})" style="color:${u.activo === false ? 'var(--green)' : 'var(--red)'};">${u.activo === false ? 'Activar' : 'Baja'}</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : `<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🏠</div><div>Sin unidades en ${cfProyecto}. Crea las casas para empezar.</div></div>`}
  `;
}

export function abrirNuevaUnidad() {
  if (!cfProyecto) { notify('Selecciona un proyecto', 'error'); return; }
  state.editUnidadId = null;
  document.getElementById('modal-unidad-title').textContent = 'Nueva Unidad · ' + cfProyecto;
  document.getElementById('un-nombre').value = '';
  document.getElementById('un-tipo').value = '';
  document.getElementById('un-indiviso').value = '';
  document.getElementById('un-superficie').value = '';
  document.getElementById('un-estatus').innerHTML = ESTATUS_UNIDAD.map(e => `<option>${e}</option>`).join('');
  document.getElementById('modal-unidad').classList.add('open');
}

export function editarUnidad(id) {
  const u = unidadById(id);
  if (!u) return;
  state.editUnidadId = id;
  document.getElementById('modal-unidad-title').textContent = 'Editar ' + u.nombre;
  document.getElementById('un-nombre').value = u.nombre;
  document.getElementById('un-tipo').value = u.tipo || '';
  document.getElementById('un-indiviso').value = u.indiviso_pct || '';
  document.getElementById('un-superficie').value = u.superficie_m2 || '';
  document.getElementById('un-estatus').innerHTML = ESTATUS_UNIDAD.map(e => `<option${e === u.estatus ? ' selected' : ''}>${e}</option>`).join('');
  document.getElementById('modal-unidad').classList.add('open');
}

export async function guardarUnidad() {
  const nombre = document.getElementById('un-nombre').value.trim();
  if (!nombre) { notify('El nombre es obligatorio', 'error'); return; }
  const indiviso = parseFloat(document.getElementById('un-indiviso').value) || 0;
  const obj = {
    nombre,
    tipo: document.getElementById('un-tipo').value.trim(),
    indiviso_pct: indiviso,
    superficie_m2: parseFloat(document.getElementById('un-superficie').value) || 0,
    estatus: document.getElementById('un-estatus').value,
  };
  if (state.editUnidadId) {
    const u = unidadById(state.editUnidadId);
    if (u) Object.assign(u, obj);
  } else {
    state.unidades.push({
      unidad_id: state.nextUnidadId++,
      proyecto: cfProyecto,
      orden: unidadesDeProyecto(true).length + 1,
      activo: true,
      ...obj
    });
  }
  cerrar('modal-unidad');
  await gsSaveUnidades();
  notify('Unidad guardada');
  renderCostosFiscales();
}

export async function toggleUnidad(id) {
  const u = unidadById(id);
  if (!u) return;
  u.activo = u.activo === false;
  await gsSaveUnidades();
  renderCostosFiscales();
}

export function abrirLoteUnidades() {
  if (!cfProyecto) { notify('Selecciona un proyecto', 'error'); return; }
  document.getElementById('lote-prefijo').value = 'Casa ';
  document.getElementById('lote-desde').value = '1';
  document.getElementById('lote-cantidad').value = '10';
  document.getElementById('lote-indiviso-auto').checked = true;
  document.getElementById('modal-unidades-lote').classList.add('open');
}

export async function guardarLoteUnidades() {
  const prefijo = document.getElementById('lote-prefijo').value;
  const desde = parseInt(document.getElementById('lote-desde').value) || 1;
  const cantidad = parseInt(document.getElementById('lote-cantidad').value) || 0;
  if (cantidad < 1 || cantidad > 500) { notify('Cantidad inválida (1-500)', 'error'); return; }
  const autoIndiviso = document.getElementById('lote-indiviso-auto').checked;

  const existentes = unidadesDeProyecto(true).length;
  // Reparte 100% entre el total de unidades activas resultante
  const totalFinal = existentes + cantidad;
  const indivisoCada = autoIndiviso ? r2(100 / totalFinal) : 0;

  for (let i = 0; i < cantidad; i++) {
    state.unidades.push({
      unidad_id: state.nextUnidadId++,
      proyecto: cfProyecto,
      nombre: prefijo + (desde + i),
      tipo: '',
      indiviso_pct: indivisoCada,
      superficie_m2: 0,
      estatus: 'En obra',
      orden: existentes + i + 1,
      activo: true,
    });
  }
  // Si auto-indiviso, re-nivelar también las unidades previas para que sume 100
  if (autoIndiviso) {
    unidadesDeProyecto(true).forEach(u => { u.indiviso_pct = indivisoCada; });
  }
  cerrar('modal-unidades-lote');
  await gsSaveUnidades();
  notify(`${cantidad} unidades creadas`);
  renderCostosFiscales();
}

// ========== TAB: ASIGNAR PAGOS ==========
function renderAsignarTab(panel) {
  const pendientes = pagosSinAsignar();
  const asignados = pagosAsignados();
  const huerfanas = asignacionesHuerfanas();

  panel.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-label">Pagos sin asignar</div><div class="stat-value" style="color:var(--orange);">${pendientes.length}</div><div class="stat-sub">${fmt(pendientes.reduce((s, h) => s + (h.importe || 0), 0))}</div></div>
      <div class="stat-card"><div class="stat-label">Pagos asignados</div><div class="stat-value" style="color:var(--green);">${asignados.length}</div><div class="stat-sub">${fmt(asignados.reduce((s, h) => s + (h.importe || 0), 0))}</div></div>
      <div class="stat-card"><div class="stat-label">Asignaciones huérfanas</div><div class="stat-value" style="color:${huerfanas.length ? 'var(--red)' : 'var(--muted)'};">${huerfanas.length}</div><div class="stat-sub">${huerfanas.length ? '<a href="#" onclick="cfLimpiarHuerfanas();return false;" style="color:var(--accent);">Limpiar</a>' : 'Sin problemas'}</div></div>
    </div>

    <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;margin-bottom:10px;">Pendientes de asignar</div>
    ${pendientes.length ? `
    <div class="table-wrap" style="margin-bottom:24px;">
      <table>
        <thead><tr><th>Fecha</th><th>Beneficiario</th><th>Concepto</th><th>Partida</th><th style="text-align:right">Importe</th><th style="text-align:right">Acción</th></tr></thead>
        <tbody>${pendientes.map(h => `
          <tr>
            <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${h.fecha || ''}</td>
            <td style="font-weight:500;">${h.nombre || '—'}</td>
            <td style="color:var(--muted);font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.concepto || '—'}</td>
            <td style="color:var(--muted);font-size:12px;">${h.partida || 'Sin partida'}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(h.importe || 0)}</td>
            <td style="text-align:right;"><button class="btn btn-primary btn-sm" onclick="abrirAsignarCosto('${h.id}')">Asignar</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>` : '<div class="empty-state" style="margin-bottom:24px;"><div style="font-size:28px;opacity:.4;margin-bottom:8px;">✅</div><div>Todos los pagos de ' + cfProyecto + ' están asignados</div></div>'}

    <button id="cf-btn-asignados" class="btn btn-ghost" onclick="cfToggleAsignados()" style="margin-bottom:12px;">▸ Ver pagos ya asignados (${asignados.length})</button>
    <div id="cf-asignados-wrap" style="display:none;">
    ${asignados.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Beneficiario</th><th style="text-align:right">Importe</th><th>Reparto</th><th style="text-align:right">Acción</th></tr></thead>
        <tbody>${asignados.map(h => {
          const asigs = state.costoAsignaciones.filter(a => String(a.pago_id) === String(h.id));
          const detalle = asigs.map(a => {
            const u = unidadById(a.unidad_id);
            return `${u ? u.nombre : '#' + a.unidad_id}: ${fmt(a.monto_asignado)}`;
          }).join(' · ');
          const metodo = asigs[0] ? METODO_LABEL[asigs[0].metodo] || asigs[0].metodo : '';
          return `<tr>
            <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${h.fecha || ''}</td>
            <td style="font-weight:500;">${h.nombre || '—'}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(h.importe || 0)}</td>
            <td style="font-size:11px;color:var(--muted);"><div style="color:var(--text);font-weight:500;">${metodo}</div>${detalle}</td>
            <td style="text-align:right;white-space:nowrap;">
              <button class="btn btn-ghost btn-sm" onclick="reasignarCosto('${h.id}')">Reasignar</button>
              <button class="btn btn-ghost btn-sm" onclick="eliminarAsignacionCosto('${h.id}')" style="color:var(--red);">Quitar</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '<div style="color:var(--muted);font-size:12px;padding:10px 0;">Aún no hay pagos asignados.</div>'}
    </div>
  `;
}

// Muestra u oculta la sección de pagos ya asignados.
export function cfToggleAsignados() {
  const wrap = document.getElementById('cf-asignados-wrap');
  const btn = document.getElementById('cf-btn-asignados');
  if (!wrap) return;
  const visible = wrap.style.display !== 'none';
  wrap.style.display = visible ? 'none' : '';
  if (btn) {
    const n = pagosAsignados().length;
    btn.textContent = (visible ? '▸ Ver' : '▾ Ocultar') + ` pagos ya asignados (${n})`;
  }
}

export async function cfLimpiarHuerfanas() {
  const huerfanas = asignacionesHuerfanas();
  if (!huerfanas.length) return;
  if (!confirm(`¿Eliminar ${huerfanas.length} asignación(es) huérfana(s)? Corresponden a pagos que ya no existen.`)) return;
  const ids = historialIdSet();
  state.costoAsignaciones = state.costoAsignaciones.filter(a => ids.has(String(a.pago_id)));
  await gsSaveCostoAsignaciones();
  notify('Asignaciones huérfanas eliminadas');
  renderPanel();
}

export function abrirAsignarCosto(pagoId) {
  const pago = pagoById(pagoId);
  if (!pago) { notify('Pago no encontrado', 'error'); return; }
  if (!unidadesDeProyecto().length) { notify('Primero crea unidades en este proyecto', 'error'); return; }
  cfPagoAsignar = pagoId;

  document.getElementById('asignar-info').innerHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px;">
      <div style="font-weight:600;">${pago.nombre || '—'}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${pago.fecha || ''} · ${pago.concepto || 'Sin concepto'} · ${pago.partida || 'Sin partida'}</div>
      <div style="font-family:'DM Mono',monospace;font-size:18px;color:var(--accent);font-weight:700;margin-top:6px;">${fmt(pago.importe || 0)}</div>
    </div>`;

  document.querySelector('input[name="cf-metodo"][value="directo"]').checked = true;
  renderMetodoBody();
  document.getElementById('modal-asignar-costo').classList.add('open');
}

export function reasignarCosto(pagoId) {
  // Reabre el modal; guardarAsignacionCosto reemplaza las asignaciones previas.
  // No se borra nada hasta confirmar, así cancelar no pierde datos.
  abrirAsignarCosto(pagoId);
}

export async function eliminarAsignacionCosto(pagoId) {
  if (!confirm('¿Quitar la asignación de costos de este pago?')) return;
  state.costoAsignaciones = state.costoAsignaciones.filter(a => String(a.pago_id) !== String(pagoId));
  await gsSaveCostoAsignaciones();
  notify('Asignación eliminada');
  renderPanel();
}

export function cfCambiarMetodo() {
  renderMetodoBody();
}

function metodoSeleccionado() {
  const el = document.querySelector('input[name="cf-metodo"]:checked');
  return el ? el.value : 'directo';
}

function renderMetodoBody() {
  const body = document.getElementById('asignar-metodo-body');
  if (!body) return;
  const metodo = metodoSeleccionado();
  const unidades = unidadesDeProyecto();

  if (!unidades.length) {
    body.innerHTML = '<div class="cf-picker-vacio">No hay casas activas en este proyecto. Crea unidades primero.</div>';
    cfPreviewReparto();
    return;
  }

  if (metodo === 'directo') {
    body.innerHTML = `
      <label style="font-size:12px;color:var(--muted);">Casa que recibe el costo completo</label>
      <select id="asignar-unidad-directo" class="filter-select" style="width:100%;margin-top:4px;" onchange="cfPreviewReparto()">
        ${unidades.map(u => `<option value="${u.unidad_id}">${u.nombre}</option>`).join('')}
      </select>`;
  } else if (metodo === 'equitativo') {
    body.innerHTML = `
      <div class="cf-picker-tools">
        <input type="text" class="cf-picker-search" placeholder="🔍 Buscar casa..." oninput="cfFiltrarUnidades()">
        <button type="button" class="btn btn-ghost btn-sm" onclick="cfSelTodas(true)">Todas</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="cfSelTodas(false)">Ninguna</button>
      </div>
      <div class="cf-picker cols" id="cf-picker-lista">
        ${unidades.map(u => `
          <div class="cf-pick-row" data-nombre="${(u.nombre || '').toLowerCase().replace(/"/g, '')}">
            <input type="checkbox" class="cf-unidad-check" value="${u.unidad_id}" id="cfchk-${u.unidad_id}" onchange="cfPreviewReparto()">
            <label for="cfchk-${u.unidad_id}">${u.nombre}</label>
          </div>`).join('')}
      </div>
      <div class="cf-picker-count" id="cf-picker-count"></div>`;
  } else if (metodo === 'custom') {
    const pago = pagoById(cfPagoAsignar);
    body.innerHTML = `
      <div class="cf-picker-tools">
        <input type="text" class="cf-picker-search" placeholder="🔍 Buscar casa..." oninput="cfFiltrarUnidades()">
        <button type="button" class="btn btn-ghost btn-sm" onclick="cfRepartirResto()">Repartir resto entre vacías</button>
      </div>
      <div class="cf-picker" id="cf-picker-lista">
        ${unidades.map(u => `
          <div class="cf-pick-row" data-nombre="${(u.nombre || '').toLowerCase().replace(/"/g, '')}">
            <label>${u.nombre}</label>
            <input type="number" step="0.01" class="cf-custom-monto" data-uid="${u.unidad_id}" placeholder="0.00"
              oninput="cfPreviewReparto()" style="text-align:right;font-family:'DM Mono',monospace;">
          </div>`).join('')}
      </div>
      <div class="cf-picker-count">Importe del pago a repartir: <strong>${fmt(pago ? pago.importe : 0)}</strong></div>`;
  } else if (metodo === 'indiviso') {
    body.innerHTML = `
      <div style="font-size:12px;color:var(--muted);background:rgba(155,127,232,.1);border:1px solid rgba(155,127,232,.3);border-radius:8px;padding:10px;">
        El costo se repartirá entre las <strong>${unidades.length}</strong> casas activas de ${cfProyecto}
        según su % de indiviso.
      </div>`;
  }
  cfPreviewReparto();
}

// Filtra las casas del picker por nombre según lo escrito en el buscador.
export function cfFiltrarUnidades() {
  const lista = document.getElementById('cf-picker-lista');
  const search = document.querySelector('.cf-picker-search');
  if (!lista || !search) return;
  const q = search.value.trim().toLowerCase();
  lista.querySelectorAll('.cf-pick-row').forEach(row => {
    const match = !q || (row.dataset.nombre || '').includes(q);
    row.classList.toggle('oculto', !match);
  });
}

// Marca o desmarca todas las casas (método equitativo).
export function cfSelTodas(valor) {
  document.querySelectorAll('.cf-unidad-check').forEach(c => { c.checked = valor; });
  cfPreviewReparto();
}

function calcularReparto() {
  const pago = pagoById(cfPagoAsignar);
  if (!pago) return [];
  const importe = pago.importe || 0;
  const metodo = metodoSeleccionado();
  const unidades = unidadesDeProyecto();

  if (metodo === 'directo') {
    const sel = document.getElementById('asignar-unidad-directo');
    const uid = sel ? parseInt(sel.value) : null;
    if (!uid) return [];
    return [{ unidad_id: uid, factor: 1, monto: r2(importe) }];
  }
  if (metodo === 'equitativo') {
    const sel = [...document.querySelectorAll('.cf-unidad-check:checked')].map(c => parseInt(c.value));
    if (!sel.length) return [];
    const n = sel.length;
    const base = r2(importe / n);
    const arr = sel.map((uid, i) => ({ unidad_id: uid, factor: 1 / n, monto: base }));
    const suma = r2(base * n);
    arr[n - 1].monto = r2(arr[n - 1].monto + (importe - suma));
    return arr;
  }
  if (metodo === 'custom') {
    const arr = [];
    document.querySelectorAll('.cf-custom-monto').forEach(inp => {
      const monto = parseFloat(inp.value) || 0;
      if (monto > 0) {
        arr.push({
          unidad_id: parseInt(inp.dataset.uid),
          factor: importe > 0 ? monto / importe : 0,
          monto: r2(monto)
        });
      }
    });
    return arr;
  }
  if (metodo === 'indiviso') {
    if (!unidades.length) return [];
    const totalPct = unidades.reduce((s, u) => s + (u.indiviso_pct || 0), 0);
    let arr;
    if (totalPct <= 0) {
      const n = unidades.length;
      const base = r2(importe / n);
      arr = unidades.map(u => ({ unidad_id: u.unidad_id, factor: 1 / n, monto: base }));
    } else {
      arr = unidades.map(u => {
        const factor = (u.indiviso_pct || 0) / totalPct;
        return { unidad_id: u.unidad_id, factor, monto: r2(importe * factor) };
      });
    }
    const suma = r2(arr.reduce((s, x) => s + x.monto, 0));
    if (arr.length) arr[arr.length - 1].monto = r2(arr[arr.length - 1].monto + (importe - suma));
    return arr;
  }
  return [];
}

// Reparte el monto restante del pago en partes iguales entre las casas
// que aún no tienen monto capturado (método personalizado).
export function cfRepartirResto() {
  const pago = pagoById(cfPagoAsignar);
  if (!pago) return;
  const inputs = [...document.querySelectorAll('.cf-custom-monto')];
  let asignado = 0;
  const vacias = [];
  inputs.forEach(inp => {
    const v = parseFloat(inp.value) || 0;
    if (v > 0) asignado += v;
    else vacias.push(inp);
  });
  if (!vacias.length) { notify('No hay casas vacías para repartir el resto', 'error'); return; }
  const resto = (pago.importe || 0) - asignado;
  if (resto <= 0) { notify('Ya no queda monto por repartir', 'error'); return; }
  const base = r2(resto / vacias.length);
  vacias.forEach((inp, i) => {
    inp.value = (i === vacias.length - 1) ? r2(resto - base * (vacias.length - 1)) : base;
  });
  cfPreviewReparto();
}

export function cfPreviewReparto() {
  // Contador de selección (método equitativo)
  const countEl = document.getElementById('cf-picker-count');
  if (countEl && metodoSeleccionado() === 'equitativo') {
    const total = document.querySelectorAll('.cf-unidad-check').length;
    const sel = document.querySelectorAll('.cf-unidad-check:checked').length;
    countEl.textContent = `${sel} de ${total} casa${total !== 1 ? 's' : ''} seleccionada${sel !== 1 ? 's' : ''}`;
  }
  const cont = document.getElementById('asignar-preview');
  if (!cont) return;
  const reparto = calcularReparto();
  const pago = pagoById(cfPagoAsignar);
  if (!reparto.length) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0;">Selecciona al menos una unidad.</div>';
    return;
  }
  const suma = r2(reparto.reduce((s, x) => s + x.monto, 0));
  const ok = Math.abs(suma - (pago.importe || 0)) < 0.01;
  cont.innerHTML = `
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 4px;">Vista previa del reparto</div>
    <div style="max-height:150px;overflow:auto;border:1px solid var(--border);border-radius:8px;">
      ${reparto.map(x => {
        const u = unidadById(x.unidad_id);
        return `<div style="display:flex;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--border);font-size:12px;">
          <span>${u ? u.nombre : '#' + x.unidad_id} <span style="color:var(--muted);">(${(x.factor * 100).toFixed(2)}%)</span></span>
          <span style="font-family:'DM Mono',monospace;">${fmt(x.monto)}</span>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:6px;font-weight:600;">
      <span>Total repartido</span>
      <span style="font-family:'DM Mono',monospace;color:${ok ? 'var(--green)' : 'var(--red)'};">${fmt(suma)}</span>
    </div>`;
}

export async function guardarAsignacionCosto() {
  const pago = pagoById(cfPagoAsignar);
  if (!pago) return;
  const reparto = calcularReparto();
  if (!reparto.length) { notify('Selecciona al menos una unidad', 'error'); return; }
  const metodo = metodoSeleccionado();

  // El método personalizado debe cuadrar exactamente con el importe del pago.
  if (metodo === 'custom') {
    const suma = r2(reparto.reduce((s, x) => s + x.monto, 0));
    if (Math.abs(suma - (pago.importe || 0)) > 0.01) {
      notify(`La suma asignada (${fmt(suma)}) debe ser igual al importe del pago (${fmt(pago.importe || 0)})`, 'error');
      return;
    }
  }

  const hoy = new Date().toISOString().slice(0, 10);

  // Quitar asignaciones previas de este pago (por si es reasignación)
  state.costoAsignaciones = state.costoAsignaciones.filter(a => String(a.pago_id) !== String(cfPagoAsignar));

  reparto.forEach(x => {
    state.costoAsignaciones.push({
      asignacion_id: state.nextAsignacionId++,
      pago_id: String(cfPagoAsignar),
      unidad_id: x.unidad_id,
      proyecto: cfProyecto,
      metodo,
      monto_asignado: x.monto,
      factor: x.factor,
      fecha_asignacion: hoy,
      partida_override: '',
    });
  });

  cerrar('modal-asignar-costo');
  await gsSaveCostoAsignaciones();
  notify('Costo asignado a ' + reparto.length + ' unidad(es)');
  renderPanel();
}

// ========== TAB: PRESUPUESTOS ==========
function renderPresupuestosTab(panel) {
  const unidades = unidadesDeProyecto();
  if (!unidades.length) {
    panel.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">📋</div><div>Crea unidades antes de capturar presupuestos.</div></div>';
    return;
  }
  if (!cfUnidadDetalle || !unidades.find(u => u.unidad_id === cfUnidadDetalle)) {
    cfUnidadDetalle = unidades[0].unidad_id;
  }

  panel.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
      <label style="font-size:12px;color:var(--muted);">Unidad:</label>
      <select id="cf-presup-unidad" class="filter-select">
        ${unidades.map(u => `<option value="${u.unidad_id}"${u.unidad_id === cfUnidadDetalle ? ' selected' : ''}>${u.nombre}</option>`).join('')}
      </select>
    </div>
    <div id="cf-presup-grid"></div>
  `;
  document.getElementById('cf-presup-unidad').addEventListener('change', e => {
    cfUnidadDetalle = parseInt(e.target.value);
    renderPresupuestoGrid();
  });
  renderPresupuestoGrid();
}

function renderPresupuestoGrid() {
  const cont = document.getElementById('cf-presup-grid');
  if (!cont) return;
  const rows = presupuestoRowsUnidad(cfUnidadDetalle);
  const conocidas = partidasConocidas();

  cont.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Partida</th>
          <th style="text-align:right">Presupuesto total</th>
          <th style="text-align:right">Costo inicial (saldo apertura)</th>
          <th></th>
        </tr></thead>
        <tbody id="cf-presup-tbody">
          ${rows.map((p, i) => presupuestoFilaHTML(p.partida, p.monto_presupuestado, p.costo_inicial, i)).join('')}
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap;">
      <input list="cf-partidas-list" id="cf-nueva-partida" placeholder="Nombre de partida" style="flex:1;min-width:160px;">
      <datalist id="cf-partidas-list">${conocidas.map(p => `<option value="${p}">`).join('')}</datalist>
      <button class="btn btn-ghost" onclick="cfAgregarPartidaPresup()">+ Agregar partida</button>
      <button class="btn btn-primary" onclick="guardarPresupuestoUnidad()">💾 Guardar presupuesto</button>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:8px;">
      El <strong>costo inicial</strong> es lo ya gastado en esa partida antes de usar el sistema (proyectos empezados). Para proyectos nuevos déjalo en 0.
    </div>
  `;
}

function presupuestoFilaHTML(partida, monto, costoIni, idx) {
  const safe = (partida || '').replace(/"/g, '&quot;');
  return `<tr data-fila="${idx}">
    <td><input type="text" class="cf-p-partida" value="${safe}" style="width:100%;"></td>
    <td><input type="number" step="0.01" class="cf-p-monto" value="${monto || ''}" placeholder="0.00" style="width:130px;text-align:right;font-family:'DM Mono',monospace;"></td>
    <td><input type="number" step="0.01" class="cf-p-inicial" value="${costoIni || ''}" placeholder="0.00" style="width:130px;text-align:right;font-family:'DM Mono',monospace;"></td>
    <td style="text-align:right;"><button class="btn btn-ghost btn-sm" onclick="this.closest('tr').remove()" style="color:var(--red);">✕</button></td>
  </tr>`;
}

export function cfAgregarPartidaPresup() {
  const inp = document.getElementById('cf-nueva-partida');
  const nombre = (inp.value || '').trim();
  if (!nombre) { notify('Escribe el nombre de la partida', 'error'); return; }
  const tbody = document.getElementById('cf-presup-tbody');
  tbody.insertAdjacentHTML('beforeend', presupuestoFilaHTML(nombre, 0, 0, tbody.children.length));
  inp.value = '';
}

export async function guardarPresupuestoUnidad() {
  const tbody = document.getElementById('cf-presup-tbody');
  if (!tbody) return;
  const nuevas = [];
  [...tbody.children].forEach(tr => {
    const partida = tr.querySelector('.cf-p-partida').value.trim();
    if (!partida) return;
    const monto = parseFloat(tr.querySelector('.cf-p-monto').value) || 0;
    const inicial = parseFloat(tr.querySelector('.cf-p-inicial').value) || 0;
    nuevas.push({ partida, monto, inicial });
  });
  // Reemplaza las filas de esta unidad
  state.presupuestoUnidad = state.presupuestoUnidad.filter(p => p.unidad_id !== cfUnidadDetalle);
  nuevas.forEach(n => {
    state.presupuestoUnidad.push({
      presupuesto_id: state.nextPresupuestoId++,
      unidad_id: cfUnidadDetalle,
      partida: n.partida,
      sub_partida: '',
      monto_presupuestado: n.monto,
      costo_inicial: n.inicial,
      notas: '',
    });
  });
  await gsSavePresupuestoUnidad();
  notify('Presupuesto guardado');
}

// ========== TAB: REPORTES ==========
function renderReportesTab(panel) {
  const unidades = unidadesDeProyecto();
  if (!unidades.length) {
    panel.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">📊</div><div>Sin unidades en ' + cfProyecto + '.</div></div>';
    return;
  }

  const filas = unidades.map(u => {
    const presu = presupuestoTotalUnidad(u.unidad_id);
    const real = costoRealUnidad(u.unidad_id);
    const av = avancePct(real, presu);
    return { u, presu, real, av, variacion: presu - real };
  });
  const totPresu = filas.reduce((s, f) => s + f.presu, 0);
  const totReal = filas.reduce((s, f) => s + f.real, 0);

  panel.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-label">Presupuesto total</div><div class="stat-value" style="color:var(--blue);">${fmt(totPresu)}</div><div class="stat-sub">${unidades.length} unidades</div></div>
      <div class="stat-card"><div class="stat-label">Costo real acumulado</div><div class="stat-value" style="color:var(--accent);">${fmt(totReal)}</div><div class="stat-sub">Inicial + asignaciones</div></div>
      <div class="stat-card"><div class="stat-label">Avance global</div><div class="stat-value" style="color:${avanceColor(avancePct(totReal, totPresu))};">${totPresu > 0 ? (totReal / totPresu * 100).toFixed(1) + '%' : '—'}</div><div class="stat-sub">${fmt(totPresu - totReal)} por ejercer</div></div>
    </div>

    <div class="table-wrap" style="margin-bottom:20px;">
      <table>
        <thead><tr>
          <th>Unidad</th>
          <th style="text-align:right">Presupuesto</th>
          <th style="text-align:right">Costo real</th>
          <th style="text-align:right">Variación</th>
          <th style="width:160px;">% Avance</th>
          <th></th>
        </tr></thead>
        <tbody>${filas.map(f => `
          <tr>
            <td style="font-weight:600;">${f.u.nombre}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(f.presu)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(f.real)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:${f.variacion < 0 ? 'var(--red)' : 'var(--green)'};">${fmt(f.variacion)}</td>
            <td>${barraAvance(f.av)}</td>
            <td style="text-align:right;"><button class="btn btn-ghost btn-sm" onclick="cfVerUnidad(${f.u.unidad_id})">Detalle</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    <div id="cf-detalle-unidad"></div>
  `;

  if (cfUnidadDetalle && unidades.find(u => u.unidad_id === cfUnidadDetalle)) {
    renderDetalleUnidad(cfUnidadDetalle);
  }
}

function avanceColor(pct) {
  if (pct === null) return 'var(--muted)';
  if (pct > 100) return 'var(--red)';
  if (pct >= 90) return 'var(--orange)';
  return 'var(--green)';
}

function barraAvance(pct) {
  if (pct === null) return '<span style="font-size:11px;color:var(--muted);">Sin presupuesto</span>';
  const w = Math.min(pct, 100);
  const color = avanceColor(pct);
  return `<div style="display:flex;align-items:center;gap:6px;">
    <div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${w}%;background:${color};"></div>
    </div>
    <span style="font-size:11px;font-family:'DM Mono',monospace;color:${color};min-width:42px;text-align:right;">${pct.toFixed(1)}%</span>
  </div>`;
}

export function cfVerUnidad(id) {
  cfUnidadDetalle = id;
  renderDetalleUnidad(id);
  const det = document.getElementById('cf-detalle-unidad');
  if (det) det.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderDetalleUnidad(id) {
  const cont = document.getElementById('cf-detalle-unidad');
  const u = unidadById(id);
  if (!cont || !u) return;

  const desg = desglosePorPartida(id);
  const partidas = Object.entries(desg).sort((a, b) => b[1].real - a[1].real);

  cont.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700;">${u.nombre} · desglose por partida</div>
        <div style="font-size:11px;color:var(--muted);">Indiviso ${(u.indiviso_pct || 0).toFixed(2)}%</div>
      </div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:18px;">
        <div>
          ${partidas.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Partida</th><th style="text-align:right">Presupuesto</th><th style="text-align:right">Real</th><th style="width:130px;">Avance</th></tr></thead>
              <tbody>${partidas.map(([p, v]) => `
                <tr>
                  <td style="font-size:12px;">${p}</td>
                  <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${fmt(v.presupuestado)}</td>
                  <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--accent);">${fmt(v.real)}${v.costoInicial > 0 ? `<div style="font-size:9px;color:var(--muted);">incl. ${fmt(v.costoInicial)} apertura</div>` : ''}</td>
                  <td>${barraAvance(avancePct(v.real, v.presupuestado))}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>` : '<div style="color:var(--muted);font-size:12px;">Sin partidas con presupuesto o costo.</div>'}
        </div>
        <div style="position:relative;height:240px;"><canvas id="cf-chart-unidad"></canvas></div>
      </div>
    </div>
  `;
  renderChartUnidad(partidas);
}

function renderChartUnidad(partidas) {
  const canvas = document.getElementById('cf-chart-unidad');
  if (!canvas) return;
  if (cfChartUnidad) { cfChartUnidad.destroy(); cfChartUnidad = null; }
  if (typeof Chart === 'undefined') return;
  const conCosto = partidas.filter(([, v]) => v.real > 0);
  if (!conCosto.length) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  cfChartUnidad = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: conCosto.map(e => e[0]),
      datasets: [{
        data: conCosto.map(e => e[1].real),
        backgroundColor: conCosto.map((_, i) => PALETA[i % PALETA.length]),
        borderColor: 'var(--bg)', borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#888', font: { size: 10 }, boxWidth: 10, padding: 6 } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.parsed)}` } }
      }
    }
  });
}

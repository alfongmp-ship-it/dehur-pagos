// ===== COSTOS FISCALES POR UNIDAD =====
// Capa nueva y aislada: asigna los pagos del historial a unidades (casas)
// para conocer el costo real por casa. No toca el flujo de pagos existente.

import { state, datosListos } from '../state.js';
import { fmt, fmtFecha } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { proyectoMatch } from '../config/proyectos.js';
import { ESTATUS_UNIDAD, METODO_LABEL } from '../config/costos-fiscales.js';
import { planoDeProyecto } from '../config/planos.js';
import { gsSaveUnidades, gsSavePresupuestoUnidad, gsSaveCostoAsignaciones, esPorFila, sbGuardarFila } from '../services/google-sync.js';

const PALETA = ['#c8a96e', '#5a9be0', '#4caf7d', '#e07a3a', '#9b7fe8', '#e05a5a', '#27ae60', '#3498db'];

let cfProyecto = '';        // proyecto activo
let cfTab = 'unidades';     // sub-pestaña: unidades | asignar | presupuestos | reportes
let cfUnidadDetalle = null; // unidad_id seleccionada en presupuestos/reportes
let cfPagoAsignar = null;   // pago_id en proceso de asignación
let cfFacturaAsignar = null; // factura_id en proceso de reparto (devengado)
let cfChartUnidad = null;
let cfPlanoModo = 'vista';      // 'vista' | 'editor'
let cfPlanoColor = 'avance';     // 'avance' | 'estatus'
let cfPlanoEditMode = 'pines';   // 'pines' | 'zonas'  — solo en modo editor

const ESTATUS_COLOR = {
  'En obra': '#e07a3a',
  'Terminada': '#5a9be0',
  'Entregada': '#4caf7d',
  'Vendida': '#9b7fe8',
};

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
function facturaById(id) { return state.facturas.find(f => String(f.factura_id) === String(id)); }

// El modal de reparto sirve a un PAGO (cfPagoAsignar) o a una FACTURA (cfFacturaAsignar,
// devengado sobre su monto_total). Estos helpers aíslan la diferencia.
function cfEsFactura() { return cfFacturaAsignar != null; }
function cfImporteObjetivo() {
  if (cfEsFactura()) { const f = facturaById(cfFacturaAsignar); return f ? (f.monto_total || 0) : 0; }
  const p = pagoById(cfPagoAsignar); return p ? (p.importe || 0) : 0;
}
function cfObjetivoValido() {
  return cfEsFactura() ? !!facturaById(cfFacturaAsignar) : !!pagoById(cfPagoAsignar);
}

function partidasConocidas() {
  // Fuente principal: catálogo activo. Se conservan partidas legacy de historial/
  // presupuestos para no perder valores antiguos en el autocomplete.
  const set = new Set();
  (state.partidasCatalogo || []).filter(p => p.activa !== false).forEach(p => set.add(p.partida));
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

// ===== Devengado vs Pagado-sin-factura =====
// Una asignación de FACTURA (factura_id lleno) = DEVENGADO (salvo factura Cancelada).
// Una asignación de PAGO (pago_id) = PAGADO. El reparto del pago SOLO se suprime (para no
// duplicar) cuando su costo YA lo aporta el devengado de la factura, es decir cuando esa
// factura está REPARTIDA (tiene asignaciones propias) y NO está cancelada. Un pago con
// factura_id cuya factura no está repartida (o está cancelada) SIGUE contando como
// 'pagado': de lo contrario su costo desaparecería del reporte aunque el reparto exista.
function _facturasRepartidasSet() {
  return new Set(state.costoAsignaciones.filter(a => a.factura_id).map(a => String(a.factura_id)));
}
function _facturasCanceladasSet() {
  return new Set((state.facturas || []).filter(f => f.estado_sat === 'Cancelada').map(f => String(f.factura_id)));
}
// Pagos cuyo costo ya cubre el devengado de su factura (repartida y no cancelada) → no se recuentan.
function _pagosCubiertosPorFacturaSet() {
  const repartidas = _facturasRepartidasSet();
  const canceladas = _facturasCanceladasSet();
  return new Set(state.historial
    .filter(h => h.factura_id && String(h.factura_id) !== ''
      && repartidas.has(String(h.factura_id)) && !canceladas.has(String(h.factura_id)))
    .map(h => String(h.id)));
}
// 'devengado' | 'pagado' | null (no cuenta: factura cancelada, o pago ya cubierto por su factura repartida)
function _tipoAsignacion(a, pagosCubiertos, factCanceladas) {
  if (a.factura_id) return factCanceladas.has(String(a.factura_id)) ? null : 'devengado';
  return pagosCubiertos.has(String(a.pago_id)) ? null : 'pagado';
}

// Devuelve { devengado, pagadoSinFactura, total } de una unidad.
function costoAsignadoDesglose(unidadId) {
  const pcf = _pagosCubiertosPorFacturaSet();
  const fc = _facturasCanceladasSet();
  let devengado = 0, pagadoSinFactura = 0;
  asignacionesDeUnidad(unidadId).forEach(a => {
    const t = _tipoAsignacion(a, pcf, fc);
    if (t === 'devengado') devengado += a.monto_asignado || 0;
    else if (t === 'pagado') pagadoSinFactura += a.monto_asignado || 0;
  });
  return { devengado, pagadoSinFactura, total: devengado + pagadoSinFactura };
}

function costoAsignadoUnidad(unidadId) {
  return costoAsignadoDesglose(unidadId).total;
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

// Devuelve { partida: {presupuestado, costoInicial, devengado, pagadoSinFactura, asignado, real} }
function desglosePorPartida(unidadId) {
  const out = {};
  const get = k => (out[k] = out[k] || { presupuestado: 0, costoInicial: 0, devengado: 0, pagadoSinFactura: 0, asignado: 0, real: 0 });
  presupuestoRowsUnidad(unidadId).forEach(p => {
    const k = p.partida || 'Sin partida';
    get(k).presupuestado += p.monto_presupuestado || 0;
    get(k).costoInicial += p.costo_inicial || 0;
  });
  const pcf = _pagosCubiertosPorFacturaSet();
  const fc = _facturasCanceladasSet();
  asignacionesDeUnidad(unidadId).forEach(a => {
    const t = _tipoAsignacion(a, pcf, fc);
    if (!t) return; // no cuenta (doble conteo evitado o factura cancelada)
    const row = get(partidaDeAsignacion(a));
    if (t === 'devengado') row.devengado += a.monto_asignado || 0;
    else row.pagadoSinFactura += a.monto_asignado || 0;
    row.asignado += a.monto_asignado || 0;
  });
  Object.values(out).forEach(v => { v.real = v.costoInicial + v.asignado; });
  return out;
}

// Un movimiento del historial cuenta como costo asignable a unidades.
// Se EXCLUYEN únicamente los Traspasos internos y los Préstamos entre
// proyectos (no son costo de construcción). Todo lo demás —Pagos,
// Aportaciones, Créditos— sí es costo asignable a una casa.
function esCostoAsignable(h) {
  if (h.tipo_registro === 'Traspaso' && h.tipo !== 'Aportación') return false;
  return true;
}

function pagosSinAsignar() {
  const asignados = new Set(state.costoAsignaciones.map(a => String(a.pago_id)));
  return state.historial.filter(h =>
    esCostoAsignable(h) && h.id &&
    proyectoMatch(h.proyecto, cfProyecto) &&
    !asignados.has(String(h.id))
  );
}

function pagosAsignados() {
  const asignados = new Set(state.costoAsignaciones.map(a => String(a.pago_id)));
  return state.historial.filter(h =>
    esCostoAsignable(h) && h.id &&
    proyectoMatch(h.proyecto, cfProyecto) &&
    asignados.has(String(h.id))
  );
}

function asignacionesHuerfanas() {
  const ids = historialIdSet();
  const factIds = new Set((state.facturas || []).map(f => String(f.factura_id)).filter(Boolean));
  // Una asignación de factura es huérfana solo si su factura ya no existe; una de
  // pago, solo si su pago ya no existe.
  return state.costoAsignaciones.filter(a =>
    a.factura_id ? !factIds.has(String(a.factura_id)) : !ids.has(String(a.pago_id))
  );
}

// ---------- render principal ----------
export function renderCostosFiscales() {
  const cont = document.getElementById('cf-contenido');
  const empty = document.getElementById('cf-empty');
  if (!cont) return;

  if (!datosListos()) {
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
    { id: 'asignados', label: '✅ Pagos Asignados' },
    { id: 'presupuestos', label: '📋 Presupuestos' },
    { id: 'reportes', label: '📊 Costo por Unidad' },
    { id: 'plano', label: '🗺️ Plano' },
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
  else if (cfTab === 'asignados') renderAsignadosTab(panel);
  else if (cfTab === 'presupuestos') renderPresupuestosTab(panel);
  else if (cfTab === 'reportes') renderReportesTab(panel);
  else if (cfTab === 'plano') renderPlanoTab(panel);
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
  // Fase 3: guarda solo esta unidad (add o edit) en modo 'fila'. Capturar el
  // item ANTES de cerrar el modal (no vaya a resetear state.editUnidadId).
  const porFila = esPorFila('unidades');
  const _u = state.editUnidadId ? unidadById(state.editUnidadId) : state.unidades[state.unidades.length - 1];
  cerrar('modal-unidad');
  await gsSaveUnidades({ porFila });
  if (porFila && _u) sbGuardarFila('unidades', _u);
  notify('Unidad guardada');
  renderCostosFiscales();
}

export async function toggleUnidad(id) {
  const u = unidadById(id);
  if (!u) return;
  u.activo = u.activo === false;
  const porFila = esPorFila('unidades');
  await gsSaveUnidades({ porFila });
  if (porFila) sbGuardarFila('unidades', u);
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

    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;">Pendientes de asignar</div>
      <input type="text" id="cf-pend-search" placeholder="🔍 Buscar beneficiario, concepto..." oninput="cfFiltrarPendientes()" style="width:280px;">
    </div>

    ${pendientes.length ? `
    <div id="cf-pend-count" style="font-size:11px;color:var(--muted);margin-bottom:6px;"></div>
    <div class="table-wrap cf-tabla-scroll" style="margin-bottom:24px;">
      <table>
        <thead><tr><th>Fecha</th><th>Beneficiario</th><th>Concepto</th><th>Partida</th><th style="text-align:right">Importe</th><th style="text-align:right">Acción</th></tr></thead>
        <tbody id="cf-pend-tbody">${pendientes.map(h => `
          <tr class="cf-pend-row" data-buscar="${`${h.nombre || ''} ${h.concepto || ''} ${h.partida || ''}`.toLowerCase().replace(/"/g, '')}">
            <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(h.fecha)}</td>
            <td style="font-weight:500;">${h.nombre || '—'}</td>
            <td style="color:var(--muted);font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.concepto || '—'}</td>
            <td style="color:var(--muted);font-size:12px;">${h.partida || 'Sin partida'}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(h.importe || 0)}</td>
            <td style="text-align:right;"><button class="btn btn-primary btn-sm" onclick="abrirAsignarCosto('${h.id}')">Asignar</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>` : '<div class="empty-state" style="margin-bottom:24px;"><div style="font-size:28px;opacity:.4;margin-bottom:8px;">✅</div><div>Todos los pagos de ' + cfProyecto + ' están asignados</div></div>'}
  `;
  cfFiltrarPendientes();
}

// Filtra la lista de pagos pendientes por beneficiario, concepto o partida.
export function cfFiltrarPendientes() {
  const search = document.getElementById('cf-pend-search');
  const tbody = document.getElementById('cf-pend-tbody');
  const countEl = document.getElementById('cf-pend-count');
  if (!tbody) return;
  const q = (search ? search.value : '').trim().toLowerCase();
  const rows = tbody.querySelectorAll('.cf-pend-row');
  let visibles = 0;
  rows.forEach(row => {
    const match = !q || (row.dataset.buscar || '').includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visibles++;
  });
  if (countEl) {
    countEl.textContent = q
      ? `Mostrando ${visibles} de ${rows.length} pagos pendientes`
      : `${rows.length} pagos pendientes`;
  }
}

// ========== TAB: PAGOS ASIGNADOS ==========
function renderAsignadosTab(panel) {
  const asignados = pagosAsignados();
  const huerfanas = asignacionesHuerfanas();
  const totalAsig = asignados.reduce((s, h) => s + (h.importe || 0), 0);

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="font-size:12px;color:var(--muted);">
        ${asignados.length} pago${asignados.length !== 1 ? 's' : ''} asignado${asignados.length !== 1 ? 's' : ''} · ${fmt(totalAsig)}
        ${huerfanas.length ? ` · <span style="color:var(--red);">${huerfanas.length} huérfana(s)</span> <a href="#" onclick="cfLimpiarHuerfanas();return false;" style="color:var(--accent);">Limpiar</a>` : ''}
      </div>
      <input type="text" id="cf-asig-search" placeholder="🔍 Buscar beneficiario, concepto..." oninput="cfFiltrarAsignados()" style="width:280px;">
    </div>
    ${asignados.length ? `
    <div id="cf-asig-count" style="font-size:11px;color:var(--muted);margin-bottom:6px;"></div>
    <div class="table-wrap cf-tabla-scroll">
      <table>
        <thead><tr><th>Fecha</th><th>Beneficiario</th><th style="text-align:right">Importe</th><th>Reparto</th><th style="text-align:right">Acción</th></tr></thead>
        <tbody id="cf-asig-tbody">${asignados.map(h => {
          const asigs = state.costoAsignaciones.filter(a => String(a.pago_id) === String(h.id));
          const detalle = asigs.map(a => {
            const u = unidadById(a.unidad_id);
            return `${u ? u.nombre : '#' + a.unidad_id}: ${fmt(a.monto_asignado)}`;
          }).join(' · ');
          const metodo = asigs[0] ? METODO_LABEL[asigs[0].metodo] || asigs[0].metodo : '';
          return `<tr class="cf-asig-row" data-buscar="${`${h.nombre || ''} ${h.concepto || ''}`.toLowerCase().replace(/"/g, '')}">
            <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(h.fecha)}</td>
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
    </div>` : '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">📭</div><div>Aún no hay pagos asignados en ' + cfProyecto + '</div></div>'}
  `;
  cfFiltrarAsignados();
}

// Filtra la lista de pagos asignados por beneficiario o concepto.
export function cfFiltrarAsignados() {
  const search = document.getElementById('cf-asig-search');
  const tbody = document.getElementById('cf-asig-tbody');
  const countEl = document.getElementById('cf-asig-count');
  if (!tbody) return;
  const q = (search ? search.value : '').trim().toLowerCase();
  const rows = tbody.querySelectorAll('.cf-asig-row');
  let visibles = 0;
  rows.forEach(row => {
    const match = !q || (row.dataset.buscar || '').includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visibles++;
  });
  if (countEl) {
    countEl.textContent = q
      ? `Mostrando ${visibles} de ${rows.length} pagos asignados`
      : `${rows.length} pagos asignados`;
  }
}

export async function cfLimpiarHuerfanas() {
  const huerfanas = asignacionesHuerfanas();
  if (!huerfanas.length) return;
  if (!confirm(`¿Eliminar ${huerfanas.length} asignación(es) huérfana(s)? Corresponden a pagos o facturas que ya no existen.`)) return;
  const ids = historialIdSet();
  const factIds = new Set((state.facturas || []).map(f => String(f.factura_id)).filter(Boolean));
  state.costoAsignaciones = state.costoAsignaciones.filter(a =>
    a.factura_id ? factIds.has(String(a.factura_id)) : ids.has(String(a.pago_id))
  );
  await gsSaveCostoAsignaciones();
  notify('Asignaciones huérfanas eliminadas');
  renderPanel();
}

export function abrirAsignarCosto(pagoId) {
  const pago = pagoById(pagoId);
  if (!pago) { notify('Pago no encontrado', 'error'); return; }
  if (!unidadesDeProyecto().length) { notify('Primero crea unidades en este proyecto', 'error'); return; }
  cfPagoAsignar = pagoId;
  cfFacturaAsignar = null;
  const tit = document.getElementById('asignar-titulo'); if (tit) tit.textContent = 'Asignar Costo a Unidades';

  document.getElementById('asignar-info').innerHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px;">
      <div style="font-weight:600;">${pago.nombre || '—'}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${fmtFecha(pago.fecha)} · ${pago.concepto || 'Sin concepto'} · ${pago.partida || 'Sin partida'}</div>
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

// Devengado (Fase B): reparte el costo de una FACTURA (sobre su monto_total) a las
// casas de su proyecto. Reusa el mismo modal que el reparto de pagos.
export function abrirRepartirFactura(facturaId) {
  const f = facturaById(facturaId);
  if (!f) { notify('Factura no encontrada', 'error'); return; }
  if (!f.proyecto) { notify('La factura no tiene proyecto; asígnale uno para repartir su costo', 'error'); return; }
  if (!(f.monto_total > 0)) { notify('La factura no tiene monto para repartir', 'error'); return; }
  cfProyecto = f.proyecto;                 // el reparto va a las unidades de ese proyecto
  if (!unidadesDeProyecto().length) { notify('El proyecto "' + f.proyecto + '" no tiene unidades', 'error'); return; }
  cfFacturaAsignar = facturaId;
  cfPagoAsignar = null;
  const tit = document.getElementById('asignar-titulo'); if (tit) tit.textContent = 'Repartir Factura (devengado)';

  const prov = f.nombre_proveedor || f.razon_social || ('ID ' + f.proveedor_id);
  const previa = state.costoAsignaciones.find(a => String(a.factura_id) === String(facturaId));
  document.getElementById('asignar-info').innerHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px;">
      <div style="font-weight:600;">🧾 Factura ${f.numero_factura || ''} · ${prov}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${f.proyecto} · devengado sobre el total de la factura</div>
      <div style="font-family:'DM Mono',monospace;font-size:18px;color:var(--accent);font-weight:700;margin-top:6px;">${fmt(f.monto_total || 0)}</div>
    </div>
    ${_repartoFacturaPartidaHTML(previa ? previa.partida_override : '')}`;

  const metPrevio = previa ? previa.metodo : 'directo';
  const radio = document.querySelector(`input[name="cf-metodo"][value="${metPrevio}"]`) || document.querySelector('input[name="cf-metodo"][value="directo"]');
  if (radio) radio.checked = true;
  renderMetodoBody();
  cfFacturaPartidaChange();                // arma la cascada de sub-partida
  if (previa && previa.sub_partida_override) {
    const sub = document.getElementById('rf-subpartida'); if (sub) sub.value = previa.sub_partida_override;
  }
  document.getElementById('modal-asignar-costo').classList.add('open');
}

// Selector de partida (+ sub-partida en cascada) para el reparto de factura.
function _repartoFacturaPartidaHTML(partidaSel) {
  const cats = (state.partidasCatalogo || []).filter(p => p.activa !== false);
  const opts = cats.map(p => `<option value="${p.partida}" ${p.partida === partidaSel ? 'selected' : ''}>${p.partida}</option>`).join('');
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
      <div><label style="font-size:12px;color:var(--muted);">Partida *</label>
        <select id="rf-partida" class="filter-select" style="width:100%;margin-top:4px;" onchange="cfFacturaPartidaChange()">
          <option value="">— Selecciona —</option>${opts}
        </select></div>
      <div id="rf-subpartida-wrap" style="display:none;"><label style="font-size:12px;color:var(--muted);">Sub-partida *</label>
        <select id="rf-subpartida" class="filter-select" style="width:100%;margin-top:4px;"></select></div>
    </div>`;
}

// Cascada: al elegir partida, puebla sub-partida si esa partida tiene sub-partidas.
export function cfFacturaPartidaChange() {
  const partSel = document.getElementById('rf-partida');
  const subWrap = document.getElementById('rf-subpartida-wrap');
  const subSel = document.getElementById('rf-subpartida');
  if (!partSel || !subSel) return;
  const cat = (state.partidasCatalogo || []).find(p => p.partida === partSel.value);
  const subs = (cat && Array.isArray(cat.subpartidas)) ? cat.subpartidas : [];
  if (subs.length) {
    subSel.innerHTML = '<option value="">— Selecciona —</option>' + subs.map(s => `<option>${s}</option>`).join('');
    if (subWrap) subWrap.style.display = '';
  } else {
    subSel.innerHTML = '';
    if (subWrap) subWrap.style.display = 'none';
  }
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
      <div class="cf-picker-count">Importe a repartir: <strong>${fmt(cfImporteObjetivo())}</strong></div>`;
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
  if (!cfObjetivoValido()) return [];
  const importe = cfImporteObjetivo();
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
  if (!cfObjetivoValido()) return;
  const inputs = [...document.querySelectorAll('.cf-custom-monto')];
  let asignado = 0;
  const vacias = [];
  inputs.forEach(inp => {
    const v = parseFloat(inp.value) || 0;
    if (v > 0) asignado += v;
    else vacias.push(inp);
  });
  if (!vacias.length) { notify('No hay casas vacías para repartir el resto', 'error'); return; }
  const resto = cfImporteObjetivo() - asignado;
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
  if (!reparto.length) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0;">Selecciona al menos una unidad.</div>';
    return;
  }
  const suma = r2(reparto.reduce((s, x) => s + x.monto, 0));
  const ok = Math.abs(suma - cfImporteObjetivo()) < 0.01;
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
  if (!cfObjetivoValido()) return;
  const esFact = cfEsFactura();
  const reparto = calcularReparto();
  if (!reparto.length) { notify('Selecciona al menos una unidad', 'error'); return; }
  const metodo = metodoSeleccionado();
  const importe = cfImporteObjetivo();

  // El método personalizado debe cuadrar exactamente con el importe a repartir.
  if (metodo === 'custom') {
    const suma = r2(reparto.reduce((s, x) => s + x.monto, 0));
    if (Math.abs(suma - importe) > 0.01) {
      notify(`La suma asignada (${fmt(suma)}) debe ser igual al importe a repartir (${fmt(importe)})`, 'error');
      return;
    }
  }

  // Reparto de FACTURA: exige partida (y sub-partida si la partida la tiene).
  let partidaOv = '', subPartidaOv = '';
  if (esFact) {
    partidaOv = (document.getElementById('rf-partida')?.value || '').trim();
    if (!partidaOv) { notify('Selecciona la partida de la factura', 'error'); return; }
    const subWrap = document.getElementById('rf-subpartida-wrap');
    if (subWrap && subWrap.style.display !== 'none') {
      subPartidaOv = (document.getElementById('rf-subpartida')?.value || '').trim();
      if (!subPartidaOv) { notify('Selecciona la sub-partida', 'error'); return; }
    }
  }

  const hoy = new Date().toISOString().slice(0, 10);
  // Quitar reparto previo del MISMO objetivo (reasignación), sin tocar el otro tipo.
  if (esFact) {
    state.costoAsignaciones = state.costoAsignaciones.filter(a => String(a.factura_id) !== String(cfFacturaAsignar));
  } else {
    state.costoAsignaciones = state.costoAsignaciones.filter(a => a.factura_id || String(a.pago_id) !== String(cfPagoAsignar));
  }

  reparto.forEach(x => {
    state.costoAsignaciones.push({
      asignacion_id: state.nextAsignacionId++,
      pago_id: esFact ? '' : String(cfPagoAsignar),
      factura_id: esFact ? String(cfFacturaAsignar) : '',
      unidad_id: x.unidad_id,
      proyecto: cfProyecto,
      metodo,
      monto_asignado: x.monto,
      factor: x.factor,
      fecha_asignacion: hoy,
      partida_override: partidaOv,
      sub_partida_override: subPartidaOv,
    });
  });

  cerrar('modal-asignar-costo');
  await gsSaveCostoAsignaciones();
  notify((esFact ? 'Factura repartida a ' : 'Costo asignado a ') + reparto.length + ' unidad(es)');
  if (esFact && window.renderFacturas) window.renderFacturas();
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
    <div style="background:rgba(90,155,224,.07);border:1px solid rgba(90,155,224,.2);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <div style="font-size:12px;color:var(--muted);">Captura masiva (${cfProyecto}):</div>
      <button class="btn btn-ghost btn-sm" onclick="descargarPlantillaPresupuesto('${(cfProyecto || '').replace(/'/g, "\\'")}')">📥 Descargar plantilla</button>
      <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
        📤 Subir plantilla
        <input type="file" accept=".xlsx,.xls" style="display:none;" onchange="handleSubirPlantillaPresupuesto(event)">
      </label>
      <div style="font-size:11px;color:var(--muted);flex:1;min-width:0;">Excel con 2 hojas (Presupuesto / Costo Inicial). Merge no destructivo.</div>
    </div>
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
    const ini = costoInicialUnidad(u.unidad_id);
    const des = costoAsignadoDesglose(u.unidad_id);
    const real = ini + des.total;
    const av = avancePct(real, presu);
    return { u, presu, real, devengado: des.devengado, pagado: des.pagadoSinFactura, av, variacion: presu - real };
  });
  const totPresu = filas.reduce((s, f) => s + f.presu, 0);
  const totReal = filas.reduce((s, f) => s + f.real, 0);
  const totDev = filas.reduce((s, f) => s + f.devengado, 0);
  const totPag = filas.reduce((s, f) => s + f.pagado, 0);

  panel.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-label">Presupuesto total</div><div class="stat-value" style="color:var(--blue);">${fmt(totPresu)}</div><div class="stat-sub">${unidades.length} unidades</div></div>
      <div class="stat-card"><div class="stat-label">Devengado (facturas)</div><div class="stat-value" style="color:var(--accent);">${fmt(totDev)}</div><div class="stat-sub">Costo facturado</div></div>
      <div class="stat-card"><div class="stat-label">Pagado sin factura</div><div class="stat-value" style="color:var(--green);">${fmt(totPag)}</div><div class="stat-sub">Pagos sin CFDI</div></div>
      <div class="stat-card"><div class="stat-label">Costo real</div><div class="stat-value" style="color:var(--accent);">${fmt(totReal)}</div><div class="stat-sub">${totPresu > 0 ? 'Avance ' + (totReal / totPresu * 100).toFixed(1) + '%' : 'Inicial + asignaciones'}</div></div>
    </div>

    <div class="table-wrap" style="margin-bottom:20px;">
      <table>
        <thead><tr>
          <th>Unidad</th>
          <th style="text-align:right">Presupuesto</th>
          <th style="text-align:right">Devengado</th>
          <th style="text-align:right">Pagado s/fact</th>
          <th style="text-align:right">Costo real</th>
          <th style="text-align:right">Variación</th>
          <th style="width:140px;">% Avance</th>
          <th></th>
        </tr></thead>
        <tbody>${filas.map(f => `
          <tr>
            <td style="font-weight:600;">${f.u.nombre}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(f.presu)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(f.devengado)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--green);">${fmt(f.pagado)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:600;">${fmt(f.real)}</td>
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

// ========== TAB: PLANO VISUAL ==========
let cfFormaArrastrada = false; // evita colocar pin tras soltar un arrastre

function colorDePin(u) {
  if (cfPlanoColor === 'estatus') return ESTATUS_COLOR[u.estatus] || '#888';
  const real = costoRealUnidad(u.unidad_id);
  const presu = presupuestoTotalUnidad(u.unidad_id);
  const pct = avancePct(real, presu);
  if (pct === null) return '#7a7570';
  if (pct > 100) return '#e05a5a';
  if (pct >= 90) return '#e07a3a';
  return '#4caf7d';
}

function renderPlanoTab(panel) {
  const plano = planoDeProyecto(cfProyecto);
  if (!plano) {
    panel.innerHTML = `<div class="empty-state">
      <div style="font-size:32px;margin-bottom:10px;opacity:.4">🗺️</div>
      <div>Aún no hay un plano cargado para <strong>${cfProyecto}</strong>.</div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px;">Envía la imagen del plano del desarrollo para activar esta vista.</div>
    </div>`;
    return;
  }
  const unidades = unidadesDeProyecto();
  const sinUbicar = unidades.filter(u => u.plano_x == null || u.plano_y == null);
  const sinZona = unidades.filter(u => !(u.plano_w > 0 && u.plano_h > 0));
  const editor = cfPlanoModo === 'editor';
  const editPines = editor && cfPlanoEditMode === 'pines';
  const editZonas = editor && cfPlanoEditMode === 'zonas';

  let indicador = '';
  let hint = '';
  if (editPines) {
    indicador = sinUbicar.length
      ? `Faltan <strong>${sinUbicar.length}</strong> · Siguiente: <strong>${sinUbicar[0].nombre}</strong> — haz clic en el plano para ubicarla`
      : 'Todas las casas tienen pin ✓';
    hint = 'Clic sobre el plano para colocar el siguiente pin · arrastra un pin para moverlo · ✕ lo quita · no olvides Guardar.';
  } else if (editZonas) {
    indicador = sinZona.length
      ? `<strong>${sinZona.length}</strong> sin zona · Siguiente: <strong>${sinZona[0].nombre}</strong> — clic-arrastra sobre el plano para dibujarla`
      : 'Todas las casas tienen zona ✓';
    hint = 'Clic-arrastra sobre el plano para dibujar una zona · clic en un pin lo convierte en zona · arrastra una zona para moverla, sus esquinas para redimensionarla, ✕ para quitarla.';
  }

  panel.innerHTML = `
    <div class="cf-plano-toolbar">
      <div class="cf-plano-modos">
        <button class="cf-plano-btn${!editor ? ' active' : ''}" data-modo="vista">👁 Vista</button>
        <button class="cf-plano-btn${editor ? ' active' : ''}" data-modo="editor">✏️ Editar</button>
      </div>
      ${editor ? `
        <div class="cf-plano-modos">
          <span style="font-size:11px;color:var(--muted);">Edit:</span>
          <button class="cf-plano-btn${editPines ? ' active' : ''}" data-editmode="pines">📍 Pines</button>
          <button class="cf-plano-btn${editZonas ? ' active' : ''}" data-editmode="zonas">▭ Zonas</button>
        </div>
        <div class="cf-plano-editor-info">${indicador}</div>
        <button class="btn btn-primary btn-sm" id="cf-plano-guardar">💾 Guardar</button>
      ` : `
        <div class="cf-plano-color">
          <span style="font-size:11px;color:var(--muted);">Color:</span>
          <button class="cf-plano-btn${cfPlanoColor === 'avance' ? ' active' : ''}" data-color="avance">% Avance</button>
          <button class="cf-plano-btn${cfPlanoColor === 'estatus' ? ' active' : ''}" data-color="estatus">Estatus</button>
        </div>
        <div id="cf-plano-leyenda" class="cf-plano-leyenda"></div>
      `}
    </div>
    ${!editor && sinUbicar.length ? `<div style="font-size:11px;color:var(--orange);margin-bottom:8px;">⚠ ${sinUbicar.length} casa(s) sin ubicar en el plano (usa "Editar").</div>` : ''}
    <div class="cf-plano-cont${editor ? ' editor' : ''}${editZonas ? ' zonas' : ''}" id="cf-plano-cont">
      <img src="${plano.img}" class="cf-plano-img" alt="Plano ${cfProyecto}" draggable="false">
      <div id="cf-plano-pins"></div>
      <div id="cf-plano-fantasma" class="cf-zona-fantasma" style="display:none;"></div>
      <div id="cf-plano-tooltip" class="cf-plano-tooltip" style="display:none;"></div>
    </div>
    ${editor
      ? `<div style="font-size:11px;color:var(--muted);margin-top:8px;">${hint}</div>`
      : '<div id="cf-detalle-unidad" style="margin-top:16px;"></div>'}
  `;
  renderPlanoFormas();
  setupPlanoInteraction();
}

// Renderiza pines y zonas. Una casa con plano_w/plano_h se dibuja como rectángulo;
// si solo tiene plano_x/plano_y se dibuja como pin (compatibilidad).
function renderPlanoFormas() {
  const cont = document.getElementById('cf-plano-pins');
  if (!cont) return;
  const editor = cfPlanoModo === 'editor';
  const editZonas = editor && cfPlanoEditMode === 'zonas';
  const editPines = editor && cfPlanoEditMode === 'pines';
  cont.innerHTML = unidadesDeProyecto()
    .filter(u => u.plano_x != null && u.plano_y != null)
    .map(u => {
      const color = colorDePin(u);
      const nombre = (u.nombre || '').replace(/"/g, '');
      // Zona (rectángulo)
      if (u.plano_w != null && u.plano_h != null && u.plano_w > 0 && u.plano_h > 0) {
        const left = u.plano_x - u.plano_w / 2;
        const top = u.plano_y - u.plano_h / 2;
        return `<div class="cf-zona${editZonas ? ' editable' : ''}" data-uid="${u.unidad_id}"
          style="left:${left}%;top:${top}%;width:${u.plano_w}%;height:${u.plano_h}%;border-color:${color};background:${color}33;"
          title="${nombre}">
          ${editZonas ? `
            <span class="cf-zona-label">${nombre}</span>
            <span class="cf-zona-handle nw" data-corner="nw"></span>
            <span class="cf-zona-handle ne" data-corner="ne"></span>
            <span class="cf-zona-handle sw" data-corner="sw"></span>
            <span class="cf-zona-handle se" data-corner="se"></span>
          ` : ''}
        </div>`;
      }
      // Pin (fallback)
      const pinTitle = editZonas ? 'Clic para convertir a zona' : nombre;
      return `<div class="cf-pin${editPines ? ' editable' : ''}${editZonas ? ' convertir' : ''}" data-uid="${u.unidad_id}"
        style="left:${u.plano_x}%;top:${u.plano_y}%;background:${color};" title="${pinTitle}"></div>`;
    }).join('');
}

function setupPlanoInteraction() {
  document.querySelectorAll('.cf-plano-btn[data-modo]').forEach(b => {
    b.addEventListener('click', () => { cfPlanoModo = b.dataset.modo; renderPanel(); });
  });
  document.querySelectorAll('.cf-plano-btn[data-editmode]').forEach(b => {
    b.addEventListener('click', () => { cfPlanoEditMode = b.dataset.editmode; renderPanel(); });
  });
  document.querySelectorAll('.cf-plano-btn[data-color]').forEach(b => {
    b.addEventListener('click', () => { cfPlanoColor = b.dataset.color; renderPanel(); });
  });
  const guardar = document.getElementById('cf-plano-guardar');
  if (guardar) guardar.addEventListener('click', cfGuardarPlano);

  const cont = document.getElementById('cf-plano-cont');
  if (!cont) return;

  // Hover/tooltip y click (detalle) — funcionan tanto en vista como en editor
  // (sin estorbar a drag/click-de-edición porque mouseenter/leave son neutros).
  cont.querySelectorAll('.cf-pin, .cf-zona').forEach(el => {
    const uid = parseInt(el.dataset.uid);
    el.addEventListener('mouseenter', () => mostrarTooltipPin(uid, el));
    el.addEventListener('mouseleave', ocultarTooltipPin);
  });

  if (cfPlanoModo === 'editor') {
    if (cfPlanoEditMode === 'pines') {
      // Colocar pin con clic sobre el plano vacío
      cont.addEventListener('click', e => {
        if (cfFormaArrastrada) { cfFormaArrastrada = false; return; }
        if (e.target.closest('.cf-pin') || e.target.closest('.cf-zona')) return;
        const sinUbicar = unidadesDeProyecto().filter(u => u.plano_x == null || u.plano_y == null);
        if (!sinUbicar.length) { notify('Todas las casas ya están ubicadas', 'error'); return; }
        const rect = cont.getBoundingClientRect();
        const u = sinUbicar[0];
        u.plano_x = r2(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
        u.plano_y = r2(Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)));
        renderPanel();
      });
      cont.querySelectorAll('.cf-pin').forEach(pin => {
        const uid = parseInt(pin.dataset.uid);
        pin.addEventListener('mousedown', e => {
          e.preventDefault();
          iniciarDragPin(uid, pin, cont);
        });
        pin.addEventListener('click', e => {
          if (cfFormaArrastrada) { cfFormaArrastrada = false; return; }
          e.stopPropagation();
          abrirPopupForma(uid, pin);
        });
      });
    } else if (cfPlanoEditMode === 'zonas') {
      // Clic en pin = convertir a zona
      cont.querySelectorAll('.cf-pin.convertir').forEach(pin => {
        const uid = parseInt(pin.dataset.uid);
        pin.addEventListener('click', e => {
          e.stopPropagation();
          cfConvertirPinAZona(uid);
        });
      });
      // Zonas: drag para mover, handles para redimensionar, clic para popup
      cont.querySelectorAll('.cf-zona').forEach(zona => {
        const uid = parseInt(zona.dataset.uid);
        zona.querySelectorAll('.cf-zona-handle').forEach(h => {
          h.addEventListener('mousedown', e => {
            e.stopPropagation();
            e.preventDefault();
            iniciarResizeZona(uid, h.dataset.corner, cont);
          });
        });
        zona.addEventListener('mousedown', e => {
          if (e.target.classList.contains('cf-zona-handle')) return;
          e.preventDefault();
          iniciarMoverZona(uid, zona, cont, e);
        });
        zona.addEventListener('click', e => {
          if (cfFormaArrastrada) { cfFormaArrastrada = false; return; }
          if (e.target.classList.contains('cf-zona-handle')) return;
          e.stopPropagation();
          abrirPopupForma(uid, zona);
        });
      });
      // Drag-to-draw sobre el plano vacío → siguiente casa sin zona
      cont.addEventListener('mousedown', e => {
        if (e.target.closest('.cf-zona') || e.target.closest('.cf-pin')) return;
        e.preventDefault();
        iniciarDibujoZona(cont, e);
      });
    }
  } else {
    // Vista: clic abre desglose
    cont.querySelectorAll('.cf-pin, .cf-zona').forEach(el => {
      const uid = parseInt(el.dataset.uid);
      el.addEventListener('click', () => {
        cfUnidadDetalle = uid;
        renderDetalleUnidad(uid);
        const d = document.getElementById('cf-detalle-unidad');
        if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
    renderLeyendaPlano();
  }
}

function iniciarDragPin(uid, pin, cont) {
  const u = unidadById(uid);
  if (!u) return;
  const rect = cont.getBoundingClientRect();
  let movido = false;
  function mover(ev) {
    movido = true;
    const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
    pin.style.left = x + '%';
    pin.style.top = y + '%';
    u.plano_x = r2(x);
    u.plano_y = r2(y);
  }
  function soltar() {
    document.removeEventListener('mousemove', mover);
    document.removeEventListener('mouseup', soltar);
    if (movido) cfFormaArrastrada = true;
  }
  document.addEventListener('mousemove', mover);
  document.addEventListener('mouseup', soltar);
}

// Dibuja una nueva zona con drag-to-draw sobre el plano y la asigna a la
// siguiente casa sin zona. Muestra un rectángulo "fantasma" durante el arrastre.
function iniciarDibujoZona(cont, eDown) {
  const sinZona = unidadesDeProyecto().filter(u => !(u.plano_w > 0 && u.plano_h > 0));
  if (!sinZona.length) { notify('Todas las casas ya tienen zona', 'error'); return; }
  const u = sinZona[0];
  const fantasma = document.getElementById('cf-plano-fantasma');
  const rect = cont.getBoundingClientRect();
  const startX = ((eDown.clientX - rect.left) / rect.width) * 100;
  const startY = ((eDown.clientY - rect.top) / rect.height) * 100;
  let curX = startX, curY = startY;
  function pintarFantasma() {
    const left = Math.max(0, Math.min(startX, curX));
    const top = Math.max(0, Math.min(startY, curY));
    const w = Math.min(100 - left, Math.abs(curX - startX));
    const h = Math.min(100 - top, Math.abs(curY - startY));
    if (!fantasma) return;
    fantasma.style.left = left + '%';
    fantasma.style.top = top + '%';
    fantasma.style.width = w + '%';
    fantasma.style.height = h + '%';
    fantasma.style.display = '';
  }
  function mover(ev) {
    curX = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    curY = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
    pintarFantasma();
  }
  function soltar() {
    document.removeEventListener('mousemove', mover);
    document.removeEventListener('mouseup', soltar);
    if (fantasma) fantasma.style.display = 'none';
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    // descartar rectángulos demasiado pequeños (probable clic accidental)
    if (w < 0.5 || h < 0.5) return;
    u.plano_x = r2((startX + curX) / 2);
    u.plano_y = r2((startY + curY) / 2);
    u.plano_w = r2(w);
    u.plano_h = r2(h);
    renderPanel();
  }
  pintarFantasma();
  document.addEventListener('mousemove', mover);
  document.addEventListener('mouseup', soltar);
}

// Mueve una zona existente arrastrando su interior. Mantiene w/h, ajusta x/y.
function iniciarMoverZona(uid, zonaEl, cont, eDown) {
  const u = unidadById(uid);
  if (!u) return;
  const rect = cont.getBoundingClientRect();
  const offsetX = ((eDown.clientX - rect.left) / rect.width) * 100 - u.plano_x;
  const offsetY = ((eDown.clientY - rect.top) / rect.height) * 100 - u.plano_y;
  const halfW = u.plano_w / 2;
  const halfH = u.plano_h / 2;
  let movido = false;
  function mover(ev) {
    movido = true;
    const mx = ((ev.clientX - rect.left) / rect.width) * 100 - offsetX;
    const my = ((ev.clientY - rect.top) / rect.height) * 100 - offsetY;
    const x = Math.max(halfW, Math.min(100 - halfW, mx));
    const y = Math.max(halfH, Math.min(100 - halfH, my));
    u.plano_x = r2(x);
    u.plano_y = r2(y);
    zonaEl.style.left = (x - halfW) + '%';
    zonaEl.style.top = (y - halfH) + '%';
  }
  function soltar() {
    document.removeEventListener('mousemove', mover);
    document.removeEventListener('mouseup', soltar);
    if (movido) cfFormaArrastrada = true;
  }
  document.addEventListener('mousemove', mover);
  document.addEventListener('mouseup', soltar);
}

// Redimensiona una zona arrastrando una esquina; la esquina opuesta queda fija.
function iniciarResizeZona(uid, corner, cont) {
  const u = unidadById(uid);
  if (!u) return;
  const rect = cont.getBoundingClientRect();
  // Coordenadas iniciales de la esquina FIJA (la opuesta a la que se arrastra)
  const halfW = u.plano_w / 2;
  const halfH = u.plano_h / 2;
  let fixX, fixY;
  if (corner === 'nw') { fixX = u.plano_x + halfW; fixY = u.plano_y + halfH; }
  else if (corner === 'ne') { fixX = u.plano_x - halfW; fixY = u.plano_y + halfH; }
  else if (corner === 'sw') { fixX = u.plano_x + halfW; fixY = u.plano_y - halfH; }
  else { fixX = u.plano_x - halfW; fixY = u.plano_y - halfH; } // 'se'

  let movido = false;
  function mover(ev) {
    movido = true;
    const cx = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    const cy = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
    const w = Math.max(0.5, Math.abs(cx - fixX));
    const h = Math.max(0.5, Math.abs(cy - fixY));
    u.plano_x = r2((fixX + cx) / 2);
    u.plano_y = r2((fixY + cy) / 2);
    u.plano_w = r2(w);
    u.plano_h = r2(h);
    // re-render solo de las formas (más fluido sin re-render del panel)
    renderPlanoFormas();
    // re-conectar handles a su zona (necesario porque innerHTML los reemplaza)
    setupPlanoInteraction();
  }
  function soltar() {
    document.removeEventListener('mousemove', mover);
    document.removeEventListener('mouseup', soltar);
    if (movido) cfFormaArrastrada = true;
  }
  document.addEventListener('mousemove', mover);
  document.addEventListener('mouseup', soltar);
}

// Quita la zona de una unidad por completo: limpia tamaño Y posición, así la
// casa queda "sin ubicar" en el plano (sin pin colgado).
function cfQuitarZona(uid) {
  const u = unidadById(uid);
  if (!u) return;
  u.plano_x = null;
  u.plano_y = null;
  u.plano_w = null;
  u.plano_h = null;
  renderPanel();
}

// Convierte el pin de una unidad en una zona default (4% × 3%) centrada en el pin.
function cfConvertirPinAZona(uid) {
  const u = unidadById(uid);
  if (!u || u.plano_x == null || u.plano_y == null) return;
  u.plano_w = 4;
  u.plano_h = 3;
  // asegurar que la zona quepa dentro del plano
  if (u.plano_x - u.plano_w / 2 < 0) u.plano_x = u.plano_w / 2;
  if (u.plano_x + u.plano_w / 2 > 100) u.plano_x = 100 - u.plano_w / 2;
  if (u.plano_y - u.plano_h / 2 < 0) u.plano_y = u.plano_h / 2;
  if (u.plano_y + u.plano_h / 2 > 100) u.plano_y = 100 - u.plano_h / 2;
  renderPanel();
}

// Popup contextual al hacer clic sobre un pin o una zona en modo editor.
// Reemplaza visualmente al ✕ colgante. Anclado al elemento clickeado.
function popupOutsideClick(e) {
  const popup = document.getElementById('cf-plano-popup');
  if (popup && !popup.contains(e.target)) cerrarPopupForma();
}
function popupEscHandler(e) {
  if (e.key === 'Escape') cerrarPopupForma();
}

function cerrarPopupForma() {
  const popup = document.getElementById('cf-plano-popup');
  if (popup) popup.remove();
  document.removeEventListener('mousedown', popupOutsideClick);
  document.removeEventListener('keydown', popupEscHandler);
}

function abrirPopupForma(uid, refEl) {
  const u = unidadById(uid);
  if (!u) return;
  cerrarPopupForma();

  const esZona = u.plano_w > 0 && u.plano_h > 0;
  const nombre = (u.nombre || '—').replace(/</g, '&lt;');
  const tipo = (u.tipo || '').replace(/</g, '&lt;');
  const estatus = (u.estatus || '—').replace(/</g, '&lt;');

  const popup = document.createElement('div');
  popup.id = 'cf-plano-popup';
  popup.className = 'cf-plano-popup';
  popup.innerHTML = `
    <div class="cf-popup-header">
      <span class="cf-popup-dot" style="background:${colorDePin(u)};"></span>
      <span class="cf-popup-nombre">${nombre}</span>
      <button class="cf-popup-close" type="button" title="Cerrar">✕</button>
    </div>
    <div class="cf-popup-datos">
      ${tipo ? `<div><span>Tipo:</span> ${tipo}</div>` : ''}
      <div><span>Estatus:</span> ${estatus}</div>
      <div><span>Indiviso:</span> ${(u.indiviso_pct || 0).toFixed(2)}%</div>
      ${u.superficie_m2 ? `<div><span>Superficie:</span> ${u.superficie_m2} m²</div>` : ''}
    </div>
    <div class="cf-popup-acciones">
      <button class="btn btn-ghost btn-sm" type="button" data-action="editar">✏️ Editar</button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="quitar" style="color:var(--red);">🗑️ Quitar del plano</button>
    </div>`;
  document.body.appendChild(popup);

  // Anclar al lado derecho del elemento; si se sale, voltear al lado izquierdo.
  const r = refEl.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.left = (r.right + 8) + 'px';
  popup.style.top = r.top + 'px';
  // Clamp dentro del viewport tras medir
  setTimeout(() => {
    const pr = popup.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) {
      popup.style.left = Math.max(8, r.left - pr.width - 8) + 'px';
    }
    if (pr.bottom > window.innerHeight - 8) {
      popup.style.top = (window.innerHeight - pr.height - 8) + 'px';
    }
    if (parseFloat(popup.style.top) < 8) popup.style.top = '8px';
  }, 0);

  popup.querySelector('.cf-popup-close').addEventListener('click', cerrarPopupForma);
  popup.querySelector('[data-action="editar"]').addEventListener('click', () => {
    cerrarPopupForma();
    editarUnidad(uid);
  });
  popup.querySelector('[data-action="quitar"]').addEventListener('click', () => {
    cerrarPopupForma();
    if (esZona) cfQuitarZona(uid);
    else cfQuitarPin(uid);
  });

  // Cerrar al hacer clic fuera o con ESC (en el próximo tick para no atrapar el clic actual)
  setTimeout(() => {
    document.addEventListener('mousedown', popupOutsideClick);
    document.addEventListener('keydown', popupEscHandler);
  }, 0);
}

function mostrarTooltipPin(uid, pin) {
  const u = unidadById(uid);
  const tip = document.getElementById('cf-plano-tooltip');
  const cont = document.getElementById('cf-plano-cont');
  if (!u || !tip || !cont) return;
  const real = costoRealUnidad(u.unidad_id);
  const presu = presupuestoTotalUnidad(u.unidad_id);
  const av = avancePct(real, presu);
  tip.innerHTML = `<strong>${u.nombre}</strong><br>`
    + `Costo real: ${fmt(real)}<br>`
    + (presu > 0 ? `Presupuesto: ${fmt(presu)}<br>Avance: ${av.toFixed(1)}%<br>` : 'Sin presupuesto<br>')
    + `Estatus: ${u.estatus || '—'}`;
  const pinRect = pin.getBoundingClientRect();
  const contRect = cont.getBoundingClientRect();
  tip.style.left = (pinRect.left - contRect.left + pinRect.width / 2) + 'px';
  tip.style.top = (pinRect.top - contRect.top - 8) + 'px';
  tip.style.display = '';
}

function ocultarTooltipPin() {
  const tip = document.getElementById('cf-plano-tooltip');
  if (tip) tip.style.display = 'none';
}

function renderLeyendaPlano() {
  const el = document.getElementById('cf-plano-leyenda');
  if (!el) return;
  const items = cfPlanoColor === 'estatus'
    ? ESTATUS_UNIDAD.map(e => [e, ESTATUS_COLOR[e] || '#888'])
    : [['En presupuesto', '#4caf7d'], ['Cerca del límite', '#e07a3a'], ['Sobre presupuesto', '#e05a5a'], ['Sin presupuesto', 'var(--muted)']];
  el.innerHTML = items.map(([t, c]) =>
    `<span class="cf-ley-item"><span class="cf-ley-dot" style="background:${c};"></span>${t}</span>`).join('');
}

function cfQuitarPin(uid) {
  const u = unidadById(uid);
  if (!u) return;
  u.plano_x = null;
  u.plano_y = null;
  renderPanel();
}

async function cfGuardarPlano() {
  await gsSaveUnidades();
  notify('Plano guardado');
}

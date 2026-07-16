// ============================================================================
// estrategia.js — MÓDULO ESTRATEGIA (Fase 2: tablero de score, SOLO LECTURA)
// ============================================================================
// Regla arquitectónica: NINGÚN supuesto del modelo vive fijo en el código —
// todos son claves de `estrategia_config` (editable en la pestaña Configuración,
// solo admin). CFG_DEFAULTS es el espejo de los seeds del SQL 30: cfg() lo usa
// si falta una fila y "Restaurar default" escribe ese valor.
//
// Estrategia escribe SOLO en estrategia_config / estrategia_flags_unidad; todo
// lo demás (unidades, ventas, cobros, créditos, historial, saldos) se LEE del
// state. Si este módulo truena, Pagos e Ingresos no se ven afectados (renders
// envueltos en try/catch).
//
// Etapa 2: Configuración funcional + placeholders de Tablero y Bloqueos.
// ============================================================================

import { state, esAdmin, puedeEditar, nuevoFlagId } from '../state.js';
import { esPorFila, sbGuardarFila, sbBorrarFila, gsSaveEstrategiaConfig, gsSaveEstrategiaFlags } from '../services/google-sync.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { escapeHtml } from '../ui/format.js';
import { getPartidasParaSelect } from '../config/sub-partidas.js';

// ---- Defaults de código (espejo 1:1 de los seeds del SQL 30) -----------------
export const CFG_DEFAULTS = {
  // VENTAS: probabilidad de cobro por situación comercial
  'prob_cobro.escriturada': { valor: 0.99, grupo: 'ventas', descripcion: 'Probabilidad de cobrar una unidad escriturada por cobrar' },
  'prob_cobro.vendida':     { valor: 0.95, grupo: 'ventas', descripcion: 'Probabilidad de cobrar una venta con crédito autorizado' },
  'prob_cobro.apartada':    { valor: 0.65, grupo: 'ventas', descripcion: 'Probabilidad de cobrar una apartada con crédito en trámite' },
  'prob_cobro.disponible':  { valor: 0.35, grupo: 'ventas', descripcion: 'Probabilidad de vender y cobrar una unidad sin cliente dentro del horizonte' },
  'prob_cobro.adeudo':      { valor: 0.90, grupo: 'ventas', descripcion: 'Probabilidad de cobrar adeudos de clientes en plan de pagos al escriturar' },
  // VENTAS: meses de trámite tras terminar la obra
  'lag_cobro.escriturada':  { valor: 0.5, grupo: 'ventas', descripcion: 'Meses de trámite de cobro tras terminar obra (escriturada)' },
  'lag_cobro.vendida':      { valor: 1.5, grupo: 'ventas', descripcion: 'Meses de trámite de cobro tras terminar obra (vendida)' },
  'lag_cobro.apartada':     { valor: 3,   grupo: 'ventas', descripcion: 'Meses de trámite de cobro tras terminar obra (apartada)' },
  'lag_cobro.disponible':   { valor: 6,   grupo: 'ventas', descripcion: 'Meses estimados para vender y cobrar una unidad sin cliente' },
  // VENTAS: ajuste al lag por tipo de crédito
  'lag_ajuste_credito.contado':      { valor: -0.5, grupo: 'ventas', descripcion: 'Ajuste de meses al cobro si la venta es de contado' },
  'lag_ajuste_credito.infonavit':    { valor: 0,    grupo: 'ventas', descripcion: 'Ajuste de meses al cobro si el crédito es Infonavit' },
  'lag_ajuste_credito.bancario':     { valor: 0.5,  grupo: 'ventas', descripcion: 'Ajuste de meses al cobro si el crédito es bancario' },
  'lag_ajuste_credito.fovissste':    { valor: 0.5,  grupo: 'ventas', descripcion: 'Ajuste de meses al cobro si el crédito es Fovissste' },
  'lag_ajuste_credito.cofinanciado': { valor: 1,    grupo: 'ventas', descripcion: 'Ajuste de meses al cobro si el crédito es cofinanciado' },
  'lag_ajuste_credito.otro':         { valor: 0,    grupo: 'ventas', descripcion: 'Ajuste de meses al cobro para otros esquemas' },
  // OBRA
  'obra.ritmo_max_semanal':         { valor: 350000, grupo: 'obra', descripcion: 'Tope físico de avance por unidad ($/semana)' },
  'obra.max_frentes':               { valor: 4,      grupo: 'obra', descripcion: 'Máximo de frentes simultáneos por proyecto (usado en Fase 3)' },
  'obra.ventana_congelamiento_sem': { valor: 3,      grupo: 'obra', descripcion: 'Semanas que dura congelada la lista de prioridades' },
  'obra.colchon_pct':               { valor: 0.08,   grupo: 'obra', descripcion: 'Colchón sobre el costo por terminar (fracción del restante)' },
  'obra.colchon_min':               { valor: 60000,  grupo: 'obra', descripcion: 'Colchón mínimo por cierre de casa ($)' },
  'obra.semanas_min_cierre':        { valor: 4,      grupo: 'obra', descripcion: 'Semanas mínimas de calendario para cerrar una casa con avance >= 85%' },
  // TESORERÍA
  'tesoreria.permite_prepago':          { valor: false,  grupo: 'tesoreria', descripcion: 'El contrato del puente permite prepago voluntario' },
  'tesoreria.pct_liberacion_default':   { valor: 0.55,   grupo: 'tesoreria', descripcion: 'Si la venta no trae valor de liberación: fracción del precio usada como estimación (se marca como estimada)' },
  'tesoreria.dia_corte':                { valor: 'fin_de_mes', grupo: 'tesoreria', descripcion: 'Corte de intereses del crédito puente' },
  'tesoreria.jerarquia_fondeo':         { valor: ['caja', 'prestamo_interno', 'disposicion'], grupo: 'tesoreria', descripcion: 'Orden de fondeo de la obra (Fase 3)' },
  'tesoreria.colchon_prestamista_meses': { valor: 1, grupo: 'tesoreria', descripcion: 'Colchón (en meses de burn) que conserva el proyecto que presta (Fase 3)' },
  'tesoreria.colchon_min_meses_burn':   { valor: 1, grupo: 'tesoreria', descripcion: 'Colchón intocable por proyecto: meses de costo fijo' },
  // DIRECCIÓN / SCORE
  'direccion.partidas_fijas':      { valor: [], grupo: 'direccion', descripcion: 'Partidas del historial que cuentan como costo fijo (elígelas del catálogo real)' },
  'direccion.burn_meses_promedio': { valor: 3,  grupo: 'direccion', descripcion: 'Meses del promedio móvil para calcular el costo fijo' },
  'direccion.reparto_corporativo': { valor: 'proporcional_dispuesto', grupo: 'direccion', descripcion: 'Cómo se reparte el gasto de la concentradora entre proyectos' },
  'direccion.modo_objetivo':       { valor: 'liquidez_primero', grupo: 'direccion', descripcion: 'Función objetivo del portafolio (Fase 3 ordena escenarios con esto)' },
  'score.castigo_incertidumbre':   { valor: 1,  grupo: 'direccion', descripcion: 'Factor multiplicativo extra de castigo a estatus inciertos (1 = sin castigo extra)' },
  'score.horizonte_meses':         { valor: 6,  grupo: 'direccion', descripcion: 'Horizonte (meses) del componente de ahorro de intereses del score' },
  'score.bono_estrategica':        { valor: 10, grupo: 'direccion', descripcion: 'Puntos de bono al score para unidades marcadas como estratégicas' }
};

// ---- cfg(): lector de configuración que NUNCA truena -------------------------
const _cfgAvisadas = new Set();
export function cfg(clave, fallback) {
  const row = state.estrategiaConfig.find(c => c.clave === clave);
  if (row && row.valor !== undefined && row.valor !== null) return row.valor;
  if (!_cfgAvisadas.has(clave)) {
    console.warn('[estrategia] cfg sin fila en estrategia_config, usando default de código:', clave);
    _cfgAvisadas.add(clave);
  }
  if (fallback !== undefined) return fallback;
  return CFG_DEFAULTS[clave] ? CFG_DEFAULTS[clave].valor : undefined;
}

// ---- Pestaña CONFIGURACIÓN ----------------------------------------------------
const GRUPO_LABEL = {
  ventas: 'Ventas · probabilidad y velocidad de cobro',
  obra: 'Obra · ejecución',
  tesoreria: 'Tesorería · reglas financieras',
  direccion: 'Dirección · costo fijo y score',
  general: 'General'
};
const GRUPO_ORDEN = ['ventas', 'obra', 'tesoreria', 'direccion', 'general'];

function _fmtValor(v) {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function renderEstrategiaConfig() {
  const el = document.getElementById('lista-estrategia-config');
  if (!el) return;
  try {
    // Unión: seeds cargados + defaults de código (por si falta alguna clave).
    const claves = new Set([...Object.keys(CFG_DEFAULTS), ...state.estrategiaConfig.map(c => c.clave)]);
    const porGrupo = {};
    for (const clave of claves) {
      const row = state.estrategiaConfig.find(c => c.clave === clave);
      const def = CFG_DEFAULTS[clave];
      const grupo = (row && row.grupo) || (def && def.grupo) || 'general';
      const valor = row ? row.valor : (def ? def.valor : null);
      const esDefault = !def || JSON.stringify(valor) === JSON.stringify(def.valor);
      if (!porGrupo[grupo]) porGrupo[grupo] = [];
      porGrupo[grupo].push({ clave, valor, descripcion: (row && row.descripcion) || (def && def.descripcion) || '', esDefault, sinFila: !row });
    }

    const bloques = GRUPO_ORDEN.filter(g => porGrupo[g] && porGrupo[g].length).map(g => {
      const filas = porGrupo[g].sort((a, b) => a.clave.localeCompare(b.clave)).map(p => {
        const esPartidasFijas = p.clave === 'direccion.partidas_fijas';
        let editor;
        if (esPartidasFijas) {
          // Selector con las partidas REALES del catálogo (los nombres del doc eran ficticios).
          const enHistorial = [...new Set(state.historial.map(h => h.partida).filter(Boolean))];
          const opts = getPartidasParaSelect(enHistorial);
          const sel = Array.isArray(p.valor) ? p.valor : [];
          editor = `<select multiple size="5" id="cfg-inp-${escapeHtml(p.clave)}" style="min-width:240px;">` +
            opts.map(o => `<option value="${escapeHtml(o.value)}"${sel.includes(o.value) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('') +
            `</select>`;
        } else {
          editor = `<input type="text" id="cfg-inp-${escapeHtml(p.clave)}" value="${escapeHtml(_fmtValor(p.valor))}" style="min-width:180px;font-family:'DM Mono',monospace;font-size:12px;">`;
        }
        const badge = p.esDefault
          ? '<span style="font-size:9px;color:var(--muted);background:var(--surface2);padding:1px 6px;border-radius:4px;">default</span>'
          : '<span style="font-size:9px;font-weight:700;color:var(--accent);background:rgba(200,169,110,.14);padding:1px 6px;border-radius:4px;">editado</span>';
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 14px;border-bottom:1px solid var(--row-border-soft);">
          <div style="min-width:0;flex:1;">
            <div style="font-family:'DM Mono',monospace;font-size:12px;font-weight:600;">${escapeHtml(p.clave)} ${badge}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(p.descripcion)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            ${editor}
            <button class="btn btn-ghost btn-sm req-admin" style="font-size:11px;" onclick="guardarConfigEstrategia('${escapeHtml(p.clave)}')">Guardar</button>
            <button class="btn btn-ghost btn-sm req-admin" style="font-size:11px;color:var(--muted);" title="Volver al valor por defecto" onclick="restaurarConfigEstrategia('${escapeHtml(p.clave)}')">↺</button>
          </div>
        </div>`;
      }).join('');
      return `<div style="margin-bottom:18px;border:1px solid var(--border);border-radius:12px;overflow:hidden;">
        <div style="padding:10px 14px;background:var(--surface2);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);">${escapeHtml(GRUPO_LABEL[g] || g)}</div>
        ${filas}</div>`;
    }).join('');

    el.innerHTML = bloques || '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">⚙️</div><div>Sin parámetros. ¿Corriste el SQL 30 en Supabase?</div></div>';
  } catch (e) {
    console.error('renderEstrategiaConfig', e);
    el.innerHTML = '<div class="empty-state">La configuración no pudo mostrarse; la operación no está afectada.</div>';
  }
}

function _setConfig(clave, valor) {
  let row = state.estrategiaConfig.find(c => c.clave === clave);
  const def = CFG_DEFAULTS[clave];
  if (row) {
    row.valor = valor;
  } else {
    row = { clave, valor, descripcion: (def && def.descripcion) || '', grupo: (def && def.grupo) || 'general' };
    state.estrategiaConfig.push(row);
  }
  const porFila = esPorFila('estrategiaConfig');
  gsSaveEstrategiaConfig({ porFila });
  if (porFila) sbGuardarFila('estrategiaConfig', row);
  renderEstrategiaConfig();
}

export function guardarConfigEstrategia(clave) {
  if (!esAdmin()) { notify('Solo el admin puede editar la configuración', 'error'); return; }
  if (!clave) return;
  let valor;
  if (clave === 'direccion.partidas_fijas') {
    const sel = document.getElementById('cfg-inp-' + clave);
    valor = sel ? [...sel.selectedOptions].map(o => o.value) : [];
  } else {
    const inp = document.getElementById('cfg-inp-' + clave);
    if (!inp) return;
    const raw = inp.value.trim();
    if (!raw) { notify('El valor no puede quedar vacío', 'error'); return; }
    // Números/booleanos/listas se capturan como JSON; texto plano queda como string.
    try { valor = JSON.parse(raw); } catch (_) { valor = raw; }
  }
  _setConfig(clave, valor);
  notify(`✓ ${clave} guardado — el modelo lo usa de inmediato`);
}

export function restaurarConfigEstrategia(clave) {
  if (!esAdmin()) { notify('Solo el admin puede editar la configuración', 'error'); return; }
  const def = CFG_DEFAULTS[clave];
  if (!def) { notify('Esa clave no tiene default de código', 'error'); return; }
  _setConfig(clave, def.valor);
  notify(`✓ ${clave} restaurado al default`);
}

// ---- Placeholders (Tablero → Etapa 5 · Bloqueos → Etapa 4) --------------------
function _emptyEst(icon, titulo, sub) {
  return `<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">${icon}</div><div>${titulo}</div>` +
    (sub ? `<div style="font-size:12px;color:var(--muted);margin-top:6px;">${sub}</div>` : '') + `</div>`;
}

export function renderEstrategiaTablero() {
  const el = document.getElementById('lista-estrategia-tablero');
  if (!el) return;
  try {
    el.innerHTML = _emptyEst('📊', 'El Tablero llega en el siguiente paso', 'Score por unidad, ranking de priorización y costo del mes.');
  } catch (e) {
    console.error('renderEstrategiaTablero', e);
    el.innerHTML = '<div class="empty-state">El tablero no pudo calcularse; la operación no está afectada.</div>';
  }
}

// ---- Pestaña BLOQUEOS Y MARCAS (Etapa 4) --------------------------------------
const FLAG_TIPO = {
  bloqueo:     { label: '🚫 Bloqueo',     color: 'rgba(224,90,90,.15);color:var(--red)',        efecto: 'sale del ranking' },
  compromiso:  { label: '📌 Compromiso',  color: 'rgba(200,169,110,.15);color:var(--accent)',   efecto: 'anclada arriba' },
  estrategica: { label: '⭐ Estratégica', color: 'rgba(90,155,224,.15);color:var(--blue)',      efecto: 'bono al score' }
};

function _unidadNombre(unidadId) {
  const u = state.unidades.find(x => String(x.unidad_id) === String(unidadId));
  return u ? (u.nombre || `Unidad ${u.unidad_id}`) : `Unidad ${unidadId}`;
}

export function renderEstrategiaFlags() {
  const el = document.getElementById('lista-estrategia-flags');
  if (!el) return;
  try {
    const acciones = document.getElementById('acciones-estrategia-flags');
    if (acciones && !acciones.innerHTML) {
      acciones.innerHTML = '<button class="btn btn-primary req-editor" onclick="abrirNuevoFlag()">+ Nueva marca</button>';
    }
    const cnt = document.getElementById('cnt-estrategia-flags');
    const vivos = state.estrategiaFlags.filter(f => f.activo !== false);
    if (cnt) cnt.textContent = vivos.length;
    if (!vivos.length) {
      el.innerHTML = _emptyEst('🚩', 'Sin marcas aún', 'Bloqueo (sale del ranking) · Compromiso (ancla arriba con fecha) · Estratégica (bono al score).');
      return;
    }
    const filas = vivos.map(f => {
      const t = FLAG_TIPO[f.tipo] || FLAG_TIPO.bloqueo;
      const id = String(f.flag_id).replace(/'/g, "\\'");
      const detalle = f.tipo === 'bloqueo' ? (f.categoria || '—')
        : f.tipo === 'compromiso' ? (f.fecha_compromiso || 'sin fecha')
        : t.efecto;
      return `<tr><td><div class="name-cell">${escapeHtml(_unidadNombre(f.unidad_id))}</div><div class="name-sub">${escapeHtml(f.proyecto || '—')}</div></td>` +
        `<td><span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${t.color};">${t.label}</span></td>` +
        `<td style="font-size:12px;">${escapeHtml(detalle)}</td>` +
        `<td style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;" title="${escapeHtml(f.nota || '')}">${escapeHtml(f.nota || '—')}</td>` +
        `<td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-ghost btn-sm req-editor" onclick="editarFlag('${id}')">Editar</button><button class="btn btn-ghost btn-sm req-editor danger" onclick="eliminarFlag('${id}')">✕</button></div></td></tr>`;
    }).join('');
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Unidad</th><th>Tipo</th><th>Categoría / Fecha</th><th>Nota</th><th style="text-align:right">Acciones</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  } catch (e) {
    console.error('renderEstrategiaFlags', e);
    el.innerHTML = '<div class="empty-state">Esta vista no pudo mostrarse; la operación no está afectada.</div>';
  }
}

// Cascada proyecto → unidad (mismo patrón que el modal de ventas).
export function efPoblarUnidades() {
  const proy = document.getElementById('ef-proyecto')?.value || '';
  const un = document.getElementById('ef-unidad');
  if (!un) return;
  const unidades = state.unidades.filter(u => u.proyecto === proy && u.activo !== false)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  un.innerHTML = unidades.length
    ? '<option value="">— Selecciona unidad —</option>' + unidades.map(u => `<option value="${escapeHtml(String(u.unidad_id))}">${escapeHtml(u.nombre || ('Unidad ' + u.unidad_id))}</option>`).join('')
    : '<option value="">(sin unidades activas en este proyecto)</option>';
}

// Muestra el campo condicional según el tipo (categoría para bloqueo, fecha para compromiso).
export function efTipoChange() {
  const tipo = document.getElementById('ef-tipo')?.value || 'bloqueo';
  const cw = document.getElementById('ef-categoria-wrap');
  const fw = document.getElementById('ef-fecha-wrap');
  if (cw) cw.style.display = tipo === 'bloqueo' ? '' : 'none';
  if (fw) fw.style.display = tipo === 'compromiso' ? '' : 'none';
}

function _poblarSelectsFlag() {
  const py = document.getElementById('ef-proyecto');
  if (py) py.innerHTML = state.proyectos.filter(p => p.activo).map(p => `<option value="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)}</option>`).join('');
  efPoblarUnidades();
}

export function abrirNuevoFlag() {
  state.editFlagId = null;
  _poblarSelectsFlag();
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  set('ef-tipo', 'bloqueo'); set('ef-categoria', 'tecnico'); set('ef-fecha', ''); set('ef-nota', '');
  efTipoChange();
  const t = document.getElementById('modal-estrategia-flag-title'); if (t) t.textContent = 'Nueva marca de unidad';
  document.getElementById('modal-estrategia-flag').classList.add('open');
}

export function editarFlag(id) {
  const f = state.estrategiaFlags.find(x => String(x.flag_id) === String(id));
  if (!f) return;
  state.editFlagId = f.flag_id;
  _poblarSelectsFlag();
  const set = (elId, v) => { const e = document.getElementById(elId); if (e) e.value = v; };
  set('ef-proyecto', f.proyecto || '');
  efPoblarUnidades();
  set('ef-unidad', String(f.unidad_id || ''));
  set('ef-tipo', f.tipo || 'bloqueo');
  set('ef-categoria', f.categoria || 'tecnico');
  set('ef-fecha', f.fecha_compromiso || '');
  set('ef-nota', f.nota || '');
  efTipoChange();
  const t = document.getElementById('modal-estrategia-flag-title'); if (t) t.textContent = 'Editar marca';
  document.getElementById('modal-estrategia-flag').classList.add('open');
}

export function guardarFlag() {
  if (!puedeEditar()) { notify('No tienes permiso para editar', 'error'); return; }
  const unidad_id = (document.getElementById('ef-unidad')?.value || '').trim();
  const proyecto = (document.getElementById('ef-proyecto')?.value || '').trim();
  const tipo = document.getElementById('ef-tipo')?.value || 'bloqueo';
  if (!unidad_id) { notify('Elige la unidad', 'error'); return; }
  const fecha = document.getElementById('ef-fecha')?.value || '';
  if (tipo === 'compromiso' && !fecha) { notify('Un compromiso necesita su fecha pactada de entrega', 'error'); return; }
  // Una unidad no lleva dos marcas activas del MISMO tipo.
  const dup = state.estrategiaFlags.some(f =>
    String(f.flag_id) !== String(state.editFlagId) &&
    String(f.unidad_id) === String(unidad_id) && f.tipo === tipo && f.activo !== false);
  if (dup) { notify(`Esa unidad ya tiene una marca de tipo "${tipo}" activa.`, 'error'); return; }
  const existing = state.editFlagId ? state.estrategiaFlags.find(f => String(f.flag_id) === String(state.editFlagId)) : null;
  const obj = {
    flag_id: existing ? existing.flag_id : nuevoFlagId(),
    unidad_id, proyecto, tipo,
    categoria: tipo === 'bloqueo' ? (document.getElementById('ef-categoria')?.value || 'otro') : '',
    fecha_compromiso: tipo === 'compromiso' ? fecha : '',
    nota: (document.getElementById('ef-nota')?.value || '').trim(),
    activo: existing ? existing.activo !== false : true
  };
  if (existing) {
    const i = state.estrategiaFlags.findIndex(f => String(f.flag_id) === String(state.editFlagId));
    state.estrategiaFlags[i] = obj;
  } else {
    state.estrategiaFlags.push(obj);
  }
  cerrar('modal-estrategia-flag');
  renderEstrategiaFlags();
  if (window.renderEstrategiaTablero) window.renderEstrategiaTablero();   // el ranking reacciona
  notify(existing ? 'Marca actualizada' : 'Marca registrada');
  const porFila = esPorFila('estrategiaFlags');
  gsSaveEstrategiaFlags({ porFila });
  if (porFila) sbGuardarFila('estrategiaFlags', obj);
}

export function eliminarFlag(id) {
  if (!puedeEditar()) { notify('No tienes permiso para editar', 'error'); return; }
  const f = state.estrategiaFlags.find(x => String(x.flag_id) === String(id));
  if (!f) return;
  if (!confirm(`¿Quitar la marca "${(FLAG_TIPO[f.tipo] || {}).label || f.tipo}" de ${_unidadNombre(f.unidad_id)}?`)) return;
  state.estrategiaFlags = state.estrategiaFlags.filter(x => String(x.flag_id) !== String(id));
  renderEstrategiaFlags();
  if (window.renderEstrategiaTablero) window.renderEstrategiaTablero();
  notify('Marca eliminada');
  const porFila = esPorFila('estrategiaFlags');
  gsSaveEstrategiaFlags({ porFila });
  if (porFila) sbBorrarFila('estrategiaFlags', id);
}

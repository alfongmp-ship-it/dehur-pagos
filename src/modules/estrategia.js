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
import { fmt, escapeHtml } from '../ui/format.js';
import { getPartidasParaSelect } from '../config/sub-partidas.js';
import { proyectoMatch } from '../config/proyectos.js';
import { parseFechaHist } from './historial.js';
import { costosPresupuestosBatch } from './costos-fiscales.js';
import { rankearUnidades } from './estrategia-score.js';

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

// ---- TABLERO (Etapas 5-6): KPIs + ranking + desglose + costo del mes ---------
const _EST_BADGE = {
  escriturada: 'rgba(39,174,96,.15);color:#27ae60',
  vendida: 'rgba(52,152,219,.15);color:#3498db',
  apartada: 'rgba(200,169,110,.15);color:var(--accent)',
  disponible: 'rgba(122,117,112,.15);color:var(--muted)'
};
let _tabDesgloseAbierto = new Set();   // filas expandidas (persisten entre re-renders)

// Saldo dispuesto de un crédito: override manual (config) o Σ pagarés VIGENTES.
// OJO: difiere del "Dispuesto" de la pantalla Créditos (que suma por activo,
// incluyendo pagados) — aquí un pagaré pagado ya no genera interés.
function _saldoDispuesto(credito) {
  const ov = cfg('tesoreria.saldo_override.' + credito.credito_id, null);
  if (ov !== null && ov !== undefined && Number.isFinite(Number(ov))) return Number(ov);
  return state.pagares
    .filter(p => String(p.credito_id) === String(credito.credito_id) && p.activo !== false && p.estatus === 'Vigente')
    .reduce((s, p) => s + (p.monto || 0), 0);
}
function _creditosActivos() {
  return state.creditos.filter(c => c.activo !== false && (c.estatus || 'Activo') === 'Activo');
}
function _tasaDeProyecto(nombreProy) {
  const c = _creditosActivos().find(x => x.proyecto && proyectoMatch(x.proyecto, nombreProy));
  return c ? (c.tasa_base || 0) : 0;
}

// Burn fijo mensual por proyecto: promedio móvil de N meses COMPLETOS anteriores
// de los pagos del historial cuyas partidas estén en direccion.partidas_fijas.
function _burnPorProyecto() {
  const partidasFijas = cfg('direccion.partidas_fijas', []) || [];
  if (!Array.isArray(partidasFijas) || !partidasFijas.length) return null;   // sin configurar
  const n = Number(cfg('direccion.burn_meses_promedio', 3)) || 3;
  const hoy = new Date();
  const meses = new Set();
  for (let i = 1; i <= n; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const fijas = new Set(partidasFijas);
  const porProy = new Map();
  state.historial.forEach(h => {
    if (!fijas.has(h.partida)) return;
    const iso = parseFechaHist(h.fecha);
    if (!iso || !meses.has(iso.slice(0, 7))) return;
    const k = h.proyecto || 'Sin proyecto';
    porProy.set(k, (porProy.get(k) || 0) + (parseFloat(h.importe) || 0));
  });
  const out = new Map();
  for (const [k, total] of porProy) out.set(k, total / n);
  return out;
}

export function estToggleDesglose(uid) {
  if (_tabDesgloseAbierto.has(uid)) _tabDesgloseAbierto.delete(uid);
  else _tabDesgloseAbierto.add(uid);
  renderEstrategiaTablero();
}

export function renderEstrategiaTablero() {
  const el = document.getElementById('lista-estrategia-tablero');
  if (!el) return;
  try {
    const filtroProy = document.getElementById('est-tab-proy')?.value || '';

    // ---- Insumos por unidad (índices UNA vez; joins con String()) ----
    const costos = costosPresupuestosBatch();
    const ventaPorUnidad = new Map();
    state.ventas.forEach(v => {
      if (v.activo === false || v.estatus_comercial === 'cancelada') return;
      ventaPorUnidad.set(String(v.unidad_id), v);
    });
    const flagsPorUnidad = new Map();
    state.estrategiaFlags.forEach(f => {
      if (f.activo === false) return;
      const k = String(f.unidad_id);
      const acc = flagsPorUnidad.get(k) || {};
      if (f.tipo === 'bloqueo') { acc.bloqueo = true; acc.categoria = f.categoria || 'otro'; acc.notaBloqueo = f.nota || ''; }
      if (f.tipo === 'compromiso') { acc.compromiso = true; acc.fechaCompromiso = f.fecha_compromiso || ''; }
      if (f.tipo === 'estrategica') { acc.estrategica = true; acc.notaEstrategica = f.nota || ''; }
      flagsPorUnidad.set(k, acc);
    });
    // Precio estimado para unidades SIN venta: promedio del proyecto (o global).
    const precios = new Map(); let sumaGlobal = 0, nGlobal = 0;
    state.ventas.forEach(v => {
      if (v.activo === false || v.estatus_comercial === 'cancelada' || !(v.precio_venta > 0)) return;
      const k = v.proyecto || '';
      const acc = precios.get(k) || { s: 0, n: 0 };
      acc.s += v.precio_venta; acc.n++;
      precios.set(k, acc); sumaGlobal += v.precio_venta; nGlobal++;
    });
    const precioEstimadoDe = proy => {
      const p = precios.get(proy || '');
      if (p && p.n) return p.s / p.n;
      return nGlobal ? sumaGlobal / nGlobal : 0;
    };
    const tasaCache = new Map();
    const tasaDe = proy => {
      if (!tasaCache.has(proy)) tasaCache.set(proy, _tasaDeProyecto(proy));
      return tasaCache.get(proy);
    };

    const insumos = state.unidades
      .filter(u => u.activo !== false && (!filtroProy || u.proyecto === filtroProy))
      .map(u => {
        const k = String(u.unidad_id);
        const c = costos.get(k) || { real: 0, presupuesto: 0, avance: null };
        const terminada = ['Terminada', 'Entregada', 'Vendida'].includes(u.estatus) || !!u.fecha_termino;
        return {
          unidad_id: k, nombre: u.nombre || ('Unidad ' + u.unidad_id), proyecto: u.proyecto || '',
          costoReal: c.real, presupuesto: c.presupuesto, avance: c.avance, terminada,
          venta: ventaPorUnidad.get(k) || null,
          precioEstimado: precioEstimadoDe(u.proyecto),
          tasaAnual: tasaDe(u.proyecto),
          flags: flagsPorUnidad.get(k) || {}
        };
      });

    const rank = rankearUnidades(insumos, cfg);

    // ---- KPIs de cabecera ----
    const creditos = _creditosActivos();
    const dispuestoTotal = creditos.reduce((s, c) => s + _saldoDispuesto(c), 0);
    const interesMes = creditos.reduce((s, c) => s + _saldoDispuesto(c) * ((c.tasa_base || 0) / 100 / 12), 0);
    const flujo90 = rank.activas.filter(s => s.calc.mesesCobro <= 3).reduce((s, x) => s + x.calc.flujoEsp, 0);
    const caja = state.proyectos.filter(p => p.activo).reduce((s, p) => s + (p.saldo || 0), 0)
      + state.cuentasPropias.filter(c => c.activo !== false).reduce((s, c) => s + (c.saldo || 0), 0);
    const burn = _burnPorProyecto();   // null = partidas fijas sin configurar
    const burnTotal = burn ? [...burn.values()].reduce((s, v) => s + v, 0) : null;
    const costoDelMes = burnTotal !== null ? burnTotal + interesMes : null;

    const kpi = (label, valor, sub, color) =>
      `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value ${color || 'stat-accent'}" style="font-size:20px;">${valor}</div><div class="stat-sub">${sub}</div></div>`;
    const kpis = `<div class="stats-row">` +
      kpi('Costo del mes', costoDelMes !== null ? fmt(costoDelMes) : '—',
        costoDelMes !== null ? 'Burn fijo + interés · lo que cuesta que el portafolio exista 30 días más' : 'Configura direccion.partidas_fijas en Configuración', 'stat-orange') +
      kpi('Interés próximo corte', fmt(interesMes), 'Σ créditos: dispuesto × tasa/12', 'stat-purple') +
      kpi('Saldo dispuesto', fmt(dispuestoTotal), 'Pagarés vigentes de créditos activos', 'stat-accent') +
      kpi('Flujo cobrable ≤ 90 días', fmt(flujo90), 'Flujo esperado de unidades a ≤ 3 meses', 'stat-green') +
      kpi('Caja disponible', fmt(caja), 'Saldos de proyectos + cuentas propias', 'stat-blue') +
      `</div>`;

    // Desglose del costo del mes (auditable)
    let costoMesDetalle = '';
    if (burn) {
      const filasBurn = [...burn.entries()].sort((a, b) => b[1] - a[1])
        .map(([p, v]) => `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;"><span>${escapeHtml(p)} (burn fijo/mes)</span><span style="font-family:'DM Mono',monospace;">${fmt(v)}</span></div>`).join('');
      const filasInt = creditos.map(c =>
        `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;"><span>${escapeHtml(c.nombre || ('Crédito ' + c.credito_id))} · dispuesto ${fmt(_saldoDispuesto(c))} × ${c.tasa_base || 0}%/12</span><span style="font-family:'DM Mono',monospace;">${fmt(_saldoDispuesto(c) * ((c.tasa_base || 0) / 100 / 12))}</span></div>`).join('');
      costoMesDetalle = `<details style="margin:-12px 0 18px;"><summary style="cursor:pointer;font-size:11px;color:var(--muted);">Ver desglose del costo del mes</summary>
        <div style="padding:10px 14px;border:1px solid var(--border);border-radius:10px;margin-top:8px;max-width:640px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">Burn fijo por proyecto (promedio ${Number(cfg('direccion.burn_meses_promedio', 3))} meses de partidas fijas)</div>${filasBurn || '<div style="font-size:11px;color:var(--muted);">Sin pagos de partidas fijas en el periodo</div>'}
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:8px 0 4px;">Interés por crédito (Σ pagarés vigentes; difiere del "Dispuesto" de Créditos, que incluye pagados)</div>${filasInt || '<div style="font-size:11px;color:var(--muted);">Sin créditos activos</div>'}
        </div></details>`;
    }

    // ---- Filtro por proyecto ----
    const proys = [...new Set(state.unidades.filter(u => u.activo !== false).map(u => u.proyecto).filter(Boolean))];
    const filtro = `<div class="toolbar"><select class="filter-select" id="est-tab-proy" onchange="renderEstrategiaTablero()">
      <option value="">Todos los proyectos</option>${proys.map(p => `<option value="${escapeHtml(p)}"${p === filtroProy ? ' selected' : ''}>${escapeHtml(p)}</option>`).join('')}
    </select><div style="font-size:11px;color:var(--muted);">${rank.activas.length} unidades en ranking · ${rank.bloqueadas.length} bloqueadas · ${rank.excluidas.length} terminadas y cobradas</div></div>`;

    // ---- Ranking ----
    const filas = rank.activas.map((s, i) => {
      const r = s.calc; const f = s.insumo.flags || {};
      const abierto = _tabDesgloseAbierto.has(s.insumo.unidad_id);
      const badges =
        `<span style="display:inline-block;padding:1px 7px;border-radius:6px;font-size:10px;font-weight:600;background:${_EST_BADGE[r.estatus]};">${r.estatus}</span>` +
        (s.compromiso ? ` <span title="Compromiso de entrega" style="display:inline-block;padding:1px 7px;border-radius:6px;font-size:10px;font-weight:700;background:rgba(200,169,110,.18);color:var(--accent);">📌 ${escapeHtml(f.fechaCompromiso || '')}</span>` : '') +
        (s.estrategica ? ` <span title="${escapeHtml(f.notaEstrategica || 'Estratégica comercial')}" style="display:inline-block;padding:1px 7px;border-radius:6px;font-size:10px;font-weight:700;background:rgba(90,155,224,.15);color:var(--blue);">⭐</span>` : '') +
        (r.precioEsEstimado || !r.liberacionCapturada ? ` <span title="Usa precio y/o liberación ESTIMADOS" style="display:inline-block;padding:1px 7px;border-radius:6px;font-size:10px;background:rgba(224,122,58,.14);color:var(--orange);">~est</span>` : '');
      const barra = `<div style="display:flex;align-items:center;gap:8px;"><div style="flex:1;height:6px;background:var(--surface2);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${Math.round(s.score)}%;background:var(--accent);"></div></div><span style="font-family:'DM Mono',monospace;font-size:12px;font-weight:700;min-width:34px;text-align:right;">${Math.round(s.score)}</span></div>`;
      const fila = `<tr style="cursor:pointer;" onclick="estToggleDesglose('${s.insumo.unidad_id}')">
        <td style="font-family:'DM Mono',monospace;color:var(--muted);text-align:center;">${i + 1}</td>
        <td><div class="name-cell">${escapeHtml(s.insumo.nombre)}</div><div class="name-sub">${escapeHtml(s.insumo.proyecto)}${s.insumo.avance != null ? ` · avance ${Math.round(s.insumo.avance)}%` : ' · sin presupuesto'}</div></td>
        <td>${badges}</td>
        <td style="min-width:160px;">${barra}</td>
        <td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;">${fmt(r.costoTerminar)}</td>
        <td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;color:#27ae60;">${fmt(r.flujoEsp)}</td>
        <td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;">${r.mesesCobro.toFixed(1)} m</td>
        <td style="text-align:center;color:var(--muted);">${abierto ? '▾' : '▸'}</td>
      </tr>`;
      const desglose = abierto ? `<tr><td colspan="8" style="background:var(--surface2);padding:10px 18px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px;">Desglose del cálculo (auditable)</div>
        ${r.desglose.map(l => `<div style="font-family:'DM Mono',monospace;font-size:11px;padding:1px 0;">${escapeHtml(l)}</div>`).join('')}
      </td></tr>` : '';
      return fila + desglose;
    }).join('');

    const tabla = rank.activas.length
      ? `<div class="table-wrap"><table><thead><tr><th style="width:36px;text-align:center;">#</th><th>Unidad</th><th>Situación</th><th>Score</th><th style="text-align:right">Costo por terminar</th><th style="text-align:right">Flujo esperado</th><th style="text-align:right">Meses a cobro</th><th style="width:30px;"></th></tr></thead><tbody>${filas}</tbody></table></div>`
      : _emptyEst('📊', 'Sin unidades en el ranking', 'Da de alta unidades (Costos por Unidad) y ventas (Ingresos) para calcular el score.');

    // ---- Bloqueadas (fuera del ranking, con su porqué) ----
    let bloqueadas = '';
    if (rank.bloqueadas.length) {
      const filasB = rank.bloqueadas.map(i => {
        const f = i.flags || {};
        return `<tr><td><div class="name-cell">${escapeHtml(i.nombre)}</div><div class="name-sub">${escapeHtml(i.proyecto)}</div></td>
          <td><span style="display:inline-block;padding:1px 7px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(224,90,90,.15);color:var(--red);">🚫 ${escapeHtml(f.categoria || 'otro')}</span></td>
          <td style="font-size:11px;color:var(--muted);">${escapeHtml(f.notaBloqueo || '—')}</td></tr>`;
      }).join('');
      bloqueadas = `<div style="margin-top:22px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--red);margin-bottom:8px;">Bloqueadas — fuera del ranking (no se les recomienda dinero que no pueden ejercer)</div>
        <div class="table-wrap"><table><thead><tr><th>Unidad</th><th>Categoría</th><th>Nota</th></tr></thead><tbody>${filasB}</tbody></table></div></div>`;
    }

    el.innerHTML = kpis + costoMesDetalle + filtro + tabla + bloqueadas;
  } catch (e) {
    console.error('renderEstrategiaTablero', e);
    el.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">📊</div><div>El tablero no pudo calcularse; la operación no está afectada.</div></div>';
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

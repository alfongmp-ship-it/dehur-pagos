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
import { esGastoRealJP } from './resumen-costos.js';
import { calcularSaldosNetosPrestamos } from './resumen-ejecutivo.js';
import { rankearUnidades } from './estrategia-score.js';
import { proyectarCaja, sugerirFondeo } from './simulador-caja.js';

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
  'simulador.horizonte_meses':     { valor: 6,  grupo: 'direccion', descripcion: 'Meses que proyecta el presupuesto de caja (Fase 3)' },
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
// Capacidad de DISPOSICIÓN de un crédito — REGLA DE LA CASA (pantalla Créditos):
// autorizado − Σ pagarés activos del crédito (INCLUYE pagados; no revolvente).
// OJO: distinta de _saldoDispuesto (vigentes + override), que es para el INTERÉS.
function _disponibleCredito(c) {
  const dispuesto = state.pagares
    .filter(p => String(p.credito_id) === String(c.credito_id) && p.activo !== false)
    .reduce((s, p) => s + (p.monto || 0), 0);
  return (c.monto_autorizado || 0) - dispuesto;
}
// Deuda viva entre proyectos para el sugeridor: canoniza cada extremo contra los
// nombres de la PROYECCIÓN, netea pares que queden invertidos tras canonizar y
// DESCARTA los que no resuelven (no se mapean a '(Sin proyecto)': colapsaría
// deudas de proyectos viejos sobre la concentradora).
function _deudaVivaCanon(netos, nombresProyeccion) {
  const resolver = s => nombresProyeccion.find(n => n !== '(Sin proyecto)' && proyectoMatch(n, s)) || null;
  const acum = new Map();   // 'k1|||k2' (orden alfabético) → monto con signo (+ = k1 debe a k2)
  for (const sn of netos) {
    const deudor = resolver(sn.neto > 0 ? sn.b : sn.a);
    const acreedor = resolver(sn.neto > 0 ? sn.a : sn.b);
    if (!deudor || !acreedor || deudor === acreedor) continue;
    const [k1, k2] = [deudor, acreedor].sort();
    const key = k1 + '|||' + k2;
    acum.set(key, (acum.get(key) || 0) + (deudor === k1 ? Math.abs(sn.neto) : -Math.abs(sn.neto)));
  }
  const out = [];
  for (const [key, v] of acum) {
    if (Math.abs(v) <= 0.5) continue;
    const [k1, k2] = key.split('|||');
    out.push(v > 0 ? { deudor: k1, acreedor: k2, monto: v } : { deudor: k2, acreedor: k1, monto: -v });
  }
  return out;
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

// Arma los insumos por unidad para el motor de score (índices UNA vez; joins con
// String()). filtroProy vacío = todas las unidades activas. Reusado por el Tablero
// (renderEstrategiaTablero) y el Presupuesto de caja (renderSimuladorCaja).
function _construirInsumos(filtroProy) {
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

  return state.unidades
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
}

export function renderEstrategiaTablero() {
  const el = document.getElementById('lista-estrategia-tablero');
  if (!el) return;
  try {
    const filtroProy = document.getElementById('est-tab-proy')?.value || '';

    const insumos = _construirInsumos(filtroProy);

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

// ---- Presupuesto de caja por FLUJOS (Fase 3 · A2, SOLO LECTURA) --------------
// SIN saldos bancarios: los saldos capturados a mano no son confiables (se
// modifican y eran un parche de antes de registrar ingresos). Todo sale de
// REGISTROS: gasto real (regla del reporte JP), cobros reales, préstamos entre
// proyectos (se llevan aparte, como deuda), y la proyección estima cuánto FONDEO
// externo (aportación / préstamo / disposición) necesitará cada proyecto y cuándo.
let _simProyAbierto = new Set();   // proyectos con desglose expandido (persiste entre renders)
let _simProyNombres = [];          // nombres del último render (toggle por índice, robusto a acentos/comillas)

export function simToggleProyecto(idx) {
  const n = _simProyNombres[idx];
  if (n == null) return;
  if (_simProyAbierto.has(n)) _simProyAbierto.delete(n); else _simProyAbierto.add(n);
  renderSimuladorCaja();
}

// Últimos n meses como ['YYYY-MM', ...] terminando en el mes actual.
function _mesesUltimos(n) {
  const hoy = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// Gasto REAL por proyecto y mes desde el historial (regla del reporte JP: Pagos +
// Aportaciones + Créditos solo intereses; Traspasos y Préstamos NO).
// Devuelve Map(proyecto canonizado → Map(ym → $)).
function _gastoRealPorProyectoMes(mesesYm, canon) {
  const meses = new Set(mesesYm);
  const out = new Map();
  state.historial.forEach(h => {
    if (!esGastoRealJP(h)) return;
    const iso = parseFechaHist(h.fecha);
    if (!iso) return;
    const ym = iso.slice(0, 7);
    if (!meses.has(ym)) return;
    const p = canon(h.proyecto);
    if (!out.has(p)) out.set(p, new Map());
    const m = out.get(p);
    m.set(ym, (m.get(ym) || 0) + (parseFloat(h.importe) || 0));
  });
  return out;
}

// Cobrado REAL consolidado por mes (módulo Ingresos). Map(ym → $).
function _cobradoPorMes(mesesYm) {
  const meses = new Set(mesesYm);
  const out = new Map();
  state.cobros.forEach(c => {
    if (c.activo === false) return;
    const iso = parseFechaHist(c.fecha || '');
    if (!iso) return;
    const ym = iso.slice(0, 7);
    if (meses.has(ym)) out.set(ym, (out.get(ym) || 0) + (c.monto || 0));
  });
  return out;
}

export function renderSimuladorCaja() {
  const el = document.getElementById('lista-estrategia-simulador-caja');
  if (!el) return;
  try {
    // Proyectos canónicos + canonizador (gasto/burn/créditos se mapean a estos nombres).
    const proysCanon = state.proyectos.filter(p => p.activo).map(p => p.nombre);
    const canon = s => { if (!s) return '(Sin proyecto)'; return proysCanon.find(n => proyectoMatch(n, s)) || '(Sin proyecto)'; };

    // Ranking (mismo motor que el Tablero) → unidades para el motor de caja.
    const rank = rankearUnidades(_construirInsumos(''), cfg);
    const unidades = rank.activas.map(s => ({
      unidad_id: s.insumo.unidad_id, nombre: s.insumo.nombre, proyecto: canon(s.insumo.proyecto),
      score: s.score, costoTerminar: s.calc.costoTerminar, semanasObra: s.calc.semanasObra,
      mesesCobro: s.calc.mesesCobro, lagMeses: s.calc.lagMeses, flujoEsp: s.calc.flujoEsp,
      liberacion: s.calc.liberacion, prob: s.calc.prob, terminada: s.insumo.terminada
    }));

    // Burn (canonizado) y créditos por proyecto.
    const burnRaw = _burnPorProyecto();
    let burnPorProyecto = null;
    if (burnRaw) { burnPorProyecto = {}; for (const [p, v] of burnRaw) { const n = canon(p); burnPorProyecto[n] = (burnPorProyecto[n] || 0) + v; } }
    const creditos = _creditosActivos().map(c => ({ proyecto: canon(c.proyecto), dispuesto: _saldoDispuesto(c), tasaMes: (c.tasa_base || 0) / 100 / 12 }));

    // Proyectos del modelo con saldoInicial 0 (SIN saldos bancarios): la proyección
    // mide FLUJO puro; el "saldo corrido" del motor se vuelve flujo acumulado y su
    // deficit (colchón − flujoAcum) se lee como NECESIDAD de fondeo externo.
    // '(Sin proyecto)' entra si tiene unidades o burn (gasto central concentradora).
    const conUnidades = new Set(unidades.map(u => u.proyecto));
    const proyectos = proysCanon.map(nombre => ({ nombre, saldoInicial: 0 }));
    if (conUnidades.has('(Sin proyecto)') || (burnPorProyecto && burnPorProyecto['(Sin proyecto)'])) {
      proyectos.push({ nombre: '(Sin proyecto)', saldoInicial: 0 });
    }

    const hoy = new Date();
    const mesInicio = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const proy = proyectarCaja({ mesInicio, proyectos, unidades, burnPorProyecto, creditos }, cfg);
    _simProyNombres = proy.proyectos.map(p => p.nombre);

    if (!proy.proyectos.length) {
      el.innerHTML = _emptyEst('💧', 'Sin proyectos para proyectar', 'Da de alta proyectos y unidades para ver el presupuesto de caja.');
      return;
    }

    const H = proy.horizonte;
    const cons = proy.consolidado;
    const stickyTd = 'position:sticky;left:0;background:var(--surface);';
    const secTitulo = (color, texto) => `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${color};margin:24px 0 8px;">${texto}</div>`;

    // ======== A) Gasto real por mes (histórico, de registros, regla JP) ========
    const mesesHist = _mesesUltimos(H);
    const ymActual = mesesHist[mesesHist.length - 1];
    const gasto = _gastoRealPorProyectoMes(mesesHist, canon);
    const cobrado = _cobradoPorMes(mesesHist);
    const proysHist = [...proysCanon, ...(gasto.has('(Sin proyecto)') ? ['(Sin proyecto)'] : [])];
    const mesesCompletos = mesesHist.slice(0, -1);   // el actual va aparte ("en curso")
    const totalMesG = ym => proysHist.reduce((s, n) => s + (gasto.get(n)?.get(ym) || 0), 0);
    const gastoPromMes = mesesCompletos.length ? mesesCompletos.reduce((s, ym) => s + totalMesG(ym), 0) / mesesCompletos.length : 0;
    const celdaHist = (v, extra = '') => `<td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;${extra}">${Math.abs(v) >= 0.005 ? fmt(v) : '<span style="color:var(--muted);">—</span>'}</td>`;
    const thHist = `<th style="${stickyTd}text-align:left;">Proyecto</th>` + mesesHist.map(m => `<th style="text-align:right;">${m}${m === ymActual ? '<div style="font-weight:400;font-size:9px;color:var(--muted);">(en curso)</div>' : ''}</th>`).join('') + `<th style="text-align:right;">Prom/mes</th>`;
    const filasHist = proysHist.map(n => {
      const m = gasto.get(n);
      const prom = mesesCompletos.length ? mesesCompletos.reduce((s, ym) => s + (m?.get(ym) || 0), 0) / mesesCompletos.length : 0;
      return `<tr><td style="${stickyTd}white-space:nowrap;">${escapeHtml(n)}</td>${mesesHist.map(ym => celdaHist(m?.get(ym) || 0)).join('')}${celdaHist(prom, 'color:var(--muted);')}</tr>`;
    }).join('');
    const filaTotalG = `<tr style="font-weight:700;border-top:2px solid var(--border);"><td style="${stickyTd}">TOTAL gastado</td>${mesesHist.map(ym => celdaHist(totalMesG(ym))).join('')}${celdaHist(gastoPromMes)}</tr>`;
    const filaCobrado = `<tr style="color:var(--green);"><td style="${stickyTd}white-space:nowrap;">Cobrado (real)</td>${mesesHist.map(ym => celdaHist(cobrado.get(ym) || 0)).join('')}<td></td></tr>`;
    const tablaHist = `<div class="table-wrap"><table><thead><tr>${thHist}</tr></thead><tbody>${filasHist}${filaTotalG}${filaCobrado}</tbody></table></div>`;

    // ======== B) Préstamos entre proyectos (cómo van hoy; mismos netos que Resumen Ejecutivo) ========
    const netos = calcularSaldosNetosPrestamos('');
    const prestamosVivos = netos.reduce((s, p) => s + Math.abs(p.neto), 0);
    const bloquePrest = netos.length
      ? `<div style="max-width:560px;">${netos.slice().sort((x, y) => Math.abs(y.neto) - Math.abs(x.neto)).map(sn => {
          const deudor = sn.neto > 0 ? sn.b : sn.a;
          const acreedor = sn.neto > 0 ? sn.a : sn.b;
          return `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;"><span><b>${escapeHtml(deudor)}</b> le debe a <b>${escapeHtml(acreedor)}</b></span><span style="font-family:'DM Mono',monospace;font-weight:700;">${fmt(Math.abs(sn.neto))}</span></div>`;
        }).join('')}</div>`
      : `<div style="font-size:12px;color:var(--muted);">Sin préstamos vivos entre proyectos.</div>`;

    // ======== C) Necesidad de fondeo (deficit del motor = colchón − flujo acumulado) ========
    const necesidadDe = tl => tl.reduce((mx, t) => Math.max(mx, t.deficit || 0), 0);
    const necPorProyecto = new Map(proy.proyectos.map(p => {
      const primera = p.timeline.find(t => (t.deficit || 0) > 0) || null;
      return [p.nombre, { nec: necesidadDe(p.timeline), desde: primera ? primera.mes : null }];
    }));
    const necesidadTotal = [...necPorProyecto.values()].reduce((s, x) => s + x.nec, 0);
    const primeraNec = proy.proyectos
      .map(p => { const t = p.timeline.find(x => (x.deficit || 0) > 0); return t ? { proyecto: p.nombre, mes: t.mes, i: t.i, deficit: t.deficit } : null; })
      .filter(Boolean).sort((a, b) => a.i - b.i)[0] || null;
    const cobrosEsp = cons.timeline.reduce((s, t) => s + t.entradas, 0);

    // ---- KPIs ----
    const kpi = (label, valor, sub, color) =>
      `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value ${color || 'stat-accent'}" style="font-size:20px;">${valor}</div><div class="stat-sub">${sub}</div></div>`;
    const kpis = `<div class="stats-row">` +
      kpi('Gasto real promedio/mes', gastoPromMes ? fmt(gastoPromMes) : '—', `Regla del reporte JP · últimos ${mesesCompletos.length} meses completos`, 'stat-orange') +
      kpi(`Necesidad de fondeo (${H}m)`, necesidadTotal > 0 ? fmt(necesidadTotal) : '—', necesidadTotal > 0 ? 'Σ por proyecto · a cubrir con aportación, préstamo o disposición' : 'Ningún proyecto necesita fondeo externo', necesidadTotal > 0 ? 'stat-orange' : 'stat-green') +
      kpi('Primer mes con necesidad', primeraNec ? primeraNec.mes : '—', primeraNec ? `${escapeHtml(primeraNec.proyecto)} · ${fmt(primeraNec.deficit)} ese mes` : 'Sin necesidades en el horizonte', primeraNec ? 'stat-orange' : 'stat-green') +
      kpi(`Cobros esperados (${H}m)`, fmt(cobrosEsp), 'Del motor de score (esperanza, no promesa)', 'stat-green') +
      kpi('Préstamos vivos', prestamosVivos > 0 ? fmt(prestamosVivos) : '—', netos.length ? `${netos.length} par(es) de proyectos · detalle abajo` : 'Sin deuda entre proyectos', 'stat-purple') +
      `</div>`;

    // ---- Matriz proyectos × meses (flujo NETO del mes; rojo = consume caja) ----
    const celda = t => {
      const neto = t.entradas - t.salidas;
      if (Math.abs(neto) < 0.005) return `<td style="font-size:12px;text-align:right;color:var(--muted);">—</td>`;
      const estilo = neto < 0 ? 'background:rgba(224,90,90,.16);color:var(--red);font-weight:700;' : 'color:var(--green);';
      return `<td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;${estilo}" title="Entra ${fmt(t.entradas)} · Sale ${fmt(t.salidas)} (burn ${fmt(t.burn)} + interés ${fmt(t.interes)} + obra ${fmt(t.obra)})">${fmt(neto)}</td>`;
    };
    const th = `<th style="${stickyTd}text-align:left;">Proyecto</th>` + proy.meses.map(m => `<th style="text-align:right;">${m}</th>`).join('') + `<th style="text-align:right;">Necesidad ${H}m</th>`;
    const filas = proy.proyectos.map((p, idx) => {
      const abierto = _simProyAbierto.has(p.nombre);
      const np = necPorProyecto.get(p.nombre) || { nec: 0, desde: null };
      const celNec = np.nec > 0
        ? `<td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;color:var(--red);font-weight:700;" title="Fondeo externo necesario en el horizonte (incluye el colchón)${np.desde ? ` · desde ${np.desde}` : ''}">${fmt(np.nec)}</td>`
        : `<td style="font-size:12px;text-align:right;color:var(--green);">—</td>`;
      const primera = `<td style="${stickyTd}cursor:pointer;white-space:nowrap;" onclick="simToggleProyecto(${idx})"><span style="color:var(--muted);">${abierto ? '▾' : '▸'}</span> ${escapeHtml(p.nombre)}</td>`;
      const fila = `<tr>${primera}${p.timeline.map(celda).join('')}${celNec}</tr>`;
      if (!abierto) return fila;
      const desg = `<tr><td colspan="${H + 2}" style="background:var(--surface2);padding:10px 14px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px;">Desglose mensual — ${escapeHtml(p.nombre)} · flujo acumulado desde 0 (lo que quede bajo el colchón es lo que hay que fondear)</div>
        <div class="table-wrap"><table><thead><tr><th>Mes</th><th style="text-align:right">Entradas</th><th style="text-align:right">Burn</th><th style="text-align:right">Interés</th><th style="text-align:right">Obra</th><th style="text-align:right">Flujo acum.</th><th style="text-align:right">Colchón</th></tr></thead><tbody>
        ${p.timeline.map(t => `<tr${(t.deficit || 0) > 0 ? ' style="color:var(--red);"' : ''}><td>${t.mes}</td><td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(t.entradas)}</td><td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(t.burn)}</td><td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(t.interes)}</td><td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(t.obra)}</td><td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;">${fmt(t.saldoFinal)}</td><td style="text-align:right;font-family:'DM Mono',monospace;color:var(--muted);">${fmt(t.colchon)}</td></tr>`).join('')}
        </tbody></table></div></td></tr>`;
      return fila + desg;
    }).join('');
    const necCons = necesidadDe(cons.timeline);
    const filaCons = `<tr style="font-weight:700;border-top:2px solid var(--border);"><td style="${stickyTd}">Consolidado</td>${cons.timeline.map(celda).join('')}<td style="font-family:'DM Mono',monospace;font-size:12px;text-align:right;color:var(--muted);" title="Neteado entre proyectos (como si la caja fuera compartida); la cifra operativa es la suma por proyecto de arriba">${necCons > 0 ? fmt(necCons) : '—'}</td></tr>`;
    const tabla = `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${filas}${filaCons}</tbody></table></div>`;

    // ======== D) Sugerencia de fondeo (Pieza B — quién le presta a quién) ========
    // try/catch propio: si el sugeridor falla, las secciones A-C sobreviven.
    let secD = '';
    let sugSupuestos = [];
    try {
      const nombresProy = proy.proyectos.map(p => p.nombre);
      const deudaViva = _deudaVivaCanon(netos, nombresProy);
      const capacidadCredito = _creditosActivos()
        .map(c => ({ proyecto: canon(c.proyecto), credito: `${c.nombre || ('Crédito ' + c.credito_id)}${c.banco ? ' – ' + c.banco : ''}`, disponible: _disponibleCredito(c), tasaMes: (c.tasa_base || 0) / 100 / 12 }))
        .filter(c => c.disponible > 0.5);
      const sug = sugerirFondeo({ proyectos: proy.proyectos, deudaViva, capacidadCredito }, cfg);
      sugSupuestos = sug.supuestos || [];

      const tituloD = secTitulo('var(--green)', `Sugerencia de fondeo — quién le presta a quién (${H} meses)`);
      if (!sug.sugerencias.length) {
        secD = tituloD + `<div style="font-size:12px;color:var(--green);">✓ La proyección no detecta necesidades de fondeo en el horizonte.</div>`;
      } else {
        const chips = `<div class="stats-row">` +
          kpi('Fondeo sugerido', sug.totales.cubierto > 0 ? fmt(sug.totales.cubierto) : '—',
            `🔄 ${fmt(sug.totales.devoluciones)} · 🤝 ${fmt(sug.totales.prestamos)} · 🏦 ${fmt(sug.totales.disposiciones)}`, 'stat-blue') +
          kpi('Sin cubrir (socios)', sug.totales.sinCubrir > 0 ? fmt(sug.totales.sinCubrir) : '—',
            sug.totales.sinCubrir > 0 ? 'Requiere aportación de socios' : 'Todo cubierto con fondeo interno y crédito',
            sug.totales.sinCubrir > 0 ? 'stat-orange' : 'stat-green') +
          (sug.totales.disposiciones > 0 ? kpi('Costo de disposición', fmt(sug.totales.costoDisposicionMes) + '/mes', 'Interés estimado de lo dispuesto sugerido', 'stat-purple') : '') +
          `</div>`;

        const ICON = { devolucion: '🔄', prestamo: '🤝', disposicion: '🏦', sin_cubrir: '⚠️' };
        const labelDe = s =>
          s.tipo === 'devolucion' ? `<b>${escapeHtml(s.de)}</b> le devuelve a <b>${escapeHtml(s.para)}</b>` :
          s.tipo === 'prestamo' ? `<b>${escapeHtml(s.de)}</b> le presta a <b>${escapeHtml(s.para)}</b>` :
          s.tipo === 'disposicion' ? `<b>${escapeHtml(s.para)}</b> dispone de «${escapeHtml(s.credito || '')}»` :
          `<b>${escapeHtml(s.para)}</b> requiere aportación de socios`;
        const porMes = new Map();
        sug.sugerencias.forEach(s => { if (!porMes.has(s.mes)) porMes.set(s.mes, []); porMes.get(s.mes).push(s); });
        const listaMeses = [...porMes.entries()].map(([mes, items]) => {
          const totMes = items.reduce((x, s) => x + s.monto, 0);
          const filasS = items.map(s => `<details style="border-bottom:1px solid var(--border);padding:4px 0;">
            <summary style="cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:12px;list-style:none;">
              <span>${ICON[s.tipo]} ${labelDe(s)}${s.tipo === 'disposicion' ? ` <span style="font-size:10px;color:var(--muted);">costo ≈ ${fmt(s.costoMes)}/mes</span>` : ''}</span>
              <span style="font-family:'DM Mono',monospace;font-weight:700;white-space:nowrap;${s.tipo === 'sin_cubrir' ? 'color:var(--orange);' : ''}">${fmt(s.monto)}</span>
            </summary>
            <div style="font-size:11px;color:var(--muted);padding:4px 0 6px 22px;">${escapeHtml(s.porque)}</div>
          </details>`).join('');
          return `<div style="margin-bottom:12px;"><div style="font-size:11px;font-weight:700;margin-bottom:2px;">${mes} <span style="color:var(--muted);font-weight:400;">· ${fmt(totMes)}</span></div>${filasS}</div>`;
        }).join('');

        const filasRes = sug.resumen.map(r => `<tr>
          <td style="white-space:nowrap;">${escapeHtml(r.proyecto)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${r.recibe.total > 0.5 ? fmt(r.recibe.total) : '—'}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${r.da.total > 0.5 ? fmt(r.da.total) : '—'}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${r.recibe.disposicion > 0.5 ? fmt(r.recibe.disposicion) : '—'}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--muted);">${r.costoDisposicionMes > 0.5 ? fmt(r.costoDisposicionMes) : '—'}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;${r.sinCubrir > 0.5 ? 'color:var(--orange);font-weight:700;' : ''}">${r.sinCubrir > 0.5 ? fmt(r.sinCubrir) : '—'}</td></tr>`).join('');
        const tablaRes = `<div class="table-wrap" style="margin-top:10px;max-width:860px;"><table><thead><tr><th>Proyecto</th><th style="text-align:right">Recibe</th><th style="text-align:right">Presta/Devuelve</th><th style="text-align:right">Dispone</th><th style="text-align:right">Costo disp./mes</th><th style="text-align:right">Socios</th></tr></thead><tbody>${filasRes}</tbody></table></div>`;

        secD = tituloD + chips + `<div style="max-width:860px;">${listaMeses}</div>` + tablaRes +
          `<div style="font-size:11px;color:var(--muted);margin-top:8px;">Esto es una <b>sugerencia</b> — no mueve dinero. Ejecuta los movimientos que decidas con la herramienta de Traspasos.</div>`;
      }
    } catch (e) {
      console.error('sugeridorFondeo', e);
      secD = secTitulo('var(--green)', 'Sugerencia de fondeo') + '<div style="font-size:12px;color:var(--muted);">La sugerencia de fondeo no pudo calcularse; el resto de la página no está afectado.</div>';
    }

    // ---- Supuestos ----
    const supuestos = `<details style="margin-top:16px;"><summary style="cursor:pointer;font-size:11px;color:var(--muted);">Ver supuestos del modelo</summary>
      <div style="padding:10px 14px;border:1px solid var(--border);border-radius:10px;margin-top:8px;max-width:680px;font-size:11px;color:var(--muted);">
      <div style="padding:2px 0;">• Sin saldos bancarios: la proyección parte de 0 y mide FLUJO; la "necesidad" es lo que falta por fondear (incluye el colchón)</div>
      <div style="padding:2px 0;">• Gasto real = regla del reporte JP: Pagos + Aportaciones + Créditos solo intereses (Traspasos y Préstamos NO)</div>
      <div style="padding:2px 0;">• Préstamos entre proyectos: mismos netos que el Resumen Ejecutivo</div>
      ${proy.supuestos.map(s => `<div style="padding:2px 0;">• ${escapeHtml(s)}</div>`).join('')}
      ${sugSupuestos.map(s => `<div style="padding:2px 0;">• ${escapeHtml(s)}</div>`).join('')}
      ${burnRaw ? '' : '<div style="padding:6px 0 0;color:var(--orange);">⚠ Configura direccion.partidas_fijas en Configuración para activar el burn fijo y el colchón.</div>'}
      </div></details>`;

    const intro = `<div style="font-size:11px;color:var(--muted);margin-bottom:14px;max-width:820px;">Esta página NO usa los saldos bancarios capturados: todo sale de <b>registros</b> — el gasto real (regla del reporte JP), los cobros reales y los préstamos entre proyectos. La proyección estima cuánto <b>fondeo externo</b> (aportación, préstamo interno o disposición de crédito) necesitará cada proyecto y desde cuándo. La obra se secuencia por prioridad (score) y no se frena por falta de caja: así la necesidad se ve completa. Toca un proyecto para ver su desglose mensual.</div>`;

    el.innerHTML = kpis + intro
      + secTitulo('var(--accent)', 'Gasto real por mes — de los registros (regla del reporte JP)')
      + tablaHist
      + secTitulo('var(--purple)', 'Préstamos entre proyectos — cómo van hoy')
      + bloquePrest
      + secTitulo('var(--blue)', `Proyección — ¿cuánto se va a necesitar? (${H} meses)`)
      + tabla
      + secD
      + supuestos;
  } catch (e) {
    console.error('renderSimuladorCaja', e);
    el.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">💧</div><div>El presupuesto de caja no pudo calcularse; la operación no está afectada.</div></div>';
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

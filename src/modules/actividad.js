// ===== 📈 ACTIVIDAD DEL EQUIPO (solo admin) =====
// Lee el registro del SERVIDOR (actividad_log, llenado por triggers de Postgres
// — SQL 35): quién creó/modificó/borró qué y cuándo. Se consulta BAJO DEMANDA
// al abrir la página; nada corre en el arranque ni en realtime. El candado real
// es la policy is_admin() en la base (a un no-admin la query le regresa vacío).
//
// Día específico / rango (SQL 41): las RPCs actividad_resumen_rango y
// actividad_por_dia agregan cota superior y desglose por día (en hora de
// México). Sin el 41 corrido, las ventanas clásicas siguen funcionando y el
// rango avisa qué correr. El reporte imprimible usa window.print() → "Guardar
// como PDF" del navegador: cero librerías nuevas.

import { esAdmin, state } from '../state.js';
import { escapeHtml } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { sbRpc, sbActividadReciente, sbActividadDepurar } from '../services/supabase-data.js';

const TABLA_LABEL = {
  facturas: 'Facturas', factura_pagos: 'Pagos a facturas', historial: 'Pagos',
  traspasos: 'Traspasos', presupuesto_unidad: 'Presupuestos',
  costo_asignaciones: 'Repartos', unidades: 'Casas'
};
const OP_LABEL = { INSERT: 'nuevas', UPDATE: 'modificadas', DELETE: 'eliminadas' };
const V_LABEL = { '1h': 'la última hora', hoy: 'hoy', '7d': 'los últimos 7 días' };
const MAX_DIAS_RANGO = 31;

let actVentana = 'hoy';   // '1h' | 'hoy' | '7d' | 'rango'
let actDesde = '';        // YYYY-MM-DD (solo ventana 'rango')
let actHasta = '';        // YYYY-MM-DD (vacío = mismo día que actDesde)
let actUsuariosSel = null;   // Set de llaves de persona para el reporte; null = todos
let _actListaCache = [];     // personas del último render (para el selector y el PDF)

// "Hoy" = medianoche LOCAL (no UTC): a las 8pm de aquí un corte UTC ya sería mañana.
function _desdeISO(v) {
  const d = new Date();
  if (v === '1h') d.setHours(d.getHours() - 1);
  else if (v === '7d') { d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); }
  else d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Cotas [desde, hasta) del filtro actual, en ISO. Para las ventanas clásicas la
// cota superior es "ahora"; para el rango, la medianoche del día siguiente.
function _cotasISO() {
  if (actVentana !== 'rango') return { desdeISO: _desdeISO(actVentana), hastaISO: new Date().toISOString() };
  const d = new Date(actDesde + 'T00:00:00');
  const h = new Date((actHasta || actDesde) + 'T00:00:00');
  h.setDate(h.getDate() + 1);
  return { desdeISO: d.toISOString(), hastaISO: h.toISOString() };
}

function _etiquetaVentana() {
  if (actVentana !== 'rango') return V_LABEL[actVentana];
  const f = ymd => new Date(ymd + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  return (!actHasta || actHasta === actDesde) ? `el ${f(actDesde)}` : `del ${f(actDesde)} al ${f(actHasta)}`;
}

export function actSetVentana(v) {
  actVentana = v;
  actUsuariosSel = null;
  renderActividad();
}

// Aplica el día / rango de los inputs de fecha. Solo "Desde" = ese día exacto.
export function actAplicarRango() {
  let d = (document.getElementById('act-desde') || {}).value || '';
  let h = (document.getElementById('act-hasta') || {}).value || '';
  if (!d && h) { d = h; h = ''; }
  if (!d) { notify('Elige al menos el día "Desde"', 'error'); return; }
  if (h && h < d) { const t = d; d = h; h = t; }   // venían volteados: se corrigen solos
  const dias = h ? Math.round((new Date(h + 'T00:00:00') - new Date(d + 'T00:00:00')) / 86400000) + 1 : 1;
  if (dias > MAX_DIAS_RANGO) { notify(`El rango máximo es de ${MAX_DIAS_RANGO} días (elegiste ${dias})`, 'error'); return; }
  actDesde = d; actHasta = h;
  actVentana = 'rango';
  actUsuariosSel = null;
  renderActividad();
}

export function actToggleUsuario(k, on) {
  if (!actUsuariosSel) actUsuariosSel = new Set(_actListaCache.map(p => p.k));
  if (on) actUsuariosSel.add(k); else actUsuariosSel.delete(k);
  const btn = document.getElementById('act-btn-pdf');
  if (btn) btn.disabled = actUsuariosSel.size === 0;
}

export async function actDepurar() {
  if (!esAdmin()) return;
  if (!confirm('¿Borrar del registro la actividad con más de 90 días?\n\n(El registro sigue funcionando; solo se limpia lo viejo.)')) return;
  const { error } = await sbActividadDepurar(90);
  if (error) { notify('No se pudo depurar: ' + (error.message || ''), 'error'); return; }
  notify('Registro depurado (se quitó lo de hace más de 90 días)');
  renderActividad();
}

export async function renderActividad() {
  const cont = document.getElementById('lista-actividad');
  if (!cont) return;
  if (!esAdmin()) {
    cont.innerHTML = '<div class="empty-state"><div style="font-size:28px;opacity:.4;margin-bottom:8px;">🔒</div><div>Sección disponible solo para el administrador.</div></div>';
    return;
  }
  cont.innerHTML = '<div class="empty-state">Cargando actividad…</div>';

  const esRango = actVentana === 'rango';
  const { desdeISO, hastaISO } = _cotasISO();
  const [res, fee, dia] = await Promise.all([
    esRango ? sbRpc('actividad_resumen_rango', { desde: desdeISO, hasta: hastaISO })
      : sbRpc('actividad_resumen', { desde: desdeISO }),
    esRango ? sbActividadReciente(50, desdeISO, hastaISO) : sbActividadReciente(50),
    esRango ? sbRpc('actividad_por_dia', { desde: desdeISO, hasta: hastaISO }) : Promise.resolve({ data: null })
  ]);
  if (res.error || fee.error || (esRango && dia.error)) {
    const err = res.error || fee.error || dia.error;
    const msg = err.message || String(err);
    const sql = esRango ? '41_actividad_rango.sql' : '35_actividad_log.sql';
    cont.innerHTML = `<div class="empty-state">⚠ No pude leer el registro de actividad.<br>
      <span style="font-size:11px;color:var(--muted);">${escapeHtml(msg)}<br><br>
      Si es la primera vez que usas ${esRango ? 'el filtro por fechas' : 'esta página'}: corre <b>supabase/schema/${sql}</b> en el SQL Editor de Supabase y vuelve a intentar.</span>
      ${esRango ? '<br><button class="btn btn-ghost btn-sm" onclick="actSetVentana(\'hoy\')">Volver a Hoy</button>' : ''}</div>`;
    return;
  }
  const filas = res.data || [];
  const feed = fee.data || [];
  const porDia = (dia && dia.data) || [];

  // Agrupar por persona (user_id); si alguien cambió de correo, gana el más reciente.
  const personas = new Map();
  filas.forEach(f => {
    const k = String(f.user_id || f.email || '?');
    let p = personas.get(k);
    if (!p) { p = { k, email: f.email || '(sin correo)', rol: f.rol || '', total: 0, ultima: null, porTabla: new Map() }; personas.set(k, p); }
    if (f.ultima && (!p.ultima || f.ultima > p.ultima)) { p.ultima = f.ultima; if (f.email) p.email = f.email; if (f.rol) p.rol = f.rol; }
    p.total += +f.n || 0;
    const t = p.porTabla.get(f.tabla) || { INSERT: 0, UPDATE: 0, DELETE: 0 };
    t[f.operacion] = (t[f.operacion] || 0) + (+f.n || 0);
    p.porTabla.set(f.tabla, t);
  });
  const lista = [...personas.values()].sort((a, b) => b.total - a.total);
  _actListaCache = lista;

  const fmtHora = iso => {
    try { return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return iso || ''; }
  };
  const btnV = (id, txt) => `<button class="btn btn-sm ${actVentana === id ? 'btn-primary' : 'btn-ghost'}" onclick="actSetVentana('${id}')">${txt}</button>`;
  const etiqueta = _etiquetaVentana();

  const tarjetas = lista.length ? lista.map(p => `
    <div class="stat-card" style="text-align:left;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap;">
        <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;max-width:100%;">${escapeHtml(p.email)}</div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">${escapeHtml(p.rol)}</div>
      </div>
      <div style="font-size:26px;font-weight:700;color:var(--accent);margin:4px 0;">${p.total}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">movimiento(s) en ${escapeHtml(etiqueta)} · último: ${fmtHora(p.ultima)}</div>
      ${[...p.porTabla].map(([t, ops]) => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:1px 0;">
        <span>${escapeHtml(TABLA_LABEL[t] || t)}</span>
        <span style="font-family:'DM Mono',monospace;color:var(--muted);">${['INSERT', 'UPDATE', 'DELETE'].filter(o => ops[o]).map(o => `${ops[o]} ${OP_LABEL[o]}`).join(' · ') || '—'}</span>
      </div>`).join('')}
    </div>`).join('')
    : `<div class="empty-state" style="grid-column:1/-1;"><div style="font-size:28px;opacity:.5;margin-bottom:8px;">😴</div><div>Nadie ha capturado nada en ${escapeHtml(etiqueta)}.</div></div>`;

  // Selector de personas para el reporte (todas marcadas por default).
  const selHTML = lista.length ? `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;font-size:12px;">
      <span style="color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-size:10px;">Reporte de:</span>
      ${lista.map(p => `<label style="display:flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap;">
        <input type="checkbox" ${(!actUsuariosSel || actUsuariosSel.has(p.k)) ? 'checked' : ''} onchange="actToggleUsuario('${escapeHtml(p.k)}', this.checked)" style="accent-color:var(--accent);">
        ${escapeHtml((p.email || '').split('@')[0])}
      </label>`).join('')}
      <button id="act-btn-pdf" class="btn btn-ghost btn-sm" onclick="actReportePDF()" title="Abre el reporte formateado; usa 'Guardar como PDF' del diálogo de impresión">🖨 Reporte PDF</button>
    </div>` : '';

  // Tabla por día (solo con rango): días × personas, incluidos los CEROS del fin
  // de semana — que es justo lo que la ventana de 7 días escondía.
  let porDiaHTML = '';
  if (esRango) {
    // OJO: nada de toISOString() aquí — es UTC y corre el día (medianoche local
    // de México en ISO es el día ANTERIOR a las 18:00). Formato local a mano.
    const ymdLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const diasRango = [];
    for (let d = new Date(actDesde + 'T00:00:00'), fin = new Date((actHasta || actDesde) + 'T00:00:00'); d <= fin; d.setDate(d.getDate() + 1)) {
      diasRango.push(ymdLocal(d));
    }
    const celda = new Map();   // dia|k → { total, detalle }
    porDia.forEach(f => {
      const k = String(f.user_id || f.email || '?');
      const kk = `${f.dia}|${k}`;
      let c = celda.get(kk);
      if (!c) { c = { total: 0, det: [] }; celda.set(kk, c); }
      c.total += +f.n || 0;
      c.det.push(`${TABLA_LABEL[f.tabla] || f.tabla}: ${f.n} ${OP_LABEL[f.operacion] || f.operacion}`);
    });
    const fmtDia = ymd => new Date(ymd + 'T00:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' });
    const esFinde = ymd => { const dw = new Date(ymd + 'T00:00:00').getDay(); return dw === 0 || dw === 6; };
    porDiaHTML = `
      <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;margin-bottom:8px;">Movimientos por día</div>
      <div class="table-wrap" style="margin-bottom:22px;">
        <table>
          <thead><tr><th>Día</th>${lista.map(p => `<th style="text-align:right;">${escapeHtml((p.email || '').split('@')[0])}</th>`).join('')}<th style="text-align:right;">Total</th></tr></thead>
          <tbody>${diasRango.map(ymd => {
            let totDia = 0;
            const celdas = lista.map(p => {
              const c = celda.get(`${ymd}|${p.k}`);
              totDia += c ? c.total : 0;
              return `<td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:${c ? 'var(--text)' : 'var(--border)'};" ${c ? `title="${escapeHtml(c.det.join(' · '))}"` : ''}>${c ? c.total : '—'}</td>`;
            }).join('');
            return `<tr${esFinde(ymd) ? ' style="opacity:.65;"' : ''}>
              <td style="font-size:12px;white-space:nowrap;${esFinde(ymd) ? 'color:var(--muted);' : ''}">${escapeHtml(fmtDia(ymd))}</td>${celdas}
              <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;font-weight:700;">${totDia || '—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  }

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        ${btnV('1h', 'Última hora')}${btnV('hoy', 'Hoy')}${btnV('7d', '7 días')}
        <span style="color:var(--border);">|</span>
        <input type="date" id="act-desde" value="${escapeHtml(actDesde)}" title="Día (o inicio del rango)" style="font-size:11px;padding:3px 5px;">
        <span style="color:var(--muted);font-size:11px;">a</span>
        <input type="date" id="act-hasta" value="${escapeHtml(actHasta)}" title="Fin del rango (vacío = solo ese día)" style="font-size:11px;padding:3px 5px;">
        <button class="btn btn-sm ${actVentana === 'rango' ? 'btn-primary' : 'btn-ghost'}" onclick="actAplicarRango()" title="Ver un día específico o un rango (máx ${MAX_DIAS_RANGO} días)">Aplicar</button>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-ghost btn-sm" onclick="renderActividad()">🔄 Actualizar</button>
        <button class="btn btn-ghost btn-sm" onclick="actDepurar()" title="Borra del registro lo de hace más de 90 días (el registro sigue activo)">🧹 Depurar</button>
      </div>
    </div>
    ${selHTML}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:22px;">${tarjetas}</div>
    ${porDiaHTML}
    <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;margin-bottom:8px;">Últimos movimientos registrados${esRango ? ' (del periodo)' : ''}</div>
    ${feed.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Acción</th><th>Fila</th></tr></thead>
      <tbody>${feed.map(f => `<tr>
        <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);white-space:nowrap;">${fmtHora(f.ocurrido_en)}</td>
        <td style="font-size:12px;">${escapeHtml(f.email || '')}</td>
        <td style="font-size:12px;">${escapeHtml(TABLA_LABEL[f.tabla] || f.tabla)}</td>
        <td style="font-size:11px;white-space:nowrap;">${f.operacion === 'INSERT' ? '➕ creó' : f.operacion === 'UPDATE' ? '✏️ modificó' : `🗑 borró${(f.n_filas || 1) > 1 ? ` (${f.n_filas} filas)` : ''}`}</td>
        <td style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(String(f.fila_id || ''))}</td>
      </tr>`).join('')}</tbody></table></div>` : '<div style="color:var(--muted);font-size:12px;">Sin movimientos registrados aún (el registro empieza a llenarse desde que se corre el SQL 35).</div>'}
  `;
}

// ===== 🖨 Reporte imprimible (window.print → "Guardar como PDF") =============
// Resumen POR DÍA de cada usuario seleccionado, en el día/rango/ventana actual.
// Siempre consulta actividad_por_dia (SQL 41) al momento de generar: el reporte
// dice exactamente lo que hay en el registro, no lo que la pantalla cacheó.
export async function actReportePDF() {
  if (!esAdmin()) return;
  const sel = actUsuariosSel ? actUsuariosSel : new Set(_actListaCache.map(p => p.k));
  if (!sel.size) { notify('Selecciona al menos una persona para el reporte', 'error'); return; }

  const { desdeISO, hastaISO } = _cotasISO();
  const { data, error } = await sbRpc('actividad_por_dia', { desde: desdeISO, hasta: hastaISO });
  if (error) {
    notify('No pude armar el reporte: ' + (error.message || '') + ' — ¿ya corriste supabase/schema/41_actividad_rango.sql?', 'error');
    return;
  }

  // dia × persona × tabla → conteos por operación
  const porPersona = new Map();   // k → { email, rol, dias: Map(dia → Map(tabla → {I,U,D})), total }
  (data || []).forEach(f => {
    const k = String(f.user_id || f.email || '?');
    if (!sel.has(k)) return;
    let p = porPersona.get(k);
    if (!p) { p = { email: f.email || '(sin correo)', rol: f.rol || '', dias: new Map(), total: 0 }; porPersona.set(k, p); }
    if (f.email) p.email = f.email;
    let d = p.dias.get(f.dia);
    if (!d) { d = new Map(); p.dias.set(f.dia, d); }
    let t = d.get(f.tabla);
    if (!t) { t = { INSERT: 0, UPDATE: 0, DELETE: 0 }; d.set(f.tabla, t); }
    t[f.operacion] = (t[f.operacion] || 0) + (+f.n || 0);
    p.total += +f.n || 0;
  });

  const fmtDia = ymd => new Date(ymd + 'T00:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const hoyTxt = new Date().toLocaleString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const quien = (state.session && state.session.email) || '';
  const esc = escapeHtml;

  let granTotal = 0;
  const secciones = [..._actListaCache.filter(p => sel.has(p.k))].map(pc => {
    const p = porPersona.get(pc.k);
    if (!p) return `<section><h2>${esc(pc.email)} <small>${esc(pc.rol)}</small></h2><p class="vacio">Sin movimientos en el periodo.</p></section>`;
    granTotal += p.total;
    const dias = [...p.dias.keys()].sort();
    return `<section>
      <h2>${esc(p.email)} <small>${esc(p.rol)}</small></h2>
      <table>
        <thead><tr><th>Día</th><th>Qué</th><th class="num">Nuevas</th><th class="num">Modificadas</th><th class="num">Eliminadas</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${dias.map(ymd => {
            const tablas = [...p.dias.get(ymd)];
            return tablas.map(([tabla, ops], i) => {
              const tot = (ops.INSERT || 0) + (ops.UPDATE || 0) + (ops.DELETE || 0);
              return `<tr${i === 0 ? ' class="dia-inicio"' : ''}>
                <td>${i === 0 ? esc(fmtDia(ymd)) : ''}</td>
                <td>${esc(TABLA_LABEL[tabla] || tabla)}</td>
                <td class="num">${ops.INSERT || ''}</td><td class="num">${ops.UPDATE || ''}</td><td class="num">${ops.DELETE || ''}</td>
                <td class="num">${tot}</td>
              </tr>`;
            }).join('');
          }).join('')}
          <tr class="total"><td colspan="5">Total del periodo</td><td class="num">${p.total}</td></tr>
        </tbody>
      </table>
    </section>`;
  }).join('');

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>Actividad del equipo — DEHUR</title>
  <style>
    body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1a1a1a; margin: 32px; font-size: 12px; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    .sub { color: #555; margin-bottom: 4px; }
    .meta { color: #888; font-size: 10px; margin-bottom: 20px; }
    h2 { font-size: 14px; margin: 22px 0 6px; border-bottom: 2px solid #1a1a1a; padding-bottom: 3px; }
    h2 small { color: #777; font-weight: 400; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #666; border-bottom: 1px solid #bbb; padding: 4px 6px; }
    td { padding: 3px 6px; border-bottom: 1px solid #eee; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    th.num { text-align: right; }
    tr.dia-inicio td { border-top: 1px solid #ccc; }
    tr.total td { font-weight: 700; border-top: 2px solid #1a1a1a; border-bottom: none; }
    .gran-total { margin-top: 18px; font-size: 13px; font-weight: 700; text-align: right; }
    .vacio { color: #888; font-style: italic; }
    .nota { margin-top: 24px; color: #999; font-size: 9px; }
    section { break-inside: avoid; }
    @media print { body { margin: 12mm; } }
  </style></head><body>
    <h1>Actividad del equipo</h1>
    <div class="sub">DEHUR · movimientos ${esc(_etiquetaVentana())}</div>
    <div class="meta">Generado el ${esc(hoyTxt)}${quien ? ' por ' + esc(quien) : ''} · fuente: registro de auditoría del servidor</div>
    ${secciones}
    <div class="gran-total">Total general (${sel.size} persona${sel.size === 1 ? '' : 's'}): ${granTotal} movimiento(s)</div>
    <div class="nota">El registro existe desde que se activó la auditoría (agosto 2026); días anteriores no tienen datos. "Nuevas / modificadas / eliminadas" cuentan filas registradas por los triggers del servidor — no se pueden alterar desde la aplicación.</div>
  <script>window.onload = () => setTimeout(() => window.print(), 150);</script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { notify('El navegador bloqueó la ventana del reporte; permite pop-ups para este sitio', 'error'); return; }
  w.document.write(html);
  w.document.close();
}

// ===== 📈 ACTIVIDAD DEL EQUIPO (solo admin) =====
// Lee el registro del SERVIDOR (actividad_log, llenado por triggers de Postgres
// — SQL 35): quién creó/modificó/borró qué y cuándo. Se consulta BAJO DEMANDA
// al abrir la página; nada corre en el arranque ni en realtime. El candado real
// es la policy is_admin() en la base (a un no-admin la query le regresa vacío).

import { esAdmin } from '../state.js';
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

let actVentana = 'hoy';   // '1h' | 'hoy' | '7d'

// "Hoy" = medianoche LOCAL (no UTC): a las 8pm de aquí un corte UTC ya sería mañana.
function _desdeISO(v) {
  const d = new Date();
  if (v === '1h') d.setHours(d.getHours() - 1);
  else if (v === '7d') { d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); }
  else d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function actSetVentana(v) {
  actVentana = v;
  renderActividad();
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

  const desde = _desdeISO(actVentana);
  const [res, fee] = await Promise.all([
    sbRpc('actividad_resumen', { desde }),
    sbActividadReciente(50)
  ]);
  if (res.error || fee.error) {
    const msg = (res.error || fee.error).message || String(res.error || fee.error);
    cont.innerHTML = `<div class="empty-state">⚠ No pude leer el registro de actividad.<br>
      <span style="font-size:11px;color:var(--muted);">${escapeHtml(msg)}<br><br>
      Si es la primera vez: corre <b>supabase/schema/35_actividad_log.sql</b> en el SQL Editor de Supabase y vuelve a intentar.</span></div>`;
    return;
  }
  const filas = res.data || [];
  const feed = fee.data || [];

  // Agrupar por persona (user_id); si alguien cambió de correo, gana el más reciente.
  const personas = new Map();
  filas.forEach(f => {
    const k = String(f.user_id || f.email || '?');
    let p = personas.get(k);
    if (!p) { p = { email: f.email || '(sin correo)', rol: f.rol || '', total: 0, ultima: null, porTabla: new Map() }; personas.set(k, p); }
    if (f.ultima && (!p.ultima || f.ultima > p.ultima)) { p.ultima = f.ultima; if (f.email) p.email = f.email; if (f.rol) p.rol = f.rol; }
    p.total += +f.n || 0;
    const t = p.porTabla.get(f.tabla) || { INSERT: 0, UPDATE: 0, DELETE: 0 };
    t[f.operacion] = (t[f.operacion] || 0) + (+f.n || 0);
    p.porTabla.set(f.tabla, t);
  });
  const lista = [...personas.values()].sort((a, b) => b.total - a.total);

  const fmtHora = iso => {
    try { return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return iso || ''; }
  };
  const btnV = (id, txt) => `<button class="btn btn-sm ${actVentana === id ? 'btn-primary' : 'btn-ghost'}" onclick="actSetVentana('${id}')">${txt}</button>`;

  const tarjetas = lista.length ? lista.map(p => `
    <div class="stat-card" style="text-align:left;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap;">
        <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;max-width:100%;">${escapeHtml(p.email)}</div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">${escapeHtml(p.rol)}</div>
      </div>
      <div style="font-size:26px;font-weight:700;color:var(--accent);margin:4px 0;">${p.total}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">movimiento(s) en ${V_LABEL[actVentana]} · último: ${fmtHora(p.ultima)}</div>
      ${[...p.porTabla].map(([t, ops]) => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:1px 0;">
        <span>${escapeHtml(TABLA_LABEL[t] || t)}</span>
        <span style="font-family:'DM Mono',monospace;color:var(--muted);">${['INSERT', 'UPDATE', 'DELETE'].filter(o => ops[o]).map(o => `${ops[o]} ${OP_LABEL[o]}`).join(' · ') || '—'}</span>
      </div>`).join('')}
    </div>`).join('')
    : `<div class="empty-state" style="grid-column:1/-1;"><div style="font-size:28px;opacity:.5;margin-bottom:8px;">😴</div><div>Nadie ha capturado nada en ${V_LABEL[actVentana]}.</div></div>`;

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="display:flex;gap:6px;">${btnV('1h', 'Última hora')}${btnV('hoy', 'Hoy')}${btnV('7d', '7 días')}</div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-ghost btn-sm" onclick="renderActividad()">🔄 Actualizar</button>
        <button class="btn btn-ghost btn-sm" onclick="actDepurar()" title="Borra del registro lo de hace más de 90 días (el registro sigue activo)">🧹 Depurar</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:22px;">${tarjetas}</div>
    <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;margin-bottom:8px;">Últimos movimientos registrados</div>
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

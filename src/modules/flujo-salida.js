import { state, datosListos } from '../state.js';
import { fmt, dl } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { proyTag } from '../ui/badges.js';
import { proyectoMatch } from '../config/proyectos.js';
import { parseFechaHist } from './historial.js';

const SIN_CUENTA = '(sin cuenta)';
const SIN_PROYECTO = '(sin proyecto)';
const PROY_INTERNO = '(Interno)';
let fsInitialized = false;

export function renderFlujoSalida() {
  const tabla = document.getElementById('fs-tabla');
  const cards = document.getElementById('fs-cards');
  if (!tabla || !cards) return;

  if (!datosListos()) {
    cards.innerHTML = '';
    tabla.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div>';
    const sub = document.getElementById('fs-subtitulo'); if (sub) sub.textContent = '';
    return;
  }

  initOnce();
  refreshSelects();

  const data = getFiltered();
  renderSubtitulo(data);
  renderCards(data);
  renderPivot(data);
}

function initOnce() {
  if (fsInitialized) return;
  setDefaultDates();
  ['fs-desde', 'fs-hasta', 'fs-cuenta', 'fs-proyecto', 'fs-solo-pagos'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderFlujoSalida);
  });
  document.getElementById('fs-reset')?.addEventListener('click', () => {
    setDefaultDates();
    const sc = document.getElementById('fs-cuenta'); if (sc) sc.value = '';
    const sp = document.getElementById('fs-proyecto'); if (sp) sp.value = '';
    const cb = document.getElementById('fs-solo-pagos'); if (cb) cb.checked = false;
    renderFlujoSalida();
  });
  document.getElementById('fs-btn-csv')?.addEventListener('click', exportarCsv);
  fsInitialized = true;
}

function setDefaultDates() {
  const hoy = new Date();
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const desde = document.getElementById('fs-desde');
  const hasta = document.getElementById('fs-hasta');
  if (desde) desde.value = primero.toISOString().slice(0, 10);
  if (hasta) hasta.value = hoy.toISOString().slice(0, 10);
}

function refreshSelects() {
  const selCuenta = document.getElementById('fs-cuenta');
  if (selCuenta) {
    const val = selCuenta.value;
    const fromHist = state.historial.map(h => h.cuenta_origen).filter(Boolean);
    const fromInt = (state.movimientosInternos || []).map(m => m.origen).filter(Boolean);
    const cuentas = [...new Set([...fromHist, ...fromInt])].sort((a, b) => a.localeCompare(b));
    selCuenta.innerHTML = '<option value="">Todas las cuentas</option>' + cuentas.map(c => `<option>${c}</option>`).join('');
    selCuenta.value = val;
  }
  const selProy = document.getElementById('fs-proyecto');
  if (selProy) {
    const val = selProy.value;
    const opts = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
    selProy.innerHTML = '<option value="">Todos los proyectos</option>' + opts.map(n => `<option>${n}</option>`).join('');
    selProy.value = val;
  }
}

function getFiltered() {
  const fd = document.getElementById('fs-desde')?.value || '';
  const fh = document.getElementById('fs-hasta')?.value || '';
  const fc = document.getElementById('fs-cuenta')?.value || '';
  const fp = document.getElementById('fs-proyecto')?.value || '';
  const soloPagos = !!document.getElementById('fs-solo-pagos')?.checked;

  const desdeHistorial = state.historial.filter(h => {
    if (!h.cuenta_origen) return false;
    return true;
  });

  // Mapear movimientosInternos a la misma forma que historial[] para fusionar.
  // Cada uno es una salida de su cuenta origen (la entrada en destino la lleva
  // un futuro modulo de entradas, no duplicamos aqui).
  const desdeInternos = (state.movimientosInternos || []).map(m => ({
    fecha: m.fecha,
    nombre: m.destino || '—',
    concepto: m.concepto || `${m.tipo || 'Interno'} a ${m.destino || ''}`.trim(),
    importe: +m.monto || 0,
    proyecto: PROY_INTERNO,
    banco: '',
    tipo: m.tipo || 'Interno',
    cuenta_origen: m.origen || '',
    tipo_registro: 'Interno',
    partida: '',
    sub_partida: '',
    _interno: true
  })).filter(h => !!h.cuenta_origen);

  const todo = [...desdeHistorial, ...desdeInternos];

  return todo.filter(h => {
    if (fc && h.cuenta_origen !== fc) return false;
    if (fp && !proyectoMatch(h.proyecto, fp) && h.proyecto !== fp) return false;
    if (soloPagos && h.tipo_registro !== 'Pago') return false;
    if (fd || fh) {
      const iso = parseFechaHist(h.fecha);
      if (fd && iso < fd) return false;
      if (fh && iso > fh) return false;
    }
    return true;
  });
}

function renderSubtitulo(data) {
  const sub = document.getElementById('fs-subtitulo');
  if (!sub) return;
  sub.textContent = `${data.length} movimiento${data.length === 1 ? '' : 's'} de salida`;
}

function renderCards(data) {
  const cards = document.getElementById('fs-cards');
  const total = data.reduce((a, h) => a + (+h.importe || 0), 0);
  const cuentas = new Set(data.map(h => h.cuenta_origen)).size;
  const proyectos = new Set(data.map(h => h.proyecto || SIN_PROYECTO)).size;
  cards.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total salidas</div><div class="stat-value" style="color:#e07a3a;">${fmt(total)}</div></div>
    <div class="stat-card"><div class="stat-label">Movimientos</div><div class="stat-value">${data.length}</div></div>
    <div class="stat-card"><div class="stat-label">Cuentas</div><div class="stat-value">${cuentas}</div></div>
    <div class="stat-card"><div class="stat-label">Proyectos</div><div class="stat-value">${proyectos}</div></div>
  `;
}

function buildPivot(data) {
  const cuentasSet = new Set();
  const proyectosSet = new Set();
  data.forEach(h => {
    cuentasSet.add(h.cuenta_origen || SIN_CUENTA);
    proyectosSet.add(h.proyecto || SIN_PROYECTO);
  });
  const cuentas = [...cuentasSet].sort((a, b) => {
    if (a === SIN_CUENTA) return 1;
    if (b === SIN_CUENTA) return -1;
    return a.localeCompare(b);
  });
  const proyectos = [...proyectosSet].sort((a, b) => {
    // (Interno) y (sin proyecto) siempre al final
    const aSpec = a === PROY_INTERNO || a === SIN_PROYECTO;
    const bSpec = b === PROY_INTERNO || b === SIN_PROYECTO;
    if (aSpec && !bSpec) return 1;
    if (!aSpec && bSpec) return -1;
    return a.localeCompare(b);
  });
  const matrix = {};
  cuentas.forEach(c => {
    matrix[c] = {};
    proyectos.forEach(p => { matrix[c][p] = { total: 0, count: 0, items: [] }; });
  });
  data.forEach(h => {
    const c = h.cuenta_origen || SIN_CUENTA;
    const p = h.proyecto || SIN_PROYECTO;
    const cell = matrix[c][p];
    cell.total += (+h.importe || 0);
    cell.count += 1;
    cell.items.push(h);
  });
  const totalsFila = {}; cuentas.forEach(c => { totalsFila[c] = proyectos.reduce((a, p) => a + matrix[c][p].total, 0); });
  const totalsCol = {}; proyectos.forEach(p => { totalsCol[p] = cuentas.reduce((a, c) => a + matrix[c][p].total, 0); });
  const granTotal = data.reduce((a, h) => a + (+h.importe || 0), 0);
  return { cuentas, proyectos, matrix, totalsFila, totalsCol, granTotal };
}

function renderPivot(data) {
  const cont = document.getElementById('fs-tabla');
  if (!data.length) {
    cont.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin salidas con los filtros actuales</div></div>';
    return;
  }
  const piv = buildPivot(data);
  // Guardamos referencia para que el handler de click pueda leer el detalle.
  window._fsPivot = piv;

  const tplCols = `220px repeat(${piv.proyectos.length}, minmax(130px, 1fr)) 150px`;
  const headerCellStyle = 'padding:10px 8px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;text-align:right;';
  const firstHeaderStyle = 'padding:10px 12px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;';
  const bodyCellStyle = 'padding:10px 8px;font-family:\'DM Mono\',monospace;font-size:12px;text-align:right;cursor:pointer;';
  const bodyFirstStyle = 'padding:10px 12px;font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const totalRowBg = 'background:var(--surface2);font-weight:600;';
  const totalColAccent = 'color:var(--accent);font-weight:600;';

  let html = '<div style="overflow-x:auto;">';
  html += `<div style="display:grid;grid-template-columns:${tplCols};min-width:max-content;">`;

  // Header
  html += `<div style="${firstHeaderStyle}background:var(--surface2);border-bottom:1px solid var(--border);">Cuenta de origen</div>`;
  piv.proyectos.forEach(p => {
    html += `<div style="${headerCellStyle}background:var(--surface2);border-bottom:1px solid var(--border);" title="${escapeAttr(p)}">${escapeHtml(p)}</div>`;
  });
  html += `<div style="${headerCellStyle}background:var(--surface2);border-bottom:1px solid var(--border);${totalColAccent}">Total cuenta</div>`;

  // Filas (cuentas)
  piv.cuentas.forEach((c, ri) => {
    const rowBg = ri % 2 === 0 ? '' : 'background:rgba(255,255,255,.02);';
    html += `<div style="${bodyFirstStyle}${rowBg}border-bottom:1px solid var(--border);" title="${escapeAttr(c)}">${escapeHtml(c)}</div>`;
    piv.proyectos.forEach(p => {
      const cell = piv.matrix[c][p];
      if (cell.count === 0) {
        html += `<div style="${bodyCellStyle.replace('cursor:pointer;', '')}${rowBg}border-bottom:1px solid var(--border);color:var(--muted);">—</div>`;
      } else {
        const tooltip = `${cell.count} mov · click para ver detalle`;
        html += `<div style="${bodyCellStyle}${rowBg}border-bottom:1px solid var(--border);" title="${tooltip}" onclick="window.fsAbrirDetalle('${encodeURIComponent(c)}','${encodeURIComponent(p)}')">${fmt(cell.total)}<div style="font-size:10px;color:var(--muted);font-weight:400;">${cell.count} mov</div></div>`;
      }
    });
    html += `<div style="${bodyCellStyle.replace('cursor:pointer;', '')}${rowBg}border-bottom:1px solid var(--border);${totalColAccent}">${fmt(piv.totalsFila[c])}</div>`;
  });

  // Fila totales
  html += `<div style="${bodyFirstStyle}${totalRowBg}border-top:2px solid var(--border);">TOTAL</div>`;
  piv.proyectos.forEach(p => {
    html += `<div style="${bodyCellStyle.replace('cursor:pointer;', '')}${totalRowBg}border-top:2px solid var(--border);">${fmt(piv.totalsCol[p])}</div>`;
  });
  html += `<div style="${bodyCellStyle.replace('cursor:pointer;', '')}${totalRowBg}border-top:2px solid var(--border);color:#e07a3a;font-size:13px;">${fmt(piv.granTotal)}</div>`;

  html += '</div></div>';
  cont.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

export function fsAbrirDetalle(cuentaEnc, proyectoEnc) {
  const c = decodeURIComponent(cuentaEnc);
  const p = decodeURIComponent(proyectoEnc);
  const piv = window._fsPivot;
  if (!piv) return;
  const items = piv.matrix[c]?.[p]?.items || [];
  if (!items.length) return;

  // Modal ligero inyectado al DOM (sigue patrón simple, sin dependencia externa).
  const ordenados = [...items].sort((a, b) => (parseFechaHist(b.fecha) || '').localeCompare(parseFechaHist(a.fecha) || ''));
  const total = ordenados.reduce((a, h) => a + (+h.importe || 0), 0);

  const filas = ordenados.map(h => {
    const tipoLabel = h.tipo_registro === 'Crédito' ? 'Crédito'
      : h.tipo_registro === 'Traspaso' ? (h.tipo === 'Préstamo' ? 'Préstamo' : (h.tipo || 'Traspaso'))
      : 'Pago';
    return `<div style="display:grid;grid-template-columns:90px 100px 1fr 1fr 130px;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px;align-items:center;">
      <div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${escapeHtml(h.fecha || '')}</div>
      <div><span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(200,169,110,.15);color:#C8A96E;">${escapeHtml(tipoLabel)}</span></div>
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeAttr(h.nombre || '')}">${escapeHtml(h.nombre || '—')}</div>
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:11px;" title="${escapeAttr(h.concepto || '')}">${escapeHtml(h.concepto || '—')}</div>
      <div style="font-family:'DM Mono',monospace;text-align:right;color:var(--accent);font-weight:500;">${fmt(+h.importe || 0)}</div>
    </div>`;
  }).join('');

  let modal = document.getElementById('fs-modal-detalle');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'fs-modal-detalle';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;max-width:1100px;width:100%;max-height:85vh;display:flex;flex-direction:column;">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">Detalle de salidas</div>
          <div style="font-size:14px;font-weight:600;margin-top:2px;">${escapeHtml(c)} → ${proyTag(p === SIN_PROYECTO ? '' : p)} <span style="margin-left:4px;">${p === SIN_PROYECTO ? escapeHtml(p) : ''}</span></div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px;">${items.length} movimiento${items.length === 1 ? '' : 's'} · Total <span style="color:var(--accent);font-weight:600;">${fmt(total)}</span></div>
        </div>
        <button class="btn btn-ghost" onclick="window.fsCerrarDetalle()">✕ Cerrar</button>
      </div>
      <div style="display:grid;grid-template-columns:90px 100px 1fr 1fr 130px;gap:10px;padding:10px 12px;background:var(--surface2);border-bottom:1px solid var(--border);font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">
        <div>Fecha</div><div>Tipo</div><div>Beneficiario</div><div>Concepto</div><div style="text-align:right;">Importe</div>
      </div>
      <div style="overflow:auto;flex:1;">${filas}</div>
    </div>
  `;
  modal.style.display = 'flex';
}

export function fsCerrarDetalle() {
  const modal = document.getElementById('fs-modal-detalle');
  if (modal) modal.style.display = 'none';
}

function exportarCsv() {
  const data = getFiltered();
  if (!data.length) { notify('Sin movimientos para exportar', 'error'); return; }
  const piv = buildPivot(data);
  const sep = ',';
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  let csv = ['Cuenta', ...piv.proyectos, 'Total cuenta'].map(esc).join(sep) + '\n';
  piv.cuentas.forEach(c => {
    const row = [esc(c)];
    piv.proyectos.forEach(p => row.push(piv.matrix[c][p].total.toFixed(2)));
    row.push(piv.totalsFila[c].toFixed(2));
    csv += row.join(sep) + '\n';
  });
  const totalRow = [esc('TOTAL')];
  piv.proyectos.forEach(p => totalRow.push(piv.totalsCol[p].toFixed(2)));
  totalRow.push(piv.granTotal.toFixed(2));
  csv += totalRow.join(sep) + '\n';

  const fd = document.getElementById('fs-desde')?.value || 'inicio';
  const fh = document.getElementById('fs-hasta')?.value || 'fin';
  dl(csv, `flujo_salida_${fd}_a_${fh}.csv`);
  notify(`Exportado: ${data.length} movimientos`);
}

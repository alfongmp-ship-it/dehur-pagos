import { state, datosListos } from '../state.js';
import { fmt, fmtFecha, escapeHtml } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { proyectoMatch } from '../config/proyectos.js';
import { parseFechaHist } from './historial.js';
import { getPartidasParaSelect } from '../config/sub-partidas.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { chartTheme } from '../ui/chart-theme.js';

let chartProyecto = null;
let chartTendencia = null;
let rcInitialized = false;
let rcPartidasSel = new Set();   // filtro de partidas MULTISELECCIÓN (vacío = todas)

const CARD_COLORS = ['#c8a96e', '#5a9be0', '#4caf7d', '#e07a3a', '#9b7fe8', '#3498db', '#27ae60', '#e05a5a'];

export function renderResumenCostos() {
  const tabla = document.getElementById('rc-tabla');
  const cards = document.getElementById('rc-cards');
  if (!tabla || !cards) return;

  if (!datosListos()) {
    cards.innerHTML = '';
    tabla.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div>';
    document.getElementById('rc-subtitulo').textContent = '';
    destruirCharts();
    return;
  }

  initOnce();

  const data = getFiltered();
  renderSubtitulo(data);
  renderCards(data);
  renderCharts(data);
  renderTendencia(data);
  renderTop5(data);
  renderListaPartidas(data);
  renderListaSubPartidas(data);
  renderTabla(data);
}

function destruirCharts() {
  if (chartProyecto) { chartProyecto.destroy(); chartProyecto = null; }
  if (chartTendencia) { chartTendencia.destroy(); chartTendencia = null; }
}

function initOnce() {
  refreshSelects();
  if (rcInitialized) return;
  setDefaultDates();
  ['rc-desde', 'rc-hasta', 'rc-proyecto'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderResumenCostos);
  });
  document.getElementById('rc-reset')?.addEventListener('click', () => {
    setDefaultDates();
    const sp = document.getElementById('rc-proyecto'); if (sp) sp.value = '';
    rcPartidasSel.clear();
    renderResumenCostos();
  });
  // Dropdown de partidas (multiselección): DELEGACIÓN sobre el contenedor — el
  // panel se reconstruye en cada render y los listeners delegados sobreviven.
  const dd = document.getElementById('rc-partida-dd');
  dd?.addEventListener('click', e => {
    if (e.target.closest('#rc-partida-btn')) {
      const panel = document.getElementById('rc-partida-panel');
      if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
    }
    if (e.target.closest('#rc-partida-limpiar')) {
      e.preventDefault();
      rcPartidasSel.clear();
      renderResumenCostos();
    }
  });
  dd?.addEventListener('change', e => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    if (cb.checked) rcPartidasSel.add(cb.value); else rcPartidasSel.delete(cb.value);
    renderResumenCostos();
  });
  // Clic fuera del dropdown lo cierra (es un filtro, no un modal con captura).
  document.addEventListener('click', e => {
    if (!e.target.closest('#rc-partida-dd')) {
      const panel = document.getElementById('rc-partida-panel');
      if (panel) panel.style.display = 'none';
    }
  });
  rcInitialized = true;
}

// Etiqueta del botón del filtro de partidas según la selección.
function _syncPartidaBtn() {
  const btn = document.getElementById('rc-partida-btn');
  if (!btn) return;
  const n = rcPartidasSel.size;
  const texto = n === 0 ? 'Todas las partidas' : (n === 1 ? [...rcPartidasSel][0] : `${n} partidas`);
  btn.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;">${escapeHtml(texto)}</span> <span style="font-size:9px;opacity:.6;">▼</span>`;
  btn.style.borderColor = n ? 'var(--accent)' : '';
}

function setDefaultDates() {
  const hoy = new Date();
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const desde = document.getElementById('rc-desde');
  const hasta = document.getElementById('rc-hasta');
  if (desde) desde.value = primero.toISOString().slice(0, 10);
  if (hasta) hasta.value = hoy.toISOString().slice(0, 10);
}

function refreshSelects() {
  const selProy = document.getElementById('rc-proyecto');
  if (selProy) {
    const val = selProy.value;
    const opts = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
    selProy.innerHTML = '<option value="">Todos los proyectos</option>' + opts.map(n => `<option>${escapeHtml(n)}</option>`).join('');
    selProy.value = val;
  }
  const panel = document.getElementById('rc-partida-panel');
  if (panel) {
    // Partidas del catálogo activo + legacy del historial (multiselección).
    const enHistorial = [...new Set(state.historial.map(h => h.partida).filter(Boolean))];
    const opts = getPartidasParaSelect(enHistorial).map(o => ({ value: o.value, label: o.label }));
    if (state.historial.some(h => !h.partida)) opts.push({ value: 'Sin partida', label: 'Sin partida' });
    // Depurar selecciones que ya no existen en el catálogo/historial.
    const validas = new Set(opts.map(o => o.value));
    [...rcPartidasSel].forEach(v => { if (!validas.has(v)) rcPartidasSel.delete(v); });
    panel.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:4px 8px 6px;border-bottom:1px solid var(--border);margin-bottom:4px;">
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);">Elige una o varias</span>
        <a href="#" id="rc-partida-limpiar" style="font-size:11px;color:var(--accent);text-decoration:none;">Limpiar</a>
      </div>` +
      opts.map(o => `<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:12px;">
        <input type="checkbox" value="${escapeHtml(o.value)}"${rcPartidasSel.has(o.value) ? ' checked' : ''} style="accent-color:var(--accent);flex-shrink:0;">
        <span>${escapeHtml(o.label)}</span></label>`).join('');
    _syncPartidaBtn();
  }
}

function filterHistorial(fd, fh, fp, fparts) {
  return state.historial.filter(h => {
    if (fp && !proyectoMatch(h.proyecto, fp)) return false;
    // fparts = array de partidas elegidas (vacío = todas).
    if (fparts && fparts.length && !fparts.includes(h.partida || 'Sin partida')) return false;
    if (fd || fh) {
      const iso = parseFechaHist(h.fecha);
      if (fd && iso < fd) return false;
      if (fh && iso > fh) return false;
    }
    return true;
  });
}

function getFiltered() {
  const fd = document.getElementById('rc-desde')?.value || '';
  const fh = document.getElementById('rc-hasta')?.value || '';
  const fp = document.getElementById('rc-proyecto')?.value || '';
  return filterHistorial(fd, fh, fp, [...rcPartidasSel]);
}

function shiftISODate(iso, deltaDays) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function calcVariacion(totalActual) {
  const fd = document.getElementById('rc-desde')?.value || '';
  const fh = document.getElementById('rc-hasta')?.value || '';
  const fp = document.getElementById('rc-proyecto')?.value || '';
  if (!fd || !fh) return null;
  const msDia = 86400000;
  const dias = Math.round((new Date(fh) - new Date(fd)) / msDia) + 1;
  const prevHasta = shiftISODate(fd, -1);
  const prevDesde = shiftISODate(fd, -dias);
  const prev = filterHistorial(prevDesde, prevHasta, fp, [...rcPartidasSel]);
  const totalPrev = prev.reduce((s, h) => s + (parseFloat(h.importe) || 0), 0);
  if (totalPrev <= 0) return { totalPrev: 0, delta: totalActual, pct: null };
  const delta = totalActual - totalPrev;
  return { totalPrev, delta, pct: (delta / totalPrev) * 100 };
}

function groupBy(arr, keyFn) {
  const out = {};
  for (const r of arr) {
    const k = keyFn(r);
    out[k] = (out[k] || 0) + (parseFloat(r.importe) || 0);
  }
  return out;
}

function renderSubtitulo(data) {
  const sub = document.getElementById('rc-subtitulo');
  if (!sub) return;
  if (data.length === state.historial.length) {
    sub.textContent = `${data.length} movimientos`;
  } else {
    sub.textContent = `${data.length} de ${state.historial.length} movimientos`;
  }
}

function renderCards(data) {
  const cards = document.getElementById('rc-cards');
  if (!cards) return;

  const total = data.reduce((s, h) => s + (parseFloat(h.importe) || 0), 0);

  const variacion = calcVariacion(total);
  let varValue, varSub, varColor;
  if (!variacion) {
    varValue = '—';
    varSub = 'Selecciona un rango de fechas';
    varColor = 'var(--muted)';
  } else if (variacion.pct === null) {
    varValue = variacion.delta > 0 ? '+∞%' : '—';
    varSub = `Sin datos previos · ${fmt(variacion.totalPrev)}`;
    varColor = 'var(--muted)';
  } else {
    const signo = variacion.pct >= 0 ? '+' : '';
    varValue = `${signo}${variacion.pct.toFixed(1)}%`;
    varSub = `${signo}${fmt(variacion.delta)} vs ${fmt(variacion.totalPrev)}`;
    varColor = variacion.pct >= 0 ? '#e05a5a' : '#4caf7d';
  }

  cards.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total General</div>
      <div class="stat-value stat-accent">${fmt(total)}</div>
      <div class="stat-sub">En el rango seleccionado</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Movimientos</div>
      <div class="stat-value stat-blue">${data.length}</div>
      <div class="stat-sub">Registros filtrados</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Variación vs periodo anterior</div>
      <div class="stat-value" style="font-size:18px;color:${varColor};">${varValue}</div>
      <div class="stat-sub">${varSub}</div>
    </div>
  `;
}

function renderTop5(data) {
  const cont = document.getElementById('rc-top5');
  if (!cont) return;
  const pagosReales = data.filter(h => h.tipo_registro === 'Pago');
  const total = pagosReales.reduce((s, h) => s + (parseFloat(h.importe) || 0), 0);
  const porBenef = groupBy(pagosReales, h => h.nombre || '—');
  const top = Object.entries(porBenef).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (!top.length || total <= 0) {
    cont.innerHTML = '<div class="empty-state" style="padding:20px 0;"><div style="font-size:28px;margin-bottom:8px;opacity:.4">👥</div><div style="font-size:12px;">Sin pagos en el rango</div></div>';
    return;
  }

  const maxMonto = top[0][1];
  cont.innerHTML = top.map(([nombre, monto], i) => {
    const pct = (monto / total) * 100;
    const barPct = (monto / maxMonto) * 100;
    const color = CARD_COLORS[i % CARD_COLORS.length];
    const nombreTrunc = nombre.length > 24 ? nombre.slice(0, 22) + '…' : nombre;
    return `
      <div title="${escapeHtml(nombre)}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;gap:8px;">
          <span style="font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(nombreTrunc)}</span>
          <span style="font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:${color};white-space:nowrap;">${fmt(monto)}</span>
        </div>
        <div style="height:6px;background:var(--surface2);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${barPct}%;background:${color};"></div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">${pct.toFixed(1)}% del total pagado</div>
      </div>
    `;
  }).join('');
}

function renderTendencia(data) {
  const canvas = document.getElementById('rc-chart-tendencia');
  if (!canvas) return;
  const wrapper = canvas.parentElement;

  if (chartTendencia) { chartTendencia.destroy(); chartTendencia = null; }

  if (!data.length) {
    canvas.style.display = 'none';
    let placeholder = wrapper.querySelector('.rc-empty-chart');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'rc-empty-chart empty-state';
      placeholder.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;';
      placeholder.innerHTML = '<div style="font-size:32px;margin-bottom:10px;opacity:.4">📈</div><div>Sin datos en el rango</div>';
      wrapper.appendChild(placeholder);
    }
    return;
  }
  const placeholder = wrapper.querySelector('.rc-empty-chart');
  if (placeholder) placeholder.remove();
  canvas.style.display = '';

  if (typeof Chart === 'undefined') return;

  // Agrupar por día ISO
  const porDia = {};
  for (const h of data) {
    const iso = parseFechaHist(h.fecha);
    if (!iso) continue;
    porDia[iso] = (porDia[iso] || 0) + (parseFloat(h.importe) || 0);
  }
  const dias = Object.keys(porDia).sort();
  if (!dias.length) return;

  // Rellenar días faltantes con 0 para que la línea sea continua
  const primero = dias[0];
  const ultimo = dias[dias.length - 1];
  const rango = [];
  const d0 = new Date(primero + 'T12:00:00');
  const dN = new Date(ultimo + 'T12:00:00');
  for (let d = new Date(d0); d <= dN; d.setDate(d.getDate() + 1)) {
    rango.push(d.toISOString().slice(0, 10));
  }

  const labels = rango.map(iso => {
    const [, m, dd] = iso.split('-');
    return `${dd}/${m}`;
  });
  const values = rango.map(iso => porDia[iso] || 0);

  const th = chartTheme();   // colores del tema ACTUAL (canvas no resuelve var(--...))
  const valueLabelsPlugin = {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.font = '600 10px "DM Mono", monospace';
      ctx.fillStyle = th.valueLabel;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      meta.data.forEach((point, i) => {
        const v = chart.data.datasets[0].data[i];
        if (!v) return;
        ctx.fillText(fmt(v), point.x, point.y - 6);
      });
      ctx.restore();
    }
  };

  chartTendencia = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Gasto diario',
        data: values,
        borderColor: th.gold,
        backgroundColor: th.goldFill,
        fill: true,
        tension: 0.25,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2
      }]
    },
    plugins: [valueLabelsPlugin],
    options: {
      layout: { padding: { top: 18 } },
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => fmt(ctx.parsed.y)
          }
        }
      },
      scales: {
        x: {
          ticks: { color: th.ticks, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          grid: { color: th.grid }
        },
        y: {
          ticks: { color: th.ticks, font: { size: 10 }, callback: v => fmt(v) },
          grid: { color: th.grid }
        }
      }
    }
  });
}

function renderCharts(data) {
  const gruposProy = groupBy(data, h => h.proyecto || '—');

  renderDoughnut(
    'rc-chart-proyecto',
    gruposProy,
    nombre => state.proyectos.find(p => p.nombre === nombre)?.color || '#888',
    'proyecto',
    data.length === 0
  );
}

function renderListaPartidas(data) {
  const cont = document.getElementById('rc-lista-partidas');
  if (!cont) return;
  const total = data.reduce((s, h) => s + (parseFloat(h.importe) || 0), 0);
  const porPartida = groupBy(data, h => h.partida || 'Sin partida');
  const sorted = Object.entries(porPartida).sort((a, b) => b[1] - a[1]);

  if (!sorted.length || total <= 0) {
    cont.innerHTML = '<div class="empty-state" style="padding:20px 0;"><div style="font-size:28px;margin-bottom:8px;opacity:.4">📊</div><div style="font-size:12px;">Sin datos en el rango</div></div>';
    return;
  }

  const maxMonto = sorted[0][1];
  cont.innerHTML = sorted.map(([partida, monto], i) => {
    const pct = (monto / total) * 100;
    const barPct = (monto / maxMonto) * 100;
    const color = CARD_COLORS[i % CARD_COLORS.length];
    return `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;gap:8px;">
          <span style="font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(partida)}</span>
          <span style="font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:${color};white-space:nowrap;">${fmt(monto)}</span>
        </div>
        <div style="height:6px;background:var(--surface2);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${barPct}%;background:${color};"></div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">${pct.toFixed(1)}% del total</div>
      </div>
    `;
  }).join('');
}

function renderListaSubPartidas(data) {
  const wrap = document.getElementById('rc-bloque-subpartidas');
  const cont = document.getElementById('rc-lista-subpartidas');
  if (!wrap || !cont) return;
  const conSub = data.filter(h => h.sub_partida);
  if (!conSub.length) { wrap.style.display = 'none'; return; }
  const total = conSub.reduce((s, h) => s + (parseFloat(h.importe) || 0), 0);
  const porSub = groupBy(conSub, h => h.sub_partida);
  const sorted = Object.entries(porSub).sort((a, b) => b[1] - a[1]);
  if (!sorted.length || total <= 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const maxMonto = sorted[0][1];
  cont.innerHTML = sorted.map(([sub, monto], i) => {
    const pct = (monto / total) * 100;
    const barPct = (monto / maxMonto) * 100;
    const color = CARD_COLORS[i % CARD_COLORS.length];
    return `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;gap:8px;">
          <span style="font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(sub)}</span>
          <span style="font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:${color};white-space:nowrap;">${fmt(monto)}</span>
        </div>
        <div style="height:6px;background:var(--surface2);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${barPct}%;background:${color};"></div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">${pct.toFixed(1)}% del total</div>
      </div>
    `;
  }).join('');
}

function renderDoughnut(canvasId, grupos, colorFn, refKey, isEmpty) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrapper = canvas.parentElement;

  // Limpiar instancia previa
  if (refKey === 'proyecto' && chartProyecto) { chartProyecto.destroy(); chartProyecto = null; }

  if (isEmpty || Object.keys(grupos).length === 0) {
    canvas.style.display = 'none';
    let placeholder = wrapper.querySelector('.rc-empty-chart');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'rc-empty-chart empty-state';
      placeholder.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;';
      placeholder.innerHTML = '<div style="font-size:32px;margin-bottom:10px;opacity:.4">📊</div><div>Sin datos en el rango</div>';
      wrapper.appendChild(placeholder);
    }
    return;
  }

  // Quitar placeholder si existía
  const placeholder = wrapper.querySelector('.rc-empty-chart');
  if (placeholder) placeholder.remove();
  canvas.style.display = '';

  if (typeof Chart === 'undefined') return;

  const entries = Object.entries(grupos).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(e => e[0]);
  const values = entries.map(e => e[1]);
  const colors = labels.map((l, i) => colorFn(l, i));

  const th = chartTheme();
  const instance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderColor: th.donutBorder, borderWidth: 2 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: th.ticks, font: { size: 11 }, boxWidth: 12, padding: 10 } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: $${ctx.parsed.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
          }
        }
      }
    }
  });

  if (refKey === 'proyecto') chartProyecto = instance;
}

function renderTabla(data) {
  const el = document.getElementById('rc-tabla');
  if (!el) return;
  if (!data.length) {
    el.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin movimientos en el rango</div></div>';
    return;
  }
  const sorted = [...data].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  el.innerHTML = sorted.map(h => `
    <div style="display:grid;grid-template-columns:95px 1fr 110px 110px 1fr 110px;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);font-size:12px;align-items:center;">
      <div style="font-family:'DM Mono',monospace;color:var(--muted);">${fmtFecha(h.fecha)}</div>
      <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.nombre || '—')}</div>
      <div>${proyTag(h.proyecto)}</div>
      <div style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.partida || 'Sin partida')}</div>
      <div style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.concepto || '—')}</div>
      <div style="font-family:'DM Mono',monospace;font-weight:500;color:var(--accent);text-align:right;">${fmt(parseFloat(h.importe) || 0)}</div>
    </div>
  `).join('');
}

/* ============================================================
   Reporte Juan Pablo (Excel) — costo por partida y por mes.
   Para el flujo que lleva Juan Pablo. Pivote: partidas en filas,
   un mes por columna, columna Total por partida y fila TOTAL general.

   Regla de QUÉ CUENTA (definida por el usuario):
     • Pagos (tipo_registro='Pago')                  → SIEMPRE
     • Aportaciones (Traspaso + tipo 'Aportación')   → SIEMPRE
     • Créditos SOLO si la partida es de intereses   → SÍ
     • Traspasos, Préstamos y el resto de Créditos
       (incluido "Pago de Deuda" de crédito)          → NO
   (Un "Pago de Deuda" que sea Pago o Aportación SÍ cuenta;
    sólo se excluye cuando viene de un Crédito.)
   ============================================================ */
const _normJP = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const _MESES_JP = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function _cuentaJP(h) {
  if (h.tipo_registro === 'Pago') return true;
  if (h.tipo_registro === 'Aportación') return true;                              // forma legacy directa
  if (h.tipo_registro === 'Traspaso' && h.tipo === 'Aportación') return true;     // forma normalizada
  if (h.tipo_registro === 'Crédito' && _normJP(h.partida).includes('interes')) return true;
  return false;
}

// Export aditivo (única fuente de verdad de la regla): la usa el Presupuesto de
// caja (estrategia.js) para "gasto real por mes". No cambia nada de este módulo.
export function esGastoRealJP(h) { return _cuentaJP(h); }

export function abrirReporteJuanPablo() {
  const desde = document.getElementById('rc-desde')?.value || '';
  const hasta = document.getElementById('rc-hasta')?.value || '';
  const di = document.getElementById('rjp-desde'); if (di) di.value = desde;
  const hi = document.getElementById('rjp-hasta'); if (hi) hi.value = hasta;
  // Selector de proyecto: poblar con los proyectos activos (igual que rc-proyecto).
  const sp = document.getElementById('rjp-proyecto');
  if (sp) {
    const val = sp.value;
    const activos = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
    sp.innerHTML = '<option value="">Todos (consolidado + cada proyecto por separado)</option>'
      + activos.map(n => `<option>${escapeHtml(n)}</option>`).join('');
    sp.value = val;
  }
  document.getElementById('modal-reporte-jp')?.classList.add('open');
}

// Construye el pivote (array de arrays) para un conjunto de filas YA filtradas.
// Devuelve { aoa, nCols }. Todas las hojas comparten el mismo arreglo `meses`
// para que las columnas (un mes cada una) queden alineadas entre hojas.
function _aoaReporteJP(filas, meses, scopeLabel, desde, hasta) {
  const porPartida = {};
  filas.forEach(h => {
    const iso = parseFechaHist(h.fecha);
    if (!iso) return;                              // self-safe: ignora fechas inválidas
    const part = h.partida || 'Sin partida';
    const mes = iso.slice(0, 7);
    (porPartida[part] = porPartida[part] || {});
    porPartida[part][mes] = (porPartida[part][mes] || 0) + (parseFloat(h.importe) || 0);
  });
  const totalDe = p => meses.reduce((s, me) => s + (porPartida[p][me] || 0), 0);
  const partidas = Object.keys(porPartida).sort((a, b) => totalDe(b) - totalDe(a));
  const multiMes = meses.length > 1;
  const etiqueta = ym => { const [yy, mm] = ym.split('-'); return `${_MESES_JP[+mm - 1]} ${yy}`; };

  const aoa = [];
  aoa.push([`Reporte Juan Pablo — ${scopeLabel}`]);
  aoa.push([`Periodo: ${fmtFecha(desde)} a ${fmtFecha(hasta)}`]);
  aoa.push(['Incluye Pagos, Aportaciones e intereses de crédito. Excluye traspasos, préstamos y pago de deuda.']);
  aoa.push([]);
  aoa.push(['Partida', ...meses.map(etiqueta), ...(multiMes ? ['Total'] : [])]);

  const totMes = {}; meses.forEach(me => (totMes[me] = 0));
  let granTotal = 0;
  partidas.forEach(p => {
    const row = [p];
    let tp = 0;
    meses.forEach(me => { const v = porPartida[p][me] || 0; row.push(v); tp += v; totMes[me] += v; });
    if (multiMes) row.push(tp);
    granTotal += tp;
    aoa.push(row);
  });
  aoa.push(['TOTAL', ...meses.map(me => totMes[me]), ...(multiMes ? [granTotal] : [])]);
  return { aoa, nCols: 1 + meses.length + (multiMes ? 1 : 0) };
}

// Nombre válido para una hoja de Excel: ≤31 chars, sin : \ / ? * [ ], y único en el libro.
function _nombreHoja(raw, usados) {
  let n = String(raw || 'Hoja').replace(/[:\\/?*\[\]]/g, ' ').trim().slice(0, 31) || 'Hoja';
  const base = n; let i = 2;
  while (usados.has(n)) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  usados.add(n);
  return n;
}

export function generarReporteJuanPablo() {
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const desde = document.getElementById('rjp-desde')?.value || '';
  const hasta = document.getElementById('rjp-hasta')?.value || '';
  const fp = document.getElementById('rjp-proyecto')?.value || '';
  if (!desde || !hasta) { notify('Elige el rango de fechas (Desde y Hasta)', 'error'); return; }
  if (desde > hasta) { notify('La fecha "Desde" no puede ser mayor que la fecha "Hasta"', 'error'); return; }

  // 1) Filas que cuentan (regla de Juan Pablo) dentro del rango.
  let filas = state.historial.filter(h => {
    if (!_cuentaJP(h)) return false;
    const iso = parseFechaHist(h.fecha);
    return iso && iso >= desde && iso <= hasta;
  });
  if (fp) filas = filas.filter(h => proyectoMatch(h.proyecto, fp));
  if (!filas.length) {
    notify(fp ? 'No hay movimientos de ese proyecto en el rango' : 'No hay pagos, aportaciones ni intereses de crédito en ese rango (traspasos y préstamos no cuentan)', 'error');
    return;
  }

  // 2) Meses del rango (de desde a hasta), aunque alguno quede en cero.
  const meses = [];
  let y = parseInt(desde.slice(0, 4), 10), m = parseInt(desde.slice(5, 7), 10);
  const yF = parseInt(hasta.slice(0, 4), 10), mF = parseInt(hasta.slice(5, 7), 10);
  while ((y < yF || (y === yF && m <= mF)) && meses.length < 1200) {  // tope: solo backstop anti-bug
    meses.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }

  // 3) Crear el libro y un ayudante que arma+formatea cada hoja.
  const wb = XLSX.utils.book_new();
  const usados = new Set();
  const addHoja = (nombre, filasHoja, scopeLabel) => {
    const { aoa, nCols } = _aoaReporteJP(filasHoja, meses, scopeLabel, desde, hasta);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 30 }, ...meses.map(() => ({ wch: 16 })), ...(meses.length > 1 ? [{ wch: 18 }] : [])];
    for (let r = 5; r < aoa.length; r++) {          // fila 4 = encabezado; datos desde la 5
      for (let c = 1; c < nCols; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00';
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, _nombreHoja(nombre, usados));
  };

  if (fp) {
    // Un solo proyecto → una hoja.
    addHoja(fp, filas, fp);
  } else {
    // Consolidado + una hoja por proyecto. Cada fila cae en UN solo bucket
    // (el primer proyecto activo que matchee, o su proyecto crudo / "Sin proyecto"),
    // así la suma de las hojas por proyecto cuadra exacto con el consolidado.
    addHoja('Consolidado', filas, 'Consolidado (todos los proyectos)');
    const activos = state.proyectos.filter(p => p.activo !== false);
    const bucketDe = h => {
      // Coincidencia más específica: entre los activos que matchean, gana el de
      // nombre normalizado más largo (así "Concentradora DT" gana sobre un "DT").
      const matches = activos.filter(pp => proyectoMatch(h.proyecto, pp.nombre));
      if (matches.length) {
        matches.sort((a, b) => _normJP(b.nombre).length - _normJP(a.nombre).length);
        return matches[0].nombre;
      }
      return h.proyecto || 'Sin proyecto';
    };
    const grupos = {};
    filas.forEach(h => { const b = bucketDe(h); (grupos[b] = grupos[b] || []).push(h); });
    const orden = [
      ...activos.map(p => p.nombre).filter(n => grupos[n]),                       // activos con datos, en orden de catálogo
      ...Object.keys(grupos).filter(n => !activos.some(p => p.nombre === n)).sort() // extras (inactivos / sin proyecto)
    ];
    orden.forEach(n => addHoja(n, grupos[n], n));
  }

  XLSX.writeFile(wb, `Reporte_Juan_Pablo_${desde}_a_${hasta}.xlsx`);
  cerrar('modal-reporte-jp');
  notify(fp ? '✅ Reporte generado' : '✅ Reporte generado (consolidado + por proyecto)', 'success');
}

/* ============================================================
   Reporte COMPARATIVO entre proyectos (Excel).
   Compara el costo por partida entre 2+ proyectos en un rango:
   Hoja 1 "Comparativo": partida × proyecto con el PESO % de cada
     partida dentro del gasto total de su proyecto, Δ y Δ% al
     comparar exactamente 2, TOTAL e insights (gasto total, peso
     de lo elegido, promedio mensual, movimientos, partida top).
   Hoja 2 "Por mes": evolución mensual por proyecto (con Δ si son 2).
   Hoja 3 "Detalle": los movimientos, cada uno asignado a UN solo
     proyecto (coincidencia más específica, como el reporte JP).
   Base: TODOS los movimientos del historial (igual que la pantalla).
   ============================================================ */
export function abrirReporteComparativo() {
  // Pre-llenar con lo que ya está filtrado en la pantalla.
  const desde = document.getElementById('rc-desde')?.value || '';
  const hasta = document.getElementById('rc-hasta')?.value || '';
  const di = document.getElementById('rcomp-desde'); if (di) di.value = desde;
  const hi = document.getElementById('rcomp-hasta'); if (hi) hi.value = hasta;
  const contP = document.getElementById('rcomp-proyectos');
  if (contP) {
    const preProy = document.getElementById('rc-proyecto')?.value || '';
    contP.innerHTML = state.proyectos.filter(p => p.activo !== false).map(p =>
      `<label style="display:flex;align-items:center;gap:8px;padding:4px 6px;cursor:pointer;font-size:12px;">
        <input type="checkbox" value="${escapeHtml(p.nombre)}"${preProy && proyectoMatch(p.nombre, preProy) ? ' checked' : ''} style="accent-color:var(--accent);flex-shrink:0;">
        <span>${escapeHtml(p.nombre)}</span></label>`).join('');
  }
  const contPa = document.getElementById('rcomp-partidas');
  if (contPa) {
    const enHistorial = [...new Set(state.historial.map(h => h.partida).filter(Boolean))];
    const opts = getPartidasParaSelect(enHistorial).map(o => ({ value: o.value, label: o.label }));
    if (state.historial.some(h => !h.partida)) opts.push({ value: 'Sin partida', label: 'Sin partida' });
    contPa.innerHTML = opts.map(o =>
      `<label style="display:flex;align-items:center;gap:8px;padding:4px 6px;cursor:pointer;font-size:12px;">
        <input type="checkbox" value="${escapeHtml(o.value)}"${rcPartidasSel.has(o.value) ? ' checked' : ''} style="accent-color:var(--accent);flex-shrink:0;">
        <span>${escapeHtml(o.label)}</span></label>`).join('');
  }
  document.getElementById('modal-reporte-comp')?.classList.add('open');
}

export function generarReporteComparativo() {
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const desde = document.getElementById('rcomp-desde')?.value || '';
  const hasta = document.getElementById('rcomp-hasta')?.value || '';
  if (!desde || !hasta) { notify('Elige el rango de fechas (Desde y Hasta)', 'error'); return; }
  if (desde > hasta) { notify('La fecha "Desde" no puede ser mayor que la fecha "Hasta"', 'error'); return; }
  const proys = [...document.querySelectorAll('#rcomp-proyectos input:checked')].map(i => i.value);
  if (proys.length < 2) { notify('Marca al menos 2 proyectos para comparar', 'error'); return; }
  const partsSel = [...document.querySelectorAll('#rcomp-partidas input:checked')].map(i => i.value);

  // Movimientos del rango (misma base que la pantalla: todo el historial).
  const enRango = state.historial.filter(h => {
    const iso = parseFechaHist(h.fecha);
    return iso && iso >= desde && iso <= hasta;
  });

  // Meses del rango (aunque alguno quede en cero).
  const meses = [];
  let y = parseInt(desde.slice(0, 4), 10), m = parseInt(desde.slice(5, 7), 10);
  const yF = parseInt(hasta.slice(0, 4), 10), mF = parseInt(hasta.slice(5, 7), 10);
  while ((y < yF || (y === yF && m <= mF)) && meses.length < 1200) {
    meses.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  const etiqueta = ym => { const [yy, mm] = ym.split('-'); return `${_MESES_JP[+mm - 1]} ${yy}`; };

  // Por proyecto: gasto TOTAL (todas las partidas, para el peso %) y las filas del reporte.
  const data = proys.map(P => {
    const todas = enRango.filter(h => proyectoMatch(h.proyecto, P));
    const filas = partsSel.length ? todas.filter(h => partsSel.includes(h.partida || 'Sin partida')) : todas;
    const porPartida = {}; const porMes = {}; meses.forEach(me => (porMes[me] = 0));
    let total = 0;
    filas.forEach(h => {
      const v = parseFloat(h.importe) || 0;
      const p = h.partida || 'Sin partida';
      porPartida[p] = (porPartida[p] || 0) + v;
      const me = parseFechaHist(h.fecha).slice(0, 7);
      if (me in porMes) porMes[me] += v;
      total += v;
    });
    const gastoTotal = todas.reduce((s, h) => s + (parseFloat(h.importe) || 0), 0);
    return { P, filas, porPartida, porMes, total, gastoTotal, n: filas.length };
  });
  if (data.every(d => !d.filas.length)) { notify('No hay movimientos de esos proyectos/partidas en el rango', 'error'); return; }

  // Partidas del reporte: las elegidas (aunque queden en 0) o la unión de las presentes;
  // ordenadas por el total combinado de mayor a menor.
  const totalComb = p => data.reduce((s, d) => s + (d.porPartida[p] || 0), 0);
  const partidas = (partsSel.length ? [...partsSel] : [...new Set(data.flatMap(d => Object.keys(d.porPartida)))])
    .sort((a, b) => totalComb(b) - totalComb(a));

  const dos = proys.length === 2;
  const wb = XLSX.utils.book_new();
  const usados = new Set();

  // ---- Hoja 1: Comparativo (partida × proyecto, con peso % e insights) ----
  const head = ['Partida'];
  data.forEach(d => head.push(d.P, `% del gasto de ${d.P}`));
  if (dos) head.push(`Δ (${proys[0]} − ${proys[1]})`, 'Δ %');
  const aoa = [
    ['Comparativo de costos entre proyectos'],
    [`Periodo: ${fmtFecha(desde)} a ${fmtFecha(hasta)}`],
    [partsSel.length ? `Partidas: ${partsSel.join(', ')}` : 'Partidas: Todas'],
    ['Base: todos los movimientos del historial (igual que la pantalla). El % es el peso de la partida dentro del gasto TOTAL de su proyecto en el rango.'],
    [],
    head
  ];
  partidas.forEach(p => {
    const row = [p];
    data.forEach(d => { const v = d.porPartida[p] || 0; row.push(v, d.gastoTotal > 0 ? v / d.gastoTotal : ''); });
    if (dos) {
      const a = data[0].porPartida[p] || 0, b = data[1].porPartida[p] || 0;
      row.push(a - b, b > 0 ? (a - b) / b : '');
    }
    aoa.push(row);
  });
  const totRow = ['TOTAL (partidas del reporte)'];
  data.forEach(d => totRow.push(d.total, d.gastoTotal > 0 ? d.total / d.gastoTotal : ''));
  if (dos) totRow.push(data[0].total - data[1].total, data[1].total > 0 ? (data[0].total - data[1].total) / data[1].total : '');
  aoa.push(totRow);
  aoa.push([]);
  aoa.push(['— Insights —']);
  const insight = (label, fn) => { const row = [label]; data.forEach(d => row.push(fn(d), '')); aoa.push(row); return aoa.length - 1; };
  insight('Gasto TOTAL del proyecto (todas las partidas)', d => d.gastoTotal);
  const rPeso = insight('Peso de las partidas del reporte en su gasto', d => (d.gastoTotal > 0 ? d.total / d.gastoTotal : ''));
  insight('Promedio mensual (partidas del reporte)', d => (meses.length ? d.total / meses.length : ''));
  const rMovs = insight('Movimientos', d => d.n);
  insight('Partida más pesada del proyecto', d => {
    const ps = Object.entries(d.porPartida).sort((x, yy2) => yy2[1] - x[1]);
    return ps.length ? `${ps[0][0]} (${d.gastoTotal > 0 ? Math.round((ps[0][1] / d.gastoTotal) * 100) : 0}% de su gasto)` : '—';
  });

  const ws1 = XLSX.utils.aoa_to_sheet(aoa);
  ws1['!cols'] = [{ wch: 36 }, ...data.flatMap(() => [{ wch: 16 }, { wch: 15 }]), ...(dos ? [{ wch: 18 }, { wch: 10 }] : [])];
  const pctCols = new Set(data.map((_, i) => 2 + 2 * i));
  if (dos) pctCols.add(head.length - 1);   // la columna Δ %
  for (let r = 5; r < aoa.length; r++) {
    for (let c = 1; c < head.length; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws1[ref] || typeof ws1[ref].v !== 'number') continue;
      if (pctCols.has(c) || r === rPeso) ws1[ref].z = '0.0%';
      else if (r === rMovs) ws1[ref].z = '#,##0';
      else ws1[ref].z = '"$"#,##0.00';
    }
  }
  XLSX.utils.book_append_sheet(wb, ws1, _nombreHoja('Comparativo', usados));

  // ---- Hoja 2: Por mes (evolución de las partidas del reporte) ----
  const head2 = ['Mes', ...proys, ...(dos ? [`Δ (${proys[0]} − ${proys[1]})`] : [])];
  const aoa2 = [['Evolución mensual (partidas del reporte)'], [`Periodo: ${fmtFecha(desde)} a ${fmtFecha(hasta)}`], [], head2];
  meses.forEach(me => {
    const row = [etiqueta(me), ...data.map(d => d.porMes[me] || 0)];
    if (dos) row.push((data[0].porMes[me] || 0) - (data[1].porMes[me] || 0));
    aoa2.push(row);
  });
  aoa2.push(['TOTAL', ...data.map(d => d.total), ...(dos ? [data[0].total - data[1].total] : [])]);
  const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
  ws2['!cols'] = [{ wch: 14 }, ...proys.map(() => ({ wch: 16 })), ...(dos ? [{ wch: 18 }] : [])];
  for (let r = 4; r < aoa2.length; r++) {
    for (let c = 1; c < head2.length; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws2[ref] && typeof ws2[ref].v === 'number') ws2[ref].z = '"$"#,##0.00';
    }
  }
  XLSX.utils.book_append_sheet(wb, ws2, _nombreHoja('Por mes', usados));

  // ---- Hoja 3: Detalle (cada movimiento en UN solo proyecto: el match más específico) ----
  const bucketSel = h => {
    const matches = proys.filter(P => proyectoMatch(h.proyecto, P));
    if (!matches.length) return null;
    matches.sort((a, b) => _normJP(b).length - _normJP(a).length);
    return matches[0];
  };
  const detalle = [];
  enRango.forEach(h => {
    if (partsSel.length && !partsSel.includes(h.partida || 'Sin partida')) return;
    const P = bucketSel(h);
    if (!P) return;
    detalle.push({ iso: parseFechaHist(h.fecha), fila: [fmtFecha(h.fecha), P, h.partida || 'Sin partida', h.sub_partida || '', h.nombre || '', h.concepto || '', parseFloat(h.importe) || 0, h.tipo_registro || 'Pago'] });
  });
  detalle.sort((a, b) => a.iso.localeCompare(b.iso));
  const aoa3 = [['Detalle de movimientos'], [`Periodo: ${fmtFecha(desde)} a ${fmtFecha(hasta)}`], [],
    ['Fecha', 'Proyecto', 'Partida', 'Subpartida', 'Beneficiario', 'Concepto', 'Importe', 'Tipo'],
    ...detalle.map(d => d.fila)];
  const ws3 = XLSX.utils.aoa_to_sheet(aoa3);
  ws3['!cols'] = [{ wch: 11 }, { wch: 20 }, { wch: 26 }, { wch: 20 }, { wch: 30 }, { wch: 36 }, { wch: 14 }, { wch: 10 }];
  for (let r = 4; r < aoa3.length; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: 6 });
    if (ws3[ref] && typeof ws3[ref].v === 'number') ws3[ref].z = '"$"#,##0.00';
  }
  XLSX.utils.book_append_sheet(wb, ws3, _nombreHoja('Detalle', usados));

  const safe = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '_');
  const nombre = dos ? `${safe(proys[0])}_vs_${safe(proys[1])}` : `${proys.length}_proyectos`;
  XLSX.writeFile(wb, `Comparativo_${nombre}_${desde}_a_${hasta}.xlsx`);
  cerrar('modal-reporte-comp');
  notify('✅ Comparativo generado (Comparativo + Por mes + Detalle)', 'success');
}

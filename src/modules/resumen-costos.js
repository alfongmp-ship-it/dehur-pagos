import { state, datosListos } from '../state.js';
import { fmt, fmtFecha } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { proyectoMatch } from '../config/proyectos.js';
import { parseFechaHist } from './historial.js';
import { getPartidasParaSelect } from '../config/sub-partidas.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';

let chartProyecto = null;
let chartTendencia = null;
let rcInitialized = false;

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
  ['rc-desde', 'rc-hasta', 'rc-proyecto', 'rc-partida'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderResumenCostos);
  });
  document.getElementById('rc-reset')?.addEventListener('click', () => {
    setDefaultDates();
    const sp = document.getElementById('rc-proyecto'); if (sp) sp.value = '';
    const spt = document.getElementById('rc-partida'); if (spt) spt.value = '';
    renderResumenCostos();
  });
  rcInitialized = true;
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
    selProy.innerHTML = '<option value="">Todos los proyectos</option>' + opts.map(n => `<option>${n}</option>`).join('');
    selProy.value = val;
  }
  const selPart = document.getElementById('rc-partida');
  if (selPart) {
    const val = selPart.value;
    // Partidas del catálogo activo + legacy del historial.
    const enHistorial = [...new Set(state.historial.map(h => h.partida).filter(Boolean))];
    const opts = getPartidasParaSelect(enHistorial);
    const haySinPartida = state.historial.some(h => !h.partida);
    let opciones = '<option value="">Todas las partidas</option>';
    opciones += opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    if (haySinPartida) opciones += '<option value="Sin partida">Sin partida</option>';
    selPart.innerHTML = opciones;
    selPart.value = val;
  }
}

function filterHistorial(fd, fh, fp, fpart) {
  return state.historial.filter(h => {
    if (fp && !proyectoMatch(h.proyecto, fp)) return false;
    if (fpart && (h.partida || 'Sin partida') !== fpart) return false;
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
  const fpart = document.getElementById('rc-partida')?.value || '';
  return filterHistorial(fd, fh, fp, fpart);
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
  const fpart = document.getElementById('rc-partida')?.value || '';
  if (!fd || !fh) return null;
  const msDia = 86400000;
  const dias = Math.round((new Date(fh) - new Date(fd)) / msDia) + 1;
  const prevHasta = shiftISODate(fd, -1);
  const prevDesde = shiftISODate(fd, -dias);
  const prev = filterHistorial(prevDesde, prevHasta, fp, fpart);
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
      <div title="${nombre}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;gap:8px;">
          <span style="font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${nombreTrunc}</span>
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

  const valueLabelsPlugin = {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.font = '600 10px "DM Mono", monospace';
      ctx.fillStyle = '#e8e8e8';
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
        borderColor: '#c8a96e',
        backgroundColor: 'rgba(200,169,110,0.15)',
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
          ticks: { color: '#aaa', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          ticks: { color: '#aaa', font: { size: 10 }, callback: v => fmt(v) },
          grid: { color: 'rgba(255,255,255,0.04)' }
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
          <span style="font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${partida}</span>
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
          <span style="font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${sub}</span>
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

  const instance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderColor: '#0f0f0f', borderWidth: 2 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#aaa', font: { size: 11 }, boxWidth: 12, padding: 10 } },
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
      <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.nombre || '—'}</div>
      <div>${proyTag(h.proyecto)}</div>
      <div style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.partida || 'Sin partida'}</div>
      <div style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.concepto || '—'}</div>
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
      + activos.map(n => `<option>${n}</option>`).join('');
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

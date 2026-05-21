import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { proyectoMatch } from '../config/proyectos.js';
import { parseFechaHist } from './historial.js';
import { getPartidasParaSelect } from '../config/sub-partidas.js';

let chartProyecto = null;
let chartTendencia = null;
let rcInitialized = false;

const CARD_COLORS = ['#c8a96e', '#5a9be0', '#4caf7d', '#e07a3a', '#9b7fe8', '#3498db', '#27ae60', '#e05a5a'];

export function renderResumenCostos() {
  const tabla = document.getElementById('rc-tabla');
  const cards = document.getElementById('rc-cards');
  if (!tabla || !cards) return;

  if (!state.gsToken) {
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
      <div style="font-family:'DM Mono',monospace;color:var(--muted);">${h.fecha || ''}</div>
      <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.nombre || '—'}</div>
      <div>${proyTag(h.proyecto)}</div>
      <div style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.partida || 'Sin partida'}</div>
      <div style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.concepto || '—'}</div>
      <div style="font-family:'DM Mono',monospace;font-weight:500;color:var(--accent);text-align:right;">${fmt(parseFloat(h.importe) || 0)}</div>
    </div>
  `).join('');
}

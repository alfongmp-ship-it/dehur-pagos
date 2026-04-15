import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { proyectoMatch } from '../config/proyectos.js';
import { parseFechaHist } from './historial.js';

let chartProyecto = null;
let chartPartida = null;
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
  renderTabla(data);
}

function destruirCharts() {
  if (chartProyecto) { chartProyecto.destroy(); chartProyecto = null; }
  if (chartPartida) { chartPartida.destroy(); chartPartida = null; }
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
    const partidasReales = [...new Set(state.historial.map(h => h.partida).filter(p => p))].sort();
    const haySinPartida = state.historial.some(h => !h.partida);
    let opciones = '<option value="">Todas las partidas</option>';
    opciones += partidasReales.map(p => `<option>${p}</option>`).join('');
    if (haySinPartida) opciones += '<option value="Sin partida">Sin partida</option>';
    selPart.innerHTML = opciones;
    selPart.value = val;
  }
}

function getFiltered() {
  const fd = document.getElementById('rc-desde')?.value || '';
  const fh = document.getElementById('rc-hasta')?.value || '';
  const fp = document.getElementById('rc-proyecto')?.value || '';
  const fpart = document.getElementById('rc-partida')?.value || '';
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
  const porProy = groupBy(data, h => h.proyecto || '—');
  const porPart = groupBy(data, h => h.partida || 'Sin partida');
  const sortedProy = Object.entries(porProy).sort((a, b) => b[1] - a[1]);
  const sortedPart = Object.entries(porPart).sort((a, b) => b[1] - a[1]);
  const [proyTop, proyTopMonto] = sortedProy[0] || ['—', 0];
  const [partTop, partTopMonto] = sortedPart[0] || ['—', 0];

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
      <div class="stat-label">Proyecto Top</div>
      <div class="stat-value stat-green" style="font-size:16px;">${proyTop}</div>
      <div class="stat-sub">${fmt(proyTopMonto)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Partida Top</div>
      <div class="stat-value stat-orange" style="font-size:16px;">${partTop}</div>
      <div class="stat-sub">${fmt(partTopMonto)}</div>
    </div>
  `;
}

function renderCharts(data) {
  const gruposProy = groupBy(data, h => h.proyecto || '—');
  const gruposPart = groupBy(data, h => h.partida || 'Sin partida');

  renderDoughnut(
    'rc-chart-proyecto',
    gruposProy,
    nombre => state.proyectos.find(p => p.nombre === nombre)?.color || '#888',
    'proyecto',
    data.length === 0
  );
  renderDoughnut(
    'rc-chart-partida',
    gruposPart,
    (_, i) => CARD_COLORS[i % CARD_COLORS.length],
    'partida',
    data.length === 0
  );
}

function renderDoughnut(canvasId, grupos, colorFn, refKey, isEmpty) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrapper = canvas.parentElement;

  // Limpiar instancia previa
  if (refKey === 'proyecto' && chartProyecto) { chartProyecto.destroy(); chartProyecto = null; }
  if (refKey === 'partida' && chartPartida) { chartPartida.destroy(); chartPartida = null; }

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
  else chartPartida = instance;
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

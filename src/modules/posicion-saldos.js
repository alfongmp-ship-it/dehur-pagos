import { state } from '../state.js';
import { fmt, escapeHtml } from '../ui/format.js';
import { chartTheme } from '../ui/chart-theme.js';

let chartSaldos = null;

const CARD_COLORS = ['#c8a96e', '#5a9be0', '#4caf7d', '#e07a3a', '#9b7fe8', '#3498db', '#27ae60', '#e05a5a'];

function getColorForCuenta(index) {
  return CARD_COLORS[index % CARD_COLORS.length];
}

export function renderPosicionSaldos() {
  const cardsEl = document.getElementById('pos-cards');
  const fechaEl = document.getElementById('pos-fecha');
  if (!cardsEl) return;

  const proyActivos = state.proyectos.filter(p => p.activo !== false && p.cuenta);
  const cpActivas = state.cuentasPropias.filter(c => c.activo !== false);
  const todas = [
    ...proyActivos.map(p => ({ id: p.id, nombre: p.nombre, saldo: parseFloat(p.saldo) || 0, tipo: 'proyecto', color: p.color || '#c8a96e', ult: p.ultima_act_saldo || '' })),
    ...cpActivas.map((c, i) => ({ id: c.cuenta_id, nombre: c.nombre, saldo: parseFloat(c.saldo) || 0, tipo: 'propia', color: getColorForCuenta(proyActivos.length + i), ult: c.ultima_actualizacion || '' }))
  ];

  if (!todas.length) {
    cardsEl.innerHTML = '<div class="stat-card"><div class="stat-label">Sin cuentas</div><div class="stat-sub">Registra cuentas en Cuentas Propias</div></div>';
    if (fechaEl) fechaEl.textContent = '';
    return;
  }

  const total = todas.reduce((s, c) => s + c.saldo, 0);

  // Fecha más reciente
  const fechas = todas.map(c => c.ult).filter(Boolean).sort().reverse();
  if (fechaEl) fechaEl.textContent = fechas.length ? fechas[0] : '';

  // Grid columns
  const cols = Math.min(todas.length + 1, 5);
  cardsEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  // Cards
  cardsEl.innerHTML =
    `<div class="stat-card" style="border-left:3px solid var(--accent);">
      <div class="stat-label">Saldo Total</div>
      <div class="stat-value stat-accent">${fmt(total)}</div>
      <div class="stat-sub">${todas.length} cuentas activas</div>
    </div>` +
    todas.map(c =>
      `<div class="stat-card" style="border-left:3px solid ${c.color};">
        <div class="stat-label">${escapeHtml(c.nombre)}</div>
        <div class="stat-value" style="color:${c.color};font-size:20px;">${fmt(c.saldo)}</div>
        <div class="stat-sub">${escapeHtml(c.ult) || 'Sin actualizar'}</div>
      </div>`
    ).join('');

  // Gráfica
  renderChartSaldos(todas);
}

function renderChartSaldos(cuentasActuales) {
  const canvas = document.getElementById('chart-saldos');
  if (!canvas || typeof Chart === 'undefined') return;

  const hist = state.historialSaldos;
  if (!hist.length) {
    canvas.parentElement.style.display = 'none';
    return;
  }
  canvas.parentElement.style.display = 'block';

  const fechasSet = [...new Set(hist.map(h => h.fecha.split(' ')[0]))].sort();
  const cuentaIds = [...new Set(hist.map(h => h.cuenta_id))];

  const colorMap = {};
  cuentasActuales.forEach(c => { colorMap[String(c.id)] = c.color; });

  const datasets = cuentaIds.map(id => {
    const nombre = hist.find(h => h.cuenta_id === id)?.cuenta_nombre || id;
    const color = colorMap[id] || '#888';
    const data = fechasSet.map(f => {
      const registros = hist.filter(h => h.cuenta_id === id && h.fecha.startsWith(f));
      return registros.length ? registros[registros.length - 1].saldo : null;
    });
    return { label: nombre, data, borderColor: color, backgroundColor: color + '22', tension: 0.3, pointRadius: 3, borderWidth: 2, spanGaps: true };
  });

  const totalData = fechasSet.map(f => {
    const registros = hist.filter(h => h.fecha.startsWith(f));
    if (!registros.length) return null;
    return registros[registros.length - 1].saldo_total;
  });
  const th = chartTheme();   // colores del tema ACTUAL (canvas no resuelve var(--...))
  datasets.unshift({ label: 'Total', data: totalData, borderColor: th.gold, backgroundColor: th.goldFill, tension: 0.3, pointRadius: 4, borderWidth: 3, borderDash: [6, 3], spanGaps: true });

  if (chartSaldos) chartSaldos.destroy();

  chartSaldos = new Chart(canvas, {
    type: 'line',
    data: { labels: fechasSet, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: th.ticks, font: { size: 11 }, boxWidth: 12, padding: 15 } },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label + ': $' + (ctx.parsed.y || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })
          }
        }
      },
      scales: {
        x: { grid: { color: th.grid }, ticks: { color: th.ticksSoft, font: { size: 10 } } },
        y: {
          grid: { color: th.grid },
          ticks: { color: th.ticksSoft, font: { size: 10 }, callback: v => '$' + (v / 1000).toFixed(0) + 'k' }
        }
      }
    }
  });
}

import { state, datosListos } from '../state.js';
import { fmt } from '../ui/format.js';
import { parseFechaHist } from './historial.js';
import { proyectoMatch } from '../config/proyectos.js';

let chartGastoMensual = null;
let chartProyectoPie = null;
let chartPartidaBar = null;
let reInitialized = false;
let proyectoActivo = ''; // '' = Total · si tiene valor, es el nombre del proyecto

const PALETA = ['#c8a96e', '#5a9be0', '#4caf7d', '#e07a3a', '#9b7fe8', '#e05a5a', '#27ae60', '#3498db'];

export function renderResumenEjecutivo() {
  const cont = document.getElementById('re-contenido');
  const empty = document.getElementById('re-empty-state');
  if (!cont) return;

  if (!datosListos()) {
    cont.style.display = 'none';
    if (empty) empty.style.display = '';
    destruirCharts();
    return;
  }

  cont.style.display = '';
  if (empty) empty.style.display = 'none';

  initOnce();

  const periodo = obtenerPeriodo();
  renderTabs();
  renderEncabezado(periodo);
  renderKPIs(periodo);
  renderTendencia(periodo);
  renderDistribuciones(periodo);
  renderPrestamos(periodo);
  renderTopBeneficiarios(periodo);
  renderObservaciones(periodo);
}

function renderTabs() {
  const cont = document.getElementById('re-tabs');
  if (!cont) return;
  const proyectos = state.proyectos.filter(p => p.activo !== false);
  const tabs = [{ id: '', nombre: 'Total', color: '#c8a96e' }, ...proyectos.map(p => ({ id: p.nombre, nombre: p.nombre, color: p.color || '#888' }))];
  cont.innerHTML = tabs.map(t => {
    const isActive = proyectoActivo === t.id;
    return `<button class="re-tab${isActive ? ' active' : ''}" data-id="${t.id.replace(/"/g, '&quot;')}" style="${isActive ? `border-color:${t.color};color:${t.color};` : ''}">${t.nombre}</button>`;
  }).join('');
  cont.querySelectorAll('.re-tab').forEach(b => {
    b.addEventListener('click', () => {
      proyectoActivo = b.dataset.id;
      renderResumenEjecutivo();
    });
  });
}

function dentroProyecto(proyectoCampo) {
  if (!proyectoActivo) return true;
  return proyectoMatch(proyectoCampo, proyectoActivo);
}

function destruirCharts() {
  if (chartGastoMensual) { chartGastoMensual.destroy(); chartGastoMensual = null; }
  if (chartProyectoPie) { chartProyectoPie.destroy(); chartProyectoPie = null; }
  if (chartPartidaBar) { chartPartidaBar.destroy(); chartPartidaBar = null; }
}

function initOnce() {
  if (reInitialized) return;
  setDefaultPeriodo();
  document.getElementById('re-desde')?.addEventListener('change', renderResumenEjecutivo);
  document.getElementById('re-hasta')?.addEventListener('change', renderResumenEjecutivo);
  document.getElementById('re-preset')?.addEventListener('change', aplicarPreset);
  document.getElementById('re-btn-imprimir')?.addEventListener('click', () => window.print());
  document.getElementById('re-btn-csv')?.addEventListener('click', exportarCSV);
  reInitialized = true;
}

function setDefaultPeriodo() {
  const hoy = new Date();
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const desde = document.getElementById('re-desde');
  const hasta = document.getElementById('re-hasta');
  if (desde) desde.value = primero.toISOString().slice(0, 10);
  if (hasta) hasta.value = hoy.toISOString().slice(0, 10);
}

function aplicarPreset(e) {
  const v = e.target.value;
  const hoy = new Date();
  let desde, hasta = hoy;
  if (v === 'mes') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  } else if (v === 'trim') {
    const m = hoy.getMonth();
    const qInicio = m - (m % 3);
    desde = new Date(hoy.getFullYear(), qInicio, 1);
  } else if (v === 'ytd') {
    desde = new Date(hoy.getFullYear(), 0, 1);
  } else if (v === 'ult90') {
    desde = new Date(hoy);
    desde.setDate(desde.getDate() - 89);
  } else if (v === 'ult30') {
    desde = new Date(hoy);
    desde.setDate(desde.getDate() - 29);
  } else {
    return;
  }
  const di = document.getElementById('re-desde');
  const hi = document.getElementById('re-hasta');
  if (di) di.value = desde.toISOString().slice(0, 10);
  if (hi) hi.value = hasta.toISOString().slice(0, 10);
  renderResumenEjecutivo();
}

function obtenerPeriodo() {
  const desde = document.getElementById('re-desde')?.value || '';
  const hasta = document.getElementById('re-hasta')?.value || '';
  return { desde, hasta };
}

function dentroPeriodo(iso, periodo) {
  if (periodo.desde && iso < periodo.desde) return false;
  if (periodo.hasta && iso > periodo.hasta) return false;
  return true;
}

function formatearFechaLarga(iso) {
  if (!iso) return '—';
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const [y, m, d] = iso.split('-');
  return `${parseInt(d)} de ${meses[parseInt(m) - 1]} de ${y}`;
}

function renderEncabezado(periodo) {
  const sub = document.getElementById('re-subtitulo');
  if (sub) {
    const ambito = proyectoActivo ? `Proyecto: ${proyectoActivo}` : 'Consolidado (todos los proyectos)';
    sub.innerHTML = `<div style="font-weight:600;">${ambito}</div><div style="font-size:11px;color:var(--muted);margin-top:2px;">Periodo: ${formatearFechaLarga(periodo.desde)} — ${formatearFechaLarga(periodo.hasta)}</div>`;
  }
  const gen = document.getElementById('re-generado');
  if (gen) {
    const ahora = new Date();
    gen.textContent = `Generado el ${ahora.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })} a las ${ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

function calcularEgresos(periodo) {
  const movimientos = state.historial.filter(h =>
    dentroPeriodo(parseFechaHist(h.fecha), periodo) && dentroProyecto(h.proyecto)
  );
  const total = movimientos.reduce((s, h) => s + (parseFloat(h.importe) || 0), 0);
  const pagos = movimientos.filter(h => h.tipo_registro === 'Pago');
  return { pagos, movimientos, total };
}

function calcularEgresosPrevios(periodo) {
  if (!periodo.desde || !periodo.hasta) return null;
  const msDia = 86400000;
  const dias = Math.round((new Date(periodo.hasta) - new Date(periodo.desde)) / msDia) + 1;
  const prevHasta = new Date(periodo.desde);
  prevHasta.setDate(prevHasta.getDate() - 1);
  const prevDesde = new Date(prevHasta);
  prevDesde.setDate(prevDesde.getDate() - dias + 1);
  const prevP = { desde: prevDesde.toISOString().slice(0, 10), hasta: prevHasta.toISOString().slice(0, 10) };
  return calcularEgresos(prevP).total;
}

// Saldos netos de préstamos entre proyectos (toda la historia, no solo período)
function calcularSaldosNetosPrestamos() {
  const pares = {};
  for (const t of state.traspasos) {
    if (t.tipo !== 'Préstamo') continue;
    const a = t.proyecto_origen;
    const b = t.proyecto_destino;
    if (!a || !b || a === b) continue;
    const [k1, k2] = [a, b].sort();
    const key = `${k1}|||${k2}`;
    if (!pares[key]) pares[key] = { a: k1, b: k2, neto: 0 };
    if (a === k1) pares[key].neto += parseFloat(t.monto) || 0;
    else pares[key].neto -= parseFloat(t.monto) || 0;
  }
  return Object.values(pares).filter(p => {
    if (Math.abs(p.neto) <= 0.01) return false;
    if (proyectoActivo) return proyectoMatch(p.a, proyectoActivo) || proyectoMatch(p.b, proyectoActivo);
    return true;
  });
}

function calcularTotalPrestamosVivos() {
  return calcularSaldosNetosPrestamos().reduce((s, p) => s + Math.abs(p.neto), 0);
}

function renderKPIs(periodo) {
  const cont = document.getElementById('re-kpis');
  if (!cont) return;

  const egresos = calcularEgresos(periodo);
  const prev = calcularEgresosPrevios(periodo);

  let varHTML = '<span style="color:var(--muted);font-size:11px;">Sin datos previos</span>';
  if (prev !== null && prev > 0) {
    const delta = egresos.total - prev;
    const pct = (delta / prev) * 100;
    const signo = pct >= 0 ? '+' : '';
    const color = pct >= 0 ? '#e05a5a' : '#4caf7d';
    varHTML = `<span style="color:${color};font-size:11px;font-weight:600;">${signo}${pct.toFixed(1)}% vs período anterior</span>`;
  }

  // Egreso por proyecto (período)
  const egresoPorProy = egresoPorProyecto(periodo);
  const topProy = Object.entries(egresoPorProy).sort((a, b) => b[1] - a[1])[0];
  const totalProy = Object.values(egresoPorProy).reduce((s, v) => s + v, 0);
  const topProyPct = topProy && totalProy > 0 ? (topProy[1] / totalProy) * 100 : 0;

  // Préstamos vivos (filtrados por proyecto si aplica)
  const saldosNetos = calcularSaldosNetosPrestamos();
  const prestamosVivos = saldosNetos.reduce((s, p) => s + Math.abs(p.neto), 0);
  const paresPrestamos = saldosNetos.length;

  // Posición neta del proyecto (deudor / acreedor)
  let posicionNeta = 0;
  if (proyectoActivo) {
    saldosNetos.forEach(s => {
      const acreedor = s.neto > 0 ? s.a : s.b;
      const deudor = s.neto > 0 ? s.b : s.a;
      const monto = Math.abs(s.neto);
      if (proyectoMatch(acreedor, proyectoActivo)) posicionNeta += monto;
      if (proyectoMatch(deudor, proyectoActivo)) posicionNeta -= monto;
    });
  }

  // Tercera KPI: cuando no hay proyecto, muestra el proyecto con mayor egreso;
  // cuando hay proyecto activo, muestra el monto promedio por operación.
  let tercerKpi;
  if (proyectoActivo) {
    const promedio = egresos.pagos.length ? egresos.total / egresos.pagos.length : 0;
    tercerKpi = `
      <div class="re-kpi-label">Ticket Promedio</div>
      <div class="re-kpi-value" style="color:var(--accent);">${fmt(promedio)}</div>
      <div class="re-kpi-sub">Por operación de pago</div>
    `;
  } else {
    tercerKpi = `
      <div class="re-kpi-label">Mayor Egreso por Proyecto</div>
      <div class="re-kpi-value" style="color:var(--accent);font-size:16px;">${topProy ? topProy[0] : '—'}</div>
      <div class="re-kpi-sub">${topProy ? fmt(topProy[1]) + ' · ' + topProyPct.toFixed(1) + '%' : 'Sin pagos'}</div>
    `;
  }

  // Cuarta KPI: en Total muestra préstamos entre proyectos; en proyecto, su deuda neta
  let cuartaKpi;
  if (proyectoActivo) {
    if (posicionNeta < -0.01) {
      cuartaKpi = `
        <div class="re-kpi-label">Deuda Neta</div>
        <div class="re-kpi-value" style="color:#e05a5a;">${fmt(Math.abs(posicionNeta))}</div>
        <div class="re-kpi-sub">El proyecto debe a otros proyectos</div>
      `;
    } else if (posicionNeta > 0.01) {
      cuartaKpi = `
        <div class="re-kpi-label">Saldo a Favor</div>
        <div class="re-kpi-value" style="color:#4caf7d;">${fmt(posicionNeta)}</div>
        <div class="re-kpi-sub">Otros proyectos le deben</div>
      `;
    } else {
      cuartaKpi = `
        <div class="re-kpi-label">Deuda Neta</div>
        <div class="re-kpi-value" style="color:var(--muted);">${fmt(0)}</div>
        <div class="re-kpi-sub">Sin saldos pendientes</div>
      `;
    }
  } else {
    cuartaKpi = `
      <div class="re-kpi-label">Préstamos entre Proyectos</div>
      <div class="re-kpi-value" style="color:#9b7fe8;">${fmt(prestamosVivos)}</div>
      <div class="re-kpi-sub">${paresPrestamos} relación${paresPrestamos !== 1 ? 'es' : ''} pendiente${paresPrestamos !== 1 ? 's' : ''}</div>
    `;
  }

  cont.innerHTML = `
    <div class="re-kpi">
      <div class="re-kpi-label">Egresos del Período</div>
      <div class="re-kpi-value" style="color:#e07a3a;">${fmt(egresos.total)}</div>
      <div class="re-kpi-sub">${varHTML}</div>
    </div>
    <div class="re-kpi">
      <div class="re-kpi-label">Operaciones de Pago</div>
      <div class="re-kpi-value" style="color:#5a9be0;">${egresos.pagos.length}</div>
      <div class="re-kpi-sub">Pagos registrados en el período</div>
    </div>
    <div class="re-kpi">${tercerKpi}</div>
    <div class="re-kpi">${cuartaKpi}</div>
  `;
}

function renderTendencia(periodo) {
  const canvas = document.getElementById('re-chart-tendencia');
  if (!canvas) return;
  if (chartGastoMensual) { chartGastoMensual.destroy(); chartGastoMensual = null; }
  if (typeof Chart === 'undefined') return;

  // Tendencia: últimos 6 meses completos (independiente del periodo)
  const hoy = new Date();
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }) });
  }

  // Suma todo el historial (mismo criterio que la KPI "Egresos del Período")
  const valores = meses.map(m => {
    const total = state.historial.reduce((s, h) => {
      if (!dentroProyecto(h.proyecto)) return s;
      const iso = parseFechaHist(h.fecha);
      if (!iso) return s;
      const [y, mm] = iso.split('-').map(Number);
      if (y === m.year && (mm - 1) === m.month) return s + (parseFloat(h.importe) || 0);
      return s;
    }, 0);
    return total;
  });

  chartGastoMensual = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: meses.map(m => m.label),
      datasets: [{
        label: 'Egresos',
        data: valores,
        backgroundColor: meses.map((_, i) => i === meses.length - 1 ? '#c8a96e' : 'rgba(200,169,110,0.35)'),
        borderColor: '#c8a96e',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmt(ctx.parsed.y) } }
      },
      scales: {
        x: { ticks: { color: '#888', font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: '#888', font: { size: 10 }, callback: v => '$' + (v / 1000).toFixed(0) + 'k' }, grid: { color: 'rgba(128,128,128,0.08)' } }
      }
    }
  });
}

// Egreso total por proyecto en el período: mismo cálculo que Resumen de Costos
// — suma todo el historial filtrado por fecha y agrupado por h.proyecto
function egresoPorProyecto(periodo) {
  const grupos = {};
  state.historial.forEach(h => {
    const iso = parseFechaHist(h.fecha);
    if (!dentroPeriodo(iso, periodo)) return;
    if (!dentroProyecto(h.proyecto)) return;
    const k = h.proyecto || 'Sin proyecto';
    grupos[k] = (grupos[k] || 0) + (parseFloat(h.importe) || 0);
  });
  return grupos;
}

function renderDistribuciones(periodo) {
  // Si hay proyecto filtrado, ocultar la doughnut por proyecto y expandir tendencia.
  const cardProy = document.getElementById('re-chart-proyecto')?.closest('.re-card');
  const filaTendencia = document.getElementById('re-fila-tendencia');
  if (cardProy) cardProy.style.display = proyectoActivo ? 'none' : '';
  if (filaTendencia) filaTendencia.style.gridTemplateColumns = proyectoActivo ? '1fr' : '1.4fr 1fr';

  renderProyectoChart(egresoPorProyecto(periodo));

  // Partida — todo el historial (mismo criterio que Resumen de Costos / KPI)
  const porPartida = {};
  state.historial.forEach(h => {
    if (!dentroProyecto(h.proyecto)) return;
    const iso = parseFechaHist(h.fecha);
    if (!dentroPeriodo(iso, periodo)) return;
    const k = h.partida || 'Sin partida';
    porPartida[k] = (porPartida[k] || 0) + (parseFloat(h.importe) || 0);
  });
  renderPartidaChart(porPartida);
}

function renderProyectoChart(grupos) {
  const canvas = document.getElementById('re-chart-proyecto');
  if (!canvas) return;
  if (chartProyectoPie) { chartProyectoPie.destroy(); chartProyectoPie = null; }
  if (typeof Chart === 'undefined') return;

  const entries = Object.entries(grupos).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const labels = entries.map(e => e[0]);
  const values = entries.map(e => e[1]);
  const colors = labels.map((l, i) => state.proyectos.find(p => p.nombre === l)?.color || PALETA[i % PALETA.length]);

  chartProyectoPie = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: 'var(--bg)', borderWidth: 2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#888', font: { size: 11 }, boxWidth: 12, padding: 8 } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.parsed)}` } }
      }
    }
  });
}

function renderPartidaChart(grupos) {
  const canvas = document.getElementById('re-chart-partida');
  if (!canvas) return;
  if (chartPartidaBar) { chartPartidaBar.destroy(); chartPartidaBar = null; }
  if (typeof Chart === 'undefined') return;

  const entries = Object.entries(grupos).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) return;

  const labels = entries.map(e => e[0]);
  const values = entries.map(e => e[1]);

  chartPartidaBar = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: labels.map((_, i) => PALETA[i % PALETA.length]), borderRadius: 4 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmt(ctx.parsed.x) } }
      },
      scales: {
        x: { ticks: { color: '#888', font: { size: 10 }, callback: v => '$' + (v / 1000).toFixed(0) + 'k' }, grid: { color: 'rgba(128,128,128,0.08)' } },
        y: { ticks: { color: '#aaa', font: { size: 11 } }, grid: { display: false } }
      }
    }
  });
}

function renderPrestamos(periodo) {
  renderSaldosNetos();
  renderSubPartidas(periodo);
}

function renderSaldosNetos() {
  const cont = document.getElementById('re-saldos-netos');
  if (!cont) return;

  const saldos = calcularSaldosNetosPrestamos();
  if (!saldos.length) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:14px 0;text-align:center;">Sin préstamos pendientes entre proyectos</div>';
    return;
  }

  // Ordenar por monto descendente
  saldos.sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto));

  cont.innerHTML = saldos.map(s => {
    const deudor = s.neto > 0 ? s.b : s.a;
    const acreedor = s.neto > 0 ? s.a : s.b;
    const monto = Math.abs(s.neto);
    return `
      <div class="re-prestamo-row">
        <div style="flex:1;font-size:12px;">
          <span style="font-weight:600;color:#e05a5a;">${deudor}</span>
          <span style="color:var(--muted);margin:0 6px;font-size:11px;">debe a</span>
          <span style="font-weight:600;color:#4caf7d;">${acreedor}</span>
        </div>
        <div style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent);font-size:14px;">${fmt(monto)}</div>
      </div>
    `;
  }).join('');
}

function renderSubPartidas(periodo) {
  const cont = document.getElementById('re-lista-subpartidas');
  if (!cont) return;

  const pagos = state.historial.filter(h => {
    if (!dentroPeriodo(parseFechaHist(h.fecha), periodo)) return false;
    if (!dentroProyecto(h.proyecto)) return false;
    return !!h.sub_partida;
  });
  const total = pagos.reduce((s, h) => s + (parseFloat(h.importe) || 0), 0);
  const porSub = {};
  pagos.forEach(h => {
    porSub[h.sub_partida] = (porSub[h.sub_partida] || 0) + (parseFloat(h.importe) || 0);
  });
  const sorted = Object.entries(porSub).sort((a, b) => b[1] - a[1]);

  if (!sorted.length || total <= 0) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:14px 0;text-align:center;">Sin sub-partidas registradas en el período</div>';
    return;
  }

  const maxV = sorted[0][1];
  cont.innerHTML = sorted.map(([sub, monto], i) => {
    const pct = (monto / total) * 100;
    const barPct = (monto / maxV) * 100;
    const color = PALETA[i % PALETA.length];
    return `
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
          <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%;">${sub}</span>
          <span style="font-family:'DM Mono',monospace;font-weight:600;color:${color};">${fmt(monto)}</span>
        </div>
        <div style="height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${barPct}%;background:${color};"></div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">${pct.toFixed(1)}% del total con sub-partida</div>
      </div>
    `;
  }).join('');
}

function renderTopBeneficiarios(periodo) {
  const cont = document.getElementById('re-top-benef');
  if (!cont) return;

  const pagos = state.historial.filter(h => h.tipo_registro === 'Pago' && dentroPeriodo(parseFechaHist(h.fecha), periodo) && dentroProyecto(h.proyecto));
  const porBenef = {};
  pagos.forEach(h => {
    const k = h.nombre || '—';
    porBenef[k] = (porBenef[k] || 0) + (parseFloat(h.importe) || 0);
  });
  const total = pagos.reduce((s, h) => s + (parseFloat(h.importe) || 0), 0);
  const top = Object.entries(porBenef).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (!top.length) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:14px 0;text-align:center;">Sin pagos en el período</div>';
    return;
  }

  const maxV = top[0][1];
  cont.innerHTML = top.map(([nombre, monto], i) => {
    const pct = total > 0 ? (monto / total) * 100 : 0;
    const barPct = (monto / maxV) * 100;
    const color = PALETA[i % PALETA.length];
    return `
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
          <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%;">${nombre}</span>
          <span style="font-family:'DM Mono',monospace;font-weight:600;color:${color};">${fmt(monto)}</span>
        </div>
        <div style="height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${barPct}%;background:${color};"></div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">${pct.toFixed(1)}% del egreso total</div>
      </div>
    `;
  }).join('');
}

function renderObservaciones(periodo) {
  const cont = document.getElementById('re-observaciones');
  if (!cont) return;

  const obs = [];
  const egresos = calcularEgresos(periodo);
  const egresoPorProy = egresoPorProyecto(periodo);
  const topProy = Object.entries(egresoPorProy).sort((a, b) => b[1] - a[1])[0];
  const totalProy = Object.values(egresoPorProy).reduce((s, v) => s + v, 0);
  const saldosNetos = calcularSaldosNetosPrestamos();

  const ambito = proyectoActivo ? ` para <strong>${proyectoActivo}</strong>` : '';
  if (egresos.total > 0) obs.push(`Egresos del período${ambito} por <strong>${fmt(egresos.total)}</strong> en <strong>${egresos.pagos.length}</strong> operaciones de pago.`);
  if (!proyectoActivo && topProy && totalProy > 0) {
    const pct = (topProy[1] / totalProy) * 100;
    obs.push(`El proyecto <strong>${topProy[0]}</strong> concentró <strong>${pct.toFixed(1)}%</strong> del egreso (${fmt(topProy[1])}).`);
  }
  if (saldosNetos.length) {
    const total = saldosNetos.reduce((s, p) => s + Math.abs(p.neto), 0);
    obs.push(`Existen <strong>${saldosNetos.length}</strong> relación${saldosNetos.length !== 1 ? 'es' : ''} de préstamo entre proyectos por un total neto de <strong>${fmt(total)}</strong>.`);
    const mayor = [...saldosNetos].sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto))[0];
    const deudor = mayor.neto > 0 ? mayor.b : mayor.a;
    const acreedor = mayor.neto > 0 ? mayor.a : mayor.b;
    obs.push(`Mayor saldo: <strong>${deudor}</strong> debe a <strong>${acreedor}</strong> <strong>${fmt(Math.abs(mayor.neto))}</strong>.`);
  }

  if (!obs.length) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:12px;">Sin observaciones para el período.</div>';
    return;
  }

  cont.innerHTML = obs.map(o => `<div style="padding:6px 0;font-size:12px;line-height:1.55;">• ${o}</div>`).join('');
}

function exportarCSV() {
  const periodo = obtenerPeriodo();
  const egresos = calcularEgresos(periodo);
  const egresoPorProy = egresoPorProyecto(periodo);
  const saldosNetos = calcularSaldosNetosPrestamos();

  let csv = 'Resumen Ejecutivo Dehur Territorial\n';
  csv += `Periodo,${periodo.desde || '—'} a ${periodo.hasta || '—'}\n\n`;
  csv += 'Indicador,Valor\n';
  csv += `Egresos del Periodo,${egresos.total.toFixed(2)}\n`;
  csv += `Numero de Pagos,${egresos.pagos.length}\n\n`;
  csv += 'Proyecto,Egreso del Periodo\n';
  Object.entries(egresoPorProy).sort((a, b) => b[1] - a[1]).forEach(([p, v]) => {
    csv += `"${p}",${v.toFixed(2)}\n`;
  });
  csv += '\nDeudor,Acreedor,Monto Neto\n';
  saldosNetos.forEach(s => {
    const deudor = s.neto > 0 ? s.b : s.a;
    const acreedor = s.neto > 0 ? s.a : s.b;
    csv += `"${deudor}","${acreedor}",${Math.abs(s.neto).toFixed(2)}\n`;
  });

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `resumen_ejecutivo_${(periodo.desde || 'inicio')}_${(periodo.hasta || 'fin')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

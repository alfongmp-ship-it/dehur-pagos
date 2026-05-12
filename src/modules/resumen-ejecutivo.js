import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { parseFechaHist } from './historial.js';
import { proyectoMatch } from '../config/proyectos.js';

let chartGastoMensual = null;
let chartProyectoPie = null;
let chartPartidaBar = null;
let reInitialized = false;

const PALETA = ['#c8a96e', '#5a9be0', '#4caf7d', '#e07a3a', '#9b7fe8', '#e05a5a', '#27ae60', '#3498db'];

export function renderResumenEjecutivo() {
  const cont = document.getElementById('re-contenido');
  const empty = document.getElementById('re-empty-state');
  if (!cont) return;

  if (!state.gsToken) {
    cont.style.display = 'none';
    if (empty) empty.style.display = '';
    destruirCharts();
    return;
  }

  cont.style.display = '';
  if (empty) empty.style.display = 'none';

  initOnce();

  const periodo = obtenerPeriodo();
  renderEncabezado(periodo);
  renderKPIs(periodo);
  renderTendencia(periodo);
  renderDistribuciones(periodo);
  renderPosicionCreditos();
  renderPagaresProximos();
  renderTopBeneficiarios(periodo);
  renderObservaciones(periodo);
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
  if (sub) sub.textContent = `Periodo: ${formatearFechaLarga(periodo.desde)} — ${formatearFechaLarga(periodo.hasta)}`;
  const gen = document.getElementById('re-generado');
  if (gen) {
    const ahora = new Date();
    gen.textContent = `Generado el ${ahora.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })} a las ${ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

function calcularSaldosActuales() {
  const proyActivos = state.proyectos.filter(p => p.activo !== false && p.cuenta);
  const cpActivas = state.cuentasPropias.filter(c => c.activo !== false);
  const totalProy = proyActivos.reduce((s, p) => s + (parseFloat(p.saldo) || 0), 0);
  const totalCP = cpActivas.reduce((s, c) => s + (parseFloat(c.saldo) || 0), 0);
  return { totalProy, totalCP, total: totalProy + totalCP, cuentas: [...proyActivos.map(p => ({ nombre: p.nombre, saldo: parseFloat(p.saldo) || 0, color: p.color || '#c8a96e' })), ...cpActivas.map(c => ({ nombre: c.nombre, saldo: parseFloat(c.saldo) || 0, color: '#5a9be0' }))] };
}

function calcularEgresos(periodo) {
  const pagos = state.historial.filter(h => {
    if (h.tipo_registro !== 'Pago') return false;
    const iso = parseFechaHist(h.fecha);
    return dentroPeriodo(iso, periodo);
  });
  const total = pagos.reduce((s, h) => s + (parseFloat(h.importe) || 0), 0);
  return { pagos, total };
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

function calcularCreditos() {
  const activos = state.creditos.filter(c => c.activo !== false);
  let autorizado = 0, dispuesto = 0;
  activos.forEach(c => {
    autorizado += parseFloat(c.monto_autorizado) || 0;
    const pgs = state.pagares.filter(p => p.credito_id === c.credito_id && p.activo !== false);
    dispuesto += pgs.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0);
  });
  return { autorizado, dispuesto, disponible: autorizado - dispuesto, lineas: activos.length };
}

function renderKPIs(periodo) {
  const cont = document.getElementById('re-kpis');
  if (!cont) return;

  const saldos = calcularSaldosActuales();
  const egresos = calcularEgresos(periodo);
  const prev = calcularEgresosPrevios(periodo);
  const creditos = calcularCreditos();

  let varHTML = '<span style="color:var(--muted);font-size:11px;">Sin datos previos</span>';
  if (prev !== null && prev > 0) {
    const delta = egresos.total - prev;
    const pct = (delta / prev) * 100;
    const signo = pct >= 0 ? '+' : '';
    const color = pct >= 0 ? '#e05a5a' : '#4caf7d';
    varHTML = `<span style="color:${color};font-size:11px;font-weight:600;">${signo}${pct.toFixed(1)}% vs período anterior</span>`;
  }

  // Pagarés próximos a vencer (30 días)
  const hoy = new Date();
  const en30 = new Date(hoy); en30.setDate(en30.getDate() + 30);
  const pagaresVigentes = state.pagares.filter(p => p.activo !== false && p.estatus === 'Vigente');
  const proximos = pagaresVigentes.filter(p => {
    if (!p.fecha_vencimiento) return false;
    const v = new Date(p.fecha_vencimiento);
    return v >= hoy && v <= en30;
  });
  const montoProximos = proximos.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0);

  cont.innerHTML = `
    <div class="re-kpi">
      <div class="re-kpi-label">Saldo Total Líquido</div>
      <div class="re-kpi-value" style="color:var(--accent);">${fmt(saldos.total)}</div>
      <div class="re-kpi-sub">${saldos.cuentas.length} cuentas activas</div>
    </div>
    <div class="re-kpi">
      <div class="re-kpi-label">Egresos del Período</div>
      <div class="re-kpi-value" style="color:#e07a3a;">${fmt(egresos.total)}</div>
      <div class="re-kpi-sub">${egresos.pagos.length} pagos · ${varHTML}</div>
    </div>
    <div class="re-kpi">
      <div class="re-kpi-label">Líneas de Crédito</div>
      <div class="re-kpi-value" style="color:#9b7fe8;">${fmt(creditos.dispuesto)}</div>
      <div class="re-kpi-sub">${creditos.lineas} líneas · Disponible ${fmt(creditos.disponible)}</div>
    </div>
    <div class="re-kpi">
      <div class="re-kpi-label">Vencimientos 30 días</div>
      <div class="re-kpi-value" style="color:${proximos.length ? '#e05a5a' : 'var(--muted)'};">${fmt(montoProximos)}</div>
      <div class="re-kpi-sub">${proximos.length} pagaré${proximos.length !== 1 ? 's' : ''} próximo${proximos.length !== 1 ? 's' : ''}</div>
    </div>
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

  const valores = meses.map(m => {
    const total = state.historial.reduce((s, h) => {
      if (h.tipo_registro !== 'Pago') return s;
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

function renderDistribuciones(periodo) {
  const pagos = state.historial.filter(h => h.tipo_registro === 'Pago' && dentroPeriodo(parseFechaHist(h.fecha), periodo));

  // Proyecto - doughnut
  const porProyecto = {};
  pagos.forEach(h => {
    const p = h.proyecto || 'Sin proyecto';
    porProyecto[p] = (porProyecto[p] || 0) + (parseFloat(h.importe) || 0);
  });
  renderProyectoChart(porProyecto);

  // Partida - barras horizontales (top 8)
  const porPartida = {};
  pagos.forEach(h => {
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
  const colors = labels.map(l => state.proyectos.find(p => p.nombre === l)?.color || PALETA[labels.indexOf(l) % PALETA.length]);

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

function renderPosicionCreditos() {
  const cont = document.getElementById('re-creditos');
  if (!cont) return;

  const activos = state.creditos.filter(c => c.activo !== false);
  if (!activos.length) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:14px 0;text-align:center;">Sin líneas de crédito registradas</div>';
    return;
  }

  cont.innerHTML = `
    <div class="re-table">
      <div class="re-table-head" style="grid-template-columns:1.5fr 90px 1fr 1fr 1fr;">
        <div>Línea / Banco</div>
        <div style="text-align:center;">Tasa</div>
        <div style="text-align:right;">Autorizado</div>
        <div style="text-align:right;">Dispuesto</div>
        <div style="text-align:right;">Disponible</div>
      </div>
      ${activos.map(c => {
        const pgs = state.pagares.filter(p => p.credito_id === c.credito_id && p.activo !== false);
        const dispuesto = pgs.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0);
        const disp = (parseFloat(c.monto_autorizado) || 0) - dispuesto;
        const pctUso = c.monto_autorizado > 0 ? (dispuesto / c.monto_autorizado) * 100 : 0;
        return `
          <div class="re-table-row" style="grid-template-columns:1.5fr 90px 1fr 1fr 1fr;">
            <div>
              <div style="font-weight:600;font-size:12px;">${c.nombre}</div>
              <div style="font-size:10px;color:var(--muted);">${c.banco} · ${c.tipo_credito}${c.proyecto ? ' · ' + c.proyecto : ''}</div>
              <div style="height:4px;background:var(--surface2);border-radius:2px;margin-top:6px;overflow:hidden;">
                <div style="height:100%;width:${pctUso}%;background:${pctUso > 80 ? '#e05a5a' : '#c8a96e'};"></div>
              </div>
            </div>
            <div style="text-align:center;font-family:'DM Mono',monospace;font-size:11px;">${c.tasa_base || 0}%</div>
            <div style="text-align:right;font-family:'DM Mono',monospace;font-size:11px;">${fmt(parseFloat(c.monto_autorizado) || 0)}</div>
            <div style="text-align:right;font-family:'DM Mono',monospace;font-size:11px;color:#e07a3a;">${fmt(dispuesto)}</div>
            <div style="text-align:right;font-family:'DM Mono',monospace;font-size:11px;color:#4caf7d;font-weight:600;">${fmt(disp)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderPagaresProximos() {
  const cont = document.getElementById('re-pagares');
  if (!cont) return;

  const hoy = new Date();
  const en60 = new Date(hoy); en60.setDate(en60.getDate() + 60);
  const proximos = state.pagares
    .filter(p => p.activo !== false && p.estatus === 'Vigente' && p.fecha_vencimiento)
    .filter(p => {
      const v = new Date(p.fecha_vencimiento);
      return v >= hoy && v <= en60;
    })
    .sort((a, b) => (a.fecha_vencimiento || '').localeCompare(b.fecha_vencimiento || ''))
    .slice(0, 6);

  if (!proximos.length) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:14px 0;text-align:center;">Sin vencimientos en los próximos 60 días</div>';
    return;
  }

  cont.innerHTML = proximos.map(p => {
    const credito = state.creditos.find(c => c.credito_id === p.credito_id);
    const dias = Math.ceil((new Date(p.fecha_vencimiento) - hoy) / 86400000);
    const urgColor = dias <= 7 ? '#e05a5a' : dias <= 30 ? '#e07a3a' : 'var(--muted)';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:500;">${credito?.nombre || '—'} · Pagaré ${p.numero_pagare}</div>
          <div style="font-size:10px;color:var(--muted);">Vence ${p.fecha_vencimiento} · <span style="color:${urgColor};font-weight:600;">${dias} día${dias !== 1 ? 's' : ''}</span></div>
        </div>
        <div style="font-family:'DM Mono',monospace;font-weight:600;color:var(--accent);">${fmt(parseFloat(p.monto) || 0)}</div>
      </div>
    `;
  }).join('');
}

function renderTopBeneficiarios(periodo) {
  const cont = document.getElementById('re-top-benef');
  if (!cont) return;

  const pagos = state.historial.filter(h => h.tipo_registro === 'Pago' && dentroPeriodo(parseFechaHist(h.fecha), periodo));
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
  const saldos = calcularSaldosActuales();
  const egresos = calcularEgresos(periodo);
  const creditos = calcularCreditos();

  if (saldos.total > 0) obs.push(`Posición líquida actual de <strong>${fmt(saldos.total)}</strong> distribuida en ${saldos.cuentas.length} cuentas activas.`);
  if (egresos.total > 0) obs.push(`Egresos del período por <strong>${fmt(egresos.total)}</strong> en <strong>${egresos.pagos.length}</strong> operaciones.`);
  if (creditos.lineas > 0) {
    const pctUso = creditos.autorizado > 0 ? (creditos.dispuesto / creditos.autorizado) * 100 : 0;
    obs.push(`Uso de líneas de crédito: <strong>${pctUso.toFixed(1)}%</strong> (${fmt(creditos.dispuesto)} de ${fmt(creditos.autorizado)} autorizados).`);
  }

  const hoy = new Date();
  const en30 = new Date(hoy); en30.setDate(en30.getDate() + 30);
  const vencen30 = state.pagares.filter(p => p.activo !== false && p.estatus === 'Vigente' && p.fecha_vencimiento && new Date(p.fecha_vencimiento) >= hoy && new Date(p.fecha_vencimiento) <= en30);
  if (vencen30.length) {
    const monto = vencen30.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0);
    obs.push(`<strong>${vencen30.length}</strong> pagaré${vencen30.length !== 1 ? 's' : ''} vence${vencen30.length !== 1 ? 'n' : ''} en los próximos 30 días por <strong>${fmt(monto)}</strong>.`);
  }

  if (!obs.length) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:12px;">Sin observaciones para el período.</div>';
    return;
  }

  cont.innerHTML = obs.map(o => `<div style="padding:6px 0;font-size:12px;line-height:1.55;">• ${o}</div>`).join('');
}

function exportarCSV() {
  const periodo = obtenerPeriodo();
  const saldos = calcularSaldosActuales();
  const egresos = calcularEgresos(periodo);
  const creditos = calcularCreditos();

  let csv = 'Resumen Ejecutivo Dehur Territorial\n';
  csv += `Periodo,${periodo.desde || '—'} a ${periodo.hasta || '—'}\n\n`;
  csv += 'Indicador,Valor\n';
  csv += `Saldo Total Liquido,${saldos.total.toFixed(2)}\n`;
  csv += `Egresos del Periodo,${egresos.total.toFixed(2)}\n`;
  csv += `Numero de Pagos,${egresos.pagos.length}\n`;
  csv += `Lineas de Credito Autorizado,${creditos.autorizado.toFixed(2)}\n`;
  csv += `Dispuesto,${creditos.dispuesto.toFixed(2)}\n`;
  csv += `Disponible,${creditos.disponible.toFixed(2)}\n`;

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `resumen_ejecutivo_${(periodo.desde || 'inicio')}_${(periodo.hasta || 'fin')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveCuentasPropias, gsSaveProyectos, gsAppendHistorialSaldo } from '../services/google-sync.js';
import { saveProy } from '../config/proyectos.js';

const TIPO_COLORS = {
  'Dispersión': 'rgba(200,169,110,.15);color:#C8A96E',
  'Cobranza':   'rgba(52,152,219,.15);color:#3498db',
  'Ahorro':     'rgba(39,174,96,.15);color:#27ae60',
  'Pagos':      'rgba(224,122,58,.15);color:#e07a3a',
  'General':    'rgba(150,150,150,.15);color:#aaa'
};

let chartSaldos = null;

const CARD_COLORS = ['#c8a96e', '#5a9be0', '#4caf7d', '#e07a3a', '#9b7fe8', '#3498db', '#27ae60', '#e05a5a'];

function getColorForCuenta(index) {
  return CARD_COLORS[index % CARD_COLORS.length];
}

export function renderPosicionDia() {
  const container = document.getElementById('posicion-dia');
  const cardsEl = document.getElementById('pos-cards');
  const fechaEl = document.getElementById('pos-fecha');
  if (!container || !cardsEl) return;

  const proyActivos = state.proyectos.filter(p => p.activo !== false && p.cuenta);
  const cpActivas = state.cuentasPropias.filter(c => c.activo !== false);
  const todas = [
    ...proyActivos.map(p => ({ id: p.id, nombre: p.nombre, saldo: parseFloat(p.saldo) || 0, tipo: 'proyecto', color: p.color || '#c8a96e', ult: p.ultima_act_saldo || '' })),
    ...cpActivas.map((c, i) => ({ id: c.cuenta_id, nombre: c.nombre, saldo: parseFloat(c.saldo) || 0, tipo: 'propia', color: getColorForCuenta(proyActivos.length + i), ult: c.ultima_actualizacion || '' }))
  ];

  if (!todas.length) { container.style.display = 'none'; return; }

  container.style.display = 'block';
  const total = todas.reduce((s, c) => s + c.saldo, 0);

  // Fecha más reciente
  const fechas = todas.map(c => c.ult).filter(Boolean).sort().reverse();
  fechaEl.textContent = fechas.length ? fechas[0] : '';

  // Determinar grid columns
  const cols = Math.min(todas.length + 1, 5);
  cardsEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  // Card de total + cards por cuenta
  cardsEl.innerHTML =
    `<div class="stat-card" style="border-left:3px solid var(--accent);">
      <div class="stat-label">Saldo Total</div>
      <div class="stat-value stat-accent">${fmt(total)}</div>
      <div class="stat-sub">${todas.length} cuentas activas</div>
    </div>` +
    todas.map(c =>
      `<div class="stat-card" style="border-left:3px solid ${c.color};">
        <div class="stat-label">${c.nombre}</div>
        <div class="stat-value" style="color:${c.color};font-size:20px;">${fmt(c.saldo)}</div>
        <div class="stat-sub">${c.ult || 'Sin actualizar'}</div>
      </div>`
    ).join('');

  // Gráfica de evolución
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

  // Agrupar por fecha (solo la parte de fecha, sin hora)
  const fechasSet = [...new Set(hist.map(h => h.fecha.split(' ')[0]))].sort();

  // Obtener IDs únicos de cuentas en el historial
  const cuentaIds = [...new Set(hist.map(h => h.cuenta_id))];

  // Colores: buscar en cuentas actuales o asignar
  const colorMap = {};
  cuentasActuales.forEach(c => { colorMap[String(c.id)] = c.color; });

  // Dataset por cuenta
  const datasets = cuentaIds.map(id => {
    const nombre = hist.find(h => h.cuenta_id === id)?.cuenta_nombre || id;
    const color = colorMap[id] || '#888';
    const data = fechasSet.map(f => {
      const registros = hist.filter(h => h.cuenta_id === id && h.fecha.startsWith(f));
      return registros.length ? registros[registros.length - 1].saldo : null;
    });
    return { label: nombre, data, borderColor: color, backgroundColor: color + '22', tension: 0.3, pointRadius: 3, borderWidth: 2, spanGaps: true };
  });

  // Dataset de total
  const totalData = fechasSet.map(f => {
    const registros = hist.filter(h => h.fecha.startsWith(f));
    if (!registros.length) return null;
    const ultimo = registros[registros.length - 1];
    return ultimo.saldo_total;
  });
  datasets.unshift({ label: 'Total', data: totalData, borderColor: '#c8a96e', backgroundColor: 'rgba(200,169,110,.1)', tension: 0.3, pointRadius: 4, borderWidth: 3, borderDash: [6, 3], spanGaps: true });

  if (chartSaldos) chartSaldos.destroy();

  chartSaldos = new Chart(canvas, {
    type: 'line',
    data: { labels: fechasSet, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#aaa', font: { size: 11 }, boxWidth: 12, padding: 15 } },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label + ': $' + (ctx.parsed.y || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#888', font: { size: 10 } } },
        y: {
          grid: { color: 'rgba(255,255,255,.05)' },
          ticks: { color: '#888', font: { size: 10 }, callback: v => '$' + (v / 1000).toFixed(0) + 'k' }
        }
      }
    }
  });
}

function tipoBadge(tipo) {
  const style = TIPO_COLORS[tipo] || TIPO_COLORS['General'];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${style};">${tipo}</span>`;
}

export function renderCuentasPropias() {
  const tb = document.getElementById('tbody-cp');
  if (!tb) return;

  if (!state.gsToken) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver tus cuentas</div></div></td></tr>';
    const sub = document.getElementById('cp-subtitulo'); if (sub) sub.textContent = '';
    const cnt = document.getElementById('cnt-cp'); if (cnt) cnt.textContent = '0';
    return;
  }

  // Filas de proyectos (solo lectura)
  const filasProyectos = state.proyectos
    .filter(p => p.activo !== false && p.cuenta)
    .map(p => `<tr style="opacity:.85;">
      <td>${tipoBadge(p.tipo_cuenta || 'Dispersión')}</td>
      <td><div style="font-weight:500;font-size:12px;">${p.nombre} <span style="font-size:10px;color:var(--muted);font-weight:400;">· Principal</span></div></td>
      <td style="font-size:11px;">BBVA</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${p.clabe || '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${p.cuenta || '—'}</td>
      <td>${proyTag(p.nombre)}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;color:${p.saldo ? 'var(--accent)' : 'var(--muted)'};">${p.saldo ? fmt(p.saldo) : '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${p.ultima_act_saldo || '—'}</td>
      <td style="text-align:right;display:flex;gap:4px;justify-content:flex-end;">
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="actualizarSaldoCuenta('${p.id}')">Actualizar saldo</button>
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="editarCuentaProyecto('${p.id}')">Editar</button>
      </td>
    </tr>`);

  // Filas de cuentas adicionales
  const filasExtra = state.cuentasPropias
    .filter(c => c.activo !== false)
    .map(c => `<tr>
      <td>${tipoBadge(c.tipo || 'General')}</td>
      <td><div style="font-weight:500;font-size:12px;">${c.nombre}</div></td>
      <td style="font-size:11px;">${c.banco}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${c.clabe || '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${c.numero_cuenta || '—'}</td>
      <td>${proyTag(c.proyecto)}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;color:var(--accent);">${fmt(c.saldo)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${c.ultima_actualizacion || '—'}</td>
      <td style="text-align:right;display:flex;gap:4px;justify-content:flex-end;">
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="actualizarSaldoExtra(${c.cuenta_id})">Actualizar saldo</button>
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="editarCuenta(${c.cuenta_id})">Editar</button>
      </td>
    </tr>`);

  const total = filasProyectos.length + filasExtra.length;

  if (!total) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🏦</div><div>Sin cuentas registradas</div></div></td></tr>';
    document.getElementById('cp-subtitulo').textContent = '';
    document.getElementById('cnt-cp').textContent = '0';
    return;
  }

  tb.innerHTML = [...filasProyectos, ...filasExtra].join('');
  document.getElementById('cp-subtitulo').textContent = `${total} cuenta${total !== 1 ? 's' : ''} (${filasProyectos.length} dispersión · ${filasExtra.length} adicionales)`;
  document.getElementById('cnt-cp').textContent = total;
  renderPosicionDia();
}

function populateCuentaSelects() {
  const sel = document.getElementById('cp-proyecto');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Sin proyecto —</option>' +
    state.proyectos.filter(p => p.activo !== false).map(p => `<option>${p.nombre}</option>`).join('');
}

export function abrirNuevaCuenta() {
  state.editCuentaId = null;
  document.getElementById('modal-cuenta-title').textContent = 'Nueva Cuenta';
  document.getElementById('cp-tipo').value = 'General';
  document.getElementById('cp-nombre').value = '';
  document.getElementById('cp-banco').value = '';
  document.getElementById('cp-clabe').value = '';
  document.getElementById('cp-numero-cuenta').value = '';
  document.getElementById('cp-saldo').value = '';
  document.getElementById('cp-ultima-act').value = new Date().toISOString().split('T')[0];
  populateCuentaSelects();
  document.getElementById('cp-proyecto').value = '';
  document.getElementById('modal-cuenta').classList.add('open');
}

export function editarCuenta(id) {
  const c = state.cuentasPropias.find(x => x.cuenta_id === id);
  if (!c) return;
  state.editCuentaId = id;
  state._editProyCuenta = null;
  populateCuentaSelects();
  document.getElementById('modal-cuenta-title').textContent = 'Editar Cuenta #' + id;
  document.getElementById('cp-tipo').value = c.tipo || 'General';
  document.getElementById('cp-nombre').value = c.nombre;
  document.getElementById('cp-banco').value = c.banco;
  document.getElementById('cp-clabe').value = c.clabe || '';
  document.getElementById('cp-numero-cuenta').value = c.numero_cuenta || '';
  document.getElementById('cp-saldo').value = c.saldo;
  document.getElementById('cp-ultima-act').value = c.ultima_actualizacion || '';
  document.getElementById('cp-proyecto').value = c.proyecto || '';
  document.getElementById('modal-cuenta').classList.add('open');
}

export function editarCuentaProyecto(proyId) {
  const p = state.proyectos.find(x => x.id === proyId);
  if (!p) return;
  state.editCuentaId = null;
  state._editProyCuenta = proyId;
  populateCuentaSelects();
  document.getElementById('modal-cuenta-title').textContent = 'Editar Cuenta – ' + p.nombre;
  document.getElementById('cp-tipo').value = p.tipo_cuenta || 'Dispersión';
  document.getElementById('cp-nombre').value = p.nombre;
  document.getElementById('cp-banco').value = 'BBVA';
  document.getElementById('cp-clabe').value = p.clabe || '';
  document.getElementById('cp-numero-cuenta').value = p.cuenta || '';
  document.getElementById('cp-saldo').value = p.saldo || 0;
  document.getElementById('cp-ultima-act').value = p.ultima_act_saldo || '';
  document.getElementById('cp-proyecto').value = p.nombre;
  document.getElementById('modal-cuenta').classList.add('open');
}

export function actualizarSaldoCuenta(proyId) {
  const p = state.proyectos.find(x => x.id === proyId);
  if (!p) return;
  state.editSaldoProy = proyId;
  state._editSaldoExtra = null;
  document.getElementById('modal-saldo-title').textContent = 'Actualizar Saldo – ' + p.nombre;
  document.getElementById('saldo-monto').value = p.saldo || '';
  document.getElementById('saldo-fecha').value = p.ultima_act_saldo || new Date().toISOString().split('T')[0];
  document.getElementById('modal-saldo').classList.add('open');
}

function registrarSaldoEnHistorial(cuentaId, nombre, tipo, saldo, ts) {
  const totalProy = state.proyectos.reduce((s, p) => s + (parseFloat(p.saldo) || 0), 0);
  const totalPropias = state.cuentasPropias.reduce((s, c) => s + (parseFloat(c.saldo) || 0), 0);
  const saldoTotal = totalProy + totalPropias;
  const registro = { fecha: ts, cuenta_id: String(cuentaId), cuenta_nombre: nombre, cuenta_tipo: tipo, saldo, saldo_total: saldoTotal };
  state.historialSaldos.push(registro);
  gsAppendHistorialSaldo(registro);
}

export function guardarSaldoCuenta() {
  const saldo = parseFloat(document.getElementById('saldo-monto').value) || 0;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  if (state._editSaldoExtra) {
    // Cuenta adicional (cuentasPropias)
    const c = state.cuentasPropias.find(x => x.cuenta_id === state._editSaldoExtra);
    if (!c) return;
    c.saldo = saldo;
    c.ultima_actualizacion = ts;
    state._editSaldoExtra = null;
    cerrar('modal-saldo');
    renderCuentasPropias();
    gsSaveCuentasPropias();
    registrarSaldoEnHistorial(c.cuenta_id, c.nombre, 'propia', saldo, ts);
    if (window.renderHeaderBadges) window.renderHeaderBadges();
    notify('Saldo actualizado');
  } else {
    // Cuenta de proyecto (dispersión)
    const p = state.proyectos.find(x => x.id === state.editSaldoProy);
    if (!p) return;
    p.saldo = saldo;
    p.ultima_act_saldo = ts;
    saveProy(state.proyectos);
    cerrar('modal-saldo');
    renderCuentasPropias();
    if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
    if (window.renderHeaderBadges) window.renderHeaderBadges();
    notify('Saldo actualizado');
    gsSaveProyectos();
    registrarSaldoEnHistorial(p.id, p.nombre, 'proyecto', saldo, ts);
  }
}

export function actualizarSaldoExtra(cuentaId) {
  const c = state.cuentasPropias.find(x => x.cuenta_id === cuentaId);
  if (!c) return;
  state.editSaldoProy = null;
  state._editSaldoExtra = cuentaId;
  document.getElementById('modal-saldo-title').textContent = 'Actualizar Saldo – ' + c.nombre;
  document.getElementById('saldo-monto').value = c.saldo || '';
  document.getElementById('saldo-fecha').value = c.ultima_actualizacion || new Date().toISOString().split('T')[0];
  document.getElementById('modal-saldo').classList.add('open');
}

export function guardarCuenta() {
  const nombre = document.getElementById('cp-nombre').value.trim();
  const banco = document.getElementById('cp-banco').value.trim();
  if (!nombre) { notify('El nombre es obligatorio', 'error'); return; }
  if (!banco) { notify('El banco es obligatorio', 'error'); return; }

  // Editando cuenta de proyecto
  if (state._editProyCuenta) {
    const p = state.proyectos.find(x => x.id === state._editProyCuenta);
    if (p) {
      p.nombre = nombre;
      p.cuenta = document.getElementById('cp-numero-cuenta').value.trim();
      p.clabe = document.getElementById('cp-clabe').value.trim();
      p.tipo_cuenta = document.getElementById('cp-tipo').value;
    }
    state._editProyCuenta = null;
    cerrar('modal-cuenta');
    renderCuentasPropias();
    notify('Cuenta de proyecto actualizada');
    saveProy(state.proyectos);
    gsSaveProyectos();
    return;
  }

  const obj = {
    cuenta_id: state.editCuentaId || (state.cuentasPropias.reduce((max, c) => Math.max(max, c.cuenta_id), 0) + 1),
    nombre,
    banco,
    clabe: document.getElementById('cp-clabe').value.trim(),
    numero_cuenta: document.getElementById('cp-numero-cuenta').value.trim(),
    proyecto: document.getElementById('cp-proyecto').value,
    tipo: document.getElementById('cp-tipo').value,
    saldo: parseFloat(document.getElementById('cp-saldo').value) || 0,
    ultima_actualizacion: document.getElementById('cp-ultima-act').value || new Date().toISOString().split('T')[0],
    activo: true
  };

  if (state.editCuentaId) {
    const i = state.cuentasPropias.findIndex(c => c.cuenta_id === state.editCuentaId);
    state.cuentasPropias[i] = obj;
  } else {
    state.cuentasPropias.push(obj);
  }

  cerrar('modal-cuenta');
  renderCuentasPropias();
  notify(state.editCuentaId ? 'Cuenta actualizada' : 'Cuenta registrada');
  gsSaveCuentasPropias();
}

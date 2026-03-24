import { state } from '../state.js';
import { fmt } from '../ui/format.js';

function tipoBadge(tipo) {
  if (!tipo) return '';
  const color = tipo === 'Traspaso'
    ? 'rgba(52,152,219,.15);color:#3498db'
    : tipo === 'Aportación'
      ? 'rgba(39,174,96,.15);color:#27ae60'
      : 'rgba(200,169,110,.15);color:#C8A96E';
  return `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:600;background:${color};">${tipo}</span>`;
}

function estatusBadge(estatus) {
  const map = {
    completado: 'rgba(39,174,96,.15);color:#27ae60',
    pendiente:  'rgba(224,122,58,.15);color:#e07a3a',
    cancelado:  'rgba(150,150,150,.15);color:#aaa'
  };
  const style = map[estatus] || map.pendiente;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${style};">${estatus}</span>`;
}

function getFilters() {
  return {
    tipo:     document.getElementById('res-filtro-tipo')?.value || '',
    proyecto: document.getElementById('res-filtro-proyecto')?.value || '',
    estatus:  document.getElementById('res-filtro-estatus')?.value || '',
    desde:    document.getElementById('res-filtro-desde')?.value || '',
    hasta:    document.getElementById('res-filtro-hasta')?.value || ''
  };
}

function applyFilters(lista, filters) {
  return lista.filter(t => {
    if (filters.tipo && t.tipo !== filters.tipo) return false;
    if (filters.proyecto && t.proyecto_origen !== filters.proyecto && t.proyecto_destino !== filters.proyecto) return false;
    if (filters.estatus && t.estatus !== filters.estatus) return false;
    if (filters.desde && t.fecha < filters.desde) return false;
    if (filters.hasta && t.fecha > filters.hasta) return false;
    return true;
  });
}

function calcularSaldosNetos(prestamos) {
  // Solo préstamos (distinto proyecto)
  const pares = {};
  for (const t of prestamos) {
    if (t.tipo !== 'Préstamo') continue;
    const a = t.proyecto_origen;
    const b = t.proyecto_destino;
    if (!a || !b) continue;
    const key = [a, b].sort().join('|||');
    if (!pares[key]) pares[key] = { a: [a, b].sort()[0], b: [a, b].sort()[1], neto: 0 };
    // Si a es el que presta en este registro: suma positivo desde a→b
    if (a === pares[key].a) {
      pares[key].neto += t.monto;
    } else {
      pares[key].neto -= t.monto;
    }
  }
  return Object.values(pares);
}

function renderSaldosNetos(filtrados) {
  const el = document.getElementById('resumen-saldos-netos');
  if (!el) return;

  const prestamos = filtrados.filter(t => t.tipo === 'Préstamo');
  if (!prestamos.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:10px 0;">Sin préstamos en el período seleccionado.</div>';
    return;
  }

  const saldos = calcularSaldosNetos(prestamos);
  el.innerHTML = saldos.map(s => {
    const deudor = s.neto > 0 ? s.b : s.a;
    const acreedor = s.neto > 0 ? s.a : s.b;
    const monto = Math.abs(s.neto);
    const color = 'var(--accent)';
    return `
      <div style="display:inline-flex;align-items:center;gap:10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 16px;margin:0 8px 8px 0;">
        <div style="font-size:12px;">
          <span style="font-weight:600;color:var(--red);">${deudor}</span>
          <span style="color:var(--muted);margin:0 6px;">le debe a</span>
          <span style="font-weight:600;color:var(--green);">${acreedor}</span>
        </div>
        <div style="font-family:'DM Mono',monospace;font-weight:700;color:${color};font-size:15px;">${fmt(monto)}</div>
      </div>
    `;
  }).join('');
}

function renderTabla(filtrados) {
  const tb = document.getElementById('tbody-resumen-traspasos');
  if (!tb) return;

  if (!filtrados.length) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div style="font-size:28px;margin-bottom:8px;opacity:.4">🔍</div><div>Sin resultados para los filtros seleccionados</div></div></td></tr>';
    return;
  }

  const sorted = [...filtrados].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  tb.innerHTML = sorted.map(t => `
    <tr>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${t.fecha || '—'}</td>
      <td>${tipoBadge(t.tipo)}</td>
      <td style="font-size:12px;font-weight:500;">${t.cuenta_origen_nombre || '—'}</td>
      <td style="font-size:12px;color:var(--muted);">${t.cuenta_destino_nombre || '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:600;text-align:right;color:var(--accent);">${fmt(t.monto)}</td>
      <td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.concepto || '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${t.referencia || '—'}</td>
      <td>${estatusBadge(t.estatus)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);">${t.fecha_registro || '—'}</td>
    </tr>
  `).join('');
}

function populateProyectosSelect() {
  const sel = document.getElementById('res-filtro-proyecto');
  if (!sel) return;
  const proyectos = [...new Set([
    ...state.traspasos.map(t => t.proyecto_origen),
    ...state.traspasos.map(t => t.proyecto_destino)
  ])].filter(Boolean).sort();
  sel.innerHTML = '<option value="">Todos los proyectos</option>' +
    proyectos.map(p => `<option value="${p}">${p}</option>`).join('');
}

export function filtrarResumen() {
  const filters = getFilters();
  const filtrados = applyFilters(state.traspasos, filters);
  renderSaldosNetos(filtrados);
  renderTabla(filtrados);

  const cnt = document.getElementById('resumen-cnt');
  if (cnt) cnt.textContent = filtrados.length + ' registro' + (filtrados.length !== 1 ? 's' : '');

  const total = filtrados.reduce((s, t) => s + (t.monto || 0), 0);
  const totalEl = document.getElementById('resumen-total');
  if (totalEl) totalEl.textContent = fmt(total);
}

export function renderResumenTraspasos() {
  populateProyectosSelect();
  filtrarResumen();
}

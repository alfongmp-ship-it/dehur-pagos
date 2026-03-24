import { state } from '../state.js';
import { fmt } from './format.js';

export function actualizarDisplaySaldo() {
  const el = document.getElementById('disp-saldo-display');
  if (!el) return;
  const sel = document.getElementById('cuenta-disp');
  const proyId = sel ? sel.value : null;
  const p = proyId ? state.proyectos.find(x => x.id === proyId) : null;
  if (p && p.saldo) {
    el.style.display = '';
    el.innerHTML = `🏦 <span style="color:var(--green);font-weight:700;font-size:15px;">${fmt(p.saldo)}</span><span style="color:var(--muted);font-size:11px;margin-left:6px;">disponible</span>`;
  } else {
    el.style.display = 'none';
  }
}

export function renderHeaderBadges() {
  const hb = document.getElementById('header-badges');
  if (!hb) return;
  const proyBadges = state.proyectos.filter(p => p.activo).map(p =>
    `<span class="badge" style="border-left:3px solid ${p.color};display:flex;align-items:center;gap:6px;">
      <span style="font-size:10px;">${p.nombre}</span>
      <span style="font-family:'DM Mono',monospace;font-size:11px;font-weight:700;color:${p.saldo ? 'var(--green)' : 'var(--muted)'};">${p.saldo ? fmt(p.saldo) : '—'}</span>
    </span>`
  ).join('');
  const extraBadges = state.cuentasPropias.filter(c => c.activo !== false).map(c =>
    `<span class="badge" style="border-left:3px solid var(--accent);display:flex;align-items:center;gap:6px;">
      <span style="font-size:10px;">${c.nombre}</span>
      <span style="font-family:'DM Mono',monospace;font-size:11px;font-weight:700;color:${c.saldo ? 'var(--green)' : 'var(--muted)'};">${c.saldo ? fmt(c.saldo) : '—'}</span>
    </span>`
  ).join('');
  hb.innerHTML = proyBadges + extraBadges;
}

export function renderCuentaDispSelect() {
  const sel = document.getElementById('cuenta-disp');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = state.proyectos.filter(p => p.activo).map(p =>
    `<option value="${p.id}">${p.nombre} – BBVA ···${p.cuenta.slice(-4)}</option>`
  ).join('');
  if (cur && state.proyectos.find(p => p.id === cur)) sel.value = cur;
  actualizarDisplaySaldo();
}


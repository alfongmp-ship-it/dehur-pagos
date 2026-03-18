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
    el.innerHTML = `🏦 <span style="color:var(--accent);font-weight:600;">${fmt(p.saldo)}</span><span style="color:var(--muted);font-size:10px;margin-left:4px;">disponible</span>`;
  } else {
    el.style.display = 'none';
  }
}

export function renderHeaderBadges() {
  const hb = document.getElementById('header-badges');
  if (!hb) return;
  hb.innerHTML = state.proyectos.filter(p => p.activo).map(p =>
    `<span class="badge" style="border-left:3px solid ${p.color};">${p.nombre}</span>`
  ).join('');
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


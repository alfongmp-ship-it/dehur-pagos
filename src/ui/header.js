import { state } from '../state.js';

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
}


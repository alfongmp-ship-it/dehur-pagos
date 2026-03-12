import { state } from '../state.js';

export function renderHeaderBadges() {
  const hb = document.getElementById('header-badges');
  if (!hb) return;
  const cg = document.getElementById('cuenta-disp');
  const cur = cg ? cg.value : (state.proyectos[0]?.id || '');
  hb.innerHTML = state.proyectos.filter(p => p.activo).map(p =>
    `<span class="badge ${p.id === cur ? 'active' : ''}"
      onclick="document.getElementById('cuenta-disp').value='${p.id}';renderHeaderBadges();"
      style="cursor:pointer;border-left:3px solid ${p.color};">${p.nombre}</span>`
  ).join('') +
    `<select class="filter-select" id="cuenta-global" onchange="updateCuentaGlobal()" style="font-size:12px;padding:6px 10px;">
    ${state.proyectos.filter(p => p.activo).map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}
  </select>`;
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

export function updateCuentaGlobal() {
  const v = document.getElementById('cuenta-global')?.value;
  const cd = document.getElementById('cuenta-disp');
  if (cd && v) cd.value = v;
  renderHeaderBadges();
}

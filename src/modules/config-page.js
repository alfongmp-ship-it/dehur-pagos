import { state } from '../state.js';
import { saveProy } from '../config/proyectos.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { renderCuentaDispSelect, renderHeaderBadges } from '../ui/header.js';
import { refreshProyectosEnSelects } from '../ui/nav.js';

export function calcularClabeProy() {
  const cta = document.getElementById('proy-cuenta').value.trim().replace(/\D/g, '');
  const prev = document.getElementById('proy-clabe-preview');
  if (cta.length < 7) { prev.textContent = ''; return; }
  const base = '012180' + ('0' + cta).slice(-11);
  if (base.length !== 17) { prev.textContent = ''; return; }
  const pesos = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
  const d = (10 - ([...base].reduce((s, c, i) => s + parseInt(c) * pesos[i], 0) % 10)) % 10;
  const clabe = base + d;
  prev.innerHTML = `CLABE estimada: <span style="font-family:'DM Mono',monospace;letter-spacing:.05em;">${clabe}</span> <span style="color:var(--yellow);font-size:10px;">(verifica en tu estado de cuenta)</span>`;
  document.getElementById('proy-cuenta').dataset.clabe = clabe;
}

export function selColor(el) {
  document.querySelectorAll('.proy-color-opt').forEach(e => e.style.border = '2px solid transparent');
  el.style.border = '2px solid var(--text)';
  document.getElementById('proy-color').value = el.dataset.color;
}

export function abrirModalProyecto(id) {
  state.editProyId = id;
  const p = id ? state.proyectos.find(x => x.id === id) : null;
  document.getElementById('modal-proy-title').textContent = p ? 'Editar Proyecto' : 'Nuevo Proyecto';
  document.getElementById('proy-nombre').value = p?.nombre || '';
  document.getElementById('proy-empresa').value = p?.empresa || '';
  document.getElementById('proy-cuenta').value = p?.cuenta || '';
  document.getElementById('proy-color').value = p?.color || '#c8a96e';
  document.querySelectorAll('.proy-color-opt').forEach(e => {
    e.style.border = e.dataset.color === (p?.color || '#c8a96e') ? '2px solid var(--text)' : '2px solid transparent';
  });
  document.getElementById('proy-clabe-preview').textContent = '';
  if (p?.clabe) document.getElementById('proy-clabe-preview').innerHTML =
    `CLABE actual: <span style="font-family:'DM Mono',monospace;">${p.clabe}</span>`;
  document.getElementById('proy-concentradora').checked = p?.es_concentradora || false;
  document.getElementById('modal-proyecto').classList.add('open');
}

export function guardarProyecto() {
  const nombre = document.getElementById('proy-nombre').value.trim();
  const cuenta = document.getElementById('proy-cuenta').value.trim().replace(/\D/g, '');
  if (!nombre) { notify('El nombre es obligatorio', 'error'); return; }
  if (!cuenta) { notify('El número de cuenta es obligatorio', 'error'); return; }
  const empresa = document.getElementById('proy-empresa').value.trim();
  const color = document.getElementById('proy-color').value;
  const base = '012180' + ('0' + cuenta).slice(-11);
  let clabe = '';
  if (base.length === 17) {
    const pesos = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
    const d = (10 - ([...base].reduce((s, c, i) => s + parseInt(c) * pesos[i], 0) % 10)) % 10;
    clabe = base + d;
  }
  const es_concentradora = document.getElementById('proy-concentradora').checked;
  if (state.editProyId) {
    const idx = state.proyectos.findIndex(p => p.id === state.editProyId);
    state.proyectos[idx] = { ...state.proyectos[idx], nombre, empresa, cuenta, clabe, color, saldo: state.proyectos[idx].saldo || 0, ultima_act_saldo: state.proyectos[idx].ultima_act_saldo || '', es_concentradora };
  } else {
    const id = 'proy_' + nombre.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 20) + '_' + Date.now();
    state.proyectos.push({ id, nombre, empresa, cuenta, clabe, color, activo: true, saldo: 0, ultima_act_saldo: '', es_concentradora });
  }
  saveProy(state.proyectos);
  cerrar('modal-proyecto');
  renderConfigProyectos();
  renderCuentaDispSelect();
  renderHeaderBadges();
  refreshProyectosEnSelects();
  notify(state.editProyId ? 'Proyecto actualizado' : 'Proyecto agregado ✓');
}

export function toggleProyecto(id, activo) {
  const p = state.proyectos.find(x => x.id === id);
  if (p) { p.activo = activo; saveProy(state.proyectos); }
  renderConfigProyectos();
  renderCuentaDispSelect();
  renderHeaderBadges();
  refreshProyectosEnSelects();
}

export function renderConfigProyectos() {
  const div = document.getElementById('config-proyectos-lista');
  if (!div) return;
  div.innerHTML = state.proyectos.map(p => `
    <div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);">
      <div style="width:10px;height:36px;border-radius:4px;background:${p.color};flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;">${p.nombre}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${p.empresa || ''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-family:'DM Mono',monospace;font-size:12px;">${p.cuenta}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;font-family:'DM Mono',monospace;">${p.clabe || '—'}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-ghost btn-sm" onclick="abrirModalProyecto('${p.id}')">✎ Editar</button>
        <button class="btn btn-sm ${p.activo ? 'btn-ghost' : 'btn-success'}" onclick="toggleProyecto('${p.id}',${!p.activo})">
          ${p.activo ? '● Activo' : '○ Inactivo'}
        </button>
      </div>
    </div>
  `).join('');
}

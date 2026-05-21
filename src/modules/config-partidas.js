import { state } from '../state.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSavePartidasCatalogo } from '../services/google-sync.js';
import { SUB_PARTIDAS_CONSTRUCCION } from '../config/sub-partidas.js';

const normPartida = s => (s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

function slugId(nombre) {
  return 'p_' + (nombre || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
    + '_' + Date.now();
}

function partidaUsadaEnHistorial(nombrePartida) {
  const n = (nombrePartida || '').trim().toLowerCase();
  if (!n) return 0;
  return state.historial.filter(h => (h.partida || '').trim().toLowerCase() === n).length;
}

export function renderConfigPartidas() {
  const div = document.getElementById('config-partidas-lista');
  if (!div) return;
  const cat = (state.partidasCatalogo || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
  if (!cat.length) {
    div.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:14px 0;">Sin partidas aún. Crea la primera con el botón de arriba.</div>';
    return;
  }
  div.innerHTML = cat.map(p => `
    <div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;">${p.partida}${p.activa === false ? ' <span style="color:var(--muted);font-weight:400;">(inactiva)</span>' : ''}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">
          ${(p.subpartidas || []).length} subpartida${(p.subpartidas || []).length === 1 ? '' : 's'}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-ghost btn-sm" onclick="abrirModalPartida('${p.id}')">✎ Editar</button>
        <button class="btn btn-sm ${p.activa !== false ? 'btn-ghost' : 'btn-success'}" onclick="togglePartidaCatalogo('${p.id}')">
          ${p.activa !== false ? '● Activa' : '○ Inactiva'}
        </button>
        <button class="btn btn-ghost btn-sm" onclick="eliminarPartidaCatalogo('${p.id}')" title="Eliminar">✕</button>
      </div>
    </div>
  `).join('');
}

export function abrirModalPartida(id) {
  state.editPartidaId = id || null;
  const p = id ? state.partidasCatalogo.find(x => x.id === id) : null;
  document.getElementById('modal-partida-title').textContent = p ? 'Editar Partida' : 'Nueva Partida';
  document.getElementById('cat-partida-nombre').value = p?.partida || '';
  document.getElementById('cat-partida-sub-input').value = '';
  state._editSubpartidas = [...(p?.subpartidas || [])];
  renderEditSubpartidas();
  document.getElementById('modal-partida').classList.add('open');
}

function renderEditSubpartidas() {
  const div = document.getElementById('cat-partida-sub-lista');
  if (!div) return;
  const subs = state._editSubpartidas || [];
  if (!subs.length) {
    div.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:6px 0;">Sin subpartidas. Agrega una arriba.</div>';
    return;
  }
  div.innerHTML = subs.map((s, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
      <span style="flex:1;font-size:12px;">${s}</span>
      <button class="btn btn-ghost btn-sm" onclick="moverSubpartida(${i},-1)" ${i === 0 ? 'disabled' : ''}>▲</button>
      <button class="btn btn-ghost btn-sm" onclick="moverSubpartida(${i},1)" ${i === subs.length - 1 ? 'disabled' : ''}>▼</button>
      <button class="btn btn-ghost btn-sm" onclick="eliminarSubpartidaTmp(${i})" title="Quitar">✕</button>
    </div>
  `).join('');
}

export function agregarSubpartidaTmp() {
  const inp = document.getElementById('cat-partida-sub-input');
  const v = (inp.value || '').trim();
  if (!v) return;
  if (!state._editSubpartidas) state._editSubpartidas = [];
  if (state._editSubpartidas.some(s => s.toLowerCase() === v.toLowerCase())) {
    notify('Esa subpartida ya existe en esta partida', 'error');
    return;
  }
  state._editSubpartidas.push(v);
  inp.value = '';
  renderEditSubpartidas();
}

export function eliminarSubpartidaTmp(idx) {
  if (!state._editSubpartidas) return;
  state._editSubpartidas.splice(idx, 1);
  renderEditSubpartidas();
}

export function moverSubpartida(idx, delta) {
  const arr = state._editSubpartidas;
  if (!arr) return;
  const j = idx + delta;
  if (j < 0 || j >= arr.length) return;
  [arr[idx], arr[j]] = [arr[j], arr[idx]];
  renderEditSubpartidas();
}

export function guardarPartidaCatalogo() {
  const nombre = (document.getElementById('cat-partida-nombre').value || '').trim();
  if (!nombre) { notify('El nombre de la partida es obligatorio', 'error'); return; }
  const subs = [...(state._editSubpartidas || [])];
  const editId = state.editPartidaId;
  // Detectar duplicado por nombre (case-insensitive) excluyendo la misma
  const dup = state.partidasCatalogo.find(p =>
    p.partida.trim().toLowerCase() === nombre.toLowerCase() && p.id !== editId
  );
  if (dup) { notify('Ya existe una partida con ese nombre', 'error'); return; }
  if (editId) {
    const idx = state.partidasCatalogo.findIndex(p => p.id === editId);
    if (idx >= 0) {
      state.partidasCatalogo[idx] = {
        ...state.partidasCatalogo[idx],
        partida: nombre,
        subpartidas: subs
      };
    }
  } else {
    const orden = state.partidasCatalogo.reduce((m, p) => Math.max(m, p.orden || 0), 0) + 1;
    state.partidasCatalogo.push({
      id: slugId(nombre),
      partida: nombre,
      subpartidas: subs,
      orden,
      activa: true
    });
  }
  gsSavePartidasCatalogo();
  cerrar('modal-partida');
  renderConfigPartidas();
  notify(editId ? 'Partida actualizada' : 'Partida agregada ✓');
  state._editSubpartidas = null;
  state.editPartidaId = null;
}

export function togglePartidaCatalogo(id) {
  const p = state.partidasCatalogo.find(x => x.id === id);
  if (!p) return;
  p.activa = p.activa === false ? true : false;
  gsSavePartidasCatalogo();
  renderConfigPartidas();
}

export function eliminarPartidaCatalogo(id) {
  const p = state.partidasCatalogo.find(x => x.id === id);
  if (!p) return;
  const usos = partidaUsadaEnHistorial(p.partida);
  if (usos > 0) {
    const ok = confirm(`La partida "${p.partida}" se usa en ${usos} pago${usos === 1 ? '' : 's'} del historial.\n\nEliminarla NO borra esos pagos, pero perderás el catálogo.\n¿Prefieres marcarla como INACTIVA (recomendado)?\n\nAceptar = marcar inactiva\nCancelar = continuar al borrado`);
    if (ok) { p.activa = false; gsSavePartidasCatalogo(); renderConfigPartidas(); return; }
    if (!confirm(`¿Borrar definitivamente la partida "${p.partida}"?`)) return;
  } else {
    if (!confirm(`¿Eliminar la partida "${p.partida}"?`)) return;
  }
  state.partidasCatalogo = state.partidasCatalogo.filter(x => x.id !== id);
  gsSavePartidasCatalogo();
  renderConfigPartidas();
  notify('Partida eliminada');
}

// Detecta entradas falsas: partidas del catálogo cuyo nombre coincide con una
// subpartida hardcoded de CONSTRUCCION. Las consolidaremos dentro de CONSTRUCCION.
function detectarEntradasFalsas() {
  const subsNorm = new Set(SUB_PARTIDAS_CONSTRUCCION.map(normPartida));
  // "construccion" sí es una partida válida (no la marcamos como falsa aunque
  // esté en el array hardcoded — está ahí solo como autopopulado del nombre).
  subsNorm.delete(normPartida('CONSTRUCCION'));
  return (state.partidasCatalogo || []).filter(p => subsNorm.has(normPartida(p.partida)));
}

export function previewLimpiarCatalogo() {
  const falsas = detectarEntradasFalsas();
  const div = document.getElementById('limpiar-catalogo-preview');
  const btnConf = document.getElementById('btn-limpiar-catalogo-confirmar');
  if (!div) return;
  if (!falsas.length) {
    div.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:14px 0;">Catálogo limpio: no se encontraron partidas que sean subpartidas de CONSTRUCCION.</div>';
    if (btnConf) btnConf.style.display = 'none';
  } else {
    div.innerHTML = `
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">
        Se eliminarán ${falsas.length} entrada${falsas.length === 1 ? '' : 's'} del catálogo y se asegurarán como subpartida${falsas.length === 1 ? '' : 's'} de <b>CONSTRUCCION</b>:
      </div>
      <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px 12px;">
        ${falsas.map(p => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">${p.partida}${p.activa === false ? ' <span style="color:var(--muted);">(inactiva)</span>' : ''}</div>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.6;">
        Esto NO modifica el historial de pagos. Los pagos viejos que tengan estas como "partida" seguirán como están.
      </div>
    `;
    if (btnConf) btnConf.style.display = '';
  }
  document.getElementById('modal-limpiar-catalogo').classList.add('open');
}

export function confirmarLimpiarCatalogo() {
  const falsas = detectarEntradasFalsas();
  if (!falsas.length) { cerrar('modal-limpiar-catalogo'); return; }

  // 1. Asegurar que CONSTRUCCION existe y tiene las subpartidas detectadas.
  let constr = state.partidasCatalogo.find(p => normPartida(p.partida) === 'construccion');
  if (!constr) {
    const orden = state.partidasCatalogo.reduce((m, p) => Math.max(m, p.orden || 0), 0) + 1;
    constr = {
      id: 'p_construccion_' + Date.now(),
      partida: 'CONSTRUCCION',
      subpartidas: [...SUB_PARTIDAS_CONSTRUCCION],
      orden,
      activa: true
    };
    state.partidasCatalogo.push(constr);
  } else {
    const existentes = new Set((constr.subpartidas || []).map(normPartida));
    // Añadir las subpartidas hardcoded que falten (lista canónica completa).
    SUB_PARTIDAS_CONSTRUCCION.forEach(s => {
      if (!existentes.has(normPartida(s))) {
        constr.subpartidas.push(s);
        existentes.add(normPartida(s));
      }
    });
  }

  // 2. Eliminar las falsas del catálogo.
  const idsFalsos = new Set(falsas.map(p => p.id));
  state.partidasCatalogo = state.partidasCatalogo.filter(p => !idsFalsos.has(p.id));

  // 3. Persistir y refrescar.
  gsSavePartidasCatalogo();
  cerrar('modal-limpiar-catalogo');
  renderConfigPartidas();
  notify(`Catálogo limpio: ${falsas.length} entrada${falsas.length === 1 ? '' : 's'} consolidada${falsas.length === 1 ? '' : 's'} en CONSTRUCCION`);
}

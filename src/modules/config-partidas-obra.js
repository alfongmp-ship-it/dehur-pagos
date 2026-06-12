import { state } from '../state.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSavePartidasObra, esPorFila, sbGuardarFila, sbBorrarFila } from '../services/google-sync.js';

const norm = s => (s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

function slugId(nombre, proyecto) {
  return 'po_' + (nombre || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 25)
    + (proyecto ? '__' + norm(proyecto).replace(/[^a-z0-9]+/g, '_').slice(0, 15) : '__maestro')
    + '_' + Date.now();
}

// Devuelve las partidas activas del catálogo Admin (para el dropdown de partida-admin).
function partidasAdminActivas() {
  return (state.partidasCatalogo || []).filter(p => p.activa !== false);
}

// Devuelve las subpartidas de una partida-admin específica (por nombre normalizado).
function subPartidasDe(partidaNombre) {
  const item = (state.partidasCatalogo || []).find(p => norm(p.partida) === norm(partidaNombre));
  return (item?.subpartidas || []).slice();
}

// Filtro UI: proyecto activo en el chip ('', '__maestro', o nombre del proyecto).
let filtroProyectoObra = '';

export function renderConfigPartidasObra() {
  const div = document.getElementById('config-partidas-obra-lista');
  if (!div) return;
  const chips = document.getElementById('config-partidas-obra-chips');
  if (chips) chips.innerHTML = renderChips();

  let items = (state.partidasObra || []).slice();
  if (filtroProyectoObra === '__maestro') {
    items = items.filter(p => !p.proyecto);
  } else if (filtroProyectoObra) {
    items = items.filter(p => !p.proyecto || norm(p.proyecto) === norm(filtroProyectoObra));
  }
  items.sort((a, b) => (a.orden || 0) - (b.orden || 0) || norm(a.nombre).localeCompare(norm(b.nombre)));

  if (!items.length) {
    div.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:14px 0;">Sin partidas de obra aún. Crea la primera con el botón de arriba.</div>';
    return;
  }
  div.innerHTML = items.map(p => {
    const badgeProy = p.proyecto
      ? `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(90,155,224,.15);color:var(--blue);">${p.proyecto}</span>`
      : `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(200,169,110,.15);color:var(--accent);">MAESTRO</span>`;
    let badgeAdmin;
    if (!p.partidaAdmin && !p.subPartidaAdmin) {
      badgeAdmin = `<span style="font-size:11px;color:var(--yellow);">⚠ sin mapeo</span>`;
    } else if (p.partidaAdmin && p.subPartidaAdmin) {
      badgeAdmin = `<span style="font-size:11px;color:var(--muted);">→ ${p.partidaAdmin} / ${p.subPartidaAdmin}</span>`;
    } else {
      // partidaAdmin sin sub (caso normal cuando la partida no tiene subpartidas)
      badgeAdmin = `<span style="font-size:11px;color:var(--muted);">→ ${p.partidaAdmin || p.subPartidaAdmin}</span>`;
    }
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;">${p.nombre}${p.activa === false ? ' <span style="color:var(--muted);font-weight:400;">(inactiva)</span>' : ''}</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">${badgeProy}${badgeAdmin}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" onclick="abrirModalPartidaObra('${p.id}')">✎ Editar</button>
          <button class="btn btn-sm ${p.activa !== false ? 'btn-ghost' : 'btn-success'}" onclick="togglePartidaObra('${p.id}')">${p.activa !== false ? '● Activa' : '○ Inactiva'}</button>
          <button class="btn btn-ghost btn-sm" onclick="eliminarPartidaObra('${p.id}')" title="Eliminar">✕</button>
        </div>
      </div>`;
  }).join('');
}

function renderChips() {
  const chip = (val, label) => {
    const active = filtroProyectoObra === val;
    const style = active
      ? 'background:var(--accent);color:var(--bg);border:1px solid var(--accent);'
      : 'background:transparent;color:var(--muted);border:1px solid var(--border);';
    return `<button onclick="filtrarPartidasObra('${val}')" style="${style}padding:4px 10px;border-radius:14px;font-size:11px;font-weight:600;cursor:pointer;">${label}</button>`;
  };
  const proyectos = state.proyectos.filter(p => p.activo !== false);
  return [
    chip('', 'Todas'),
    chip('__maestro', 'Solo maestro'),
    ...proyectos.map(p => chip(p.nombre, p.nombre))
  ].join('');
}

export function filtrarPartidasObra(val) {
  filtroProyectoObra = val || '';
  renderConfigPartidasObra();
}

export function abrirModalPartidaObra(id) {
  state.editPartidaObraId = id || null;
  const p = id ? state.partidasObra.find(x => x.id === id) : null;
  document.getElementById('modal-partida-obra-title').textContent = p ? 'Editar Partida Obra' : 'Nueva Partida Obra';
  document.getElementById('cat-po-nombre').value = p?.nombre || '';

  // Dropdown de proyecto: "(maestro)" + cada proyecto activo
  const selProy = document.getElementById('cat-po-proyecto');
  const opts = ['<option value="">(maestro — todos los proyectos)</option>'];
  state.proyectos.filter(x => x.activo !== false).forEach(x => {
    opts.push(`<option value="${x.nombre}">${x.nombre}</option>`);
  });
  selProy.innerHTML = opts.join('');
  selProy.value = p?.proyecto || '';

  // Dropdown de partida admin (todas las activas)
  const selPartida = document.getElementById('cat-po-partida-admin');
  const partidas = partidasAdminActivas();
  selPartida.innerHTML = '<option value="">— sin mapeo —</option>' +
    partidas.map(x => `<option value="${x.partida}">${x.partida}</option>`).join('');
  selPartida.value = p?.partidaAdmin || '';

  // Repoblar el dropdown de subpartida según la partida elegida
  actualizarSubpartidaAdminOptions(p?.subPartidaAdmin || '');

  document.getElementById('modal-partida-obra').classList.add('open');
}

// Repuebla el dropdown de subpartida-admin según la partida-admin seleccionada.
// Si la partida no tiene subpartidas, oculta el wrap.
export function actualizarSubpartidaAdminOptions(valorPreseleccionado) {
  const selPartida = document.getElementById('cat-po-partida-admin');
  const selSub = document.getElementById('cat-po-subpartida-admin');
  const wrap = document.getElementById('cat-po-subpartida-admin-wrap');
  if (!selPartida || !selSub || !wrap) return;
  const partidaSel = selPartida.value || '';
  if (!partidaSel) {
    selSub.innerHTML = '';
    selSub.value = '';
    wrap.style.display = 'none';
    return;
  }
  const subs = subPartidasDe(partidaSel);
  if (!subs.length) {
    selSub.innerHTML = '';
    selSub.value = '';
    wrap.style.display = 'none';
    return;
  }
  selSub.innerHTML = '<option value="">— (sin sub-partida) —</option>' +
    subs.map(s => `<option value="${s}">${s}</option>`).join('');
  selSub.value = valorPreseleccionado || '';
  wrap.style.display = '';
}

export function guardarPartidaObra() {
  const nombre = (document.getElementById('cat-po-nombre').value || '').trim();
  if (!nombre) { notify('El nombre es obligatorio', 'error'); return; }
  const proyecto = (document.getElementById('cat-po-proyecto').value || '').trim();
  const partidaAdmin = (document.getElementById('cat-po-partida-admin').value || '').trim();
  let subPartidaAdmin = (document.getElementById('cat-po-subpartida-admin').value || '').trim();
  const editId = state.editPartidaObraId;

  // Si no hay partidaAdmin, la subpartida no aplica.
  if (!partidaAdmin) subPartidaAdmin = '';

  // Validar duplicado por (nombre + proyecto) (case-insensitive)
  const dup = state.partidasObra.find(p =>
    p.id !== editId &&
    norm(p.nombre) === norm(nombre) &&
    norm(p.proyecto) === norm(proyecto)
  );
  if (dup) {
    notify(`Ya existe una partida obra "${nombre}"${proyecto ? ' en ' + proyecto : ' como maestro'}`, 'error');
    return;
  }
  // Validar partidaAdmin (debe existir y estar activa)
  if (partidaAdmin) {
    const partidas = partidasAdminActivas().map(x => norm(x.partida));
    if (!partidas.includes(norm(partidaAdmin))) {
      notify(`La partida admin "${partidaAdmin}" no existe o está inactiva`, 'error');
      return;
    }
  }
  // Validar subPartidaAdmin: solo si la partidaAdmin tiene subpartidas, y debe ser una de ellas.
  if (subPartidaAdmin) {
    const subs = subPartidasDe(partidaAdmin).map(norm);
    if (!subs.includes(norm(subPartidaAdmin))) {
      notify(`La sub-partida "${subPartidaAdmin}" no pertenece a "${partidaAdmin}"`, 'error');
      return;
    }
  }

  if (editId) {
    const idx = state.partidasObra.findIndex(p => p.id === editId);
    if (idx >= 0) {
      state.partidasObra[idx] = { ...state.partidasObra[idx], nombre, proyecto, partidaAdmin, subPartidaAdmin };
    }
  } else {
    const orden = state.partidasObra.reduce((m, p) => Math.max(m, p.orden || 0), 0) + 1;
    state.partidasObra.push({
      id: slugId(nombre, proyecto), nombre, proyecto, partidaAdmin, subPartidaAdmin, orden, activa: true
    });
  }
  // Fase 3: en modo 'fila' guarda solo la partida obra afectada (add o edit).
  const porFila = esPorFila('partidasObra');
  gsSavePartidasObra({ porFila });
  if (porFila) {
    const _obj = editId
      ? state.partidasObra.find(p => p.id === editId)
      : state.partidasObra[state.partidasObra.length - 1];
    if (_obj) sbGuardarFila('partidasObra', _obj);
  }
  cerrar('modal-partida-obra');
  renderConfigPartidasObra();
  notify(editId ? 'Partida obra actualizada' : 'Partida obra agregada ✓');
  state.editPartidaObraId = null;
}

export function togglePartidaObra(id) {
  const p = state.partidasObra.find(x => x.id === id);
  if (!p) return;
  p.activa = p.activa === false ? true : false;
  const porFila = esPorFila('partidasObra');
  gsSavePartidasObra({ porFila });
  if (porFila) sbGuardarFila('partidasObra', p);
  renderConfigPartidasObra();
}

export function eliminarPartidaObra(id) {
  const p = state.partidasObra.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`¿Eliminar la partida obra "${p.nombre}"${p.proyecto ? ' (' + p.proyecto + ')' : ' (maestro)'}?`)) return;
  state.partidasObra = state.partidasObra.filter(x => x.id !== id);
  const porFila = esPorFila('partidasObra');
  gsSavePartidasObra({ porFila });
  if (porFila) sbBorrarFila('partidasObra', id);
  renderConfigPartidasObra();
  notify('Partida obra eliminada');
}

import { state, esAdmin } from '../state.js';
import { escapeHtml } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSavePartidasCatalogo, gsSaveHistorial, esPorFila, sbGuardarFila, sbBorrarFila } from '../services/google-sync.js';
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
        <div style="font-weight:600;font-size:13px;">${escapeHtml(p.partida)}${p.activa === false ? ' <span style="color:var(--muted);font-weight:400;">(inactiva)</span>' : ''}${p.visibleObra === false ? ' <span style="color:var(--orange);font-weight:400;font-size:10px;" title="Los perfiles de obra (Gustavo/Anahi) no la ven en Costos por Unidad">🚫 oculta a obra</span>' : ''}</div>
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
  const inpNombre = document.getElementById('cat-partida-nombre');
  inpNombre.value = p?.partida || '';
  inpNombre.oninput = actualizarAvisoSubpartidas;
  const chkVisObra = document.getElementById('cat-partida-visible-obra');
  if (chkVisObra) chkVisObra.checked = p ? p.visibleObra !== false : true;
  document.getElementById('cat-partida-sub-input').value = '';
  state._editSubpartidas = [...(p?.subpartidas || [])];
  renderEditSubpartidas();
  actualizarAvisoSubpartidas();
  document.getElementById('modal-partida').classList.add('open');
}

function actualizarAvisoSubpartidas() {
  const nombre = (document.getElementById('cat-partida-nombre')?.value || '').trim();
  const aviso = document.getElementById('cat-partida-sub-aviso');
  if (!aviso) return;
  aviso.style.display = normPartida(nombre) === 'construccion' ? 'none' : '';
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
      <span style="flex:1;font-size:12px;">${escapeHtml(s)}</span>
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
  if (!esAdmin()) { notify('Solo el admin puede editar el catálogo de partidas', 'error'); return; }
  const nombre = (document.getElementById('cat-partida-nombre').value || '').trim();
  if (!nombre) { notify('El nombre de la partida es obligatorio', 'error'); return; }
  const subs = [...(state._editSubpartidas || [])];
  const editId = state.editPartidaId;
  // Detectar duplicado por nombre (case-insensitive) excluyendo la misma
  const dup = state.partidasCatalogo.find(p =>
    p.partida.trim().toLowerCase() === nombre.toLowerCase() && p.id !== editId
  );
  if (dup) { notify('Ya existe una partida con ese nombre', 'error'); return; }
  const visibleObra = document.getElementById('cat-partida-visible-obra')
    ? document.getElementById('cat-partida-visible-obra').checked
    : true;
  if (editId) {
    const idx = state.partidasCatalogo.findIndex(p => p.id === editId);
    if (idx >= 0) {
      state.partidasCatalogo[idx] = {
        ...state.partidasCatalogo[idx],
        partida: nombre,
        subpartidas: subs,
        visibleObra
      };
    }
  } else {
    const orden = state.partidasCatalogo.reduce((m, p) => Math.max(m, p.orden || 0), 0) + 1;
    state.partidasCatalogo.push({
      id: slugId(nombre),
      partida: nombre,
      subpartidas: subs,
      orden,
      activa: true,
      visibleObra
    });
  }
  // Fase 3: en modo 'fila' guarda solo la partida afectada (add o edit).
  const porFila = esPorFila('partidasCatalogo');
  gsSavePartidasCatalogo({ porFila });
  if (porFila) {
    const _obj = editId
      ? state.partidasCatalogo.find(p => p.id === editId)
      : state.partidasCatalogo[state.partidasCatalogo.length - 1];
    if (_obj) sbGuardarFila('partidasCatalogo', _obj);
  }
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
  const porFila = esPorFila('partidasCatalogo');
  gsSavePartidasCatalogo({ porFila });
  if (porFila) sbGuardarFila('partidasCatalogo', p);
  renderConfigPartidas();
}

export function eliminarPartidaCatalogo(id) {
  if (!esAdmin()) { notify('Solo el admin puede editar el catálogo de partidas', 'error'); return; }
  const p = state.partidasCatalogo.find(x => x.id === id);
  if (!p) return;
  const usos = partidaUsadaEnHistorial(p.partida);
  if (usos > 0) {
    const ok = confirm(`La partida "${p.partida}" se usa en ${usos} pago${usos === 1 ? '' : 's'} del historial.\n\nEliminarla NO borra esos pagos, pero perderás el catálogo.\n¿Prefieres marcarla como INACTIVA (recomendado)?\n\nAceptar = marcar inactiva\nCancelar = continuar al borrado`);
    if (ok) {
      p.activa = false;
      const _pf = esPorFila('partidasCatalogo');
      gsSavePartidasCatalogo({ porFila: _pf });
      if (_pf) sbGuardarFila('partidasCatalogo', p);
      renderConfigPartidas();
      return;
    }
    if (!confirm(`¿Borrar definitivamente la partida "${p.partida}"?`)) return;
  } else {
    if (!confirm(`¿Eliminar la partida "${p.partida}"?`)) return;
  }
  state.partidasCatalogo = state.partidasCatalogo.filter(x => x.id !== id);
  const porFila = esPorFila('partidasCatalogo');
  gsSavePartidasCatalogo({ porFila });
  if (porFila) sbBorrarFila('partidasCatalogo', id);
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
        ${falsas.map(p => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">${escapeHtml(p.partida)}${p.activa === false ? ' <span style="color:var(--muted);">(inactiva)</span>' : ''}</div>`).join('')}
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

// ============================================================
// Reclasificar historial: pagos cuya `partida` en realidad es una subpartida
// de CONSTRUCCION (data legacy de antes del catálogo con jerarquía).
// ============================================================

// Mapa normalizado → valor canónico de SUB_PARTIDAS_CONSTRUCCION.
// Ej. "acabados" → "Acabados", "albanileria" → "Albanileria".
function canonicalSubpartidaMap() {
  const m = new Map();
  SUB_PARTIDAS_CONSTRUCCION.forEach(s => {
    if (normPartida(s) === 'construccion') return;
    m.set(normPartida(s), s);
  });
  return m;
}

function detectarPagosParaReclasificar() {
  const mapa = canonicalSubpartidaMap();
  const candidatos = []; // { idx, h, partidaActual, canonico }
  const saltados = [];   // { h, motivo }
  state.historial.forEach((h, idx) => {
    if (!h.partida) return;
    if (h.tipo_registro === 'Traspaso' || h.tipo_registro === 'Crédito') return;
    const norm = normPartida(h.partida);
    const canonico = mapa.get(norm);
    if (!canonico) return; // no es subpartida de CONSTRUCCION
    if (h.sub_partida && normPartida(h.sub_partida) !== norm) {
      saltados.push({ h, motivo: `ya tiene sub_partida="${h.sub_partida}"` });
      return;
    }
    candidatos.push({ idx, h, partidaActual: h.partida, canonico });
  });
  return { candidatos, saltados };
}

export function previewReclasificarHistorial() {
  const { candidatos, saltados } = detectarPagosParaReclasificar();
  const div = document.getElementById('reclasificar-preview');
  const btnConf = document.getElementById('btn-reclasificar-confirmar');
  if (!div) return;
  if (!candidatos.length && !saltados.length) {
    div.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:14px 0;">Nada que reclasificar: ningún pago tiene en <code>partida</code> un valor que sea una subpartida canónica de CONSTRUCCION.</div>';
    if (btnConf) btnConf.style.display = 'none';
    document.getElementById('modal-reclasificar-historial').classList.add('open');
    return;
  }
  // Agrupar candidatos por partida actual.
  const grupos = {};
  candidatos.forEach(c => {
    const key = c.partidaActual + '||' + c.canonico;
    if (!grupos[key]) grupos[key] = { partidaActual: c.partidaActual, canonico: c.canonico, count: 0 };
    grupos[key].count++;
  });
  const filas = Object.values(grupos).sort((a, b) => b.count - a.count);

  let html = '';
  if (filas.length) {
    html += `
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">
        Se reclasificarán <b>${candidatos.length}</b> pago${candidatos.length === 1 ? '' : 's'}: partida actual → <b>CONSTRUCCION</b> + sub_partida.
      </div>
      <div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px 12px;margin-bottom:10px;">
        ${filas.map(g => `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
            <span style="flex:1;"><code>${escapeHtml(g.partidaActual)}</code> → CONSTRUCCION + <code>${escapeHtml(g.canonico)}</code></span>
            <span style="font-family:'DM Mono',monospace;color:var(--accent);">${g.count}</span>
          </div>
        `).join('')}
      </div>
    `;
  }
  if (saltados.length) {
    html += `
      <div style="font-size:11px;color:var(--muted);margin-top:10px;">
        ${saltados.length} pago${saltados.length === 1 ? '' : 's'} se omitirá${saltados.length === 1 ? '' : 'n'} porque ya tiene${saltados.length === 1 ? '' : 'n'} sub_partida con otro valor (no se sobreescribe).
      </div>
    `;
  }
  html += `
    <div style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.6;">
      Esto modifica registros reales del historial en Google Sheets. Si necesitas revertir, usa Archivo → Historial de versiones en la hoja.
    </div>
  `;
  div.innerHTML = html;
  if (btnConf) btnConf.style.display = candidatos.length ? '' : 'none';
  document.getElementById('modal-reclasificar-historial').classList.add('open');
}

export async function confirmarReclasificarHistorial() {
  if (!esAdmin()) {
    notify('Solo el admin puede reclasificar el historial en bloque', 'error');
    return;
  }
  const { candidatos } = detectarPagosParaReclasificar();
  if (!candidatos.length) { cerrar('modal-reclasificar-historial'); return; }
  if (candidatos.length > 100 && !confirm(`Vas a modificar ${candidatos.length} pagos del historial. ¿Continuar?`)) return;

  candidatos.forEach(c => {
    c.h.sub_partida = c.canonico;
    c.h.partida = 'CONSTRUCCION';
  });

  await gsSaveHistorial();
  cerrar('modal-reclasificar-historial');
  if (window.renderHistorial) window.renderHistorial();
  notify(`✓ ${candidatos.length} pago${candidatos.length === 1 ? '' : 's'} reclasificado${candidatos.length === 1 ? '' : 's'} en CONSTRUCCION`);
}

import { state } from '../state.js';
import { getBanco, getTipo } from '../config/bancos.js';
import { tipoBadge, catTag, proyTag } from '../ui/badges.js';
import { fmt, dl } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveProveedores } from '../services/google-sync.js';

export function renderProveedores() {
  const q = document.getElementById('buscar-prov').value.toLowerCase();
  const ft = document.getElementById('f-tipo').value;
  const fc = document.getElementById('f-cat').value;
  const fp = document.getElementById('f-proy').value;
  const fil = state.proveedores.filter(p =>
    (!q || (/^\d+$/.test(q) ? String(p.id) === q : p.nombre.toLowerCase().includes(q))) &&
    (!ft || p.tipo_cuenta === ft) &&
    (!fc || p.categoria === fc) &&
    (!fp || p.proyectos.includes(fp))
  );
  const tb = document.getElementById('tbody-prov');
  if (!fil.length) {
    tb.innerHTML = `<tr><td colspan="8"><div class="empty-state" style="padding:30px;"><div style="font-size:28px;opacity:.4;margin-bottom:8px;">🔍</div><div>Sin resultados</div></div></td></tr>`;
    return;
  }
  tb.innerHTML = fil.map(p => `<tr><td style="font-size:12px;color:var(--muted);text-align:center;">${p.id}</td><td><div class="name-cell">${p.nombre}</div>${p.rfc ? `<div class="name-sub">${p.rfc}</div>` : ''}</td><td>${tipoBadge(p.tipo_cuenta)}</td><td style="font-size:13px;">${p.banco}</td><td><span class="mono">${p.clabe || p.cuenta}</span></td><td>${catTag(p.categoria)}</td><td>${p.proyectos.map(proyTag).join(' ')}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-success btn-sm" onclick="abrirPagoRapido('prov',${p.id})">+ Pago</button><button class="btn btn-ghost btn-sm" onclick="editarProv(${p.id})">Editar</button></div></td></tr>`).join('');
  document.getElementById('st-total').textContent = state.proveedores.length;
  document.getElementById('st-clabe').textContent = state.proveedores.filter(p => p.tipo_cuenta === 'CLABE').length;
  document.getElementById('st-bbva').textContent = state.proveedores.filter(p => p.tipo_cuenta === 'Cuenta').length;
  if (document.getElementById('st-corta')) document.getElementById('st-corta').textContent = '0';
  document.getElementById('st-cola').textContent = state.cola.length;
  document.getElementById('sub-prov').textContent = `${fil.length} de ${state.proveedores.length} registros`;
  document.getElementById('cnt-prov').textContent = state.proveedores.length;
}

export function abrirNuevoProveedor() {
  state.editProvId = null;
  limpiarFormProv();
  document.getElementById('modal-prov-title').textContent = 'Nuevo Proveedor';
  document.getElementById('modal-prov').classList.add('open');
}

export function editarProv(id) {
  const p = state.proveedores.find(x => x.id === id);
  if (!p) return;
  state.editProvId = id;
  document.getElementById('modal-prov-title').textContent = 'Editar Proveedor';
  document.getElementById('p-nombre').value = p.nombre;
  document.getElementById('p-rfc').value = p.rfc || '';
  document.getElementById('p-cuenta').value = p.cuenta || '';
  document.getElementById('p-clabe').value = p.clabe || '';
  document.getElementById('p-banco').value = p.banco;
  document.getElementById('p-cat').value = p.categoria;
  document.getElementById('p-activo').value = p.activo ? 'true' : 'false';
  validarCuentaProv();
  document.querySelectorAll('#modal-prov .proyecto-pill').forEach(pp =>
    pp.classList.toggle('selected', p.proyectos.includes(pp.dataset.p))
  );
  document.getElementById('modal-prov').classList.add('open');
}

function limpiarFormProv() {
  document.getElementById('p-nombre').value = '';
  document.getElementById('p-rfc').value = '';
  document.getElementById('p-cuenta').value = '';
  document.getElementById('p-clabe').value = '';
  document.getElementById('p-banco').value = '';
  document.getElementById('p-cat').value = 'General';
  document.getElementById('p-activo').value = 'true';
  document.getElementById('p-cuenta-status').textContent = '';
  document.querySelectorAll('#modal-prov .proyecto-pill').forEach(pp => pp.classList.remove('selected'));
}

export function validarCuentaProv() {
  const v = (document.getElementById('p-clabe').value || '').replace(/\D/g, '');
  document.getElementById('p-clabe').value = v;
  const st = document.getElementById('p-cuenta-status');
  const bi = document.getElementById('p-banco');
  if (v.length === 18) { bi.value = getBanco(v); st.className = 'cuenta-ok'; st.textContent = `✓ ${getBanco(v)}`; }
  else if (v.length > 0) { st.className = 'cuenta-err'; st.textContent = `${v.length}/18`; bi.value = ''; }
  else { st.textContent = ''; bi.value = ''; }
}

export function guardarProveedor() {
  const nombre = document.getElementById('p-nombre').value.trim().toUpperCase();
  const cuenta = document.getElementById('p-cuenta').value.trim();
  const clabe = document.getElementById('p-clabe').value.trim();
  if (!nombre) { notify('El nombre es obligatorio', 'error'); return; }
  if (!cuenta && !clabe) { notify('Ingresa al menos un número de cuenta o CLABE', 'error'); return; }
  if (clabe && clabe.length !== 18) { notify('CLABE debe tener 18 dígitos', 'error'); return; }
  const tipo = clabe.length === 18 ? 'CLABE' : 'Cuenta';
  const banco = clabe.length === 18 ? getBanco(clabe) : (document.getElementById('p-banco').value || 'BBVA');
  const projs = [...document.querySelectorAll('#modal-prov .proyecto-pill.selected')].map(p => p.dataset.p);
  const existing = state.editProvId ? state.proveedores.find(p => p.id === state.editProvId) : null;
  const obj = {
    id: state.editProvId || state.nextId++,
    nombre, rfc: document.getElementById('p-rfc').value.toUpperCase(),
    banco, tipo_cuenta: tipo, cuenta,
    clabe, num_cuenta: cuenta,
    categoria: document.getElementById('p-cat').value,
    subcategoria: existing ? existing.subcategoria || '' : '',
    activo: document.getElementById('p-activo').value === 'true',
    bloqueada_para_pago: existing ? existing.bloqueada_para_pago || false : false,
    proyectos: projs
  };
  if (state.editProvId) {
    const i = state.proveedores.findIndex(p => p.id === state.editProvId);
    state.proveedores[i] = obj;
  } else {
    state.proveedores.push(obj);
  }
  cerrar('modal-prov');
  renderProveedores();
  notify(state.editProvId ? 'Proveedor actualizado' : 'Proveedor agregado');
  gsSaveProveedores();
}

export function exportarCSV() {
  let csv = 'ID,Nombre,RFC,Banco,Tipo Cuenta,Cuenta/CLABE,Categoría,Proyectos\n';
  csv += state.proveedores.map(p =>
    `${p.id},"${p.nombre}",${p.rfc || ''},${p.banco},"${p.tipo_cuenta}",${p.cuenta},"${p.categoria}","${p.proyectos.join('|')}"`
  ).join('\n');
  dl(csv, 'proveedores_dehur.csv');
  notify('Exportado');
}

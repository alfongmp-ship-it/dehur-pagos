import { state, datosListos } from '../state.js';
import { getBanco, getTipo } from '../config/bancos.js';
import { tipoBadge, catTag, proyTag } from '../ui/badges.js';
import { fmt, dl, escapeHtml } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveProveedores, esPorFila, sbGuardarFila } from '../services/google-sync.js';

// Subcategorías por categoría: 'Proveedor' (especialidad de obra) y 'Gastos de operación'
// (compras que no se pagan por transferencia: gasolina, tiendas, viajes, materiales de
// mostrador…). "Gastos de operación" NO se ofrece al crear un proveedor a mano: solo
// entra por la carga de Excel (controlada), para que la distinción quede limpia.
const SUBCATS = {
  'Proveedor': ['Estructura', 'Instalaciones', 'Acabados', 'Herrería', 'Impermeabilización', 'Electricidad', 'Plomería', 'Otros'],
  'Gastos de operación': ['Gasolina', 'Tiendas y súper', 'Papelería', 'Viajes y transporte', 'Gobierno y cuotas', 'Materiales de obra', 'Otros'],
};

// Un <select> que no trae la opción guardada la pierde al guardar (categorías viejas
// como "Impuestos" o "Gastos fijos" quedaban en blanco): se agrega antes de asignarla.
function _asegurarOpcion(sel, valor) {
  if (!sel || !valor) return;
  if ([...sel.options].some(o => o.value === valor)) return;
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = valor;
  sel.appendChild(o);
}

// Regresa el menú a su lista base (la del HTML): quita lo agregado al editar otro
// proveedor (p. ej. "Gastos de operación" o "Impuestos"), así no queda ofrecido para
// proveedores nuevos ni para cambiar a otro.
function _opcionesBase(sel) {
  if (!sel) return;
  if (!sel._base) sel._base = new Set([...sel.options].map(o => o.value));
  for (let i = sel.options.length - 1; i >= 0; i--) {
    if (!sel._base.has(sel.options[i].value)) sel.remove(i);
  }
}

export function toggleSubcat() {
  const cat = document.getElementById('p-cat').value;
  const lista = SUBCATS[cat];
  document.getElementById('field-subcat').style.display = lista ? '' : 'none';
  const sel = document.getElementById('p-subcat');
  if (!lista || !sel) return;
  const actual = sel.value;
  if (sel.dataset.cat !== cat) {
    sel.innerHTML = '<option value="">—</option>' + lista.map(s => `<option>${escapeHtml(s)}</option>`).join('');
    sel.dataset.cat = cat;
  }
  sel.value = lista.includes(actual) ? actual : '';
}

export function renderProveedores() {
  const tb = document.getElementById('tbody-prov');
  if (!tb) return;

  if (!datosListos()) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div></td></tr>';
    const cnt = document.getElementById('cnt-prov'); if (cnt) cnt.textContent = '0';
    return;
  }

  // El filtro también ofrece las categorías que ya existen en el catálogo aunque no
  // estén en la lista fija (p. ej. "Impuestos", "Gastos fijos").
  const selF = document.getElementById('f-cat');
  if (selF) new Set(state.proveedores.map(p => p.categoria).filter(Boolean)).forEach(c => _asegurarOpcion(selF, c));
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
  if (!fil.length) {
    tb.innerHTML = `<tr><td colspan="9"><div class="empty-state" style="padding:30px;"><div style="font-size:28px;opacity:.4;margin-bottom:8px;">🔍</div><div>Sin resultados</div></div></td></tr>`;
    return;
  }
  tb.innerHTML = fil.map(p => `<tr><td style="font-size:12px;color:var(--muted);text-align:center;">${p.id}</td><td><div class="name-cell">${escapeHtml(p.nombre)}</div>${p.rfc ? `<div class="name-sub">${escapeHtml(p.rfc)}</div>` : ''}</td><td>${tipoBadge(p.tipo_cuenta)}</td><td style="font-size:13px;">${escapeHtml(p.banco)}</td><td><span class="mono">${escapeHtml(p.clabe || p.cuenta)}</span></td><td>${catTag(p.categoria)}</td><td style="font-size:11px;color:var(--muted);">${SUBCATS[p.categoria] && p.subcategoria ? escapeHtml(p.subcategoria) : '—'}</td><td>${p.proyectos.map(proyTag).join(' ')}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-success btn-sm" onclick="abrirPagoRapido('prov',${p.id})">+ Pago</button><button class="btn btn-ghost btn-sm" onclick="editarProv(${p.id})">Editar</button></div></td></tr>`).join('');
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
  // Categoría / subcategoría que no estén en la lista: se agregan como opción para que
  // guardar NO las borre.
  _opcionesBase(document.getElementById('p-cat'));
  _asegurarOpcion(document.getElementById('p-cat'), p.categoria);
  document.getElementById('p-cat').value = p.categoria;
  toggleSubcat();
  if (SUBCATS[p.categoria]) _asegurarOpcion(document.getElementById('p-subcat'), p.subcategoria);
  document.getElementById('p-subcat').value = p.subcategoria || '';
  document.getElementById('p-activo').value = p.activo ? 'true' : 'false';
  const sinCuenta = !p.cuenta && !p.clabe;
  document.getElementById('p-sin-cuenta').checked = sinCuenta;
  toggleSinCuenta();
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
  _opcionesBase(document.getElementById('p-cat'));
  document.getElementById('p-cat').value = 'General';
  document.getElementById('p-subcat').value = '';
  document.getElementById('field-subcat').style.display = 'none';
  document.getElementById('p-activo').value = 'true';
  document.getElementById('p-cuenta-status').textContent = '';
  document.getElementById('p-sin-cuenta').checked = false;
  toggleSinCuenta();
  document.querySelectorAll('#modal-prov .proyecto-pill').forEach(pp => pp.classList.remove('selected'));
}

export function toggleSinCuenta() {
  const sinCuenta = document.getElementById('p-sin-cuenta').checked;
  const display = sinCuenta ? 'none' : '';
  document.getElementById('field-cuenta').style.display = display;
  document.getElementById('field-clabe').style.display = display;
  document.getElementById('field-banco').style.display = display;
  if (sinCuenta) {
    document.getElementById('p-cuenta').value = '';
    document.getElementById('p-clabe').value = '';
    document.getElementById('p-banco').value = '';
    document.getElementById('p-cuenta-status').textContent = '';
  }
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
  const sinCuenta = document.getElementById('p-sin-cuenta').checked;
  if (!nombre) { notify('El nombre es obligatorio', 'error'); return; }
  if (!sinCuenta && !cuenta && !clabe) { notify('Ingresa al menos un número de cuenta o CLABE', 'error'); return; }
  if (!sinCuenta && clabe && clabe.length !== 18) { notify('CLABE debe tener 18 dígitos', 'error'); return; }
  const tipo = sinCuenta ? 'N/A' : (clabe.length === 18 ? 'CLABE' : 'Cuenta');
  const banco = sinCuenta ? 'N/A' : (clabe.length === 18 ? getBanco(clabe) : (document.getElementById('p-banco').value || 'BBVA'));
  const projs = [...document.querySelectorAll('#modal-prov .proyecto-pill.selected')].map(p => p.dataset.p);
  const existing = state.editProvId ? state.proveedores.find(p => p.id === state.editProvId) : null;
  const obj = {
    id: state.editProvId || state.nextId++,
    nombre, rfc: document.getElementById('p-rfc').value.toUpperCase(),
    banco, tipo_cuenta: tipo, cuenta,
    clabe, num_cuenta: cuenta,
    categoria: document.getElementById('p-cat').value,
    subcategoria: SUBCATS[document.getElementById('p-cat').value] ? (document.getElementById('p-subcat').value || '') : '',
    activo: document.getElementById('p-activo').value === 'true',
    bloqueada_para_pago: existing ? existing.bloqueada_para_pago || false : false,
    aliases: existing ? (existing.aliases || []) : [],   // editar NO borra los alias (los usa el buscador)
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
  // Fase 3: en modo 'fila' guardamos SOLO este proveedor a Supabase (no la tabla
  // completa) y le pedimos a gsSaveProveedores que no espeje. En modo 'tabla'
  // todo queda igual que antes (espejo de tabla completa).
  const porFila = esPorFila('proveedores');
  gsSaveProveedores({ porFila });
  if (porFila) sbGuardarFila('proveedores', obj);
}

export function exportarCSV() {
  let csv = 'ID,Nombre,RFC,Banco,Tipo Cuenta,Cuenta/CLABE,Categoría,Proyectos\n';
  csv += state.proveedores.map(p =>
    `${p.id},"${p.nombre}",${p.rfc || ''},${p.banco},"${p.tipo_cuenta}",${p.cuenta},"${p.categoria}","${p.proyectos.join('|')}"`
  ).join('\n');
  dl(csv, 'proveedores_dehur.csv');
  notify('Exportado');
}

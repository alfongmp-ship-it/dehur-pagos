import { state, datosListos } from '../state.js';
import { getBanco, getTipo } from '../config/bancos.js';
import { tipoBadge } from '../ui/badges.js';
import { dl } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveEmpleados } from '../services/google-sync.js';

export function renderNomina() {
  const tb = document.getElementById('tbody-nom');
  if (!tb) return;

  if (!datosListos()) {
    tb.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div></td></tr>';
    const cnt = document.getElementById('cnt-nom'); if (cnt) cnt.textContent = '0';
    return;
  }

  const q = document.getElementById('buscar-nom').value.toLowerCase();
  const ft = document.getElementById('f-nom-tipo').value;
  const fil = state.empleados.filter(e =>
    (!q || (e.nombre.toLowerCase().includes(q) || e.cuenta.includes(q) || e.banco.toLowerCase().includes(q))) &&
    (!ft || e.tipo_cuenta === ft)
  );
  tb.innerHTML = fil.map(e => `<tr><td><div class="name-cell">${e.nombre}</div></td><td style="font-size:12px;color:var(--muted);">${e.puesto || '—'}</td><td>${tipoBadge(e.tipo_cuenta)}</td><td style="font-size:13px;">${e.banco}</td><td><span class="mono">${e.cuenta}</span></td><td style="font-size:11px;color:var(--muted);">${(e.empresa || '').replace('DESARROLLO Y CONTROL ALE SA DE CV', 'D.Y C. ALE').replace('DESARROLLO DE HOGARES URBANOS SA DE CV', 'D.H. URBANOS')}</td><td>${e.activo !== false ? '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(39,174,96,.15);color:#27ae60;">Activo</span>' : '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(231,76,60,.15);color:#e74c3c;">Inactivo</span>'}</td><td><div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn btn-success btn-sm" onclick="abrirPagoRapido('emp',${e.id})">+ Pago</button><button class="btn btn-ghost btn-sm" onclick="editarEmp(${e.id})">Editar</button></div></td></tr>`).join('');
  document.getElementById('st-nom-total').textContent = state.empleados.length;
  document.getElementById('st-nom-clabe').textContent = state.empleados.filter(e => e.tipo_cuenta === 'CLABE').length;
  document.getElementById('st-nom-bbva').textContent = state.empleados.filter(e => e.tipo_cuenta === 'Cuenta BBVA').length;
  document.getElementById('cnt-nom').textContent = state.empleados.length;
}

export function abrirNuevoEmpleado() {
  state.editEmpId = null;
  limpiarFormEmp();
  document.getElementById('modal-emp-title').textContent = 'Nuevo Empleado';
  document.getElementById('modal-emp').classList.add('open');
}

export function editarEmp(id) {
  const e = state.empleados.find(x => x.id === id);
  if (!e) return;
  state.editEmpId = id;
  document.getElementById('modal-emp-title').textContent = 'Editar Empleado';
  document.getElementById('e-nombre').value = e.nombre;
  document.getElementById('e-puesto').value = e.puesto || '';
  document.getElementById('e-empresa').value = e.empresa || 'DEHUR TERRITORIAL SA DE CV';
  document.getElementById('e-cuenta').value = e.cuenta;
  document.getElementById('e-banco').value = e.banco;
  document.getElementById('e-tipo').value = e.tipo_cuenta;
  document.getElementById('e-activo').value = e.activo ? 'true' : 'false';
  updateTipoEmp();
  document.getElementById('modal-emp').classList.add('open');
}

function limpiarFormEmp() {
  document.getElementById('e-nombre').value = '';
  document.getElementById('e-puesto').value = '';
  document.getElementById('e-cuenta').value = '';
  document.getElementById('e-banco').value = '';
  document.getElementById('e-tipo').value = 'CLABE';
  document.getElementById('e-activo').value = 'true';
  updateTipoEmp();
}

export function updateTipoEmp() {
  const t = document.getElementById('e-tipo').value;
  const lbl = document.getElementById('lbl-cuenta-emp');
  const inp = document.getElementById('e-cuenta');
  if (t === 'CLABE') { lbl.textContent = 'CLABE Interbancaria * (18 dígitos)'; inp.maxLength = 18; inp.placeholder = '000000000000000000'; }
  else { lbl.textContent = 'Número de Cuenta BBVA * (10 dígitos)'; inp.maxLength = 10; inp.placeholder = '0000000000'; }
  validarCuentaEmp();
}

export function validarCuentaEmp() {
  const t = document.getElementById('e-tipo').value;
  const v = document.getElementById('e-cuenta').value.replace(/\D/g, '');
  document.getElementById('e-cuenta').value = v;
  const st = document.getElementById('e-cuenta-status');
  const bi = document.getElementById('e-banco');
  if (t === 'CLABE') {
    if (v.length === 18) { bi.value = getBanco(v); st.className = 'cuenta-ok'; st.textContent = '✓ ' + getBanco(v); }
    else if (v.length > 0) { st.className = 'cuenta-err'; st.textContent = v.length + '/18'; bi.value = ''; }
    else { st.textContent = ''; bi.value = ''; }
  } else {
    bi.value = 'BBVA';
    st.className = v.length > 0 ? 'cuenta-ok' : '';
    st.textContent = v.length > 0 ? '✓ ' + v.length + ' dígitos · BBVA' : '';
  }
}

export function guardarEmpleado() {
  const nombre = document.getElementById('e-nombre').value.trim().toUpperCase();
  const cuenta = document.getElementById('e-cuenta').value.trim();
  const tipo = document.getElementById('e-tipo').value;
  if (!nombre || !cuenta) { notify('Nombre y cuenta son obligatorios', 'error'); return; }
  if (tipo === 'CLABE' && cuenta.length !== 18) { notify('CLABE debe tener 18 dígitos', 'error'); return; }
  const obj = {
    id: state.editEmpId || state.nextId++, nombre,
    puesto: document.getElementById('e-puesto').value,
    empresa: document.getElementById('e-empresa').value,
    banco: getBanco(cuenta) || 'BBVA', tipo_cuenta: tipo, cuenta,
    clabe: tipo === 'CLABE' ? cuenta : '', num_cuenta: tipo !== 'CLABE' ? cuenta : '',
    categoria: 'Nómina / Asimilados', proyectos: ['Concentradora DT'], rfc: '',
    activo: document.getElementById('e-activo').value === 'true'
  };
  if (state.editEmpId) {
    const i = state.empleados.findIndex(e => e.id === state.editEmpId);
    state.empleados[i] = obj;
  } else {
    state.empleados.push(obj);
  }
  cerrar('modal-emp');
  renderNomina();
  notify(state.editEmpId ? 'Empleado actualizado' : 'Empleado agregado');
  gsSaveEmpleados();
}

export function exportarNomina() {
  let csv = 'Nombre,Puesto,Empresa,Banco,Tipo Cuenta,Cuenta/CLABE\n';
  csv += state.empleados.map(e =>
    `"${e.nombre}","${e.puesto || ''}","${e.empresa || ''}",${e.banco},"${e.tipo_cuenta}",${e.cuenta}`
  ).join('\n');
  dl(csv, 'nomina_dehur.csv');
  notify('Nómina exportada');
}

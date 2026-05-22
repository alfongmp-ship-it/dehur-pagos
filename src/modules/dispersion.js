import { state, esConcentradora } from '../state.js';
import { tipoBadge } from '../ui/badges.js';
import { fmt } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { saveData, gsSavePendientes, gsSaveProyectos, gsSaveCuentasPropias } from '../services/google-sync.js';
import { showPage } from '../router.js';
import { saveProy } from '../config/proyectos.js';
import { getSubPartidas, getPartidasCatalogo, subPartidaObligatoria } from '../config/sub-partidas.js';

// Pobla el select de partidas con el catálogo activo. Mantiene el valor actual
// si sigue siendo válido.
export function refreshPagoPartidaSelect() {
  const sel = document.getElementById('pago-partida');
  if (!sel) return;
  const actual = sel.value || '';
  const cat = getPartidasCatalogo();
  sel.innerHTML = '<option value="">— selecciona —</option>' +
    cat.map(p => `<option value="${p.partida}">${p.partida}</option>`).join('');
  if (actual && cat.some(p => p.partida === actual)) sel.value = actual;
}

export function togglePagoSubPartida() {
  const partida = document.getElementById('pago-partida')?.value || '';
  const wrap = document.getElementById('pago-sub-partida-wrap');
  const sel = document.getElementById('pago-sub-partida');
  const lbl = document.getElementById('pago-sub-partida-label');
  if (!wrap || !sel) return;
  const opciones = getSubPartidas(partida);
  const obligatoria = subPartidaObligatoria(partida);
  if (opciones.length) {
    sel.innerHTML = (obligatoria ? '' : '<option value="">— (opcional) —</option>') +
      opciones.map(o => `<option value="${o}">${o}</option>`).join('');
    if (lbl) lbl.innerHTML = obligatoria ? 'Sub-partida *' : 'Sub-partida';
    wrap.style.display = '';
  } else {
    sel.innerHTML = '';
    sel.value = '';
    wrap.style.display = 'none';
  }
}

// ---- PAGO / COLA ----
export function abrirPagoRapido(src, id) {
  const rec = src === 'prov' ? state.proveedores.find(p => p.id === id) : state.empleados.find(e => e.id === id);
  if (!rec) return;
  if (src === 'emp' && rec.activo === false) {
    notify('Empleado inactivo — no se puede realizar el pago', 'error');
    return;
  }
  state.pagoP = { ...rec, _src: src };
  document.getElementById('buscar-m').value = rec.nombre;
  document.getElementById('res-modal').style.display = 'none';
  cargarSeleccionado();
  document.getElementById('pago-concepto').value = '';
  document.getElementById('pago-importe').value = '';
  document.getElementById('modal-pago').classList.add('open');
  if (window.showPage) window.showPage('dispersion', document.getElementById('nav-dispersion'));
}

export function abrirModalPago() {
  state.pagoP = null;
  document.getElementById('buscar-m').value = '';
  document.getElementById('res-modal').style.display = 'none';
  document.getElementById('pago-sel').style.display = 'none';
  document.getElementById('alerta-tipo').style.display = 'none';
  document.getElementById('pago-concepto').value = '';
  document.getElementById('pago-importe').value = '';
  refreshPagoPartidaSelect();
  document.getElementById('pago-partida').value = '';
  togglePagoSubPartida();
  // Poblar cuenta origen: proyectos BBVA + cuentas adicionales
  const sel = document.getElementById('pago-cuenta-origen');
  if (sel) {
    const proyOpts = state.proyectos.filter(p => p.activo !== false && p.cuenta).map(p =>
      `<option value="proy:${p.nombre}" data-tipo="bbva">${p.nombre} – BBVA ···${p.cuenta.slice(-4)}</option>`
    ).join('');
    const extraOpts = state.cuentasPropias.filter(c => c.activo !== false).map(c =>
      `<option value="extra:${c.nombre}" data-tipo="otro">${c.nombre} – ${c.banco}${c.numero_cuenta ? ' ···' + c.numero_cuenta.slice(-4) : ''}</option>`
    ).join('');
    sel.innerHTML = proyOpts + extraOpts;
  }
  checkCuentaOrigenPago();
  document.getElementById('modal-pago').classList.add('open');
}

export function checkCuentaOrigenPago() {
  const sel = document.getElementById('pago-cuenta-origen');
  const btn = document.getElementById('btn-pago-action');
  const info = document.getElementById('pago-info-no-bbva');
  if (!sel || !btn) return;
  const val = sel.value || '';
  const esBBVA = val.startsWith('proy:');
  if (esBBVA) {
    btn.textContent = 'Agregar a Cola ⚡';
    btn.onclick = agregarACola;
    if (info) info.style.display = 'none';
  } else {
    btn.textContent = 'Confirmar Pago ✓';
    btn.onclick = confirmarPagoDirecto;
    if (info) info.style.display = '';
  }
}

function cargarSeleccionado() {
  if (!state.pagoP) return;
  document.getElementById('sel-nombre').textContent = state.pagoP.nombre;
  document.getElementById('sel-cuenta').textContent = state.pagoP.cuenta + ' · ' + state.pagoP.banco;
  document.getElementById('sel-banco').textContent = state.pagoP.tipo_cuenta;
  document.getElementById('sel-tipo-badge').innerHTML = tipoBadge(state.pagoP.tipo_cuenta);
  document.getElementById('pago-sel').style.display = '';
  document.getElementById('alerta-tipo').style.display = state.pagoP.tipo_cuenta === 'Cuenta corta' ? '' : 'none';
}

export function buscarModal() {
  const q = document.getElementById('buscar-m').value.toLowerCase();
  const res = document.getElementById('res-modal');
  if (!q) { res.style.display = 'none'; return; }
  const all = [...state.proveedores.map(p => ({ ...p, _src: 'prov' })), ...state.empleados.map(e => ({ ...e, _src: 'emp' }))];
  const esId = /^\d+$/.test(q);
  const f = all.filter(p => esId ? String(p.id) === q : p.nombre.toLowerCase().includes(q)).slice(0, 8);
  if (!f.length) { res.style.display = 'none'; return; }
  res.style.display = '';
  res.innerHTML = f.map(p =>
    `<div onclick="selPago('${p._src}',${p.id})" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''"><div style="font-weight:500;font-size:12px;">${p.nombre}</div><div style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;">${p.cuenta} · ${p.banco} · ${p.tipo_cuenta}</div></div>`
  ).join('');
}

export function selPago(src, id) {
  const rec = src === 'prov' ? state.proveedores.find(p => p.id === id) : state.empleados.find(e => e.id === id);
  state.pagoP = { ...rec, _src: src };
  document.getElementById('buscar-m').value = rec.nombre;
  document.getElementById('res-modal').style.display = 'none';
  cargarSeleccionado();
}

export function agregarACola() {
  if (!state.pagoP) { notify('Selecciona un destinatario', 'error'); return; }
  const concepto = document.getElementById('pago-concepto').value.trim();
  const importe = parseFloat(document.getElementById('pago-importe').value);
  const partida = document.getElementById('pago-partida')?.value.trim() || '';
  const sub_partida = document.getElementById('pago-sub-partida')?.value || '';
  const ctaVal = document.getElementById('pago-cuenta-origen')?.value || '';
  const proyecto = ctaVal.replace(/^proy:|^extra:/, '');
  if (!concepto) { notify('El concepto es obligatorio', 'error'); return; }
  if (!importe || importe <= 0) { notify('Ingresa un importe válido', 'error'); return; }
  if (subPartidaObligatoria(partida) && !sub_partida) { notify('La sub-partida es obligatoria para CONSTRUCCION', 'error'); return; }
  state.cola.push({ id: Date.now(), proveedor: state.pagoP, concepto, importe, proyecto, partida, sub_partida, proveedor_id: String(state.pagoP.id || ''), factura_id: '' });
  cerrar('modal-pago');
  renderCola();
  document.getElementById('cnt-cola').textContent = state.cola.length;
  document.getElementById('st-cola').textContent = state.cola.length;
  notify(`${state.pagoP.nombre.split(' ')[0]} · ${fmt(importe)}`);
}

export function confirmarPagoDirecto() {
  if (!state.pagoP) { notify('Selecciona un destinatario', 'error'); return; }
  const concepto = document.getElementById('pago-concepto').value.trim();
  const importe = parseFloat(document.getElementById('pago-importe').value);
  const partida = document.getElementById('pago-partida')?.value.trim() || '';
  const sub_partida = document.getElementById('pago-sub-partida')?.value || '';
  const ctaVal = document.getElementById('pago-cuenta-origen')?.value || '';
  const cuentaNombre = ctaVal.replace(/^proy:|^extra:/, '');
  if (!concepto) { notify('El concepto es obligatorio', 'error'); return; }
  if (!importe || importe <= 0) { notify('Ingresa un importe válido', 'error'); return; }
  if (subPartidaObligatoria(partida) && !sub_partida) { notify('La sub-partida es obligatoria para CONSTRUCCION', 'error'); return; }

  // Buscar el proyecto real de la cuenta
  const proy = state.proyectos.find(x => x.nombre === cuentaNombre);
  const extra = state.cuentasPropias.find(x => x.nombre === cuentaNombre);
  const proyectoReal = esConcentradora(cuentaNombre)
    ? ''
    : (proy ? proy.nombre : (extra?.proyecto || cuentaNombre));

  const fecha = new Date().toLocaleDateString('es-MX');
  state.historial.unshift({
    fecha, nombre: state.pagoP.nombre, concepto, importe,
    proyecto: proyectoReal, banco: state.pagoP.banco,
    tipo: state.pagoP.tipo_cuenta || 'Cuenta',
    proveedor_id: String(state.pagoP.id || ''), factura_id: '',
    cuenta_origen: cuentaNombre, tipo_registro: 'Pago', partida, sub_partida
  });

  document.getElementById('cnt-hist').textContent = state.historial.length;
  saveData(1);

  // Ajustar saldo de la cuenta origen (reusar proy/extra de arriba)
  const todayISO = new Date().toISOString().split('T')[0];
  if (proy && proy.ultima_act_saldo && todayISO >= proy.ultima_act_saldo.slice(0, 10)) {
    proy.saldo = (proy.saldo || 0) - importe;
    saveProy(state.proyectos); gsSaveProyectos();
  } else if (extra && extra.ultima_actualizacion && todayISO >= extra.ultima_actualizacion.slice(0, 10)) {
    extra.saldo = (extra.saldo || 0) - importe;
    gsSaveCuentasPropias();
  }

  cerrar('modal-pago');
  if (window.renderHistorial) window.renderHistorial();
  if (window.renderCuentasPropias) window.renderCuentasPropias();
  if (window.renderHeaderBadges) window.renderHeaderBadges();
  notify(`Pago directo registrado: ${state.pagoP.nombre.split(' ')[0]} · ${fmt(importe)}`);
}

// Nómina masiva a cola
export function abrirModalNominaDisp() {
  renderNomDisp();
  document.getElementById('modal-nom-disp').classList.add('open');
}

function renderNomDisp(q = '') {
  const fil = state.empleados.filter(e => e.activo && (!q || e.nombre.toLowerCase().includes(q)));
  document.getElementById('nom-disp-lista').innerHTML = fil.map(e =>
    `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);"><input type="checkbox" id="chk-${e.id}" value="${e.id}" style="width:16px;height:16px;cursor:pointer;"><div style="flex:1;"><div style="font-weight:500;font-size:12px;">${e.nombre}</div><div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;">${e.cuenta} · ${e.banco} · ${tipoBadge(e.tipo_cuenta)}</div></div><div style="position:relative;"><span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:11px;">$</span><input type="number" id="monto-${e.id}" placeholder="0.00" step="0.01" style="width:110px;padding:6px 8px 6px 18px;font-size:12px;" onclick="this.previousElementSibling.parentElement.previousElementSibling.previousElementSibling.checked=true"></div></div>`
  ).join('');
}

export function filtrarNomDisp() {
  renderNomDisp(document.getElementById('buscar-nom-disp').value.toLowerCase());
}

export function agregarNominaACola() {
  const proyecto = document.getElementById('qnom-proy').value;
  if (!proyecto) { notify('Selecciona un proyecto', 'error'); return; }
  let count = 0;
  state.empleados.forEach(e => {
    const chk = document.getElementById('chk-' + e.id);
    const monto = parseFloat(document.getElementById('monto-' + e.id)?.value || '0');
    if (chk && chk.checked && monto > 0) {
      state.cola.push({ id: Date.now() + Math.random(), proveedor: { ...e }, concepto: 'NOMINA QUINCENA', importe: monto, proyecto });
      count++;
    }
  });
  if (!count) { notify('Selecciona empleados y captura montos', 'error'); return; }
  cerrar('modal-nom-disp');
  renderCola();
  document.getElementById('cnt-cola').textContent = state.cola.length;
  document.getElementById('st-cola').textContent = state.cola.length;
  notify(`${count} empleados agregados a la cola`);
}

export function renderCola() {
  const lista = document.getElementById('cola-lista');
  if (!lista) return;
  const tb = document.getElementById('total-bar');

  if (!state.gsToken) {
    lista.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div>';
    if (tb) tb.style.display = 'none';
    const cnt = document.getElementById('cnt-cola'); if (cnt) cnt.textContent = '0';
    return;
  }

  if (!state.cola.length) {
    lista.innerHTML = `<div class="queue-empty"><div style="font-size:32px;margin-bottom:10px;opacity:.4">⚡</div><div>Sin pagos en cola</div></div>`;
    tb.style.display = 'none';
    return;
  }
  lista.innerHTML = state.cola.map(item =>
    `<div class="queue-item"><div style="flex:1;"><div class="qi-name">${item.proveedor.nombre}</div><div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;margin-top:2px;">${item.proveedor.cuenta} · ${item.proveedor.banco} ${tipoBadge(item.proveedor.tipo_cuenta)}</div><div style="font-size:11px;color:var(--muted);margin-top:2px;">${item.concepto} · ${item.proyecto}${item.partida ? ' · <span style="color:var(--accent);">' + item.partida + '</span>' : ''}</div></div><div style="text-align:right;"><div class="qi-amount">${fmt(item.importe)}</div></div><button onclick="qDel(${item.id})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:4px;" title="Quitar">✕</button></div>`
  ).join('');
  const total = state.cola.reduce((s, i) => s + i.importe, 0);
  document.getElementById('total-amount').textContent = fmt(total);
  document.getElementById('total-desc').textContent = `${state.cola.length} pago${state.cola.length > 1 ? 's' : ''}`;
  tb.style.display = 'flex';
}

export function qDel(id) {
  state.cola = state.cola.filter(i => i.id !== id);
  renderCola();
  document.getElementById('cnt-cola').textContent = state.cola.length;
  document.getElementById('st-cola').textContent = state.cola.length;
}

export function limpiarCola() {
  if (!state.cola.length) return;
  if (confirm('¿Limpiar toda la cola?')) {
    state.cola = [];
    renderCola();
    document.getElementById('cnt-cola').textContent = 0;
    document.getElementById('st-cola').textContent = 0;
  }
}

export function buscarRapido() {
  const q = document.getElementById('buscar-rapido').value.toLowerCase();
  const res = document.getElementById('res-rapidos');
  if (!q) { res.innerHTML = ''; return; }
  const all = [...state.proveedores.map(p => ({ ...p, _src: 'prov' })), ...state.empleados.map(e => ({ ...e, _src: 'emp' }))];
  const f = all.filter(p => p.activo && p.nombre.toLowerCase().includes(q)).slice(0, 7);
  res.innerHTML = f.map(p =>
    `<div onclick="quickAdd('${p._src}',${p.id})" style="padding:8px 10px;cursor:pointer;border-radius:6px;margin-bottom:4px;background:var(--surface2);" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='var(--surface2)'"><div style="font-size:12px;font-weight:500;">${p.nombre.substring(0, 40)}${p.nombre.length > 40 ? '...' : ''}</div><div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;">${p.banco} · ${p.tipo_cuenta}</div></div>`
  ).join('') || '<div style="font-size:12px;color:var(--muted);padding:8px;">Sin resultados</div>';
}

export function quickAdd(src, id) {
  const rec = src === 'prov' ? state.proveedores.find(p => p.id === id) : state.empleados.find(e => e.id === id);
  state.pagoP = { ...rec, _src: src };
  document.getElementById('buscar-m').value = rec.nombre;
  cargarSeleccionado();
  document.getElementById('pago-concepto').value = '';
  document.getElementById('pago-importe').value = '';
  document.getElementById('res-modal').style.display = 'none';
  document.getElementById('modal-pago').classList.add('open');
}

// Decide qué cuenta escribir en el archivo de dispersión BBVA según el banco
// del beneficiario. Origen siempre es BBVA (los proyectos son BBVA).
// - Destino BBVA  → "Mismo Banco" + cuenta corta (fallback: CLABE si sólo hay eso)
// - Destino otro  → "Interbancarios" + CLABE forzosa
function resolverCuentaAbono(proveedor) {
  const bancoDestino = (proveedor.banco || '').trim().toUpperCase();
  const esDestinoBBVA = bancoDestino === 'BBVA' || bancoDestino === 'BBVA BANCOMER';
  const cuenta = proveedor.cuenta || '';
  const clabe = proveedor.clabe || '';

  if (esDestinoBBVA) {
    const ctaCorta = cuenta.length !== 18 ? cuenta : '';
    return { tipo: 'Mismo Banco', cuenta: ctaCorta || cuenta || clabe };
  }

  const clabeFinal = clabe || (cuenta.length === 18 ? cuenta : '');
  return { tipo: 'Interbancarios', cuenta: clabeFinal || cuenta };
}

// ---- GENERAR ARCHIVO BBVA (XLSX formato SIM) ----
export function generarArchivo() {
  if (!window.XLSX) { notify('Cargando librería, intenta en 2 segundos', 'error'); return; }
  if (!state.cola.length) { notify('Cola vacía', 'error'); return; }
  const fecha = document.getElementById('fecha-disp').value || new Date().toISOString().split('T')[0];
  const proyId = document.getElementById('cuenta-disp').value;
  const proySel = state.proyectos.find(p => p.id === proyId) || state.proyectos[0];
  const cargo = proySel.cuenta;
  const fechaFn = fecha.replace(/-/g, '');

  const wb = XLSX.utils.book_new();
  const headers = [
    'TIPO DE OPERACIÓN', 'CUENTA CARGO', 'CTA. ABONO O CONVENIO CIE', 'IMPORTE',
    'DETALLE DEL PAGO O CONCEPTO CIE', 'REFERENCIA CIE O REFERENCIA NUMERICA O ABA / BIC',
    'MONEDA', 'TITULAR o BENEFICIARIO', 'PAIS DEL BENEFICIARIO', 'DIRECCION DEL BENEFICIARIO',
    'TELEFONO BENEFICIARIO', 'BANCO BENEFICIARIO', 'PAIS BANCO BENEFICIARIO', 'DIRECCION BANCO BENEFICIARIO'
  ];
  const data = [headers];
  state.cola.forEach(item => {
    const { tipo, cuenta: ctaAbono } = resolverCuentaAbono(item.proveedor);
    data.push([tipo, cargo, ctaAbono, item.importe, item.concepto, '', 'Pesos', item.proveedor.nombre, '', '', '', '', '', '']);
  });
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Dispersión');

  const fn = 'Dispersion_BBVA_' + fechaFn + '.xlsx';
  XLSX.writeFile(wb, fn);
  notify('✅ Excel generado: ' + fn);

  // Mover a pendientes de confirmación y abrir modal
  const fd = new Date().toLocaleDateString('es-MX');
  state.pendientesConfirmacion = state.cola.map(item => ({
    id: item.id, proveedor_id: item.proveedor_id || item.proveedor.id || '', factura_id: item.factura_id || '',
    nombre: item.proveedor.nombre, cuenta: item.proveedor.cuenta,
    banco: item.proveedor.banco, tipo: item.proveedor.tipo_cuenta,
    concepto: item.concepto, importe: item.importe, proyecto: item.proyecto, partida: item.partida || '', sub_partida: item.sub_partida || '',
    cuenta_cargo: proySel.nombre,
    fechaGen: fd, seleccionado: true, tieneInfo: true,
    // Propagación de asignaciones planificadas (desde solicitud)
    asignacionesPlanificadas: item.asignacionesPlanificadas || [],
    repartoMetodo: item.repartoMetodo || null
  }));

  state.cola = [];
  renderCola();
  document.getElementById('cnt-cola').textContent = 0;
  document.getElementById('st-cola').textContent = 0;
  gsSavePendientes();
  setTimeout(() => {
    showPage('confirmar', document.getElementById('nav-confirmar'));
  }, 700);
}


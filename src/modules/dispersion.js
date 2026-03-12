import { state } from '../state.js';
import { getTipo } from '../config/bancos.js';
import { tipoBadge, proyTag } from '../ui/badges.js';
import { fmt, dl } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { abrirModalConfirmarPagos } from './historial.js';

// ---- PAGO / COLA ----
export function abrirPagoRapido(src, id) {
  const rec = src === 'prov' ? state.proveedores.find(p => p.id === id) : state.empleados.find(e => e.id === id);
  if (!rec) return;
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
  document.getElementById('modal-pago').classList.add('open');
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
  const f = all.filter(p => p.nombre.toLowerCase().includes(q) || p.cuenta.includes(q)).slice(0, 8);
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
  const proyecto = document.getElementById('pago-proy').value;
  if (!concepto) { notify('El concepto es obligatorio', 'error'); return; }
  if (!importe || importe <= 0) { notify('Ingresa un importe válido', 'error'); return; }
  state.cola.push({ id: Date.now(), proveedor: state.pagoP, concepto, importe, proyecto });
  cerrar('modal-pago');
  renderCola();
  document.getElementById('cnt-cola').textContent = state.cola.length;
  document.getElementById('st-cola').textContent = state.cola.length;
  notify(`${state.pagoP.nombre.split(' ')[0]} · ${fmt(importe)}`);
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
  const tb = document.getElementById('total-bar');
  if (!state.cola.length) {
    lista.innerHTML = `<div class="queue-empty"><div style="font-size:32px;margin-bottom:10px;opacity:.4">⚡</div><div>Sin pagos en cola</div></div>`;
    tb.style.display = 'none';
    return;
  }
  lista.innerHTML = state.cola.map(item =>
    `<div class="queue-item"><div style="flex:1;"><div class="qi-name">${item.proveedor.nombre}</div><div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;margin-top:2px;">${item.proveedor.cuenta} · ${item.proveedor.banco} ${tipoBadge(item.proveedor.tipo_cuenta)}</div><div style="font-size:11px;color:var(--muted);margin-top:2px;">${item.concepto} · ${item.proyecto}</div></div><div style="text-align:right;"><div class="qi-amount">${fmt(item.importe)}</div></div><button onclick="qDel(${item.id})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:4px;" title="Quitar">✕</button></div>`
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

// ---- GENERAR ARCHIVO CSV (desde cola) ----
export function generarArchivo() {
  if (!state.cola.length) { notify('Cola vacía', 'error'); return; }
  const tipo = document.getElementById('tipo-disp').value;
  const fecha = document.getElementById('fecha-disp').value || new Date().toISOString().split('T')[0];
  const proyId = document.getElementById('cuenta-disp').value;
  const proySel = state.proyectos.find(p => p.id === proyId) || state.proyectos[0];
  const cargo = proySel.cuenta;
  const total = state.cola.reduce((s, i) => s + i.importe, 0);
  let csv = '', fn = '';
  if (tipo === 'interbancario') {
    csv = `Numero de Registros=>>,, ${state.cola.length}\nImporte Total=======>>,, ${total.toFixed(2)}\n\nCUENTA CARGO,CUENTA CLABE / TARJETA ABONO,IMPORTE,TITULAR,MOTIVO PAGO,REF_NUMERICA\n`;
    csv += state.cola.map(i => `${cargo},${i.proveedor.cuenta},${i.importe.toFixed(2)},"${i.proveedor.nombre}","${i.concepto}",`).join('\n');
    fn = `bbva_interbancario_${fecha.replace(/-/g, '')}.csv`;
  } else if (tipo === 'mismo-banco') {
    csv = `Numero de Registros=>>,, ${state.cola.length}\nImporte Total ======>>,, ${total.toFixed(2)}\n\nCUENTA CARGO,CUENTA / TARJETA ABONO,MONEDA,IMPORTE,MOTIVO PAGO\n`;
    csv += state.cola.map(i => `${cargo},${i.proveedor.cuenta},MXP,${i.importe.toFixed(2)},"${i.concepto}"`).join('\n');
    fn = `bbva_mismo_banco_${fecha.replace(/-/g, '')}.csv`;
  } else {
    csv = `\n\n\n\n\n\n\nAFILIACION,,,,,,,,,,, DISPERSION\n,NO EMPLEADO,NOMBRE,CLABE,BANCO,IMPORTE,,,,,,,IMPORTE\n`;
    csv += state.cola.map((i, n) => `,${n + 1},"${i.proveedor.nombre}",${i.proveedor.cuenta},${i.proveedor.banco},${i.importe.toFixed(2)},,,,,,,${i.importe.toFixed(2)}`).join('\n');
    fn = `bbva_nomina_${fecha.replace(/-/g, '')}.csv`;
  }
  dl(csv, fn);
  const fd = new Date().toLocaleDateString('es-MX');
  state.cola.forEach(item => state.historial.unshift({ fecha: fd, nombre: item.proveedor.nombre, concepto: item.concepto, importe: item.importe, proyecto: item.proyecto, banco: item.proveedor.banco, tipo: item.proveedor.tipo_cuenta }));
  document.getElementById('cnt-hist').textContent = state.historial.length;
  notify(`Archivo generado: ${fn}`);
  state.cola = [];
  renderCola();
  document.getElementById('cnt-cola').textContent = 0;
  document.getElementById('st-cola').textContent = 0;
}

// ---- GENERAR EXCEL BBVA (desde solicitudes) ----
export function abrirModalDispersion() {
  const sel = state.solicitudesData.filter(s => s.seleccionado);
  if (!sel.length) { notify('Selecciona al menos un pago', 'error'); return; }

  // Bloquear si hay proveedores sin match — forzar vinculación manual primero
  const sinMatch = sel.filter(s => !s.match);
  if (sinMatch.length) {
    notify(`⚠ ${sinMatch.length} proveedor(es) sin vincular: ${sinMatch.map(s => s.proveedor).join(', ')}. Vincúlalos primero.`, 'error');
    return;
  }

  state.dispPagos = [];
  sel.forEach(s => {
    const prov = s.match;
    const cuentaF = s.cuentaEmbebida || '';
    const bancoF = s.bancoEmbebido || '';
    const cuenta = prov ? prov.cuenta : cuentaF;
    const banco = prov ? prov.banco : bancoF;
    const tieneInfo = !!(cuenta);
    state.dispPagos.push({
      id: Date.now() + '-' + Math.random(),
      nombre: prov ? prov.nombre : (s.proveedor || '').toUpperCase(),
      cuenta: cuenta || '', banco: banco || '',
      tipo: cuenta ? getTipo(cuenta) : '',
      concepto: (s.motivo || s.concepto || '').substring(0, 40),
      importe: s.importe, proyecto: s.proyecto || '',
      tieneInfo, seleccionado: tieneInfo
    });
  });

  const sel2 = document.getElementById('disp-cuenta-cargo');
  sel2.innerHTML = '';
  state.proyectos.filter(p => p.activo && p.cuenta).forEach(p => {
    const o = document.createElement('option');
    o.value = p.cuenta;
    o.textContent = p.nombre + ' — cta ' + p.cuenta;
    sel2.appendChild(o);
  });
  const proyFrec = state.dispPagos.map(d => d.proyecto).sort((a, b) =>
    state.dispPagos.filter(x => x.proyecto === b).length - state.dispPagos.filter(x => x.proyecto === a).length)[0];
  const proy = state.proyectos.find(p => p.nombre === proyFrec);
  if (proy && proy.cuenta) sel2.value = proy.cuenta;

  renderModalDisp();
  document.getElementById('modal-dispersion').classList.add('open');
}

export function renderModalDisp() {
  const tbody = document.getElementById('tbody-disp');
  const total = state.dispPagos.reduce((s, d) => s + d.importe, 0);
  const selTotal = state.dispPagos.filter(d => d.seleccionado).reduce((s, d) => s + d.importe, 0);
  const sinInfo = state.dispPagos.filter(d => !d.tieneInfo);

  document.getElementById('disp-resumen').innerHTML =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;">' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">TOTAL SOLICITUD</div>' +
    '<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:700;">' + fmt(total) + '</div></div>' +
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;">' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">A DISPERSAR</div>' +
    '<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:700;color:var(--accent);">' + fmt(selTotal) + '</div></div>' +
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;">' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">SIN CUENTA</div>' +
    '<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:700;color:' + (sinInfo.length ? '#e74c3c' : 'var(--green)') + ';">' + sinInfo.length + '</div></div>';

  const warn = document.getElementById('disp-sin-cuenta-warn');
  if (sinInfo.length) {
    warn.style.display = 'block';
    warn.textContent = '⚠️ ' + sinInfo.length + ' pago(s) sin datos bancarios (no se incluirán en el Excel): ' + sinInfo.map(x => x.nombre).join(', ');
  } else { warn.style.display = 'none'; }

  tbody.innerHTML = state.dispPagos.map((d, i) =>
    '<tr style="' + (d.tieneInfo ? '' : 'opacity:.45') + '">' +
    '<td><input type="checkbox" ' + (d.seleccionado ? 'checked' : '') + ' ' + (d.tieneInfo ? '' : 'disabled') + ' onchange="dispPagos[' + i + '].seleccionado=this.checked;renderModalDisp()" style="width:14px;height:14px;cursor:pointer;"></td>' +
    '<td style="font-size:12px;font-weight:500;">' + d.nombre + '</td>' +
    '<td style="font-size:11px;color:var(--muted);">' + d.concepto + '</td>' +
    '<td style="font-family:DM Mono,monospace;font-size:11px;">' + (d.cuenta || '<span style="color:#e74c3c">—</span>') + '</td>' +
    '<td style="font-size:11px;">' + (d.banco || '—') + '</td>' +
    '<td style="font-family:DM Mono,monospace;font-size:12px;font-weight:600;text-align:right;">' + fmt(d.importe) + '</td>' +
    '</tr>'
  ).join('');
}

export function toggleAllDisp(v) {
  state.dispPagos.forEach(d => { if (d.tieneInfo) d.seleccionado = v; });
  renderModalDisp();
}

export function generarExcelBBVA() {
  if (!window.XLSX) { notify('Cargando librería, intenta en 2 segundos', 'error'); return; }
  const activos = state.dispPagos.filter(d => d.seleccionado && d.tieneInfo);
  if (!activos.length) { notify('Sin pagos con cuenta para generar', 'error'); return; }

  const cuentaCargo = document.getElementById('disp-cuenta-cargo').value;
  const fecha = new Date().toLocaleDateString('es-MX');
  const fechaFn = new Date().toISOString().split('T')[0].replace(/-/g, '');

  const interbancarios = activos.filter(d => getTipo(d.cuenta) === 'CLABE');
  const mismosBanco = activos.filter(d => getTipo(d.cuenta) !== 'CLABE' && d.cuenta);

  const wb = XLSX.utils.book_new();

  if (interbancarios.length) {
    const dataI = [
      ['Numero de Registros==>>', '', interbancarios.length],
      ['Importe Total========>>', '', parseFloat(interbancarios.reduce((s, d) => s + d.importe, 0).toFixed(2))],
      [],
      ['CUENTA CARGO', 'CUENTA CLABE / TARJETA  ABONO', 'IMPORTE', 'TITULAR', 'MOTIVO PAGO', 'REF_NUMERICA']
    ];
    interbancarios.forEach(d => { dataI.push([cuentaCargo, d.cuenta, d.importe, d.nombre, d.concepto, '']); });
    const wsI = XLSX.utils.aoa_to_sheet(dataI);
    XLSX.utils.book_append_sheet(wb, wsI, 'Pagos Interbancarios');
  }

  if (mismosBanco.length) {
    const dataMB = [
      ['Numero de Registros==>>', '', mismosBanco.length],
      ['Importe Total =======>>', '', parseFloat(mismosBanco.reduce((s, d) => s + d.importe, 0).toFixed(2))],
      [],
      ['CUENTA CARGO', 'CUENTA / TARJETA ABONO', 'MONEDA', 'IMPORTE', 'MOTIVO PAGO']
    ];
    mismosBanco.forEach(d => { dataMB.push([cuentaCargo, d.cuenta, 'MXP', d.importe, d.concepto]); });
    const wsMB = XLSX.utils.aoa_to_sheet(dataMB);
    XLSX.utils.book_append_sheet(wb, wsMB, 'Pagos Mismo Banco');
  }

  if (!wb.SheetNames.length) { notify('Sin pagos para generar', 'error'); return; }

  XLSX.writeFile(wb, 'Dispersion_BBVA_' + fechaFn + '.xlsx');
  notify('✅ Excel generado: Dispersion_BBVA_' + fechaFn + '.xlsx');

  state.pendientesConfirmacion = [...activos.map(d => Object.assign({}, d, { fechaGen: fecha }))];
  cerrar('modal-dispersion');
  setTimeout(() => { abrirModalConfirmarPagos(); }, 700);
}

export function enviarADispersion() { abrirModalDispersion(); }

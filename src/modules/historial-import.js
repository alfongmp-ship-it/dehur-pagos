// Importar historial desde Excel.
// Plantilla .xlsx con firma, drop-zone, preview con seleccion fila a fila,
// deteccion de duplicados, validacion contra catalogos. Append puro a
// state.historial[] + gsSaveHistorial al confirmar.

import { state } from '../state.js';
import { notify } from '../ui/notify.js';
import { fmt } from '../ui/format.js';
import { proyectoMatch } from '../config/proyectos.js';
import { parseFechaHist } from './historial.js';
import { gsSaveHistorial, ensureHistorialIds } from '../services/google-sync.js';
import { getPartidasParaSelect } from '../config/sub-partidas.js';

const HEADER_ID = 'DEHUR — Importar Historial';
const TIPOS_VALIDOS = ['Pago', 'Traspaso', 'Crédito'];

// Orden de columnas en la plantilla = mismo orden que el Sheet historial_pagos
// (sin la columna `id`, que generamos automaticamente). Permite copy-paste
// directo entre Sheet y plantilla.
const COLS = [
  'Proveedor ID',
  'Factura ID',
  'Fecha (DD/MM/YYYY)',
  'Beneficiario',
  'Banco',
  'Tipo cuenta',
  'Concepto',
  'Importe',
  'Proyecto',
  'Cuenta origen',
  'Tipo movimiento',
  'Partida',
  'Sub-partida'
];

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

// ===== Descarga de plantilla =====
export function descargarPlantillaHistorial() {
  if (!window.XLSX) { notify('Cargando libreria XLSX, intenta en 2 segundos', 'error'); return; }
  const XLSX = window.XLSX;
  const fechaTxt = new Date().toISOString().split('T')[0];
  const proyectosActivos = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
  const partidasOpts = getPartidasParaSelect([...new Set(state.historial.map(h => h.partida).filter(Boolean))]);
  const partidasNombres = partidasOpts.map(o => o.value);
  const cuentas = (state.cuentasPropias || []).map(c => c.nombre).concat(proyectosActivos);

  // Hoja 1: Historial (la que se sube de regreso)
  const titulo = [`${HEADER_ID}`];
  const meta = [`Generado: ${fechaTxt} · Proyectos activos: ${proyectosActivos.length} · Partidas catalogo: ${partidasNombres.length} — borra las filas de ejemplo antes de subir`];
  const headers = COLS.slice();
  // Ejemplos en el MISMO orden que COLS (= orden del Sheet historial_pagos):
  // Proveedor ID, Factura ID, Fecha, Beneficiario, Banco, Tipo cuenta, Concepto,
  // Importe, Proyecto, Cuenta origen, Tipo movimiento, Partida, Sub-partida
  const ejemplos = [
    ['', '', '01/01/2025', 'Proveedor de Ejemplo S.A.', 'BBVA', 'CLABE', 'Pago de factura A-123', 12500.50, proyectosActivos[0] || 'Paraiso', cuentas[0] || 'Paraiso', 'Pago', partidasNombres[0] || 'CONSTRUCCION', ''],
    ['', '', '15/01/2025', 'Traspaso interno', 'BBVA', 'Cuenta BBVA', 'Aportacion entre cuentas propias', 50000, '', cuentas[0] || 'DT', 'Traspaso', '', ''],
    ['', '', '20/01/2025', 'Empleado Ejemplo', 'BBVA', 'CLABE', 'Pago nomina enero', 8500, proyectosActivos[0] || 'Paraiso', cuentas[0] || 'Paraiso', 'Pago', 'NOMINA', '']
  ];
  const data = [titulo, meta, headers, ...ejemplos];
  const ws = XLSX.utils.aoa_to_sheet(data);
  // Anchos en el orden de COLS
  ws['!cols'] = [
    { wch: 12 }, // Proveedor ID
    { wch: 12 }, // Factura ID
    { wch: 18 }, // Fecha
    { wch: 28 }, // Beneficiario
    { wch: 10 }, // Banco
    { wch: 12 }, // Tipo cuenta
    { wch: 32 }, // Concepto
    { wch: 12 }, // Importe
    { wch: 18 }, // Proyecto
    { wch: 18 }, // Cuenta origen
    { wch: 16 }, // Tipo movimiento
    { wch: 18 }, // Partida
    { wch: 18 }  // Sub-partida
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 3 };

  // Hoja 2: Referencia
  const refData = [
    ['Referencia — usa estos valores exactos en la hoja Historial'],
    [],
    ['Proyectos activos', '', 'Partidas catalogo', '', 'Tipos validos', '', 'Cuentas conocidas'],
  ];
  const maxFilas = Math.max(proyectosActivos.length, partidasNombres.length, TIPOS_VALIDOS.length, cuentas.length, 1);
  for (let i = 0; i < maxFilas; i++) {
    refData.push([
      proyectosActivos[i] || '',
      '',
      partidasNombres[i] || '',
      '',
      TIPOS_VALIDOS[i] || '',
      '',
      cuentas[i] || ''
    ]);
  }
  const wsRef = XLSX.utils.aoa_to_sheet(refData);
  wsRef['!cols'] = [{ wch: 22 }, { wch: 2 }, { wch: 22 }, { wch: 2 }, { wch: 16 }, { wch: 2 }, { wch: 22 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Historial');
  XLSX.utils.book_append_sheet(wb, wsRef, 'Referencia');

  const fn = `Plantilla_Importar_Historial_${fechaTxt.replace(/-/g, '')}.xlsx`;
  XLSX.writeFile(wb, fn);
  notify(`Plantilla descargada — ${proyectosActivos.length} proyectos, ${partidasNombres.length} partidas de referencia`, 'success');
}

// ===== Apertura del modal =====
export function abrirImportHistorial() {
  if (!state.gsToken) { notify('Conecta Google Sheets primero', 'error'); return; }
  const m = document.getElementById('modal-import-hist');
  if (!m) return;
  // Reset estados
  document.getElementById('imp-hist-dropzone-wrap').style.display = '';
  document.getElementById('imp-hist-preview').style.display = 'none';
  const fileInput = document.getElementById('imp-hist-file');
  if (fileInput) fileInput.value = '';
  m.classList.add('open');
}

export function cerrarImportHistorial() {
  const m = document.getElementById('modal-import-hist');
  if (m) m.classList.remove('open');
  state._importHistorial = null;
}

// ===== Recepcion de archivo (drop o input) =====
export function handleHistorialFile(file) {
  if (!file) return;
  if (!window.XLSX) { notify('Cargando libreria XLSX, intenta en 2 segundos', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = window.XLSX.read(new Uint8Array(ev.target.result), { type: 'array', cellDates: false });
      procesarLibro(wb);
    } catch (e) {
      console.error('handleHistorialFile error', e);
      notify('Error leyendo el archivo: ' + e.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

export function handleHistorialDrop(ev) {
  ev.preventDefault();
  const dz = document.getElementById('imp-hist-dropzone');
  if (dz) { dz.style.borderColor = 'var(--border)'; dz.style.background = 'var(--surface)'; }
  const f = ev.dataTransfer?.files?.[0];
  if (f) handleHistorialFile(f);
}

function procesarLibro(wb) {
  const XLSX = window.XLSX;
  const hoja = wb.Sheets['Historial'] || wb.Sheets[wb.SheetNames[0]];
  if (!hoja) { notify('El archivo no tiene hojas', 'error'); return; }
  const rows = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });
  const titulo = String(rows[0]?.[0] || '');
  if (!titulo.startsWith(HEADER_ID)) {
    notify('Este archivo no es la plantilla Dehur de Importar Historial. Descarga la plantilla primero.', 'error');
    return;
  }
  const headers = (rows[2] || []).map(h => String(h || '').trim());
  // Validacion suave de headers (solo avisamos si el primer header no parece nuestro)
  if (!headers[0] || !headers[0].toLowerCase().includes('fecha')) {
    notify('La estructura de headers no coincide con la plantilla', 'error');
    return;
  }

  const resultado = parsearFilas(rows.slice(3));
  state._importHistorial = resultado;
  mostrarPreview(resultado);
}

// ===== Parseo de filas =====
function excelSerialADate(n) {
  // Excel serial: dias desde 1900-01-01 (con bug del leap year). 25569 = dias a 1970-01-01.
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d;
}

function normalizarFecha(raw) {
  if (raw === '' || raw === null || raw === undefined) return '';
  // Numero (serial Excel)
  if (typeof raw === 'number' && isFinite(raw)) {
    const d = excelSerialADate(raw);
    if (!d) return '';
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
  const s = String(raw).trim();
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  // DD/MM/YYYY o DD/MM/YY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${d.padStart(2, '0')}/${mo.padStart(2, '0')}/${y}`;
  }
  return '';
}

function fechaIsoDeDdmmyyyy(fechaDdmmyyyy) {
  return parseFechaHist(fechaDdmmyyyy);
}

function buildSetCuentas() {
  const set = new Set();
  (state.cuentasPropias || []).forEach(c => set.add(norm(c.nombre)));
  state.proyectos.forEach(p => set.add(norm(p.nombre)));
  state.historial.forEach(h => { if (h.cuenta_origen) set.add(norm(h.cuenta_origen)); });
  return set;
}

function buildIndiceProyectos() {
  return state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
}

function buildSetPartidas() {
  const opts = getPartidasParaSelect([...new Set(state.historial.map(h => h.partida).filter(Boolean))]);
  return new Set(opts.map(o => norm(o.value)));
}

function buildHistorialKeyset() {
  // Clave: fechaISO|importe|nombre|cuenta_origen — para deteccion de duplicados
  const k = new Set();
  state.historial.forEach(h => {
    const iso = parseFechaHist(h.fecha);
    const imp = (+h.importe || 0).toFixed(2);
    k.add(`${iso}|${imp}|${norm(h.nombre)}|${norm(h.cuenta_origen)}`);
  });
  return k;
}

function parsearFilas(filas) {
  const validos = [];
  const omitidos = [];
  const duplicados = [];
  const avisosSet = new Set();

  const proyectosActivos = buildIndiceProyectos();
  const setPartidas = buildSetPartidas();
  const setCuentas = buildSetCuentas();
  const histKeys = buildHistorialKeyset();
  // Llaves dentro de la misma importacion para evitar duplicados internos
  const importKeys = new Set();

  filas.forEach((row, idx) => {
    const numeroFila = idx + 4; // 1-based en el Excel (3 filas de cabecera)
    // Indices alineados con COLS = orden del Sheet historial_pagos
    const proveedorId = String(row[0] || '').trim();
    const facturaId = String(row[1] || '').trim();
    const fechaRaw = row[2];
    const beneficiario = String(row[3] || '').trim();
    const banco = String(row[4] || '').trim() || 'BBVA';
    const tipoCuenta = String(row[5] || '').trim();
    const concepto = String(row[6] || '').trim();
    const importeRaw = row[7];
    const proyecto = String(row[8] || '').trim();
    const cuentaOrigen = String(row[9] || '').trim();
    const tipoMov = String(row[10] || '').trim() || 'Pago';
    const partida = String(row[11] || '').trim();
    const subPartida = String(row[12] || '').trim();
    const tipoCuentaFinal = tipoCuenta || (cuentaOrigen ? 'CLABE' : '');

    // Fila completamente vacia → ignorar silencioso
    const todoVacio = !fechaRaw && !beneficiario && !concepto && !importeRaw && !proyecto && !cuentaOrigen;
    if (todoVacio) return;

    // Importe
    let importe = 0;
    if (typeof importeRaw === 'number') importe = importeRaw;
    else importe = parseFloat(String(importeRaw || '').replace(/[$,\s]/g, ''));
    if (!isFinite(importe) || importe <= 0) {
      omitidos.push({ numeroFila, razon: 'Importe invalido o cero', raw: { fechaRaw, beneficiario, importeRaw } });
      return;
    }

    // Fecha
    const fecha = normalizarFecha(fechaRaw);
    if (!fecha) {
      omitidos.push({ numeroFila, razon: 'Fecha vacia o no parseable', raw: { fechaRaw, beneficiario, importeRaw } });
      return;
    }

    // Beneficiario
    if (!beneficiario) {
      omitidos.push({ numeroFila, razon: 'Beneficiario requerido', raw: { fechaRaw, beneficiario, importeRaw } });
      return;
    }

    // Tipo movimiento
    if (!TIPOS_VALIDOS.includes(tipoMov)) {
      omitidos.push({ numeroFila, razon: `Tipo movimiento invalido: "${tipoMov}" (validos: ${TIPOS_VALIDOS.join(', ')})`, raw: { fechaRaw, beneficiario, importeRaw } });
      return;
    }

    // Avisos (no bloquean)
    const avisosFila = [];
    if (proyecto) {
      const proyectoConocido = proyectosActivos.some(p => proyectoMatch(p, proyecto) || norm(p) === norm(proyecto));
      if (!proyectoConocido) {
        const msg = `Proyecto "${proyecto}" no esta en catalogo activo`;
        avisosFila.push(msg); avisosSet.add(msg);
      }
    }
    if (!cuentaOrigen) {
      const msg = 'Sin cuenta origen — no aparecera en Flujo de Salida';
      avisosFila.push(msg); avisosSet.add(msg);
    } else if (!setCuentas.has(norm(cuentaOrigen))) {
      const msg = `Cuenta "${cuentaOrigen}" no esta en cuentas conocidas`;
      avisosFila.push(msg); avisosSet.add(msg);
    }
    if (partida && !setPartidas.has(norm(partida))) {
      const msg = `Partida "${partida}" no esta en catalogo`;
      avisosFila.push(msg); avisosSet.add(msg);
    }

    // Construir registro al estilo state.historial
    const registro = {
      fecha,
      nombre: beneficiario,
      concepto,
      importe: Math.round(importe * 100) / 100,
      proyecto,
      banco,
      tipo: tipoCuentaFinal,
      proveedor_id: proveedorId,
      factura_id: facturaId,
      cuenta_origen: cuentaOrigen,
      tipo_registro: tipoMov,
      partida,
      sub_partida: subPartida
    };

    // Duplicado vs historial actual o dentro del mismo import
    const iso = fechaIsoDeDdmmyyyy(fecha);
    const key = `${iso}|${importe.toFixed(2)}|${norm(beneficiario)}|${norm(cuentaOrigen)}`;
    const esDup = histKeys.has(key) || importKeys.has(key);
    importKeys.add(key);

    const item = { numeroFila, registro, avisos: avisosFila, key };
    if (esDup) duplicados.push(item);
    else validos.push(item);
  });

  return { validos, omitidos, duplicados, avisosUnicos: [...avisosSet] };
}

// ===== Preview =====
function rowHtml(item, idx, prefix, defaultChecked) {
  const r = item.registro;
  const avisos = item.avisos?.length ? `<div style="font-size:10px;color:#e07a3a;margin-top:2px;">⚠ ${item.avisos.join(' · ')}</div>` : '';
  return `<div style="display:grid;grid-template-columns:32px 80px 1fr 1fr 100px 120px 100px 100px;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border);align-items:center;font-size:11px;">
    <div><input type="checkbox" data-${prefix}="${idx}" ${defaultChecked ? 'checked' : ''} onchange="window.fsImportRefreshTotales()"></div>
    <div style="font-family:'DM Mono',monospace;">${r.fecha}</div>
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(r.nombre)}">${escHtml(r.nombre)}${avisos}</div>
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);" title="${escAttr(r.concepto)}">${escHtml(r.concepto)}</div>
    <div style="font-family:'DM Mono',monospace;text-align:right;color:var(--accent);">${fmt(r.importe)}</div>
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(r.cuenta_origen)}">${escHtml(r.cuenta_origen || '—')}</div>
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(r.proyecto)}">${escHtml(r.proyecto || '—')}</div>
    <div style="font-size:10px;">${escHtml(r.tipo_registro)}</div>
  </div>`;
}

function headerHtml() {
  return `<div style="display:grid;grid-template-columns:32px 80px 1fr 1fr 100px 120px 100px 100px;gap:8px;padding:8px 10px;background:var(--surface2);border-bottom:1px solid var(--border);font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">
    <div></div><div>Fecha</div><div>Beneficiario</div><div>Concepto</div><div style="text-align:right;">Importe</div><div>Cuenta</div><div>Proyecto</div><div>Tipo</div>
  </div>`;
}

function mostrarPreview(res) {
  document.getElementById('imp-hist-dropzone-wrap').style.display = 'none';
  document.getElementById('imp-hist-preview').style.display = '';

  const resumen = document.getElementById('imp-hist-resumen');
  resumen.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;">
      <div class="stat-card"><div class="stat-label">Validos</div><div class="stat-value" style="color:var(--green);">${res.validos.length}</div></div>
      <div class="stat-card"><div class="stat-label">Duplicados sospechosos</div><div class="stat-value" style="color:#e07a3a;">${res.duplicados.length}</div></div>
      <div class="stat-card"><div class="stat-label">Omitidos</div><div class="stat-value" style="color:var(--muted);">${res.omitidos.length}</div></div>
    </div>
    ${res.avisosUnicos.length ? `<div style="background:rgba(224,122,58,.08);border:1px solid rgba(224,122,58,.25);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:11px;">
      <div style="font-weight:600;margin-bottom:4px;">⚠ Avisos (no bloquean):</div>
      <ul style="margin:0;padding-left:18px;color:var(--muted);">${res.avisosUnicos.map(a => `<li>${escHtml(a)}</li>`).join('')}</ul>
    </div>` : ''}
  `;

  const cont = document.getElementById('imp-hist-validos');
  if (res.validos.length) {
    cont.innerHTML = `<div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:6px;letter-spacing:.06em;">Filas validas (se importan por default)</div>
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:320px;overflow-y:auto;">
        ${headerHtml()}
        ${res.validos.map((it, i) => rowHtml(it, i, 'val', true)).join('')}
      </div>`;
  } else {
    cont.innerHTML = `<div class="empty-state" style="padding:20px;"><div>No hay filas validas en el archivo</div></div>`;
  }

  const dups = document.getElementById('imp-hist-duplicados');
  if (res.duplicados.length) {
    dups.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">Estas filas parecen ya existir en historial (misma fecha + importe + beneficiario + cuenta). Marca solo las que quieras forzar.</div>
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:220px;overflow-y:auto;">
        ${headerHtml()}
        ${res.duplicados.map((it, i) => rowHtml(it, i, 'dup', false)).join('')}
      </div>`;
  } else {
    dups.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px;">Ningun duplicado detectado.</div>';
  }

  const om = document.getElementById('imp-hist-omitidos');
  if (res.omitidos.length) {
    om.innerHTML = `<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:200px;overflow-y:auto;">
      ${res.omitidos.map(o => `<div style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:11px;">
        <span style="color:var(--muted);font-family:'DM Mono',monospace;">Fila ${o.numeroFila}</span>
        · <span style="color:#e05a5a;">${escHtml(o.razon)}</span>
        ${o.raw?.beneficiario ? `· <span style="color:var(--muted);">${escHtml(o.raw.beneficiario)}</span>` : ''}
      </div>`).join('')}
    </div>`;
  } else {
    om.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px;">Ninguna omision.</div>';
  }

  fsImportRefreshTotales();
}

export function fsImportRefreshTotales() {
  const res = state._importHistorial;
  if (!res) return;
  const validosSel = countChecked('val', res.validos.length);
  const dupsSel = countChecked('dup', res.duplicados.length);
  const total = validosSel + dupsSel;
  const monto = sumarSeleccionado(res);
  const btn = document.getElementById('imp-hist-confirmar');
  if (btn) {
    btn.disabled = total === 0;
    btn.textContent = total === 0 ? 'Importar (nada seleccionado)' : `Importar ${total} fila${total === 1 ? '' : 's'} · ${fmt(monto)}`;
  }
}

function countChecked(prefix, max) {
  let c = 0;
  for (let i = 0; i < max; i++) {
    if (document.querySelector(`[data-${prefix}="${i}"]`)?.checked) c++;
  }
  return c;
}

function sumarSeleccionado(res) {
  let s = 0;
  res.validos.forEach((it, i) => {
    if (document.querySelector(`[data-val="${i}"]`)?.checked) s += +it.registro.importe || 0;
  });
  res.duplicados.forEach((it, i) => {
    if (document.querySelector(`[data-dup="${i}"]`)?.checked) s += +it.registro.importe || 0;
  });
  return s;
}

// ===== Confirmacion =====
export async function confirmarImportHistorial() {
  const res = state._importHistorial;
  if (!res) return;
  const aImportar = [];
  res.validos.forEach((it, i) => {
    if (document.querySelector(`[data-val="${i}"]`)?.checked) aImportar.push(it.registro);
  });
  res.duplicados.forEach((it, i) => {
    if (document.querySelector(`[data-dup="${i}"]`)?.checked) aImportar.push(it.registro);
  });
  if (!aImportar.length) { notify('No hay filas seleccionadas', 'error'); return; }

  // Insertar al inicio en orden inverso para mantener orden cronologico de plantilla
  for (let i = aImportar.length - 1; i >= 0; i--) {
    state.historial.unshift(aImportar[i]);
  }
  ensureHistorialIds();

  const cntHist = document.getElementById('cnt-hist');
  if (cntHist) cntHist.textContent = state.historial.length;

  notify(`Importando ${aImportar.length} registro${aImportar.length === 1 ? '' : 's'}...`);
  try {
    await gsSaveHistorial();
    notify(`✓ Importados ${aImportar.length} registros al historial`, 'success');
  } catch (e) {
    console.error('confirmarImportHistorial save error', e);
    notify('Importacion local OK, pero hubo error al guardar a Sheets: ' + e.message, 'error');
  }

  cerrarImportHistorial();
  if (window.renderHistorial) window.renderHistorial();
  if (window.renderFlujoSalida) window.renderFlujoSalida();
  if (window.renderResumenCostos) window.renderResumenCostos();
}

// ===== Utils =====
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) { return escHtml(s); }

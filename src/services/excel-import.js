// Framework generico para importar datos desde Excel.
// Cada modulo provee una config con sus columnas, validacion, dedupe e insercion.
// El framework se encarga del modal, drop-zone, parse, preview, totales y commit.

import { state, puedeEditar, puedeFacturas } from '../state.js';
import { notify } from '../ui/notify.js';
import { fmt } from '../ui/format.js';

// Importer activo (uno a la vez — el modal es generico). Lo guardamos para
// que los handlers de checkbox/confirmar/cerrar sepan a quien le hablan.
let activeImporter = null;
let parsedResult = null;

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ===== Helpers de fecha (re-utilizables por configs) =====
export function excelSerialADate(n) {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d;
}

export function normalizarFechaDDMMYYYY(raw) {
  if (raw === '' || raw === null || raw === undefined) return '';
  if (typeof raw === 'number' && isFinite(raw)) {
    const d = excelSerialADate(raw);
    if (!d) return '';
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${d.padStart(2, '0')}/${mo.padStart(2, '0')}/${y}`;
  }
  return '';
}

export function normalizarFechaISO(raw) {
  if (raw === '' || raw === null || raw === undefined) return '';
  if (typeof raw === 'number' && isFinite(raw)) {
    const d = excelSerialADate(raw);
    if (!d) return '';
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return '';
}

export function parseImporte(raw) {
  if (typeof raw === 'number') return raw;
  return parseFloat(String(raw || '').replace(/[$,\s]/g, ''));
}

// ===== Factory =====
export function createExcelImporter(config) {
  const {
    key,
    titulo,
    headerSignature,
    filenamePrefix = 'Plantilla',
    columns,
    referencia,
    ejemplos,
    validar,
    duplicateKey,
    existingKeyset,
    insertar,
    save,
    postCommit
  } = config;

  if (!key || !titulo || !headerSignature || !columns || !validar) {
    console.error('createExcelImporter: faltan campos requeridos en config', config);
    throw new Error('Config de import incompleta');
  }

  function descargarPlantilla() {
    if (!window.XLSX) { notify('Cargando libreria XLSX, intenta en 2 segundos', 'error'); return; }
    const XLSX = window.XLSX;
    const fechaTxt = new Date().toISOString().split('T')[0];

    const titleRow = [headerSignature];
    const metaRow = [`Generado: ${fechaTxt} — borra las filas de ejemplo antes de subir`];
    const headerRow = columns.map(c => c.label);
    const ejemplosRows = (ejemplos ? ejemplos() : []).map(ej => columns.map(c => ej[c.key] ?? ''));
    const data = [titleRow, metaRow, headerRow, ...ejemplosRows];

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = columns.map(c => ({ wch: c.width || 16 }));
    ws['!freeze'] = { xSplit: 0, ySplit: 3 };

    // Columnas marcadas como texto (ej. Fecha): forzar formato `@` para que Excel
    // NO auto-convierta lo que el usuario escriba. Sin esto, en locale US Excel
    // interpreta `11/5/2026` como 5-nov (MM/DD) y lo guarda como número de fecha,
    // y al leerlo la app obtiene la fecha volteada. Pre-sellamos filas vacías como
    // texto para que el formato aplique también a lo que se capture después.
    const FILAS_BUFFER = 500;
    const PRIMERA_FILA_DATOS = 3; // 0=titulo, 1=meta, 2=encabezado
    let hayTexto = false;
    columns.forEach((c, ci) => {
      if (!c.text) return;
      hayTexto = true;
      for (let r = PRIMERA_FILA_DATOS; r < PRIMERA_FILA_DATOS + FILAS_BUFFER; r++) {
        const ref = XLSX.utils.encode_cell({ r, c: ci });
        const prev = ws[ref];
        ws[ref] = { t: 's', v: prev && prev.v != null ? String(prev.v) : '', z: '@' };
      }
    });
    if (hayTexto) {
      const ultimaFila = PRIMERA_FILA_DATOS + FILAS_BUFFER - 1;
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: ultimaFila, c: Math.max(0, columns.length - 1) } });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');

    if (referencia) {
      const refConfig = referencia();
      const refTitulo = [`Referencia — usa estos valores en la hoja Datos`];
      const refHeaders = refConfig.map(g => g.header);
      const filas = [refTitulo, [], []];
      filas[2] = [];
      refConfig.forEach((g, i) => { filas[2][i * 2] = g.header; });
      const maxLen = Math.max(1, ...refConfig.map(g => g.valores.length));
      for (let i = 0; i < maxLen; i++) {
        const fila = [];
        refConfig.forEach((g, j) => { fila[j * 2] = g.valores[i] || ''; });
        filas.push(fila);
      }
      const wsRef = XLSX.utils.aoa_to_sheet(filas);
      wsRef['!cols'] = refConfig.flatMap(() => [{ wch: 22 }, { wch: 2 }]);
      XLSX.utils.book_append_sheet(wb, wsRef, 'Referencia');
    }

    const fn = `${filenamePrefix}_${fechaTxt.replace(/-/g, '')}.xlsx`;
    XLSX.writeFile(wb, fn);
    notify(`Plantilla "${titulo}" descargada`, 'success');
  }

  function abrir() {
    // Gate por ROL (no por Google): la app guarda sin Google desde Etapa 2. Permite
    // a quien puede editar (admin/capturista) y al rol 'facturas' (Gonzalo); deja
    // fuera a lector/contabilidad. Los botones por página (req-editor/req-facturas)
    // controlan además quién ve cada importador.
    if (!puedeEditar() && !puedeFacturas()) { notify('No tienes permiso para importar', 'error'); return; }
    activeImporter = api;
    parsedResult = null;

    document.getElementById('excel-import-titulo').textContent = titulo;
    document.getElementById('excel-import-dropzone-wrap').style.display = '';
    document.getElementById('excel-import-preview').style.display = 'none';
    const fi = document.getElementById('excel-import-file');
    if (fi) fi.value = '';

    document.getElementById('modal-excel-import').classList.add('open');
  }

  function cerrar() {
    document.getElementById('modal-excel-import').classList.remove('open');
    activeImporter = null;
    parsedResult = null;
  }

  function handleFile(file) {
    if (!file) return;
    if (activeImporter !== api) {
      // Si por alguna razon el modal abierto no es este, abrimos primero.
      abrir();
    }
    if (!window.XLSX) { notify('Cargando libreria XLSX, intenta en 2 segundos', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = window.XLSX.read(new Uint8Array(ev.target.result), { type: 'array', cellDates: false });
        procesarLibro(wb);
      } catch (e) {
        console.error(`[excel-import:${key}] error leyendo archivo`, e);
        notify('Error leyendo el archivo: ' + e.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleDrop(ev) {
    ev.preventDefault();
    const dz = document.getElementById('excel-import-dropzone');
    if (dz) { dz.style.borderColor = 'var(--border)'; dz.style.background = 'var(--surface)'; }
    const f = ev.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  }

  function procesarLibro(wb) {
    const XLSX = window.XLSX;
    // Buscamos la hoja "Datos" o la primera disponible
    const hoja = wb.Sheets['Datos'] || wb.Sheets[wb.SheetNames[0]];
    if (!hoja) { notify('El archivo no tiene hojas', 'error'); return; }
    const rows = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });
    const titulo0 = String(rows[0]?.[0] || '');
    if (!titulo0.startsWith(headerSignature)) {
      notify(`Este archivo no es la plantilla de "${config.titulo}". Descarga la plantilla correcta.`, 'error');
      return;
    }
    parsedResult = parsearFilas(rows.slice(3));
    // Bloqueo global opcional (p.ej. facturas: reparto mal escrito bloquea TODA la
    // carga hasta corregir el Excel). Si devuelve un mensaje, no se muestra preview.
    if (typeof config.bloqueoGlobal === 'function') {
      const bloqueo = config.bloqueoGlobal(parsedResult);
      if (bloqueo) { parsedResult = null; notify(bloqueo, 'error'); return; }
    }
    mostrarPreview(parsedResult);
  }

  function parsearFilas(filas) {
    const validos = [];
    const omitidos = [];
    const duplicados = [];
    const avisosSet = new Set();

    const ctx = {
      norm,
      proyectos: state.proyectos,
      proyectosActivos: state.proyectos.filter(p => p.activo !== false),
      cuentasPropias: state.cuentasPropias || [],
      historial: state.historial,
      proveedores: state.proveedores,
      empleados: state.empleados,
      traspasos: state.traspasos
    };
    const existingKeys = existingKeyset ? existingKeyset() : new Set();
    const importKeys = new Set();

    filas.forEach((row, idx) => {
      const numeroFila = idx + 4;
      // Construir objeto raw por key
      const raw = {};
      columns.forEach((c, i) => { raw[c.key] = row[i]; });
      // Saltar filas totalmente vacias
      const todoVacio = columns.every(c => raw[c.key] === '' || raw[c.key] === null || raw[c.key] === undefined);
      if (todoVacio) return;

      let res;
      try {
        res = validar(raw, ctx);
      } catch (e) {
        console.error(`[excel-import:${key}] validar() lanzo error en fila ${numeroFila}`, e);
        omitidos.push({ numeroFila, razon: 'Error de validacion: ' + e.message, raw });
        return;
      }

      if (res?.omit) {
        omitidos.push({ numeroFila, razon: res.omit, raw });
        return;
      }
      if (!res?.registro) {
        omitidos.push({ numeroFila, razon: 'Sin registro generado', raw });
        return;
      }

      (res.avisos || []).forEach(a => avisosSet.add(a));

      const dKey = duplicateKey ? duplicateKey(res.registro) : null;
      const esDup = !!(dKey && (existingKeys.has(dKey) || importKeys.has(dKey)));
      if (dKey) importKeys.add(dKey);

      const item = {
        numeroFila,
        registro: res.registro,
        avisos: res.avisos || [],
        rawPreview: res.preview || res.registro
      };
      if (esDup) duplicados.push(item);
      else validos.push(item);
    });

    return { validos, omitidos, duplicados, avisosUnicos: [...avisosSet] };
  }

  function mostrarPreview(res) {
    document.getElementById('excel-import-dropzone-wrap').style.display = 'none';
    document.getElementById('excel-import-preview').style.display = '';

    const previewCols = (config.previewColumns || []).length ? config.previewColumns : derivarPreviewColumns();
    const tplCols = '32px ' + previewCols.map(c => c.css || '1fr').join(' ');

    const resumen = document.getElementById('excel-import-resumen');
    resumen.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;">
        <div class="stat-card"><div class="stat-label">Validos</div><div class="stat-value" style="color:var(--green);">${res.validos.length}</div></div>
        <div class="stat-card"><div class="stat-label">Duplicados sospechosos</div><div class="stat-value" style="color:#e07a3a;">${res.duplicados.length}</div></div>
        <div class="stat-card"><div class="stat-label">Omitidos</div><div class="stat-value" style="color:var(--muted);">${res.omitidos.length}</div></div>
      </div>
      ${res.avisosUnicos.length ? `<div style="background:rgba(224,122,58,.08);border:1px solid rgba(224,122,58,.25);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:11px;">
        <div style="font-weight:600;margin-bottom:4px;">⚠ Avisos (no bloquean):</div>
        <ul style="margin:0;padding-left:18px;color:var(--muted);">${res.avisosUnicos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
      </div>` : ''}
    `;

    const headerHtml = `<div style="display:grid;grid-template-columns:${tplCols};gap:8px;padding:8px 10px;background:var(--surface2);border-bottom:1px solid var(--border);font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">
      <div></div>${previewCols.map(c => `<div style="${c.align === 'right' ? 'text-align:right;' : ''}">${esc(c.label)}</div>`).join('')}
    </div>`;

    function rowHtml(item, i, prefix, checked) {
      const r = item.rawPreview;
      const avisos = item.avisos?.length ? `<div style="font-size:10px;color:#e07a3a;margin-top:2px;">⚠ ${item.avisos.map(esc).join(' · ')}</div>` : '';
      const cellsHtml = previewCols.map((c, ci) => {
        const v = c.render ? c.render(r) : (r[c.key] ?? '');
        const isFirst = ci === 0;
        return `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${c.align === 'right' ? 'text-align:right;font-family:\'DM Mono\',monospace;' : ''}${c.style || ''}" title="${esc(String(v))}">${esc(String(v))}${isFirst ? avisos : ''}</div>`;
      }).join('');
      return `<div style="display:grid;grid-template-columns:${tplCols};gap:8px;padding:6px 10px;border-bottom:1px solid var(--border);align-items:center;font-size:11px;">
        <div><input type="checkbox" data-${prefix}="${i}" ${checked ? 'checked' : ''} onchange="window.excelImportRefreshTotales()"></div>
        ${cellsHtml}
      </div>`;
    }

    const cont = document.getElementById('excel-import-validos');
    cont.innerHTML = res.validos.length ? `
      <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:6px;letter-spacing:.06em;">Filas validas (default ON)</div>
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:340px;overflow-y:auto;">
        ${headerHtml}${res.validos.map((it, i) => rowHtml(it, i, 'val', true)).join('')}
      </div>` : `<div class="empty-state" style="padding:20px;"><div>No hay filas validas en el archivo</div></div>`;

    const dups = document.getElementById('excel-import-duplicados');
    dups.innerHTML = res.duplicados.length ? `
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">Estas filas parecen ya existir. Marca solo las que quieras forzar.</div>
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:220px;overflow-y:auto;">
        ${headerHtml}${res.duplicados.map((it, i) => rowHtml(it, i, 'dup', false)).join('')}
      </div>` : '<div style="font-size:11px;color:var(--muted);padding:8px;">Ningun duplicado detectado.</div>';

    const om = document.getElementById('excel-import-omitidos');
    om.innerHTML = res.omitidos.length ? `<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:220px;overflow-y:auto;">
      ${res.omitidos.map(o => `<div style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:11px;">
        <span style="color:var(--muted);font-family:'DM Mono',monospace;">Fila ${o.numeroFila}</span> · <span style="color:#e05a5a;">${esc(o.razon)}</span>
      </div>`).join('')}
    </div>` : '<div style="font-size:11px;color:var(--muted);padding:8px;">Ninguna omision.</div>';

    refreshTotales();
  }

  function derivarPreviewColumns() {
    // Si la config no tiene previewColumns, mostramos las primeras 6 columnas.
    return columns.slice(0, 6).map(c => ({ key: c.key, label: c.label, css: '1fr', align: c.align }));
  }

  function refreshTotales() {
    if (!parsedResult) return;
    const v = countChecked('val', parsedResult.validos.length);
    const d = countChecked('dup', parsedResult.duplicados.length);
    const total = v + d;
    const monto = sumarImporte(parsedResult);
    const btn = document.getElementById('excel-import-confirmar');
    if (btn) {
      btn.disabled = total === 0;
      const sufijo = monto > 0 ? ` · ${fmt(monto)}` : '';
      btn.textContent = total === 0 ? 'Importar (nada seleccionado)' : `Importar ${total} fila${total === 1 ? '' : 's'}${sufijo}`;
    }
  }

  function sumarImporte(res) {
    // Suma el campo `importe` o `monto` si existe
    let s = 0;
    res.validos.forEach((it, i) => {
      if (document.querySelector(`[data-val="${i}"]`)?.checked) {
        const v = it.registro.importe ?? it.registro.monto ?? 0;
        s += +v || 0;
      }
    });
    res.duplicados.forEach((it, i) => {
      if (document.querySelector(`[data-dup="${i}"]`)?.checked) {
        const v = it.registro.importe ?? it.registro.monto ?? 0;
        s += +v || 0;
      }
    });
    return s;
  }

  async function confirmar() {
    if (!parsedResult) return;
    const aImportar = [];
    parsedResult.validos.forEach((it, i) => {
      if (document.querySelector(`[data-val="${i}"]`)?.checked) aImportar.push(it.registro);
    });
    parsedResult.duplicados.forEach((it, i) => {
      if (document.querySelector(`[data-dup="${i}"]`)?.checked) aImportar.push(it.registro);
    });
    if (!aImportar.length) { notify('No hay filas seleccionadas', 'error'); return; }

    try {
      insertar(aImportar);
    } catch (e) {
      console.error(`[excel-import:${key}] insertar() fallo`, e);
      notify('Error insertando registros: ' + e.message, 'error');
      return;
    }

    notify(`Importando ${aImportar.length} registro${aImportar.length === 1 ? '' : 's'}...`);
    try {
      if (save) await save(aImportar);
      notify(`✓ Importados ${aImportar.length} a "${titulo}"`, 'success');
    } catch (e) {
      console.error(`[excel-import:${key}] save() fallo`, e);
      notify('Importacion local OK, pero hubo error al guardar a Sheets: ' + e.message, 'error');
    }

    cerrar();
    if (postCommit) {
      try { postCommit(aImportar); } catch (e) { console.error(`[excel-import:${key}] postCommit fallo`, e); }
    }
  }

  const api = {
    key,
    descargarPlantilla,
    abrir,
    cerrar,
    handleFile,
    handleDrop,
    confirmar
  };
  return api;
}

// ===== Helpers expuestos al window (compartidos entre todos los importers) =====
function countChecked(prefix, max) {
  let c = 0;
  for (let i = 0; i < max; i++) {
    if (document.querySelector(`[data-${prefix}="${i}"]`)?.checked) c++;
  }
  return c;
}

// Llamado por el onchange de cada checkbox. Re-evalua totales del importer activo.
export function excelImportRefreshTotales() {
  if (!activeImporter || !parsedResult) return;
  const v = countChecked('val', parsedResult.validos.length);
  const d = countChecked('dup', parsedResult.duplicados.length);
  const total = v + d;
  let monto = 0;
  parsedResult.validos.forEach((it, i) => {
    if (document.querySelector(`[data-val="${i}"]`)?.checked) monto += +(it.registro.importe ?? it.registro.monto ?? 0) || 0;
  });
  parsedResult.duplicados.forEach((it, i) => {
    if (document.querySelector(`[data-dup="${i}"]`)?.checked) monto += +(it.registro.importe ?? it.registro.monto ?? 0) || 0;
  });
  const btn = document.getElementById('excel-import-confirmar');
  if (btn) {
    btn.disabled = total === 0;
    const sufijo = monto > 0 ? ` · ${fmt(monto)}` : '';
    btn.textContent = total === 0 ? 'Importar (nada seleccionado)' : `Importar ${total} fila${total === 1 ? '' : 's'}${sufijo}`;
  }
}

// Handlers globales del modal generico — siempre delegan al importer activo.
export function excelImportConfirmar() {
  if (activeImporter) activeImporter.confirmar();
}
export function excelImportCerrar() {
  if (activeImporter) activeImporter.cerrar();
  else document.getElementById('modal-excel-import')?.classList.remove('open');
}
export function excelImportHandleDrop(ev) {
  if (activeImporter) activeImporter.handleDrop(ev);
}
export function excelImportHandleFile(file) {
  if (activeImporter) activeImporter.handleFile(file);
}
export function excelImportDescargarPlantilla() {
  if (activeImporter) activeImporter.descargarPlantilla();
}

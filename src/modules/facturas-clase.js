// ============================================================================
// 🏷 Clase de costo de las facturas (Directo / Indirecto de obra). Solo admin.
// Facturas → "📥 Subir clase de costo": lee el reporte de contabilidad tal cual
// (o un Excel sencillo UUID + Clase) con el motor puro services/clase-costo.js,
// descarga una VISTA PREVIA en Excel, pide confirmar y guarda en lotes en la
// tabla aparte `factura_clase` (SQL 47). Solo toca la clase y la cuenta contable
// de cada factura: ningún monto, partida, proyecto ni reparto.
// ============================================================================
import { state, esAdmin } from '../state.js';
import { fmtFecha, escapeHtml } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { proyectoMatch } from '../config/proyectos.js';
import { sbUpsertRows, sbDeleteRows } from '../services/supabase-data.js';
import { leerReporteClase, emparejarClase, planClase } from '../services/clase-costo.js';

export const CLASE_LABEL = { directo: 'Directo de obra', indirecto: 'Indirecto de obra' };
const MSG_SQL47 = 'Falta correr el SQL 47 (clase de costo) en Supabase: sin él no se puede guardar la clase de las facturas.';

export function claseListo() { return !!(state.cargado && state.cargado.facturaClase === true); }

// Clase guardada de una factura (o null = sin clasificar). Map memoizado por arreglo y largo.
let _mapa = null, _ref = null, _len = -1;
export function claseDeFactura(facturaId) {
  const arr = state.facturaClase || [];
  if (_ref !== arr || _len !== arr.length) {
    _mapa = new Map(arr.map(c => [String(c.factura_id), c]));
    _ref = arr; _len = arr.length;
  }
  return _mapa.get(String(facturaId)) || null;
}

// ID más alto con clase guardada. Las facturas NUEVAS se numeran por encima de él:
// si se borra la última factura, la que se cree después NO hereda su clase.
export function maxIdConClase() {
  return (state.facturaClase || []).reduce((mx, c) => Math.max(mx, Number(c.factura_id) || 0), 0);
}

// Guarda clases en lotes de 100 y actualiza la memoria lote por lote (si se corta a
// media corrida, lo ya guardado queda bien en los dos lados).
//   filas: [{ factura_id, clase, cuenta_contable, fuente, lote }]
export async function guardarClases(filas, onProgress) {
  const usuario = (state.session && state.session.email) || '';
  const ahora = new Date().toISOString();
  const rows = filas.map(x => ({
    factura_id: String(x.factura_id), clase: x.clase, cuenta_contable: x.cuenta_contable || '',
    fuente: x.fuente || 'manual', lote: x.lote || '', usuario, actualizado: ahora,
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const lote = rows.slice(i, i + 100);
    await sbUpsertRows('factura_clase', 'factura_id', lote);
    lote.forEach(r => {
      const ex = claseDeFactura(r.factura_id);
      if (ex) Object.assign(ex, r); else state.facturaClase.push({ ...r });
    });
    if (onProgress) onProgress(Math.min(i + 100, rows.length), rows.length);
  }
}

// Quita la clase (la factura queda "sin clasificar").
export async function quitarClases(facturaIds) {
  const ids = facturaIds.map(String);
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    await sbDeleteRows('factura_clase', 'factura_id', lote);
    const fuera = new Set(lote);
    state.facturaClase = (state.facturaClase || []).filter(c => !fuera.has(String(c.factura_id)));
  }
}

// 'EU' → proyecto de Entorno; 'PP' → Privada del Paraíso (según el nombre en la app).
function _proyectoDeCodigo(codigo) {
  const busca = codigo === 'EU' ? 'entorno' : codigo === 'PP' ? 'paraiso' : '';
  if (!busca) return '';
  const p = (state.proyectos || []).find(x => String(x.nombre || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(busca));
  return p ? p.nombre : '';
}

function _sello() {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return { txt: `${fmtFecha(iso)} ${p2(d.getHours())}:${p2(d.getMinutes())}`, archivo: `${iso}_${p2(d.getHours())}${p2(d.getMinutes())}` };
}

// Aviso flotante de avance mientras se guarda.
function _progreso(txt) {
  let el = document.getElementById('clase-progreso-flotante');
  if (txt == null) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'clase-progreso-flotante';
    el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#1a1a1a;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.3);';
    document.body.appendChild(el);
  }
  el.textContent = txt;
}

// ---------- Excel de vista previa (antes de aplicar) ----------
function _excelVistaPrevia(nombreArchivo, lect, m, plan, sello) {
  const wb = XLSX.utils.book_new();
  const money = (ws, aoa, cols, desde) => {
    for (let r = desde; r < aoa.length; r++) cols.forEach(c => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00';
    });
  };
  const hoja = (nombre, aoa, anchos, cMoney = []) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = anchos.map(w => ({ wch: w }));
    if (cMoney.length) money(ws, aoa, cMoney, 1);
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  };
  const lbl = c => CLASE_LABEL[c] || c || '';
  const fFac = f => [String(f.factura_id), f.numero_factura || '', f.uuid || '', f.nombre_proveedor || f.razon_social || '',
    fmtFecha(f.fecha_factura) || '', f.monto_total || 0, f.proyecto || ''];
  const encFac = ['Factura (ID)', 'Folio', 'UUID en la app', 'Proveedor', 'Fecha', 'Total neto', 'Proyecto en la app'];

  const dir = lect.registros.filter(r => r.clase === 'directo').length;
  const ind = lect.registros.length - dir;
  const sinSeccion = lect.avisos.filter(a => a.uuid).length;
  const resumen = [
    [`Clase de costo — vista previa de "${nombreArchivo}"`],
    [`Corte: ${sello.txt} · Solo cambia la CLASE (Directo / Indirecto de obra) y la cuenta contable de cada factura: nada más.`],
    [],
    ['En el archivo', lect.registros.length, `${dir} directas · ${ind} indirectas`],
    ['Se marcan (no tenían clase)', plan.nuevas.length],
    ['Cambian de clase o de cuenta', plan.cambian.length],
    ['Ya estaban igual', plan.iguales.length],
    ['NO están en la app', m.noEncontradas.length, 'están en el reporte pero no hay factura con ese UUID'],
    ['Ambiguas (no se tocan)', m.ambiguas.length + lect.conflictos.length],
    ['Con otro proyecto en la app (solo aviso)', plan.proyectoDistinto.length],
    ['Sin sección Directo/Indirecto (no se tocan)', sinSeccion, 'ver la hoja "Sin sección"'],
    [],
    ['Hoja', 'Directas', 'Indirectas', 'Sin sección', 'Repetidas'],
    ...lect.porHoja.map(h => [h.hoja, h.directo, h.indirecto, h.sinClase, h.repetidos]),
  ];
  hoja('Resumen', resumen, [44, 12, 50, 12, 12]);
  const filasPlan = lista => lista.map(x => [...fFac(x.factura), lbl(x.clase), x.cuenta, x.registro.hoja, x.via]);
  hoja('Se marcan', [[...encFac, 'Clase', 'Cuenta contable', 'Hoja del reporte', 'Cómo se encontró'], ...filasPlan(plan.nuevas)],
    [10, 12, 38, 34, 11, 14, 22, 18, 22, 14, 16], [5]);
  hoja('Cambian', [[...encFac, 'Clase NUEVA', 'Cuenta NUEVA', 'Clase actual', 'Cuenta actual', 'Origen actual', 'Hoja del reporte'],
    ...plan.cambian.map(x => [...fFac(x.factura), lbl(x.clase), x.cuenta, lbl(x.prev.clase), x.prev.cuenta_contable || '', x.prev.fuente || '', x.registro.hoja])],
  [10, 12, 38, 34, 11, 14, 22, 18, 22, 18, 22, 10, 14], [5]);
  hoja('No están en la app', [['Hoja', 'Clase', 'UUID', 'RFC', 'Emisor', 'Fecha', 'Folio', 'Total', 'Cuenta contable', 'Estado SAT', 'Tipo'],
    ...m.noEncontradas.map(r => [r.hoja, lbl(r.clase), r.uuid, r.rfc, r.emisor, String(r.fecha || ''), r.folio, r.total, r.cuenta, r.estado, r.tipo])],
  [12, 18, 38, 15, 34, 11, 10, 14, 22, 10, 10], [7]);
  hoja('Ambiguas', [['Hoja', 'Clase', 'UUID', 'Emisor', 'Total', 'Motivo', 'Facturas de la app'],
    ...m.ambiguas.map(a => [a.registro.hoja, lbl(a.registro.clase), a.registro.uuid, a.registro.emisor, a.registro.total, a.motivo, a.facturas.map(f => f.factura_id).join(', ')]),
    ...lect.conflictos.map(c => [c.hoja, lbl(c.clase), c.uuid, c.emisor, c.total, c.motivo, ''])],
  [12, 18, 38, 34, 14, 60, 20], [4]);
  hoja('Proyecto distinto', [[...encFac, 'Clase', 'Proyecto según el reporte', 'Hoja del reporte'],
    ...plan.proyectoDistinto.map(x => [...fFac(x.factura), lbl(x.clase), x.proyectoReporte, x.registro.hoja])],
  [10, 12, 38, 34, 11, 14, 22, 18, 24, 14], [5]);
  hoja('Sin sección', [['Hoja', 'Renglón', 'UUID', 'Emisor', 'Total', 'Motivo'],
    ...lect.avisos.map(a => [a.hoja || '', a.fila || '', a.uuid || '', a.emisor || '', a.total || '', a.motivo])],
  [12, 9, 38, 34, 14, 70], [4]);
  XLSX.writeFile(wb, `Clase_de_costo_vista_previa_${sello.archivo}.xlsx`);
}

// ---------- 📥 Subir clase de costo ----------
export function subirClaseCosto() {
  if (!esAdmin()) { notify('Solo el admin puede subir la clase de costo', 'error'); return; }
  if (!claseListo()) { notify(MSG_SQL47, 'error'); return; }
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls,.xlsm';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) _procesarArchivo(f); };
  inp.click();
}

async function _procesarArchivo(file) {
  let wb;
  try {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  } catch (e) {
    notify(`No pude leer "${file.name}": ${(e && e.message) || e}`, 'error');
    return;
  }
  const hojas = wb.SheetNames.map(n => ({
    nombre: n, filas: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false }),
  }));
  const lect = leerReporteClase(hojas);
  if (!lect.registros.length) {
    notify('No encontré facturas en ese archivo: debe tener una columna "UUID" y renglones "COSTOS DIRECTOS / INDIRECTOS DE OBRA" (o una columna "Clase").', 'error');
    return;
  }
  const m = emparejarClase(lect.registros, state.facturas || []);
  const existentes = new Map((state.facturaClase || []).map(c => [String(c.factura_id), c]));
  const plan = planClase(m.matches, existentes, { proyMatch: proyectoMatch, proyectoDeCodigo: _proyectoDeCodigo });
  const sello = _sello();
  _excelVistaPrevia(file.name, lect, m, plan, sello);

  const aplicar = [...plan.nuevas, ...plan.cambian];
  const dir = lect.registros.filter(r => r.clase === 'directo').length;
  if (!aplicar.length) {
    notify(`✅ Nada que cambiar: las ${plan.iguales.length} factura(s) encontradas ya tenían su clase. Se descargó el Excel con el detalle (${m.noEncontradas.length} no están en la app).`);
    return;
  }
  const texto = `📥 Clase de costo — "${file.name}"\n\n`
    + `En el archivo: ${lect.registros.length} factura(s) (${dir} directas · ${lect.registros.length - dir} indirectas).\n\n`
    + `• Se marcan: ${plan.nuevas.length}\n`
    + `• Cambian de clase o de cuenta: ${plan.cambian.length}\n`
    + `• Ya estaban igual: ${plan.iguales.length}\n`
    + `• NO están en la app: ${m.noEncontradas.length}\n`
    + `• Ambiguas (no se tocan): ${m.ambiguas.length + lect.conflictos.length}\n`
    + (plan.proyectoDistinto.length ? `• Con otro proyecto en la app (solo aviso): ${plan.proyectoDistinto.length}\n` : '')
    + (lect.avisos.some(a => a.uuid) ? `• Sin sección Directo/Indirecto (no se tocan): ${lect.avisos.filter(a => a.uuid).length}\n` : '')
    + `\nSe descargó un Excel con el detalle de cada una. Solo se guarda la CLASE y la cuenta contable de cada factura: no cambia montos, partidas, proyectos ni repartos.\n\n¿Aplicar a ${aplicar.length} factura(s)?`;
  if (!confirm(texto)) return;

  try {
    _progreso(`Guardando clase de costo… 0/${aplicar.length}`);
    await guardarClases(aplicar.map(x => ({
      factura_id: x.factura_id, clase: x.clase, cuenta_contable: x.cuenta, fuente: 'excel',
      lote: `${file.name} · ${x.registro.hoja}`.slice(0, 200),
    })), (k, n) => _progreso(`Guardando clase de costo… ${k}/${n}`));
    notify(`✅ Clase de costo guardada en ${aplicar.length} factura(s)`, 'success');
  } catch (e) {
    notify(`⚠️ Se cortó el guardado (${(e && e.message) || e}). Lo ya guardado quedó bien; vuelve a subir el archivo para completar (lo que ya está igual no se repite).`, 'error');
  } finally {
    _progreso(null);
    if (window.renderFacturas) window.renderFacturas();
  }
}

// Badge para la lista de Facturas.
export function claseCelda(facturaId) {
  const c = claseDeFactura(facturaId);
  if (!c) return '<span style="color:var(--muted);font-size:11px;" title="Sin clasificar">—</span>';
  const esD = c.clase === 'directo';
  const tit = escapeHtml(`${CLASE_LABEL[c.clase] || c.clase}${c.cuenta_contable ? ' · cuenta ' + c.cuenta_contable : ''}${c.fuente === 'manual' ? ' · marcada a mano' : c.lote ? ' · ' + c.lote : ''}`);
  return `<span title="${tit}" style="display:inline-block;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;${esD ? 'background:rgba(76,175,120,.15);color:var(--green);' : 'background:rgba(120,110,220,.15);color:#8a7fe0;'}">${esD ? 'Directo' : 'Indirecto'}</span>`;
}

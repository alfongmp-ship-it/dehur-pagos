// ============================================================================
// Clase de costo de las facturas (Directo / Indirecto de obra) — motor PURO, sin
// imports (pruebas en scripts/test-clase-costo.mjs).
//
// Lee el reporte de contabilidad tal cual (p. ej. "DTE - COSTOS POR PROYECTO"):
// una hoja por mes y proyecto ("ENE E.U.", "ENE P.P."…), un renglón de encabezado
// con "UUID" y renglones de SECCIÓN ("COSTOS DIRECTOS DE OBRA" / "COSTOS
// INDIRECTOS DE OBRA"): toda factura debajo de una sección es de esa clase. Las
// columnas cambian entre hojas → se leen POR NOMBRE de encabezado, nunca por
// posición. También acepta un Excel sencillo con columnas "UUID" y "Clase".
// Después busca cada UUID entre las facturas de la app (completo, o por el primer
// bloque cuando la app lo guardó incompleto) y arma el plan: qué se marca, qué
// cambia, qué no está en la app y qué es ambiguo. Solo PLANEA; no guarda nada.
// ============================================================================

const norm = s => String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}/i;          // al menos el primer y segundo bloque
const CUENTA_RE = /^\d{3,5}(-\d{2,4}){3,}$/;         // 1115-001-010-001-006 (4+ partes: una fecha 2026-02-03 NO pasa)

export const CLASES = ['directo', 'indirecto'];

// "Directo", "DIRECTO DE OBRA", "D" → 'directo'; "Indirecto", "I" → 'indirecto'.
export function claseDeTexto(v) {
  const t = norm(v);
  if (!t) return '';
  if (t === 'i' || t.startsWith('indirect') || t.includes('costos indirectos')) return 'indirecto';
  if (t === 'd' || t.startsWith('direct') || t.includes('costos directos')) return 'directo';
  return '';
}

// Proyecto según el nombre de la hoja: "ENE E.U." → 'EU' (Entorno), "ENE P.P." → 'PP'.
export function proyectoDeHoja(nombre) {
  const t = String(nombre || '').toUpperCase();
  if (/\bE\.\s*U\.?/.test(t) || /ENTORNO/.test(t)) return 'EU';
  if (/\bP\.\s*P\.?/.test(t) || /PARA[IÍ]SO/.test(t)) return 'PP';
  return '';
}

// Renglón de sección: algún texto con "costos … directos/indirectos" y sin UUID.
function _seccionDe(fila) {
  for (const c of fila || []) {
    const t = norm(c);
    if (!t || !t.includes('costo')) continue;
    if (t.includes('indirect')) return 'indirecto';
    if (t.includes('direct')) return 'directo';
  }
  return '';
}

// Renglón de título de OTRA sección (p. ej. "GASTOS DE ADMINISTRACIÓN"): 1 o 2
// celdas llenas y todas texto. Corta la sección anterior para que lo de abajo NO
// herede Directo/Indirecto (va a avisos). Los totales son números: no cortan; una
// factura sin UUID trae muchas celdas: tampoco corta.
function _tituloOtraSeccion(fila) {
  const llenas = (fila || []).filter(c => c != null && String(c).trim() !== '');
  if (!llenas.length || llenas.length > 2) return '';
  return llenas.every(c => typeof c === 'string' && /[a-z]/i.test(c)) ? llenas.map(c => String(c).trim()).join(' ') : '';
}

// Columnas por nombre de encabezado (normalizado).
function _columnas(enc) {
  const col = {};
  enc.forEach((h, i) => {
    const t = norm(h);
    if (!t) return;
    if (col.uuid == null && (t === 'uuid' || t.includes('folio fiscal'))) col.uuid = i;
    else if (col.clase == null && (t.startsWith('clase') || t.includes('tipo de costo') || (t.includes('directo') && t.includes('indirecto')))) col.clase = i;
    else if (col.cuenta == null && (t.includes('cuenta') || t.replace(/\s/g, '') === 'gasto/costo')) col.cuenta = i;
    else if (col.total == null && t === 'total') col.total = i;
    else if (col.fecha == null && t.includes('fecha')) col.fecha = i;
    else if (col.rfc == null && t.startsWith('rfc')) col.rfc = i;
    else if (col.emisor == null && (t.includes('nombre') || t.includes('emisor') || t.includes('proveedor'))) col.emisor = i;
    else if (col.folio == null && t === 'folio') col.folio = i;
    else if (col.estado == null && t.includes('estado')) col.estado = i;
    else if (col.tipo == null && t === 'tipo') col.tipo = i;
  });
  return col;
}
const _celda = (fila, i) => (i == null ? '' : (fila[i] == null ? '' : fila[i]));
const _num = v => { const n = typeof v === 'number' ? v : Number(String(v || '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; };

// hojas = [{ nombre, filas: [[celda…]…] }] (como sheet_to_json con header:1).
// Devuelve { registros, avisos, porHoja }. Un registro por UUID (el primero gana si
// se repite con la misma clase; si se repite con OTRA clase, va a `conflictos`).
export function leerReporteClase(hojas) {
  const registros = [];
  const avisos = [];
  const porHoja = [];
  const vistos = new Map();         // uuidNorm → registro
  const conflictos = [];
  (hojas || []).forEach(h => {
    const filas = h.filas || [];
    const cuenta = { hoja: h.nombre, directo: 0, indirecto: 0, sinClase: 0, repetidos: 0 };
    let col = null, seccion = '', otraSeccion = '';
    filas.forEach((fila, idx) => {
      if (!Array.isArray(fila)) return;
      if (!col) {
        if (fila.some(c => { const t = norm(c); return t === 'uuid' || t.includes('folio fiscal'); })) col = _columnas(fila);
        return;
      }
      const uuidTxt = String(_celda(fila, col.uuid)).trim();
      if (!UUID_RE.test(uuidTxt)) {
        const s = _seccionDe(fila);
        if (s) { seccion = s; otraSeccion = ''; return; }
        const otra = _tituloOtraSeccion(fila);
        if (otra) { seccion = ''; otraSeccion = otra; }
        return;
      }
      let cta = String(_celda(fila, col.cuenta)).trim();
      if (!CUENTA_RE.test(cta)) {
        const otra = fila.find(c => CUENTA_RE.test(String(c == null ? '' : c).trim()));
        cta = otra ? String(otra).trim() : (CUENTA_RE.test(cta) ? cta : '');
      }
      const clase = col.clase != null ? (claseDeTexto(_celda(fila, col.clase)) || seccion) : seccion;
      const reg = {
        uuid: uuidTxt.toUpperCase(), uuidNorm: uuidTxt.toLowerCase(), prefijo: uuidTxt.toLowerCase().slice(0, 8),
        clase, cuenta: cta, hoja: h.nombre, proyHoja: proyectoDeHoja(h.nombre), fila: idx + 1,
        fecha: _celda(fila, col.fecha), rfc: String(_celda(fila, col.rfc)).trim(), emisor: String(_celda(fila, col.emisor)).trim(),
        folio: String(_celda(fila, col.folio)).trim(), total: _num(_celda(fila, col.total)),
        estado: String(_celda(fila, col.estado)).trim(), tipo: String(_celda(fila, col.tipo)).trim(),
      };
      if (!clase) {
        cuenta.sinClase++;
        avisos.push({ ...reg, motivo: otraSeccion ? `Está bajo "${otraSeccion}": no es costo directo ni indirecto de obra` : 'Factura sin sección DIRECTOS/INDIRECTOS ni columna Clase' });
        return;
      }
      const prev = vistos.get(reg.uuidNorm);
      if (prev) {
        cuenta.repetidos++;
        if (prev.clase !== clase && !prev.conflicto) {
          prev.conflicto = true;
          conflictos.push({ ...reg, motivo: `El mismo UUID viene como ${prev.clase} (${prev.hoja}) y como ${clase} (${reg.hoja})` });
        }
        return;
      }
      vistos.set(reg.uuidNorm, reg);
      registros.push(reg);
      cuenta[clase]++;
    });
    if (!col) avisos.push({ hoja: h.nombre, motivo: 'Hoja sin encabezado UUID: se ignora' });
    porHoja.push(cuenta);
  });
  return { registros: registros.filter(r => !r.conflicto), conflictos, avisos, porHoja };
}

// Busca cada registro entre las facturas de la app.
//   · UUID completo idéntico (sin importar mayúsculas) → 'uuid completo'.
//   · Si no: factura cuyo UUID guardado es el INICIO del del reporte (la app a veces
//     guarda solo el primer bloque) → 'primer bloque'.
//   · Dos o más candidatas, o dos renglones del reporte con distinta clase hacia la
//     misma factura → ambigua (no se toca).
export function emparejarClase(registros, facturas) {
  const porUuid = new Map(), porPref = new Map();
  (facturas || []).forEach(f => {
    const u = String(f.uuid || '').trim().toLowerCase();
    if (u.length < 8) return;
    (porUuid.get(u) || porUuid.set(u, []).get(u)).push(f);
    const p = u.slice(0, 8);
    (porPref.get(p) || porPref.set(p, []).get(p)).push(f);
  });
  const matches = [], noEncontradas = [], ambiguas = [];
  (registros || []).forEach(r => {
    const exactas = porUuid.get(r.uuidNorm) || [];
    let cands = exactas, via = 'uuid completo';
    if (!exactas.length) {
      cands = (porPref.get(r.prefijo) || []).filter(f => r.uuidNorm.startsWith(String(f.uuid || '').trim().toLowerCase()));
      via = 'primer bloque';
    }
    if (!cands.length) { noEncontradas.push(r); return; }
    if (cands.length > 1) { ambiguas.push({ registro: r, facturas: cands, motivo: `${cands.length} facturas de la app tienen ese UUID` }); return; }
    matches.push({ registro: r, factura: cands[0], via });
  });
  // Una misma factura alcanzada por dos renglones con distinta clase → ambigua.
  const porFactura = new Map();
  matches.forEach(m => { const k = String(m.factura.factura_id); (porFactura.get(k) || porFactura.set(k, []).get(k)).push(m); });
  const finales = [];
  porFactura.forEach(lista => {
    const clases = new Set(lista.map(m => m.registro.clase));
    if (clases.size > 1) { lista.forEach(m => ambiguas.push({ registro: m.registro, facturas: [m.factura], motivo: 'Dos renglones del reporte con distinta clase apuntan a la misma factura' })); return; }
    finales.push(lista[0]);
  });
  return { matches: finales, noEncontradas, ambiguas };
}

// Plan contra lo que ya hay guardado (existentes: Map factura_id → { clase, cuenta_contable, fuente }).
//   nuevas → sin clase todavía · cambian → otra clase u otra cuenta · iguales → nada que hacer.
//   proyectoDistinto → informativo: la hoja dice un proyecto y la factura tiene otro.
// opts: { proyMatch(a, b), proyectoDeCodigo('EU'|'PP') → nombre en la app }
export function planClase(matches, existentes, opts = {}) {
  const nuevas = [], cambian = [], iguales = [], proyectoDistinto = [];
  (matches || []).forEach(m => {
    const fid = String(m.factura.factura_id);
    const prev = existentes && existentes.get(fid);
    const cuenta = m.registro.cuenta || (prev && prev.cuenta_contable) || '';
    const item = { ...m, factura_id: fid, clase: m.registro.clase, cuenta, prev: prev || null };
    if (!prev) nuevas.push(item);
    else if (prev.clase !== item.clase || (m.registro.cuenta && prev.cuenta_contable !== m.registro.cuenta)) cambian.push(item);
    else iguales.push(item);
    const esperado = opts.proyectoDeCodigo ? opts.proyectoDeCodigo(m.registro.proyHoja) : '';
    if (esperado && m.factura.proyecto && opts.proyMatch && !opts.proyMatch(m.factura.proyecto, esperado)) {
      proyectoDistinto.push({ ...item, proyectoReporte: esperado });
    }
  });
  return { nuevas, cambian, iguales, proyectoDistinto };
}

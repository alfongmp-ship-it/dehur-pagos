// ============================================================================
// Repartos de obra — motor PURO, sin imports (pruebas en scripts/test-repartos-obra.mjs).
//
// Lee el Excel mensual que manda la obra ("REGISTRO DE CONTROL DE COMPRAS /
// DISPERSIONES": ID, Fecha emisión, Tipo, Proveedor, Descripción, Categoría,
// Importe, Descripción particular, Aplicación x Depto. y Reparto) tal cual llega.
// Las columnas se leen POR NOMBRE de encabezado, nunca por posición.
//
// No trae UUID ni folio: cada renglón FACTURA se liga a una factura de la app por
// importe al centavo + fecha + proveedor parecido. Ante CUALQUIER duda (dos
// facturas iguales, fecha lejana con compras que se repiten, proveedor distinto)
// NO se liga: queda para revisar con el motivo. Solo PLANEA; no guarda nada.
// ============================================================================

const norm = s => String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const up = s => norm(s).toUpperCase();
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dias = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const txt = v => String(v == null ? '' : v).trim();

export const VENTANA_CERCANA = 15;   // días: fecha distinta aceptable si la factura es única…
export const VENTANA_UNICA = 60;     // …en ±60 días (compras que se repiten cada mes con el mismo importe)

// ---------- Fechas ----------
// Celda de fecha del Excel → 'YYYY-MM-DD' ('' si no se entiende). Acepta número de
// serie de Excel, Date, 'DD/MM/YYYY' y 'YYYY-MM-DD'.
export function fechaISO(v) {
  if (v == null || v === '') return '';
  const p2 = n => String(n).padStart(2, '0');
  if (v instanceof Date) return isNaN(v) ? '' : `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  if (typeof v === 'number') {
    if (!(v > 20000 && v < 80000)) return '';
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${p2(m[2])}-${p2(m[1])}`;
  return '';
}

function _importe(v) {
  if (typeof v === 'number') return isFinite(v) ? r2(v) : null;
  const s = txt(v).replace(/[$,\s]/g, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return r2(parseFloat(s));
}

// ---------- 1. Leer el formato ----------
// Columnas por nombre (normalizado). Las obligatorias definen si la hoja es del formato.
const COLS = [
  { key: 'id', test: t => t.startsWith('id') || t.startsWith('n°') || t === 'no' },
  { key: 'fecha', test: t => t.startsWith('fecha'), obligatoria: true },
  { key: 'tipo', test: t => t.startsWith('tipo'), obligatoria: true },
  { key: 'proveedor', test: t => t.startsWith('proveedor'), obligatoria: true },
  { key: 'particular', test: t => t.includes('particular') },
  { key: 'concepto', test: t => t.startsWith('descripcion') && !t.includes('particular') },
  { key: 'categoria', test: t => t.startsWith('categoria') },
  { key: 'importe', test: t => t.startsWith('importe'), obligatoria: true },
  { key: 'aplicacion', test: t => t.startsWith('aplicacion'), obligatoria: true },
  { key: 'reparto', test: t => t.startsWith('reparto'), obligatoria: true },
];

function _encabezado(fila) {
  const idx = {};
  (fila || []).forEach((c, i) => {
    const t = norm(c);
    if (!t) return;
    const col = COLS.find(k => idx[k.key] == null && k.test(t));
    if (col) idx[col.key] = i;
  });
  return COLS.every(k => !k.obligatoria || idx[k.key] != null) ? idx : null;
}

export function tipoDeTexto(v) {
  const t = norm(v);
  if (t.startsWith('factura')) return 'factura';
  if (t.startsWith('transfer')) return 'transferencia';   // la obra escribe "TRANSFERANCIA"
  return t ? 'otro' : '';
}

// hojas: [{ archivo, nombre, filas (arreglo de arreglos), filaInicial (renglón Excel - 1 de filas[0]) }]
export function leerFormatoDispersion(hojas) {
  const filas = [], hojasLeidas = [], hojasIgnoradas = [];
  (hojas || []).forEach(h => {
    const rows = h.filas || [];
    let hi = -1, idx = null;
    for (let i = 0; i < Math.min(rows.length, 20); i++) { idx = _encabezado(rows[i]); if (idx) { hi = i; break; } }
    if (hi < 0) { hojasIgnoradas.push({ archivo: h.archivo, hoja: h.nombre, motivo: 'no tiene los encabezados del formato (Fecha, Tipo, Proveedor, Importe, Aplicación, Reparto)' }); return; }
    let n = 0;
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const cel = k => (idx[k] == null ? '' : r[idx[k]]);
      if (r.some(c => norm(c) === 'totales')) continue;
      const proveedor = txt(cel('proveedor'));
      const impCel = cel('importe');
      if (!proveedor && (impCel === '' || impCel == null)) continue;   // renglón vacío de la plantilla ("047")
      n++;
      filas.push({
        archivo: h.archivo, hoja: h.nombre, renglon: (h.filaInicial || 0) + i + 1,
        idObra: txt(cel('id')),
        fecha: fechaISO(cel('fecha')), fechaTxt: cel('fecha') instanceof Date ? '' : txt(cel('fecha')),
        tipo: tipoDeTexto(cel('tipo')), tipoTxt: txt(cel('tipo')),
        proveedor, concepto: txt(cel('concepto')), categoria: txt(cel('categoria')),
        importe: _importe(impCel), particular: txt(cel('particular')),
        aplicacion: txt(cel('aplicacion')), reparto: txt(cel('reparto')),
      });
    }
    hojasLeidas.push({ archivo: h.archivo, hoja: h.nombre, renglones: n });
  });
  return { filas, hojasLeidas, hojasIgnoradas };
}

// ---------- 2. Interpretar Reparto + Aplicación ----------
const TODOS_RE = /^(TODOS|TODAS|TODO|DESARROLLO|TODO EL DESARROLLO|TODOS LOS DEPTOS|TODOS LOS DEPARTAMENTOS)$/;

// → { ok:true, metodo:'equitativo'|'directo'|'indiviso', codigos:[], nota }
//   { ok:false, motivo, vacio? }
export function interpretarReparto(repartoTxt, aplicacionTxt) {
  const rep = up(repartoTxt);
  const apl = up(aplicacionTxt);
  if (!rep && !apl) return { ok: false, vacio: true, motivo: 'La obra no puso reparto ni casas' };
  let metodo = '';
  if (rep === 'EQUITATIVO') metodo = 'equitativo';
  else if (rep === 'DIRECTO') metodo = 'directo';
  else if (/^INDIVISOS?$/.test(rep)) metodo = 'indiviso';
  else if (!rep) return { ok: false, motivo: 'Falta el reparto (EQUITATIVO / DIRECTO / INDIVISO)' };
  else return { ok: false, motivo: `Reparto "${txt(repartoTxt)}" no se reconoce (debe ser EQUITATIVO, DIRECTO o INDIVISO)` };
  if (!apl) return { ok: false, motivo: `${rep} sin casas: la columna "Aplicación" está vacía` };

  if (TODOS_RE.test(apl)) {
    if (metodo === 'indiviso') return { ok: true, metodo: 'indiviso', codigos: [], nota: rep === 'INDIVISO' ? '' : `"${rep}" se tomó como INDIVISO` };
    if (metodo === 'equitativo') return { ok: false, motivo: `EQUITATIVO con "${apl}": ¿partes iguales entre todas las casas o INDIVISO? Pon INDIVISO o la lista de casas` };
    return { ok: false, motivo: `DIRECTO con "${apl}": directo es a UNA casa. ¿Era INDIVISO?` };
  }

  const tokens = apl.split(/[\s,;/]+/).filter(Boolean);
  const pegada = tokens.find(t => /^\d{6,}$/.test(t));
  if (pegada) {
    const sug = pegada.length % 3 === 0 ? ` ¿${pegada.match(/\d{3}/g).join(', ')}?` : '';
    return { ok: false, motivo: `Casas pegadas sin coma ("${pegada}").${sug} Sepáralas con coma` };
  }
  const malo = tokens.find(t => !/^[A-Z]?-?\d{1,4}[A-Z]?$/.test(t));
  if (malo) return { ok: false, motivo: `"${txt(aplicacionTxt)}" no es una lista de casas ("${malo}" no es una casa). Ej.: 304, 402, 501` };
  const codigos = tokens;
  const rep2 = codigos.filter((c, i) => codigos.indexOf(c) !== i);
  if (rep2.length) return { ok: false, motivo: `La casa ${rep2[0]} viene repetida en la lista` };

  if (metodo === 'indiviso') return { ok: false, motivo: `INDIVISO con lista de casas (${codigos.length}): el indiviso es entre TODAS. ¿Era EQUITATIVO entre esas casas?` };
  if (metodo === 'directo' && codigos.length > 1) return { ok: false, motivo: `DIRECTO con ${codigos.length} casas: directo es a UNA casa. ¿Era EQUITATIVO entre esas ${codigos.length}?` };
  if (codigos.length === 1) return { ok: true, metodo: 'directo', codigos, nota: metodo === 'equitativo' ? 'EQUITATIVO con 1 sola casa = todo a esa casa' : '' };
  return { ok: true, metodo: 'equitativo', codigos, nota: '' };
}

// ---------- 3. Repetidos entre hojas ----------
// Un renglón que aparece en OTRA hoja/archivo (la obra copia renglones al mes
// siguiente) con el mismo reparto se cuenta una vez; con reparto DISTINTO es
// conflicto (no se aplica). En la MISMA hoja, dos renglones iguales son dos
// compras (gemelas). Renglones sin reparto ni casas → aparte.
const _clave = f => [f.tipo, f.fecha, f.importe == null ? '' : f.importe.toFixed(2), up(f.proveedor)].join('|');
const _firma = f => up(f.reparto) + '#' + up(f.aplicacion).replace(/[\s,;/]+/g, ',').replace(/^,|,$/g, '');
const _hojaDe = f => f.archivo + '::' + f.hoja;

export function deduplicarFilas(filas) {
  const unicas = [], repetidas = [], sinReparto = [];
  const llenas = (filas || []).filter(f => up(f.reparto) || up(f.aplicacion));
  const vacias = (filas || []).filter(f => !up(f.reparto) && !up(f.aplicacion));
  llenas.forEach(f => {
    const k = _clave(f);
    const otra = unicas.find(u => _clave(u) === k && _hojaDe(u) !== _hojaDe(f));
    if (!otra) { unicas.push({ ...f }); return; }
    if (_firma(otra) === _firma(f)) { repetidas.push({ fila: f, igualA: otra }); return; }
    otra.conflicto = otra.conflicto || [];
    otra.conflicto.push(f);
    repetidas.push({ fila: f, igualA: otra, conflicto: true });
  });
  vacias.forEach(f => {
    const otra = unicas.find(u => _clave(u) === _clave(f));
    if (otra) repetidas.push({ fila: f, igualA: otra, vacia: true });
    else sinReparto.push(f);
  });
  return { unicas, repetidas, sinReparto };
}

// ---------- 4. Proveedor parecido ----------
const STOP = new Set(['SA', 'DE', 'CV', 'RL', 'SAPI', 'SAS', 'SC', 'S', 'A', 'C', 'V', 'Y', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'EN',
  'MEXICO', 'GRUPO', 'COMERCIAL', 'COMERCIALIZADORA', 'CIA', 'COMPANIA', 'SERVICIOS', 'MATERIALES', 'PRODUCTOS',
  'DISTRIBUIDORA', 'INSTITUCION', 'BANCA', 'MULTIPLE']);
export function tokensProveedor(s) {
  return up(s).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !STOP.has(t));
}
const _tokIgual = (a, b) => {
  if (a === b) return true;
  const [c, l] = a.length <= b.length ? [a, b] : [b, a];
  return c.length >= 4 && l.startsWith(c);
};
// ¿El nombre de la obra se parece a alguno de los nombres de la factura (proveedor,
// razón social, alias)? Basta UNA palabra significativa en común.
export function provParecido(nombreObra, nombresApp) {
  const A = tokensProveedor(nombreObra);
  if (!A.length) return false;
  const B = (nombresApp || []).flatMap(tokensProveedor);
  return A.some(a => B.some(b => _tokIgual(a, b)));
}

// ---------- 5. Ligar renglón ↔ factura ----------
// filas: renglones FACTURA (de deduplicarFilas().unicas). facturas: [{ id, fecha (ISO),
// total, nombres:[...], valida }] (valida = Factura vigente con monto).
// → [{ fila, factura|null, via:'exacta'|'gemela'|'cercana'|'', dias, estado, motivo, candidatos }]
//   estado: 'ligada' | 'ambigua' | 'proveedor' | 'no_encontrada' | 'conflicto' | 'sin_dato'
export function emparejarFilas(filas, facturas) {
  const pool = (facturas || []).filter(f => f.valida && f.fecha && f.total > 0);
  const mismoImporte = (f, imp) => Math.abs(f.total - imp) < 0.015;   // hasta 1 centavo de redondeo (subtotal + IVA)
  const res = (filas || []).map(fila => ({ fila, factura: null, via: '', dias: 0, estado: '', motivo: '', candidatos: [] }));
  const usadas = new Set();
  const lista = fs => fs.map(f => '#' + f.id).join(', ');

  // a) datos mínimos y conflictos entre hojas
  res.forEach(r => {
    const f = r.fila;
    if (f.conflicto && f.conflicto.length) { r.estado = 'conflicto'; r.motivo = `Viene en otra hoja con OTRO reparto (${f.conflicto.map(c => `${c.hoja} renglón ${c.renglon}: ${c.reparto} ${c.aplicacion}`).join(' · ')})`; return; }
    if (!f.fecha) { r.estado = 'sin_dato'; r.motivo = `Fecha no válida ("${f.fechaTxt}")`; return; }
    if (!(f.importe > 0)) { r.estado = 'sin_dato'; r.motivo = 'Importe vacío o no válido'; return; }
    if (!f.proveedor) { r.estado = 'sin_dato'; r.motivo = 'Sin proveedor'; }
  });

  // b) fecha EXACTA (+ importe + proveedor), con renglones gemelos de la misma hoja
  const grupos = new Map();
  res.filter(r => !r.estado).forEach(r => {
    const k = _hojaDe(r.fila) + '|' + _clave(r.fila);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  });
  grupos.forEach(rs => {
    const f0 = rs[0].fila;
    const exactas = pool.filter(f => mismoImporte(f, f0.importe) && f.fecha === f0.fecha && provParecido(f0.proveedor, f.nombres));
    if (!exactas.length) return;
    if (exactas.length === rs.length && rs.every(r => _firma(r.fila) === _firma(f0)) && exactas.every(f => !usadas.has(f.id))) {
      const ord = exactas.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
      rs.forEach((r, i) => { r.factura = ord[i]; r.via = rs.length > 1 ? 'gemela' : 'exacta'; r.estado = 'ligada'; usadas.add(ord[i].id); });
      return;
    }
    rs.forEach(r => {
      r.estado = 'ambigua'; r.candidatos = exactas;
      r.motivo = `En la app hay ${exactas.length} factura(s) iguales (${lista(exactas)}) y el formato trae ${rs.length} renglón(es) así${rs.length > 1 && exactas.length === rs.length ? ' con repartos distintos' : ''}: no se puede saber cuál es cuál`;
    });
  });

  // c) fecha CERCANA: solo si es la ÚNICA de ese importe y proveedor en ±60 días
  res.filter(r => !r.estado).forEach(r => {
    const f0 = r.fila;
    const parecida = f => mismoImporte(f, f0.importe) && provParecido(f0.proveedor, f.nombres);
    const ancho = pool.filter(f => parecida(f) && Math.abs(dias(f.fecha) - dias(f0.fecha)) <= VENTANA_UNICA);
    const cerca = ancho.filter(f => Math.abs(dias(f.fecha) - dias(f0.fecha)) <= VENTANA_CERCANA);
    if (cerca.length === 1 && ancho.length === 1 && !usadas.has(cerca[0].id)) {
      r.factura = cerca[0]; r.via = 'cercana'; r.dias = Math.round(dias(cerca[0].fecha) - dias(f0.fecha)); r.estado = 'ligada';
      return;
    }
    if (cerca.length) {
      r.estado = 'ambigua'; r.candidatos = ancho;
      r.motivo = cerca.length === 1 && ancho.length === 1
        ? `La factura parecida (#${cerca[0].id}) ya la ocupa otro renglón con la fecha exacta`
        : `Ninguna factura con la misma fecha; hay ${ancho.length} del mismo importe y proveedor en ±${VENTANA_UNICA} días (${lista(ancho)}): no se puede saber cuál es`;
      return;
    }
    const sinProv = pool.filter(f => mismoImporte(f, f0.importe) && Math.abs(dias(f.fecha) - dias(f0.fecha)) <= VENTANA_CERCANA);
    if (sinProv.length) {
      r.estado = 'proveedor'; r.candidatos = sinProv;
      r.motivo = `Importe y fecha coinciden con ${sinProv.map(f => `#${f.id} (${(f.nombres || [])[0] || '?'})`).join(', ')}, pero el proveedor no se parece a "${f0.proveedor}"`;
      return;
    }
    r.estado = 'no_encontrada';
    r.motivo = `No hay en la app una factura vigente de ${f0.importe.toFixed(2)} en ±${VENTANA_CERCANA} días`;
  });
  // Dos renglones (por fecha cercana) que caen en la MISMA factura → ninguno se liga.
  const porFactura = new Map();
  res.filter(r => r.estado === 'ligada' && r.via === 'cercana').forEach(r => {
    porFactura.set(r.factura.id, [...(porFactura.get(r.factura.id) || []), r]);
  });
  porFactura.forEach(rs => {
    if (rs.length < 2) return;
    rs.forEach(r => { r.estado = 'ambigua'; r.candidatos = [r.factura]; r.factura = null; r.via = ''; r.motivo = `${rs.length} renglones apuntan a la misma factura: no se puede saber cuál es`; });
  });
  return res;
}

// ---------- 6. Partida ----------
// Concepto de la obra → sub-partida de CONSTRUCCION (solo si existe en el catálogo).
export const PARTIDA_BASE = 'CONSTRUCCION';
export const CONCEPTO_SUBPARTIDA = [
  [/CARPINTER|LAMBRIN|GABINETE|MADERA|CLOSET|PUERTA/, 'Carpinteria'],
  [/ALBANIL/, 'Albanileria'],
  [/\bGAS\b/, 'Instalaciones de Gas'],
  [/ELECTRIC|LAMPARA|LUMINARI|\bLED\b|ALUMBRADO|ALIMENTADOR/, 'Instalaciones Electricas'],
  [/HIDRAUL|FONTANER|GRIFERIA|CALENTADOR|SANITARI|LINEAS? DE AGUA|TINACO/, 'Instalaciones Hidrosanitarias'],
  [/IMPER/, 'Impermeabilizacion'],
  [/ELEVADOR/, 'Elevadores'],
  [/FACHADA/, 'Fachadas y Recubrimientos Exteriores'],
  [/CANCEL|BARANDAL|VIDRIO/, 'Canceleria'],
  [/HERRERIA/, 'Herreria'],
  [/CLIMA|AIRE ACONDICIONADO|INST\.? A\.?A\b/, 'Aire Acondicionado'],
  [/PISO|MARMOL|PINTURA|ACABADO|TABLAROCA|ZOCLO|AZULEJO|CERAMIC|CUBIERTA/, 'Acabados'],
];

// Partida/sub válidas en el catálogo → { partida, sub } con los nombres del catálogo, o null.
export function partidaValida(catalogo, partida, sub) {
  if (!norm(partida)) return null;
  const cat = (catalogo || []).find(p => p.activa !== false && norm(p.partida) === norm(partida));
  if (!cat) return null;
  const subs = Array.isArray(cat.subpartidas) ? cat.subpartidas : [];
  if (!subs.length) return { partida: cat.partida, sub: '' };
  const s = subs.find(x => norm(x) === norm(sub));
  return s ? { partida: cat.partida, sub: s } : null;
}

// dePago / historial: [{ partida, sub }] (uno por documento). → { partida, sub, fuente } | { error }
export function elegirPartida({ dePago = [], historial = [], concepto = '', catalogo = [] }) {
  const validas = l => l.map(x => partidaValida(catalogo, x.partida, x.sub)).filter(Boolean);
  const k = x => x.partida + '|' + x.sub;
  const vp = validas(dePago);
  if (vp.length && vp.every(x => k(x) === k(vp[0]))) return { ...vp[0], fuente: 'pago ligado' };
  const vh = validas(historial);
  if (vh.length >= 2) {
    const cnt = new Map();
    vh.forEach(x => cnt.set(k(x), (cnt.get(k(x)) || 0) + 1));
    const [top, n] = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n / vh.length >= 2 / 3) return { ...vh.find(x => k(x) === top), fuente: `historial del proveedor (${n} de ${vh.length})` };
  }
  // concepto: texto o lista de textos en orden de preferencia (concepto, luego descripción particular)
  for (const t of (Array.isArray(concepto) ? concepto : [concepto]).map(up).filter(Boolean)) {
    for (const [re, sub] of CONCEPTO_SUBPARTIDA) {
      if (!re.test(t)) continue;
      const v = partidaValida(catalogo, PARTIDA_BASE, sub);
      if (v) return { ...v, fuente: 'concepto de la obra' };
    }
  }
  const def = partidaValida(catalogo, PARTIDA_BASE, PARTIDA_BASE);
  if (def) return { ...def, fuente: 'por defecto' };
  return { error: `No encontré una partida válida (ni "${PARTIDA_BASE}" en el catálogo)` };
}

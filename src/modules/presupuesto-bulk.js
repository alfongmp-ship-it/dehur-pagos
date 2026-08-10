// Captura masiva de presupuesto + costo inicial por unidad usando Excel.
// Genera plantilla (descargar) y procesa subida con merge inteligente.

import { state, puedeCapturarObra, nuevoPresupuestoId } from '../state.js';
import { notify } from '../ui/notify.js';
import { gsSavePresupuestoUnidad, esPorFila, sbGuardarFila } from '../services/google-sync.js';

const HEADER_ID = 'DEHUR — Presupuesto / Costo Inicial';

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

function unidadesDelProyecto(proyecto) {
  return state.unidades
    .filter(u => u.activo !== false && u.proyecto === proyecto)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0) || String(a.nombre).localeCompare(String(b.nombre)));
}

// Columnas del presupuesto = catálogo ADMIN (Control de Obra v2): una columna por
// partida sin sub-partidas y una por cada "PARTIDA / Sub" cuando las tiene
// (CONSTRUCCION). Misma taxonomía con que se clasifican facturas y pagos.
function columnasPresupuestoAdmin() {
  const cols = [];
  (state.partidasCatalogo || [])
    .filter(p => p.activa !== false)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0) || String(a.partida).localeCompare(String(b.partida)))
    .forEach(p => {
      const subs = Array.isArray(p.subpartidas) ? p.subpartidas : [];
      if (subs.length) subs.forEach(s => cols.push({ partida: p.partida, sub: s, header: `${p.partida} / ${s}` }));
      else cols.push({ partida: p.partida, sub: '', header: p.partida });
    });
  return cols;
}

// Traduce el texto de una columna a {partida, sub}: primero por match exacto con
// el catálogo; si no, intenta partir en el PRIMER " / " (las subs pueden contener
// "/" — p.ej. "Instalaciones Especiales / Voz y Datos"); si tampoco, todo es partida.
function parseColumnaPresupuesto(header, colsCat) {
  const h = String(header || '').trim();
  const cat = colsCat.find(c => norm(c.header) === norm(h));
  if (cat) return { partida: cat.partida, sub: cat.sub };
  const i = h.indexOf(' / ');
  if (i > 0) {
    const p = h.slice(0, i).trim(), s = h.slice(i + 3).trim();
    if (colsCat.some(c => norm(c.partida) === norm(p))) return { partida: p, sub: s };
  }
  return { partida: h, sub: '' };
}

function presupuestoExistente(unidadId, partida, sub) {
  const nP = norm(partida), nS = norm(sub || '');
  return state.presupuestoUnidad.find(x => x.unidad_id === unidadId && norm(x.partida) === nP && norm(x.sub_partida) === nS);
}

export function descargarPlantillaPresupuesto(proyecto) {
  if (!window.XLSX) { notify('Cargando librería XLSX, intenta en 2 segundos', 'error'); return; }
  if (!proyecto) { notify('Selecciona un proyecto antes de descargar la plantilla', 'error'); return; }
  const unidades = unidadesDelProyecto(proyecto);
  const cols = columnasPresupuestoAdmin();
  if (!unidades.length) { notify(`No hay unidades activas en ${proyecto}`, 'error'); return; }
  if (!cols.length) { notify('No hay partidas en el catálogo de admin. Crea el catálogo primero (Configuración → Partidas).', 'error'); return; }

  const fechaTxt = new Date().toISOString().split('T')[0];
  const headerRow = ['Unidad', ...cols.map(c => c.header)];

  function buildSheet(campo) {
    const titleRow = [`${HEADER_ID} — Proyecto: ${proyecto}`];
    const metaRow = [`Generado: ${fechaTxt} · Unidades: ${unidades.length} · Columnas: ${cols.length} (partida / sub-partida del catálogo admin)`];
    const data = [titleRow, metaRow, headerRow];
    unidades.forEach(u => {
      const row = [u.nombre];
      cols.forEach(c => {
        const ex = presupuestoExistente(u.unidad_id, c.partida, c.sub);
        const v = ex ? ex[campo] : 0;
        row.push(v && v !== 0 ? v : '');
      });
      data.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    // Anchos: unidad 14, columnas 18 (los headers compuestos son más largos)
    ws['!cols'] = [{ wch: 14 }, ...cols.map(() => ({ wch: 18 }))];
    // Freeze primera columna y fila de headers
    ws['!freeze'] = { xSplit: 1, ySplit: 3 };
    return ws;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet('monto_presupuestado'), 'Presupuesto');
  XLSX.utils.book_append_sheet(wb, buildSheet('costo_inicial'), 'Costo Inicial');
  XLSX.utils.book_append_sheet(wb, buildSheet('avance_fisico'), 'Avance Fisico');

  const fn = `Presupuesto_${proyecto.replace(/[^\w]+/g, '_')}_${fechaTxt.replace(/-/g, '')}.xlsx`;
  XLSX.writeFile(wb, fn);
  notify(`Plantilla descargada: ${unidades.length} unidades × ${cols.length} columnas ✓`, 'success');
}

// Procesa una hoja del Excel y aplica merge sobre state.presupuestoUnidad.
// Devuelve { actualizadas, nuevas, omitidas, avisos }.
function procesarHoja(rows, campo, proyecto, colsCat, tocadas) {
  let actualizadas = 0, nuevas = 0, omitidas = 0;
  const avisos = [];
  if (!rows || rows.length < 4) return { actualizadas, nuevas, omitidas, avisos: ['hoja vacía'] };

  // rows[0] = título, rows[1] = meta, rows[2] = headers, rows[3+] = datos
  const headers = rows[2] || [];
  // headers[0] = 'Unidad', headers[1..] = "Partida" o "Partida / Sub" del catálogo admin
  const partidaCols = headers.slice(1).map(h => String(h || '').trim());
  const headersCatNorm = new Set(colsCat.map(c => norm(c.header)));

  for (let i = 3; i < rows.length; i++) {
    const row = rows[i] || [];
    const nombreUnidad = String(row[0] || '').trim();
    if (!nombreUnidad) continue;

    // Resolver unidad dentro del proyecto
    const unidad = state.unidades.find(u =>
      u.activo !== false &&
      u.proyecto === proyecto &&
      norm(u.nombre) === norm(nombreUnidad)
    );
    if (!unidad) {
      avisos.push(`Unidad "${nombreUnidad}" no existe en ${proyecto} — fila omitida`);
      omitidas++;
      continue;
    }

    for (let c = 0; c < partidaCols.length; c++) {
      const colTxt = partidaCols[c];
      if (!colTxt) continue;
      const raw = row[c + 1];
      // Celda vacía → no tocar
      if (raw === undefined || raw === null || raw === '') continue;
      let valor = parseFloat(String(raw).replace(/[$,%\s]/g, ''));
      if (!isFinite(valor)) {
        avisos.push(`Celda no numérica en ${nombreUnidad} / ${colTxt} = "${raw}"`);
        continue;
      }
      // El avance físico es un porcentaje: se acota a 0-100.
      if (campo === 'avance_fisico') valor = Math.max(0, Math.min(100, valor));
      const { partida, sub } = parseColumnaPresupuesto(colTxt, colsCat);
      // Aviso si la columna no calza con el catálogo admin actual
      if (!headersCatNorm.has(norm(colTxt))) {
        // Solo el primer aviso por columna desconocida (para no spammear)
        const msg = `Columna "${colTxt}" no está en el catálogo admin (se aplica igual)`;
        if (!avisos.includes(msg)) avisos.push(msg);
      }

      const existente = presupuestoExistente(unidad.unidad_id, partida, sub);
      if (existente) {
        if ((existente[campo] || 0) !== valor) {
          existente[campo] = valor;
          if (tocadas) tocadas.set(String(existente.presupuesto_id), existente);
        }
        actualizadas++;
      } else {
        const nuevo = {
          presupuesto_id: nuevoPresupuestoId(),
          unidad_id: unidad.unidad_id,
          partida,
          sub_partida: sub,
          monto_presupuestado: campo === 'monto_presupuestado' ? valor : 0,
          costo_inicial: campo === 'costo_inicial' ? valor : 0,
          notas: '',
          avance_fisico: campo === 'avance_fisico' ? valor : 0
        };
        state.presupuestoUnidad.push(nuevo);
        if (tocadas) tocadas.set(String(nuevo.presupuesto_id), nuevo);
        nuevas++;
      }
    }
  }
  return { actualizadas, nuevas, omitidas, avisos };
}

export async function subirPlantillaPresupuesto(file) {
  if (!puedeCapturarObra()) { notify('No tienes permiso para capturar presupuestos', 'error'); return; }
  if (!file) return;
  if (!window.XLSX) { notify('Cargando librería XLSX, intenta en 2 segundos', 'error'); return; }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const hojaPres = wb.Sheets['Presupuesto'];
    const hojaInic = wb.Sheets['Costo Inicial'];
    const hojaAv = wb.Sheets['Avance Fisico'];   // OPCIONAL: plantillas viejas no la traen
    if (!hojaPres || !hojaInic) {
      notify('⛔ El archivo no tiene las hojas "Presupuesto" y "Costo Inicial"', 'error');
      return;
    }
    const rowsPres = XLSX.utils.sheet_to_json(hojaPres, { header: 1, defval: '' });
    const rowsInic = XLSX.utils.sheet_to_json(hojaInic, { header: 1, defval: '' });
    const rowsAv = hojaAv ? XLSX.utils.sheet_to_json(hojaAv, { header: 1, defval: '' }) : null;

    // Validar firma + extraer proyecto
    const titulo = String(rowsPres[0]?.[0] || '');
    if (!titulo.startsWith(HEADER_ID)) {
      notify('⛔ Este archivo no es la plantilla Dehur de Presupuesto', 'error');
      return;
    }
    const matchProy = titulo.match(/Proyecto:\s*(.+)$/);
    const proyecto = matchProy ? matchProy[1].trim() : '';
    if (!proyecto) {
      notify('⛔ No pude detectar el proyecto en el header', 'error');
      return;
    }

    // Validar que ambas hojas tengan el mismo header row
    const hdrPres = JSON.stringify((rowsPres[2] || []).map(String));
    const hdrInic = JSON.stringify((rowsInic[2] || []).map(String));
    if (hdrPres !== hdrInic) {
      notify('⛔ Las hojas "Presupuesto" y "Costo Inicial" tienen estructura distinta', 'error');
      return;
    }

    // Columnas válidas del catálogo ADMIN (para validar y parsear "Partida / Sub")
    const colsCat = columnasPresupuestoAdmin();

    // Confirmación si el alcance es grande
    const numUnidades = (rowsPres.length || 0) - 3;
    const numPartidas = ((rowsPres[2] || []).length || 1) - 1;
    const totalCeldas = numUnidades * numPartidas * (rowsAv ? 3 : 2);
    if (totalCeldas > 200) {
      if (!confirm(`Vas a procesar ${numUnidades} unidades × ${numPartidas} partidas × 2 hojas = hasta ${totalCeldas} celdas para el proyecto "${proyecto}".\n\n¿Continuar?`)) return;
    }

    // Procesar
    // Filas creadas/cambiadas por TODAS las hojas (por id) → guardado POR FILA (F3b).
    const tocadas = new Map();
    const resPres = procesarHoja(rowsPres, 'monto_presupuestado', proyecto, colsCat, tocadas);
    const resInic = procesarHoja(rowsInic, 'costo_inicial', proyecto, colsCat, tocadas);
    const resAv = rowsAv ? procesarHoja(rowsAv, 'avance_fisico', proyecto, colsCat, tocadas)
      : { actualizadas: 0, nuevas: 0, omitidas: 0, avisos: [] };
    const totales = {
      actualizadas: resPres.actualizadas + resInic.actualizadas + resAv.actualizadas,
      nuevas: resPres.nuevas + resInic.nuevas + resAv.nuevas,
      omitidas: resPres.omitidas + resInic.omitidas + resAv.omitidas,
      avisos: [...new Set([...resPres.avisos, ...resInic.avisos, ...resAv.avisos])]
    };

    const porFila = esPorFila('presupuestoUnidad');
    await gsSavePresupuestoUnidad({ porFila });
    if (porFila) tocadas.forEach(p => sbGuardarFila('presupuestoUnidad', p));
    if (window.renderCostosFiscales) window.renderCostosFiscales();

    const extra = totales.avisos.length ? ` · ⚠ ${totales.avisos.length} aviso(s)` : '';
    notify(`✓ ${totales.actualizadas} actualizadas, ${totales.nuevas} nuevas, ${totales.omitidas} omitidas${extra}`, 'success');
    if (totales.avisos.length) {
      console.warn('Avisos al procesar plantilla:', totales.avisos);
    }
  } catch (e) {
    console.error('subirPlantillaPresupuesto error', e);
    notify('Error procesando el archivo: ' + e.message, 'error');
  }
}

// Wrapper para el input file (recibe el evento del onchange)
export function handleSubirPlantillaPresupuesto(ev) {
  const file = ev.target.files?.[0];
  if (file) subirPlantillaPresupuesto(file);
  ev.target.value = ''; // permitir re-subir el mismo archivo
}

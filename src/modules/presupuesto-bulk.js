// Captura masiva de presupuesto + costo inicial por unidad usando Excel.
// Genera plantilla (descargar) y procesa subida con merge inteligente.

import { state, puedeCapturarObra } from '../state.js';
import { notify } from '../ui/notify.js';
import { gsSavePresupuestoUnidad } from '../services/google-sync.js';

const HEADER_ID = 'DEHUR — Presupuesto / Costo Inicial';

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

function unidadesDelProyecto(proyecto) {
  return state.unidades
    .filter(u => u.activo !== false && u.proyecto === proyecto)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0) || String(a.nombre).localeCompare(String(b.nombre)));
}

function partidasObraDelProyecto(proyecto) {
  const nProy = norm(proyecto);
  return (state.partidasObra || [])
    .filter(p => p.activa !== false && (!p.proyecto || norm(p.proyecto) === nProy))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0) || String(a.nombre).localeCompare(String(b.nombre)));
}

function presupuestoExistente(unidadId, partida) {
  const nP = norm(partida);
  return state.presupuestoUnidad.find(x => x.unidad_id === unidadId && norm(x.partida) === nP);
}

export function descargarPlantillaPresupuesto(proyecto) {
  if (!window.XLSX) { notify('Cargando librería XLSX, intenta en 2 segundos', 'error'); return; }
  if (!proyecto) { notify('Selecciona un proyecto antes de descargar la plantilla', 'error'); return; }
  const unidades = unidadesDelProyecto(proyecto);
  const partidas = partidasObraDelProyecto(proyecto);
  if (!unidades.length) { notify(`No hay unidades activas en ${proyecto}`, 'error'); return; }
  if (!partidas.length) { notify(`No hay partidas de obra en el catálogo para ${proyecto}. Crea el catálogo primero.`, 'error'); return; }

  const fechaTxt = new Date().toISOString().split('T')[0];
  const headerRow = ['Unidad', ...partidas.map(p => p.nombre)];

  function buildSheet(campo) {
    const titleRow = [`${HEADER_ID} — Proyecto: ${proyecto}`];
    const metaRow = [`Generado: ${fechaTxt} · Unidades: ${unidades.length} · Partidas: ${partidas.length}`];
    const data = [titleRow, metaRow, headerRow];
    unidades.forEach(u => {
      const row = [u.nombre];
      partidas.forEach(p => {
        const ex = presupuestoExistente(u.unidad_id, p.nombre);
        const v = ex ? ex[campo] : 0;
        row.push(v && v !== 0 ? v : '');
      });
      data.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    // Anchos: unidad 14, partidas 16
    ws['!cols'] = [{ wch: 14 }, ...partidas.map(() => ({ wch: 16 }))];
    // Freeze primera columna y fila de headers
    ws['!freeze'] = { xSplit: 1, ySplit: 3 };
    return ws;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet('monto_presupuestado'), 'Presupuesto');
  XLSX.utils.book_append_sheet(wb, buildSheet('costo_inicial'), 'Costo Inicial');

  const fn = `Presupuesto_${proyecto.replace(/[^\w]+/g, '_')}_${fechaTxt.replace(/-/g, '')}.xlsx`;
  XLSX.writeFile(wb, fn);
  notify(`Plantilla descargada: ${unidades.length} unidades × ${partidas.length} partidas ✓`, 'success');
}

// Procesa una hoja del Excel y aplica merge sobre state.presupuestoUnidad.
// Devuelve { actualizadas, nuevas, omitidas, avisos }.
function procesarHoja(rows, campo, proyecto, partidasCatalogoNorm) {
  let actualizadas = 0, nuevas = 0, omitidas = 0;
  const avisos = [];
  if (!rows || rows.length < 4) return { actualizadas, nuevas, omitidas, avisos: ['hoja vacía'] };

  // rows[0] = título, rows[1] = meta, rows[2] = headers, rows[3+] = datos
  const headers = rows[2] || [];
  // headers[0] = 'Unidad', headers[1..] = partidas
  const partidaCols = headers.slice(1).map(h => String(h || '').trim());

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
      const partida = partidaCols[c];
      if (!partida) continue;
      const raw = row[c + 1];
      // Celda vacía → no tocar
      if (raw === undefined || raw === null || raw === '') continue;
      const valor = parseFloat(String(raw).replace(/[$,\s]/g, ''));
      if (!isFinite(valor)) {
        avisos.push(`Celda no numérica en ${nombreUnidad} / ${partida} = "${raw}"`);
        continue;
      }
      // Aviso si la partida no está en el catálogo actual
      if (!partidasCatalogoNorm.has(norm(partida))) {
        // Solo el primer aviso por partida desconocida (para no spammear)
        const msg = `Partida "${partida}" no está en catálogo Obra (se aplica igual)`;
        if (!avisos.includes(msg)) avisos.push(msg);
      }

      const existente = presupuestoExistente(unidad.unidad_id, partida);
      if (existente) {
        existente[campo] = valor;
        actualizadas++;
      } else {
        const nuevo = {
          presupuesto_id: state.nextPresupuestoId++,
          unidad_id: unidad.unidad_id,
          partida,
          sub_partida: '',
          monto_presupuestado: campo === 'monto_presupuestado' ? valor : 0,
          costo_inicial: campo === 'costo_inicial' ? valor : 0,
          notas: ''
        };
        state.presupuestoUnidad.push(nuevo);
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
    if (!hojaPres || !hojaInic) {
      notify('⛔ El archivo no tiene las hojas "Presupuesto" y "Costo Inicial"', 'error');
      return;
    }
    const rowsPres = XLSX.utils.sheet_to_json(hojaPres, { header: 1, defval: '' });
    const rowsInic = XLSX.utils.sheet_to_json(hojaInic, { header: 1, defval: '' });

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

    // Construir set normalizado de partidas activas del catálogo
    const partidasCat = partidasObraDelProyecto(proyecto);
    const partidasCatNorm = new Set(partidasCat.map(p => norm(p.nombre)));

    // Confirmación si el alcance es grande
    const numUnidades = (rowsPres.length || 0) - 3;
    const numPartidas = ((rowsPres[2] || []).length || 1) - 1;
    const totalCeldas = numUnidades * numPartidas * 2;
    if (totalCeldas > 200) {
      if (!confirm(`Vas a procesar ${numUnidades} unidades × ${numPartidas} partidas × 2 hojas = hasta ${totalCeldas} celdas para el proyecto "${proyecto}".\n\n¿Continuar?`)) return;
    }

    // Procesar
    const resPres = procesarHoja(rowsPres, 'monto_presupuestado', proyecto, partidasCatNorm);
    const resInic = procesarHoja(rowsInic, 'costo_inicial', proyecto, partidasCatNorm);
    const totales = {
      actualizadas: resPres.actualizadas + resInic.actualizadas,
      nuevas: resPres.nuevas + resInic.nuevas,
      omitidas: resPres.omitidas + resInic.omitidas,
      avisos: [...new Set([...resPres.avisos, ...resInic.avisos])]
    };

    await gsSavePresupuestoUnidad();
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

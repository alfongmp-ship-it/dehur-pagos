// ============================================================================
// 📥 Repartos de obra (solo admin) — reparte facturas SIN reparto con las casas
// que manda la obra en su formato mensual de dispersiones.
//
// Motor puro (leer formato, interpretar reparto, ligar factura, partida) en
// services/repartos-obra.js. Aquí: candados, reglas que dependen de la app (casas
// del proyecto y su cierre vía parseReparto, pagos ligados, catálogo de partidas),
// Excel de vista previa, confirmación y guardado.
//
// Blindajes:
//   - Solo admin; un solo proceso a la vez (sin doble clic).
//   - Solo AGREGA reparto a facturas que NO tienen; lo vuelve a verificar al aplicar.
//   - Cualquier duda (factura ambigua, otro proyecto, proveedor distinto, formato
//     raro, casa inexistente o ya escriturada a la fecha) → "Revisar", no se aplica.
//   - Si un pago ligado con reparto propio también paga OTRA factura sin repartir,
//     no se aplica (su costo dejaría de contarse).
//   - Volver a subir el mismo archivo no duplica: lo ya repartido se salta.
//   - Si el guardado se corta, lo pendiente queda en memoria y el mismo botón reintenta.
// ============================================================================

import { state, esAdmin, nuevoAsignacionId } from '../state.js';
import { fmt, fmtFecha } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { gsSaveCostoAsignaciones } from '../services/google-sync.js';
import { parseReparto } from './solicitudes.js';
import { parseFechaHist } from './historial.js';
import { leerFormatoDispersion, deduplicarFilas, interpretarReparto, emparejarFilas, elegirPartida } from '../services/repartos-obra.js';

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const S = v => String(v == null ? '' : v);
const NECESARIOS = { facturas: 'Facturas', costoAsignaciones: 'Repartos', historial: 'Historial de pagos', facturaPagos: 'Pagos de facturas', unidades: 'Unidades', partidasCatalogo: 'Partidas', proveedores: 'Proveedores' };

let _enCurso = false;   // lectura/guardado en curso: bloquea un segundo clic
let _pendiente = null;  // { partes } cuando el guardado quedó INCOMPLETO (filas aún en memoria)

// Monto por casa que suma EXACTO el total de la factura: los centavos de redondeo
// van a la casa con más % (muy por debajo de la tolerancia de la auditoría).
function _montos(total, asigs) {
  const m = asigs.map(a => r2(total * a.pct / 100));
  const dif = r2(total - m.reduce((s, x) => s + x, 0));
  if (dif && m.length) {
    let k = 0;
    asigs.forEach((a, i) => { if (a.pct > asigs[k].pct) k = i; });
    m[k] = r2(m[k] + dif);
  }
  return m;
}

function _sello() {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return { txt: `${fmtFecha(iso)} ${p2(d.getHours())}:${p2(d.getMinutes())}`, archivo: `${iso}_${p2(d.getHours())}${p2(d.getMinutes())}` };
}

function _progreso(texto) {
  let el = document.getElementById('robra-progreso-flotante');
  if (texto == null) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'robra-progreso-flotante';
    el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#1a1a1a;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.3);';
    document.body.appendChild(el);
  }
  el.textContent = texto;
}

// ---------- Plan (no cambia nada) ----------
function _armarPlan(lect) {
  const ded = deduplicarFilas(lect.filas);
  const filasFact = ded.unicas.filter(f => f.tipo === 'factura');
  const transferencias = ded.unicas.filter(f => f.tipo !== 'factura');

  const provs = new Map((state.proveedores || []).map(p => [S(p.id), p]));
  const idx = (state.facturas || []).map(f => {
    const p = provs.get(S(f.proveedor_id));
    return {
      id: S(f.factura_id), fecha: parseFechaHist(f.fecha_factura), total: Number(f.monto_total) || 0,
      nombres: [f.nombre_proveedor, f.razon_social, p && p.nombre, ...((p && p.aliases) || [])].filter(Boolean),
      valida: (f.tipo_comprobante || 'Factura') === 'Factura' && f.estado_sat !== 'Cancelada' && f.estatus_factura !== 'cancelada',
      f,
    };
  });
  const emp = emparejarFilas(filasFact, idx);

  // Proyecto del formato = el de la mayoría de las facturas ligadas.
  const cuentaProy = new Map();
  emp.filter(r => r.estado === 'ligada').forEach(r => { const p = S(r.factura.f.proyecto); cuentaProy.set(p, (cuentaProy.get(p) || 0) + 1); });
  const proyecto = [...cuentaProy.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || '';

  // Índices de la app
  const asigsFact = new Map(), asigsPago = new Map();
  (state.costoAsignaciones || []).forEach(a => {
    if (a.factura_id) { const k = S(a.factura_id); asigsFact.set(k, [...(asigsFact.get(k) || []), a]); }
    else if (a.pago_id) { const k = S(a.pago_id); asigsPago.set(k, [...(asigsPago.get(k) || []), a]); }
  });
  const histById = new Map((state.historial || []).map(h => [S(h.id), h]));
  const pagosDeFact = new Map(), factsDePago = new Map();
  const liga = (fid, pid) => {
    fid = S(fid); pid = S(pid);
    if (!fid || !pid) return;
    pagosDeFact.set(fid, new Set([...(pagosDeFact.get(fid) || []), pid]));
    factsDePago.set(pid, new Set([...(factsDePago.get(pid) || []), fid]));
  };
  (state.historial || []).forEach(h => { if (h.factura_id != null && S(h.factura_id) !== '') liga(h.factura_id, h.id); });
  (state.facturaPagos || []).forEach(fp => liga(fp.factura_id, fp.pago_id));
  const nombreUnidad = new Map((state.unidades || []).map(u => [S(u.unidad_id), S(u.nombre)]));
  const factPorId = new Map((state.facturas || []).map(f => [S(f.factura_id), f]));
  const canceladas = new Set((state.facturas || []).filter(f => f.estado_sat === 'Cancelada' || f.estatus_factura === 'cancelada').map(f => S(f.factura_id)));

  const partidaDePago = pid => {
    const a = (asigsPago.get(pid) || []).find(x => S(x.partida_override));
    if (a) return { partida: a.partida_override, sub: a.sub_partida_override };
    const h = histById.get(pid);
    return h && S(h.partida) ? { partida: h.partida, sub: h.sub_partida } : null;
  };
  const _histProv = new Map();
  const historialProveedor = (provId, proy) => {
    const k = S(provId) + '|' + proy;
    if (_histProv.has(k)) return _histProv.get(k);
    const out = [];
    (state.facturas || []).forEach(g => {
      if (S(g.proveedor_id) !== S(provId) || S(g.proyecto) !== proy) return;
      const a = (asigsFact.get(S(g.factura_id)) || []).find(x => S(x.partida_override));
      if (a) out.push({ partida: a.partida_override, sub: a.sub_partida_override });
    });
    (state.historial || []).forEach(h => {
      if (S(h.proveedor_id) !== S(provId) || S(h.proyecto) !== proy) return;
      const p = partidaDePago(S(h.id));
      if (p) out.push(p);
    });
    _histProv.set(k, out);
    return out;
  };

  const aplicar = [], revisar = [], noEncontradas = [], yaTenian = [];
  const ACC = {
    formato: 'Corrige el renglón en el Excel de la obra y vuelve a subirlo (lo ya repartido se salta solo)',
    cierre: 'Si la casa NO estaba escriturada, corrige su fecha de escrituración y vuelve a subir; si sí, quítala del renglón',
    ambigua: 'Repártela a mano en Facturas (📊 Repartir) eligiendo la factura correcta',
    proveedor: 'Si es el mismo proveedor, pon en el Excel el nombre que tiene en la app y vuelve a subirlo',
    proyecto: 'Revisa el proyecto de esa factura en la app',
    pago: 'Reparte primero (o en el mismo archivo) la otra factura que paga ese pago',
  };
  const aRevisar = (r, motivo, accion, extra = {}) => revisar.push({ r, fila: r.fila, motivo, accion, ...extra });

  emp.forEach(r => {
    const fila = r.fila;
    const interp = interpretarReparto(fila.reparto, fila.aplicacion);
    if (r.estado === 'no_encontrada') { noEncontradas.push({ r, fila, motivo: r.motivo, interp }); return; }
    if (r.estado !== 'ligada') {
      aRevisar(r, r.motivo, r.estado === 'proveedor' ? ACC.proveedor : r.estado === 'ambigua' ? ACC.ambigua : ACC.formato, { candidatos: r.candidatos });
      return;
    }
    const f = r.factura.f;
    const fid = S(f.factura_id);
    if (asigsFact.has(fid)) { yaTenian.push({ r, fila, f, interp, asigs: asigsFact.get(fid) }); return; }
    if (S(f.proyecto) !== proyecto) { aRevisar(r, `La factura #${fid} es del proyecto "${f.proyecto}" (el formato es de "${proyecto}")`, ACC.proyecto, { f }); return; }
    if (!interp.ok) { aRevisar(r, interp.motivo, ACC.formato, { f }); return; }
    const fechaF = parseFechaHist(f.fecha_factura);
    const pr = parseReparto(interp.metodo, interp.codigos.join('/'), f.proyecto, fechaF);
    if (pr.errores && pr.errores.length) { aRevisar(r, pr.errores[0], /cerrada|escriturada/i.test(pr.errores[0]) ? ACC.cierre : ACC.formato, { f }); return; }
    const asigs = pr.asignaciones || [];
    const noExisten = asigs.filter(a => !a.unidad_id).map(a => a.casa);
    if (noExisten.length) { aRevisar(r, `La(s) casa(s) ${noExisten.join(', ')} no existe(n) en ${f.proyecto}`, ACC.formato, { f }); return; }
    const sumaPct = asigs.reduce((s, a) => s + (a.pct || 0), 0);
    if (!asigs.length || Math.abs(sumaPct - 100) > 0.01) { aRevisar(r, `El reparto no suma 100% (${sumaPct.toFixed(2)}%)`, ACC.formato, { f }); return; }

    const pids = [...(pagosDeFact.get(fid) || [])];
    const dePago = pids.map(partidaDePago).filter(Boolean);
    const par = elegirPartida({ indicada: { partida: fila.partida, sub: fila.subpartida }, dePago, historial: historialProveedor(f.proveedor_id, S(f.proyecto)), concepto: [fila.concepto, fila.particular], catalogo: state.partidasCatalogo || [] });
    if (par.error) { aRevisar(r, par.error, fila.partida ? 'Corrige la Partida / Sub-partida del renglón (nombre exacto del catálogo) y vuelve a subirlo' : 'Revisa el catálogo de partidas', { f }); return; }

    const casasNuevas = new Set(asigs.map(a => S(a.unidad_id)));
    const pagos = pids.map(pid => {
      const h = histById.get(pid);
      const propias = asigsPago.get(pid) || [];
      const casas = new Set(propias.map(a => S(a.unidad_id)));
      const mismas = casas.size === casasNuevas.size && [...casas].every(c => casasNuevas.has(c));
      return {
        pid, h, conReparto: propias.length > 0, otras: [...(factsDePago.get(pid) || [])].filter(g => g !== fid),
        txt: `Pago #${pid}${h ? ' ' + fmt(Number(h.importe) || 0) : ''}: ` + (propias.length
          ? `tenía reparto propio en ${casas.size} casa(s)${mismas ? ' (las mismas)' : ' (DISTINTAS)'} → deja de contar, ahora cuenta la factura`
          : 'sin reparto propio'),
      };
    });
    const notas = [interp.nota];
    if (r.via === 'cercana') notas.push(`fecha de la obra distinta (${r.dias > 0 ? '+' : ''}${r.dias} días)`);
    if (r.via === 'gemela') notas.push('renglón repetido en la hoja con su factura gemela (mismo reparto)');
    if (Math.abs((Number(f.monto_total) || 0) - fila.importe) >= 0.005) notas.push(`importe de la obra ${fmt(fila.importe)} vs app ${fmt(Number(f.monto_total) || 0)} (centavo de redondeo)`);
    if (par.fuente === 'por defecto') notas.push('partida por defecto: revísala');
    aplicar.push({ r, fila, f, fid, total: Number(f.monto_total) || 0, metodo: pr.metodo, asigs, partida: par.partida, sub: par.sub, fuente: par.fuente, pagos, notas: notas.filter(Boolean) });
  });

  // Pago ligado con reparto propio que TAMBIÉN paga otra factura sin repartir: al
  // repartir ésta, el pago entero deja de contar y la parte de la otra se perdería.
  // Se repite hasta que no cambie (sacar una puede afectar a otra).
  let cambio = true;
  while (cambio) {
    cambio = false;
    const ids = new Set(aplicar.map(x => x.fid));
    for (let i = aplicar.length - 1; i >= 0; i--) {
      const x = aplicar[i];
      const malo = x.pagos.find(p => p.conReparto && p.otras.some(g => !asigsFact.has(g) && !ids.has(g) && !canceladas.has(g) && factPorId.has(g)));
      if (!malo) continue;
      const g = malo.otras.find(gg => !asigsFact.has(gg) && !ids.has(gg) && !canceladas.has(gg) && factPorId.has(gg));
      aplicar.splice(i, 1);
      aRevisar(x.r, `El pago #${malo.pid} (con reparto propio) también paga la Fac ${g}, que no tiene reparto: al repartir ésta, ese pago deja de contar y el costo de la Fac ${g} se perdería`, ACC.pago, { f: x.f });
      cambio = true;
    }
  }
  // Defensa: una factura nunca se reparte dos veces en la misma carga.
  const vistas = new Map();
  aplicar.forEach(x => vistas.set(x.fid, (vistas.get(x.fid) || 0) + 1));
  for (let i = aplicar.length - 1; i >= 0; i--) {
    if (vistas.get(aplicar[i].fid) > 1) { const x = aplicar.splice(i, 1)[0]; aRevisar(x.r, `Dos renglones apuntan a la Fac ${x.fid}`, ACC.ambigua, { f: x.f }); }
  }

  const casasTxt = asigs => asigs.map(a => nombreUnidad.get(S(a.unidad_id)) || a.casa || S(a.unidad_id));
  yaTenian.forEach(y => {
    const app = new Set(casasTxt(y.asigs));
    const metApp = S(y.asigs[0] && y.asigs[0].metodo);
    y.metodoApp = metApp;
    y.casasApp = [...app].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!y.interp.ok) { y.coincide = '— (el formato no es válido: ' + y.interp.motivo + ')'; return; }
    if (y.interp.metodo === 'indiviso') { y.coincide = metApp === 'indiviso' ? 'sí' : `no: la obra dice INDIVISO y la app tiene ${metApp}`; return; }
    const obra = new Set(y.interp.codigos);
    const faltan = [...obra].filter(c => !app.has(c));
    const sobran = [...app].filter(c => !obra.has(c));
    y.coincide = !faltan.length && !sobran.length ? 'sí' : `no${faltan.length ? ' · faltan ' + faltan.join(', ') : ''}${sobran.length ? ' · sobran ' + sobran.join(', ') : ''}`;
  });

  return { ded, emp, proyecto, aplicar, revisar, noEncontradas, yaTenian, transferencias, filasFact, casasTxt };
}

// ---------- Excel de vista previa ----------
function _excelVistaPrevia(nombres, lect, plan, sello) {
  const wb = XLSX.utils.book_new();
  const hoja = (nombre, aoa, anchos, cMoney = [], filtro = true) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = anchos.map(w => ({ wch: w }));
    for (let r = 1; r < aoa.length; r++) cMoney.forEach(c => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00';
    });
    if (filtro && aoa.length > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  };
  const origen = f => `${f.archivo} · ${f.hoja} · renglón ${f.renglon}`;
  const obra = f => [fmtFecha(f.fecha) || f.fechaTxt, f.proveedor, f.concepto, f.particular, f.importe, f.aplicacion, f.reparto];
  const encObra = ['Fecha (obra)', 'Proveedor (obra)', 'Concepto', 'Descripción particular', 'Importe (obra)', 'Aplicación (obra)', 'Reparto (obra)'];
  const fac = f => (f ? [S(f.factura_id), S(f.numero_factura), S(f.nombre_proveedor || f.razon_social), fmtFecha(f.fecha_factura), Number(f.monto_total) || 0] : ['', '', '', '', '']);
  const encFac = ['Factura (ID)', 'Folio', 'Proveedor (app)', 'Fecha (app)', 'Total neto (app)'];
  const tot = l => r2(l.reduce((s, x) => s + (x.fila.importe || 0), 0));

  const resumen = [
    [`Repartos de obra — vista previa (${plan.proyecto || 'sin proyecto detectado'})`],
    [`Corte: ${sello.txt} · Archivo(s): ${nombres.join(', ')}`],
    ['Solo AGREGA reparto (devengado) a facturas que NO tenían. No cambia montos, facturas, pagos ni repartos existentes.'],
    [],
    ['Facturas del formato', 'Renglones', 'Importe'],
    ['Se reparten', plan.aplicar.length, tot(plan.aplicar)],
    ['Revisar (no se aplican)', plan.revisar.length, tot(plan.revisar)],
    ['No están en la app', plan.noEncontradas.length, tot(plan.noEncontradas)],
    ['Ya tenían reparto (no se tocan)', plan.yaTenian.length, tot(plan.yaTenian)],
    ['TOTAL renglones FACTURA', plan.filasFact.length, r2(plan.filasFact.reduce((s, f) => s + (f.importe || 0), 0))],
    [],
    ['Transferencias y otros (no se tocan: son pagos)', plan.transferencias.length],
    ['Renglones repetidos en otra hoja (se cuentan una vez)', plan.ded.repetidas.length],
    ['Renglones sin reparto ni casas', plan.ded.sinReparto.length],
    [],
    ['Ya tenían reparto: coinciden con la obra', plan.yaTenian.filter(y => y.coincide === 'sí').length],
    ['Ya tenían reparto: NO coinciden (solo aviso)', plan.yaTenian.filter(y => y.coincide !== 'sí').length],
    [],
    ['Hojas leídas', ...lect.hojasLeidas.map(h => `${h.archivo} · ${h.hoja} (${h.renglones})`)],
    ...(lect.hojasIgnoradas.length ? [['Hojas ignoradas', ...lect.hojasIgnoradas.map(h => `${h.archivo} · ${h.hoja}: ${h.motivo}`)]] : []),
  ];
  hoja('Resumen', resumen, [52, 14, 18], [2], false);

  hoja('Se reparten', [[...encFac, ...encObra, 'Método que se aplica', 'Casas', 'Lista de casas', 'Partida', 'Sub-partida', 'De dónde salió la partida', 'Cómo se encontró', 'Pagos ligados', 'Notas', 'Origen en el formato'],
    ...plan.aplicar.map(x => [...fac(x.f), ...obra(x.fila), x.metodo, x.asigs.length, plan.casasTxt(x.asigs).join(', '), x.partida, x.sub, x.fuente,
      x.r.via === 'cercana' ? `fecha cercana (${x.r.dias} días)` : x.r.via === 'gemela' ? 'fecha exacta (gemela)' : 'fecha exacta',
      x.pagos.map(p => p.txt).join(' | '), x.notas.join(' · '), origen(x.fila)])],
  [10, 12, 30, 11, 14, 11, 30, 26, 26, 14, 40, 11, 10, 50, 16, 26, 26, 18, 60, 40, 50], [4, 9]);

  hoja('Reparto por casa', [['Factura (ID)', 'Proveedor (app)', 'Casa', '% de la factura', 'Monto a la casa', 'Método', 'Partida', 'Sub-partida'],
    ...plan.aplicar.flatMap(x => { const m = _montos(x.total, x.asigs); return x.asigs.map((a, i) => [x.fid, S(x.f.nombre_proveedor), plan.casasTxt([a])[0], Math.round(a.pct * 10000) / 10000, m[i], x.metodo, x.partida, x.sub]); })],
  [10, 30, 8, 12, 14, 11, 16, 26], [4]);

  hoja('Revisar (no se aplican)', [['Motivo', 'Qué hacer', ...encObra, 'Factura en la app (o candidatas)', 'Origen en el formato'],
    ...plan.revisar.map(x => [x.motivo, x.accion, ...obra(x.fila),
      x.f ? `#${x.f.factura_id}` : (x.candidatos || []).map(c => '#' + c.id + ' ' + fmtFecha(c.fecha)).join(', '), origen(x.fila)])],
  [70, 50, 11, 30, 26, 26, 14, 40, 11, 24, 50], [6]);

  hoja('No están en la app', [[...encObra, 'Detalle', '¿El reparto de la obra es válido?', 'Origen en el formato'],
    ...plan.noEncontradas.map(x => [...obra(x.fila), x.motivo, x.interp.ok ? 'sí' : x.interp.motivo, origen(x.fila)])],
  [11, 30, 26, 26, 14, 40, 11, 50, 40, 50], [4]);

  hoja('Ya tenían reparto', [[...encFac, 'Método en la app', 'Casas en la app', 'Reparto (obra)', 'Aplicación (obra)', '¿Coincide con la obra?', 'Origen en el formato'],
    ...plan.yaTenian.map(y => [...fac(y.f), y.metodoApp, y.casasApp.length > 12 ? `${y.casasApp.length} casas` : y.casasApp.join(', '), y.fila.reparto, y.fila.aplicacion, y.coincide, origen(y.fila)])],
  [10, 12, 30, 11, 14, 12, 40, 12, 40, 40, 50], [4]);

  hoja('Transferencias (no se tocan)', [['Tipo', ...encObra, 'Origen en el formato'],
    ...plan.transferencias.map(f => [f.tipoTxt, ...obra(f), origen(f)])],
  [14, 11, 30, 26, 26, 14, 40, 11, 50], [5]);

  hoja('Repetidos y sin reparto', [['Qué pasa', 'Tipo', ...encObra, 'Origen', 'Igual a'],
    ...plan.ded.repetidas.map(x => [x.conflicto ? 'CONFLICTO: mismo renglón con otro reparto (no se aplica ninguno)' : x.vacia ? 'Copia sin reparto (se usa la que sí lo tiene)' : 'Repetido en otra hoja (se cuenta una vez)', x.fila.tipoTxt, ...obra(x.fila), origen(x.fila), origen(x.igualA)]),
    ...plan.ded.sinReparto.map(f => ['Sin reparto ni casas en el formato', f.tipoTxt, ...obra(f), origen(f), ''])],
  [46, 14, 11, 30, 26, 26, 14, 40, 11, 50, 50], [6]);

  XLSX.writeFile(wb, `Repartos_obra_vista_previa_${sello.archivo}.xlsx`);
}

// ---------- Aplicar y guardar ----------
function _aplicar(plan) {
  // Verificación AL APLICAR (no al leer): si alguien repartió una de éstas mientras
  // veías la vista previa, aquí se salta.
  const repartidas = new Set((state.costoAsignaciones || []).filter(a => a.factura_id).map(a => S(a.factura_id)));
  const hoyISO = new Date().toISOString().slice(0, 10);
  const saltadas = [];
  let facturas = 0, filas = 0;
  plan.aplicar.forEach(x => {
    const f = (state.facturas || []).find(ff => S(ff.factura_id) === x.fid);
    if (!f) { saltadas.push(`Fac ${x.fid}: ya no existe`); return; }
    if (repartidas.has(x.fid)) { saltadas.push(`Fac ${x.fid}: alguien la repartió mientras`); return; }
    if (f.estado_sat === 'Cancelada' || f.estatus_factura === 'cancelada') { saltadas.push(`Fac ${x.fid}: está cancelada`); return; }
    if (Math.abs((Number(f.monto_total) || 0) - x.total) > 0.005) { saltadas.push(`Fac ${x.fid}: cambió su monto`); return; }
    const montos = _montos(Number(f.monto_total) || 0, x.asigs);
    x.asigs.forEach((a, i) => {
      state.costoAsignaciones.push({
        asignacion_id: nuevoAsignacionId(),
        pago_id: '',
        factura_id: x.fid,
        unidad_id: a.unidad_id,
        proyecto: f.proyecto,
        metodo: x.metodo,
        monto_asignado: montos[i],
        factor: a.pct / 100,
        fecha_asignacion: hoyISO,
        partida_override: x.partida,
        sub_partida_override: x.sub,
        partida_obra: ''
      });
      filas++;
    });
    repartidas.add(x.fid);
    facturas++;
  });
  return { facturas, filas, saltadas };
}

async function _guardar(partes) {
  _progreso('Guardando repartos… no cierres ni recargues la app');
  try {
    const res = await gsSaveCostoAsignaciones({
      onProgress: (k, n) => _progreso(`Guardando ${k} de ${n} asignaciones… no cierres ni recargues la app`)
    });
    if (res && res.ok) {
      _pendiente = null;
      notify([...partes, `${res.subidas} asignaciones guardadas`].join(' · '));
    } else {
      _pendiente = { partes };
      const motivo = res ? (res.error || res.motivo || 'error desconocido') : 'sin respuesta';
      notify(`⛔ ${res ? res.pendientes : '?'} asignaciones NO se guardaron (${motivo}). No recargues: vuelve a pulsar "📥 Repartos de obra" para reintentar el guardado.`, 'error');
    }
  } catch (e) {
    _pendiente = { partes };
    notify(`⛔ Se cortó el guardado (${(e && e.message) || e}). No recargues: vuelve a pulsar "📥 Repartos de obra" para reintentar.`, 'error');
  } finally {
    _progreso(null);
    if (window.renderFacturas) window.renderFacturas();
  }
}

async function _procesar(files) {
  if (_enCurso) { notify('Ya hay una carga de repartos de obra en curso; espera a que termine', 'error'); return; }
  _enCurso = true;
  try {
    _progreso('Leyendo el formato de la obra…');
    const hojas = [];
    for (const file of files) {
      let wb;
      try {
        wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      } catch (e) {
        notify(`No pude leer "${file.name}": ${(e && e.message) || e}. No se cambió nada.`, 'error');
        return;
      }
      wb.SheetNames.forEach(n => {
        const ws = wb.Sheets[n];
        if (!ws || !ws['!ref']) return;
        hojas.push({ archivo: file.name, nombre: n, filaInicial: XLSX.utils.decode_range(ws['!ref']).s.r,
          filas: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true }) });
      });
    }
    const lect = leerFormatoDispersion(hojas);
    if (!lect.hojasLeidas.length) {
      notify('Ese archivo no es el formato de dispersión de la obra: no encontré los encabezados Fecha, Tipo, Proveedor, Importe, Aplicación y Reparto. No se cambió nada.', 'error');
      return;
    }
    const plan = _armarPlan(lect);
    const nombres = files.map(f => f.name);
    _excelVistaPrevia(nombres, lect, plan, _sello());
    _progreso(null);
    const totalAp = r2(plan.aplicar.reduce((s, x) => s + x.total, 0));
    const resumen = `• Se reparten: ${plan.aplicar.length} (${fmt(totalAp)})\n`
      + `• Revisar (no se aplican): ${plan.revisar.length}\n`
      + `• No están en la app: ${plan.noEncontradas.length}\n`
      + `• Ya tenían reparto (no se tocan): ${plan.yaTenian.length}\n`
      + `• Transferencias (no se tocan): ${plan.transferencias.length}`;
    if (!plan.aplicar.length) {
      notify(`Nada que repartir.\n${resumen}\nSe descargó el Excel con el detalle de cada renglón.`, 'error');
      return;
    }
    const texto = `📥 Repartos de obra — ${plan.proyecto}\n${nombres.join(', ')}\n\n`
      + `Renglones FACTURA en el formato: ${plan.filasFact.length}\n${resumen}\n\n`
      + `Se descargó un Excel con el detalle de cada renglón ("Se reparten", "Revisar", "Reparto por casa"…).\n`
      + `Solo AGREGA reparto a facturas que NO tenían. No cambia montos, facturas, pagos ni repartos existentes; todo queda en la bitácora.\n\n`
      + `¿Repartir ${plan.aplicar.length} factura(s)?`;
    if (!confirm(texto)) return;
    const res = _aplicar(plan);
    const partes = [`✓ ${res.facturas} factura(s) repartida(s) con el formato de la obra`];
    if (res.saltadas.length) partes.push(`saltadas: ${res.saltadas.length} (${res.saltadas[0]}${res.saltadas.length > 1 ? '…' : ''})`);
    if (!res.filas) { notify(partes.join(' · '), 'error'); return; }
    await _guardar(partes);
  } catch (e) {
    console.error('Repartos de obra:', e);
    notify(`⛔ Algo falló al leer el formato (${(e && e.message) || e}). No se cambió nada.`, 'error');
  } finally {
    _enCurso = false;
    _progreso(null);
  }
}

// ---------- 📥 Repartos de obra ----------
export function subirRepartosObra() {
  if (!esAdmin()) { notify('Solo el admin puede subir repartos de obra', 'error'); return; }
  if (_enCurso) { notify('Ya hay una carga de repartos de obra en curso; espera a que termine', 'error'); return; }
  if (_pendiente) {
    // Guardado anterior incompleto: lo pendiente sigue en memoria → solo reintenta subirlo.
    _enCurso = true;
    _guardar(_pendiente.partes).finally(() => { _enCurso = false; });
    return;
  }
  const falta = Object.keys(NECESARIOS).filter(e => !state.cargado || state.cargado[e] !== true);
  if (falta.length) { notify(`No se cargaron bien: ${falta.map(e => NECESARIOS[e]).join(', ')}. Recarga la página antes de subir repartos.`, 'error'); return; }
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls,.xlsm';
  inp.multiple = true;
  inp.onchange = () => { const fs = inp.files ? [...inp.files] : []; if (fs.length) _procesar(fs); };
  inp.click();
}

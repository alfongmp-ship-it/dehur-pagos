// ============================================================================
// 📤 Exportar repartos (solo admin, SOLO LECTURA). Excel del proyecto activo de
// Costos por Unidad: cada pago/factura repartido (método, casas, partida, si
// cuenta para el costo y si ♻️ lo puede recolocar) + las unidades con su
// indiviso y su cierre. Sirve para revisar ANTES de dar de alta casas nuevas
// (♻️ las metería en los repartos por indiviso). No modifica nada.
// ============================================================================
import { state, esAdmin } from '../state.js';
import { fmtFecha } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { fechaCierreUnidad, METODO_LABEL } from '../config/costos-fiscales.js';
import { proyectoCostosActivo, _tipoAsignacion, _pagosCubiertosPorFacturaSet, _facturasCanceladasSet, _pagosCapitalSet } from './costos-fiscales.js';
import { motivoNoRecolocaPago, motivoNoRecolocaFactura } from './confirmar-pagos.js';

const S = v => (v == null ? '' : String(v));
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const uniq = arr => [...new Set(arr)];
// DD/MM/YYYY (o ISO) → ISO, solo para ordenar.
const iso = f => {
  const s = S(f).trim();
  if (s.includes('-') && s.length >= 10) return s.slice(0, 10);
  const p = s.split('/'); return p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : '';
};

function _sello() {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
}

export function exportarRepartosProyecto() {
  if (!esAdmin()) { notify('Solo el admin puede exportar los repartos', 'error'); return; }
  // Sin los datos completos un reparto sano parecería "ya no existe": no se exporta a medias.
  const faltan = ['costoAsignaciones', 'facturas', 'historial', 'unidades', 'facturaPagos'].filter(k => state.cargado && state.cargado[k] !== true);
  if (faltan.length) { notify(`No se puede exportar: no cargó completo (${faltan.join(', ')}). Recarga la página.`, 'error'); return; }
  const proyecto = proyectoCostosActivo();
  if (!proyecto) { notify('Selecciona un proyecto', 'error'); return; }
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }

  const uById = new Map((state.unidades || []).map(u => [S(u.unidad_id), u]));
  const hById = new Map((state.historial || []).map(h => [S(h.id), h]));
  const fById = new Map((state.facturas || []).map(f => [S(f.factura_id), f]));
  const cub = _pagosCubiertosPorFacturaSet(), canc = _facturasCanceladasSet(), cap = _pagosCapitalSet();
  const fe = new Set(fById.keys()), pe = new Set(hById.keys());

  // Documentos con reparto en el proyecto (la fila manda; si no trae proyecto, el del documento).
  const docs = new Map();
  (state.costoAsignaciones || []).forEach(a => {
    const esF = S(a.factura_id) !== '';
    const ref = esF ? S(a.factura_id) : S(a.pago_id);
    if (!ref) return;
    const doc = esF ? fById.get(ref) : hById.get(ref);
    if ((S(a.proyecto) || S(doc && doc.proyecto)) !== proyecto) return;
    const k = (esF ? 'F' : 'P') + ref;
    if (!docs.has(k)) docs.set(k, { esF, ref, doc, asigs: [] });
    docs.get(k).asigs.push(a);
  });

  const nombreCasa = id => S((uById.get(S(id)) || {}).nombre) || `Unidad ${id}`;
  const ordenCasa = id => { const u = uById.get(S(id)); return u ? (Number(u.orden) || 0) : 1e9; };
  const filas = [...docs.values()].map(d => {
    const { esF, ref, doc, asigs } = d;
    const total = doc ? Number(esF ? doc.monto_total : doc.importe) || 0 : 0;
    const fecha = doc ? (esF ? doc.fecha_factura : doc.fecha) : '';
    const partidaDe = a => a.partida_override || (!esF && doc ? doc.partida : '') || '';
    const subDe = a => (a.partida_override ? a.sub_partida_override : (a.sub_partida_override || (!esF && doc ? doc.sub_partida : ''))) || '';
    const casas = uniq(asigs.map(a => S(a.unidad_id))).sort((x, y) => ordenCasa(x) - ordenCasa(y) || nombreCasa(x).localeCompare(nombreCasa(y), 'es', { numeric: true }));
    // ¿Cuenta para el costo? Misma regla que la app (_tipoAsignacion), con el motivo.
    const cuenta = _tipoAsignacion(asigs[0], cub, canc, fe, pe, cap) ? 'Sí'
      : esF ? (!doc ? 'No: la factura ya no existe' : 'No: factura cancelada')
        : !doc ? 'No: el pago ya no existe' : cap.has(ref) ? 'No: capital de crédito' : 'No: lo lleva su factura';
    const motivo = esF ? motivoNoRecolocaFactura(doc) : motivoNoRecolocaPago(doc);
    return {
      iso: iso(fecha),
      fila: [esF ? 'Factura' : 'Pago', esF ? Number(ref) || ref : ref, fmtFecha(fecha),
        doc ? S(esF ? (doc.nombre_proveedor || doc.razon_social) : doc.nombre) : '',
        doc ? S(esF ? doc.observaciones : doc.concepto) : '', doc ? S(doc.proyecto) : '',
        r2(total), r2(asigs.reduce((s, a) => s + (Number(a.monto_asignado) || 0), 0)),
        uniq(asigs.map(a => METODO_LABEL[a.metodo] || a.metodo || '(sin método)')).join(' + '),
        casas.length, casas.map(nombreCasa).join(', '),
        uniq(asigs.map(partidaDe)).map(p => p || '(sin partida)').join(' | '),
        uniq(asigs.map(subDe)).filter(Boolean).join(' | '),
        cuenta, motivo ? 'No' : 'Sí', motivo],
    };
  }).sort((a, b) => a.iso.localeCompare(b.iso));

  if (!filas.length) { notify(`${proyecto}: no hay pagos ni facturas repartidos`, 'error'); return; }

  const money = (ws, r0, cols, n) => {
    for (let r = r0; r < n; r++) cols.forEach(c => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00';
    });
  };
  const wb = XLSX.utils.book_new();

  const enc = ['Tipo', 'ID', 'Fecha', 'Proveedor / Beneficiario', 'Concepto', 'Proyecto del documento', 'Total del documento', 'Total repartido',
    'Método', '# casas', 'Casas', 'Partida', 'Sub-partida', '¿Cuenta para el costo?', '¿♻️ lo puede recolocar?', 'Por qué no'];
  const aoa = [enc, ...filas.map(f => f.fila)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [8, 10, 11, 32, 36, 18, 15, 15, 26, 8, 60, 26, 26, 24, 12, 44].map(wch => ({ wch }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: enc.length - 1 } }) };
  money(ws, 1, [6, 7], aoa.length);

  const unidades = (state.unidades || []).filter(u => S(u.proyecto) === proyecto)
    .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0) || S(a.nombre).localeCompare(S(b.nombre), 'es', { numeric: true }));
  const aoaU = [['Casa', 'unidad_id', 'Tipo', 'Indiviso %', 'Superficie m²', 'Estatus', 'Escritura (cierre)', 'Activa'],
    ...unidades.map(u => [S(u.nombre), Number(u.unidad_id) || S(u.unidad_id), S(u.tipo), Number(u.indiviso_pct) || 0, Number(u.superficie_m2) || 0,
      S(u.estatus), fmtFecha(fechaCierreUnidad(u)), u.activo === false ? 'No' : 'Sí'])];
  const wsU = XLSX.utils.aoa_to_sheet(aoaU);
  wsU['!cols'] = [12, 10, 10, 11, 13, 14, 16, 8].map(wch => ({ wch }));

  const nDoc = t => filas.filter(f => f.fila[0] === t).length;
  const siRec = filas.filter(f => f.fila[14] === 'Sí');
  const aoaR = [[`Repartos de ${proyecto}`], [`Generado: ${fmtFecha(new Date().toISOString().slice(0, 10))} · solo lectura, no cambió nada`], [],
    ['Documentos con reparto', filas.length], ['Pagos', nDoc('Pago')], ['Facturas', nDoc('Factura')],
    ['Cuentan para el costo', filas.filter(f => f.fila[13] === 'Sí').length],
    ['♻️ los puede recolocar (por indiviso automático)', siRec.length, r2(siRec.reduce((s, f) => s + f.fila[7], 0))],
    ['Unidades del proyecto', unidades.length, r2(unidades.reduce((s, u) => s + (Number(u.indiviso_pct) || 0), 0)) + '% de indiviso']];
  const wsR = XLSX.utils.aoa_to_sheet(aoaR);
  wsR['!cols'] = [{ wch: 46 }, { wch: 10 }, { wch: 18 }];
  money(wsR, 7, [2], 8);

  XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');
  XLSX.utils.book_append_sheet(wb, ws, 'Documentos');
  XLSX.utils.book_append_sheet(wb, wsU, 'Unidades');
  XLSX.writeFile(wb, `Repartos_${String(proyecto).replace(/[\\/:*?"<>|\s]+/g, '_')}_${_sello()}.xlsx`);
  notify(`📤 Exportado: ${filas.length} documento(s) de ${proyecto} · ${siRec.length} los puede recolocar ♻️ — solo lectura`);
}

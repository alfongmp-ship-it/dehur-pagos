// ============================================================================
// Motor PURO de la auditoría de repartos (🩺 Auditar repartos). Sin imports: recibe
// los datos y las reglas de la app como parámetros, para poder probarlo en node
// (patrón de lotes-asignaciones.js / rmf-324.js). SOLO LEE: nunca modifica nada.
//
// Nació de la auditoría de código del 2026-09-30 (91 hallazgos, 86 confirmados):
// cada categoría es la FIRMA EN LOS DATOS de un problema real del código, para
// medir el daño antes de reparar (decisión del dueño: medir → blindar → reparar).
// ============================================================================

// Severidades: ERROR = el costo por casa está mal · REVISAR = puede estar mal o
// ser legítimo · INFO = no afecta el costo hoy pero conviene saberlo.
export const CATEGORIAS = [
  { key: 'posterior_cierre', titulo: 'Costo posterior al CIERRE de la casa',
    accion: 'Quitar esa casa del reparto del documento (la casa ya estaba escriturada a la fecha del documento).' },
  { key: 'terminada_sin_fecha', titulo: 'Casa fuera de obra SIN fecha de escrituración',
    accion: 'Capturar su fecha real de escrituración: sin ella sigue absorbiendo costo por indiviso.' },
  { key: 'sobre_repartido', titulo: 'Documento SOBRE-repartido (reparto > total)',
    accion: 'Limpiar el reparto del documento y repartirlo de nuevo (típico de ♻️/🔍 o de editar el total en facturas por partes).' },
  { key: 'pago_sub_repartido', titulo: 'Pago repartido de MENOS (reparto < importe)',
    accion: 'Completar el reparto del pago o revisar si el importe cambió después de repartir.' },
  { key: 'duplicado', titulo: 'Casa DUPLICADA en el mismo documento y partida',
    accion: 'Borrar la fila repetida: la casa está recibiendo el costo dos veces.' },
  { key: 'por_partes', titulo: 'Documento repartido POR PARTES (varias filas por casa)',
    accion: 'Solo informativo: es válido, pero ♻️/🔍 ya no lo tocan. Revisar a mano si cambian fechas o montos.' },
  { key: 'huerfana', titulo: 'Reparto HUÉRFANO (el documento ya no existe)',
    accion: 'Borrar esas filas (Costos por Unidad → Limpiar huérfanas), confirmando antes que los datos cargaron completos.' },
  { key: 'casa_invalida', titulo: 'Casa inexistente, dada de baja o de otro proyecto',
    accion: 'Reasignar ese costo a la casa correcta o quitarlo del reparto.' },
  { key: 'comprobante_no_factura', titulo: 'Nota de crédito / complemento / otro comprobante repartido',
    accion: 'Quitar su reparto: no es costo (en gerencial suma como si lo fuera).' },
  { key: 'factura_cancelada', titulo: 'Factura CANCELADA con reparto',
    accion: 'Quitar su reparto (o revisar si la cancelación es correcta).' },
  { key: 'pago_suprimido', titulo: 'Pago con reparto propio cubierto por su factura',
    accion: 'Solo informativo: ese reparto no cuenta (lo cubre la factura). Se puede limpiar.' },
  { key: 'pago_aplicacion_parcial', titulo: 'Pago aplicado solo EN PARTE a facturas repartidas',
    accion: 'El resto del pago no cuenta en ningún costo: aplicar el resto a su factura o repartirlo.' },
  { key: 'fecha_invalida', titulo: 'Documento con fecha vacía o ilegible',
    accion: 'Corregir la fecha: sin ella no se puede saber qué casas estaban abiertas.' },
  { key: 'factor_incoherente', titulo: 'Proporción guardada que no cuadra con el monto',
    accion: 'Revisar el reparto: el % guardado no corresponde al monto asignado.' },
  { key: 'monto_no_positivo', titulo: 'Fila de reparto con monto cero o negativo',
    accion: 'Borrar la fila o corregir el monto.' },
];
const _CAT = new Map(CATEGORIAS.map((c, i) => [c.key, { ...c, orden: i }]));

const _TOL = 0.5;   // pesos: diferencias menores son redondeo del reparto

// datos: { asigs, facturas, historial, unidades, facturaPagos }
// reglas: {
//   parseFecha(str) → 'YYYY-MM-DD' | '',
//   cierreDe(unidad) → 'YYYY-MM-DD' | ''   (terminación o escritura, la más temprana),
//   proyMatch(a, b) → bool                 (mismo criterio de proyecto que la app),
//   cubiertos: Set(pago_id)                (pagos suprimidos por su factura repartida),
//   capital:   Set(pago_id)  [opcional]    (pagos de capital: la app no los cuenta),
// }
// Filas de documentos que la app NO cuenta en el costo (suprimidos, cancelados en el
// SAT, capital) se bajan a INFO: no son "el costo por casa está mal".
// Devuelve una lista plana de hallazgos (una fila por problema).
export function auditarRepartosMotor(datos, reglas) {
  const asigs = datos.asigs || [];
  const facById = new Map((datos.facturas || []).map(f => [String(f.factura_id), f]));
  const pagoById = new Map((datos.historial || []).map(h => [String(h.id), h]));
  const uById = new Map((datos.unidades || []).map(u => [String(u.unidad_id), u]));
  const cubiertos = reglas.cubiertos || new Set();
  const capital = reglas.capital || new Set();
  const out = [];

  // --- agrupar por documento ---
  const docs = new Map();
  for (const a of asigs) {
    const esF = a.factura_id != null && String(a.factura_id) !== '';
    const id = String(esF ? a.factura_id : (a.pago_id == null ? '' : a.pago_id));
    const k = (esF ? 'F' : 'P') + id;
    let d = docs.get(k);
    if (!d) {
      d = { tipo: esF ? 'factura' : 'pago', id, doc: esF ? facById.get(id) : pagoById.get(id), asigs: [] };
      docs.set(k, d);
    }
    d.asigs.push(a);
  }

  for (const d of docs.values()) {
    const doc = d.doc;
    const esF = d.tipo === 'factura';
    const ref = esF
      ? `Fac ${d.id}${doc && doc.numero_factura ? ' · ' + doc.numero_factura : ''}`
      : `Pago ${d.id}`;
    const quien = doc ? (esF ? (doc.razon_social || doc.nombre_proveedor || '') : (doc.nombre || '')) : '';
    const fechaIso = doc ? (reglas.parseFecha(esF ? doc.fecha_factura : doc.fecha) || '') : '';
    const total = doc ? (esF ? (doc.monto_total || 0) : (doc.importe || 0)) : 0;
    const suma = d.asigs.reduce((s, a) => s + (a.monto_asignado || 0), 0);
    const proyDoc = doc ? (doc.proyecto || '') : '';
    const base = { tipo: d.tipo, docId: d.id, ref, quien, fechaIso, total, suma, proyecto: proyDoc };
    const fila = (a, extra) => {
      const u = uById.get(String(a.unidad_id));
      return {
        ...base, casa: u ? u.nombre : `(id ${a.unidad_id})`, unidadId: String(a.unidad_id),
        proyecto: proyDoc || (u ? u.proyecto : ''), proyectoCasa: u ? (u.proyecto || '') : '',
        cierre: u ? (reglas.cierreDe(u) || '') : '',
        metodo: a.metodo || '', partida: a.partida_override || (doc && !esF ? doc.partida || '' : ''),
        sub: a.sub_partida_override || '', monto: a.monto_asignado || 0, factor: a.factor || 0,
        asignacionId: a.asignacion_id, ...extra,
      };
    };
    // Documento que la app NO cuenta en el costo: sus problemas de reparto no mueven
    // ningún costo por casa → se reportan como INFO (con el motivo), nunca como ERROR.
    const suprimido = !esF && cubiertos.has(d.id);
    const noCuenta = !doc ? '' : suprimido ? 'lo cubre su factura'
      : (esF && doc.estado_sat === 'Cancelada') ? 'factura cancelada en el SAT'
      : (!esF && capital.has(d.id)) ? 'pago de capital' : '';
    const SIEMPRE = new Set(['pago_suprimido', 'factura_cancelada', 'comprobante_no_factura', 'huerfana']);
    const add = (cat, sev, row, detalle) => {
      if (noCuenta && !SIEMPRE.has(cat) && sev !== 'INFO') {
        out.push({ cat, sev: 'INFO', ...row, detalle: `${detalle} (no cuenta en el costo: ${noCuenta})` });
      } else out.push({ cat, sev, ...row, detalle });
    };

    // Documento inexistente → todas sus filas son huérfanas (y nada más se puede evaluar).
    if (!doc) {
      d.asigs.forEach(a => add('huerfana', 'ERROR', fila(a), `${esF ? 'La factura' : 'El pago'} ${d.id} ya no existe`));
      continue;
    }

    // --- chequeos del documento ---
    const docRow = { ...base, casa: '', unidadId: '', cierre: '', metodo: '', partida: '', sub: '', monto: 0, factor: 0, asignacionId: '' };
    if (!fechaIso) add('fecha_invalida', 'REVISAR', { ...docRow, monto: suma }, `Fecha '${esF ? doc.fecha_factura || '' : doc.fecha || ''}' no se puede interpretar`);
    if (esF && (doc.tipo_comprobante || 'Factura') !== 'Factura') {
      add('comprobante_no_factura', 'ERROR', { ...docRow, monto: suma }, `Es "${doc.tipo_comprobante}" y tiene ${d.asigs.length} fila(s) de reparto`);
    }
    if (esF && (doc.estado_sat === 'Cancelada' || doc.estatus_factura === 'cancelada')) {
      add('factura_cancelada', 'REVISAR', { ...docRow, monto: suma }, `Cancelada (${doc.estado_sat === 'Cancelada' ? 'SAT' : 'estatus'}) con ${d.asigs.length} fila(s) de reparto`);
    }
    if (suma > total + _TOL) {
      add('sobre_repartido', 'ERROR', { ...docRow, monto: suma - total }, `Repartido ${suma.toFixed(2)} de ${total.toFixed(2)} (exceso ${(suma - total).toFixed(2)})`);
    }
    if (!esF && !suprimido && suma > 0.005 && suma < total - _TOL) {
      add('pago_sub_repartido', 'REVISAR', { ...docRow, monto: total - suma }, `Repartido ${suma.toFixed(2)} de ${total.toFixed(2)} (falta ${(total - suma).toFixed(2)})`);
    }
    if (suprimido) add('pago_suprimido', 'INFO', { ...docRow, monto: suma }, 'Tiene reparto propio pero lo cubre su factura repartida: ese reparto no cuenta');

    // --- varias filas por casa: duplicado (misma partida) o por partes ---
    const porCasa = new Map();
    d.asigs.forEach(a => {
      const k = String(a.unidad_id);
      if (!porCasa.has(k)) porCasa.set(k, []);
      porCasa.get(k).push(a);
    });
    // Misma casa + misma partida dos veces NO siempre es error: una factura se puede
    // repartir en varios pasos con la misma partida (60% hoy, 40% después). Solo es
    // DUPLICADO si la fila es idéntica a otra (doble guardado) o si el documento quedó
    // sobre-repartido; si no, es un reparto por partes legítimo (INFO).
    const sobreRep = suma > total + _TOL;
    let hayPartes = false;
    porCasa.forEach(filas => {
      if (filas.length < 2) return;
      hayPartes = true;
      const vistos = new Map();   // partida|sub → filas ya vistas
      filas.forEach(a => {
        const kp = `${a.partida_override || ''}|${a.sub_partida_override || ''}`;
        const previas = vistos.get(kp) || [];
        const identica = previas.some(b => Math.abs((b.monto_asignado || 0) - (a.monto_asignado || 0)) < 0.01
          && Math.abs((b.factor || 0) - (a.factor || 0)) < 1e-6 && (b.metodo || '') === (a.metodo || ''));
        if (previas.length && (identica || sobreRep)) {
          add('duplicado', 'ERROR', fila(a), identica
            ? 'Fila idéntica a otra de la misma casa y partida (doble guardado)'
            : 'La casa se repite en la misma partida y el documento quedó sobre-repartido');
        }
        previas.push(a); vistos.set(kp, previas);
      });
    });
    if (hayPartes) {
      const nPart = new Set(d.asigs.map(a => `${a.partida_override || ''}|${a.sub_partida_override || ''}`)).size;
      const nPasos = new Set(d.asigs.map(a => `${a.partida_override || ''}|${a.sub_partida_override || ''}|${a.fecha_asignacion || ''}|${a.metodo || ''}`)).size;
      add('por_partes', 'INFO', { ...docRow, monto: suma }, `Varias filas por casa: ${nPart} partida(s) en ${nPasos} paso(s) de reparto`);
    }

    // --- partes para el chequeo de proporción: por partida y por PASO (misma partida,
    // fecha y método = un guardado del modal), porque el factor es relativo a su paso ---
    const partes = new Map(), pasos = new Map();
    const kPaso = a => `${a.partida_override || ''}|${a.sub_partida_override || ''}|${a.fecha_asignacion || ''}|${a.metodo || ''}`;
    d.asigs.forEach(a => {
      const kp = `${a.partida_override || ''}|${a.sub_partida_override || ''}`;
      partes.set(kp, (partes.get(kp) || 0) + (a.monto_asignado || 0));
      pasos.set(kPaso(a), (pasos.get(kPaso(a)) || 0) + (a.monto_asignado || 0));
    });

    // --- chequeos por fila ---
    d.asigs.forEach(a => {
      const u = uById.get(String(a.unidad_id));
      const m = a.monto_asignado || 0;
      if (!u) {
        add('casa_invalida', 'ERROR', fila(a), 'La casa ya no existe');
      } else {
        if (u.activo === false) add('casa_invalida', 'REVISAR', fila(a), 'Casa dada de baja');
        if (proyDoc && u.proyecto && !reglas.proyMatch(proyDoc, u.proyecto) && !reglas.proyMatch(u.proyecto, proyDoc)) {
          add('casa_invalida', 'ERROR', fila(a), `La casa es de "${u.proyecto}" y el documento de "${proyDoc}"`);
        }
        const cierre = reglas.cierreDe(u) || '';
        if (!suprimido && cierre && fechaIso && cierre <= fechaIso) {
          add('posterior_cierre', (a.metodo || '') === 'indiviso' ? 'ERROR' : 'REVISAR', fila(a),
            `Documento del ${fechaIso}; la casa cerró el ${cierre}${(a.metodo || '') === 'indiviso' ? ' (reparto automático por indiviso)' : ' (reparto dirigido: ¿garantía/postventa?)'}`);
        }
      }
      if (!(m > 0)) add('monto_no_positivo', 'REVISAR', fila(a), `Monto ${m}`);
      // Proporción: el factor puede ser relativo al documento o a su parte (por partes).
      const f = a.factor || 0;
      if (f > 0 && m > 0) {
        const parte = partes.get(`${a.partida_override || ''}|${a.sub_partida_override || ''}`) || 0;
        const paso = pasos.get(kPaso(a)) || 0;
        const tolM = Math.max(_TOL, m * 0.005);
        const cuadra = [total, parte, paso, suma].some(T => T > 0 && Math.abs(m - f * T) <= tolM);
        if (!cuadra) add('factor_incoherente', 'REVISAR', fila(a), `Factor ${(f * 100).toFixed(4)}% no cuadra con ${m.toFixed(2)} (total ${total.toFixed(2)})`);
      }
    });
  }

  // --- pagos aplicados solo en parte a facturas (la supresión es todo o nada) ---
  const aplicado = new Map();
  (datos.facturaPagos || []).forEach(fp => {
    if (fp.pago_id == null || String(fp.pago_id) === '') return;
    const k = String(fp.pago_id);
    aplicado.set(k, (aplicado.get(k) || 0) + (fp.monto_aplicado || 0));
  });
  aplicado.forEach((ap, pid) => {
    if (!cubiertos.has(pid)) return;
    const h = pagoById.get(pid);
    if (!h) return;
    const imp = h.importe || 0;
    if (ap < imp - _TOL) {
      out.push({ cat: 'pago_aplicacion_parcial', sev: 'REVISAR', tipo: 'pago', docId: pid, ref: `Pago ${pid}`, quien: h.nombre || '',
        fechaIso: reglas.parseFecha(h.fecha) || '', total: imp, suma: ap, proyecto: h.proyecto || '', casa: '', unidadId: '',
        cierre: '', metodo: '', partida: h.partida || '', sub: '', monto: imp - ap, factor: 0, asignacionId: '',
        detalle: `Aplicado ${ap.toFixed(2)} de ${imp.toFixed(2)} a facturas repartidas: el resto (${(imp - ap).toFixed(2)}) no cuenta en ningún costo` });
    }
  });

  // --- casas fuera de obra sin fecha ---
  (datos.unidades || []).forEach(u => {
    if (u.activo === false) return;
    if ((u.estatus || 'En obra') === 'En obra' || u.fecha_termino) return;
    // Si ya está cerrada por ESCRITURA, deja de recibir costo desde ahí: solo falta el dato.
    const cierreEsc = reglas.cierreDe(u) || '';
    out.push({ cat: 'terminada_sin_fecha', sev: cierreEsc ? 'REVISAR' : 'ERROR', tipo: 'casa', docId: '', ref: '', quien: '', fechaIso: '', total: 0, suma: 0,
      proyecto: u.proyecto || '', proyectoCasa: u.proyecto || '', casa: u.nombre, unidadId: String(u.unidad_id), cierre: cierreEsc, metodo: '',
      partida: '', sub: '', monto: 0, factor: 0, asignacionId: '',
      detalle: cierreEsc
        ? `Estatus "${u.estatus === 'Terminada' ? 'Escriturada' : u.estatus}" sin fecha de escrituración; la venta ya trae su escritura (${cierreEsc}): falta capturarla en la casa`
        : `Estatus "${u.estatus === 'Terminada' ? 'Escriturada' : u.estatus}" sin fecha de escrituración: sigue recibiendo costo por indiviso` });
  });

  out.sort((a, b) => (_CAT.get(a.cat).orden - _CAT.get(b.cat).orden) || String(a.proyecto).localeCompare(String(b.proyecto)) || (b.monto - a.monto));
  return out;
}

// Resumen por categoría: filas, documentos distintos y $ afectado.
export function resumirAuditoria(hallazgos) {
  const m = new Map();
  hallazgos.forEach(x => {
    let r = m.get(x.cat);
    if (!r) { r = { ...(_CAT.get(x.cat) || { key: x.cat, titulo: x.cat, accion: '' }), filas: 0, docs: new Set(), monto: 0, sev: new Set() }; m.set(x.cat, r); }
    r.filas++; r.monto += x.monto || 0; r.sev.add(x.sev);
    r.docs.add(x.tipo === 'casa' ? 'U' + x.unidadId : x.tipo + x.docId);
  });
  return [...m.values()].sort((a, b) => a.orden - b.orden)
    .map(r => ({ ...r, docs: r.docs.size, sev: [...r.sev].sort().join(' / ') }));
}

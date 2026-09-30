// ============================================================================
// Motor PURO de "rehacer por cierre" (sin imports; probado en node con
// scripts/test-rehacer-cierre.mjs). SOLO PLANEA: devuelve acciones con el
// antes/después de cada parte; quien aplica es src/modules/rehacer-repartos.js.
//
// Reglas del dueño (2026-09-30):
//   · Una casa CERRADA (terminación o escritura, la más temprana) no puede recibir
//     costo de un documento con fecha ≥ su cierre (factura = emisión; pago = fecha).
//   · indiviso      → recolocar entre TODAS las casas del proyecto abiertas a la fecha.
//   · indiviso_sel  → quitar las cerradas; repartir por indiviso entre las ELEGIDAS
//                     que seguían abiertas (respeta la selección).
//   · sin ninguna abierta → la parte se quita y queda PENDIENTE.
//   · equitativo / directo / custom → "revisar" (no se tocan solos).
//   · El total de cada PARTE se conserva al centavo.
// Una PARTE conserva su llave (partida|sub|fecha|método) para siempre: rehacer y
// restaurar NO cambian la fecha de la parte, así dos partes nunca se funden.
// Nunca se recoloca a ciegas: documento repartido de más, parte que junta varios
// repartos de elegidas, o restaurar que no cabe en el total → "revisar".
// Repetible e idempotente; `planRestaurar` devuelve casas que se reabrieron
// (fecha corregida o venta cancelada) usando lo que guardaron los lotes; una parte
// sin filas solo se rearma si quedó PENDIENTE y si, junto con las demás del mismo
// documento, cabe en su total.
// ============================================================================

const _TOL = 0.5;
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;

// Una PARTE = un guardado del reparto: misma partida, sub, fecha y método.
const _kParte = a => `${a.partida_override || ''}|${a.sub_partida_override || ''}|${a.fecha_asignacion || ''}|${a.metodo || ''}`;
const _kParteDe = p => `${p.partida || ''}|${p.sub || ''}|${p.fechaParte || ''}|${p.metodo || ''}`;
// Llave sin fecha (para detectar copias idénticas en 🧹).
export const kParteEstable = a => `${a.partida_override || ''}|${a.sub_partida_override || ''}|${a.metodo || ''}`;

// Σ fuera del total (con signo: una nota de crédito tiene total negativo).
const _sobre = (suma, total) => (total >= 0 ? suma > total + _TOL : suma < total - _TOL);

// ¿La parte junta varios repartos de casas elegidas? En un solo guardado del modal
// los factores (parte dentro de la selección) suman 1 y monto = importe × factor, así
// que monto ÷ factor es el mismo en todas; una casa repetida también lo delata.
// (Filas viejas con factor 0 no se pueden juzgar: no se marcan.)
function _mezclaPasos(filas) {
  const vistos = new Set();
  for (const a of filas) { const k = String(a.unidad_id); if (vistos.has(k)) return true; vistos.add(k); }
  const sf = filas.reduce((x, a) => x + (a.factor || 0), 0);
  if (sf > 1e-9 && Math.abs(sf - 1) > 0.005) return true;
  if (filas.length < 2 || filas.some(a => !(Math.abs(a.factor || 0) > 1e-9))) return false;
  const R = filas.map(a => (a.monto_asignado || 0) / a.factor).sort((x, y) => x - y)[Math.floor(filas.length / 2)];
  return filas.some(a => Math.abs((a.monto_asignado || 0) - R * a.factor) > Math.max(0.1, Math.abs(R * a.factor) * 0.002));
}

// Reparte `monto` entre `casas` por indiviso (parejo si nadie tiene %). Σ exacta.
function _porIndiviso(casas, monto) {
  const suma = casas.reduce((s, u) => s + (u.indiviso_pct || 0), 0);
  const out = casas.map(u => {
    const f = suma > 0 ? (u.indiviso_pct || 0) / suma : 1 / casas.length;
    return { unidad_id: u.unidad_id, factor: f, monto: r2(monto * f) };
  });
  const dif = r2(monto - out.reduce((s, x) => s + x.monto, 0));
  if (out.length && Math.abs(dif) >= 0.01) {
    const m = out.reduce((a, b) => (Math.abs(b.monto) > Math.abs(a.monto) ? b : a), out[0]);
    m.monto = r2(m.monto + dif);
  }
  return out;
}

function _ctx(datos, reglas) {
  const facById = new Map((datos.facturas || []).map(f => [String(f.factura_id), f]));
  const pagoById = new Map((datos.historial || []).map(h => [String(h.id), h]));
  const uById = new Map((datos.unidades || []).map(u => [String(u.unidad_id), u]));
  const cubiertos = reglas.cubiertos || new Set();
  const capital = reglas.capital || new Set();
  // Abierta = activa y sin cierre, o con cierre POSTERIOR a la fecha del documento.
  const abierta = (u, fechaIso) => {
    if (!u || u.activo === false) return false;
    const c = reglas.cierreDe(u) || '';
    return !c || c > fechaIso;
  };
  // Cerrada = tiene cierre y el documento es de esa fecha o posterior. (Una casa dada
  // de baja SIN cierre no se considera cerrada: la 🩺 la reporta aparte.)
  const cerrada = (u, fechaIso) => {
    if (!u) return false;
    const c = reglas.cierreDe(u) || '';
    return !!c && c <= fechaIso;
  };
  // Documento que cuenta en el costo (los que no, no se tocan).
  const docInfo = (tipo, id) => {
    const esF = tipo === 'factura';
    const doc = esF ? facById.get(String(id)) : pagoById.get(String(id));
    if (!doc) return null;
    if (!esF && (cubiertos.has(String(id)) || capital.has(String(id)))) return null;
    if (esF && doc.estado_sat === 'Cancelada') return null;
    const fechaIso = reglas.parseFecha(esF ? doc.fecha_factura : doc.fecha) || '';
    if (!fechaIso) return null;
    return {
      doc, fechaIso, proyecto: doc.proyecto || '',
      ref: esF ? `Fac ${id}${doc.numero_factura ? ' · ' + doc.numero_factura : ''}` : `Pago ${id}`,
      quien: esF ? (doc.razon_social || doc.nombre_proveedor || '') : (doc.nombre || ''),
      total: esF ? (doc.monto_total || 0) : (doc.importe || 0),
    };
  };
  const poolProyecto = (proyecto, fechaIso) => (datos.unidades || [])
    .filter(u => reglas.proyMatch(proyecto, u.proyecto) && abierta(u, fechaIso));
  // Fila en una casa que NO está abierta NI cerrada a la fecha (dada de baja sin
  // cierre, o que ya no existe): recolocar la dejaría sin su parte en silencio.
  const huerfana = (a, fechaIso) => { const u = uById.get(String(a.unidad_id)); return !abierta(u, fechaIso) && !cerrada(u, fechaIso); };
  return { uById, abierta, cerrada, docInfo, poolProyecto, huerfana };
}

function _docs(asigs) {
  const docs = new Map();
  (asigs || []).forEach(a => {
    const esF = a.factura_id != null && String(a.factura_id) !== '';
    const id = String(esF ? a.factura_id : (a.pago_id == null ? '' : a.pago_id));
    if (!id) return;
    const k = (esF ? 'F' : 'P') + id;
    if (!docs.has(k)) docs.set(k, { tipo: esF ? 'factura' : 'pago', id, asigs: [] });
    docs.get(k).asigs.push(a);
  });
  return docs;
}
const _sumaFilas = filas => r2(filas.reduce((s, a) => s + (a.monto_asignado || 0), 0));
const _antes = filas => filas.map(a => ({ asignacion_id: a.asignacion_id, unidad_id: a.unidad_id, monto: a.monto_asignado || 0, factor: a.factor || 0 }));

// Filas nuevas de una parte: reutiliza la fila existente de cada casa (conserva su
// asignacion_id) y marca como nuevas las que entran.
function _despues(dist, filasParte) {
  const porCasa = new Map();
  filasParte.forEach(a => { const k = String(a.unidad_id); if (!porCasa.has(k)) porCasa.set(k, a); });
  return dist.map(x => {
    const ex = porCasa.get(String(x.unidad_id));
    return { asignacion_id: ex ? ex.asignacion_id : null, unidad_id: x.unidad_id, monto: x.monto, factor: x.factor };
  });
}

// ---------------------------------------------------------------------------
// REHACER: partes con alguna casa cerrada a la fecha del documento.
// alcance: {} = todo · { unidadId } = solo partes donde ESA casa está cerrada.
// ---------------------------------------------------------------------------
export function planRehacerCierre(datos, reglas, alcance = {}) {
  const c = _ctx(datos, reglas);
  const acciones = [];
  for (const d of _docs(datos.asigs).values()) {
    const info = c.docInfo(d.tipo, d.id);
    if (!info) continue;
    const sumaDoc = _sumaFilas(d.asigs);
    const partes = new Map();
    d.asigs.forEach(a => { const k = _kParte(a); if (!partes.has(k)) partes.set(k, []); partes.get(k).push(a); });
    for (const filas of partes.values()) {
      const cerradas = filas.filter(a => c.cerrada(c.uById.get(String(a.unidad_id)), info.fechaIso));
      if (!cerradas.length) continue;
      if (alcance.unidadId != null && !cerradas.some(a => String(a.unidad_id) === String(alcance.unidadId))) continue;
      const a0 = filas[0];
      const metodo = a0.metodo || '';
      const montoParte = _sumaFilas(filas);
      const base = {
        docTipo: d.tipo, docId: d.id, ref: info.ref, quien: info.quien, fechaIso: info.fechaIso,
        proyecto: info.proyecto, totalDoc: info.total, metodo, montoParte, fechaParte: a0.fecha_asignacion || '',
        partida: a0.partida_override || '', sub: a0.sub_partida_override || '', obra: a0.partida_obra || '',
        antes: _antes(filas),
        seleccionOriginal: [...new Set(filas.map(a => a.unidad_id))],
        quitadas: cerradas.map(a => ({ unidad_id: a.unidad_id, monto: a.monto_asignado || 0 })),
      };
      const revisar = motivo => acciones.push({ ...base, tipo: 'revisar', despues: null, entran: [], motivo });
      if (_sobre(sumaDoc, info.total)) {
        revisar(`Documento repartido de más (${r2(sumaDoc)} de ${r2(info.total)}): primero 🧹 Quitar duplicados; no se recoloca solo`);
        continue;
      }
      if (metodo !== 'indiviso' && metodo !== 'indiviso_sel') {
        revisar(`Reparto dirigido (${metodo || 'sin método'}) con casa(s) cerrada(s): se revisa a mano`);
        continue;
      }
      if (metodo === 'indiviso_sel' && _mezclaPasos(filas)) {
        revisar('La parte junta varios repartos de casas elegidas del mismo día: se revisa a mano');
        continue;
      }
      if (filas.some(a => c.huerfana(a, info.fechaIso))) {
        revisar('La parte incluye una casa dada de baja (o que ya no existe) sin fecha de cierre: se revisa a mano');
        continue;
      }
      let pool;
      if (metodo === 'indiviso') pool = c.poolProyecto(info.proyecto, info.fechaIso);
      else {
        const vistos = new Set();
        pool = filas.map(a => c.uById.get(String(a.unidad_id)))
          .filter(u => u && c.abierta(u, info.fechaIso) && !vistos.has(String(u.unidad_id)) && vistos.add(String(u.unidad_id)));
      }
      if (!pool.length) {
        acciones.push({ ...base, tipo: 'pendiente', despues: [], entran: [],
          motivo: 'Ninguna casa abierta a la fecha del documento: la parte queda pendiente por repartir' });
        continue;
      }
      const antesCasas = new Set(filas.map(a => String(a.unidad_id)));
      acciones.push({ ...base, tipo: 'recolocar', despues: _despues(_porIndiviso(pool, montoParte), filas),
        entran: pool.filter(u => !antesCasas.has(String(u.unidad_id))).map(u => u.unidad_id),
        motivo: metodo === 'indiviso'
          ? 'Recolocado entre las casas del proyecto abiertas a la fecha del documento'
          : 'Quitadas las casas cerradas; repartido entre las elegidas que seguían abiertas' });
    }
  }
  return acciones;
}

// ---------------------------------------------------------------------------
// RESTAURAR: casas que un lote quitó y que HOY vuelven a estar abiertas a la fecha
// del documento (fecha corregida, venta cancelada). lotes = filas de reparto_lotes.
// ---------------------------------------------------------------------------
export function planRestaurar(datos, lotes, reglas, alcance = {}) {
  const c = _ctx(datos, reglas);
  const docs = _docs(datos.asigs);
  // Lotes anulados (se registraron pero no se aplicaron) no cuentan.
  const anulados = new Set((lotes || []).filter(l => l && l.tipo === 'anulado' && l.detalle && l.detalle.anula)
    .map(l => String(l.detalle.anula)));
  const orden = (lotes || []).filter(l => l && l.tipo === 'rehacer_cierre' && !anulados.has(String(l.lote_id)))
    .slice().sort((a, b) => String(a.creado || '').localeCompare(String(b.creado || '')) || String(a.lote_id).localeCompare(String(b.lote_id)));
  // Por documento + PARTE (con su fecha): junta las casas quitadas por TODOS los lotes;
  // tipo, monto, selección y obra los da el lote MÁS RECIENTE.
  const reg = new Map();
  orden.forEach(l => {
    ((l.detalle && l.detalle.partes) || []).forEach(p => {
      if (!p || !p.docTipo || p.docId == null || p.fechaParte == null || !(p.quitadas || []).length) return;
      if (p.tipo !== 'recolocar' && p.tipo !== 'pendiente') return;
      const k = `${p.docTipo}|${p.docId}|${_kParteDe(p)}`;
      const prev = reg.get(k);
      const quitadas = prev ? prev.quitadas : [];
      p.quitadas.forEach(q => { if (!quitadas.some(x => String(x.unidad_id) === String(q.unidad_id))) quitadas.push(q); });
      reg.set(k, { ...p, quitadas, lotes: [...(prev ? prev.lotes : []), l.lote_id] });
    });
  });
  const acciones = [];
  // Partes SIN filas que se rearman (agregan dinero al documento): se deciden juntas
  // por documento, para que entre todas no pasen su total.
  const agregan = new Map();
  for (const p of reg.values()) {
    if (p.metodo !== 'indiviso' && p.metodo !== 'indiviso_sel') continue;
    const info = c.docInfo(p.docTipo, p.docId);
    if (!info) continue;
    const reabiertas = p.quitadas.map(q => c.uById.get(String(q.unidad_id))).filter(u => u && c.abierta(u, info.fechaIso));
    if (!reabiertas.length) continue;
    if (alcance.unidadId != null && !reabiertas.some(u => String(u.unidad_id) === String(alcance.unidadId))) continue;
    const dk = (p.docTipo === 'factura' ? 'F' : 'P') + p.docId;
    const d = docs.get(dk);
    const todas = d ? d.asigs : [];
    const filas = todas.filter(a => _kParte(a) === _kParteDe(p));
    const yaEstan = new Set(filas.map(a => String(a.unidad_id)));
    const nuevas = reabiertas.filter(u => !yaEstan.has(String(u.unidad_id)));
    if (!nuevas.length) continue;   // ya se restauraron: idempotente
    const sumaDoc = _sumaFilas(todas);
    const montoParte = filas.length ? _sumaFilas(filas) : r2(p.montoParte || 0);
    if (Math.abs(montoParte) < 0.005) continue;
    const base = {
      docTipo: p.docTipo, docId: String(p.docId), ref: info.ref, quien: info.quien, fechaIso: info.fechaIso,
      proyecto: info.proyecto, totalDoc: info.total, metodo: p.metodo, montoParte, fechaParte: p.fechaParte,
      partida: p.partida || '', sub: p.sub || '', obra: p.obra || '',
      antes: _antes(filas), entran: nuevas.map(u => u.unidad_id), quitadas: [], seleccionOriginal: p.seleccionOriginal || [],
      lotesOrigen: p.lotes,
    };
    const revisar = motivo => acciones.push({ ...base, tipo: 'revisar', despues: null, motivo });
    if (!filas.length && p.tipo !== 'pendiente') {
      revisar('La parte ya no tiene filas: se borró o se rehízo a mano después del lote. Revisar si la casa reabierta debe llevar parte');
      continue;
    }
    if (filas.length && _sobre(sumaDoc, info.total)) {
      revisar(`Documento repartido de más (${r2(sumaDoc)} de ${r2(info.total)}): primero 🧹 Quitar duplicados; no se restaura solo`);
      continue;
    }
    if (p.metodo === 'indiviso_sel' && filas.length && _mezclaPasos(filas)) {
      revisar('La parte junta varios repartos de casas elegidas del mismo día: se revisa a mano');
      continue;
    }
    if (filas.some(a => c.huerfana(a, info.fechaIso))) {
      revisar('La parte incluye una casa dada de baja (o que ya no existe) sin fecha de cierre: se revisa a mano');
      continue;
    }
    let pool;
    if (p.metodo === 'indiviso') pool = c.poolProyecto(info.proyecto, info.fechaIso);
    else {
      const vistos = new Set();
      pool = [...filas.map(a => c.uById.get(String(a.unidad_id))), ...nuevas]
        .filter(u => u && c.abierta(u, info.fechaIso) && !vistos.has(String(u.unidad_id)) && vistos.add(String(u.unidad_id)));
    }
    if (!pool.length) continue;
    const accion = { ...base, tipo: 'restaurar', despues: _despues(_porIndiviso(pool, montoParte), filas),
      motivo: `Casa(s) reabierta(s) a la fecha del documento: vuelven al reparto (${nuevas.length})` };
    if (filas.length) { acciones.push(accion); continue; }   // redistribuye: el total del documento no cambia
    if (!agregan.has(dk)) agregan.set(dk, { sumaDoc, total: info.total, lista: [] });
    agregan.get(dk).lista.push(accion);
  }
  for (const g of agregan.values()) {
    const suma = r2(g.lista.reduce((x, a) => x + a.montoParte, 0));
    if (!_sobre(g.sumaDoc + suma, g.total)) { acciones.push(...g.lista); continue; }
    g.lista.forEach(a => acciones.push({ ...a, tipo: 'revisar', despues: null,
      motivo: `Parte(s) pendiente(s): el documento ya tiene ${r2(g.sumaDoc)} de ${r2(g.total)} y devolver ${suma} lo pasaría (se volvió a repartir a mano o cambió su total). Revisar a mano` }));
  }
  return acciones;
}

// ---------------------------------------------------------------------------
// APLICAR: ejecuta acciones sobre el arreglo de asignaciones. Actualiza EN SITIO
// (conserva asignacion_id, el objeto y la FECHA de la parte), quita y crea filas.
// Devuelve el arreglo nuevo y los conteos. La usan la app y las pruebas.
//   opts: { nuevoId: () => string, hoy: 'YYYY-MM-DD' (solo si la parte no tiene fecha) }
// ---------------------------------------------------------------------------
export function aplicarAcciones(asigs, acciones, opts) {
  const porId = new Map(asigs.map(a => [String(a.asignacion_id), a]));
  const quitar = new Set();
  const nuevas = [];
  let actualizadas = 0;
  // Una fila solo puede estar en UNA acción: si dos la tocan, el plan está mal armado
  // (duplicaría dinero) y no se aplica nada.
  const tocadas = new Set();
  (acciones || []).forEach(ac => {
    if (ac.tipo === 'revisar') return;
    [...(ac.antes || []), ...(ac.quitar || [])].forEach(a => {
      const id = String(a.asignacion_id);
      if (tocadas.has(id)) throw new Error(`La fila de reparto ${id} aparece en dos acciones del plan: no se aplica nada`);
      tocadas.add(id);
    });
  });
  (acciones || []).forEach(ac => {
    if (ac.tipo === 'revisar') return;
    if (ac.tipo === 'quitar_duplicado') {
      (ac.quitar || []).forEach(a => quitar.add(String(a.asignacion_id)));
      return;
    }
    if (ac.tipo === 'pendiente') {
      (ac.antes || []).forEach(a => quitar.add(String(a.asignacion_id)));
      return;
    }
    // recolocar / restaurar
    const siguen = new Set((ac.despues || []).filter(x => x.asignacion_id).map(x => String(x.asignacion_id)));
    (ac.antes || []).forEach(a => { if (!siguen.has(String(a.asignacion_id))) quitar.add(String(a.asignacion_id)); });
    (ac.despues || []).forEach(x => {
      const ex = x.asignacion_id ? porId.get(String(x.asignacion_id)) : null;
      if (ex) {
        ex.monto_asignado = x.monto; ex.factor = x.factor;
        actualizadas++;
      } else {
        const esF = ac.docTipo === 'factura';
        nuevas.push({
          asignacion_id: opts.nuevoId(), factura_id: esF ? String(ac.docId) : '', pago_id: esF ? '' : ac.docId,
          unidad_id: x.unidad_id, proyecto: ac.proyecto || '', metodo: ac.metodo, monto_asignado: x.monto,
          factor: x.factor, fecha_asignacion: ac.fechaParte != null ? ac.fechaParte : opts.hoy, partida_override: ac.partida || '',
          sub_partida_override: ac.sub || '', partida_obra: ac.obra || '',
        });
      }
    });
  });
  const resultado = asigs.filter(a => !quitar.has(String(a.asignacion_id))).concat(nuevas);
  return { asigs: resultado, creadas: nuevas.length, actualizadas, quitadas: quitar.size };
}

// ---------------------------------------------------------------------------
// DUPLICADOS: documento sobre-repartido cuyas filas se repiten idénticas (misma
// parte, casa y monto). Se quitan las copias (queda la más antigua); solo si con
// eso el documento cuadra al 100% — si no, "revisar".
// ---------------------------------------------------------------------------
export function planDuplicados(datos) {
  const facById = new Map((datos.facturas || []).map(f => [String(f.factura_id), f]));
  const pagoById = new Map((datos.historial || []).map(h => [String(h.id), h]));
  const acciones = [];
  for (const d of _docs(datos.asigs).values()) {
    const doc = d.tipo === 'factura' ? facById.get(d.id) : pagoById.get(d.id);
    if (!doc) continue;
    const total = d.tipo === 'factura' ? (doc.monto_total || 0) : (doc.importe || 0);
    const suma = d.asigs.reduce((s, a) => s + (a.monto_asignado || 0), 0);
    if (!_sobre(suma, total)) continue;
    const orden = d.asigs.slice().sort((a, b) =>
      String(a.fecha_asignacion || '').localeCompare(String(b.fecha_asignacion || '')) ||
      String(a.asignacion_id).localeCompare(String(b.asignacion_id)));
    const vistos = new Set();
    const quitar = [];
    orden.forEach(a => {
      const k = `${kParteEstable(a)}|${a.unidad_id}|${(a.monto_asignado || 0).toFixed(2)}`;
      if (vistos.has(k)) quitar.push(a); else vistos.add(k);
    });
    const ref = d.tipo === 'factura' ? `Fac ${d.id}${doc.numero_factura ? ' · ' + doc.numero_factura : ''}` : `Pago ${d.id}`;
    const quedan = suma - quitar.reduce((s, a) => s + (a.monto_asignado || 0), 0);
    const base = { docTipo: d.tipo, docId: d.id, ref, proyecto: doc.proyecto || '', totalDoc: total, sumaAntes: r2(suma), sumaDespues: r2(quedan),
      quitar: quitar.map(a => ({ ...a })) };
    if (quitar.length && Math.abs(quedan - total) <= _TOL) {
      acciones.push({ ...base, tipo: 'quitar_duplicado', motivo: `${quitar.length} fila(s) repetida(s): el reparto queda al 100%` });
    } else {
      acciones.push({ ...base, tipo: 'revisar', quitar: [],
        motivo: quitar.length ? 'Tiene filas repetidas pero al quitarlas no cuadra al 100%: revisar a mano'
          : 'Sobre-repartido sin filas idénticas: revisar a mano' });
    }
  }
  return acciones;
}

// ---------------------------------------------------------------------------
// Utilidades para quien aplica (misma lógica en la app y en las pruebas).
// ---------------------------------------------------------------------------

// Lo que se guarda de cada parte en reparto_lotes.detalle.partes (para restaurar).
export function partesLote(acciones) {
  return (acciones || []).filter(a => a && a.tipo !== 'revisar').map(a => ({
    tipo: a.tipo, docTipo: a.docTipo, docId: String(a.docId), fechaIso: a.fechaIso || '', fechaParte: a.fechaParte || '',
    proyecto: a.proyecto || '', partida: a.partida || '', sub: a.sub || '', obra: a.obra || '', metodo: a.metodo || '',
    montoParte: a.montoParte || 0, seleccionOriginal: a.seleccionOriginal || [], quitadas: a.quitadas || [], entran: a.entran || [],
    quitarDuplicados: (a.quitar || []).map(x => ({ asignacion_id: x.asignacion_id, unidad_id: x.unidad_id, monto: x.monto_asignado, partida: x.partida_override || '' })),
  }));
}

// Firma de un plan: si al re-planear justo antes de aplicar sale distinta, algo
// cambió mientras el usuario revisaba (otra sesión guardó) y no se aplica.
export function firmaPlan(acciones) {
  const f = x => `${x.asignacion_id || ''}:${x.unidad_id}:${r2(x.monto != null ? x.monto : (x.monto_asignado || 0))}`;
  return (acciones || []).map(a => [a.tipo, a.docTipo, a.docId, a.partida || '', a.sub || '', a.fechaParte || '', a.metodo || '',
    (a.antes || []).map(f).sort().join(','), (a.despues || []).map(f).sort().join(','), (a.quitar || []).map(f).sort().join(',')].join('|'))
    .sort().join('\n');
}

// Documentos (de los que tocaron las acciones) que quedaron repartidos de más.
export function sobreRepartidos(datos, acciones) {
  const tocados = new Set((acciones || []).filter(a => a && a.tipo !== 'revisar').map(a => (a.docTipo === 'factura' ? 'F' : 'P') + a.docId));
  const facById = new Map((datos.facturas || []).map(f => [String(f.factura_id), f]));
  const pagoById = new Map((datos.historial || []).map(h => [String(h.id), h]));
  const out = [];
  for (const [k, d] of _docs(datos.asigs)) {
    if (!tocados.has(k)) continue;
    const doc = d.tipo === 'factura' ? facById.get(d.id) : pagoById.get(d.id);
    if (!doc) continue;
    const total = d.tipo === 'factura' ? (doc.monto_total || 0) : (doc.importe || 0);
    const suma = _sumaFilas(d.asigs);
    if (_sobre(suma, total)) out.push({ docTipo: d.tipo, docId: d.id, suma, total });
  }
  return out;
}

// ============================================================================
// Copiar el reparto de los PAGOS ligados a facturas SIN reparto — motor PURO
// (pruebas en scripts/test-copiar-reparto.mjs). Solo PLANEA; no guarda nada.
//
// Por qué es seguro cuando aplica: si los pagos cubren la factura COMPLETA y se
// copian casa por casa, el costo por casa no cambia — antes contaba el pago y
// después cuenta la factura (el pago queda "cubierto por su factura repartida").
// Solo se copian las facturas 100% claras; cualquier duda va a "Revisar" (o a
// "Parciales" si los pagos cubren solo una parte) y no se toca.
// ============================================================================

import { partidaValida } from './repartos-obra.js';

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const S = v => String(v == null ? '' : v);
const normP = s => S(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const TOL_REPARTIDO = 0.5;   // pago repartido = su importe (± 50 centavos)
export const TOL_CUBRE = 1;         // pagos aplicados = total de la factura / importe del pago (± $1)

/**
 * datos = {
 *   facturas:  [{ id, proyecto, total, fecha (ISO), valida, repartida }]
 *   pagos:     [{ id, proyecto, importe, partida, sub, capital }]
 *   ligas:     [{ facturaId, pagoId, aplicado }]   (aplicado null = ligado solo por el marcador del pago)
 *   asigPagos: [{ pagoId, unidadId, monto, metodo, partidaOv, subOv }]   (reparto PROPIO del pago)
 *   unidades:  [{ id, nombre, proyecto }]
 *   cerradaA:  (unidadId, fechaISO) => '' si la casa está abierta a esa fecha, o el texto del cierre
 *   catalogo:  partidas del catálogo
 * }
 * → { copiar: [...], parciales: [...], revisar: [...] }
 */
export function planCopiarReparto(datos) {
  const d = datos || {};
  const factById = new Map((d.facturas || []).map(f => [S(f.id), f]));
  const pagoById = new Map((d.pagos || []).map(p => [S(p.id), p]));
  const uById = new Map((d.unidades || []).map(u => [S(u.id), u]));
  const cerradaA = d.cerradaA || (() => '');
  const mismoProy = (a, b) => normP(a) === normP(b);

  // Ligas sin repetir (factura, pago): las de facturaPagos suman; el marcador solo si no hay fila.
  const ligaMap = new Map();
  (d.ligas || []).forEach(l => {
    const k = S(l.facturaId) + '|' + S(l.pagoId);
    const prev = ligaMap.get(k);
    if (l.aplicado == null) { if (!prev) ligaMap.set(k, { facturaId: S(l.facturaId), pagoId: S(l.pagoId), aplicado: null }); return; }
    if (!prev || prev.aplicado == null) ligaMap.set(k, { facturaId: S(l.facturaId), pagoId: S(l.pagoId), aplicado: Number(l.aplicado) || 0 });
    else prev.aplicado += Number(l.aplicado) || 0;
  });
  const ligasF = new Map(), ligasP = new Map();
  ligaMap.forEach(l => {
    ligasF.set(l.facturaId, [...(ligasF.get(l.facturaId) || []), l]);
    ligasP.set(l.pagoId, [...(ligasP.get(l.pagoId) || []), l]);
  });
  const asigsDe = new Map();
  (d.asigPagos || []).forEach(a => asigsDe.set(S(a.pagoId), [...(asigsDe.get(S(a.pagoId)) || []), a]));

  // Lo aplicado de un pago a una factura (marcador sin monto = el pago completo, si solo paga esa).
  const aplicadoDe = l => {
    if (l.aplicado != null) return l.aplicado;
    const p = pagoById.get(l.pagoId);
    return (ligasP.get(l.pagoId) || []).length === 1 && p ? Number(p.importe) || 0 : null;
  };

  const evaluar = f => {
    const fid = S(f.id);
    const ligas = ligasF.get(fid) || [];
    const partes = [];
    for (const l of ligas) {
      const p = pagoById.get(l.pagoId);
      const ref = `El pago #${l.pagoId}`;
      if (!p) return { motivo: `${ref} ya no existe en el historial` };
      if (p.capital) return { motivo: `${ref} es capital de crédito (no es costo): no hay reparto que copiar` };
      if (!mismoProy(p.proyecto, f.proyecto)) return { motivo: `${ref} es de "${p.proyecto}" y la factura de "${f.proyecto}"` };
      const asigs = asigsDe.get(l.pagoId) || [];
      if (!asigs.length) return { motivo: `${ref} no tiene reparto propio` };
      const repartido = asigs.reduce((s, a) => s + (Number(a.monto) || 0), 0);
      const importe = Number(p.importe) || 0;
      if (Math.abs(repartido - importe) > TOL_REPARTIDO) return { motivo: `${ref} está repartido ${r2(repartido).toFixed(2)} de ${r2(importe).toFixed(2)}` };
      const a = aplicadoDe(l);
      if (a == null) return { motivo: `${ref} está ligado por su marcador pero también a otras facturas: no se sabe cuánto le toca a ésta` };
      if (!(a > 0)) return { motivo: `${ref} tiene $0 aplicado a esta factura` };
      const aplTotal = (ligasP.get(l.pagoId) || []).reduce((s, x) => s + (aplicadoDe(x) || 0), 0);
      if (Math.abs(aplTotal - importe) > TOL_CUBRE) return { motivo: `${ref} se aplicó ${r2(aplTotal).toFixed(2)} de ${r2(importe).toFixed(2)} a facturas: al copiar, el resto dejaría de contar` };
      const asigsC = [];
      for (const x of asigs) {
        const u = uById.get(S(x.unidadId));
        if (!u) return { motivo: `${ref} tiene una casa que ya no existe (${x.unidadId})` };
        if (!mismoProy(u.proyecto, f.proyecto)) return { motivo: `${ref} tiene la casa ${u.nombre} de "${u.proyecto}"` };
        const cierre = cerradaA(S(x.unidadId), f.fecha);
        if (cierre) return { motivo: `La casa ${u.nombre} ya estaba escriturada a la fecha de la factura (${cierre}): ese reparto no se puede copiar tal cual` };
        const partida = S(x.partidaOv) || S(p.partida);
        const sub = S(x.partidaOv) ? S(x.subOv) : S(p.sub);
        const pv = partidaValida(d.catalogo || [], partida, sub);   // nombres tal cual el catálogo
        if (!pv) return { motivo: `${ref}: la partida "${partida}${sub ? ' / ' + sub : ''}" no está en el catálogo (o le falta la sub-partida)` };
        asigsC.push({ ...x, partidaC: pv.partida, subC: pv.sub });
      }
      partes.push({ pagoId: l.pagoId, aplicado: a, repartido, importe, asigs: asigsC });
    }
    const cubierto = partes.reduce((s, x) => s + x.aplicado, 0);
    const total = Number(f.total) || 0;
    if (cubierto > total + TOL_CUBRE) return { motivo: `Los pagos aplicados (${r2(cubierto).toFixed(2)}) suman más que la factura (${r2(total).toFixed(2)})` };
    if (cubierto < total - TOL_CUBRE) return { parcial: true, partes, cubierto, motivo: `Los pagos cubren ${r2(cubierto).toFixed(2)} de ${r2(total).toFixed(2)}` };
    return { ok: true, partes, cubierto };
  };

  const candidatas = (d.facturas || []).filter(f => f.valida && !f.repartida && (ligasF.get(S(f.id)) || []).length);
  const res = new Map();
  candidatas.forEach(f => res.set(S(f.id), { f, ...evaluar(f) }));

  // Punto fijo: un pago se suprime COMPLETO en cuanto UNA de sus facturas queda repartida;
  // si otra de sus facturas no se copia en esta misma carga, su parte dejaría de contar.
  let cambio = true;
  while (cambio) {
    cambio = false;
    res.forEach((r, fid) => {
      if (!r.ok) return;
      for (const pt of r.partes) {
        const otra = (ligasP.get(pt.pagoId) || []).map(x => x.facturaId).find(g => g !== fid && !(res.get(g) && res.get(g).ok));
        if (otra == null) continue;
        const g = factById.get(otra);
        const porque = !g ? 'ya no existe' : g.repartida ? 'ya tiene reparto' : !g.valida ? 'está cancelada o no es factura' : 'no se puede copiar en esta carga';
        res.set(fid, { f: r.f, motivo: `El pago #${pt.pagoId} también paga la Fac ${otra}, que ${porque}: copiar ésta haría que ese pago deje de contar` });
        cambio = true;
        return;
      }
    });
  }

  const copiar = [], parciales = [], revisar = [];
  res.forEach(r => {
    if (r.ok) copiar.push(_construir(r, pagoById));
    else if (r.parcial) parciales.push({ factura: r.f, motivo: r.motivo, partes: r.partes, cubierto: r.cubierto });
    else revisar.push({ factura: r.f, motivo: r.motivo });
  });
  const ord = (a, b) => S(a.factura.id).localeCompare(S(b.factura.id), undefined, { numeric: true });
  return { copiar: copiar.sort(ord), parciales: parciales.sort(ord), revisar: revisar.sort(ord) };
}

// Filas de la factura: cada asignación del pago escalada a lo aplicado (aplicado / repartido),
// juntando casa+partida+sub+método; centavos al renglón mayor para que sume EXACTO el total.
function _construir(r, pagoById) {
  const f = r.f;
  const total = Number(f.total) || 0;
  const acc = new Map();
  const antes = new Map();   // costo por casa que hoy aportan los pagos (su reparto propio completo)
  r.partes.forEach(pt => {
    const escala = pt.repartido > 0 ? pt.aplicado / pt.repartido : 0;
    pt.asigs.forEach(a => {
      const partida = a.partidaC, sub = a.subC;
      const k = [S(a.unidadId), normP(partida), normP(sub), S(a.metodo)].join('|');
      const o = acc.get(k) || { unidadId: S(a.unidadId), partida, sub, metodo: S(a.metodo) || 'custom', monto: 0 };
      o.monto += (Number(a.monto) || 0) * escala;
      acc.set(k, o);
      // lo que HOY aporta el pago por la parte que le toca a ESTA factura (un pago puede pagar varias)
      const parteDelPago = pt.importe > 0 ? pt.aplicado / pt.importe : 0;
      antes.set(S(a.unidadId), (antes.get(S(a.unidadId)) || 0) + (Number(a.monto) || 0) * parteDelPago);
    });
  });
  const filas = [...acc.values()].map(o => ({ ...o, monto: r2(o.monto) }));
  const dif = r2(total - filas.reduce((s, o) => s + o.monto, 0));
  if (dif && filas.length) {
    let k = 0;
    filas.forEach((o, i) => { if (o.monto > filas[k].monto) k = i; });
    filas[k].monto = r2(filas[k].monto + dif);
  }
  filas.forEach(o => { o.factor = total > 0 ? o.monto / total : 0; });
  const despues = new Map();
  filas.forEach(o => despues.set(o.unidadId, (despues.get(o.unidadId) || 0) + o.monto));
  const casas = [...new Set([...antes.keys(), ...despues.keys()])];
  const comparacion = casas.map(u => ({ unidadId: u, antes: r2(antes.get(u) || 0), despues: r2(despues.get(u) || 0), dif: r2((despues.get(u) || 0) - (antes.get(u) || 0)) }));
  const porPartida = new Map();
  filas.forEach(o => { const k = o.partida + (o.sub ? ' / ' + o.sub : ''); porPartida.set(k, r2((porPartida.get(k) || 0) + o.monto)); });
  return {
    factura: f, partes: r.partes.map(pt => ({ pagoId: pt.pagoId, aplicado: r2(pt.aplicado), importe: r2(pt.importe) })),
    filas, comparacion, porPartida: [...porPartida.entries()].map(([partida, monto]) => ({ partida, monto })),
    huella: JSON.stringify(filas.map(o => [o.unidadId, o.partida, o.sub, o.metodo, o.monto])),
  };
}

// Tope por corrida SIN partir grupos: facturas que comparten un pago van juntas.
export function limitarPorGrupos(copiar, max, ligas) {
  const facturasDePago = new Map();
  (ligas || []).forEach(l => facturasDePago.set(S(l.pagoId), [...(facturasDePago.get(S(l.pagoId)) || []), S(l.facturaId)]));
  const pagosDeFact = new Map();
  (ligas || []).forEach(l => pagosDeFact.set(S(l.facturaId), [...(pagosDeFact.get(S(l.facturaId)) || []), S(l.pagoId)]));
  const ahora = [], despues = [], visto = new Set();
  const porId = new Map(copiar.map(c => [S(c.factura.id), c]));
  copiar.forEach(c => {
    const id0 = S(c.factura.id);
    if (visto.has(id0)) return;
    const grupo = [], cola = [id0];
    while (cola.length) {
      const id = cola.pop();
      if (visto.has(id) || !porId.has(id)) continue;
      visto.add(id); grupo.push(porId.get(id));
      (pagosDeFact.get(id) || []).forEach(pid => (facturasDePago.get(pid) || []).forEach(g => cola.push(g)));
    }
    (ahora.length && ahora.length + grupo.length > max ? despues : ahora).push(...grupo);
  });
  return { ahora, despues };
}

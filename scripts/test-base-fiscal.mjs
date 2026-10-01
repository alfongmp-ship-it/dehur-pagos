// Pruebas del motor de base fiscal (subtotal + IVA; las retenciones no bajan el costo).
//   node scripts/test-base-fiscal.mjs
import { retencionesFactura, retencionesFiscales, baseFiscalFactura, factorFiscalFactura, montosFiscales, montoFiscalDe, desgloseFactura } from '../src/services/base-fiscal.js';

let ok = 0, fail = 0;
const ck = (n, c, d) => { if (c) { ok++; console.log('OK  ' + n); } else { fail++; console.error('XX  ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); } };
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const A = (id, fid, monto, extra = {}) => ({ asignacion_id: 'a' + id, factura_id: fid, unidad_id: id, monto_asignado: monto, ...extra });

// El plomero del ejemplo: subtotal 10,000 + IVA 1,600; retiene ISR 1,000 e IVA 1,066.67.
const plomero = { factura_id: 1, subtotal: 10000, descuento: 0, iva_trasladado: 1600, retencion_isr: 1000, retencion_iva: 1066.67, nc_subtotal: 0, nc_iva: 0, monto_total: 9533.33 };

// --- 1. la regla ---
ck('retenciones = ISR + IVA retenido', retencionesFactura(plomero) === 2066.67);
ck('base fiscal = total pagado + retenciones = subtotal + IVA (11,600)', baseFiscalFactura(plomero) === 11600);
ck('factor = 11,600 / 9,533.33', Math.abs(factorFiscalFactura(plomero) - 11600 / 9533.33) < 1e-12);
ck('sin retenciones → factor 1', factorFiscalFactura({ monto_total: 5000, retencion_iva: 0, retencion_isr: 0 }) === 1);
ck('factura vieja sin desglose (solo total) → base = total, factor 1', baseFiscalFactura({ monto_total: 8000 }) === 8000 && factorFiscalFactura({ monto_total: 8000 }) === 1);
ck('total 0 → factor 1 (no divide entre cero)', factorFiscalFactura({ monto_total: 0, retencion_isr: 100 }) === 1);
ck('total 0 con retenciones → base 0 (no aparecen $ sueltos en la conciliación)', baseFiscalFactura({ monto_total: 0, subtotal: 100, retencion_isr: 100 }) === 0);
ck('vieja SIN subtotal pero con retenciones → base = su total (no se sabe si era neto)',
  baseFiscalFactura({ monto_total: 9533.33, subtotal: 0, retencion_isr: 1000 }) === 9533.33 && retencionesFiscales({ monto_total: 9533.33, subtotal: 0, retencion_isr: 1000 }) === 0);
ck('… y la lista de desglose la marca para verificar', desgloseFactura({ monto_total: 9533.33, subtotal: 0, retencion_isr: 1000 }).retSinSubtotal === true);
ck('retenciones que cuentan (plomero) = 2,066.67', retencionesFiscales(plomero) === 2066.67);
ck('retención negativa (error de captura) no baja la base', baseFiscalFactura({ monto_total: 1000, retencion_isr: -50 }) === 1000);
ck('con nota de crédito: base = subtotal − NC + IVA − NC IVA',
  baseFiscalFactura({ subtotal: 10000, iva_trasladado: 1600, retencion_isr: 1000, retencion_iva: 0, nc_subtotal: 1000, nc_iva: 160, monto_total: 9440 }) === 10440);

// --- 2. varias partidas: el mismo factor a cada fila (el ejemplo que preguntó el dueño) ---
{
  const asigs = [A(120, 1, 3000, { partida_override: 'Albañilería' }), A(121, 1, 3000, { partida_override: 'Albañilería' }),
                 A(122, 1, 3533.33, { partida_override: 'Instalaciones' })];
  const mf = montosFiscales(asigs, [plomero]);
  const v = id => montoFiscalDe(mf, asigs.find(a => a.unidad_id === id));
  ck('casa 120 (Albañilería): 3,000 → 3,650.35', v(120) === 3650.35, v(120));
  ck('casa 121 (Albañilería): 3,000 → 3,650.35', v(121) === 3650.35, v(121));
  ck('casa 122 (Instalaciones): 3,533.33 → 4,299.30', v(122) === 4299.30, v(122));
  ck('la suma fiscal da EXACTO 11,600', r2(v(120) + v(121) + v(122)) === 11600);
  const alb = r2(v(120) + v(121)) / 11600, alb0 = 6000 / 9533.33;
  ck('Albañilería conserva su % de la factura (63%)', Math.abs(alb - alb0) < 0.0001, [alb, alb0]);
}

// --- 3. repartida solo en parte: lo repartido y lo pendiente escalan igual ---
{
  const asigs = [A(1, 1, 6000)];
  const mf = montosFiscales(asigs, [plomero]);
  const rep = montoFiscalDe(mf, asigs[0]);
  ck('6,000 de 9,533.33 repartido → 7,300.70 fiscal', rep === 7300.70, rep);
  ck('lo que falta por repartir fiscal = 11,600 − 7,300.70 = 4,299.30', r2(baseFiscalFactura(plomero) - rep) === 4299.30);
}

// --- 4. redondeo: muchas casas, la suma por factura cuadra al centavo ---
{
  const f = { factura_id: 7, monto_total: 1000, retencion_isr: 100, retencion_iva: 6.67 };
  const asigs = Array.from({ length: 7 }, (_, i) => A(i + 1, 7, i === 6 ? 142.86 : 142.857142, {}));
  asigs.forEach(a => { a.monto_asignado = r2(a.monto_asignado); });
  const netoSum = r2(asigs.reduce((s, a) => s + a.monto_asignado, 0));
  const mf = montosFiscales(asigs, [f]);
  const fisSum = r2(asigs.reduce((s, a) => s + montoFiscalDe(mf, a), 0));
  ck('7 casas: Σ fiscal = Σ neto × factor, redondeado exacto', fisSum === r2(netoSum * factorFiscalFactura(f)), [fisSum, netoSum * factorFiscalFactura(f)]);
}

// --- 5. facturas sin retenciones no entran al mapa (valen su monto); pagos tampoco ---
{
  const sinRet = { factura_id: 2, monto_total: 500 };
  const asigs = [A(1, 2, 500), { asignacion_id: 'p1', pago_id: '9', unidad_id: 1, monto_asignado: 300 }];
  const mf = montosFiscales(asigs, [sinRet]);
  ck('factura sin retenciones y pagos: mapa vacío', mf.size === 0);
  ck('… y su monto fiscal = monto_asignado', montoFiscalDe(mf, asigs[0]) === 500 && montoFiscalDe(mf, asigs[1]) === 300);
}

// --- 6. nota de crédito negativa en el reparto (fila negativa) también escala ---
{
  const asigs = [A(1, 1, 9533.33), A(2, 1, -1000)];
  const mf = montosFiscales(asigs, [plomero]);
  ck('fila negativa escala con el mismo factor', montoFiscalDe(mf, asigs[1]) === r2(-1000 * factorFiscalFactura(plomero)), montoFiscalDe(mf, asigs[1]));
}

// --- 7. calidad del desglose ---
{
  const d = desgloseFactura(plomero);
  ck('plomero: desglose cuadra con su total', !d.sinDesglose && !d.noCuadra && d.diferencia === 0, d);
  ck('plomero: IVA al 16%', Math.abs(d.ivaPct - 0.16) < 1e-9);
  ck('factura vieja (solo total) → sin desglose', desgloseFactura({ monto_total: 8000 }).sinDesglose === true);
  const mal = desgloseFactura({ subtotal: 1000, iva_trasladado: 160, monto_total: 1500 });
  ck('total capturado a mano que no cuadra → noCuadra (dif 340)', mal.noCuadra === true && mal.diferencia === 340, mal);
  ck('diferencia de centavos (≤ $1) cuenta como que cuadra', desgloseFactura({ subtotal: 1000, iva_trasladado: 160, monto_total: 1160.40 }).noCuadra === false);
}

console.log(`\n${ok} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);

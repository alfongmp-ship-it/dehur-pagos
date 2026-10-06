// Pruebas del motor "Copiar reparto de pagos" (facturas sin reparto con pagos ligados repartidos).
//   node scripts/test-copiar-reparto.mjs
// Datos inventados (no datos reales).
import { planCopiarReparto, limitarPorGrupos } from '../src/services/copiar-reparto-pago.js';

let ok = 0, fail = 0;
const ck = (n, c, d) => { if (c) { ok++; console.log('OK  ' + n); } else { fail++; console.error('XX  ' + n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 600) : '')); } };
const r2 = n => Math.round(n * 100) / 100;

const P = 'Proyecto A';
const unidades = Array.from({ length: 6 }, (_, i) => ({ id: 'U' + (i + 1), nombre: String(101 + i), proyecto: P }))
  .concat([{ id: 'Z1', nombre: '901', proyecto: 'Proyecto B' }]);
const catalogo = [
  { partida: 'CONSTRUCCION', activa: true, subpartidas: ['Acabados', 'Mano de Obra', 'Carpinteria'] },
  { partida: 'Indirectos', activa: true, subpartidas: [] },
  { partida: 'Intereses', activa: true, subpartidas: [] },
];
const F = (id, total, extra = {}) => ({ id, proyecto: P, total, fecha: '2026-08-28', valida: true, repartida: false, ...extra });
const Pg = (id, importe, partida, sub = '', extra = {}) => ({ id, proyecto: P, importe, partida, sub, capital: false, ...extra });
// reparto indiviso "parejo-ish" de un pago entre casas con pesos
const rep = (pagoId, importe, pesos, extra = {}) => {
  const tot = pesos.reduce((s, x) => s + x[1], 0);
  return pesos.map(([u, w]) => ({ pagoId, unidadId: u, monto: r2(importe * w / tot), metodo: 'indiviso', partidaOv: '', subOv: '', ...extra }));
};
const W = [['U1', 1], ['U2', 2], ['U3', 3]];
const cerrada = { U4: '2026-01-15' };
const base = {
  unidades, catalogo,
  cerradaA: (uid, f) => (cerrada[uid] && cerrada[uid] <= f ? 'escriturada ' + cerrada[uid] : ''),
};

const datos = {
  ...base,
  facturas: [
    F('10', 29326.39),                                   // caso tipo "Anahí": 5 pagos, 3 partidas
    F('11', 1000), F('12', 500),                         // un pago que paga 2 facturas (se copian juntas)
    F('13', 2000),                                       // pago cubre solo 1,200 → parcial
    F('14', 800),                                        // casa escriturada a la fecha
    F('15', 700),                                        // pago de otro proyecto
    F('16', 600),                                        // partida inválida (sub que no existe)
    F('17', 900),                                        // pago capital
    F('18', 400), F('19', 300, { repartida: true }),     // pago a 2 facturas, la otra YA repartida
    F('20', 450),                                        // pago repartido de menos
    F('21', 250),                                        // ligada solo por marcador
    F('22', 100, { valida: false }),                     // cancelada → ni se considera
    F('23', 1000.03),                                    // centavos: pago 1000.00 cubre ± $1
    F('24', 300),                                        // pago con casa de otro proyecto
  ],
  pagos: [
    Pg('P1', 4000, 'Indirectos'), Pg('P2', 8200, 'CONSTRUCCION', 'Acabados'), Pg('P3', 6134.94, 'CONSTRUCCION', 'Acabados'),
    Pg('P4', 7491.45, 'CONSTRUCCION', 'Acabados'), Pg('P5', 3500, 'CONSTRUCCION', 'Mano de Obra'),
    Pg('P6', 1500, 'CONSTRUCCION', 'Carpinteria'),
    Pg('P7', 1200, 'CONSTRUCCION', 'Acabados'),
    Pg('P8', 800, 'CONSTRUCCION', 'Acabados'),
    Pg('P9', 700, 'CONSTRUCCION', 'Acabados', { proyecto: 'Proyecto B' }),
    Pg('P10', 600, 'CONSTRUCCION', 'Pisos'),
    Pg('P11', 900, 'Pago de Deuda', '', { capital: true }),
    Pg('P12', 700, 'CONSTRUCCION', 'Acabados'),
    Pg('P13', 450, 'CONSTRUCCION', 'Acabados'),
    Pg('P14', 250, 'Intereses'),
    Pg('P15', 1100, 'CONSTRUCCION', 'Acabados'),
    Pg('P16', 300, 'CONSTRUCCION', 'Acabados'),
  ],
  ligas: [
    ...['P1', 'P2', 'P3', 'P4', 'P5'].map((p, i) => ({ facturaId: '10', pagoId: p, aplicado: [4000, 8200, 6134.94, 7491.45, 3500][i] })),
    { facturaId: '11', pagoId: 'P6', aplicado: 1000 }, { facturaId: '12', pagoId: 'P6', aplicado: 500 },
    { facturaId: '13', pagoId: 'P7', aplicado: 1200 },
    { facturaId: '14', pagoId: 'P8', aplicado: 800 },
    { facturaId: '15', pagoId: 'P9', aplicado: 700 },
    { facturaId: '16', pagoId: 'P10', aplicado: 600 },
    { facturaId: '17', pagoId: 'P11', aplicado: 900 },
    { facturaId: '18', pagoId: 'P12', aplicado: 400 }, { facturaId: '19', pagoId: 'P12', aplicado: 300 },
    { facturaId: '20', pagoId: 'P13', aplicado: 450 },
    { facturaId: '21', pagoId: 'P14', aplicado: null },
    { facturaId: '22', pagoId: 'P15', aplicado: 100 },
    { facturaId: '23', pagoId: 'P15', aplicado: 1000 }, { facturaId: '23', pagoId: 'P15', aplicado: null },   // marcador + fila: no duplica
    { facturaId: '24', pagoId: 'P16', aplicado: 300 },
  ],
  asigPagos: [
    ...rep('P1', 4000, W), ...rep('P2', 8200, W), ...rep('P3', 6134.94, W), ...rep('P4', 7491.45, W), ...rep('P5', 3500, W),
    ...rep('P6', 1500, [['U1', 1], ['U2', 1]], { metodo: 'equitativo' }),
    ...rep('P7', 1200, W),
    ...rep('P8', 800, [['U3', 1], ['U4', 1]], { metodo: 'equitativo' }),
    ...rep('P9', 700, W),
    ...rep('P10', 600, W),
    ...rep('P11', 900, W),
    ...rep('P12', 700, W),
    ...rep('P13', 300, W),                                 // repartido 300 de 450
    ...rep('P14', 250, [['U5', 1]], { metodo: 'directo' }),
    ...rep('P15', 1100, W),                               // paga 1,000 a la Fac 23 y 100 a la 22 (cancelada)
    ...rep('P16', 300, [['U1', 1], ['Z1', 1]], { metodo: 'equitativo' }),
  ],
};

const plan = planCopiarReparto(datos);
const C = id => plan.copiar.find(c => c.factura.id === id);
const R = id => plan.revisar.find(c => c.factura.id === id);
const Pa = id => plan.parciales.find(c => c.factura.id === id);

// --- caso tipo Anahí ---
const a = C('10');
ck('Anahí: se copia', !!a, plan.revisar.find(x => x.factura.id === '10'));
ck('Anahí: 3 partes por partida (Indirectos 4,000 · Acabados 21,826.39 · Mano de Obra 3,500)', a && JSON.stringify(a.porPartida.map(p => [p.partida, p.monto]).sort()) === JSON.stringify([['CONSTRUCCION / Acabados', 21826.39], ['CONSTRUCCION / Mano de Obra', 3500], ['Indirectos', 4000]]), a && a.porPartida);
ck('Anahí: filas juntadas (3 casas × 3 partidas = 9)', a && a.filas.length === 9, a && a.filas.length);
ck('Anahí: suma EXACTA = total de la factura', a && r2(a.filas.reduce((s, o) => s + o.monto, 0)) === 29326.39);
ck('Anahí: costo por casa antes = después (diferencia ≤ 1 centavo)', a && a.comparacion.every(c => Math.abs(c.dif) <= 0.01), a && a.comparacion);
ck('Anahí: factor = monto / total de la factura', a && a.filas.every(o => Math.abs(o.factor * 29326.39 - o.monto) < 1e-6));
ck('Anahí: conserva método del pago (indiviso)', a && a.filas.every(o => o.metodo === 'indiviso'));

// --- pago que paga 2 facturas: se copian juntas y escaladas ---
ck('pago a 2 facturas: las dos se copian', !!C('11') && !!C('12'));
ck('pago a 2 facturas: cada una recibe su parte (1,000 y 500), parejo entre 101 y 102', C('11').filas.map(o => o.monto).join() === '500,500' && C('12').filas.map(o => o.monto).join() === '250,250');
ck('pago a 2 facturas: juntas suman el pago (costo por casa igual)', r2(C('11').filas[0].monto + C('12').filas[0].monto) === 750);

// --- no se copian ---
ck('pago cubre solo una parte → Parciales (no se aplica)', !!Pa('13') && !C('13') && /cubren 1200\.00 de 2000\.00/.test(Pa('13').motivo));
ck('casa escriturada a la fecha → Revisar', /escriturada/.test((R('14') || {}).motivo || ''), R('14'));
ck('pago de otro proyecto → Revisar', /es de "Proyecto B"/.test((R('15') || {}).motivo || ''));
ck('partida/sub-partida que no existe → Revisar', /no está en el catálogo/.test((R('16') || {}).motivo || ''));
ck('pago capital → Revisar', /capital/.test((R('17') || {}).motivo || ''));
ck('pago que también paga una factura YA repartida → Revisar (punto fijo)', /también paga la Fac 19, que ya tiene reparto/.test((R('18') || {}).motivo || ''), R('18'));
ck('la factura ya repartida ni se considera', !C('19') && !R('19') && !Pa('19'));
ck('pago repartido de menos → Revisar', /repartido 300\.00 de 450\.00/.test((R('20') || {}).motivo || ''));
ck('ligada solo por marcador (pago completo) → se copia directo a 105', !!C('21') && C('21').filas.length === 1 && C('21').filas[0].monto === 250 && C('21').filas[0].metodo === 'directo');
ck('cancelada → no se considera', !C('22') && !R('22') && !Pa('22'));
ck('pago que también paga una factura cancelada → Revisar', /también paga la Fac 22, que está cancelada/.test((R('23') || {}).motivo || ''), R('23'));
ck('pago con casa de otro proyecto → Revisar', /901 de "Proyecto B"/.test((R('24') || {}).motivo || ''));

// --- centavos: pago 1000.00 cubre factura 1000.03 (± $1) ---
const d2 = { ...base, facturas: [F('30', 1000.03)], pagos: [Pg('Q1', 1000, 'CONSTRUCCION', 'Acabados')], ligas: [{ facturaId: '30', pagoId: 'Q1', aplicado: 1000 }], asigPagos: rep('Q1', 1000, W) };
const c30 = planCopiarReparto(d2).copiar[0];
ck('centavos: se copia y suma EXACTO el total de la factura (1000.03)', c30 && r2(c30.filas.reduce((s, o) => s + o.monto, 0)) === 1000.03);

// --- override de partida por asignación del pago (pago repartido por partes) ---
const d3 = { ...base, facturas: [F('31', 1000)], pagos: [Pg('Q2', 1000, 'CONSTRUCCION', 'Acabados')], ligas: [{ facturaId: '31', pagoId: 'Q2', aplicado: 1000 }],
  asigPagos: [{ pagoId: 'Q2', unidadId: 'U1', monto: 600, metodo: 'directo', partidaOv: 'CONSTRUCCION', subOv: 'Carpinteria' }, { pagoId: 'Q2', unidadId: 'U2', monto: 400, metodo: 'directo', partidaOv: '', subOv: '' }] };
const c31 = planCopiarReparto(d3).copiar[0];
ck('override por asignación: 600 Carpinteria + 400 Acabados (la del pago)', c31 && JSON.stringify(c31.porPartida.map(p => [p.partida, p.monto]).sort()) === JSON.stringify([['CONSTRUCCION / Acabados', 400], ['CONSTRUCCION / Carpinteria', 600]]), c31);

// --- la partida se guarda con el nombre EXACTO del catálogo ---
const d4 = { ...base, facturas: [F('32', 300)], pagos: [Pg('Q3', 300, 'construcción', 'acabados')], ligas: [{ facturaId: '32', pagoId: 'Q3', aplicado: 300 }], asigPagos: rep('Q3', 300, W) };
const c32 = planCopiarReparto(d4).copiar[0];
ck('partida escrita distinto en el pago → se guarda como en el catálogo (CONSTRUCCION / Acabados)', c32 && c32.filas.every(o => o.partida === 'CONSTRUCCION' && o.sub === 'Acabados'), c32 && c32.filas[0]);

// --- tope por corrida sin partir grupos ---
const lim = limitarPorGrupos(plan.copiar, 2, datos.ligas);
const ids = l => l.map(c => c.factura.id).sort().join();
ck('tope: el grupo 11+12 nunca se parte', (ids(lim.ahora).includes('11') === ids(lim.ahora).includes('12')));
ck('tope: todo queda en ahora o después', lim.ahora.length + lim.despues.length === plan.copiar.length);

console.log(`\n${ok} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);

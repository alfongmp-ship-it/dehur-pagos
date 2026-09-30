// Pruebas del motor puro de "rehacer por cierre".
//   node scripts/test-rehacer-cierre.mjs
import { planRehacerCierre, planRestaurar, planDuplicados, aplicarAcciones, partesLote, firmaPlan, sobreRepartidos, planQuitarCopias } from '../src/services/rehacer-cierre-motor.js';

let ok = 0, fail = 0;
const ck = (n, c, d) => { if (c) { ok++; console.log('OK  ' + n); } else { fail++; console.error('XX  ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); } };
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const reglas = (extra = {}) => ({
  parseFecha: s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : ''),
  cierreDe: u => u.fecha_termino || '',
  proyMatch: (a, b) => norm(a) === norm(b),
  cubiertos: new Set(), capital: new Set(), ...extra,
});
let seq = 0;
const nuevoId = () => 'n' + (++seq);
const HOY = '2026-09-30';
const U = (id, ind, ft = '', extra = {}) => ({ unidad_id: id, nombre: 'C' + id, proyecto: 'Paraíso', activo: true, indiviso_pct: ind, fecha_termino: ft, ...extra });
const A = (id, extra) => ({ asignacion_id: 'a' + id, metodo: 'indiviso_sel', factor: 0, monto_asignado: 0, partida_override: 'CONSTRUCCION', sub_partida_override: 'Acabados', partida_obra: '', fecha_asignacion: '2025-09-01', proyecto: 'Paraíso', pago_id: '', ...extra });
const F = (id, extra = {}) => ({ factura_id: id, numero_factura: 'X' + id, proyecto: 'Paraíso', fecha_factura: '2025-08-15', monto_total: 1000, estado_sat: 'Vigente', ...extra });
const suma = (asigs, fid) => r2(asigs.filter(a => String(a.factura_id) === String(fid)).reduce((s, a) => s + a.monto_asignado, 0));
const casasDe = (asigs, fid) => asigs.filter(a => String(a.factura_id) === String(fid)).map(a => a.unidad_id).sort((a, b) => a - b);

// Casa 1 cerró en 2024 (como la 329); 2, 3 abiertas; 4 abierta pero NO elegida.
const unidades = () => [U(1, 0.64, '2024-10-14'), U(2, 0.61), U(3, 0.62), U(4, 0.60)];

// --- 1. casas elegidas: quita la cerrada, reparte entre las elegidas abiertas ---
{
  const asigs = [A(1, { factura_id: 10, unidad_id: 1, monto_asignado: 400, factor: 0.4 }),
                 A(2, { factura_id: 10, unidad_id: 2, monto_asignado: 300, factor: 0.3 }),
                 A(3, { factura_id: 10, unidad_id: 3, monto_asignado: 300, factor: 0.3 })];
  const datos = { asigs, facturas: [F(10)], unidades: unidades() };
  const pl = planRehacerCierre(datos, reglas());
  ck('elegidas: una acción recolocar', pl.length === 1 && pl[0].tipo === 'recolocar', pl.map(p => p.tipo));
  ck('elegidas: la casa NO elegida (4) no entra', !pl[0].entran.includes(4) && !pl[0].despues.some(x => x.unidad_id === 4));
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  ck('elegidas: Σ se conserva al centavo (1000)', suma(res.asigs, 10) === 1000, suma(res.asigs, 10));
  ck('elegidas: queda solo 2 y 3', JSON.stringify(casasDe(res.asigs, 10)) === '[2,3]', casasDe(res.asigs, 10));
  ck('elegidas: proporción por indiviso (0.61 : 0.62)', Math.abs(res.asigs.find(a => a.unidad_id === 2).monto_asignado / 1000 - 0.61 / 1.23) < 0.001);
  ck('elegidas: conserva los asignacion_id existentes', res.asigs.some(a => a.asignacion_id === 'a2') && res.asigs.some(a => a.asignacion_id === 'a3'));
  ck('IDEMPOTENTE: re-planear sobre el resultado no hace nada', planRehacerCierre({ ...datos, asigs: res.asigs }, reglas()).length === 0);
}

// --- 2. automático (indiviso): recoloca entre TODAS las abiertas, marca entrantes ---
{
  const asigs = [A(1, { factura_id: 11, unidad_id: 1, metodo: 'indiviso', monto_asignado: 500 }),
                 A(2, { factura_id: 11, unidad_id: 2, metodo: 'indiviso', monto_asignado: 500 })];
  const datos = { asigs, facturas: [F(11)], unidades: unidades() };
  const pl = planRehacerCierre(datos, reglas());
  ck('indiviso: recoloca entre las 3 abiertas del proyecto', pl[0].despues.length === 3);
  ck('indiviso: 3 y 4 ENTRAN', JSON.stringify(pl[0].entran.sort()) === '[3,4]', pl[0].entran);
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  ck('indiviso: Σ conservada', suma(res.asigs, 11) === 1000);
  ck('indiviso: filas nuevas heredan partida/sub/método', res.asigs.filter(a => String(a.factura_id) === '11' && a.asignacion_id.startsWith('n')).every(a => a.partida_override === 'CONSTRUCCION' && a.sub_partida_override === 'Acabados' && a.metodo === 'indiviso'));
}

// --- 3. por partes: cada parte por separado, Σ por parte ---
{
  const asigs = [A(1, { factura_id: 12, unidad_id: 1, monto_asignado: 200 }), A(2, { factura_id: 12, unidad_id: 2, monto_asignado: 300 }),
                 A(3, { factura_id: 12, unidad_id: 1, monto_asignado: 250, partida_override: 'Indirectos', sub_partida_override: '' }),
                 A(4, { factura_id: 12, unidad_id: 3, monto_asignado: 250, partida_override: 'Indirectos', sub_partida_override: '' })];
  const pl = planRehacerCierre({ asigs, facturas: [F(12)], unidades: unidades() }, reglas());
  ck('por partes: dos acciones (una por parte)', pl.length === 2 && pl.every(p => p.tipo === 'recolocar'));
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  const sp = p => r2(res.asigs.filter(a => a.partida_override === p && String(a.factura_id) === '12').reduce((s, a) => s + a.monto_asignado, 0));
  ck('por partes: CONSTRUCCION conserva 500 (todo a la 2)', sp('CONSTRUCCION') === 500 && res.asigs.filter(a => a.partida_override === 'CONSTRUCCION').length === 1);
  ck('por partes: Indirectos conserva 500 (todo a la 3)', sp('Indirectos') === 500);
}

// --- 4. sin ninguna abierta → pendiente; 5. dirigidos → revisar ---
{
  const u = [U(1, 0.5, '2024-10-14'), U(2, 0.5, '2024-12-01')];
  const asigs = [A(1, { factura_id: 13, unidad_id: 1, monto_asignado: 500 }), A(2, { factura_id: 13, unidad_id: 2, monto_asignado: 500 }),
                 A(3, { factura_id: 14, unidad_id: 1, metodo: 'directo', monto_asignado: 1000, factor: 1 })];
  const pl = planRehacerCierre({ asigs, facturas: [F(13), F(14)], unidades: u }, reglas());
  const p13 = pl.find(p => p.docId === '13'), p14 = pl.find(p => p.docId === '14');
  ck('sin abiertas → pendiente', p13 && p13.tipo === 'pendiente');
  ck('directo a casa cerrada → revisar (sin cambios)', p14 && p14.tipo === 'revisar' && p14.despues === null);
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  ck('pendiente: la parte se quita completa', suma(res.asigs, 13) === 0);
  ck('revisar: el directo sigue intacto', suma(res.asigs, 14) === 1000);
}

// --- 6. documentos que no cuentan no se tocan; alcance por casa ---
{
  const asigs = [A(1, { factura_id: 15, unidad_id: 1, monto_asignado: 500 }), A(2, { factura_id: 15, unidad_id: 2, monto_asignado: 500 }),
                 A(3, { factura_id: 16, unidad_id: 1, monto_asignado: 500 }), A(4, { factura_id: 16, unidad_id: 2, monto_asignado: 500 })];
  const pl = planRehacerCierre({ asigs, facturas: [F(15, { estado_sat: 'Cancelada' }), F(16, { fecha_factura: 'ayer' })], unidades: unidades() }, reglas());
  ck('cancelada en SAT o fecha ilegible → no se toca', pl.length === 0, pl.map(p => p.docId));
  const asigs2 = [A(1, { factura_id: 17, unidad_id: 1, monto_asignado: 500 }), A(2, { factura_id: 17, unidad_id: 2, monto_asignado: 500 })];
  ck('alcance por OTRA casa (2, abierta) → nada', planRehacerCierre({ asigs: asigs2, facturas: [F(17)], unidades: unidades() }, reglas(), { unidadId: 2 }).length === 0);
  ck('alcance por la casa cerrada (1) → sí', planRehacerCierre({ asigs: asigs2, facturas: [F(17)], unidades: unidades() }, reglas(), { unidadId: 1 }).length === 1);
}

// --- 7. RESTAURAR: la fecha de cierre se corrige y la casa vuelve ---
{
  const asigs = [A(1, { factura_id: 20, unidad_id: 1, monto_asignado: 400 }), A(2, { factura_id: 20, unidad_id: 2, monto_asignado: 300 }),
                 A(3, { factura_id: 20, unidad_id: 3, monto_asignado: 300 })];
  let u = unidades();
  const pl = planRehacerCierre({ asigs, facturas: [F(20)], unidades: u }, reglas());
  const lote = { lote_id: 'L1', tipo: 'rehacer_cierre', detalle: { partes: pl } };
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  // Se corrige: la casa 1 en realidad cerró DESPUÉS de la factura.
  u = u.map(x => (x.unidad_id === 1 ? { ...x, fecha_termino: '2025-12-31' } : x));
  const pr = planRestaurar({ asigs: res.asigs, facturas: [F(20)], unidades: u }, [lote], reglas());
  ck('restaurar: detecta la casa reabierta', pr.length === 1 && pr[0].tipo === 'restaurar' && pr[0].entran.includes(1), pr);
  const res2 = aplicarAcciones(res.asigs.map(a => ({ ...a })), pr, { nuevoId, hoy: HOY });
  ck('restaurar: vuelve a estar 1, 2 y 3', JSON.stringify(casasDe(res2.asigs, 20)) === '[1,2,3]', casasDe(res2.asigs, 20));
  ck('restaurar: Σ se conserva (1000)', suma(res2.asigs, 20) === 1000);
  ck('restaurar IDEMPOTENTE: no la vuelve a meter', planRestaurar({ asigs: res2.asigs, facturas: [F(20)], unidades: u }, [lote], reglas()).length === 0);
  ck('y con la casa abierta, rehacer ya no la saca', planRehacerCierre({ asigs: res2.asigs, facturas: [F(20)], unidades: u }, reglas()).length === 0);
}

// --- 8. RESTAURAR una parte que quedó PENDIENTE (todas cerradas) ---
{
  let u = [U(1, 0.5, '2024-10-14'), U(2, 0.5, '2024-12-01')];
  const asigs = [A(1, { factura_id: 21, unidad_id: 1, monto_asignado: 500 }), A(2, { factura_id: 21, unidad_id: 2, monto_asignado: 500 })];
  const pl = planRehacerCierre({ asigs, facturas: [F(21)], unidades: u }, reglas());
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  ck('pendiente: se quitó todo', suma(res.asigs, 21) === 0);
  u = u.map(x => (x.unidad_id === 2 ? { ...x, fecha_termino: '' } : x));   // la 2 no estaba cerrada
  const pr = planRestaurar({ asigs: res.asigs, facturas: [F(21)], unidades: u }, [{ lote_id: 'L2', tipo: 'rehacer_cierre', detalle: { partes: pl } }], reglas());
  const res2 = aplicarAcciones(res.asigs.map(a => ({ ...a })), pr, { nuevoId, hoy: HOY });
  ck('restaurar parte pendiente: se rearma con su monto (1000 a la 2)', suma(res2.asigs, 21) === 1000 && JSON.stringify(casasDe(res2.asigs, 21)) === '[2]', casasDe(res2.asigs, 21));
}

// --- 9. DUPLICADOS ---
{
  const unaVez = [A(1, { factura_id: 30, unidad_id: 2, monto_asignado: 600 }), A(2, { factura_id: 30, unidad_id: 3, monto_asignado: 400 })];
  const doble = [...unaVez, A(3, { factura_id: 30, unidad_id: 2, monto_asignado: 600, fecha_asignacion: '2025-10-01' }), A(4, { factura_id: 30, unidad_id: 3, monto_asignado: 400, fecha_asignacion: '2025-10-01' })];
  const pd = planDuplicados({ asigs: doble, facturas: [F(30)] });
  ck('doble reparto → quitar_duplicado (2 filas)', pd.length === 1 && pd[0].tipo === 'quitar_duplicado' && pd[0].quitar.length === 2, pd);
  ck('se quedan las más antiguas', pd[0].quitar.every(a => a.fecha_asignacion === '2025-10-01'));
  const res = aplicarAcciones(doble.map(a => ({ ...a })), pd, { nuevoId, hoy: HOY });
  ck('después: exactamente al 100%', suma(res.asigs, 30) === 1000);
  const mismo_dia = [...unaVez, A(5, { factura_id: 30, unidad_id: 2, monto_asignado: 600 }), A(6, { factura_id: 30, unidad_id: 3, monto_asignado: 400 })];
  ck('doble el MISMO día también se detecta', planDuplicados({ asigs: mismo_dia, facturas: [F(30)] })[0].tipo === 'quitar_duplicado');
  const raro = [A(1, { factura_id: 31, unidad_id: 2, monto_asignado: 700 }), A(2, { factura_id: 31, unidad_id: 3, monto_asignado: 500 })];
  ck('sobre-repartido sin filas idénticas → revisar', planDuplicados({ asigs: raro, facturas: [F(31)] })[0].tipo === 'revisar');
  ck('documento al 100% no se toca', planDuplicados({ asigs: unaVez, facturas: [F(30)] }).length === 0);
}

// ===== Casos de la revisión adversarial (2026-09-30) =====

// --- 10. pendiente → se reparte a mano → la casa se reabre: NO duplica (revisar) ---
{
  let u = [U(1, 0.5, '2024-10-14'), U(2, 0.5, '2024-12-01'), U(3, 0.5)];
  const asigs = [A(1, { factura_id: 40, unidad_id: 1, monto_asignado: 500 }), A(2, { factura_id: 40, unidad_id: 2, monto_asignado: 500 })];
  const pl = planRehacerCierre({ asigs, facturas: [F(40)], unidades: u }, reglas());
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  const lote = { lote_id: 'L40', creado: '2026-09-30T10:00:00Z', tipo: 'rehacer_cierre', detalle: { partes: partesLote(pl) } };
  const aMano = [...res.asigs, A(90, { factura_id: 40, unidad_id: 3, metodo: 'directo', monto_asignado: 1000, factor: 1, fecha_asignacion: '2026-10-02' })];
  u = u.map(x => (x.unidad_id === 2 ? { ...x, fecha_termino: '' } : x));
  const pr = planRestaurar({ asigs: aMano, facturas: [F(40)], unidades: u }, [lote], reglas());
  ck('pendiente re-repartido a mano + reapertura → revisar, no restaurar', pr.length === 1 && pr[0].tipo === 'revisar', pr.map(p => p.tipo));
  const res2 = aplicarAcciones(aMano.map(a => ({ ...a })), pr, { nuevoId, hoy: HOY });
  ck('… y el documento sigue en 1000 (no 2000)', suma(res2.asigs, 40) === 1000, suma(res2.asigs, 40));
}

// --- 11. dos partes misma partida, distinta fecha, ambas pendientes → restaurar devuelve LAS DOS ---
{
  let u = [U(1, 0.5, '2024-10-14'), U(2, 0.5, '2024-12-01')];
  const asigs = [A(1, { factura_id: 41, unidad_id: 1, monto_asignado: 300, fecha_asignacion: '2025-09-01' }),
                 A(2, { factura_id: 41, unidad_id: 2, monto_asignado: 300, fecha_asignacion: '2025-09-01' }),
                 A(3, { factura_id: 41, unidad_id: 1, monto_asignado: 200, fecha_asignacion: '2025-09-02' }),
                 A(4, { factura_id: 41, unidad_id: 2, monto_asignado: 200, fecha_asignacion: '2025-09-02' })];
  const pl = planRehacerCierre({ asigs, facturas: [F(41)], unidades: u }, reglas());
  ck('dos partes → dos pendientes', pl.length === 2 && pl.every(p => p.tipo === 'pendiente'), pl.map(p => p.tipo));
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  const lote = { lote_id: 'L41', creado: '2026-09-30T10:00:00Z', tipo: 'rehacer_cierre', detalle: { partes: partesLote(pl) } };
  u = u.map(x => (x.unidad_id === 2 ? { ...x, fecha_termino: '' } : x));
  const pr = planRestaurar({ asigs: res.asigs, facturas: [F(41)], unidades: u }, [lote], reglas());
  const res2 = aplicarAcciones(res.asigs.map(a => ({ ...a })), pr, { nuevoId, hoy: HOY });
  ck('restaurar devuelve 600 + 400 = 1000 (no se pierde una parte)', suma(res2.asigs, 41) === 1000, suma(res2.asigs, 41));
  const fechas = [...new Set(res2.asigs.filter(a => String(a.factura_id) === '41').map(a => a.fecha_asignacion))].sort();
  ck('cada parte conserva su fecha', JSON.stringify(fechas) === '["2025-09-01","2025-09-02"]', fechas);
  ck('restaurar idempotente con dos partes', planRestaurar({ asigs: res2.asigs, facturas: [F(41)], unidades: u }, [lote], reglas()).length === 0);
}

// --- 12. rehacer → restaurar conserva la fecha de la parte (no pone "hoy") ---
{
  const asigs = [A(1, { factura_id: 42, unidad_id: 1, metodo: 'indiviso', monto_asignado: 500 }),
                 A(2, { factura_id: 42, unidad_id: 2, metodo: 'indiviso', monto_asignado: 500 })];
  let u = unidades();
  const pl = planRehacerCierre({ asigs, facturas: [F(42)], unidades: u }, reglas());
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  ck('rehacer: todas las filas (viejas y nuevas) quedan con la fecha de la parte',
    res.asigs.filter(a => String(a.factura_id) === '42').every(a => a.fecha_asignacion === '2025-09-01'));
  const lote = { lote_id: 'L42', creado: '2026-09-30T10:00:00Z', tipo: 'rehacer_cierre', detalle: { partes: partesLote(pl) } };
  u = u.map(x => (x.unidad_id === 1 ? { ...x, fecha_termino: '' } : x));
  const pr = planRestaurar({ asigs: res.asigs, facturas: [F(42)], unidades: u }, [lote], reglas());
  const res2 = aplicarAcciones(res.asigs.map(a => ({ ...a })), pr, { nuevoId, hoy: HOY });
  ck('restaurar (indiviso): vuelve la 1, Σ 1000, misma fecha',
    casasDe(res2.asigs, 42).includes(1) && suma(res2.asigs, 42) === 1000 &&
    res2.asigs.filter(a => String(a.factura_id) === '42').every(a => a.fecha_asignacion === '2025-09-01'));
}

// --- 13. dos repartos de ELEGIDAS el mismo día, distinta selección → revisar ---
{
  const u = [...unidades(), U(5, 0.6)];
  const t = 1 / 3, m = 1 / 2;
  const asigs = [A(1, { factura_id: 43, unidad_id: 1, monto_asignado: 300, factor: t }), A(2, { factura_id: 43, unidad_id: 2, monto_asignado: 300, factor: t }),
                 A(3, { factura_id: 43, unidad_id: 3, monto_asignado: 300, factor: t }),
                 A(4, { factura_id: 43, unidad_id: 4, monto_asignado: 50, factor: m }), A(5, { factura_id: 43, unidad_id: 5, monto_asignado: 50, factor: m })];
  const pl = planRehacerCierre({ asigs, facturas: [F(43)], unidades: u }, reglas());
  ck('elegidas mezcladas el mismo día → revisar', pl.length === 1 && pl[0].tipo === 'revisar', pl.map(p => p.tipo));
  // Un solo reparto con redondeo (100.01 entre 3) NO se confunde con mezcla.
  const asigs2 = [A(1, { factura_id: 44, unidad_id: 1, monto_asignado: 33.34, factor: t }), A(2, { factura_id: 44, unidad_id: 2, monto_asignado: 33.34, factor: t }),
                  A(3, { factura_id: 44, unidad_id: 3, monto_asignado: 33.33, factor: t })];
  const pl2 = planRehacerCierre({ asigs: asigs2, facturas: [F(44, { monto_total: 100.01 })], unidades: u }, reglas());
  ck('un reparto con centavos de redondeo sí se recoloca', pl2.length === 1 && pl2[0].tipo === 'recolocar', pl2.map(p => p.tipo));
  // Una casa repetida en la parte también es mezcla.
  const asigs3 = [A(1, { factura_id: 45, unidad_id: 1, monto_asignado: 500 }), A(2, { factura_id: 45, unidad_id: 2, monto_asignado: 250 }),
                  A(3, { factura_id: 45, unidad_id: 2, monto_asignado: 250 })];
  const pl3 = planRehacerCierre({ asigs: asigs3, facturas: [F(45)], unidades: u }, reglas());
  ck('casa repetida en la parte → revisar', pl3.length === 1 && pl3[0].tipo === 'revisar', pl3.map(p => p.tipo));
}

// --- 14. duplicado del MISMO día con casa cerrada → revisar (primero 🧹) ---
{
  const una = [A(1, { factura_id: 46, unidad_id: 1, monto_asignado: 400 }), A(2, { factura_id: 46, unidad_id: 2, monto_asignado: 300 }),
               A(3, { factura_id: 46, unidad_id: 3, monto_asignado: 300 })];
  const doble = [...una, A(4, { factura_id: 46, unidad_id: 1, monto_asignado: 400 }), A(5, { factura_id: 46, unidad_id: 2, monto_asignado: 300 }),
                 A(6, { factura_id: 46, unidad_id: 3, monto_asignado: 300 })];
  const pl = planRehacerCierre({ asigs: doble, facturas: [F(46)], unidades: unidades() }, reglas());
  ck('sobre-repartido con casa cerrada → revisar, no recolocar', pl.length === 1 && pl[0].tipo === 'revisar' && /🧹/.test(pl[0].motivo), pl.map(p => p.tipo));
  ck('… y 🧹 lo sigue pudiendo arreglar', planDuplicados({ asigs: doble, facturas: [F(46)] })[0].tipo === 'quitar_duplicado');
}

// --- 15. lotes desordenados: manda el más reciente por "creado"; el anulado no cuenta ---
{
  let u = [U(1, 0.5, '2024-10-14'), U(2, 0.5, '2024-12-01')];
  const parte = (monto, quitadas) => ({ tipo: 'pendiente', docTipo: 'factura', docId: '47', fechaParte: '2025-09-01', proyecto: 'Paraíso',
    partida: 'CONSTRUCCION', sub: 'Acabados', obra: '', metodo: 'indiviso_sel', montoParte: monto, seleccionOriginal: [1, 2], quitadas });
  const viejo = { lote_id: 'L-zzz', creado: '2026-09-01T10:00:00Z', tipo: 'rehacer_cierre', detalle: { partes: [parte(800, [{ unidad_id: 1, monto: 400 }])] } };
  const nuevo = { lote_id: 'L-aaa', creado: '2026-09-20T10:00:00Z', tipo: 'rehacer_cierre', detalle: { partes: [parte(1000, [{ unidad_id: 2, monto: 500 }])] } };
  u = u.map(x => ({ ...x, fecha_termino: '' }));   // las dos se reabren
  const pr = planRestaurar({ asigs: [], facturas: [F(47)], unidades: u }, [nuevo, viejo], reglas());
  ck('manda el lote más reciente por creado (1000), aunque su id ordene antes', pr.length === 1 && pr[0].montoParte === 1000, pr.map(p => p.montoParte));
  ck('junta las casas quitadas de los dos lotes', pr.length === 1 && JSON.stringify(pr[0].entran.slice().sort()) === '[1,2]', pr.map(p => p.entran));
  const anula = { lote_id: 'L-x', creado: '2026-09-21T10:00:00Z', tipo: 'anulado', detalle: { anula: 'L-aaa' } };
  const pr2 = planRestaurar({ asigs: [], facturas: [F(47)], unidades: u }, [nuevo, viejo, anula], reglas());
  ck('lote anulado no cuenta (queda el viejo: 800, solo la 1)', pr2.length === 1 && pr2[0].montoParte === 800 && JSON.stringify(pr2[0].entran) === '[1]', pr2.map(p => [p.montoParte, p.entran]));
}

// --- 16. nota de crédito (negativa): se quita y se restaura igual ---
{
  let u = [U(1, 0.5, '2024-10-14'), U(2, 0.5, '2024-12-01')];
  const asigs = [A(1, { factura_id: 48, unidad_id: 1, monto_asignado: -500 }), A(2, { factura_id: 48, unidad_id: 2, monto_asignado: -500 })];
  const fac = F(48, { monto_total: -1000 });
  const pl = planRehacerCierre({ asigs, facturas: [fac], unidades: u }, reglas());
  ck('NC entre casas cerradas → pendiente', pl.length === 1 && pl[0].tipo === 'pendiente');
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  const lote = { lote_id: 'L48', creado: '2026-09-30T10:00:00Z', tipo: 'rehacer_cierre', detalle: { partes: partesLote(pl) } };
  u = u.map(x => (x.unidad_id === 2 ? { ...x, fecha_termino: '' } : x));
  const pr = planRestaurar({ asigs: res.asigs, facturas: [fac], unidades: u }, [lote], reglas());
  const res2 = aplicarAcciones(res.asigs.map(a => ({ ...a })), pr, { nuevoId, hoy: HOY });
  ck('NC restaurada: −1000 a la casa 2', pr.length === 1 && pr[0].tipo === 'restaurar' && suma(res2.asigs, 48) === -1000, [pr.map(p => p.tipo), suma(res2.asigs, 48)]);
}

// --- 17. firma del plan y verificación de totales ---
{
  const asigs = [A(1, { factura_id: 49, unidad_id: 1, monto_asignado: 400 }), A(2, { factura_id: 49, unidad_id: 2, monto_asignado: 300 }),
                 A(3, { factura_id: 49, unidad_id: 3, monto_asignado: 300 })];
  const d = { asigs, facturas: [F(49)], unidades: unidades() };
  const f1 = firmaPlan(planRehacerCierre(d, reglas())), f2 = firmaPlan(planRehacerCierre(d, reglas()));
  ck('firma: el mismo estado da la misma firma', f1 === f2 && f1.length > 0);
  const d2 = { ...d, asigs: asigs.map(a => (a.unidad_id === 2 ? { ...a, monto_asignado: 250 } : a)).concat([A(9, { factura_id: 49, unidad_id: 3, monto_asignado: 50, fecha_asignacion: '2025-09-05' })]) };
  ck('firma: si otra sesión cambió el reparto, la firma cambia', firmaPlan(planRehacerCierre(d2, reglas())) !== f1);
  const pl = planRehacerCierre(d, reglas());
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  ck('verificación: nada queda repartido de más', sobreRepartidos({ ...d, asigs: res.asigs }, pl).length === 0);
  ck('verificación: detecta un documento repartido de más', sobreRepartidos({ ...d, asigs: [...res.asigs, A(99, { factura_id: 49, unidad_id: 2, monto_asignado: 10 })] }, pl).length === 1);
}

// ===== 2a revisión adversarial (2026-09-30) =====

// --- 18. dos partes pendientes: se deciden JUNTAS contra el total del documento ---
{
  const u0 = [U(1, 0.5, '2024-10-14'), U(2, 0.5, '2024-12-01'), U(3, 0.5)];
  const asigs = [A(1, { factura_id: 50, unidad_id: 1, monto_asignado: 300, fecha_asignacion: '2025-09-01' }),
                 A(2, { factura_id: 50, unidad_id: 2, monto_asignado: 300, fecha_asignacion: '2025-09-01' }),
                 A(3, { factura_id: 50, unidad_id: 1, monto_asignado: 200, fecha_asignacion: '2025-09-02' }),
                 A(4, { factura_id: 50, unidad_id: 2, monto_asignado: 200, fecha_asignacion: '2025-09-02' })];
  const pl = planRehacerCierre({ asigs, facturas: [F(50)], unidades: u0 }, reglas());
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  const lote = { lote_id: 'L50', creado: '2026-09-30T10:00:00Z', tipo: 'rehacer_cierre', detalle: { partes: partesLote(pl) } };
  const u = u0.map(x => (x.unidad_id === 2 ? { ...x, fecha_termino: '' } : x));
  // (a) alguien repartió 300 a mano mientras estaba pendiente
  const aMano = [...res.asigs, A(91, { factura_id: 50, unidad_id: 3, metodo: 'directo', monto_asignado: 300, factor: 1, fecha_asignacion: '2026-10-02' })];
  const pa = planRestaurar({ asigs: aMano, facturas: [F(50)], unidades: u }, [lote], reglas());
  ck('2 pendientes + 300 a mano → las dos a revisar (no 1300 de 1000)', pa.length === 2 && pa.every(p => p.tipo === 'revisar'), pa.map(p => p.tipo));
  // (b) el total de la factura se corrigió a 800
  const pb = planRestaurar({ asigs: res.asigs, facturas: [F(50, { monto_total: 800 })], unidades: u }, [lote], reglas());
  ck('2 pendientes y total bajó a 800 → revisar (no 1000 de 800)', pb.length === 2 && pb.every(p => p.tipo === 'revisar'), pb.map(p => p.tipo));
}

// --- 19. parte RECOLOCADA que luego se borró a mano → no se re-crea (revisar) ---
{
  const asigs = [A(1, { factura_id: 51, unidad_id: 1, monto_asignado: 400 }), A(2, { factura_id: 51, unidad_id: 2, monto_asignado: 300 }),
                 A(3, { factura_id: 51, unidad_id: 3, monto_asignado: 300 })];
  let u = unidades();
  const pl = planRehacerCierre({ asigs, facturas: [F(51)], unidades: u }, reglas());
  const lote = { lote_id: 'L51', creado: '2026-09-30T10:00:00Z', tipo: 'rehacer_cierre', detalle: { partes: partesLote(pl) } };
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  const limpio = res.asigs.filter(a => String(a.factura_id) !== '51');   // "Limpiar reparto"
  u = u.map(x => (x.unidad_id === 1 ? { ...x, fecha_termino: '' } : x));
  const pr = planRestaurar({ asigs: limpio, facturas: [F(51)], unidades: u }, [lote], reglas());
  ck('recolocada y luego borrada a mano → revisar, no se re-crea', pr.length === 1 && pr[0].tipo === 'revisar', pr.map(p => p.tipo));
  ck('… y el documento sigue sin reparto', suma(aplicarAcciones(limpio.map(a => ({ ...a })), pr, { nuevoId, hoy: HOY }).asigs, 51) === 0);
}

// --- 20. dos repartos de elegidas el mismo día con el MISMO monto → revisar ---
{
  const u = [...unidades(), U(5, 0.6)];
  const t = 1 / 3;
  const asigs = [A(1, { factura_id: 52, unidad_id: 1, monto_asignado: 250, factor: 0.5 }), A(2, { factura_id: 52, unidad_id: 2, monto_asignado: 250, factor: 0.5 }),
                 A(3, { factura_id: 52, unidad_id: 3, monto_asignado: 166.67, factor: t }), A(4, { factura_id: 52, unidad_id: 4, monto_asignado: 166.67, factor: t }),
                 A(5, { factura_id: 52, unidad_id: 5, monto_asignado: 166.66, factor: t })];
  const pl = planRehacerCierre({ asigs, facturas: [F(52)], unidades: u }, reglas());
  ck('mitades iguales del mismo día (Σ factores = 2) → revisar', pl.length === 1 && pl[0].tipo === 'revisar', pl.map(p => p.tipo));
}

// --- 21. parte con fecha VACÍA (filas viejas): las filas nuevas no toman "hoy" ---
{
  const asigs = [A(1, { factura_id: 53, unidad_id: 1, metodo: 'indiviso', monto_asignado: 500, fecha_asignacion: '' }),
                 A(2, { factura_id: 53, unidad_id: 2, metodo: 'indiviso', monto_asignado: 500, fecha_asignacion: '' })];
  const pl = planRehacerCierre({ asigs, facturas: [F(53)], unidades: unidades() }, reglas());
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pl, { nuevoId, hoy: HOY });
  ck('fecha vacía se conserva vacía (la parte no se parte en dos)',
    res.asigs.filter(a => String(a.factura_id) === '53').every(a => a.fecha_asignacion === ''), res.asigs.filter(a => String(a.factura_id) === '53').map(a => a.fecha_asignacion));
}

// --- 22. casa dada de baja SIN cierre dentro de la parte → revisar (no pierde su parte en silencio) ---
{
  const u = [U(1, 0.5, '2024-10-14'), U(2, 0.5), U(3, 0.5, '', { activo: false })];
  const asigs = [A(1, { factura_id: 54, unidad_id: 1, monto_asignado: 300 }), A(2, { factura_id: 54, unidad_id: 2, monto_asignado: 300 }),
                 A(3, { factura_id: 54, unidad_id: 3, monto_asignado: 400 })];
  const pl = planRehacerCierre({ asigs, facturas: [F(54)], unidades: u }, reglas());
  ck('casa de baja sin cierre en la parte → revisar', pl.length === 1 && pl[0].tipo === 'revisar', pl.map(p => p.tipo));
}

// --- 23. una fila en dos acciones → aplicar se niega (no duplica) ---
{
  const asigs = [A(1, { factura_id: 55, unidad_id: 1, monto_asignado: 500 }), A(2, { factura_id: 55, unidad_id: 2, monto_asignado: 500 })];
  const pl = planRehacerCierre({ asigs, facturas: [F(55)], unidades: unidades() }, reglas());
  let lanzo = false;
  try { aplicarAcciones(asigs.map(a => ({ ...a })), [...pl, ...pl], { nuevoId, hoy: HOY }); } catch (e) { lanzo = /dos acciones/.test(e.message); }
  ck('fila repetida entre acciones → error, no se aplica', lanzo);
}

// --- 24. lote de formato viejo (sin fecha de parte) → se ignora ---
{
  const u = [U(1, 0.5), U(2, 0.5)];
  const viejo = { lote_id: 'L-v', creado: '2026-09-01T10:00:00Z', tipo: 'rehacer_cierre', detalle: { partes: [{ tipo: 'pendiente', docTipo: 'factura', docId: '56',
    partida: 'CONSTRUCCION', sub: 'Acabados', metodo: 'indiviso_sel', montoParte: 1000, quitadas: [{ unidad_id: 1, monto: 500 }] }] } };
  ck('lote sin fechaParte → no genera acciones', planRestaurar({ asigs: [], facturas: [F(56)], unidades: u }, [viejo], reglas()).length === 0);
}

// ===== Copias completas: el dueño elige cuál se queda (2026-09-30, Fac 467 y 322) =====

// --- 25. como la 467: dos sub-partidas, mismas casas y montos → elegir_copia ---
{
  const u = [U(1, 0.5), U(2, 0.5)];
  const asigs = [A(1, { factura_id: 60, unidad_id: 1, monto_asignado: 500, factor: 0.5, sub_partida_override: 'Instalaciones Hidrosanitarias', fecha_asignacion: '2026-01-07' }),
                 A(2, { factura_id: 60, unidad_id: 2, monto_asignado: 500, factor: 0.5, sub_partida_override: 'Instalaciones Hidrosanitarias', fecha_asignacion: '2026-01-07' }),
                 A(3, { factura_id: 60, unidad_id: 1, monto_asignado: 500, factor: 0.5, sub_partida_override: 'Muebles de Bano', fecha_asignacion: '2026-01-20' }),
                 A(4, { factura_id: 60, unidad_id: 2, monto_asignado: 500, factor: 0.5, sub_partida_override: 'Muebles de Bano', fecha_asignacion: '2026-01-20' })];
  const pd = planDuplicados({ asigs, facturas: [F(60)] });
  ck('467: dos copias con distinta sub → elegir_copia (no revisar)', pd.length === 1 && pd[0].tipo === 'elegir_copia' && pd[0].copias.length === 2, pd.map(p => p.tipo));
  ck('467: elegir_copia no se aplica sola', aplicarAcciones(asigs.map(a => ({ ...a })), pd, { nuevoId, hoy: HOY }).asigs.length === 4);
  const muebles = pd[0].copias.find(c => c.sub === 'Muebles de Bano');
  const pq = planQuitarCopias({ asigs, facturas: [F(60)] }, [{ docTipo: 'factura', docId: '60', clave: muebles.clave }]);
  ck('467: elegir "Muebles de Baño" → quitar_duplicado', pq.length === 1 && pq[0].tipo === 'quitar_duplicado' && pq[0].quitar.length === 2, pq.map(p => p.tipo));
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), pq, { nuevoId, hoy: HOY });
  ck('467: queda al 100% y solo con la sub elegida', suma(res.asigs, 60) === 1000 && res.asigs.every(a => a.sub_partida_override === 'Muebles de Bano'));
  ck('467: después ya no hay nada que elegir', planDuplicados({ asigs: res.asigs, facturas: [F(60)] }).length === 0);
  ck('467: elección vieja sobre datos ya corregidos → revisar, no toca',
    planQuitarCopias({ asigs: res.asigs, facturas: [F(60)] }, [{ docTipo: 'factura', docId: '60', clave: muebles.clave }])[0].tipo === 'revisar');
}

// --- 26. como la 322: partes iguales entre 6 casas y otra vez entre 9 → elegir_copia ---
{
  const u = Array.from({ length: 12 }, (_, i) => U(i + 1, 0.5));
  const seis = [1, 2, 3, 4, 5, 6], nueve = [5, 6, 7, 8, 9, 10, 11, 12, 1];
  const reparte = (casas, fecha, base) => casas.map((c, i) => A(base + i, { factura_id: 61, unidad_id: c, metodo: 'equitativo', sub_partida_override: 'Estructura',
    monto_asignado: i === casas.length - 1 ? r2(1000 - r2(1000 / casas.length) * (casas.length - 1)) : r2(1000 / casas.length), factor: 1 / casas.length, fecha_asignacion: fecha }));
  const asigs = [...reparte(seis, '2025-10-01', 100), ...reparte(nueve, '2025-11-15', 200)];
  const pd = planDuplicados({ asigs, facturas: [F(61)] });
  ck('322: dos repartos completos con distintas casas → elegir_copia', pd.length === 1 && pd[0].tipo === 'elegir_copia', pd.map(p => p.tipo));
  const de9 = pd[0].copias.find(c => c.filas.length === 9);
  const res = aplicarAcciones(asigs.map(a => ({ ...a })), planQuitarCopias({ asigs, facturas: [F(61)] }, [{ docTipo: 'factura', docId: '61', clave: de9.clave }]), { nuevoId, hoy: HOY });
  ck('322: elegir la de 9 casas → quedan esas 9 y el 100%', suma(res.asigs, 61) === 1000 && casasDe(res.asigs, 61).length === 9, [suma(res.asigs, 61), casasDe(res.asigs, 61)]);
}

// --- 27. sobre-repartido donde un paso NO suma el total → sigue en revisar ---
{
  const asigs = [A(1, { factura_id: 62, unidad_id: 1, monto_asignado: 1000, fecha_asignacion: '2025-09-01' }),
                 A(2, { factura_id: 62, unidad_id: 2, monto_asignado: 300, fecha_asignacion: '2025-09-05' })];
  const pd = planDuplicados({ asigs, facturas: [F(62)] });
  ck('pasos que no son copias completas → revisar (con las casas en el Excel)', pd.length === 1 && pd[0].tipo === 'revisar' && pd[0].antes.length === 2, pd.map(p => p.tipo));
}

// ===== Falsas alarmas de "mezcla" vistas en la 1a corrida real (2026-09-30) =====
{
  // 80 casas con el mismo indiviso; la 1 cerró en 2024 (como la 329).
  const u80 = Array.from({ length: 80 }, (_, i) => U(i + 1, 0.5, i === 0 ? '2024-10-14' : ''));
  const paso = (fid, importe, casas, fecha, base) => {
    const c = r2(importe / casas.length);
    return casas.map((uid, i) => A(base + i, { factura_id: fid, unidad_id: uid, factor: 1 / casas.length, fecha_asignacion: fecha,
      monto_asignado: i === casas.length - 1 ? r2(importe - c * (casas.length - 1)) : c }));
  };
  const todas = u80.map(x => x.unidad_id);

  // --- 28. como Fac 510: UN reparto de 80 casas, la última con ajuste de $0.30 ---
  const a28 = paso(70, 4023.70, todas, '2025-09-01', 1000);
  const f28 = F(70, { monto_total: 4023.70 });
  ck('80 casas con ajuste de centavos en la última → NO es mezcla (se recoloca)',
    (() => { const pl = planRehacerCierre({ asigs: a28, facturas: [f28], unidades: u80 }, reglas()); return pl.length === 1 && pl[0].tipo === 'recolocar'; })());

  // --- 29. como Fac 568: la MISMA selección de 80 casas, dos veces el mismo día ---
  const a29 = [...paso(71, 4000, todas, '2025-09-01', 2000), ...paso(71, 3500, todas, '2025-09-01', 3000)];
  const f29 = F(71, { monto_total: 7500 });
  const pl29 = planRehacerCierre({ asigs: a29, facturas: [f29], unidades: u80 }, reglas());
  ck('misma selección repartida 2 veces el mismo día → se recoloca', pl29.length === 1 && pl29[0].tipo === 'recolocar', pl29.map(p => p.tipo));
  const r29 = aplicarAcciones(a29.map(a => ({ ...a })), pl29, { nuevoId, hoy: HOY });
  const filas29 = r29.asigs.filter(a => String(a.factura_id) === '71');
  ck('… Σ se conserva (7500) y la casa cerrada sale', suma(r29.asigs, 71) === 7500 && !filas29.some(a => a.unidad_id === 1), suma(r29.asigs, 71));
  ck('… una fila por casa, cada una 7500/79 (solo una con el ajuste de centavos)',
    filas29.length === 79 && filas29.filter(a => Math.abs(a.monto_asignado - 7500 / 79) > 0.01).length <= 1
      && filas29.every(a => Math.abs(a.monto_asignado - 7500 / 79) < 0.5), filas29.slice(0, 2).map(a => a.monto_asignado));
  ck('… y si se vuelve a correr ya no hay nada que hacer (el ajuste no se toma por mezcla)',
    planRehacerCierre({ asigs: r29.asigs, facturas: [f29], unidades: u80 }, reglas()).length === 0);

  // --- 30. dos repartos del mismo día con DISTINTA selección (80 y luego 40) → sigue en revisar ---
  const a30 = [...paso(72, 4000, todas, '2025-09-01', 4000), ...paso(72, 2000, todas.slice(0, 40), '2025-09-01', 5000)];
  const pl30 = planRehacerCierre({ asigs: a30, facturas: [F(72, { monto_total: 6000 })], unidades: u80 }, reglas());
  ck('distinta selección el mismo día → revisar', pl30.length === 1 && pl30[0].tipo === 'revisar', pl30.map(p => p.tipo));
}

console.log(`\n${ok} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);

// Pruebas del lector de clase de costo (Directo / Indirecto de obra) y su match por UUID.
//   node scripts/test-clase-costo.mjs
// Datos inventados con la forma del reporte de contabilidad (no datos reales).
import { claseDeTexto, proyectoDeHoja, leerReporteClase, emparejarClase, planClase } from '../src/services/clase-costo.js';

let ok = 0, fail = 0;
const ck = (n, c, d) => { if (c) { ok++; console.log('OK  ' + n); } else { fail++; console.error('XX  ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); } };

const U = n => `${String(n).padStart(8, 'A')}-1111-2222-3333-444455556666`;   // UUID de prueba

// Hoja tipo ENE (col D "GASTO / COSTO", con IEPS/ISH) y tipo FEB (col D SIN encabezado).
const encEne = ['Estado SAT', 'Tipo', 'Fecha Emision', 'GASTO / COSTO', 'Folio', 'UUID', 'RFC Emisor', 'Nombre Emisor', 'SubTotal', 'Descuento', 'Total IEPS', 'IVA 16%', 'Retenido IVA', 'Retenido ISR', 'ISH', 'Total'];
const encFeb = ['Estado SAT', 'Tipo', 'Fecha Emision', null, 'Folio', 'UUID', 'RFC Emisor', 'Nombre Emisor', 'SubTotal', 'Descuento', 'IVA 16%', 'Retenido IVA', 'Retenido ISR', 'Total'];
const fila = (uuid, cuenta, total, extra = {}) => ['Vigente', 'Factura', '05/01/2026', cuenta, extra.folio || '1', uuid, 'XAXX010101000', extra.emisor || 'PROVEEDOR', total, 0, 0, 0, 0, 0, 0, total];
const filaFeb = (uuid, cuenta, total) => ['Vigente', 'Factura', '03/02/2026', cuenta, '2', uuid, 'XAXX010101000', 'PROVEEDOR', total, 0, 0, 0, 0, total];
const sec = t => [null, null, null, null, null, t];

const hojas = [
  { nombre: 'ENE E.U.', filas: [encEne, sec('COSTOS DIRECTOS DE OBRA'),
    fila(U(1), '1115-002-010-001-006', 1160.04), fila(U(2), '1115-002-010-001-010', 38538.51),
    [], sec('COSTOS INDIRECTOS DE OBRA'),
    fila(U(3), '1115-002-010-005-001', 500)] },
  { nombre: 'FEB P.P. ', filas: [encFeb, sec('COSTOS DIRECTOS DE OBRA'),
    filaFeb(U(4), '1115-001-010-001-006', 15000), filaFeb(U(1), '1115-002-010-001-006', 1160.04),   // U(1) repetido, misma clase
    sec('COSTOS INDIRECTOS DE OBRA'),
    filaFeb(U(5), '1115-001-010-005-002', 700)] },
  { nombre: 'Notas', filas: [['sin encabezado'], ['nada']] },
];

// --- 1. utilidades ---
ck('claseDeTexto: Directo / INDIRECTO DE OBRA / d / i', claseDeTexto('Directo') === 'directo' && claseDeTexto('COSTOS INDIRECTOS DE OBRA') === 'indirecto' && claseDeTexto('d') === 'directo' && claseDeTexto('I') === 'indirecto' && claseDeTexto('otra') === '');
ck('proyectoDeHoja: E.U. → EU, P.P. → PP, otra → ""', proyectoDeHoja('ENE E.U.') === 'EU' && proyectoDeHoja('MZO P.P. ') === 'PP' && proyectoDeHoja('Notas') === '');

// --- 2. lector del formato de contabilidad ---
const lect = leerReporteClase(hojas);
ck('lee 5 facturas únicas (el UUID repetido con la misma clase cuenta una vez)', lect.registros.length === 5, lect.registros.map(r => r.uuid));
ck('secciones: 3 directas y 2 indirectas', lect.registros.filter(r => r.clase === 'directo').length === 3 && lect.registros.filter(r => r.clase === 'indirecto').length === 2);
const r1 = lect.registros.find(r => r.uuidNorm === U(1).toLowerCase());
ck('U(1): directo, cuenta 1115-002-010-001-006, hoja ENE E.U., proyecto EU, total 1160.04', r1 && r1.clase === 'directo' && r1.cuenta === '1115-002-010-001-006' && r1.proyHoja === 'EU' && r1.total === 1160.04, r1);
const r4 = lect.registros.find(r => r.uuidNorm === U(4).toLowerCase());
ck('hoja FEB sin encabezado de cuenta: la cuenta se encuentra por su forma', r4 && r4.cuenta === '1115-001-010-001-006' && r4.proyHoja === 'PP', r4);
ck('el renglón vacío entre secciones no rompe nada y la hoja sin UUID se reporta', lect.avisos.some(a => a.hoja === 'Notas'));
ck('conteo por hoja', lect.porHoja[0].directo === 2 && lect.porHoja[0].indirecto === 1 && lect.porHoja[1].repetidos === 1);

// --- 3. mismo UUID con DISTINTA clase → conflicto, no se aplica ---
{
  const l2 = leerReporteClase([{ nombre: 'X', filas: [encEne, sec('COSTOS DIRECTOS DE OBRA'), fila(U(9), '1115-001-010-001-006', 10),
    sec('COSTOS INDIRECTOS DE OBRA'), fila(U(9), '1115-001-010-005-001', 10)] }]);
  ck('UUID en las dos secciones → conflicto y fuera de los registros', l2.registros.length === 0 && l2.conflictos.length === 1, l2);
}

// --- 4. formato sencillo: UUID + Clase ---
{
  const l3 = leerReporteClase([{ nombre: 'Hoja1', filas: [['UUID', 'Clase'], [U(1), 'Indirecto'], [U(2), 'directo'], [U(3), '']] }]);
  ck('formato sencillo: lee la clase de su columna', l3.registros.length === 2 && l3.registros[0].clase === 'indirecto' && l3.registros[1].clase === 'directo');
  ck('… y la fila sin clase se avisa', l3.avisos.some(a => a.motivo && a.motivo.includes('sin sección')));
}

// --- 5. match por UUID: completo, primer bloque, ambiguo, no encontrado ---
const facturas = [
  { factura_id: 10, uuid: U(1).toLowerCase(), proyecto: 'Entorno' },                         // completo (minúsculas)
  { factura_id: 11, uuid: U(2).split('-')[0], proyecto: 'Entorno' },                         // solo el primer bloque
  { factura_id: 12, uuid: U(4), proyecto: 'Entorno' },                                       // proyecto distinto (PP en el reporte)
  { factura_id: 13, uuid: U(5).split('-')[0], proyecto: 'Privada del Paraíso' },
  { factura_id: 14, uuid: U(5).split('-')[0], proyecto: 'Privada del Paraíso' },             // dos con el mismo primer bloque → ambigua
  { factura_id: 15, uuid: '0000AAAA-9999-2222-3333-444455556666', proyecto: 'Entorno' },     // otro CFDI con distinto UUID
];
const m = emparejarClase(lect.registros, facturas);
const via = id => (m.matches.find(x => String(x.factura.factura_id) === String(id)) || {}).via;
ck('UUID completo (sin importar mayúsculas)', via(10) === 'uuid completo');
ck('primer bloque cuando la app guardó solo eso', via(11) === 'primer bloque');
ck('dos facturas con el mismo primer bloque → ambigua, no se toca', m.ambiguas.length === 1 && m.ambiguas[0].registro.uuidNorm === U(5).toLowerCase());
ck('U(3) no está en la app', m.noEncontradas.length === 1 && m.noEncontradas[0].uuidNorm === U(3).toLowerCase());
ck('un UUID completo DISTINTO con el mismo primer bloque NO se confunde', !facturas.slice(5).some(f => m.matches.some(x => x.factura === f)));

// --- 6. plan: nuevas / cambian / iguales / proyecto distinto ---
{
  const existentes = new Map([['10', { clase: 'directo', cuenta_contable: '1115-002-010-001-006' }], ['11', { clase: 'indirecto', cuenta_contable: '' }]]);
  const proyectoDeCodigo = c => (c === 'EU' ? 'Entorno' : c === 'PP' ? 'Privada del Paraíso' : '');
  const proyMatch = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const p = planClase(m.matches, existentes, { proyectoDeCodigo, proyMatch });
  ck('Fac 10 ya estaba igual', p.iguales.length === 1 && p.iguales[0].factura_id === '10');
  ck('Fac 11 cambia de indirecto a directo', p.cambian.length === 1 && p.cambian[0].factura_id === '11' && p.cambian[0].clase === 'directo');
  ck('Fac 12 es nueva', p.nuevas.length === 1 && p.nuevas[0].factura_id === '12');
  ck('Fac 12: el reporte la pone en Paraíso y en la app es de Entorno → aviso', p.proyectoDistinto.length === 1 && p.proyectoDistinto[0].factura_id === '12' && p.proyectoDistinto[0].proyectoReporte === 'Privada del Paraíso');
}

// --- 7. otra sección (no Directo/Indirecto) corta la herencia; una fecha no es cuenta ---
{
  const h = [{ nombre: 'MZO E.U.', filas: [encFeb, sec('COSTOS INDIRECTOS DE OBRA'),
    filaFeb(U(31), '1115-001-010-005-002', 100),
    sec('GASTOS DE ADMINISTRACION'), filaFeb(U(32), '6100-001-001-001-001', 200),
    [null, null, null, null, null, null, null, null, 300, 0, 48, 0, 0, 348],          // renglón de totales (números): no corta
    filaFeb(U(33), '6100-001-001-001-002', 50),
    sec('COSTOS DIRECTOS DE OBRA'), filaFeb(U(34), '1115-001-010-001-006', 400)] }];
  const l = leerReporteClase(h);
  const cl = n => (l.registros.find(r => r.uuidNorm === U(n).toLowerCase()) || {}).clase;
  ck('"GASTOS DE ADMINISTRACION" corta: lo de abajo NO hereda Indirecto (va a avisos)', cl(31) === 'indirecto' && cl(32) === undefined && cl(33) === undefined && cl(34) === 'directo', l.registros.map(r => [r.uuid.slice(0, 8), r.clase]));
  ck('el aviso dice bajo qué sección venía', l.avisos.length === 2 && l.avisos.every(a => /GASTOS DE ADMINISTRACION/.test(a.motivo)), l.avisos.map(a => a.motivo));
  // FEB sin encabezado en la cuenta: la fecha en texto NO se toma como cuenta
  const fecha = [encFeb, sec('COSTOS DIRECTOS DE OBRA'), ['Vigente', 'Factura', '2026-02-03', null, '2', U(35), 'XAXX010101000', 'PROVEEDOR', 10, 0, 0, 0, 0, 10]];
  const rf = leerReporteClase([{ nombre: 'FEB E.U.', filas: fecha }]).registros[0];
  ck('una fecha 2026-02-03 no se toma como cuenta contable', rf && rf.clase === 'directo' && rf.cuenta === '', rf);
}

console.log(`\n${ok} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);

// Pruebas del motor puro src/services/clase-efectiva.js (node scripts/test-clase-efectiva.mjs)
import { claseEfectiva, PARTIDAS_DIRECTAS } from '../src/services/clase-efectiva.js';

let ok = 0, fail = 0;
const ck = (n, c, d) => { if (c) { ok++; } else { fail++; console.log('XX  ' + n, d !== undefined ? JSON.stringify(d) : ''); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Manda la clase de contabilidad, diga lo que diga la partida
ck('Ericka directo + partida Indirectos → directo firme', eq(claseEfectiva('directo', 'Indirectos'), { clase: 'directo', provisional: false }));
ck('Ericka indirecto + partida CONSTRUCCION → indirecto firme', eq(claseEfectiva('indirecto', 'CONSTRUCCION'), { clase: 'indirecto', provisional: false }));
ck('Ericka directo sin partida → directo firme', eq(claseEfectiva('directo', ''), { clase: 'directo', provisional: false }));
// Sin clase: la partida, solo lo seguro es directo
ck('sin clase + CONSTRUCCION → directo provisional', eq(claseEfectiva(null, 'CONSTRUCCION'), { clase: 'directo', provisional: true }));
ck('sin clase + Supervision → directo provisional', eq(claseEfectiva('', 'Supervision'), { clase: 'directo', provisional: true }));
ck('sin clase + Terreno → directo provisional', eq(claseEfectiva(undefined, 'Terreno'), { clase: 'directo', provisional: true }));
ck('mayúsculas/acentos/espacios no importan', claseEfectiva(null, '  supervisión ').clase === 'directo' && claseEfectiva(null, 'construccion').clase === 'directo');
['Intereses', 'Administracion y Honorarios', 'Indirectos', 'IMSS', 'Impuestos', 'Licencias y Permisos', 'Estudios y Laboratorio', 'Fees y Otros', 'ALBAÑILERIA']
  .forEach(p => ck(`sin clase + ${p} → indirecto provisional`, eq(claseEfectiva(null, p), { clase: 'indirecto', provisional: true }), claseEfectiva(null, p)));
ck('sin clase ni partida → sinDato', eq(claseEfectiva(null, ''), { clase: 'sinDato', provisional: true }));
ck('clase basura se trata como sin clase', claseEfectiva('xyz', 'CONSTRUCCION').clase === 'directo' && claseEfectiva('xyz', 'CONSTRUCCION').provisional);
ck('lista de partidas directas', eq(PARTIDAS_DIRECTAS, ['CONSTRUCCION', 'Supervision', 'Terreno']));

console.log(`${ok} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);

// ============================================================================
// Pruebas del MOTOR DE PRESUPUESTO DE CAJA (Fase 3) con datos sintéticos.
//   node scripts/test-simulador-caja.mjs
// Verifica las propiedades del modelo:
//   (1) roll-forward / conservación (saldo baja por el burn; consolidado = suma)
//   (2) la amortización (liberación al cobrar) BAJA el interés del mes siguiente
//   (3) obra.max_frentes ACOTA el gasto de obra del mes (secuenciación)
//   (4) detección de faltante contra el colchón (colchon_min_meses_burn)
//   (5) el flujo cae en floor(mesesCobro) del proyecto correcto y el consolidado suma
// ============================================================================
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// El repo no tiene package.json (ESM por <script type=module>): importamos una
// copia .mjs del motor — que por diseño es PURO y sin imports.
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'dt-simcaja-'));
const dst = join(dir, 'simulador-caja.mjs');
copyFileSync(join(here, '..', 'src', 'modules', 'simulador-caja.js'), dst);
const { proyectarCaja } = await import(pathToFileURL(dst).href);

// Defaults de config que lee el motor (espejo de los seeds del SQL 30/32).
const DEFAULTS = {
  'simulador.horizonte_meses': 6, 'score.horizonte_meses': 6,
  'obra.max_frentes': 4, 'tesoreria.colchon_min_meses_burn': 1
};
const cfgDe = (overrides = {}) => (clave) => (clave in overrides ? overrides[clave] : DEFAULTS[clave]);

let ok = 0, fail = 0;
const check = (nombre, cond, detalle) => {
  if (cond) { ok++; console.log(`✓ ${nombre}`); }
  else { fail++; console.error(`✗ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
};
const aprox = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// Unidad terminada (sin obra) que solo espera su cobro en `mesesCobro`.
const Uterminada = (id, proy, mesesCobro, flujoEsp, extra = {}) => ({
  unidad_id: id, nombre: id, proyecto: proy, costoTerminar: 0, semanasObra: 0,
  mesesCobro, lagMeses: mesesCobro, flujoEsp, liberacion: 0, prob: 1, terminada: true, ...extra
});

// (1) Roll-forward / conservación + etiquetas de mes + consolidado = único proyecto
{
  const ins = {
    mesInicio: '2026-07',
    proyectos: [{ nombre: 'A', saldoInicial: 1000000 }],
    unidades: [], burnPorProyecto: { A: 100000 }, creditos: []
  };
  const r = proyectarCaja(ins, cfgDe({ 'simulador.horizonte_meses': 6 }));
  const tl = r.proyectos[0].timeline;
  check('(1) saldo baja por el burn: saldoFinal[5] = 1,000,000 − 6×100,000 = 400,000',
    aprox(tl[5].saldoFinal, 400000), `saldoFinal[5]=${tl[5].saldoFinal}`);
  check('(1) etiquetas de mes rotan correctamente (2026-07 … 2026-12)',
    r.meses[0] === '2026-07' && r.meses[5] === '2026-12', `meses=${r.meses.join(',')}`);
  check('(1) consolidado == el único proyecto',
    aprox(r.consolidado.timeline[5].saldoFinal, 400000) && aprox(r.consolidado.saldoInicial, 1000000));
}

// (2) La amortización baja el interés: crédito 2,000,000 a 1%/mes; una unidad libera
//     2,000,000 al cobrar en el mes 0 ⇒ interés[0]=20,000 e interés[1]=0.
{
  const ins = {
    mesInicio: '2026-07',
    proyectos: [{ nombre: 'A', saldoInicial: 0 }],
    unidades: [Uterminada('u1', 'A', 0, 0, { liberacion: 2000000, prob: 1 })],
    burnPorProyecto: { A: 0 },
    creditos: [{ proyecto: 'A', dispuesto: 2000000, tasaMes: 0.01 }]
  };
  const tl = proyectarCaja(ins, cfgDe()).proyectos[0].timeline;
  check('(2) interés[0] = dispuesto 2,000,000 × 1% = 20,000', aprox(tl[0].interes, 20000), `interes[0]=${tl[0].interes}`);
  check('(2) interés[1] = 0 (la liberación amortizó el dispuesto)', aprox(tl[1].interes, 0), `interes[1]=${tl[1].interes}`);
}

// (3) obra.max_frentes acota el gasto de obra del mes. 4 unidades, cada una 1,000,000
//     con 1 mes de obra (semanasObra 4.33). 2 frentes ⇒ 2M/mes; 4 frentes ⇒ 4M en mes 0.
{
  const mkU = id => ({ unidad_id: id, nombre: id, proyecto: 'A', costoTerminar: 1000000, semanasObra: 4.33, mesesCobro: 12, lagMeses: 11, flujoEsp: 0, liberacion: 0, prob: 0, terminada: false });
  const ins = () => ({ mesInicio: '2026-07', proyectos: [{ nombre: 'A', saldoInicial: 0 }], unidades: [mkU('1'), mkU('2'), mkU('3'), mkU('4')], burnPorProyecto: { A: 0 }, creditos: [] });
  const r2 = proyectarCaja(ins(), cfgDe({ 'obra.max_frentes': 2 })).proyectos[0].timeline;
  check('(3) con 2 frentes: obra[0]=2M y obra[1]=2M (no 4M de golpe)',
    aprox(r2[0].obra, 2000000) && aprox(r2[1].obra, 2000000), `obra[0]=${r2[0].obra}, obra[1]=${r2[1].obra}`);
  const r4 = proyectarCaja(ins(), cfgDe({ 'obra.max_frentes': 4 })).proyectos[0].timeline;
  check('(3) con 4 frentes: obra[0]=4M (todas a la vez) — la palanca funciona sin tocar código',
    aprox(r4[0].obra, 4000000), `obra[0]=${r4[0].obra}`);
}

// (4) Faltante contra el colchón. Saldo 500k, burn 100k (colchón 100k), obra 350k en
//     mes 0, cobro hasta el mes 3 ⇒ mes 0 en rojo con déficit 50k.
{
  const ins = {
    mesInicio: '2026-07',
    proyectos: [{ nombre: 'A', saldoInicial: 500000 }],
    unidades: [{ unidad_id: 'u1', nombre: 'Casa 1', proyecto: 'A', costoTerminar: 350000, semanasObra: 4.33, mesesCobro: 3, lagMeses: 2, flujoEsp: 1000000, liberacion: 0, prob: 0.9, terminada: false }],
    burnPorProyecto: { A: 100000 }, creditos: []
  };
  const r = proyectarCaja(ins, cfgDe({ 'tesoreria.colchon_min_meses_burn': 1 }));
  const t0 = r.proyectos[0].timeline[0];
  check('(4) mes 0: obra 350k ⇒ saldoFinal 50k, bajo el colchón 100k ⇒ faltante',
    aprox(t0.obra, 350000) && aprox(t0.saldoFinal, 50000) && t0.faltante === true && aprox(t0.deficit, 50000),
    `saldoFinal=${t0.saldoFinal}, faltante=${t0.faltante}, deficit=${t0.deficit}`);
  check('(4) el faltante aparece en faltantes[] (hand-off al sugeridor)',
    r.faltantes.some(f => f.proyecto === 'A' && f.i === 0 && aprox(f.deficit, 50000)));
}

// (5) Bucketización del cobro por floor(mesesCobro) y por proyecto; consolidado suma.
{
  const ins = {
    mesInicio: '2026-07',
    proyectos: [{ nombre: 'A', saldoInicial: 0 }, { nombre: 'B', saldoInicial: 0 }],
    unidades: [Uterminada('a1', 'A', 1.2, 500000), Uterminada('b1', 'B', 3.8, 800000)],
    burnPorProyecto: { A: 0, B: 0 }, creditos: []
  };
  const r = proyectarCaja(ins, cfgDe());
  const A = r.proyectos.find(p => p.nombre === 'A'), B = r.proyectos.find(p => p.nombre === 'B');
  check('(5) flujo A (mesesCobro 1.2) cae en el mes 1 del proyecto A',
    aprox(A.timeline[1].entradas, 500000) && aprox(A.timeline[0].entradas, 0), `A.entradas[1]=${A.timeline[1].entradas}`);
  check('(5) flujo B (mesesCobro 3.8) cae en el mes 3 del proyecto B',
    aprox(B.timeline[3].entradas, 800000), `B.entradas[3]=${B.timeline[3].entradas}`);
  check('(5) el consolidado suma ambos proyectos por mes',
    aprox(r.consolidado.timeline[1].entradas, 500000) && aprox(r.consolidado.timeline[3].entradas, 800000));
}

console.log(`\n${ok} pruebas OK, ${fail} fallidas`);
process.exitCode = fail ? 1 : 0;

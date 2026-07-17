// ============================================================================
// Pruebas del SUGERIDOR DE FONDEO (Fase 3 · Pieza B) con datos sintéticos.
//   node scripts/test-sugeridor-fondeo.mjs
// Propiedades verificadas:
//   (a) match simple prestamista→necesitado, sin duplicar entre meses
//   (b) el colchón del prestamista se respeta en TODOS los meses futuros
//   (c) devolución preferida y capada a la deuda viva; no se devuelve dos veces
//   (d) disposición cap = disponible, tasa barata primero, con costoMes
//   (e) "sin cubrir" es incremental (Σ = máximo deficit, no suma de acumulados)
//   (f) la jerarquía reordenada se honra (y la devolución sigue primera)
//   (g) lo prestado en un mes reduce la capacidad en meses siguientes
//   (h) conservación: cubierto + sinCubrir = Σ max deficit; pisos intactos (replay)
//   (i) integración real: salida de proyectarCaja → sugerirFondeo sin fricción
// ============================================================================
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'dt-fondeo-'));
const dst = join(dir, 'simulador-caja.mjs');
copyFileSync(join(here, '..', 'src', 'modules', 'simulador-caja.js'), dst);
const { proyectarCaja, sugerirFondeo } = await import(pathToFileURL(dst).href);

const DEFAULTS = {
  'simulador.horizonte_meses': 6, 'score.horizonte_meses': 6,
  'obra.max_frentes': 4, 'tesoreria.colchon_min_meses_burn': 1,
  'tesoreria.jerarquia_fondeo': ['caja', 'prestamo_interno', 'disposicion'],
  'tesoreria.colchon_prestamista_meses': 1
};
const cfgDe = (overrides = {}) => (clave) => (clave in overrides ? overrides[clave] : DEFAULTS[clave]);

let ok = 0, fail = 0;
const check = (nombre, cond, detalle) => {
  if (cond) { ok++; console.log(`✓ ${nombre}`); }
  else { fail++; console.error(`✗ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
};
const aprox = (a, b, eps = 1) => Math.abs(a - b) <= eps;

// Timeline sintético con control directo del flujo acumulado por mes.
const MES = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
const mkP = (nombre, burn, flujos, colMes = 1) => ({
  nombre,
  timeline: flujos.map((f, i) => ({ i, mes: MES[i], saldoFinal: f, burn, colchon: burn * colMes }))
});

// Re-aplica las sugerencias sobre los flujos ORIGINALES (verificación externa).
function replay(proyectos, sugerencias) {
  const H = Math.min(...proyectos.map(p => p.timeline.length));
  const f = new Map(proyectos.map(p => [p.nombre, p.timeline.slice(0, H).map(t => t.saldoFinal)]));
  for (const s of sugerencias) {
    for (let t = s.i; t < H; t++) {
      f.get(s.para)[t] += s.monto;
      if (s.tipo === 'devolucion' || s.tipo === 'prestamo') f.get(s.de)[t] -= s.monto;
    }
  }
  return f;
}
const maxDeficit = p => p.timeline.reduce((mx, t) => Math.max(mx, Math.max(t.colchon - t.saldoFinal, 0)), 0);

// (a) Match simple: A necesita 300k en m0 (colchón 100k, flujo −200k); B sobra.
{
  const A = mkP('A', 100000, [-200000, -200000, -200000]);
  const B = mkP('B', 100000, [500000, 500000, 500000]);
  const r = sugerirFondeo({ proyectos: [A, B], deudaViva: [], capacidadCredito: [] }, cfgDe());
  check('(a) una sola sugerencia: préstamo B→A de 300k en el mes 0',
    r.sugerencias.length === 1 && r.sugerencias[0].tipo === 'prestamo' && r.sugerencias[0].de === 'B'
    && r.sugerencias[0].para === 'A' && aprox(r.sugerencias[0].monto, 300000) && r.sugerencias[0].i === 0,
    JSON.stringify(r.sugerencias));
  check('(a) sin duplicar en meses siguientes (cubierto=300k, sinCubrir=0)',
    aprox(r.totales.cubierto, 300000) && aprox(r.totales.sinCubrir, 0));
}

// (b) Colchón del prestamista respetado en TODOS los meses: B se estrecha en m2.
{
  const A = mkP('A', 100000, [-200000, -200000, -200000]);
  const B = mkP('B', 100000, [800000, 800000, 150000]);   // prestable = min(700,700,50) = 50k
  const r = sugerirFondeo({ proyectos: [A, B], deudaViva: [], capacidadCredito: [] }, cfgDe());
  const prest = r.sugerencias.find(s => s.tipo === 'prestamo');
  const sc = r.sugerencias.filter(s => s.tipo === 'sin_cubrir').reduce((s, x) => s + x.monto, 0);
  check('(b) el préstamo se capa a 50k (mínimo futuro de B sobre su colchón)',
    prest && aprox(prest.monto, 50000), prest && String(prest.monto));
  check('(b) el resto (250k) queda sin cubrir', aprox(sc, 250000), String(sc));
  const f = replay([A, B], r.sugerencias);
  check('(b) replay: B nunca baja de su colchón (100k) en ningún mes',
    f.get('B').every(v => v >= 100000 - 1), JSON.stringify(f.get('B')));
}

// (c) Devolución preferida y capada a la deuda; no se devuelve dos veces.
{
  const A = mkP('A', 100000, [-200000, -200000, -400000]);   // m2 se deteriora 200k más
  const B = mkP('B', 100000, [500000, 500000, 500000]);
  const r = sugerirFondeo({ proyectos: [A, B], deudaViva: [{ deudor: 'B', acreedor: 'A', monto: 80000 }], capacidadCredito: [] }, cfgDe());
  const m0 = r.sugerencias.filter(s => s.i === 0);
  check('(c) m0: primero devolución B→A de 80k, luego préstamo B→A de 220k',
    m0.length === 2 && m0[0].tipo === 'devolucion' && aprox(m0[0].monto, 80000)
    && m0[1].tipo === 'prestamo' && aprox(m0[1].monto, 220000), JSON.stringify(m0.map(s => [s.tipo, s.monto])));
  const devsM2 = r.sugerencias.filter(s => s.i === 2 && s.tipo === 'devolucion');
  check('(c) m2: NO hay otra devolución (la deuda ya se agotó); el deterioro nuevo va por préstamo',
    devsM2.length === 0 && r.sugerencias.some(s => s.i === 2 && s.tipo === 'prestamo'),
    JSON.stringify(r.sugerencias.filter(s => s.i === 2).map(s => [s.tipo, s.monto])));
}

// (d) Disposición: cap = disponible, tasa barata primero, con costoMes.
{
  const A = mkP('A', 0, [-200000, -200000, -200000]);   // burn 0 ⇒ colchón 0; necesita 200k
  const r = sugerirFondeo({
    proyectos: [A], deudaViva: [],
    capacidadCredito: [{ proyecto: 'A', credito: 'Puente – HSBC', disponible: 150000, tasaMes: 0.015 }]
  }, cfgDe());
  const d = r.sugerencias.find(s => s.tipo === 'disposicion');
  const sc = r.sugerencias.find(s => s.tipo === 'sin_cubrir');
  check('(d) dispone 150k (cap = disponible) con costo 2,250/mes y 50k sin cubrir',
    d && aprox(d.monto, 150000) && aprox(d.costoMes, 2250, 0.01) && sc && aprox(sc.monto, 50000),
    JSON.stringify([d && d.monto, d && d.costoMes, sc && sc.monto]));
  const r2_ = sugerirFondeo({
    proyectos: [mkP('A', 0, [-100000, 0, 0])], deudaViva: [],
    capacidadCredito: [
      { proyecto: 'A', credito: 'Caro', disponible: 100000, tasaMes: 0.02 },
      { proyecto: 'A', credito: 'Barato', disponible: 60000, tasaMes: 0.01 }
    ]
  }, cfgDe());
  const dd = r2_.sugerencias.filter(s => s.tipo === 'disposicion');
  check('(d) con dos créditos consume primero el barato (60k al 1%) y luego el caro (40k al 2%)',
    dd.length === 2 && dd[0].credito === 'Barato' && aprox(dd[0].monto, 60000)
    && dd[1].credito === 'Caro' && aprox(dd[1].monto, 40000), JSON.stringify(dd.map(x => [x.credito, x.monto])));
}

// (e) "Sin cubrir" incremental: Σ = máximo deficit, no suma de acumulados.
{
  const A = mkP('A', 100000, [0, -50000, -50000]);   // deficit: 100k, 150k, 150k (máx 150k)
  const r = sugerirFondeo({ proyectos: [A], deudaViva: [], capacidadCredito: [] }, cfgDe());
  const sc = r.sugerencias.filter(s => s.tipo === 'sin_cubrir');
  check('(e) sin_cubrir = 100k en m0 + 50k en m1 (incremental), nada en m2',
    sc.length === 2 && aprox(sc[0].monto, 100000) && sc[0].i === 0 && aprox(sc[1].monto, 50000) && sc[1].i === 1,
    JSON.stringify(sc.map(s => [s.i, s.monto])));
  check('(e) Σ sin_cubrir = 150k = máximo deficit (no 400k de acumulados)',
    aprox(r.totales.sinCubrir, 150000), String(r.totales.sinCubrir));
}

// (f) Jerarquía reordenada (disposición antes que préstamo) se honra; devolución sigue primera.
{
  const cfgF = cfgDe({ 'tesoreria.jerarquia_fondeo': ['caja', 'disposicion', 'prestamo_interno'] });
  const A = mkP('A', 0, [-100000, 0, 0]);
  const B = mkP('B', 0, [500000, 500000, 500000]);
  const cap = [{ proyecto: 'A', credito: 'Puente', disponible: 60000, tasaMes: 0.015 }];
  const r = sugerirFondeo({ proyectos: [A, B], deudaViva: [], capacidadCredito: cap.map(c => ({ ...c })) }, cfgF);
  check('(f) orden del mes: disposición 60k PRIMERO y luego préstamo B→A 40k',
    r.sugerencias.length === 2 && r.sugerencias[0].tipo === 'disposicion' && aprox(r.sugerencias[0].monto, 60000)
    && r.sugerencias[1].tipo === 'prestamo' && aprox(r.sugerencias[1].monto, 40000),
    JSON.stringify(r.sugerencias.map(s => [s.tipo, s.monto])));
  const r2_ = sugerirFondeo({
    proyectos: [mkP('A', 0, [-100000, 0, 0]), mkP('B', 0, [500000, 500000, 500000])],
    deudaViva: [{ deudor: 'B', acreedor: 'A', monto: 30000 }],
    capacidadCredito: cap.map(c => ({ ...c }))
  }, cfgF);
  check('(f) con deuda viva, la devolución (30k) sale ANTES que la disposición',
    r2_.sugerencias[0].tipo === 'devolucion' && aprox(r2_.sugerencias[0].monto, 30000)
    && r2_.sugerencias[1].tipo === 'disposicion', JSON.stringify(r2_.sugerencias.map(s => [s.tipo, s.monto])));
}

// (g) Lo prestado en m0 reduce la capacidad del prestamista en m1 (no doble préstamo).
{
  const A = mkP('A', 100000, [40000, 40000, 40000]);      // necesita 60k en m0
  const B = mkP('B', 100000, [200000, 200000, 200000]);   // prestable 100k
  const C = mkP('C', 100000, [100000, 40000, 40000]);     // necesita 60k desde m1
  const r = sugerirFondeo({ proyectos: [A, B, C], deudaViva: [], capacidadCredito: [] }, cfgDe());
  const pA = r.sugerencias.find(s => s.tipo === 'prestamo' && s.para === 'A');
  const pC = r.sugerencias.find(s => s.tipo === 'prestamo' && s.para === 'C');
  const scC = r.sugerencias.filter(s => s.tipo === 'sin_cubrir' && s.para === 'C').reduce((s, x) => s + x.monto, 0);
  check('(g) B presta 60k a A en m0 y solo 40k a C en m1 (capacidad ya consumida); a C le faltan 20k',
    pA && aprox(pA.monto, 60000) && pA.i === 0 && pC && aprox(pC.monto, 40000) && pC.i === 1 && aprox(scC, 20000),
    JSON.stringify(r.sugerencias.map(s => [s.i, s.tipo, s.para, s.monto])));
  const totalB = r.sugerencias.filter(s => s.de === 'B').reduce((s, x) => s + x.monto, 0);
  check('(g) B nunca presta más que su excedente total (100k)', aprox(totalB, 100000), String(totalB));
}

// (h) Conservación con 4 proyectos mixtos + pisos intactos (replay).
{
  const A = mkP('A', 100000, [-300000, -350000, -300000]);            // necesitado fuerte
  const B = mkP('B', 100000, [400000, 400000, 300000]);               // prestamista
  const C = mkP('C', 50000, [20000, -80000, -80000]);                 // necesitado con crédito
  const D = mkP('D', 100000, [250000, 250000, 250000]);               // deudor de A
  const proys = [A, B, C, D];
  const r = sugerirFondeo({
    proyectos: proys,
    deudaViva: [{ deudor: 'D', acreedor: 'A', monto: 120000 }],
    capacidadCredito: [{ proyecto: 'C', credito: 'Puente C', disponible: 90000, tasaMes: 0.012 }]
  }, cfgDe());
  const esperado = proys.reduce((s, p) => s + maxDeficit(p), 0);
  check('(h) conservación: cubierto + sinCubrir = Σ máximo deficit original',
    aprox(r.totales.cubierto + r.totales.sinCubrir, esperado),
    `${r.totales.cubierto}+${r.totales.sinCubrir} vs ${esperado}`);
  const f = replay(proys, r.sugerencias);
  const pisoOK = ['B', 'D'].every(n => f.get(n).every(v => v >= 100000 - 1));
  check('(h) replay: ningún prestamista queda bajo su piso en ningún mes', pisoOK,
    JSON.stringify({ B: f.get('B'), D: f.get('D') }));
  check('(h) ninguna sugerencia de centavos (todas > $0.50)',
    r.sugerencias.every(s => s.monto > 0.5));
}

// (i) Integración real: proyectarCaja → sugerirFondeo (el hand-off que usa la UI).
{
  const ins = {
    mesInicio: '2026-07',
    proyectos: [{ nombre: 'Alfa', saldoInicial: 0 }, { nombre: 'Beta', saldoInicial: 0 }],
    unidades: [
      { unidad_id: 'u1', nombre: 'Casa 1', proyecto: 'Alfa', costoTerminar: 350000, semanasObra: 4.33, mesesCobro: 3, lagMeses: 2, flujoEsp: 1000000, liberacion: 0, prob: 0.9, terminada: false },
      { unidad_id: 'u2', nombre: 'Casa 2', proyecto: 'Beta', costoTerminar: 0, semanasObra: 0, mesesCobro: 0, lagMeses: 0, flujoEsp: 900000, liberacion: 0, prob: 1, terminada: true }
    ],
    burnPorProyecto: { Alfa: 100000, Beta: 100000 }, creditos: []
  };
  const p = proyectarCaja(ins, cfgDe());
  const r = sugerirFondeo({ proyectos: p.proyectos, deudaViva: [], capacidadCredito: [] }, cfgDe());
  check('(i) corre sin fricción y las sugerencias usan los meses reales de la proyección',
    r.sugerencias.length > 0 && r.sugerencias.every(s => p.meses.includes(s.mes)),
    JSON.stringify(r.sugerencias.map(s => s.mes)));
  const esperado = p.proyectos.reduce((s, pr) => s + pr.timeline.reduce((mx, t) => Math.max(mx, t.deficit || 0), 0), 0);
  check('(i) cubierto + sinCubrir cuadra con la Necesidad del tablero (Σ max deficit)',
    aprox(r.totales.cubierto + r.totales.sinCubrir, esperado),
    `${r.totales.cubierto}+${r.totales.sinCubrir} vs ${esperado}`);
  check('(i) Beta (con excedente por su cobro del mes 0) aparece prestándole a Alfa',
    r.sugerencias.some(s => s.tipo === 'prestamo' && s.de === 'Beta' && s.para === 'Alfa'),
    JSON.stringify(r.sugerencias.map(s => [s.tipo, s.de, s.para, s.monto])));
}

console.log(`\n${ok} pruebas OK, ${fail} fallidas`);
process.exitCode = fail ? 1 : 0;

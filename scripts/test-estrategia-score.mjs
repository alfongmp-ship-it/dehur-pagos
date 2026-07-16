// ============================================================================
// Pruebas del MOTOR DE SCORE (Fase 2) con datos sintéticos. Correr con:
//   node scripts/test-estrategia-score.mjs
// Verifica las 4 propiedades obligatorias del doc de la fase:
//   (a) escriturada por cobrar con poco restante SIEMPRE gana a disponible con mucho restante
//   (b) subir la tasa del crédito sube el score RELATIVO de liberaciones grandes
//   (c) el bloqueo excluye del ranking activo
//   (d) cambiar una clave de config cambia el resultado SIN tocar código
// ============================================================================
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// El repo no tiene package.json (ESM por <script type=module>): importamos una
// copia .mjs del motor — que por diseño es PURO y sin imports.
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'dt-score-'));
const dst = join(dir, 'estrategia-score.mjs');
copyFileSync(join(here, '..', 'src', 'modules', 'estrategia-score.js'), dst);
const { scoreUnidad, rankearUnidades } = await import(pathToFileURL(dst).href);

// Defaults de calibración (espejo de los seeds del SQL 30)
const DEFAULTS = {
  'prob_cobro.escriturada': 0.99, 'prob_cobro.vendida': 0.95, 'prob_cobro.apartada': 0.65,
  'prob_cobro.disponible': 0.35, 'prob_cobro.adeudo': 0.90,
  'lag_cobro.escriturada': 0.5, 'lag_cobro.vendida': 1.5, 'lag_cobro.apartada': 3, 'lag_cobro.disponible': 6,
  'lag_ajuste_credito.contado': -0.5, 'lag_ajuste_credito.infonavit': 0, 'lag_ajuste_credito.bancario': 0.5,
  'lag_ajuste_credito.fovissste': 0.5, 'lag_ajuste_credito.cofinanciado': 1, 'lag_ajuste_credito.otro': 0,
  'obra.ritmo_max_semanal': 350000, 'obra.colchon_pct': 0.08, 'obra.colchon_min': 60000, 'obra.semanas_min_cierre': 4,
  'tesoreria.pct_liberacion_default': 0.55,
  'score.castigo_incertidumbre': 1, 'score.horizonte_meses': 6, 'score.bono_estrategica': 10
};
const cfgDe = (overrides = {}) => (clave) => (clave in overrides ? overrides[clave] : DEFAULTS[clave]);

// ---- Set sintético de 6 unidades ------------------------------------------
const U = (id, extra) => ({
  unidad_id: String(id), nombre: 'Casa ' + id, proyecto: 'Sintético',
  costoReal: 0, presupuesto: 0, avance: null, terminada: false,
  venta: null, precioEstimado: 0, tasaAnual: 14, flags: {}, ...extra
});
const unidades = [
  // 1: escriturada por cobrar, obra casi lista (poco restante)
  U(1, { costoReal: 1900000, presupuesto: 2000000, avance: 95,
    venta: { estatus_comercial: 'escriturada', precio_venta: 3000000, valor_liberacion: 1600000, saldo_cliente: 900000, monto_cobrado: 2100000, tipo_credito: 'bancario', activo: true } }),
  // 2: disponible (sin cliente) con MUCHO restante
  U(2, { costoReal: 400000, presupuesto: 2000000, avance: 20, precioEstimado: 3000000 }),
  // 3: vendida con crédito autorizado, medio restante
  U(3, { costoReal: 1200000, presupuesto: 2000000, avance: 60,
    venta: { estatus_comercial: 'vendida', precio_venta: 2800000, valor_liberacion: 1500000, saldo_cliente: 2800000, monto_cobrado: 0, tipo_credito: 'infonavit', activo: true } }),
  // 4: apartada con crédito en trámite
  U(4, { costoReal: 1500000, presupuesto: 2000000, avance: 75,
    venta: { estatus_comercial: 'apartada', precio_venta: 2900000, valor_liberacion: 0, saldo_cliente: 2750000, monto_cobrado: 150000, tipo_credito: 'cofinanciado', activo: true } }),
  // 5: BLOQUEADA (permiso) — no debe entrar al ranking
  U(5, { costoReal: 1000000, presupuesto: 2000000, avance: 50, flags: { bloqueo: true, categoria: 'permiso' },
    venta: { estatus_comercial: 'vendida', precio_venta: 2800000, valor_liberacion: 1500000, saldo_cliente: 2800000, monto_cobrado: 0, tipo_credito: 'bancario', activo: true } }),
  // 6: liberación GRANDE vs 3 (misma situación, más liberación) — para la prueba (b)
  U(6, { costoReal: 1200000, presupuesto: 2000000, avance: 60,
    venta: { estatus_comercial: 'vendida', precio_venta: 2800000, valor_liberacion: 2200000, saldo_cliente: 2800000, monto_cobrado: 0, tipo_credito: 'infonavit', activo: true } })
];

let ok = 0, fail = 0;
const check = (nombre, cond, detalle) => {
  if (cond) { ok++; console.log(`✓ ${nombre}`); }
  else { fail++; console.error(`✗ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
};

// (a) escriturada-poco-restante > disponible-mucho-restante
{
  const r = rankearUnidades(unidades, cfgDe());
  const pos = id => r.activas.findIndex(s => s.insumo.unidad_id === String(id));
  check('(a) escriturada con poco restante gana a disponible con mucho restante',
    pos(1) !== -1 && pos(2) !== -1 && pos(1) < pos(2),
    `pos escriturada=${pos(1)}, pos disponible=${pos(2)}`);
}

// (b) subir la tasa sube el score RELATIVO de liberaciones grandes
{
  const conTasa = t => {
    const us = unidades.map(u => ({ ...u, tasaAnual: t }));
    const r = rankearUnidades(us, cfgDe());
    const de = id => r.activas.find(s => s.insumo.unidad_id === String(id));
    return de(6).calc.scoreRaw / de(3).calc.scoreRaw;   // liberación grande vs chica (mismo resto)
  };
  const ratioBaja = conTasa(8), ratioAlta = conTasa(20);
  check('(b) subir la tasa sube el score relativo de la liberación grande',
    ratioAlta > ratioBaja, `ratio tasa8=${ratioBaja.toFixed(4)} vs tasa20=${ratioAlta.toFixed(4)}`);
}

// (c) el bloqueo excluye del ranking activo
{
  const r = rankearUnidades(unidades, cfgDe());
  const enActivas = r.activas.some(s => s.insumo.unidad_id === '5');
  const enBloqueadas = r.bloqueadas.some(i => i.unidad_id === '5');
  check('(c) la unidad bloqueada queda fuera del ranking y en su sección',
    !enActivas && enBloqueadas);
}

// (d) cambiar una clave de config cambia el resultado sin tocar código
{
  const base = scoreUnidad(unidades[1], cfgDe());                                  // disponible
  const editada = scoreUnidad(unidades[1], cfgDe({ 'prob_cobro.disponible': 0.9 }));
  check('(d) cambiar prob_cobro.disponible (0.35→0.9) cambia el score',
    editada.scoreRaw > base.scoreRaw, `base=${base.scoreRaw.toFixed(4)} editada=${editada.scoreRaw.toFixed(4)}`);
  // extra: el desglose es auditable línea por línea
  check('(d+) el desglose trae la cadena completa del cálculo',
    Array.isArray(base.desglose) && base.desglose.length >= 8);
}

console.log(`\n${ok} pruebas OK, ${fail} fallidas`);
process.exitCode = fail ? 1 : 0;

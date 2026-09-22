// ============================================================================
// Pruebas del MOTOR RMF 3.2.4 (Estimados fiscales) con datos sintéticos.
//   node scripts/test-rmf-324.mjs
// Verifica las propiedades del modelo:
//   (1) frontera del corte: cobro del 31/dic ENTRA, del 01/ene siguiente NO
//   (2) escriturada ANTES o EN el corte queda fuera del registro
//   (3) escriturada EN el ejercicio → reversión con el cobrado al cierre ANTERIOR
//   (4) cancelada e inactiva fuera; escriturada SIN fecha fuera + aviso
//   (5) factor capturado manda sobre el sugerido; sugerido = presupuesto/precio
//   (6) cobros sin fecha excluidos con aviso; redondeo a centavos
// ============================================================================
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// El repo no tiene package.json (ESM por <script type=module>): importamos una
// copia .mjs del motor — que por diseño es PURO y sin imports.
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'dt-rmf324-'));
const dst = join(dir, 'rmf-324.mjs');
copyFileSync(join(here, '..', 'src', 'modules', 'rmf-324.js'), dst);
const { estimados324 } = await import(pathToFileURL(dst).href);

const cfgDe = (overrides = {}) => (clave) => (clave in overrides ? overrides[clave] : null);

let ok = 0, fail = 0;
const check = (nombre, cond, detalle) => {
  if (cond) { ok++; console.log(`✓ ${nombre}`); }
  else { fail++; console.error(`✗ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
};
const aprox = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

const V = (ventaId, unidadId, precio, extra = {}) => ({
  ventaId, unidadId, etiqueta: `Casa ${unidadId}`, cliente: 'Cliente X',
  precio, estatus: 'vendida', fechaEscrituraISO: '', activo: true, ...extra
});
const C = (ventaId, fechaISO, monto, extra = {}) => ({ ventaId, fechaISO, monto, activo: true, ...extra });

// (1) Frontera del corte: 31/dic entra, 01/ene no; suma al centavo
{
  const r = estimados324({
    ejercicio: 2025,
    ventas: [V('v1', '10', 1000000)],
    cobros: [C('v1', '2025-12-31', 100000.10), C('v1', '2026-01-01', 50000), C('v1', '2025-06-15', 0.13)],
    presupuestoPorUnidad: {}, costoRealPorUnidad: {},
  }, cfgDe());
  check('(1) cobro del 31/dic entra y el del 01/ene no', r.registro.length === 1 && aprox(r.registro[0].cobradoAlCorte, 100000.23), JSON.stringify(r.registro));
  check('(1) base acumulable = cobrado al corte', aprox(r.baseAcumulable, 100000.23), String(r.baseAcumulable));
}

// (2) Escriturada antes o en el corte → fuera del registro
{
  const r = estimados324({
    ejercicio: 2025,
    ventas: [
      V('v1', '10', 500000, { fechaEscrituraISO: '2024-03-01', estatus: 'escriturada' }), // antes: fuera, sin reversión
      V('v2', '11', 500000, { fechaEscrituraISO: '2025-12-31', estatus: 'escriturada' }), // EN el corte: fuera + reversión
      V('v3', '12', 500000),                                                              // no escriturada: dentro
    ],
    cobros: [C('v1', '2023-05-01', 100), C('v2', '2025-02-01', 200), C('v3', '2025-02-01', 300)],
    presupuestoPorUnidad: {}, costoRealPorUnidad: {},
  }, cfgDe());
  check('(2) solo la NO escriturada está en el registro', r.registro.length === 1 && r.registro[0].ventaId === 'v3', JSON.stringify(r.registro.map(x => x.ventaId)));
  check('(2) la escriturada EN 2025 aparece como reversión', r.reversiones.length === 1 && r.reversiones[0].ventaId === 'v2', JSON.stringify(r.reversiones.map(x => x.ventaId)));
}

// (3) Reversión usa el cobrado al cierre ANTERIOR (31/dic/E−1), no el total
{
  const r = estimados324({
    ejercicio: 2026,
    ventas: [V('v1', '10', 900000, { fechaEscrituraISO: '2026-07-10', estatus: 'escriturada' })],
    cobros: [C('v1', '2025-11-30', 250000), C('v1', '2026-01-15', 100000), C('v1', '2026-07-01', 550000)],
    presupuestoPorUnidad: {}, costoRealPorUnidad: {},
  }, cfgDe());
  const rev = r.reversiones[0];
  check('(3) cobradoAlCierreAnterior = solo lo de 2025', rev && aprox(rev.cobradoAlCierreAnterior, 250000), JSON.stringify(rev));
  check('(3) precio total a acumular al escriturar', rev && aprox(rev.precio, 900000) && aprox(r.totPrecioEscriturado, 900000));
  check('(3) la escriturada NO está también en el registro', r.registro.length === 0);
}

// (4) Cancelada e inactiva fuera; escriturada SIN fecha fuera + aviso
{
  const r = estimados324({
    ejercicio: 2025,
    ventas: [
      V('v1', '10', 100, { estatus: 'cancelada' }),
      V('v2', '11', 100, { activo: false }),
      V('v3', '12', 100, { estatus: 'escriturada' }),   // sin fecha: fuera + aviso
      V('v4', '13', 100),
    ],
    cobros: [C('v1', '2025-01-01', 10), C('v2', '2025-01-01', 10), C('v3', '2025-01-01', 10), C('v4', '2025-01-01', 10)],
    presupuestoPorUnidad: {}, costoRealPorUnidad: {},
  }, cfgDe());
  check('(4) solo la venta normal entra', r.registro.length === 1 && r.registro[0].ventaId === 'v4', JSON.stringify(r.registro.map(x => x.ventaId)));
  check('(4) aviso por escriturada sin fecha', r.avisos.some(a => a.includes('sin fecha de escritura')), JSON.stringify(r.avisos));
}

// (5) Factor: capturado manda; sugerido = presupuesto/precio; fallback costo real
{
  const ins = {
    ejercicio: 2025,
    ventas: [V('v1', '10', 1000000)],
    cobros: [C('v1', '2025-05-01', 400000)],
    presupuestoPorUnidad: { 10: 620000 }, costoRealPorUnidad: { 10: 300000 },
  };
  const sug = estimados324(ins, cfgDe());
  check('(5) sugerido 62% por presupuesto', aprox(sug.factorSugerido, 0.62, 0.0001) && sug.factorFuente === 'sugerido' && sug.factorSugeridoFuente === 'presupuesto', JSON.stringify([sug.factorSugerido, sug.factorFuente]));
  check('(5) costo estimado = base × sugerido', aprox(sug.costoEstimado, 400000 * 0.62) && aprox(sug.neto, 400000 * 0.38));
  const cap = estimados324(ins, cfgDe({ factor: 0.5 }));
  check('(5) capturado 50% manda sobre el sugerido', cap.factorFuente === 'capturado' && aprox(cap.costoEstimado, 200000) && aprox(cap.neto, 200000));
  const fb = estimados324({ ...ins, presupuestoPorUnidad: {} }, cfgDe());
  check('(5) fallback a costo real (30%)', aprox(fb.factorSugerido, 0.30, 0.0001) && fb.factorSugeridoFuente === 'costo real', String(fb.factorSugerido));
}

// (6) Cobros sin fecha excluidos con aviso; cobro inactivo fuera; centavos
{
  const r = estimados324({
    ejercicio: 2025,
    ventas: [V('v1', '10', 1000)],
    cobros: [C('v1', '', 999), C('v1', '2025-03-03', 100.005), C('v1', '2025-03-04', 50, { activo: false })],
    presupuestoPorUnidad: {}, costoRealPorUnidad: {},
  }, cfgDe());
  check('(6) sin fecha e inactivo excluidos; redondeo a centavos', aprox(r.registro[0].cobradoAlCorte, 100.01) && aprox(r.baseAcumulable, 100.01), JSON.stringify(r.registro));
  check('(6) aviso de cobros sin fecha', r.avisos.some(a => a.includes('sin fecha válida')), JSON.stringify(r.avisos));
}

console.log(`\n${ok} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);

// ============================================================================
// Pruebas del motor de LOTES de asignaciones (subida por arreglo a Supabase).
//   node scripts/test-lotes-asignaciones.mjs
// Verifica:
//   (1) dedup por asignacion_id conservando la última aparición
//   (2) los lotes NUNCA parten un documento (factura/pago) entre dos lotes
//   (3) un documento con >= max filas viaja solo en su lote
//   (4) tope por lote respetado y ninguna fila perdida ni repetida
//   (5) filas sin documento (huérfanas) se agrupan por su propio id
// ============================================================================
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'dt-lotes-'));
const dst = join(dir, 'lotes-asignaciones.mjs');
copyFileSync(join(here, '..', 'src', 'services', 'lotes-asignaciones.js'), dst);
const { dedupPorId, partirEnLotes, llaveDoc } = await import(pathToFileURL(dst).href);

let ok = 0, fail = 0;
const check = (nombre, cond, detalle) => {
  if (cond) { ok++; console.log(`✓ ${nombre}`); }
  else { fail++; console.error(`✗ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
};
let seq = 0;
const fila = (doc, extra = {}) => ({ asignacion_id: 'a' + (++seq), ...doc, unidad_id: 1, monto_asignado: 10, ...extra });
const fact = (fid, n) => Array.from({ length: n }, () => fila({ factura_id: String(fid), pago_id: '' }));
const pago = (pid, n) => Array.from({ length: n }, () => fila({ factura_id: '', pago_id: String(pid) }));

// (1) dedup: la última gana
{
  const a = { asignacion_id: 'x', factura_id: '1', monto_asignado: 1 };
  const b = { asignacion_id: 'x', factura_id: '1', monto_asignado: 2 };
  const d = dedupPorId([a, b]);
  check('(1) dedup deja una sola fila por id', d.length === 1);
  check('(1) conserva la ÚLTIMA aparición', d[0].monto_asignado === 2);
}

// (2)+(4) 3 facturas x 40 filas, max 100 → [80][40], sin partir ninguna
{
  const rows = [...fact(1, 40), ...fact(2, 40), ...fact(3, 40)];
  const lotes = partirEnLotes(rows, 100);
  check('(2) 3x40 con max 100 → 2 lotes', lotes.length === 2, JSON.stringify(lotes.map(l => l.length)));
  check('(2) tamaños [80, 40]', lotes[0].length === 80 && lotes[1].length === 40);
  const docsPorLote = lotes.map(l => new Set(l.map(llaveDoc)));
  const cruzados = [...docsPorLote[0]].filter(k => docsPorLote[1].has(k));
  check('(2) ningún documento aparece en dos lotes', cruzados.length === 0);
  const total = lotes.reduce((s, l) => s + l.length, 0);
  check('(4) ninguna fila perdida ni repetida', total === 120 && new Set(lotes.flat().map(r => r.asignacion_id)).size === 120);
}

// (3) documento grande (250 filas) viaja solo; los chicos alrededor se agrupan aparte
{
  const rows = [...fact(1, 30), ...fact(2, 250), ...fact(3, 30)];
  const lotes = partirEnLotes(rows, 100);
  check('(3) documento de 250 va en su propio lote', lotes.some(l => l.length === 250 && l.every(r => r.factura_id === '2')), JSON.stringify(lotes.map(l => l.length)));
  check('(3) los dos chicos quedan en lotes aparte y completos', lotes.filter(l => l.length === 30).length === 2);
}

// (4) tope: 12 pagos x 10 filas con max 25 → lotes de 20 (2 pagos), nunca > 25
{
  const rows = Array.from({ length: 12 }, (_, i) => pago(100 + i, 10)).flat();
  const lotes = partirEnLotes(rows, 25);
  check('(4) ningún lote supera el tope', lotes.every(l => l.length <= 25), JSON.stringify(lotes.map(l => l.length)));
  check('(4) lotes de 20 (2 pagos por lote) y total 120', lotes.every(l => l.length === 20) && lotes.length === 6);
}

// (6) cada lote sale ORDENADO por asignacion_id (orden canónico de bloqueo)
{
  const rows = [...fact(2, 7), ...fact(1, 7), ...pago(9, 7)];
  const lotes = partirEnLotes(rows, 100);
  const ordenado = l => l.every((r, i) => i === 0 || String(l[i - 1].asignacion_id) <= String(r.asignacion_id));
  check('(6) todos los lotes vienen ordenados por id', lotes.every(ordenado), JSON.stringify(lotes.map(l => l.map(r => r.asignacion_id))));
}

// (5) huérfanas (sin factura ni pago) no se mezclan como un solo documento
{
  const rows = Array.from({ length: 5 }, () => fila({ factura_id: '', pago_id: '' }));
  const lotes = partirEnLotes(rows, 2);
  check('(5) huérfanas se agrupan por su propio id → tope respetado', lotes.every(l => l.length <= 2) && lotes.flat().length === 5);
}

console.log(`\n${ok} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);

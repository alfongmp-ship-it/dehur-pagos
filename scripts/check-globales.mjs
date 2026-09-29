// ============================================================================
// Detector de identificadores USADOS pero nunca declarados ni importados.
//   node scripts/check-globales.mjs
//
// Existe por un bug real (2026-09-29): un script de parche dejó `${NL}` literal
// en costos-fiscales.js. `NL` no existía → ReferenceError en el navegador: el
// Excel se generaba y el confirm nunca aparecía. `node --check` NO lo atrapa,
// porque es sintaxis perfectamente válida.
//
// Mira SOLO los identificadores sueltos dentro de interpolaciones `${...}` de
// template literals, que es donde caen estos errores. Conservador a propósito:
// prefiere callar a gritar en falso (un falso positivo vuelve inútil al detector).
//
// Complementa —no sustituye— la auditoría de handlers inline vs window.*.
// ============================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Globales de plataforma y librerías por CDN que sí existen en tiempo de ejecución.
const GLOBALES = new Set([
  'window', 'document', 'console', 'Math', 'JSON', 'Date', 'Number', 'String', 'Boolean',
  'Array', 'Object', 'Set', 'Map', 'WeakMap', 'Promise', 'Error', 'RegExp', 'Intl', 'Symbol',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'fetch', 'alert', 'confirm', 'prompt', 'localStorage', 'sessionStorage', 'location',
  'navigator', 'crypto', 'Blob', 'File', 'FileReader', 'URL', 'FormData', 'Headers',
  'XLSX', 'Chart', 'supabase', 'google', 'gapi', 'structuredClone', 'queueMicrotask',
  'Infinity', 'NaN', 'undefined', 'globalThis', 'this', 'arguments', 'true', 'false', 'null',
  'typeof', 'new', 'await', 'void', 'delete', 'in', 'instanceof', 'if', 'else', 'return',
]);

function archivos(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

// Todo lo que el archivo declara de alguna forma. Amplio a propósito: pasar por
// alto una declaración solo cuesta un falso positivo, y esos matan al detector.
function declarados(txt) {
  const d = new Set();
  const add = (t) => {
    // Las interpolaciones `${...}` son USOS, no declaraciones: si se contaran,
    // una variable inexistente se "declararía" a sí misma y nunca se detectaría.
    const limpio = String(t || '').replace(/\$\{[^}]*\}/g, ' ');
    const ids = limpio.match(/[A-Za-z_$][\w$]*/g) || [];
    for (const n of ids) d.add(n);
  };
  // const/let/var: toma TODO hasta el `;` (hasta 1200 chars, saltos incluidos) →
  // cubre listas con valores (`let a = 0, b = 0`), destructuring multilínea
  // (`const {\n key,\n titulo\n} = config`) y arrays (`const [d, m, y] = …`).
  // Capturar de más solo nos hace perder una detección; capturar de menos genera
  // falsos positivos, que es lo que vuelve inútil a un detector.
  for (const m of txt.matchAll(/\b(?:const|let|var)\s+([\s\S]{0,1200}?);/g)) add(m[1]);
  // Parámetros: function nombre(...), métodos y arrows (...) =>  ·  x =>
  for (const m of txt.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) { add(m[1]); add(m[2]); }
  for (const m of txt.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of txt.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
  // class · catch(e) · for (… of/in …) · imports
  for (const m of txt.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of txt.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of txt.matchAll(/\bfor\s*\(\s*(?:const|let|var)?\s*([^;)]+?)\s+(?:of|in)\s/g)) add(m[1]);
  for (const m of txt.matchAll(/import\s+([^;]+?)\s+from/g)) add(m[1]);
  // Cualquier identificador seguido de `(`: funciones y métodos del propio archivo.
  for (const m of txt.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) d.add(m[1]);
  return d;
}

let fallos = 0, revisados = 0;
for (const f of archivos(raiz)) {
  const txt = readFileSync(f, 'utf8');
  revisados++;
  const conocidos = declarados(txt);
  const vistos = new Set();
  for (const m of txt.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
    const n = m[1];
    if (GLOBALES.has(n) || conocidos.has(n) || vistos.has(n)) continue;
    vistos.add(n);
    const linea = txt.slice(0, m.index).split('\n').length;
    console.error(`⛔ ${f.replace(/.*[\\/]src[\\/]/, 'src/')}:${linea} — \`${n}\` se usa pero no está declarada ni importada`);
    fallos++;
  }
}
console.log(`\n${revisados} módulo(s) revisados · ${fallos} identificador(es) sin declarar`);
process.exit(fallos ? 1 : 0);

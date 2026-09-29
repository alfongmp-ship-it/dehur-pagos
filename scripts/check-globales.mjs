// ============================================================================
// Detector de identificadores USADOS pero nunca declarados ni importados.
//   node scripts/check-globales.mjs
//
// Existe por TRES bugs reales del 2026-09-29, todos invisibles para
// `node --check` porque son sintaxis válida y solo revientan en el navegador:
//   1. `setIndivisoUnidad` llamada desde un onchange sin registrarse en window
//      (eso lo caza la otra auditoría: handlers inline vs window.*).
//   2. `${NL}` dejado literal por un script de parche → ReferenceError: el
//      Excel se generaba y el confirm nunca aparecía.
//   3. `puedeRepartirCostos()` usada como gate en google-sync.js sin estar en
//      el import → TODO guardado de repartos tronaba con ReferenceError.
//
// Dos chequeos por módulo, sobre el código con comentarios/strings/regex
// REMOVIDOS por un mini-lexer (sin él, "rgba(" en un string o "DD(" en un
// comentario generan cientos de falsos positivos y matan al detector):
//   A. identificadores sueltos en interpolaciones `${nombre}`
//   B. llamadas sueltas `nombre(` (los métodos `obj.metodo(` no cuentan)
// ============================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Globales de plataforma y librerías por CDN que sí existen en tiempo de ejecución.
const GLOBALES = new Set([
  'window', 'document', 'console', 'Math', 'JSON', 'Date', 'Number', 'String', 'Boolean',
  'Array', 'Object', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Promise', 'Error', 'TypeError',
  'RangeError', 'RegExp', 'Intl', 'Symbol', 'Proxy', 'Reflect', 'BigInt', 'Uint8Array',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'alert', 'confirm', 'prompt',
  'localStorage', 'sessionStorage', 'location', 'history', 'navigator', 'crypto',
  'Blob', 'File', 'FileReader', 'URL', 'URLSearchParams', 'FormData', 'Headers', 'Request',
  'Response', 'AbortController', 'Event', 'CustomEvent', 'MutationObserver', 'ResizeObserver',
  'IntersectionObserver', 'DOMParser', 'Image', 'Audio', 'Option', 'atob', 'btoa',
  'structuredClone', 'queueMicrotask', 'getComputedStyle', 'matchMedia', 'open', 'print',
  'XLSX', 'Chart', 'supabase', 'google', 'gapi',
  'Infinity', 'NaN', 'undefined', 'globalThis',
]);

// Palabras clave que pueden preceder a `(` o vivir en una interpolación.
const KEYWORDS = new Set([
  'function', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'catch',
  'try', 'finally', 'return', 'typeof', 'new', 'await', 'async', 'yield', 'void', 'delete',
  'in', 'of', 'instanceof', 'throw', 'break', 'continue', 'const', 'let', 'var', 'class',
  'extends', 'super', 'this', 'arguments', 'import', 'export', 'from', 'static', 'get',
  'set', 'true', 'false', 'null',
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

// ---------------------------------------------------------------------------
// Mini-lexer: reemplaza comentarios, strings y regex literales por espacios,
// CONSERVANDO longitud (los números de línea siguen válidos), los saltos de
// línea, y el código de las interpolaciones `${...}` (incluido su `${`/`}`).
// Heurística estándar para regex-vs-división: un `/` inicia regex si el último
// token significativo es un operador/apertura o una palabra clave.
// ---------------------------------------------------------------------------
function soloCodigo(src) {
  const out = src.split('');
  const borra = (i) => { if (out[i] !== '\n') out[i] = ' '; };
  // Pila de marcos: el fondo es código global; 'tpl' = dentro de un template
  // literal; {prof} = código dentro de una interpolación `${…}` (cuenta llaves).
  // La pila es lo que permite templates ANIDADOS (`${x ? `a${y}` : 'b'}`), que
  // esta app usa por todos lados y que desincronizaban la versión anterior.
  const pila = [{ tipo: 'code' }];
  let i = 0, ultimo = '';     // último char significativo del CÓDIGO emitido
  const RE_ANTES = /[([{=,;:!&|?+\-*%^~<>]/;
  const KW_ANTES = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'delete', 'new', 'await', 'yield', 'instanceof']);

  const esRegex = () => {
    if (ultimo === '') return true;
    if (RE_ANTES.test(ultimo)) return true;
    const m = src.slice(0, i).match(/([A-Za-z_$][\w$]*)\s*$/);
    return !!(m && KW_ANTES.has(m[1]));
  };

  while (i < src.length) {
    const marco = pila[pila.length - 1];
    const c = src[i], d = src[i + 1];

    if (marco.tipo === 'tpl') {                      // dentro de un template: borrar
      if (c === '\\') { borra(i++); borra(i++); continue; }
      if (c === '`') { borra(i++); pila.pop(); ultimo = "'"; continue; }
      if (c === '$' && d === '{') {                  // interpolación: conservar `${`
        i += 2; pila.push({ tipo: 'code', prof: 1 });
        continue;
      }
      borra(i++);
      continue;
    }

    // marco de código (global o interpolación)
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') borra(i++);
      continue;
    }
    if (c === '/' && d === '*') {
      borra(i++); borra(i++);
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) borra(i++);
      if (i < src.length) { borra(i++); borra(i++); }
      continue;
    }
    if (c === "'" || c === '"') {
      borra(i++);
      while (i < src.length && src[i] !== c) { if (src[i] === '\\') borra(i++); borra(i++); }
      borra(i++);
      ultimo = "'";                                  // un string es "valor": / después = división
      continue;
    }
    if (c === '`') { borra(i++); pila.push({ tipo: 'tpl' }); continue; }
    if (c === '/' && esRegex()) {
      borra(i++);
      let enClase = false;
      while (i < src.length) {
        const cc = src[i];
        if (cc === '\\') { borra(i++); borra(i++); continue; }
        if (cc === '[') enClase = true;
        else if (cc === ']') enClase = false;
        else if (cc === '/' && !enClase) break;
        else if (cc === '\n') break;                 // regex nunca cruza línea: abortar
        borra(i++);
      }
      borra(i++);
      while (i < src.length && /[a-z]/i.test(src[i])) borra(i++);  // flags
      ultimo = "'";
      continue;
    }
    if (marco.prof !== undefined) {                  // código de una interpolación
      if (c === '{') marco.prof++;
      else if (c === '}') {
        marco.prof--;
        if (marco.prof === 0) { i++; pila.pop(); continue; }  // conservar el `}`
      }
    }
    if (!/\s/.test(c)) ultimo = c;
    i++;
  }
  return out.join('');
}

// Todo lo que el archivo declara o importa. Amplio a propósito para variables…
function declarados(txt) {
  const d = new Set();
  const add = (t) => {
    // Las interpolaciones `${...}` son USOS, no declaraciones.
    const limpio = String(t || '').replace(/\$\{[^}]*\}/g, ' ');
    for (const n of limpio.match(/[A-Za-z_$][\w$]*/g) || []) d.add(n);
  };
  for (const m of txt.matchAll(/\b(?:const|let|var)\s+([\s\S]{0,20000}?);/g)) add(m[1]);
  for (const m of txt.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) { add(m[1]); add(m[2]); }
  for (const m of txt.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of txt.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
  for (const m of txt.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of txt.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of txt.matchAll(/\bfor\s*\(\s*(?:const|let|var)?\s*([^;)]+?)\s+(?:of|in)\s/g)) add(m[1]);
  for (const m of txt.matchAll(/import\s+([\s\S]{0,600}?)\s+from/g)) add(m[1]);
  return d;
}

// …y lo que puede LLAMARSE: lo declarado + asignaciones a función/arrow +
// propiedades de objeto `{ x: fn }` usadas vía shorthand. Separado a propósito:
// si toda llamada "se declarara a sí misma", una función jamás importada nunca
// se detectaría (bug real nº 3).
function declaradosParaLlamadas(txt) {
  const d = declarados(txt);
  for (const m of txt.matchAll(/([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function\b|\()/g)) d.add(m[1]);
  // Métodos shorthand de objeto/clase: `{ validar(filas) { … } }` — en JS válido
  // una LLAMADA nunca va seguida de `{`, así que `nombre(args) {` declara.
  for (const m of txt.matchAll(/([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g)) {
    d.add(m[1]);
    for (const p of m[2].match(/[A-Za-z_$][\w$]*/g) || []) d.add(p);
  }
  return d;
}

let fallos = 0, revisados = 0;
for (const f of archivos(raiz)) {
  const src = readFileSync(f, 'utf8');
  revisados++;
  const txt = soloCodigo(src);
  const conocidos = declarados(txt);
  const llamables = declaradosParaLlamadas(txt);
  const vistos = new Set();
  const reporta = (n, idx, uso) => {
    if (vistos.has(n)) return;
    vistos.add(n);
    const linea = txt.slice(0, idx).split('\n').length;
    console.error(`⛔ ${f.replace(/.*[\\/]src[\\/]/, 'src/')}:${linea} — \`${n}\` ${uso} pero no está declarada ni importada`);
    fallos++;
  };
  // A. Identificadores sueltos en interpolaciones `${NL}`.
  for (const m of txt.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
    if (!GLOBALES.has(m[1]) && !KEYWORDS.has(m[1]) && !conocidos.has(m[1])) reporta(m[1], m.index, 'se usa');
  }
  // B. Llamadas sueltas `nombre(` — sin `.` antes (los métodos no cuentan).
  for (const m of txt.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const n = m[2];
    if (GLOBALES.has(n) || KEYWORDS.has(n) || llamables.has(n)) continue;
    reporta(n, m.index + m[1].length, 'se llama');
  }
}
console.log(`\n${revisados} módulo(s) revisados · ${fallos} identificador(es) sin declarar`);
process.exit(fallos ? 1 : 0);

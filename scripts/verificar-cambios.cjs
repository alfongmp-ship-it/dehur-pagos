// Verificación previa a subir (correr ANTES de cada commit, junto con check-globales.mjs):
//   node scripts/verificar-cambios.cjs                 → archivos .js cambiados según git
//   node scripts/verificar-cambios.cjs src/a.js src/b.js
// Revisa:
//  1) ESM: cada archivo cambiado se copia a .mjs y se valida con node --check.
//  2) Imports: cada nombre importado existe como export en su archivo destino
//     (historial.js se lee de HEAD: su versión local es un editor pausado que NO se sube).
//  3) Handlers: toda llamada window.fn( y todo onclick/onchange="fn(" tiene su window.fn = … .
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-'));
let cambiados = process.argv.slice(2);
if (!cambiados.length) {
  const git = c => execSync(c, { cwd: ROOT, encoding: 'utf8' }).split('\n').map(x => x.trim()).filter(Boolean);
  cambiados = [...new Set([...git('git diff --name-only HEAD'), ...git('git ls-files --others --exclude-standard')])]
    .filter(f => /^src\/.*\.js$/.test(f) && f !== 'src/modules/historial.js' && fs.existsSync(path.join(ROOT, f)));
}
console.log('Archivos: ' + (cambiados.join(', ') || '(ninguno)'));
let fallas = 0;
const mal = m => { fallas++; console.error('XX ' + m); };

const leer = rel => {
  if (rel.replace(/\\/g, '/') === 'src/modules/historial.js') {
    return execSync('git show HEAD:src/modules/historial.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  }
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
};

// 1) ESM
for (const rel of cambiados) {
  const dst = path.join(SP, 'esm_' + path.basename(rel).replace(/\.js$/, '') + '.mjs');
  fs.writeFileSync(dst, leer(rel));
  try { execSync(`node --check "${dst}"`, { stdio: 'pipe' }); console.log('ESM ok  ' + rel); }
  catch (e) { mal('ESM ' + rel + ': ' + String(e.stderr || e.message).split('\n').slice(0, 4).join(' | ')); }
}

// 2) Imports
const exportsDe = txt => {
  const s = new Set();
  for (const m of txt.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of txt.matchAll(/export\s*\{([^}]*)\}/g)) m[1].split(',').forEach(x => { const n = x.trim().split(/\s+as\s+/).pop().trim(); if (n) s.add(n); });
  return s;
};
for (const rel of cambiados) {
  const txt = leer(rel);
  for (const m of txt.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const destino = path.posix.normalize(path.posix.join(path.posix.dirname(rel.replace(/\\/g, '/')), m[2]));
    let ex;
    try { ex = exportsDe(leer(destino)); } catch (e) { mal(`${rel}: no existe ${destino}`); continue; }
    m[1].split(',').map(x => x.trim()).filter(Boolean).forEach(x => {
      const n = x.split(/\s+as\s+/)[0].trim();
      if (!ex.has(n)) mal(`${rel}: importa "${n}" de ${destino}, que no lo exporta`);
    });
  }
}
console.log('Imports revisados');

// 3) Handlers
const archivos = [];
const recorrer = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach(e => {
  const r = d + '/' + e.name;
  if (e.isDirectory()) recorrer(r); else if (/\.js$/.test(e.name)) archivos.push(r);
});
recorrer('src');
const textos = archivos.map(r => [r, leer(r)]);
textos.push(['index.html', fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')]);
const definidos = new Set();
for (const [, t] of textos) for (const m of t.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) definidos.add(m[1]);
// Funciones globales declaradas en los <script> de index.html (p.ej. toggleTheme).
for (const m of fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) definidos.add(m[1]);
for (const [, t] of textos) for (const m of t.matchAll(/Object\.assign\(\s*window\s*,\s*\{([^}]*)\}/g)) m[1].split(',').forEach(x => { const n = x.trim().split(':')[0].trim(); if (n) definidos.add(n); });
const NATIVOS = new Set(['confirm', 'alert', 'prompt', 'open', 'print', 'location', 'addEventListener', 'removeEventListener', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'scrollTo', 'getComputedStyle', 'requestAnimationFrame', 'matchMedia', 'dispatchEvent', 'fetch', 'close', 'focus', 'scrollBy', 'postMessage', 'queueMicrotask']);
const llamados = new Map();
const JS_KW = new Set(['if', 'return', 'this', 'event', 'document', 'window', 'confirm', 'alert', 'prompt', 'typeof', 'new', 'void', 'function', 'var', 'let', 'const', 'true', 'false', 'null', 'Number', 'String', 'parseInt', 'parseFloat', 'Math', 'JSON', 'Array', 'Object', 'setTimeout', 'encodeURIComponent', 'decodeURIComponent', 'navigator', 'location', 'history', 'console', 'Date', 'isNaN', 'Boolean', 'Promise', 'else', 'for', 'while', 'async', 'await']);
for (const [r, t] of textos) {
  for (const m of t.matchAll(/window\.([A-Za-z_$][\w$]*)\s*\(/g)) if (!NATIVOS.has(m[1])) llamados.set(m[1], r);
  for (const m of t.matchAll(/\son(?:click|change|input|submit|keyup|keydown|blur|focus)\s*=\s*\\?["']\s*([A-Za-z_$][\w$]*)\s*\(/g)) if (!JS_KW.has(m[1])) llamados.set(m[1], r);
}
let n = 0;
for (const [fn, r] of llamados) { n++; if (!definidos.has(fn)) mal(`handler sin window.${fn} (usado en ${r})`); }
console.log(`Handlers revisados: ${n}`);
console.log(fallas ? `\n${fallas} FALLA(S)` : '\nVERIFICACIÓN OK');
process.exit(fallas ? 1 : 0);

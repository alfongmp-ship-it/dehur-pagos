// ============================================================================
// 📥 Importar unidades (solo admin). Da de alta de un jalón las casas de un
// Excel en el proyecto activo de Costos por Unidad: nombre, tipo, indiviso,
// superficie y fecha de escrituración. SOLO CREA: nunca modifica una casa que
// ya existe ni toca repartos (las casas nuevas entran a los repartos viejos
// únicamente si se usa ♻️ Revisar repartos). Todo o nada: con un solo dato
// malo no se crea ninguna.
// ============================================================================
import { state, puedeEditarUnidades } from '../state.js';
import { notify } from '../ui/notify.js';
import { estatusLabel, hoyISOLocal } from '../config/costos-fiscales.js';
import { proyectoCostosActivo, renderCostosFiscales } from './costos-fiscales.js';
import { gsSaveUnidades, esPorFila, sbGuardarFila } from '../services/google-sync.js';

const S = v => (v == null ? '' : String(v).trim());
const norm = s => S(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const r4 = n => Math.round(n * 10000) / 10000;
const num = v => {
  if (typeof v === 'number') return v;
  const t = S(v).replace(/[%\s$]/g, '').replace(',', '.');
  return t === '' ? NaN : Number(t);
};

// Encabezado → campo. Por nombre, sin importar orden, acentos ni mayúsculas.
const COLS = [
  ['casa', t => /^(casa|unidad|depto|departamento|nombre)/.test(t)],
  ['tipo', t => /^tipo/.test(t)],
  ['indiviso', t => /indiviso/.test(t)],
  ['superficie', t => /superficie|m2|m²/.test(t)],
  ['escritura', t => /escritura/.test(t)],
];

// Fecha de Excel (número de serie / Date) o texto DD/MM/YYYY · YYYY-MM-DD → ISO.
// '' = vacía; null = no se entiende.
export function fechaImportISO(v) {
  if (v == null || S(v) === '') return '';
  const p2 = n => String(n).padStart(2, '0');
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  if (typeof v === 'number' && window.XLSX && XLSX.SSF) {
    const d = XLSX.SSF.parse_date_code(v);
    return d && d.y ? `${d.y}-${p2(d.m)}-${p2(d.d)}` : null;
  }
  const t = S(v);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${p2(m[2])}-${p2(m[1])}`;
  return null;
}

// Puro: valida las filas contra las casas existentes del proyecto.
// → { nuevas: [{nombre,tipo,indiviso_pct,superficie_m2,fecha_termino}], errores: [] }
export function planImportarUnidades(aoa, existentes, hoyISO) {
  const errores = [];
  const hi = aoa.findIndex(r => (r || []).some(c => /^(casa|unidad|depto|departamento|nombre)/.test(norm(c))) && (r || []).some(c => /indiviso/.test(norm(c))));
  if (hi < 0) return { nuevas: [], errores: ['No encontré los encabezados: el Excel necesita al menos "Casa" e "Indiviso %"'] };
  const idx = {};
  aoa[hi].forEach((c, i) => { const t = norm(c); const col = COLS.find(([k, f]) => idx[k] == null && f(t)); if (col) idx[col[0]] = i; });
  const ya = new Set(existentes.map(u => norm(u.nombre)));
  const vistos = new Set();
  const nuevas = [];
  aoa.slice(hi + 1).forEach((r, k) => {
    const fila = hi + k + 2;   // renglón como lo ve Excel
    const get = key => (idx[key] == null ? '' : (r || [])[idx[key]]);
    const nombre = S(get('casa'));
    const indRaw = get('indiviso');
    if (!nombre && S(indRaw) === '') return;   // renglón vacío
    if (!nombre) { errores.push(`Renglón ${fila}: falta el nombre de la casa`); return; }
    const kN = norm(nombre);
    if (ya.has(kN)) { errores.push(`Renglón ${fila}: "${nombre}" ya existe en el proyecto (este importador solo crea casas nuevas)`); return; }
    if (vistos.has(kN)) { errores.push(`Renglón ${fila}: "${nombre}" viene repetida en el Excel`); return; }
    vistos.add(kN);
    const ind = num(indRaw);
    if (!(ind > 0 && ind < 100)) { errores.push(`Renglón ${fila} (${nombre}): indiviso "${S(indRaw)}" no es válido (debe ser mayor a 0 y menor a 100)`); return; }
    const supRaw = get('superficie');
    const sup = S(supRaw) === '' ? 0 : num(supRaw);
    if (!(sup >= 0)) { errores.push(`Renglón ${fila} (${nombre}): superficie "${S(supRaw)}" no es un número`); return; }
    const fecha = fechaImportISO(get('escritura'));
    if (fecha === null || (fecha && fecha < '2000-01-01')) { errores.push(`Renglón ${fila} (${nombre}): fecha de escrituración "${S(get('escritura'))}" no se entiende (usa DD/MM/AAAA)`); return; }
    if (fecha && fecha > hoyISO) { errores.push(`Renglón ${fila} (${nombre}): la escrituración ${fecha.split('-').reverse().join('/')} es futura — solo se captura la escritura ya firmada`); return; }
    nuevas.push({ nombre, tipo: S(get('tipo')), indiviso_pct: r4(ind), superficie_m2: sup, fecha_termino: fecha });
  });
  if (!nuevas.length && !errores.length) errores.push('El Excel no trae casas');
  return { nuevas, errores };
}

export function importarUnidadesExcel() {
  if (!puedeEditarUnidades()) { notify('Solo el admin puede dar de alta casas', 'error'); return; }
  if (!state.cargado || state.cargado.unidades !== true) { notify('Las unidades no cargaron completas; recarga la página antes de importar', 'error'); return; }
  if (!proyectoCostosActivo()) { notify('Selecciona un proyecto', 'error'); return; }
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls,.xlsm';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) _procesar(f); };
  inp.click();
}

let _enCurso = false;
async function _procesar(file) {
  if (_enCurso) { notify('Ya hay una importación de casas en curso', 'error'); return; }
  const proyecto = proyectoCostosActivo();
  let aoa;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  } catch (e) { notify('No se pudo leer el Excel: ' + ((e && e.message) || e), 'error'); return; }
  const existentes = state.unidades.filter(u => u.proyecto === proyecto);   // incluye las dadas de baja
  const { nuevas, errores } = planImportarUnidades(aoa, existentes, hoyISOLocal());
  if (errores.length) {
    console.table(errores.map(e => ({ ERROR: e })));
    notify(`⛔ No se creó ninguna casa: ${errores.length} problema(s). ${errores.slice(0, 2).join(' · ')}${errores.length > 2 ? ' … (detalle en consola F12)' : ''}`, 'error');
    return;
  }
  const activas = existentes.filter(u => u.activo !== false);
  const sumaAntes = activas.reduce((s, u) => s + (u.indiviso_pct || 0), 0);
  const sumaDespues = sumaAntes + nuevas.reduce((s, u) => s + u.indiviso_pct, 0);
  const conF = nuevas.filter(u => u.fecha_termino), sinF = nuevas.filter(u => !u.fecha_termino);
  const ej = u => `${u.nombre}${u.tipo ? ' ' + u.tipo : ''} · ${u.indiviso_pct}%${u.fecha_termino ? ' · escriturada ' + u.fecha_termino.split('-').reverse().join('/') : ' · sin escritura'}`;
  if (!confirm(`📥 Dar de alta ${nuevas.length} casa(s) en ${proyecto}:\n\n` +
    `· ${sinF.length} sin escrituración (reciben costo)\n` +
    `· ${conF.length} con escrituración (desde esa fecha ya no reciben costo)\n\n` +
    `Suma de indiviso del proyecto: ${sumaAntes.toFixed(2)}% → ${sumaDespues.toFixed(2)}%${Math.abs(sumaDespues - 100) > 0.05 ? '  ⚠ no da 100%' : ''}\n\n` +
    `Ej.: ${nuevas.slice(0, 3).map(ej).join('\n       ')}\n\n` +
    `Solo se CREAN casas nuevas: no cambia ninguna casa existente ni ningún reparto. Los repartos que ya existen NO las incluyen hasta que uses ♻️ Revisar repartos.\n\n¿Crear las ${nuevas.length}?`)) return;

  _enCurso = true;
  try {
    let orden = existentes.reduce((m, u) => Math.max(m, u.orden || 0), 0);
    const creadas = nuevas.map(n => ({
      unidad_id: state.nextUnidadId++,
      proyecto,
      orden: ++orden,
      activo: true,
      nombre: n.nombre,
      tipo: n.tipo,
      indiviso_pct: n.indiviso_pct,
      superficie_m2: n.superficie_m2,
      fecha_termino: n.fecha_termino,
      estatus: n.fecha_termino ? 'Terminada' : 'En obra',
    }));
    state.unidades.push(...creadas);   // todas juntas
    const porFila = esPorFila('unidades');
    await gsSaveUnidades({ porFila });
    if (porFila) for (const u of creadas) await sbGuardarFila('unidades', u);
    renderCostosFiscales();
    notify(`📥 ${creadas.length} casa(s) dadas de alta en ${proyecto} (${sinF.length} sin escrituración · ${conF.length} ${estatusLabel('Terminada').toLowerCase()}s)`);
  } finally { _enCurso = false; }
}

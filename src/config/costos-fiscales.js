// Catálogos para el módulo de Costos Fiscales por unidad.
import { state } from '../state.js';

// Estatus de obra de una unidad (casa).
export const ESTATUS_UNIDAD = ['En obra', 'Terminada', 'Entregada', 'Vendida'];

// Métodos de asignación de un pago a unidades:
// - directo:    el pago completo va a 1 unidad.
// - equitativo: el pago se divide en partes iguales entre N unidades.
// - indiviso:   el pago se reparte entre TODAS las unidades del proyecto
//               según su % de indiviso (costos de área común / indirectos).
// - indiviso_sel: igual, pero SOLO entre las casas elegidas, con su indiviso
//               renormalizado entre ellas (contratista que trabajó en algunas).
// - custom:     proporción libre por unidad (preparado para uso futuro).
export const METODOS_ASIGNACION = ['directo', 'equitativo', 'indiviso', 'indiviso_sel', 'custom'];

export const METODO_LABEL = {
  directo: 'Directo a una unidad',
  equitativo: 'Dividido en partes iguales',
  indiviso: 'Área común (por indiviso)',
  indiviso_sel: 'Indiviso entre casas elegidas',
  custom: 'Proporción personalizada',
};

// Hoy en hora LOCAL (toISOString es UTC: en México, después de las 18:00 daba mañana).
export function hoyISOLocal() {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

// Normaliza a 'YYYY-MM-DD' las fechas que puede traer el catálogo ('YYYY-MM-DD…',
// 'DD/MM/YYYY'); '' si no se puede interpretar (así nunca se compara basura). Un año
// < 2000 es una fecha a medio teclear en el campo (0002, 0202…): tampoco cuenta.
function _iso(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Number(m[1]) < 2000 ? '' : `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return Number(m[3]) < 2000 ? '' : `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

// CIERRE de una casa (regla del dueño, 2026-09-30): la fecha MÁS TEMPRANA entre su
// terminación de obra (`fecha_termino`) y su ESCRITURA real (ventas.fecha_escritura_real de
// una venta activa y no cancelada). A partir de esa fecha la casa NO puede recibir costo.
// '' = abierta (sin terminación ni escritura).
// Escritura real más temprana por casa. Caché corto (1 s): los pools se evalúan miles
// de veces por render/auditoría y recorrer todas las ventas cada vez es caro; un cambio
// de venta se ve en el siguiente segundo.
let _escCache = null, _escRef = null, _escT = 0;
function _escrituraMin(uid) {
  const v = state.ventas || [];
  const now = Date.now();
  if (!_escCache || _escRef !== v || now - _escT > 1000) {
    _escCache = new Map();
    v.forEach(x => {
      if (x.activo === false || x.estatus_comercial === 'cancelada') return;
      const fe = _iso(x.fecha_escritura_real);
      if (!fe) return;
      const k = String(x.unidad_id);
      const prev = _escCache.get(k);
      if (!prev || fe < prev) _escCache.set(k, fe);
    });
    _escRef = v; _escT = now;
  }
  return _escCache.get(String(uid)) || '';
}

// Tras capturar/cambiar una venta en esta sesión: las ventas se mutan EN SITIO
// (mismo arreglo), así que el caché de 1 s podría no ver el cambio recién hecho.
export function invalidarCierres() { _escCache = null; }

export function fechaCierreUnidad(u) {
  if (!u) return '';
  const ft = _iso(u.fecha_termino);
  const fe = _escrituraMin(u.unidad_id);
  if (ft && fe) return ft < fe ? ft : fe;
  return ft || fe || '';
}

// ¿La casa está ABIERTA (puede recibir costo) a una fecha dada? Sí, si sigue activa y su
// cierre es POSTERIOR a esa fecha. Sin cierre = abierta siempre. Sin fechaISO se usa hoy
// (hora local). Las fechas deben venir en ISO 'YYYY-MM-DD' (los llamadores normalizan con
// parseFechaHist).
export function unidadEnIndivisoAFecha(u, fechaISO) {
  if (!u || u.activo === false) return false;
  const cierre = fechaCierreUnidad(u);
  if (!cierre) return true;
  const d = fechaISO || hoyISOLocal();
  return cierre > d;
}

// Catálogos para el módulo de Costos Fiscales por unidad.

// Estatus de obra de una unidad (casa).
export const ESTATUS_UNIDAD = ['En obra', 'Terminada', 'Entregada', 'Vendida'];

// Cómo se MUESTRA cada estatus (el valor guardado NO cambia). La "Terminada" de la app es
// en realidad la ESCRITURACIÓN: desde esa fecha la casa deja de recibir costo (decisión del
// dueño, oct-2026; mismo criterio que el despacho fiscal).
export const ESTATUS_LABEL = { 'Terminada': 'Escriturada' };
export const estatusLabel = e => ESTATUS_LABEL[e] || e || '';

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

// CIERRE de una casa = su fecha de ESCRITURACIÓN capturada en la pestaña Unidades
// (`fecha_termino`). A partir de esa fecha la casa NO puede recibir costo. '' = abierta.
// Regla del dueño (2026-10-07): lo capturado en Ingresos (ventas.fecha_escritura_real)
// NO cierra casas — Ingresos todavía no se usa y una fecha tentativa ahí cerraba la casa.
export function fechaCierreUnidad(u) {
  if (!u) return '';
  return _iso(u.fecha_termino);
}

// Se conserva para los llamadores de Ingresos/rehacer (antes vaciaba el caché de
// escrituras de ventas); el cierre ya no depende de ventas, así que no hace nada.
export function invalidarCierres() {}

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

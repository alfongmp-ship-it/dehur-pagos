// Catálogos para el módulo de Costos Fiscales por unidad.

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

// ¿La casa está en el pool de INDIVISO a una fecha dada? Sí, si sigue activa y todavía NO
// había salido (terminado) a esa fecha. `fecha_termino` vacío = sigue en obra (siempre en el
// pool). Sin fechaISO se usa hoy. Las fechas deben venir en ISO 'YYYY-MM-DD' (los llamadores
// normalizan con parseFechaHist). Inerte mientras ninguna casa tenga fecha_termino → igual que hoy.
export function unidadEnIndivisoAFecha(u, fechaISO) {
  if (!u || u.activo === false) return false;
  if (!u.fecha_termino) return true;
  const d = fechaISO || new Date().toISOString().slice(0, 10);
  return String(u.fecha_termino) > d;
}

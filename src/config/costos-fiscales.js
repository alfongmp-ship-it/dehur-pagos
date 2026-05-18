// Catálogos para el módulo de Costos Fiscales por unidad.

// Estatus de obra de una unidad (casa).
export const ESTATUS_UNIDAD = ['En obra', 'Terminada', 'Entregada', 'Vendida'];

// Métodos de asignación de un pago a unidades:
// - directo:    el pago completo va a 1 unidad.
// - equitativo: el pago se divide en partes iguales entre N unidades.
// - indiviso:   el pago se reparte entre TODAS las unidades del proyecto
//               según su % de indiviso (costos de área común / indirectos).
// - custom:     proporción libre por unidad (preparado para uso futuro).
export const METODOS_ASIGNACION = ['directo', 'equitativo', 'indiviso', 'custom'];

export const METODO_LABEL = {
  directo: 'Directo a una unidad',
  equitativo: 'Dividido en partes iguales',
  indiviso: 'Área común (por indiviso)',
  custom: 'Proporción personalizada',
};

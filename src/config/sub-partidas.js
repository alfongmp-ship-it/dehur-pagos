// Catálogo oficial de sub-partidas para movimientos de Construcción.
export const SUB_PARTIDAS_CONSTRUCCION = [
  'Preliminares',
  'Urbanización',
  'Media Tensión',
  'Agua, Drenaje y Redes Sanitarias',
  'Cimentación',
  'Estructura',
  'Albañilería',
  'Mano de Obra',
  'Fachadas y Recubrimientos Exteriores',
  'Cancelería y Barandales',
  'Herrería',
  'Instalaciones Eléctricas',
  'Instalaciones Hidrosanitarias',
  'Instalaciones de Gas',
  'Instalaciones Especiales / Voz y Datos',
  'Drenaje y Redes Sanitarias',
  'Acabados',
  'Impermeabilización',
  'Carpintería',
  'Cocinas',
  'Muebles de Baño',
  'Elevadores',
  'Amenidades',
  'Obras Exteriores y Jardinería',
  'Renta de Maquinaria y Equipo',
];

export function getSubPartidas(partida) {
  const p = (partida || '').trim().toLowerCase();
  if (p === 'construcción' || p === 'construccion') return SUB_PARTIDAS_CONSTRUCCION;
  return [];
}

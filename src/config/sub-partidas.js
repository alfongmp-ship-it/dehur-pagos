// Catálogo oficial de sub-partidas para movimientos de Construcción.
// ASCII puro: sin tildes ni ñ, para coincidir con los valores guardados en Sheets.
export const SUB_PARTIDAS_CONSTRUCCION = [
  'Preliminares',
  'Urbanizacion',
  'Media Tension',
  'Agua, Drenaje y Redes Sanitarias',
  'Cimentacion',
  'Estructura',
  'Albanileria',
  'Mano de Obra',
  'Fachadas y Recubrimientos Exteriores',
  'Canceleria y Barandales',
  'Herreria',
  'Instalaciones Electricas',
  'Instalaciones Hidrosanitarias',
  'Instalaciones de Gas',
  'Instalaciones Especiales / Voz y Datos',
  'Drenaje y Redes Sanitarias',
  'Acabados',
  'Impermeabilizacion',
  'Carpinteria',
  'Cocinas',
  'Muebles de Bano',
  'Elevadores',
  'Amenidades',
  'Obras Exteriores y Jardineria',
  'Renta de Maquinaria y Equipo',
  'CONSTRUCCION',
];

export function getSubPartidas(partida) {
  const p = (partida || '').trim().toLowerCase();
  if (p === 'construcción' || p === 'construccion') return SUB_PARTIDAS_CONSTRUCCION;
  return [];
}

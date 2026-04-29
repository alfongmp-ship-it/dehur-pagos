// Catálogo de sub-partidas por partida principal.
// Reemplazar SUB_PARTIDAS_CONSTRUCCION con el catálogo oficial de la empresa.
export const SUB_PARTIDAS_CONSTRUCCION = [
  'Instalaciones',
  'Acabados',
];

export function getSubPartidas(partida) {
  const p = (partida || '').trim().toLowerCase();
  if (p === 'construcción' || p === 'construccion') return SUB_PARTIDAS_CONSTRUCCION;
  return [];
}

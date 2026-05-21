// Catálogo de partidas / subpartidas.
// - SUB_PARTIDAS_CONSTRUCCION: semilla de migración usada SOLO la primera vez
//   que se inicializa la hoja partidas_catalogo en Sheets.
// - getPartidasCatalogo / getSubPartidas: leen el catálogo dinámico desde state.
// ASCII puro: sin tildes ni ñ, para coincidir con los valores guardados en Sheets.
import { state } from '../state.js';

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

const norm = s => (s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

export function getPartidasCatalogo() {
  return (state.partidasCatalogo || []).filter(p => p.activa !== false);
}

export function getSubPartidas(partida) {
  const p = norm(partida);
  if (!p) return [];
  const item = (state.partidasCatalogo || []).find(x => norm(x.partida) === p && x.activa !== false);
  if (item && Array.isArray(item.subpartidas)) return item.subpartidas;
  // Fallback duro: si el catálogo aún no está poblado y se pregunta por
  // CONSTRUCCION, devolver la semilla. Útil en arranques sin Sheets conectado.
  if (p === 'construccion') return SUB_PARTIDAS_CONSTRUCCION;
  return [];
}

export function subPartidaObligatoria(partida) {
  return norm(partida) === 'construccion';
}

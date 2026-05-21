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

// Reglas de negocio: SOLO CONSTRUCCION tiene subpartidas. Aunque el catálogo
// permita guardar subpartidas para otras partidas, no se usan en la UI.
export function getSubPartidas(partida) {
  if (norm(partida) !== 'construccion') return [];
  const item = (state.partidasCatalogo || []).find(x => norm(x.partida) === 'construccion' && x.activa !== false);
  if (item && Array.isArray(item.subpartidas) && item.subpartidas.length) return item.subpartidas;
  return SUB_PARTIDAS_CONSTRUCCION;
}

export function subPartidaObligatoria(partida) {
  return norm(partida) === 'construccion';
}

// Helper: opciones {value,label} para llenar selects en cualquier pantalla.
// Si includeLegacy es un array, agrega al final las que no estén en el catálogo
// activo (marcadas como "(legacy)") para no perder valores antiguos del historial.
export function getPartidasParaSelect(includeLegacy = []) {
  const activas = getPartidasCatalogo().slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const opts = activas.map(p => ({ value: p.partida, label: p.partida }));
  const existentes = new Set(activas.map(p => norm(p.partida)));
  const extras = [];
  (includeLegacy || []).forEach(v => {
    const vv = (v || '').trim();
    if (!vv) return;
    if (existentes.has(norm(vv))) return;
    if (extras.some(e => norm(e.value) === norm(vv))) return;
    extras.push({ value: vv, label: vv + ' (legacy)' });
  });
  return [...opts, ...extras];
}

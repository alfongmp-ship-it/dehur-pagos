// ============================================================================
// Clase EFECTIVA de un costo (directo / indirecto) para 🧾 Fiscal → 🏠 Por casa,
// que suma a las casas SOLO lo directo; lo indirecto va a la tarjeta "Indirectos
// por distribuir" hasta que se decida cómo repartirlo (regla del dueño 2026-10-07).
//   · Manda la clase de contabilidad (Ericka, por factura).
//   · Sin clase decide la partida, pero solo para lo seguro (en las facturas que
//     Ericka sí clasificó, CONSTRUCCION y Supervision salen ~100% Directo; Terreno
//     se paga sin factura): esas = directo, todo lo demás = indirecto. Lo decidido
//     por partida es PROVISIONAL (cambia en cuanto contabilidad la clasifique).
//   · Sin clase ni partida → 'sinDato' (no se sabe todavía).
// Puro: sin imports, para probarlo aparte (scripts/test-clase-efectiva.mjs).
// ============================================================================
export const PARTIDAS_DIRECTAS = ['CONSTRUCCION', 'Supervision', 'Terreno'];

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const _DIR = new Set(PARTIDAS_DIRECTAS.map(norm));

// claseContab: 'directo' | 'indirecto' | null/'' (sin clase) · partida: texto de la partida
// → { clase: 'directo' | 'indirecto' | 'sinDato', provisional: boolean }
export function claseEfectiva(claseContab, partida) {
  if (claseContab === 'directo' || claseContab === 'indirecto') return { clase: claseContab, provisional: false };
  const p = norm(partida);
  if (!p) return { clase: 'sinDato', provisional: true };
  return { clase: _DIR.has(p) ? 'directo' : 'indirecto', provisional: true };
}

export const CLASE_EFECTIVA_LABEL = { directo: 'Directo', indirecto: 'Indirecto', sinDato: 'Sin clase ni partida' };

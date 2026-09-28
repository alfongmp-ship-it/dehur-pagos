// ===== Lotes para subir asignaciones (costo_asignaciones) en pocos requests =====
// FUNCIONES PURAS, sin imports (probadas en scripts/test-lotes-asignaciones.mjs).
//
// Reglas (decididas tras el incidente del reparto en bloque de 30 facturas):
//  1. DEDUP por asignacion_id: Postgres rechaza el mismo id dos veces en un mismo
//     statement de upsert ("ON CONFLICT DO UPDATE command cannot affect row a
//     second time"). Se conserva la ÚLTIMA aparición (la más reciente en state).
//  2. Los lotes se cortan en FRONTERA de documento (factura_id o pago_id): un lote
//     que falle nunca deja una factura/pago con reparto a medias. Un documento con
//     más filas que `max` viaja SOLO en su propio lote (grande) por la misma razón.
//  3. Tope `max` por lote (statement_timeout de Supabase ~8 s: 100 filas van sobrados).

export function dedupPorId(rows, idCol = 'asignacion_id') {
  const porId = new Map();
  for (const r of rows || []) porId.set(String(r[idCol]), r);   // la última gana
  return [...porId.values()];
}

// Llave del documento al que pertenece la fila (para no partirlo entre lotes).
export function llaveDoc(r) {
  if (r.factura_id != null && String(r.factura_id) !== '') return 'f:' + String(r.factura_id);
  if (r.pago_id != null && String(r.pago_id) !== '') return 'p:' + String(r.pago_id);
  return 'x:' + String(r.asignacion_id);
}

export function partirEnLotes(rows, max = 100) {
  const filas = dedupPorId(rows);
  // Agrupar por documento conservando el orden de primera aparición.
  const grupos = new Map();
  for (const r of filas) {
    const k = llaveDoc(r);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  }
  const lotes = [];
  let actual = [];
  for (const grupo of grupos.values()) {
    if (grupo.length >= max) {              // documento grande: lote propio, entero
      if (actual.length) { lotes.push(actual); actual = []; }
      lotes.push(grupo.slice());
      continue;
    }
    if (actual.length + grupo.length > max) { lotes.push(actual); actual = []; }
    actual.push(...grupo);
  }
  if (actual.length) lotes.push(actual);
  // Orden canónico DENTRO de cada lote: dos sesiones que toquen filas traslapadas
  // bloquean en el mismo orden global → sin deadlock entre sus statements.
  for (const l of lotes) l.sort((a, b) => (String(a.asignacion_id) < String(b.asignacion_id) ? -1 : 1));
  return lotes;
}

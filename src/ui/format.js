// Dinero SIEMPRE con 2 decimales. `maximumFractionDigits` es obligatorio: sin él
// toLocaleString usa max(min, 3) y las SUMAS grandes salían con 3 decimales
// ($20,242,075.572) por el arrastre de coma flotante — se veía como error de datos.
export function fmt(n) {
  return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Escapa texto para insertarlo con seguridad en innerHTML (contenido) o en
// atributos con comillas (title="…", value="…"). Evita XSS almacenado: un dato
// con < > " ' & (p.ej. de un proveedor o un Excel pegado) se muestra LITERAL en
// vez de ejecutarse. Úsalo en CADA interpolación de texto libre que vaya al DOM.
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Formatea CUALQUIER fecha guardada (DD/MM/YYYY, D/M/YYYY o YYYY-MM-DD) para
// MOSTRARLA siempre pareja como DD/MM/YYYY con ceros. No cambia cómo se guarda,
// solo cómo se ve → resuelve la mezcla de formatos en pantalla.
export function fmtFecha(f) {
  if (!f) return '';
  const s = String(f).trim();
  // ISO: YYYY-MM-DD(...) → DD/MM/YYYY
  if (s.includes('-') && s.length >= 10) {
    const [y, m, d] = s.slice(0, 10).split('-');
    if (y && m && d) return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }
  // DD/MM/YYYY con o sin ceros → con ceros
  const p = s.split('/');
  if (p.length === 3) {
    const [d, m, y] = p;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }
  return s; // formato desconocido: mostrar tal cual
}

// Fecha de HOY en formato DD/MM/YYYY (con ceros), en hora LOCAL. Determinista —
// NO depende del navegador/idioma como toLocaleDateString. Úsala al crear fechas.
export function hoyFecha() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export function dl(csv, fn) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fn;
  a.click();
  URL.revokeObjectURL(url);
}

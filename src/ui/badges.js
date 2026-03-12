export function tipoBadge(t) {
  if (t === 'CLABE') return '<span class="tipo-badge-clabe">✓ CLABE</span>';
  if (t === 'Cuenta BBVA') return '<span class="tipo-badge-bbva">🏦 BBVA</span>';
  return '<span class="tipo-badge-corta">⚠ Corta</span>';
}

export function catTag(c) {
  const m = {
    'Obra / Materiales': 'tag-obra',
    'Nómina / Asimilados': 'tag-nomina',
    'Impuestos': 'tag-impuesto',
    'Gastos fijos': 'tag-fijo',
    'Préstamo entre proyectos': 'tag-prestamo',
    'General': 'tag-general'
  };
  return `<span class="tag ${m[c] || 'tag-general'}">${c}</span>`;
}

export function proyTag(p) {
  if (p.includes('Paraíso')) return `<span class="tag tag-paraiso" style="font-size:10px;padding:2px 6px;">Paraíso</span>`;
  if (p.includes('Entorno')) return `<span class="tag tag-entorno" style="font-size:10px;padding:2px 6px;">Entorno</span>`;
  return `<span class="tag tag-dt" style="font-size:10px;padding:2px 6px;">DT</span>`;
}

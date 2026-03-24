export function tipoBadge(t) {
  if (t === 'CLABE') return '<span class="tipo-badge-clabe">✓ CLABE</span>';
  return '<span class="tipo-badge-bbva">Cuenta</span>';
}

export function catTag(c) {
  const m = {
    'General': 'tag-general',
    'Nomina': 'tag-nomina',
    'Proveedor': 'tag-general',
    'Obra': 'tag-obra',
    'Acreedor': 'tag-fijo',
    'Socio': 'tag-prestamo',
    'Contratista': 'tag-obra'
  };
  return `<span class="tag ${m[c] || 'tag-general'}">${c}</span>`;
}

export function proyTag(p) {
  if (!p) return '<span class="tag tag-dt" style="font-size:10px;padding:2px 6px;">—</span>';
  const pl = p.toLowerCase();
  if (pl.includes('paraiso') || pl.includes('paraíso')) return `<span class="tag tag-paraiso" style="font-size:10px;padding:2px 6px;">Paraíso</span>`;
  if (pl.includes('entorno')) return `<span class="tag tag-entorno" style="font-size:10px;padding:2px 6px;">Entorno</span>`;
  if (pl.includes('concentradora') || pl === 'dt') return `<span class="tag tag-dt" style="font-size:10px;padding:2px 6px;">DT</span>`;
  return `<span class="tag tag-dt" style="font-size:10px;padding:2px 6px;">${p}</span>`;
}

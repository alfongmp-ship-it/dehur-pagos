export function fmt(n) {
  return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2 });
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

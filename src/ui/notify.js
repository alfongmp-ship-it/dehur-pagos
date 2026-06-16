let _nt;

export function notify(msg, type = 'success') {
  const el = document.getElementById('notif');
  const nm = document.getElementById('nm');
  nm.textContent = msg;
  // Respeta los saltos de línea del mensaje (ej. listas de errores que llegan con \n).
  nm.style.whiteSpace = 'pre-line';
  document.getElementById('ni').textContent = type === 'success' ? '✓' : '✕';
  el.className = `notif show ${type}`;
  // Clic en el aviso lo cierra (para leerlo el tiempo que haga falta y cerrarlo ya).
  el.style.cursor = 'pointer';
  el.title = 'Clic para cerrar';
  el.onclick = () => { clearTimeout(_nt); el.classList.remove('show'); };
  // Los ERRORES se quedan más tiempo (y crecen con el largo del mensaje, tope ~20s)
  // para poder leerlos; los éxitos se van rápido como siempre.
  const dur = type === 'error' ? Math.min(20000, 6000 + String(msg).length * 50) : 3000;
  clearTimeout(_nt);
  _nt = setTimeout(() => el.classList.remove('show'), dur);
}

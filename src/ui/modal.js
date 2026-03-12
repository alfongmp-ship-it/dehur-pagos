export function cerrar(id) {
  document.getElementById(id).classList.remove('open');
}

export function setupModalCloseHandlers() {
  document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => {
      if (e.target === o) o.classList.remove('open');
    });
  });
}

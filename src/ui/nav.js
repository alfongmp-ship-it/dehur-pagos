import { state } from '../state.js';

export function refreshProyectosEnSelects() {
  ['pago-proy'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = state.proyectos.filter(p => p.activo).map(p =>
      `<option value="${p.nombre}">${p.nombre}</option>`
    ).join('');
    if (cur) el.value = cur;
  });
  const fp = document.getElementById('f-proy');
  if (fp) {
    const cur = fp.value;
    fp.innerHTML = '<option value="">Todos los proyectos</option>' +
      state.proyectos.filter(p => p.activo).map(p =>
        `<option value="${p.nombre}">${p.nombre}</option>`
      ).join('');
    if (cur) fp.value = cur;
  }
  const pillContainer = document.querySelector('#modal-prov .proyecto-pill')?.parentElement ||
    document.getElementById('pills-placeholder')?.parentElement;
  if (pillContainer) {
    pillContainer.innerHTML = state.proyectos.filter(p => p.activo)
      .map(p => `<span class="proyecto-pill" data-p="${p.nombre}" onclick="this.classList.toggle('selected')">${p.nombre}</span>`).join('');
  }
}

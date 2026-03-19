import { state } from '../state.js';

export function renderCreditos() {
  const el = document.getElementById('creditos-content');
  if (!el) return;
  document.getElementById('cnt-creditos').textContent = state.creditos.filter(c => c.activo !== false).length;
}

export function abrirNuevoCredito() {}
export function editarCredito() {}
export function guardarCredito() {}
export function eliminarCredito() {}
export function abrirPagoCredito() {}
export function confirmarPagoCredito() {}

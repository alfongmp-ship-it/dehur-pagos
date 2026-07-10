export function cerrar(id) {
  document.getElementById(id).classList.remove('open');
}

export function setupModalCloseHandlers() {
  // Los modales SOLO se cierran con su ✕ (.modal-close → cerrar) o con Cancelar.
  // Antes un clic en el fondo (o un arrastre desde un campo que soltaba fuera)
  // cerraba el modal y se perdía todo el formulario (ej. una factura larga).
  // Ese cierre-por-fondo se quitó a propósito. No-op intencional.
}

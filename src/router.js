import { state, rol } from './state.js';

// Páginas que puede navegar cada perfil ACOTADO (los demás roles navegan libre).
// Es UX/defensa; el bloqueo de escritura real está en los guardados por rol.
//   'obra' (Gustavo, residente, solo-lectura) y 'facturas_obra' (Anahi: poderes de
//   facturas sin ver el resto) → las 3 de siempre.
//   'conciliacion' (Diana) → esas 3 + Historial de Pagos: concilia pagos↔facturas.
// Es un mapa POR ROL a propósito: un Set compartido abriría la página nueva de un
// perfil a todos los demás acotados.
const PAGINAS_POR_ROL = {
  obra:          new Set(['facturas', 'factura-pagos', 'costos-fiscales']),
  facturas_obra: new Set(['facturas', 'factura-pagos', 'costos-fiscales']),
  conciliacion:  new Set(['historial', 'facturas', 'factura-pagos', 'costos-fiscales']),
};
// Página de inicio de cada perfil acotado (a donde lo regresa si intenta salirse).
export const INICIO_POR_ROL = { obra: 'costos-fiscales', facturas_obra: 'facturas', conciliacion: 'historial' };

// Render (lazy) de UNA página por nombre. Lo usan showPage al navegar y
// renderPaginaActual tras cada carga de datos (finalizarCarga / 🔄 Refrescar):
// así el arranque ya no renderiza las 15 páginas ocultas — solo la visible.
function renderDePagina(name) {
  if (name === 'proveedores' && window.renderProveedores) window.renderProveedores();
  if (name === 'nomina' && window.renderNomina) window.renderNomina();
  if (name === 'dispersion') { if (window.renderCuentaDispSelect) window.renderCuentaDispSelect(); if (window.renderCola) window.renderCola(); }
  if (name === 'confirmar' && window.renderConfirmarPagos) window.renderConfirmarPagos();
  if (name === 'historial' && window.renderHistorial) window.renderHistorial();
  if (name === 'solicitudes' && window.renderSolicitudes) window.renderSolicitudes();
  if (name === 'facturas' && window.renderFacturas) window.renderFacturas();
  if (name === 'factura-pagos' && window.renderFacturaPagos) window.renderFacturaPagos();
  if (name === 'config') { if (window.renderConfigProyectos) window.renderConfigProyectos(); if (window.renderConfigPartidas) window.renderConfigPartidas(); if (window.renderConfigPartidasObra) window.renderConfigPartidasObra(); }
  if (name === 'cuentas-propias' && window.renderCuentasPropias) window.renderCuentasPropias();
  if (name === 'posicion-saldos' && window.renderPosicionSaldos) window.renderPosicionSaldos();
  if (name === 'resumen-costos' && window.renderResumenCostos) window.renderResumenCostos();
  if (name === 'flujo-salida' && window.renderFlujoSalida) window.renderFlujoSalida();
  if (name === 'resumen-ejecutivo' && window.renderResumenEjecutivo) window.renderResumenEjecutivo();
  if (name === 'costos-fiscales' && window.renderCostosFiscales) window.renderCostosFiscales();
  // FISCAL (admin + contabilidad; backstop real en renderFiscal + RLS de fiscal_marcas)
  if (name === 'fiscal' && window.renderFiscal) window.renderFiscal();
  if (name === 'traspasos' && window.renderTraspasos) window.renderTraspasos();
  if (name === 'resumen-traspasos' && window.renderResumenTraspasos) window.renderResumenTraspasos();
  if (name === 'creditos' && window.renderCreditos) window.renderCreditos();
  // INGRESOS (Fase 1)
  if (name === 'clientes' && window.renderClientes) window.renderClientes();
  if (name === 'ventas' && window.renderVentas) window.renderVentas();
  if (name === 'cobros' && window.renderCobros) window.renderCobros();
  if (name === 'estado-cuenta' && window.renderEstadoCuenta) window.renderEstadoCuenta();
  // ESTRATEGIA (Fase 2)
  if (name === 'estrategia-tablero' && window.renderEstrategiaTablero) window.renderEstrategiaTablero();
  if (name === 'estrategia-flags' && window.renderEstrategiaFlags) window.renderEstrategiaFlags();
  if (name === 'estrategia-config' && window.renderEstrategiaConfig) window.renderEstrategiaConfig();
  if (name === 'estrategia-simulador-caja' && window.renderSimuladorCaja) window.renderSimuladorCaja();
  // ACTIVIDAD (solo admin; el backstop real está en renderActividad + RLS)
  if (name === 'actividad' && window.renderActividad) window.renderActividad();
}

export function showPage(name, el) {
  const permitidas = PAGINAS_POR_ROL[rol()];
  if (permitidas && !permitidas.has(name)) {
    // Cada perfil acotado regresa a SU inicio.
    name = INICIO_POR_ROL[rol()] || 'costos-fiscales';
    el = document.getElementById('nav-' + name);
  }
  document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
  document.getElementById('page-' + name).style.display = '';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  renderDePagina(name);
}

// Re-render de la página actualmente VISIBLE (tras cargar/refrescar datos).
export function renderPaginaActual() {
  const visible = [...document.querySelectorAll('[id^="page-"]')]
    .find(p => p.style.display !== 'none');
  if (visible) renderDePagina(visible.id.replace('page-', ''));
}

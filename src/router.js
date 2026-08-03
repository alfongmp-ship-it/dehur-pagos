import { state, rol } from './state.js';

// El rol 'obra' (residente) solo navega a estas páginas; cualquier otra lo regresa a
// Costos por Unidad. Es UX/defensa; el bloqueo de escritura real está en los guardados.
const OBRA_PAGES = new Set(['facturas', 'factura-pagos', 'costos-fiscales']);
// Roles con el menú ACOTADO a esas 3 páginas: 'obra' (residente, solo-lectura) y
// 'facturas_obra' (Anahi: mismos poderes de facturas que 'facturas', pero sin ver
// el resto de la app). Cualquier otra página los regresa a su inicio.
const ROLES_ACOTADOS = new Set(['obra', 'facturas_obra']);

export function showPage(name, el) {
  if (ROLES_ACOTADOS.has(rol()) && !OBRA_PAGES.has(name)) {
    // Cada perfil acotado regresa a SU inicio: 'facturas_obra' captura facturas;
    // 'obra' (residente) revisa Costos por Unidad.
    name = rol() === 'facturas_obra' ? 'facturas' : 'costos-fiscales';
    el = document.getElementById('nav-' + name);
  }
  document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
  document.getElementById('page-' + name).style.display = '';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  // Lazy-render pages on navigation
  if (name === 'proveedores' && window.renderProveedores) window.renderProveedores();
  if (name === 'nomina' && window.renderNomina) window.renderNomina();
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
}

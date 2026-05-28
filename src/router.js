import { state } from './state.js';

export function showPage(name, el) {
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
}

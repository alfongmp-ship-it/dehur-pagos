import { state } from './state.js';

export function showPage(name, el) {
  document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
  document.getElementById('page-' + name).style.display = '';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  // Lazy-render pages on navigation
  if (name === 'proveedores' && window.renderProveedores) window.renderProveedores();
  if (name === 'nomina' && window.renderNomina) window.renderNomina();
  if (name === 'historial') {
    if (window.renderHistorial) window.renderHistorial();
    const btn = document.getElementById('btn-confirmar-hist');
    if (btn) btn.style.display = state.pendientesConfirmacion && state.pendientesConfirmacion.length ? 'inline-flex' : 'none';
  }
  if (name === 'solicitudes' && window.renderSolicitudes) window.renderSolicitudes();
  if (name === 'facturas' && window.renderFacturas) window.renderFacturas();
  if (name === 'factura-pagos' && window.renderFacturaPagos) window.renderFacturaPagos();
  if (name === 'config' && window.renderConfigProyectos) window.renderConfigProyectos();
  if (name === 'cuentas-propias' && window.renderCuentasPropias) window.renderCuentasPropias();
  if (name === 'traspasos' && window.renderTraspasos) window.renderTraspasos();
  if (name === 'resumen-traspasos' && window.renderResumenTraspasos) window.renderResumenTraspasos();
}

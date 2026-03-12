// ===== MAIN.JS — Entry Point =====
// Carga datos, inicializa estado, renderiza UI, expone funciones en window

import { state } from './state.js';
import { loadProyectos } from './config/proyectos.js';
import { showPage } from './router.js';
import { setupModalCloseHandlers, cerrar } from './ui/modal.js';
import { notify } from './ui/notify.js';
import { renderHeaderBadges, renderCuentaDispSelect, updateCuentaGlobal } from './ui/header.js';
import { refreshProyectosEnSelects } from './ui/nav.js';
import { renderProveedores, abrirNuevoProveedor, editarProv, updateTipoProv, validarCuentaProv, guardarProveedor, exportarCSV } from './modules/proveedores.js';
import { renderNomina, abrirNuevoEmpleado, editarEmp, updateTipoEmp, validarCuentaEmp, guardarEmpleado, exportarNomina } from './modules/nomina.js';
import { renderHistorial, exportarHistorial, renderModalConf, toggleAllConf, abrirModalConfirmarPagos, confirmarPagos } from './modules/historial.js';
import { renderCola, abrirPagoRapido, abrirModalPago, buscarModal, selPago, agregarACola, abrirModalNominaDisp, filtrarNomDisp, agregarNominaACola, qDel, limpiarCola, buscarRapido, quickAdd, generarArchivo, abrirModalDispersion, renderModalDisp, toggleAllDisp, generarExcelBBVA, enviarADispersion } from './modules/dispersion.js';
import { handleSolDrop, handleSolFile, descargarPlantilla, parsearSolicitud, renderSolicitudes, toggleSol, seleccionarTodosSol, nuevaSolicitud, abrirVincular, renderVincBusqueda, seleccionarProvExistente, renderVincTipo, validarVincCuenta, confirmarNuevoProv } from './modules/solicitudes.js';
import { calcularClabeProy, selColor, abrirModalProyecto, guardarProyecto, toggleProyecto, renderConfigProyectos } from './modules/config-page.js';
import { gsLogin, gsLogout, renderAuthStatus, checkOAuthCallback } from './services/google-auth.js';
import { gsLoadAll, gsSaveProveedores, gsSaveEmpleados, gsSaveProyectos } from './services/google-sync.js';

// ===== INICIALIZACIÓN =====
async function init() {
  // 1. Cargar proyectos desde localStorage (o seed)
  state.proyectos = loadProyectos();

  // 2. Fetch datos JSON en paralelo
  try {
    const [seedRes, extraRes, nomRes] = await Promise.all([
      fetch('./data/proveedores-seed.json'),
      fetch('./data/proveedores-extra.json'),
      fetch('./data/nomina-seed.json')
    ]);
    const seed = await seedRes.json();
    const extra = await extraRes.json();
    const nomina = await nomRes.json();

    // 3. Merge proveedores (dedup por cuenta)
    const cuentasVistas = new Set();
    const merged = [];
    [...seed, ...extra].forEach(p => {
      const key = p.cuenta || p.clabe || p.nombre;
      if (!cuentasVistas.has(key)) {
        cuentasVistas.add(key);
        merged.push(p);
      }
    });
    state.proveedores = merged;
    state.nextId = Math.max(...merged.map(p => p.id || 0), ...nomina.map(e => e.id || 0)) + 1;

    // 4. Empleados
    state.empleados = nomina;

    console.log(`✅ Datos cargados: ${state.proveedores.length} proveedores, ${state.empleados.length} empleados, ${state.proyectos.length} proyectos`);
  } catch (err) {
    console.error('Error cargando datos:', err);
    notify('Error cargando datos iniciales', 'error');
  }

  // 5. Fecha dispersión = hoy
  const fechaDisp = document.getElementById('fecha-disp');
  if (fechaDisp) fechaDisp.value = new Date().toISOString().split('T')[0];

  // 6. Render inicial
  renderProveedores();
  renderCuentaDispSelect();
  renderHeaderBadges();
  refreshProyectosEnSelects();
  renderAuthStatus();

  // 7. Contadores nav
  document.getElementById('cnt-prov').textContent = state.proveedores.length;
  document.getElementById('cnt-nom').textContent = state.empleados.length;
  document.getElementById('cnt-hist').textContent = state.historial.length;

  // 8. Setup modal close handlers
  setupModalCloseHandlers();

  // 9. Check OAuth callback
  checkOAuthCallback();
}

// ===== EXPONER FUNCIONES EN WINDOW =====
// Los onclick="" del HTML necesitan acceso global a estas funciones

// Router
window.showPage = showPage;

// UI
window.cerrar = cerrar;
window.notify = notify;
window.renderHeaderBadges = renderHeaderBadges;
window.renderCuentaDispSelect = renderCuentaDispSelect;
window.updateCuentaGlobal = updateCuentaGlobal;
window.refreshProyectosEnSelects = refreshProyectosEnSelects;

// Proveedores
window.renderProveedores = renderProveedores;
window.abrirNuevoProveedor = abrirNuevoProveedor;
window.editarProv = editarProv;
window.updateTipoProv = updateTipoProv;
window.validarCuentaProv = validarCuentaProv;
window.guardarProveedor = guardarProveedor;
window.exportarCSV = exportarCSV;

// Nómina
window.renderNomina = renderNomina;
window.abrirNuevoEmpleado = abrirNuevoEmpleado;
window.editarEmp = editarEmp;
window.updateTipoEmp = updateTipoEmp;
window.validarCuentaEmp = validarCuentaEmp;
window.guardarEmpleado = guardarEmpleado;
window.exportarNomina = exportarNomina;

// Historial
window.renderHistorial = renderHistorial;
window.exportarHistorial = exportarHistorial;
window.renderModalConf = renderModalConf;
window.toggleAllConf = toggleAllConf;
window.abrirModalConfirmarPagos = abrirModalConfirmarPagos;
window.confirmarPagos = confirmarPagos;

// Dispersión / Cola
window.renderCola = renderCola;
window.abrirPagoRapido = abrirPagoRapido;
window.abrirModalPago = abrirModalPago;
window.buscarModal = buscarModal;
window.selPago = selPago;
window.agregarACola = agregarACola;
window.abrirModalNominaDisp = abrirModalNominaDisp;
window.filtrarNomDisp = filtrarNomDisp;
window.agregarNominaACola = agregarNominaACola;
window.qDel = qDel;
window.limpiarCola = limpiarCola;
window.buscarRapido = buscarRapido;
window.quickAdd = quickAdd;
window.generarArchivo = generarArchivo;
window.abrirModalDispersion = abrirModalDispersion;
window.renderModalDisp = renderModalDisp;
window.toggleAllDisp = toggleAllDisp;
window.generarExcelBBVA = generarExcelBBVA;
window.enviarADispersion = enviarADispersion;

// Solicitudes
window.handleSolDrop = handleSolDrop;
window.handleSolFile = handleSolFile;
window.descargarPlantilla = descargarPlantilla;
window.renderSolicitudes = renderSolicitudes;
window.toggleSol = toggleSol;
window.seleccionarTodosSol = seleccionarTodosSol;
window.nuevaSolicitud = nuevaSolicitud;
window.abrirVincular = abrirVincular;
window.renderVincBusqueda = renderVincBusqueda;
window.seleccionarProvExistente = seleccionarProvExistente;
window.renderVincTipo = renderVincTipo;
window.validarVincCuenta = validarVincCuenta;
window.confirmarNuevoProv = confirmarNuevoProv;

// Config / Proyectos
window.calcularClabeProy = calcularClabeProy;
window.selColor = selColor;
window.abrirModalProyecto = abrirModalProyecto;
window.guardarProyecto = guardarProyecto;
window.toggleProyecto = toggleProyecto;
window.renderConfigProyectos = renderConfigProyectos;

// Google Sheets
window.gsLogin = gsLogin;
window.gsLogout = gsLogout;
window.gsLoadAll = gsLoadAll;
window.gsSaveProveedores = gsSaveProveedores;
window.gsSaveEmpleados = gsSaveEmpleados;
window.gsSaveProyectos = gsSaveProyectos;

// State references for inline onclick in rendered HTML
// (e.g., dispPagos[i].seleccionado, pendientesConfirmacion[i].confirmado)
window.dispPagos = state.dispPagos;
window.pendientesConfirmacion = state.pendientesConfirmacion;

// Keep window references in sync when arrays are replaced
const origPush = Array.prototype.push;
Object.defineProperty(state, 'dispPagos', {
  get() { return window.dispPagos; },
  set(v) { window.dispPagos = v; }
});
Object.defineProperty(state, 'pendientesConfirmacion', {
  get() { return window.pendientesConfirmacion; },
  set(v) { window.pendientesConfirmacion = v; }
});

// ===== GO =====
init();

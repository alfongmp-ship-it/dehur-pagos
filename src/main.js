// ===== MAIN.JS — Entry Point =====
// Carga datos, inicializa estado, renderiza UI, expone funciones en window

import { state } from './state.js';
import { loadProyectos } from './config/proyectos.js';
import { showPage } from './router.js';
import { setupModalCloseHandlers, cerrar } from './ui/modal.js';
import { notify } from './ui/notify.js';
import { renderHeaderBadges, renderCuentaDispSelect, actualizarDisplaySaldo } from './ui/header.js';
import { refreshProyectosEnSelects } from './ui/nav.js';
import { renderProveedores, abrirNuevoProveedor, editarProv, validarCuentaProv, guardarProveedor, exportarCSV, toggleSubcat, toggleSinCuenta } from './modules/proveedores.js';
import { renderNomina, abrirNuevoEmpleado, editarEmp, updateTipoEmp, validarCuentaEmp, guardarEmpleado, exportarNomina } from './modules/nomina.js';
import { renderHistorial, exportarHistorial, eliminarHistorial, eliminarHistorialBulk, toggleHistSel, toggleHistSelAll, editarPartidaPago, abrirCambiarPartidaBulk, aplicarCambiarPartida, actualizarSubpartidaCambiar } from './modules/historial.js';
import { abrirImportHistorial, descargarPlantillaHistorial } from './modules/historial-import.js';
import { abrirImportProveedores } from './modules/proveedores-import.js';
import { abrirImportEmpleados } from './modules/empleados-import.js';
import { abrirImportTraspasos } from './modules/traspasos-import.js';
import { excelImportConfirmar, excelImportCerrar, excelImportHandleDrop, excelImportHandleFile, excelImportDescargarPlantilla, excelImportRefreshTotales } from './services/excel-import.js';
import { initAuthGate, setupAuthListener, handleLoginSubmit, handleLogout, toggleUserMenu } from './services/auth-gate.js';
import { renderConfirmarPagos, toggleConfPago, toggleAllConf, confirmarPagos, eliminarPendiente } from './modules/confirmar-pagos.js';
import { renderCola, abrirPagoRapido, abrirModalPago, buscarModal, selPago, agregarACola, confirmarPagoDirecto, checkCuentaOrigenPago, abrirModalNominaDisp, filtrarNomDisp, agregarNominaACola, qDel, limpiarCola, buscarRapido, quickAdd, generarArchivo, togglePagoSubPartida } from './modules/dispersion.js';
import { handleSolDrop, handleSolFile, descargarPlantilla, parsearSolicitud, renderSolicitudes, toggleSol, seleccionarTodosSol, nuevaSolicitud, abrirVincular, renderVincBusqueda, seleccionarProvExistente, renderVincTipo, validarVincCuenta, confirmarNuevoProv, enviarACola } from './modules/solicitudes.js';
import { renderFacturas, renderFacturaPagos, abrirNuevaFactura, editarFactura, guardarFactura, filtrarProvFactura, selProvFactura, eliminarPagoFactura } from './modules/facturas.js';
import { renderTraspasos, abrirNuevoTraspaso, editarTraspaso, guardarTraspaso, eliminarTraspaso, actualizarTipoDetectado, togglePartidaTraspaso } from './modules/traspasos.js';
import { renderResumenTraspasos, filtrarResumen } from './modules/resumen-traspasos.js';
import { calcularClabeProy, selColor, abrirModalProyecto, guardarProyecto, toggleProyecto, renderConfigProyectos } from './modules/config-page.js';
import { renderConfigPartidas, abrirModalPartida, guardarPartidaCatalogo, togglePartidaCatalogo, eliminarPartidaCatalogo, agregarSubpartidaTmp, eliminarSubpartidaTmp, moverSubpartida, previewLimpiarCatalogo, confirmarLimpiarCatalogo, previewReclasificarHistorial, confirmarReclasificarHistorial } from './modules/config-partidas.js';
import { renderConfigPartidasObra, filtrarPartidasObra, abrirModalPartidaObra, guardarPartidaObra, togglePartidaObra, eliminarPartidaObra, actualizarSubpartidaAdminOptions } from './modules/config-partidas-obra.js';
import { descargarPlantillaPresupuesto, handleSubirPlantillaPresupuesto } from './modules/presupuesto-bulk.js';
import { renderCuentasPropias, abrirNuevaCuenta, editarCuenta, editarCuentaProyecto, guardarCuenta, actualizarSaldoCuenta, guardarSaldoCuenta, actualizarSaldoExtra } from './modules/cuentas-propias.js';
import { renderPosicionSaldos } from './modules/posicion-saldos.js';
import { renderResumenCostos } from './modules/resumen-costos.js';
import { renderFlujoSalida, fsAbrirDetalle, fsCerrarDetalle } from './modules/flujo-salida.js';
import { renderResumenEjecutivo } from './modules/resumen-ejecutivo.js';
import { renderCostosFiscales, abrirNuevaUnidad, editarUnidad, guardarUnidad, toggleUnidad, abrirLoteUnidades, guardarLoteUnidades, cfLimpiarHuerfanas, abrirAsignarCosto, reasignarCosto, eliminarAsignacionCosto, cfCambiarMetodo, cfPreviewReparto, cfRepartirResto, cfFiltrarUnidades, cfSelTodas, cfFiltrarPendientes, cfFiltrarAsignados, guardarAsignacionCosto, cfAgregarPartidaPresup, guardarPresupuestoUnidad, cfVerUnidad } from './modules/costos-fiscales.js';
import { renderCreditos, seleccionarCredito, abrirNuevoCredito, editarCredito, guardarCredito, abrirNuevaDisposicion, guardarDisposicion, editarPagare, togglePagare, abrirNuevaFechaPago, editarFechaPago, guardarFechaPago, marcarPagoPagado, eliminarPagoPagare } from './modules/creditos.js';
import { gsLogin, gsLogout, renderAuthStatus, checkOAuthCallback } from './services/google-auth.js';
import { gsLoadAll, gsSaveProveedores, gsSaveEmpleados, gsSaveProyectos, gsSaveAlias, gsSaveCuentasPropias, gsSaveTraspasos, gsSaveCreditos, gsSavePagares, gsSavePagosPagare, gsSaveMovimientosInternos, migrarTodoASupabase, cargarDatos } from './services/google-sync.js';

// ===== INICIALIZACIÓN =====
async function init() {
  // 1. Cargar proyectos desde localStorage (o seed)
  state.proyectos = loadProyectos();

  // 2. Fetch datos JSON en paralelo
  try {
    const [nomRes] = await Promise.all([
      fetch('./data/nomina-seed.json')
    ]);
    const nomina = await nomRes.json();

    // 3. Proveedores: vacío hasta conectar Google Sheets
    state.proveedores = [];
    state.nextId = Math.max(...nomina.map(e => e.id || 0)) + 1;

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

  // Restaurar preferencia del límite de caracteres del archivo BBVA
  const bbvaMaxInput = document.getElementById('bbva-concepto-max');
  if (bbvaMaxInput) {
    const saved = parseInt(localStorage.getItem('bbva-concepto-max'), 10);
    if (Number.isFinite(saved) && saved >= 20 && saved <= 200) bbvaMaxInput.value = String(saved);
  }

  // 6. Render inicial
  renderProveedores();
  renderCuentaDispSelect();
  renderHeaderBadges();
  refreshProyectosEnSelects();
  renderAuthStatus();
  renderConfigPartidas();
  renderConfigPartidasObra();

  // 7. Contadores nav
  document.getElementById('cnt-prov').textContent = state.proveedores.length;
  document.getElementById('cnt-nom').textContent = state.empleados.length;
  document.getElementById('cnt-hist').textContent = state.historial.length;
  document.getElementById('cnt-cp').textContent = state.cuentasPropias.length;

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
window.actualizarDisplaySaldo = actualizarDisplaySaldo;
window.refreshProyectosEnSelects = refreshProyectosEnSelects;

// Proveedores
window.renderProveedores = renderProveedores;
window.abrirNuevoProveedor = abrirNuevoProveedor;
window.editarProv = editarProv;

window.validarCuentaProv = validarCuentaProv;
window.guardarProveedor = guardarProveedor;
window.exportarCSV = exportarCSV;
window.toggleSubcat = toggleSubcat;
window.toggleSinCuenta = toggleSinCuenta;

// Nómina
window.renderNomina = renderNomina;
window.abrirNuevoEmpleado = abrirNuevoEmpleado;
window.editarEmp = editarEmp;
window.updateTipoEmp = updateTipoEmp;
window.validarCuentaEmp = validarCuentaEmp;
window.guardarEmpleado = guardarEmpleado;
window.exportarNomina = exportarNomina;

// Facturas
window.renderFacturas = renderFacturas;
window.renderFacturaPagos = renderFacturaPagos;
window.abrirNuevaFactura = abrirNuevaFactura;
window.editarFactura = editarFactura;
window.guardarFactura = guardarFactura;
window.filtrarProvFactura = filtrarProvFactura;
window.selProvFactura = selProvFactura;
window.eliminarPagoFactura = eliminarPagoFactura;

// Traspasos y Préstamos
window.renderTraspasos = renderTraspasos;
window.abrirNuevoTraspaso = abrirNuevoTraspaso;
window.editarTraspaso = editarTraspaso;
window.guardarTraspaso = guardarTraspaso;
window.eliminarTraspaso = eliminarTraspaso;
window.actualizarTipoDetectado = actualizarTipoDetectado;
window.togglePartidaTraspaso = togglePartidaTraspaso;
window.renderResumenTraspasos = renderResumenTraspasos;
window.filtrarResumen = filtrarResumen;
window.gsSaveTraspasos = gsSaveTraspasos;

// Historial
window.renderHistorial = renderHistorial;
window.exportarHistorial = exportarHistorial;
window.eliminarHistorial = eliminarHistorial;
window.eliminarHistorialBulk = eliminarHistorialBulk;
window.toggleHistSel = toggleHistSel;
window.toggleHistSelAll = toggleHistSelAll;
window.editarPartidaPago = editarPartidaPago;
window.abrirCambiarPartidaBulk = abrirCambiarPartidaBulk;
window.aplicarCambiarPartida = aplicarCambiarPartida;
window.actualizarSubpartidaCambiar = actualizarSubpartidaCambiar;

// Importar desde Excel (framework generico + abridores por modulo)
window.abrirImportHistorial = abrirImportHistorial;
window.descargarPlantillaHistorial = descargarPlantillaHistorial;
window.abrirImportProveedores = abrirImportProveedores;
window.abrirImportEmpleados = abrirImportEmpleados;
window.abrirImportTraspasos = abrirImportTraspasos;
window.excelImportConfirmar = excelImportConfirmar;
window.excelImportCerrar = excelImportCerrar;
window.excelImportHandleDrop = excelImportHandleDrop;
window.excelImportHandleFile = excelImportHandleFile;
window.excelImportDescargarPlantilla = excelImportDescargarPlantilla;
window.excelImportRefreshTotales = excelImportRefreshTotales;

// Confirmar Pagos
window.renderConfirmarPagos = renderConfirmarPagos;
window.toggleConfPago = toggleConfPago;
window.toggleAllConf = toggleAllConf;
window.confirmarPagos = confirmarPagos;
window.eliminarPendiente = eliminarPendiente;

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
window.confirmarPagoDirecto = confirmarPagoDirecto;
window.checkCuentaOrigenPago = checkCuentaOrigenPago;
window.togglePagoSubPartida = togglePagoSubPartida;
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
window.enviarACola = enviarACola;

// Cuentas Propias
window.renderCuentasPropias = renderCuentasPropias;
window.abrirNuevaCuenta = abrirNuevaCuenta;
window.editarCuenta = editarCuenta;
window.editarCuentaProyecto = editarCuentaProyecto;
window.guardarCuenta = guardarCuenta;
window.gsSaveCuentasPropias = gsSaveCuentasPropias;
window.actualizarSaldoCuenta = actualizarSaldoCuenta;
window.guardarSaldoCuenta = guardarSaldoCuenta;
window.actualizarSaldoExtra = actualizarSaldoExtra;

// Posición de Saldos
window.renderPosicionSaldos = renderPosicionSaldos;

// Resumen de Costos
window.renderResumenCostos = renderResumenCostos;

// Flujo de Salida por Cuenta y Proyecto
window.renderFlujoSalida = renderFlujoSalida;
window.fsAbrirDetalle = fsAbrirDetalle;
window.fsCerrarDetalle = fsCerrarDetalle;

// Resumen Ejecutivo
window.renderResumenEjecutivo = renderResumenEjecutivo;

// Costos Fiscales por Unidad
window.renderCostosFiscales = renderCostosFiscales;
window.abrirNuevaUnidad = abrirNuevaUnidad;
window.editarUnidad = editarUnidad;
window.guardarUnidad = guardarUnidad;
window.toggleUnidad = toggleUnidad;
window.abrirLoteUnidades = abrirLoteUnidades;
window.guardarLoteUnidades = guardarLoteUnidades;
window.cfLimpiarHuerfanas = cfLimpiarHuerfanas;
window.abrirAsignarCosto = abrirAsignarCosto;
window.reasignarCosto = reasignarCosto;
window.eliminarAsignacionCosto = eliminarAsignacionCosto;
window.cfCambiarMetodo = cfCambiarMetodo;
window.cfPreviewReparto = cfPreviewReparto;
window.cfRepartirResto = cfRepartirResto;
window.cfFiltrarUnidades = cfFiltrarUnidades;
window.cfSelTodas = cfSelTodas;
window.cfFiltrarPendientes = cfFiltrarPendientes;
window.cfFiltrarAsignados = cfFiltrarAsignados;
window.guardarAsignacionCosto = guardarAsignacionCosto;
window.cfAgregarPartidaPresup = cfAgregarPartidaPresup;
window.guardarPresupuestoUnidad = guardarPresupuestoUnidad;
window.cfVerUnidad = cfVerUnidad;

// Créditos
window.renderCreditos = renderCreditos;
window.seleccionarCredito = seleccionarCredito;
window.abrirNuevoCredito = abrirNuevoCredito;
window.editarCredito = editarCredito;
window.guardarCredito = guardarCredito;
window.abrirNuevaDisposicion = abrirNuevaDisposicion;
window.guardarDisposicion = guardarDisposicion;
window.editarPagare = editarPagare;
window.togglePagare = togglePagare;
window.abrirNuevaFechaPago = abrirNuevaFechaPago;
window.editarFechaPago = editarFechaPago;
window.guardarFechaPago = guardarFechaPago;
window.marcarPagoPagado = marcarPagoPagado;
window.eliminarPagoPagare = eliminarPagoPagare;
window.gsSaveCreditos = gsSaveCreditos;
window.gsSavePagares = gsSavePagares;
window.gsSavePagosPagare = gsSavePagosPagare;

// Config / Proyectos
window.calcularClabeProy = calcularClabeProy;
window.selColor = selColor;
window.abrirModalProyecto = abrirModalProyecto;
window.guardarProyecto = guardarProyecto;
window.toggleProyecto = toggleProyecto;
window.renderConfigProyectos = renderConfigProyectos;

// Catálogo de Partidas
window.renderConfigPartidas = renderConfigPartidas;
window.abrirModalPartida = abrirModalPartida;
window.guardarPartidaCatalogo = guardarPartidaCatalogo;
window.togglePartidaCatalogo = togglePartidaCatalogo;
window.eliminarPartidaCatalogo = eliminarPartidaCatalogo;
window.agregarSubpartidaTmp = agregarSubpartidaTmp;
window.eliminarSubpartidaTmp = eliminarSubpartidaTmp;
window.moverSubpartida = moverSubpartida;
window.previewLimpiarCatalogo = previewLimpiarCatalogo;
window.confirmarLimpiarCatalogo = confirmarLimpiarCatalogo;
window.previewReclasificarHistorial = previewReclasificarHistorial;
window.confirmarReclasificarHistorial = confirmarReclasificarHistorial;

// Catálogo de Partidas de Obra
window.renderConfigPartidasObra = renderConfigPartidasObra;
window.filtrarPartidasObra = filtrarPartidasObra;
window.abrirModalPartidaObra = abrirModalPartidaObra;
window.guardarPartidaObra = guardarPartidaObra;
window.togglePartidaObra = togglePartidaObra;
window.eliminarPartidaObra = eliminarPartidaObra;
window.actualizarSubpartidaAdminOptions = actualizarSubpartidaAdminOptions;

// Captura masiva de presupuesto (Excel)
window.descargarPlantillaPresupuesto = descargarPlantillaPresupuesto;
window.handleSubirPlantillaPresupuesto = handleSubirPlantillaPresupuesto;

// Google Sheets
window.gsLogin = gsLogin;
window.gsLogout = gsLogout;
window.gsLoadAll = gsLoadAll;
window.gsSaveProveedores = gsSaveProveedores;
window.gsSaveEmpleados = gsSaveEmpleados;
window.gsSaveProyectos = gsSaveProyectos;
window.gsSaveAlias = gsSaveAlias;

// Migración / espejo a Supabase (Etapa B — Fase 1)
window.migrarTodoASupabase = migrarTodoASupabase;
// Refrescar datos desde la FUENTE ACTIVA (Supabase en Fase 2; Sheets si se
// revierte la bandera FUENTE_LECTURA). Sirve para ver lo último (multiusuario).
window.refrescarDatos = async function refrescarDatos() {
  notify('Refrescando datos...');
  const fuente = await cargarDatos();
  notify(`✓ Actualizado desde ${fuente === 'supabase' ? 'Supabase' : 'Sheets'}: ${state.historial.length} pagos · ${state.proveedores.length} proveedores`, 'success');
};

// State references for inline onclick in rendered HTML
window.pendientesConfirmacion = state.pendientesConfirmacion;
Object.defineProperty(state, 'pendientesConfirmacion', {
  get() { return window.pendientesConfirmacion; },
  set(v) { window.pendientesConfirmacion = v; }
});

// ===== GO =====
// Etapa A de Fase 0: gate de auth Supabase delante de la app.
// 1) Inicializa el listener de cambios de sesion.
// 2) Llama initAuthGate, que muestra login si no hay sesion valida o
//    arranca init() de la app si si la hay.
// 3) Tras login exitoso (manejado por setupAuthListener), corre init() tambien.
//
// init() sigue siendo el bootstrap actual que carga datos seed y maneja
// Google Sheets aparte. NO hemos migrado data todavia — eso es Etapa B+.
let _initDone = false;
async function bootstrapApp() {
  if (_initDone) return;
  _initDone = true;
  await init();
  // Fase 2/3c: cargar datos desde la fuente activa (Supabase) al iniciar sesión,
  // SIN depender de conectar Google. Así los testers ven los datos al entrar.
  // cargarDatos tiene su propio manejo de errores (fallback a Sheets).
  try { await cargarDatos(); } catch (e) { console.error('cargarDatos en bootstrap falló:', e); }
}
setupAuthListener(bootstrapApp);
initAuthGate(bootstrapApp).catch(err => {
  console.error('Auth gate fallo:', err);
});

// Login/logout handlers para el HTML
window.handleLoginSubmit = handleLoginSubmit;
window.handleLogout = handleLogout;
window.toggleUserMenu = toggleUserMenu;

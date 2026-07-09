// ===== MAIN.JS — Entry Point =====
// Carga datos, inicializa estado, renderiza UI, expone funciones en window

import { state, rol } from './state.js';
import { loadProyectos } from './config/proyectos.js';
import { showPage } from './router.js';
import { setupModalCloseHandlers, cerrar } from './ui/modal.js';
import { notify } from './ui/notify.js';
import { renderHeaderBadges, renderCuentaDispSelect, actualizarDisplaySaldo } from './ui/header.js';
import { refreshProyectosEnSelects } from './ui/nav.js';
import { renderProveedores, abrirNuevoProveedor, editarProv, validarCuentaProv, guardarProveedor, exportarCSV, toggleSubcat, toggleSinCuenta } from './modules/proveedores.js';
import { renderNomina, abrirNuevoEmpleado, editarEmp, updateTipoEmp, validarCuentaEmp, guardarEmpleado, exportarNomina } from './modules/nomina.js';
import { renderHistorial, exportarHistorial, eliminarHistorial, eliminarHistorialBulk, toggleHistSel, toggleHistSelAll, editarPartidaPago, abrirCambiarPartidaBulk, aplicarCambiarPartida, actualizarSubpartidaCambiar, cpFiltrarProv, cpSelProv } from './modules/historial.js';
import { abrirImportHistorial, descargarPlantillaHistorial } from './modules/historial-import.js';
import { abrirImportProveedores } from './modules/proveedores-import.js';
import { abrirImportEmpleados } from './modules/empleados-import.js';
import { abrirImportTraspasos } from './modules/traspasos-import.js';
import { abrirImportFacturas, descargarPlantillaFacturas } from './modules/facturas-import.js';
import { excelImportConfirmar, excelImportCerrar, excelImportHandleDrop, excelImportHandleFile, excelImportDescargarPlantilla, excelImportRefreshTotales } from './services/excel-import.js';
import { initAuthGate, setupAuthListener, handleLoginSubmit, handleLogout, toggleUserMenu } from './services/auth-gate.js';
import { fetchMantenimiento, setMantenimiento } from './services/supabase.js';
import { renderConfirmarPagos, toggleConfPago, toggleAllConf, confirmarPagos, eliminarPendiente } from './modules/confirmar-pagos.js';
import { renderCola, abrirPagoRapido, abrirModalPago, buscarModal, selPago, agregarACola, confirmarPagoDirecto, checkCuentaOrigenPago, abrirModalNominaDisp, filtrarNomDisp, agregarNominaACola, qDel, limpiarCola, buscarRapido, quickAdd, generarArchivo, togglePagoSubPartida } from './modules/dispersion.js';
import { handleSolDrop, handleSolFile, descargarPlantilla, parsearSolicitud, renderSolicitudes, toggleSol, seleccionarTodosSol, nuevaSolicitud, abrirVincular, renderVincBusqueda, seleccionarProvExistente, renderVincTipo, validarVincCuenta, confirmarNuevoProv, enviarACola } from './modules/solicitudes.js';
import { renderFacturas, renderFacturaPagos, abrirNuevaFactura, editarFactura, abrirDetalleFactura, guardarFactura, filtrarProvFactura, selProvFactura, eliminarPagoFactura, abrirBuscadorPagosFactura, filtrarPagosParaFactura, vincularPagoAFactura, recalcularTotalFactura, eliminarFactura, exportarFacturasExcel } from './modules/facturas.js';
import { renderTraspasos, abrirNuevoTraspaso, editarTraspaso, guardarTraspaso, eliminarTraspaso, actualizarTipoDetectado, togglePartidaTraspaso, sincronizarAportacionesATraspasos } from './modules/traspasos.js';
import { renderResumenTraspasos, filtrarResumen } from './modules/resumen-traspasos.js';
import { calcularClabeProy, selColor, abrirModalProyecto, guardarProyecto, toggleProyecto, renderConfigProyectos } from './modules/config-page.js';
import { renderConfigPartidas, abrirModalPartida, guardarPartidaCatalogo, togglePartidaCatalogo, eliminarPartidaCatalogo, agregarSubpartidaTmp, eliminarSubpartidaTmp, moverSubpartida, previewLimpiarCatalogo, confirmarLimpiarCatalogo, previewReclasificarHistorial, confirmarReclasificarHistorial } from './modules/config-partidas.js';
import { renderConfigPartidasObra, filtrarPartidasObra, abrirModalPartidaObra, guardarPartidaObra, togglePartidaObra, eliminarPartidaObra, actualizarSubpartidaAdminOptions } from './modules/config-partidas-obra.js';
import { descargarPlantillaPresupuesto, handleSubirPlantillaPresupuesto } from './modules/presupuesto-bulk.js';
import { renderCuentasPropias, abrirNuevaCuenta, editarCuenta, editarCuentaProyecto, guardarCuenta, actualizarSaldoCuenta, guardarSaldoCuenta, actualizarSaldoExtra } from './modules/cuentas-propias.js';
import { renderPosicionSaldos } from './modules/posicion-saldos.js';
import { renderResumenCostos, abrirReporteJuanPablo, generarReporteJuanPablo } from './modules/resumen-costos.js';
import { renderFlujoSalida, fsAbrirDetalle, fsCerrarDetalle } from './modules/flujo-salida.js';
import { renderResumenEjecutivo } from './modules/resumen-ejecutivo.js';
import { renderCostosFiscales, abrirNuevaUnidad, editarUnidad, guardarUnidad, toggleUnidad, setFechaTermino, abrirLoteUnidades, guardarLoteUnidades, cfLimpiarHuerfanas, abrirAsignarCosto, reasignarCosto, eliminarAsignacionCosto, cfCambiarMetodo, cfPreviewReparto, cfRepartirResto, cfRepartirRestoIndiviso, cfCustomSetModo, cfFiltrarUnidades, cfSelTodas, cfFiltrarPendientes, cfFiltrarAsignados, guardarAsignacionCosto, cfAgregarPartidaPresup, guardarPresupuestoUnidad, cfVerUnidad, abrirRepartirFactura, cfLimpiarRepartoFactura, cfFacturaPartidaChange, cfToggleEstimado } from './modules/costos-fiscales.js';
import { renderCreditos, seleccionarCredito, abrirNuevoCredito, editarCredito, guardarCredito, abrirNuevaDisposicion, guardarDisposicion, editarPagare, togglePagare, abrirNuevaFechaPago, editarFechaPago, guardarFechaPago, marcarPagoPagado, eliminarPagoPagare } from './modules/creditos.js';
import { initIngresosUI, setWorkspace, renderClientes, renderVentas, renderCobros, renderEstadoCuenta, abrirNuevoCliente, editarCliente, guardarCliente, eliminarCliente, abrirNuevaVenta, editarVenta, guardarVenta, eliminarVenta, vPoblarUnidades } from './modules/ingresos.js';
import { gsLogin, gsLogout, renderAuthStatus, checkOAuthCallback } from './services/google-auth.js';
import { iniciarChequeoVersion } from './services/version-check.js';
import { gsLoadAll, gsSaveProveedores, gsSaveEmpleados, gsSaveProyectos, gsSaveAlias, gsSaveCuentasPropias, gsSaveTraspasos, gsSaveCreditos, gsSavePagares, gsSavePagosPagare, gsSaveMovimientosInternos, migrarTodoASupabase, respaldarTodoASheets, cargarDatos, REALTIME_ON } from './services/google-sync.js';
import { iniciarRealtime } from './services/realtime.js';

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

  // 10. Aviso de "versión nueva" (evita depender de Ctrl+Shift+R)
  iniciarChequeoVersion();
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
window.abrirDetalleFactura = abrirDetalleFactura;
window.guardarFactura = guardarFactura;
window.filtrarProvFactura = filtrarProvFactura;
window.selProvFactura = selProvFactura;
window.eliminarPagoFactura = eliminarPagoFactura;
window.abrirBuscadorPagosFactura = abrirBuscadorPagosFactura;
window.filtrarPagosParaFactura = filtrarPagosParaFactura;
window.vincularPagoAFactura = vincularPagoAFactura;
window.recalcularTotalFactura = recalcularTotalFactura;
window.eliminarFactura = eliminarFactura;
window.exportarFacturasExcel = exportarFacturasExcel;

// Traspasos y Préstamos
window.renderTraspasos = renderTraspasos;
window.abrirNuevoTraspaso = abrirNuevoTraspaso;
window.editarTraspaso = editarTraspaso;
window.guardarTraspaso = guardarTraspaso;
window.eliminarTraspaso = eliminarTraspaso;
window.actualizarTipoDetectado = actualizarTipoDetectado;
window.togglePartidaTraspaso = togglePartidaTraspaso;
window.renderResumenTraspasos = renderResumenTraspasos;
window.sincronizarAportacionesATraspasos = sincronizarAportacionesATraspasos;
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
window.cpFiltrarProv = cpFiltrarProv;
window.cpSelProv = cpSelProv;

// Importar desde Excel (framework generico + abridores por modulo)
window.abrirImportHistorial = abrirImportHistorial;
window.descargarPlantillaHistorial = descargarPlantillaHistorial;
window.abrirImportProveedores = abrirImportProveedores;
window.abrirImportEmpleados = abrirImportEmpleados;
window.abrirImportTraspasos = abrirImportTraspasos;
window.abrirImportFacturas = abrirImportFacturas;
window.descargarPlantillaFacturas = descargarPlantillaFacturas;
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
window.abrirReporteJuanPablo = abrirReporteJuanPablo;
window.generarReporteJuanPablo = generarReporteJuanPablo;

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
window.setFechaTermino = setFechaTermino;
window.abrirLoteUnidades = abrirLoteUnidades;
window.guardarLoteUnidades = guardarLoteUnidades;
window.cfLimpiarHuerfanas = cfLimpiarHuerfanas;
window.abrirAsignarCosto = abrirAsignarCosto;
window.reasignarCosto = reasignarCosto;
window.eliminarAsignacionCosto = eliminarAsignacionCosto;
window.cfCambiarMetodo = cfCambiarMetodo;
window.cfPreviewReparto = cfPreviewReparto;
window.cfRepartirResto = cfRepartirResto;
window.cfRepartirRestoIndiviso = cfRepartirRestoIndiviso;
window.cfCustomSetModo = cfCustomSetModo;
window.cfFiltrarUnidades = cfFiltrarUnidades;
window.cfSelTodas = cfSelTodas;
window.cfFiltrarPendientes = cfFiltrarPendientes;
window.cfFiltrarAsignados = cfFiltrarAsignados;
window.guardarAsignacionCosto = guardarAsignacionCosto;
window.abrirRepartirFactura = abrirRepartirFactura;
window.cfLimpiarRepartoFactura = cfLimpiarRepartoFactura;
window.cfToggleEstimado = cfToggleEstimado;
window.cfFacturaPartidaChange = cfFacturaPartidaChange;
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

// Ingresos (Fase 1)
window.setWorkspace = setWorkspace;
window.renderClientes = renderClientes;
window.renderVentas = renderVentas;
window.renderCobros = renderCobros;
window.renderEstadoCuenta = renderEstadoCuenta;
window.abrirNuevoCliente = abrirNuevoCliente;
window.editarCliente = editarCliente;
window.guardarCliente = guardarCliente;
window.eliminarCliente = eliminarCliente;
window.abrirNuevaVenta = abrirNuevaVenta;
window.editarVenta = editarVenta;
window.guardarVenta = guardarVenta;
window.eliminarVenta = eliminarVenta;
window.vPoblarUnidades = vPoblarUnidades;

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
window.respaldarTodoASheets = respaldarTodoASheets;
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
  // Etapa 2: aplica el rol a la UI (oculta acciones que el rol no permite).
  aplicarPermisosUI();
  // INGRESOS (Fase 1): inyecta el switcher Pagos|Ingresos SOLO si el módulo está
  // activo (INGRESOS_ON + vista previa ?ingresos=1). Si no, no toca nada.
  try { initIngresosUI(); } catch (e) { console.error('initIngresosUI falló:', e); }
  // Fase 3: suscripciones en vivo (solo si REALTIME_ON). Tras cargar los datos,
  // para que las suscripciones se monten sobre el estado ya inicializado.
  if (REALTIME_ON) { try { await iniciarRealtime(); } catch (e) { console.error('iniciarRealtime falló:', e); } }
  iniciarMantenimiento();
}
setupAuthListener(bootstrapApp);
initAuthGate(bootstrapApp).catch(err => {
  console.error('Auth gate fallo:', err);
});

// Login/logout handlers para el HTML
window.handleLoginSubmit = handleLoginSubmit;
window.handleLogout = handleLogout;
window.toggleUserMenu = toggleUserMenu;

// ===== Permisos por rol en la UI (Etapa 2) =====
// Pone el rol en <body data-rol="..."> para que el CSS oculte las acciones que
// el rol no permite (.req-editor para capturar/editar; .req-admin para bulk/config).
// El bloqueo REAL está en los handlers + el backstop de guardado; esto es UX.
function aplicarPermisosUI() {
  document.body.dataset.rol = rol();
  // El rol 'obra' (residente) solo ve Facturas / Pagos a Facturas / Costos por Unidad
  // (el CSS oculta el resto). Lo mandamos a su página de inicio: Costos por Unidad.
  if (rol() === 'obra') {
    showPage('costos-fiscales', document.getElementById('nav-costos-fiscales'));
  }
}
window.aplicarPermisosUI = aplicarPermisosUI;

// ===== Aviso de mantenimiento (banner self-serve) =====
let _mantPollIniciado = false;

// Muestra/oculta el banner (para todos) y el control (solo admin) según el flag.
function renderMantenimientoBanner() {
  const m = state.mantenimiento || { activo: false, msg: '' };
  const banner = document.getElementById('mantenimiento-banner');
  const msgEl = document.getElementById('mantenimiento-banner-msg');
  if (banner) banner.style.display = m.activo ? '' : 'none';
  if (msgEl) msgEl.textContent = m.msg || 'Mantenimiento en curso — por favor no captures nada por ahora.';
  const ctrl = document.getElementById('mantenimiento-control');
  if (ctrl) ctrl.style.display = (state.session && state.session.role === 'admin') ? '' : 'none';
  // Sincroniza los inputs del control, salvo que el admin los esté editando.
  const chk = document.getElementById('mant-activo');
  const inp = document.getElementById('mant-msg');
  if (chk && inp && document.activeElement !== chk && document.activeElement !== inp) {
    chk.checked = !!m.activo;
    inp.value = m.msg || '';
  }
}

// Lee el flag de Supabase y refresca el banner.
async function refrescarMantenimiento() {
  if (!state.session || !state.session.tenantId) return;
  state.mantenimiento = await fetchMantenimiento(state.session.tenantId);
  renderMantenimientoBanner();
}

// Tras login: lee el flag + deja un poll cada 45s para que quien ya está adentro
// vea aparecer/desaparecer el aviso sin recargar.
async function iniciarMantenimiento() {
  await refrescarMantenimiento();
  if (!_mantPollIniciado) {
    _mantPollIniciado = true;
    setInterval(refrescarMantenimiento, 45000);
  }
}

// Botón "Guardar aviso" (solo admin) — prende/apaga el aviso para todos.
window.guardarMantenimiento = async function guardarMantenimiento() {
  if (!state.session || state.session.role !== 'admin') { notify('Solo el admin puede cambiar el aviso', 'error'); return; }
  const activo = !!document.getElementById('mant-activo')?.checked;
  const msg = (document.getElementById('mant-msg')?.value || '').trim();
  try {
    await setMantenimiento(state.session.tenantId, activo, msg);
    state.mantenimiento = { activo, msg };
    renderMantenimientoBanner();
    notify(activo ? '✅ Aviso ACTIVADO — todos lo verán' : '✅ Aviso apagado', 'success');
  } catch (e) {
    notify('No pude guardar el aviso: ' + (e.message || e), 'error');
  }
};

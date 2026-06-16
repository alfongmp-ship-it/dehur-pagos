export const state = {
  proveedores: [],
  empleados: [],
  proyectos: [],
  cola: [],
  historial: [],
  solicitudesData: [],
  dispPagos: [],
  pendientesConfirmacion: [],
  facturas: [],
  facturaPagos: [],
  cuentasPropias: [],
  historialSaldos: [],
  traspasos: [],
  creditos: [],
  pagares: [],
  pagosPagare: [],
  movimientosInternos: [],
  // Costos fiscales por unidad
  unidades: [],
  presupuestoUnidad: [],
  costoAsignaciones: [],
  // Catálogo editable de partidas y subpartidas
  // Cada item: { id, partida, subpartidas: [string], orden, activa }
  partidasCatalogo: [],
  // Catálogo de partidas de OBRA (presupuesto de construcción) — más detallado
  // que el de Admin. Modelo "maestro + ajustes por proyecto": proyecto='' aplica
  // a todos; proyecto con nombre solo aplica a ese.
  // Cada item: { id, nombre, proyecto, partidaAdmin, subPartidaAdmin, orden, activa }
  partidasObra: [],
  nextUnidadId: 1,
  nextPresupuestoId: 1,
  nextAsignacionId: 1,
  histSeq: 1,
  // Blindaje: marca qué entidades se cargaron OK desde Sheets esta sesión.
  // Una entidad no cargada NO se puede guardar (evita sobrescribir con vacío).
  cargado: {},
  creditoTabActivo: null,
  editProvId: null,
  editCuentaId: null,
  editSaldoProy: null,
  editTraspasoId: null,
  editCreditoId: null,
  editUnidadId: null,
  editEmpId: null,
  editProyId: null,
  editFactId: null,
  pagoP: null,
  vincUid: null,
  nextId: 600,
  gsToken: null,
  gsUser: null,
  // Sesion Supabase: { userId, email, tenantId, tenantNombre, role }
  // Se llena al loguearse, null si no hay sesion.
  session: null,
  // Aviso de mantenimiento (flag a nivel tenant, lo prende/apaga el admin).
  mantenimiento: { activo: false, msg: '' },
};

export function esConcentradora(nombreCuenta) {
  if (!nombreCuenta) return false;
  const c = state.cuentasPropias.find(x => x.nombre === nombreCuenta);
  return !!(c && c.es_concentradora);
}

// ¿La app ya tiene de dónde mostrar datos? True si hay token de Google (Sheets)
// O una sesión de Supabase con tenant. Reemplaza el viejo candado "!gsToken" en
// las PANTALLAS: ahora un usuario logueado en Supabase ve los datos sin conectar
// Google. (Guardar sigue requiriendo Google — eso NO usa este helper.)
export function datosListos() {
  return !!state.gsToken || !!(state.session && state.session.tenantId);
}

// ===== Roles / permisos (Etapa 2 — gating en cliente) =====
// Default 'solo_lectura' por seguridad: si el rol no cargó, NO se puede escribir.
// Solo admin y capturista mueven cosas; contabilidad/lector/solo_lectura solo ven.
export function rol() {
  return (state.session && state.session.role) || 'solo_lectura';
}

// Puede capturar / editar / borrar-de-uno / confirmar pagos / actualizar saldos.
export function puedeEditar() {
  const r = rol();
  return r === 'admin' || r === 'capturista';
}

// Solo el admin: borrado EN BLOQUE, configuración (proyectos/partidas/cuentas),
// conectar Google + "Respaldar a Sheets".
export function esAdmin() {
  return rol() === 'admin';
}

// Etiqueta amigable del rol para el badge de usuario.
const ROL_LABEL = {
  admin: 'Admin', capturista: 'Capturista', contabilidad: 'Contabilidad',
  lector: 'Lector', aprobador: 'Aprobador', solo_lectura: 'Solo lectura'
};
export function rolLabel() {
  return ROL_LABEL[rol()] || rol();
}

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
  // ===== MÓDULO INGRESOS (Fase 1 — cartera pura, detrás de INGRESOS_ON) =====
  // Espejo del ciclo de cobro: clientes → ventas por unidad → cobros. Tablas y
  // módulos propios; NO tocan saldos ni nada de Pagos. IDs = UUID (ver abajo).
  clientes: [],
  ventas: [],
  cobros: [],
  // ===== MÓDULO ESTRATEGIA (Fase 2 — solo lectura, detrás de ESTRATEGIA_ON) =====
  // Config del motor de score (clave→valor jsonb, todo supuesto es un parámetro)
  // y flags por unidad (bloqueo/compromiso/estratégica). NO tocan nada de Pagos.
  estrategiaConfig: [],
  estrategiaFlags: [],
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
  editClienteId: null,
  editVentaId: null,
  editCobroId: null,
  editFlagId: null,
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

// ID único global para una asignación de costo (reparto). NO usa un contador local:
// dos navegadores generaban el MISMO número (MAX+1) y el upsert de Supabase se pisaba,
// perdiendo el reparto de una sesión. Un UUID no colisiona entre usuarios ni pestañas.
let _asigSalt = '';
let _asigSeq = 0;
export function nuevoAsignacionId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* fallback abajo */ }
  // Fallback (crypto.randomUUID ausente): sal por sesión + secuencia monótona → único dentro de
  // la sesión y distinto entre pestañas/usuarios aun creando varias asignaciones en el mismo ms.
  if (!_asigSalt) _asigSalt = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return 'a-' + _asigSalt + '-' + (_asigSeq++).toString(36);
}

// ID único global para un enlace pago↔factura (facturaPagos). Mismo motivo que arriba: el
// contador local MAX+1 colisionaba entre sesiones (uno vinculando pagos + otro confirmando
// solicitudes con factura_id) → el upsert pisaba un enlace con otro. Un UUID no colisiona.
export function nuevoFacturaPagoId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* fallback abajo */ }
  if (!_asigSalt) _asigSalt = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return 'fp-' + _asigSalt + '-' + (_asigSeq++).toString(36);
}

// IDs únicos para el módulo INGRESOS (clientes/ventas/cobros). Mismo motivo que
// arriba: un contador local MAX+1 colisiona entre pestañas/usuarios y el upsert
// de Supabase se pisa. UUID no colisiona. Prefijo por entidad solo en el fallback.
function _uuidCon(prefijo) {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* fallback abajo */ }
  if (!_asigSalt) _asigSalt = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return prefijo + _asigSalt + '-' + (_asigSeq++).toString(36);
}
export function nuevoClienteId() { return _uuidCon('cli-'); }
export function nuevoVentaId()   { return _uuidCon('vta-'); }
export function nuevoCobroId()   { return _uuidCon('cob-'); }
// ESTRATEGIA (Fase 2): flags por unidad (bloqueo/compromiso/estratégica).
export function nuevoFlagId()    { return _uuidCon('flg-'); }

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

// Puede crear/editar facturas, vincular pagos a facturas y repartir su devengado.
// Roles dedicados: 'facturas' (Gonzalo, ve toda la app) y 'facturas_obra' (Anahi,
// mismos poderes con el menú acotado a Facturas/Pagos a Facturas/Costos por Unidad),
// además de los que ya editan. 'contabilidad' (Ericka) queda solo-ver.
export function puedeFacturas() {
  const r = rol();
  return r === 'admin' || r === 'capturista' || r === 'facturas' || r === 'facturas_obra';
}

// Borrar facturas (corregir errores): solo admin y los roles de facturas.
// Capturista NO — es una acción destructiva acotada a quienes manejan facturas.
export function puedeBorrarFacturas() {
  const r = rol();
  return r === 'admin' || r === 'facturas' || r === 'facturas_obra';
}

// Solo el admin: borrado EN BLOQUE, configuración (proyectos/partidas/cuentas),
// conectar Google + "Respaldar a Sheets".
export function esAdmin() {
  return rol() === 'admin';
}

// Etiqueta amigable del rol para el badge de usuario.
const ROL_LABEL = {
  admin: 'Admin', capturista: 'Capturista', contabilidad: 'Contabilidad',
  lector: 'Lector', aprobador: 'Aprobador', solo_lectura: 'Solo lectura',
  facturas: 'Facturas', obra: 'Obra', facturas_obra: 'Facturas (obra)'
};
export function rolLabel() {
  return ROL_LABEL[rol()] || rol();
}

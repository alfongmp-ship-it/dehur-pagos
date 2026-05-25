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
  // Cada item: { id, nombre, proyecto, subPartidaAdmin, orden, activa }
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
};

export function esConcentradora(nombreCuenta) {
  if (!nombreCuenta) return false;
  const c = state.cuentasPropias.find(x => x.nombre === nombreCuenta);
  return !!(c && c.es_concentradora);
}

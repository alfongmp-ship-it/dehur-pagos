import { state, puedeEditar, esAdmin, puedeFacturas, puedeLigarPagos, puedeCapturarObra } from '../state.js';
import { notify } from '../ui/notify.js';
import { gsReadSheet, gsWriteRange, gsClearAndWrite, gsAppendRow } from './google-sheets.js';
import { normalizeBanco } from '../config/bancos.js';
import { SUB_PARTIDAS_CONSTRUCCION } from '../config/sub-partidas.js';
import { sbReplaceTable, sbLoadTable, sbReady, sbUpsertRow, sbDeleteRow } from './supabase-data.js';

// ============================================================================
// BANDERA DE FUENTE DE LECTURA (Fase 2). Controla de dónde lee la app al cargar.
//   'supabase' → lee de Supabase (con fallback automático a Sheets si falla).
//   'sheets'   → lee de Sheets (comportamiento original).
// Para REVERTIR el flip: cambiar a 'sheets' y hacer push. Los GUARDADOS no
// cambian (siguen escribiendo a Sheets + Supabase).
// ============================================================================
export const FUENTE_LECTURA = 'supabase';

// ============================================================================
// FASE 3 (tiempo real) — banderas REVERSIBLES. Para revertir: volver a 'tabla'
// / false y push.
//   MODO_GUARDADO 'tabla'  → guarda reemplazando la tabla completa (como Fase 2).
//                 'fila'   → para las entidades en ENTIDADES_POR_FILA, guarda solo
//                            la fila que cambió (no se pisan + habilita realtime).
//   REALTIME_ON   false    → sin suscripciones (como hoy).
//                 true     → la app se suscribe a los cambios de las tablas en
//                            ENTIDADES_REALTIME y se actualiza sola cuando otro
//                            usuario/pestaña cambia algo.
// PILOTO: solo 'proveedores'. Conforme se valide, se agregan más entidades a los
// Sets (cada una necesita idCol+rowOne en SB_ENTIDADES y estar en la publicación
// supabase_realtime). El resto de entidades sigue en 'tabla' aunque MODO sea 'fila'.
// ============================================================================
export const MODO_GUARDADO = 'fila';
export const ENTIDADES_POR_FILA = new Set(['proveedores', 'empleados', 'partidasCatalogo', 'partidasObra', 'creditos', 'pagares', 'unidades', 'facturas', 'facturaPagos', 'traspasos', 'movimientosInternos', 'proyectos', 'cuentasPropias', 'pagosPagare', 'historial', 'clientes', 'ventas', 'cobros', 'estrategiaConfig', 'estrategiaFlags', 'presupuestoUnidad', 'fiscalMarcas']);
export const REALTIME_ON = true;

// ============================================================================
// MÓDULO INGRESOS (Fase 1 — cartera pura). Bandera maestra REVERSIBLE.
//   false → la app queda IDÉNTICA a hoy: no carga clientes/ventas/cobros, no
//           inyecta el switcher ni el sidebar de Ingresos, no abre realtime.
//   true  → habilita el módulo. Durante la construcción, la UI se mantiene
//           OCULTA a los usuarios reales tras el candado de vista previa
//           (?ingresos=1 en la URL); al terminar se retira ese candado.
// Ingresos vive en tablas/módulos propios y NO toca saldos ni nada de Pagos.
// ============================================================================
export const INGRESOS_ON = true;

// Candado de VISTA PREVIA (solo mientras se construye Ingresos): la carga y la UI
// del módulo solo se activan con ?ingresos=1 en la URL (queda sticky en
// localStorage) o dt-ingresos=1. Así los usuarios reales NO pagan carga ni ven
// nada a medio construir. Al lanzar, se elimina este candado y manda solo
// INGRESOS_ON. ?ingresos=0 lo apaga.
export function ingresosPreview() {
  try {
    if (typeof location !== 'undefined' && /[?&]ingresos=1(\b|&|$)/.test(location.search || '')) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('dt-ingresos') === '1') return true;
  } catch (_) { /* sin location/localStorage: no activar */ }
  return false;
}
// LANZADO (2026-07-16): se retiró el candado de vista previa; ahora manda SOLO la
// bandera maestra, así TODO el equipo ve Ingresos (los roles siguen mandando sobre
// qué puede EDITAR cada quien). Para revertir/ocultar a todos: INGRESOS_ON = false.
export function ingresosActivo() { return INGRESOS_ON; }

// ============================================================================
// MÓDULO ESTRATEGIA (Fase 2 — tablero de score, SOLO LECTURA). Bandera maestra
// REVERSIBLE + candado de vista previa ?estrategia=1 (sticky en dt-estrategia;
// ?estrategia=0 lo apaga). Mismo patrón que Ingresos. Estrategia escribe SOLO en
// estrategia_config / estrategia_flags_unidad; todo lo demás lo LEE del state.
// ============================================================================
export const ESTRATEGIA_ON = true;
export function estrategiaPreview() {
  try {
    if (typeof location !== 'undefined' && /[?&]estrategia=1(\b|&|$)/.test(location.search || '')) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('dt-estrategia') === '1') return true;
  } catch (_) { /* sin location/localStorage: no activar */ }
  return false;
}
// LANZADO (2026-07-16): sin candado de vista previa; manda SOLO la bandera maestra.
// Para revertir/ocultar a todos: ESTRATEGIA_ON = false.
export function estrategiaActivo() { return ESTRATEGIA_ON; }

// Los datos de INGRESOS (clientes/ventas/cobros) deben cargar también cuando solo
// Estrategia está activa: el score lee ventas/cobros. Sin esto, Estrategia vería
// arrays vacíos (estaban atrapados tras el candado de Ingresos).
export function ingresosDataActiva() { return ingresosActivo() || estrategiaActivo(); }
// pendientesConfirmacion va aquí pero NO en ENTIDADES_POR_FILA: tabla chica, se
// guarda whole-table; el realtime deja ver la cola compartida en vivo.
export const ENTIDADES_REALTIME = new Set(['proveedores', 'empleados', 'partidasCatalogo', 'partidasObra', 'creditos', 'pagares', 'unidades', 'facturas', 'facturaPagos', 'traspasos', 'movimientosInternos', 'pendientesConfirmacion', 'proyectos', 'cuentasPropias', 'pagosPagare', 'historial', 'presupuestoUnidad', 'costoAsignaciones']);

// INGRESOS (Fase 1): suscribir realtime de clientes/ventas/cobros SOLO si el módulo
// está activo (bandera maestra + vista previa). Con preview off no se agrega ninguna
// clave → 0 canales nuevos → la app queda idéntica para el resto del equipo.
if (ingresosDataActiva()) {
  ENTIDADES_REALTIME.add('clientes');
  ENTIDADES_REALTIME.add('ventas');
  ENTIDADES_REALTIME.add('cobros');
}
// ESTRATEGIA (Fase 2): realtime de config/marcas solo si el módulo está activo.
if (estrategiaActivo()) {
  ENTIDADES_REALTIME.add('estrategiaConfig');
  ENTIDADES_REALTIME.add('estrategiaFlags');
}

// ¿Esta entidad guarda por fila ahora mismo? (modo 'fila' y está en el Set)
export function esPorFila(key) {
  return MODO_GUARDADO === 'fila' && ENTIDADES_POR_FILA.has(key);
}

// Parser local de fecha para sort (DD/MM/YYYY o YYYY-MM-DD → ISO).
function _parseFecha(f) {
  if (!f) return '';
  if (f.includes('-') && f.length >= 10) return f.slice(0, 10);
  const parts = f.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return '';
}

// Ordena state.historial in-place: fecha desc, empate por id desc, inválidas al inicio.
function sortHistorialByFecha() {
  state.historial.sort((a, b) => {
    const isoA = _parseFecha(a.fecha);
    const isoB = _parseFecha(b.fecha);
    const invA = !isoA;
    const invB = !isoB;
    if (invA && !invB) return -1;
    if (!invA && invB) return 1;
    if (isoA !== isoB) return isoB.localeCompare(isoA);
    return (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0);
  });
}

// ===== BLINDAJE CONTRA PÉRDIDA DE DATOS =====
// Entidades con función de guardado que sobrescribe su hoja completa.
const ENTIDADES_GUARDABLES = [
  'proveedores', 'empleados', 'historial', 'proyectos', 'facturas', 'facturaPagos',
  'cuentasPropias', 'traspasos', 'creditos', 'pagares', 'pagosPagare',
  'movimientosInternos', 'pendientesConfirmacion', 'unidades', 'presupuestoUnidad',
  'costoAsignaciones', 'partidasCatalogo', 'partidasObra'
];
const ETIQUETA = {
  proveedores: 'Proveedores', empleados: 'Empleados', historial: 'Historial de pagos',
  proyectos: 'Proyectos', facturas: 'Facturas', facturaPagos: 'Pagos de facturas',
  cuentasPropias: 'Cuentas propias', traspasos: 'Traspasos', creditos: 'Créditos',
  pagares: 'Pagarés', pagosPagare: 'Pagos de pagaré', movimientosInternos: 'Movimientos internos',
  pendientesConfirmacion: 'Pagos por confirmar', unidades: 'Unidades',
  presupuestoUnidad: 'Presupuestos', costoAsignaciones: 'Asignaciones de costo',
  partidasCatalogo: 'Catálogo de partidas',
  partidasObra: 'Catálogo de partidas de obra'
};
// INGRESOS (Fase 1): dar de alta en el blindaje/banner solo si el módulo está activo.
if (ingresosDataActiva()) {
  ENTIDADES_GUARDABLES.push('clientes', 'ventas', 'cobros');
  ETIQUETA.clientes = 'Clientes'; ETIQUETA.ventas = 'Ventas'; ETIQUETA.cobros = 'Cobranza';
}
// ESTRATEGIA (Fase 2): ídem.
if (estrategiaActivo()) {
  ENTIDADES_GUARDABLES.push('estrategiaConfig', 'estrategiaFlags');
  ETIQUETA.estrategiaConfig = 'Configuración de estrategia'; ETIQUETA.estrategiaFlags = 'Marcas de unidades';
}

// Lee una hoja y marca si la entidad cargó con éxito. `gsReadSheet` devuelve
// null SOLO ante error de lectura (una hoja vacía devuelve []), así que null
// marca la entidad como NO cargada y bloquea su guardado esta sesión.
async function leerHoja(sheet, entidad) {
  const rows = await gsReadSheet(sheet);
  state.cargado[entidad] = (rows !== null);
  return rows;
}

// Decide si se permite guardar una entidad. Bloquea si no se cargó esta sesión
// (evita sobrescribir la hoja con datos vacíos por una carga fallida) y pide
// confirmación si el guardado dejaría la hoja sin ningún registro.
function guardarPermitido(entidad, arr, puedeVaciarse = false) {
  if (state.cargado[entidad] !== true) {
    notify(`Guardado bloqueado: "${ETIQUETA[entidad] || entidad}" no se cargó correctamente esta sesión. Recarga la página antes de guardar.`, 'error');
    return false;
  }
  if (!puedeVaciarse && (!arr || arr.length === 0)) {
    return confirm(`Vas a guardar "${ETIQUETA[entidad] || entidad}" SIN NINGÚN registro.\n\nSi no es intencional, presiona Cancelar para no perder datos.\n\n¿Continuar de todos modos?`);
  }
  return true;
}

// Muestra u oculta el banner de advertencia según haya entidades sin cargar.
function actualizarBannerCarga() {
  const banner = document.getElementById('data-warning-banner');
  if (!banner) return;
  const fallos = ENTIDADES_GUARDABLES.filter(e => state.cargado[e] !== true);
  if (fallos.length) {
    banner.textContent = '⚠ No se cargaron correctamente: ' + fallos.map(e => ETIQUETA[e] || e).join(', ')
      + '. Recarga la página y vuelve a conectar. El guardado de esos datos está bloqueado por seguridad para no sobrescribirlos.';
    banner.style.display = '';
  } else {
    banner.style.display = 'none';
  }
}

export async function gsLoadAll() {
  state.cargado = {};
  try {
    // Load proveedores from Sheets (Sheets is source of truth)
    const pRows = await leerHoja('proveedores', 'proveedores');
    if (pRows && pRows.length > 1) {
      const loaded = pRows.slice(1).filter(r => r[0]).map(r => ({
        id: parseInt(r[0]) || 0,
        nombre: r[1] || '',
        rfc: r[2] || '',
        banco: normalizeBanco(r[3] || ''),
        tipo_cuenta: (r[6] || '').replace(/\D/g, '').length === 18 ? 'CLABE' : 'Cuenta',
        cuenta: r[5] || '',
        clabe: r[6] || '',
        categoria: r[7] || '',
        subcategoria: r[8] || '',
        proyectos: (r[9] || '').split('|').filter(Boolean),
        activo: r[10] !== 'FALSE' && r[10] !== 'false',
        bloqueada_para_pago: r[11] === 'TRUE' || r[11] === 'true',
        aliases: []
      }));
      if (loaded.length) {
        state.proveedores = loaded;
        document.getElementById('cnt-prov').textContent = loaded.length;
      }
    } else if (pRows !== null && state.proveedores.length) {
      await gsSaveProveedores();
    }

    // Load pendientes confirmacion
    const pcRows = await leerHoja('pendientes_confirmacion', 'pendientesConfirmacion');
    if (pcRows && pcRows.length > 1) {
      state.pendientesConfirmacion = pcRows.slice(1).filter(r => r[0]).map(r => {
        // Asignación planificada serializada en col 15 (JSON con {a, m}).
        let asignacionesPlanificadas = [], repartoMetodo = null;
        if (r[15]) {
          try {
            const parsed = JSON.parse(r[15]);
            asignacionesPlanificadas = Array.isArray(parsed.a) ? parsed.a : [];
            repartoMetodo = parsed.m || null;
          } catch (e) { /* JSON corrupto: ignorar */ }
        }
        return {
          id: parseInt(r[0]) || Date.now(),
          proveedor_id: r[1] || '',
          factura_id: r[2] || '',
          nombre: r[3] || '',
          cuenta: r[4] || '',
          banco: normalizeBanco(r[5] || ''),
          tipo: r[6] || '',
          concepto: r[7] || '',
          importe: parseFloat(r[8]) || 0,
          proyecto: r[9] || '',
          partida: r[10] || '',
          cuenta_cargo: r[11] || '',
          fechaGen: r[12] || '',
          confirmado: r[13] !== 'false',
          sub_partida: r[14] || '',
          asignacionesPlanificadas,
          repartoMetodo,
          partidaObra: r[16] || ''
        };
      });
    }

    // Load empleados
    const eRows = await leerHoja('empleados', 'empleados');
    if (eRows && eRows.length > 1) {
      state.empleados = eRows.slice(1).filter(r => r[0]).map(r => ({
        id: parseInt(r[0]) || 0,
        nombre: r[1] || '',
        puesto: r[2] || '',
        empresa: r[3] || '',
        banco: r[4] || 'BBVA',
        tipo_cuenta: r[5] || '',
        cuenta: r[6] || '',
        clabe: r[7] || '',
        rfc: r[8] || '',
        activo: r[9] !== 'false'
      }));
    } else if (eRows !== null && state.empleados.length) {
      // Hoja vacía — auto-popular desde JSON seed
      await gsSaveEmpleados();
    }

    // Load historial
    const hRows = await leerHoja('historial_pagos', 'historial');
    if (hRows && hRows.length > 1) {
      state.historial = hRows.slice(1).filter(r => r[0] || r[2]).map(r => ({
        proveedor_id: r[0] || '',
        factura_id: r[1] || '',
        fecha: r[2] || '',
        nombre: r[3] || '',
        banco: normalizeBanco(r[4] || ''),
        tipo: r[5] || '',
        concepto: r[6] || '',
        importe: parseFloat(r[7]) || 0,
        proyecto: r[8] || '',
        cuenta_origen: r[9] || '',
        tipo_registro: r[10] || 'Pago',
        partida: r[11] || '',
        sub_partida: r[12] || '',
        id: r[13] || ''
      }));
      // Backfill de IDs estables para la capa de costos fiscales.
      // Si se asignó algún ID nuevo, se persiste una sola vez (migración idempotente).
      if (ensureHistorialIds()) {
        await gsSaveHistorial();
      }
      // Ordenar por fecha desc (más reciente arriba) tras cargar.
      sortHistorialByFecha();
    }

    // Load proyectos
    const prRows = await leerHoja('proyectos', 'proyectos');
    if (prRows && prRows.length > 1) {
      const loaded = prRows.slice(1).filter(r => r[0]).map(r => ({
        id: r[0] || '',
        nombre: r[1] || '',
        empresa: r[2] || '',
        cuenta: r[3] || '',
        clabe: r[4] || '',
        color: r[5] || '#C8A96E',
        activo: r[6] !== 'false',
        saldo: parseFloat(r[7]) || 0,
        ultima_act_saldo: r[8] || '',
        es_concentradora: String(r[9]).toLowerCase() === 'true'
      }));
      if (loaded.length) state.proyectos = loaded;
    }

    // Load aliases
    const aRows = await gsReadSheet('aliases');
    if (aRows && aRows.length > 1) {
      aRows.slice(1).filter(r => r[0]).forEach(r => {
        const prov = state.proveedores.find(p => p.id === parseInt(r[1]));
        if (prov) {
          if (!prov.aliases) prov.aliases = [];
          if (!prov.aliases.includes(r[0])) prov.aliases.push(r[0]);
        }
      });
    }

    // Load facturas
    const fRows = await leerHoja('facturas', 'facturas');
    if (fRows && fRows.length > 1) {
      state.facturas = fRows.slice(1).filter(r => r[0]).map(r => ({
        factura_id: parseInt(r[0]) || 0,
        numero_factura: r[1] || '',
        razon_social: r[2] || '',
        proveedor_id: parseInt(r[3]) || 0,
        nombre_proveedor: r[4] || '',
        fecha_factura: r[5] || '',
        fecha_vencimiento: r[6] || '',
        fecha_pago_total: r[7] || '',
        monto_total: parseFloat(String(r[8]).replace(/,/g, '')) || 0,
        monto_pagado: parseFloat(String(r[9]).replace(/,/g, '')) || 0,
        saldo_pendiente: (parseFloat(String(r[8]).replace(/,/g, '')) || 0) - (parseFloat(String(r[9]).replace(/,/g, '')) || 0),
        estatus_factura: r[11] || 'pendiente',
        proyecto: r[12] || '',
        observaciones: r[13] || '',
        activo: r[14] !== 'false',
        uuid: r[15] || '',
        // Fase 2: campos fiscales (CFDI), leídos por posición (índices 16-23).
        subtotal: parseFloat(String(r[16]).replace(/,/g, '')) || 0,
        descuento: parseFloat(String(r[17]).replace(/,/g, '')) || 0,
        iva_trasladado: parseFloat(String(r[18]).replace(/,/g, '')) || 0,
        retencion_iva: parseFloat(String(r[19]).replace(/,/g, '')) || 0,
        retencion_isr: parseFloat(String(r[20]).replace(/,/g, '')) || 0,
        rfc_emisor: r[21] || '',
        estado_sat: r[22] || 'Vigente',
        tipo_comprobante: r[23] || 'Factura'
      }));
    }

    // Load cuentas_propias
    const cpRows = await leerHoja('cuentas_propias', 'cuentasPropias');
    if (cpRows && cpRows.length > 1) {
      state.cuentasPropias = cpRows.slice(1).filter(r => r[0]).map(r => ({
        cuenta_id: parseInt(r[0]) || 0,
        nombre: r[1] || '',
        banco: r[2] || '',
        clabe: r[3] || '',
        numero_cuenta: r[4] || '',
        proyecto: r[5] || '',
        tipo: r[6] || 'General',
        saldo: parseFloat(r[7]) || 0,
        ultima_actualizacion: r[8] || '',
        activo: r[9] !== 'false'
      }));
    }

    // Load historial_saldos
    const hsRows = await gsReadSheet('historial_saldos');
    if (hsRows && hsRows.length > 1) {
      state.historialSaldos = hsRows.slice(1).filter(r => r[0]).map(r => ({
        fecha: r[0] || '',
        cuenta_id: r[1] || '',
        cuenta_nombre: r[2] || '',
        cuenta_tipo: r[3] || '',
        saldo: parseFloat(r[4]) || 0,
        saldo_total: parseFloat(r[5]) || 0
      }));
    }

    // Load traspasos
    const tRows = await leerHoja('traspasos', 'traspasos');
    if (tRows && tRows.length > 1) {
      state.traspasos = tRows.slice(1).filter(r => r[0]).map(r => ({
        traspaso_id: parseInt(r[0]) || 0,
        tipo: r[1] || '',
        cuenta_origen_id: r[2] || '',
        cuenta_origen_tipo: r[3] || 'proyecto',
        cuenta_origen_nombre: r[4] || '',
        proyecto_origen: r[5] || '',
        cuenta_destino_id: r[6] || '',
        cuenta_destino_tipo: r[7] || 'proyecto',
        cuenta_destino_nombre: r[8] || '',
        proyecto_destino: r[9] || '',
        monto: parseFloat(r[10]) || 0,
        fecha: r[11] || '',
        concepto: r[12] || '',
        referencia: r[13] || '',
        estatus: r[14] || 'pendiente',
        fecha_registro: r[15] || ''
      }));
    }

    // Load creditos
    const crRows = await leerHoja('creditos', 'creditos');
    if (crRows && crRows.length > 1) {
      state.creditos = crRows.slice(1).filter(r => r[0]).map(r => ({
        credito_id: parseInt(r[0]) || 0,
        nombre: r[1] || '',
        banco: r[2] || '',
        tipo_credito: r[3] || 'Puente',
        monto_autorizado: parseFloat(r[4]) || 0,
        tasa_base: parseFloat(r[5]) || 0,
        proyecto: r[6] || '',
        cuenta_pago: r[7] || '',
        estatus: r[8] || 'Activo',
        activo: r[9] !== 'false'
      }));
    }

    // Load pagares
    const pgRows = await leerHoja('pagares', 'pagares');
    if (pgRows && pgRows.length > 1) {
      state.pagares = pgRows.slice(1).filter(r => r[0]).map(r => ({
        pagare_id: parseInt(r[0]) || 0,
        credito_id: parseInt(r[1]) || 0,
        numero_pagare: r[2] || '',
        monto: parseFloat(r[3]) || 0,
        fecha_disposicion: r[4] || '',
        fecha_vencimiento: r[5] || '',
        tasa: parseFloat(r[6]) || 0,
        estatus: r[7] || 'Vigente',
        activo: r[8] !== 'false'
      }));
    }

    // Load pagos_pagare
    const ppRows = await leerHoja('pagos_pagare', 'pagosPagare');
    if (ppRows && ppRows.length > 1) {
      state.pagosPagare = ppRows.slice(1).filter(r => r[0]).map(r => ({
        pago_id: parseInt(r[0]) || 0,
        pagare_id: parseInt(r[1]) || 0,
        credito_id: parseInt(r[2]) || 0,
        fecha_pago: r[3] || '',
        monto_intereses: parseFloat(r[4]) || 0,
        concepto: r[5] || '',
        estatus: r[6] || 'Pendiente',
        fecha_real_pago: r[7] || ''
      }));
    }

    // Load movimientos_internos
    const miRows = await leerHoja('movimientos_internos', 'movimientosInternos');
    if (miRows && miRows.length > 1) {
      state.movimientosInternos = miRows.slice(1).filter(r => r[0]).map(r => ({
        id: parseInt(r[0]) || 0,
        fecha: r[1] || '',
        tipo: r[2] || '',
        origen: r[3] || '',
        destino: r[4] || '',
        monto: parseFloat(r[5]) || 0,
        concepto: r[6] || '',
        referencia: r[7] || ''
      }));
    }

    // Load factura_pagos
    const fpRows = await leerHoja('factura_pagos', 'facturaPagos');
    if (fpRows && fpRows.length > 1) {
      state.facturaPagos = fpRows.slice(1).filter(r => r[0]).map(r => ({
        factura_pago_id: String(r[0] || ''),
        factura_id: parseInt(r[1]) || 0,
        pago_id: parseInt(r[2]) || 0,
        proveedor_id: parseInt(r[3]) || 0,
        monto_aplicado: parseFloat(r[4]) || 0,
        fecha_pago: r[5] || '',
        estatus: r[6] || '',
        observaciones: r[7] || ''
      }));
    }

    // Load unidades (costos fiscales)
    const uRows = await leerHoja('unidades', 'unidades');
    if (uRows && uRows.length > 1) {
      state.unidades = uRows.slice(1).filter(r => r[0]).map(r => ({
        unidad_id: parseInt(r[0]) || 0,
        proyecto: r[1] || '',
        nombre: r[2] || '',
        tipo: r[3] || '',
        indiviso_pct: parseFloat(r[4]) || 0,
        superficie_m2: parseFloat(r[5]) || 0,
        estatus: r[6] || 'En obra',
        orden: parseInt(r[7]) || 0,
        activo: r[8] !== 'false' && r[8] !== 'FALSE',
        plano_x: (r[9] === undefined || r[9] === '') ? null : parseFloat(r[9]),
        plano_y: (r[10] === undefined || r[10] === '') ? null : parseFloat(r[10]),
        plano_w: (r[11] === undefined || r[11] === '') ? null : parseFloat(r[11]),
        plano_h: (r[12] === undefined || r[12] === '') ? null : parseFloat(r[12]),
        fecha_termino: r[13] || ''
      }));
      state.nextUnidadId = state.unidades.reduce((m, u) => Math.max(m, u.unidad_id), 0) + 1;
    }

    // Load presupuesto_unidad
    const buRows = await leerHoja('presupuesto_unidad', 'presupuestoUnidad');
    if (buRows && buRows.length > 1) {
      state.presupuestoUnidad = buRows.slice(1).filter(r => r[0]).map(r => ({
        presupuesto_id: String(r[0] || ''),   // texto: convive int legacy + UUID nuevo
        unidad_id: parseInt(r[1]) || 0,
        partida: r[2] || '',
        sub_partida: r[3] || '',
        monto_presupuestado: parseFloat(r[4]) || 0,
        costo_inicial: parseFloat(r[5]) || 0,
        notas: r[6] || '',
        avance_fisico: parseFloat(r[7]) || 0
      }));
      // Contador legacy (ya no acuña ids nuevos): solo ids numéricos, para no dar NaN con UUIDs.
      state.nextPresupuestoId = state.presupuestoUnidad.reduce((m, p) => {
        const n = parseInt(p.presupuesto_id);
        return isFinite(n) ? Math.max(m, n) : m;
      }, 0) + 1;
    }

    // Load costo_asignaciones
    const caRows = await leerHoja('costo_asignaciones', 'costoAsignaciones');
    if (caRows && caRows.length > 1) {
      state.costoAsignaciones = caRows.slice(1).filter(r => r[0]).map(r => ({
        asignacion_id: String(r[0] || ''),
        pago_id: r[1] || '',
        unidad_id: parseInt(r[2]) || 0,
        proyecto: r[3] || '',
        metodo: r[4] || 'directo',
        monto_asignado: parseFloat(r[5]) || 0,
        factor: parseFloat(r[6]) || 0,
        fecha_asignacion: r[7] || '',
        partida_override: r[8] || '',
        // Devengado (Fase A): si factura_id está lleno, el reparto es de una FACTURA.
        factura_id: r[9] || '',
        sub_partida_override: r[10] || '',
        // Control de Obra: la partida del catálogo del residente (la hoja legacy
        // nunca la trae; simetría con sbLoadAll para que el diff no se confunda).
        partida_obra: r[11] || ''
      }));
    }

    // Load partidas_catalogo (catálogo editable de partidas y subpartidas)
    const pcatRows = await leerHoja('partidas_catalogo', 'partidasCatalogo');
    if (pcatRows && pcatRows.length > 1) {
      state.partidasCatalogo = pcatRows.slice(1).filter(r => r[0] || r[1]).map(r => ({
        id: r[0] || '',
        partida: r[1] || '',
        subpartidas: (r[2] || '').split('|').map(s => s.trim()).filter(Boolean),
        orden: parseInt(r[3]) || 0,
        activa: r[4] !== 'false' && r[4] !== 'FALSE' && r[4] !== false,
        visibleObra: r[5] !== 'false' && r[5] !== 'FALSE' && r[5] !== false
      }));
    }
    // Migración: si la hoja está vacía, sembrar con partidas únicas del
    // historial + subpartidas hardcoded de CONSTRUCCION. Se ejecuta una vez.
    if (pcatRows !== null && (!state.partidasCatalogo || state.partidasCatalogo.length === 0)) {
      const norm = s => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      // Set normalizado de subpartidas de CONSTRUCCION (sin incluir "CONSTRUCCION"
      // que también figura en el array como autopopulado del nombre de partida).
      const subsNorm = new Set(SUB_PARTIDAS_CONSTRUCCION.map(norm));
      subsNorm.delete(norm('CONSTRUCCION'));
      // Tomar partidas únicas del historial filtrando las que en realidad son
      // subpartidas de CONSTRUCCION (datos contaminados de versiones previas).
      const partidasSet = new Set();
      state.historial.forEach(h => {
        const p = (h.partida || '').trim();
        if (p && !subsNorm.has(norm(p))) partidasSet.add(p);
      });
      partidasSet.add('CONSTRUCCION');
      const slug = s => 'p_' + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) + '_' + Date.now();
      let orden = 0;
      state.partidasCatalogo = [...partidasSet].map(p => {
        orden++;
        const esConstr = norm(p) === 'construccion';
        return {
          id: slug(p) + '_' + orden,
          partida: p,
          subpartidas: esConstr ? [...SUB_PARTIDAS_CONSTRUCCION] : [],
          orden,
          activa: true
        };
      });
      await gsSavePartidasCatalogo();
    }

    // Load partidas_obra (catálogo detallado de partidas de Obra)
    // Schema v2: partida_obra_id, nombre, proyecto, partida_admin, sub_partida_admin, orden, activa
    // Schema v1 (legacy):           ..., proyecto, sub_partida_admin, orden, activa
    // Detección por header: si la columna 3 (idx 3) del header dice 'partida_admin' es v2.
    const poRows = await leerHoja('partidas_obra', 'partidasObra');
    if (poRows && poRows.length > 1) {
      const header = poRows[0].map(h => String(h || '').toLowerCase());
      const esV2 = header[3] === 'partida_admin';
      state.partidasObra = poRows.slice(1).filter(r => r[0] || r[1]).map(r => {
        if (esV2) {
          return {
            id: r[0] || '',
            nombre: r[1] || '',
            proyecto: r[2] || '',
            partidaAdmin: r[3] || '',
            subPartidaAdmin: r[4] || '',
            orden: parseInt(r[5]) || 0,
            activa: r[6] !== 'false' && r[6] !== 'FALSE' && r[6] !== false
          };
        }
        // Legacy v1: 6 columnas, sub_partida_admin en idx 3.
        // Si tenía sub_partida_admin → asumir partida_admin = CONSTRUCCION.
        const subAdmin = r[3] || '';
        return {
          id: r[0] || '',
          nombre: r[1] || '',
          proyecto: r[2] || '',
          partidaAdmin: subAdmin ? 'CONSTRUCCION' : '',
          subPartidaAdmin: subAdmin,
          orden: parseInt(r[4]) || 0,
          activa: r[5] !== 'false' && r[5] !== 'FALSE' && r[5] !== false
        };
      });
    }

    // Pasos post-carga compartidos (recalibrar contadores, limpiar huérfanas,
    // re-render). Mismos pasos para Sheets y Supabase.
    await finalizarCarga();

    // INGRESOS (Fase 1): lectura de RESPALDO desde Sheets (ruta de fallback). Gated
    // + try/catch propio → jamás afecta la carga de Pagos. Columnas POSICIONALES que
    // calcan gsSaveClientes/Ventas/Cobros y gsInitSheets (3er mapRow). Supabase sigue
    // siendo la fuente; esto solo aplica si se cae a Sheets.
    if (ingresosDataActiva()) {
      try {
        const clRows = await leerHoja('clientes', 'clientes');
        if (clRows && clRows.length > 1) {
          state.clientes = clRows.slice(1).filter(r => r[0]).map(r => ({
            cliente_id: String(r[0] || ''), nombre: r[1] || '', rfc: r[2] || '', telefono: r[3] || '',
            email: r[4] || '', observaciones: r[5] || '', activo: r[6] !== 'FALSE' && r[6] !== 'false'
          }));
        }
        const veRows = await leerHoja('ventas', 'ventas');
        if (veRows && veRows.length > 1) {
          state.ventas = veRows.slice(1).filter(r => r[0]).map(r => ({
            venta_id: String(r[0] || ''), unidad_id: String(r[1] || ''), proyecto: r[2] || '', cliente_id: String(r[3] || ''),
            precio_venta: parseFloat(r[4]) || 0, tipo_credito: r[5] || '', estatus_comercial: r[6] || 'apartada',
            fecha_apartado: r[7] || '', fecha_escritura_estimada: r[8] || '', fecha_escritura_real: r[9] || '',
            valor_liberacion: parseFloat(r[10]) || 0, credito_id: String(r[11] || ''),
            monto_cobrado: parseFloat(r[12]) || 0, saldo_cliente: parseFloat(r[13]) || 0,
            observaciones: r[14] || '', activo: r[15] !== 'FALSE' && r[15] !== 'false'
          }));
        }
        const coRows = await leerHoja('cobros', 'cobros');
        if (coRows && coRows.length > 1) {
          state.cobros = coRows.slice(1).filter(r => r[0]).map(r => ({
            cobro_id: String(r[0] || ''), venta_id: String(r[1] || ''), cliente_id: String(r[2] || ''), proyecto: r[3] || '',
            fecha: r[4] || '', monto: parseFloat(r[5]) || 0, tipo_cobro: r[6] || 'abono', metodo: r[7] || 'transferencia',
            cuenta_destino_tipo: r[8] || '', cuenta_destino_id: String(r[9] || ''), referencia: r[10] || '',
            concepto: r[11] || '', observaciones: r[12] || '', activo: r[13] !== 'FALSE' && r[13] !== 'false'
          }));
        }
        // Re-suma cobros → derivados de ventas (igual que en sbLoadAll).
        const _cpv = new Map();
        for (const c of state.cobros) { if (c.activo === false) continue; const k = String(c.venta_id); _cpv.set(k, (_cpv.get(k) || 0) + (parseFloat(c.monto) || 0)); }
        for (const v of state.ventas) { const cb = _cpv.get(String(v.venta_id)) || 0; v.monto_cobrado = cb; v.saldo_cliente = Math.max(0, (v.precio_venta || 0) - cb); }
      } catch (e) { console.error('gsLoadAll ingresos (Sheets)', e); }
    }

    // ESTRATEGIA (Fase 2): lectura de RESPALDO desde Sheets (ruta de fallback).
    // Gated + try/catch propio. Columnas POSICIONALES que calcan gsSaveEstrategia*
    // y gsInitSheets. 'valor' viene serializado con JSON.stringify → se re-parsea.
    if (estrategiaActivo()) {
      try {
        const ecRows = await leerHoja('estrategia_config', 'estrategiaConfig');
        if (ecRows && ecRows.length > 1) {
          state.estrategiaConfig = ecRows.slice(1).filter(r => r[0]).map(r => {
            let valor = r[1]; try { valor = JSON.parse(r[1]); } catch (_) { /* deja el texto */ }
            return { clave: String(r[0] || ''), valor, descripcion: r[2] || '', grupo: r[3] || 'general' };
          });
        }
        const efRows = await leerHoja('estrategia_flags_unidad', 'estrategiaFlags');
        if (efRows && efRows.length > 1) {
          state.estrategiaFlags = efRows.slice(1).filter(r => r[0]).map(r => ({
            flag_id: String(r[0] || ''), unidad_id: String(r[1] || ''), proyecto: r[2] || '',
            tipo: r[3] || 'bloqueo', categoria: r[4] || '', fecha_compromiso: r[5] || '',
            nota: r[6] || '', activo: r[7] !== 'FALSE' && r[7] !== 'false'
          }));
        }
      } catch (e) { console.error('gsLoadAll estrategia (Sheets)', e); }
    }
  } catch (e) {
    console.error('gsLoadAll error', e);
    notify('Error cargando datos: ' + e.message, 'error');
  } finally {
    // Aviso visible si alguna hoja no cargó (y bloqueo de su guardado).
    actualizarBannerCarga();
  }
}

// Pasos post-carga compartidos por gsLoadAll (Sheets) y sbLoadAll (Supabase).
// Garantiza comportamiento idéntico sin importar la fuente: IDs estables, orden,
// recalibración de contadores en memoria, limpieza de asignaciones huérfanas y
// re-render de toda la UI.
async function finalizarCarga() {
  ensureHistorialIds();
  sortHistorialByFecha();

  // Recalibrar contadores desde el máximo cargado (para no chocar IDs nuevos).
  const maxProv = state.proveedores.reduce((max, p) => Math.max(max, p.id || 0), 0);
  const maxEmp = state.empleados.reduce((max, e) => Math.max(max, e.id || 0), 0);
  state.nextId = Math.max(maxProv, maxEmp, state.nextId || 0) + 1;
  state.nextUnidadId = state.unidades.reduce((m, u) => Math.max(m, u.unidad_id || 0), 0) + 1;
  state.nextPresupuestoId = state.presupuestoUnidad.reduce((m, p) => Math.max(m, p.presupuesto_id || 0), 0) + 1;

  // Foto de lo que se acaba de cargar de Supabase → base del guardado POR FILA (diff).
  _resetCaSnapshot();

  // Detección de asignaciones huérfanas (su pago/factura ya no existe). SOLO AVISA,
  // NUNCA borra automáticamente: en edición simultánea o carga parcial, borrar aquí
  // podía eliminar reparto VÁLIDO de otra sesión. Para limpiar de verdad está el
  // botón "Limpiar huérfanas" en Costos por Unidad (manual, con confirmación).
  if (state.cargado.historial === true && state.cargado.costoAsignaciones === true) {
    const idsHist = new Set(state.historial.map(h => String(h.id)).filter(Boolean));
    const idsFact = new Set(state.facturas.map(f => String(f.factura_id)).filter(Boolean));
    const factOk = state.cargado.facturas === true && state.facturas.length > 0;
    const histOk = state.historial.length > 0;
    const huerfanas = state.costoAsignaciones.filter(a =>
      a.factura_id ? (factOk && !idsFact.has(String(a.factura_id)))
                   : (histOk && !idsHist.has(String(a.pago_id)))
    );
    if (huerfanas.length) {
      notify(`⚠ ${huerfanas.length} asignación(es) parecen huérfanas (su pago/factura no está). No se borró nada; revísalas con "Limpiar huérfanas" si aplica.`, 'error');
    }
  }

  // Sanar facturas "parcial" que solo traen una diferencia de CENTAVOS (el banco paga en pesos
  // cerrados) → marcarlas pagada. Tolerancia $1, idempotente, guardado por fila. Mismo criterio
  // que recalcularSaldoEstatus. Sana las que ya estaban atoradas desde antes del fix.
  if ((puedeEditar() || puedeFacturas()) && state.cargado.facturas === true) {
    const _pfFac = esPorFila('facturas');
    let _sanadas = 0;
    state.facturas.forEach(f => {
      const saldo = Math.max(0, (f.monto_total || 0) - (f.monto_pagado || 0));
      if (f.estatus_factura === 'parcial' && (f.monto_pagado || 0) > 0 && saldo > 0 && saldo <= 1) {
        f.estatus_factura = 'pagada';
        if (!f.fecha_pago_total) f.fecha_pago_total = new Date().toISOString().slice(0, 10);
        if (_pfFac) sbGuardarFila('facturas', f);
        _sanadas++;
      }
    });
    if (_sanadas) { gsSaveFacturas({ porFila: _pfFac }); if (window.renderFacturas) window.renderFacturas(); }
  }

  // Rendimiento: antes se renderizaban LAS 15 PÁGINAS con la mayoría oculta
  // (display:none) — trabajo redundante porque el router YA re-renderiza cada
  // página al navegar (lazy-render). Ahora: solo lo GLOBAL (header, selects de
  // modales, contadores del nav) + la página actualmente VISIBLE.
  if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();   // select de Dispersión (sin rama propia)
  if (window.renderHeaderBadges) window.renderHeaderBadges();           // saldos del header (global)
  if (window.refreshProyectosEnSelects) window.refreshProyectosEnSelects(); // selects de modales/filtros
  // Contadores del nav (antes venían de pilón dentro de cada render de página).
  const _cnt = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  _cnt('cnt-hist', state.historial.length);
  _cnt('cnt-fact', state.facturas.length);
  _cnt('cnt-fp', state.facturaPagos.length);
  _cnt('cnt-prov', state.proveedores.length);
  _cnt('cnt-nom', state.empleados.length);
  _cnt('cnt-cp', state.cuentasPropias.length);
  _cnt('cnt-traspasos', state.traspasos.length);
  _cnt('cnt-creditos', state.creditos.length);
  _cnt('cnt-confirmar', state.pendientesConfirmacion.length);
  // La página visible (la única cuyo render se ve ahora mismo).
  if (window.renderPaginaActual) window.renderPaginaActual();
}

// Carga TODO el estado desde Supabase (Fase 2). Es el espejo inverso de los
// _rowsX: mapea cada fila al shape de state.* COERCIONANDO tipos EXACTAMENTE
// como el cargador de Sheets (ids numéricos con parseInt, montos con parseFloat,
// mismos defaults) para que el comportamiento sea idéntico. Lanza si Supabase
// falla; el caller decide el fallback a Sheets.
export async function sbLoadAll() {
  if (!sbReady()) throw new Error('Sin sesión/tenant Supabase');
  state.cargado = {};
  const toInt = (v) => parseInt(v) || 0;
  const toNum = (v) => parseFloat(v) || 0;
  const plano = (v) => (v === null || v === undefined || v === '' ? null : (parseFloat(v) || 0));

  // Columna de id único por tabla, para paginar la lectura sin duplicar ni saltar filas.
  const ORDER = {
    proveedores: 'id', historial: 'id', proyectos: 'id', empleados: 'id',
    cuentas_propias: 'cuenta_id', facturas: 'factura_id', factura_pagos: 'factura_pago_id',
    traspasos: 'traspaso_id', movimientos_internos: 'id', creditos: 'credito_id',
    pagares: 'pagare_id', pagos_pagare: 'pago_id', unidades: 'unidad_id',
    presupuesto_unidad: 'presupuesto_id', costo_asignaciones: 'asignacion_id',
    partidas_catalogo: 'partida_id', partidas_obra: 'partida_obra_id',
    pendientes_confirmacion: 'id',
    // INGRESOS (Fase 1)
    clientes: 'cliente_id', ventas: 'venta_id', cobros: 'cobro_id',
    // ESTRATEGIA (Fase 2)
    estrategia_config: 'clave', estrategia_flags_unidad: 'flag_id',
    // FISCAL (pestaña 🧾, solo-admin)
    fiscal_marcas: 'marca_id'
  };

  async function cargar(tabla, entidad, fn) {
    const rows = await sbLoadTable(tabla, ORDER[tabla]);
    try {
      state.cargado[entidad] = (rows !== null);
      if (rows && rows.length) fn(rows);
    } catch (e) {
      // Un error de mapeo NO debe tumbar el resto de la carga: se marca la
      // entidad como no-cargada (guardarPermitido bloquea SOLO su guardado).
      console.error('sbLoadAll: fallo mapeando ' + tabla, e);
      state.cargado[entidad] = false;
    }
  }
  // Rendimiento: las tablas son INDEPENDIENTES entre sí (ningún map lee otro
  // state.*), así que se cargan EN PARALELO; la única barrera es finalizarCarga.
  const _cargas = [];
  const P = (tabla, entidad, fn) => _cargas.push(cargar(tabla, entidad, fn));
  const _t0 = (typeof performance !== 'undefined') ? performance.now() : 0;

  P('proveedores', 'proveedores', rows => {
    state.proveedores = rows.map(r => ({
      id: toInt(r.id), nombre: r.nombre || '', rfc: r.rfc || '', banco: normalizeBanco(r.banco || ''),
      tipo_cuenta: r.tipo_cuenta || '', cuenta: r.cuenta || '', clabe: r.clabe || '',
      categoria: r.categoria || '', subcategoria: r.subcategoria || '',
      proyectos: Array.isArray(r.proyectos) ? r.proyectos : [], activo: r.activo !== false,
      bloqueada_para_pago: !!r.bloqueada_para_pago, aliases: Array.isArray(r.aliases) ? r.aliases : []
    }));
  });

  P('historial', 'historial', rows => {
    state.historial = rows.map(r => ({
      proveedor_id: r.proveedor_id || '', factura_id: r.factura_id || '', fecha: r.fecha || '',
      nombre: r.nombre || '', banco: normalizeBanco(r.banco || ''), tipo: r.tipo || '',
      concepto: r.concepto || '', importe: toNum(r.importe), proyecto: r.proyecto || '',
      cuenta_origen: r.cuenta_origen || '', tipo_registro: r.tipo_registro || 'Pago',
      partida: r.partida || '', sub_partida: r.sub_partida || '', id: r.id || ''
    }));
  });

  P('proyectos', 'proyectos', rows => {
    state.proyectos = rows.map(r => ({
      id: r.id || '', nombre: r.nombre || '', empresa: r.empresa || '', cuenta: r.cuenta || '',
      clabe: r.clabe || '', color: r.color || '#C8A96E', activo: r.activo !== false,
      saldo: toNum(r.saldo), ultima_act_saldo: r.ultima_act_saldo || '', es_concentradora: !!r.es_concentradora
    }));
  });

  P('empleados', 'empleados', rows => {
    state.empleados = rows.map(r => ({
      id: toInt(r.id), nombre: r.nombre || '', puesto: r.puesto || '', empresa: r.empresa || '',
      banco: r.banco || 'BBVA', tipo_cuenta: r.tipo_cuenta || '', cuenta: r.cuenta || '',
      clabe: r.clabe || '', rfc: r.rfc || '', activo: r.activo !== false
    }));
  });

  P('cuentas_propias', 'cuentasPropias', rows => {
    state.cuentasPropias = rows.map(r => ({
      cuenta_id: toInt(r.cuenta_id), nombre: r.nombre || '', banco: r.banco || '', clabe: r.clabe || '',
      numero_cuenta: r.numero_cuenta || '', proyecto: r.proyecto || '', tipo: r.tipo || 'General',
      saldo: toNum(r.saldo), ultima_actualizacion: r.ultima_actualizacion || '', activo: r.activo !== false
    }));
  });

  P('facturas', 'facturas', rows => {
    state.facturas = rows.map(r => ({
      factura_id: toInt(r.factura_id), numero_factura: r.numero_factura || '', razon_social: r.razon_social || '',
      proveedor_id: toInt(r.proveedor_id), nombre_proveedor: r.nombre_proveedor || '',
      fecha_factura: r.fecha_factura || '', fecha_vencimiento: r.fecha_vencimiento || '',
      fecha_pago_total: r.fecha_pago_total || '', monto_total: toNum(r.monto_total),
      monto_pagado: toNum(r.monto_pagado), saldo_pendiente: toNum(r.saldo_pendiente),
      estatus_factura: r.estatus_factura || 'pendiente', proyecto: r.proyecto || '', empresa: r.empresa || '',
      observaciones: r.observaciones || '', activo: r.activo !== false, uuid: r.uuid || '',
      // Fase 2: campos fiscales (CFDI).
      subtotal: toNum(r.subtotal), descuento: toNum(r.descuento), iva_trasladado: toNum(r.iva_trasladado),
      retencion_iva: toNum(r.retencion_iva), retencion_isr: toNum(r.retencion_isr),
      nc_subtotal: toNum(r.nc_subtotal), nc_iva: toNum(r.nc_iva),
      rfc_emisor: r.rfc_emisor || '', estado_sat: r.estado_sat || 'Vigente', tipo_comprobante: r.tipo_comprobante || 'Factura'
    }));
  });

  P('factura_pagos', 'facturaPagos', rows => {
    state.facturaPagos = rows.map(r => ({
      factura_pago_id: r.factura_pago_id != null ? String(r.factura_pago_id) : '', factura_id: toInt(r.factura_id), pago_id: toInt(r.pago_id),
      proveedor_id: toInt(r.proveedor_id), monto_aplicado: toNum(r.monto_aplicado),
      fecha_pago: r.fecha_pago || '', estatus: r.estatus || '', observaciones: r.observaciones || ''
    }));
  });

  P('traspasos', 'traspasos', rows => {
    state.traspasos = rows.map(r => ({
      traspaso_id: toInt(r.traspaso_id), tipo: r.tipo || '', cuenta_origen_id: r.cuenta_origen_id || '',
      cuenta_origen_tipo: r.cuenta_origen_tipo || 'proyecto', cuenta_origen_nombre: r.cuenta_origen_nombre || '',
      proyecto_origen: r.proyecto_origen || '', cuenta_destino_id: r.cuenta_destino_id || '',
      cuenta_destino_tipo: r.cuenta_destino_tipo || 'proyecto', cuenta_destino_nombre: r.cuenta_destino_nombre || '',
      proyecto_destino: r.proyecto_destino || '', monto: toNum(r.monto), fecha: r.fecha || '',
      concepto: r.concepto || '', referencia: r.referencia || '', estatus: r.estatus || 'pendiente',
      fecha_registro: r.fecha_registro || ''
    }));
  });

  P('movimientos_internos', 'movimientosInternos', rows => {
    state.movimientosInternos = rows.map(r => ({
      id: toInt(r.id), fecha: r.fecha || '', tipo: r.tipo || '', origen: r.origen || '',
      destino: r.destino || '', monto: toNum(r.monto), concepto: r.concepto || '', referencia: r.referencia || ''
    }));
  });

  P('creditos', 'creditos', rows => {
    state.creditos = rows.map(r => ({
      credito_id: toInt(r.credito_id), nombre: r.nombre || '', banco: r.banco || '',
      tipo_credito: r.tipo_credito || 'Puente', monto_autorizado: toNum(r.monto_autorizado),
      tasa_base: toNum(r.tasa_base), proyecto: r.proyecto || '', cuenta_pago: r.cuenta_pago || '',
      estatus: r.estatus || 'Activo', activo: r.activo !== false
    }));
  });

  P('pagares', 'pagares', rows => {
    state.pagares = rows.map(r => ({
      pagare_id: toInt(r.pagare_id), credito_id: toInt(r.credito_id), numero_pagare: r.numero_pagare || '',
      monto: toNum(r.monto), fecha_disposicion: r.fecha_disposicion || '', fecha_vencimiento: r.fecha_vencimiento || '',
      tasa: toNum(r.tasa), estatus: r.estatus || 'Vigente', activo: r.activo !== false
    }));
  });

  P('pagos_pagare', 'pagosPagare', rows => {
    state.pagosPagare = rows.map(r => ({
      pago_id: toInt(r.pago_id), pagare_id: toInt(r.pagare_id), credito_id: toInt(r.credito_id),
      fecha_pago: r.fecha_pago || '', monto_intereses: toNum(r.monto_intereses), concepto: r.concepto || '',
      estatus: r.estatus || 'Pendiente', fecha_real_pago: r.fecha_real_pago || ''
    }));
  });

  P('unidades', 'unidades', rows => {
    state.unidades = rows.map(r => ({
      unidad_id: toInt(r.unidad_id), proyecto: r.proyecto || '', nombre: r.nombre || '', tipo: r.tipo || '',
      indiviso_pct: toNum(r.indiviso_pct), superficie_m2: toNum(r.superficie_m2), estatus: r.estatus || 'En obra',
      fecha_termino: r.fecha_termino || '',
      orden: toInt(r.orden), activo: r.activo !== false,
      plano_x: plano(r.plano_x), plano_y: plano(r.plano_y), plano_w: plano(r.plano_w), plano_h: plano(r.plano_h)
    }));
  });

  P('presupuesto_unidad', 'presupuestoUnidad', rows => {
    state.presupuestoUnidad = rows.map(r => ({
      presupuesto_id: r.presupuesto_id != null ? String(r.presupuesto_id) : '', unidad_id: toInt(r.unidad_id), partida: r.partida || '',
      sub_partida: r.sub_partida || '', monto_presupuestado: toNum(r.monto_presupuestado),
      costo_inicial: toNum(r.costo_inicial), notas: r.notas || '',
      avance_fisico: toNum(r.avance_fisico)
    }));
  });

  P('costo_asignaciones', 'costoAsignaciones', rows => {
    state.costoAsignaciones = rows.map(r => ({
      asignacion_id: r.asignacion_id != null ? String(r.asignacion_id) : '', pago_id: r.pago_id || '', unidad_id: toInt(r.unidad_id),
      proyecto: r.proyecto || '', metodo: r.metodo || 'directo', monto_asignado: toNum(r.monto_asignado),
      factor: toNum(r.factor), fecha_asignacion: r.fecha_asignacion || '', partida_override: r.partida_override || '',
      factura_id: r.factura_id || '', sub_partida_override: r.sub_partida_override || '',
      partida_obra: r.partida_obra || ''
    }));
  });

  P('partidas_catalogo', 'partidasCatalogo', rows => {
    state.partidasCatalogo = rows.map(r => ({
      id: r.partida_id || '', partida: r.partida || '',
      subpartidas: Array.isArray(r.subpartidas) ? r.subpartidas : [],
      orden: toInt(r.orden), activa: r.activa !== false,
      visibleObra: r.visible_obra !== false
    }));
  });

  P('partidas_obra', 'partidasObra', rows => {
    state.partidasObra = rows.map(r => ({
      id: r.partida_obra_id || '', nombre: r.nombre || '', proyecto: r.proyecto || '',
      partidaAdmin: r.partida_admin || '', subPartidaAdmin: r.sub_partida_admin || '',
      orden: toInt(r.orden), activa: r.activa !== false
    }));
  });

  P('pendientes_confirmacion', 'pendientesConfirmacion', rows => {
    state.pendientesConfirmacion = rows.map(r => {
      const ap = r.asignaciones_planificadas || {};
      return {
        id: parseInt(r.id) || r.id, proveedor_id: r.proveedor_id || '', factura_id: r.factura_id || '',
        nombre: r.nombre || '', cuenta: r.cuenta || '', banco: normalizeBanco(r.banco || ''),
        tipo: r.tipo || '', concepto: r.concepto || '', importe: toNum(r.importe),
        proyecto: r.proyecto || '', partida: r.partida || '', cuenta_cargo: r.cuenta_cargo || '',
        fechaGen: r.fecha_gen || '', confirmado: r.confirmado !== false, sub_partida: r.sub_partida || '',
        asignacionesPlanificadas: Array.isArray(ap.a) ? ap.a : [], repartoMetodo: ap.m || null,
        partidaObra: r.partida_obra || ''
      };
    });
  });

  // ===== INGRESOS (Fase 1 — cartera pura) =====
  // Gated: solo carga si el módulo está activo (bandera maestra + vista previa),
  // así los usuarios reales no pagan este costo mientras se construye. IDs = text
  // (UUID) → String(). NO toca nada de Pagos.
  if (ingresosDataActiva()) _cargas.push((async () => {
    await cargar('clientes', 'clientes', rows => {
      state.clientes = rows.map(r => ({
        cliente_id: r.cliente_id != null ? String(r.cliente_id) : '',
        nombre: r.nombre || '', rfc: r.rfc || '', telefono: r.telefono || '',
        email: r.email || '', observaciones: r.observaciones || '', activo: r.activo !== false
      }));
    });
    await cargar('ventas', 'ventas', rows => {
      state.ventas = rows.map(r => ({
        venta_id: r.venta_id != null ? String(r.venta_id) : '',
        unidad_id: r.unidad_id != null ? String(r.unidad_id) : '', proyecto: r.proyecto || '',
        cliente_id: r.cliente_id != null ? String(r.cliente_id) : '',
        precio_venta: toNum(r.precio_venta), tipo_credito: r.tipo_credito || '',
        estatus_comercial: r.estatus_comercial || 'apartada', fecha_apartado: r.fecha_apartado || '',
        fecha_escritura_estimada: r.fecha_escritura_estimada || '', fecha_escritura_real: r.fecha_escritura_real || '',
        valor_liberacion: toNum(r.valor_liberacion), credito_id: r.credito_id != null ? String(r.credito_id) : '',
        monto_cobrado: toNum(r.monto_cobrado), saldo_cliente: toNum(r.saldo_cliente),
        observaciones: r.observaciones || '', activo: r.activo !== false
      }));
    });
    await cargar('cobros', 'cobros', rows => {
      state.cobros = rows.map(r => ({
        cobro_id: r.cobro_id != null ? String(r.cobro_id) : '',
        venta_id: r.venta_id != null ? String(r.venta_id) : '', cliente_id: r.cliente_id != null ? String(r.cliente_id) : '',
        proyecto: r.proyecto || '', fecha: r.fecha || '', monto: toNum(r.monto),
        tipo_cobro: r.tipo_cobro || 'abono', metodo: r.metodo || 'transferencia',
        cuenta_destino_tipo: r.cuenta_destino_tipo || '', cuenta_destino_id: r.cuenta_destino_id != null ? String(r.cuenta_destino_id) : '',
        referencia: r.referencia || '', concepto: r.concepto || '', observaciones: r.observaciones || '', activo: r.activo !== false
      }));
    });
    // Sana los derivados de ventas por RE-SUMA de cobros (Map una vez). Corrige en
    // memoria cualquier drift entre monto_cobrado/saldo_cliente guardados y los cobros
    // reales. No persiste (se corrige al próximo guardado de cobro). Cero costo notable.
    const _cobradoPorVenta = new Map();
    for (const c of state.cobros) {
      if (c.activo === false) continue;
      const k = String(c.venta_id);
      _cobradoPorVenta.set(k, (_cobradoPorVenta.get(k) || 0) + (toNum(c.monto)));
    }
    for (const v of state.ventas) {
      const cobrado = _cobradoPorVenta.get(String(v.venta_id)) || 0;
      v.monto_cobrado = cobrado;
      v.saldo_cliente = Math.max(0, (v.precio_venta || 0) - cobrado);
    }
  })());

  // ===== ESTRATEGIA (Fase 2) =====
  // Gated: solo con el módulo activo. valor es jsonb (llega ya como JS nativo).
  if (estrategiaActivo()) _cargas.push((async () => {
    await cargar('estrategia_config', 'estrategiaConfig', rows => {
      state.estrategiaConfig = rows.map(r => ({
        clave: r.clave != null ? String(r.clave) : '',
        valor: r.valor,                       // número/booleano/string/lista según la clave
        descripcion: r.descripcion || '', grupo: r.grupo || 'general'
      }));
    });
    await cargar('estrategia_flags_unidad', 'estrategiaFlags', rows => {
      state.estrategiaFlags = rows.map(r => ({
        flag_id: r.flag_id != null ? String(r.flag_id) : '',
        unidad_id: r.unidad_id != null ? String(r.unidad_id) : '', proyecto: r.proyecto || '',
        tipo: r.tipo || 'bloqueo', categoria: r.categoria || '',
        fecha_compromiso: r.fecha_compromiso || '', nota: r.nota || '', activo: r.activo !== false
      }));
    });
  })());

  // FISCAL (pestaña 🧾, solo-admin): marcas de deducibilidad. Vive SOLO en Supabase.
  // RLS regresa vacío a los no-admin; si la tabla no existe aún (SQL 36 sin correr),
  // sbLoadTable devuelve null y cargado queda en false → la pestaña avisa.
  P('fiscal_marcas', 'fiscalMarcas', rows => {
    state.fiscalMarcas = rows.map(r => ({
      marca_id: r.marca_id != null ? String(r.marca_id) : '',
      doc_tipo: r.doc_tipo || 'pago',
      doc_id: r.doc_id != null ? String(r.doc_id) : '',
      incluir: r.incluir !== false,
      motivo: r.motivo || '',
      usuario_email: r.usuario_email || '',
      created_at: r.created_at || ''
    }));
  });

  await Promise.allSettled(_cargas);
  if (_t0) console.log('✓ sbLoadAll (paralelo) en ' + Math.round(performance.now() - _t0) + ' ms');

  await finalizarCarga();
}

// Botón de prueba (Fase 2): carga desde Supabase SIN cambiar el arranque por
// defecto, para comparar contra Sheets antes del flip real.
export async function probarCargaDesdeSupabase() {
  if (!sbReady()) { notify('Inicia sesión en la app (Supabase) primero', 'error'); return; }
  notify('Cargando desde Supabase (prueba)...');
  try {
    await sbLoadAll();
    notify(`✓ Desde Supabase: ${state.historial.length} pagos · ${state.proveedores.length} proveedores · ${state.facturas.length} facturas · ${state.traspasos.length} traspasos`, 'success');
  } catch (e) {
    console.error('sbLoadAll error', e);
    notify('Error cargando desde Supabase: ' + (e.message || e), 'error');
  }
}

// Carga los datos según FUENTE_LECTURA. Si Supabase está configurado pero falla,
// cae automáticamente a Sheets (red de seguridad). Devuelve la fuente usada.
// Lo llaman los flujos de conexión de Google (gsLogin / checkOAuthCallback).
export async function cargarDatos() {
  if (FUENTE_LECTURA === 'supabase' && sbReady()) {
    try {
      await sbLoadAll();
      console.log('📥 Datos cargados desde Supabase');
      return 'supabase';
    } catch (e) {
      console.error('sbLoadAll falló; cae a Sheets de respaldo:', e);
      notify('No pude leer de Supabase; uso Sheets de respaldo. ' + (e.message || e), 'error');
    }
  }
  await gsLoadAll();
  console.log('📥 Datos cargados desde Sheets');
  return 'sheets';
}

// Asigna un ID único y estable a cada registro del historial que no lo tenga.
// Nunca sobrescribe un ID existente -> garantiza estabilidad de referencias.
// Devuelve true si asignó al menos un ID nuevo.
export function ensureHistorialIds() {
  let maxId = 0;
  state.historial.forEach(h => {
    const n = parseInt(h.id, 10);
    if (!isNaN(n) && n > maxId) maxId = n;
  });
  if (maxId >= (state.histSeq || 1)) state.histSeq = maxId + 1;
  let changed = false;
  state.historial.forEach(h => {
    if (!h.id) { h.id = String(state.histSeq++); changed = true; }
  });
  return changed;
}

// Elimina las asignaciones de costo ligadas a un pago borrado (evita huérfanas).
export async function purgarAsignacionesDePago(pagoId) {
  if (!pagoId || !puedeEditar()) return;
  const antes = state.costoAsignaciones.length;
  state.costoAsignaciones = state.costoAsignaciones.filter(a => a.factura_id || String(a.pago_id) !== String(pagoId));
  if (state.costoAsignaciones.length !== antes) {
    await gsSaveCostoAsignaciones();
  }
}

// Al borrar pago(s) del historial: quita sus facturaPagos y REVIERTE la factura ligada
// (monto_pagado -= aplicado; recalcula saldo/estatus) para no dejar enlaces huérfanos ni
// saldos inflados. No actúa sobre pagos sin facturaPago (ej. factura_id heredado del import).
export async function purgarFacturaPagosDePagos(pagoIds) {
  if (!puedeEditar() && !puedeFacturas()) return;
  const set = new Set((pagoIds || []).map(String));
  const fps = state.facturaPagos.filter(fp => set.has(String(fp.pago_id)));
  if (!fps.length) return;
  const tocadas = new Map();
  fps.forEach(fp => {
    const fact = state.facturas.find(f => String(f.factura_id) === String(fp.factura_id));
    if (!fact) return;
    fact.monto_pagado = Math.max(0, (fact.monto_pagado || 0) - (fp.monto_aplicado || 0));
    fact.saldo_pendiente = Math.max(0, (fact.monto_total || 0) - (fact.monto_pagado || 0));
    if ((fact.monto_pagado || 0) <= 0) { fact.estatus_factura = 'pendiente'; fact.fecha_pago_total = ''; }
    else if (fact.saldo_pendiente <= 1) { fact.estatus_factura = 'pagada'; }   // tolerancia de redondeo ($1)
    else { fact.estatus_factura = 'parcial'; fact.fecha_pago_total = ''; }
    tocadas.set(fact.factura_id, fact);
  });
  const fpIds = new Set(fps.map(fp => String(fp.factura_pago_id)));
  state.facturaPagos = state.facturaPagos.filter(fp => !fpIds.has(String(fp.factura_pago_id)));
  const porFilaF = esPorFila('facturas');
  const porFilaFp = esPorFila('facturaPagos');
  await gsSaveFacturas({ porFila: porFilaF });
  await gsSaveFacturaPagos({ porFila: porFilaFp });
  if (porFilaF) tocadas.forEach(f => sbGuardarFila('facturas', f));
  if (porFilaFp) fps.forEach(fp => sbBorrarFila('facturaPagos', fp.factura_pago_id));
  const cF = document.getElementById('cnt-fact'); if (cF) cF.textContent = state.facturas.length;
  const cFP = document.getElementById('cnt-fp'); if (cFP) cFP.textContent = state.facturaPagos.length;
  if (window.renderFacturas) window.renderFacturas();
  if (window.renderFacturaPagos) window.renderFacturaPagos();
}

// Devengado (Fase A): elimina las asignaciones de costo de una FACTURA (al darla de
// baja). Análogo a purgarAsignacionesDePago pero por factura_id.
export async function purgarAsignacionesDeFactura(facturaId) {
  if (facturaId == null || (!puedeEditar() && !puedeFacturas())) return;
  const antes = state.costoAsignaciones.length;
  state.costoAsignaciones = state.costoAsignaciones.filter(a => String(a.factura_id) !== String(facturaId));
  if (state.costoAsignaciones.length !== antes) {
    await gsSaveCostoAsignaciones();
  }
}

export async function saveData(count = 1) {
  if (!puedeEditar()) return;
  try {
    ensureHistorialIds();
    const n = Math.min(count, state.historial.length);
    for (let i = 0; i < n; i++) {
      const h = state.historial[i];
      await gsAppendRow('historial_pagos', [h.proveedor_id || '', h.factura_id || '', h.fecha, h.nombre, h.banco, h.tipo, h.concepto, h.importe, h.proyecto, h.cuenta_origen || '', h.tipo_registro || 'Pago', h.partida || '', h.sub_partida || '', h.id || '']);
    }
  } catch (e) {
    console.error('saveData error', e);
    notify(`⚠ No pude guardar el pago en Sheets: ${e.message}. Está en memoria pero NO se persistió.`, 'error');
  }
}

const HS_HEADERS = ['fecha', 'cuenta_id', 'cuenta_nombre', 'cuenta_tipo', 'saldo', 'saldo_total'];
let hsHeadersOk = false;

export async function gsAppendHistorialSaldo(registro) {
  if (!puedeEditar()) return;
  try {
    if (!hsHeadersOk) {
      const rows = await gsReadSheet('historial_saldos');
      if (!rows || !rows.length || rows[0][0] !== 'fecha') {
        await gsWriteRange('historial_saldos!A1', [HS_HEADERS]);
      }
      hsHeadersOk = true;
    }
    await gsAppendRow('historial_saldos', [
      registro.fecha, registro.cuenta_id, registro.cuenta_nombre,
      registro.cuenta_tipo, registro.saldo, registro.saldo_total
    ]);
  } catch (e) { console.error('gsAppendHistorialSaldo', e); }
}

export async function gsSavePendientes() {
  if (!puedeEditar()) return;
  // Los pagos por confirmar se vacían de forma normal al confirmar la cola.
  if (!guardarPermitido('pendientesConfirmacion', state.pendientesConfirmacion, true)) return;
  try {
    const rows = state.pendientesConfirmacion.map(p => [
      p.id, p.proveedor_id || '', p.factura_id || '', p.nombre, p.cuenta || '',
      p.banco, p.tipo, p.concepto, p.importe, p.proyecto, p.partida || '',
      p.cuenta_cargo || '', p.fechaGen || '', p.confirmado, p.sub_partida || '',
      JSON.stringify({ a: p.asignacionesPlanificadas || [], m: p.repartoMetodo || null }),
      p.partidaObra || ''
    ]);
    await gsClearAndWrite('pendientes_confirmacion', rows, [
      'id', 'proveedor_id', 'factura_id', 'nombre', 'cuenta', 'banco',
      'tipo', 'concepto', 'importe', 'proyecto', 'partida', 'cuenta_cargo',
      'fechaGen', 'confirmado', 'sub_partida', 'asignaciones_planificadas', 'partida_obra'
    ]);
    await sbEspejar('pendientesConfirmacion');
  } catch (e) { console.error('gsSavePendientes', e); }
}

export async function gsSaveHistorial(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('historial', state.historial, true)) return;
  // Salvaguarda: nunca sobrescribir el historial con cero filas (evita vaciarlo
  // por accidente si el estado en memoria está vacío).
  if (!state.historial.length) return;

  // Protección anti-sobrescritura: detectar si Sheets fue modificado por fuera
  // (ej. usuario metió filas a mano) desde la última carga. Si hay más filas
  // en remoto que en local, avisar antes de pisar.
  try {
    const remoto = await gsReadSheet('historial_pagos');
    if (remoto !== null && Array.isArray(remoto)) {
      const remotoCount = Math.max(0, (remoto.length || 0) - 1);
      const localCount = state.historial.length;
      // Tolerancia de 5 filas (por casos donde el state ya tiene unas pendientes).
      if (remotoCount > localCount + 5) {
        const ok = confirm(
          `⚠ La hoja historial_pagos tiene ${remotoCount} filas pero la app tiene ${localCount} en memoria.\n\n` +
          `Es probable que se haya editado directamente en Sheets desde que abriste la app.\n\n` +
          `Si confirmas, se SOBRESCRIBIRÁ Sheets con la versión local y se perderán esos cambios externos.\n\n` +
          `RECOMENDACIÓN: cancela aquí, recarga la app con el botón 🔄, y vuelve a confirmar tus pagos.\n\n` +
          `¿Sobrescribir de todos modos?`
        );
        if (!ok) {
          notify('Guardado cancelado. Usa 🔄 Recargar antes de continuar.', 'error');
          return;
        }
      }
    }
  } catch (e) { console.warn('No pude verificar el remoto antes de guardar historial:', e); }

  try {
    ensureHistorialIds();
    // Ordenar por fecha desc antes de persistir (más reciente arriba en Sheets).
    sortHistorialByFecha();
    const rows = state.historial.map(h => [
      h.proveedor_id || '', h.factura_id || '', h.fecha, h.nombre, h.banco,
      h.tipo, h.concepto, h.importe, h.proyecto, h.cuenta_origen || '',
      h.tipo_registro || 'Pago', h.partida || '', h.sub_partida || '', h.id || ''
    ]);
    await gsClearAndWrite('historial_pagos', rows, [
      'proveedor_id', 'factura_id', 'fecha', 'nombre', 'banco',
      'tipo', 'concepto', 'importe', 'proyecto', 'cuenta_origen',
      'tipo_registro', 'partida', 'sub_partida', 'id'
    ]);
    if (!opts.porFila) await sbEspejar('historial');
  } catch (e) {
    console.error('gsSaveHistorial', e);
    notify(`⚠ No pude guardar el historial en Sheets: ${e.message}. Tus cambios están en memoria pero NO se persistieron.`, 'error');
  }
}

export async function gsSaveUnidades(opts = {}) {
  // 'obra' (residente) captura fecha de terminación y estatus de las casas.
  if (!puedeEditar() && !puedeCapturarObra()) return;
  if (!guardarPermitido('unidades', state.unidades)) return;
  try {
    const rows = state.unidades.map(u => [
      u.unidad_id, u.proyecto, u.nombre, u.tipo || '', u.indiviso_pct || 0,
      u.superficie_m2 || 0, u.estatus || 'En obra', u.orden || 0, u.activo,
      u.plano_x == null ? '' : u.plano_x, u.plano_y == null ? '' : u.plano_y,
      u.plano_w == null ? '' : u.plano_w, u.plano_h == null ? '' : u.plano_h,
      u.fecha_termino || ''
    ]);
    await gsClearAndWrite('unidades', rows, [
      'unidad_id', 'proyecto', 'nombre', 'tipo', 'indiviso_pct',
      'superficie_m2', 'estatus', 'orden', 'activo', 'plano_x', 'plano_y',
      'plano_w', 'plano_h', 'fecha_termino'
    ]);
    if (!opts.porFila) await sbEspejar('unidades');
  } catch (e) { console.error('gsSaveUnidades', e); }
}

export async function gsSavePresupuestoUnidad(opts = {}) {
  // 'obra' (residente) captura los presupuestos por partida.
  if (!puedeEditar() && !puedeCapturarObra()) return;
  if (!guardarPermitido('presupuestoUnidad', state.presupuestoUnidad)) return;
  try {
    const rows = state.presupuestoUnidad.map(p => [
      p.presupuesto_id, p.unidad_id, p.partida || '', p.sub_partida || '',
      p.monto_presupuestado || 0, p.costo_inicial || 0, p.notas || '',
      p.avance_fisico || 0
    ]);
    await gsClearAndWrite('presupuesto_unidad', rows, [
      'presupuesto_id', 'unidad_id', 'partida', 'sub_partida',
      'monto_presupuestado', 'costo_inicial', 'notas', 'avance_fisico'
    ]);
    // Por fila (F3b): el llamador guarda solo las filas tocadas con sbGuardarFila /
    // sbBorrarFila — sin espejo de tabla completa (adiós pisado entre sesiones).
    if (!opts.porFila) await sbEspejar('presupuestoUnidad');
  } catch (e) { console.error('gsSavePresupuestoUnidad', e); }
}

// Guarda costoAsignaciones POR FILA (diff) en Supabase: sube/borra SOLO las filas que ESTA
// sesión agregó/cambió/quitó vs el último estado guardado (_caSnapshot). NUNCA borra la tabla
// completa → imposible pisar el reparto de otra sesión (admin + facturas a la vez). NO escribe a
// Sheets por-save (era lento y, sin realtime, dejaba la hoja incompleta; el respaldo a Sheets
// queda por "Respaldar a Sheets"). Si Supabase falla, no actualiza el snapshot → reintenta luego.
export async function gsSaveCostoAsignaciones() {
  if (!puedeEditar() && !puedeFacturas()) return;   // rol 'facturas' reparte facturas (devengado)
  if (!guardarPermitido('costoAsignaciones', state.costoAsignaciones)) return;
  if (!sbReady()) return;
  try {
    // FOTO de la lista ANTES de los await: los eventos realtime pueden mutar
    // state.costoAsignaciones DURANTE los await; el diff y el snapshot deben
    // trabajar sobre lo que ESTA sesión decidió persistir, no sobre un array
    // que se mueve (evita la "fila fantasma": UI con filas que ya no existen).
    const filas = state.costoAsignaciones.slice();
    const curIds = new Set();
    const cambios = [];   // filas nuevas o modificadas → upsert
    for (const a of filas) {
      const id = String(a.asignacion_id);
      curIds.add(id);
      const row = _rowCostoAsignacion(a);
      if (_caSnapshot.get(id) !== JSON.stringify(row)) cambios.push(row);
    }
    const borrar = []; // ids que estaban guardados y ya NO están en local → delete (quita de ESTA sesión)
    for (const id of _caSnapshot.keys()) { if (!curIds.has(id)) borrar.push(id); }
    // Snapshot INCREMENTAL tras cada operación exitosa (nada de reconstruirlo
    // completo al final: con realtime, los eventos ajenos ya lo van actualizando
    // por su cuenta vía caSnapshotAplicar/Quitar — reconstruirlo pisaría eso).
    for (const row of cambios) {
      await sbUpsertRow('costo_asignaciones', 'asignacion_id', row);
      _caSnapshot.set(String(row.asignacion_id), JSON.stringify(row));
    }
    for (const id of borrar) {
      await sbDeleteRow('costo_asignaciones', 'asignacion_id', id);
      _caSnapshot.delete(String(id));
    }
  } catch (e) { console.error('gsSaveCostoAsignaciones (por fila)', e); }
}

// ===== Espejo a Supabase (Etapa B — Fase 1: dual-write) =====
// Helpers de coerción para que los tipos calcen con las columnas de Postgres.
const _sbBool = (v) => v === true || v === 'TRUE' || v === 'true' || v === 1;
const _sbNum  = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const _sbStr  = (v) => (v == null ? '' : String(v));

// Mapeos state → filas (objetos) por entidad. Columnas == campos que se
// persisten en Sheets (espejo 1:1). Arrays como JSON nativo (jsonb).
// Mapea UN proveedor → fila Supabase (reusable para guardado por fila, Fase 3).
function _rowProveedor(p) {
  return {
    id: p.id, nombre: _sbStr(p.nombre), rfc: _sbStr(p.rfc), banco: _sbStr(p.banco),
    tipo_cuenta: _sbStr(p.tipo_cuenta), cuenta: _sbStr(p.cuenta), clabe: _sbStr(p.clabe),
    categoria: _sbStr(p.categoria), subcategoria: _sbStr(p.subcategoria),
    proyectos: p.proyectos || [], activo: p.activo !== false,
    bloqueada_para_pago: !!p.bloqueada_para_pago, aliases: p.aliases || []
  };
}
function _rowsProveedores() {
  return state.proveedores.map(_rowProveedor);
}
// INGRESOS (Fase 1) — cliente → fila Supabase. IDs = text (UUID).
function _rowCliente(c) {
  return {
    cliente_id: _sbStr(c.cliente_id), nombre: _sbStr(c.nombre), rfc: _sbStr(c.rfc),
    telefono: _sbStr(c.telefono), email: _sbStr(c.email), observaciones: _sbStr(c.observaciones),
    activo: c.activo !== false
  };
}
function _rowsClientes() {
  return _dedupBy(state.clientes.map(_rowCliente), 'cliente_id');
}
// INGRESOS (Fase 1) — venta → fila Supabase. monto_cobrado/saldo_cliente son DERIVADOS.
function _rowVenta(v) {
  return {
    venta_id: _sbStr(v.venta_id), unidad_id: _sbStr(v.unidad_id), proyecto: _sbStr(v.proyecto),
    cliente_id: _sbStr(v.cliente_id), precio_venta: _sbNum(v.precio_venta), tipo_credito: _sbStr(v.tipo_credito),
    estatus_comercial: _sbStr(v.estatus_comercial || 'apartada'), fecha_apartado: _sbStr(v.fecha_apartado),
    fecha_escritura_estimada: _sbStr(v.fecha_escritura_estimada), fecha_escritura_real: _sbStr(v.fecha_escritura_real),
    valor_liberacion: _sbNum(v.valor_liberacion), credito_id: _sbStr(v.credito_id),
    monto_cobrado: _sbNum(v.monto_cobrado), saldo_cliente: _sbNum(v.saldo_cliente),
    observaciones: _sbStr(v.observaciones), activo: v.activo !== false
  };
}
function _rowsVentas() {
  return _dedupBy(state.ventas.map(_rowVenta), 'venta_id');
}
// INGRESOS (Fase 1) — cobro → fila Supabase. En Fase 1 NO afecta saldos (cuenta_destino_* se guardan pero no aplican).
function _rowCobro(c) {
  return {
    cobro_id: _sbStr(c.cobro_id), venta_id: _sbStr(c.venta_id), cliente_id: _sbStr(c.cliente_id),
    proyecto: _sbStr(c.proyecto), fecha: _sbStr(c.fecha), monto: _sbNum(c.monto),
    tipo_cobro: _sbStr(c.tipo_cobro || 'abono'), metodo: _sbStr(c.metodo || 'transferencia'),
    cuenta_destino_tipo: _sbStr(c.cuenta_destino_tipo), cuenta_destino_id: _sbStr(c.cuenta_destino_id),
    referencia: _sbStr(c.referencia), concepto: _sbStr(c.concepto),
    observaciones: _sbStr(c.observaciones), activo: c.activo !== false
  };
}
function _rowsCobros() {
  return _dedupBy(state.cobros.map(_rowCobro), 'cobro_id');
}
// ESTRATEGIA (Fase 2) — config del motor (valor jsonb nativo) y flags por unidad.
function _rowEstrategiaConfig(c) {
  return {
    clave: _sbStr(c.clave), valor: c.valor === undefined ? null : c.valor,
    descripcion: _sbStr(c.descripcion), grupo: _sbStr(c.grupo || 'general')
  };
}
function _rowsEstrategiaConfig() {
  return _dedupBy(state.estrategiaConfig.map(_rowEstrategiaConfig), 'clave');
}
function _rowEstrategiaFlag(f) {
  return {
    flag_id: _sbStr(f.flag_id), unidad_id: _sbStr(f.unidad_id), proyecto: _sbStr(f.proyecto),
    tipo: _sbStr(f.tipo || 'bloqueo'), categoria: _sbStr(f.categoria),
    fecha_compromiso: _sbStr(f.fecha_compromiso), nota: _sbStr(f.nota), activo: f.activo !== false
  };
}
function _rowsEstrategiaFlags() {
  return _dedupBy(state.estrategiaFlags.map(_rowEstrategiaFlag), 'flag_id');
}
function _rowProyecto(p) {
  return {
    id: _sbStr(p.id), nombre: _sbStr(p.nombre), empresa: _sbStr(p.empresa),
    cuenta: _sbStr(p.cuenta), clabe: _sbStr(p.clabe), color: _sbStr(p.color),
    activo: p.activo !== false, saldo: _sbNum(p.saldo),
    ultima_act_saldo: _sbStr(p.ultima_act_saldo), es_concentradora: _sbBool(p.es_concentradora)
  };
}
function _rowsProyectos() {
  return state.proyectos.map(_rowProyecto);
}
function _rowCuentaPropia(c) {
  return {
    cuenta_id: c.cuenta_id, nombre: _sbStr(c.nombre), banco: _sbStr(c.banco),
    clabe: _sbStr(c.clabe), numero_cuenta: _sbStr(c.numero_cuenta), proyecto: _sbStr(c.proyecto),
    tipo: _sbStr(c.tipo || 'General'), saldo: _sbNum(c.saldo),
    ultima_actualizacion: _sbStr(c.ultima_actualizacion), activo: c.activo !== false
  };
}
function _rowsCuentasPropias() {
  return state.cuentasPropias.map(_rowCuentaPropia);
}
function _rowEmpleado(e) {
  return {
    id: e.id, nombre: _sbStr(e.nombre), puesto: _sbStr(e.puesto), empresa: _sbStr(e.empresa),
    banco: _sbStr(e.banco), tipo_cuenta: _sbStr(e.tipo_cuenta), cuenta: _sbStr(e.cuenta),
    clabe: _sbStr(e.clabe), rfc: _sbStr(e.rfc), activo: e.activo !== false
  };
}
function _rowsEmpleados() {
  return state.empleados.map(_rowEmpleado);
}
// Mapea UN pago del historial → fila Supabase (reusable para guardado por fila).
function _rowHistorial(h) {
  return {
    id: _sbStr(h.id), proveedor_id: _sbStr(h.proveedor_id), factura_id: _sbStr(h.factura_id),
    fecha: _sbStr(h.fecha), nombre: _sbStr(h.nombre), banco: _sbStr(h.banco),
    tipo: _sbStr(h.tipo), concepto: _sbStr(h.concepto), importe: _sbNum(h.importe),
    proyecto: _sbStr(h.proyecto), cuenta_origen: _sbStr(h.cuenta_origen),
    tipo_registro: _sbStr(h.tipo_registro || 'Pago'), partida: _sbStr(h.partida),
    sub_partida: _sbStr(h.sub_partida)
  };
}
function _rowsHistorial() {
  // Dedup por id (el PK es (tenant_id, id)). ensureHistorialIds ya los hace
  // únicos, pero por si una edición manual del Sheet dejó duplicados.
  const seen = new Set();
  const out = [];
  for (const h of state.historial) {
    const id = _sbStr(h.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(_rowHistorial(h));
  }
  return out;
}

// Dedup por campo PK (evita fallar el insert si una edición manual dejó ids
// repetidos o vacíos). Mismo criterio que _rowsHistorial.
function _dedupBy(rows, pk) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = _sbStr(r[pk]);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out;
}

function _rowFactura(f) {
  return {
    factura_id: _sbStr(f.factura_id), numero_factura: _sbStr(f.numero_factura),
    razon_social: _sbStr(f.razon_social), proveedor_id: _sbStr(f.proveedor_id),
    nombre_proveedor: _sbStr(f.nombre_proveedor), fecha_factura: _sbStr(f.fecha_factura),
    fecha_vencimiento: _sbStr(f.fecha_vencimiento), fecha_pago_total: _sbStr(f.fecha_pago_total),
    monto_total: _sbNum(f.monto_total), monto_pagado: _sbNum(f.monto_pagado),
    saldo_pendiente: _sbNum(f.saldo_pendiente), estatus_factura: _sbStr(f.estatus_factura),
    proyecto: _sbStr(f.proyecto), empresa: _sbStr(f.empresa), observaciones: _sbStr(f.observaciones),
    activo: f.activo !== false, uuid: _sbStr(f.uuid),
    // Fase 2: datos fiscales del CFDI.
    subtotal: _sbNum(f.subtotal), descuento: _sbNum(f.descuento),
    iva_trasladado: _sbNum(f.iva_trasladado), retencion_iva: _sbNum(f.retencion_iva),
    retencion_isr: _sbNum(f.retencion_isr),
    nc_subtotal: _sbNum(f.nc_subtotal), nc_iva: _sbNum(f.nc_iva),
    rfc_emisor: _sbStr(f.rfc_emisor),
    estado_sat: _sbStr(f.estado_sat) || 'Vigente', tipo_comprobante: _sbStr(f.tipo_comprobante) || 'Factura'
  };
}
function _rowsFacturas() {
  return _dedupBy(state.facturas.map(_rowFactura), 'factura_id');
}
function _rowFacturaPago(fp) {
  return {
    factura_pago_id: _sbStr(fp.factura_pago_id), factura_id: _sbStr(fp.factura_id),
    pago_id: _sbStr(fp.pago_id), proveedor_id: _sbStr(fp.proveedor_id),
    monto_aplicado: _sbNum(fp.monto_aplicado), fecha_pago: _sbStr(fp.fecha_pago),
    estatus: _sbStr(fp.estatus), observaciones: _sbStr(fp.observaciones)
  };
}
function _rowsFacturaPagos() {
  return _dedupBy(state.facturaPagos.map(_rowFacturaPago), 'factura_pago_id');
}
function _rowTraspaso(t) {
  return {
    traspaso_id: _sbStr(t.traspaso_id), tipo: _sbStr(t.tipo),
    cuenta_origen_id: _sbStr(t.cuenta_origen_id), cuenta_origen_tipo: _sbStr(t.cuenta_origen_tipo),
    cuenta_origen_nombre: _sbStr(t.cuenta_origen_nombre), proyecto_origen: _sbStr(t.proyecto_origen),
    cuenta_destino_id: _sbStr(t.cuenta_destino_id), cuenta_destino_tipo: _sbStr(t.cuenta_destino_tipo),
    cuenta_destino_nombre: _sbStr(t.cuenta_destino_nombre), proyecto_destino: _sbStr(t.proyecto_destino),
    monto: _sbNum(t.monto), fecha: _sbStr(t.fecha), concepto: _sbStr(t.concepto),
    referencia: _sbStr(t.referencia), estatus: _sbStr(t.estatus), fecha_registro: _sbStr(t.fecha_registro)
  };
}
function _rowsTraspasos() {
  return _dedupBy(state.traspasos.map(_rowTraspaso), 'traspaso_id');
}
function _rowMovimientoInterno(m) {
  return {
    id: _sbStr(m.id), fecha: _sbStr(m.fecha), tipo: _sbStr(m.tipo),
    origen: _sbStr(m.origen), destino: _sbStr(m.destino), monto: _sbNum(m.monto),
    concepto: _sbStr(m.concepto), referencia: _sbStr(m.referencia)
  };
}
function _rowsMovimientosInternos() {
  return _dedupBy(state.movimientosInternos.map(_rowMovimientoInterno), 'id');
}
function _rowCredito(c) {
  return {
    credito_id: _sbStr(c.credito_id), nombre: _sbStr(c.nombre), banco: _sbStr(c.banco),
    tipo_credito: _sbStr(c.tipo_credito), monto_autorizado: _sbNum(c.monto_autorizado),
    tasa_base: _sbNum(c.tasa_base), proyecto: _sbStr(c.proyecto), cuenta_pago: _sbStr(c.cuenta_pago),
    estatus: _sbStr(c.estatus), activo: c.activo !== false
  };
}
function _rowsCreditos() {
  return _dedupBy(state.creditos.map(_rowCredito), 'credito_id');
}
function _rowPagare(p) {
  return {
    pagare_id: _sbStr(p.pagare_id), credito_id: _sbStr(p.credito_id),
    numero_pagare: _sbStr(p.numero_pagare), monto: _sbNum(p.monto),
    fecha_disposicion: _sbStr(p.fecha_disposicion), fecha_vencimiento: _sbStr(p.fecha_vencimiento),
    tasa: _sbNum(p.tasa), estatus: _sbStr(p.estatus), activo: p.activo !== false
  };
}
function _rowsPagares() {
  return _dedupBy(state.pagares.map(_rowPagare), 'pagare_id');
}
function _rowPagoPagare(p) {
  return {
    pago_id: _sbStr(p.pago_id), pagare_id: _sbStr(p.pagare_id), credito_id: _sbStr(p.credito_id),
    fecha_pago: _sbStr(p.fecha_pago), monto_intereses: _sbNum(p.monto_intereses),
    concepto: _sbStr(p.concepto), estatus: _sbStr(p.estatus), fecha_real_pago: _sbStr(p.fecha_real_pago)
  };
}
function _rowsPagosPagare() {
  return _dedupBy(state.pagosPagare.map(_rowPagoPagare), 'pago_id');
}
function _rowUnidad(u) {
  const plano = (v) => (v == null || v === '' ? null : _sbNum(v));
  return {
    unidad_id: _sbStr(u.unidad_id), proyecto: _sbStr(u.proyecto), nombre: _sbStr(u.nombre),
    tipo: _sbStr(u.tipo), indiviso_pct: _sbNum(u.indiviso_pct), superficie_m2: _sbNum(u.superficie_m2),
    estatus: _sbStr(u.estatus), fecha_termino: _sbStr(u.fecha_termino), orden: _sbNum(u.orden), activo: u.activo !== false,
    plano_x: plano(u.plano_x), plano_y: plano(u.plano_y), plano_w: plano(u.plano_w), plano_h: plano(u.plano_h)
  };
}
function _rowsUnidades() {
  return _dedupBy(state.unidades.map(_rowUnidad), 'unidad_id');
}
function _rowFiscalMarca(m) {
  return {
    marca_id: _sbStr(m.marca_id), doc_tipo: _sbStr(m.doc_tipo), doc_id: _sbStr(m.doc_id),
    incluir: m.incluir !== false, motivo: _sbStr(m.motivo), usuario_email: _sbStr(m.usuario_email)
  };
}
function _rowsFiscalMarcas() {
  return _dedupBy(state.fiscalMarcas.map(_rowFiscalMarca), 'marca_id');
}
function _rowPresupuestoUnidad(p) {
  return {
    presupuesto_id: _sbStr(p.presupuesto_id), unidad_id: _sbStr(p.unidad_id),
    partida: _sbStr(p.partida), sub_partida: _sbStr(p.sub_partida),
    monto_presupuestado: _sbNum(p.monto_presupuestado), costo_inicial: _sbNum(p.costo_inicial),
    notas: _sbStr(p.notas), avance_fisico: _sbNum(p.avance_fisico)
  };
}
function _rowsPresupuestoUnidad() {
  return _dedupBy(state.presupuestoUnidad.map(_rowPresupuestoUnidad), 'presupuesto_id');
}
function _rowCostoAsignacion(a) {
  return {
    asignacion_id: _sbStr(a.asignacion_id), pago_id: _sbStr(a.pago_id), unidad_id: _sbStr(a.unidad_id),
    proyecto: _sbStr(a.proyecto), metodo: _sbStr(a.metodo), monto_asignado: _sbNum(a.monto_asignado),
    factor: _sbNum(a.factor), fecha_asignacion: _sbStr(a.fecha_asignacion), partida_override: _sbStr(a.partida_override),
    factura_id: _sbStr(a.factura_id), sub_partida_override: _sbStr(a.sub_partida_override),
    partida_obra: _sbStr(a.partida_obra)
  };
}
function _rowsCostoAsignaciones() {
  return _dedupBy(state.costoAsignaciones.map(_rowCostoAsignacion), 'asignacion_id');
}
// Snapshot (asignacion_id → JSON de la fila) de lo último persistido en Supabase, para guardar
// costoAsignaciones POR FILA (diff): así NUNCA se borra la tabla completa ni se pisa el reparto
// de otra sesión. Se (re)arma al cargar y tras cada guardado exitoso.
let _caSnapshot = new Map();
function _resetCaSnapshot() {
  _caSnapshot = new Map(state.costoAsignaciones.map(a => [String(a.asignacion_id), JSON.stringify(_rowCostoAsignacion(a))]));
}
// Hooks para REALTIME (repartos en vivo): el snapshot debe SEGUIR a los eventos.
// Si una fila ajena entra al state sin entrar aquí, el diff del guardado la vería
// como "nueva" y la re-upsertearía en cada guardado (amplificación sin techo).
export function caSnapshotAplicar(a) {
  _caSnapshot.set(String(a.asignacion_id), JSON.stringify(_rowCostoAsignacion(a)));
}
export function caSnapshotQuitar(id) {
  _caSnapshot.delete(String(id));
}
function _rowPartidaCatalogo(p) {
  return {
    partida_id: _sbStr(p.id), partida: _sbStr(p.partida), subpartidas: p.subpartidas || [],
    orden: _sbNum(p.orden), activa: p.activa !== false,
    visible_obra: p.visibleObra !== false
  };
}
function _rowsPartidasCatalogo() {
  return _dedupBy(state.partidasCatalogo.map(_rowPartidaCatalogo), 'partida_id');
}
function _rowPartidaObra(p) {
  return {
    partida_obra_id: _sbStr(p.id), nombre: _sbStr(p.nombre), proyecto: _sbStr(p.proyecto),
    partida_admin: _sbStr(p.partidaAdmin), sub_partida_admin: _sbStr(p.subPartidaAdmin),
    orden: _sbNum(p.orden), activa: p.activa !== false
  };
}
function _rowsPartidasObra() {
  return _dedupBy(state.partidasObra.map(_rowPartidaObra), 'partida_obra_id');
}
function _rowsPendientes() {
  return _dedupBy(state.pendientesConfirmacion.map(p => ({
    id: _sbStr(p.id), proveedor_id: _sbStr(p.proveedor_id), factura_id: _sbStr(p.factura_id),
    nombre: _sbStr(p.nombre), cuenta: _sbStr(p.cuenta), banco: _sbStr(p.banco),
    tipo: _sbStr(p.tipo), concepto: _sbStr(p.concepto), importe: _sbNum(p.importe),
    proyecto: _sbStr(p.proyecto), partida: _sbStr(p.partida), cuenta_cargo: _sbStr(p.cuenta_cargo),
    fecha_gen: _sbStr(p.fechaGen), confirmado: p.confirmado !== false, sub_partida: _sbStr(p.sub_partida),
    asignaciones_planificadas: { a: p.asignacionesPlanificadas || [], m: p.repartoMetodo || null },
    partida_obra: _sbStr(p.partidaObra)
  })), 'id');
}

// Registro entidad → { tabla Supabase, función que arma las filas }.
// Conforme se agregan entidades aquí, "Migrar TODO" y el dual-write las cubren.
const SB_ENTIDADES = {
  proveedores:        { tabla: 'proveedores',         rows: _rowsProveedores, idCol: 'id', rowOne: _rowProveedor },
  clientes:           { tabla: 'clientes',            rows: _rowsClientes, idCol: 'cliente_id', rowOne: _rowCliente },
  ventas:             { tabla: 'ventas',              rows: _rowsVentas, idCol: 'venta_id', rowOne: _rowVenta },
  cobros:             { tabla: 'cobros',              rows: _rowsCobros, idCol: 'cobro_id', rowOne: _rowCobro },
  estrategiaConfig:   { tabla: 'estrategia_config',   rows: _rowsEstrategiaConfig, idCol: 'clave', rowOne: _rowEstrategiaConfig },
  estrategiaFlags:    { tabla: 'estrategia_flags_unidad', rows: _rowsEstrategiaFlags, idCol: 'flag_id', rowOne: _rowEstrategiaFlag },
  proyectos:          { tabla: 'proyectos',           rows: _rowsProyectos, idCol: 'id', rowOne: _rowProyecto },
  cuentasPropias:     { tabla: 'cuentas_propias',     rows: _rowsCuentasPropias, idCol: 'cuenta_id', rowOne: _rowCuentaPropia },
  empleados:          { tabla: 'empleados',           rows: _rowsEmpleados, idCol: 'id', rowOne: _rowEmpleado },
  historial:          { tabla: 'historial',           rows: _rowsHistorial, idCol: 'id', rowOne: _rowHistorial },
  facturas:           { tabla: 'facturas',            rows: _rowsFacturas, idCol: 'factura_id', rowOne: _rowFactura },
  facturaPagos:       { tabla: 'factura_pagos',       rows: _rowsFacturaPagos, idCol: 'factura_pago_id', rowOne: _rowFacturaPago },
  traspasos:          { tabla: 'traspasos',           rows: _rowsTraspasos, idCol: 'traspaso_id', rowOne: _rowTraspaso },
  movimientosInternos:{ tabla: 'movimientos_internos',rows: _rowsMovimientosInternos, idCol: 'id', rowOne: _rowMovimientoInterno },
  creditos:           { tabla: 'creditos',            rows: _rowsCreditos, idCol: 'credito_id', rowOne: _rowCredito },
  pagares:            { tabla: 'pagares',             rows: _rowsPagares, idCol: 'pagare_id', rowOne: _rowPagare },
  pagosPagare:        { tabla: 'pagos_pagare',        rows: _rowsPagosPagare, idCol: 'pago_id', rowOne: _rowPagoPagare },
  unidades:           { tabla: 'unidades',            rows: _rowsUnidades, idCol: 'unidad_id', rowOne: _rowUnidad },
  presupuestoUnidad:  { tabla: 'presupuesto_unidad',  rows: _rowsPresupuestoUnidad, idCol: 'presupuesto_id', rowOne: _rowPresupuestoUnidad },
  fiscalMarcas:       { tabla: 'fiscal_marcas',       rows: _rowsFiscalMarcas, idCol: 'marca_id', rowOne: _rowFiscalMarca },
  costoAsignaciones:  { tabla: 'costo_asignaciones',  rows: _rowsCostoAsignaciones, idCol: 'asignacion_id', rowOne: _rowCostoAsignacion },
  partidasCatalogo:   { tabla: 'partidas_catalogo',   rows: _rowsPartidasCatalogo, idCol: 'partida_id', rowOne: _rowPartidaCatalogo },
  partidasObra:       { tabla: 'partidas_obra',       rows: _rowsPartidasObra, idCol: 'partida_obra_id', rowOne: _rowPartidaObra },
  pendientesConfirmacion: { tabla: 'pendientes_confirmacion', rows: _rowsPendientes }
};

// Espeja UNA entidad a Supabase tras guardarla en Sheets (dual-write).
// Degradación suave: si falla, avisa pero NO rompe el guardado a Sheets.
async function sbEspejar(key) {
  if (!sbReady()) return;
  const def = SB_ENTIDADES[key];
  if (!def) return;
  try {
    await sbReplaceTable(def.tabla, def.rows());
  } catch (e) {
    console.warn(`Espejo ${def.tabla} → Supabase falló:`, e);
    notify(`⚠ ${def.tabla} guardado en Sheets, pero no se espejó a Supabase: ` + (e.message || e), 'error');
  }
}

// Guarda UNA fila a Supabase (Fase 3, guardado por fila). Degradación suave:
// si falla, avisa pero NO rompe el guardado a Sheets. `item` es el objeto del
// state (un proveedor, etc.); usa el mapeo `rowOne` de SB_ENTIDADES[key].
export async function sbGuardarFila(key, item) {
  // Backstop de rol: solo_lectura/contabilidad/lector nunca escriben. El rol
  // 'facturas' (Gonzalo) SÍ escribe facturas/facturaPagos, y 'historial' SOLO
  // vía la herramienta de vincular pago→factura (no tiene otra vía de UI: todos
  // los editores del historial van con .req-editor, que ese rol no ve).
  // Marcas fiscales: SOLO admin (la RLS también lo exige; esto evita el intento).
  if (key === 'fiscalMarcas' && !esAdmin()) return;
  const esFactKey = key === 'facturas' || key === 'facturaPagos' || key === 'historial';
  const esObraKey = key === 'unidades' || key === 'presupuestoUnidad';
  if (!puedeEditar() && !(esFactKey && puedeFacturas()) && !(esObraKey && puedeCapturarObra())) return;
  // Ligar/desligar pagos↔facturas es un permiso APARTE: 'facturas_obra' (Anahi)
  // captura facturas pero NO aplica pagos (backstop más profundo del vínculo).
  if (key === 'facturaPagos' && !puedeLigarPagos()) return;
  if (!sbReady()) return;
  const def = SB_ENTIDADES[key];
  if (!def || !def.rowOne || !def.idCol) return;
  try {
    await sbUpsertRow(def.tabla, def.idCol, def.rowOne(item));
  } catch (e) {
    console.warn(`Guardar fila ${def.tabla} → Supabase falló:`, e);
    notify(`⚠ ${def.tabla}: no se guardó esa fila en Supabase: ` + (e.message || e), 'error');
  }
}

// Borra UNA fila de Supabase (Fase 3). `idValue` = el id de la fila a borrar.
export async function sbBorrarFila(key, idValue) {
  // Backstop de rol (ver sbGuardarFila): 'facturas' borra facturaPagos al
  // eliminar un pago a factura.
  // Marcas fiscales: SOLO admin (la RLS también lo exige; esto evita el intento).
  if (key === 'fiscalMarcas' && !esAdmin()) return;
  const esFactKey = key === 'facturas' || key === 'facturaPagos' || key === 'historial';
  const esObraKey = key === 'unidades' || key === 'presupuestoUnidad';
  if (!puedeEditar() && !(esFactKey && puedeFacturas()) && !(esObraKey && puedeCapturarObra())) return;
  // Ligar/desligar pagos↔facturas es un permiso APARTE: 'facturas_obra' (Anahi)
  // captura facturas pero NO aplica pagos (backstop más profundo del vínculo).
  if (key === 'facturaPagos' && !puedeLigarPagos()) return;
  if (!sbReady()) return;
  const def = SB_ENTIDADES[key];
  if (!def || !def.idCol) return;
  try {
    await sbDeleteRow(def.tabla, def.idCol, idValue);
  } catch (e) {
    console.warn(`Borrar fila ${def.tabla} → Supabase falló:`, e);
    notify(`⚠ ${def.tabla}: no se borró esa fila en Supabase: ` + (e.message || e), 'error');
  }
}

// Botón "Migrar TODO a Supabase": recarga de Sheets (toma ediciones manuales) y
// espeja TODAS las entidades del registro. Sirve igual para migración inicial
// que para re-sincronizar tras editar el Sheet a mano. Idempotente.
export async function migrarTodoASupabase() {
  if (!state.gsToken) { notify('Conecta Google Sheets primero', 'error'); return; }
  if (!sbReady()) { notify('Inicia sesión en la app (Supabase) primero', 'error'); return; }
  // Confirmación FUERTE (type-to-confirm): sobrescribe Supabase con el contenido del
  // Sheet (puede pisar cambios recientes). Pedir escribir "SUBIR" evita dispararlo por
  // accidente con un solo clic/Aceptar.
  const _resp = prompt('⚠️ ACCIÓN DELICADA — "Subir cambios del Sheet"\n\nRECARGA todo desde el Google Sheet y SOBRESCRIBE Supabase con esa versión (puede PISAR cambios recientes hechos en la app). Úsalo SOLO si editaste el Google Sheet a mano y quieres subir ESO.\n\nPara confirmar, escribe:  SUBIR');
  if (!_resp || _resp.trim().toUpperCase() !== 'SUBIR') { notify('Cancelado: no se escribió SUBIR.', 'error'); return; }
  notify('Migrando a Supabase: recargando de Sheets...');
  await gsLoadAll();
  let ok = 0, fail = 0;
  for (const key of Object.keys(SB_ENTIDADES)) {
    // El reparto (costoAsignaciones) vive SOLO en Supabase (se guarda por fila/diff); su hoja ya no
    // se mantiene al día, así que NO debe sobrescribirse desde el Sheet (pisaría el reparto bueno).
    // INGRESOS (clientes/ventas/cobros) y ESTRATEGIA (config/flags) tampoco tienen hoja aún y solo
    // se cargan con su módulo activo → sobrescribirlos aquí desde un state vacío BORRARÍA la tabla.
    if (key === 'costoAsignaciones' || key === 'clientes' || key === 'ventas' || key === 'cobros'
      || key === 'estrategiaConfig' || key === 'estrategiaFlags' || key === 'fiscalMarcas') continue;
    const def = SB_ENTIDADES[key];
    try {
      const n = await sbReplaceTable(def.tabla, def.rows());
      ok++;
      console.log(`✓ ${def.tabla}: ${n} filas`);
    } catch (e) {
      fail++;
      console.error(`✗ ${def.tabla}:`, e);
    }
  }
  if (fail === 0) notify(`✅ Migrado a Supabase: ${ok} tablas`, 'success');
  else notify(`Migración parcial: ${ok} OK, ${fail} con error. Revisa F12 — ¿corriste el SQL de esas tablas?`, 'error');
}

// Botón "Respaldar a Sheets" (solo admin): empuja TODO el estado actual al Google
// Sheet. Supabase es la fuente; esto pone el respaldo al día cuando el admin quiera
// (útil porque el capturista guarda sin Google y el Sheet se queda atrás). Llama
// cada gsSaveX con {porFila:true} → escribe Sheets sin re-espejar Supabase (evita la
// tormenta de realtime del delete+insert masivo).
export async function respaldarTodoASheets() {
  if (!esAdmin()) { notify('Solo el admin puede respaldar a Sheets', 'error'); return; }
  if (!state.gsToken) { notify('Conecta Google primero para respaldar a Sheets', 'error'); return; }
  if (!confirm('Esto SOBRESCRIBE el Google Sheet con la versión actual (la que ves desde Supabase).\n\nÚsalo para poner el respaldo al día.\n\n¿Continuar?')) return;
  notify('Respaldando todo a Sheets...');
  const savers = [
    gsSaveProveedores, gsSaveEmpleados, gsSaveProyectos, gsSaveCuentasPropias,
    gsSaveHistorial, gsSaveFacturas, gsSaveFacturaPagos, gsSaveTraspasos,
    gsSaveMovimientosInternos, gsSaveCreditos, gsSavePagares, gsSavePagosPagare,
    gsSaveUnidades, gsSavePresupuestoUnidad, gsSaveCostoAsignaciones,
    gsSavePartidasCatalogo, gsSavePartidasObra, gsSavePendientes
  ];
  // INGRESOS (Fase 1): incluir en el respaldo solo si el módulo está activo. Cada
  // saver además se autoprotege con guardarPermitido (no escribe si no cargó).
  if (ingresosDataActiva()) savers.push(gsSaveClientes, gsSaveVentas, gsSaveCobros);
  if (estrategiaActivo()) savers.push(gsSaveEstrategiaConfig, gsSaveEstrategiaFlags);
  let ok = 0, fail = 0;
  for (const fn of savers) {
    try { await fn({ porFila: true }); ok++; }
    catch (e) { fail++; console.error('respaldarTodoASheets', fn.name, e); }
  }
  if (fail === 0) notify(`✅ Respaldado a Sheets: ${ok} tablas`, 'success');
  else notify(`Respaldo parcial: ${ok} OK, ${fail} con error (revisa F12)`, 'error');
}

export async function gsSaveProveedores(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('proveedores', state.proveedores)) return;
  try {
    const rows = state.proveedores.map(p => [p.id, p.nombre, p.rfc || '', p.banco, p.tipo_cuenta, p.cuenta, p.clabe || '', p.categoria, p.subcategoria || '', (p.proyectos || []).join('|'), p.activo, p.bloqueada_para_pago || false]);
    await gsClearAndWrite('proveedores', rows, ['proveedor_id', 'nombre', 'rfc', 'banco', 'tipo_cuenta', 'cuenta', 'clabe', 'categoria', 'Subcategoria', 'proyectos', 'activo', 'bloqueada_para_pago']);
    if (state.gsToken) notify('✅ Proveedores guardados en Sheets');
    // Fase 3: en modo 'fila' el caller ya guardó la fila puntual a Supabase, así
    // que NO espejamos la tabla completa (evita el delete+insert masivo y la
    // cascada de eventos de realtime). En modo 'tabla' se espeja como siempre.
    if (!opts.porFila) await sbEspejar('proveedores');
  } catch (e) { notify('Error guardando proveedores: ' + e.message, 'error'); }
}

// INGRESOS (Fase 1) — guarda la tabla clientes a Sheets (no-op sin Google) y, en
// modo 'tabla', espeja a Supabase. En modo 'fila' el caller ya subió la fila con
// sbGuardarFila. La pestaña de Sheets se crea en Etapa 6; hasta entonces esto
// degrada suave (sin Google no escribe nada; con Google y sin pestaña, fail-soft).
export async function gsSaveClientes(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('clientes', state.clientes)) return;
  try {
    const rows = state.clientes.map(c => [c.cliente_id, c.nombre, c.rfc || '', c.telefono || '', c.email || '', c.observaciones || '', c.activo !== false]);
    await gsClearAndWrite('clientes', rows, ['cliente_id', 'nombre', 'rfc', 'telefono', 'email', 'observaciones', 'activo']);
    if (!opts.porFila) await sbEspejar('clientes');
  } catch (e) { console.error('gsSaveClientes', e); }
}

// INGRESOS (Fase 1) — guarda la tabla ventas a Sheets (no-op sin Google). Misma
// degradación suave que gsSaveClientes; pestaña de Sheets en Etapa 6.
export async function gsSaveVentas(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('ventas', state.ventas)) return;
  try {
    const rows = state.ventas.map(v => [v.venta_id, v.unidad_id, v.proyecto, v.cliente_id, v.precio_venta || 0, v.tipo_credito || '', v.estatus_comercial || 'apartada', v.fecha_apartado || '', v.fecha_escritura_estimada || '', v.fecha_escritura_real || '', v.valor_liberacion || 0, v.credito_id || '', v.monto_cobrado || 0, v.saldo_cliente || 0, v.observaciones || '', v.activo !== false]);
    await gsClearAndWrite('ventas', rows, ['venta_id', 'unidad_id', 'proyecto', 'cliente_id', 'precio_venta', 'tipo_credito', 'estatus_comercial', 'fecha_apartado', 'fecha_escritura_estimada', 'fecha_escritura_real', 'valor_liberacion', 'credito_id', 'monto_cobrado', 'saldo_cliente', 'observaciones', 'activo']);
    if (!opts.porFila) await sbEspejar('ventas');
  } catch (e) { console.error('gsSaveVentas', e); }
}

// INGRESOS (Fase 1) — guarda la tabla cobros a Sheets (no-op sin Google). Pestaña
// de Sheets en Etapa 6. En Fase 1 el cobro NO toca saldos (efecto diferido).
export async function gsSaveCobros(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('cobros', state.cobros)) return;
  try {
    const rows = state.cobros.map(c => [c.cobro_id, c.venta_id, c.cliente_id, c.proyecto, c.fecha, c.monto || 0, c.tipo_cobro || 'abono', c.metodo || 'transferencia', c.cuenta_destino_tipo || '', c.cuenta_destino_id || '', c.referencia || '', c.concepto || '', c.observaciones || '', c.activo !== false]);
    await gsClearAndWrite('cobros', rows, ['cobro_id', 'venta_id', 'cliente_id', 'proyecto', 'fecha', 'monto', 'tipo_cobro', 'metodo', 'cuenta_destino_tipo', 'cuenta_destino_id', 'referencia', 'concepto', 'observaciones', 'activo']);
    if (!opts.porFila) await sbEspejar('cobros');
  } catch (e) { console.error('gsSaveCobros', e); }
}

// ESTRATEGIA (Fase 2) — savers (Sheets no-op sin Google; pestañas en Etapa 7).
export async function gsSaveEstrategiaConfig(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('estrategiaConfig', state.estrategiaConfig)) return;
  try {
    const rows = state.estrategiaConfig.map(c => [c.clave, JSON.stringify(c.valor), c.descripcion || '', c.grupo || 'general']);
    await gsClearAndWrite('estrategia_config', rows, ['clave', 'valor', 'descripcion', 'grupo']);
    if (!opts.porFila) await sbEspejar('estrategiaConfig');
  } catch (e) { console.error('gsSaveEstrategiaConfig', e); }
}
export async function gsSaveEstrategiaFlags(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('estrategiaFlags', state.estrategiaFlags, true)) return;
  try {
    const rows = state.estrategiaFlags.map(f => [f.flag_id, f.unidad_id, f.proyecto || '', f.tipo || 'bloqueo', f.categoria || '', f.fecha_compromiso || '', f.nota || '', f.activo !== false]);
    await gsClearAndWrite('estrategia_flags_unidad', rows, ['flag_id', 'unidad_id', 'proyecto', 'tipo', 'categoria', 'fecha_compromiso', 'nota', 'activo']);
    if (!opts.porFila) await sbEspejar('estrategiaFlags');
  } catch (e) { console.error('gsSaveEstrategiaFlags', e); }
}

export async function gsSaveAlias(nombreOriginal, provId) {
  if (!puedeEditar()) return;
  try {
    const fecha = new Date().toISOString().split('T')[0];
    await gsAppendRow('aliases', [nombreOriginal, provId, fecha]);
  } catch (e) { console.error('gsSaveAlias error', e); }
}

export async function gsSaveEmpleados(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('empleados', state.empleados)) return;
  try {
    const rows = state.empleados.map(e => [e.id, e.nombre, e.puesto || '', e.empresa || '', e.banco, e.tipo_cuenta, e.cuenta, e.clabe || '', e.rfc || '', e.activo]);
    await gsClearAndWrite('empleados', rows, ['id', 'nombre', 'puesto', 'empresa', 'banco', 'tipo_cuenta', 'cuenta', 'clabe', 'rfc', 'activo']);
    if (state.gsToken) notify('✅ Empleados guardados en Sheets');
    if (!opts.porFila) await sbEspejar('empleados');
  } catch (e) { console.error('gsSaveEmpleados', e); }
}

export async function gsSaveFacturas(opts = {}) {
  if (!puedeEditar() && !puedeFacturas()) return;
  if (!guardarPermitido('facturas', state.facturas)) return;
  try {
    // Fase 2: los 8 campos fiscales (CFDI) van AL FINAL (índices 16-23) para no
    // desalinear las filas viejas del Sheet, que se leen por posición en gsLoadAll.
    const rows = state.facturas.map(f => [f.factura_id, f.numero_factura || '', f.razon_social || '', f.proveedor_id, f.nombre_proveedor || '', f.fecha_factura, f.fecha_vencimiento || '', f.fecha_pago_total || '', f.monto_total, f.monto_pagado, f.saldo_pendiente, f.estatus_factura, f.proyecto, f.observaciones, f.activo, f.uuid || '', f.subtotal || 0, f.descuento || 0, f.iva_trasladado || 0, f.retencion_iva || 0, f.retencion_isr || 0, f.rfc_emisor || '', f.estado_sat || '', f.tipo_comprobante || '']);
    await gsClearAndWrite('facturas', rows, ['factura_id', 'Numero_Factura', 'razon_social', 'proveedor_id', 'nombre_proveedor', 'fecha_factura', 'fecha_vencimiento', 'fecha_pago_total', 'monto_total', 'monto_pagado', 'saldo_pendiente', 'estatus_factura', 'proyecto', 'observaciones', 'activo', 'uuid', 'subtotal', 'descuento', 'iva_trasladado', 'retencion_iva', 'retencion_isr', 'rfc_emisor', 'estado_sat', 'tipo_comprobante']);
    if (!opts.porFila) await sbEspejar('facturas');
  } catch (e) { console.error('gsSaveFacturas', e); }
}

export async function gsSaveFacturaPagos(opts = {}) {
  if (!puedeLigarPagos()) return;   // permiso específico del vínculo pago↔factura
  if (!guardarPermitido('facturaPagos', state.facturaPagos)) return;
  try {
    const rows = state.facturaPagos.map(fp => [fp.factura_pago_id, fp.factura_id, fp.pago_id, fp.proveedor_id, fp.monto_aplicado, fp.fecha_pago, fp.estatus, fp.observaciones]);
    await gsClearAndWrite('factura_pagos', rows, ['factura_pago_id', 'factura_id', 'pago_id', 'proveedor_id', 'monto_aplicado', 'fecha_pago', 'estatus', 'observaciones']);
    if (!opts.porFila) await sbEspejar('facturaPagos');
  } catch (e) { console.error('gsSaveFacturaPagos', e); }
}

export async function gsSaveCuentasPropias(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('cuentasPropias', state.cuentasPropias)) return;
  try {
    const rows = state.cuentasPropias.map(c => [c.cuenta_id, c.nombre, c.banco, c.clabe || '', c.numero_cuenta || '', c.proyecto || '', c.tipo || 'General', c.saldo, c.ultima_actualizacion || '', c.activo]);
    await gsClearAndWrite('cuentas_propias', rows, ['cuenta_id', 'nombre', 'banco', 'clabe', 'numero_cuenta', 'proyecto', 'tipo', 'saldo', 'ultima_actualizacion', 'activo']);
    if (!opts.porFila) await sbEspejar('cuentasPropias');
  } catch (e) { console.error('gsSaveCuentasPropias', e); }
}

export async function gsSaveTraspasos(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('traspasos', state.traspasos)) return;
  try {
    const rows = state.traspasos.map(t => [
      t.traspaso_id, t.tipo,
      t.cuenta_origen_id, t.cuenta_origen_tipo, t.cuenta_origen_nombre, t.proyecto_origen,
      t.cuenta_destino_id, t.cuenta_destino_tipo, t.cuenta_destino_nombre, t.proyecto_destino,
      t.monto, t.fecha, t.concepto, t.referencia, t.estatus, t.fecha_registro
    ]);
    await gsClearAndWrite('traspasos', rows, [
      'traspaso_id', 'tipo',
      'cuenta_origen_id', 'cuenta_origen_tipo', 'cuenta_origen_nombre', 'proyecto_origen',
      'cuenta_destino_id', 'cuenta_destino_tipo', 'cuenta_destino_nombre', 'proyecto_destino',
      'monto', 'fecha', 'concepto', 'referencia', 'estatus', 'fecha_registro'
    ]);
    if (!opts.porFila) await sbEspejar('traspasos');
  } catch (e) { console.error('gsSaveTraspasos', e); }
}

export async function gsSaveCreditos(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('creditos', state.creditos)) return;
  try {
    const rows = state.creditos.map(c => [
      c.credito_id, c.nombre, c.banco, c.tipo_credito, c.monto_autorizado,
      c.tasa_base, c.proyecto || '', c.cuenta_pago || '', c.estatus, c.activo
    ]);
    await gsClearAndWrite('creditos', rows, [
      'credito_id', 'nombre', 'banco', 'tipo_credito', 'monto_autorizado',
      'tasa_base', 'proyecto', 'cuenta_pago', 'estatus', 'activo'
    ]);
    if (!opts.porFila) await sbEspejar('creditos');
  } catch (e) { console.error('gsSaveCreditos', e); }
}

export async function gsSavePagares(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('pagares', state.pagares)) return;
  try {
    const rows = state.pagares.map(p => [
      p.pagare_id, p.credito_id, p.numero_pagare, p.monto,
      p.fecha_disposicion, p.fecha_vencimiento, p.tasa, p.estatus, p.activo
    ]);
    await gsClearAndWrite('pagares', rows, [
      'pagare_id', 'credito_id', 'numero_pagare', 'monto',
      'fecha_disposicion', 'fecha_vencimiento', 'tasa', 'estatus', 'activo'
    ]);
    if (!opts.porFila) await sbEspejar('pagares');
  } catch (e) { console.error('gsSavePagares', e); }
}

export async function gsSavePagosPagare(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('pagosPagare', state.pagosPagare)) return;
  try {
    const rows = state.pagosPagare.map(p => [
      p.pago_id, p.pagare_id, p.credito_id, p.fecha_pago,
      p.monto_intereses, p.concepto || '', p.estatus, p.fecha_real_pago || ''
    ]);
    await gsClearAndWrite('pagos_pagare', rows, [
      'pago_id', 'pagare_id', 'credito_id', 'fecha_pago',
      'monto_intereses', 'concepto', 'estatus', 'fecha_real_pago'
    ]);
    if (!opts.porFila) await sbEspejar('pagosPagare');
  } catch (e) { console.error('gsSavePagosPagare', e); }
}

export async function gsSaveMovimientosInternos(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('movimientosInternos', state.movimientosInternos)) return;
  try {
    const rows = state.movimientosInternos.map(m => [m.id, m.fecha, m.tipo, m.origen, m.destino, m.monto, m.concepto, m.referencia]);
    await gsClearAndWrite('movimientos_internos', rows, ['id', 'fecha', 'tipo', 'origen', 'destino', 'monto', 'concepto', 'referencia']);
    if (!opts.porFila) await sbEspejar('movimientosInternos');
  } catch (e) { console.error('gsSaveMovimientosInternos', e); }
}

export async function gsSavePartidasObra(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('partidasObra', state.partidasObra, true)) return;
  try {
    const rows = state.partidasObra.map(p => [
      p.id || '', p.nombre || '', p.proyecto || '',
      p.partidaAdmin || '', p.subPartidaAdmin || '',
      p.orden || 0, p.activa === false ? 'false' : 'true'
    ]);
    await gsClearAndWrite('partidas_obra', rows, ['partida_obra_id', 'nombre', 'proyecto', 'partida_admin', 'sub_partida_admin', 'orden', 'activa']);
    if (!opts.porFila) await sbEspejar('partidasObra');
  } catch (e) { console.error('gsSavePartidasObra', e); }
}

export async function gsSavePartidasCatalogo(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('partidasCatalogo', state.partidasCatalogo, true)) return;
  try {
    const rows = state.partidasCatalogo.map(p => [
      p.id || '', p.partida || '', (p.subpartidas || []).join('|'),
      p.orden || 0, p.activa === false ? 'false' : 'true',
      p.visibleObra === false ? 'false' : 'true'
    ]);
    await gsClearAndWrite('partidas_catalogo', rows, ['partida_id', 'partida', 'subpartidas', 'orden', 'activa', 'visible_obra']);
    if (!opts.porFila) await sbEspejar('partidasCatalogo');
  } catch (e) { console.error('gsSavePartidasCatalogo', e); }
}

export async function gsSaveProyectos(opts = {}) {
  if (!puedeEditar()) return;
  if (!guardarPermitido('proyectos', state.proyectos)) return;
  try {
    const rows = state.proyectos.map(p => [p.id, p.nombre, p.empresa || '', p.cuenta || '', p.clabe || '', p.color || '', p.activo, p.saldo || 0, p.ultima_act_saldo || '', p.es_concentradora || false]);
    await gsClearAndWrite('proyectos', rows, ['id', 'nombre', 'empresa', 'cuenta', 'clabe', 'color', 'activo', 'saldo', 'ultima_act_saldo', 'es_concentradora']);
    if (state.gsToken) notify('✅ Proyectos guardados en Sheets');
    if (!opts.porFila) await sbEspejar('proyectos');
  } catch (e) { console.error('gsSaveProyectos', e); }
}

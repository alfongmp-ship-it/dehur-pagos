import { state } from '../state.js';
import { notify } from '../ui/notify.js';
import { gsReadSheet, gsWriteRange, gsClearAndWrite, gsAppendRow } from './google-sheets.js';
import { normalizeBanco } from '../config/bancos.js';
import { SUB_PARTIDAS_CONSTRUCCION } from '../config/sub-partidas.js';
import { sbReplaceTable, sbLoadTable, sbReady } from './supabase-data.js';

// ============================================================================
// BANDERA DE FUENTE DE LECTURA (Fase 2). Controla de dónde lee la app al cargar.
//   'supabase' → lee de Supabase (con fallback automático a Sheets si falla).
//   'sheets'   → lee de Sheets (comportamiento original).
// Para REVERTIR el flip: cambiar a 'sheets' y hacer push. Los GUARDADOS no
// cambian (siguen escribiendo a Sheets + Supabase).
// ============================================================================
export const FUENTE_LECTURA = 'supabase';

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
        uuid: r[15] || ''
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
        factura_pago_id: parseInt(r[0]) || 0,
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
        plano_h: (r[12] === undefined || r[12] === '') ? null : parseFloat(r[12])
      }));
      state.nextUnidadId = state.unidades.reduce((m, u) => Math.max(m, u.unidad_id), 0) + 1;
    }

    // Load presupuesto_unidad
    const buRows = await leerHoja('presupuesto_unidad', 'presupuestoUnidad');
    if (buRows && buRows.length > 1) {
      state.presupuestoUnidad = buRows.slice(1).filter(r => r[0]).map(r => ({
        presupuesto_id: parseInt(r[0]) || 0,
        unidad_id: parseInt(r[1]) || 0,
        partida: r[2] || '',
        sub_partida: r[3] || '',
        monto_presupuestado: parseFloat(r[4]) || 0,
        costo_inicial: parseFloat(r[5]) || 0,
        notas: r[6] || ''
      }));
      state.nextPresupuestoId = state.presupuestoUnidad.reduce((m, p) => Math.max(m, p.presupuesto_id), 0) + 1;
    }

    // Load costo_asignaciones
    const caRows = await leerHoja('costo_asignaciones', 'costoAsignaciones');
    if (caRows && caRows.length > 1) {
      state.costoAsignaciones = caRows.slice(1).filter(r => r[0]).map(r => ({
        asignacion_id: parseInt(r[0]) || 0,
        pago_id: r[1] || '',
        unidad_id: parseInt(r[2]) || 0,
        proyecto: r[3] || '',
        metodo: r[4] || 'directo',
        monto_asignado: parseFloat(r[5]) || 0,
        factor: parseFloat(r[6]) || 0,
        fecha_asignacion: r[7] || '',
        partida_override: r[8] || ''
      }));
      state.nextAsignacionId = state.costoAsignaciones.reduce((m, a) => Math.max(m, a.asignacion_id), 0) + 1;
    }

    // Load partidas_catalogo (catálogo editable de partidas y subpartidas)
    const pcatRows = await leerHoja('partidas_catalogo', 'partidasCatalogo');
    if (pcatRows && pcatRows.length > 1) {
      state.partidasCatalogo = pcatRows.slice(1).filter(r => r[0] || r[1]).map(r => ({
        id: r[0] || '',
        partida: r[1] || '',
        subpartidas: (r[2] || '').split('|').map(s => s.trim()).filter(Boolean),
        orden: parseInt(r[3]) || 0,
        activa: r[4] !== 'false' && r[4] !== 'FALSE' && r[4] !== false
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
  state.nextAsignacionId = state.costoAsignaciones.reduce((m, a) => Math.max(m, a.asignacion_id || 0), 0) + 1;

  // Auto-limpiar asignaciones huérfanas (pago borrado directo en la fuente).
  // Solo si AMBAS entidades cargaron OK — para no borrar nada si una falló.
  if (state.cargado.historial === true && state.cargado.costoAsignaciones === true) {
    const idsHist = new Set(state.historial.map(h => String(h.id)).filter(Boolean));
    const antesAsig = state.costoAsignaciones.length;
    state.costoAsignaciones = state.costoAsignaciones.filter(a => idsHist.has(String(a.pago_id)));
    const eliminadas = antesAsig - state.costoAsignaciones.length;
    if (eliminadas > 0) {
      try { await gsSaveCostoAsignaciones(); } catch (e) { console.error('Auto-limpia huérfanas: error guardando', e); }
      notify(`🧹 Limpieza automática: ${eliminadas} asignación(es) huérfana(s) eliminada(s)`, 'success');
    }
  }

  // Re-render everything
  if (window.renderCreditos) window.renderCreditos();
  if (window.renderTraspasos) window.renderTraspasos();
  if (window.renderResumenTraspasos) window.renderResumenTraspasos();
  if (window.renderCuentasPropias) window.renderCuentasPropias();
  if (window.renderProveedores) window.renderProveedores();
  if (window.renderNomina) window.renderNomina();
  if (window.renderHistorial) window.renderHistorial();
  if (window.renderConfigProyectos) window.renderConfigProyectos();
  if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
  if (window.renderHeaderBadges) window.renderHeaderBadges();
  if (window.refreshProyectosEnSelects) window.refreshProyectosEnSelects();
  if (window.renderCostosFiscales) window.renderCostosFiscales();
  if (window.renderConfigPartidas) window.renderConfigPartidas();
  if (window.renderConfigPartidasObra) window.renderConfigPartidasObra();
  const cH = document.getElementById('cnt-hist'); if (cH) cH.textContent = state.historial.length;
  const cF = document.getElementById('cnt-fact'); if (cF) cF.textContent = state.facturas.length;
  const cFP = document.getElementById('cnt-fp'); if (cFP) cFP.textContent = state.facturaPagos.length;
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
    pendientes_confirmacion: 'id'
  };

  async function cargar(tabla, entidad, fn) {
    const rows = await sbLoadTable(tabla, ORDER[tabla]);
    state.cargado[entidad] = (rows !== null);
    if (rows && rows.length) fn(rows);
  }

  await cargar('proveedores', 'proveedores', rows => {
    state.proveedores = rows.map(r => ({
      id: toInt(r.id), nombre: r.nombre || '', rfc: r.rfc || '', banco: normalizeBanco(r.banco || ''),
      tipo_cuenta: r.tipo_cuenta || '', cuenta: r.cuenta || '', clabe: r.clabe || '',
      categoria: r.categoria || '', subcategoria: r.subcategoria || '',
      proyectos: Array.isArray(r.proyectos) ? r.proyectos : [], activo: r.activo !== false,
      bloqueada_para_pago: !!r.bloqueada_para_pago, aliases: Array.isArray(r.aliases) ? r.aliases : []
    }));
  });

  await cargar('historial', 'historial', rows => {
    state.historial = rows.map(r => ({
      proveedor_id: r.proveedor_id || '', factura_id: r.factura_id || '', fecha: r.fecha || '',
      nombre: r.nombre || '', banco: normalizeBanco(r.banco || ''), tipo: r.tipo || '',
      concepto: r.concepto || '', importe: toNum(r.importe), proyecto: r.proyecto || '',
      cuenta_origen: r.cuenta_origen || '', tipo_registro: r.tipo_registro || 'Pago',
      partida: r.partida || '', sub_partida: r.sub_partida || '', id: r.id || ''
    }));
  });

  await cargar('proyectos', 'proyectos', rows => {
    state.proyectos = rows.map(r => ({
      id: r.id || '', nombre: r.nombre || '', empresa: r.empresa || '', cuenta: r.cuenta || '',
      clabe: r.clabe || '', color: r.color || '#C8A96E', activo: r.activo !== false,
      saldo: toNum(r.saldo), ultima_act_saldo: r.ultima_act_saldo || '', es_concentradora: !!r.es_concentradora
    }));
  });

  await cargar('empleados', 'empleados', rows => {
    state.empleados = rows.map(r => ({
      id: toInt(r.id), nombre: r.nombre || '', puesto: r.puesto || '', empresa: r.empresa || '',
      banco: r.banco || 'BBVA', tipo_cuenta: r.tipo_cuenta || '', cuenta: r.cuenta || '',
      clabe: r.clabe || '', rfc: r.rfc || '', activo: r.activo !== false
    }));
  });

  await cargar('cuentas_propias', 'cuentasPropias', rows => {
    state.cuentasPropias = rows.map(r => ({
      cuenta_id: toInt(r.cuenta_id), nombre: r.nombre || '', banco: r.banco || '', clabe: r.clabe || '',
      numero_cuenta: r.numero_cuenta || '', proyecto: r.proyecto || '', tipo: r.tipo || 'General',
      saldo: toNum(r.saldo), ultima_actualizacion: r.ultima_actualizacion || '', activo: r.activo !== false
    }));
  });

  await cargar('facturas', 'facturas', rows => {
    state.facturas = rows.map(r => ({
      factura_id: toInt(r.factura_id), numero_factura: r.numero_factura || '', razon_social: r.razon_social || '',
      proveedor_id: toInt(r.proveedor_id), nombre_proveedor: r.nombre_proveedor || '',
      fecha_factura: r.fecha_factura || '', fecha_vencimiento: r.fecha_vencimiento || '',
      fecha_pago_total: r.fecha_pago_total || '', monto_total: toNum(r.monto_total),
      monto_pagado: toNum(r.monto_pagado), saldo_pendiente: toNum(r.saldo_pendiente),
      estatus_factura: r.estatus_factura || 'pendiente', proyecto: r.proyecto || '',
      observaciones: r.observaciones || '', activo: r.activo !== false, uuid: r.uuid || ''
    }));
  });

  await cargar('factura_pagos', 'facturaPagos', rows => {
    state.facturaPagos = rows.map(r => ({
      factura_pago_id: toInt(r.factura_pago_id), factura_id: toInt(r.factura_id), pago_id: toInt(r.pago_id),
      proveedor_id: toInt(r.proveedor_id), monto_aplicado: toNum(r.monto_aplicado),
      fecha_pago: r.fecha_pago || '', estatus: r.estatus || '', observaciones: r.observaciones || ''
    }));
  });

  await cargar('traspasos', 'traspasos', rows => {
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

  await cargar('movimientos_internos', 'movimientosInternos', rows => {
    state.movimientosInternos = rows.map(r => ({
      id: toInt(r.id), fecha: r.fecha || '', tipo: r.tipo || '', origen: r.origen || '',
      destino: r.destino || '', monto: toNum(r.monto), concepto: r.concepto || '', referencia: r.referencia || ''
    }));
  });

  await cargar('creditos', 'creditos', rows => {
    state.creditos = rows.map(r => ({
      credito_id: toInt(r.credito_id), nombre: r.nombre || '', banco: r.banco || '',
      tipo_credito: r.tipo_credito || 'Puente', monto_autorizado: toNum(r.monto_autorizado),
      tasa_base: toNum(r.tasa_base), proyecto: r.proyecto || '', cuenta_pago: r.cuenta_pago || '',
      estatus: r.estatus || 'Activo', activo: r.activo !== false
    }));
  });

  await cargar('pagares', 'pagares', rows => {
    state.pagares = rows.map(r => ({
      pagare_id: toInt(r.pagare_id), credito_id: toInt(r.credito_id), numero_pagare: r.numero_pagare || '',
      monto: toNum(r.monto), fecha_disposicion: r.fecha_disposicion || '', fecha_vencimiento: r.fecha_vencimiento || '',
      tasa: toNum(r.tasa), estatus: r.estatus || 'Vigente', activo: r.activo !== false
    }));
  });

  await cargar('pagos_pagare', 'pagosPagare', rows => {
    state.pagosPagare = rows.map(r => ({
      pago_id: toInt(r.pago_id), pagare_id: toInt(r.pagare_id), credito_id: toInt(r.credito_id),
      fecha_pago: r.fecha_pago || '', monto_intereses: toNum(r.monto_intereses), concepto: r.concepto || '',
      estatus: r.estatus || 'Pendiente', fecha_real_pago: r.fecha_real_pago || ''
    }));
  });

  await cargar('unidades', 'unidades', rows => {
    state.unidades = rows.map(r => ({
      unidad_id: toInt(r.unidad_id), proyecto: r.proyecto || '', nombre: r.nombre || '', tipo: r.tipo || '',
      indiviso_pct: toNum(r.indiviso_pct), superficie_m2: toNum(r.superficie_m2), estatus: r.estatus || 'En obra',
      orden: toInt(r.orden), activo: r.activo !== false,
      plano_x: plano(r.plano_x), plano_y: plano(r.plano_y), plano_w: plano(r.plano_w), plano_h: plano(r.plano_h)
    }));
  });

  await cargar('presupuesto_unidad', 'presupuestoUnidad', rows => {
    state.presupuestoUnidad = rows.map(r => ({
      presupuesto_id: toInt(r.presupuesto_id), unidad_id: toInt(r.unidad_id), partida: r.partida || '',
      sub_partida: r.sub_partida || '', monto_presupuestado: toNum(r.monto_presupuestado),
      costo_inicial: toNum(r.costo_inicial), notas: r.notas || ''
    }));
  });

  await cargar('costo_asignaciones', 'costoAsignaciones', rows => {
    state.costoAsignaciones = rows.map(r => ({
      asignacion_id: toInt(r.asignacion_id), pago_id: r.pago_id || '', unidad_id: toInt(r.unidad_id),
      proyecto: r.proyecto || '', metodo: r.metodo || 'directo', monto_asignado: toNum(r.monto_asignado),
      factor: toNum(r.factor), fecha_asignacion: r.fecha_asignacion || '', partida_override: r.partida_override || ''
    }));
  });

  await cargar('partidas_catalogo', 'partidasCatalogo', rows => {
    state.partidasCatalogo = rows.map(r => ({
      id: r.partida_id || '', partida: r.partida || '',
      subpartidas: Array.isArray(r.subpartidas) ? r.subpartidas : [],
      orden: toInt(r.orden), activa: r.activa !== false
    }));
  });

  await cargar('partidas_obra', 'partidasObra', rows => {
    state.partidasObra = rows.map(r => ({
      id: r.partida_obra_id || '', nombre: r.nombre || '', proyecto: r.proyecto || '',
      partidaAdmin: r.partida_admin || '', subPartidaAdmin: r.sub_partida_admin || '',
      orden: toInt(r.orden), activa: r.activa !== false
    }));
  });

  await cargar('pendientes_confirmacion', 'pendientesConfirmacion', rows => {
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
  if (!pagoId || !state.gsToken) return;
  const antes = state.costoAsignaciones.length;
  state.costoAsignaciones = state.costoAsignaciones.filter(a => String(a.pago_id) !== String(pagoId));
  if (state.costoAsignaciones.length !== antes) {
    await gsSaveCostoAsignaciones();
  }
}

export async function saveData(count = 1) {
  if (!state.gsToken) return;
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
  if (!state.gsToken) return;
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
  if (!state.gsToken) return;
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

export async function gsSaveHistorial() {
  if (!state.gsToken) return;
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
    await sbEspejar('historial');
  } catch (e) {
    console.error('gsSaveHistorial', e);
    notify(`⚠ No pude guardar el historial en Sheets: ${e.message}. Tus cambios están en memoria pero NO se persistieron.`, 'error');
  }
}

export async function gsSaveUnidades() {
  if (!state.gsToken) return;
  if (!guardarPermitido('unidades', state.unidades)) return;
  try {
    const rows = state.unidades.map(u => [
      u.unidad_id, u.proyecto, u.nombre, u.tipo || '', u.indiviso_pct || 0,
      u.superficie_m2 || 0, u.estatus || 'En obra', u.orden || 0, u.activo,
      u.plano_x == null ? '' : u.plano_x, u.plano_y == null ? '' : u.plano_y,
      u.plano_w == null ? '' : u.plano_w, u.plano_h == null ? '' : u.plano_h
    ]);
    await gsClearAndWrite('unidades', rows, [
      'unidad_id', 'proyecto', 'nombre', 'tipo', 'indiviso_pct',
      'superficie_m2', 'estatus', 'orden', 'activo', 'plano_x', 'plano_y',
      'plano_w', 'plano_h'
    ]);
    await sbEspejar('unidades');
  } catch (e) { console.error('gsSaveUnidades', e); }
}

export async function gsSavePresupuestoUnidad() {
  if (!state.gsToken) return;
  if (!guardarPermitido('presupuestoUnidad', state.presupuestoUnidad)) return;
  try {
    const rows = state.presupuestoUnidad.map(p => [
      p.presupuesto_id, p.unidad_id, p.partida || '', p.sub_partida || '',
      p.monto_presupuestado || 0, p.costo_inicial || 0, p.notas || ''
    ]);
    await gsClearAndWrite('presupuesto_unidad', rows, [
      'presupuesto_id', 'unidad_id', 'partida', 'sub_partida',
      'monto_presupuestado', 'costo_inicial', 'notas'
    ]);
    await sbEspejar('presupuestoUnidad');
  } catch (e) { console.error('gsSavePresupuestoUnidad', e); }
}

export async function gsSaveCostoAsignaciones() {
  if (!state.gsToken) return;
  if (!guardarPermitido('costoAsignaciones', state.costoAsignaciones)) return;
  try {
    const rows = state.costoAsignaciones.map(a => [
      a.asignacion_id, a.pago_id, a.unidad_id, a.proyecto || '', a.metodo || 'directo',
      a.monto_asignado || 0, a.factor || 0, a.fecha_asignacion || '', a.partida_override || ''
    ]);
    await gsClearAndWrite('costo_asignaciones', rows, [
      'asignacion_id', 'pago_id', 'unidad_id', 'proyecto', 'metodo',
      'monto_asignado', 'factor', 'fecha_asignacion', 'partida_override'
    ]);
    await sbEspejar('costoAsignaciones');
  } catch (e) { console.error('gsSaveCostoAsignaciones', e); }
}

// ===== Espejo a Supabase (Etapa B — Fase 1: dual-write) =====
// Helpers de coerción para que los tipos calcen con las columnas de Postgres.
const _sbBool = (v) => v === true || v === 'TRUE' || v === 'true' || v === 1;
const _sbNum  = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const _sbStr  = (v) => (v == null ? '' : String(v));

// Mapeos state → filas (objetos) por entidad. Columnas == campos que se
// persisten en Sheets (espejo 1:1). Arrays como JSON nativo (jsonb).
function _rowsProveedores() {
  return state.proveedores.map(p => ({
    id: p.id, nombre: _sbStr(p.nombre), rfc: _sbStr(p.rfc), banco: _sbStr(p.banco),
    tipo_cuenta: _sbStr(p.tipo_cuenta), cuenta: _sbStr(p.cuenta), clabe: _sbStr(p.clabe),
    categoria: _sbStr(p.categoria), subcategoria: _sbStr(p.subcategoria),
    proyectos: p.proyectos || [], activo: p.activo !== false,
    bloqueada_para_pago: !!p.bloqueada_para_pago, aliases: p.aliases || []
  }));
}
function _rowsProyectos() {
  return state.proyectos.map(p => ({
    id: _sbStr(p.id), nombre: _sbStr(p.nombre), empresa: _sbStr(p.empresa),
    cuenta: _sbStr(p.cuenta), clabe: _sbStr(p.clabe), color: _sbStr(p.color),
    activo: p.activo !== false, saldo: _sbNum(p.saldo),
    ultima_act_saldo: _sbStr(p.ultima_act_saldo), es_concentradora: _sbBool(p.es_concentradora)
  }));
}
function _rowsCuentasPropias() {
  return state.cuentasPropias.map(c => ({
    cuenta_id: c.cuenta_id, nombre: _sbStr(c.nombre), banco: _sbStr(c.banco),
    clabe: _sbStr(c.clabe), numero_cuenta: _sbStr(c.numero_cuenta), proyecto: _sbStr(c.proyecto),
    tipo: _sbStr(c.tipo || 'General'), saldo: _sbNum(c.saldo),
    ultima_actualizacion: _sbStr(c.ultima_actualizacion), activo: c.activo !== false
  }));
}
function _rowsEmpleados() {
  return state.empleados.map(e => ({
    id: e.id, nombre: _sbStr(e.nombre), puesto: _sbStr(e.puesto), empresa: _sbStr(e.empresa),
    banco: _sbStr(e.banco), tipo_cuenta: _sbStr(e.tipo_cuenta), cuenta: _sbStr(e.cuenta),
    clabe: _sbStr(e.clabe), rfc: _sbStr(e.rfc), activo: e.activo !== false
  }));
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
    out.push({
      id, proveedor_id: _sbStr(h.proveedor_id), factura_id: _sbStr(h.factura_id),
      fecha: _sbStr(h.fecha), nombre: _sbStr(h.nombre), banco: _sbStr(h.banco),
      tipo: _sbStr(h.tipo), concepto: _sbStr(h.concepto), importe: _sbNum(h.importe),
      proyecto: _sbStr(h.proyecto), cuenta_origen: _sbStr(h.cuenta_origen),
      tipo_registro: _sbStr(h.tipo_registro || 'Pago'), partida: _sbStr(h.partida),
      sub_partida: _sbStr(h.sub_partida)
    });
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

function _rowsFacturas() {
  return _dedupBy(state.facturas.map(f => ({
    factura_id: _sbStr(f.factura_id), numero_factura: _sbStr(f.numero_factura),
    razon_social: _sbStr(f.razon_social), proveedor_id: _sbStr(f.proveedor_id),
    nombre_proveedor: _sbStr(f.nombre_proveedor), fecha_factura: _sbStr(f.fecha_factura),
    fecha_vencimiento: _sbStr(f.fecha_vencimiento), fecha_pago_total: _sbStr(f.fecha_pago_total),
    monto_total: _sbNum(f.monto_total), monto_pagado: _sbNum(f.monto_pagado),
    saldo_pendiente: _sbNum(f.saldo_pendiente), estatus_factura: _sbStr(f.estatus_factura),
    proyecto: _sbStr(f.proyecto), observaciones: _sbStr(f.observaciones),
    activo: f.activo !== false, uuid: _sbStr(f.uuid)
  })), 'factura_id');
}
function _rowsFacturaPagos() {
  return _dedupBy(state.facturaPagos.map(fp => ({
    factura_pago_id: _sbStr(fp.factura_pago_id), factura_id: _sbStr(fp.factura_id),
    pago_id: _sbStr(fp.pago_id), proveedor_id: _sbStr(fp.proveedor_id),
    monto_aplicado: _sbNum(fp.monto_aplicado), fecha_pago: _sbStr(fp.fecha_pago),
    estatus: _sbStr(fp.estatus), observaciones: _sbStr(fp.observaciones)
  })), 'factura_pago_id');
}
function _rowsTraspasos() {
  return _dedupBy(state.traspasos.map(t => ({
    traspaso_id: _sbStr(t.traspaso_id), tipo: _sbStr(t.tipo),
    cuenta_origen_id: _sbStr(t.cuenta_origen_id), cuenta_origen_tipo: _sbStr(t.cuenta_origen_tipo),
    cuenta_origen_nombre: _sbStr(t.cuenta_origen_nombre), proyecto_origen: _sbStr(t.proyecto_origen),
    cuenta_destino_id: _sbStr(t.cuenta_destino_id), cuenta_destino_tipo: _sbStr(t.cuenta_destino_tipo),
    cuenta_destino_nombre: _sbStr(t.cuenta_destino_nombre), proyecto_destino: _sbStr(t.proyecto_destino),
    monto: _sbNum(t.monto), fecha: _sbStr(t.fecha), concepto: _sbStr(t.concepto),
    referencia: _sbStr(t.referencia), estatus: _sbStr(t.estatus), fecha_registro: _sbStr(t.fecha_registro)
  })), 'traspaso_id');
}
function _rowsMovimientosInternos() {
  return _dedupBy(state.movimientosInternos.map(m => ({
    id: _sbStr(m.id), fecha: _sbStr(m.fecha), tipo: _sbStr(m.tipo),
    origen: _sbStr(m.origen), destino: _sbStr(m.destino), monto: _sbNum(m.monto),
    concepto: _sbStr(m.concepto), referencia: _sbStr(m.referencia)
  })), 'id');
}
function _rowsCreditos() {
  return _dedupBy(state.creditos.map(c => ({
    credito_id: _sbStr(c.credito_id), nombre: _sbStr(c.nombre), banco: _sbStr(c.banco),
    tipo_credito: _sbStr(c.tipo_credito), monto_autorizado: _sbNum(c.monto_autorizado),
    tasa_base: _sbNum(c.tasa_base), proyecto: _sbStr(c.proyecto), cuenta_pago: _sbStr(c.cuenta_pago),
    estatus: _sbStr(c.estatus), activo: c.activo !== false
  })), 'credito_id');
}
function _rowsPagares() {
  return _dedupBy(state.pagares.map(p => ({
    pagare_id: _sbStr(p.pagare_id), credito_id: _sbStr(p.credito_id),
    numero_pagare: _sbStr(p.numero_pagare), monto: _sbNum(p.monto),
    fecha_disposicion: _sbStr(p.fecha_disposicion), fecha_vencimiento: _sbStr(p.fecha_vencimiento),
    tasa: _sbNum(p.tasa), estatus: _sbStr(p.estatus), activo: p.activo !== false
  })), 'pagare_id');
}
function _rowsPagosPagare() {
  return _dedupBy(state.pagosPagare.map(p => ({
    pago_id: _sbStr(p.pago_id), pagare_id: _sbStr(p.pagare_id), credito_id: _sbStr(p.credito_id),
    fecha_pago: _sbStr(p.fecha_pago), monto_intereses: _sbNum(p.monto_intereses),
    concepto: _sbStr(p.concepto), estatus: _sbStr(p.estatus), fecha_real_pago: _sbStr(p.fecha_real_pago)
  })), 'pago_id');
}
function _rowsUnidades() {
  const plano = (v) => (v == null || v === '' ? null : _sbNum(v));
  return _dedupBy(state.unidades.map(u => ({
    unidad_id: _sbStr(u.unidad_id), proyecto: _sbStr(u.proyecto), nombre: _sbStr(u.nombre),
    tipo: _sbStr(u.tipo), indiviso_pct: _sbNum(u.indiviso_pct), superficie_m2: _sbNum(u.superficie_m2),
    estatus: _sbStr(u.estatus), orden: _sbNum(u.orden), activo: u.activo !== false,
    plano_x: plano(u.plano_x), plano_y: plano(u.plano_y), plano_w: plano(u.plano_w), plano_h: plano(u.plano_h)
  })), 'unidad_id');
}
function _rowsPresupuestoUnidad() {
  return _dedupBy(state.presupuestoUnidad.map(p => ({
    presupuesto_id: _sbStr(p.presupuesto_id), unidad_id: _sbStr(p.unidad_id),
    partida: _sbStr(p.partida), sub_partida: _sbStr(p.sub_partida),
    monto_presupuestado: _sbNum(p.monto_presupuestado), costo_inicial: _sbNum(p.costo_inicial),
    notas: _sbStr(p.notas)
  })), 'presupuesto_id');
}
function _rowsCostoAsignaciones() {
  return _dedupBy(state.costoAsignaciones.map(a => ({
    asignacion_id: _sbStr(a.asignacion_id), pago_id: _sbStr(a.pago_id), unidad_id: _sbStr(a.unidad_id),
    proyecto: _sbStr(a.proyecto), metodo: _sbStr(a.metodo), monto_asignado: _sbNum(a.monto_asignado),
    factor: _sbNum(a.factor), fecha_asignacion: _sbStr(a.fecha_asignacion), partida_override: _sbStr(a.partida_override)
  })), 'asignacion_id');
}
function _rowsPartidasCatalogo() {
  return _dedupBy(state.partidasCatalogo.map(p => ({
    partida_id: _sbStr(p.id), partida: _sbStr(p.partida), subpartidas: p.subpartidas || [],
    orden: _sbNum(p.orden), activa: p.activa !== false
  })), 'partida_id');
}
function _rowsPartidasObra() {
  return _dedupBy(state.partidasObra.map(p => ({
    partida_obra_id: _sbStr(p.id), nombre: _sbStr(p.nombre), proyecto: _sbStr(p.proyecto),
    partida_admin: _sbStr(p.partidaAdmin), sub_partida_admin: _sbStr(p.subPartidaAdmin),
    orden: _sbNum(p.orden), activa: p.activa !== false
  })), 'partida_obra_id');
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
  proveedores:        { tabla: 'proveedores',         rows: _rowsProveedores },
  proyectos:          { tabla: 'proyectos',           rows: _rowsProyectos },
  cuentasPropias:     { tabla: 'cuentas_propias',     rows: _rowsCuentasPropias },
  empleados:          { tabla: 'empleados',           rows: _rowsEmpleados },
  historial:          { tabla: 'historial',           rows: _rowsHistorial },
  facturas:           { tabla: 'facturas',            rows: _rowsFacturas },
  facturaPagos:       { tabla: 'factura_pagos',       rows: _rowsFacturaPagos },
  traspasos:          { tabla: 'traspasos',           rows: _rowsTraspasos },
  movimientosInternos:{ tabla: 'movimientos_internos',rows: _rowsMovimientosInternos },
  creditos:           { tabla: 'creditos',            rows: _rowsCreditos },
  pagares:            { tabla: 'pagares',             rows: _rowsPagares },
  pagosPagare:        { tabla: 'pagos_pagare',        rows: _rowsPagosPagare },
  unidades:           { tabla: 'unidades',            rows: _rowsUnidades },
  presupuestoUnidad:  { tabla: 'presupuesto_unidad',  rows: _rowsPresupuestoUnidad },
  costoAsignaciones:  { tabla: 'costo_asignaciones',  rows: _rowsCostoAsignaciones },
  partidasCatalogo:   { tabla: 'partidas_catalogo',   rows: _rowsPartidasCatalogo },
  partidasObra:       { tabla: 'partidas_obra',       rows: _rowsPartidasObra },
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

// Botón "Migrar TODO a Supabase": recarga de Sheets (toma ediciones manuales) y
// espeja TODAS las entidades del registro. Sirve igual para migración inicial
// que para re-sincronizar tras editar el Sheet a mano. Idempotente.
export async function migrarTodoASupabase() {
  if (!state.gsToken) { notify('Conecta Google Sheets primero', 'error'); return; }
  if (!sbReady()) { notify('Inicia sesión en la app (Supabase) primero', 'error'); return; }
  notify('Migrando a Supabase: recargando de Sheets...');
  await gsLoadAll();
  let ok = 0, fail = 0;
  for (const key of Object.keys(SB_ENTIDADES)) {
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

export async function gsSaveProveedores() {
  if (!state.gsToken) return;
  if (!guardarPermitido('proveedores', state.proveedores)) return;
  try {
    const rows = state.proveedores.map(p => [p.id, p.nombre, p.rfc || '', p.banco, p.tipo_cuenta, p.cuenta, p.clabe || '', p.categoria, p.subcategoria || '', (p.proyectos || []).join('|'), p.activo, p.bloqueada_para_pago || false]);
    await gsClearAndWrite('proveedores', rows, ['proveedor_id', 'nombre', 'rfc', 'banco', 'tipo_cuenta', 'cuenta', 'clabe', 'categoria', 'Subcategoria', 'proyectos', 'activo', 'bloqueada_para_pago']);
    notify('✅ Proveedores guardados en Sheets');
    await sbEspejar('proveedores');
  } catch (e) { notify('Error guardando proveedores: ' + e.message, 'error'); }
}

export async function gsSaveAlias(nombreOriginal, provId) {
  if (!state.gsToken) return;
  try {
    const fecha = new Date().toISOString().split('T')[0];
    await gsAppendRow('aliases', [nombreOriginal, provId, fecha]);
  } catch (e) { console.error('gsSaveAlias error', e); }
}

export async function gsSaveEmpleados() {
  if (!state.gsToken) return;
  if (!guardarPermitido('empleados', state.empleados)) return;
  try {
    const rows = state.empleados.map(e => [e.id, e.nombre, e.puesto || '', e.empresa || '', e.banco, e.tipo_cuenta, e.cuenta, e.clabe || '', e.rfc || '', e.activo]);
    await gsClearAndWrite('empleados', rows, ['id', 'nombre', 'puesto', 'empresa', 'banco', 'tipo_cuenta', 'cuenta', 'clabe', 'rfc', 'activo']);
    notify('✅ Empleados guardados en Sheets');
    await sbEspejar('empleados');
  } catch (e) { console.error('gsSaveEmpleados', e); }
}

export async function gsSaveFacturas() {
  if (!state.gsToken) return;
  if (!guardarPermitido('facturas', state.facturas)) return;
  try {
    const rows = state.facturas.map(f => [f.factura_id, f.numero_factura || '', f.razon_social || '', f.proveedor_id, f.nombre_proveedor || '', f.fecha_factura, f.fecha_vencimiento || '', f.fecha_pago_total || '', f.monto_total, f.monto_pagado, f.saldo_pendiente, f.estatus_factura, f.proyecto, f.observaciones, f.activo, f.uuid || '']);
    await gsClearAndWrite('facturas', rows, ['factura_id', 'Numero_Fcatura', 'razon_social', 'proveedor_id', 'nombre_proveedor', 'fecha_factura', 'fecha_vencimiento', 'fecha_pago_total', 'monto_total', 'monto_pagado', 'saldo_pendiente', 'estatus_factura', 'proyecto', 'observaciones', 'activo', 'uuid']);
    await sbEspejar('facturas');
  } catch (e) { console.error('gsSaveFacturas', e); }
}

export async function gsSaveFacturaPagos() {
  if (!state.gsToken) return;
  if (!guardarPermitido('facturaPagos', state.facturaPagos)) return;
  try {
    const rows = state.facturaPagos.map(fp => [fp.factura_pago_id, fp.factura_id, fp.pago_id, fp.proveedor_id, fp.monto_aplicado, fp.fecha_pago, fp.estatus, fp.observaciones]);
    await gsClearAndWrite('factura_pagos', rows, ['factura_pago_id', 'factura_id', 'pago_id', 'proveedor_id', 'monto_aplicado', 'fecha_pago', 'estatus', 'observaciones']);
    await sbEspejar('facturaPagos');
  } catch (e) { console.error('gsSaveFacturaPagos', e); }
}

export async function gsSaveCuentasPropias() {
  if (!state.gsToken) return;
  if (!guardarPermitido('cuentasPropias', state.cuentasPropias)) return;
  try {
    const rows = state.cuentasPropias.map(c => [c.cuenta_id, c.nombre, c.banco, c.clabe || '', c.numero_cuenta || '', c.proyecto || '', c.tipo || 'General', c.saldo, c.ultima_actualizacion || '', c.activo]);
    await gsClearAndWrite('cuentas_propias', rows, ['cuenta_id', 'nombre', 'banco', 'clabe', 'numero_cuenta', 'proyecto', 'tipo', 'saldo', 'ultima_actualizacion', 'activo']);
    await sbEspejar('cuentasPropias');
  } catch (e) { console.error('gsSaveCuentasPropias', e); }
}

export async function gsSaveTraspasos() {
  if (!state.gsToken) return;
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
    await sbEspejar('traspasos');
  } catch (e) { console.error('gsSaveTraspasos', e); }
}

export async function gsSaveCreditos() {
  if (!state.gsToken) return;
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
    await sbEspejar('creditos');
  } catch (e) { console.error('gsSaveCreditos', e); }
}

export async function gsSavePagares() {
  if (!state.gsToken) return;
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
    await sbEspejar('pagares');
  } catch (e) { console.error('gsSavePagares', e); }
}

export async function gsSavePagosPagare() {
  if (!state.gsToken) return;
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
    await sbEspejar('pagosPagare');
  } catch (e) { console.error('gsSavePagosPagare', e); }
}

export async function gsSaveMovimientosInternos() {
  if (!state.gsToken) return;
  if (!guardarPermitido('movimientosInternos', state.movimientosInternos)) return;
  const rows = state.movimientosInternos.map(m => [m.id, m.fecha, m.tipo, m.origen, m.destino, m.monto, m.concepto, m.referencia]);
  await gsClearAndWrite('movimientos_internos', rows, ['id', 'fecha', 'tipo', 'origen', 'destino', 'monto', 'concepto', 'referencia']);
  await sbEspejar('movimientosInternos');
}

export async function gsSavePartidasObra() {
  if (!state.gsToken) return;
  if (!guardarPermitido('partidasObra', state.partidasObra, true)) return;
  try {
    const rows = state.partidasObra.map(p => [
      p.id || '', p.nombre || '', p.proyecto || '',
      p.partidaAdmin || '', p.subPartidaAdmin || '',
      p.orden || 0, p.activa === false ? 'false' : 'true'
    ]);
    await gsClearAndWrite('partidas_obra', rows, ['partida_obra_id', 'nombre', 'proyecto', 'partida_admin', 'sub_partida_admin', 'orden', 'activa']);
    await sbEspejar('partidasObra');
  } catch (e) { console.error('gsSavePartidasObra', e); }
}

export async function gsSavePartidasCatalogo() {
  if (!state.gsToken) return;
  if (!guardarPermitido('partidasCatalogo', state.partidasCatalogo, true)) return;
  try {
    const rows = state.partidasCatalogo.map(p => [
      p.id || '', p.partida || '', (p.subpartidas || []).join('|'),
      p.orden || 0, p.activa === false ? 'false' : 'true'
    ]);
    await gsClearAndWrite('partidas_catalogo', rows, ['partida_id', 'partida', 'subpartidas', 'orden', 'activa']);
    await sbEspejar('partidasCatalogo');
  } catch (e) { console.error('gsSavePartidasCatalogo', e); }
}

export async function gsSaveProyectos() {
  if (!state.gsToken) return;
  if (!guardarPermitido('proyectos', state.proyectos)) return;
  try {
    const rows = state.proyectos.map(p => [p.id, p.nombre, p.empresa || '', p.cuenta || '', p.clabe || '', p.color || '', p.activo, p.saldo || 0, p.ultima_act_saldo || '', p.es_concentradora || false]);
    await gsClearAndWrite('proyectos', rows, ['id', 'nombre', 'empresa', 'cuenta', 'clabe', 'color', 'activo', 'saldo', 'ultima_act_saldo', 'es_concentradora']);
    notify('✅ Proyectos guardados en Sheets');
    await sbEspejar('proyectos');
  } catch (e) { console.error('gsSaveProyectos', e); }
}

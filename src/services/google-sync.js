import { state } from '../state.js';
import { notify } from '../ui/notify.js';
import { gsReadSheet, gsWriteRange, gsClearAndWrite, gsAppendRow } from './google-sheets.js';
import { normalizeBanco } from '../config/bancos.js';

export async function gsLoadAll() {
  try {
    // Load proveedores from Sheets (Sheets is source of truth)
    const pRows = await gsReadSheet('proveedores');
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
    } else if (state.proveedores.length) {
      await gsSaveProveedores();
    }

    // Load pendientes confirmacion
    const pcRows = await gsReadSheet('pendientes_confirmacion');
    if (pcRows && pcRows.length > 1) {
      state.pendientesConfirmacion = pcRows.slice(1).filter(r => r[0]).map(r => ({
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
        sub_partida: r[14] || ''
      }));
    }

    // Load empleados
    const eRows = await gsReadSheet('empleados');
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
    } else if (state.empleados.length) {
      // Hoja vacía — auto-popular desde JSON seed
      await gsSaveEmpleados();
    }

    // Load historial
    const hRows = await gsReadSheet('historial_pagos');
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
        sub_partida: r[12] || ''
      }));
    }

    // Load proyectos
    const prRows = await gsReadSheet('proyectos');
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
    const fRows = await gsReadSheet('facturas');
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
    const cpRows = await gsReadSheet('cuentas_propias');
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
    const tRows = await gsReadSheet('traspasos');
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
    const crRows = await gsReadSheet('creditos');
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
    const pgRows = await gsReadSheet('pagares');
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
    const ppRows = await gsReadSheet('pagos_pagare');
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
    const miRows = await gsReadSheet('movimientos_internos');
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
    const fpRows = await gsReadSheet('factura_pagos');
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

    // Recalcular nextId con el máximo entre proveedores y empleados
    const maxProv = state.proveedores.reduce((max, p) => Math.max(max, p.id || 0), 0);
    const maxEmp = state.empleados.reduce((max, e) => Math.max(max, e.id || 0), 0);
    state.nextId = Math.max(maxProv, maxEmp, state.nextId || 0) + 1;

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
    document.getElementById('cnt-hist').textContent = state.historial.length;
    document.getElementById('cnt-fact').textContent = state.facturas.length;
    document.getElementById('cnt-fp').textContent = state.facturaPagos.length;
  } catch (e) {
    console.error('gsLoadAll error', e);
    notify('Error cargando datos: ' + e.message, 'error');
  }
}

export async function saveData(count = 1) {
  if (!state.gsToken) return;
  try {
    const n = Math.min(count, state.historial.length);
    for (let i = 0; i < n; i++) {
      const h = state.historial[i];
      await gsAppendRow('historial_pagos', [h.proveedor_id || '', h.factura_id || '', h.fecha, h.nombre, h.banco, h.tipo, h.concepto, h.importe, h.proyecto, h.cuenta_origen || '', h.tipo_registro || 'Pago', h.partida || '', h.sub_partida || '']);
    }
  } catch (e) { console.error('saveData error', e); }
}

const HS_HEADERS = ['fecha', 'cuenta_id', 'cuenta_nombre', 'cuenta_tipo', 'saldo', 'saldo_total'];
let hsHeadersOk = false;

export async function gsAppendHistorialSaldo(registro) {
  if (!state.gsToken) return;
  try {
    if (!hsHeadersOk) {
      const rows = await gsReadSheet('historial_saldos');
      if (!rows.length || rows[0][0] !== 'fecha') {
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
  try {
    const rows = state.pendientesConfirmacion.map(p => [
      p.id, p.proveedor_id || '', p.factura_id || '', p.nombre, p.cuenta || '',
      p.banco, p.tipo, p.concepto, p.importe, p.proyecto, p.partida || '',
      p.cuenta_cargo || '', p.fechaGen || '', p.confirmado, p.sub_partida || ''
    ]);
    await gsClearAndWrite('pendientes_confirmacion', rows, [
      'id', 'proveedor_id', 'factura_id', 'nombre', 'cuenta', 'banco',
      'tipo', 'concepto', 'importe', 'proyecto', 'partida', 'cuenta_cargo',
      'fechaGen', 'confirmado', 'sub_partida'
    ]);
  } catch (e) { console.error('gsSavePendientes', e); }
}

export async function gsSaveHistorial() {
  if (!state.gsToken) return;
  try {
    const rows = state.historial.map(h => [
      h.proveedor_id || '', h.factura_id || '', h.fecha, h.nombre, h.banco,
      h.tipo, h.concepto, h.importe, h.proyecto, h.cuenta_origen || '',
      h.tipo_registro || 'Pago', h.partida || '', h.sub_partida || ''
    ]);
    await gsClearAndWrite('historial_pagos', rows, [
      'proveedor_id', 'factura_id', 'fecha', 'nombre', 'banco',
      'tipo', 'concepto', 'importe', 'proyecto', 'cuenta_origen',
      'tipo_registro', 'partida', 'sub_partida'
    ]);
  } catch (e) { console.error('gsSaveHistorial', e); }
}

export async function gsSaveProveedores() {
  if (!state.gsToken) return;
  try {
    const rows = state.proveedores.map(p => [p.id, p.nombre, p.rfc || '', p.banco, p.tipo_cuenta, p.cuenta, p.clabe || '', p.categoria, p.subcategoria || '', (p.proyectos || []).join('|'), p.activo, p.bloqueada_para_pago || false]);
    await gsClearAndWrite('proveedores', rows, ['proveedor_id', 'nombre', 'rfc', 'banco', 'tipo_cuenta', 'cuenta', 'clabe', 'categoria', 'Subcategoria', 'proyectos', 'activo', 'bloqueada_para_pago']);
    notify('✅ Proveedores guardados en Sheets');
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
  try {
    const rows = state.empleados.map(e => [e.id, e.nombre, e.puesto || '', e.empresa || '', e.banco, e.tipo_cuenta, e.cuenta, e.clabe || '', e.rfc || '', e.activo]);
    await gsClearAndWrite('empleados', rows, ['id', 'nombre', 'puesto', 'empresa', 'banco', 'tipo_cuenta', 'cuenta', 'clabe', 'rfc', 'activo']);
    notify('✅ Empleados guardados en Sheets');
  } catch (e) { console.error('gsSaveEmpleados', e); }
}

export async function gsSaveFacturas() {
  if (!state.gsToken) return;
  try {
    const rows = state.facturas.map(f => [f.factura_id, f.numero_factura || '', f.razon_social || '', f.proveedor_id, f.nombre_proveedor || '', f.fecha_factura, f.fecha_vencimiento || '', f.fecha_pago_total || '', f.monto_total, f.monto_pagado, f.saldo_pendiente, f.estatus_factura, f.proyecto, f.observaciones, f.activo, f.uuid || '']);
    await gsClearAndWrite('facturas', rows, ['factura_id', 'Numero_Fcatura', 'razon_social', 'proveedor_id', 'nombre_proveedor', 'fecha_factura', 'fecha_vencimiento', 'fecha_pago_total', 'monto_total', 'monto_pagado', 'saldo_pendiente', 'estatus_factura', 'proyecto', 'observaciones', 'activo', 'uuid']);
  } catch (e) { console.error('gsSaveFacturas', e); }
}

export async function gsSaveFacturaPagos() {
  if (!state.gsToken) return;
  try {
    const rows = state.facturaPagos.map(fp => [fp.factura_pago_id, fp.factura_id, fp.pago_id, fp.proveedor_id, fp.monto_aplicado, fp.fecha_pago, fp.estatus, fp.observaciones]);
    await gsClearAndWrite('factura_pagos', rows, ['factura_pago_id', 'factura_id', 'pago_id', 'proveedor_id', 'monto_aplicado', 'fecha_pago', 'estatus', 'observaciones']);
  } catch (e) { console.error('gsSaveFacturaPagos', e); }
}

export async function gsSaveCuentasPropias() {
  if (!state.gsToken) return;
  try {
    const rows = state.cuentasPropias.map(c => [c.cuenta_id, c.nombre, c.banco, c.clabe || '', c.numero_cuenta || '', c.proyecto || '', c.tipo || 'General', c.saldo, c.ultima_actualizacion || '', c.activo]);
    await gsClearAndWrite('cuentas_propias', rows, ['cuenta_id', 'nombre', 'banco', 'clabe', 'numero_cuenta', 'proyecto', 'tipo', 'saldo', 'ultima_actualizacion', 'activo']);
  } catch (e) { console.error('gsSaveCuentasPropias', e); }
}

export async function gsSaveTraspasos() {
  if (!state.gsToken) return;
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
  } catch (e) { console.error('gsSaveTraspasos', e); }
}

export async function gsSaveCreditos() {
  if (!state.gsToken) return;
  try {
    const rows = state.creditos.map(c => [
      c.credito_id, c.nombre, c.banco, c.tipo_credito, c.monto_autorizado,
      c.tasa_base, c.proyecto || '', c.cuenta_pago || '', c.estatus, c.activo
    ]);
    await gsClearAndWrite('creditos', rows, [
      'credito_id', 'nombre', 'banco', 'tipo_credito', 'monto_autorizado',
      'tasa_base', 'proyecto', 'cuenta_pago', 'estatus', 'activo'
    ]);
  } catch (e) { console.error('gsSaveCreditos', e); }
}

export async function gsSavePagares() {
  if (!state.gsToken) return;
  try {
    const rows = state.pagares.map(p => [
      p.pagare_id, p.credito_id, p.numero_pagare, p.monto,
      p.fecha_disposicion, p.fecha_vencimiento, p.tasa, p.estatus, p.activo
    ]);
    await gsClearAndWrite('pagares', rows, [
      'pagare_id', 'credito_id', 'numero_pagare', 'monto',
      'fecha_disposicion', 'fecha_vencimiento', 'tasa', 'estatus', 'activo'
    ]);
  } catch (e) { console.error('gsSavePagares', e); }
}

export async function gsSavePagosPagare() {
  if (!state.gsToken) return;
  try {
    const rows = state.pagosPagare.map(p => [
      p.pago_id, p.pagare_id, p.credito_id, p.fecha_pago,
      p.monto_intereses, p.concepto || '', p.estatus, p.fecha_real_pago || ''
    ]);
    await gsClearAndWrite('pagos_pagare', rows, [
      'pago_id', 'pagare_id', 'credito_id', 'fecha_pago',
      'monto_intereses', 'concepto', 'estatus', 'fecha_real_pago'
    ]);
  } catch (e) { console.error('gsSavePagosPagare', e); }
}

export async function gsSaveMovimientosInternos() {
  if (!state.gsToken) return;
  const rows = state.movimientosInternos.map(m => [m.id, m.fecha, m.tipo, m.origen, m.destino, m.monto, m.concepto, m.referencia]);
  await gsClearAndWrite('movimientos_internos', rows, ['id', 'fecha', 'tipo', 'origen', 'destino', 'monto', 'concepto', 'referencia']);
}

export async function gsSaveProyectos() {
  if (!state.gsToken) return;
  try {
    const rows = state.proyectos.map(p => [p.id, p.nombre, p.empresa || '', p.cuenta || '', p.clabe || '', p.color || '', p.activo, p.saldo || 0, p.ultima_act_saldo || '', p.es_concentradora || false]);
    await gsClearAndWrite('proyectos', rows, ['id', 'nombre', 'empresa', 'cuenta', 'clabe', 'color', 'activo', 'saldo', 'ultima_act_saldo', 'es_concentradora']);
    notify('✅ Proyectos guardados en Sheets');
  } catch (e) { console.error('gsSaveProyectos', e); }
}

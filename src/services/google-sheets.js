import { state } from '../state.js';
import { GS_SPREADSHEET_ID } from '../config/google-sheets.js';

export async function gsFetch(url, method = 'GET', body = null) {
  const opts = { method, headers: { Authorization: 'Bearer ' + state.gsToken, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// Devuelve las filas de la hoja, o `null` si la LECTURA falló (error de red/API).
// Distinguir null (fallo) de [] (hoja vacía legítima) es clave para el blindaje:
// nunca se debe sobrescribir una hoja cuya lectura falló.
export async function gsReadSheet(sheet) {
  try {
    const r = await gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${GS_SPREADSHEET_ID}/values/${encodeURIComponent(sheet)}`);
    return r.values || [];
  } catch (e) {
    console.error('gsReadSheet error', sheet, e);
    return null;
  }
}

export async function gsWriteRange(range, values) {
  return gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${GS_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, 'PUT', { values });
}

export async function gsAppendRow(sheet, row) {
  return gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${GS_SPREADSHEET_ID}/values/${encodeURIComponent(sheet)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, 'POST', { values: [row] });
}

// Sobrescribe una hoja de forma SEGURA: escribe primero y limpia los sobrantes
// después. Un fallo de escritura nunca vacía la hoja (los datos previos quedan
// intactos). Antes hacía clear+write, lo que podía dejar la hoja vacía si la
// escritura fallaba tras el clear.
export async function gsClearAndWrite(sheet, rows, headers) {
  const values = [headers, ...rows];
  // 1) Escribir/sobrescribir primero. values.update es atómico del lado de
  //    Google: aplica todo o lanza error. Si lanza, los datos viejos siguen ahí.
  await gsWriteRange(sheet + '!A1', values);
  // 2) Limpiar filas viejas sobrantes por debajo de los datos nuevos. Si esto
  //    falla, solo quedan filas de más (no es pérdida de datos).
  try {
    const primeraSobrante = values.length + 1; // fila 1-indexed siguiente a los datos
    await gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${GS_SPREADSHEET_ID}/values/${encodeURIComponent(sheet + '!A' + primeraSobrante + ':ZZ')}:clear`, 'POST', {});
  } catch (e) { console.error('gsClearAndWrite limpieza de sobrantes', e); }
}

export async function gsInitSheets() {
  const sheetsNeeded = ['proveedores', 'empleados', 'historial_pagos', 'proyectos', 'facturas', 'factura_pagos', 'aliases', 'cuentas_propias', 'traspasos', 'creditos', 'pagares', 'pagos_pagare', 'movimientos_internos', 'pendientes_confirmacion', 'historial_saldos', 'unidades', 'presupuesto_unidad', 'costo_asignaciones'];
  try {
    const r = await gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${GS_SPREADSHEET_ID}`);
    const existing = r.sheets.map(s => s.properties.title);
    const toCreate = sheetsNeeded.filter(s => !existing.includes(s));
    if (toCreate.length) {
      await gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${GS_SPREADSHEET_ID}:batchUpdate`, 'POST', {
        requests: toCreate.map(title => ({ addSheet: { properties: { title } } }))
      });
      const headers = {
        proveedores: [['proveedor_id', 'nombre', 'rfc', 'banco', 'tipo_cuenta', 'cuenta', 'clabe', 'categoria', 'Subcategoria', 'proyectos', 'activo', 'bloqueada_para_pago']],
        empleados: [['id', 'nombre', 'puesto', 'empresa', 'banco', 'tipo_cuenta', 'cuenta', 'activo']],
        historial_pagos: [['proveedor_id', 'factura_id', 'fecha', 'nombre', 'banco', 'tipo', 'concepto', 'importe', 'proyecto', 'cuenta_origen', 'tipo_registro', 'partida', 'sub_partida', 'id']],
        proyectos: [['id', 'nombre', 'empresa', 'cuenta', 'clabe', 'color', 'activo', 'saldo', 'ultima_act_saldo', 'es_concentradora']],
        facturas: [['factura_id', 'Numero_Fcatura', 'razon_social', 'proveedor_id', 'nombre_proveedor', 'fecha_factura', 'fecha_vencimiento', 'fecha_pago_total', 'monto_total', 'monto_pagado', 'saldo_pendiente', 'estatus_factura', 'proyecto', 'observaciones', 'activo', 'uuid']],
        factura_pagos: [['factura_pago_id', 'factura_id', 'pago_id', 'proveedor_id', 'monto_aplicado', 'fecha_pago', 'estatus', 'observaciones']],
        aliases: [['alias', 'proveedor_id', 'fecha']],
        cuentas_propias: [['cuenta_id', 'nombre', 'banco', 'clabe', 'numero_cuenta', 'proyecto', 'tipo', 'saldo', 'ultima_actualizacion', 'activo']],
        traspasos: [['traspaso_id', 'tipo', 'cuenta_origen_id', 'cuenta_origen_tipo', 'cuenta_origen_nombre', 'proyecto_origen', 'cuenta_destino_id', 'cuenta_destino_tipo', 'cuenta_destino_nombre', 'proyecto_destino', 'monto', 'fecha', 'concepto', 'referencia', 'estatus', 'fecha_registro']],
        creditos: [['credito_id', 'nombre', 'banco', 'tipo_credito', 'monto_autorizado', 'tasa_base', 'proyecto', 'cuenta_pago', 'estatus', 'activo']],
        pagares: [['pagare_id', 'credito_id', 'numero_pagare', 'monto', 'fecha_disposicion', 'fecha_vencimiento', 'tasa', 'estatus', 'activo']],
        pagos_pagare: [['pago_id', 'pagare_id', 'credito_id', 'fecha_pago', 'monto_intereses', 'concepto', 'estatus', 'fecha_real_pago']],
        movimientos_internos: [['id', 'fecha', 'tipo', 'origen', 'destino', 'monto', 'concepto', 'referencia']],
        pendientes_confirmacion: [['id', 'proveedor_id', 'factura_id', 'nombre', 'cuenta', 'banco', 'tipo', 'concepto', 'importe', 'proyecto', 'partida', 'cuenta_cargo', 'fechaGen', 'confirmado']],
        historial_saldos: [['fecha', 'cuenta_id', 'cuenta_nombre', 'cuenta_tipo', 'saldo', 'saldo_total']],
        unidades: [['unidad_id', 'proyecto', 'nombre', 'tipo', 'indiviso_pct', 'superficie_m2', 'estatus', 'orden', 'activo', 'plano_x', 'plano_y', 'plano_w', 'plano_h']],
        presupuesto_unidad: [['presupuesto_id', 'unidad_id', 'partida', 'sub_partida', 'monto_presupuestado', 'costo_inicial', 'notas']],
        costo_asignaciones: [['asignacion_id', 'pago_id', 'unidad_id', 'proyecto', 'metodo', 'monto_asignado', 'factor', 'fecha_asignacion', 'partida_override']]
      };
      for (const sheet of toCreate) {
        await gsWriteRange(sheet + '!A1', headers[sheet]);
      }
    }
  } catch (e) { console.error('gsInitSheets error', e); }
}

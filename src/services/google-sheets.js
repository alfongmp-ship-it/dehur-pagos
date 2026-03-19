import { state } from '../state.js';
import { GS_SPREADSHEET_ID } from '../config/google-sheets.js';

export async function gsFetch(url, method = 'GET', body = null) {
  const opts = { method, headers: { Authorization: 'Bearer ' + state.gsToken, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function gsReadSheet(sheet) {
  try {
    const r = await gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${GS_SPREADSHEET_ID}/values/${encodeURIComponent(sheet)}`);
    return r.values || [];
  } catch (e) { return []; }
}

export async function gsWriteRange(range, values) {
  return gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${GS_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, 'PUT', { values });
}

export async function gsAppendRow(sheet, row) {
  return gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${GS_SPREADSHEET_ID}/values/${encodeURIComponent(sheet)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, 'POST', { values: [row] });
}

export async function gsClearAndWrite(sheet, rows, headers) {
  await gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${GS_SPREADSHEET_ID}/values/${encodeURIComponent(sheet)}:clear`, 'POST', {});
  await gsWriteRange(sheet + '!A1', [headers, ...rows]);
}

export async function gsInitSheets() {
  const sheetsNeeded = ['proveedores', 'empleados', 'historial_pagos', 'proyectos', 'facturas', 'factura_pagos', 'aliases', 'cuentas_propias', 'traspasos', 'creditos'];
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
        historial_pagos: [['proveedor_id', 'factura_id', 'fecha', 'nombre', 'banco', 'tipo', 'concepto', 'importe', 'proyecto', 'cuenta_origen', 'tipo_registro']],
        proyectos: [['id', 'nombre', 'empresa', 'cuenta', 'clabe', 'color', 'activo', 'saldo', 'ultima_act_saldo', 'es_concentradora']],
        facturas: [['factura_id', 'proveedor_id', 'folio_factura', 'uuid', 'fecha_factura', 'fecha_registro', 'moneda', 'monto_total', 'monto_pagado', 'saldo_pendiente', 'estatus_factura', 'proyecto', 'observaciones', 'activo']],
        factura_pagos: [['factura_pago_id', 'factura_id', 'pago_id', 'proveedor_id', 'monto_aplicado', 'fecha_pago', 'estatus', 'observaciones']],
        aliases: [['alias', 'proveedor_id', 'fecha']],
        cuentas_propias: [['cuenta_id', 'nombre', 'banco', 'clabe', 'numero_cuenta', 'proyecto', 'tipo', 'saldo', 'ultima_actualizacion', 'activo']],
        traspasos: [['traspaso_id', 'tipo', 'cuenta_origen_id', 'cuenta_origen_tipo', 'cuenta_origen_nombre', 'proyecto_origen', 'cuenta_destino_id', 'cuenta_destino_tipo', 'cuenta_destino_nombre', 'proyecto_destino', 'monto', 'fecha', 'concepto', 'referencia', 'estatus', 'fecha_registro']],
        creditos: [['credito_id', 'banco', 'tipo_credito', 'monto_total', 'tasa_interes', 'plazo_meses', 'fecha_inicio', 'pago_mensual', 'saldo_pendiente', 'proyecto', 'concepto', 'estatus', 'activo']]
      };
      for (const sheet of toCreate) {
        await gsWriteRange(sheet + '!A1', headers[sheet]);
      }
    }
  } catch (e) { console.error('gsInitSheets error', e); }
}

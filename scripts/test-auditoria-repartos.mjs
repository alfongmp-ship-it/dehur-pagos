// Pruebas del motor puro de 🩺 Auditar repartos.
//   node scripts/test-auditoria-repartos.mjs
import { auditarRepartosMotor, resumirAuditoria, CATEGORIAS } from '../src/services/auditoria-repartos-motor.js';

let ok = 0, fail = 0;
const ck = (n, c, d) => { if (c) { ok++; console.log('OK  ' + n); } else { fail++; console.error('XX  ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); } };

// Reglas como las de la app (simplificadas): fechas ISO, cierre = fecha_termino,
// proyecto por igualdad sin acentos/mayúsculas.
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const reglas = (cubiertos = new Set()) => ({
  parseFecha: s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : ''),
  cierreDe: u => u.fecha_termino || '',
  proyMatch: (a, b) => norm(a) === norm(b),
  cubiertos,
});
const U = (id, extra = {}) => ({ unidad_id: id, nombre: 'C' + id, proyecto: 'Paraíso', activo: true, estatus: 'En obra', fecha_termino: '', ...extra });
const A = (extra) => ({ asignacion_id: 'a' + Math.random(), metodo: 'indiviso', factor: 0.5, monto_asignado: 50, partida_override: 'CONSTRUCCION', sub_partida_override: '', ...extra });
const F = (id, extra = {}) => ({ factura_id: id, numero_factura: 'X' + id, razon_social: 'Prov', proyecto: 'Paraíso', fecha_factura: '2025-06-01', monto_total: 100, estado_sat: 'Vigente', estatus_factura: 'pendiente', tipo_comprobante: 'Factura', ...extra });
const P = (id, extra = {}) => ({ id, nombre: 'Benef', proyecto: 'Paraíso', fecha: '2025-06-01', importe: 100, partida: 'Nómina', ...extra });
const cats = r => r.map(x => x.cat);
const has = (r, cat, sev) => r.some(x => x.cat === cat && (!sev || x.sev === sev));

// --- caso limpio: nada que reportar ---
{
  const r = auditarRepartosMotor({
    unidades: [U(1), U(2)], facturas: [F(10)],
    asigs: [A({ factura_id: 10, unidad_id: 1 }), A({ factura_id: 10, unidad_id: 2 })],
  }, reglas());
  ck('reparto sano no genera hallazgos', r.length === 0, cats(r));
}

// --- 1. posterior al cierre: indiviso = ERROR, dirigido = REVISAR; anterior = nada ---
{
  const unidades = [U(329, { fecha_termino: '2024-10-14', estatus: 'Terminada' }), U(2)];
  const r = auditarRepartosMotor({
    unidades, facturas: [F(10, { fecha_factura: '2025-01-15' }), F(11, { fecha_factura: '2024-09-01' }), F(12, { fecha_factura: '2025-02-01', monto_total: 50 })],
    asigs: [
      A({ factura_id: 10, unidad_id: 329 }), A({ factura_id: 10, unidad_id: 2 }),
      A({ factura_id: 11, unidad_id: 329 }), A({ factura_id: 11, unidad_id: 2 }),
      A({ factura_id: 12, unidad_id: 329, metodo: 'directo', factor: 1, monto_asignado: 50 }),
    ],
  }, reglas());
  const pc = r.filter(x => x.cat === 'posterior_cierre');
  ck('factura posterior al cierre por indiviso → ERROR', pc.some(x => x.docId === '10' && x.sev === 'ERROR' && x.casa === 'C329'));
  ck('factura ANTERIOR al cierre no se marca', !pc.some(x => x.docId === '11'));
  ck('dirigido posterior al cierre → REVISAR', pc.some(x => x.docId === '12' && x.sev === 'REVISAR'));
  ck('el día exacto del cierre ya cuenta como cerrada', auditarRepartosMotor({ unidades, facturas: [F(13, { fecha_factura: '2024-10-14' })],
    asigs: [A({ factura_id: 13, unidad_id: 329 }), A({ factura_id: 13, unidad_id: 2 })] }, reglas()).some(x => x.cat === 'posterior_cierre'));
}

// --- 2. terminada sin fecha ---
{
  const r = auditarRepartosMotor({ unidades: [U(1, { estatus: 'Terminada' }), U(2, { estatus: 'Terminada', fecha_termino: '2025-01-01' }), U(3)], asigs: [] }, reglas());
  ck('Terminada sin fecha → ERROR', has(r, 'terminada_sin_fecha', 'ERROR') && r.filter(x => x.cat === 'terminada_sin_fecha').length === 1);
}

// --- 3. sobre-repartido / 4. pago sub-repartido ---
{
  const r = auditarRepartosMotor({
    unidades: [U(1), U(2)], facturas: [F(10)], historial: [P(20), P(21)],
    asigs: [
      A({ factura_id: 10, unidad_id: 1, monto_asignado: 100, factor: 1 }), A({ factura_id: 10, unidad_id: 2, monto_asignado: 50 }),
      A({ pago_id: 20, unidad_id: 1, monto_asignado: 30, factor: 0.3 }),
      A({ pago_id: 21, unidad_id: 1, monto_asignado: 99.8, factor: 0.998 }),
    ],
  }, reglas());
  ck('factura con reparto > total → sobre_repartido', has(r, 'sobre_repartido') && r.find(x => x.cat === 'sobre_repartido').monto === 50);
  ck('pago con reparto < importe → pago_sub_repartido', r.some(x => x.cat === 'pago_sub_repartido' && x.docId === '20'));
  ck('diferencia < $0.50 es redondeo, no se marca', !r.some(x => x.docId === '21' && (x.cat === 'pago_sub_repartido' || x.cat === 'sobre_repartido')));
}

// --- 5. duplicado vs por partes ---
{
  const r = auditarRepartosMotor({
    unidades: [U(1), U(2)], facturas: [F(10), F(11)],
    asigs: [
      A({ factura_id: 10, unidad_id: 1 }), A({ factura_id: 10, unidad_id: 1 }),                       // misma partida → duplicado
      A({ factura_id: 11, unidad_id: 1, monto_asignado: 25, factor: 0.5 }), A({ factura_id: 11, unidad_id: 1, partida_override: 'Indirectos', monto_asignado: 25, factor: 0.5 }),
      A({ factura_id: 11, unidad_id: 2, monto_asignado: 25, factor: 0.5 }), A({ factura_id: 11, unidad_id: 2, partida_override: 'Indirectos', monto_asignado: 25, factor: 0.5 }),
    ],
  }, reglas());
  ck('misma casa y misma partida dos veces → duplicado', r.some(x => x.cat === 'duplicado' && x.docId === '10'));
  ck('misma casa en partidas distintas → por_partes (INFO), no duplicado', r.some(x => x.cat === 'por_partes' && x.docId === '11') && !r.some(x => x.cat === 'duplicado' && x.docId === '11'));
  ck('por partes con factor relativo a la parte NO es factor incoherente', !r.some(x => x.cat === 'factor_incoherente' && x.docId === '11'));
}

// --- 6. huérfanas / 7. casa inválida ---
{
  const r = auditarRepartosMotor({
    unidades: [U(1), U(2, { activo: false }), U(3, { proyecto: 'Entorno' })], facturas: [F(10)],
    asigs: [
      A({ factura_id: 999, unidad_id: 1 }),
      A({ factura_id: 10, unidad_id: 2, monto_asignado: 25, factor: 0.25 }), A({ factura_id: 10, unidad_id: 3, monto_asignado: 25, factor: 0.25 }),
      A({ factura_id: 10, unidad_id: 77, monto_asignado: 50 }),
    ],
  }, reglas());
  ck('factura inexistente → huérfana', r.some(x => x.cat === 'huerfana' && x.docId === '999'));
  ck('casa dada de baja → casa_invalida REVISAR', r.some(x => x.cat === 'casa_invalida' && x.unidadId === '2' && x.sev === 'REVISAR'));
  ck('casa de otro proyecto → casa_invalida ERROR', r.some(x => x.cat === 'casa_invalida' && x.unidadId === '3' && x.sev === 'ERROR'));
  ck('casa inexistente → casa_invalida ERROR', r.some(x => x.cat === 'casa_invalida' && x.unidadId === '77' && x.sev === 'ERROR'));
}

// --- 8. NC / 9. cancelada / 11. fecha inválida / 15. monto no positivo ---
{
  const r = auditarRepartosMotor({
    unidades: [U(1)], facturas: [F(10, { tipo_comprobante: 'Nota de crédito' }), F(11, { estatus_factura: 'cancelada' }), F(12, { fecha_factura: 'ayer' }), F(13)],
    asigs: [
      A({ factura_id: 10, unidad_id: 1, monto_asignado: 100, factor: 1 }), A({ factura_id: 11, unidad_id: 1, monto_asignado: 100, factor: 1 }),
      A({ factura_id: 12, unidad_id: 1, monto_asignado: 100, factor: 1 }), A({ factura_id: 13, unidad_id: 1, monto_asignado: 0, factor: 0 }),
    ],
  }, reglas());
  ck('nota de crédito repartida → comprobante_no_factura', r.some(x => x.cat === 'comprobante_no_factura' && x.docId === '10'));
  ck('cancelada por estatus_factura → factura_cancelada', r.some(x => x.cat === 'factura_cancelada' && x.docId === '11'));
  ck('fecha ilegible → fecha_invalida', r.some(x => x.cat === 'fecha_invalida' && x.docId === '12'));
  ck('monto 0 → monto_no_positivo', r.some(x => x.cat === 'monto_no_positivo' && x.docId === '13'));
  ck('factura sana (F13 aparte del monto) no se marca cancelada/NC', !r.some(x => x.docId === '13' && ['factura_cancelada', 'comprobante_no_factura'].includes(x.cat)));
}

// --- 10. suprimido / aplicación parcial ---
{
  const r = auditarRepartosMotor({
    unidades: [U(1)], historial: [P(20, { importe: 100 }), P(21, { importe: 100 })],
    asigs: [A({ pago_id: 20, unidad_id: 1, monto_asignado: 100, factor: 1 })],
    facturaPagos: [{ pago_id: 20, monto_aplicado: 100 }, { pago_id: 21, monto_aplicado: 60 }],
  }, reglas(new Set(['20', '21'])));
  ck('pago con reparto propio cubierto por factura → pago_suprimido INFO', r.some(x => x.cat === 'pago_suprimido' && x.docId === '20' && x.sev === 'INFO'));
  ck('pago suprimido NO se marca como posterior/sub-repartido', !r.some(x => x.docId === '20' && ['pago_sub_repartido', 'posterior_cierre'].includes(x.cat)));
  ck('pago aplicado 60 de 100 → aplicación parcial (resto 40)', r.some(x => x.cat === 'pago_aplicacion_parcial' && x.docId === '21' && Math.abs(x.monto - 40) < 1e-9));
  ck('pago aplicado completo NO es parcial', !r.some(x => x.cat === 'pago_aplicacion_parcial' && x.docId === '20'));
}

// --- 14. factor incoherente ---
{
  const r = auditarRepartosMotor({
    unidades: [U(1), U(2)], facturas: [F(10)],
    asigs: [A({ factura_id: 10, unidad_id: 1, monto_asignado: 50, factor: 0.9 }), A({ factura_id: 10, unidad_id: 2, monto_asignado: 50, factor: 0.5 })],
  }, reglas());
  ck('factor 90% con monto de 50% → factor_incoherente', r.some(x => x.cat === 'factor_incoherente' && x.unidadId === '1'));
  ck('factor coherente no se marca', !r.some(x => x.cat === 'factor_incoherente' && x.unidadId === '2'));
}

// --- revisión adversarial: reparto en varios pasos con la misma partida es legítimo ---
{
  const r = auditarRepartosMotor({
    unidades: [U(1), U(2)], facturas: [F(10)],
    asigs: [   // paso 1 (60%): 30/30 · paso 2 (40%): 20/20, misma partida, otra fecha
      A({ factura_id: 10, unidad_id: 1, monto_asignado: 30, factor: 0.5, fecha_asignacion: '2025-01-01' }),
      A({ factura_id: 10, unidad_id: 2, monto_asignado: 30, factor: 0.5, fecha_asignacion: '2025-01-01' }),
      A({ factura_id: 10, unidad_id: 1, monto_asignado: 20, factor: 0.5, fecha_asignacion: '2025-02-01' }),
      A({ factura_id: 10, unidad_id: 2, monto_asignado: 20, factor: 0.5, fecha_asignacion: '2025-02-01' }),
    ],
  }, reglas());
  ck('varios pasos misma partida (Σ = total) NO es duplicado', !r.some(x => x.cat === 'duplicado'), cats(r));
  ck('…se reporta como por_partes INFO', r.some(x => x.cat === 'por_partes' && x.sev === 'INFO'));
  ck('…y su factor (relativo al paso) no es incoherente', !r.some(x => x.cat === 'factor_incoherente'), cats(r));
  const r2 = auditarRepartosMotor({
    unidades: [U(1)], facturas: [F(11)],
    asigs: [A({ factura_id: 11, unidad_id: 1, monto_asignado: 100, factor: 1, fecha_asignacion: '2025-01-01' }),
            A({ factura_id: 11, unidad_id: 1, monto_asignado: 40, factor: 0.4, fecha_asignacion: '2025-02-01' })],
  }, reglas());
  ck('misma partida repetida y SOBRE-repartida → duplicado ERROR', r2.some(x => x.cat === 'duplicado' && x.sev === 'ERROR'));
}

// --- revisión adversarial: documentos que la app no cuenta bajan a INFO ---
{
  const unidades = [U(1, { fecha_termino: '2024-01-01', estatus: 'Terminada' }), U(2)];
  const r = auditarRepartosMotor({
    unidades, facturas: [F(10, { estado_sat: 'Cancelada', fecha_factura: '2025-01-01' })], historial: [P(20, { fecha: '2025-01-01' })],
    asigs: [A({ factura_id: 10, unidad_id: 1 }), A({ factura_id: 10, unidad_id: 2 }),
            A({ pago_id: 20, unidad_id: 1 }), A({ pago_id: 20, unidad_id: 2 })],
  }, { ...reglas(), capital: new Set(['20']) });
  ck('factura cancelada en SAT: posterior al cierre baja a INFO', r.some(x => x.cat === 'posterior_cierre' && x.docId === '10' && x.sev === 'INFO'));
  ck('pago de capital: posterior al cierre baja a INFO', r.some(x => x.cat === 'posterior_cierre' && x.docId === '20' && x.sev === 'INFO'));
  ck('la cancelación misma sigue reportándose (REVISAR)', r.some(x => x.cat === 'factura_cancelada' && x.sev === 'REVISAR'));
}

// --- revisión adversarial: casa cerrada por escritura sin fecha de terminación → REVISAR ---
{
  const r = auditarRepartosMotor({ unidades: [U(5, { estatus: 'Vendida' })], asigs: [] },
    { ...reglas(), cierreDe: u => (String(u.unidad_id) === '5' ? '2025-03-01' : '') });
  ck('Vendida sin terminación pero escriturada → REVISAR (no ERROR)', r.some(x => x.cat === 'terminada_sin_fecha' && x.sev === 'REVISAR'));
  ck('las filas traen el proyecto de la CASA (para agrupar por casa)', r.every(x => x.proyectoCasa === 'Paraíso'));
}

// --- resumen ---
{
  const r = auditarRepartosMotor({
    unidades: [U(1, { fecha_termino: '2024-01-01' }), U(2)], facturas: [F(10, { fecha_factura: '2025-01-01' }), F(11, { fecha_factura: '2025-02-01' })],
    asigs: [A({ factura_id: 10, unidad_id: 1 }), A({ factura_id: 10, unidad_id: 2 }), A({ factura_id: 11, unidad_id: 1 }), A({ factura_id: 11, unidad_id: 2 })],
  }, reglas());
  const res = resumirAuditoria(r);
  const pc = res.find(x => x.key === 'posterior_cierre');
  ck('resumen cuenta filas, documentos y $', pc && pc.filas === 2 && pc.docs === 2 && pc.monto === 100, pc);
  ck('todas las categorías tienen título y acción', CATEGORIAS.every(c => c.titulo && c.accion));
}

console.log(`\n${ok} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);

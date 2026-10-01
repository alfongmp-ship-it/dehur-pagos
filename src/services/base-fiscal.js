// ============================================================================
// Base FISCAL de las facturas (motor PURO, sin imports; pruebas en
// scripts/test-base-fiscal.mjs).
//
// Regla (Ericka, contadora, 2026-09-30): fiscalmente se reparte SUBTOTAL + IVA de
// cada factura; las retenciones (ISR / IVA retenido) NO bajan el costo fiscal.
// `monto_total` es el NETO que se le paga al proveedor (subtotal − descuento + IVA
// − retenciones − NC), así que:
//      base fiscal = monto_total + retención IVA + retención ISR
//                  = subtotal − descuento + IVA − NC
// Los repartos (`monto_asignado`) están hechos sobre el neto. Para las vistas
// FISCALES cada fila se multiplica por (base fiscal ÷ neto): cada casa y cada
// partida conservan su mismo % de la factura. Costos por Unidad (operativo) NO usa
// esto: sigue con lo pagado al proveedor (las retenciones entran ahí como pagos al
// SAT). Un solo reparto, dos montos.
// ============================================================================

const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const num = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

// Retenciones de la factura (nunca negativas: un negativo sería error de captura).
export function retencionesFactura(f) {
  if (!f) return 0;
  return Math.max(0, num(f.retencion_iva)) + Math.max(0, num(f.retencion_isr));
}

// Subtotal + IVA (− descuento − NC), calculado desde lo capturado: total + retenciones.
// Factura SIN desglose (subtotal 0: capturada solo con el total) o con total no
// positivo → su total, igual que hoy: no se sabe si ese total era neto o bruto.
export function baseFiscalFactura(f) {
  if (!f) return 0;
  const neto = num(f.monto_total);
  if (!(neto > 0) || !(num(f.subtotal) > 0)) return r2(neto);
  return r2(neto + retencionesFactura(f));
}

// Retenciones que SÍ suben el costo fiscal (0 en facturas sin desglose).
export function retencionesFiscales(f) {
  if (!f) return 0;
  return r2(baseFiscalFactura(f) - num(f.monto_total));
}

// Multiplicador de cada fila de reparto de esa factura. Sin retenciones que cuenten
// → 1 (el monto fiscal es el mismo que el operativo).
export function factorFiscalFactura(f) {
  const neto = num(f && f.monto_total);
  const base = baseFiscalFactura(f);
  if (!(neto > 0) || base === r2(neto)) return 1;
  return base / neto;
}

// Monto FISCAL de cada fila de reparto de factura: Map(asignacion_id → monto).
// Solo trae las filas de facturas CON retenciones (las demás valen su monto_asignado).
// Redondeo: r2 por fila y el centavo restante en la fila de mayor monto de cada
// factura, para que la suma de sus filas fiscales sea exacta.
export function montosFiscales(asigs, facturas) {
  const facById = new Map((facturas || []).map(f => [String(f.factura_id), f]));
  const porFactura = new Map();
  (asigs || []).forEach(a => {
    if (!a || a.factura_id == null || String(a.factura_id) === '') return;
    const k = String(a.factura_id);
    let l = porFactura.get(k);
    if (!l) { l = []; porFactura.set(k, l); }
    l.push(a);
  });
  const out = new Map();
  porFactura.forEach((filas, k) => {
    const fac = factorFiscalFactura(facById.get(k));
    if (fac === 1) return;
    const meta = r2(filas.reduce((s, a) => s + num(a.monto_asignado), 0) * fac);
    let suma = 0, mayor = null;
    filas.forEach(a => {
      const v = r2(num(a.monto_asignado) * fac);
      out.set(String(a.asignacion_id), v);
      suma += v;
      if (!mayor || Math.abs(num(a.monto_asignado)) > Math.abs(num(mayor.monto_asignado))) mayor = a;
    });
    const dif = r2(meta - suma);
    if (mayor && Math.abs(dif) >= 0.01) {
      const id = String(mayor.asignacion_id);
      out.set(id, r2(out.get(id) + dif));
    }
  });
  return out;
}

// Monto fiscal de una fila (con el mapa de montosFiscales); si no está, su monto.
export function montoFiscalDe(mapa, a) {
  if (!a) return 0;
  const v = mapa && mapa.get(String(a.asignacion_id));
  return v != null ? v : num(a.monto_asignado);
}

// ¿El desglose capturado sostiene el total? Para la lista de calidad de datos.
//   sinDesglose → subtotal ≤ 0: solo hay total (su base fiscal = total).
//   noCuadra    → subtotal − desc + IVA − ret − NC difiere del total en más de $1.
export function desgloseFactura(f) {
  const sub = num(f && f.subtotal), desc = num(f && f.descuento), iva = num(f && f.iva_trasladado);
  const ret = retencionesFactura(f), nc = num(f && f.nc_subtotal) + num(f && f.nc_iva);
  const total = num(f && f.monto_total);
  const calculado = r2(sub - desc + iva - ret - nc);
  const sinDesglose = !(sub > 0);
  const diferencia = sinDesglose ? 0 : r2(total - calculado);
  const baseIva = sub - desc;
  return {
    subtotal: sub, descuento: desc, iva, retenciones: ret, retIva: Math.max(0, num(f && f.retencion_iva)),
    retIsr: Math.max(0, num(f && f.retencion_isr)), nc, total, calculado, diferencia, sinDesglose,
    noCuadra: !sinDesglose && Math.abs(diferencia) > 1,
    retSinSubtotal: sinDesglose && ret > 0,   // trae retenciones pero no subtotal: verificar que el total sea neto
    ivaPct: baseIva > 0 ? iva / baseIva : null,
    baseFiscal: baseFiscalFactura(f),
  };
}

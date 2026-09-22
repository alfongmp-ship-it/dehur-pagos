// ===== MOTOR RMF 3.2.4 — Estimados de cobros por bienes NO entregados =====
// FUNCIONES PURAS. Sin DOM, sin state, sin imports y SIN new Date() (el
// ejercicio entra como dato). El módulo de UI (fiscal.js) arma los insumos.
//
// Regla 3.2.4 RMF (lado ingresos, desarrolladores): los cobros de casas VENDIDAS
// pero NO escrituradas al cierre del ejercicio se acumulan al 31/dic, y se deduce
// un costo de lo vendido ESTIMADO = cobros × factor. Al escriturar la casa se
// acumula el precio total y se REVIERTE lo antes acumulado (y su estimado).
// La app INFORMA: el factor lo decide contabilidad (capturable, con sugerencia).
//
// insumos = {
//   ejercicio: 2025,                       // año E; corte = 31/dic/E
//   ventas: [{ ventaId, unidadId, etiqueta, cliente, precio, estatus,
//              fechaEscrituraISO,          // 'YYYY-MM-DD' o '' (parseada por la UI)
//              activo }],                  // ventas de UN proyecto
//   cobros: [{ ventaId, fechaISO, monto, activo }],  // fechaISO '' = sin fecha válida
//   presupuestoPorUnidad: { [unidadId]: monto },     // para el factor sugerido
//   costoRealPorUnidad:  { [unidadId]: monto },      // fallback del sugerido
// }
// cfgFn('factor') → factor capturado por contabilidad (fracción, ej. 0.62) o null.
//
// Devuelve { registro, baseAcumulable, factorUsado, factorFuente, factorSugerido,
//   factorSugeridoFuente, costoEstimado, neto, reversiones, totReversionCobrado,
//   totPrecioEscriturado, avisos: string[], desglose: string[] } — todo derivado,
// nada se escribe: los números gerenciales y de Ingresos no cambian un centavo.

const _num = (v, fb) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
const _r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;

export function estimados324(insumos, cfgFn) {
  const E = Math.trunc(_num(insumos && insumos.ejercicio, 0));
  const avisos = [], desglose = [];
  if (!E || E < 2000 || E > 2100) {
    return { registro: [], baseAcumulable: 0, factorUsado: 0, factorFuente: 'sin datos',
      factorSugerido: null, factorSugeridoFuente: null, costoEstimado: 0, neto: 0,
      reversiones: [], totReversionCobrado: 0, totPrecioEscriturado: 0,
      avisos: ['Ejercicio inválido'], desglose: [] };
  }
  const corte = `${E}-12-31`;
  const corteAnt = `${E - 1}-12-31`;
  const ventas = (insumos.ventas || []).filter(v => v && v.activo !== false);
  const presu = insumos.presupuestoPorUnidad || {};
  const real = insumos.costoRealPorUnidad || {};

  // Cobros por venta, una pasada. Comparación lexicográfica de 'YYYY-MM-DD'.
  // Mismo criterio que recalcularVenta: TODOS los tipos, solo activo !== false.
  const porVenta = new Map();   // ventaId → [{fechaISO, monto}]
  let cobrosSinFecha = 0, montoSinFecha = 0;
  (insumos.cobros || []).forEach(c => {
    if (!c || c.activo === false) return;
    const vid = String(c.ventaId);
    if (!c.fechaISO) { cobrosSinFecha++; montoSinFecha += _num(c.monto, 0); return; }
    let arr = porVenta.get(vid); if (!arr) { arr = []; porVenta.set(vid, arr); }
    arr.push({ fechaISO: String(c.fechaISO), monto: _num(c.monto, 0) });
  });
  const cobradoHasta = (ventaId, limite) => {
    const arr = porVenta.get(String(ventaId));
    if (!arr) return 0;
    let s = 0; arr.forEach(c => { if (c.fechaISO <= limite) s += c.monto; });
    return _r2(s);
  };
  if (cobrosSinFecha) avisos.push(`${cobrosSinFecha} cobro(s) sin fecha válida por ${_r2(montoSinFecha)} — EXCLUIDOS del corte; corrige su fecha en Cobranza.`);

  // Clasificación de ventas al corte del 31/dic/E.
  const registro = [], reversiones = [];
  let nCanceladas = 0, nEscrituradasAlCorte = 0, nSinFechaEsc = 0, nElegibles = 0;
  ventas.forEach(v => {
    if (v.estatus === 'cancelada') { nCanceladas++; return; }
    const fe = String(v.fechaEscrituraISO || '');
    const anioEsc = fe ? Math.trunc(_num(fe.slice(0, 4), 0)) : null;
    if (!fe && v.estatus === 'escriturada') {
      // Estado actual dice escriturada pero sin fecha: no se puede ubicar el
      // ejercicio → fuera del registro (conservador) + aviso para capturarla.
      nSinFechaEsc++;
      avisos.push(`"${v.etiqueta || v.unidadId}" está ESCRITURADA sin fecha de escritura capturada — queda fuera del registro; captúrale la fecha en Ventas.`);
      return;
    }
    if (anioEsc != null && anioEsc <= E) {
      nEscrituradasAlCorte++;
      if (anioEsc === E) {
        // Escriturada EN el ejercicio: se acumula su precio total y se revierte
        // lo que traía acumulado al cierre ANTERIOR (con su estimado de entonces).
        reversiones.push({
          ventaId: v.ventaId, unidadId: v.unidadId, etiqueta: v.etiqueta || String(v.unidadId),
          cliente: v.cliente || '', fechaEscrituraISO: fe, precio: _r2(_num(v.precio, 0)),
          cobradoAlCierreAnterior: cobradoHasta(v.ventaId, corteAnt),
        });
      }
      return;
    }
    // NO escriturada al corte → candidata al registro de cobros por bien no entregado.
    nElegibles++;
    const cobrado = cobradoHasta(v.ventaId, corte);
    if (cobrado <= 0.005) return;   // sin cobros al corte: no aporta al registro
    const precio = _r2(_num(v.precio, 0));
    if (precio > 0 && cobrado > precio + 0.01) {
      avisos.push(`"${v.etiqueta || v.unidadId}": cobrado al corte (${cobrado}) EXCEDE el precio de venta (${precio}) — revisa cobros duplicados o precio.`);
    }
    registro.push({
      ventaId: v.ventaId, unidadId: v.unidadId, etiqueta: v.etiqueta || String(v.unidadId),
      cliente: v.cliente || '', precio, cobradoAlCorte: cobrado,
      pctPrecio: precio > 0 ? (cobrado / precio) * 100 : null,
    });
  });
  registro.sort((a, b) => b.cobradoAlCorte - a.cobradoAlCorte);
  reversiones.sort((a, b) => (a.fechaEscrituraISO < b.fechaEscrituraISO ? -1 : 1));

  const baseAcumulable = _r2(registro.reduce((s, r) => s + r.cobradoAlCorte, 0));
  const totReversionCobrado = _r2(reversiones.reduce((s, r) => s + r.cobradoAlCierreAnterior, 0));
  const totPrecioEscriturado = _r2(reversiones.reduce((s, r) => s + r.precio, 0));

  // Factor sugerido: costo presupuestado de LAS CASAS DEL REGISTRO ÷ su precio de
  // venta (fallback: costo real acumulado ÷ precio). Solo una referencia — el
  // factor fiscal lo determina contabilidad.
  let sumPresu = 0, sumReal = 0, sumPrecio = 0;
  registro.forEach(r => {
    const k = String(r.unidadId);
    sumPresu += _num(presu[k], 0);
    sumReal += _num(real[k], 0);
    sumPrecio += r.precio;
  });
  let factorSugerido = null, factorSugeridoFuente = null;
  if (sumPrecio > 0) {
    if (sumPresu > 0) { factorSugerido = sumPresu / sumPrecio; factorSugeridoFuente = 'presupuesto'; }
    else if (sumReal > 0) { factorSugerido = sumReal / sumPrecio; factorSugeridoFuente = 'costo real'; }
  }
  if (factorSugerido != null && factorSugerido > 1) {
    avisos.push(`El factor sugerido (${(factorSugerido * 100).toFixed(1)}%) es MAYOR a 100%: el costo de esas casas supera su precio — revisa presupuestos/precios.`);
  }

  const capturado = _num(cfgFn && cfgFn('factor'), NaN);
  const capturadoValido = Number.isFinite(capturado) && capturado > 0 && capturado <= 1.5;
  const factorUsado = capturadoValido ? capturado : (factorSugerido || 0);
  const factorFuente = capturadoValido ? 'capturado' : (factorSugerido != null ? 'sugerido' : 'sin factor');
  const costoEstimado = _r2(baseAcumulable * factorUsado);
  const neto = _r2(baseAcumulable - costoEstimado);

  desglose.push(`Ejercicio ${E} · corte ${corte}`);
  desglose.push(`Ventas del proyecto: ${ventas.length} (canceladas fuera: ${nCanceladas} · escrituradas al corte fuera: ${nEscrituradasAlCorte} · escrituradas SIN fecha fuera: ${nSinFechaEsc})`);
  desglose.push(`No escrituradas al corte: ${nElegibles} → en el registro (con cobros): ${registro.length}`);
  if (cobrosSinFecha) desglose.push(`Cobros sin fecha excluidos: ${cobrosSinFecha} por ${_r2(montoSinFecha)}`);
  desglose.push(`Base acumulable 3.2.4 (cobros al corte de bienes no escriturados): ${baseAcumulable}`);
  desglose.push(`Factor ${factorFuente}${factorSugerido != null ? ` (sugerido ${(factorSugerido * 100).toFixed(2)}% por ${factorSugeridoFuente})` : ''}: ${(factorUsado * 100).toFixed(2)}%`);
  desglose.push(`Costo estimado deducible: ${costoEstimado} · Neto acumulable: ${neto}`);
  desglose.push(`Escrituradas en ${E} (reversión): ${reversiones.length} · cobrado al cierre ${E - 1} que se revierte: ${totReversionCobrado} · precio total que se acumula: ${totPrecioEscriturado}`);

  return { registro, baseAcumulable, factorUsado, factorFuente, factorSugerido,
    factorSugeridoFuente, costoEstimado, neto, reversiones, totReversionCobrado,
    totPrecioEscriturado, avisos, desglose };
}

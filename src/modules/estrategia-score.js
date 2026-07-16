// ============================================================================
// estrategia-score.js — MOTOR DE SCORE (Fase 2). FUNCIONES PURAS.
// ============================================================================
// Sin DOM, sin state, sin imports: recibe insumos + un lector de configuración
// (cfgFn) → testeable con node (scripts/test-estrategia-score.mjs). Todos los
// supuestos vienen de cfgFn (claves de estrategia_config); los únicos números
// fijos son de la propia fórmula del doc: 4.33 (semanas/mes), max(mesesCobro,
// 0.5) y max(costoTerminar, $1) (guarda numérica contra división entre cero,
// documentada en el desglose).
//
// insumo por unidad:
// {
//   unidad_id, nombre, proyecto,
//   costoReal, presupuesto, avance,   // avance en % (0-100) o null sin presupuesto
//   terminada,                         // bool: estatus Terminada/Entregada/Vendida o fecha_termino
//   venta: null | { estatus_comercial, precio_venta, valor_liberacion,
//                   saldo_cliente, monto_cobrado, tipo_credito },
//   precioEstimado,                    // precio asumido si NO hay venta (promedio del proyecto)
//   tasaAnual,                         // % anual del crédito puente del proyecto (0 = sin crédito)
//   flags: { bloqueo, categoria, compromiso, fechaCompromiso, estrategica, nota }
// }
// ============================================================================

const _num = (v, fb) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
const _r = (v, d = 2) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
const _m = v => '$' + (Math.round((v || 0) * 100) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 });

// Situación comercial para el score: sin venta activa (o cancelada) = 'disponible'.
export function estatusScore(insumo) {
  const v = insumo.venta;
  if (!v || v.activo === false || v.estatus_comercial === 'cancelada') return 'disponible';
  if (v.estatus_comercial === 'escriturada') return 'escriturada';
  if (v.estatus_comercial === 'vendida') return 'vendida';
  return 'apartada';
}

// Score crudo de UNA unidad + desglose línea por línea (auditable, obligatorio).
export function scoreUnidad(insumo, cfgFn) {
  const estatus = estatusScore(insumo);
  const v = (insumo.venta && insumo.venta.activo !== false && insumo.venta.estatus_comercial !== 'cancelada') ? insumo.venta : null;
  const d = [];

  // Probabilidad de cobro (castigo multiplicativo solo a estatus inciertos)
  const castigo = _num(cfgFn('score.castigo_incertidumbre'), 1);
  const probBase = _num(cfgFn('prob_cobro.' + estatus), 0);
  const incierta = estatus === 'apartada' || estatus === 'disponible';
  const prob = probBase * (incierta ? castigo : 1);
  d.push(`prob = prob_cobro.${estatus} (${probBase})${incierta && castigo !== 1 ? ` × castigo_incertidumbre (${castigo})` : ''} = ${_r(prob, 4)}`);

  // Lag de cobro (meses tras terminar obra) + ajuste por tipo de crédito
  const tipoCred = (v && v.tipo_credito) || '';
  const lagBase = _num(cfgFn('lag_cobro.' + estatus), 0);
  const lagAjuste = tipoCred ? _num(cfgFn('lag_ajuste_credito.' + tipoCred), 0) : 0;
  const lagMeses = lagBase + lagAjuste;
  d.push(`lag = lag_cobro.${estatus} (${lagBase})${tipoCred ? ` + lag_ajuste_credito.${tipoCred} (${lagAjuste})` : ''} = ${_r(lagMeses, 2)} meses`);

  // Costo por terminar (con colchón; 0 si la obra ya no requiere inversión)
  const restante = Math.max((insumo.presupuesto || 0) - (insumo.costoReal || 0), 0);
  const colchonPct = _num(cfgFn('obra.colchon_pct'), 0.08);
  const colchonMin = _num(cfgFn('obra.colchon_min'), 60000);
  const costoTerminar = restante > 0 ? restante * (1 + colchonPct) + colchonMin : 0;
  d.push(`costoTerminar = max(presupuesto ${_m(insumo.presupuesto)} − real ${_m(insumo.costoReal)}, 0)${restante > 0 ? ` × (1 + ${colchonPct}) + ${_m(colchonMin)}` : ''} = ${_m(costoTerminar)}`);

  // Precio (de la venta; sin venta = estimado del proyecto) y valor de liberación
  const precio = v ? (v.precio_venta || 0) : (insumo.precioEstimado || 0);
  const precioEsEstimado = !v;
  const pctLib = _num(cfgFn('tesoreria.pct_liberacion_default'), 0.55);
  const liberacionCapturada = !!(v && v.valor_liberacion > 0);
  const liberacion = liberacionCapturada ? v.valor_liberacion : precio * pctLib;
  d.push(`precio = ${_m(precio)}${precioEsEstimado ? ' (ESTIMADO: promedio de ventas del proyecto)' : ''}`);
  d.push(`liberación = ${_m(liberacion)}${liberacionCapturada ? ' (capturada en la venta)' : ` (ESTIMADA: ${pctLib} × precio)`}`);

  // Flujo esperado (el adeudo en plan de pagos solo aplica a escrituradas)
  const probAdeudo = _num(cfgFn('prob_cobro.adeudo'), 0.9);
  const adeudo = (estatus === 'escriturada' && v) ? (v.saldo_cliente || 0) : 0;
  const flujoEsp = (precio - liberacion + adeudo * probAdeudo) * prob;
  d.push(`flujoEsp = (precio − liberación${adeudo ? ` + adeudo ${_m(adeudo)} × prob_cobro.adeudo (${probAdeudo})` : ''}) × prob = ${_m(flujoEsp)}`);

  // Ahorro de intereses al liberar (por mes)
  const tasa = _num(insumo.tasaAnual, 0);
  const ahorroMes = liberacion * (tasa / 100 / 12);
  d.push(`ahorroMes = liberación × (tasa ${tasa}% anual / 12) = ${_m(ahorroMes)}`);

  // Tiempo: semanas de obra (tope físico) + mínimo de cierre si avance ≥ 85%
  const ritmo = _num(cfgFn('obra.ritmo_max_semanal'), 350000);
  let semanasObra = ritmo > 0 ? costoTerminar / ritmo : 0;
  const semMin = _num(cfgFn('obra.semanas_min_cierre'), 4);
  const casiTerminada = insumo.avance != null && insumo.avance >= 85;
  if (casiTerminada && costoTerminar > 0) semanasObra = Math.max(semanasObra, semMin);
  d.push(`semanasObra = costoTerminar / ritmo (${_m(ritmo)}/sem)${casiTerminada && costoTerminar > 0 ? ` con mínimo de cierre ${semMin} sem (avance ≥ 85%)` : ''} = ${_r(semanasObra, 2)}`);

  const mesesCobro = semanasObra / 4.33 + lagMeses;
  d.push(`mesesCobro = semanasObra / 4.33 + lag = ${_r(mesesCobro, 2)}`);

  // Score crudo: flujo (+ ahorro en el horizonte) por peso invertido por mes
  const horizonte = _num(cfgFn('score.horizonte_meses'), 6);
  const scoreRaw = (flujoEsp + ahorroMes * horizonte) / Math.max(costoTerminar, 1) / Math.max(mesesCobro, 0.5);
  d.push(`scoreRaw = (flujoEsp + ahorroMes × horizonte ${horizonte}) / max(costoTerminar, $1) / max(mesesCobro, 0.5) = ${_r(scoreRaw, 4)}`);

  return {
    estatus, prob, lagMeses, restante, costoTerminar,
    precio, precioEsEstimado, liberacion, liberacionCapturada,
    adeudo, flujoEsp, ahorroMes, semanasObra, mesesCobro, scoreRaw,
    desglose: d
  };
}

// Rankea el portafolio: excluye bloqueadas (a su propia sección) y terminadas ya
// cobradas; normaliza 0–100 sobre el máximo; bono a estratégicas (tope 100);
// compromisos anclados ARRIBA del ranking (restricción dura sobre el score).
export function rankearUnidades(insumos, cfgFn) {
  const bloqueadas = [];
  const excluidas = [];
  const activas = [];
  for (const i of insumos) {
    const f = i.flags || {};
    if (f.bloqueo) { bloqueadas.push(i); continue; }
    const v = i.venta;
    const cobrada = v && v.activo !== false && v.estatus_comercial === 'escriturada' && (v.saldo_cliente || 0) <= 0;
    if (cobrada && i.terminada) { excluidas.push(i); continue; }
    activas.push(i);
  }

  const scored = activas.map(i => ({ insumo: i, calc: scoreUnidad(i, cfgFn) }));
  const maxRaw = scored.reduce((mx, s) => Math.max(mx, s.calc.scoreRaw), 0);
  const bono = _num(cfgFn('score.bono_estrategica'), 10);
  for (const s of scored) {
    let score = maxRaw > 0 ? (s.calc.scoreRaw / maxRaw) * 100 : 0;
    const estrategica = s.insumo.flags && s.insumo.flags.estrategica;
    if (estrategica) score = Math.min(100, score + bono);
    s.score = score;
    s.estrategica = !!estrategica;
    s.compromiso = !!(s.insumo.flags && s.insumo.flags.compromiso);
  }
  scored.sort((a, b) => {
    if (a.compromiso !== b.compromiso) return a.compromiso ? -1 : 1;
    return b.score - a.score;
  });
  return { activas: scored, bloqueadas, excluidas, maxRaw };
}

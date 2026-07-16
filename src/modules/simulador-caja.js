// ============================================================================
// simulador-caja.js — MOTOR DE PRESUPUESTO DE CAJA (Fase 3). FUNCIONES PURAS.
// ============================================================================
// Sin DOM, sin state, sin imports, y SIN new Date() (el mes de inicio entra como
// dato) → testeable con node (scripts/test-simulador-caja.mjs). Proyecta, mes a
// mes por proyecto y consolidado, cuánto ENTRA (cobros esperados) y SALE (burn
// fijo + interés del puente + gasto de obra) y marca dónde/cuándo un proyecto
// cae bajo su colchón (faltante). Es SOLO-LECTURA: no mueve dinero.
//
// Modelo clave: la obra se SECUENCIA por score en `obra.max_frentes` carriles por
// proyecto (no todas las unidades a la vez) → el gasto de obra mensual queda
// acotado y el timeline de cobro se desplaza. Reusa los números que ya calcula el
// motor de score (costoTerminar, semanasObra, mesesCobro, flujoEsp, liberacion,
// prob). La obra NO se frena por falta de caja: así el faltante se MARCA en vez de
// esconderse (esa señal alimenta al futuro sugeridor de préstamos).
//
// insumos = {
//   mesInicio: 'YYYY-MM',
//   proyectos: [{ nombre, saldoInicial }],            // canónicos + '(Sin proyecto)'
//   unidades:  [{ unidad_id, nombre, proyecto,         // proyecto ya canonizado
//                 costoTerminar, semanasObra, mesesCobro, lagMeses,
//                 flujoEsp, liberacion, prob, terminada }],   // orden = ranking
//   burnPorProyecto: { [proy]: number } | null,       // de _burnPorProyecto()
//   creditos: [{ proyecto, dispuesto, tasaMes }]       // uno por crédito activo
// }
// ============================================================================

const _num = (v, fb) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

// 'YYYY-MM' + m meses → 'YYYY-MM' (aritmética pura, sin Date, maneja fin de año).
function _mesMas(mesInicio, m) {
  const s = String(mesInicio || '');
  const y = parseInt(s.slice(0, 4), 10);
  const mo = parseInt(s.slice(5, 7), 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return String(m);
  const tot = y * 12 + (mo - 1) + m;
  const yy = Math.floor(tot / 12);
  const mm = (tot % 12) + 1;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

// Reparte un costo continuo sobre [startT, startT+durT] meses en buckets mensuales
// (por traslape). durT<=0 → todo en el mes floor(startT).
function _repartir(costo, startT, durT, H, buckets, detArr, u) {
  if (durT <= 0) {
    const b = Math.floor(startT);
    if (b >= 0 && b < H) { buckets[b] += costo; detArr[b].push({ unidad_id: u.unidad_id, nombre: u.nombre, monto: costo }); }
    return;
  }
  const desde = Math.max(0, Math.floor(startT));
  const hasta = Math.min(H - 1, Math.ceil(startT + durT) - 1);
  for (let m = desde; m <= hasta; m++) {
    const ov = Math.max(Math.min(startT + durT, m + 1) - Math.max(startT, m), 0);
    if (ov > 0) {
      const q = costo * ov / durT;
      buckets[m] += q;
      detArr[m].push({ unidad_id: u.unidad_id, nombre: u.nombre, monto: q });
    }
  }
}

// Proyecta UN proyecto → { nombre, saldoInicial, dispuestoInicial, timeline, faltanteDesde, cobrosFueraHorizonte }.
function _proyectarProyecto(nombre, saldoInicial, unidades, burnMes, disp0, tasaMes, H, frentes, colMes) {
  const obra = new Array(H).fill(0);
  const entra = new Array(H).fill(0);
  const amort = new Array(H).fill(0);
  const detObra = Array.from({ length: H }, () => []);
  const detEntra = Array.from({ length: H }, () => []);
  const detAmort = Array.from({ length: H }, () => []);
  const cobrosFueraHorizonte = [];

  // 1) Programación greedy en carriles. `unidades` ya viene en orden de score.
  const lanes = new Array(Math.max(1, frentes)).fill(0);   // "carril libre en el mes t"
  for (const u of unidades) {
    const obraM = _num(u.semanasObra, 0) / 4.33;
    const costoT = _num(u.costoTerminar, 0);
    let startT = 0;
    if (costoT > 0 && obraM > 0) {
      let li = 0;
      for (let k = 1; k < lanes.length; k++) if (lanes[k] < lanes[li]) li = k;
      startT = lanes[li];
      lanes[li] = startT + obraM;
      _repartir(costoT, startT, obraM, H, obra, detObra, u);
    }
    // Cobro = arranque del carril + meses a cobro (obra + lag). Terminada ⇒ startT 0.
    const cobroT = startT + _num(u.mesesCobro, 0);
    const b = Math.floor(cobroT);
    const flujo = _num(u.flujoEsp, 0);
    const amortiza = _num(u.liberacion, 0) * _num(u.prob, 0);
    if (b >= 0 && b < H) {
      entra[b] += flujo;
      detEntra[b].push({ unidad_id: u.unidad_id, nombre: u.nombre, monto: flujo });
      if (amortiza > 0) { amort[b] += amortiza; detAmort[b].push({ unidad_id: u.unidad_id, nombre: u.nombre, monto: amortiza }); }
    } else if (flujo !== 0) {
      cobrosFueraHorizonte.push({ unidad_id: u.unidad_id, nombre: u.nombre, flujoEsp: flujo, mes: b });
    }
  }

  // 2) Roll-forward con interés decreciente (la amortización baja el dispuesto futuro).
  let disp = Math.max(0, disp0);
  let saldo = saldoInicial;
  const timeline = [];
  let faltanteDesde = null;
  for (let m = 0; m < H; m++) {
    const interes = disp * tasaMes;              // sobre el dispuesto vigente el mes
    const salidas = burnMes + interes + obra[m];
    const saldoFinal = saldo + entra[m] - salidas;
    disp = Math.max(disp - amort[m], 0);         // amortiza ⇒ afecta meses siguientes
    const colchon = colMes * burnMes;
    const faltante = saldoFinal < colchon;
    if (faltante && faltanteDesde === null) faltanteDesde = m;
    timeline.push({
      mes: null, i: m, saldoInicial: saldo, entradas: entra[m], burn: burnMes,
      interes, obra: obra[m], salidas, saldoFinal, colchon, faltante,
      deficit: Math.max(colchon - saldoFinal, 0),
      detalle: { entradas: detEntra[m], obra: detObra[m], amortiza: detAmort[m] }
    });
    saldo = saldoFinal;
  }
  return { nombre, saldoInicial, dispuestoInicial: Math.max(0, disp0), timeline, faltanteDesde, cobrosFueraHorizonte };
}

// Proyección de caja del portafolio. Devuelve timelines por proyecto + consolidado
// + faltantes[] (hand-off al futuro sugeridor de préstamos) + supuestos[].
export function proyectarCaja(insumos, cfgFn) {
  const cf = typeof cfgFn === 'function' ? cfgFn : () => undefined;
  const H = Math.max(1, Math.min(36, Math.round(_num(cf('simulador.horizonte_meses'), _num(cf('score.horizonte_meses'), 6)))));
  const frentes = Math.max(1, Math.round(_num(cf('obra.max_frentes'), 4)));
  const colMes = _num(cf('tesoreria.colchon_min_meses_burn'), 1);
  const mesInicio = (insumos && insumos.mesInicio) || '';
  const proyectos = (insumos && Array.isArray(insumos.proyectos)) ? insumos.proyectos : [];
  const unidades = (insumos && Array.isArray(insumos.unidades)) ? insumos.unidades : [];
  const burnMap = (insumos && insumos.burnPorProyecto) || null;
  const creditos = (insumos && Array.isArray(insumos.creditos)) ? insumos.creditos : [];

  const meses = [];
  for (let m = 0; m < H; m++) meses.push(_mesMas(mesInicio, m));

  const proySalida = [];
  const faltantes = [];
  for (const p of proyectos) {
    const nombre = p.nombre;
    const uds = unidades.filter(u => u.proyecto === nombre);
    const burnMes = burnMap ? _num(burnMap[nombre], 0) : 0;
    // Agregar créditos del proyecto: dispuesto total + tasa mensual mezclada.
    const cs = creditos.filter(c => c.proyecto === nombre);
    const disp0 = cs.reduce((s, c) => s + _num(c.dispuesto, 0), 0);
    const interes0 = cs.reduce((s, c) => s + _num(c.dispuesto, 0) * _num(c.tasaMes, 0), 0);
    const tasaMes = disp0 > 0 ? interes0 / disp0 : 0;

    const pr = _proyectarProyecto(nombre, _num(p.saldoInicial, 0), uds, burnMes, disp0, tasaMes, H, frentes, colMes);
    pr.timeline.forEach(t => {
      t.mes = meses[t.i];
      if (t.faltante) faltantes.push({ proyecto: nombre, i: t.i, mes: t.mes, deficit: t.deficit, saldoFinal: t.saldoFinal, colchon: t.colchon });
    });
    proySalida.push(pr);
  }

  // Consolidado: suma campo a campo de todos los proyectos.
  const saldoInicialCons = proySalida.reduce((s, p) => s + p.saldoInicial, 0);
  const consTimeline = [];
  for (let m = 0; m < H; m++) {
    let saldoInicial = 0, entradas = 0, burn = 0, interes = 0, obra = 0, salidas = 0, saldoFinal = 0, colchon = 0;
    for (const p of proySalida) {
      const t = p.timeline[m];
      saldoInicial += t.saldoInicial; entradas += t.entradas; burn += t.burn;
      interes += t.interes; obra += t.obra; salidas += t.salidas;
      saldoFinal += t.saldoFinal; colchon += t.colchon;
    }
    consTimeline.push({ mes: meses[m], i: m, saldoInicial, entradas, burn, interes, obra, salidas, saldoFinal, colchon, faltante: saldoFinal < colchon, deficit: Math.max(colchon - saldoFinal, 0) });
  }

  const supuestos = [
    `Horizonte = ${H} meses`,
    `Obra secuenciada: máximo ${frentes} frentes por proyecto (obra.max_frentes)`,
    `Colchón = ${colMes} mes(es) de burn fijo (tesoreria.colchon_min_meses_burn)`,
    `Amortización esperada = liberación × probabilidad de cobro`,
    `La obra NO se frena por falta de caja (el faltante se marca, no se esconde)`,
    burnMap ? `Burn fijo: promedio móvil de partidas fijas configuradas` : `Burn fijo = 0 (configura direccion.partidas_fijas para activar el colchón)`
  ];

  return {
    horizonte: H, meses,
    proyectos: proySalida,
    consolidado: { saldoInicial: saldoInicialCons, timeline: consTimeline },
    faltantes, supuestos
  };
}

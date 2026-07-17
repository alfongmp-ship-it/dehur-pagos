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

// ============================================================================
// sugerirFondeo — SUGERIDOR DE PRÉSTAMOS INTERNOS / FONDEO (Fase 3 · Pieza B).
// ============================================================================
// PURO (sin DOM/state/Date/imports). Consume la salida de proyectarCaja y decide,
// mes a mes, cómo cubrir cada necesidad: (1) DEVOLUCIÓN primero (recuperar dinero
// propio: si al necesitado le deben, que le paguen antes de crear deuda nueva),
// (2) préstamo interno y disposición de crédito en el ORDEN de
// tesoreria.jerarquia_fondeo, (3) lo que no alcance = sin_cubrir (aportación de
// socios) y se aplica como "aportación fantasma" al flujo simulado para que los
// meses siguientes solo reporten necesidad NUEVA (cero doble conteo).
// El prestamista NUNCA queda bajo su piso (max(colchón prestamista, colchón)) en
// NINGÚN mes futuro: prestable = min sobre t≥m de (flujo − piso).
// Invariante: totales.cubierto + totales.sinCubrir = Σ por proyecto del máximo
// deficit original = el KPI "Necesidad de fondeo" del tablero.
// SOLO SUGIERE: no mueve dinero; el humano ejecuta con Traspasos.
//
// entrada = {
//   proyectos: proyectarCaja(...).proyectos,   // lee nombre y timeline[{i,mes,saldoFinal,burn,colchon}]
//   deudaViva: [{ deudor, acreedor, monto }],  // nombres canónicos (canoniza el llamador)
//   capacidadCredito: [{ proyecto, credito, disponible, tasaMes }]  // regla de la casa
// }
// ============================================================================

const EPS_FONDEO = 0.5;   // medio peso: no sugerir movimientos de centavos

export function sugerirFondeo(entrada, cfgFn) {
  const cf = typeof cfgFn === 'function' ? cfgFn : () => undefined;
  const proyectos = (entrada && Array.isArray(entrada.proyectos)) ? entrada.proyectos : [];
  const deudaVivaIn = (entrada && Array.isArray(entrada.deudaViva)) ? entrada.deudaViva : [];
  const capIn = (entrada && Array.isArray(entrada.capacidadCredito)) ? entrada.capacidadCredito : [];
  const supuestos = [];
  const vacio = { horizonte: 0, meses: [], sugerencias: [], resumen: [], totales: { necesidad: 0, devoluciones: 0, prestamos: 0, disposiciones: 0, cubierto: 0, sinCubrir: 0, costoDisposicionMes: 0 }, supuestos };
  if (!proyectos.length) return vacio;

  const H = Math.min(...proyectos.map(p => (p.timeline || []).length));
  if (!H) return vacio;
  const meses = proyectos[0].timeline.slice(0, H).map(t => t.mes);
  const nombres = proyectos.map(p => p.nombre);
  const nombreSet = new Set(nombres);
  const colPrestMes = _num(cf('tesoreria.colchon_prestamista_meses'), 1);
  const r2 = v => Math.round(v * 100) / 100;
  const _fm = n => '$' + Math.round(n).toLocaleString('en-US');

  // ---- Estado simulado (COPIAS; la entrada no se muta) ----
  const flujo = new Map(), colNec = new Map(), pisoPrest = new Map();
  for (const p of proyectos) {
    const f = [], c = [], pp = [];
    for (let t = 0; t < H; t++) {
      const tl = p.timeline[t];
      f.push(_num(tl.saldoFinal, 0));
      c.push(_num(tl.colchon, 0));
      // Piso del prestamista: max(colchón prestamista, colchón del proyecto) — así
      // prestar jamás crea una necesidad nueva (sin rescates circulares).
      pp.push(Math.max(colPrestMes * _num(tl.burn, 0), _num(tl.colchon, 0)));
    }
    flujo.set(p.nombre, f); colNec.set(p.nombre, c); pisoPrest.set(p.nombre, pp);
  }

  // Necesidad total original (invariante): Σ por proyecto del máximo deficit.
  const necesidadOriginal = proyectos.reduce((s, p) => {
    let mx = 0;
    for (let t = 0; t < H; t++) mx = Math.max(mx, Math.max(_num(p.timeline[t].colchon, 0) - _num(p.timeline[t].saldoFinal, 0), 0));
    return s + mx;
  }, 0);

  // Deuda viva simulada (solo pares donde ambos están en la proyección).
  const kD = (d, a) => d + '|||' + a;
  const deuda = new Map();
  for (const dv of deudaVivaIn) {
    if (!nombreSet.has(dv.deudor) || !nombreSet.has(dv.acreedor) || dv.deudor === dv.acreedor) continue;
    const m = _num(dv.monto, 0);
    if (m > EPS_FONDEO) deuda.set(kD(dv.deudor, dv.acreedor), (deuda.get(kD(dv.deudor, dv.acreedor)) || 0) + m);
  }
  const nDeudaPares = deuda.size;

  // Capacidad de crédito por proyecto (mutable; tasa más barata primero).
  const capPorProy = new Map();
  for (const c of capIn) {
    if (!nombreSet.has(c.proyecto)) continue;
    const disp = _num(c.disponible, 0);
    if (disp <= EPS_FONDEO) continue;
    if (!capPorProy.has(c.proyecto)) capPorProy.set(c.proyecto, []);
    capPorProy.get(c.proyecto).push({ credito: c.credito || '', disponible: disp, tasaMes: _num(c.tasaMes, 0) });
  }
  for (const arr of capPorProy.values()) arr.sort((a, b) => a.tasaMes - b.tasaMes);

  // Jerarquía accionable ('caja' = el flujo propio, ya neteado dentro del deficit).
  const jerRaw = cf('tesoreria.jerarquia_fondeo');
  let jer = (Array.isArray(jerRaw) ? jerRaw : []).filter(x => x === 'prestamo_interno' || x === 'disposicion');
  if (!jer.length) jer = ['prestamo_interno', 'disposicion'];
  const peldanos = ['devolucion', ...jer];

  // ---- Primitivas ----
  const necesidad = (X, m) => Math.max(colNec.get(X)[m] - flujo.get(X)[m], 0);
  const prestable = (Y, m) => {
    const f = flujo.get(Y), pp = pisoPrest.get(Y);
    let mn = Infinity;
    for (let t = m; t < H; t++) mn = Math.min(mn, f[t] - pp[t]);
    return Math.max(0, mn);
  };
  const sumarDesde = (X, m, L) => { const f = flujo.get(X); for (let t = m; t < H; t++) f[t] += L; };

  // ---- Bucle greedy mes a mes ----
  const sugerencias = [];
  for (let m = 0; m < H; m++) {
    const necesitados = nombres
      .map(n => ({ n, need: necesidad(n, m) }))
      .filter(x => x.need > EPS_FONDEO)
      .sort((a, b) => (b.need - a.need) || a.n.localeCompare(b.n))
      .map(x => x.n);

    for (const X of necesitados) {
      let falta = necesidad(X, m);
      if (falta <= EPS_FONDEO) continue;
      const needInicial = falta;

      for (const peldano of peldanos) {
        if (falta <= EPS_FONDEO) break;

        if (peldano === 'devolucion') {
          // Recuperar dinero PROPIO: deudores de X con excedente, cap = deuda viva.
          for (;;) {
            if (falta <= EPS_FONDEO) break;
            const cands = nombres
              .filter(D => D !== X && (deuda.get(kD(D, X)) || 0) > EPS_FONDEO && prestable(D, m) > EPS_FONDEO)
              .map(D => ({ D, cap: Math.min(deuda.get(kD(D, X)), prestable(D, m)) }))
              .sort((a, b) => (b.cap - a.cap) || a.D.localeCompare(b.D));
            if (!cands.length) break;
            const { D } = cands[0];
            const pAntes = prestable(D, m);
            const dAntes = deuda.get(kD(D, X));
            const L = r2(Math.min(dAntes, pAntes, falta));
            sumarDesde(X, m, L); sumarDesde(D, m, -L);
            deuda.set(kD(D, X), dAntes - L);
            falta -= L;
            sugerencias.push({
              i: m, mes: meses[m], tipo: 'devolucion', de: D, para: X, monto: L, credito: null, costoMes: 0,
              porque: `«${X}» necesita ${_fm(needInicial)} en ${meses[m]} (colchón incluido). «${D}» ya le debe ${_fm(dAntes)} y trae excedente prestable de ${_fm(pAntes)} (su colchón queda respetado en todos los meses del horizonte) → devolución antes que deuda nueva.`,
              datos: { necesidadMes: r2(needInicial), deudaPrevia: r2(dAntes), excedentePrestable: r2(pAntes) }
            });
          }

        } else if (peldano === 'prestamo_interno') {
          for (;;) {
            if (falta <= EPS_FONDEO) break;
            const cands = nombres
              .filter(Y => Y !== X)
              .map(Y => ({ Y, p: prestable(Y, m) }))
              .filter(x => x.p > EPS_FONDEO)
              .sort((a, b) => (b.p - a.p) || a.Y.localeCompare(b.Y));
            if (!cands.length) break;
            const { Y, p } = cands[0];
            const L = r2(Math.min(p, falta));
            sumarDesde(X, m, L); sumarDesde(Y, m, -L);
            // Deuda simulada NETEADA: si Y le debía a X, primero se compensa.
            const dYX = deuda.get(kD(Y, X)) || 0;
            const compensa = Math.min(dYX, L);
            if (compensa > 0) deuda.set(kD(Y, X), dYX - compensa);
            const nuevo = r2(L - compensa);
            if (nuevo > 0) deuda.set(kD(X, Y), (deuda.get(kD(X, Y)) || 0) + nuevo);
            falta -= L;
            const piso = pisoPrest.get(Y)[m];
            sugerencias.push({
              i: m, mes: meses[m], tipo: 'prestamo', de: Y, para: X, monto: L, credito: null, costoMes: 0,
              porque: `«${X}» necesita ${_fm(needInicial)} en ${meses[m]}. «${Y}» es quien más excedente prestable trae: ${_fm(p)} (mínimo de su flujo futuro menos su colchón de prestamista ${_fm(piso)}). Queda registrado: «${X}» le deberá ${_fm(nuevo)} a «${Y}».`,
              datos: { necesidadMes: r2(needInicial), excedentePrestable: r2(p), colchonPrestamista: r2(piso) }
            });
          }

        } else if (peldano === 'disposicion') {
          const creditos = capPorProy.get(X) || [];
          for (const c of creditos) {
            if (falta <= EPS_FONDEO) break;
            if (c.disponible <= EPS_FONDEO) continue;
            const dispPrevio = c.disponible;
            const L = r2(Math.min(c.disponible, falta));
            sumarDesde(X, m, L);
            c.disponible -= L;
            falta -= L;
            const costoMes = r2(L * c.tasaMes);
            sugerencias.push({
              i: m, mes: meses[m], tipo: 'disposicion', de: null, para: X, monto: L, credito: c.credito, costoMes,
              porque: `Sin excedente interno suficiente para «${X}» en ${meses[m]}. Disponer ${_fm(L)} de «${c.credito}» (disponible ${_fm(dispPrevio)}; regla de la casa: autorizado − pagarés). Costo ≈ ${_fm(costoMes)}/mes (≈ ${_fm(costoMes * (H - m))} hasta el fin del horizonte). Este interés NO está restado de la proyección.`,
              datos: { necesidadMes: r2(needInicial), disponiblePrevio: r2(dispPrevio), tasaMes: c.tasaMes, costoHastaH: r2(costoMes * (H - m)) }
            });
          }
        }
      }

      if (falta > EPS_FONDEO) {
        const L = r2(falta);
        // Aportación fantasma: los meses siguientes suponen la aportación hecha
        // (así lo "sin cubrir" es incremental y jamás se cuenta dos veces).
        sumarDesde(X, m, L);
        sugerencias.push({
          i: m, mes: meses[m], tipo: 'sin_cubrir', de: null, para: X, monto: L, credito: null, costoMes: 0,
          porque: `A «${X}» le faltan ${_fm(L)} en ${meses[m]} tras agotar devoluciones, préstamos y crédito → requiere aportación de socios. Los meses siguientes ya suponen esta aportación hecha.`,
          datos: { necesidadMes: r2(needInicial) }
        });
      }
    }
  }

  // ---- Totales y resumen (desde las sugerencias emitidas, para que siempre cuadren) ----
  const tot = { necesidad: r2(necesidadOriginal), devoluciones: 0, prestamos: 0, disposiciones: 0, cubierto: 0, sinCubrir: 0, costoDisposicionMes: 0 };
  const porProy = new Map();
  const acc = n => {
    if (!porProy.has(n)) porProy.set(n, { proyecto: n, recibe: { devolucion: 0, prestamo: 0, disposicion: 0, total: 0 }, da: { devolucion: 0, prestamo: 0, total: 0 }, sinCubrir: 0, costoDisposicionMes: 0 });
    return porProy.get(n);
  };
  for (const s of sugerencias) {
    if (s.tipo === 'devolucion') { tot.devoluciones += s.monto; const a = acc(s.para); a.recibe.devolucion += s.monto; a.recibe.total += s.monto; const d = acc(s.de); d.da.devolucion += s.monto; d.da.total += s.monto; }
    else if (s.tipo === 'prestamo') { tot.prestamos += s.monto; const a = acc(s.para); a.recibe.prestamo += s.monto; a.recibe.total += s.monto; const d = acc(s.de); d.da.prestamo += s.monto; d.da.total += s.monto; }
    else if (s.tipo === 'disposicion') { tot.disposiciones += s.monto; tot.costoDisposicionMes += s.costoMes; const a = acc(s.para); a.recibe.disposicion += s.monto; a.recibe.total += s.monto; a.costoDisposicionMes += s.costoMes; }
    else if (s.tipo === 'sin_cubrir') { tot.sinCubrir += s.monto; acc(s.para).sinCubrir += s.monto; }
  }
  tot.devoluciones = r2(tot.devoluciones); tot.prestamos = r2(tot.prestamos); tot.disposiciones = r2(tot.disposiciones);
  tot.cubierto = r2(tot.devoluciones + tot.prestamos + tot.disposiciones);
  tot.sinCubrir = r2(tot.sinCubrir); tot.costoDisposicionMes = r2(tot.costoDisposicionMes);
  const resumen = [...porProy.values()].sort((a, b) => (b.sinCubrir - a.sinCubrir) || (b.recibe.total - a.recibe.total) || a.proyecto.localeCompare(b.proyecto));

  supuestos.push(
    'Devolución primero: recuperar dinero propio domina a cualquier deuda nueva (cap = deuda viva)',
    `Orden de fondeo: ${peldanos.join(' → ')} (tesoreria.jerarquia_fondeo)`,
    `Colchón del prestamista = ${colPrestMes} mes(es) de burn: nunca queda debajo en ningún mes del horizonte`,
    'Capacidad de crédito = regla de la casa: autorizado − pagarés del crédito (incluye pagados)',
    'El interés de las disposiciones sugeridas NO está restado de los flujos proyectados (la necesidad real sería un poco mayor)',
    'Lo "sin cubrir" se supone aportado por socios en su mes (los meses siguientes ya lo asumen)',
    `Deuda viva considerada: ${nDeudaPares} par(es) de proyectos`,
    'Cubierto + sin cubrir = la "Necesidad de fondeo" del tablero (cuadre exacto)'
  );

  return { horizonte: H, meses, sugerencias, resumen, totales: tot, supuestos };
}

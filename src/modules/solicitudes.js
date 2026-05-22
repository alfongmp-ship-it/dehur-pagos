import { state } from '../state.js';
import { getBanco, getTipo } from '../config/bancos.js';
import { tipoBadge, proyTag } from '../ui/badges.js';
import { fmt } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { buscarProveedorSol, normalizar } from '../matching/fuzzy.js';
import { gsSaveAlias } from '../services/google-sync.js';
import { renderCola } from './dispersion.js';
import { getPartidasCatalogo } from '../config/sub-partidas.js';

// Template is now generated dynamically via SheetJS in descargarPlantilla()
const _PLANTILLA_LEGACY = "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";

export function handleSolDrop(e) {
  e.preventDefault();
  const dz = document.getElementById('sol-dropzone');
  dz.style.borderColor = 'var(--border)';
  dz.style.background = 'var(--surface)';
  const f = e.dataTransfer.files[0];
  if (f) handleSolFile(f);
}

export function handleSolFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      parsearSolicitud(wb, file.name);
    } catch (err) { notify('Error leyendo el archivo: ' + err.message, 'error'); }
  };
  reader.readAsArrayBuffer(file);
}

export function descargarPlantilla() {
  if (!window.XLSX) { notify('Cargando librería, intenta en 2 segundos', 'error'); return; }
  const wb = XLSX.utils.book_new();
  const data = [
    ['DEHUR TERRITORIAL — Solicitud de Pagos'],
    ['Obra:', '', '', '', '', '', '', '', '', '', '', ''],
    ['Fecha:', '', '', '', '', '', '', '', '', '', '', ''],
    ['Proveedor_ID', 'Factura_ID', 'Proveedor / Contratista', 'Partida', 'Clave', 'Factura', 'OC', 'Importe', 'Proyecto', 'Concepto', 'Reparto', 'Unidades'],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [
    { wch: 14 }, { wch: 12 }, { wch: 35 }, { wch: 15 }, { wch: 12 },
    { wch: 15 }, { wch: 10 }, { wch: 14 }, { wch: 20 }, { wch: 40 },
    { wch: 12 }, { wch: 28 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Solicitud');
  XLSX.writeFile(wb, 'Plantilla_Solicitud_Pagos_Dehur.xlsx');
  notify('Plantilla descargada ✓', 'success');
}

function detectarProyecto(sheetName, obra, proyectoFila) {
  const texto = (proyectoFila || obra || sheetName || '');
  const norm = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  for (const p of state.proyectos) {
    const pNorm = p.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (pNorm.includes(norm) || norm.includes(pNorm)) return p.nombre;
  }
  return state.proyectos.length ? state.proyectos[0].nombre : texto;
}

// Normaliza para comparar nombres (case-insensitive, sin acentos).
function normCodigo(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Resuelve un c\u00f3digo de unidad ('101') al objeto de unidad usando state.unidades.
// ESTRICTO: solo busca dentro del proyecto del pago. Si la unidad existe en otro
// proyecto pero no en el del pago, devuelve null (evita asignar costos cruzados
// a proyectos equivocados por typos de obra).
function resolverUnidadPorCodigo(codigo, proyecto) {
  const cod = normCodigo(codigo);
  const proy = normCodigo(proyecto);
  if (!cod || !proy) return null;
  return state.unidades.find(u =>
    u.activo !== false &&
    normCodigo(u.nombre) === cod &&
    normCodigo(u.proyecto) === proy
  ) || null;
}

// Parsea las columnas Reparto + Unidades de una fila del Excel.
// Devuelve { asignaciones, metodo, errores, warnings }:
//  - asignaciones: array [{ unidad_id, casa, pct }] (vac\u00edo si no aplica)
//  - metodo: 'directo' | 'equitativo' | 'indiviso' | 'custom' | null
//  - errores: array de strings (bloquean carga)
//  - warnings: array de strings (no bloquean)
function parseReparto(repartoRaw, unidadesRaw, proyecto) {
  const errores = [];
  const warnings = [];
  let asignaciones = [];
  let metodo = null;

  const reparto = String(repartoRaw || '').trim().toLowerCase();
  const unidadesStr = String(unidadesRaw || '').trim();

  // Vac\u00edo expl\u00edcito o blanco: no auto-asignar
  if (!reparto || reparto === 'vacio' || reparto === 'vac\u00edo') {
    return { asignaciones: [], metodo: null, errores, warnings };
  }

  const VALIDOS = ['directo', 'equitativo', 'indiviso', 'custom'];
  if (!VALIDOS.includes(reparto)) {
    errores.push(`Reparto='${repartoRaw}' no es v\u00e1lido. Usa: directo, equitativo, indiviso, custom, o d\u00e9jalo vac\u00edo.`);
    return { asignaciones, metodo, errores, warnings };
  }
  metodo = reparto;

  // Helper: separa c\u00f3digos por '/' filtrando vac\u00edos
  const splitCodigos = s => s.split('/').map(x => x.trim()).filter(Boolean);

  if (metodo === 'indiviso') {
    if (unidadesStr) warnings.push(`Columna Unidades se ignora cuando Reparto='indiviso' (se reparte entre TODAS las casas del proyecto).`);
    const delProyecto = state.unidades.filter(u => u.activo !== false && normCodigo(u.proyecto) === normCodigo(proyecto));
    if (!delProyecto.length) {
      errores.push(`No hay unidades en el proyecto '${proyecto}' para repartir por indiviso.`);
      return { asignaciones, metodo, errores, warnings };
    }
    const sumaIndiviso = delProyecto.reduce((s, u) => s + (u.indiviso_pct || 0), 0);
    if (sumaIndiviso <= 0) {
      errores.push(`Las unidades del proyecto '${proyecto}' no tienen indiviso_pct definido.`);
      return { asignaciones, metodo, errores, warnings };
    }
    // Normalizar a 100% si la suma no es exacta
    if (Math.abs(sumaIndiviso - 100) > 0.5) {
      warnings.push(`Suma de indiviso del proyecto '${proyecto}' es ${sumaIndiviso.toFixed(2)}%, se normaliza a 100%.`);
    }
    asignaciones = delProyecto.map(u => ({
      unidad_id: u.unidad_id, casa: u.nombre, pct: (u.indiviso_pct / sumaIndiviso) * 100
    }));
    return { asignaciones, metodo, errores, warnings };
  }

  if (!unidadesStr) {
    errores.push(`Reparto='${metodo}' requiere la columna Unidades (d\u00e9jala vac\u00eda solo con 'indiviso' o 'vacio').`);
    return { asignaciones, metodo, errores, warnings };
  }

  if (metodo === 'directo') {
    const codigos = splitCodigos(unidadesStr);
    if (codigos.length !== 1) {
      errores.push(`Reparto='directo' requiere exactamente 1 unidad (Unidades='${unidadesStr}' tiene ${codigos.length}).`);
      return { asignaciones, metodo, errores, warnings };
    }
    const u = resolverUnidadPorCodigo(codigos[0], proyecto);
    if (!u) {
      warnings.push(`Unidad '${codigos[0]}' no existe en el cat\u00e1logo \u2014 no se auto-asignar\u00e1.`);
      asignaciones = [{ unidad_id: null, casa: codigos[0], pct: 100 }];
    } else {
      asignaciones = [{ unidad_id: u.unidad_id, casa: u.nombre, pct: 100 }];
    }
    return { asignaciones, metodo, errores, warnings };
  }

  if (metodo === 'equitativo') {
    const codigos = splitCodigos(unidadesStr);
    if (codigos.length < 2) {
      errores.push(`Reparto='equitativo' requiere 2+ unidades (Unidades='${unidadesStr}' tiene ${codigos.length}).`);
      return { asignaciones, metodo, errores, warnings };
    }
    const pct = 100 / codigos.length;
    const noEncontradas = [];
    asignaciones = codigos.map(c => {
      const u = resolverUnidadPorCodigo(c, proyecto);
      if (!u) noEncontradas.push(c);
      return { unidad_id: u?.unidad_id || null, casa: u?.nombre || c, pct };
    });
    if (noEncontradas.length) warnings.push(`Unidades no encontradas: ${noEncontradas.join(', ')} \u2014 esas se omitir\u00e1n al auto-asignar.`);
    return { asignaciones, metodo, errores, warnings };
  }

  // custom: 'c\u00f3digo:%' separados por '/'
  if (metodo === 'custom') {
    const tokens = unidadesStr.split('/').map(t => t.trim()).filter(Boolean);
    if (!tokens.length) {
      errores.push(`Reparto='custom' requiere tokens 'c\u00f3digo:%' separados por '/'.`);
      return { asignaciones, metodo, errores, warnings };
    }
    let sumaPct = 0;
    const noEncontradas = [];
    asignaciones = tokens.map(tok => {
      const m = tok.match(/^([^:]+):(.+)$/);
      if (!m) {
        errores.push(`Token '${tok}' inv\u00e1lido en custom (formato esperado: 'c\u00f3digo:%').`);
        return null;
      }
      const codigo = m[1].trim();
      const pct = parseFloat(String(m[2]).replace(/[%\s]/g, ''));
      if (!isFinite(pct) || pct <= 0) {
        errores.push(`Porcentaje inv\u00e1lido en '${tok}'.`);
        return null;
      }
      sumaPct += pct;
      const u = resolverUnidadPorCodigo(codigo, proyecto);
      if (!u) noEncontradas.push(codigo);
      return { unidad_id: u?.unidad_id || null, casa: u?.nombre || codigo, pct };
    }).filter(Boolean);
    if (errores.length) return { asignaciones: [], metodo, errores, warnings };
    if (Math.abs(sumaPct - 100) > 0.5) {
      errores.push(`Suma de % en custom es ${sumaPct.toFixed(2)}, debe ser 100.`);
      return { asignaciones: [], metodo, errores, warnings };
    }
    if (noEncontradas.length) warnings.push(`Unidades no encontradas: ${noEncontradas.join(', ')} \u2014 esas se omitir\u00e1n al auto-asignar.`);
    return { asignaciones, metodo, errores, warnings };
  }

  return { asignaciones, metodo, errores, warnings };
}

export function parsearSolicitud(wb, filename) {
  state.solicitudesData = [];
  let obraGlobal = '';
  const erroresGlobales = []; // { fila, motivo }
  const warningsGlobales = []; // strings

  // Validate it's Dehur standard template
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  const firstRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
  const fila1 = String(firstRows[0]?.[0] || '').toLowerCase();
  const fila4 = firstRows[3] || [];
  const headers4 = fila4.map(h => String(h || '').toLowerCase());
  const tieneProvId = headers4.some(h => h.includes('proveedor_id'));
  const esPlantillaDehur = fila1.includes('dehur') &&
    headers4.some(h => h.includes('proveedor') || h.includes('contratista'));
  if (!esPlantillaDehur) {
    notify('⚠ Este archivo no es la Plantilla Estándar Dehur.', 'error');
    return;
  }

  wb.SheetNames.forEach(sheetName => {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    rows.slice(0, 6).forEach(r => {
      const v = String(r[0] || '').trim();
      if (v.toUpperCase().includes('OBRA:')) obraGlobal = v;
    });

    // Column offset: new template has proveedor_id(0), factura_id(1) before proveedor(2)
    const off = tieneProvId ? 1 : 0;

    let dataStart = 4;
    rows.forEach((r, i) => {
      const v = String(r[off + 1] || '').toLowerCase();
      if (v.includes('proveedor') || v.includes('contratista')) {
        dataStart = i + 1;
      }
    });

    rows.slice(dataStart).forEach((r, rIdx) => {
      const numeroFila = dataStart + rIdx + 1; // 1-based para el reporte de errores
      const proveedorIdRaw = tieneProvId ? String(r[0] || '').trim() : '';
      const facturaIdRaw = tieneProvId ? String(r[1] || '').trim() : '';

      const proveedor = String(r[off + 1] || '').trim();
      if (!proveedor || proveedor.toLowerCase() === 'total' ||
        proveedor.toLowerCase().startsWith('total') ||
        proveedor.toLowerCase().startsWith('solicitud') ||
        proveedor.toLowerCase().startsWith('dehur') ||
        proveedor.toLowerCase().startsWith('obra')) return;

      const partida = String(r[off + 2] || '').trim();
      const clave = String(r[off + 3] || '').trim();
      const factura = String(r[off + 4] || '').trim();
      const oc = String(r[off + 5] || '').trim();
      const importe = parseFloat(String(r[off + 6] || '').replace(/[$,\s]/g, '')) || 0;
      if (!importe || importe < 1) return;

      const proyectoFila = String(r[off + 7] || '').trim();
      if (proyectoFila && !obraGlobal) obraGlobal = proyectoFila;

      const concepto = String(r[off + 8] || '').trim();
      const motivoRaw = (factura ? 'Fac:' + factura + ' ' : '') + concepto;
      const motivo = motivoRaw.substring(0, 40).trim();

      const flag = String(r[off + 7] || '').trim().toUpperCase();
      const esNo = flag === 'NO' || flag === 'N/A' || flag === 'PENDIENTE';

      let cuentaEmbebida = '', bancoEmbebido = '';
      const m18 = concepto.match(/(\d{18})/);
      const mCta = concepto.match(/cta\.?\s*(\d{10,18})/i);
      if (m18) { cuentaEmbebida = m18[1]; bancoEmbebido = getBanco(m18[1]) || 'BBVA'; }
      else if (mCta) { cuentaEmbebida = mCta[1]; bancoEmbebido = 'BBVA'; }
      if (!bancoEmbebido) {
        const conU = concepto.toUpperCase();
        if (conU.includes('BANCOMER') || conU.includes('BBVA')) bancoEmbebido = 'BBVA';
        else if (conU.includes('BANAMEX') || conU.includes('CITIBANAMEX')) bancoEmbebido = 'Banamex';
        else if (conU.includes('BANORTE')) bancoEmbebido = 'Banorte';
        else if (conU.includes('HSBC')) bancoEmbebido = 'HSBC';
        else if (conU.includes('SCOTIABANK')) bancoEmbebido = 'Scotiabank';
      }

      // Auto-vincular por proveedor_id si viene en la plantilla
      let matchProv = null, matchMetodo = null, matchScore = 0;
      const provIdNum = parseInt(proveedorIdRaw);
      if (provIdNum) {
        const provById = state.proveedores.find(p => p.id === provIdNum);
        if (provById) {
          matchProv = provById;
          matchMetodo = 'id';
          matchScore = 100;
        }
      }
      if (!matchProv) {
        const matchResult = buscarProveedorSol(proveedor, cuentaEmbebida);
        // Solo auto-asignar match exacto por nombre
        const esExacto = matchResult && matchResult.metodo === 'exacta';
        matchProv = esExacto ? matchResult.prov : null;
        matchMetodo = esExacto ? matchResult.metodo : null;
        matchScore = esExacto ? matchResult.score : 0;
      }

      const nombreFinal = (matchProv && matchMetodo === 'id') ? matchProv.nombre : proveedor;
      const proyectoDet = detectarProyecto(sheetName, obraGlobal, proyectoFila);

      // Parseo de Reparto / Unidades (columnas 10 y 11 del nuevo template)
      const repartoRaw = String(r[off + 9] || '').trim();
      const unidadesRaw = String(r[off + 10] || '').trim();
      const { asignaciones, metodo: repartoMetodo, errores: errParse, warnings: warnParse } =
        parseReparto(repartoRaw, unidadesRaw, proyectoDet);
      errParse.forEach(e => erroresGlobales.push({ fila: numeroFila, motivo: e }));
      warnParse.forEach(w => warningsGlobales.push(`Fila ${numeroFila}: ${w}`));

      state.solicitudesData.push({
        uid: Date.now() + '-' + Math.random(),
        proveedor: nombreFinal, partida, clave, oc, concepto, motivo, importe, flag,
        proveedor_id: proveedorIdRaw, factura_id: facturaIdRaw,
        esNo, proyecto: proyectoDet,
        semana: sheetName, cuentaEmbebida, bancoEmbebido,
        match: matchProv, matchMetodo, matchScore,
        vinculadoManual: false, seleccionado: !esNo,
        // Asignación planificada desde el Excel (opcional)
        asignacionesPlanificadas: asignaciones,
        repartoMetodo
      });
    });
  });

  if (!state.solicitudesData.length) { notify('No se encontraron filas de pago en el archivo', 'error'); return; }

  // Si el Excel trae errores en columnas Reparto/Unidades, bloquear la carga.
  if (erroresGlobales.length) {
    state.solicitudesData = [];
    const detalle = erroresGlobales.slice(0, 6)
      .map(e => `Fila ${e.fila}: ${e.motivo}`).join('\n');
    const extra = erroresGlobales.length > 6 ? `\n…y ${erroresGlobales.length - 6} más` : '';
    notify(`⛔ Carga bloqueada: ${erroresGlobales.length} error${erroresGlobales.length === 1 ? '' : 'es'} en Reparto/Unidades:\n${detalle}${extra}`, 'error');
    return;
  }

  document.getElementById('sol-filename').textContent = filename;
  const total = state.solicitudesData.reduce((a, s) => a + s.importe, 0);
  document.getElementById('sol-fileinfo').textContent =
    `${state.solicitudesData.length} partidas · ${wb.SheetNames.join(', ')} · Total: ${fmt(total)}`;
  document.getElementById('sol-dropzone').style.display = 'none';
  document.getElementById('sol-contenido').style.display = '';
  document.getElementById('sol-actions').style.display = 'flex';
  document.getElementById('cnt-sol').textContent = state.solicitudesData.length;

  const partidas = [...new Set(state.solicitudesData.map(s => s.partida).filter(Boolean))].sort();
  const sel = document.getElementById('f-sol-partida');
  sel.innerHTML = '<option value="">Todas las partidas</option>' +
    partidas.map(p => `<option value="${p}">${p}</option>`).join('');

  renderSolicitudes();
  const sinCuenta = state.solicitudesData.filter(s => !s.match && !s.cuentaEmbebida).length;
  // Validar partidas contra el catálogo (informativo, no bloquea).
  const norm = s => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const catalogoNorm = new Set(getPartidasCatalogo().map(p => norm(p.partida)));
  const desconocidas = [...new Set(state.solicitudesData
    .map(s => s.partida).filter(Boolean)
    .filter(p => !catalogoNorm.has(norm(p)))
  )];
  const warningsTxt = warningsGlobales.length
    ? `\n⚠ ${warningsGlobales.length} aviso${warningsGlobales.length === 1 ? '' : 's'} de Reparto/Unidades — revisa los badges`
    : '';
  notify(`${state.solicitudesData.length} solicitudes cargadas${sinCuenta ? ' · ⚠ ' + sinCuenta + ' sin cuenta' : ''}${desconocidas.length ? ' · ⚠ partidas fuera del catálogo: ' + desconocidas.join(', ') : ''}${warningsTxt}`);
}

// Devuelve el HTML del badge de asignación para una solicitud (o cadena vacía).
function badgeAsignacion(s) {
  if (!s.repartoMetodo) return '';
  const arr = s.asignacionesPlanificadas || [];
  const sinResolver = arr.filter(a => !a.unidad_id).map(a => a.casa);
  let texto = '';
  if (s.repartoMetodo === 'directo') {
    const a = arr[0];
    texto = `🏠 ${a?.casa || '?'}`;
  } else if (s.repartoMetodo === 'equitativo') {
    texto = `🏠 ${arr.length} casas equitativo`;
  } else if (s.repartoMetodo === 'indiviso') {
    texto = `🏠 indiviso (${arr.length} casas)`;
  } else if (s.repartoMetodo === 'custom') {
    const partes = arr.map(a => `${a.casa}:${Math.round(a.pct)}%`).join(' / ');
    texto = `🏠 custom ${partes}`;
  }
  const avisos = sinResolver.length
    ? `<span style="color:var(--yellow);font-size:10px;margin-left:4px;">⚠ ${sinResolver.join(', ')} no existe</span>`
    : '';
  return `<div style="font-size:10px;color:var(--accent);margin-top:3px;">${texto}${avisos}</div>`;
}

export function renderSolicitudes() {
  const tbSol = document.getElementById('tbody-sol');

  if (!state.gsToken) {
    if (tbSol) tbSol.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div></td></tr>';
    const cnt = document.getElementById('cnt-sol'); if (cnt) cnt.textContent = '0';
    return;
  }

  if (!state.solicitudesData.length) return;
  const q = (document.getElementById('buscar-sol')?.value || '').toLowerCase();
  const fp = document.getElementById('f-sol-partida')?.value || '';

  const fil = state.solicitudesData.filter(s =>
    (!q || (s.proveedor.toLowerCase().includes(q) || s.concepto.toLowerCase().includes(q) || s.partida.toLowerCase().includes(q) || s.clave.toLowerCase().includes(q))) &&
    (!fp || s.partida === fp)
  );

  // Validar facturas inline — acumula pagos del mismo lote + tolerancia punto flotante
  const acumuladoPorFactura = {};
  state.solicitudesData.forEach(s => {
    s._facturaError = '';
    if (!s.factura_id) return;
    const factId = parseInt(s.factura_id);
    const fact = state.facturas.find(f => f.factura_id === factId);
    if (!fact) return;
    const provIdSol = parseInt(s.proveedor_id) || 0;
    if (fact.proveedor_id && provIdSol && fact.proveedor_id !== provIdSol) {
      s._facturaError = `Factura pertenece a prov. #${fact.proveedor_id}`;
      s.seleccionado = false;
      return;
    }
    if (fact.estatus_factura === 'pagada') {
      s._facturaError = 'Factura ya pagada';
      s.seleccionado = false;
      return;
    }
    const yaAcumulado = acumuladoPorFactura[factId] || 0;
    const saldoDisp = Math.round((fact.saldo_pendiente - yaAcumulado) * 100) / 100;
    if (s.importe > saldoDisp + 0.01) {
      s._facturaError = `Excede saldo ($${fmt(saldoDisp)})`;
      s.seleccionado = false;
    } else {
      acumuladoPorFactura[factId] = yaAcumulado + s.importe;
    }
  });

  let total = 0, selTotal = 0, selCount = 0;
  state.solicitudesData.forEach(s => { total += s.importe; if (s.seleccionado) { selTotal += s.importe; selCount++; } });
  document.getElementById('sol-total').textContent = fmt(total);
  document.getElementById('sol-seleccionado').textContent = fmt(selTotal);
  document.getElementById('sol-subtitle').textContent =
    `${state.solicitudesData.length} solicitudes · ${selCount} seleccionadas · ` +
    [...new Set(state.solicitudesData.map(s => s.proyecto))].join(', ');

  const sinCuenta = state.solicitudesData.filter(s => s.seleccionado && !s.match && !s.cuentaEmbebida);
  document.getElementById('sol-alertas').innerHTML = sinCuenta.length
    ? `<div style="background:rgba(224,90,90,.1);border:1px solid rgba(224,90,90,.3);border-radius:8px;padding:10px 14px;font-size:12px;margin-bottom:4px;">
        ⚠ <b>${sinCuenta.length} proveedor${sinCuenta.length > 1 ? 'es' : ''} sin cuenta:</b>
        ${sinCuenta.map(s => `<span style="font-weight:500">${s.proveedor}</span>`).join(', ')}
      </div>` : '';

  const tb = document.getElementById('tbody-sol');
  if (!fil.length) {
    tb.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">Sin resultados</td></tr>`;
    return;
  }

  tb.innerHTML = fil.map(s => {
    const cuenta = s.match ? s.match.cuenta : s.cuentaEmbebida;
    const banco = s.match ? s.match.banco : s.bancoEmbebido;
    const tipo = s.match ? s.match.tipo_cuenta : (cuenta ? getTipo(cuenta) : '');

    let cuentaHtml = '';
    if (cuenta) {
      const tColor = tipo === 'CLABE' ? 'var(--green)' : tipo === 'Cuenta BBVA' ? 'var(--blue)' : 'var(--yellow)';
      cuentaHtml = `<span style="font-family:'DM Mono',monospace;font-size:11px;">${cuenta}</span>
        <div style="font-size:10px;color:var(--muted);margin-top:1px;">
          ${banco || ''} <span style="color:${tColor};font-weight:600;">${tipo}</span>
          ${!s.match && s.cuentaEmbebida ? ' <span style="color:var(--yellow)">(del concepto)</span>' : ''}
        </div>`;
    } else {
      cuentaHtml = `<span style="font-size:11px;color:var(--red);">⚠ Sin cuenta</span>`;
    }

    const metodoLabel = { 'id': 'ID', 'cuenta exacta': 'Cta.', 'cuenta parcial': 'Cta.', 'cuenta': 'Cta.', 'exacta': 'Exacto', 'contención': 'Contenido', 'contencion': 'Contenido', 'tokens': 'Palabras', 'keyword largo': 'Keyword', 'alias': 'Alias' }[s.matchMetodo] || '';
    const estadoHtml = s.esNo
      ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(224,90,90,.15);color:var(--red);">NO</span>`
      : s.match
        ? `<div>
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;background:rgba(90,200,90,.12);color:#5cb85c;font-weight:600;">
              ${s.matchMetodo === 'cuenta' ? '🔗' : s.vinculadoManual ? '✎' : '✓'} ${s.vinculadoManual ? 'Vinculado' : metodoLabel || 'BD'}
            </span>
            ${s.matchScore < 80 && !s.vinculadoManual ? `<div style="font-size:9px;color:var(--muted);margin-top:2px;">${s.matchScore}% · <a href="#" onclick="abrirVincular('${s.uid}');return false;" style="color:var(--accent);">cambiar</a></div>` : ''}
          </div>`
        : s.cuentaEmbebida
          ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;background:rgba(90,155,224,.12);color:var(--blue);">Cta.en texto</span>`
          : `<div>
              <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;background:rgba(224,180,90,.12);color:var(--yellow);">⚠ Sin match</span>
              <div style="margin-top:3px;"><a href="#" onclick="abrirVincular('${s.uid}');return false;" style="font-size:10px;color:var(--accent);text-decoration:none;">🔗 Vincular / Agregar</a></div>
            </div>`;

    const rowStyle = s.esNo ? 'opacity:.5' : s._facturaError ? 'background:rgba(231,76,60,.08);' : '';
    return `<tr style="${rowStyle}">
      <td style="padding:8px 6px;"><input type="checkbox" ${s.seleccionado ? 'checked' : ''}
        onchange="toggleSol('${s.uid}',this.checked)" style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent);"></td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);text-align:center;">${s.proveedor_id || '—'}</td>
      <td>
        <div style="font-size:12px;font-weight:600;line-height:1.3;">${s.match ? s.match.nombre : s.proveedor}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">${s.proyecto}</div>
      </td>
      <td style="font-size:11px;color:var(--muted);">${s.partida}</td>
      <td style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);">${s.clave}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;">${s.factura_id
        ? s._facturaError
          ? `<div style="color:#e74c3c;font-weight:600;">${s.factura_id}</div><div style="font-size:9px;color:#e74c3c;margin-top:2px;">⛔ ${s._facturaError}</div>`
          : `<span style="color:var(--accent);">${s.factura_id}</span>`
        : '<span style="color:var(--muted);">—</span>'}</td>
      <td style="font-size:11px;color:var(--muted);max-width:240px;">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px;" title="${s.concepto}">${s.concepto}</div>
        ${badgeAsignacion(s)}
      </td>
      <td>${cuentaHtml}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;font-size:13px;font-weight:600;color:var(--accent);white-space:nowrap;">${fmt(s.importe)}</td>
      <td style="text-align:center;">${estadoHtml}</td>
    </tr>`;
  }).join('');
}

export function toggleSol(uid, checked) {
  const s = state.solicitudesData.find(x => x.uid === uid);
  if (s) { s.seleccionado = checked; }
  renderSolicitudes();
}

export function seleccionarTodosSol(val) {
  const v = val === true || val === 'true' || val === '1';
  state.solicitudesData.forEach(s => s.seleccionado = v);
  if (document.getElementById('chk-all-sol'))
    document.getElementById('chk-all-sol').checked = v;
  renderSolicitudes();
}

export function nuevaSolicitud() {
  state.solicitudesData = [];
  document.getElementById('sol-dropzone').style.display = '';
  document.getElementById('sol-contenido').style.display = 'none';
  document.getElementById('sol-actions').style.display = 'none';
  if (document.getElementById('sol-file-input'))
    document.getElementById('sol-file-input').value = '';
  document.getElementById('cnt-sol').textContent = '0';
}

// ---- VINCULAR PROVEEDOR ----
export function abrirVincular(uid) {
  state.vincUid = uid;
  const s = state.solicitudesData.find(x => x.uid === uid);
  if (!s) return;
  document.getElementById('vinc-nombre-sol').textContent = s.proveedor;
  document.getElementById('vinc-cuenta-sol').textContent =
    s.cuentaEmbebida ? `Cuenta en concepto: ${s.cuentaEmbebida}` : 'Sin cuenta en concepto';
  document.getElementById('vinc-nuevo-nombre').value = s.proveedor.toUpperCase();
  document.getElementById('vinc-nuevo-cuenta').value = s.cuentaEmbebida || '';
  validarVincCuenta();
  if (s.cuentaEmbebida) {
    const t = getTipo(s.cuentaEmbebida);
    document.getElementById('vinc-nuevo-tipo').value = t;
    renderVincTipo();
  }
  document.getElementById('vinc-buscar').value = '';
  renderVincBusqueda();
  document.getElementById('modal-vincular').classList.add('open');
}

export function renderVincBusqueda() {
  const q = document.getElementById('vinc-buscar').value.toLowerCase();
  const s = state.solicitudesData.find(x => x.uid === state.vincUid);
  let lista = [...state.proveedores];
  if (s) {
    lista.sort((a, b) => {
      const sa = buscarProveedorSol(a.nombre, s.cuentaEmbebida);
      const sb = buscarProveedorSol(b.nombre, s.cuentaEmbebida);
      return (sb?.score || 0) - (sa?.score || 0);
    });
  }
  if (q) lista = lista.filter(p =>
    p.nombre.toLowerCase().includes(q) || (p.cuenta || '').includes(q) || (p.banco || '').toLowerCase().includes(q)
  );
  const div = document.getElementById('vinc-resultados');
  if (!lista.length) {
    div.innerHTML = `<div style="padding:12px;text-align:center;color:var(--muted);font-size:12px;">Sin resultados</div>`;
    return;
  }
  div.innerHTML = lista.slice(0, 30).map(p => {
    const tipColor = p.tipo_cuenta === 'CLABE' ? 'var(--green)' : p.tipo_cuenta === 'Cuenta BBVA' ? 'var(--blue)' : 'var(--yellow)';
    return `<div onclick="seleccionarProvExistente(${p.id})"
      style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;transition:background .15s;"
      onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.nombre}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;font-family:'DM Mono',monospace;">${p.cuenta || ''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <span style="font-size:10px;color:${tipColor};font-weight:600;">${p.tipo_cuenta === 'CLABE' ? 'CLABE' : p.tipo_cuenta === 'Cuenta BBVA' ? 'BBVA' : 'Corta'}</span>
        <div style="font-size:10px;color:var(--muted);">${p.banco || ''}</div>
      </div>
    </div>`;
  }).join('');
}

export function seleccionarProvExistente(id) {
  const s = state.solicitudesData.find(x => x.uid === state.vincUid);
  const prov = state.proveedores.find(p => p.id === id);
  if (!s || !prov) return;
  s.match = prov;
  s.vinculadoManual = true;
  s.matchMetodo = 'manual';
  s.matchScore = 100;
  // Guardar alias si el nombre no coincide con el proveedor
  const nameNorm = normalizar(s.proveedor);
  if (!prov.aliases) prov.aliases = [];
  if (normalizar(prov.nombre) !== nameNorm && !prov.aliases.some(a => normalizar(a) === nameNorm)) {
    prov.aliases.push(s.proveedor);
    gsSaveAlias(s.proveedor, prov.id);
  }
  cerrar('modal-vincular');
  renderSolicitudes();
  notify(`Vinculado: ${s.proveedor} → ${prov.nombre}`);
}

export function renderVincTipo() {
  const tipo = document.getElementById('vinc-nuevo-tipo').value;
  const lbl = document.getElementById('vinc-lbl-cuenta');
  const ph = document.getElementById('vinc-nuevo-cuenta');
  if (tipo === 'CLABE') { lbl.textContent = 'CLABE Interbancaria (18 dígitos)'; ph.placeholder = '000000000000000000'; }
  else if (tipo === 'Cuenta BBVA') { lbl.textContent = 'Número de Cuenta BBVA (10 dígitos)'; ph.placeholder = '0000000000'; }
  else { lbl.textContent = 'Cuenta corta'; ph.placeholder = 'Número de cuenta'; }
  validarVincCuenta();
}

export function validarVincCuenta() {
  const tipo = document.getElementById('vinc-nuevo-tipo').value;
  const val = document.getElementById('vinc-nuevo-cuenta').value.trim();
  const st = document.getElementById('vinc-cuenta-status');
  const bancoEl = document.getElementById('vinc-banco');
  if (!val) { bancoEl.value = ''; st.innerHTML = ''; return; }
  if (tipo === 'CLABE') {
    if (val.length === 18) {
      const b = getBanco(val) || 'Banco desconocido';
      bancoEl.value = b;
      st.innerHTML = `<span class="cuenta-ok">✓ CLABE válida · ${b}</span>`;
    } else {
      bancoEl.value = '';
      st.innerHTML = `<span class="cuenta-err">${val.length}/18 dígitos</span>`;
    }
  } else {
    bancoEl.value = 'BBVA';
    st.innerHTML = `<span class="cuenta-ok">✓ BBVA</span>`;
  }
}

export function confirmarNuevoProv() {
  const s = state.solicitudesData.find(x => x.uid === state.vincUid);
  if (!s) return;
  const nombre = document.getElementById('vinc-nuevo-nombre').value.trim().toUpperCase();
  const cuenta = document.getElementById('vinc-nuevo-cuenta').value.trim();
  const tipo = document.getElementById('vinc-nuevo-tipo').value;
  const cat = document.getElementById('vinc-cat').value;
  if (!nombre) { notify('El nombre es obligatorio', 'error'); return; }
  if (!cuenta) { notify('La cuenta es obligatoria', 'error'); return; }
  if (tipo === 'CLABE' && cuenta.length !== 18) { notify('CLABE debe tener 18 dígitos', 'error'); return; }
  const nuevoProv = {
    id: state.nextId++, nombre, cuenta,
    banco: getBanco(cuenta) || 'BBVA', tipo_cuenta: tipo,
    clabe: tipo === 'CLABE' ? cuenta : '', num_cuenta: tipo !== 'CLABE' ? cuenta : '',
    rfc: '', categoria: cat, proyectos: [s.proyecto], activo: true
  };
  state.proveedores.push(nuevoProv);
  document.getElementById('cnt-prov').textContent = state.proveedores.length;
  s.match = nuevoProv;
  s.vinculadoManual = true;
  s.matchMetodo = 'nuevo';
  s.matchScore = 100;
  cerrar('modal-vincular');
  renderSolicitudes();
  notify(`Proveedor agregado y vinculado: ${nombre}`);
}

// ---- ENVIAR A COLA DE PAGOS ----
export function enviarACola() {
  const sel = state.solicitudesData.filter(s => s.seleccionado);
  if (!sel.length) { notify('Selecciona al menos un pago', 'error'); return; }

  const sinMatch = sel.filter(s => !s.match);
  if (sinMatch.length) {
    notify(`⚠ ${sinMatch.length} proveedor(es) sin vincular: ${sinMatch.map(s => s.proveedor).join(', ')}. Vincúlalos primero.`, 'error');
    return;
  }

  // Filtrar solicitudes con error de factura (ya están deseleccionadas pero por si acaso)
  const validos = sel.filter(s => !s._facturaError);
  if (!validos.length) { notify('⛔ Todos los pagos seleccionados tienen problemas de factura. Revisa las advertencias.', 'error'); return; }

  validos.forEach(s => {
    const prov = s.match;
    state.cola.push({
      id: Date.now() + Math.random(),
      proveedor: prov,
      concepto: (s.motivo || s.concepto || '').substring(0, 40),
      importe: s.importe,
      proyecto: s.proyecto || '',
      proveedor_id: s.proveedor_id || String(prov.id || ''),
      factura_id: s.factura_id || '',
      partida: s.partida || '',
      origen: 'solicitud',
      // Asignación planificada de costos (desde el Excel)
      asignacionesPlanificadas: s.asignacionesPlanificadas || [],
      repartoMetodo: s.repartoMetodo || null
    });
  });

  const count = validos.length;
  const total = validos.reduce((a, s) => a + s.importe, 0);

  // Limpiar solicitudes
  state.solicitudesData = [];
  document.getElementById('sol-dropzone').style.display = '';
  document.getElementById('sol-contenido').style.display = 'none';
  document.getElementById('sol-actions').style.display = 'none';
  if (document.getElementById('sol-file-input'))
    document.getElementById('sol-file-input').value = '';
  document.getElementById('cnt-sol').textContent = '0';

  // Actualizar cola
  document.getElementById('cnt-cola').textContent = state.cola.length;
  document.getElementById('st-cola').textContent = state.cola.length;
  renderCola();

  notify(`${count} pagos enviados a Cola · ${fmt(total)}`);

  // Navegar a Dispersión
  if (window.showPage) window.showPage('dispersion', document.getElementById('nav-dispersion'));
}

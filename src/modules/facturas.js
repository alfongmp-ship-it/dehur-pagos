import { state, datosListos, puedeBorrarFacturas, puedeLigarPagos, esAdmin, nuevoFacturaPagoId, nuevoAsignacionId } from '../state.js';
import { parseReparto } from './solicitudes.js';
import { fmt, fmtFecha, hoyFecha, escapeHtml } from '../ui/format.js';
import { proyTag } from '../ui/badges.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { gsSaveFacturas, gsSaveFacturaPagos, esPorFila, sbGuardarFila, sbBorrarFila, ensureHistorialIds, gsSaveCostoAsignaciones, purgarAsignacionesDeFactura } from '../services/google-sync.js';
import { proyectoMatch } from '../config/proyectos.js';
import { parseFechaHist } from './historial.js';
import { claseCelda, claseDeFactura, CLASE_LABEL, guardarClases, quitarClases, claseListo, maxIdConClase } from './facturas-clase.js';
import { sbDeleteRows } from '../services/supabase-data.js';

// Empresas propias a las que se factura (receptor del CFDI). Lista corta editable:
// agrega aquí si en el futuro facturan a otra razón social.
export const EMPRESAS_FACTURA = ['Dehur', 'Dehur Territorial'];

function diasAlVencimiento(fechaVenc) {
  if (!fechaVenc) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const venc = new Date(fechaVenc + 'T00:00:00');
  if (isNaN(venc)) return null;
  return Math.ceil((venc - hoy) / 86400000);
}

function vencimientoBadge(f) {
  if (f.estatus_factura === 'pagada' || f.estatus_factura === 'cancelada') return '';
  const dias = diasAlVencimiento(f.fecha_vencimiento);
  if (dias === null) return '';
  if (dias < 0) return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:600;background:rgba(224,90,90,.15);color:#e05a5a;">Vencida ${Math.abs(dias)}d</span>`;
  if (dias <= 7) return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:600;background:rgba(224,122,58,.15);color:#e07a3a;">Vence ${dias}d</span>`;
  return '';
}

function vencimientoColor(f) {
  if (f.estatus_factura === 'pagada' || f.estatus_factura === 'cancelada') return 'var(--muted)';
  const dias = diasAlVencimiento(f.fecha_vencimiento);
  if (dias === null) return 'var(--muted)';
  if (dias < 0) return '#e05a5a';
  if (dias <= 7) return '#e07a3a';
  return 'var(--muted)';
}

function renderFactStats() {
  const el = document.getElementById('fact-stats');
  if (!el) return;

  const pendientes = state.facturas.filter(f => f.estatus_factura === 'pendiente' || f.estatus_factura === 'parcial');
  const vencidas = pendientes.filter(f => { const d = diasAlVencimiento(f.fecha_vencimiento); return d !== null && d < 0; });
  const porVencer = pendientes.filter(f => { const d = diasAlVencimiento(f.fecha_vencimiento); return d !== null && d >= 0 && d <= 7; });
  const montoVencido = vencidas.reduce((s, f) => s + f.saldo_pendiente, 0);
  const montoPorVencer = porVencer.reduce((s, f) => s + f.saldo_pendiente, 0);

  if (!pendientes.length) { el.style.display = 'none'; return; }
  el.style.display = '';

  el.innerHTML = `
    <div class="stat-card" style="border-left:3px solid var(--red);">
      <div class="stat-label">Vencidas</div>
      <div class="stat-value" style="color:var(--red);">${vencidas.length}</div>
      <div class="stat-sub">${fmt(montoVencido)} pendiente</div>
    </div>
    <div class="stat-card" style="border-left:3px solid var(--orange);">
      <div class="stat-label">Vencen en 7 d</div>
      <div class="stat-value" style="color:var(--orange);">${porVencer.length}</div>
      <div class="stat-sub">${fmt(montoPorVencer)} pendiente</div>
    </div>
    <div class="stat-card" style="border-left:3px solid var(--accent);">
      <div class="stat-label">Pendientes</div>
      <div class="stat-value stat-accent">${pendientes.length}</div>
      <div class="stat-sub">${fmt(pendientes.reduce((s, f) => s + f.saldo_pendiente, 0))} total</div>
    </div>
    <div class="stat-card" style="border-left:3px solid var(--green);">
      <div class="stat-label">Al corriente</div>
      <div class="stat-value stat-green">${pendientes.length - vencidas.length - porVencer.length}</div>
      <div class="stat-sub">Sin urgencia</div>
    </div>`;
}

export function renderFacturas() {
  const tb = document.getElementById('tbody-fact');
  if (!tb) return;

  if (!datosListos()) {
    tb.innerHTML = '<tr><td colspan="14"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div></td></tr>';
    const sub = document.getElementById('fact-subtitulo'); if (sub) sub.textContent = '';
    const cnt = document.getElementById('cnt-fact'); if (cnt) cnt.textContent = '0';
    return;
  }

  refreshFactProyectos();
  _refreshLotesFactura();
  _refreshCatProvFactura();
  renderFactStats();

  if (!state.facturas.length) {
    tb.innerHTML = '<tr><td colspan="14"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🧾</div><div>Sin facturas registradas</div></div></td></tr>';
    document.getElementById('fact-subtitulo').textContent = '';
    return;
  }

  const fil = getFilteredFacturas();
  const sub = document.getElementById('fact-subtitulo');
  sub.textContent = fil.length !== state.facturas.length
    ? `${fil.length} de ${state.facturas.length} facturas`
    : `${state.facturas.length} facturas`;

  if (!fil.length) {
    tb.innerHTML = '<tr><td colspan="14"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin resultados con los filtros actuales</div></div></td></tr>';
    return;
  }

  // Suma del reparto (devengado) por factura, para mostrar completo / parcial / falta.
  const repartoSum = new Map();
  state.costoAsignaciones.forEach(a => { if (a.factura_id) repartoSum.set(String(a.factura_id), (repartoSum.get(String(a.factura_id)) || 0) + (a.monto_asignado || 0)); });
  // Pagos VINCULADOS por factura (para el indicador de la columna Pagado, sin tener que
  // abrir el detalle). Se cuentan las DOS vías de vínculo, igual que la regla canónica
  // _facturasLigadasAPago de costos-fiscales: la tabla facturaPagos (aplicar por partes)
  // y la bandera directa factura_id del pago (legacy). Set de pago_id por factura para no
  // contar dos veces el pago que tenga ambas. UNA pasada — patrón batch.
  // Empresa cruzada: resolver memoizado + contador para el checkbox del filtro
  // (visible solo cuando hay al menos una — si no hay, no estorba).
  const empresaDeProyecto = _empresasProyectosMap();
  const nCruzadas = state.facturas.reduce((n, f) => n + (_esEmpresaCruzada(f, empresaDeProyecto) ? 1 : 0), 0);
  const wrapEC = document.getElementById('ff-emp-cruzada-wrap');
  if (wrapEC) {
    wrapEC.style.display = nCruzadas ? 'inline-flex' : 'none';
    if (!nCruzadas) { const chk = document.getElementById('ff-emp-cruzada'); if (chk) chk.checked = false; }
    wrapEC.lastChild.textContent = ` ⚠ Empresa cruzada (${nCruzadas})`;
  }

  const pagosVinc = new Map();   // factura_id → Set(pago_id)
  const ligar = (fid, pid) => {
    const k = String(fid);
    if (!k || k === '0') return;
    let s = pagosVinc.get(k);
    if (!s) { s = new Set(); pagosVinc.set(k, s); }
    s.add(String(pid));
  };
  (state.facturaPagos || []).forEach(fp => ligar(fp.factura_id, fp.pago_id));
  state.historial.forEach(h => { if (h.factura_id != null && String(h.factura_id) !== '') ligar(h.factura_id, h.id); });
  tb.innerHTML = fil.map(f => {
    const provNombre = f.nombre_proveedor || f.razon_social || `ID ${f.proveedor_id}`;
    const estBadge = estatusBadge(f.estatus_factura);
    const vBadge = vencimientoBadge(f);
    const vColor = vencimientoColor(f);
    const sumR = repartoSum.get(String(f.factura_id)) || 0;
    const totalR = f.monto_total || 0;
    let repTxt, repTit, repCss;
    if (sumR <= 0.01) { repTxt = '⚠ Repartir'; repTit = 'Falta repartir el costo a unidades'; repCss = 'color:var(--orange);'; }
    else if (sumR < totalR - 0.5) { repTxt = `Parcial ${Math.round(sumR / totalR * 100)}%`; repTit = `Repartido ${fmt(sumR)} de ${fmt(totalR)} — falta ${fmt(totalR - sumR)}`; repCss = 'color:var(--orange);'; }
    // Sobre-repartida: suma de asignaciones MAYOR al total (dos repartos a la misma
    // factura). Antes se veía como "Reparto ✓" y el devengado iba al doble sin aviso.
    else if (sumR > totalR + 0.5) { repTxt = `⚠ ${Math.round(sumR / totalR * 100)}%`; repTit = `SOBRE-REPARTIDA: ${fmt(sumR)} asignados contra ${fmt(totalR)} de factura — hay reparto duplicado; límpialo y reparte de nuevo`; repCss = 'color:var(--red);font-weight:700;'; }
    else { repTxt = 'Reparto ✓'; repTit = 'Reparto del costo (devengado) completo'; repCss = ''; }
    const btnRepartir = `<button class="btn btn-ghost req-facturas req-repartir" style="padding:4px 8px;font-size:11px;${repCss}" onclick="abrirRepartirFactura(${f.factura_id})" title="${repTit}">${repTxt}</button>`;
    // Total: si hay nota de crédito, monto_total ya es el NETO (factura − NC). Mostramos el
    // neto y, debajo, el total ORIGINAL (antes de NC) + el monto de la NC, solo informativo.
    const ncTotal = (f.nc_subtotal || 0) + (f.nc_iva || 0);
    const totalCell = ncTotal > 0.005
      ? `${fmt(f.monto_total)}<div style="font-size:9px;color:var(--muted);font-weight:400;">orig. ${fmt((f.monto_total || 0) + ncTotal)} · NC −${fmt(ncTotal)}</div>`
      : fmt(f.monto_total);
    // Indicador de pago VINCULADO bajo el monto pagado: evita abrir el detalle para saberlo.
    // El tooltip lista cada pago (fecha · monto aplicado). El caso "hay monto pagado pero
    // ningún pago vinculado" se marca en ámbar: es justo el que descuadra la supresión de costo.
    const nVinc = (pagosVinc.get(String(f.factura_id)) || new Set()).size;
    let vincCell = '';
    if (nVinc > 0) {
      const det = (state.facturaPagos || [])
        .filter(fp => String(fp.factura_id) === String(f.factura_id))
        .map(fp => `${fmtFecha(fp.fecha_pago)} · ${fmt(fp.monto_aplicado)}`).join('\n');
      vincCell = `<div style="font-size:9px;color:var(--green);font-weight:600;" title="${escapeHtml(det || 'Pago ligado a esta factura')}">✓ ${nVinc === 1 ? 'Pago vinculado' : nVinc + ' pagos vinculados'}</div>`;
    } else if ((f.monto_pagado || 0) > 0.005) {
      vincCell = '<div style="font-size:9px;color:var(--orange);font-weight:600;" title="La factura tiene monto pagado capturado, pero NINGÚN pago del historial está ligado a ella. Liga el pago con 📎 en Costos por Unidad para que su costo no se cuente doble.">⚠ Sin pago vinculado</div>';
    }
    return `<tr ondblclick="abrirDetalleFactura(${f.factura_id})" style="cursor:pointer;" title="Doble click para ver el detalle y los pagos">
      <td style="text-align:center;"><input type="checkbox" class="req-admin" ${factSel.has(String(f.factura_id)) ? 'checked' : ''} onclick="toggleFactSel('${f.factura_id}', event)" style="cursor:pointer;" title="Seleccionar"></td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${f.factura_id}</td>
      <td style="font-size:11px;"><span style="font-family:'DM Mono',monospace;" title="${escapeHtml(f.uuid)}">${escapeHtml((f.uuid || '').split('-')[0]) || '—'}</span><div style="font-size:9px;color:var(--muted);">Núm: ${escapeHtml(f.numero_factura) || '—'}</div></td>
      <td><div style="font-weight:500;font-size:12px;">${escapeHtml(provNombre)}</div><div style="font-size:10px;color:var(--muted);">${f.razon_social && f.nombre_proveedor ? escapeHtml(f.razon_social) : ''}</div></td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(f.fecha_factura)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:${vColor};font-weight:${vColor !== 'var(--muted)' ? '600' : '400'};">${fmtFecha(f.fecha_vencimiento) || '—'} ${vBadge}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;">${totalCell}</td>
      <td style="font-family:'DM Mono',monospace;text-align:right;color:var(--green);">${fmt(f.monto_pagado)}${vincCell}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;color:${f.saldo_pendiente > 0 ? 'var(--accent)' : 'var(--muted)'};">${fmt(f.saldo_pendiente)}</td>
      <td>${estBadge}</td>
      <td>${estadoSatBadge(f.estado_sat)}</td>
      <td>${proyTag(f.proyecto)}${_esEmpresaCruzada(f, empresaDeProyecto) ? `<div style="font-size:9px;color:var(--red);font-weight:700;" title="La factura está a ${escapeHtml(f.empresa)} pero el proyecto es de otra empresa: NO cuenta para el costo fiscal de este proyecto. Si es un error de captura, corrígela con 🏢 Cambiar empresa.">⚠ ${escapeHtml(f.empresa)}</div>` : ''}</td>
      <td>${claseCelda(f.factura_id)}</td>
      <td style="text-align:right;white-space:nowrap;">${btnRepartir} <button class="btn btn-ghost req-facturas" style="padding:4px 8px;font-size:11px;" onclick="editarFactura(${f.factura_id})">Editar</button></td>
    </tr>`;
  }).join('');

  // Depura ids que ya no existen (borrados desde otra pestaña vía realtime) para que
  // el contador del botón no mienta, y sincroniza el checkbox maestro.
  const idsActuales = new Set(state.facturas.map(f => String(f.factura_id)));
  [...factSel].forEach(id => { if (!idsActuales.has(id)) factSel.delete(id); });
  actualizarBarraSelFact();
  _syncSelAllFact(fil);
}

// Cambia el campo de búsqueda (Todo/ID/N°/UUID) y ajusta el placeholder de ayuda.
export function cambiarBuscarPorFactura() {
  const modo = document.getElementById('ff-buscar-por')?.value || 'todo';
  const inp = document.getElementById('buscar-fact');
  if (inp) {
    inp.placeholder = modo === 'id' ? 'Escribe el ID interno…'
      : modo === 'numero' ? 'Escribe el Número de Factura…'
      : modo === 'uuid' ? 'Escribe el UUID (folio fiscal)…'
      : 'Buscar por ID, folio o proveedor…';
  }
  renderFacturas();
}

// ===== Selección múltiple (solo admin) para acciones en bloque =====
// Guarda factura_id como String (NO índices): con realtime moviendo el array, un
// índice viejo apuntaría a otra factura. Se depura en cada render.
const factSel = new Set();

export function toggleFactSel(id, ev) {
  if (ev) ev.stopPropagation();          // la fila tiene ondblclick (abrir detalle)
  const k = String(id);
  if (factSel.has(k)) factSel.delete(k); else factSel.add(k);
  actualizarBarraSelFact();
  _syncSelAllFact(getFilteredFacturas());
}

export function toggleFactSelAll(check) {
  const fil = getFilteredFacturas();     // solo las VISIBLES con los filtros actuales
  fil.forEach(f => {
    const k = String(f.factura_id);
    if (check) factSel.add(k); else factSel.delete(k);
  });
  renderFacturas();
}

function actualizarBarraSelFact() {
  const n = factSel.size;
  const btn = document.getElementById('fact-bulk-empresa');
  if (btn) {
    btn.style.display = n > 0 ? '' : 'none';
    btn.textContent = `🏢 Cambiar empresa (${n})`;
  }
  const btnR = document.getElementById('fact-bulk-reparto');
  if (btnR) {
    btnR.style.display = n > 0 ? '' : 'none';
    btnR.textContent = `📊 Repartir (${n})`;
  }
  const btnC = document.getElementById('fact-bulk-clase');
  if (btnC) {
    btnC.style.display = n > 0 ? '' : 'none';
    btnC.textContent = `🏷 Clase de costo (${n})`;
  }
  const btnB = document.getElementById('fact-bulk-borrar');
  if (btnB) {
    btnB.style.display = n > 0 ? '' : 'none';
    btnB.textContent = `🗑 Borrar (${n})`;
  }
}

// ===== Acción en bloque: BORRAR facturas (solo admin) =====
// Pensada para limpiar cargas duplicadas. Por seguridad SOLO borra facturas SIN reparto
// y SIN pagos aplicados: las que tengan cualquiera de los dos se saltan (se borran una por
// una desde Editar, donde se avisa cuánto costo o qué pagos se pierden).
export async function borrarFacturasBulk() {
  if (!esAdmin()) { notify('Solo el admin puede borrar facturas en bloque', 'error'); return; }
  const sel = state.facturas.filter(f => factSel.has(String(f.factura_id)));
  if (!sel.length) { notify('Selecciona al menos una factura', 'error'); return; }
  const conRep = new Set(state.costoAsignaciones.filter(a => a.factura_id).map(a => String(a.factura_id)));
  const conPago = new Set(state.facturaPagos.map(fp => String(fp.factura_id)));
  const tieneAlgo = f => conRep.has(String(f.factura_id)) || conPago.has(String(f.factura_id));
  const saltadas = sel.filter(tieneAlgo);
  const borrar = sel.filter(f => !tieneAlgo(f));
  if (!borrar.length) {
    notify(`No se borró nada: las ${sel.length} seleccionada(s) tienen reparto o pagos aplicados (esas se borran una por una desde Editar)`, 'error');
    return;
  }
  const total = borrar.reduce((s, f) => s + (f.monto_total || 0), 0);
  if (!confirm(`¿Borrar ${borrar.length} factura(s) por ${fmt(total)}?`
    + (saltadas.length ? `\n\n${saltadas.length} de las seleccionadas tienen reparto o pagos aplicados: esas NO se borran.` : '')
    + `\n\nSolo se borran facturas SIN reparto y SIN pagos. No se puede deshacer.`)) return;
  const porFilaF = esPorFila('facturas');
  const porFilaH = esPorFila('historial');
  let borradas = 0;
  try {
    for (let i = 0; i < borrar.length; i += 50) {
      const trozo = borrar.slice(i, i + 50);
      const ids = trozo.map(f => f.factura_id);
      if (porFilaF) await sbDeleteRows('facturas', 'factura_id', ids);
      const fuera = new Set(ids.map(String));
      state.facturas = state.facturas.filter(f => !fuera.has(String(f.factura_id)));
      // Pagos del historial que apuntaban a estas facturas (marcador viejo): se desligan.
      state.historial.forEach(h => {
        if (h.factura_id && fuera.has(String(h.factura_id))) {
          h.factura_id = '';
          if (porFilaH) sbGuardarFila('historial', h);
        }
      });
      const conClase = ids.filter(id => claseDeFactura(id));
      if (conClase.length) await quitarClases(conClase);
      borradas += ids.length;
    }
  } catch (e) {
    notify(`⚠️ Se borraron ${borradas} de ${borrar.length}; el resto falló (${(e && e.message) || e}). Vuelve a intentarlo con las que queden.`, 'error');
  }
  gsSaveFacturas({ porFila: porFilaF });
  factSel.clear();
  renderFacturas();
  const cnt = document.getElementById('cnt-fact');
  if (cnt) cnt.textContent = state.facturas.length;
  if (borradas === borrar.length) {
    notify(`✓ ${borradas} factura(s) borrada(s)${saltadas.length ? ` · ${saltadas.length} con reparto o pagos se dejaron` : ''}`);
  }
}

// El maestro queda marcado solo si TODAS las visibles están seleccionadas.
function _syncSelAllFact(fil) {
  const cb = document.getElementById('fact-sel-all');
  if (cb) cb.checked = fil.length > 0 && fil.every(f => factSel.has(String(f.factura_id)));
}

// ===== Lotes de carga (derivados de observaciones, sin campo nuevo en la base) =====
// Una carga masiva marcada (ej. "Conciliación Ericka ENE-MAY 2026 · FEB · …") deja su
// etiqueta en observaciones; el filtro la DERIVA leyendo el primer segmento antes del
// '·'. Si alguien reescribe esa observación, la factura simplemente sale del lote.
function _loteDeFactura(f) {
  const obs = String(f.observaciones || '');
  if (!obs) return '';
  const plano = obs.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!plano.includes('concilia')) return '';
  return obs.split('·')[0].trim();
}

// Repinta las opciones del select de lotes (UNA pasada sobre state.facturas) y
// preserva lo elegido. Si no hay lotes, esconde el select para no ensuciar la barra.
function _refreshLotesFactura() {
  const sel = document.getElementById('ff-lote');
  if (!sel) return;
  const cuenta = new Map();
  let sinLote = 0;
  state.facturas.forEach(f => {
    const lote = _loteDeFactura(f);
    if (lote) cuenta.set(lote, (cuenta.get(lote) || 0) + 1);
    else sinLote++;
  });
  if (!cuenta.size) { sel.style.display = 'none'; sel.value = ''; return; }
  sel.style.display = '';
  const prev = sel.value;
  const lotes = [...cuenta.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  sel.innerHTML = '<option value="">Todos los lotes</option>'
    + lotes.map(([l, n]) => `<option value="${escapeHtml(l)}">${escapeHtml(l)} (${n})</option>`).join('')
    + `<option value="__sin__">— Sin lote (captura normal) (${sinLote}) —</option>`;
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// Filtro "Categoría del proveedor": opciones a partir de los proveedores que SÍ tienen
// facturas — la categoría y, si la trae, "categoría · subcategoría" (valor "cat||sub").
// Sirve para ver juntas, p. ej., todas las facturas de "Gastos de operación".
function _refreshCatProvFactura() {
  const sel = document.getElementById('ff-catprov');
  if (!sel) return;
  const provPorId = new Map((state.proveedores || []).map(p => [String(p.id), p]));
  const cuenta = new Map();
  const suma = k => cuenta.set(k, (cuenta.get(k) || 0) + 1);
  state.facturas.forEach(f => {
    const p = provPorId.get(String(f.proveedor_id));
    if (!p || !p.categoria) return;
    suma(p.categoria + '||');
    if (p.subcategoria) suma(p.categoria + '||' + p.subcategoria);
  });
  const prev = sel.value;
  const ops = [...cuenta.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  sel.innerHTML = '<option value="">Proveedor: todas las categorías</option>'
    + ops.map(([k, n]) => {
      const [c, s] = k.split('||');
      return `<option value="${escapeHtml(k)}">${escapeHtml(s ? `${c} · ${s}` : c)} (${n})</option>`;
    }).join('');
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// ===== EMPRESA CRUZADA =====
// Factura cuya empresa NO coincide con la empresa del proyecto (ej. Home Depot
// facturada a "Dehur" en un proyecto de "Dehur Territorial"). El SAT no la
// acepta para esa empresa: se rotula aquí y el modo 💼 fiscal la excluye. Solo
// cuenta como cruzada si AMBAS empresas están capturadas.
const _normEmpF = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
function _empresasProyectosMap() {
  // f.proyecto (texto libre) → empresa del proyecto, resuelto con proyectoMatch
  // y memoizado por nombre crudo para no re-buscar en cada fila.
  const memo = new Map();
  return (proyectoCrudo) => {
    const k = proyectoCrudo || '';
    if (memo.has(k)) return memo.get(k);
    const p = (state.proyectos || []).find(pp => proyectoMatch(k, pp.nombre));
    const emp = _normEmpF(p && p.empresa);
    memo.set(k, emp);
    return emp;
  };
}
function _esEmpresaCruzada(f, empresaDeProyecto) {
  const ep = empresaDeProyecto(f.proyecto);
  const ef = _normEmpF(f.empresa);
  return !!(ep && ef && ep !== ef);
}

function getFilteredFacturas() {
  const q = (document.getElementById('buscar-fact')?.value || '').trim().toLowerCase();
  const modo = document.getElementById('ff-buscar-por')?.value || 'todo';
  const fe = document.getElementById('ff-estatus')?.value || '';
  const fes = document.getElementById('ff-estado-sat')?.value || '';
  const fp = document.getElementById('ff-proy')?.value || '';
  const fl = document.getElementById('ff-lote')?.value || '';
  const fx = document.getElementById('ff-emp-cruzada')?.checked || false;
  const fc = document.getElementById('ff-clase')?.value || '';
  const frep = document.getElementById('ff-reparto')?.value || '';
  const conRepF = frep ? new Set(state.costoAsignaciones.filter(a => a.factura_id).map(a => String(a.factura_id))) : null;
  const fcp = document.getElementById('ff-catprov')?.value || '';
  const provPorIdF = fcp ? new Map((state.proveedores || []).map(p => [String(p.id), p])) : null;
  const empresaDeProyecto = _empresasProyectosMap();
  const fil = state.facturas.filter(f => {
    if (fx && !_esEmpresaCruzada(f, empresaDeProyecto)) return false;
    if (fc) {
      const c = claseDeFactura(f.factura_id);
      if (fc === 'sin' ? !!c : !c || c.clase !== fc) return false;
    }
    if (frep) {
      const rep = conRepF.has(String(f.factura_id));
      if (frep === 'con' ? !rep : rep) return false;
    }
    if (fcp) {
      const [cat, sub] = fcp.split('||');
      const pv = provPorIdF.get(String(f.proveedor_id));
      if (!pv || pv.categoria !== cat || (sub && pv.subcategoria !== sub)) return false;
    }
    if (q) {
      // Búsqueda por CAMPO elegido → así un número no se confunde entre ID, N° de
      // factura y UUID. 'todo' conserva el buscador amplio de siempre.
      if (modo === 'id') {
        if (!String(f.factura_id).toLowerCase().includes(q)) return false;
      } else if (modo === 'numero') {
        if (!(f.numero_factura || '').toLowerCase().includes(q)) return false;
      } else if (modo === 'uuid') {
        if (!(f.uuid || '').toLowerCase().includes(q)) return false;
      } else {
        const prov = state.proveedores.find(p => p.id === f.proveedor_id);
        const provNombre = prov ? prov.nombre.toLowerCase() : '';
        if (!(/^\d+$/.test(q) ? String(f.factura_id) === q || String(f.proveedor_id) === q : provNombre.includes(q) || (f.numero_factura || '').toLowerCase().includes(q) || (f.nombre_proveedor || '').toLowerCase().includes(q) || (f.rfc_emisor || '').toLowerCase().includes(q) || (f.uuid || '').toLowerCase().includes(q) || (f.observaciones || '').toLowerCase().includes(q))) return false;
      }
    }
    if (fe && f.estatus_factura !== fe) return false;
    if (fes && (f.estado_sat || 'Vigente') !== fes) return false;
    if (fp && !proyectoMatch(f.proyecto, fp)) return false;
    if (fl) {
      const lote = _loteDeFactura(f);
      if (fl === '__sin__') { if (lote) return false; }
      else if (lote !== fl) return false;
    }
    return true;
  });
  // Orden: primero las que AÚN requieren acción (pendiente/parcial) — por VENCIMIENTO ascendente
  // (las más vencidas / próximas a vencer arriba; sin vencimiento al fondo de su grupo), desempate
  // por FECHA DE FACTURA descendente. Las ya cerradas (pagada/cancelada) se van ABAJO, y entre
  // ellas la más VIEJA hasta el fondo (fecha de factura descendente). Aplica a la lista y al export.
  const _cerrada = f => f.estatus_factura === 'pagada' || f.estatus_factura === 'cancelada';
  fil.sort((a, b) => {
    const ca = _cerrada(a), cb = _cerrada(b);
    if (ca !== cb) return ca ? 1 : -1;                       // pagadas/canceladas al fondo
    const fa = parseFechaHist(a.fecha_factura) || '';
    const fb = parseFechaHist(b.fecha_factura) || '';
    if (!ca) {                                               // activas: por vencimiento ascendente
      const va = parseFechaHist(a.fecha_vencimiento) || '9999-12-31';
      const vb = parseFechaHist(b.fecha_vencimiento) || '9999-12-31';
      if (va !== vb) return va < vb ? -1 : 1;
      return fa < fb ? 1 : (fa > fb ? -1 : 0);               // desempate: factura más reciente arriba
    }
    return fa < fb ? 1 : (fa > fb ? -1 : 0);                 // pagadas: más vieja abajo (fecha desc)
  });
  return fil;
}

// Exporta el reporte de facturas (lo FILTRADO que se ve en pantalla) a un Excel real
// (.xlsx) usando la librería XLSX ya cargada. Solo-lectura: no toca datos. Montos van como
// números para que Excel los sume; incluye nota de crédito y el total neto.
export function exportarFacturasExcel() {
  if (!state.facturas.length) { notify('No hay facturas para exportar', 'error'); return; }
  const fil = getFilteredFacturas();
  if (!fil.length) { notify('No hay facturas con los filtros actuales', 'error'); return; }
  const headers = ['ID', 'Folio', 'UUID', 'Proveedor', 'Razón social', 'RFC emisor',
    'Fecha factura', 'Vencimiento', 'Subtotal', 'Descuento', 'IVA', 'Ret. IVA', 'Ret. ISR',
    'NC monto', 'NC IVA', 'Total neto', 'Pagado', 'Saldo', 'Estatus pago', 'Estado SAT',
    'Tipo comprobante', 'Proyecto', 'Empresa facturada', 'Observaciones', 'Clase de costo', 'Cuenta contable', 'Origen de la clase',
    'Categoría del proveedor', 'Subcategoría del proveedor'];
  const rows = fil.map(f => {
    const prov = state.proveedores.find(p => p.id === f.proveedor_id);
    const provNombre = f.nombre_proveedor || (prov ? prov.nombre : '') || f.razon_social || `ID ${f.proveedor_id}`;
    return [
      f.factura_id, f.numero_factura || '', f.uuid || '', provNombre, f.razon_social || '',
      f.rfc_emisor || '', fmtFecha(f.fecha_factura), fmtFecha(f.fecha_vencimiento) || '',
      f.subtotal || 0, f.descuento || 0, f.iva_trasladado || 0, f.retencion_iva || 0, f.retencion_isr || 0,
      f.nc_subtotal || 0, f.nc_iva || 0, f.monto_total || 0, f.monto_pagado || 0, f.saldo_pendiente || 0,
      f.estatus_factura || '', f.estado_sat || 'Vigente', f.tipo_comprobante || 'Factura',
      f.proyecto || '', f.empresa || '', f.observaciones || '',
      ...(c => [c ? (CLASE_LABEL[c.clase] || c.clase) : 'Sin clasificar', c ? c.cuenta_contable || '' : '', c ? (c.fuente === 'manual' ? 'Manual' : c.lote || '') : ''])(claseDeFactura(f.factura_id)),
      prov ? prov.categoria || '' : '', prov ? prov.subcategoria || '' : ''
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
  XLSX.writeFile(wb, `facturas_dehur_${hoyFecha().replace(/\//g, '-')}.xlsx`);
  notify(`Reporte exportado (${fil.length} factura${fil.length !== 1 ? 's' : ''})`);
}

// ===== Acción en bloque: Empresa facturada (solo admin) =====
// Pensada para cargas masivas que entraron sin empresa (el importador no la trae).
// Solo toca el campo `empresa`: ningún motor de costos ni el fiscal lo usan.
export function abrirEmpresaBulk() {
  if (!esAdmin()) { notify('Solo el admin puede cambiar la empresa en bloque', 'error'); return; }
  if (!factSel.size) { notify('Selecciona al menos una factura', 'error'); return; }
  const sel = document.getElementById('eb-empresa');
  if (sel) {
    // Empresa de la primera seleccionada como valor inicial (si todas comparten una).
    const objetivos = state.facturas.filter(f => factSel.has(String(f.factura_id)));
    const actuales = new Set(objetivos.map(f => f.empresa || ''));
    sel.innerHTML = '<option value="">— Sin especificar —</option>'
      + EMPRESAS_FACTURA.map(e => `<option>${escapeHtml(e)}</option>`).join('');
    sel.value = actuales.size === 1 ? [...actuales][0] : '';
  }
  const tit = document.getElementById('eb-titulo');
  if (tit) tit.textContent = `Empresa facturada — ${factSel.size} factura(s) seleccionada(s)`;
  document.getElementById('modal-empresa-bulk').classList.add('open');
}

export function aplicarEmpresaBulk() {
  if (!esAdmin()) { notify('Solo el admin puede cambiar la empresa en bloque', 'error'); return; }
  const objetivos = state.facturas.filter(f => factSel.has(String(f.factura_id)));
  if (!objetivos.length) { notify('No hay facturas seleccionadas', 'error'); return; }
  const valor = document.getElementById('eb-empresa')?.value || '';
  const etiqueta = valor || '(sin especificar)';
  if (!confirm(`¿Poner la empresa "${etiqueta}" a ${objetivos.length} factura(s)?\n\nSe reemplaza la que tengan actualmente.`)) return;

  objetivos.forEach(f => { f.empresa = valor; });
  // Guardado POR FILA: N upserts, nunca el espejo completo de la tabla (evita la
  // tormenta de eventos realtime que rebota la UI de todos).
  const porFila = esPorFila('facturas');
  gsSaveFacturas({ porFila });
  if (porFila) objetivos.forEach(f => sbGuardarFila('facturas', f));

  factSel.clear();
  cerrar('modal-empresa-bulk');
  renderFacturas();
  notify(`✓ ${objetivos.length} factura(s) actualizada(s) — empresa: ${etiqueta}`);
}

// ===== Acción en bloque: CLASE DE COSTO (solo admin) =====
// Directo / Indirecto de obra a las seleccionadas, o quitarla (sin clasificar). Se
// guarda aparte de la factura (tabla factura_clase, SQL 47): solo toca la clase;
// la cuenta contable que ya tuvieran se conserva.
export function abrirClaseBulk() {
  if (!esAdmin()) { notify('Solo el admin puede cambiar la clase de costo', 'error'); return; }
  if (!claseListo()) { notify('Falta correr el SQL 47 (clase de costo) en Supabase', 'error'); return; }
  if (!factSel.size) { notify('Selecciona al menos una factura', 'error'); return; }
  const actuales = new Set([...factSel].map(id => { const c = claseDeFactura(id); return c ? c.clase : ''; }));
  const sel = document.getElementById('cb-clase');
  if (sel) sel.value = actuales.size === 1 && [...actuales][0] ? [...actuales][0] : 'directo';
  const tit = document.getElementById('cb-titulo');
  if (tit) tit.textContent = `Clase de costo — ${factSel.size} factura(s) seleccionada(s)`;
  document.getElementById('modal-clase-bulk').classList.add('open');
}

export async function aplicarClaseBulk() {
  if (!esAdmin()) { notify('Solo el admin puede cambiar la clase de costo', 'error'); return; }
  const ids = state.facturas.filter(f => factSel.has(String(f.factura_id))).map(f => String(f.factura_id));
  if (!ids.length) { notify('No hay facturas seleccionadas', 'error'); return; }
  if (!claseListo()) { notify('Falta correr el SQL 47 (clase de costo) en Supabase', 'error'); return; }
  const valor = document.getElementById('cb-clase')?.value || '';
  const etiqueta = valor ? CLASE_LABEL[valor] : 'Sin clasificar (quitar la clase)';
  // Solo las que CAMBIAN: volver a poner la misma clase no borra su origen (Excel) ni su cuenta.
  const cambian = ids.filter(id => { const c = claseDeFactura(id); return valor ? !(c && c.clase === valor) : !!c; });
  if (!cambian.length) { cerrar('modal-clase-bulk'); notify(`Las ${ids.length} factura(s) ya estaban en "${etiqueta}": no hay nada que cambiar`); return; }
  const yaEstaban = ids.length - cambian.length;
  if (!confirm(`¿Poner "${etiqueta}" a ${cambian.length} factura(s)?${yaEstaban ? `\n(${yaEstaban} ya estaban así y no se tocan)` : ''}\n\nSolo cambia la clase de costo: no toca montos, partidas, proyectos ni repartos.`)) return;
  cerrar('modal-clase-bulk');
  try {
    if (valor) {
      await guardarClases(cambian.map(id => {
        const prev = claseDeFactura(id);
        return { factura_id: id, clase: valor, cuenta_contable: prev ? prev.cuenta_contable : '', fuente: 'manual', lote: '' };
      }));
    } else {
      await quitarClases(cambian);
    }
    factSel.clear();
    notify(`✓ ${cambian.length} factura(s): ${etiqueta}`, 'success');
  } catch (e) {
    notify(`⚠️ No se pudo guardar la clase (${(e && e.message) || e}). Lo ya guardado quedó; intenta de nuevo.`, 'error');
  }
  renderFacturas();
}

// ===== Acción en bloque: REPARTIR facturas (solo admin) =====
// Misma partida/sub-partida y método para N facturas SIN reparto. Reusa la
// aritmética probada del importador (parseReparto, con la fecha de CADA factura
// para el pool de indiviso) y el guardado con foto de costoAsignaciones. Las
// facturas que YA tengan asignaciones se saltan — verificado AL APLICAR, no al
// seleccionar — así dos personas no pueden duplicar el devengado de una factura.
const RB_MAX = 30;   // tope por tanda: el guardado sube fila por fila y con
                     // indiviso cada factura son ~30-40 filas (tiempo y realtime)
const _rbR2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
let _bulkEnCurso = false;   // guardado en curso: bloquea abrir/aplicar otra tanda
let _rbReintento = null;    // { partes } cuando el guardado quedó INCOMPLETO (filas aún en memoria)

// Guarda lo que ya está en state con progreso en el modal. El modal se queda ABIERTO
// hasta terminar (invita a no navegar); si falla, se queda abierto en modo
// "Reintentar guardado": las filas pendientes siguen en memoria y el diff del
// guardado sube SOLO lo que falta. Nada se pierde mientras no se recargue la app.
async function _rbGuardar(partesBase) {
  const btn = document.getElementById('rb-aplicar');
  const prog = document.getElementById('rb-progreso');
  _bulkEnCurso = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  if (prog) prog.innerHTML = '<span style="color:var(--accent);">Guardando… no cierres ni recargues la app</span>';
  try {
    const res = await gsSaveCostoAsignaciones({
      onProgress: (k, n) => { if (prog) prog.innerHTML = `<span style="color:var(--accent);">Guardando <b>${k}</b> de <b>${n}</b> asignaciones… no cierres ni recargues la app</span>`; }
    });
    if (res && res.ok) {
      _rbReintento = null;
      if (prog) prog.textContent = '';
      cerrar('modal-reparto-bulk');
      renderFacturas();
      notify([...partesBase, `${res.subidas} asignaciones guardadas`].join(' · '));
    } else {
      const motivo = res ? (res.error || res.motivo || 'error desconocido') : 'sin respuesta';
      const pend = res ? res.pendientes : '?';
      _rbReintento = { partes: partesBase };
      if (prog) prog.innerHTML = `<span style="color:var(--red);font-weight:600;">⛔ ${pend} asignaciones NO se guardaron (${escapeHtml(String(motivo))}). Revisa tu conexión y pulsa "Reintentar guardado". No recargues la app: lo pendiente solo vive en memoria.</span>`;
      renderFacturas();
      notify(`⛔ ${pend} asignaciones NO se guardaron en Supabase (${motivo}). No recargues: abre "📊 Repartir" y pulsa "Reintentar guardado".`, 'error');
    }
  } finally {
    _bulkEnCurso = false;
    if (btn) { btn.disabled = false; btn.textContent = _rbReintento ? 'Reintentar guardado' : 'Repartir'; }
  }
}

const RB_AYUDA = {
  indiviso: '',
  directo: '(un código de casa, ej. A-1)',
  equitativo: '(códigos separados por /, ej. A-1/A-2/A-3)',
  custom: '(código:% separados por /, ej. A-1:60/A-2:40 — usa INDIVISO como código para mandar ese % por indiviso)',
};

export function rbMetodoChange() {
  const metodo = document.getElementById('rb-metodo')?.value || 'indiviso';
  const wrap = document.getElementById('rb-unidades-wrap');
  if (wrap) wrap.style.display = metodo === 'indiviso' ? 'none' : '';
  const ayuda = document.getElementById('rb-unidades-ayuda');
  if (ayuda) ayuda.textContent = RB_AYUDA[metodo] || '';
  const inp = document.getElementById('rb-unidades');
  if (inp) inp.placeholder = (RB_AYUDA[metodo] || '').replace(/[()]/g, '');
}

export function rbPartidaChange() {
  const partida = document.getElementById('rb-partida')?.value || '';
  const cat = (state.partidasCatalogo || []).find(p => p.activa !== false && p.partida === partida);
  const subs = (cat && Array.isArray(cat.subpartidas)) ? cat.subpartidas : [];
  const wrap = document.getElementById('rb-sub-wrap');
  const sel = document.getElementById('rb-subpartida');
  if (!wrap || !sel) return;
  wrap.style.display = subs.length ? '' : 'none';
  sel.innerHTML = subs.map(s => `<option>${escapeHtml(s)}</option>`).join('');
}

export function abrirRepartoBulk() {
  if (!esAdmin()) { notify('Solo el admin puede repartir en bloque', 'error'); return; }
  if (_bulkEnCurso) { notify('Hay un reparto guardándose; espera a que termine', 'error'); return; }
  // Guardado anterior incompleto: el modal se abre en modo reintento (sin nueva tanda).
  if (_rbReintento) {
    const prog = document.getElementById('rb-progreso');
    if (prog) prog.innerHTML = '<span style="color:var(--red);font-weight:600;">⛔ Hay asignaciones del reparto anterior sin guardar. Pulsa "Reintentar guardado" antes de repartir otra tanda.</span>';
    const btn = document.getElementById('rb-aplicar');
    if (btn) { btn.disabled = false; btn.textContent = 'Reintentar guardado'; }
    const res = document.getElementById('rb-resumen');
    if (res) res.textContent = '';
    document.getElementById('modal-reparto-bulk').classList.add('open');
    return;
  }
  if (!factSel.size) { notify('Selecciona al menos una factura', 'error'); return; }
  const progLimpio = document.getElementById('rb-progreso'); if (progLimpio) progLimpio.textContent = '';
  const btnLimpio = document.getElementById('rb-aplicar'); if (btnLimpio) { btnLimpio.disabled = false; btnLimpio.textContent = 'Repartir'; }
  const objetivos = state.facturas.filter(f => factSel.has(String(f.factura_id)));
  const proys = new Set(objetivos.map(f => f.proyecto || ''));
  const total = objetivos.reduce((s, f) => s + (f.monto_total || 0), 0);
  const res = document.getElementById('rb-resumen');
  if (res) res.innerHTML = `<b>${objetivos.length}</b> factura(s) seleccionada(s) · ${fmt(total)} · proyecto: <b>${[...proys].map(escapeHtml).join(', ') || '—'}</b>`
    + (proys.size > 1 ? ' <span style="color:var(--red);font-weight:600;">⛔ hay varios proyectos: deselecciona hasta dejar uno</span>' : '');
  const selP = document.getElementById('rb-partida');
  if (selP) selP.innerHTML = '<option value="">— Elige la partida —</option>'
    + (state.partidasCatalogo || []).filter(p => p.activa !== false).map(p => `<option>${escapeHtml(p.partida)}</option>`).join('');
  rbPartidaChange();
  rbMetodoChange();
  document.getElementById('modal-reparto-bulk').classList.add('open');
}

export async function aplicarRepartoBulk() {
  if (!esAdmin()) { notify('Solo el admin puede repartir en bloque', 'error'); return; }
  if (_bulkEnCurso) { notify('Hay un guardado en curso; espera a que termine', 'error'); return; }
  if (_rbReintento) { await _rbGuardar(_rbReintento.partes); return; }   // solo reintenta lo pendiente
  const objetivos = state.facturas.filter(f => factSel.has(String(f.factura_id)));
  if (!objetivos.length) { notify('No hay facturas seleccionadas', 'error'); return; }

  // Un solo proyecto por tanda: los códigos de casa y el pool de indiviso son por proyecto.
  const proys = new Set(objetivos.map(f => f.proyecto || ''));
  if (proys.size > 1) { notify('Las seleccionadas son de VARIOS proyectos; reparte un proyecto por tanda', 'error'); return; }

  const metodo = document.getElementById('rb-metodo')?.value || 'indiviso';
  const unidadesTxt = document.getElementById('rb-unidades')?.value || '';
  const partida = document.getElementById('rb-partida')?.value || '';
  const cat = (state.partidasCatalogo || []).find(p => p.activa !== false && p.partida === partida);
  if (!cat) { notify('Elige una partida válida del catálogo', 'error'); return; }
  const subs = Array.isArray(cat.subpartidas) ? cat.subpartidas : [];
  const subOv = subs.length ? (document.getElementById('rb-subpartida')?.value || '') : '';
  if (subs.length && !subOv) { notify(`La partida "${cat.partida}" requiere sub-partida`, 'error'); return; }

  // Clasificación AL MOMENTO de aplicar (no al seleccionar): si alguien repartió
  // una de estas facturas hace 10 segundos, aquí se salta.
  const repartidas = new Set(state.costoAsignaciones.filter(a => a.factura_id).map(a => String(a.factura_id)));
  const saltos = { repartida: 0, cancelada: 0, tipo: 0, sinMonto: 0 };
  const elegibles = objetivos.filter(f => {
    if (repartidas.has(String(f.factura_id))) { saltos.repartida++; return false; }
    if (f.estatus_factura === 'cancelada' || f.estado_sat === 'Cancelada') { saltos.cancelada++; return false; }
    if ((f.tipo_comprobante || 'Factura') !== 'Factura') { saltos.tipo++; return false; }
    if (!(f.monto_total > 0)) { saltos.sinMonto++; return false; }
    return true;
  });
  const saltosTxt = Object.entries({ 'ya con reparto': saltos.repartida, canceladas: saltos.cancelada, 'no facturas (NC/otro)': saltos.tipo, 'sin monto': saltos.sinMonto })
    .filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
  if (!elegibles.length) { notify(`Nada que repartir — ${saltosTxt || 'sin elegibles'}`, 'error'); return; }
  if (elegibles.length > RB_MAX) { notify(`Máximo ${RB_MAX} facturas por tanda (hay ${elegibles.length} elegibles). Hazlo en tandas para no saturar el guardado.`, 'error'); return; }

  const totalElegible = _rbR2(elegibles.reduce((s, f) => s + (f.monto_total || 0), 0));
  if (!confirm(`¿Repartir ${elegibles.length} factura(s) por ${fmt(totalElegible)}?\n\nMétodo: ${metodo}\nPartida: ${cat.partida}${subOv ? ' / ' + subOv : ''}${saltosTxt ? `\nSe saltan: ${saltosTxt}` : ''}\n\nSolo crea asignaciones de devengado; ningún monto cambia.`)) return;

  const hoyISO = new Date().toISOString().slice(0, 10);
  const conError = [];
  let repartidasOk = 0, filasNuevas = 0;
  elegibles.forEach(f => {
    // El pool de indiviso depende de la FECHA de cada factura (casas en obra ese día).
    const pr = parseReparto(metodo, unidadesTxt, f.proyecto, parseFechaHist(f.fecha_factura));
    const asigs = (pr.errores && pr.errores.length) ? [] : (pr.asignaciones || []).filter(a => a.unidad_id);
    if (!asigs.length) { conError.push(`Fac ${f.factura_id}: ${(pr.errores && pr.errores[0]) || 'sin unidades válidas'}`); return; }
    asigs.forEach(a => {
      state.costoAsignaciones.push({
        asignacion_id: nuevoAsignacionId(),
        pago_id: '',
        factura_id: String(f.factura_id),
        unidad_id: a.unidad_id,
        proyecto: f.proyecto,
        metodo: pr.metodo,
        monto_asignado: _rbR2((f.monto_total || 0) * (a.pct / 100)),
        factor: a.pct / 100,
        fecha_asignacion: hoyISO,
        partida_override: cat.partida,
        sub_partida_override: subOv,
        partida_obra: ''
      });
      filasNuevas++;
    });
    repartidasOk++;
  });

  const partes = [`✓ ${repartidasOk} factura(s) repartida(s)`];
  if (saltosTxt) partes.push(`saltadas: ${saltosTxt}`);
  if (conError.length) partes.push(`con error: ${conError.length} (${conError[0]}${conError.length > 1 ? '…' : ''})`);
  factSel.clear();          // antes del guardado: el botón "Repartir (N)" ya no invita a repetir
  actualizarBarraSelFact();
  if (!filasNuevas) {
    cerrar('modal-reparto-bulk');
    renderFacturas();
    notify(partes.join(' · '), 'error');
    return;
  }
  await _rbGuardar(partes);   // modal abierto con progreso; cierra solo si todo subió
}

function refreshFactProyectos() {
  const sel = document.getElementById('ff-proy');
  if (!sel) return;
  const val = sel.value;
  const opts = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
  sel.innerHTML = '<option value="">Todos los proyectos</option>' + opts.map(n => `<option>${escapeHtml(n)}</option>`).join('');
  sel.value = val;
}

function estatusBadge(estatus) {
  const colors = {
    pendiente: 'rgba(200,169,110,.15);color:var(--accent)',
    parcial: 'rgba(52,152,219,.15);color:#3498db',
    pagada: 'rgba(39,174,96,.15);color:#27ae60',
    cancelada: 'rgba(231,76,60,.15);color:#e74c3c'
  };
  const style = colors[estatus] || 'rgba(200,169,110,.15);color:var(--accent)';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${style};">${estatus}</span>`;
}

// Recalcula saldo_pendiente y estatus_factura (estado de PAGO) a partir de
// monto_total y monto_pagado. Fuente ÚNICA usada por guardar/vincular/eliminar
// para que las 3 rutas no diverjan (saldo siempre clampado a 0; estatus coherente
// con lo pagado). NO toca estado_sat (fiscal, independiente) ni respeta 'cancelada'
// aquí — eso solo aplica a facturas sin pagos (ver guardarFactura).
function recalcularSaldoEstatus(fact) {
  fact.saldo_pendiente = Math.max(0, (fact.monto_total || 0) - (fact.monto_pagado || 0));
  if ((fact.monto_pagado || 0) <= 0) {
    fact.estatus_factura = 'pendiente';
    fact.fecha_pago_total = '';
  } else if (fact.saldo_pendiente <= 1) {   // tolerancia de redondeo: ≤ $1 (el banco paga en pesos cerrados) → pagada
    fact.estatus_factura = 'pagada';
    if (!fact.fecha_pago_total) fact.fecha_pago_total = new Date().toISOString().split('T')[0];
  } else {
    fact.estatus_factura = 'parcial';
    fact.fecha_pago_total = '';
  }
}

// Estado fiscal del CFDI (Vigente/Cancelada) — distinto del estatus de PAGO.
function estadoSatBadge(estado) {
  const e = estado || 'Vigente';
  const style = e === 'Cancelada'
    ? 'rgba(231,76,60,.15);color:#e74c3c'
    : 'rgba(39,174,96,.15);color:#27ae60';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${style};">${e}</span>`;
}

// ===== CRUD Facturas =====

function populateFacturaSelects() {
  const selProy = document.getElementById('f-proyecto');
  selProy.innerHTML = '<option value="">— Sin proyecto —</option>' +
    state.proyectos.filter(p => p.activo !== false).map(p => `<option>${escapeHtml(p.nombre)}</option>`).join('');
  const selEmp = document.getElementById('f-empresa');
  if (selEmp) selEmp.innerHTML = '<option value="">— Sin especificar —</option>' +
    EMPRESAS_FACTURA.map(e => `<option>${escapeHtml(e)}</option>`).join('');
}

export function filtrarProvFactura() {
  const input = document.getElementById('f-proveedor');
  const dd = document.getElementById('f-prov-dropdown');
  const q = input.value.trim().toLowerCase();
  if (!q) {
    dd.style.display = 'none';
    document.getElementById('f-proveedor-id').value = '';
    return;
  }
  const results = state.proveedores.filter(p => p.activo &&
    (/^\d+$/.test(q) ? String(p.id).includes(q) : p.nombre.toLowerCase().includes(q))
  ).slice(0, 15);
  if (!results.length) {
    dd.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--muted);">Sin resultados</div>';
    dd.style.display = 'block';
    return;
  }
  dd.innerHTML = results.map(p =>
    `<div onclick="selProvFactura(${p.id})" style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border);" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='transparent'">
      <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);margin-right:6px;">${p.id}</span>${escapeHtml(p.nombre)}
    </div>`
  ).join('');
  dd.style.display = 'block';
}

export function selProvFactura(id) {
  const p = state.proveedores.find(x => x.id === id);
  if (!p) return;
  document.getElementById('f-proveedor').value = p.nombre;
  document.getElementById('f-proveedor-id').value = id;
  document.getElementById('f-prov-dropdown').style.display = 'none';
  // Autollenar datos fiscales del emisor desde el proveedor (solo si están vacíos,
  // para no pisar lo que ya se capturó del XML).
  const rfcEl = document.getElementById('f-rfc-emisor');
  if (rfcEl && !rfcEl.value) rfcEl.value = (p.rfc || '').toUpperCase();
  const rsEl = document.getElementById('f-razon-social');
  if (rsEl && !rsEl.value) rsEl.value = p.nombre || '';
}

// Recalcula IVA sugerido y el Total a partir del desglose fiscal. IVA = (subtotal -
// descuento) * 0.16, pero NO se pisa si el usuario lo editó a mano (dataset.touched).
// El Total solo se autocalcula cuando hay subtotal (>0): así no machaca el monto de
// facturas viejas que solo tienen Total.
export function recalcularTotalFactura() {
  const num = id => { const el = document.getElementById(id); return el ? (parseFloat(el.value) || 0) : 0; };
  const round2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
  const subtotal = num('f-subtotal');
  const ivaEl = document.getElementById('f-iva');
  if (ivaEl && !ivaEl.dataset.touched) {
    ivaEl.value = round2((subtotal - num('f-descuento')) * 0.16);
  }
  // Nota de crédito: el IVA de la NC se autocalcula al 16% del monto NC (editable) y,
  // junto con el monto NC, se RESTA del total → monto_total queda como el NETO a pagar.
  const ncSub = num('f-nc-subtotal');
  const ncIvaEl = document.getElementById('f-nc-iva');
  if (ncIvaEl && !ncIvaEl.dataset.touched) {
    ncIvaEl.value = ncSub > 0 ? round2(ncSub * 0.16) : 0;
  }
  if (subtotal > 0) {
    const total = subtotal - num('f-descuento') + num('f-iva') - num('f-retiva') - num('f-retisr')
                  - num('f-nc-subtotal') - num('f-nc-iva');
    document.getElementById('f-monto').value = round2(total);
  }
}

export function abrirNuevaFactura() {
  state.editFactId = null;
  document.getElementById('modal-fact-title').textContent = 'Nueva Factura';
  document.getElementById('f-razon-social').value = '';
  document.getElementById('f-proveedor').value = '';
  document.getElementById('f-proveedor-id').value = '';
  document.getElementById('f-prov-dropdown').style.display = 'none';
  document.getElementById('f-folio').value = '';
  document.getElementById('f-uuid').value = '';
  document.getElementById('f-fecha-factura').value = '';
  document.getElementById('f-fecha-vencimiento').value = '';
  document.getElementById('f-monto').value = '';
  document.getElementById('f-estatus').value = 'pendiente';
  document.getElementById('f-proyecto').value = '';
  document.getElementById('f-obs').value = '';
  // Campos fiscales (CFDI) nuevos.
  document.getElementById('f-tipo-comprobante').value = 'Factura';
  document.getElementById('f-estado-sat').value = 'Vigente';
  document.getElementById('f-rfc-emisor').value = '';
  document.getElementById('f-subtotal').value = '';
  document.getElementById('f-descuento').value = '0';
  const ivaNew = document.getElementById('f-iva'); ivaNew.value = ''; delete ivaNew.dataset.touched;
  document.getElementById('f-retiva').value = '0';
  document.getElementById('f-retisr').value = '0';
  document.getElementById('f-nc-subtotal').value = '0';
  const ncIvaNew = document.getElementById('f-nc-iva'); ncIvaNew.value = '0'; delete ncIvaNew.dataset.touched;
  // Vincular pagos existentes solo aplica a una factura YA creada (necesita saldo).
  ocultarBuscadorPagosFactura();
  document.getElementById('fact-pagos-vinc').style.display = 'none';
  document.getElementById('fact-eliminar-btn').style.display = 'none'; // no se borra algo que no existe
  populateFacturaSelects();
  document.getElementById('modal-factura').classList.add('open');
}

export function editarFactura(id) {
  const f = state.facturas.find(x => x.factura_id === id);
  if (!f) return;
  state.editFactId = id;
  populateFacturaSelects();
  document.getElementById('modal-fact-title').textContent = 'Editar Factura #' + id;
  document.getElementById('f-razon-social').value = f.razon_social || '';
  const prov = state.proveedores.find(p => p.id === f.proveedor_id);
  document.getElementById('f-proveedor').value = prov ? prov.nombre : `ID ${f.proveedor_id}`;
  document.getElementById('f-proveedor-id').value = f.proveedor_id;
  document.getElementById('f-prov-dropdown').style.display = 'none';
  document.getElementById('f-folio').value = f.numero_factura || f.folio_factura || '';
  document.getElementById('f-uuid').value = f.uuid || '';
  document.getElementById('f-fecha-factura').value = f.fecha_factura;
  document.getElementById('f-fecha-vencimiento').value = f.fecha_vencimiento || '';
  document.getElementById('f-monto').value = f.monto_total;
  document.getElementById('f-estatus').value = f.estatus_factura;
  document.getElementById('f-proyecto').value = f.proyecto;
  document.getElementById('f-empresa').value = f.empresa || '';
  document.getElementById('f-obs').value = f.observaciones || '';
  // Campos fiscales (CFDI). El RFC cae al del proveedor si la factura no lo trae.
  document.getElementById('f-tipo-comprobante').value = f.tipo_comprobante || 'Factura';
  document.getElementById('f-estado-sat').value = f.estado_sat || 'Vigente';
  document.getElementById('f-rfc-emisor').value = (f.rfc_emisor || (prov && prov.rfc) || '').toUpperCase();
  document.getElementById('f-subtotal').value = f.subtotal || 0;
  document.getElementById('f-descuento').value = f.descuento || 0;
  const ivaEdit = document.getElementById('f-iva'); ivaEdit.value = f.iva_trasladado || 0; ivaEdit.dataset.touched = '1';
  document.getElementById('f-retiva').value = f.retencion_iva || 0;
  document.getElementById('f-retisr').value = f.retencion_isr || 0;
  document.getElementById('f-nc-subtotal').value = f.nc_subtotal || 0;
  // Marcar "touched" SOLO si la factura ya traía IVA de NC (para preservarlo). Si no traía NC,
  // dejarlo SIN touched para que al agregar una NC en edición el IVA se autollene (16%) y el total
  // baje solo — igual que en "Nueva factura". (Sin esto, editar dejaba muerto el autocálculo de NC.)
  const ncIvaEdit = document.getElementById('f-nc-iva'); ncIvaEdit.value = f.nc_iva || 0;
  if (f.nc_iva > 0) ncIvaEdit.dataset.touched = '1'; else delete ncIvaEdit.dataset.touched;
  // En edición sí se puede vincular pagos del historial a esta factura.
  document.getElementById('fact-pagos-vinc').style.display = '';
  // El botón Eliminar aparece al editar; el CSS (.req-borrar-factura) decide si el rol lo ve.
  document.getElementById('fact-eliminar-btn').style.display = '';
  ocultarBuscadorPagosFactura();
  document.getElementById('modal-factura').classList.add('open');
}

// Detalle de factura SOLO LECTURA (doble click en la fila). Para roles de solo lectura
// (p.ej. contabilidad/Ericka) que no ven el botón Editar: ver datos + pagos ligados.
export function abrirDetalleFactura(id) {
  const f = state.facturas.find(x => x.factura_id === id);
  if (!f) return;
  const prov = state.proveedores.find(p => p.id === f.proveedor_id);
  const provNombre = f.nombre_proveedor || (prov && prov.nombre) || f.razon_social || ('ID ' + f.proveedor_id);
  const ncTotal = (f.nc_subtotal || 0) + (f.nc_iva || 0);
  const fila = (k, v) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:4px 0;border-bottom:1px solid var(--border);font-size:12px;"><span style="color:var(--muted);">${k}</span><span style="text-align:right;font-weight:500;">${v}</span></div>`;
  const filaMonto = (k, v, color) => fila(k, `<span style="font-family:'DM Mono',monospace;${color ? 'color:' + color + ';' : ''}">${fmt(v)}</span>`);

  const fps = state.facturaPagos.filter(fp => String(fp.factura_id) === String(id));
  const pagosHTML = fps.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px;">
         <thead><tr style="color:var(--muted);text-align:left;border-bottom:1px solid var(--border);">
           <th style="padding:4px 6px;">Fecha</th><th style="padding:4px 6px;text-align:right;">Monto aplicado</th><th style="padding:4px 6px;">Concepto</th></tr></thead>
         <tbody>${fps.map(fp => {
           const pago = state.historial.find(p => String(p.id) === String(fp.pago_id));
           const concepto = fp.observaciones || (pago && pago.concepto) || '';
           return `<tr style="border-bottom:1px solid var(--border);">
             <td style="padding:4px 6px;font-family:'DM Mono',monospace;color:var(--muted);">${fmtFecha(fp.fecha_pago)}</td>
             <td style="padding:4px 6px;text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(fp.monto_aplicado)}</td>
             <td style="padding:4px 6px;color:var(--muted);">${escapeHtml(concepto)}</td>
           </tr>`;
         }).join('')}</tbody>
       </table>
       <div style="font-size:11px;color:var(--muted);margin-top:4px;">${fps.length} pago(s) · aplicado ${fmt(fps.reduce((s, fp) => s + (fp.monto_aplicado || 0), 0))}</div>`
    : '<div style="font-size:12px;color:var(--muted);padding:6px 0;">Sin pagos ligados a esta factura.</div>';

  document.getElementById('detalle-factura-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px;">
      <div>
        ${fila('Factura (ID)', '#' + f.factura_id)}
        ${fila('Número', escapeHtml(f.numero_factura) || '—')}
        ${fila('UUID (folio fiscal)', `<span style="font-family:'DM Mono',monospace;font-size:11px;">${escapeHtml(f.uuid) || '—'}</span>`)}
        ${fila('RFC emisor', escapeHtml(f.rfc_emisor) || '—')}
        ${fila('Proveedor', escapeHtml(provNombre))}
        ${fila('Razón social', escapeHtml(f.razon_social) || '—')}
        ${fila('Empresa facturada', escapeHtml(f.empresa) || '—')}
        ${(c => fila('Clase de costo', c ? `${escapeHtml(CLASE_LABEL[c.clase] || c.clase)}${c.cuenta_contable ? ` · <span style="font-family:'DM Mono',monospace;font-size:11px;">${escapeHtml(c.cuenta_contable)}</span>` : ''}<div style="font-size:10px;color:var(--muted);">${c.fuente === 'manual' ? 'Marcada a mano' : escapeHtml(c.lote || '')}</div>` : '<span style="color:var(--muted);">Sin clasificar</span>'))(claseDeFactura(f.factura_id))}
        ${fila('Proyecto', escapeHtml(f.proyecto) || '—')}
        ${fila('Tipo comprobante', escapeHtml(f.tipo_comprobante) || '—')}
        ${fila('Estado SAT', escapeHtml(f.estado_sat) || 'Vigente')}
        ${fila('Estatus de pago', escapeHtml(f.estatus_factura) || '—')}
      </div>
      <div>
        ${fila('Fecha factura', fmtFecha(f.fecha_factura) || '—')}
        ${fila('Vencimiento', fmtFecha(f.fecha_vencimiento) || '—')}
        ${filaMonto('Subtotal', f.subtotal || 0)}
        ${filaMonto('Descuento', f.descuento || 0)}
        ${filaMonto('IVA', f.iva_trasladado || 0)}
        ${filaMonto('Retención IVA', f.retencion_iva || 0)}
        ${filaMonto('Retención ISR', f.retencion_isr || 0)}
        ${ncTotal > 0.005 ? filaMonto('Nota de crédito', ncTotal, 'var(--red)') : ''}
        ${filaMonto('Total neto', f.monto_total || 0)}
        ${filaMonto('Pagado', f.monto_pagado || 0, 'var(--green)')}
        ${filaMonto('Saldo', f.saldo_pendiente || 0, (f.saldo_pendiente || 0) > 0 ? 'var(--accent)' : 'var(--muted)')}
      </div>
    </div>
    ${f.observaciones ? `<div style="margin-top:10px;font-size:12px;"><span style="color:var(--muted);">Observaciones:</span> ${escapeHtml(f.observaciones)}</div>` : ''}
    <div style="margin-top:14px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-top:1px solid var(--border);padding-top:8px;">Pagos ligados a esta factura</div>
    ${pagosHTML}`;
  const tit = document.getElementById('modal-detalle-fact-title');
  if (tit) tit.textContent = 'Detalle · Factura #' + f.factura_id;
  document.getElementById('modal-detalle-factura').classList.add('open');
}

export function guardarFactura() {
  const esNueva = !state.editFactId;
  const provId = parseInt(document.getElementById('f-proveedor-id').value);
  const folio = document.getElementById('f-folio').value.trim();
  const fechaFact = document.getElementById('f-fecha-factura').value;
  const monto = parseFloat(document.getElementById('f-monto').value) || 0;
  const subtotal = parseFloat(document.getElementById('f-subtotal').value) || 0;
  const uuid = document.getElementById('f-uuid').value.trim();

  if (!provId) { notify('Selecciona un proveedor', 'error'); return; }
  if (!folio) { notify('El folio es obligatorio', 'error'); return; }
  if (!uuid) { notify('El UUID (folio fiscal) es obligatorio', 'error'); return; }
  if (!fechaFact) { notify('La fecha de factura es obligatoria', 'error'); return; }
  if (subtotal <= 0) { notify('El subtotal es obligatorio', 'error'); return; }
  if (monto <= 0) { notify('El total debe ser mayor a 0', 'error'); return; }

  // Anti-duplicados: evita registrar dos veces la misma factura. Al editar se
  // compara contra las DEMÁS (se excluye la propia por factura_id). Misma lógica
  // de detección que la importación por Excel (facturas-import.js).
  const norm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const otras = state.facturas.filter(f => f.factura_id !== state.editFactId);
  // UUID idéntico = es la misma factura (folio fiscal único en el SAT) → bloquea.
  const dupUuid = otras.find(f => f.uuid && norm(f.uuid) === norm(uuid));
  if (dupUuid) { notify(`Ya existe una factura con ese UUID (folio fiscal): #${dupUuid.factura_id} · ${dupUuid.numero_factura || ''}`, 'error'); return; }
  // Señales fuertes (no idénticas) → avisa y deja continuar si el usuario confirma.
  const dupFolio = otras.find(f => String(f.proveedor_id) === String(provId) && norm(f.numero_factura) === norm(folio));
  const dupMfp = otras.find(f => String(f.proveedor_id) === String(provId)
    && (+f.monto_total || 0).toFixed(2) === monto.toFixed(2)
    && (f.fecha_factura || '') === fechaFact);
  if (dupFolio || dupMfp) {
    const motivos = [];
    if (dupFolio) motivos.push(`• Mismo folio "${folio}" y proveedor (factura #${dupFolio.factura_id}, ${dupFolio.fecha_factura})`);
    if (dupMfp && dupMfp !== dupFolio) motivos.push(`• Mismo monto, fecha y proveedor (factura #${dupMfp.factura_id})`);
    if (!confirm(`⚠️ Posible factura duplicada:\n\n${motivos.join('\n')}\n\n¿Guardar de todos modos?`)) return;
  }

  const existing = state.editFactId ? state.facturas.find(f => f.factura_id === state.editFactId) : null;
  const pagado = existing ? existing.monto_pagado : 0;

  const prov = state.proveedores.find(p => p.id === provId);
  const obj = {
    factura_id: state.editFactId || (Math.max(state.facturas.reduce((max, f) => Math.max(max, f.factura_id), 0), maxIdConClase()) + 1),
    numero_factura: folio,
    razon_social: document.getElementById('f-razon-social').value.trim(),
    proveedor_id: provId,
    nombre_proveedor: prov ? prov.nombre : '',
    fecha_factura: fechaFact,
    fecha_vencimiento: document.getElementById('f-fecha-vencimiento').value || '',
    fecha_pago_total: existing ? existing.fecha_pago_total || '' : '',
    monto_total: monto,
    monto_pagado: pagado,
    saldo_pendiente: Math.max(0, monto - pagado),
    estatus_factura: document.getElementById('f-estatus').value,
    proyecto: document.getElementById('f-proyecto').value,
    empresa: document.getElementById('f-empresa').value,
    observaciones: document.getElementById('f-obs').value.trim(),
    activo: true,
    uuid,
    // Datos fiscales del CFDI (Fase 2).
    subtotal,
    descuento: parseFloat(document.getElementById('f-descuento').value) || 0,
    iva_trasladado: parseFloat(document.getElementById('f-iva').value) || 0,
    retencion_iva: parseFloat(document.getElementById('f-retiva').value) || 0,
    retencion_isr: parseFloat(document.getElementById('f-retisr').value) || 0,
    // Nota de crédito (acumulada): resta del total → monto_total ya es el neto a pagar.
    nc_subtotal: parseFloat(document.getElementById('f-nc-subtotal').value) || 0,
    nc_iva: parseFloat(document.getElementById('f-nc-iva').value) || 0,
    rfc_emisor: document.getElementById('f-rfc-emisor').value.trim().toUpperCase(),
    estado_sat: document.getElementById('f-estado-sat').value,
    tipo_comprobante: document.getElementById('f-tipo-comprobante').value
  };

  // Si la factura YA tiene pagos, el saldo y el estatus de PAGO se DERIVAN de lo
  // pagado (no se leen del menú) para que no queden incoherentes al editar el
  // desglose. Sin pagos se respeta lo elegido en el menú (p.ej. 'cancelada').
  if (pagado > 0) recalcularSaldoEstatus(obj);

  if (state.editFactId) {
    const i = state.facturas.findIndex(f => f.factura_id === state.editFactId);
    state.facturas[i] = obj;
  } else {
    state.facturas.push(obj);
  }

  cerrar('modal-factura');
  renderFacturas();
  document.getElementById('cnt-fact').textContent = state.facturas.length;
  notify(state.editFactId ? 'Factura actualizada' : 'Factura registrada');
  // Fase 3: guarda solo esta factura (upsert por factura_id, add/edit).
  const porFila = esPorFila('facturas');
  // Editar una factura YA repartida NO recoloca su devengado: se avisa, porque el
  // reparto conserva la foto (pool de casas) de la fecha/proyecto anteriores.
  if (state.editFactId && existing) {
    const asigsPrevias = state.costoAsignaciones.filter(a => String(a.factura_id) === String(obj.factura_id));
    if (asigsPrevias.length) {
      if ((existing.proyecto || '') !== (obj.proyecto || '')) {
        notify(`⚠️ Cambiaste el PROYECTO de una factura con ${asigsPrevias.length} reparto(s): su costo sigue asignado a casas de "${existing.proyecto || 'el proyecto anterior'}". Limpia el reparto y vuelve a repartirla en Costos por Unidad.`, 'error');
      } else if ((existing.fecha_factura || '') !== (obj.fecha_factura || '')) {
        notify('⚠️ Cambiaste la FECHA de una factura ya repartida: el reparto conserva las casas que estaban en obra en la fecha anterior. Corrígelo con ♻️ Revisar repartos.', 'error');
      }
    }
  }
  gsSaveFacturas({ porFila });
  if (porFila) sbGuardarFila('facturas', obj);

  // Devengado (Fase B): si cambió el total y la factura ya estaba repartida,
  // re-escala CADA monto por la proporción nuevo/anterior. Antes hacía
  // `nuevoTotal × factor`, pero en facturas repartidas POR PARTES el factor es
  // relativo a su parte → cada parte quedaba del tamaño de la factura completa
  // (2 partes = doble). La proporción conserva partes, casas y lo repartido parcial.
  if (state.editFactId && existing && (existing.monto_total || 0) !== monto) {
    const asigs = state.costoAsignaciones.filter(a => String(a.factura_id) === String(obj.factura_id));
    const anterior = existing.monto_total || 0;
    if (asigs.length && anterior > 0) {
      const ratio = monto / anterior;
      const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
      const objetivo = r2(asigs.reduce((s, a) => s + (a.monto_asignado || 0), 0) * ratio);
      asigs.forEach(a => { a.monto_asignado = r2((a.monto_asignado || 0) * ratio); });
      // El centavo de redondeo va a la fila más grande (Σ exacta).
      const dif = r2(objetivo - asigs.reduce((s, a) => s + a.monto_asignado, 0));
      if (Math.abs(dif) >= 0.01) {
        const mayor = asigs.reduce((m, a) => (a.monto_asignado > m.monto_asignado ? a : m), asigs[0]);
        mayor.monto_asignado = r2(mayor.monto_asignado + dif);
      }
      gsSaveCostoAsignaciones();
    } else if (asigs.length) {
      notify('⚠️ La factura tenía total $0: su reparto no se puede re-escalar. Límpialo y repártela de nuevo.', 'error');
    }
  }

  // Al CREAR una factura nueva con proyecto y casas activas, abre el repartidor de
  // inmediato para asignar el costo (devengado) de corrido, sin que sea un paso aparte.
  // Si no hay proyecto/casas o está cancelada, no se abre: queda el "⚠ Repartir" para
  // después. No se bloquea: la factura ya quedó guardada pase lo que pase.
  if (esNueva && obj.proyecto && obj.estado_sat !== 'Cancelada'
      && state.unidades.some(u => u.activo !== false && u.proyecto === obj.proyecto)
      && window.abrirRepartirFactura) {
    window.abrirRepartirFactura(obj.factura_id);
  }
}

// Borrar una factura (corregir errores). Solo admin + rol 'facturas'. Limpia su
// cascada: pagos a factura (los pagos del historial se conservan, solo se
// desvinculan), su devengado (asignaciones de costo) y la propia factura.
export function eliminarFactura() {
  if (!puedeBorrarFacturas()) { notify('No tienes permiso para borrar facturas', 'error'); return; }
  const id = state.editFactId;
  const fact = state.facturas.find(f => f.factura_id === id);
  if (!fact) { notify('Abre una factura primero', 'error'); return; }

  const fps = state.facturaPagos.filter(fp => fp.factura_id === id);
  const aviso = fps.length
    ? `Esta factura tiene ${fps.length} pago(s) aplicados: se DESVINCULARÁN (los pagos del historial se conservan).\n\n`
    : '';
  // El devengado se va con la factura: que quien borra vea cuánto costo pierden
  // las casas (importa sobre todo desde que 'conciliacion' también puede borrar).
  const asigs = state.costoAsignaciones.filter(a => String(a.factura_id) === String(id));
  const avisoRep = asigs.length
    ? `Esta factura tiene reparto a ${asigs.length} casa(s) por ${fmt(asigs.reduce((s, a) => s + (a.monto_asignado || 0), 0))}: ese costo se BORRARÁ de esas casas.\n\n`
    : '';
  if (!confirm(`${aviso}${avisoRep}¿Eliminar la factura ${fact.numero_factura || ''} (#${id})? No se puede deshacer.`)) return;

  const porFilaF = esPorFila('facturas');
  const porFilaFp = esPorFila('facturaPagos');
  const porFilaH = esPorFila('historial');

  // 1) Quitar los pagos aplicados a esta factura (el pago del historial NO se borra).
  fps.forEach(fp => { if (porFilaFp) sbBorrarFila('facturaPagos', fp.factura_pago_id); });
  state.facturaPagos = state.facturaPagos.filter(fp => fp.factura_id !== id);

  // 2) Desvincular del historial los pagos que apuntaban a esta factura.
  state.historial.forEach(h => {
    if (h.factura_id && String(h.factura_id) === String(id)) {
      h.factura_id = '';
      if (porFilaH) sbGuardarFila('historial', h);
    }
  });

  // 3) Borrar el devengado (reparto a unidades) de esta factura.
  purgarAsignacionesDeFactura(id);

  // 4) Quitar la factura.
  state.facturas = state.facturas.filter(f => f.factura_id !== id);
  if (porFilaF) sbBorrarFila('facturas', id);

  // 5) Guardar (a Sheets) y refrescar.
  gsSaveFacturas({ porFila: porFilaF });
  gsSaveFacturaPagos({ porFila: porFilaFp });
  cerrar('modal-factura');
  state.editFactId = null;
  renderFacturas();
  renderFacturaPagos();
  document.getElementById('cnt-fact').textContent = state.facturas.length;
  document.getElementById('cnt-fp').textContent = state.facturaPagos.length;
  if (window.renderHistorial) window.renderHistorial();
  notify('Factura eliminada');
}

// ===== Factura Pagos (solo lectura) =====

export function renderFacturaPagos() {
  const tb = document.getElementById('tbody-fp');
  if (!tb) return;

  if (!datosListos()) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔒</div><div>Conecta Google Sheets para ver esta información</div></div></td></tr>';
    const sub = document.getElementById('fp-subtitulo'); if (sub) sub.textContent = '';
    const cnt = document.getElementById('cnt-fp'); if (cnt) cnt.textContent = '0';
    return;
  }

  if (!state.facturaPagos.length) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">💳</div><div>Sin pagos a facturas registrados</div></div></td></tr>';
    document.getElementById('fp-subtitulo').textContent = '';
    return;
  }

  const q = (document.getElementById('buscar-fp')?.value || '').toLowerCase();
  const ffId = document.getElementById('fp-factura-id')?.value || '';
  const fd = document.getElementById('fp-desde')?.value || '';
  const fh = document.getElementById('fp-hasta')?.value || '';
  const fil = state.facturaPagos.filter(fp => {
    if (q) {
      if (/^\d+$/.test(q)) {
        if (String(fp.factura_pago_id) !== q && String(fp.factura_id) !== q && String(fp.proveedor_id) !== q) return false;
      } else {
        const prov = state.proveedores.find(p => p.id === fp.proveedor_id);
        if (!prov || !prov.nombre.toLowerCase().includes(q)) return false;
      }
    }
    if (ffId && String(fp.factura_id) !== ffId) return false;
    if (fd && fp.fecha_pago < fd) return false;
    if (fh && fp.fecha_pago > fh) return false;
    return true;
  });

  const sub = document.getElementById('fp-subtitulo');
  sub.textContent = fil.length !== state.facturaPagos.length
    ? `${fil.length} de ${state.facturaPagos.length} registros`
    : `${state.facturaPagos.length} registros`;

  if (!fil.length) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🔍</div><div>Sin resultados</div></div></td></tr>';
    return;
  }

  tb.innerHTML = fil.map(fp => {
    const prov = state.proveedores.find(p => p.id === fp.proveedor_id);
    const provNombre = prov ? prov.nombre : `ID ${fp.proveedor_id}`;
    const estBadge = estatusBadge(fp.estatus);
    const fact = state.facturas.find(f => f.factura_id === fp.factura_id);
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${String(fp.factura_pago_id).slice(0, 8)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;">${fp.factura_id}</td>
      <td><div style="font-weight:500;font-size:12px;">${escapeHtml(provNombre)}</div></td>
      <td style="font-family:'DM Mono',monospace;font-weight:500;text-align:right;color:var(--accent);">${fmt(fp.monto_aplicado)}</td>
      <td style="font-family:'DM Mono',monospace;text-align:right;color:${fact && fact.saldo_pendiente > 0 ? 'var(--accent)' : 'var(--muted)'};">${fact ? fmt(fact.saldo_pendiente) : '—'}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(fp.fecha_pago)}</td>
      <td>${estBadge}</td>
      <td style="font-size:11px;color:var(--muted);">${escapeHtml((fp.observaciones || '').substring(0, 40))}</td>
      <td style="text-align:right;"><button class="btn btn-ghost req-ligar-pagos" style="padding:4px 6px;font-size:11px;color:#e74c3c;" onclick="eliminarPagoFactura('${fp.factura_pago_id}')">✕</button></td>
    </tr>`;
  }).join('');
}

// Restante de un pago = su importe menos lo YA aplicado a facturas (suma de sus facturaPagos).
// Con esto un mismo pago se puede repartir POR PARTES entre varias facturas sin pasarse.
export function restantePago(pago) {
  if (!pago) return 0;
  const aplicado = state.facturaPagos
    .filter(fp => String(fp.pago_id) === String(pago.id))
    .reduce((s, fp) => s + (fp.monto_aplicado || 0), 0);
  return Math.round(((pago.importe || 0) - aplicado) * 100) / 100;
}

export function eliminarPagoFactura(fpId) {
  if (!puedeLigarPagos()) { notify('Tu perfil no puede desligar pagos de facturas', 'error'); return; }
  const fp = state.facturaPagos.find(x => String(x.factura_pago_id) === String(fpId));
  if (!fp) return;
  if (!confirm(`¿Eliminar pago de ${fmt(fp.monto_aplicado)} a factura ${fp.factura_id}?`)) return;

  const fact = state.facturas.find(f => f.factura_id === fp.factura_id);
  if (fact) {
    fact.monto_pagado = Math.max(0, (fact.monto_pagado || 0) - fp.monto_aplicado);
    recalcularSaldoEstatus(fact);
  }

  state.facturaPagos = state.facturaPagos.filter(x => String(x.factura_pago_id) !== String(fpId));

  // Desligar el pago del historial SOLO si ya no le queda NINGUNA otra factura aplicada
  // (con multi-factura un pago puede seguir cubriendo otras). Si le quedan, deja el
  // marcador (factura_id) apuntando a una de ellas para que su costo siga suprimiéndose.
  const porFilaH = esPorFila('historial');
  let pagoDesligado = null;
  if (fp.pago_id) {
    pagoDesligado = state.historial.find(p => String(p.id) === String(fp.pago_id));
    if (pagoDesligado) {
      const otras = state.facturaPagos.filter(x => String(x.pago_id) === String(fp.pago_id));
      pagoDesligado.factura_id = otras.length ? String(otras[0].factura_id) : '';
      if (porFilaH) sbGuardarFila('historial', pagoDesligado);
    }
  }
  // Fase 3: la factura padre se re-guarda por fila (saldo recalculado) y el pago
  // borrado se quita por fila.
  const porFilaF = esPorFila('facturas');
  const porFilaFp = esPorFila('facturaPagos');
  gsSaveFacturas({ porFila: porFilaF });
  gsSaveFacturaPagos({ porFila: porFilaFp });
  if (porFilaF && fact) sbGuardarFila('facturas', fact);
  if (porFilaFp) sbBorrarFila('facturaPagos', fpId);
  renderFacturas();
  renderFacturaPagos();
  if (pagoDesligado) {
    if (window.renderHistorial) window.renderHistorial();
    if (window.renderCostosFiscales) window.renderCostosFiscales();
  }
  document.getElementById('cnt-fact').textContent = state.facturas.length;
  document.getElementById('cnt-fp').textContent = state.facturaPagos.length;
  notify('Pago a factura eliminado');
}

// ===== Vincular un pago YA existente del historial → factura (Fase 1) =====
// Reutiliza la lógica del auto-enlace de confirmar-pagos.js (al confirmar un pago
// con factura_id): crea el facturaPago, actualiza saldo/estatus de la factura y
// marca factura_id en el pago. NO toca costoAsignaciones: en Fase 1 el reparto de
// costo sigue viviendo en el pago; la factura todavía no es fuente de costo (eso
// es Fase 2), así que no hay doble conteo.

function ocultarBuscadorPagosFactura() {
  const panel = document.getElementById('fact-pagos-vinc-panel');
  if (panel) panel.style.display = 'none';
}

export function abrirBuscadorPagosFactura() {
  if (!puedeLigarPagos()) { notify('Tu perfil no puede ligar pagos a facturas', 'error'); return; }
  const panel = document.getElementById('fact-pagos-vinc-panel');
  if (panel) panel.style.display = '';
  const inp = document.getElementById('fact-pagos-buscar');
  if (inp) inp.value = '';
  _fpVerTodosProv = false; // cada apertura del panel regresa al corte de 25
  filtrarPagosParaFactura();
}

// "Del mismo proveedor" se corta en 25; este flag lo expande a TODOS. Sobrevive al
// tecleo del buscador y al re-render tras vincular (misma factura); se resetea al
// reabrir el panel. Solo vista: no cambia candidatos ni montos.
let _fpVerTodosProv = false;
export function fpMostrarTodosProv() { _fpVerTodosProv = true; filtrarPagosParaFactura(); }

export function filtrarPagosParaFactura() {
  const cont = document.getElementById('fact-pagos-result');
  if (!cont) return;
  const f = state.facturas.find(x => x.factura_id === state.editFactId);
  if (!f) { cont.innerHTML = ''; return; }
  const q = (document.getElementById('fact-pagos-buscar')?.value || '').toLowerCase().trim();

  // Match inteligente: ordena por cercanía de MONTO (luego FECHA) y separa "mismo proveedor"
  // de "otros con el mismo monto" (estos surgen aunque el pago tenga el proveedor mal puesto).
  const _toDays = iso => { const t = new Date((iso || '') + 'T00:00:00').getTime(); return isNaN(t) ? null : t / 86400000; };
  const fRefDays = _toDays(parseFechaHist(f.fecha_vencimiento) || parseFechaHist(f.fecha_factura) || '');
  const tol = Math.max(1, (f.monto_total || 0) * 0.01);
  const targets = [f.monto_total || 0];
  if ((f.saldo_pendiente || 0) > 0.01) targets.push(f.saldo_pendiente);
  // El monto se busca también con comas o $: "44,642" o "$44,642.06" encuentran 44642.06.
  const qNum = q.replace(/[$,\s]/g, '');
  const matchQ = h => !q ||
    (h.concepto || '').toLowerCase().includes(q) || (h.nombre || '').toLowerCase().includes(q) ||
    String(h.importe).includes(q) || (/^[\d.]+$/.test(qNum) && String(h.importe).includes(qNum)) ||
    (h.fecha || '').includes(q);

  // Candidatos: pagos con RESTANTE por aplicar (importe − lo ya aplicado a facturas) y que NO
  // estén ya aplicados a ESTA factura. Así un pago se reparte por partes entre varias facturas.
  const base = state.historial
    .filter(h => h.id && restantePago(h) > 0.01 && matchQ(h)
      && !state.facturaPagos.some(fp => String(fp.pago_id) === String(h.id) && String(fp.factura_id) === String(f.factura_id)))
    .map(h => {
      const rest = restantePago(h);
      const montoDiff = Math.min(...targets.map(t => Math.abs(rest - t)));
      const pDays = _toDays(parseFechaHist(h.fecha) || '');
      const fechaDiff = (fRefDays != null && pDays != null) ? Math.abs(pDays - fRefDays) : 99999;
      return { h, rest, montoDiff, fechaDiff,
        mismoProv: parseInt(h.proveedor_id) === f.proveedor_id,
        mismoProy: !f.proyecto || !h.proyecto || proyectoMatch(h.proyecto, f.proyecto),
        exacto: montoDiff < 0.01, cercano: montoDiff <= tol };
    });
  const ordenar = arr => arr.sort((a, b) => (a.montoDiff - b.montoDiff) || (a.fechaDiff - b.fechaDiff));
  // Del mismo proyecto (o sin proyecto definido): el flujo normal, separando mismo/otro proveedor.
  const mismoProvTodos = ordenar(base.filter(x => x.mismoProy && x.mismoProv));
  const mismoProv = _fpVerTodosProv ? mismoProvTodos : mismoProvTodos.slice(0, 25);
  const provOcultos = mismoProvTodos.length - mismoProv.length;
  // Con texto en el buscador, también los de OTRO proveedor que coincidan aunque el monto no se
  // parezca (p. ej. un pago parcial registrado a otro proveedor con el mismo nombre).
  const otros = ordenar(base.filter(x => x.mismoProy && !x.mismoProv && (x.cercano || q))).slice(0, q ? 25 : 10);
  // De OTRO proyecto: NO se esconden — van hasta ABAJO con aviso (para no errar al vincular y
  // para cachar pagos mal clasificados a otro proyecto). Prioriza los del mismo proveedor (señal
  // más fuerte de que ese pago debería ser de la factura pero quedó con el proyecto mal puesto).
  const otroProy = base.filter(x => !x.mismoProy && (x.mismoProv || x.cercano || q))
    .sort((a, b) => (b.mismoProv - a.mismoProv) || (a.montoDiff - b.montoDiff) || (a.fechaDiff - b.fechaDiff))
    .slice(0, 12);

  if (!mismoProv.length && !otros.length && !otroProy.length) {
    cont.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--muted);">Sin pagos con saldo por aplicar que coincidan</div>';
    return;
  }

  const saldoF = Math.max(0, (f.monto_total || 0) - (f.monto_pagado || 0));
  const fila = x => {
    const h = x.h;
    const badge = x.exacto ? '<span style="font-size:9px;font-weight:700;color:var(--green);background:rgba(39,174,96,.12);padding:1px 6px;border-radius:4px;">✓ mismo monto</span>'
      : x.cercano ? '<span style="font-size:9px;color:var(--accent);background:rgba(200,169,110,.14);padding:1px 6px;border-radius:4px;">monto similar</span>' : '';
    const fechaB = x.fechaDiff <= 10 ? ' <span style="font-size:9px;color:var(--muted);">· fecha cercana</span>' : '';
    const proyBadge = !x.mismoProy ? ' <span style="font-size:9px;font-weight:700;color:var(--orange);background:rgba(224,122,58,.15);padding:1px 6px;border-radius:4px;">⚠ otro proyecto</span>' : '';
    const proyTxt = h.proyecto ? ` · <span style="${!x.mismoProy ? 'color:var(--orange);font-weight:600;' : ''}">${escapeHtml(h.proyecto)}</span>` : '';
    const defMonto = Math.round(Math.min(saldoF, x.rest) * 100) / 100;
    const inpId = 'fp-aplicar-' + h.id;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border);${!x.mismoProy ? 'border-left:3px solid var(--orange);' : ''}">
      <div style="min-width:0;">
        <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(h.concepto || h.nombre || '—')} ${badge}${proyBadge}${fechaB}</div>
        <div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;">${fmtFecha(h.fecha)} · ${fmt(h.importe)}${proyTxt} · restante ${fmt(x.rest)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        <span style="font-size:10px;color:var(--muted);">Aplicar $</span>
        <input type="number" step="0.01" min="0" max="${defMonto}" id="${inpId}" value="${defMonto}" style="width:88px;text-align:right;font-family:'DM Mono',monospace;font-size:11px;padding:3px 6px;">
        <button class="btn btn-ghost req-ligar-pagos" style="padding:4px 10px;font-size:11px;" onclick="vincularPagoAFactura('${h.id}', document.getElementById('${inpId}').value)">Vincular</button>
      </div>
    </div>`;
  };
  const header = txt => `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:6px 10px;background:var(--surface2);border-bottom:1px solid var(--border);">${txt}</div>`;
  const headerWarn = txt => `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--orange);font-weight:700;padding:6px 10px;background:rgba(224,122,58,.10);border-top:1px solid rgba(224,122,58,.35);border-bottom:1px solid var(--border);">${txt}</div>`;
  let html = '';
  if (mismoProv.length) {
    html += header('Del mismo proveedor (más probables arriba)') + mismoProv.map(fila).join('');
    if (provOcultos > 0) html += `<div style="padding:6px 10px;border-bottom:1px solid var(--border);">
      <button class="btn btn-ghost" style="width:100%;padding:6px;font-size:11px;color:var(--muted);" onclick="fpMostrarTodosProv()">▾ Mostrar los ${provOcultos} pagos restantes de este proveedor</button>
    </div>`;
  }
  if (otros.length) html += header(q ? 'Otros proveedores que coinciden con tu búsqueda' : 'Otros con el mismo monto (otro proveedor)') + otros.map(fila).join('');
  if (otroProy.length) html += headerWarn('⚠ De OTRO proyecto — revisa si algún pago quedó mal clasificado') + otroProy.map(fila).join('');
  cont.innerHTML = html;
}

// CORE reutilizable (headless): aplica un pago a UNA factura recibida POR
// PARÁMETRO — mismas validaciones y efectos de siempre. No depende del modal de
// facturas; lo usa también el botón "📎 Factura" de Costos por Unidad. Devuelve
// { ok, factura } para que el llamador encadene (p.ej. ofrecer repartir).
export function aplicarPagoAFactura(pagoId, facturaId, montoAplicado) {
  if (!puedeLigarPagos()) { notify('Tu perfil no puede ligar pagos a facturas', 'error'); return { ok: false }; }
  const fact = state.facturas.find(x => String(x.factura_id) === String(facturaId));
  if (!fact) { notify('No se encontró la factura', 'error'); return { ok: false }; }
  if (fact.estatus_factura === 'cancelada') {
    notify('La factura está cancelada', 'error'); return { ok: false };
  }
  // Se permite ligar aunque el estatus diga "pagada" (p.ej. facturas viejas capturadas como
  // pagadas): lo que importa es que quede SALDO REAL por aplicar (total − pagado), no la etiqueta.
  // Al ligar el pago, recalcularSaldoEstatus deja el estatus consistente.
  const saldoReal = Math.round(((fact.monto_total || 0) - (fact.monto_pagado || 0)) * 100) / 100;
  if (saldoReal <= 0.01) {
    notify('La factura ya no tiene saldo por aplicar', 'error'); return { ok: false };
  }
  ensureHistorialIds(); // asegura pago.id estable para guardar la fila
  const pago = state.historial.find(h => String(h.id) === String(pagoId));
  if (!pago) { notify('No se encontró el pago', 'error'); return { ok: false }; }
  // Un pago se puede aplicar POR PARTES a VARIAS facturas. Solo se evita aplicar el MISMO
  // pago a la MISMA factura dos veces (duplicaría el monto_pagado). Para corregir un monto,
  // borra la línea en "Pagos a Facturas" y vuelve a aplicar.
  if (state.facturaPagos.some(fp => String(fp.pago_id) === String(pago.id) && String(fp.factura_id) === String(fact.factura_id))) {
    notify('Ese pago ya está aplicado a esta factura', 'error'); return { ok: false };
  }
  const restante = restantePago(pago);
  if (restante <= 0.01) { notify('Ese pago ya está aplicado por completo a otras facturas', 'error'); return { ok: false }; }
  if (parseInt(pago.proveedor_id) !== fact.proveedor_id) {
    if (!confirm('El proveedor del pago no coincide con el de la factura. ¿Vincular de todos modos?')) return { ok: false };
  }
  // Monto a aplicar EN ESTA factura: lo que pida el usuario, topado al saldo de la factura y
  // al restante del pago → imposible sobrepagar la factura ni pasar del importe del pago.
  const tope = Math.round(Math.min(saldoReal, restante) * 100) / 100;
  let monto = parseFloat(montoAplicado);
  if (!isFinite(monto) || monto <= 0) monto = tope;
  monto = Math.round(Math.min(monto, tope) * 100) / 100;
  if (monto <= 0) { notify('No hay saldo por aplicar en esta factura', 'error'); return { ok: false }; }

  const fpId = nuevoFacturaPagoId();
  const nuevoFp = {
    factura_pago_id: fpId,
    factura_id: fact.factura_id,
    pago_id: pago.id || 0,
    proveedor_id: parseInt(pago.proveedor_id) || 0,
    monto_aplicado: monto,
    fecha_pago: pago.fecha || hoyFecha(),
    estatus: 'aplicado',
    observaciones: pago.concepto || ''
  };
  state.facturaPagos.push(nuevoFp);

  fact.monto_pagado = (fact.monto_pagado || 0) + monto;
  recalcularSaldoEstatus(fact);

  // Marca en el pago que ya está aplicado a (al menos) una factura. Es la bandera para la
  // supresión de costo; con varias facturas apunta a la primera (el detalle vive en facturaPagos).
  if (!(pago.factura_id && String(pago.factura_id) !== '')) pago.factura_id = String(fact.factura_id);

  // Guardado por fila (Fase 3).
  const pfF = esPorFila('facturas');
  const pfFp = esPorFila('facturaPagos');
  const pfH = esPorFila('historial');
  gsSaveFacturas({ porFila: pfF });
  gsSaveFacturaPagos({ porFila: pfFp });
  if (pfF) sbGuardarFila('facturas', fact);
  if (pfFp) sbGuardarFila('facturaPagos', nuevoFp);
  if (pfH) sbGuardarFila('historial', pago);

  renderFacturas();
  renderFacturaPagos();
  filtrarPagosParaFactura();              // desaparece de ESTA factura; sigue en otras si le queda restante
  const sel = document.getElementById('f-estatus');
  if (sel) sel.value = fact.estatus_factura; // refleja el estatus nuevo en el modal abierto
  const cntFp = document.getElementById('cnt-fp');
  if (cntFp) cntFp.textContent = state.facturaPagos.length;
  if (window.renderHistorial) window.renderHistorial();
  const rest2 = restantePago(pago);
  notify(rest2 > 0.01
    ? `Aplicado ${fmt(monto)} a la factura · restante del pago ${fmt(rest2)}`
    : `Aplicado ${fmt(monto)} · pago aplicado por completo`);
  return { ok: true, factura: fact };
}

// Wrapper del modal de facturas: usa la factura abierta en el editor (como siempre).
export function vincularPagoAFactura(pagoId, montoAplicado) {
  if (!state.editFactId) { notify('Abre una factura primero', 'error'); return; }
  aplicarPagoAFactura(pagoId, state.editFactId, montoAplicado);
}

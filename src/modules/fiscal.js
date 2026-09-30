// ===== 🧾 FISCAL — página propia (admin + contabilidad) =====
// Fase 1 del módulo Fiscal. Pestañas: Deducibilidad (la vista fiscal que vivía
// dentro de Costos por Unidad, MUDADA sin reescribir — mismos motores, mismos
// números al centavo) y próximamente Estimados RMF 3.2.4.
// Contabilidad (Ericka) SOLO consulta y exporta: los botones de marcar llevan
// .req-admin (CSS) y los handlers conservan su backstop esAdmin(). La RLS de
// fiscal_marcas abre el select a contabilidad con el SQL 44.

import { state, datosListos, esAdmin, puedeFiscal, nuevoMarcaFiscalId } from '../state.js';
import { fmt, fmtFecha, escapeHtml } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { sbGuardarFila, sbBorrarFila } from '../services/google-sync.js';
import {
  unidadesDeProyecto, pagoById, facturaById,
  _facturasRepartidasSet, _facturasCanceladasSet, _pagosCubiertosPorFacturaSet,
  _factExistSet, _pagoExistSet, _pagosCapitalSet, _tipoAsignacion,
  costosPresupuestosBatch, costoFacturadoPorUnidad, estimadoFacturadoPorUnidad,
  empresaDeProyectoNorm, facturaEmpresaCruzada, pagosSinFacturaSinRepartir, simularIndivisoDocs, repartidoPorFactura
} from './costos-fiscales.js';
import { parseFechaHist } from './historial.js';
import { estimados324 } from './rmf-324.js';
import { subPartidaObligatoria } from '../config/sub-partidas.js';

let fisProyecto = '';           // proyecto activo de la página
let fisTab = 'deducibilidad';   // pestaña activa

// ---------- shell de la página ----------
export function renderFiscal() {
  const panel = document.getElementById('fiscal-panel');
  if (!panel) return;
  const proy = document.getElementById('fiscal-proy-tabs');
  const tabs = document.getElementById('fiscal-tabs');

  // Backstop de rol (además del CSS .req-fiscal en el nav y de la RLS en la base).
  if (!puedeFiscal()) {
    if (proy) proy.innerHTML = '';
    if (tabs) tabs.innerHTML = '';
    panel.innerHTML = '<div class="empty-state"><div style="font-size:28px;opacity:.4;margin-bottom:8px;">🔒</div><div>Sección disponible solo para el administrador y contabilidad.</div></div>';
    return;
  }
  if (!datosListos()) {
    if (proy) proy.innerHTML = '';
    if (tabs) tabs.innerHTML = '';
    panel.innerHTML = '<div class="empty-state"><div style="font-size:28px;opacity:.4;margin-bottom:8px;">⏳</div><div>Esperando datos… entra de nuevo cuando cargue la app.</div></div>';
    return;
  }

  const activos = state.proyectos.filter(p => p.activo !== false);
  if (!fisProyecto || !activos.find(p => p.nombre === fisProyecto)) {
    fisProyecto = activos.length ? activos[0].nombre : '';
  }
  renderFisProyTabs(activos);
  renderFisTabs();
  renderFisPanel();
}

function renderFisProyTabs(activos) {
  const cont = document.getElementById('fiscal-proy-tabs');
  if (!cont) return;
  cont.innerHTML = activos.map(p => {
    const act = p.nombre === fisProyecto;
    return `<button class="re-tab${act ? ' active' : ''}" data-proy="${escapeHtml(p.nombre)}"
      style="${act ? `border-color:${p.color || 'var(--accent)'};color:${p.color || 'var(--accent)'};` : ''}">${escapeHtml(p.nombre)}</button>`;
  }).join('') || '<div style="color:var(--muted);font-size:12px;">Sin proyectos activos</div>';
  cont.querySelectorAll('.re-tab').forEach(b => {
    b.addEventListener('click', () => { fisProyecto = b.dataset.proy; renderFiscal(); });
  });
}

function renderFisTabs() {
  const cont = document.getElementById('fiscal-tabs');
  if (!cont) return;
  const tabs = [
    { id: 'deducibilidad', label: '✅ Deducibilidad' },
    { id: 'porcasa', label: '🏠 Por casa (facturado)' },
    { id: 'sincfdi', label: '🧮 Sin CFDI' },
    { id: 'estimados', label: '📅 Estimados 3.2.4' },
  ];
  cont.innerHTML = tabs.map(t =>
    `<button class="cf-subtab${fisTab === t.id ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
  ).join('');
  cont.querySelectorAll('.cf-subtab').forEach(b => {
    b.addEventListener('click', () => {
      fisTab = b.dataset.tab;
      cont.querySelectorAll('.cf-subtab').forEach(x => x.classList.toggle('active', x.dataset.tab === fisTab));
      renderFisPanel();
    });
  });
}

function renderFisPanel() {
  const panel = document.getElementById('fiscal-panel');
  if (!panel) return;
  if (fisTab === 'deducibilidad') renderFiscalTab(panel);
  else if (fisTab === 'porcasa') renderPorCasaTab(panel);
  else if (fisTab === 'sincfdi') renderSinCfdiTab(panel);
  else if (fisTab === 'estimados') renderEstimadosTab(panel);
}

// ===== 🧮 SIN CFDI =====
// Pagos que son costo pero NO tienen factura (nómina, IMSS, gastos sueltos…),
// AGRUPADOS POR PARTIDA para decidir viéndolos en conjunto qué es deducible.
// Solo vista (decisión del dueño 2026-09-30: "primero solo quiero ver"); la
// aprobación sigue siendo pago por pago con el ✅ de siempre (fiscal_marcas).
// Dos universos, porque importan distinto:
//   · REPARTIDOS a casas → ya están en el costo por casa; su aprobación decide
//     si entran al costo FISCAL (fiscalBatch.pagosCand).
//   · SIN REPARTIR → todavía no le pesan a ninguna casa; se muestran para que
//     el hueco sea visible (pagosSinFacturaSinRepartir, misma fuente que el
//     estimado de Costos por Unidad).
let fisSinCfdiAbiertas = new Set();

export function fisSinCfdiToggle(kEnc) {
  const k = decodeURIComponent(kEnc);
  if (fisSinCfdiAbiertas.has(k)) fisSinCfdiAbiertas.delete(k); else fisSinCfdiAbiertas.add(k);
  renderFisPanel();
}

function _gruposSinCfdi(proyecto) {
  const b = fiscalBatch(proyecto);
  const grupos = new Map();
  const g = k => {
    let x = grupos.get(k);
    if (!x) { x = { partida: k, n: 0, repartido: 0, aprob: 0, pend: 0, nSR: 0, sinRep: 0, pagos: [] }; grupos.set(k, x); }
    return x;
  };
  b.pagosCand.forEach((reg, pid) => {
    const h = reg.h;
    const x = g(((h && h.partida) || '').trim() || 'Sin partida');
    x.n++; x.repartido += reg.monto;
    if (reg.aprobado) x.aprob += reg.monto; else x.pend += reg.monto;
    x.pagos.push({ pid, h, monto: reg.monto, aprobado: reg.aprobado, repartido: true });
  });
  const { aprobados } = _marcasFiscales();
  pagosSinFacturaSinRepartir(proyecto).forEach(h => {
    const x = g((h.partida || '').trim() || 'Sin partida');
    x.nSR++; x.sinRep += h.importe || 0;
    x.pagos.push({ pid: String(h.id), h, monto: h.importe || 0, aprobado: aprobados.has(String(h.id)), repartido: false });
  });
  const lista = [...grupos.values()].sort((a, z) => (z.repartido + z.sinRep) - (a.repartido + a.sinRep));
  lista.forEach(x => x.pagos.sort((a, z) => z.monto - a.monto));
  return { b, lista };
}

function renderSinCfdiTab(panel) {
  const sinTabla = state.cargado && state.cargado.fiscalMarcas !== true;
  const { b, lista } = _gruposSinCfdi(fisProyecto);
  const facturado = b.totFis - b.totPagosAprob;
  const tSinRep = lista.reduce((s, x) => s + x.sinRep, 0);
  const nSinRep = lista.reduce((s, x) => s + x.nSR, 0);
  const aprobSR = lista.reduce((s, x) => s + x.pagos.filter(p => !p.repartido && p.aprobado).reduce((t, p) => t + p.monto, 0), 0);
  const mono = "font-family:'DM Mono',monospace;";

  panel.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px;">
      <div class="stat-card"><div class="stat-label">Facturado (fiscal)</div><div class="stat-value">${fmt(facturado)}</div><div class="stat-sub">facturas repartidas elegibles</div></div>
      <div class="stat-card"><div class="stat-label">✅ Sin CFDI aprobado</div><div class="stat-value" style="color:var(--green);">${fmt(b.totPagosAprob)}</div><div class="stat-sub">pagos marcados deducibles</div></div>
      <div class="stat-card"><div class="stat-label">Pendiente de decidir</div><div class="stat-value" style="color:var(--orange);">${fmt(b.totPagosNoAprob)}</div><div class="stat-sub">sin CFDI, repartido, sin aprobar</div></div>
      <div class="stat-card" title="Facturado + Sin CFDI aprobado. Es el costo fiscal que hoy se sostiene, a nivel casa."><div class="stat-label">Costo fiscal conciliado</div><div class="stat-value" style="color:var(--accent);">${fmt(b.totFis)}</div><div class="stat-sub">facturado + aprobado</div></div>
    </div>
    ${tSinRep > 0 ? `<div style="font-size:12px;color:var(--muted);margin-bottom:14px;">Además hay <strong style="color:var(--orange);">${fmt(tSinRep)}</strong> en ${nSinRep} pago(s) sin CFDI <strong>todavía sin repartir</strong> a casas: no le pesan a ninguna casa hasta que se repartan.${aprobSR > 0 ? ` De ellos, <strong style="color:var(--green);">${fmt(aprobSR)}</strong> ya están aprobados: entran al proyectado de 🏠 Por casa por indiviso.` : ''}</div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
      <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;">Pagos sin CFDI por partida</div>
      <button class="btn btn-ghost btn-sm" onclick="exportarSinCfdiExcel()" title="Excel: resumen por partida + detalle de cada pago">⬇ Excel</button>
    </div>
    ${lista.length ? `<div class="table-wrap">
      <table>
        <thead><tr><th>Partida</th><th style="text-align:right">Pagos</th><th style="text-align:right">Repartido a casas</th><th style="text-align:right">✅ Aprobado</th><th style="text-align:right">Pendiente de decidir</th><th style="text-align:right">Sin repartir aún</th></tr></thead>
        <tbody>${lista.map(x => {
          const abierta = fisSinCfdiAbiertas.has(x.partida);
          const kEnc = encodeURIComponent(x.partida).replace(/'/g, '%27');
          const fila = `<tr style="cursor:pointer;" onclick="fisSinCfdiToggle('${kEnc}')" title="Click para ${abierta ? 'cerrar' : 'ver los pagos'}">
            <td style="font-weight:600;">${abierta ? '▾' : '▸'} ${escapeHtml(x.partida)}</td>
            <td style="text-align:right;${mono}color:var(--muted);">${x.n + x.nSR}</td>
            <td style="text-align:right;${mono}">${fmt(x.repartido)}</td>
            <td style="text-align:right;${mono}color:var(--green);">${x.aprob ? fmt(x.aprob) : '—'}</td>
            <td style="text-align:right;${mono}color:var(--orange);">${x.pend ? fmt(x.pend) : '—'}</td>
            <td style="text-align:right;${mono}color:var(--muted);">${x.nSR ? `${fmt(x.sinRep)} <span style="font-size:10px;">(${x.nSR})</span>` : '—'}</td>
          </tr>`;
          if (!abierta) return fila;
          return fila + `<tr><td colspan="6" style="padding:0 0 10px 18px;background:color-mix(in srgb, var(--accent) 4%, transparent);">
            <table style="width:100%;font-size:11px;">
              <thead><tr><th>Fecha</th><th>Beneficiario</th><th>Concepto</th><th>Sub-partida</th><th style="text-align:right">Monto</th><th>Estado</th><th class="req-admin"></th></tr></thead>
              <tbody>${x.pagos.map(p => {
                const h = p.h || {};
                const estado = !p.repartido
                  ? (p.aprobado ? '<span style="color:var(--green);" title="Aprobado: entra al proyectado de 🏠 Por casa por indiviso hasta que se reparta">✅ aprobado · sin repartir</span>' : '<span style="color:var(--muted);">sin repartir</span>')
                  : p.aprobado ? '<span style="color:var(--green);">✅ aprobado</span>'
                  : '<span style="color:var(--orange);">pendiente</span>';
                const btn = sinTabla ? '' : (p.aprobado
                  ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();fiscalMarcarPago('${escapeHtml(p.pid)}', false)">↩️ Quitar</button>`
                  : `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();fiscalMarcarPago('${escapeHtml(p.pid)}', true)">✅ Aprobar</button>`);
                return `<tr>
                  <td style="${mono}white-space:nowrap;">${escapeHtml(h.fecha || '')}</td>
                  <td>${escapeHtml(h.nombre || '')}</td>
                  <td style="color:var(--muted);">${escapeHtml(h.concepto || '')}</td>
                  <td style="color:var(--muted);">${escapeHtml(h.sub_partida || '')}</td>
                  <td style="text-align:right;${mono}">${fmt(p.monto)}</td>
                  <td>${estado}</td>
                  <td class="req-admin" style="text-align:right;">${btn}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '<div style="color:var(--muted);font-size:12px;">No hay pagos sin CFDI en este proyecto.</div>'}`;
}

export function exportarSinCfdiExcel() {
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const { b, lista } = _gruposSinCfdi(fisProyecto);
  if (!lista.length) { notify('No hay pagos sin CFDI en este proyecto', 'error'); return; }
  const sello = _sello();
  const money = (ws, r0, cols, rows) => {
    for (let r = r0; r < rows; r++) cols.forEach(c => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00';
    });
  };
  const aoa1 = [
    [`FISCAL — Pagos sin CFDI por partida — ${fisProyecto}`],
    [`Generado: ${sello.txt} · Facturado ${fmt(b.totFis - b.totPagosAprob)} + Sin CFDI aprobado ${fmt(b.totPagosAprob)} = Costo fiscal conciliado ${fmt(b.totFis)} · Pendiente de decidir ${fmt(b.totPagosNoAprob)}`],
    [], ['Partida', 'Pagos', 'Repartido a casas', 'Aprobado', 'Pendiente de decidir', 'Sin repartir aún', 'Pagos sin repartir']];
  lista.forEach(x => aoa1.push([x.partida, x.n + x.nSR, x.repartido, x.aprob, x.pend, x.sinRep, x.nSR]));
  const ws1 = XLSX.utils.aoa_to_sheet(aoa1);
  ws1['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 10 }];
  money(ws1, 4, [2, 3, 4, 5], aoa1.length);
  const aoa2 = [['Detalle de pagos sin CFDI'], [],
    ['Partida', 'Sub-partida', 'Fecha', 'Beneficiario', 'Concepto', 'Monto', 'Repartido', 'Estado', 'Motivo aprobación']];
  lista.forEach(x => x.pagos.forEach(p => {
    const h = p.h || {};
    const marca = _marcaFiscalDe('pago', p.pid);
    aoa2.push([x.partida, h.sub_partida || '', h.fecha || '', h.nombre || '', h.concepto || '', p.monto,
      p.repartido ? 'Sí' : 'No', !p.repartido ? (p.aprobado ? 'Aprobado · sin repartir' : 'Sin repartir') : p.aprobado ? 'Aprobado' : 'Pendiente',
      (marca && marca.incluir !== false && marca.motivo) || '']);
  }));
  const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
  ws2['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 11 }, { wch: 28 }, { wch: 34 }, { wch: 14 }, { wch: 9 }, { wch: 12 }, { wch: 28 }];
  money(ws2, 3, [5], aoa2.length);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Por partida');
  XLSX.utils.book_append_sheet(wb, ws2, 'Detalle');
  XLSX.writeFile(wb, `Fiscal_sin_CFDI_${String(fisProyecto).replace(/[\\/:*?"<>|\s]+/g, '_')}_${sello.archivo}.xlsx`);
  notify('⬇ Excel de pagos sin CFDI descargado');
}

// ===== 🏠 POR CASA (facturado) =====
// El costo que se reporta al SAT es el DEVENGADO: toda factura vigente, pagada
// o no. Esta pestaña lo baja a nivel casa con el motor del modo 💼 de Costos
// por Unidad (misma regla, mismo número) y mide el HUECO: cuánto le caería a
// cada casa si lo facturado sin repartir se repartiera por indiviso.
let fisEstimCasa = true;   // aquí el punto ES ver el hueco → prendido por default

export function fisToggleEstimCasa(on) {
  fisEstimCasa = on === true || on === 'true' || on === '1';
  renderFisPanel();
}

// Estimado de 🏠 Por casa = facturas elegibles sin repartir + pagos sin CFDI
// APROBADOS que aún no se reparten (si no, un pago aprobado sin reparto no
// aparecería en ningún lado). Los aprobados YA repartidos van por la columna
// 'Sin CFDI' (fiscalBatch), así que aquí no se duplican.
function _pagosAprobadosSinRepartir(proyecto) {
  const { aprobados } = _marcasFiscales();
  return pagosSinFacturaSinRepartir(proyecto).filter(h => aprobados.has(String(h.id)));
}
// conDetalle → además `detalle: Map(unidad_id → [{ ref, factor, monto }])`: qué
// parte de cada documento pendiente le toca a cada casa (renglón del anexo).
function _estimadoPorCasa(proyecto, conDetalle = false) {
  const opts = { detalle: conDetalle };
  const fac = estimadoFacturadoPorUnidad(proyecto, opts);
  const pag = simularIndivisoDocs(_pagosAprobadosSinRepartir(proyecto)
    .map(h => ({ importe: h.importe || 0, fechaIso: parseFechaHist(h.fecha) || '',
      ref: { tipo: 'pago', id: h.id, pend: h.importe || 0, repartido: 0 } })), proyecto, opts);
  const porUnidad = new Map(fac.porUnidad);
  pag.porUnidad.forEach((v, k) => porUnidad.set(k, (porUnidad.get(k) || 0) + v));
  let detalle = null;
  if (conDetalle) {
    detalle = new Map();
    [fac.detalle, pag.detalle].forEach(m => m && m.forEach((l, k) => detalle.set(k, [...(detalle.get(k) || []), ...l])));
  }
  return { porUnidad, detalle, total: fac.total + pag.total, nFact: fac.count, nSin: fac.nSin, nParc: fac.nParc, totFact: fac.total, nPagos: pag.count, totPagos: pag.total };
}

function renderPorCasaTab(panel) {
  const unidades = unidadesDeProyecto(false, fisProyecto);
  if (!unidades.length) {
    panel.innerHTML = `<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">🏠</div><div>Sin unidades en ${escapeHtml(fisProyecto)}.</div></div>`;
    return;
  }
  const fisc = costoFacturadoPorUnidad(fisProyecto);
  const estim = fisEstimCasa ? _estimadoPorCasa(fisProyecto) : null;
  const tEst = estim ? estim.total : 0;
  // Sin CFDI aprobado por casa (pagos marcados deducibles en 🧮 / ✅): con eso la
  // fila dice el costo FISCAL CONCILIADO = facturado + sin CFDI aprobado.
  const bat = fiscalBatch(fisProyecto);
  const scDe = u => (bat.porUnidad.get(String(u.unidad_id)) || {}).sinCfdi || 0;
  const tSC = unidades.reduce((s, u) => s + scDe(u), 0);
  const tConc = fisc.total + tSC;

  panel.innerHTML = `
    <div style="margin-bottom:14px;padding:9px 12px;border:1px solid var(--accent);border-radius:8px;font-size:12px;background:color-mix(in srgb, var(--accent) 8%, transparent);">
      <strong>💼 Solo facturado (devengado)</strong> — cuenta únicamente facturas vigentes, pagadas o no; los pagos no cuentan aquí.
      ${fisc.nCruzadas ? ` · <span style="color:var(--red);font-weight:600;">${fisc.nCruzadas} factura(s) de EMPRESA CRUZADA excluidas</span>` : ''}
      ${fisc.nExcluidas ? ` · ${fisc.nExcluidas} excluida(s) a mano en ✅ Deducibilidad` : ''}
      ${fisc.sinEmpresaProyecto ? ` · <span style="color:var(--orange);">⚠ Este proyecto no tiene EMPRESA capturada (Configuración → Proyectos): sin eso no se filtran las facturas de empresa cruzada.</span>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-label">Facturado repartido</div><div class="stat-value" style="color:var(--green);">${fmt(fisc.total)}</div><div class="stat-sub">ya asignado a casas</div></div>
      <div class="stat-card" title="Pagos sin factura marcados deducibles (pestaña 🧮 Sin CFDI), repartidos a casas."><div class="stat-label">✅ Sin CFDI aprobado</div><div class="stat-value">${fmt(tSC)}</div><div class="stat-sub">nómina y otros deducibles</div></div>
      <div class="stat-card" title="Facturas elegibles SIN reparto y pagos sin CFDI aprobados SIN reparto, simulados por indiviso con el pool a la fecha de cada uno. Es el tamaño del pendiente de reparto."><div class="stat-label">⚠ Por repartir (estimado)</div><div class="stat-value" style="color:var(--orange);">${estim ? fmt(tEst) : '—'}</div><div class="stat-sub">${estim ? `${estim.nSin} sin reparto${estim.nParc ? ` + ${estim.nParc} a medias` : ''}${estim.nPagos ? ` + ${estim.nPagos} pago(s) aprobado(s)` : ''}` : 'prende el estimado'}</div></div>
      <div class="stat-card" title="Facturado + Sin CFDI aprobado${estim ? ' + estimado por repartir' : ''}"><div class="stat-label">Costo fiscal ${estim ? 'proyectado' : 'conciliado'}</div><div class="stat-value" style="color:var(--accent);">${fmt(tConc + tEst)}</div><div class="stat-sub">${estim ? 'conciliado + por repartir' : 'facturado + sin CFDI'}</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
      <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;">Costo facturado por casa</div>
      <div style="display:flex;gap:10px;align-items:center;">
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);cursor:pointer;" title="Simula repartir por indiviso (pool a la fecha de cada factura) lo facturado que aún no repartes. Solo para ver: no crea asignaciones.">
          <input type="checkbox" ${fisEstimCasa ? 'checked' : ''} onchange="fisToggleEstimCasa(this.checked)" style="cursor:pointer;"> Estimado por asignar
        </label>
        <button class="btn btn-ghost btn-sm" onclick="exportarFiscalPorCasaExcel()" title="Excel: costo facturado por casa (y el estimado si está prendido)">⬇ Excel</button>
        <button class="btn btn-ghost btn-sm" onclick="exportarAnexoFiscalExcel()" title="Anexo auditable para fiscalistas: Excel con + / − por casa y partida; cada factura con UUID, proveedor, RFC y la proporción que le tocó a la casa">📎 Anexo Excel</button>
        <button class="btn btn-primary btn-sm" onclick="imprimirFichasFiscales()" title="Una ficha por casa (hoja carta). En la ventana de impresión elige 'Guardar como PDF'.">🖨 Fichas (todas)</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Casa</th><th style="text-align:right">% Indiviso</th><th style="text-align:right">💼 Facturado</th><th style="text-align:right">✅ Sin CFDI</th><th style="text-align:right" title="Facturado + Sin CFDI aprobado">Fiscal conciliado</th>${estim ? '<th style="text-align:right">Estimado (por asignar)</th><th style="text-align:right">Proyectado</th>' : ''}<th></th></tr></thead>
        <tbody>${unidades.map(u => {
          const cf = fisc.porUnidad.get(u.unidad_id) || 0;
          const sc = scDe(u);
          const e = estim ? (estim.porUnidad.get(u.unidad_id) || 0) : 0;
          return `<tr>
            <td style="font-weight:600;">${escapeHtml(u.nombre)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--muted);">${(u.indiviso_pct || 0).toFixed(4)}%</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--green);">${fmt(cf)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;">${sc ? fmt(sc) : '—'}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);font-weight:600;">${fmt(cf + sc)}</td>
            ${estim ? `<td style="text-align:right;font-family:'DM Mono',monospace;color:var(--orange);">${fmt(e)}</td><td style="text-align:right;font-family:'DM Mono',monospace;font-weight:600;">${fmt(cf + sc + e)}</td>` : ''}
            <td style="text-align:right;"><button class="btn btn-ghost btn-sm" onclick="imprimirFichasFiscales('${escapeHtml(String(u.unidad_id))}')" title="Ficha de ${escapeHtml(u.nombre)} (Guardar como PDF)">🖨</button></td>
          </tr>`;
        }).join('')}
        <tr style="border-top:2px solid var(--border);font-weight:700;">
          <td>TOTAL</td><td></td>
          <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--green);">${fmt(fisc.total)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(tSC)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent);">${fmt(tConc)}</td>
          ${estim ? `<td style="text-align:right;font-family:'DM Mono',monospace;color:var(--orange);">${fmt(tEst)}</td><td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(tConc + tEst)}</td>` : ''}
          <td></td>
        </tr></tbody>
      </table>
    </div>`;
}

export function exportarFiscalPorCasaExcel() {
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const unidades = unidadesDeProyecto(false, fisProyecto);
  if (!unidades.length) { notify('No hay unidades en este proyecto', 'error'); return; }
  const fisc = costoFacturadoPorUnidad(fisProyecto);
  const estim = fisEstimCasa ? _estimadoPorCasa(fisProyecto) : null;
  const bat = fiscalBatch(fisProyecto);
  const scDe = u => (bat.porUnidad.get(String(u.unidad_id)) || {}).sinCfdi || 0;
  const sello = _sello();
  const enc = ['Casa', '% Indiviso', 'Facturado', 'Sin CFDI aprobado', 'Fiscal conciliado'];
  if (estim) enc.push('Estimado por asignar', 'Proyectado');
  const aoa = [
    [`FISCAL — Por casa (solo facturado) — ${fisProyecto}`],
    [`Generado: ${sello.txt} · Facturas vigentes (pagadas o no); pagos NO cuentan${fisc.nCruzadas ? ` · ${fisc.nCruzadas} factura(s) de empresa cruzada excluidas` : ''}${fisc.nExcluidas ? ` · ${fisc.nExcluidas} excluida(s) en Deducibilidad` : ''}${estim ? ` · Estimado: ${fmt(estim.total)} = ${estim.nFact} factura(s) con saldo por repartir — ${estim.nSin} sin reparto y ${estim.nParc} a medias — (${fmt(estim.totFact)})${estim.nPagos ? ` + ${estim.nPagos} pago(s) sin CFDI aprobados sin repartir (${fmt(estim.totPagos)})` : ''}, por indiviso (NO es reparto real)` : ''}`],
    [], enc];
  let tEst = 0, tSC = 0;
  unidades.forEach(u => {
    const cf = fisc.porUnidad.get(u.unidad_id) || 0;
    const sc = scDe(u);
    const e = estim ? (estim.porUnidad.get(u.unidad_id) || 0) : 0;
    tEst += e; tSC += sc;
    const fila = [u.nombre, (u.indiviso_pct || 0) / 100, cf, sc, cf + sc];
    if (estim) fila.push(e, cf + sc + e);
    aoa.push(fila);
  });
  const tot = ['TOTAL', '', fisc.total, tSC, fisc.total + tSC];
  if (estim) tot.push(tEst, fisc.total + tSC + tEst);
  aoa.push([], tot);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 18 }, { wch: 11 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 16 }];
  for (let r = 4; r < aoa.length; r++) {
    const refI = XLSX.utils.encode_cell({ r, c: 1 });
    if (ws[refI] && typeof ws[refI].v === 'number') ws[refI].z = '0.0000%';
    [2, 3, 4, 5, 6].forEach(c => { const ref = XLSX.utils.encode_cell({ r, c }); if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00'; });
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Por casa');
  XLSX.writeFile(wb, `Fiscal_por_casa_${String(fisProyecto).replace(/[\\/:*?"<>|\s]+/g, '_')}_${sello.archivo}.xlsx`);
  notify('⬇ Excel fiscal por casa descargado');
}

// ===== F3 · FICHAS POR CASA + ANEXO AUDITABLE =====
// Motor de detalle ÚNICO: de aquí salen la ficha (PDF) y el anexo (Excel), así
// ambos cuentan exactamente lo mismo que 🏠 Por casa. Cada línea es un renglón
// de costo_asignaciones con su documento de origen, método, factor y monto:
// la cadena auditable factura → proporción → casa.
//   · Facturado     = asignaciones de facturas ELEGIBLES (costoFacturadoPorUnidad).
//   · Sin CFDI apr. = asignaciones tipo 'pagado' de pagos aprobados (= fiscalBatch).
const _SIN_SUB = '(sin sub-partida)';

// Sello de corte en hora LOCAL (toISOString es UTC: en México, después de las
// 18:00 daba la fecha de mañana). txt para textos, archivo para nombres.
function _sello() {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const hora = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return { iso, hora, txt: `${fmtFecha(iso)} ${hora}`, archivo: `${iso}_${p2(d.getHours())}${p2(d.getMinutes())}` };
}

// Lo que NO está asignado a casas, ubicado documento por documento, y la
// conciliación del proyecto: total facturado = repartido + pendiente − exceso.
//   · sinRep    → facturas elegibles sin ningún reparto (todo su total pendiente)
//   · parciales → repartidas a medias (pendiente = su faltante)
//   · sobre     → repartidas de MÁS (exceso a corregir)
//   · pagos     → pagos sin CFDI aprobados que aún no se reparten
// Tolerancia $0.50 por factura (redondeos del reparto); lo menor va a "redondeos".
function _pendientesFiscal(proyecto) {
  const { elegibles } = costoFacturadoPorUnidad(proyecto);
  const rep = repartidoPorFactura();
  const provDe = id => (state.proveedores || []).find(p => String(p.id) === String(id));
  const sinRep = [], parciales = [], sobre = [];
  let totalFact = 0, repartido = 0, pendSin = 0, pendParc = 0, sobreTot = 0;
  (state.facturas || []).forEach(f => {
    const k = String(f.factura_id);
    if (!elegibles.has(k)) return;
    const total = f.monto_total || 0;
    const r = rep.get(k) || 0;
    totalFact += total; repartido += r;
    const prov = provDe(f.proveedor_id);
    const doc = {
      tipo: 'Factura', doc: `Fac ${k}${f.numero_factura ? ' · ' + f.numero_factura : ''}`, uuid: f.uuid || '',
      quien: f.razon_social || f.nombre_proveedor || (prov && prov.nombre) || '', rfc: (prov && prov.rfc) || '',
      fechaIso: parseFechaHist(f.fecha_factura) || f.fecha_factura || '', total, rep: r
    };
    const dif = total - r;
    if (dif > 0.5) {
      if (r > 0.005) { parciales.push({ ...doc, pend: dif }); pendParc += dif; }
      else { sinRep.push({ ...doc, pend: dif }); pendSin += dif; }
    } else if (dif < -0.5) {
      sobre.push({ ...doc, pend: dif }); sobreTot += -dif;
    }
  });
  const pagos = _pagosAprobadosSinRepartir(proyecto).map(h => {
    const prov = provDe(h.proveedor_id);
    const marca = _marcaFiscalDe('pago', h.id);
    return {
      tipo: 'Pago sin CFDI', doc: `Pago ${h.id}`, uuid: '', quien: h.nombre || (prov && prov.nombre) || '',
      rfc: (prov && prov.rfc) || '', fechaIso: parseFechaHist(h.fecha) || h.fecha || '', total: h.importe || 0,
      rep: 0, pend: h.importe || 0, motivo: (marca && marca.motivo) || '', partida: h.partida || ''
    };
  });
  const pendPagos = pagos.reduce((s, x) => s + x.pend, 0);
  const porMonto = (a, z) => Math.abs(z.pend) - Math.abs(a.pend);
  sinRep.sort(porMonto); parciales.sort(porMonto); sobre.sort(porMonto); pagos.sort(porMonto);
  // Lo que queda fuera de la tolerancia (< $0.50 por factura) — cierra la cuenta.
  const redondeo = totalFact - (repartido + pendSin + pendParc - sobreTot);
  return { sinRep, parciales, sobre, pagos, totalFact, repartido, pendSin, pendParc, sobreTot, pendPagos, redondeo };
}

function _detalleFiscalCasas(proyecto) {
  const unidades = unidadesDeProyecto(false, proyecto);
  const uids = new Set(unidades.map(u => String(u.unidad_id)));
  const { elegibles } = costoFacturadoPorUnidad(proyecto);
  const pcf = _pagosCubiertosPorFacturaSet();
  const fc = _facturasCanceladasSet();
  const fe = _factExistSet(); const pe = _pagoExistSet();
  const pcap = _pagosCapitalSet();
  const { aprobados } = _marcasFiscales();
  const provDe = id => (state.proveedores || []).find(p => String(p.id) === String(id));
  const casas = new Map();
  const casa = uid => {
    let c = casas.get(uid);
    if (!c) { c = { fac: 0, sc: 0, nFac: new Set(), nPag: new Set(), partidas: new Map() }; casas.set(uid, c); }
    return c;
  };
  const grupo = (c, partida) => {
    let g = c.partidas.get(partida);
    if (!g) { g = { fac: 0, sc: 0, subs: new Map() }; c.partidas.set(partida, g); }
    return g;
  };
  // Sub-partida dentro de la partida: ahí viven las líneas; la partida suma sus subs.
  // Regla de negocio (subPartidaObligatoria): SOLO CONSTRUCCION lleva sub-partida; en
  // las demás todo cae en un único cubo aunque el dato traiga una sub capturada.
  const subDe = (g, partida, sub) => {
    const k = subPartidaObligatoria(partida) ? ((sub || '').trim() || _SIN_SUB) : _SIN_SUB;
    let s = g.subs.get(k);
    if (!s) { s = { fac: 0, sc: 0, lineas: [] }; g.subs.set(k, s); }
    return s;
  };
  state.costoAsignaciones.forEach(a => {
    const uid = String(a.unidad_id);
    if (!uids.has(uid)) return;
    const monto = a.monto_asignado || 0;
    if (a.factura_id && elegibles.has(String(a.factura_id))) {
      const f = facturaById(a.factura_id) || {};
      const prov = provDe(f.proveedor_id);
      const c = casa(uid);
      const pNom = (a.partida_override || '').trim() || 'Sin partida';
      const g = grupo(c, pNom);
      const sb = subDe(g, pNom, a.sub_partida_override);
      c.fac += monto; g.fac += monto; sb.fac += monto; c.nFac.add(String(a.factura_id));
      sb.lineas.push({
        tipo: 'Factura', doc: `Fac ${a.factura_id}${f.numero_factura ? ' · ' + f.numero_factura : ''}`,
        uuid: f.uuid || '', quien: f.razon_social || f.nombre_proveedor || (prov && prov.nombre) || '',
        rfc: (prov && prov.rfc) || '', fechaIso: parseFechaHist(f.fecha_factura) || f.fecha_factura || '',
        totalDoc: f.monto_total || 0, metodo: a.metodo || '', factor: a.factor || 0, monto,
        sub: a.sub_partida_override || '', motivo: ''
      });
      return;
    }
    if (a.factura_id) return;   // factura no elegible: fuera del fiscal
    if (_tipoAsignacion(a, pcf, fc, fe, pe, pcap) !== 'pagado') return;
    if (!aprobados.has(String(a.pago_id))) return;
    const h = pagoById(a.pago_id) || {};
    const prov = provDe(h.proveedor_id);
    const marca = _marcaFiscalDe('pago', a.pago_id);
    const c = casa(uid);
    const pNom = (a.partida_override || h.partida || '').trim() || 'Sin partida';
    const g = grupo(c, pNom);
    const sb = subDe(g, pNom, a.sub_partida_override || h.sub_partida);
    c.sc += monto; g.sc += monto; sb.sc += monto; c.nPag.add(String(a.pago_id));
    sb.lineas.push({
      tipo: 'Pago sin CFDI', doc: `Pago ${a.pago_id}`, uuid: '',
      quien: h.nombre || (prov && prov.nombre) || '', rfc: (prov && prov.rfc) || '',
      fechaIso: parseFechaHist(h.fecha) || h.fecha || '', totalDoc: h.importe || 0,
      metodo: a.metodo || '', factor: a.factor || 0, monto,
      sub: a.sub_partida_override || h.sub_partida || '', motivo: (marca && marca.motivo) || ''
    });
  });
  // Autochequeo contra las vistas: si algún día divergen, que se note en consola.
  const fisc = costoFacturadoPorUnidad(proyecto);
  const bat = fiscalBatch(proyecto);
  unidades.forEach(u => {
    const c = casas.get(String(u.unidad_id)) || { fac: 0, sc: 0 };
    const facV = fisc.porUnidad.get(u.unidad_id) || 0;
    const scV = (bat.porUnidad.get(String(u.unidad_id)) || {}).sinCfdi || 0;
    if (Math.abs(c.fac - facV) > 1 || Math.abs(c.sc - scV) > 1) {
      console.warn(`[fichas] ${u.nombre}: detalle fac ${c.fac.toFixed(2)} / sc ${c.sc.toFixed(2)} vs vistas fac ${facV.toFixed(2)} / sc ${scV.toFixed(2)}`);
    }
  });
  return { unidades, casas };
}

const _partidasOrdenadas = c => [...c.partidas.entries()].sort((a, z) => (z[1].fac + z[1].sc) - (a[1].fac + a[1].sc));
const _subsOrdenadas = g => [...g.subs.entries()].sort((a, z) => (z[1].fac + z[1].sc) - (a[1].fac + a[1].sc));

// Fichas imprimibles: ventana nueva con CSS de impresión (una casa por hoja
// carta) y print() → el usuario elige "Guardar como PDF". Sin librerías.
export function imprimirFichasFiscales(unidadId) {
  const { unidades, casas } = _detalleFiscalCasas(fisProyecto);
  const lista = unidadId == null || unidadId === ''
    ? unidades
    : unidades.filter(u => String(u.unidad_id) === String(unidadId));
  if (!lista.length) { notify('No hay casas para generar fichas', 'error'); return; }
  // La nota del estimado obedece a la casilla 'Estimado por asignar' (decisión del dueño).
  const est = fisEstimCasa ? _estimadoPorCasa(fisProyecto) : null;
  const proy = (state.proyectos || []).find(p => p.nombre === fisProyecto) || {};
  const sello = _sello();
  const e = escapeHtml;
  const paginas = lista.map((u, i) => {
    const c = casas.get(String(u.unidad_id)) || { fac: 0, sc: 0, nFac: new Set(), nPag: new Set(), partidas: new Map() };
    const conc = c.fac + c.sc;
    const estU = est ? (est.porUnidad.get(u.unidad_id) || 0) : 0;
    // Partida en negritas y, debajo, sus sub-partidas con sangría. Si la partida
    // solo trae "(sin sub-partida)", no se repite un renglón que no aporta.
    const filas = _partidasOrdenadas(c).map(([p, g]) => {
      const subs = _subsOrdenadas(g);
      const soloSinSub = !subPartidaObligatoria(p) || (subs.length === 1 && subs[0][0] === _SIN_SUB);
      const renglonP = `<tr class="rp"><td>${e(p)}</td><td class="n">${g.fac ? fmt(g.fac) : '—'}</td><td class="n">${g.sc ? fmt(g.sc) : '—'}</td><td class="n b">${fmt(g.fac + g.sc)}</td></tr>`;
      if (soloSinSub) return renglonP;
      return renglonP + subs.map(([s, x]) =>
        `<tr class="rs"><td>${e(s)}</td><td class="n">${x.fac ? fmt(x.fac) : '—'}</td><td class="n">${x.sc ? fmt(x.sc) : '—'}</td><td class="n">${fmt(x.fac + x.sc)}</td></tr>`).join('');
    }).join('');
    return `<section class="pag">
      <header>
        <div class="emp">${e(proy.empresa || '')}</div>
        <h1>Ficha de costo fiscal por unidad</h1>
        <div class="sub">${e(fisProyecto)} · Corte: ${e(sello.txt)}</div>
      </header>
      <table class="datos">
        <tr><th>Unidad</th><td class="b">${e(u.nombre)}</td><th>Tipo</th><td>${e(u.tipo || '—')}</td></tr>
        <tr><th>% Indiviso</th><td>${(u.indiviso_pct || 0).toFixed(4)}%</td><th>Superficie</th><td>${u.superficie_m2 ? e(String(u.superficie_m2)) + ' m²' : '—'}</td></tr>
        <tr><th>Estatus</th><td>${e(u.estatus || '—')}</td><th>Terminación</th><td>${u.fecha_termino ? e(fmtFecha(u.fecha_termino)) : '—'}</td></tr>
      </table>
      <h2>Costo por partida</h2>
      <table class="part">
        <thead><tr><th>Partida</th><th class="n">Facturado (CFDI)</th><th class="n">Sin CFDI aprobado</th><th class="n">Total</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="4" class="vacio">Sin costo fiscal asignado a esta unidad.</td></tr>'}</tbody>
        <tfoot><tr><td>TOTAL</td><td class="n">${fmt(c.fac)}</td><td class="n">${fmt(c.sc)}</td><td class="n">${fmt(conc)}</td></tr></tfoot>
      </table>
      <div class="total"><span>Costo fiscal conciliado</span><strong>${fmt(conc)}</strong></div>
      <div class="comp">Integrado por ${c.nFac.size} factura(s) y ${c.nPag.size} pago(s) sin CFDI aprobado(s) como deducibles.</div>
      ${estU > 0 ? `<div class="nota"><strong>Pendiente por repartir (estimado, NO definitivo): ${fmt(estU)}</strong><br>
        Comprobantes del proyecto aún no asignados a unidades, simulados por % de indiviso. No forma parte del costo conciliado.</div>` : ''}
      <div class="metodo">Método: los costos directos se asignan a la unidad que los generó; los costos comunes se reparten por
        porcentaje de indiviso entre las unidades en obra a la fecha de cada comprobante. Solo se incluyen facturas vigentes
        de la empresa del proyecto (pagadas o no) y pagos sin CFDI aprobados como deducibles. Detalle documento por documento
        (UUID, proveedor, proporción asignada) en el anexo Excel.</div>
      <footer>${e(fisProyecto)} · ${e(u.nombre)} · Hoja ${i + 1} de ${lista.length}</footer>
    </section>`;
  }).join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Fichas fiscales — ${e(fisProyecto)}${lista.length === 1 ? ' — ' + e(lista[0].nombre) : ''}</title>
    <style>
      @page { size: letter; margin: 16mm 14mm; }
      * { box-sizing: border-box; }
      body { font-family: Georgia, 'Times New Roman', serif; color: #111; margin: 0; font-size: 11pt; }
      .pag { page-break-after: always; break-after: page; }
      .pag:last-child { page-break-after: auto; break-after: auto; }
      header { border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 12px; }
      .emp { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; letter-spacing: .12em; text-transform: uppercase; color: #444; }
      h1 { font-size: 17pt; margin: 2px 0; }
      h2 { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; letter-spacing: .08em; text-transform: uppercase; margin: 16px 0 6px; color: #333; }
      .sub { font-size: 10pt; color: #333; }
      table { width: 100%; border-collapse: collapse; }
      .datos th { text-align: left; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #555; font-weight: normal; width: 17%; padding: 3px 4px; }
      .datos td { padding: 3px 4px; width: 33%; }
      .part th { font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; text-align: left; border-bottom: 1px solid #111; padding: 4px; }
      .part td { padding: 4px; border-bottom: 1px solid #ddd; font-size: 10pt; }
      .part thead { display: table-header-group; }   /* se repite si la ficha ocupa 2 hojas */
      .part tr { page-break-inside: avoid; break-inside: avoid; }
      .part tr.rp td { font-weight: bold; border-top: 1px solid #999; }
      .part tr.rs td { font-size: 9pt; color: #333; border-bottom: 1px dotted #ddd; padding-top: 2px; padding-bottom: 2px; }
      .part tr.rs td:first-child { padding-left: 18px; }
      .part tfoot td { border-top: 2px solid #111; border-bottom: none; font-weight: bold; }
      .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .b { font-weight: bold; }
      .vacio { color: #777; font-style: italic; }
      .total { display: flex; justify-content: space-between; align-items: baseline; border: 2px solid #111; padding: 8px 12px; margin-top: 14px; font-size: 13pt; }
      .total strong { font-size: 16pt; font-variant-numeric: tabular-nums; }
      .comp { font-size: 9.5pt; color: #333; margin-top: 6px; }
      .nota { margin-top: 14px; border: 1px dashed #777; padding: 8px 12px; font-size: 9.5pt; color: #333; }
      .metodo { margin-top: 14px; font-size: 8.5pt; color: #555; line-height: 1.45; }
      footer { margin-top: 18px; border-top: 1px solid #aaa; padding-top: 4px; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #666; text-align: right; }
    </style></head><body>${paginas}</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { notify('El navegador bloqueó la ventana de impresión: permite ventanas emergentes para este sitio y vuelve a intentarlo', 'error'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (_) { /* el usuario puede imprimir a mano */ } }, 400);
}

// Anexo auditable: Excel con renglones agrupados (+/−). Nivel 0 = casa (visible),
// nivel 1 = partida, nivel 2 = cada documento. Total ARRIBA de cada grupo.
export function exportarAnexoFiscalExcel() {
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const { unidades, casas } = _detalleFiscalCasas(fisProyecto);
  if (!unidades.length) { notify('No hay casas en este proyecto', 'error'); return; }
  // El estimado obedece a la casilla 'Estimado por asignar': prendida → cada casa
  // trae su renglón simulado con el detalle por documento y la columna Proyectado.
  const est = fisEstimCasa ? _estimadoPorCasa(fisProyecto, true) : null;
  const sello = _sello();
  // Columnas: 0 Casa · 1 Partida · 2 Sub-partida · 3 Tipo · 4 Documento · 5 UUID ·
  // 6 Proveedor · 7 RFC · 8 Fecha · 9 Total doc · 10 Método · 11 % a la casa ·
  // 12 Monto a la casa · 13 Facturado · 14 Sin CFDI · 15 Conciliado · 16 Motivo
  // [+ 17 Estimado · 18 Proyectado, solo con la casilla prendida]
  const enc = ['Casa', 'Partida', 'Sub-partida', 'Tipo', 'Documento', 'UUID', 'Proveedor / Beneficiario', 'RFC', 'Fecha',
    'Total documento', 'Método', '% a la casa', 'Monto a la casa', 'Facturado', 'Sin CFDI aprobado', 'Conciliado', 'Motivo aprobación',
    ...(est ? ['Estimado (simulado)', 'Proyectado'] : [])];
  const aoa = [
    [`ANEXO — Detalle del costo fiscal por unidad — ${fisProyecto}`],
    [`Corte: ${sello.txt} · Da clic en + (margen izquierdo) para abrir cada casa, partida y sub-partida. Facturas vigentes de la empresa del proyecto (pagadas o no) + pagos sin CFDI aprobados como deducibles.${est ? ' INCLUYE ESTIMADO: lo pendiente por repartir simulado por indiviso (NO definitivo) en un renglón aparte por casa.' : ''}`],
    [], enc];
  const niveles = [0, 0, 0, 0];
  const vacias = n => Array(n).fill('');
  const resumen = [['Casa', '% Indiviso', 'Facturado', 'Sin CFDI aprobado', 'Conciliado',
    ...(est ? ['Estimado (simulado)', 'Proyectado'] : []), 'Facturas', 'Pagos sin CFDI']];
  const porSub = [['Casa', 'Partida', 'Sub-partida', 'Facturado', 'Sin CFDI aprobado', 'Total', 'Documentos']];
  unidades.forEach(u => {
    const c = casas.get(String(u.unidad_id)) || { fac: 0, sc: 0, nFac: new Set(), nPag: new Set(), partidas: new Map() };
    const eU = est ? (est.porUnidad.get(u.unidad_id) || 0) : 0;
    aoa.push([u.nombre, `Indiviso ${(u.indiviso_pct || 0).toFixed(4)}%`, ...vacias(11), c.fac, c.sc, c.fac + c.sc, '',
      ...(est ? [eU, c.fac + c.sc + eU] : [])]);
    niveles.push(0);
    _partidasOrdenadas(c).forEach(([p, g]) => {
      aoa.push(['', p, ...vacias(11), g.fac, g.sc, g.fac + g.sc, '']);
      niveles.push(1);
      // Solo CONSTRUCCION abre un nivel de sub-partida; las demás van directo a sus
      // documentos (la regla de negocio es la misma que usa toda la app).
      const conSub = subPartidaObligatoria(p);
      const docNivel = conSub ? 3 : 2;
      _subsOrdenadas(g).forEach(([s, x]) => {
        if (conSub) {
          aoa.push(['', '', s, ...vacias(10), x.fac, x.sc, x.fac + x.sc, '']);
          niveles.push(2);
        }
        porSub.push([u.nombre, p, conSub ? s : '', x.fac, x.sc, x.fac + x.sc, x.lineas.length]);
        x.lineas.slice().sort((a, z) => z.monto - a.monto).forEach(l => {
          aoa.push(['', '', '', l.tipo, l.doc, l.uuid, l.quien, l.rfc, l.fechaIso ? fmtFecha(l.fechaIso) : '', l.totalDoc,
            l.metodo, l.factor, l.monto, '', '', '', l.motivo]);
          niveles.push(docNivel);
        });
      });
    });
    // Renglón del ESTIMADO de esta casa (solo con la casilla prendida): lo que le
    // tocaría de cada documento pendiente si se repartiera por indiviso a su fecha.
    if (est && eU > 0.005) {
      aoa.push(['', '⚠ ESTIMADO — pendiente por repartir (simulado por indiviso, NO definitivo)', ...vacias(15), eU, '']);
      niveles.push(1);
      (est.detalle.get(u.unidad_id) || []).slice().sort((a, z) => z.monto - a.monto).forEach(d => {
        const r = d.ref || {};
        let fila;
        if (r.tipo === 'factura') {
          const f = facturaById(r.id) || {};
          const prov = (state.proveedores || []).find(p => String(p.id) === String(f.proveedor_id));
          fila = ['', '', '', 'Factura (estimado)', `Fac ${r.id}${f.numero_factura ? ' · ' + f.numero_factura : ''}`, f.uuid || '',
            f.razon_social || f.nombre_proveedor || (prov && prov.nombre) || '', (prov && prov.rfc) || '',
            f.fecha_factura ? fmtFecha(parseFechaHist(f.fecha_factura) || f.fecha_factura) : '', f.monto_total || 0,
            'indiviso (simulado)', d.factor, d.monto, '', '', '',
            r.repartido > 0.005 ? `Faltante de factura repartida a medias: ${fmt(r.pend)}` : 'Factura sin reparto'];
        } else {
          const h = pagoById(r.id) || {};
          fila = ['', '', '', 'Pago sin CFDI (estimado)', `Pago ${r.id}`, '', h.nombre || '', '',
            h.fecha ? fmtFecha(parseFechaHist(h.fecha) || h.fecha) : '', h.importe || 0,
            'indiviso (simulado)', d.factor, d.monto, '', '', '', 'Pago aprobado sin repartir'];
        }
        aoa.push(fila);   // el detalle va en 'Monto a la casa'; el total del estimado, en su renglón
        niveles.push(2);
      });
    }
    resumen.push([u.nombre, (u.indiviso_pct || 0) / 100, c.fac, c.sc, c.fac + c.sc,
      ...(est ? [eU, c.fac + c.sc + eU] : []), c.nFac.size, c.nPag.size]);
  });

  // ---- PENDIENTE POR REPARTIR: lo que no está en ninguna casa, ubicado doc por doc ----
  const pf = _pendientesFiscal(fisProyecto);
  const pendFac = pf.pendSin + pf.pendParc;
  if (pendFac > 0 || pf.pendPagos > 0) {
    aoa.push(['PENDIENTE POR REPARTIR', 'sin partida · no asignado a casas', ...vacias(11), pendFac, pf.pendPagos, pendFac + pf.pendPagos, '']);
    niveles.push(0);
    const grupoPend = (titulo, lista, esPago) => {
      if (!lista.length) return;
      const tot = lista.reduce((s, x) => s + x.pend, 0);
      aoa.push(['', titulo, ...vacias(11), esPago ? '' : tot, esPago ? tot : '', tot, '']);
      niveles.push(1);
      lista.forEach(x => {
        aoa.push(['', '', '', x.tipo, x.doc, x.uuid, x.quien, x.rfc, x.fechaIso ? fmtFecha(x.fechaIso) : '', x.total,
          '', '', x.pend, '', '', '', x.rep > 0.005 ? `Ya repartido ${fmt(x.rep)}; falta ${fmt(x.pend)}` : (x.motivo || '')]);
        niveles.push(2);
      });
    };
    grupoPend(`Facturas sin reparto (${pf.sinRep.length})`, pf.sinRep, false);
    grupoPend(`Facturas repartidas a medias — faltante (${pf.parciales.length})`, pf.parciales, false);
    grupoPend(`Pagos sin CFDI aprobados sin repartir (${pf.pagos.length})`, pf.pagos, true);
  }

  // ---- Conciliación del proyecto (al pie de Resumen) ----
  const resumenFilasCasas = resumen.length;
  const repCasas = resumen.slice(1).reduce((s, r) => s + (r[2] || 0), 0);
  const fueraLista = pf.repartido - repCasas;
  const cuadre = (pf.repartido + pf.pendSin + pf.pendParc - pf.sobreTot + pf.redondeo) - pf.totalFact;
  resumen.push([], ['CONCILIACIÓN DEL PROYECTO — facturas elegibles', '', ''],
    ['Total facturado elegible (vigentes, empresa del proyecto)', '', pf.totalFact],
    ['Repartido a casas', '', pf.repartido],
    ...(Math.abs(fueraLista) > 0.5 ? [['   de ello, en casas fuera de esta lista (dadas de baja u otras)', '', fueraLista]] : []),
    [`Pendiente — facturas sin reparto (${pf.sinRep.length})`, '', pf.pendSin],
    [`Pendiente — faltante de facturas repartidas a medias (${pf.parciales.length})`, '', pf.pendParc],
    [`(−) Sobre-repartido — exceso a corregir (${pf.sobre.length})`, '', -pf.sobreTot],
    ['Redondeos (< $0.50 por factura)', '', pf.redondeo],
    ['Cuadre: componentes − total (debe ser $0.00)', '', Math.abs(cuadre) < 0.005 ? 0 : cuadre],
    [],
    [`Aparte (no son facturas): pagos sin CFDI aprobados sin repartir (${pf.pagos.length})`, '', pf.pendPagos]);

  // Hoja plana "Pendiente por repartir" (misma lista, filtrable)
  const aoaP = [['Grupo', 'Tipo', 'Documento', 'UUID', 'Proveedor / Beneficiario', 'RFC', 'Fecha', 'Total documento', 'Ya repartido', 'Pendiente (− = exceso)', 'Motivo aprobación']];
  const addP = (g, lista) => lista.forEach(x => aoaP.push([g, x.tipo, x.doc, x.uuid, x.quien, x.rfc,
    x.fechaIso ? fmtFecha(x.fechaIso) : '', x.total, x.rep, x.pend, x.motivo || '']));
  addP('Sin reparto', pf.sinRep);
  addP('Repartida a medias', pf.parciales);
  addP('Pago sin CFDI aprobado sin repartir', pf.pagos);
  addP('SOBRE-repartida (exceso)', pf.sobre);
  const wsP = XLSX.utils.aoa_to_sheet(aoaP);
  wsP['!cols'] = [{ wch: 30 }, { wch: 13 }, { wch: 20 }, { wch: 38 }, { wch: 30 }, { wch: 15 }, { wch: 11 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 26 }];
  for (let r = 1; r < aoaP.length; r++) {
    [7, 8, 9].forEach(c => { const ref = XLSX.utils.encode_cell({ r, c }); if (wsP[ref] && typeof wsP[ref].v === 'number') wsP[ref].z = '"$"#,##0.00'; });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!outline'] = { above: true };
  ws['!rows'] = niveles.map(lv => (lv ? { level: lv, hidden: true } : {}));
  ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 22 }, { wch: 13 }, { wch: 20 }, { wch: 38 }, { wch: 30 }, { wch: 15 }, { wch: 11 },
    { wch: 15 }, { wch: 11 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 16 }, { wch: 15 }, { wch: 26 },
    ...(est ? [{ wch: 18 }, { wch: 16 }] : [])];
  for (let r = 4; r < aoa.length; r++) {
    [9, 12, 13, 14, 15, ...(est ? [17, 18] : [])].forEach(c => { const ref = XLSX.utils.encode_cell({ r, c }); if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00'; });
    const rf = XLSX.utils.encode_cell({ r, c: 11 });
    if (ws[rf] && typeof ws[rf].v === 'number') ws[rf].z = '0.0000%';
  }
  const wsS = XLSX.utils.aoa_to_sheet(porSub);
  wsS['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 26 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 11 }];
  for (let r = 1; r < porSub.length; r++) {
    [3, 4, 5].forEach(c => { const ref = XLSX.utils.encode_cell({ r, c }); if (wsS[ref] && typeof wsS[ref].v === 'number') wsS[ref].z = '"$"#,##0.00'; });
  }
  const wsR = XLSX.utils.aoa_to_sheet(resumen);
  wsR['!cols'] = [{ wch: 44 }, { wch: 11 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, ...(est ? [{ wch: 18 }, { wch: 16 }] : []), { wch: 9 }, { wch: 13 }];
  for (let r = 1; r < resumen.length; r++) {
    const ri = XLSX.utils.encode_cell({ r, c: 1 }); if (r < resumenFilasCasas && wsR[ri] && typeof wsR[ri].v === 'number') wsR[ri].z = '0.0000%';
    (r >= resumenFilasCasas ? [2] : [2, 3, 4, ...(est ? [5, 6] : [])]).forEach(c => { const ref = XLSX.utils.encode_cell({ r, c }); if (wsR[ref] && typeof wsR[ref].v === 'number') wsR[ref].z = '"$"#,##0.00'; });
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Anexo');
  XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');
  XLSX.utils.book_append_sheet(wb, wsS, 'Por sub-partida');
  XLSX.utils.book_append_sheet(wb, wsP, 'Pendiente por repartir');
  XLSX.writeFile(wb, `Anexo_fiscal_${String(fisProyecto).replace(/[\\/:*?"<>|\s]+/g, '_')}_${sello.archivo}.xlsx`);
  notify('📎 Anexo fiscal descargado');
}

// ========== PESTAÑA: ✅ DEDUCIBILIDAD (mudada de Costos por Unidad) ==========
// Costo por unidad ESTRICTO (solo lo deducible). Capa de SOLO LECTURA sobre los
// mismos repartos: _tipoAsignacion intacta, los números gerenciales de las demás
// vistas no cambian ni un centavo. Regla híbrida:
//   devengado (factura)  → cuenta SALVO factura excluida o comprobante ≠ 'Factura'
//   pagado (sin factura) → cuenta SOLO si el admin lo aprobó como deducible
//   costo inicial        → NO es fiscal (apertura sin comprobante en el sistema)

function _marcasFiscales() {
  const aprobados = new Set(), factExcluidas = new Set();
  (state.fiscalMarcas || []).forEach(m => {
    if (m.doc_tipo === 'pago' && m.incluir !== false) aprobados.add(String(m.doc_id));
    if (m.doc_tipo === 'factura' && m.incluir === false) factExcluidas.add(String(m.doc_id));
  });
  return { aprobados, factExcluidas };
}
function _marcaFiscalDe(docTipo, docId) {
  return (state.fiscalMarcas || []).find(m => m.doc_tipo === docTipo && String(m.doc_id) === String(docId));
}
// Comprobante que NO es factura (Nota de crédito / Complemento de pago / Otro):
// contarlo sería doble conteo o costo inexistente → auto-excluido, sin botón.
function _factAutoExcluida(f) {
  return ((f && f.tipo_comprobante) || 'Factura') !== 'Factura';
}

// UNA pasada (Sets una vez, patrón batch). Post-filtro sobre _tipoAsignacion.
export function fiscalBatch(proyecto) {
  const uids = new Set(state.unidades
    .filter(u => u.activo !== false && u.proyecto === proyecto)
    .map(u => String(u.unidad_id)));
  const pcf = _pagosCubiertosPorFacturaSet();
  const fc = _facturasCanceladasSet();
  const fe = _factExistSet(); const pe = _pagoExistSet();
  const pcap = _pagosCapitalSet();
  const { aprobados, factExcluidas } = _marcasFiscales();
  // Empresa cruzada (factura a otra razón social que la del proyecto): el SAT no
  // la acepta para esta empresa → fuera del fiscal, igual que en 🏠 Por casa.
  const empNorm = empresaDeProyectoNorm(proyecto);

  const porUnidad = new Map();   // uid → { ger, fis }
  const filaDe = uid => { let x = porUnidad.get(uid); if (!x) { x = { ger: 0, fis: 0, sinCfdi: 0 }; porUnidad.set(uid, x); } return x; };
  const pagosCand = new Map();   // pago_id → { h, monto, aprobado }
  const factRep = new Map();     // factura_id → { f, monto, excluida, auto }
  let totGer = 0, totFis = 0, totPagosAprob = 0, totPagosNoAprob = 0, totFactExcl = 0, totInicial = 0;

  state.costoAsignaciones.forEach(a => {
    const uid = String(a.unidad_id);
    if (!uids.has(uid)) return;
    const t = _tipoAsignacion(a, pcf, fc, fe, pe, pcap);
    if (!t) return;
    const monto = a.monto_asignado || 0;
    const fila = filaDe(uid);
    fila.ger += monto; totGer += monto;
    let esFiscal = false;
    if (t === 'devengado') {
      const fid = String(a.factura_id);
      let reg = factRep.get(fid);
      if (!reg) {
        const f = facturaById(fid);
        reg = { f, monto: 0, excluida: factExcluidas.has(fid), auto: _factAutoExcluida(f), cruzada: facturaEmpresaCruzada(f, empNorm) };
        factRep.set(fid, reg);
      }
      reg.monto += monto;
      if (reg.excluida || reg.auto || reg.cruzada) totFactExcl += monto;
      else esFiscal = true;
    } else {
      const pid = String(a.pago_id);
      let reg = pagosCand.get(pid);
      if (!reg) { reg = { h: pagoById(pid), monto: 0, aprobado: aprobados.has(pid) }; pagosCand.set(pid, reg); }
      reg.monto += monto;
      if (reg.aprobado) { esFiscal = true; totPagosAprob += monto; fila.sinCfdi += monto; } else { totPagosNoAprob += monto; }
    }
    if (esFiscal) { fila.fis += monto; totFis += monto; }
  });

  // Costo inicial (apertura): entra al GERENCIAL (igual que costoRealUnidad) pero
  // no al fiscal — sin comprobante dentro del sistema.
  state.presupuestoUnidad.forEach(p => {
    const uid = String(p.unidad_id);
    if (!uids.has(uid)) return;
    const ini = p.costo_inicial || 0;
    if (ini) { filaDe(uid).ger += ini; totGer += ini; totInicial += ini; }
  });

  // Facturas del proyecto SIN repartir: su costo aún no existe en NINGUNA vista de
  // unidades (ni fiscal) — el KPI avisa que el fiscal subirá al repartirlas.
  const repartidas = _facturasRepartidasSet();
  const sinRepartir = (state.facturas || []).filter(f =>
    f.proyecto === proyecto && f.estado_sat !== 'Cancelada' && f.estatus_factura !== 'cancelada' &&
    !_factAutoExcluida(f) && !facturaEmpresaCruzada(f, empNorm) &&
    (f.monto_total || 0) > 0 && !repartidas.has(String(f.factura_id)));

  return { porUnidad, pagosCand, factRep, sinRepartir, totGer, totFis, totPagosAprob, totPagosNoAprob, totFactExcl, totInicial };
}

function renderFiscalTab(panel) {
  if (!puedeFiscal()) {
    panel.innerHTML = '<div class="empty-state"><div style="font-size:28px;opacity:.4;margin-bottom:8px;">🔒</div><div>Vista disponible solo para el administrador y contabilidad.</div></div>';
    return;
  }
  const sinTabla = state.cargado && state.cargado.fiscalMarcas !== true;
  const b = fiscalBatch(fisProyecto);
  const unidades = unidadesDeProyecto(false, fisProyecto);
  const totNoDeducible = b.totGer - b.totFis;
  const sinRepTot = b.sinRepartir.reduce((s, f) => s + (f.monto_total || 0), 0);
  const pagosList = [...b.pagosCand.values()].filter(x => x.h).sort((a, z) => z.monto - a.monto);
  const factList = [...b.factRep.values()].filter(x => x.f).sort((a, z) => z.monto - a.monto);

  panel.innerHTML = `
    ${sinTabla ? '<div style="background:rgba(224,122,58,.1);border:1px solid rgba(224,122,58,.35);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;">⚠ <b>Falta activar las marcas fiscales:</b> corre <b>supabase/schema/36_fiscal.sql</b> en el SQL Editor de Supabase y recarga. Mientras tanto la vista muestra solo lo facturado y los botones de marcar están desactivados.</div>' : ''}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-label">Costo FISCAL (deducible)</div><div class="stat-value" style="color:var(--green);">${fmt(b.totFis)}</div><div class="stat-sub">facturas ${fmt(b.totFis - b.totPagosAprob)} + pagos aprobados ${fmt(b.totPagosAprob)}</div></div>
      <div class="stat-card"><div class="stat-label">Costo gerencial</div><div class="stat-value">${fmt(b.totGer)}</div><div class="stat-sub">la vista de siempre (márgenes)</div></div>
      <div class="stat-card" title="Pagos sin factura no aprobados + facturas excluidas + costo inicial de apertura"><div class="stat-label">No deducible (hoy)</div><div class="stat-value" style="color:var(--orange);">${fmt(totNoDeducible)}</div><div class="stat-sub">sin aprobar ${fmt(b.totPagosNoAprob)} · fact. excl. ${fmt(b.totFactExcl)} · apertura ${fmt(b.totInicial)}</div></div>
      <div class="stat-card" title="Facturas vigentes del proyecto sin repartir a casas: al repartirlas, su monto entrará al costo fiscal"><div class="stat-label">⚠ Facturas sin repartir</div><div class="stat-value" style="color:${b.sinRepartir.length ? 'var(--red)' : 'var(--muted)'};">${b.sinRepartir.length}</div><div class="stat-sub">${fmt(sinRepTot)} por entrar al fiscal</div></div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
      <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;">Fiscal por casa</div>
      <button class="btn btn-ghost btn-sm" onclick="fiscalExportar()" title="Excel para contabilidad: fiscal por casa + pagos aprobados + marcas con motivo">⬇ Excel</button>
    </div>
    <div class="table-wrap" style="margin-bottom:22px;">
      <table>
        <thead><tr><th>Casa</th><th style="text-align:right">Gerencial</th><th style="text-align:right">Fiscal</th><th style="text-align:right">Diferencia</th><th style="text-align:right">% fiscal</th></tr></thead>
        <tbody>${unidades.map(u => {
          const x = b.porUnidad.get(String(u.unidad_id)) || { ger: 0, fis: 0 };
          const pct = x.ger > 0 ? (x.fis / x.ger) * 100 : null;
          return `<tr>
            <td style="font-weight:600;font-size:12px;">${escapeHtml(u.nombre)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${fmt(x.ger)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--green);">${fmt(x.fis)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--orange);">${fmt(x.ger - x.fis)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${pct === null ? '—' : pct.toFixed(0) + '%'}</td>
          </tr>`;
        }).join('')}
        <tr style="border-top:2px solid var(--border);font-weight:700;">
          <td style="text-transform:uppercase;font-size:11px;letter-spacing:.05em;">Total</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(b.totGer)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--green);">${fmt(b.totFis)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--orange);">${fmt(totNoDeducible)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;">${b.totGer > 0 ? ((b.totFis / b.totGer) * 100).toFixed(0) + '%' : '—'}</td>
        </tr></tbody>
      </table>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
      <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;">Pagos sin factura — requieren aprobación del admin (${pagosList.filter(x => !x.aprobado).length} pendientes)</div>
      <input type="text" id="fiscal-buscar" placeholder="🔍 Buscar beneficiario, partida..." oninput="fiscalFiltrarPagos()" style="width:260px;">
    </div>
    ${pagosList.length ? `
    <div class="table-wrap cf-tabla-scroll" style="margin-bottom:22px;max-height:420px;">
      <table>
        <thead><tr><th>Fecha</th><th>Beneficiario</th><th>Partida</th><th style="text-align:right">$ asignado</th><th>Estado</th><th style="text-align:right" class="req-admin">Acción</th></tr></thead>
        <tbody id="fiscal-pagos-tbody">${pagosList.map(x => {
          const h = x.h;
          const marca = _marcaFiscalDe('pago', h.id);
          return `<tr class="fiscal-p-row" data-buscar="${escapeHtml(`${h.nombre || ''} ${h.partida || ''} ${h.concepto || ''}`.toLowerCase().replace(/"/g, ''))}">
            <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(h.fecha)}</td>
            <td style="font-size:12px;font-weight:500;">${escapeHtml(h.nombre) || '—'}</td>
            <td style="font-size:11px;color:var(--muted);">${escapeHtml(h.partida) || 'Sin partida'}${h.sub_partida ? ' / ' + escapeHtml(h.sub_partida) : ''}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${fmt(x.monto)}</td>
            <td>${x.aprobado ? `<span style="font-size:10px;color:var(--green);" title="${escapeHtml((marca && (marca.motivo + ' · ' + marca.usuario_email)) || '')}">✅ deducible</span>` : '<span style="font-size:10px;color:var(--muted);">fuera del fiscal</span>'}</td>
            <td style="text-align:right;" class="req-admin">${sinTabla ? '' : (x.aprobado
              ? `<button class="btn btn-ghost btn-sm" onclick="fiscalMarcarPago('${h.id}', false)">↩️ Quitar</button>`
              : `<button class="btn btn-primary btn-sm" onclick="fiscalMarcarPago('${h.id}', true)">✅ Aprobar deducible</button>`)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '<div style="color:var(--muted);font-size:12px;margin-bottom:22px;">No hay pagos sin factura con reparto en este proyecto.</div>'}

    <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;margin-bottom:8px;">Facturas repartidas (${factList.length})</div>
    ${factList.length ? `
    <div class="table-wrap cf-tabla-scroll" style="max-height:360px;">
      <table>
        <thead><tr><th>Factura</th><th>Proveedor</th><th>Tipo</th><th style="text-align:right">$ repartido</th><th>Estado fiscal</th><th style="text-align:right" class="req-admin">Acción</th></tr></thead>
        <tbody>${factList.map(x => {
          const f = x.f;
          const marca = _marcaFiscalDe('factura', f.factura_id);
          return `<tr>
            <td style="font-size:12px;font-weight:500;">Fac ${escapeHtml(String(f.factura_id))}${f.numero_factura ? ' · ' + escapeHtml(f.numero_factura) : ''}</td>
            <td style="font-size:12px;">${escapeHtml(f.razon_social || f.nombre_proveedor || '')}</td>
            <td style="font-size:11px;color:var(--muted);">${escapeHtml(f.tipo_comprobante || 'Factura')}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${fmt(x.monto)}</td>
            <td>${x.cruzada ? `<span style="font-size:10px;color:var(--red);font-weight:600;" title="La factura está a ${escapeHtml(f.empresa || '')}, no a la empresa del proyecto: el SAT no la acepta para esta empresa. Si es error de captura, corrígela en Facturas con 🏢 Cambiar empresa.">⚠ empresa cruzada</span>`
              : x.auto ? '<span style="font-size:10px;color:var(--orange);" title="Este tipo de comprobante no es costo deducible (sería doble conteo)">🚫 auto-excluida</span>'
              : x.excluida ? `<span style="font-size:10px;color:var(--red);" title="${escapeHtml((marca && (marca.motivo + ' · ' + marca.usuario_email)) || '')}">🚫 excluida</span>`
              : '<span style="font-size:10px;color:var(--green);">✅ deducible</span>'}</td>
            <td style="text-align:right;" class="req-admin">${(sinTabla || x.auto || x.cruzada) ? '' : (x.excluida
              ? `<button class="btn btn-ghost btn-sm" onclick="fiscalMarcarFactura('${escapeHtml(String(f.factura_id))}', false)">↩️ Incluir</button>`
              : `<button class="btn btn-ghost btn-sm" style="color:var(--red);" onclick="fiscalMarcarFactura('${escapeHtml(String(f.factura_id))}', true)">🚫 Excluir</button>`)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '<div style="color:var(--muted);font-size:12px;">Aún no hay facturas repartidas en este proyecto.</div>'}
  `;
}

export function fiscalFiltrarPagos() {
  const q = (document.getElementById('fiscal-buscar')?.value || '').trim().toLowerCase();
  document.querySelectorAll('#fiscal-pagos-tbody .fiscal-p-row').forEach(row => {
    row.style.display = (!q || (row.dataset.buscar || '').includes(q)) ? '' : 'none';
  });
}

export async function fiscalMarcarPago(pagoId, aprobar) {
  if (!esAdmin()) { notify('Solo el admin puede marcar deducibilidad', 'error'); return; }
  if (state.cargado && state.cargado.fiscalMarcas !== true) { notify('Corre el SQL 36 en Supabase para activar las marcas', 'error'); return; }
  const ex = _marcaFiscalDe('pago', pagoId);
  if (aprobar) {
    if (ex && ex.incluir !== false) return;
    const motivo = prompt('Motivo (opcional) — ej. "nómina con recibos", "gasto deducible sin CFDI en sistema":');
    if (motivo === null) return;   // canceló
    const marca = ex || {
      marca_id: nuevoMarcaFiscalId(), doc_tipo: 'pago', doc_id: String(pagoId),
      incluir: true, motivo: '', usuario_email: '', created_at: new Date().toISOString()
    };
    marca.incluir = true;
    marca.motivo = motivo.trim();
    marca.usuario_email = (state.session && state.session.email) || '';
    if (!ex) state.fiscalMarcas.push(marca);
    sbGuardarFila('fiscalMarcas', marca);
    notify('✅ Pago aprobado como deducible');
  } else {
    if (!ex) return;
    state.fiscalMarcas = state.fiscalMarcas.filter(m => m !== ex);
    sbBorrarFila('fiscalMarcas', ex.marca_id);
    notify('Aprobación quitada: el pago sale del costo fiscal');
  }
  renderFisPanel();
}

export async function fiscalMarcarFactura(facturaId, excluir) {
  if (!esAdmin()) { notify('Solo el admin puede marcar deducibilidad', 'error'); return; }
  if (state.cargado && state.cargado.fiscalMarcas !== true) { notify('Corre el SQL 36 en Supabase para activar las marcas', 'error'); return; }
  const ex = _marcaFiscalDe('factura', facturaId);
  if (excluir) {
    if (ex && ex.incluir === false) return;
    const motivo = prompt('Motivo de la exclusión — ej. "no deducible", "gasto personal":');
    if (motivo === null) return;
    const marca = ex || {
      marca_id: nuevoMarcaFiscalId(), doc_tipo: 'factura', doc_id: String(facturaId),
      incluir: false, motivo: '', usuario_email: '', created_at: new Date().toISOString()
    };
    marca.incluir = false;
    marca.motivo = motivo.trim();
    marca.usuario_email = (state.session && state.session.email) || '';
    if (!ex) state.fiscalMarcas.push(marca);
    sbGuardarFila('fiscalMarcas', marca);
    notify('🚫 Factura excluida del costo fiscal');
  } else {
    if (!ex) return;
    state.fiscalMarcas = state.fiscalMarcas.filter(m => m !== ex);
    sbBorrarFila('fiscalMarcas', ex.marca_id);
    notify('Factura incluida de nuevo en el costo fiscal');
  }
  renderFisPanel();
}

export function fiscalExportar() {
  // Contabilidad SÍ exporta: este Excel existe justamente para ella.
  if (!puedeFiscal()) return;
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const b = fiscalBatch(fisProyecto);
  const unidades = unidadesDeProyecto(false, fisProyecto);
  const sello = _sello();
  const wb = XLSX.utils.book_new();
  const fmtMoney = (ws, aoa, cols, desde) => {
    for (let r = desde; r < aoa.length; r++) cols.forEach(c => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00';
    });
  };

  const aoa1 = [
    [`Costo FISCAL por casa — ${fisProyecto}`],
    [`Generado: ${sello.txt} · Regla: facturas (CFDI) + pagos aprobados por admin · apertura y no aprobados fuera`],
    [],
    ['Casa', 'Gerencial', 'Fiscal (deducible)', 'Diferencia', '% fiscal']
  ];
  unidades.forEach(u => {
    const x = b.porUnidad.get(String(u.unidad_id)) || { ger: 0, fis: 0 };
    aoa1.push([u.nombre, x.ger, x.fis, x.ger - x.fis, x.ger > 0 ? x.fis / x.ger : '']);
  });
  aoa1.push([]);
  aoa1.push(['TOTAL', b.totGer, b.totFis, b.totGer - b.totFis, b.totGer > 0 ? b.totFis / b.totGer : '']);
  const ws1 = XLSX.utils.aoa_to_sheet(aoa1);
  ws1['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 10 }];
  fmtMoney(ws1, aoa1, [1, 2, 3], 4);
  for (let r = 4; r < aoa1.length; r++) { const ref = XLSX.utils.encode_cell({ r, c: 4 }); if (ws1[ref] && typeof ws1[ref].v === 'number') ws1[ref].z = '0.0%'; }
  XLSX.utils.book_append_sheet(wb, ws1, 'Fiscal por casa');

  const aoa2 = [
    [`Pagos sin factura — estado de aprobación — ${fisProyecto}`],
    [],
    ['Fecha', 'Beneficiario', 'Partida', 'Sub-partida', '$ asignado', 'Estado', 'Motivo', 'Aprobó']
  ];
  [...b.pagosCand.values()].filter(x => x.h).sort((a, z) => z.monto - a.monto).forEach(x => {
    const marca = _marcaFiscalDe('pago', x.h.id);
    aoa2.push([fmtFecha(x.h.fecha), x.h.nombre || '', x.h.partida || '', x.h.sub_partida || '', x.monto,
      x.aprobado ? 'APROBADO deducible' : 'Fuera del fiscal', (marca && marca.motivo) || '', (marca && marca.usuario_email) || '']);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
  ws2['!cols'] = [{ wch: 11 }, { wch: 32 }, { wch: 18 }, { wch: 20 }, { wch: 13 }, { wch: 18 }, { wch: 30 }, { wch: 26 }];
  fmtMoney(ws2, aoa2, [4], 3);
  XLSX.utils.book_append_sheet(wb, ws2, 'Pagos sin factura');

  const aoa3 = [
    [`Facturas repartidas — estado fiscal — ${fisProyecto}`],
    [],
    ['Factura', 'Folio', 'Proveedor', 'Tipo comprobante', '$ repartido', 'Estado', 'Motivo', 'Marcó']
  ];
  [...b.factRep.values()].filter(x => x.f).sort((a, z) => z.monto - a.monto).forEach(x => {
    const marca = _marcaFiscalDe('factura', x.f.factura_id);
    aoa3.push([String(x.f.factura_id), x.f.numero_factura || '', x.f.razon_social || x.f.nombre_proveedor || '',
      x.f.tipo_comprobante || 'Factura', x.monto,
      x.cruzada ? 'EXCLUIDA (empresa cruzada)' : x.auto ? 'AUTO-excluida (tipo)' : x.excluida ? 'EXCLUIDA' : 'Deducible',
      (marca && marca.motivo) || '', (marca && marca.usuario_email) || '']);
  });
  const ws3 = XLSX.utils.aoa_to_sheet(aoa3);
  ws3['!cols'] = [{ wch: 9 }, { wch: 14 }, { wch: 32 }, { wch: 18 }, { wch: 13 }, { wch: 18 }, { wch: 30 }, { wch: 26 }];
  fmtMoney(ws3, aoa3, [4], 3);
  XLSX.utils.book_append_sheet(wb, ws3, 'Facturas');

  XLSX.writeFile(wb, `Fiscal_${String(fisProyecto || 'proyecto').replace(/[\\/:*?"<>|\s]+/g, '_')}_${sello.archivo}.xlsx`);
  notify('✅ Excel fiscal generado');
}

// ========== PESTAÑA: 📅 ESTIMADOS RMF 3.2.4 ==========
// Corte al 31/dic del ejercicio: cobros de casas vendidas NO escrituradas (la
// "cuenta de cobros por bienes no entregados" de la regla) + costo estimado por
// factor. TODO derivado de Ventas/Cobros/Presupuestos — cero SQL, cero escritura:
// el motor puro vive en rmf-324.js y esta vista solo lo pinta. El factor lo
// captura contabilidad (se guarda por ejercicio+proyecto en ESTE navegador,
// localStorage) y la app enseña a un lado el que sugiere con tus datos.

let estEjercicio = 0;   // ejercicio activo de la pestaña (0 = aún sin elegir)

// --- factor capturado en localStorage: { "2025": { "Proyecto": 0.62 } } ---
function _rmfCfgLeer() {
  try { return JSON.parse(localStorage.getItem('dt-rmf324') || '{}') || {}; } catch (e) { return {}; }
}
function _rmfFactorGet(ej, proy) {
  const cfg = _rmfCfgLeer();
  const v = cfg[String(ej)] && cfg[String(ej)][proy];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function _rmfFactorSet(ej, proy, factor) {
  const cfg = _rmfCfgLeer();
  const k = String(ej);
  if (factor == null) {
    if (cfg[k]) { delete cfg[k][proy]; if (!Object.keys(cfg[k]).length) delete cfg[k]; }
  } else {
    if (!cfg[k]) cfg[k] = {};
    cfg[k][proy] = factor;
  }
  try { localStorage.setItem('dt-rmf324', JSON.stringify(cfg)); } catch (e) { /* ignore */ }
}

// Arma los insumos del motor con fechas NORMALIZADAS (ISO) — los cobros vienen
// en formato mixto (UI = ISO, importador = DD/MM/YYYY): parseFechaHist unifica.
function _est324Insumos(ejercicio) {
  const ventasProy = (state.ventas || []).filter(v => v.proyecto === fisProyecto && v.activo !== false);
  const ventaIds = new Set(ventasProy.map(v => String(v.venta_id)));
  const uniNombre = new Map(state.unidades.map(u => [String(u.unidad_id), u.nombre]));
  const cliNombre = new Map((state.clientes || []).map(c => [String(c.cliente_id), c.nombre]));

  const ventas = ventasProy.map(v => ({
    ventaId: String(v.venta_id), unidadId: String(v.unidad_id),
    etiqueta: uniNombre.get(String(v.unidad_id)) || `Unidad ${v.unidad_id}`,
    cliente: cliNombre.get(String(v.cliente_id)) || '',
    precio: v.precio_venta || 0, estatus: v.estatus_comercial || 'apartada',
    fechaEscrituraISO: parseFechaHist(v.fecha_escritura_real) || '', activo: v.activo !== false,
  }));
  const cobros = (state.cobros || []).filter(c => ventaIds.has(String(c.venta_id))).map(c => ({
    ventaId: String(c.venta_id), fechaISO: parseFechaHist(c.fecha) || '',
    monto: c.monto || 0, activo: c.activo !== false,
  }));
  // Presupuesto y costo real por unidad para el factor SUGERIDO — misma regla
  // batch de Costos por Unidad (no se recalcula nada a mano).
  const cpb = costosPresupuestosBatch();
  const presupuestoPorUnidad = {}, costoRealPorUnidad = {};
  ventas.forEach(v => {
    const x = cpb.get(v.unidadId);
    if (x) { presupuestoPorUnidad[v.unidadId] = x.presupuesto || 0; costoRealPorUnidad[v.unidadId] = x.real || 0; }
  });
  return { ejercicio, ventas, cobros, presupuestoPorUnidad, costoRealPorUnidad };
}

// Años con actividad (cobros o escrituras) del proyecto + el año en curso.
function _est324Anios() {
  const anios = new Set([new Date().getFullYear()]);
  (state.cobros || []).forEach(c => {
    if (c.proyecto && c.proyecto !== fisProyecto) return;
    const iso = parseFechaHist(c.fecha); if (iso) anios.add(parseInt(iso.slice(0, 4), 10));
  });
  (state.ventas || []).forEach(v => {
    if (v.proyecto !== fisProyecto) return;
    const iso = parseFechaHist(v.fecha_escritura_real); if (iso) anios.add(parseInt(iso.slice(0, 4), 10));
  });
  return [...anios].filter(a => a >= 2000 && a <= 2100).sort((a, b) => b - a);
}

const _pctTxt = f => f == null ? '—' : (f * 100).toFixed(2) + '%';

function renderEstimadosTab(panel) {
  if (!puedeFiscal()) { panel.innerHTML = ''; return; }
  const anios = _est324Anios();
  if (!estEjercicio || !anios.includes(estEjercicio)) estEjercicio = anios[0] || new Date().getFullYear();

  const capturado = _rmfFactorGet(estEjercicio, fisProyecto);
  const r = estimados324(_est324Insumos(estEjercicio), clave => clave === 'factor' ? capturado : null);

  const sinIngresos = !(state.ventas || []).some(v => v.proyecto === fisProyecto);
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
      <label style="font-size:12px;color:var(--muted);">Ejercicio
        <select onchange="est324SetEjercicio(this.value)" style="margin-left:6px;">
          ${anios.map(a => `<option value="${a}"${a === estEjercicio ? ' selected' : ''}>${a}</option>`).join('')}
        </select>
      </label>
      <div style="font-size:12px;color:var(--muted);">Corte: <b style="color:var(--text);">31/dic/${estEjercicio}</b> · ${escapeHtml(fisProyecto)}</div>
      <div style="flex:1;"></div>
      <button class="btn btn-ghost btn-sm" onclick="est324Exportar()" title="Excel para contabilidad: registro por casa + reversiones + resumen">⬇ Excel</button>
    </div>

    ${sinIngresos ? '<div class="empty-state"><div style="font-size:28px;opacity:.4;margin-bottom:8px;">🏘️</div><div>Este proyecto no tiene ventas capturadas en Ingresos — el corte 3.2.4 sale de Ventas por Unidad y Cobranza.</div></div>' : `

    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <div style="font-size:12px;font-weight:600;">Factor de costo estimado</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <input type="number" id="est324-factor" step="0.01" min="0.01" max="150" value="${capturado != null ? (capturado * 100).toFixed(2) : ''}" placeholder="${r.factorSugerido != null ? (r.factorSugerido * 100).toFixed(2) : '—'}" style="width:90px;text-align:right;font-family:'DM Mono',monospace;">
        <span style="font-size:12px;color:var(--muted);">%</span>
        <button class="btn btn-ghost btn-sm" onclick="est324GuardarFactor()">Guardar</button>
        ${capturado != null ? '<button class="btn btn-ghost btn-sm" onclick="est324QuitarFactor()" title="Volver al factor sugerido">✕ Quitar</button>' : ''}
      </div>
      <div style="font-size:11px;color:var(--muted);">
        La app sugiere <b style="color:var(--accent);">${_pctTxt(r.factorSugerido)}</b>${r.factorSugeridoFuente ? ` (${r.factorSugeridoFuente} ÷ precio de las casas del registro)` : ''} —
        usando: <b style="color:var(--text);">${_pctTxt(r.factorUsado)} (${r.factorFuente})</b>. El factor fiscal lo decide tu contabilidad; se guarda por ejercicio y proyecto en este navegador.
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
      <div class="stat-card" title="Cobros acumulados al 31/dic de casas vendidas y NO escrituradas (registro de cobros por bienes no entregados)"><div class="stat-label">Base acumulable 3.2.4</div><div class="stat-value">${fmt(r.baseAcumulable)}</div><div class="stat-sub">${r.registro.length} casa(s) con cobros al corte</div></div>
      <div class="stat-card"><div class="stat-label">Costo estimado deducible</div><div class="stat-value" style="color:var(--green);">${fmt(r.costoEstimado)}</div><div class="stat-sub">base × ${_pctTxt(r.factorUsado)}</div></div>
      <div class="stat-card"><div class="stat-label">Neto acumulable</div><div class="stat-value" style="color:var(--orange);">${fmt(r.neto)}</div><div class="stat-sub">base − costo estimado</div></div>
      <div class="stat-card" title="Casas escrituradas dentro del ejercicio: se acumula su precio total y se revierte lo antes acumulado con su estimado"><div class="stat-label">Reversión del ejercicio</div><div class="stat-value">${fmt(r.totReversionCobrado)}</div><div class="stat-sub">${r.reversiones.length} escriturada(s) · precio ${fmt(r.totPrecioEscriturado)}</div></div>
    </div>

    ${r.avisos.length ? `<div style="background:rgba(224,122,58,.1);border:1px solid rgba(224,122,58,.35);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;">
      <b>⚠ Avisos del corte</b><ul style="margin:6px 0 0 18px;padding:0;">${r.avisos.map(a => `<li style="margin-bottom:3px;">${escapeHtml(a)}</li>`).join('')}</ul></div>` : ''}

    <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;margin-bottom:8px;">Registro por casa — cobros de bienes NO escriturados al 31/dic/${estEjercicio}</div>
    ${r.registro.length ? `
    <div class="table-wrap cf-tabla-scroll" style="margin-bottom:22px;max-height:420px;">
      <table>
        <thead><tr><th>Casa</th><th>Cliente</th><th style="text-align:right">Precio de venta</th><th style="text-align:right">Cobrado al corte</th><th style="text-align:right">% del precio</th></tr></thead>
        <tbody>${r.registro.map(x => `<tr>
          <td style="font-weight:600;font-size:12px;">${escapeHtml(x.etiqueta)}</td>
          <td style="font-size:12px;">${escapeHtml(x.cliente) || '—'}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${fmt(x.precio)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${fmt(x.cobradoAlCorte)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${x.pctPrecio == null ? '—' : x.pctPrecio.toFixed(0) + '%'}</td>
        </tr>`).join('')}
        <tr style="border-top:2px solid var(--border);font-weight:700;">
          <td style="text-transform:uppercase;font-size:11px;letter-spacing:.05em;">Total</td><td></td><td></td>
          <td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(r.baseAcumulable)}</td><td></td>
        </tr></tbody>
      </table>
    </div>` : '<div style="color:var(--muted);font-size:12px;margin-bottom:22px;">Ninguna casa sin escriturar tiene cobros al corte de este ejercicio.</div>'}

    <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;margin-bottom:8px;">Escrituradas en ${estEjercicio} — reversión (${r.reversiones.length})</div>
    ${r.reversiones.length ? `
    <div class="table-wrap" style="margin-bottom:22px;">
      <table>
        <thead><tr><th>Casa</th><th>Cliente</th><th>Escriturada el</th><th style="text-align:right">Precio (se acumula)</th><th style="text-align:right">Cobrado al cierre ${estEjercicio - 1} (se revierte)</th></tr></thead>
        <tbody>${r.reversiones.map(x => `<tr>
          <td style="font-weight:600;font-size:12px;">${escapeHtml(x.etiqueta)}</td>
          <td style="font-size:12px;">${escapeHtml(x.cliente) || '—'}</td>
          <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">${fmtFecha(x.fechaEscrituraISO)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;">${fmt(x.precio)}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--orange);">${fmt(x.cobradoAlCierreAnterior)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : '<div style="color:var(--muted);font-size:12px;margin-bottom:22px;">Ninguna casa del proyecto se escrituró en este ejercicio.</div>'}

    <details style="margin-bottom:10px;"><summary style="cursor:pointer;font-size:12px;color:var(--muted);">🔍 Desglose auditable del cálculo</summary>
      <pre style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;white-space:pre-wrap;">${escapeHtml(r.desglose.join('\n'))}</pre>
    </details>
    <details><summary style="cursor:pointer;font-size:12px;color:var(--muted);">📖 Qué es la regla 3.2.4 y qué hace esta vista</summary>
      <div style="font-size:12px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;line-height:1.6;">
        La regla <b>3.2.4 de la RMF</b> permite que los cobros de casas vendidas pero <b>aún no escrituradas</b> (enganches, mensualidades) no se acumulen mes a mes: se acumula al <b>cierre del ejercicio</b> el saldo cobrado pendiente de entrega, deduciendo un <b>costo de lo vendido estimado</b> (saldo × factor). Al escriturar, se acumula el precio total y se revierte lo estimado. Exige llevar un <b>registro de cobros por bien no entregado</b> — este es exactamente ese registro, armado con tus Ventas y Cobranza.<br>
        <b>Esta vista solo informa</b>: no escribe nada, no toca saldos ni costos gerenciales, y el factor definitivo lo determina tu contabilidad. Confirma el tratamiento con tus fiscalistas antes de declarar.
      </div>
    </details>
    `}
  `;
}

export function est324SetEjercicio(v) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n)) estEjercicio = n;
  renderFisPanel();
}

export function est324GuardarFactor() {
  const pct = parseFloat(document.getElementById('est324-factor')?.value);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 150) { notify('Factor inválido: captúralo en % (ej. 62.5), mayor a 0 y hasta 150', 'error'); return; }
  _rmfFactorSet(estEjercicio, fisProyecto, pct / 100);
  notify(`✅ Factor ${pct.toFixed(2)}% guardado para ${estEjercicio} · ${fisProyecto} (este navegador)`);
  renderFisPanel();
}

export function est324QuitarFactor() {
  _rmfFactorSet(estEjercicio, fisProyecto, null);
  notify('Factor capturado quitado: se usa el sugerido');
  renderFisPanel();
}

export function est324Exportar() {
  if (!puedeFiscal()) return;
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const capturado = _rmfFactorGet(estEjercicio, fisProyecto);
  const r = estimados324(_est324Insumos(estEjercicio), clave => clave === 'factor' ? capturado : null);
  const sello = _sello();
  const wb = XLSX.utils.book_new();
  const fmtMoney = (ws, aoa, cols, desde) => {
    for (let row = desde; row < aoa.length; row++) cols.forEach(c => {
      const ref = XLSX.utils.encode_cell({ r: row, c });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00';
    });
  };

  const aoa1 = [
    [`Registro RMF 3.2.4 — cobros por bienes NO escriturados — ${fisProyecto}`],
    [`Corte: 31/dic/${estEjercicio} · Generado: ${sello.txt} · Factor ${r.factorFuente}: ${_pctTxt(r.factorUsado)}`],
    [],
    ['Casa', 'Cliente', 'Precio de venta', 'Cobrado al corte', '% del precio']
  ];
  r.registro.forEach(x => aoa1.push([x.etiqueta, x.cliente, x.precio, x.cobradoAlCorte, x.pctPrecio != null ? x.pctPrecio / 100 : '']));
  aoa1.push([]);
  aoa1.push(['TOTAL (base acumulable)', '', '', r.baseAcumulable, '']);
  const ws1 = XLSX.utils.aoa_to_sheet(aoa1);
  ws1['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 15 }, { wch: 16 }, { wch: 11 }];
  fmtMoney(ws1, aoa1, [2, 3], 4);
  for (let row = 4; row < aoa1.length; row++) { const ref = XLSX.utils.encode_cell({ r: row, c: 4 }); if (ws1[ref] && typeof ws1[ref].v === 'number') ws1[ref].z = '0.0%'; }
  XLSX.utils.book_append_sheet(wb, ws1, 'Registro por casa');

  const aoa2 = [
    [`Escrituradas en ${estEjercicio} — reversión — ${fisProyecto}`],
    [],
    ['Casa', 'Cliente', 'Escriturada el', 'Precio (se acumula)', `Cobrado al cierre ${estEjercicio - 1} (se revierte)`]
  ];
  r.reversiones.forEach(x => aoa2.push([x.etiqueta, x.cliente, x.fechaEscrituraISO, x.precio, x.cobradoAlCierreAnterior]));
  aoa2.push([]);
  aoa2.push(['TOTAL', '', '', r.totPrecioEscriturado, r.totReversionCobrado]);
  const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
  ws2['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 14 }, { wch: 17 }, { wch: 24 }];
  fmtMoney(ws2, aoa2, [3, 4], 3);
  XLSX.utils.book_append_sheet(wb, ws2, 'Reversiones');

  const aoa3 = [
    [`Resumen RMF 3.2.4 — ${fisProyecto} — ejercicio ${estEjercicio}`],
    [`Generado: ${sello.txt}`],
    [],
    ['Concepto', 'Valor'],
    ['Base acumulable (cobros al corte de bienes no escriturados)', r.baseAcumulable],
    [`Factor usado (${r.factorFuente})`, r.factorUsado],
    ['Factor sugerido por la app', r.factorSugerido != null ? r.factorSugerido : ''],
    ['Costo estimado deducible', r.costoEstimado],
    ['Neto acumulable', r.neto],
    [`Reversión: cobrado al cierre ${estEjercicio - 1} de escrituradas en ${estEjercicio}`, r.totReversionCobrado],
    ['Reversión: precio total que se acumula al escriturar', r.totPrecioEscriturado],
    [],
    ['Desglose auditable'],
    ...r.desglose.map(d => [d]),
    ...(r.avisos.length ? [[], ['Avisos'], ...r.avisos.map(a => ['⚠ ' + a])] : []),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(aoa3);
  ws3['!cols'] = [{ wch: 58 }, { wch: 18 }];
  fmtMoney(ws3, aoa3, [1], 4);
  const refF = XLSX.utils.encode_cell({ r: 5, c: 1 }); if (ws3[refF] && typeof ws3[refF].v === 'number') ws3[refF].z = '0.00%';
  const refS = XLSX.utils.encode_cell({ r: 6, c: 1 }); if (ws3[refS] && typeof ws3[refS].v === 'number') ws3[refS].z = '0.00%';
  XLSX.utils.book_append_sheet(wb, ws3, 'Resumen');

  XLSX.writeFile(wb, `RMF324_${String(fisProyecto || 'proyecto').replace(/[\\/:*?"<>|\s]+/g, '_')}_${estEjercicio}_${sello.archivo}.xlsx`);
  notify('✅ Excel 3.2.4 generado');
}

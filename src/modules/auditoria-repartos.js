// ============================================================================
// 🩺 Auditar repartos (solo admin, SOLO LECTURA). Recorre TODOS los repartos
// reales con las reglas de la app y entrega un Excel de hallazgos + un resumen
// en pantalla. No modifica nada: es la fase "medir" (medir → blindar → reparar).
// El cálculo vive en el motor puro src/services/auditoria-repartos-motor.js.
// ============================================================================
import { state, esAdmin } from '../state.js';
import { fmt, fmtFecha, escapeHtml } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { parseFechaHist } from './historial.js';
import { proyectoMatch } from '../config/proyectos.js';
import { fechaCierreUnidad } from '../config/costos-fiscales.js';
import { _pagosCubiertosPorFacturaSet, _pagosCapitalSet } from './costos-fiscales.js';
import { auditarRepartosMotor, resumirAuditoria } from '../services/auditoria-repartos-motor.js';

let _ultimo = null;   // { hallazgos, resumen, sello } de la última corrida (para re-descargar)

function _sello() {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return { txt: `${fmtFecha(iso)} ${p2(d.getHours())}:${p2(d.getMinutes())}`, archivo: `${iso}_${p2(d.getHours())}${p2(d.getMinutes())}` };
}

const _SEV_COLOR = { ERROR: 'var(--red)', REVISAR: 'var(--orange)', INFO: 'var(--muted)' };

export function auditarRepartosTodo() {
  if (!esAdmin()) { notify('Solo el admin puede auditar los repartos', 'error'); return; }
  // Sin los datos completos, un reparto sano parecería "huérfano": no se audita a medias.
  const faltan = ['costoAsignaciones', 'facturas', 'historial', 'unidades', 'facturaPagos'].filter(k => state.cargado && state.cargado[k] !== true);
  if (faltan.length) { notify(`No se puede auditar: no cargó completo (${faltan.join(', ')}). Recarga la página.`, 'error'); return; }
  // Sin ventas, el cierre por ESCRITURA no se ve (solo la terminación): se audita, pero avisando.
  const sinVentas = !(state.cargado && state.cargado.ventas === true);
  const hallazgos = auditarRepartosMotor({
    asigs: state.costoAsignaciones, facturas: state.facturas || [], historial: state.historial,
    unidades: state.unidades, facturaPagos: state.facturaPagos || [],
  }, {
    parseFecha: parseFechaHist, cierreDe: fechaCierreUnidad, proyMatch: proyectoMatch,
    cubiertos: _pagosCubiertosPorFacturaSet(), capital: _pagosCapitalSet(),
  });
  _ultimo = { hallazgos, resumen: resumirAuditoria(hallazgos), sello: _sello(), sinVentas };
  console.table(_ultimo.resumen.map(r => ({ CATEGORIA: r.titulo, SEVERIDAD: r.sev, FILAS: r.filas, DOCS: r.docs, MONTO: Math.round(r.monto * 100) / 100 })));
  _modal();
  descargarAuditoriaRepartos();
}

export function descargarAuditoriaRepartos() {
  if (!_ultimo) { auditarRepartosTodo(); return; }
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const { hallazgos, resumen, sello, sinVentas } = _ultimo;
  const money = (ws, r0, cols, n) => {
    for (let r = r0; r < n; r++) cols.forEach(c => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00';
    });
  };
  const wb = XLSX.utils.book_new();

  // --- Resumen ---
  const aoaR = [
    ['🩺 Auditoría de repartos — todos los proyectos'],
    [`Corte: ${sello.txt} · Solo lectura: no se modificó nada. ERROR = el costo por casa está mal · REVISAR = puede estar mal o ser legítimo · INFO = no afecta el costo hoy.${sinVentas ? ' ⚠ Las ventas no cargaron: el cierre por ESCRITURA no se consideró (solo la terminación).' : ''}`],
    [],
    ['Categoría', 'Severidad', 'Filas', 'Documentos / casas', '$ afectado', 'Qué hacer'],
  ];
  resumen.forEach(r => aoaR.push([r.titulo, r.sev, r.filas, r.docs, r.monto, r.accion]));
  if (!resumen.length) aoaR.push(['Sin hallazgos: todos los repartos pasan los chequeos.']);
  const wsR = XLSX.utils.aoa_to_sheet(aoaR);
  wsR['!cols'] = [{ wch: 52 }, { wch: 16 }, { wch: 8 }, { wch: 18 }, { wch: 16 }, { wch: 90 }];
  money(wsR, 4, [4], aoaR.length);
  XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');

  // --- Detalle ---
  const titulo = new Map(resumen.map(r => [r.key, r.titulo]));
  const accion = new Map(resumen.map(r => [r.key, r.accion]));
  const aoaD = [['Categoría', 'Severidad', 'Proyecto', 'Casa', 'Cierre de la casa', 'Tipo', 'Documento', 'Proveedor / Beneficiario',
    'Fecha documento', 'Método', 'Partida', 'Sub-partida', 'Monto', 'Total documento', 'Repartido del documento', 'Detalle', 'Qué hacer', 'ID reparto']];
  hallazgos.forEach(x => aoaD.push([
    titulo.get(x.cat) || x.cat, x.sev, x.proyecto || '', x.casa || '', x.cierre ? fmtFecha(x.cierre) : '', x.tipo,
    x.ref || '', x.quien || '', x.fechaIso ? fmtFecha(x.fechaIso) : '', x.metodo || '', x.partida || '', x.sub || '',
    x.monto || 0, x.total || 0, x.suma || 0, x.detalle || '', accion.get(x.cat) || '', x.asignacionId || '',
  ]));
  const wsD = XLSX.utils.aoa_to_sheet(aoaD);
  wsD['!cols'] = [{ wch: 40 }, { wch: 9 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 28 }, { wch: 12 },
    { wch: 10 }, { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 15 }, { wch: 15 }, { wch: 60 }, { wch: 60 }, { wch: 22 }];
  wsD['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoaD.length - 1, 1), c: 17 } }) };
  money(wsD, 1, [12, 13, 14], aoaD.length);
  XLSX.utils.book_append_sheet(wb, wsD, 'Detalle');

  // --- Por casa (lo que le pega a cada casa) ---
  const porCasa = new Map();
  hallazgos.forEach(x => {
    if (!x.unidadId) return;
    // Una fila por CASA (por su id), con el proyecto de la casa: el nombre del proyecto
    // en cada documento puede venir escrito distinto y partía la misma casa en varias.
    const k = x.unidadId;
    let c = porCasa.get(k);
    if (!c) { c = { proyecto: x.proyectoCasa || x.proyecto, casa: x.casa, cierre: x.cierre, n: 0, pcErr: 0, pcRev: 0, dup: 0, otras: new Set() }; porCasa.set(k, c); }
    c.n++;
    if (x.cat === 'posterior_cierre') { if (x.sev === 'ERROR') c.pcErr += x.monto || 0; else c.pcRev += x.monto || 0; }
    else if (x.cat === 'duplicado') c.dup += x.monto || 0;
    else c.otras.add(titulo.get(x.cat) || x.cat);
  });
  const aoaC = [['Proyecto', 'Casa', 'Cierre', 'Hallazgos', '$ posterior al cierre (automático)', '$ posterior al cierre (dirigido)', '$ duplicado', 'Otros hallazgos']];
  [...porCasa.values()].sort((a, b) => (b.pcErr + b.pcRev + b.dup) - (a.pcErr + a.pcRev + a.dup))
    .forEach(c => aoaC.push([c.proyecto, c.casa, c.cierre ? fmtFecha(c.cierre) : '', c.n, c.pcErr, c.pcRev, c.dup, [...c.otras].join(' · ')]));
  const wsC = XLSX.utils.aoa_to_sheet(aoaC);
  wsC['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 70 }];
  wsC['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoaC.length - 1, 1), c: 7 } }) };
  money(wsC, 1, [4, 5, 6], aoaC.length);
  XLSX.utils.book_append_sheet(wb, wsC, 'Por casa');

  XLSX.writeFile(wb, `Auditoria_repartos_${sello.archivo}.xlsx`);
  notify('🩺 Auditoría descargada');
}

function _modal() {
  const { resumen, hallazgos, sello, sinVentas } = _ultimo;
  let el = document.getElementById('modal-auditoria-rep');
  if (!el) {
    el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'modal-auditoria-rep';
    document.body.appendChild(el);
  }
  const nErr = hallazgos.filter(x => x.sev === 'ERROR').length;
  const nRev = hallazgos.filter(x => x.sev === 'REVISAR').length;
  el.innerHTML = `
    <div class="modal" style="max-width:820px;">
      <div class="modal-header">
        <div class="modal-title">🩺 Auditoría de repartos</div>
        <button class="modal-close" onclick="cerrar('modal-auditoria-rep')">✕</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">
        Corte ${escapeHtml(sello.txt)} · todos los proyectos · <strong>solo lectura, no se cambió nada</strong>.
        <span style="color:var(--red);font-weight:600;">${nErr} error(es)</span> · <span style="color:var(--orange);font-weight:600;">${nRev} por revisar</span>.
        El detalle (casa por casa y documento por documento) está en el Excel descargado.
        ${sinVentas ? '<br><span style="color:var(--orange);">⚠ Las ventas no cargaron: el cierre por escritura no se consideró (solo la terminación).</span>' : ''}
      </div>
      ${resumen.length ? `<div class="table-wrap" style="max-height:60vh;overflow:auto;">
        <table>
          <thead><tr><th>Categoría</th><th>Severidad</th><th style="text-align:right">Filas</th><th style="text-align:right">Docs / casas</th><th style="text-align:right">$ afectado</th></tr></thead>
          <tbody>${resumen.map(r => `<tr title="${escapeHtml(r.accion)}">
            <td style="font-size:12px;">${escapeHtml(r.titulo)}</td>
            <td style="font-size:11px;font-weight:700;color:${_SEV_COLOR[r.sev.split(' / ')[0]] || 'var(--muted)'};">${escapeHtml(r.sev)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;">${r.filas}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;">${r.docs}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace;">${fmt(r.monto)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>` : '<div style="padding:18px;color:var(--green);font-weight:600;">✅ Sin hallazgos: todos los repartos pasan los chequeos.</div>'}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
        <button class="btn btn-ghost" onclick="descargarAuditoriaRepartos()">⬇ Descargar Excel otra vez</button>
        <button class="btn btn-primary" onclick="cerrar('modal-auditoria-rep')">Cerrar</button>
      </div>
    </div>`;
  el.classList.add('open');
}

// ============================================================================
// 🔧 Rehacer repartos por CIERRE · 🧹 Quitar duplicados · ↩️ Restaurar casas
// reabiertas · 📜 Bitácora. Solo admin. El plan lo hace el motor puro
// src/services/rehacer-cierre-motor.js; aquí: vista previa + respaldo en Excel,
// confirmación, registro del LOTE, aplicación y guardado. Cada cambio a las filas
// queda además en reparto_bitacora por el trigger del SQL 46 (antes/después, quién).
//
// Orden seguro de cada corrida (nunca queda algo aplicado sin su lote):
//   guardar lo pendiente → plan → Excel → confirm → prueba en copia (nada repartido
//   de más) → LOTE registrado → re-plan en ese instante (si otra sesión cambió algo,
//   no se aplica y el lote se anula) → aplicar → guardar (borrando primero; si se
//   cae, "Reintentar guardado"; si el guardado se niega de entrada, se deshace).
// Todo pasa por una sola fila: nunca corren dos a la vez.
// ============================================================================
import { state, esAdmin, nuevoAsignacionId } from '../state.js';
import { fmt, fmtFecha } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { parseFechaHist } from './historial.js';
import { proyectoMatch } from '../config/proyectos.js';
import { fechaCierreUnidad, hoyISOLocal, invalidarCierres } from '../config/costos-fiscales.js';
import { _pagosCubiertosPorFacturaSet, _pagosCapitalSet } from './costos-fiscales.js';
import { gsSaveCostoAsignaciones, estadoGuardadoAsignaciones, ingresosDataActiva } from '../services/google-sync.js';
import { sbLoadTable, sbInsertRow } from '../services/supabase-data.js';
import { planRehacerCierre, planRestaurar, planDuplicados, aplicarAcciones, partesLote, firmaPlan, sobreRepartidos } from '../services/rehacer-cierre-motor.js';
import { auditarRepartosMotor } from '../services/auditoria-repartos-motor.js';

const MSG_LOTES = 'No pude leer los lotes de repartos: ¿falta correr el SQL 46 (bitácora de repartos) en Supabase, o se cortó la conexión? No se cambió nada.';
const ICONO = { rehacer_cierre: '🔧', quitar_duplicado: '🧹', restaurar: '↩️' };

function _reglas() {
  return {
    parseFecha: parseFechaHist, cierreDe: fechaCierreUnidad, proyMatch: proyectoMatch,
    cubiertos: _pagosCubiertosPorFacturaSet(), capital: _pagosCapitalSet(),
  };
}
function _datos() {
  return { asigs: state.costoAsignaciones, facturas: state.facturas || [], historial: state.historial, unidades: state.unidades };
}
function _sello() {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return { txt: `${fmtFecha(iso)} ${p2(d.getHours())}:${p2(d.getMinutes())}`, archivo: `${iso}_${p2(d.getHours())}${p2(d.getMinutes())}` };
}
const _nombre = uid => { const u = state.unidades.find(x => String(x.unidad_id) === String(uid)); return u ? u.nombre : `(id ${uid})`; };
const _usuario = () => (state.session && state.session.email) || '';
const _kDoc = a => (a.docTipo === 'factura' ? 'F' : 'P') + a.docId;
const _nDocs = l => new Set(l.map(_kDoc)).size;

// El resumen de 🩺 queda con números viejos detrás de la reparación: se cierra.
function _cerrarModalAuditoria() {
  const m = document.getElementById('modal-auditoria-rep');
  if (m) m.classList.remove('open');
}

// Aviso flotante de avance mientras se guarda (el modal de 🩺 ya se cerró).
function _progreso(txt) {
  let el = document.getElementById('rr-progreso-flotante');
  if (txt == null) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'rr-progreso-flotante';
    el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#1a1a1a;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.3);';
    document.body.appendChild(el);
  }
  el.textContent = txt;
}

// Una sola fila para 🔧 / 🧹 / ↩️ / disparador por casa: nunca dos a la vez.
let _cola = Promise.resolve();
let _corriendo = 0;
function _enCola(fn, avisarSiEspera) {
  if (avisarSiEspera && _corriendo) notify('Quedó en fila detrás de otra corrida de repartos: arranca en cuanto termine');
  const p = _cola.then(async () => { _corriendo++; try { return await fn(); } finally { _corriendo--; } });
  _cola = p.catch(() => {});
  return p;
}
// Para 🔄 Refrescar / "versión nueva": no recargar a media corrida.
export function rehacerEnCurso() { return _corriendo > 0; }

const _pausa = ms => new Promise(r => setTimeout(r, ms));
const _conTope = (p, ms) => Promise.race([p, _pausa(ms).then(() => null)]);

// Si hay un guardado de repartos en curso, lo espera (hasta ~60 s).
async function _esperarGuardado(maxMs = 60000) {
  if (!estadoGuardadoAsignaciones().enCurso) return true;
  notify('Esperando a que termine un guardado de repartos…');
  const t0 = Date.now();
  while (estadoGuardadoAsignaciones().enCurso && Date.now() - t0 < maxMs) await _pausa(500);
  return !estadoGuardadoAsignaciones().enCurso;
}

// ¿Se puede operar? Admin y datos completos (con ventas: sin ellas no se ve la escritura).
function _listo() {
  if (!esAdmin()) { notify('Solo el admin puede rehacer repartos', 'error'); return false; }
  const req = ['costoAsignaciones', 'facturas', 'historial', 'unidades', 'facturaPagos'];
  if (ingresosDataActiva()) req.push('ventas');
  const faltan = req.filter(k => !(state.cargado && state.cargado[k] === true));
  if (faltan.length) { notify(`No se puede: no cargó completo (${faltan.join(', ')}). Recarga la página.`, 'error'); return false; }
  return true;
}

// Lotes anteriores (para restaurar y para la bitácora). null = no se pudieron leer
// (falta el SQL 46 o falló la conexión; tope de 30 s).
async function _cargarLotes() {
  const rows = await _conTope(sbLoadTable('reparto_lotes', 'lote_id'), 30000);
  if (!rows) return null;
  return rows.map(r => ({ ...r, detalle: typeof r.detalle === 'string' ? (() => { try { return JSON.parse(r.detalle); } catch (_) { return {}; } })() : (r.detalle || {}) }));
}

// ---------- Excel de vista previa = RESPALDO del antes ----------
function _excel(titulo, acciones, sello, tipoArchivo) {
  const wb = XLSX.utils.book_new();
  const money = (ws, r0, cols, n) => { for (let r = r0; r < n; r++) cols.forEach(c => { const ref = XLSX.utils.encode_cell({ r, c }); if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"$"#,##0.00'; }); };
  // Documentos
  const aoaD = [[titulo], [`Corte: ${sello.txt} · Vista previa y RESPALDO del estado ANTES del cambio.`], [],
    ['Acción', 'Documento', 'Proveedor / Beneficiario', 'Fecha', 'Proyecto', 'Partida', 'Sub-partida', 'Método', 'Monto de la parte',
      'Casas antes', 'Casas después', 'Salen (cerradas)', 'Entran', 'Motivo']];
  acciones.forEach(a => {
    const antes = a.antes || (a.quitar || []);
    aoaD.push([a.tipo, a.ref || '', a.quien || '', a.fechaIso ? fmtFecha(a.fechaIso) : '', a.proyecto || '', a.partida || '', a.sub || '',
      a.metodo || '', a.montoParte != null ? a.montoParte : (a.sumaAntes || 0),
      antes.map(x => `${_nombre(x.unidad_id)} ${fmt(x.monto != null ? x.monto : x.monto_asignado)}`).join(' · '),
      a.despues ? a.despues.map(x => `${_nombre(x.unidad_id)} ${fmt(x.monto)}`).join(' · ') : (a.tipo === 'quitar_duplicado' ? `(queda ${fmt(a.sumaDespues)})` : '—'),
      (a.quitadas || []).map(q => _nombre(q.unidad_id)).join(', ') || (a.quitar || []).map(q => _nombre(q.unidad_id)).join(', '),
      (a.entran || []).map(_nombre).join(', '), a.motivo || '']);
  });
  const wsD = XLSX.utils.aoa_to_sheet(aoaD);
  wsD['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 26 }, { wch: 11 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 15 }, { wch: 60 }, { wch: 60 }, { wch: 30 }, { wch: 20 }, { wch: 60 }];
  money(wsD, 4, [8], aoaD.length);
  XLSX.utils.book_append_sheet(wb, wsD, 'Documentos');
  // Por casa: cambio neto
  const neto = new Map();
  const suma = (uid, k, m) => { const c = neto.get(String(uid)) || { antes: 0, despues: 0 }; c[k] += m || 0; neto.set(String(uid), c); };
  acciones.forEach(a => {
    if (a.tipo === 'revisar') return;
    (a.antes || []).forEach(x => suma(x.unidad_id, 'antes', x.monto));
    (a.despues || []).forEach(x => suma(x.unidad_id, 'despues', x.monto));
    (a.quitar || []).forEach(x => suma(x.unidad_id, 'antes', x.monto_asignado));
  });
  const aoaC = [['Casa', 'Antes', 'Después', 'Cambio']];
  [...neto.entries()].sort((x, y) => (x[1].despues - x[1].antes) - (y[1].despues - y[1].antes))
    .forEach(([uid, c]) => aoaC.push([_nombre(uid), c.antes, c.despues, c.despues - c.antes]));
  const wsC = XLSX.utils.aoa_to_sheet(aoaC);
  wsC['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  money(wsC, 1, [1, 2, 3], aoaC.length);
  XLSX.utils.book_append_sheet(wb, wsC, 'Por casa');
  XLSX.writeFile(wb, `Rehacer_repartos_${tipoArchivo}_${sello.archivo}.xlsx`);
}

function _resumenTexto(acciones) {
  const por = t => acciones.filter(a => a.tipo === t);
  const monto = l => l.reduce((s, a) => s + (a.quitadas || []).reduce((x, q) => x + (q.monto || 0), 0), 0);
  const rec = por('recolocar'), pen = por('pendiente'), rev = por('revisar'), res = por('restaurar');
  return [
    rec.length ? `• ${_nDocs(rec)} documento(s) se RECOLOCAN: salen ${fmt(monto(rec))} de casas cerradas y se reparten entre las abiertas.` : '',
    pen.length ? `• ${_nDocs(pen)} documento(s) quedan PENDIENTES (${fmt(monto(pen))}): ninguna casa estaba abierta a su fecha.` : '',
    res.length ? `• ${_nDocs(res)} documento(s) RECUPERAN casas reabiertas.` : '',
    rev.length ? `• ${_nDocs(rev)} documento(s) NO se tocan: van a revisión a mano (motivo en el Excel).` : '',
  ].filter(Boolean).join('\n');
}

// Lote que se registró pero NO se aplicó: se marca para que restaurar lo ignore.
async function _anular(loteId, motivo) {
  try {
    await sbInsertRow('reparto_lotes', { lote_id: `${loteId}-anulado`, usuario: _usuario(), tipo: 'anulado', motivo, detalle: { anula: loteId } });
  } catch (e) {
    console.warn('No se pudo anular el lote', loteId, e);
    notify(`⚠️ No se pudo marcar como anulado el lote ${loteId} (${(e && e.message) || e}). No hace daño: sus casas siguen en sus repartos, pero en 📜 Bitácora aparecerá como si se hubiera aplicado.`, 'error');
  }
}

// Guarda en ciclo mientras el usuario quiera reintentar. Un rechazo "de entrada"
// (sin sesión, sin permiso, datos sin cargar: ese intento no escribió nada) no se
// reintenta: lo decide quien llama. Devuelve { ok, rechazo, primero } — primero =
// el rechazo fue en el 1er intento, o sea que NADA de esta corrida llegó a la base.
async function _guardarConReintento() {
  const tick = setInterval(() => { const g = estadoGuardadoAsignaciones(); _progreso(`Guardando repartos… faltan ${g.pendientes}`); }, 500);
  let intento = 0;
  try {
    for (;;) {
      intento++;
      _progreso('Guardando repartos…');
      const g = await gsSaveCostoAsignaciones({ borrarPrimero: true });
      if (g && g.ok) return { ok: true };
      if (!g || g.motivo !== 'error') return { ok: false, rechazo: (g && g.motivo) || 'error', primero: intento === 1 };
      if (!confirm(`⚠️ El guardado no terminó (${g.error || 'error de conexión'}).\n\nLos cambios siguen en esta pantalla (${g.pendientes || 0} por subir o borrar). NO recargues la página.\n\n¿Reintentar guardado ahora?`)) {
        notify('⚠️ Quedaron repartos SIN GUARDAR en esta pantalla: no recargues. 🔄 Refrescar (o volver a correr la herramienta) ofrece reintentar el guardado.', 'error');
        return { ok: false };
      }
    }
  } finally {
    clearInterval(tick);
    _progreso(null);
  }
}

function _render() {
  if (window.renderCostosFiscales) window.renderCostosFiscales();
  if (window.renderFacturas) window.renderFacturas();
}

// Verificación al terminar, SOLO sobre los documentos que tocó esta corrida: ninguno
// repartido de más y (en 🔧) ningún automático/elegidas en casas cerradas, salvo los
// que se mandaron a revisión a mano.
function _verificar(tipo, res, aplicables, acciones) {
  const tocados = new Set(aplicables.map(_kDoc));
  const revisar = new Set(acciones.filter(a => a.tipo === 'revisar').map(_kDoc));
  const inesperadas = tipo !== 'rehacer_cierre' ? [] : auditarRepartosMotor({ ..._datos(), facturaPagos: state.facturaPagos || [] }, _reglas())
    .filter(x => x.cat === 'posterior_cierre' && x.sev !== 'INFO' && (x.metodo === 'indiviso' || x.metodo === 'indiviso_sel'))
    .filter(x => { const k = (x.tipo === 'factura' ? 'F' : 'P') + x.docId; return tocados.has(k) && !revisar.has(k); });
  const sobre = sobreRepartidos(_datos(), aplicables);
  const hecho = `${ICONO[tipo] || ''} Hecho: ${res.actualizadas} actualizadas · ${res.creadas} nuevas · ${res.quitadas} quitadas`;
  if (sobre.length || inesperadas.length) {
    notify(`${hecho}, PERO ${sobre.length ? `${sobre.length} documento(s) quedaron repartidos de más` : ''}${sobre.length && inesperadas.length ? ' y ' : ''}${inesperadas.length ? `${inesperadas.length} fila(s) siguen después del cierre` : ''}: corre 🩺 Auditar repartos`, 'error');
  } else {
    notify(`✅ ${hecho}. Revisión: ningún documento tocado quedó repartido de más${tipo === 'rehacer_cierre' ? ' ni con costo en casas cerradas' : ''}${revisar.size ? ` (${revisar.size} documento(s) van a revisión a mano)` : ''}.`, 'success');
  }
}

// ---------- corrida completa (siempre dentro de la cola) ----------
//   cfg: { tipo, titulo, archivo, planear(lotes), vacio, silencioso, cabecera, confirmar(acciones), motivo }
async function _ejecutar(cfg) {
  if (!esAdmin()) { notify('Solo el admin puede rehacer repartos', 'error'); return false; }
  if (!window.XLSX) { notify('Todavía carga la librería de Excel (el respaldo): corre esto desde 🩺 Auditar repartos en unos segundos', 'error'); return false; }
  if (!(await _esperarGuardado())) { notify('Sigue un guardado de repartos en curso: corre esto desde 🩺 Auditar repartos cuando termine', 'error'); return false; }
  if (!_listo()) return false;
  // Cambios de un guardado que se cortó antes: primero se suben (si no, el plan saldría
  // de una memoria que la base no tiene).
  if (estadoGuardadoAsignaciones().pendientes > 0) {
    notify('Primero se guardan los cambios de reparto que quedaron pendientes…');
    const g0 = await _guardarConReintento();
    if (!g0.ok) { if (g0.rechazo) notify(`No se pudieron guardar los cambios pendientes (${g0.rechazo}): no se hizo nada más.`, 'error'); return false; }
  }
  const lotes = await _cargarLotes();
  if (lotes === null) { notify(MSG_LOTES, 'error'); return false; }
  if (estadoGuardadoAsignaciones().enCurso && !(await _esperarGuardado())) { notify('Sigue un guardado de repartos en curso: corre esto desde 🩺 cuando termine', 'error'); return false; }
  // Desde aquí hasta el confirm no hay await: el plan que se ve es el que se confirma.
  const acciones = cfg.planear(lotes);
  const aplicables = acciones.filter(a => a.tipo !== 'revisar');
  const cab = cfg.cabecera ? cfg.cabecera + '\n\n' : '';
  if (!acciones.length) { if (!cfg.silencioso) notify(cfg.vacio); return false; }
  const sello = _sello();
  if (!aplicables.length) {
    // Solo hay cosas para revisar a mano. Desde el disparador por casa solo se avisa
    // (sin descargar un Excel en cada cambio de fecha); desde 🩺 se descarga la lista.
    if (cfg.silencioso) {
      notify(`ℹ️ ${cfg.cabecera ? cfg.cabecera + ' ' : ''}${_nDocs(acciones)} documento(s) de esta casa van a revisión a mano (dirigidos, mezclados o ya re-repartidos): revísalos con 🩺 Auditar repartos.`);
      return false;
    }
    _cerrarModalAuditoria();
    _excel(cfg.titulo, acciones, sello, cfg.archivo);
    notify(`${_nDocs(acciones)} documento(s) no se tocan solos: van a revisión a mano (motivo en el Excel descargado).`, 'error');
    return false;
  }
  _cerrarModalAuditoria();
  _excel(cfg.titulo, acciones, sello, cfg.archivo);
  if (!confirm(`${cab}${cfg.confirmar(acciones)}`)) return false;
  const firma = firmaPlan(aplicables);
  const hoy = hoyISOLocal();

  // 1) Prueba en una COPIA: el plan debe estar bien armado y no dejar nada repartido de más.
  let prueba;
  try {
    prueba = aplicarAcciones(state.costoAsignaciones.map(a => ({ ...a })), aplicables, { nuevoId: () => '', hoy });
  } catch (e) {
    notify(`⚠️ ${(e && e.message) || e}. Avisa a soporte; no se cambió nada.`, 'error');
    return false;
  }
  const sobrePrueba = sobreRepartidos({ ..._datos(), asigs: prueba.asigs }, aplicables);
  if (sobrePrueba.length) {
    notify(`⚠️ El plan dejaría ${sobrePrueba.length} documento(s) repartidos de más (p.ej. ${sobrePrueba[0].docTipo} ${sobrePrueba[0].docId}): no se aplicó nada. Corre 🧹 primero o revisa esos documentos.`, 'error');
    return false;
  }

  // 2) LOTE primero: si no se puede registrar, no se cambia nada.
  const uuid = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  const loteId = `L-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${uuid.slice(0, 8)}`;
  try {
    await sbInsertRow('reparto_lotes', {
      lote_id: loteId, usuario: _usuario(), tipo: cfg.tipo, motivo: cfg.motivo,
      detalle: {
        partes: partesLote(aplicables),
        resumen: { documentos: _nDocs(aplicables), creadas: prueba.creadas, actualizadas: prueba.actualizadas, quitadas: prueba.quitadas },
        corte: sello.txt,
      },
    });
  } catch (e) {
    notify(`⚠️ No se pudo registrar el lote (${(e && e.message) || e}): NO se cambió nada. Intenta de nuevo.`, 'error');
    return false;
  }

  // 3) Re-planear AHORA (sin await hasta aplicar): si otra sesión guardó mientras se
  //    revisaba, o se recargaron los datos, el plan ya no es el confirmado → se anula.
  if (estadoGuardadoAsignaciones().enCurso) await _esperarGuardado();
  const listo = _listo();
  const ahora = listo ? cfg.planear(lotes).filter(a => a.tipo !== 'revisar') : [];
  if (!listo || estadoGuardadoAsignaciones().enCurso || firmaPlan(ahora) !== firma) {
    await _anular(loteId, 'Cambiaron los repartos mientras se revisaba: no se aplicó');
    notify('⚠️ Cambiaron repartos mientras revisabas (otra persona, otra pantalla o una recarga): NO se aplicó nada. Vuelve a correrlo para ver el plan actualizado.', 'error');
    return false;
  }
  const respaldo = state.costoAsignaciones.map(a => ({ ...a }));
  const res = aplicarAcciones(state.costoAsignaciones, aplicables, { nuevoId: nuevoAsignacionId, hoy });
  state.costoAsignaciones = res.asigs;

  // 4) Guardar (borrando primero; con reintento). Si el guardado se niega de entrada
  //    (no escribió nada), se deshace en memoria y se anula el lote.
  const g = await _guardarConReintento();
  const porque = r => (r === 'sin-sesion' ? 'la sesión venció: vuelve a entrar' : r === 'no-cargado' ? 'los datos no están completos' : r);
  if (!g.ok && g.rechazo && g.primero) {
    state.costoAsignaciones = respaldo;
    await _anular(loteId, `El guardado se negó (${g.rechazo}): no se aplicó`);
    _render();
    notify(`⚠️ No se pudo guardar (${porque(g.rechazo)}). No se aplicó nada.`, 'error');
    return false;
  }
  if (!g.ok && g.rechazo) {
    notify(`⚠️ El guardado quedó a medias (${porque(g.rechazo)}). Los cambios que faltan siguen en esta pantalla: NO recargues; cuando se arregle, 🔄 Refrescar ofrece reintentar el guardado.`, 'error');
  }
  _render();
  if (!g.ok) return false;
  _verificar(cfg.tipo, res, aplicables, acciones);
  return true;
}

function _rehacer(alcance = {}, opts = {}) {
  return _ejecutar({
    tipo: 'rehacer_cierre', titulo: '🔧 Rehacer repartos por cierre de casa', archivo: 'cierre',
    planear: () => planRehacerCierre(_datos(), _reglas(), alcance),
    vacio: '✅ Ningún reparto carga costo a casas cerradas', silencioso: opts.silencioso, cabecera: opts.cabecera,
    confirmar: acciones => `🔧 Rehacer repartos por cierre de casa:\n\n${_resumenTexto(acciones)}\n\nEl total de cada factura/pago NO cambia. Se descargó un Excel con el ANTES (respaldo) y el después; todo queda en la bitácora.\n\n¿Aplicar?`,
    motivo: opts.motivo || (alcance.unidadId != null ? `Cierre de la casa ${_nombre(alcance.unidadId)}` : 'Rehacer por cierre (todos los proyectos)'),
  });
}

function _restaurar(alcance = {}, opts = {}) {
  return _ejecutar({
    tipo: 'restaurar', titulo: '↩️ Restaurar casas reabiertas', archivo: 'restaurar',
    planear: lotes => planRestaurar(_datos(), lotes, _reglas(), alcance),
    vacio: '✅ No hay casas reabiertas por restaurar', silencioso: opts.silencioso, cabecera: opts.cabecera,
    confirmar: acciones => `↩️ Restaurar casas reabiertas:\n\n${_resumenTexto(acciones)}\n\nVuelven al reparto de donde se quitaron, sin pasar el total de cada documento. Excel de respaldo descargado; todo queda en la bitácora.\n\n¿Aplicar?`,
    motivo: opts.motivo || (alcance.unidadId != null ? `Reapertura de la casa ${_nombre(alcance.unidadId)}` : 'Restaurar casas reabiertas'),
  });
}

// ============================================================================
// Público
// ============================================================================

// 🔧 Rehacer por cierre. alcance: {} = todo · { unidadId } = una casa.
export function rehacerPorCierre(alcance = {}, opts = {}) {
  return _enCola(() => _rehacer(alcance, opts), true);
}

// 🧹 Quitar repartos duplicados (documentos repartidos dos veces).
export function quitarRepartosDuplicados() {
  return _enCola(() => _ejecutar({
    tipo: 'quitar_duplicado', titulo: '🧹 Quitar repartos duplicados', archivo: 'duplicados',
    planear: () => planDuplicados(_datos()),
    vacio: '✅ No hay documentos sobre-repartidos',
    confirmar: acciones => {
      const ap = acciones.filter(a => a.tipo === 'quitar_duplicado');
      const rev = acciones.filter(a => a.tipo === 'revisar');
      return `🧹 Quitar repartos duplicados:\n\n${ap.map(a => `• ${a.ref}: repartido ${fmt(a.sumaAntes)} de ${fmt(a.totalDoc)} → quedará ${fmt(a.sumaDespues)} (${a.quitar.length} fila(s) repetida(s))`).join('\n')}${rev.length ? `\n\n${rev.length} más no se tocan (revisar a mano).` : ''}\n\nSe queda la copia más antigua. Excel de respaldo descargado; todo queda en la bitácora.\n\n¿Aplicar?`;
    },
    motivo: 'Quitar repartos duplicados',
  }), true);
}

// ↩️ Restaurar casas que se reabrieron (fecha corregida, venta cancelada).
export function restaurarReabiertas(alcance = {}, opts = {}) {
  return _enCola(() => _restaurar(alcance, opts), true);
}

// Disparador al capturar/cambiar una fecha de cierre (terminación o escritura).
// Solo admin; si la casa cerró → ofrece rehacer; si se reabrió → ofrece restaurar.
// Una sola corrida en fila por casa: si ya hay una esperando, esa leerá la fecha final
// (el campo de fecha dispara un cambio por cada parte que se teclea).
const _casaEnFila = new Set();
export function ofrecerRehacerCasa(unidadId, origen) {
  const k = String(unidadId);
  if (_casaEnFila.has(k)) return _cola;
  _casaEnFila.add(k);
  return _enCola(async () => {
    try {
      await _pausa(1200);   // deja terminar de teclear la fecha
      _casaEnFila.delete(k);
      if (!esAdmin()) return;
      const u = state.unidades.find(x => String(x.unidad_id) === k);
      if (!u) return;
      invalidarCierres();   // la venta/fecha se acaba de mutar en sitio
      const cierre = fechaCierreUnidad(u);
      const hoy = hoyISOLocal();
      const tope = `${Number(hoy.slice(0, 4)) + 1}${hoy.slice(4)}`;
      if (cierre && cierre > tope) {
        notify(`ℹ️ "${u.nombre}": el cierre ${fmtFecha(cierre)} es más de un año en el futuro; no se rehacen repartos. Si es un error, corrige la fecha.`, 'error');
        return;
      }
      const cab = `${origen || 'Cambió el cierre'} de "${u.nombre}"${cierre ? ` (cierre: ${fmtFecha(cierre)})` : ' (sin cierre)'}.`;
      if (planRehacerCierre(_datos(), _reglas(), { unidadId: u.unidad_id }).length) {
        await _rehacer({ unidadId: u.unidad_id }, { cabecera: cab, silencioso: true, motivo: `${origen || 'Cierre'}: ${u.nombre}` });
      }
      const lotes = await _cargarLotes();
      if (lotes && planRestaurar(_datos(), lotes, _reglas(), { unidadId: u.unidad_id }).length) {
        await _restaurar({ unidadId: u.unidad_id }, { cabecera: cab, silencioso: true, motivo: `${origen || 'Reapertura'}: ${u.nombre}` });
      }
    } catch (e) { _casaEnFila.delete(k); console.warn('ofrecerRehacerCasa', e); }
  });
}

// Conteos para los botones del modal de 🩺 (restaurar se cuenta al pulsarlo).
export function conteosRehacer() {
  try {
    const r = planRehacerCierre(_datos(), _reglas());
    const d = planDuplicados(_datos());
    return {
      rehacer: _nDocs(r.filter(a => a.tipo !== 'revisar')),
      revisar: _nDocs(r.filter(a => a.tipo === 'revisar')),
      duplicados: d.filter(a => a.tipo === 'quitar_duplicado').length,
    };
  } catch (e) { console.warn('conteosRehacer', e); return { rehacer: 0, revisar: 0, duplicados: 0 }; }
}

// 📜 Bitácora: lotes + cada cambio fila por fila (antes/después, quién, cuándo).
export async function descargarBitacoraRepartos() {
  if (!esAdmin()) { notify('Solo el admin', 'error'); return; }
  if (!window.XLSX) { notify('Cargando la librería de Excel, intenta de nuevo en 2 segundos', 'error'); return; }
  const lotes = await _cargarLotes();
  const cambios = await _conTope(sbLoadTable('reparto_bitacora', 'bitacora_id'), 60000);
  if (lotes === null || !cambios) { notify(MSG_LOTES, 'error'); return; }
  const sello = _sello();
  const wb = XLSX.utils.book_new();
  const aoaL = [['Fecha', 'Usuario', 'Tipo', 'Motivo', 'Documentos', 'Filas actualizadas', 'Filas nuevas', 'Filas quitadas', 'Lote']];
  lotes.sort((a, b) => String(b.creado).localeCompare(String(a.creado))).forEach(l => {
    const r = (l.detalle && l.detalle.resumen) || {};
    aoaL.push([String(l.creado || '').replace('T', ' ').slice(0, 16), l.usuario || '', l.tipo || '', l.motivo || '', r.documentos || 0, r.actualizadas || 0, r.creadas || 0, r.quitadas || 0, l.lote_id]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoaL), 'Lotes');
  const aoaB = [['Fecha', 'Usuario', 'Operación', 'Factura', 'Pago', 'Casa', 'Monto antes', 'Monto después', 'Partida antes', 'Partida después', 'Método', 'ID reparto']];
  cambios.sort((a, b) => String(b.creado).localeCompare(String(a.creado))).forEach(c => {
    const an = c.antes || {}, de = c.despues || {};
    aoaB.push([String(c.creado || '').replace('T', ' ').slice(0, 19), c.usuario || '', c.operacion || '', c.factura_id || '', c.pago_id || '', _nombre(c.unidad_id),
      an.monto_asignado != null ? Number(an.monto_asignado) : '', de.monto_asignado != null ? Number(de.monto_asignado) : '',
      an.partida_override || '', de.partida_override || '', de.metodo || an.metodo || '', c.asignacion_id || '']);
  });
  const wsB = XLSX.utils.aoa_to_sheet(aoaB);
  for (let r = 1; r < aoaB.length; r++) [6, 7].forEach(col => { const ref = XLSX.utils.encode_cell({ r, c: col }); if (wsB[ref] && typeof wsB[ref].v === 'number') wsB[ref].z = '"$"#,##0.00'; });
  wsB['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoaB.length - 1, 1), c: 11 } }) };
  XLSX.utils.book_append_sheet(wb, wsB, 'Cambios');
  XLSX.writeFile(wb, `Bitacora_repartos_${sello.archivo}.xlsx`);
  notify(`📜 Bitácora: ${lotes.length} lote(s) · ${cambios.length} cambio(s)`);
}

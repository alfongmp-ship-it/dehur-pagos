import { state, esConcentradora, nuevoAsignacionId, nuevoFacturaPagoId } from '../state.js';
import { fmt, hoyFecha, escapeHtml, fmtFecha } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { proyTag } from '../ui/badges.js';
import { saveData, gsSaveHistorial, gsSavePendientes, gsSaveProyectos, gsSaveCuentasPropias, gsSaveFacturas, gsSaveFacturaPagos, gsSaveCostoAsignaciones, ensureHistorialIds, esPorFila, sbGuardarFila } from '../services/google-sync.js';
import { saveProy } from '../config/proyectos.js';
import { unidadEnIndivisoAFecha } from '../config/costos-fiscales.js';

// DD/MM/YYYY (o ISO) → ISO 'YYYY-MM-DD'. Inline para no depender de historial.js (evita ciclo).
const _isoFecha = f => {
  const s = String(f || '');
  if (!s) return '';
  if (s.includes('-') && s.length >= 10) return s.slice(0, 10);
  const p = s.split('/'); if (p.length === 3) { const [d, m, y] = p; return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  return '';
};

const _normPart = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

// Aplica auto-indiviso a un pago del historial cuya partida Admin no sea
// CONSTRUCCION y que no tenga aún asignaciones de costo. Devuelve la cantidad
// de asignaciones creadas (0 si no aplica). El llamador es responsable de
// invocar gsSaveCostoAsignaciones() después si se creó al menos una.
export function aplicarAutoIndiviso(h, repartoMetodo, forzar = false) {
  if (!h || !h.id || !h.proyecto) return 0;
  if (repartoMetodo === 'vacio') return 0;                     // opt-out explícito
  if (!forzar) {
    const part = _normPart(h.partida);
    if (!part || part === 'construccion') return 0;            // sin partida o construccion → no aplica
  }
  // `forzar` (p.ej. APORTACIONES): siempre reparte por indiviso a las activas, sin
  // importar la partida. No duplicar si ya hay asignaciones para este pago.
  if (state.costoAsignaciones.some(a => String(a.pago_id) === String(h.id))) return 0;

  // Pool de indiviso a la FECHA del pago (casas que seguían en obra entonces); cae a todas
  // las activas si ninguna calificó. Inerte si ninguna casa tiene fecha_termino (= como antes).
  const activas = state.unidades.filter(u => u.activo !== false && u.proyecto === h.proyecto);
  const pool = activas.filter(u => unidadEnIndivisoAFecha(u, _isoFecha(h.fecha)));
  const unidades = pool.length ? pool : activas;
  if (!unidades.length) return 0;

  const sumaInd = unidades.reduce((s, u) => s + (u.indiviso_pct || 0), 0);
  const usarInd = sumaInd > 0.01;
  const fecha = new Date().toISOString().split('T')[0];

  let creadas = 0;
  unidades.forEach(u => {
    const pct = usarInd
      ? ((u.indiviso_pct || 0) / sumaInd) * 100
      : 100 / unidades.length;
    if (pct <= 0) return;
    state.costoAsignaciones.push({
      asignacion_id: nuevoAsignacionId(),
      pago_id: h.id,
      unidad_id: u.unidad_id,
      proyecto: h.proyecto,
      metodo: usarInd ? 'indiviso' : 'equitativo',
      monto_asignado: (h.importe * pct) / 100,
      factor: pct / 100,
      fecha_asignacion: fecha,
      partida_override: ''
    });
    creadas++;
  });
  return creadas;
}

export function renderConfirmarPagos() {
  const el = document.getElementById('confirmar-lista');
  if (!el) return;

  const cnt = document.getElementById('cnt-confirmar');
  if (cnt) cnt.textContent = state.pendientesConfirmacion.length;

  if (!state.pendientesConfirmacion.length) {
    el.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:10px;opacity:.4">✅</div><div>Sin pagos pendientes de confirmar</div></div>';
    document.getElementById('conf-resumen-page').innerHTML = '';
    return;
  }

  state.pendientesConfirmacion.forEach(d => { if (d.confirmado === undefined) d.confirmado = true; });
  // Fecha del pago (editable): default = la fecha que traen los pendientes (de dispersión) o hoy.
  // Solo se pre-llena si está vacío, para no pisar lo que el usuario escriba.
  const _fp = document.getElementById('conf-fecha-pago');
  if (_fp && !_fp.value) {
    const _any = state.pendientesConfirmacion.find(d => d.fechaGen)?.fechaGen;
    _fp.value = _isoFecha(_any) || _isoFecha(hoyFecha());
  }
  const total = state.pendientesConfirmacion.reduce((s, d) => s + d.importe, 0);
  const selTotal = state.pendientesConfirmacion.filter(d => d.confirmado).reduce((s, d) => s + d.importe, 0);
  const selCount = state.pendientesConfirmacion.filter(d => d.confirmado).length;

  document.getElementById('conf-resumen-page').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">' +
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;">' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">TOTAL GENERADO</div>' +
    '<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:700;">' + fmt(total) + '</div></div>' +
    '<div style="background:rgba(39,174,96,.08);border:1px solid rgba(39,174,96,.3);border-radius:10px;padding:14px;">' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">CONFIRMADOS</div>' +
    '<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:700;color:var(--green);">' + fmt(selTotal) + ' (' + selCount + ')</div></div>' +
    '<div style="background:rgba(231,76,60,.08);border:1px solid rgba(231,76,60,.3);border-radius:10px;padding:14px;">' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">NO CONFIRMADOS</div>' +
    '<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:700;color:var(--red);">' + fmt(total - selTotal) + ' (' + (state.pendientesConfirmacion.length - selCount) + ')</div></div></div>';

  el.innerHTML = state.pendientesConfirmacion.map((d, i) =>
    '<div style="display:grid;grid-template-columns:32px 1fr 1fr auto 100px 40px;gap:10px;align-items:center;padding:11px 16px;border-bottom:1px solid var(--border);">' +
    '<input type="checkbox" ' + (d.confirmado ? 'checked' : '') + ' onchange="toggleConfPago(' + i + ',this.checked)" style="width:16px;height:16px;cursor:pointer;">' +
    '<div><div style="font-size:12px;font-weight:500;">' + escapeHtml(d.nombre) + '</div><div style="font-size:10px;color:var(--muted);">' + escapeHtml(d.banco || '') + ' · ' + escapeHtml(d.tipo || '') + '</div></div>' +
    '<div style="font-size:11px;color:var(--muted);">' + escapeHtml(d.concepto) + '</div>' +
    '<div>' + proyTag(d.proyecto) + '</div>' +
    '<div style="font-family:\'DM Mono\',monospace;font-size:12px;font-weight:600;text-align:right;">' + fmt(d.importe) + '</div>' +
    '<button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;color:var(--red);" onclick="eliminarPendiente(' + i + ')">✕</button>' +
    '</div>'
  ).join('');
}

export function toggleConfPago(idx, checked) {
  state.pendientesConfirmacion[idx].confirmado = checked;
  renderConfirmarPagos();
}

export function toggleAllConf(v) {
  state.pendientesConfirmacion.forEach(d => d.confirmado = v);
  renderConfirmarPagos();
}

export function eliminarPendiente(idx) {
  if (!confirm('¿Eliminar este pago pendiente?')) return;
  state.pendientesConfirmacion.splice(idx, 1);
  gsSavePendientes();
  renderConfirmarPagos();
  notify('Pago pendiente eliminado');
}

export async function confirmarPagos() {
  const confirmados = state.pendientesConfirmacion.filter(d => d.confirmado);
  if (!confirmados.length) { notify('Selecciona al menos un pago confirmado', 'error'); return; }
  // Fecha REAL del pago para el historial: el campo "Fecha del pago" (editable), convertido
  // al formato de guardado (DD/MM/YYYY). Si está vacío, hoy. El archivo del banco NO lleva
  // fecha, así que registrar con una fecha anterior es seguro.
  const _fpEl = document.getElementById('conf-fecha-pago');
  const fecha = (_fpEl && _fpEl.value) ? fmtFecha(_fpEl.value) : hoyFecha();
  // Insertamos en historial y mantenemos referencia al objeto recién creado para
  // poder obtener su `id` estable y crear las asignaciones auto-vinculadas.
  const insertados = [];
  confirmados.forEach(d => {
    const proyectoHist = esConcentradora(d.cuenta_cargo) ? '' : (d.cuenta_cargo || d.proyecto);
    const h = { fecha, nombre: d.nombre, concepto: d.concepto, importe: d.importe, proyecto: proyectoHist, banco: d.banco, tipo: d.tipo || d.cuenta, proveedor_id: d.proveedor_id || '', factura_id: d.factura_id || '', cuenta_origen: d.cuenta_cargo || '', tipo_registro: 'Pago', partida: d.partida || '', sub_partida: d.sub_partida || '' };
    state.historial.unshift(h);
    insertados.push({ d, h });
  });
  // Asegurar IDs estables para poder vincular asignaciones de costos.
  ensureHistorialIds();
  // Validar el enlace pago→factura ANTES de guardar/repartir/ligar. Si el factura_id es
  // inválido (factura inexistente / cancelada / ya pagada / de otro proveedor) se avisa y se
  // limpia h.factura_id: el pago se registra como pago NORMAL (con su reparto), nunca como un
  // enlace fantasma. Mismo criterio que vincularPagoAFactura.
  insertados.forEach(({ d, h }) => {
    if (!h.factura_id) return;
    const fact = state.facturas.find(f => f.factura_id === parseInt(h.factura_id));
    const provPago = parseInt(d.proveedor_id) || 0;
    let motivo = '';
    if (!fact) motivo = `la factura ${h.factura_id} no existe`;
    else if (fact.estado_sat === 'Cancelada' || fact.estatus_factura === 'cancelada') motivo = `la factura ${h.factura_id} está cancelada`;
    else if (fact.estatus_factura === 'pagada') motivo = `la factura ${h.factura_id} ya está pagada`;
    else if (fact.proveedor_id && provPago && fact.proveedor_id !== provPago) motivo = `el proveedor no coincide con la factura ${h.factura_id}`;
    if (motivo) {
      notify(`"${h.nombre || 'Pago'}": ${motivo}. Se registró SIN ligar a factura (su costo se reparte como pago normal).`, 'error');
      h.factura_id = '';
    }
  });
  document.getElementById('cnt-hist').textContent = state.historial.length;
  // Fase 3: guarda por fila los pagos recién confirmados (ya con id estable tras
  // ensureHistorialIds). Las otras cascadas (saldos, facturas, asignaciones)
  // siguen whole-table.
  const _pfHist = esPorFila('historial');
  gsSaveHistorial({ porFila: _pfHist });
  if (_pfHist) insertados.forEach(({ h }) => sbGuardarFila('historial', h));

  // Auto-crear asignaciones de costo planificadas desde la solicitud (obra).
  // DEVENGADO (Fase A): si el pago trae factura_id, el costo lo aporta la FACTURA
  // (su propio reparto), NO el pago → se omite el reparto del pago para no duplicar.
  let asignacionesCreadas = 0;
  let repartoIgnorado = 0;
  insertados.forEach(({ d, h }) => {
    if (h.factura_id) { if (d.asignacionesPlanificadas?.length) repartoIgnorado++; return; } // el costo va por la factura (devengado)
    if (!d.asignacionesPlanificadas?.length) return;
    d.asignacionesPlanificadas.forEach(asg => {
      if (!asg.unidad_id) return; // casa no encontrada en catálogo: se omite
      const pct = parseFloat(asg.pct) || 0;
      if (pct <= 0) return;
      const monto = (d.importe * pct) / 100;
      state.costoAsignaciones.push({
        asignacion_id: nuevoAsignacionId(),
        pago_id: h.id,
        unidad_id: asg.unidad_id,
        proyecto: h.proyecto,
        metodo: d.repartoMetodo || 'custom',
        monto_asignado: monto,
        factor: pct / 100,
        fecha_asignacion: new Date().toISOString().split('T')[0],
        partida_override: d.partidaObra || ''
      });
      asignacionesCreadas++;
    });
  });

  // Auto-indiviso para pagos no-construcción sin asignaciones manuales.
  // El helper internamente verifica que no haya asignaciones ya creadas,
  // así que es seguro llamarlo siempre. Respeta opt-out (repartoMetodo='vacio').
  let autoIndivCreadas = 0;
  insertados.forEach(({ d, h }) => {
    if (h.factura_id) return; // con factura el costo es devengado (lo aporta la factura)
    autoIndivCreadas += aplicarAutoIndiviso(h, d.repartoMetodo);
  });

  if (asignacionesCreadas || autoIndivCreadas) {
    await gsSaveCostoAsignaciones();
  }
  if (repartoIgnorado) {
    notify(`${repartoIgnorado} pago(s) con factura: el costo se toma del reparto de la factura (devengado), no del pago.`, 'success');
  }

  // Registrar el enlace pago→factura (facturaPago) y actualizar la factura. Se recorre
  // `insertados` para usar el id REAL del historial (h.id), NO el id de la cola (d.id), y
  // solo se liga lo que pasó la validación de arriba (h.factura_id válido).
  let factChanged = false;
  insertados.forEach(({ d, h }) => {
    if (!h.factura_id) return;
    const factId = parseInt(h.factura_id);
    const fact = state.facturas.find(f => f.factura_id === factId);
    if (!fact) return;

    const fpId = nuevoFacturaPagoId();
    state.facturaPagos.push({
      factura_pago_id: fpId,
      factura_id: factId,
      pago_id: h.id,
      proveedor_id: parseInt(d.proveedor_id) || 0,
      monto_aplicado: d.importe,
      fecha_pago: fecha,
      estatus: 'aplicado',
      observaciones: d.concepto || ''
    });

    fact.monto_pagado = (fact.monto_pagado || 0) + d.importe;
    fact.saldo_pendiente = Math.max(0, fact.monto_total - fact.monto_pagado);
    if (fact.saldo_pendiente <= 0) {
      fact.estatus_factura = 'pagada';
      fact.fecha_pago_total = new Date().toISOString().split('T')[0];
    } else if (fact.monto_pagado > 0) {
      fact.estatus_factura = 'parcial';
    }
    factChanged = true;
  });
  if (factChanged) {
    gsSaveFacturas();
    gsSaveFacturaPagos();
    if (window.renderFacturas) window.renderFacturas();
    if (window.renderFacturaPagos) window.renderFacturaPagos();
    document.getElementById('cnt-fact').textContent = state.facturas.length;
    document.getElementById('cnt-fp').textContent = state.facturaPagos.length;
  }

  // Restar saldo de la cuenta origen (proyecto o cuenta propia/concentradora)
  const todayISO = new Date().toISOString().split('T')[0];
  let saldoChangedProy = false;
  let saldoChangedExtra = false;
  confirmados.forEach(d => {
    const ctaNombre = d.cuenta_cargo || d.proyecto;
    if (!ctaNombre || !d.importe) return;
    const p = state.proyectos.find(x => x.nombre === ctaNombre);
    if (p && p.ultima_act_saldo) {
      if (todayISO >= p.ultima_act_saldo.slice(0, 10)) {
        p.saldo = (p.saldo || 0) - d.importe;
        saldoChangedProy = true;
      }
      return;
    }
    const extra = state.cuentasPropias.find(x => x.nombre === ctaNombre);
    if (extra && extra.ultima_actualizacion) {
      if (todayISO >= extra.ultima_actualizacion.slice(0, 10)) {
        extra.saldo = (extra.saldo || 0) - d.importe;
        saldoChangedExtra = true;
      }
    }
  });
  if (saldoChangedProy) {
    saveProy(state.proyectos);
    gsSaveProyectos();
  }
  if (saldoChangedExtra) {
    gsSaveCuentasPropias();
  }
  if (saldoChangedProy || saldoChangedExtra) {
    if (window.renderCuentasPropias) window.renderCuentasPropias();
    if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
    if (window.renderHeaderBadges) window.renderHeaderBadges();
  }

  // Quitar confirmados de pendientes, mantener no confirmados
  state.pendientesConfirmacion = state.pendientesConfirmacion.filter(d => !d.confirmado);
  gsSavePendientes();

  const partes = [];
  if (asignacionesCreadas) partes.push(`🏠 ${asignacionesCreadas} desde Excel`);
  if (autoIndivCreadas) partes.push(`🏠 ${autoIndivCreadas} auto-indiviso`);
  const extraAsig = partes.length ? ' · ' + partes.join(' · ') : '';
  notify('✅ ' + confirmados.length + ' pago(s) registrados en historial' + extraAsig);
  if (window.renderHistorial) window.renderHistorial();
  if (window.renderCostosFiscales) window.renderCostosFiscales();
  renderConfirmarPagos();
}

// Carga masiva de FACTURAS desde Excel (rol 'facturas' / Gonzalo).
// Reusa el framework genérico createExcelImporter (modal + dropzone + preview +
// descarga de plantilla). Reglas (decididas con el usuario):
//   - Proveedor se liga por Proveedor ID (entero del catálogo). factura_id lo
//     autoasigna la app (NO va en el Excel).
//   - Total SIEMPRE se recalcula = subtotal - descuento + IVA - retIVA - retISR;
//     el Total del Excel es solo verificación (aviso si no cuadra).
//   - UUID duplicado (vs existentes o dentro del Excel) se BLOQUEA (omit);
//     folio+proveedor o monto+fecha+proveedor → solo AVISO (importable).
//   - Proyecto OBLIGATORIO y debe existir en el catálogo activo.

import { state, nuevoAsignacionId } from '../state.js';
import { fmt } from '../ui/format.js';
import { createExcelImporter, normalizarFechaISO, normalizarFechaDDMMYYYY, parseImporte } from '../services/excel-import.js';
import { gsSaveFacturas, esPorFila, sbGuardarFila, gsSaveCostoAsignaciones } from '../services/google-sync.js';
import { parseReparto } from './solicitudes.js';

const norm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

// Sets de detección. Los de "Exist" se arman desde state.facturas y los de "Lote"
// detectan repetidos dentro del mismo Excel. Se RESETEAN/ARMAN en existingKeyset(),
// que el framework llama UNA vez al inicio de cada parseo (antes de validar filas).
let _uuidExist, _folioProvExist, _mfpExist;
let _uuidLote, _folioProvLote, _mfpLote;
let _repartoErrores;   // si hay reparto mal escrito, se BLOQUEA toda la carga (bloqueoGlobal)

export const facturasImporter = createExcelImporter({
  key: 'facturas',
  titulo: '📥 Importar Facturas desde Excel',
  headerSignature: 'DEHUR — Importar Facturas',
  filenamePrefix: 'Plantilla_Importar_Facturas',

  columns: [
    { key: 'proveedor_id', label: 'Proveedor ID', width: 12 },
    { key: 'numero_factura', label: 'Núm. Factura (folio)', width: 18 },
    { key: 'uuid', label: 'UUID (folio fiscal)', width: 38, text: true },
    { key: 'fecha_factura', label: 'Fecha factura (DD/MM/YYYY)', width: 22, text: true },
    { key: 'fecha_vencimiento', label: 'Vencimiento (DD/MM/YYYY)', width: 22, text: true },
    { key: 'subtotal', label: 'Subtotal', width: 12, align: 'right' },
    { key: 'descuento', label: 'Descuento', width: 12, align: 'right' },
    { key: 'iva_trasladado', label: 'IVA', width: 12, align: 'right' },
    { key: 'retencion_iva', label: 'Retención IVA', width: 14, align: 'right' },
    { key: 'retencion_isr', label: 'Retención ISR', width: 14, align: 'right' },
    { key: 'monto_total', label: 'Total (opcional, se verifica)', width: 24, align: 'right' },
    { key: 'rfc_emisor', label: 'RFC Emisor (opcional)', width: 16 },
    { key: 'razon_social', label: 'Razón Social (opcional)', width: 28 },
    { key: 'estado_sat', label: 'Estado SAT', width: 14 },
    { key: 'tipo_comprobante', label: 'Tipo comprobante', width: 18 },
    { key: 'proyecto', label: 'Proyecto', width: 18 },
    { key: 'reparto', label: 'Reparto (directo/equitativo/indiviso/custom)', width: 36 },
    { key: 'unidades', label: 'Unidades (códigos, ver Referencia)', width: 28 },
    { key: 'partida', label: 'Partida (si hay reparto)', width: 20 },
    { key: 'sub_partida', label: 'Sub-partida (si la partida la pide)', width: 26 },
    { key: 'observaciones', label: 'Observaciones', width: 28 }
  ],

  previewColumns: [
    { key: 'numero_factura', label: 'Folio', css: '90px' },
    { key: 'uuid', label: 'UUID', css: '150px', style: "font-family:'DM Mono',monospace;font-size:9px;" },
    { key: 'fecha', label: 'Fecha', css: '80px' },
    { key: 'proveedor', label: 'Proveedor', css: '1fr' },
    { key: 'monto_total', label: 'Total', css: '95px', align: 'right', render: r => fmt(+r.monto_total || 0) },
    { key: 'reparto', label: 'Reparto', css: '110px' }
  ],

  referencia: () => [
    { header: 'Proveedores (ID - Nombre)', valores: state.proveedores.filter(p => p.activo !== false).map(p => `${p.id} - ${p.nombre}`) },
    { header: 'Proyectos', valores: state.proyectos.filter(p => p.activo !== false).map(p => p.nombre) },
    { header: 'Estado SAT', valores: ['Vigente', 'Cancelada'] },
    { header: 'Tipo comprobante', valores: ['Factura', 'Nota de crédito', 'Complemento de pago', 'Otro'] },
    { header: 'Partidas', valores: (state.partidasCatalogo || []).filter(p => p.activa !== false).map(p => p.partida) },
    { header: 'Reparto: cómo llenar', valores: [
      'directo  → Unidades = 1 código (ej. A-1)',
      'equitativo → Unidades = varios con / (ej. A-1/A-2/A-3)',
      'indiviso → Unidades vacío (todas las activas por % indiviso)',
      'custom → Unidades = código:% con / (ej. A-1:60/A-2:40)',
      'custom MIXTO → usa INDIVISO (o AMENIDADES) como código para mandar ese % por indiviso a todas (ej. 101:20/INDIVISO:80)',
      'vacío → no reparte (la asignas después a mano)'
    ] }
  ],

  ejemplos: () => {
    const prov = state.proveedores.find(p => p.activo !== false);
    const proy = state.proyectos.find(p => p.activo !== false);
    return [{
      proveedor_id: prov ? prov.id : 1,
      numero_factura: 'A-001',
      uuid: 'DFFB3C64-B01F-4DB9-8DEA-FF8D7CF9A3E0',
      fecha_factura: '05/01/2026',
      fecha_vencimiento: '04/02/2026',
      subtotal: 1216.83,
      descuento: 0,
      iva_trasladado: 194.69,
      retencion_iva: 129.80,
      retencion_isr: 121.68,
      monto_total: 1160.04,
      rfc_emisor: prov && prov.rfc ? prov.rfc : 'XAXX010101000',
      razon_social: prov ? prov.nombre : 'Proveedor Ejemplo',
      estado_sat: 'Vigente',
      tipo_comprobante: 'Factura',
      proyecto: proy ? proy.nombre : '',
      reparto: 'indiviso',
      unidades: '',
      partida: (state.partidasCatalogo || []).find(p => p.activa !== false)?.partida || '',
      sub_partida: '',
      observaciones: ''
    }];
  },

  // Hook que el framework llama UNA vez por parseo (antes de validar): lo usamos
  // para (re)armar los sets de detección. Devolvemos Set vacío y NO definimos
  // duplicateKey: el bloqueo de UUID se hace con `omit` en validar.
  existingKeyset: () => {
    _uuidExist = new Set(); _folioProvExist = new Set(); _mfpExist = new Set();
    _uuidLote = new Set(); _folioProvLote = new Set(); _mfpLote = new Set();
    _repartoErrores = [];
    state.facturas.forEach(f => {
      if (f.uuid) _uuidExist.add(norm(f.uuid));
      _folioProvExist.add(norm(f.numero_factura) + '|' + f.proveedor_id);
      _mfpExist.add((+f.monto_total || 0).toFixed(2) + '|' + (f.fecha_factura || '') + '|' + f.proveedor_id);
    });
    return new Set();
  },

  validar: (raw, ctx) => {
    const provIdRaw = String(raw.proveedor_id ?? '').trim();
    const provId = parseInt(provIdRaw, 10);
    const folio = String(raw.numero_factura ?? '').trim();
    const uuid = String(raw.uuid ?? '').trim().toUpperCase();
    const fechaFact = normalizarFechaISO(raw.fecha_factura);
    const fechaVenc = normalizarFechaISO(raw.fecha_vencimiento);
    const subtotal = parseImporte(raw.subtotal);
    const descuento = parseImporte(raw.descuento) || 0;
    const iva = parseImporte(raw.iva_trasladado) || 0;
    const retIva = parseImporte(raw.retencion_iva) || 0;
    const retIsr = parseImporte(raw.retencion_isr) || 0;
    const proyecto = String(raw.proyecto ?? '').trim();

    // ===== Errores (omit → van a "Filas omitidas", no importables) =====
    if (!provIdRaw) return { omit: 'Proveedor ID requerido' };
    if (!Number.isInteger(provId)) return { omit: `Proveedor ID inválido: "${provIdRaw}"` };
    const prov = state.proveedores.find(p => p.id === provId);
    if (!prov) return { omit: `Proveedor ID ${provIdRaw} no existe en el catálogo` };
    if (!folio) return { omit: 'Núm. Factura (folio) requerido' };
    if (!uuid) return { omit: 'UUID (folio fiscal) obligatorio' };
    if (!UUID_RE.test(uuid)) return { omit: 'UUID con formato inválido (debe ser 8-4-4-4-12)' };
    if (!fechaFact) return { omit: 'Fecha de factura inválida (usa DD/MM/YYYY)' };
    if (!isFinite(subtotal) || subtotal <= 0) return { omit: 'Subtotal debe ser mayor a 0' };
    if (!proyecto) return { omit: 'Proyecto requerido' };
    if (!ctx.proyectosActivos.some(p => norm(p.nombre) === norm(proyecto))) return { omit: `Proyecto "${proyecto}" no existe en el catálogo` };

    // UUID duplicado → BLOQUEAR (el folio fiscal es único en el SAT)
    const uuidKey = norm(uuid);
    if (_uuidExist.has(uuidKey)) return { omit: 'UUID duplicado: ya existe una factura con ese folio fiscal' };
    if (_uuidLote.has(uuidKey)) return { omit: 'UUID duplicado dentro del mismo Excel' };

    // Total recalculado (fuente de verdad)
    const montoTotal = r2(subtotal - descuento + iva - retIva - retIsr);
    if (montoTotal <= 0) return { omit: 'Total calculado ≤ 0; revisa el desglose' };

    // ===== Avisos (no bloquean, sí importan) =====
    const avisos = [];
    const folioProvKey = norm(folio) + '|' + provId;
    const mfpKey = montoTotal.toFixed(2) + '|' + fechaFact + '|' + provId;
    if (_folioProvExist.has(folioProvKey) || _folioProvLote.has(folioProvKey)) avisos.push(`Posible duplicado: folio "${folio}" repetido del proveedor ${provId}`);
    if (_mfpExist.has(mfpKey) || _mfpLote.has(mfpKey)) avisos.push('Sospechosa: mismo monto, fecha y proveedor que otra factura');
    const excelTotal = parseImporte(raw.monto_total);
    if (isFinite(excelTotal) && excelTotal > 0 && Math.abs(excelTotal - montoTotal) > 0.01) avisos.push(`El Total del Excel (${fmt(excelTotal)}) no cuadra con el calculado (${fmt(montoTotal)}); se usa el calculado`);
    const rfcExcel = String(raw.rfc_emisor ?? '').trim().toUpperCase();
    if (rfcExcel && prov.rfc && norm(rfcExcel) !== norm(prov.rfc)) avisos.push('RFC emisor no coincide con el RFC del proveedor');
    if (fechaVenc && fechaVenc < fechaFact) avisos.push('Vencimiento antes de la fecha de factura');
    if (typeof raw.fecha_factura === 'number') avisos.push('La fecha venía como número de Excel; verifica día/mes');

    // Registrar claves del lote para detectar repetidos en filas siguientes
    _uuidLote.add(uuidKey);
    _folioProvLote.add(folioProvKey);
    _mfpLote.add(mfpKey);

    const estadoSat = String(raw.estado_sat ?? '').trim() === 'Cancelada' ? 'Cancelada' : 'Vigente';
    if (estadoSat === 'Cancelada') avisos.push('Estado SAT: Cancelada');
    const tipoComp = String(raw.tipo_comprobante ?? '').trim() || 'Factura';

    // ===== Reparto OPCIONAL (devengado) =====
    // Si la fila trae reparto y está MAL, se BLOQUEA toda la carga (se acumula en
    // _repartoErrores → bloqueoGlobal) hasta corregir el Excel. Si va en blanco, la
    // factura se importa sin repartir (se asigna a mano después).
    let repartoPlan = null;
    let repartoLabel = '—';
    const repartoRaw = String(raw.reparto ?? '').trim();
    const _errRep = msg => { _repartoErrores.push(`Factura ${folio}: ${msg}`); repartoLabel = '⛔ ' + msg; };
    if (repartoRaw && norm(repartoRaw) !== 'vacio') {
      const pr = parseReparto(raw.reparto, raw.unidades, proyecto, fechaFact);
      (pr.warnings || []).forEach(w => avisos.push('Reparto: ' + w));
      if (pr.errores && pr.errores.length) {
        _errRep('reparto inválido (' + pr.errores[0] + ')');
      } else {
        const asigs = (pr.asignaciones || []).filter(a => a.unidad_id);
        if (!asigs.length) {
          _errRep('el reparto no tiene unidades válidas');
        } else {
          const partidaTxt = String(raw.partida ?? '').trim();
          const cat = (state.partidasCatalogo || []).find(p => p.activa !== false && norm(p.partida) === norm(partidaTxt));
          if (!partidaTxt || !cat) {
            _errRep('el reparto requiere una Partida válida del catálogo');
          } else {
            const subs = Array.isArray(cat.subpartidas) ? cat.subpartidas : [];
            let subOv = '';
            let okSub = true;
            if (subs.length) {
              const subTxt = String(raw.sub_partida ?? '').trim();
              const subMatch = subs.find(s => norm(s) === norm(subTxt));
              if (!subMatch) { _errRep(`la partida "${cat.partida}" requiere una Sub-partida válida`); okSub = false; }
              else subOv = subMatch;
            }
            if (okSub) {
              repartoPlan = { metodo: pr.metodo, asignaciones: asigs.map(a => ({ unidad_id: a.unidad_id, pct: a.pct })), partida_override: cat.partida, sub_partida_override: subOv };
              repartoLabel = pr.metodo + ' (' + asigs.length + ')';
            }
          }
        }
      }
    }

    const registro = {
      numero_factura: folio,
      razon_social: String(raw.razon_social ?? '').trim() || prov.nombre,
      proveedor_id: provId,
      nombre_proveedor: prov.nombre,
      fecha_factura: fechaFact,
      fecha_vencimiento: fechaVenc || '',
      fecha_pago_total: '',
      subtotal: r2(subtotal),
      descuento: r2(descuento),
      iva_trasladado: r2(iva),
      retencion_iva: r2(retIva),
      retencion_isr: r2(retIsr),
      monto_total: montoTotal,
      monto: montoTotal,            // alias para el total del botón (se borra en insertar)
      monto_pagado: 0,
      saldo_pendiente: montoTotal,
      estatus_factura: 'pendiente',
      proyecto,
      observaciones: String(raw.observaciones ?? '').trim(),
      activo: true,
      uuid,
      rfc_emisor: (rfcExcel || prov.rfc || '').toUpperCase(),
      estado_sat: estadoSat,
      tipo_comprobante: tipoComp,
      _reparto: repartoPlan            // transitorio: se consume en insertar()
    };
    const preview = {
      numero_factura: folio,
      uuid,
      fecha: normalizarFechaDDMMYYYY(raw.fecha_factura),
      proveedor: `${provId} - ${prov.nombre}`,
      monto_total: montoTotal,
      reparto: repartoLabel
    };
    return { registro, avisos, preview };
  },

  insertar: (registros) => {
    let nextId = state.facturas.reduce((mx, f) => Math.max(mx, f.factura_id || 0), 0) + 1;
    const porFila = esPorFila('facturas');
    const hoyISO = new Date().toISOString().slice(0, 10);
    let creoAsig = false;
    registros.forEach(r => {
      delete r.monto;                 // alias solo para el total del botón
      const plan = r._reparto; delete r._reparto;  // transitorio
      r.factura_id = nextId++;
      r.saldo_pendiente = Math.max(0, (r.monto_total || 0) - (r.monto_pagado || 0));
      state.facturas.push(r);
      if (porFila) sbGuardarFila('facturas', r);
      // Devengado: si la fila traía reparto, genera las asignaciones de la factura
      // (sobre su monto_total), igual que el botón "Repartir".
      if (plan && plan.asignaciones.length) {
        plan.asignaciones.forEach(a => {
          state.costoAsignaciones.push({
            asignacion_id: nuevoAsignacionId(),
            pago_id: '',
            factura_id: String(r.factura_id),
            unidad_id: a.unidad_id,
            proyecto: r.proyecto,
            metodo: plan.metodo,
            monto_asignado: r2((r.monto_total || 0) * (a.pct / 100)),
            factor: a.pct / 100,
            fecha_asignacion: hoyISO,
            partida_override: plan.partida_override,
            sub_partida_override: plan.sub_partida_override,
            partida_obra: ''
          });
        });
        creoAsig = true;
      }
    });
    const cnt = document.getElementById('cnt-fact');
    if (cnt) cnt.textContent = state.facturas.length;
    if (creoAsig) gsSaveCostoAsignaciones();
  },

  save: async () => {
    await gsSaveFacturas({ porFila: esPorFila('facturas') });
  },

  postCommit: () => {
    if (window.renderFacturas) window.renderFacturas();
  },

  // Si alguna fila trae el reparto MAL escrito, se bloquea TODA la carga (como en
  // solicitudes) hasta que el Excel venga sin errores de reparto.
  bloqueoGlobal: () => {
    if (!_repartoErrores || !_repartoErrores.length) return null;
    const detalle = _repartoErrores.slice(0, 8).join('\n');
    const extra = _repartoErrores.length > 8 ? `\n…y ${_repartoErrores.length - 8} más` : '';
    return `⛔ Carga bloqueada: ${_repartoErrores.length} factura(s) con el reparto mal escrito:\n${detalle}${extra}\n\nCorrige el reparto en el Excel y vuelve a subirlo.`;
  }
});

export const abrirImportFacturas = () => facturasImporter.abrir();
export const descargarPlantillaFacturas = () => facturasImporter.descargarPlantilla();

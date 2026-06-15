// Config de import Excel para Historial, montado sobre src/services/excel-import.js.
// Acepta 5 tipos planos de movimiento (Pago, Credito, Aportacion, Prestamo, Traspaso)
// y deriva internamente tipo_registro + tipo del modelo de datos.

import { state } from '../state.js';
import { fmt } from '../ui/format.js';
import { proyectoMatch } from '../config/proyectos.js';
import { parseFechaHist } from './historial.js';
import { gsSaveHistorial, ensureHistorialIds } from '../services/google-sync.js';
import { getPartidasParaSelect } from '../config/sub-partidas.js';
import { createExcelImporter, normalizarFechaDDMMYYYY, parseImporte } from '../services/excel-import.js';

const TIPOS_MOVIMIENTO = ['Pago', 'Crédito', 'Aportación', 'Préstamo', 'Traspaso'];

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

function buildSetPartidas() {
  const opts = getPartidasParaSelect([...new Set(state.historial.map(h => h.partida).filter(Boolean))]);
  return new Set(opts.map(o => norm(o.value)));
}

function buildSetCuentas() {
  const set = new Set();
  (state.cuentasPropias || []).forEach(c => set.add(norm(c.nombre)));
  state.proyectos.forEach(p => set.add(norm(p.nombre)));
  state.historial.forEach(h => { if (h.cuenta_origen) set.add(norm(h.cuenta_origen)); });
  return set;
}

// Mapeo de Tipo movimiento (input usuario) → { tipo_registro, tipoDefault }
function resolverTipos(tipoMovInput, tipoCuentaCol, cuentaOrigen) {
  const t = String(tipoMovInput || 'Pago').trim();
  if (t === 'Pago') return { tipo_registro: 'Pago', tipo: tipoCuentaCol || (cuentaOrigen ? 'CLABE' : '') };
  if (t === 'Crédito') return { tipo_registro: 'Crédito', tipo: tipoCuentaCol || '' };
  if (t === 'Aportación') return { tipo_registro: 'Traspaso', tipo: 'Aportación' };
  if (t === 'Préstamo') return { tipo_registro: 'Traspaso', tipo: 'Préstamo' };
  if (t === 'Traspaso') return { tipo_registro: 'Traspaso', tipo: 'Traspaso' };
  return null;
}

export const historialImporter = createExcelImporter({
  key: 'historial',
  titulo: '📥 Importar Historial desde Excel',
  headerSignature: 'DEHUR — Importar Historial',
  filenamePrefix: 'Plantilla_Importar_Historial',

  // Columnas en orden del Sheet historial_pagos (sin la columna `id`)
  columns: [
    { key: 'proveedor_id', label: 'Proveedor ID', width: 12 },
    { key: 'factura_id', label: 'Factura ID', width: 12 },
    { key: 'fecha', label: 'Fecha (DD/MM/YYYY)', width: 18 },
    { key: 'nombre', label: 'Beneficiario', width: 28 },
    { key: 'banco', label: 'Banco', width: 10 },
    { key: 'tipo', label: 'Tipo cuenta', width: 14 },
    { key: 'concepto', label: 'Concepto', width: 32 },
    { key: 'importe', label: 'Importe', width: 12, align: 'right' },
    { key: 'proyecto', label: 'Proyecto', width: 18 },
    { key: 'cuenta_origen', label: 'Cuenta origen', width: 18 },
    { key: 'tipo_registro', label: 'Tipo movimiento', width: 16 },
    { key: 'partida', label: 'Partida', width: 18 },
    { key: 'sub_partida', label: 'Sub-partida', width: 18 }
  ],

  previewColumns: [
    { key: 'fecha', label: 'Fecha', css: '85px' },
    { key: 'nombre', label: 'Beneficiario', css: '1.2fr' },
    { key: 'concepto', label: 'Concepto', css: '1fr', style: 'color:var(--muted);font-size:11px;' },
    { key: 'importe', label: 'Importe', css: '110px', align: 'right', render: r => fmt(+r.importe || 0) },
    { key: 'cuenta_origen', label: 'Cuenta', css: '110px' },
    { key: 'proyecto', label: 'Proyecto', css: '100px' },
    { key: 'tipo_registro', label: 'Tipo', css: '90px', render: r => r.tipo_registro === 'Traspaso' ? `${r.tipo_registro}/${r.tipo}` : r.tipo_registro }
  ],

  referencia: () => {
    const proyectos = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
    const partidas = getPartidasParaSelect([...new Set(state.historial.map(h => h.partida).filter(Boolean))]).map(o => o.value);
    const cuentas = (state.cuentasPropias || []).map(c => c.nombre).concat(proyectos);
    return [
      { header: 'Proyectos activos', valores: proyectos },
      { header: 'Partidas catalogo', valores: partidas },
      { header: 'Tipo movimiento (5 valores)', valores: TIPOS_MOVIMIENTO },
      { header: 'Cuentas conocidas', valores: [...new Set(cuentas)] }
    ];
  },

  ejemplos: () => {
    const proyectos = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
    const partidas = getPartidasParaSelect([...new Set(state.historial.map(h => h.partida).filter(Boolean))]).map(o => o.value);
    const cuentas = (state.cuentasPropias || []).map(c => c.nombre).concat(proyectos);
    return [
      { proveedor_id: '', factura_id: '', fecha: '01/01/2025', nombre: 'Proveedor Ejemplo S.A.', banco: 'BBVA', tipo: 'CLABE', concepto: 'Pago factura A-123', importe: 12500.50, proyecto: proyectos[0] || '', cuenta_origen: cuentas[0] || '', tipo_registro: 'Pago', partida: partidas[0] || 'CONSTRUCCION', sub_partida: '' },
      { proveedor_id: '', factura_id: '', fecha: '15/01/2025', nombre: 'Aportacion a proyecto', banco: 'BBVA', tipo: '', concepto: 'Aportacion socios', importe: 50000, proyecto: proyectos[0] || '', cuenta_origen: cuentas[0] || '', tipo_registro: 'Aportación', partida: '', sub_partida: '' },
      { proveedor_id: '', factura_id: '', fecha: '20/01/2025', nombre: 'Empleado Ejemplo', banco: 'BBVA', tipo: 'CLABE', concepto: 'Pago nomina enero', importe: 8500, proyecto: proyectos[0] || '', cuenta_origen: cuentas[0] || '', tipo_registro: 'Pago', partida: 'NOMINA', sub_partida: '' }
    ];
  },

  validar: (raw, ctx) => {
    const proveedorId = String(raw.proveedor_id || '').trim();
    const facturaId = String(raw.factura_id || '').trim();
    const fecha = normalizarFechaDDMMYYYY(raw.fecha);
    const nombre = String(raw.nombre || '').trim();
    const banco = String(raw.banco || '').trim() || 'BBVA';
    const tipoCuenta = String(raw.tipo || '').trim();
    const concepto = String(raw.concepto || '').trim();
    const importe = parseImporte(raw.importe);
    const proyecto = String(raw.proyecto || '').trim();
    const cuentaOrigen = String(raw.cuenta_origen || '').trim();
    const tipoMovInput = String(raw.tipo_registro || 'Pago').trim();
    const partida = String(raw.partida || '').trim();
    const subPartida = String(raw.sub_partida || '').trim();

    if (!isFinite(importe) || importe <= 0) return { omit: 'Importe invalido o cero' };
    if (!fecha) return { omit: 'Fecha vacia o no parseable' };
    if (!nombre) return { omit: 'Beneficiario requerido' };

    const tiposResueltos = resolverTipos(tipoMovInput, tipoCuenta, cuentaOrigen);
    if (!tiposResueltos) {
      return { omit: `Tipo movimiento invalido: "${tipoMovInput}" (validos: ${TIPOS_MOVIMIENTO.join(', ')})` };
    }

    const avisos = [];
    if (proyecto) {
      const conocido = ctx.proyectosActivos.some(p => proyectoMatch(p.nombre, proyecto) || norm(p.nombre) === norm(proyecto));
      if (!conocido) avisos.push(`Proyecto "${proyecto}" no esta en catalogo activo`);
    }
    if (!cuentaOrigen) {
      avisos.push('Sin cuenta origen — no aparecera en Flujo de Salida');
    } else {
      const setCuentas = buildSetCuentas();
      if (!setCuentas.has(norm(cuentaOrigen))) avisos.push(`Cuenta "${cuentaOrigen}" no esta en cuentas conocidas`);
    }
    if (partida) {
      const setPartidas = buildSetPartidas();
      if (!setPartidas.has(norm(partida))) avisos.push(`Partida "${partida}" no esta en catalogo`);
    }

    const registro = {
      fecha,
      nombre,
      concepto,
      importe: Math.round(importe * 100) / 100,
      proyecto,
      banco,
      tipo: tiposResueltos.tipo,
      proveedor_id: proveedorId,
      factura_id: facturaId,
      cuenta_origen: cuentaOrigen,
      tipo_registro: tiposResueltos.tipo_registro,
      partida,
      sub_partida: subPartida
    };
    return { registro, avisos };
  },

  // Clave de duplicado: incluye el CONCEPTO para que dos pagos del mismo día,
  // monto, beneficiario y cuenta pero con distinto concepto (ej. "PAGO TOMA CASA
  // 415" vs "CASA 408", o dos CFE del mismo importe) NO se marquen como duplicados.
  duplicateKey: r => {
    const iso = parseFechaHist(r.fecha);
    return `${iso}|${(+r.importe || 0).toFixed(2)}|${norm(r.nombre)}|${norm(r.cuenta_origen)}|${norm(r.concepto)}`;
  },

  existingKeyset: () => {
    const k = new Set();
    state.historial.forEach(h => {
      const iso = parseFechaHist(h.fecha);
      k.add(`${iso}|${(+h.importe || 0).toFixed(2)}|${norm(h.nombre)}|${norm(h.cuenta_origen)}|${norm(h.concepto)}`);
    });
    return k;
  },

  insertar: (registros) => {
    for (let i = registros.length - 1; i >= 0; i--) state.historial.unshift(registros[i]);
    ensureHistorialIds();
    const cnt = document.getElementById('cnt-hist');
    if (cnt) cnt.textContent = state.historial.length;
  },

  save: async () => { await gsSaveHistorial(); },

  postCommit: () => {
    if (window.renderHistorial) window.renderHistorial();
    if (window.renderFlujoSalida) window.renderFlujoSalida();
    if (window.renderResumenCostos) window.renderResumenCostos();
  }
});

// Wrappers para mantener nombres anteriores expuestos en window
export const abrirImportHistorial = () => historialImporter.abrir();
export const descargarPlantillaHistorial = () => historialImporter.descargarPlantilla();

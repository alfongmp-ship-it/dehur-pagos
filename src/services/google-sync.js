import { state } from '../state.js';
import { notify } from '../ui/notify.js';
import { gsReadSheet, gsClearAndWrite, gsAppendRow } from './google-sheets.js';

export async function gsLoadAll() {
  try {
    // Proveedores: NEVER overwrite from Sheets — always from code/JSON

    // Load empleados
    const eRows = await gsReadSheet('empleados');
    if (eRows && eRows.length > 1) {
      state.empleados = eRows.slice(1).filter(r => r[0]).map(r => ({
        id: parseInt(r[0]) || 0,
        nombre: r[1] || '',
        puesto: r[2] || '',
        empresa: r[3] || '',
        banco: r[4] || 'BBVA',
        tipo_cuenta: r[5] || '',
        cuenta: r[6] || '',
        activo: r[7] !== 'false'
      }));
    }

    // Load historial
    const hRows = await gsReadSheet('historial_pagos');
    if (hRows && hRows.length > 1) {
      state.historial = hRows.slice(1).filter(r => r[0]).map(r => ({
        fecha: r[0] || '',
        nombre: r[1] || '',
        banco: r[2] || '',
        tipo: r[3] || '',
        concepto: r[4] || '',
        importe: parseFloat(r[5]) || 0,
        proyecto: r[6] || ''
      }));
    }

    // Load proyectos
    const prRows = await gsReadSheet('proyectos');
    if (prRows && prRows.length > 1) {
      const loaded = prRows.slice(1).filter(r => r[0]).map(r => ({
        id: r[0] || '',
        nombre: r[1] || '',
        empresa: r[2] || '',
        cuenta: r[3] || '',
        clabe: r[4] || '',
        color: r[5] || '#C8A96E',
        activo: r[6] !== 'false'
      }));
      if (loaded.length) state.proyectos = loaded;
    }

    // Re-render everything
    if (window.renderProveedores) window.renderProveedores();
    if (window.renderNomina) window.renderNomina();
    if (window.renderHistorial) window.renderHistorial();
    if (window.renderConfigProyectos) window.renderConfigProyectos();
    if (window.renderCuentaDispSelect) window.renderCuentaDispSelect();
    if (window.renderHeaderBadges) window.renderHeaderBadges();
    if (window.refreshProyectosEnSelects) window.refreshProyectosEnSelects();
    document.getElementById('cnt-hist').textContent = state.historial.length;
  } catch (e) {
    console.error('gsLoadAll error', e);
    notify('Error cargando datos: ' + e.message, 'error');
  }
}

export async function saveData() {
  if (!state.gsToken) return;
  try {
    if (state.historial.length) {
      const h = state.historial[0];
      await gsAppendRow('historial_pagos', [h.fecha, h.nombre, h.banco, h.tipo, h.concepto, h.importe, h.proyecto]);
    }
  } catch (e) { console.error('saveData error', e); }
}

export async function gsSaveProveedores() {
  if (!state.gsToken) return;
  try {
    const rows = state.proveedores.map(p => [p.id, p.nombre, p.rfc || '', p.banco, p.tipo_cuenta, p.cuenta, p.categoria, (p.proyectos || []).join('|'), p.activo]);
    await gsClearAndWrite('proveedores', rows, ['id', 'nombre', 'rfc', 'banco', 'tipo_cuenta', 'cuenta', 'categoria', 'proyectos', 'activo']);
    notify('✅ Proveedores guardados en Sheets');
  } catch (e) { notify('Error guardando proveedores: ' + e.message, 'error'); }
}

export async function gsSaveEmpleados() {
  if (!state.gsToken) return;
  try {
    const rows = state.empleados.map(e => [e.id, e.nombre, e.puesto || '', e.empresa || '', e.banco, e.tipo_cuenta, e.cuenta, e.activo]);
    await gsClearAndWrite('empleados', rows, ['id', 'nombre', 'puesto', 'empresa', 'banco', 'tipo_cuenta', 'cuenta', 'activo']);
    notify('✅ Empleados guardados en Sheets');
  } catch (e) { console.error('gsSaveEmpleados', e); }
}

export async function gsSaveProyectos() {
  if (!state.gsToken) return;
  try {
    const rows = state.proyectos.map(p => [p.id, p.nombre, p.empresa || '', p.cuenta || '', p.clabe || '', p.color || '', p.activo]);
    await gsClearAndWrite('proyectos', rows, ['id', 'nombre', 'empresa', 'cuenta', 'clabe', 'color', 'activo']);
    notify('✅ Proyectos guardados en Sheets');
  } catch (e) { console.error('gsSaveProyectos', e); }
}

// Config de import Excel para Empleados (Nomina).

import { state } from '../state.js';
import { gsSaveEmpleados } from '../services/google-sync.js';
import { createExcelImporter } from '../services/excel-import.js';

const BANCOS_COMUNES = ['BBVA', 'Santander', 'Banorte', 'Banamex', 'HSBC', 'Scotiabank', 'Inbursa'];

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

function detectarTipoCuenta(cuenta) {
  const limpia = String(cuenta || '').replace(/\D/g, '');
  if (limpia.length === 18) return 'CLABE';
  if (limpia.length === 10) return 'Cuenta BBVA';
  if (limpia.length === 16) return 'Tarjeta';
  return 'Cuenta';
}

export const empleadosImporter = createExcelImporter({
  key: 'empleados',
  titulo: '📥 Importar Nomina desde Excel',
  headerSignature: 'DEHUR — Importar Empleados',
  filenamePrefix: 'Plantilla_Importar_Empleados',

  // Columnas en orden del Sheet empleados
  columns: [
    { key: 'id', label: 'ID (opcional)', width: 12 },
    { key: 'nombre', label: 'Nombre', width: 30 },
    { key: 'puesto', label: 'Puesto', width: 22 },
    { key: 'empresa', label: 'Empresa', width: 28 },
    { key: 'banco', label: 'Banco', width: 12 },
    { key: 'tipo_cuenta', label: 'Tipo cuenta (CLABE/Cuenta BBVA)', width: 18 },
    { key: 'cuenta', label: 'Cuenta', width: 22 },
    { key: 'clabe', label: 'CLABE', width: 22 },
    { key: 'rfc', label: 'RFC', width: 16 },
    { key: 'activo', label: 'Activo (true/false)', width: 12 }
  ],

  previewColumns: [
    { key: 'nombre', label: 'Nombre', css: '1.3fr' },
    { key: 'puesto', label: 'Puesto', css: '140px' },
    { key: 'empresa', label: 'Empresa', css: '1fr', style: 'color:var(--muted);font-size:10px;' },
    { key: 'banco', label: 'Banco', css: '80px' },
    { key: 'tipo_cuenta', label: 'Tipo', css: '90px' },
    { key: 'cuenta', label: 'Cuenta', css: '140px', style: 'font-family:\'DM Mono\',monospace;font-size:10px;' }
  ],

  referencia: () => [
    { header: 'Bancos comunes', valores: BANCOS_COMUNES }
  ],

  ejemplos: () => [
    { id: '', nombre: 'Juan Perez Lopez', puesto: 'Administrador', empresa: 'Desarrollo y Control ALE', banco: 'BBVA', tipo_cuenta: 'CLABE', cuenta: '012180001234567890', clabe: '012180001234567890', rfc: 'PEPJ800101AAA', activo: 'true' },
    { id: '', nombre: 'Maria Garcia Ruiz', puesto: 'Contabilidad', empresa: 'Desarrollo de Hogares Urbanos', banco: 'BBVA', tipo_cuenta: 'Cuenta BBVA', cuenta: '1234567890', clabe: '', rfc: 'GARM850515AAA', activo: 'true' }
  ],

  validar: (raw) => {
    const idRaw = String(raw.id || '').trim();
    const nombre = String(raw.nombre || '').trim();
    const puesto = String(raw.puesto || '').trim();
    const empresa = String(raw.empresa || '').trim();
    const banco = String(raw.banco || '').trim() || 'BBVA';
    let tipoCuenta = String(raw.tipo_cuenta || '').trim();
    const cuentaLimpia = String(raw.cuenta || '').replace(/\D/g, '');
    const clabe = String(raw.clabe || '').replace(/\D/g, '');
    const rfc = String(raw.rfc || '').trim().toUpperCase();
    const activoRaw = String(raw.activo || 'true').trim().toLowerCase();
    const activo = !(activoRaw === 'false' || activoRaw === '0' || activoRaw === 'no');

    if (!nombre) return { omit: 'Nombre requerido' };
    if (!cuentaLimpia) return { omit: 'Cuenta requerida' };

    if (!tipoCuenta) tipoCuenta = detectarTipoCuenta(cuentaLimpia);

    const registro = {
      id: idRaw ? parseInt(idRaw, 10) : null,
      nombre,
      puesto,
      empresa,
      banco,
      tipo_cuenta: tipoCuenta,
      cuenta: cuentaLimpia,
      clabe,
      rfc,
      activo
    };
    return { registro };
  },

  duplicateKey: r => {
    if (r.rfc) return `rfc:${norm(r.rfc)}`;
    return `nc:${norm(r.nombre)}|${r.cuenta}`;
  },

  existingKeyset: () => {
    const k = new Set();
    state.empleados.forEach(e => {
      if (e.rfc) k.add(`rfc:${norm(e.rfc)}`);
      k.add(`nc:${norm(e.nombre)}|${e.cuenta}`);
    });
    return k;
  },

  insertar: (registros) => {
    const maxId = state.empleados.reduce((m, e) => Math.max(m, e.id || 0), 0);
    let next = maxId + 1;
    registros.forEach(r => {
      if (!r.id) r.id = next++;
      else if (r.id >= next) next = r.id + 1;
      state.empleados.push(r);
    });
    const cnt = document.getElementById('cnt-nom');
    if (cnt) cnt.textContent = state.empleados.length;
  },

  save: async () => { await gsSaveEmpleados(); },

  postCommit: () => {
    if (window.renderNomina) window.renderNomina();
  }
});

export const abrirImportEmpleados = () => empleadosImporter.abrir();
export const descargarPlantillaEmpleados = () => empleadosImporter.descargarPlantilla();

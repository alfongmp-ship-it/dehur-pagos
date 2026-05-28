// Config de import Excel para Proveedores.

import { state } from '../state.js';
import { gsSaveProveedores } from '../services/google-sync.js';
import { createExcelImporter, parseImporte } from '../services/excel-import.js';

const CATEGORIAS_VALIDAS = ['General', 'Nomina', 'Proveedor', 'Obra', 'Contratista', 'Acreedor', 'Socio'];
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

export const proveedoresImporter = createExcelImporter({
  key: 'proveedores',
  titulo: '📥 Importar Proveedores desde Excel',
  headerSignature: 'DEHUR — Importar Proveedores',
  filenamePrefix: 'Plantilla_Importar_Proveedores',

  // Columnas en orden del Sheet proveedores
  columns: [
    { key: 'proveedor_id', label: 'Proveedor ID (opcional)', width: 14 },
    { key: 'nombre', label: 'Nombre', width: 30 },
    { key: 'rfc', label: 'RFC', width: 16 },
    { key: 'banco', label: 'Banco', width: 12 },
    { key: 'tipo_cuenta', label: 'Tipo cuenta (CLABE/Cuenta BBVA)', width: 18 },
    { key: 'cuenta', label: 'Cuenta', width: 22 },
    { key: 'clabe', label: 'CLABE', width: 22 },
    { key: 'categoria', label: 'Categoria', width: 14 },
    { key: 'subcategoria', label: 'Subcategoria', width: 16 },
    { key: 'proyectos', label: 'Proyectos (separados por |)', width: 24 },
    { key: 'activo', label: 'Activo (true/false)', width: 12 },
    { key: 'bloqueada_para_pago', label: 'Bloqueada (true/false)', width: 14 }
  ],

  previewColumns: [
    { key: 'nombre', label: 'Nombre', css: '1.4fr' },
    { key: 'rfc', label: 'RFC', css: '130px' },
    { key: 'banco', label: 'Banco', css: '90px' },
    { key: 'tipo_cuenta', label: 'Tipo', css: '110px' },
    { key: 'cuenta', label: 'Cuenta', css: '160px', style: 'font-family:\'DM Mono\',monospace;font-size:10px;' },
    { key: 'categoria', label: 'Categoria', css: '110px' }
  ],

  referencia: () => {
    const proyectos = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
    return [
      { header: 'Categorias validas', valores: CATEGORIAS_VALIDAS },
      { header: 'Bancos comunes', valores: BANCOS_COMUNES },
      { header: 'Proyectos activos', valores: proyectos }
    ];
  },

  ejemplos: () => {
    const proyectos = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
    const proyEj = proyectos.slice(0, 2).join('|');
    return [
      { proveedor_id: '', nombre: 'Cementos Ejemplo S.A.', rfc: 'CEJ123456789', banco: 'BBVA', tipo_cuenta: 'CLABE', cuenta: '012180001234567890', clabe: '012180001234567890', categoria: 'Proveedor', subcategoria: 'Materiales', proyectos: proyEj, activo: 'true', bloqueada_para_pago: 'false' },
      { proveedor_id: '', nombre: 'Maestro Albanil Juan', rfc: 'JUAJ800101AAA', banco: 'BBVA', tipo_cuenta: 'Cuenta BBVA', cuenta: '1234567890', clabe: '', categoria: 'Contratista', subcategoria: '', proyectos: proyectos[0] || '', activo: 'true', bloqueada_para_pago: 'false' }
    ];
  },

  validar: (raw) => {
    const proveedorId = String(raw.proveedor_id || '').trim();
    const nombre = String(raw.nombre || '').trim();
    const rfc = String(raw.rfc || '').trim().toUpperCase();
    const banco = String(raw.banco || '').trim() || 'BBVA';
    let tipoCuenta = String(raw.tipo_cuenta || '').trim();
    const cuentaRaw = String(raw.cuenta || '').trim();
    const cuentaLimpia = cuentaRaw.replace(/\D/g, '');
    const clabe = String(raw.clabe || '').trim();
    const categoria = String(raw.categoria || 'General').trim();
    const subcategoria = String(raw.subcategoria || '').trim();
    const proyectosRaw = String(raw.proyectos || '').trim();
    const proyectos = proyectosRaw ? proyectosRaw.split(/[|,;]/).map(s => s.trim()).filter(Boolean) : [];
    const activoRaw = String(raw.activo || 'true').trim().toLowerCase();
    const activo = !(activoRaw === 'false' || activoRaw === '0' || activoRaw === 'no');
    const bloqRaw = String(raw.bloqueada_para_pago || 'false').trim().toLowerCase();
    const bloqueada = bloqRaw === 'true' || bloqRaw === '1' || bloqRaw === 'si' || bloqRaw === 'sí';

    if (!nombre) return { omit: 'Nombre requerido' };
    if (!cuentaLimpia) return { omit: 'Cuenta requerida' };

    if (!tipoCuenta) tipoCuenta = detectarTipoCuenta(cuentaLimpia);

    const avisos = [];
    if (categoria && !CATEGORIAS_VALIDAS.includes(categoria)) {
      avisos.push(`Categoria "${categoria}" no esta en lista estandar`);
    }
    if (proyectos.length) {
      const conocidos = new Set(state.proyectos.map(p => p.nombre));
      proyectos.forEach(p => { if (!conocidos.has(p)) avisos.push(`Proyecto "${p}" no esta en catalogo`); });
    }

    const registro = {
      id: proveedorId ? parseInt(proveedorId, 10) : null,
      nombre,
      rfc,
      banco,
      tipo_cuenta: tipoCuenta,
      cuenta: cuentaLimpia,
      clabe: clabe.replace(/\D/g, ''),
      categoria: categoria || 'General',
      subcategoria,
      proyectos,
      activo,
      bloqueada_para_pago: bloqueada,
      aliases: []
    };
    return { registro, avisos };
  },

  duplicateKey: r => {
    if (r.rfc) return `rfc:${norm(r.rfc)}`;
    return `nc:${norm(r.nombre)}|${r.cuenta}`;
  },

  existingKeyset: () => {
    const k = new Set();
    state.proveedores.forEach(p => {
      if (p.rfc) k.add(`rfc:${norm(p.rfc)}`);
      k.add(`nc:${norm(p.nombre)}|${p.cuenta}`);
    });
    return k;
  },

  insertar: (registros) => {
    registros.forEach(r => {
      if (!r.id) r.id = state.nextId++;
      else if (r.id >= state.nextId) state.nextId = r.id + 1;
      state.proveedores.push(r);
    });
    const cnt = document.getElementById('cnt-prov');
    if (cnt) cnt.textContent = state.proveedores.length;
  },

  save: async () => { await gsSaveProveedores(); },

  postCommit: () => {
    if (window.renderProveedores) window.renderProveedores();
  }
});

export const abrirImportProveedores = () => proveedoresImporter.abrir();
export const descargarPlantillaProveedores = () => proveedoresImporter.descargarPlantilla();

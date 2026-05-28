// Config de import Excel para Traspasos y Prestamos.
// Scope: solo Prestamo y Traspaso. Aportaciones se importan via Historial.
// Side effect: cada traspaso importado tambien crea entrada en
// state.movimientosInternos[] para que aparezca en Flujo de Salida.
// NO ajusta saldos de cuentas (decision del usuario).

import { state } from '../state.js';
import { gsSaveTraspasos, gsSaveMovimientosInternos } from '../services/google-sync.js';
import { createExcelImporter, normalizarFechaISO, parseImporte } from '../services/excel-import.js';

const TIPOS_VALIDOS = ['Préstamo', 'Traspaso'];

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

// Resuelve un nombre de cuenta a { id, tipo, nombre, proyecto } buscando en
// state.proyectos (cuenta_id = id de proyecto, tipo='proyecto') y luego en
// state.cuentasPropias (cuenta_id = cuenta_id, tipo='propia'). Devuelve null si no encuentra.
function resolverCuenta(nombre) {
  if (!nombre) return null;
  const n = norm(nombre);
  // 1) Proyecto
  const proy = state.proyectos.find(p => norm(p.nombre) === n);
  if (proy) {
    return { id: proy.id, tipo: 'proyecto', nombre: proy.nombre, proyecto: proy.nombre };
  }
  // 2) Cuenta propia
  const cp = (state.cuentasPropias || []).find(c => norm(c.nombre) === n);
  if (cp) {
    return { id: cp.cuenta_id, tipo: 'propia', nombre: cp.nombre, proyecto: cp.proyecto || '' };
  }
  return null;
}

export const traspasosImporter = createExcelImporter({
  key: 'traspasos',
  titulo: '📥 Importar Traspasos y Préstamos desde Excel',
  headerSignature: 'DEHUR — Importar Traspasos',
  filenamePrefix: 'Plantilla_Importar_Traspasos',

  // Columnas: pedimos NOMBRES de cuenta (no IDs) — los resolvemos al parsear.
  // El traspaso_id es opcional (autogenera).
  columns: [
    { key: 'traspaso_id', label: 'Traspaso ID (opcional)', width: 14 },
    { key: 'tipo', label: 'Tipo (Préstamo / Traspaso)', width: 18 },
    { key: 'cuenta_origen_nombre', label: 'Cuenta origen', width: 22 },
    { key: 'cuenta_destino_nombre', label: 'Cuenta destino', width: 22 },
    { key: 'monto', label: 'Monto', width: 14, align: 'right' },
    { key: 'fecha', label: 'Fecha (DD/MM/YYYY)', width: 18 },
    { key: 'concepto', label: 'Concepto', width: 32 },
    { key: 'referencia', label: 'Referencia', width: 14 },
    { key: 'estatus', label: 'Estatus (default completado)', width: 16 }
  ],

  previewColumns: [
    { key: 'fecha', label: 'Fecha', css: '85px', render: r => isoADdmmyyyy(r.fecha) },
    { key: 'tipo', label: 'Tipo', css: '100px' },
    { key: 'cuenta_origen_nombre', label: 'Origen', css: '1fr' },
    { key: 'cuenta_destino_nombre', label: 'Destino', css: '1fr' },
    { key: 'monto', label: 'Monto', css: '120px', align: 'right', render: r => '$' + (+r.monto || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 }) },
    { key: 'concepto', label: 'Concepto', css: '1.2fr', style: 'color:var(--muted);font-size:11px;' }
  ],

  referencia: () => {
    const proyectos = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
    const cuentasPropias = (state.cuentasPropias || []).map(c => c.nombre);
    return [
      { header: 'Tipos validos', valores: TIPOS_VALIDOS },
      { header: 'Cuentas conocidas', valores: [...new Set([...proyectos, ...cuentasPropias])] },
      { header: 'Estatus', valores: ['completado', 'pendiente'] }
    ];
  },

  ejemplos: () => {
    const proyectos = state.proyectos.filter(p => p.activo !== false).map(p => p.nombre);
    const o = proyectos[0] || '';
    const d = proyectos[1] || proyectos[0] || '';
    return [
      { traspaso_id: '', tipo: 'Préstamo', cuenta_origen_nombre: o, cuenta_destino_nombre: d, monto: 50000, fecha: '15/01/2025', concepto: 'Prestamo a proyecto', referencia: 'TR001', estatus: 'completado' },
      { traspaso_id: '', tipo: 'Traspaso', cuenta_origen_nombre: o, cuenta_destino_nombre: d, monto: 20000, fecha: '20/01/2025', concepto: 'Traspaso entre cuentas', referencia: '', estatus: 'completado' }
    ];
  },

  validar: (raw) => {
    const idRaw = String(raw.traspaso_id || '').trim();
    const tipo = String(raw.tipo || '').trim();
    const origenNombre = String(raw.cuenta_origen_nombre || '').trim();
    const destinoNombre = String(raw.cuenta_destino_nombre || '').trim();
    const monto = parseImporte(raw.monto);
    const fechaIso = normalizarFechaISO(raw.fecha);
    const concepto = String(raw.concepto || '').trim();
    const referencia = String(raw.referencia || '').trim();
    const estatus = String(raw.estatus || 'completado').trim().toLowerCase();

    if (!tipo) return { omit: 'Tipo requerido (Préstamo o Traspaso)' };
    if (norm(tipo) === norm('Aportación') || norm(tipo) === 'aportacion') {
      return { omit: 'Las aportaciones se importan por el módulo Historial, no por Traspasos' };
    }
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return { omit: `Tipo inválido: "${tipo}" (válidos: ${TIPOS_VALIDOS.join(', ')})` };
    }
    if (!fechaIso) return { omit: 'Fecha vacía o no parseable' };
    if (!isFinite(monto) || monto <= 0) return { omit: 'Monto inválido o cero' };
    if (!origenNombre) return { omit: 'Cuenta origen requerida' };
    if (!destinoNombre) return { omit: 'Cuenta destino requerida' };
    if (norm(origenNombre) === norm(destinoNombre)) return { omit: 'Origen y destino no pueden ser la misma cuenta' };

    const o = resolverCuenta(origenNombre);
    const d = resolverCuenta(destinoNombre);
    if (!o) return { omit: `Cuenta origen "${origenNombre}" no existe (revisa Cuentas Propias o Proyectos)` };
    if (!d) return { omit: `Cuenta destino "${destinoNombre}" no existe (revisa Cuentas Propias o Proyectos)` };

    const registro = {
      _idImport: idRaw ? parseInt(idRaw, 10) : null,
      tipo,
      cuenta_origen_id: o.id,
      cuenta_origen_tipo: o.tipo,
      cuenta_origen_nombre: o.nombre,
      proyecto_origen: o.proyecto,
      cuenta_destino_id: d.id,
      cuenta_destino_tipo: d.tipo,
      cuenta_destino_nombre: d.nombre,
      proyecto_destino: d.proyecto,
      monto: Math.round(monto * 100) / 100,
      fecha: fechaIso,
      concepto,
      referencia,
      estatus: estatus === 'pendiente' ? 'pendiente' : 'completado',
      fecha_registro: new Date().toISOString().split('T')[0]
    };
    return { registro };
  },

  duplicateKey: r => `${r.fecha}|${(+r.monto || 0).toFixed(2)}|${norm(r.cuenta_origen_nombre)}|${norm(r.cuenta_destino_nombre)}`,

  existingKeyset: () => {
    const k = new Set();
    state.traspasos.forEach(t => {
      k.add(`${t.fecha}|${(+t.monto || 0).toFixed(2)}|${norm(t.cuenta_origen_nombre)}|${norm(t.cuenta_destino_nombre)}`);
    });
    return k;
  },

  insertar: (registros) => {
    // Asignar traspaso_id estable
    const maxId = state.traspasos.reduce((m, t) => Math.max(m, t.traspaso_id || 0), 0);
    let next = maxId + 1;
    let maxMiId = (state.movimientosInternos || []).reduce((m, x) => Math.max(m, x.id || 0), 0);
    let nextMi = maxMiId + 1;

    registros.forEach(r => {
      const id = r._idImport && r._idImport > 0 ? r._idImport : next++;
      if (id >= next) next = id + 1;
      delete r._idImport;
      r.traspaso_id = id;
      state.traspasos.push(r);

      // Side effect: SIEMPRE crear entrada en movimientosInternos[] (porque el
      // scope es solo Prestamo y Traspaso, que en el flujo manual van ambos a
      // movimientosInternos). Esto los hace aparecer en Flujo de Salida.
      state.movimientosInternos.push({
        id: nextMi++,
        fecha: r.fecha,
        tipo: r.tipo,
        origen: r.cuenta_origen_nombre,
        destino: r.cuenta_destino_nombre,
        monto: r.monto,
        concepto: r.concepto || '',
        referencia: r.referencia || ''
      });
    });
    const cnt = document.getElementById('cnt-traspasos');
    if (cnt) cnt.textContent = state.traspasos.length;
  },

  save: async () => {
    await gsSaveTraspasos();
    await gsSaveMovimientosInternos();
  },

  postCommit: () => {
    if (window.renderTraspasos) window.renderTraspasos();
    if (window.renderResumenTraspasos) window.renderResumenTraspasos();
    if (window.renderFlujoSalida) window.renderFlujoSalida();
  }
});

function isoADdmmyyyy(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export const abrirImportTraspasos = () => traspasosImporter.abrir();
export const descargarPlantillaTraspasos = () => traspasosImporter.descargarPlantilla();

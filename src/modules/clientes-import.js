// Config de import Excel para CLIENTES (módulo Ingresos).
// Mismo framework que proveedores/facturas: plantilla + preview + validación por
// fila + bloqueo de duplicados. Guarda POR FILA (clientes está en ENTIDADES_POR_FILA)
// para no espejear la tabla completa con realtime encendido.

import { state, nuevoClienteId } from '../state.js';
import { gsSaveClientes, esPorFila, sbGuardarFila } from '../services/google-sync.js';
import { createExcelImporter } from '../services/excel-import.js';

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

export const clientesImporter = createExcelImporter({
  key: 'clientes',
  titulo: '📥 Importar Clientes desde Excel',
  headerSignature: 'DEHUR — Importar Clientes',
  filenamePrefix: 'Plantilla_Importar_Clientes',

  columns: [
    { key: 'nombre', label: 'Nombre', width: 30 },
    { key: 'rfc', label: 'RFC', width: 16 },
    { key: 'telefono', label: 'Telefono', width: 16 },
    { key: 'email', label: 'Email', width: 26 },
    { key: 'proyectos_interes', label: 'Proyectos de interes (separados por |)', width: 26 },
    { key: 'observaciones', label: 'Observaciones', width: 30 },
    { key: 'activo', label: 'Activo (true/false)', width: 12 }
  ],

  previewColumns: [
    { key: 'nombre', label: 'Nombre', css: '1.6fr' },
    { key: 'rfc', label: 'RFC', css: '150px' },
    { key: 'telefono', label: 'Telefono', css: '130px' },
    { key: 'email', label: 'Email', css: '1.2fr' }
  ],

  referencia: () => ([
    { header: 'Proyectos activos', valores: (state.proyectos || []).filter(p => p.activo !== false).map(p => p.nombre) }
  ]),

  ejemplos: () => {
    const proy = (state.proyectos || []).find(p => p.activo !== false);
    return [
      { nombre: 'Juan Perez Lopez', rfc: 'PELJ800101AAA', telefono: '5512345678', email: 'juan@correo.com', proyectos_interes: proy ? proy.nombre : '', observaciones: '', activo: 'true' },
      { nombre: 'Inmobiliaria Ejemplo S.A. de C.V.', rfc: 'IEJ123456789', telefono: '', email: '', proyectos_interes: '', observaciones: 'Compra 2 casas', activo: 'true' }
    ];
  },

  validar: (raw) => {
    const nombre = String(raw.nombre || '').trim();
    const rfc = String(raw.rfc || '').trim().toUpperCase();
    const activoRaw = String(raw.activo || 'true').trim().toLowerCase();
    const activo = !(activoRaw === 'false' || activoRaw === '0' || activoRaw === 'no');

    if (!nombre) return { omit: 'Nombre requerido' };

    const avisos = [];
    // El RFC no se exige: hay clientes persona física sin RFC a la mano al apartar.
    if (rfc && rfc.length !== 12 && rfc.length !== 13) {
      avisos.push(`RFC con longitud inusual (${rfc.length}); se importa igual — revisa "${nombre}"`);
    }

    // Proyectos de interés: se canonicaliza el nombre si coincide con un proyecto;
    // uno desconocido se importa tal cual con aviso (no bloquea al prospecto).
    const proyectosInteres = [];
    String(raw.proyectos_interes || '').split(/[|,;]/).map(s => s.trim()).filter(Boolean).forEach(px => {
      const p = (state.proyectos || []).find(p2 => norm(p2.nombre) === norm(px));
      const nombreCanon = p ? p.nombre : px;
      if (!p) avisos.push(`Proyecto de interés desconocido "${px}" (cliente "${nombre}") — se importa tal cual`);
      if (!proyectosInteres.includes(nombreCanon)) proyectosInteres.push(nombreCanon);
    });

    return {
      registro: {
        cliente_id: '',            // se acuña en insertar (UUID)
        nombre,
        rfc,
        telefono: String(raw.telefono || '').trim(),
        email: String(raw.email || '').trim(),
        observaciones: String(raw.observaciones || '').trim(),
        activo,
        proyectos_interes: proyectosInteres
      },
      avisos
    };
  },

  // Un cliente ya existente no se vuelve a crear: por RFC si lo trae, si no por
  // nombre. Cubre tanto el choque contra state.clientes como filas repetidas
  // dentro del mismo archivo (el framework acumula las llaves del lote).
  duplicateKey: (r) => (r.rfc ? `rfc:${norm(r.rfc)}` : `nom:${norm(r.nombre)}`),

  existingKeyset: () => {
    const k = new Set();
    (state.clientes || []).forEach(c => {
      if (c.rfc) k.add(`rfc:${norm(c.rfc)}`);
      k.add(`nom:${norm(c.nombre)}`);
    });
    return k;
  },

  insertar: (registros) => {
    const porFila = esPorFila('clientes');
    registros.forEach(r => {
      if (!r.cliente_id) r.cliente_id = nuevoClienteId();
      state.clientes.push(r);
      if (porFila) sbGuardarFila('clientes', r);
    });
  },

  save: async () => { await gsSaveClientes({ porFila: esPorFila('clientes') }); },

  postCommit: () => {
    if (window.renderClientes) window.renderClientes();
  }
});

export const abrirImportClientes = () => clientesImporter.abrir();
export const descargarPlantillaClientes = () => clientesImporter.descargarPlantilla();

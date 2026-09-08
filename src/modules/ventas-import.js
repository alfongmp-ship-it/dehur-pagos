// Config de import Excel para VENTAS POR UNIDAD (módulo Ingresos).
//
// El Excel referencia por NOMBRE (proyecto / casa / cliente), nunca por id interno:
// los ids son UUID y nadie los va a teclear. Las referencias se resuelven contra el
// state con el mismo criterio de presupuesto-bulk (normalizar y comparar).
//
// Reglas calcadas de guardarVenta (ingresos.js) para que importar y capturar a mano
// dejen EXACTAMENTE el mismo registro:
//   · precio_venta > 0
//   · una unidad no puede tener dos ventas activas no canceladas
//   · monto_cobrado / saldo_cliente son DERIVADOS — nunca se importan
//
// Referencia inexistente (proyecto/casa/cliente) = se BLOQUEA toda la carga: media
// cartera cargada es peor que ninguna, porque no se ve a simple vista qué faltó.

import { state, nuevoVentaId } from '../state.js';
import { gsSaveVentas, esPorFila, sbGuardarFila } from '../services/google-sync.js';
import { createExcelImporter, parseImporte, normalizarFechaDDMMYYYY } from '../services/excel-import.js';
import { recalcularVenta } from './ingresos.js';

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const ESTATUS_VALIDOS = ['apartada', 'vendida', 'escriturada', 'cancelada'];
const TIPOS_CREDITO = ['contado', 'bancario', 'infonavit', 'fovissste', 'cofinanciado', 'otro'];

// Referencias no resueltas del archivo → bloqueoGlobal. Se reinicia en existingKeyset,
// que el framework llama UNA vez por parseo, antes de validar (patrón facturas-import).
let _refErrores;

export const ventasImporter = createExcelImporter({
  key: 'ventas',
  titulo: '📥 Importar Ventas por unidad desde Excel',
  headerSignature: 'DEHUR — Importar Ventas',
  filenamePrefix: 'Plantilla_Importar_Ventas',

  columns: [
    { key: 'proyecto', label: 'Proyecto', width: 20 },
    { key: 'unidad', label: 'Casa / Unidad', width: 14 },
    { key: 'cliente', label: 'Cliente (nombre o RFC)', width: 30 },
    { key: 'precio_venta', label: 'Precio de venta', width: 16 },
    { key: 'tipo_credito', label: 'Tipo de credito', width: 16 },
    { key: 'estatus_comercial', label: 'Estatus comercial', width: 16 },
    { key: 'fecha_apartado', label: 'Fecha apartado (DD/MM/YYYY)', width: 20, text: true },
    { key: 'fecha_escritura_estimada', label: 'Escritura estimada (DD/MM/YYYY)', width: 22, text: true },
    { key: 'fecha_escritura_real', label: 'Escritura real (DD/MM/YYYY)', width: 20, text: true },
    { key: 'valor_liberacion', label: 'Valor de liberacion', width: 16 },
    { key: 'observaciones', label: 'Observaciones', width: 28 },
    { key: 'activo', label: 'Activo (true/false)', width: 12 }
  ],

  previewColumns: [
    { key: 'proyecto', label: 'Proyecto', css: '1fr' },
    { key: '_unidadNombre', label: 'Casa', css: '90px' },
    { key: '_clienteNombre', label: 'Cliente', css: '1.4fr' },
    { key: 'precio_venta', label: 'Precio', css: '120px', style: 'font-family:\'DM Mono\',monospace;font-size:10px;text-align:right;' },
    { key: 'estatus_comercial', label: 'Estatus', css: '110px' }
  ],

  referencia: () => {
    const proyectos = (state.proyectos || []).filter(p => p.activo !== false).map(p => p.nombre);
    const clientes = (state.clientes || []).filter(c => c.activo !== false).map(c => c.nombre).slice(0, 60);
    return [
      { header: 'Proyectos', valores: proyectos },
      { header: 'Estatus comercial', valores: ESTATUS_VALIDOS },
      { header: 'Tipo de credito', valores: TIPOS_CREDITO },
      { header: 'Clientes dados de alta', valores: clientes }
    ];
  },

  ejemplos: () => {
    const proy = (state.proyectos || []).find(p => p.activo !== false);
    const proyNom = proy ? proy.nombre : 'Privada del Paraiso';
    const uni = (state.unidades || []).find(u => u.activo !== false && u.proyecto === proyNom);
    const cli = (state.clientes || []).find(c => c.activo !== false);
    return [{
      proyecto: proyNom,
      unidad: uni ? uni.nombre : '329',
      cliente: cli ? cli.nombre : 'Juan Perez Lopez',
      precio_venta: '1850000',
      tipo_credito: 'infonavit',
      estatus_comercial: 'apartada',
      fecha_apartado: '15/03/2026',
      fecha_escritura_estimada: '30/09/2026',
      fecha_escritura_real: '',
      valor_liberacion: '',
      observaciones: '',
      activo: 'true'
    }];
  },

  validar: (raw) => {
    const proyectoTxt = String(raw.proyecto || '').trim();
    const unidadTxt = String(raw.unidad || '').trim();
    const clienteTxt = String(raw.cliente || '').trim();

    if (!proyectoTxt) return { omit: 'Proyecto requerido' };
    if (!unidadTxt) return { omit: 'Casa / Unidad requerida' };
    if (!clienteTxt) return { omit: 'Cliente requerido' };

    // --- Resolución de referencias (nombre → id) ---
    const unidad = (state.unidades || []).find(u =>
      u.activo !== false &&
      norm(u.proyecto) === norm(proyectoTxt) &&
      norm(u.nombre) === norm(unidadTxt));
    if (!unidad) {
      _refErrores.push(`Casa "${unidadTxt}" no existe en el proyecto "${proyectoTxt}"`);
      return { omit: `Casa "${unidadTxt}" no existe en "${proyectoTxt}"` };
    }

    const cliente = (state.clientes || []).find(c =>
      norm(c.nombre) === norm(clienteTxt) ||
      (c.rfc && norm(c.rfc) === norm(clienteTxt)));
    if (!cliente) {
      _refErrores.push(`Cliente "${clienteTxt}" no está dado de alta (impórtalo primero en Clientes)`);
      return { omit: `Cliente "${clienteTxt}" no existe` };
    }

    const precio = parseImporte(raw.precio_venta);
    if (!(precio > 0)) return { omit: 'El precio de venta debe ser mayor a 0' };

    const estatusRaw = norm(raw.estatus_comercial) || 'apartada';
    if (!ESTATUS_VALIDOS.includes(estatusRaw)) {
      return { omit: `Estatus comercial inválido: "${raw.estatus_comercial}" (usa ${ESTATUS_VALIDOS.join(' / ')})` };
    }
    const tipoCredRaw = norm(raw.tipo_credito);
    if (tipoCredRaw && !TIPOS_CREDITO.includes(tipoCredRaw)) {
      return { omit: `Tipo de crédito inválido: "${raw.tipo_credito}" (usa ${TIPOS_CREDITO.join(' / ')})` };
    }

    const avisos = [];
    const fApartado = raw.fecha_apartado ? normalizarFechaDDMMYYYY(raw.fecha_apartado) : '';
    const fEstim = raw.fecha_escritura_estimada ? normalizarFechaDDMMYYYY(raw.fecha_escritura_estimada) : '';
    const fReal = raw.fecha_escritura_real ? normalizarFechaDDMMYYYY(raw.fecha_escritura_real) : '';
    if (raw.fecha_apartado && !fApartado) avisos.push(`Fecha de apartado no legible en la casa ${unidadTxt}; se deja vacía`);
    if (raw.fecha_escritura_estimada && !fEstim) avisos.push(`Escritura estimada no legible en la casa ${unidadTxt}; se deja vacía`);
    if (raw.fecha_escritura_real && !fReal) avisos.push(`Escritura real no legible en la casa ${unidadTxt}; se deja vacía`);

    const activoRaw = String(raw.activo || 'true').trim().toLowerCase();
    const activo = !(activoRaw === 'false' || activoRaw === '0' || activoRaw === 'no');

    return {
      registro: {
        venta_id: '',                       // se acuña en insertar (UUID)
        unidad_id: String(unidad.unidad_id),
        proyecto: unidad.proyecto,          // nombre canónico del catálogo, no el tecleado
        cliente_id: String(cliente.cliente_id),
        precio_venta: precio,
        tipo_credito: tipoCredRaw,
        estatus_comercial: estatusRaw,
        fecha_apartado: fApartado,
        fecha_escritura_estimada: fEstim,
        fecha_escritura_real: fReal,
        valor_liberacion: parseImporte(raw.valor_liberacion) || 0,
        credito_id: '',                     // el crédito puente se liga a mano desde el modal
        monto_cobrado: 0,                   // DERIVADOS: recalcularVenta los fija en insertar
        saldo_cliente: 0,
        observaciones: String(raw.observaciones || '').trim(),
        activo,
        // Solo para la vista previa (se eliminan antes de guardar)
        _unidadNombre: unidad.nombre,
        _clienteNombre: cliente.nombre
      },
      avisos
    };
  },

  // "Duplicado" aquí = la casa YA tiene una venta viva. Misma regla que el modal.
  // Una fila CANCELADA no compite por la casa, así que no lleva llave.
  duplicateKey: (r) => (r.estatus_comercial === 'cancelada' ? null : `uni:${String(r.unidad_id)}`),

  // El framework lo llama UNA vez por parseo, antes de validar: sirve de reset.
  existingKeyset: () => {
    _refErrores = [];
    const k = new Set();
    (state.ventas || []).forEach(v => {
      if (v.estatus_comercial !== 'cancelada' && v.activo !== false) k.add(`uni:${String(v.unidad_id)}`);
    });
    return k;
  },

  insertar: (registros) => {
    const porFila = esPorFila('ventas');
    registros.forEach(r => {
      delete r._unidadNombre; delete r._clienteNombre;   // solo eran para el preview
      r.venta_id = nuevoVentaId();
      recalcularVenta(r);        // única fuente de verdad de monto_cobrado / saldo_cliente
      state.ventas.push(r);
      if (porFila) sbGuardarFila('ventas', r);
    });
  },

  save: async () => { await gsSaveVentas({ porFila: esPorFila('ventas') }); },

  postCommit: () => {
    if (window.renderVentas) window.renderVentas();
  },

  // Una referencia que no existe casi siempre significa que el Excel viene de otra
  // fuente o con nombres viejos: se corrige el archivo, no se carga a medias.
  bloqueoGlobal: () => {
    if (!_refErrores || !_refErrores.length) return null;
    const unicos = [...new Set(_refErrores)];
    const detalle = unicos.slice(0, 8).join('\n');
    const extra = unicos.length > 8 ? `\n…y ${unicos.length - 8} más` : '';
    return `⛔ Carga bloqueada: ${unicos.length} referencia(s) que no existen en el sistema:\n${detalle}${extra}\n\nCorrige los nombres en el Excel (o da de alta primero los clientes) y vuelve a subirlo.`;
  }
});

export const abrirImportVentas = () => ventasImporter.abrir();
export const descargarPlantillaVentas = () => ventasImporter.descargarPlantilla();

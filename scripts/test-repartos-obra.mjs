// Pruebas del motor de "Repartos de obra" (formato de dispersiones de la obra).
//   node scripts/test-repartos-obra.mjs
// Datos inventados con la forma del formato (no datos reales).
import { fechaISO, tipoDeTexto, leerFormatoDispersion, interpretarReparto, deduplicarFilas, provParecido, emparejarFilas, partidaValida, elegirPartida } from '../src/services/repartos-obra.js';

let ok = 0, fail = 0;
const ck = (n, c, d) => { if (c) { ok++; console.log('OK  ' + n); } else { fail++; console.error('XX  ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); } };

// --- 1. fechas y tipo ---
ck('fecha: número de serie de Excel', fechaISO(46027) === '2026-01-05', fechaISO(46027));
ck('fecha: DD/MM/YYYY', fechaISO('5/1/2026') === '2026-01-05');
ck('fecha: ISO', fechaISO('2026-03-17') === '2026-03-17');
ck('fecha: Date local', fechaISO(new Date(2026, 3, 30)) === '2026-04-30');
ck('fecha: basura → vacía', fechaISO('pendiente') === '' && fechaISO(12) === '');
ck('tipo: TRANSFERANCIA (así lo escribe la obra) = transferencia', tipoDeTexto('TRANSFERANCIA') === 'transferencia' && tipoDeTexto('Factura ') === 'factura');

// --- 2. leer el formato (columnas por nombre) ---
const enc = ['ID / N°', 'Fecha Emisión', 'Tipo Comprobante', 'Proveedor', 'Descripción Producto/Servicio', 'Categoría / Usos / Area', 'Importe', 'Descripción Particular', 'Aplicación X Depto. en Obra', 'Reparto'];
const encMovido = ['Reparto', 'Importe', 'Proveedor', 'Fecha Emisión', 'Tipo Comprobante', 'Aplicación X Depto. en Obra'];
const hojas = [
  { archivo: 'ENE.xlsx', nombre: 'RegCompEne', filaInicial: 0, filas: [
    ['REGISTRO DE CONTROL DE COMPRAS / DISPERSIONES'], [], ['Periodo:', 46023], [], [], [],
    enc,
    ['001', 46027, 'FACTURA', 'PROVEEDOR UNO SA DE CV', 'MATERIAL CARPINTERIA', 'DEPTOS', 1000, 'TRIPLAY', '101, 102', 'EQUITATIVO'],
    ['002', 46028, 'TRANSFERANCIA', 'CONTRATISTA DOS', 'ESTIMACION', 'DEPTOS', 5000, '', 'TODOS', 'INDIVISO'],
    ['003', '', '', '', '', '', '', '', '', ''],                                   // renglón vacío de la plantilla
    ['', '', '', '', '', 'TOTALES', 6000, '', '', ''],
  ] },
  { archivo: 'FEB.xlsx', nombre: 'Columnas movidas', filaInicial: 2, filas: [encMovido, ['DIRECTO', '1,234.50', 'OTRO PROV', '03/02/2026', 'Factura', '201']] },
  { archivo: 'FEB.xlsx', nombre: 'Notas', filas: [['sin encabezados'], ['x']] },
];
const lect = leerFormatoDispersion(hojas);
ck('lee 2 hojas del formato e ignora la que no lo es', lect.hojasLeidas.length === 2 && lect.hojasIgnoradas.length === 1 && lect.hojasIgnoradas[0].hoja === 'Notas');
ck('salta renglones vacíos y TOTALES: 3 renglones', lect.filas.length === 3, lect.filas.length);
const f1 = lect.filas[0];
ck('renglón 1 completo', f1.fecha === '2026-01-05' && f1.tipo === 'factura' && f1.importe === 1000 && f1.aplicacion === '101, 102' && f1.reparto === 'EQUITATIVO' && f1.concepto === 'MATERIAL CARPINTERIA' && f1.particular === 'TRIPLAY' && f1.renglon === 8, f1);
const f3 = lect.filas[2];
ck('columnas en otro orden se leen por nombre (importe con coma, renglón real)', f3.importe === 1234.5 && f3.fecha === '2026-02-03' && f3.aplicacion === '201' && f3.reparto === 'DIRECTO' && f3.renglon === 4, f3);

// --- 3. interpretar reparto ---
const I = (r, a) => interpretarReparto(r, a);
let x = I('EQUITATIVO', '304, 402, 501,');
ck('EQUITATIVO + lista (coma final) → equitativo 3', x.ok && x.metodo === 'equitativo' && x.codigos.join() === '304,402,501', x);
x = I('EQUITATIVO', '304, 402, 501 601, 602');
ck('lista con espacio en vez de coma → 5 casas', x.ok && x.codigos.length === 5, x);
x = I('equitativo', '602');
ck('EQUITATIVO con 1 casa → directo', x.ok && x.metodo === 'directo' && x.codigos[0] === '602' && /1 sola casa/.test(x.nota), x);
x = I('DIRECTO', '402');
ck('DIRECTO 1 casa → directo', x.ok && x.metodo === 'directo');
ck('INDIVISO + TODOS / DESARROLLO / "TODOS " → indiviso', I('INDIVISO', 'TODOS ').ok && I('INDIVISO', 'DESARROLLO').metodo === 'indiviso');
x = I('INDIVISOS', 'TODOS');
ck('"INDIVISOS" se toma como indiviso (con nota)', x.ok && x.metodo === 'indiviso' && /INDIVISO/.test(x.nota), x);
ck('DIRECTO con varias casas → revisar', !I('DIRECTO', '505, 903').ok && /DIRECTO con 2 casas/.test(I('DIRECTO', '505, 903').motivo));
ck('INDIVISO con lista → revisar', !I('INDIVISO', '202, 204').ok);
ck('EQUITATIVO con TODOS → revisar (ambiguo)', !I('EQUITATIVO', 'TODOS').ok);
ck('DIRECTO con TODOS → revisar', !I('DIRECTO', 'TODOS').ok);
ck('FACHADAS → revisar', !I('INDIVISO', 'FACHADAS').ok);
ck('"302, AREAS COMUNES" → revisar', !I('EQUITATIVO', '302, AREAS COMUNES').ok);
ck('"27 G20 Y 18 G30" → revisar', !I('EQUITATIVO', '27 G20 Y 18 G30').ok);
x = I('EQUITATIVO', '901902903');
ck('casas pegadas → revisar con sugerencia', !x.ok && /901, 902, 903/.test(x.motivo), x);
ck('casa repetida → revisar', !I('EQUITATIVO', '101, 102, 101').ok);
ck('sin método → revisar', !I('', '101, 102').ok && /Falta el reparto/.test(I('', '101, 102').motivo));
ck('método desconocido → revisar', !I('PRORRATEO', '101').ok);
ck('DIRECTO sin casas → revisar', !I('DIRECTO', '').ok);
x = I('', '');
ck('vacío → vacio:true', !x.ok && x.vacio);

// --- 4. repetidos entre hojas ---
const base = { tipo: 'factura', fecha: '2026-01-13', importe: 500, proveedor: 'PROV X', reparto: 'EQUITATIVO', aplicacion: '101, 102' };
const ded = deduplicarFilas([
  { ...base, archivo: 'A', hoja: 'Ene', renglon: 10 },
  { ...base, archivo: 'A', hoja: 'Ene', renglon: 11 },                                   // gemela misma hoja → se queda
  { ...base, archivo: 'A', hoja: 'Feb', renglon: 10, aplicacion: '101,102' },            // copia en otra hoja → una vez
  { ...base, archivo: 'B', hoja: 'Feb', renglon: 9, reparto: '', aplicacion: '' },       // copia vacía → se descarta
  { ...base, importe: 700, archivo: 'A', hoja: 'Ene', renglon: 12 },
  { ...base, importe: 700, archivo: 'C', hoja: 'Mar', renglon: 5, aplicacion: '103' },   // MISMO renglón con otro reparto → conflicto
  { ...base, importe: 900, archivo: 'C', hoja: 'Mar', renglon: 6, reparto: '', aplicacion: '' },   // sin reparto
]);
ck('gemelas de la misma hoja se quedan; copias de otra hoja se cuentan una vez', ded.unicas.filter(u => u.importe === 500).length === 2, ded.unicas.map(u => u.renglon));
ck('copia vacía y copia igual van a "repetidas"', ded.repetidas.filter(r => r.fila.importe === 500).length === 2);
ck('mismo renglón con otro reparto → conflicto marcado', ded.unicas.find(u => u.importe === 700).conflicto.length === 1 && ded.repetidas.some(r => r.conflicto));
ck('renglón sin reparto ni casas → aparte', ded.sinReparto.length === 1 && ded.sinReparto[0].importe === 900);

// --- 5. proveedor parecido ---
ck('proveedor: abreviatura "TECNOL. INDUS. DEL NTE." ~ "TECNOLOGIA INDUSTRIAL DEL NORTE"', provParecido('TECNOL. INDUS. DEL NTE.', ['TECNOLOGIA INDUSTRIAL DEL NORTE SA DE CV']));
ck('proveedor: nombre comercial dentro de la razón social', provParecido('MADERAS ROBLE', ['JUAN PEREZ LOPEZ MADERAS ROBLE']));
ck('proveedor: alias cuenta', provParecido('DECORACIONES LUNA', ['JOSE GOMEZ RUIZ', 'DECORACIONES LUNA']));
ck('proveedor: distinto NO', !provParecido('DECORACIONES LUNA', ['JOSE GOMEZ RUIZ']));
ck('proveedor: solo palabras genéricas NO ("GRUPO COMERCIAL" vs "GRUPO COMERCIAL")', !provParecido('GRUPO COMERCIAL SA DE CV', ['GRUPO COMERCIAL']));

// --- 6. ligar renglón ↔ factura ---
const F = (id, fecha, total, nombre, extra = {}) => ({ id: String(id), fecha, total, nombres: [nombre], valida: true, ...extra });
const R = (renglon, fecha, importe, proveedor, extra = {}) => ({ archivo: 'A', hoja: 'H', renglon, tipo: 'factura', fecha, importe, proveedor, reparto: 'EQUITATIVO', aplicacion: '101, 102', ...extra });
const facts = [
  F(1, '2026-01-05', 1000, 'PROVEEDOR UNO'),
  F(2, '2026-03-06', 4321.10, 'FLUIDOS ARCA'), F(3, '2026-03-17', 4321.10, 'FLUIDOS ARCA'), F(4, '2026-03-25', 4321.10, 'FLUIDOS ARCA'),   // compra mensual repetida
  F(5, '2026-01-13', 2222.5, 'FLUIDOS ARCA'), F(6, '2026-01-13', 2222.5, 'FLUIDOS ARCA'),   // gemelas
  F(7, '2026-03-04', 3333.33, 'ELECTRICO SOL'),
  F(8, '2026-03-31', 5555.50, 'ELECTRICO SOL'),
  F(9, '2026-01-30', 12345, 'JOSE GOMEZ RUIZ'),
  F(10, '2026-05-28', 777.77, 'ELECTRICO SOL'), F(11, '2026-05-28', 777.77, 'ELECTRICO SOL'),
  F(12, '2026-02-10', 2500, 'PROVEEDOR UNO', { valida: false }),    // cancelada
  F(13, '2026-04-01', 300, 'MADERAS ROBLE'),
];
const filas = [
  R(1, '2026-01-05', 1000, 'PROVEEDOR UNO SA'),                 // exacta
  R(2, '2026-03-17', 4321.10, 'ARCA FLUIDOS'),                  // exacta entre repetidas mensuales
  R(3, '2026-03-20', 4321.10, 'ARCA FLUIDOS'),                  // cercana pero hay otras en ±60 → ambigua
  R(4, '2026-01-13', 2222.5, 'FLUIDOS ARCA'), R(5, '2026-01-13', 2222.5, 'FLUIDOS ARCA'),   // gemelas → se ligan 1 a 1
  R(6, '2026-03-03', 3333.33, 'ELECTRICO SOL'),                 // cercana única → se liga
  R(7, '2026-03-31', 5555.51, 'ELECTRICO SOL'),                // 1 centavo de diferencia → se liga
  R(8, '2026-01-30', 12345, 'DECORACIONES LUNA'),               // proveedor distinto
  R(9, '2026-05-28', 777.77, 'ELECTRICO SOL'),                 // 1 renglón, 2 facturas iguales → ambigua
  R(10, '2026-02-10', 2500, 'PROVEEDOR UNO'),                   // la única es cancelada → no encontrada
  R(11, '2026-04-01', 300, 'MADERAS ROBLE', { conflicto: [{ hoja: 'X', renglon: 3, reparto: 'DIRECTO', aplicacion: '101' }] }),
  R(12, '', 300, 'MADERAS ROBLE', { fechaTxt: 'pendiente' }),
];
const emp = emparejarFilas(filas, facts);
const E = n => emp.find(r => r.fila.renglon === n);
ck('exacta', E(1).estado === 'ligada' && E(1).via === 'exacta' && E(1).factura.id === '1');
ck('compra mensual repetida: la de la fecha exacta', E(2).estado === 'ligada' && E(2).factura.id === '3');
ck('fecha cercana con otras iguales en ±60 días → ambigua (no adivina)', E(3).estado === 'ambigua' && !E(3).factura, E(3));
ck('gemelas misma hoja → una factura cada una', E(4).estado === 'ligada' && E(5).estado === 'ligada' && E(4).factura.id === '5' && E(5).factura.id === '6' && E(4).via === 'gemela');
ck('fecha cercana y única → se liga con los días', E(6).estado === 'ligada' && E(6).via === 'cercana' && E(6).factura.id === '7' && E(6).dias === 1, E(6));
ck('1 centavo de redondeo → se liga', E(7).estado === 'ligada' && E(7).factura.id === '8');
ck('proveedor distinto → no se liga (estado proveedor)', E(8).estado === 'proveedor' && !E(8).factura && /#9/.test(E(8).motivo));
ck('1 renglón y 2 facturas iguales → ambigua', E(9).estado === 'ambigua' && E(9).candidatos.length === 2);
ck('factura cancelada no cuenta → no encontrada', E(10).estado === 'no_encontrada');
ck('conflicto entre hojas → no se liga', E(11).estado === 'conflicto' && !E(11).factura);
ck('fecha inválida → sin_dato', E(12).estado === 'sin_dato');
const ids = emp.filter(r => r.factura).map(r => r.factura.id);
ck('nunca dos renglones en la misma factura', new Set(ids).size === ids.length, ids);
// Gemelas con repartos DISTINTOS → ambiguas
const emp2 = emparejarFilas([R(1, '2026-01-13', 2222.5, 'FLUIDOS ARCA'), R(2, '2026-01-13', 2222.5, 'FLUIDOS ARCA', { aplicacion: '103' })], facts);
ck('gemelas con repartos distintos → ambiguas', emp2.every(r => r.estado === 'ambigua'));
// Dos renglones de fecha cercana hacia la misma factura única → ninguno
const emp3 = emparejarFilas([R(1, '2026-03-02', 3333.33, 'ELECTRICO SOL', { hoja: 'H1' }), R(2, '2026-03-08', 3333.33, 'ELECTRICO SOL', { hoja: 'H2' })], facts);
ck('dos renglones cercanos a la misma factura → ninguno se liga', emp3.every(r => r.estado === 'ambigua' && !r.factura), emp3.map(r => r.estado));
// Una exacta ocupa la factura: otro renglón cercano no la vuelve a tomar
const emp4 = emparejarFilas([R(1, '2026-03-04', 3333.33, 'ELECTRICO SOL', { hoja: 'H1' }), R(2, '2026-03-08', 3333.33, 'ELECTRICO SOL', { hoja: 'H2' })], facts);
ck('la exacta gana; el cercano no se liga a la misma', emp4[0].estado === 'ligada' && emp4[1].estado === 'ambigua' && !emp4[1].factura, emp4.map(r => r.estado));

// --- 7. partida ---
const cat = [
  { partida: 'CONSTRUCCION', activa: true, subpartidas: ['CONSTRUCCION', 'Carpinteria', 'Acabados', 'Instalaciones Electricas'] },
  { partida: 'Supervision', activa: true, subpartidas: [] },
  { partida: 'Vieja', activa: false, subpartidas: [] },
];
ck('partidaValida: nombre del catálogo sin importar mayúsculas/acentos', JSON.stringify(partidaValida(cat, 'construcción', 'carpintería')) === JSON.stringify({ partida: 'CONSTRUCCION', sub: 'Carpinteria' }));
ck('partidaValida: sub que no existe → null; inactiva → null; sin subs → sub vacía', partidaValida(cat, 'CONSTRUCCION', 'Herreria') === null && partidaValida(cat, 'Vieja', '') === null && partidaValida(cat, 'Supervision', 'x').sub === '');
let p = elegirPartida({ dePago: [{ partida: 'Supervision', sub: '' }], historial: [{ partida: 'CONSTRUCCION', sub: 'Acabados' }, { partida: 'CONSTRUCCION', sub: 'Acabados' }], concepto: 'MATERIAL CARPINTERIA', catalogo: cat });
ck('1° la del pago ligado', p.partida === 'Supervision' && p.fuente === 'pago ligado', p);
p = elegirPartida({ dePago: [{ partida: 'Supervision', sub: '' }, { partida: 'CONSTRUCCION', sub: 'Acabados' }], historial: [{ partida: 'CONSTRUCCION', sub: 'Acabados' }, { partida: 'CONSTRUCCION', sub: 'Acabados' }, { partida: 'Supervision', sub: '' }], catalogo: cat });
ck('pagos que no coinciden → historial del proveedor si domina (2 de 3)', p.sub === 'Acabados' && /historial/.test(p.fuente), p);
p = elegirPartida({ historial: [{ partida: 'CONSTRUCCION', sub: 'Acabados' }, { partida: 'Supervision', sub: '' }], concepto: ['MATERIAL CARPINTERIA', 'PINTURA'], catalogo: cat });
ck('historial sin mayoría → concepto (el primer texto manda)', p.sub === 'Carpinteria' && p.fuente === 'concepto de la obra', p);
p = elegirPartida({ concepto: ['MATERIAL HERRERIA', 'LAMPARAS LED'], catalogo: cat });
ck('sub del concepto que no está en el catálogo → siguiente texto', p.sub === 'Instalaciones Electricas', p);
p = elegirPartida({ concepto: 'ANTICIPO', catalogo: cat });
ck('sin pista → CONSTRUCCION / CONSTRUCCION por defecto', p.partida === 'CONSTRUCCION' && p.sub === 'CONSTRUCCION' && p.fuente === 'por defecto', p);
p = elegirPartida({ concepto: 'ANTICIPO', catalogo: [{ partida: 'Otra', subpartidas: [] }] });
ck('sin CONSTRUCCION en el catálogo → error (no se aplica)', !!p.error);

console.log(`\n${ok} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);

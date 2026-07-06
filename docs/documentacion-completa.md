> **Documento maestro** - Generado el 6 de julio de 2026. Explica TODO el sistema y su importancia. Fuente: codigo real de la aplicacion.

# Dehur Territorial — Core de Pagos

## Introducción general

### ¿Qué es esta aplicación?

**Dehur Territorial — Core de Pagos** es el sistema central con el que la constructora administra todo el dinero que sale de la empresa: desde que alguien solicita un pago hasta que el banco lo confirma y queda registrado para siempre. En una sola herramienta convive el ciclo completo de un pago (solicitud, dispersión bancaria en BBVA, confirmación y archivo histórico), la gestión de facturas fiscales CFDI (con su UUID, RFC, IVA y retenciones) y el cálculo del costo real de cada casa o unidad de un proyecto.

No es un simple registro de gastos. Es el punto donde se cruzan tres mundos que normalmente viven separados: la **tesorería** (¿cuánto dinero hay y a quién le pago hoy?), lo **fiscal** (¿qué factura respalda este pago y cuál es su saldo?) y el **control de obra** (¿cuánto llevo gastado por casa contra lo presupuestado?). Cada peso que se paga puede repartirse entre las casas que lo consumieron, de modo que la empresa siempre sabe el costo real por unidad, no solo el gasto total.

El resultado es una fuente única de verdad: un historial de pagos inmutable y auditado, saldos de tesorería en tiempo real, y un panel de costos por unidad que compara presupuesto contra realidad. Todo lo que se captura una vez alimenta automáticamente las demás vistas.

### ¿Para qué sirve? ¿Qué problemas resuelve?

- **Evita el doble pago.** El sistema detecta duplicados en varios momentos (al importar el Excel, en la cola de pagos y en la confirmación bancaria) y bloquea o avisa antes de que se pague dos veces una misma obligación. Las facturas se protegen además por UUID único.
- **Une el pago con su respaldo fiscal.** Cada pago puede ligarse a una o varias facturas CFDI, y el saldo pendiente de cada factura se calcula solo: nunca queda descuadrado entre lo que se debe y lo que se pagó.
- **Da el costo real por casa, no solo el total.** Mediante el reparto de cada pago o factura entre unidades (directo, equitativo, por indiviso o personalizado), el dueño ve cuánto lleva cada casa contra su presupuesto, con alertas de desviación y un plano visual coloreado por avance.
- **Refleja la realidad del banco.** La fecha del pago se ajusta a la fecha en que el banco realmente procesó la dispersión, no a la de captura, para que la contabilidad cuadre con los estados de cuenta.
- **Conserva la memoria de la empresa.** El historial es inmutable y trazable: cada pago se puede seguir hasta su solicitud original, su factura y su movimiento bancario. Nada se borra.
- **Responde la pregunta diaria de tesorería.** Los saldos de cuentas y proyectos se ven en tiempo real en el encabezado: ¿hay dinero para pagar hoy y desde qué cuenta?

### ¿Cómo está hecha, a alto nivel?

La aplicación es una **SPA (aplicación de una sola página) en JavaScript vanilla**, sin framework pesado, que se publica en **GitHub Pages** (el frontend) y se apoya en **Supabase (Postgres)** como base de datos y fuente de verdad. Google Sheets se mantiene como respaldo en escritura dual, de modo que los datos existen en dos lugares.

Es una herramienta **multi-usuario en tiempo real**: los cambios se sincronizan entre las personas conectadas mediante WebSocket (Realtime), sin necesidad de recargar. El acceso está controlado por **8 roles** con permisos granulares (admin, capturista, facturas, contabilidad, aprobador, obra, lector y solo lectura), y el aislamiento de datos por empresa se garantiza a nivel de base de datos con **RLS (Row Level Security)** y llaves compuestas por inquilino.

El diseño prioriza no perder datos: guardado fila por fila con identificadores estables para evitar colisiones cuando varias personas editan a la vez, confirmaciones y banners de carga, y la posibilidad de revertir comportamientos clave (fuente de lectura, modo de guardado, tiempo real) cambiando una sola línea. El despliegue es sencillo: el frontend se actualiza en GitHub Pages y los cambios de base de datos se aplican de forma manual y controlada en Supabase.

### Mapa del documento

Este documento maestro se organiza en cinco grandes áreas. Cada una se detalla en su propia sección; aquí solo se indica qué cubre cada una:

| Área | Qué cubre |
|------|-----------|
| **A. Ciclo de Pago** | El flujo completo de un pago: solicitudes, cola, dispersión bancaria, confirmación e historial inmutable. Detección de duplicados, matching de proveedores y reparto de costos. |
| **B. Facturas y Pagos a Facturas** | El subsistema fiscal: facturas CFDI, saldos derivados, pagos multi-factura, devengado, notas de crédito y conciliación. |
| **C. Costos por Unidad, Presupuestos y Resumen Ejecutivo** | El costo real por casa (inicial + devengado + pagado sin factura), métodos de reparto, control de presupuesto contra realidad, plano visual y reportes por período. |
| **D. Catálogos y Finanzas Auxiliares** | Los maestros y movimientos de apoyo: proveedores, empleados, cuentas propias y proyectos, traspasos, préstamos, aportaciones, créditos, pagarés y partidas. |
| **E. Arquitectura Técnica y Operación** | Cómo está construido por dentro: modelo de datos, multi-tenant con RLS, respaldo dual, tiempo real, roles, blindajes contra pérdida de datos y despliegue. |

---

# Ciclo de Pago (A): Solicitudes → Dispersión → Confirmar → Historial

## ¿Qué es este subsistema?

El **Ciclo de Pago** es el corazón operativo de Dehur Territorial. Gestiona el flujo completo de dinero: desde que la obra/proyecto solicita un pago (generalmente a proveedores), pasando por la generación del archivo para el banco, la confirmación que el banco realmente procesó, y el registro final que sustenta reportes, auditoría y cálculos de costos por unidad.

Sin este ciclo, la empresa no podría:
- **Controlar quién recibe qué, cuándo y por qué** (auditoría + conciliación).
- **Automatizar repartos de costo** entre unidades/casas (cada pago se distribuye entre las casas bajo construcción).
- **Reconocer ingresos fiscal e internamente** (el costo entra al Historial con la fecha REAL del pago, no la de hoy).
- **Evitar pagos duplicados** (la app detecta automáticamente si el mismo pago entra dos veces).

---

## Flujo End-to-End

### 1. **SOLICITUDES** — Captura de Pagos (src/modules/solicitudes.js)

**¿Qué es?**  
Una **pantalla donde se importa un Excel semanal** con los pagos que la obra o proyecto quiere hacer. El Excel viene del generador de órdenes de pago (externo) con columnas: Proveedor, Partida (de Obra), Importe, Concepto, Reparto (directo/equitativo/indiviso/custom).

**¿Cómo funciona?**

1. **Validación de plantilla:**  
   - Solo acepta la "Plantilla Estándar Dehur" (validación: fila 1 contiene "DEHUR", fila 4 tiene encabezados como "Proveedor").
   - Si es otra plantilla → rechaza con error.

2. **Lectura del Excel** (usando SheetJS, librería gratuita incluida):
   - Extrae cada fila de datos (salta totales, filas vacias).
   - **Auto-detecta el proyecto** del nombre de la hoja o columna "Obra".
   - Resuelve la **partida de Obra** (ej. "Albañilería") contra el catálogo y mapea a la **partida Admin** (ej. "CONSTRUCCION") + sub-partida.

3. **Búsqueda/Matching de Proveedor** (fuzzy matching inteligente):
   - Si la fila trae un `proveedor_id` numérico: busca directo en BD, 100% exactitud.
   - Si no: busca por nombre (fuzzy) contra todos los proveedores registrados:
     - Exacta por nombre → auto-vincula (verde, confiable).
     - Parcial (cuenta embebida en el concepto) → marcada con ⚠, requiere aprobación.
     - Sin match → roja, **requiere que el usuario vincule manualmente** (puede ser proveedor nuevo).
   - Guarda el **alias** de cómo se escribió el nombre para futuras búsquedas.

4. **Detección de Duplicados** (red de seguridad anti doble-pago):
   - Calcula una "clave de duplicado" = normalizar(proveedor) + importe + normalizar(concepto).
   - Si dentro del **mismo Excel** dos filas coinciden → marca ambas como posible duplicado ⛔.
   - No las bloquea, pero avisa visualmente y requiere confirmación antes de enviar a pago.

5. **Validación de Factura** (si aplica):
   - Si la fila trae `factura_id`: valida que la factura exista, no esté cancelada, pertenezca al mismo proveedor.
   - Si hay error → la fila se marca en rojo, avisa motivo, pero **se puede seguir adelante** (el pago se registra sin ligar a factura).

6. **Cálculo de Asignaciones Planificadas** (reparto de costo):
   - Columna `Reparto`: elige método:
     - `directo` → 100% a una unidad/casa.
     - `equitativo` → dividir 100% entre N casas (ej. 50% A-1, 50% A-2).
     - `indiviso` → dividir por proporción de **indiviso_pct** de cada casa activa (ej. amenidades).
     - `custom` → tokens `código:% / código:%` (ej. "A-1:60% / indiviso:40%").
     - vacío → no-decision, se aplica auto-indiviso después al confirmar.
   - Valida suma = 100%, resuelve códigos contra el catálogo de unidades del proyecto.
   - Si hay error → bloquea la carga (no permite enviar a pago con reparto inválido).

7. **Tabla de Solicitudes Renderizada:**
   - Muestra cada pago con:
     - ✓ estado (vinculado, sin match, duplicado, etc.).
     - Partida Obra → Partida Admin (con tooltip mostrando mapeo).
     - Proveedor resuelto + banco + tipo cuenta.
     - Importe.
   - Usuario puede:
     - Marcar/desmarcar individual (checkbox).
     - Vincular proveedores sin match (modal de búsqueda + opción agregar nuevo).
     - Cambiar partida si fuera necesario antes de enviar.
     - Ver advertencias sobre duplicados, factura inválida, etc.

**¿Por qué importa?**
- **Evita errores de entrada**: validación de datos ANTES de que dinero salga del banco.
- **Automatiza matching**: sin esto, cada pago requeriría búsqueda manual en la BD.
- **Bloquea duplicados**: si la obra cargó accidentalmente dos veces un pago, la app lo detecta.
- **Prepara costo fiscal**: calcula desde ya cuánto costo irá a cada casa (columna Reparto).

---

### 2. **DISPERSIÓN BBVA** — Cola y Generación del Archivo (src/modules/dispersion.js)

**¿Qué es?**  
Una **cola de pagos en memoria** que el usuario construye (arrastrando solicitudes o pagos individuales), y desde la que se genera el **archivo XLSX para BBVA SIM** (Sistema de Importación Masiva).

**¿Cómo funciona?**

1. **Agregar Pagos a la Cola:**
   - **Desde Solicitudes**: usuario selecciona pagos del Excel importado → botón "Enviar a Cola de Pagos".
   - **Manual** (en Dispersión): click "+ Agregar Pago" abre modal de búsqueda de proveedor/empleado, ingresa importe, concepto, selecciona partida/sub-partida, elige cuenta origen (proyecto BBVA u otra cuenta).
   - **Nómina masiva**: botón "+ Nómina completa" abre diálogo para agregar empleados en lote.
   - Cada item en cola es un objeto con: { proveedor, importe, concepto, proyecto, partida, sub_partida, asignacionesPlanificadas, repartoMetodo, ... }.

2. **Visualización de la Cola:**
   - Lista renderizada: cada pago muestra nombre, banco, cuenta, concepto, importe.
   - Total a dispersar (suma de todos).
   - Botones: quitar individual o "Limpiar todo".

3. **Generación del Archivo BBVA:**
   - **Selecciona cuenta origen** (de qué proyecto/cuenta sale el dinero).
   - **Selecciona "Fecha aplicación"** (cuándo BBVA aplicará el pago; por defecto hoy).
   - **Configura límite de caracteres del concepto** (default 40, rango 20-200, algunos bancos aceptan más).
   - **Red de seguridad**: detecta pagos duplicados EN LA COLA (mismo proveedor + importe + concepto) y pide confirmación.
   - **Genera XLSX**:
     - Columnas: TIPO OP., CUENTA CARGO, CTA. ABONO, IMPORTE, DETALLE PAGO (concepto truncado), REFERENCIA, MONEDA, TITULAR, etc.
     - Cada fila = un pago; el concepto se trunca a N caracteres (si "Factura ABC 123 Importación de tablarroca" entra como límite 40 → "Factura ABC 123 Importación de t").
     - Descarga como `Dispersion_BBVA_YYYYMMDD.xlsx`.

4. **Transición a Pendientes de Confirmación:**
   - Tras generar el archivo, la cola se **mueve internamente a `state.pendientesConfirmacion`** (array de items que esperan que el banco responda).
   - Cada item registra:
     - Datos del pago (nombre, importe, proyecto, partida, etc.).
     - `fechaGen` = la fecha que elegiste en paso 2.
     - `asignacionesPlanificadas` = reparto planificado (para crear costos después).
     - `repartoMetodo` = cómo se reparte (directo, equitativo, indiviso, custom).
   - La cola UI se vacía (se muestra "Sin pagos en cola").

5. **Actualización de Saldos (opcional):**
   - Si activas "Mostrar saldo", la app consulta la cuenta origen y muestra saldo disponible (feature avanzada, requiere integración bancaria).

**¿Por qué importa?**
- **Automatiza generación del archivo**: sin esto, cada semana habría que armar el Excel manualmente (error-prone).
- **Límite de caracteres**: algunos bancos rechazan conceptos muy largos; la app trunca automáticamente.
- **Puente entre solicitud y realidad**: la cola es la última oportunidad para revisar que TODO sea correcto ANTES de enviar al banco.
- **Cierre limpio**: al generar archivo, la cola pasa a "pendientes", preparándose para el paso 3.

---

### 3. **CONFIRMAR PAGOS** — Validación Bancaria (src/modules/confirmar-pagos.js)

**¿Qué es?**  
Una **pantalla de reconciliación** donde el usuario marca QUÉ PAGOS el banco sí procesó (comparando contra el extracto o confirmación bancaria), y desde la que se **registran en el Historial maestro**.

**¿Cómo funciona?**

1. **Visualización de Pendientes:**
   - Muestra todos los items de `state.pendientesConfirmacion` en una tabla.
   - Cada fila: beneficiario, concepto, importe, proyecto, checkbox (default checked = se asume que pasó).
   - Resumen: TOTAL GENERADO | CONFIRMADOS | NO CONFIRMADOS.

2. **Edición de Fecha del Pago:**
   - Campo de fecha editable (DD/MM/YYYY o input `type=date`).
   - **Importante**: esta es la fecha REAL del pago que quedará en el Historial y reportes.
   - Por defecto: fecha que se eligió al generar el archivo (paso 2 de Dispersión).
   - Caso de uso: si generaste archivo el jueves pero el banco procesó los pagos el lunes → cambias fecha a lunes.

3. **Selección:**
   - Checkbox individual: marcar/desmarcar cada pago.
   - Checkbox "Seleccionar todos": marca/desmarca todos visibles.
   - Botones rápidos: ✓ Todos, ✗ Ninguno.

4. **Confirmación (registrar en Historial):**
   - Click "Registrar confirmados en Historial".
   - Para cada pago MARCADO:
     - Se **inserta en `state.historial`** con:
       - Fecha = la del campo editable.
       - Nombre beneficiario, importe, concepto.
       - Proyecto (resuelto: si la cuenta origen es un proyecto específico, ese; si es concentradora o cuenta propia → campo blanco).
       - Banco, tipo, proveedor_id, factura_id, partida, sub_partida.
       - `tipo_registro` = "Pago".
       - `cuenta_origen` = de dónde salió el dinero.
     - Se asigna un **ID estable** (`pago_id`) para vincular asignaciones de costo después.

5. **Auto-Enlace a Factura (si aplica):**
   - Si el pago trae `factura_id`: valida que factura exista y sea del mismo proveedor.
   - Si válida: crea un **registro en `facturaPagos`** (tabla de "pagos a facturas").
   - **IMPORTANTE**: si la factura tiene su propio reparto de costo (devengado), el pago NO recibe un reparto aparte → evita contar dos veces el costo.
   - Actualiza estado de la factura:
     - Si saldo_pendiente ≤ 0 → `estatus_factura` = "pagada".
     - Si monto_pagado > 0 → `estatus_factura` = "parcial".

6. **Auto-Indiviso / Reparto Planificado:**
   - Si el pago NO tiene factura (`factura_id` vacío):
     - Si trae `asignacionesPlanificadas` desde la solicitud → crea costos con esos datos (casa A:60%, casa B:40%, etc.).
     - Si NO tiene asignaciones planificadas (ej., pago manual en Dispersión) → aplica **auto-indiviso**: reparte por `indiviso_pct` entre todas las casas activas a esa fecha.
   - Crea registros en `costoAsignaciones` con:
     - `pago_id`, `unidad_id`, `proyecto`, `monto_asignado`, `factor` (%), `metodo` (indiviso/equitativo/custom/directo).

7. **Reversión de Saldos de Cuentas:**
   - Si la cuenta origen es un proyecto: resta el importe del saldo (p.ej., proyecto A tenía $500k, ahora tiene $400k).
   - Si la cuenta origen es una cuenta propia/extra: idem.
   - **Condición**: solo si la fecha del pago es ≥ a la última actualización del saldo registrada (evita crear saldos históricos contradictorios).

8. **Persistencia:**
   - Guarda todo en Google Sheets (y en Supabase si está configurado).
   - Los pendientes se vacían.

**¿Por qué importa?**
- **Reconciliación real**: confirmas contra el extracto del banco (el ÚNICO registro confiable de si dinero salió).
- **Fecha correcta**: el Historial refleja cuándo el dinero REALMENTE cambió de mano (para auditoría, impuestos, reportes).
- **Automatización de costos**: sin este paso, no hay asignación de costos a unidades; la obra no sabe qué cuesta cada casa.
- **Control de errores**: si el banco rechazó 3 pagos, desmarcas esos 3 y se registran solo los válidos.

---

### 4. **HISTORIAL DE PAGOS** — Registro Maestro (src/modules/historial.js)

**¿Qué es?**  
El **registro maestro, irrevocable, de TODOS los pagos** que la empresa ha hecho. Es el single source of truth para reportes, auditoría, y cálculos de costo por unidad.

**¿Cómo funciona?**

1. **Estructura de un Registro (fila del historial):**
   - `id` (estable, único).
   - `fecha` (DD/MM/YYYY, la REAL del pago).
   - `nombre` (beneficiario).
   - `concepto` (qué se pagó).
   - `importe` (cantidad en pesos).
   - `proyecto` (de dónde salió el dinero, o blanco si concentradora).
   - `banco`, `tipo` (cuenta, CLABE, etc.).
   - `proveedor_id`, `factura_id` (referencias a otras tablas).
   - `cuenta_origen` (nombre de proyecto/cuenta propia).
   - `tipo_registro` ("Pago", "Crédito", "Préstamo", "Aportación", "Traspaso").
   - `partida`, `sub_partida` (clasificación contable/fiscal).

2. **Visualización / Tabla:**
   - Columnas: ID Prov, ID Fact, Fecha, Origen, Beneficiario, Tipo, Categoría, Sub-cat, Partida, Sub-partida, Concepto, Importe, Proyecto.
   - Orden: más reciente arriba (ordenado por fecha DESC, desempate por id DESC).
   - Búsqueda: por ID proveedor o nombre.
   - Filtros: tipo pago, proyecto, partida, sub-partida, rango fechas.
   - Total en pantalla.

3. **Edición de Partida / Sub-partida:**
   - Botón ✏️ en cada fila (single edit) o "Cambiar partida (N)" para bloque.
   - Modal:
     - Single: edita partida, sub-partida, fecha, proyecto del pago.
     - Bulk (admin only): edita partida/sub a múltiples seleccionados.
   - Al cambiar partida:
     - Se recalculan asignaciones de costo (purga viejas, crea nuevas si no hay factura).
     - Si cambia proyecto: se "recoloca" el reparto entre casas del nuevo proyecto.

4. **Eliminación:**
   - Click ✕ o bulk delete (admin only).
   - Confirmación + suma del monto a borrar.
   - Al eliminar:
     - Revierte el saldo de la cuenta origen (si la fecha es actual).
     - Purga asignaciones de costo ligadas.
     - Purga `facturaPagos` si estaba ligado a factura (y revierte estado de factura).
     - Purga traspaso correlativo si era un traspaso.

5. **Importación de Excel:**
   - Botón "Importar Excel" (admin).
   - Acepta CSV/XLSX con estructura: ID Prov, ID Fact, Fecha, Origen, Beneficiario, Banco, Tipo Cuenta, Tipo, Categoria, Sub-cat, Partida, Sub-partida, Concepto, Importe, Proyecto.
   - Carga filas nuevas (no borra existentes).

6. **Exportación:**
   - Botón "Exportar CSV".
   - Descarga todos los registros visibles (con filtros aplicados) en CSV.

7. **Integración con Costos Fiscales:**
   - Cada pago del historial (que no esté cubierto por factura devengada) tiene N asignaciones en `costoAsignaciones`.
   - El módulo de "Costos por Unidad" sumariza estos costos: ∑(monto_asignado) por unidad = costo fiscal.
   - Usa `factor` (% del pago) para distribuir entre casas.

8. **Persistencia:**
   - Guardado en Google Sheets + Supabase (row-by-row si está habilitado).
   - Sincronización en tiempo real si otros usuarios editan.

**¿Por qué importa?**
- **Auditoría**: cualquier pago que la empresa hizo está registrado, con fecha real, beneficiario, importe, clasificación.
- **Reportes**: el reporte de costos, el flujo de salida, la posición de saldos, TODO se alimenta del Historial.
- **Cálculo de costo por unidad**: sin el historial, no hay manera de saber cuánto costó construir cada casa.
- **Impuestos**: el contador necesita este registro para declaraciones (ISR, IVA, etc.).

---

## Arquitectura y Datos

### Flujo de Datos

```
Excel de Solicitud (entrada)
        ↓
   [SOLICITUDES]
   - Valida plantilla
   - Matchea proveedores
   - Detecta duplicados
   - Calcula reparto (asignaciones planificadas)
        ↓
 [usuario: selecciona pagos]
        ↓
   [DISPERSIÓN]
   - Agrupa en cola
   - Detecta duplicados OTRA VEZ
   - Genera archivo BBVA
   - Mueve a pendientes
        ↓
 [usuario: descarga archivo → envía a banco]
 [banco: procesa algunos/todos]
 [usuario: descarga extracto del banco]
        ↓
   [CONFIRMAR PAGOS]
   - Marca qué pagos el banco sí procesó
   - Edita fecha real
   - Auto-enlaza factura
   - Auto-reparte costo (asignaciones)
   - Revierte saldos
        ↓
   [HISTORIAL]
   - Registro permanente
   - Permite editar partida/fecha/proyecto
   - Purga de duplicados al eliminar
        ↓
   [REPORTES]
   - Resumen de Costos (sum por unidad)
   - Flujo de Salida (sum por cuenta)
   - Posición de Saldos (state de cada proyecto)
```

### Tablas Principales (en state.js)

- **`state.solicitudesData`**: items del Excel importado (temporal, se vacía al enviar a cola).
- **`state.cola`**: items en preparación para BBVA (temporal, se vacía al generar archivo).
- **`state.pendientesConfirmacion`**: items generados por BBVA, esperando confirmación del banco (temporal, se vacía al registrar en historial).
- **`state.historial`**: pagos definitivos (persistente en BD).
- **`state.costoAsignaciones`**: cada pago distribuido entre casas (persistente en BD).
- **`state.facturaPagos`**: enlace pago ↔ factura (persistente en BD).
- **`state.facturas`**: facturas por pagar (persistente en BD).

---

## Flujos Especiales

### 1. Pago Directo (sin solicitud)
- En Dispersión, usuario selecciona proveedor/empleado directamente.
- Elige cuenta origen (proyecto u otro).
  - Si **proyecto BBVA**: se agrega a cola.
  - Si **cuenta propia/extra**: se registra INMEDIATAMENTE en historial (bypassa dispersión, porque no sale del banco).

### 2. Nómina en Lote
- Botón "+ Nómina completa".
- Selecciona empleados, ingresa monto individual.
- Se agrega a la cola (proyecto BBVA) o se registra directo (cuenta extra).

### 3. Cambio de Proyecto (en Historial)
- Usuario edita proyecto de un pago.
- Las **asignaciones de costo se purgan** (apuntaban a casas del proyecto anterior).
- Se **recrean por indiviso** con las casas activas del NUEVO proyecto.
- Es la forma de "reubicar" costos entre proyectos.

### 4. Pago con Factura
- Si el pago trae `factura_id`:
  - Se valida que factura exista.
  - Se crea registro `facturaPago` (auditoria).
  - **NO se crea reparto propio del pago** (el costo viene del reparto de la factura, "devengado").
  - Se actualiza estado de factura (parcial/pagada).

### 5. Auto-Indiviso (Pagos sin Asignación Explícita)
- Si un pago NO tiene asignaciones planificadas Y NO está cubierto por factura:
  - Se reparte automáticamente por `indiviso_pct` de cada casa.
  - Caso: empresa paga servicios compartidos (agua, luz) → auto-distribuye entre casas activas.

---

## Controles de Seguridad y Auditoría

### 1. Detección de Duplicados (3 niveles)
- **En solicitud**: marca filas dentro del mismo Excel.
- **En dispersión**: detecta duplicados TAMBIÉN en la cola (puede venir de múltiples solicitudes).
- **En confirmar**: si envías archivo y luego tú mismo cargas un Excel con el mismo pago → lo pilla AQUÍ.
- En todos los niveles: NO bloquea, pero requiere confirmación explícita.

### 2. Validación de Factura
- Si `factura_id` viene en la solicitud:
  - Verifica que factura exista en BD.
  - Verifica que NO esté cancelada.
  - Verifica que NO esté 100% pagada.
  - Verifica que pertenezca al MISMO proveedor.
  - Si hay error: marca en rojo, avisa, pero permite continuar (pago se registra sin ligar).

### 3. Matching de Proveedor
- Si el proveedor del Excel NO está en la BD:
  - Flag rojo: "⚠ Sin match".
  - Usuario puede:
    - Vincular manualmente (buscar en BD).
    - Agregar nuevo proveedor (no recomendado en flujo urgente).
  - Si no se vincula: bloquea el envío a cola.

### 4. Validación de Reparto
- Si `Reparto` trae errores (suma ≠ 100%, unidad inexistente, etc.):
  - **Bloquea la carga entera del Excel** (no se importa nada).
  - Error explícito en la UI.
  - Usuario debe corregir el Excel y re-cargar.

### 5. Reversión de Saldos
- Al eliminar un pago: restaura el saldo de la cuenta origen (si la fecha lo permite).
- Al cambiar proyecto: recoloca asignaciones (no duplica costo).
- Al cambiar partida: recalcula si el costo entra en reportes o no (ej., obra vs. administración).

---

## Importancia para el Negocio

### Operativa
- **Control del flujo de dinero**: la empresa sabe exactamente cuánto sale, cuándo, a quién, por qué.
- **Automatización**: sin este sistema, cada pago requeriría:
  - Búsqueda manual de proveedor en la BD.
  - Generación manual del archivo BBVA (error-prone).
  - Conciliación manual con el banco.
  - Entrada manual en contabilidad.
- **Velocidad**: proceso que toma ~1 hora manual se reduce a ~10 minutos.

### Contable y Fiscal
- **Costo de construcción por unidad**: el contador necesita estos datos para calcular utilidad, impuestos, etc.
  - ¿A cuánto salió construir cada casa? → se suma desde `costoAsignaciones`.
- **Documentación**: cada pago está ligado a factura (si aplica) y tiene una fecha REAL.
- **Auditoría**: si la SAT (Fisco mexicano) pide justificantes, están todos en el Historial.

### Gerencial / Estratégico
- **Posición de saldos**: el CFO ve en tiempo real cuánto dinero queda por proyecto.
- **Flujo de salida**: análisis de egreso por cuenta/proyecto (¿cuánto salió del proyecto A en julio?).
- **Análisis de proveedores**: ¿cuál es el top 5 de proveedores por monto? (reportes, negociación).

### Riesgos Mitigados
- **Doble pago**: la app detecta si el mismo pago entra dos veces (duplicado).
- **Pago a proveedor equivocado**: el matching + validación manual aseguran que el dinero vaya al correcto.
- **Falta de documentación**: cada pago está fechado, clasificado, ligado a factura; es trazable.
- **Errores de costo fiscal**: asignaciones automáticas evitan contar 2x o 3x un gasto.

---

## Nota sobre Sincronización y Persistencia

- **Google Sheets**: tabla principal de respaldo (usa `google-sync.js` para push/pull).
- **Supabase (Postgres)**: tabla "historial" con replicación en tiempo real (si está habilitado).
- **Local Storage**: solo UI state (tema, filtros, algunas preferencias).
- Si 2 usuarios editan al mismo tiempo: resolución por última escritura gana (simple, pero requiere disciplina).

---

## Interfaz: Botones y Flujos Rápidos

| Acción | Dónde | Botón | Resultado |
|--------|-------|-------|-----------|
| Cargar Excel de solicitudes | Solicitudes | 📥 Importar Excel | Valida, parsea, renderiza tabla |
| Enviar solicitudes a cola | Solicitudes | 📤 Enviar a Cola | Agrega a `state.cola`, navega a Dispersión |
| Generar archivo BBVA | Dispersión | ⬇ Generar Archivo BBVA | Crea XLSX, mueve a pendientes |
| Registrar confirmados | Confirmar Pagos | ✅ Registrar confirmados en Historial | Inserta en historial, crea asignaciones |
| Editar pago | Historial | ✏️ (en cada fila) | Abre modal partida/fecha/proyecto |
| Eliminar pago | Historial | ✕ (en cada fila) | Confirma, elimina, revierte saldo |
| Exportar historial | Historial | ⬇ Exportar CSV | Descarga CSV de filtrados |

### Conceptos clave de esta seccion
- Flujo: Solicitud → Cola → Dispersión BBVA → Confirmación Bancaria → Historial = registro maestro (inmutable, auditado).
- Excel importado trae reparto (directo, equitativo, indiviso, custom) que se traduce a asignaciones de costo entre casas.
- Triple detección de duplicados: en Excel, en cola, en confirmación (red de seguridad anti doble-pago).
- Matching fuzzy de proveedor: auto-vinculación si es exacta, manual si es parcial o inexistente.
- Fecha del pago es EDITABLE en confirmación: refleja la fecha REAL que el banco procesó (no la de hoy).
- Auto-indiviso: pagos sin reparto explícito se distribuyen automáticamente por indiviso_pct entre casas activas.
- Validación de factura: si pago liga a factura, el costo viene del reparto de factura (devengado), no del pago.
- Reversión de saldos: eliminar pago revierte dinero; cambiar proyecto recoloca costos (evita duplicar).
- Partida + Sub-partida: clasificación contable; mapeo automático de Obra → Admin para exactitud fiscal.
- Auditoría completa: cada pago en historial es trazable a solicitud original, factura (si aplica), y banco.

---

# FACTURAS Y PAGOS A FACTURAS — Subsistema B

# Facturas y Pagos a Facturas

## Resumen Ejecutivo

El subsistema de **Facturas y Pagos a Facturas** es el corazón del control fiscal y de liquidación de pasivos de DEHUR. Registra todas las obligaciones de pago (facturas CFDI) de proveedores y empleados, vincula a ellas los pagos realizados, y permite controlar que no se sobrepague ni se doble-contabilice. También reparte el costo de cada factura a las unidades/casas del proyecto para calcular el **costo de construcción por casa** (devengado).

### Por qué importa para el negocio

1. **Cumplimiento Fiscal**: Las facturas capturan el UUID (folio fiscal único en el SAT), RFC del emisor, retenciones (IVA e ISR) y estado SAT (vigente/cancelada). DEHUR debe conciliar que cada factura esté vigente en el SAT y que no haya doble pago en auditoría.

2. **Control de Pasivos y Caja**: Es el listado único de quién adeuda DEHUR y cuánto. Sin este control, habría pagos duplicados o proveedores no pagados. El sistema evita sobrepagar una factura topando el monto aplicado al saldo real.

3. **Costo de Obra por Casa**: Al repartir la factura entre casas (devengado), se acumula el costo real de construcción por unidad. Esto permite saber cuánto costó realmente cada casa y detectar desviaciones de presupuesto.

4. **Conciliación Proveedor**: La vista de "Pagos a Facturas" deja evidente qué monto se aplicó a cuál factura, en qué fecha, faciendo fácil responder "¿cuánto debe el proveedor DEHUR?" o "¿cuánto de ese pago fue a la factura X?".

5. **Notas de Crédito**: Maneja rebajas/descuentos que el proveedor emite (NC), restándolos del total a pagar, sin duplicar la gestión de un "pago negativo".

---

## Datos Principales

### Tabla `facturas`

Almacena cada factura CFDI recibida. Columnas clave:

| Campo | Tipo | Propósito |
|-------|------|----------|
| **factura_id** | TEXT (PK) | ID único autogenerado por la app (1, 2, 3...) |
| **numero_factura** | TEXT | Folio de la factura en el comprobante del proveedor (ej: "A-001") |
| **uuid** | TEXT | Folio fiscal del SAT (36 caracteres, único). **Evita duplicados**. |
| **proveedor_id** | TEXT | Referencia al catálogo de proveedores |
| **nombre_proveedor** | TEXT | Nombre del proveedor (copia para rapidez) |
| **razon_social** | TEXT | Razón social del emisor (del XML del CFDI) |
| **rfc_emisor** | TEXT | RFC del que emite la factura (de la empresa, no de DEHUR) |
| **fecha_factura** | TEXT | Fecha en que se emitió la factura |
| **fecha_vencimiento** | TEXT | Plazo de pago acordado con el proveedor |
| **subtotal** | NUMERIC | Base imposible (antes de descuento) |
| **descuento** | NUMERIC | Rebaja sobre el subtotal |
| **iva_trasladado** | NUMERIC | IVA 16% a cargo de DEHUR |
| **retencion_iva** | NUMERIC | Retención de IVA (anticipo/ISR del emisor) |
| **retencion_isr** | NUMERIC | Retención de ISR (si es empleado/contratista) |
| **nc_subtotal** | NUMERIC | Monto de nota(s) de crédito (acumuladas, resta del total) |
| **nc_iva** | NUMERIC | IVA de la(s) nota(s) de crédito |
| **monto_total** | NUMERIC | **Total neto a pagar** = subtotal − descuento + IVA − retenciones − (NC monto + NC IVA) |
| **monto_pagado** | NUMERIC | Suma de todos los montos aplicados desde `factura_pagos` |
| **saldo_pendiente** | NUMERIC | monto_total − monto_pagado (clampeado a ≥ 0) |
| **estatus_factura** | TEXT | "pendiente" / "parcial" / "pagada" / "cancelada" — **DERIVADO de los pagos** |
| **estado_sat** | TEXT | "Vigente" / "Cancelada" (estado fiscal del CFDI, independiente del pago) |
| **tipo_comprobante** | TEXT | "Factura" / "Nota de crédito" / "Complemento de pago" / "Otro" |
| **empresa** | TEXT | A nombre de qué razón social propia (Dehur / Dehur Territorial) |
| **proyecto** | TEXT | Proyecto al que se asigna (requerido para devengado) |
| **observaciones** | TEXT | Notas libres del usuario |
| **activo** | BOOLEAN | Soft delete (la app siempre filtra por `activo=true`) |
| **created_at / updated_at** | TIMESTAMPTZ | Auditoría de cambios |

### Tabla `factura_pagos`

Registro de **cada aplicación de un pago a una factura**. Un pago (del `historial`) puede repartirse entre varias facturas, o una factura puede recibir pagos de varias fuentes. Cada fila es una "ligadura".

| Campo | Tipo | Propósito |
|-------|------|----------|
| **factura_pago_id** | TEXT (PK) | ID único de esta ligadura (ej: UUID truncado) |
| **factura_id** | TEXT (FK) | Referencia a la factura padre |
| **pago_id** | TEXT (FK) | Referencia al pago del `historial` que aplica |
| **proveedor_id** | TEXT | Referencia del proveedor (redundante, para filtros rápidos) |
| **monto_aplicado** | NUMERIC | **Cuánto del pago va a ESTA factura**. ≤ saldo de la factura. |
| **fecha_pago** | TEXT | Fecha en que se ejecutó el pago (copia del historial, para filtros) |
| **estatus** | TEXT | "aplicado" (siempre en Fase 1; avisos/aclaraciones en Fase futura) |
| **observaciones** | TEXT | Concepto del pago (copia del historial) o notas de la ligadura |

**Invariante**: Para cada `factura_id`, la suma de `monto_aplicado` de sus `factura_pagos` debe ser ≤ `factura.monto_total` y ≥ `factura.monto_pagado` (derivado).

### Tabla `historial` (Pagos)

Registro de **todos los pagos y movimientos** de caja (ya procesados). Cada fila es un desembolso, ingreso o movimiento interno:

| Campo | Tipo | Propósito (relevante a facturas) |
|-------|------|----------|
| **id** | TEXT (PK) | ID único del pago |
| **proveedor_id** | TEXT | A quién se pagó (o de quién se recibió) |
| **factura_id** | TEXT | **SI ESTÁ LLENO**: este pago está ligado a esa factura (usa devengado) |
| **fecha** | TEXT | Fecha del pago confirmado (contra extracto bancario) |
| **concepto** | TEXT | Descripción (ej: "Acero, 5 paletadas", "Honorarios mes de junio") |
| **importe** | NUMERIC | Monto del pago |
| **tipo_registro** | TEXT | "Pago" / "Aportación" / "Retorno" (para filtros) |
| **partida** / **sub_partida** | TEXT | Clasificación contable/presupuestaria |
| **proyecto** | TEXT | Proyecto a que se asigna |

**Rol de `factura_id` en historial**: 
- Si está **vacío**: el pago es "libre" (no se asignó a factura). Su costo va por reparto directo en `costo_asignaciones`.
- Si está **lleno**: el pago está ligado a esa factura. Su costo NO se reparte aquí; lo aporta la factura (devengado, Fase A).

### Tabla `costo_asignaciones` (Devengado)

Reparte el costo de una factura (o de un pago libre) a las unidades/casas del proyecto.

| Campo | Tipo | Propósito |
|-------|------|----------|
| **asignacion_id** | TEXT (PK) | ID único |
| **factura_id** | TEXT | SI ESTÁ LLENO: esta asignación pertenece a esa factura (devengado) |
| **pago_id** | TEXT | SI ESTÁ LLENO: pertenece a ese pago (libre) |
| **unidad_id** | TEXT | Casa/apartamento al que se asigna |
| **proyecto** | TEXT | Proyecto (redundante, para filtros) |
| **metodo** | TEXT | "directo" / "equitativo" / "indiviso" / "custom" |
| **monto_asignado** | NUMERIC | Dinero que recibe ESTA unidad |
| **factor** | NUMERIC | Proporción (0.0 a 1.0) de la factura/pago que va aquí |
| **fecha_asignacion** | TEXT | Cuándo se repartió |
| **partida_override** | TEXT | Partida fiscal de esta asignación (puede diferir del pago) |
| **sub_partida_override** | TEXT | Sub-partida (si es construcción) |

**Invariante**: Para cada `factura_id` o `pago_id`, la suma de `monto_asignado` debe ≤ el total de la factura/pago; la suma de `factor` debe ≤ 1.0.

---

## Flujos Principales

### 1. Captura de Factura (Manual o Importación)

#### Ruta Manual: Botón "+ Nueva Factura"

1. Usuario abre modal "Nueva Factura".
2. **Busca proveedor** en dropdown (se autollena RFC/razón social del proveedor).
3. **Captura CFDI**:
   - Número de factura (folio)
   - UUID (folio fiscal, **obligatorio**)
   - Tipo de comprobante (Factura / NC / Complemento de pago)
   - RFC emisor (autollena del proveedor si está vacío)
   - Fechas (factura, vencimiento)
4. **Desglose fiscal**:
   - Subtotal (> 0, obligatorio)
   - Descuento (opcional, default 0)
   - IVA (autocalcula al 16% si no se toca; "touched" flag previene sobrescritura)
   - Retención IVA (opcional)
   - Retención ISR (opcional)
   - **Total = subtotal − descuento + IVA − ret.IVA − ret.ISR** (se calcula en tiempo real)
5. **Nota de Crédito** (opcional):
   - Monto de la NC (baja el total)
   - IVA de la NC (autocalcula al 16% si no se toca)
   - **Total NETO = Total − (NC monto + NC IVA)**
6. **Metadatos**:
   - Proyecto (obligatorio si hay reparto)
   - Empresa facturada (Dehur / Dehur Territorial)
   - Estado SAT (Vigente / Cancelada)
   - Estatus de pago (pendiente / parcial / pagada / cancelada) — ignorado si hay pagos ya ligados
   - Observaciones
7. **Guardar**: 
   - **Anti-duplicados**: verifica UUID (bloquea si existe), folio+proveedor (aviso), monto+fecha+proveedor (aviso).
   - Si es **nueva** y tiene proyecto + estado ≠ Cancelada: abre modal de reparto (devengado) automáticamente.
   - Guarda en `facturas` (Sheets + Supabase por fila).

#### Ruta Importación: "📥 Importar Facturas"

1. Usuario descarga plantilla Excel (auto-rellena con ejemplo real).
2. Llena filas con facturas (una por fila).
3. **Validaciones por fila**:
   - Proveedor ID debe existir en catálogo.
   - UUID obligatorio, formato correcto (8-4-4-4-12), único en BD y en el lote.
   - Proyecto obligatorio y debe existir.
   - Subtotal > 0.
   - Total recalculado = subtotal − desc + IVA − ret.IVA − ret.ISR. Si trae Total en Excel, se verifica pero se usa el recalculado.
   - **Avisos** (no bloquean): folio+proveedor repetido, monto+fecha+proveedor repetido, RFC no coincide con proveedor, vencimiento < fecha factura.
4. **Reparto opcional**: Si la fila trae "Reparto" (directo/equitativo/indiviso/custom) + Unidades, se valida:
   - Las unidades deben existir y ser activas.
   - Partida obligatoria (si hay reparto).
   - Sub-partida requerida si la partida la pide.
   - **Si hay error de reparto, toda la carga se bloquea** (user debe corregir Excel antes de reintentar).
5. **Insertar**:
   - Si reparto válido, genera las `costo_asignaciones` sobre el `monto_total` de la factura.
   - IDs de factura autogenerados (continuidad con lo manual).
   - Guarda todo.

### 2. Vincular Pago a Factura (Fase 1)

**Contexto**: Un pago ya existe en el `historial` (confirmado contra el banco). Ahora se liga a una factura.

#### Ruta: Botón "Vincular pago existente" (solo en edición de factura)

1. Usuario abre la factura en edición.
2. Presiona "+ Vincular pago existente" (aparece solo si la factura existe y no está cancelada).
3. **Búsqueda inteligente** de pagos disponibles:
   - Candidatos: pagos con **saldo > 0** (importe − ya aplicado a otras facturas) y que **no estén ya aplicados A ESTA factura** (multi-factura segura).
   - Filtro manual: concepto, monto, fecha, proveedor.
   - **Ranking automático**: 
     - Mismo proveedor arriba (más probables).
     - Otros con monto similar abajo (otro proveedor, posible error).
   - Muestra para cada pago: fecha, importe, restante, proyecto, badges ("✓ mismo monto", "monto similar", "fecha cercana").
4. **Seleccionar y aplicar**:
   - User ve cuánto saldo tiene la factura y cuánto restante tiene el pago.
   - Captura monto a aplicar (tope = min(saldo factura, restante pago)).
   - Presiona "Vincular".
5. **Validación rápida**:
   - ¿El proveedor del pago ≠ de la factura? Aviso (permite continuar si confirma).
   - ¿Factura ya está "pagada"? Se permite ligar siempre que haya saldo real (monto_total − monto_pagado > 0). El estatus se actualiza automáticamente.
6. **Creación de `factura_pago`**:
   - Genera ID único (factura_pago_id).
   - Datos: factura_id, pago_id, proveedor_id, monto_aplicado, fecha_pago, estatus="aplicado".
   - Incrementa `factura.monto_pagado` y recalcula saldo/estatus.
   - Marca el pago con `factura_id` (primera factura a la que se liga).
7. **Guardado cascada**:
   - Factura: recalcula saldo/estatus (por fila si Supabase).
   - Pago (historial): actualiza `factura_id` (por fila si Supabase).
   - `factura_pago`: nueva fila.
   - UI: actualiza tabla de Pagos a Facturas, refleja estatus nuevo en el modal.

#### Ruta Automática: Al confirmar pagos (confirmar-pagos.js)

1. Usuario importa confirmación del banco (Excel con pagos procesados).
2. Para cada pago confirmado, si el usuario especificó una `factura_id`:
   - **Validación**: factura existe, no está cancelada (fiscal ni de pago), proveedor coincide, no está "pagada".
   - Si válido: crea `factura_pago` y actualiza la factura.
   - Si inválido: limpia `factura_id` y trata el pago como "libre" (reparte su costo por `costo_asignaciones`).

### 3. Repartir Costo de Factura (Devengado, Fase A)

**Propósito**: Distribuir el monto_total de la factura entre las casas del proyecto para calcular costo por unidad.

#### Modal de Reparto

1. Se abre cuando:
   - User presiona botón "⚠ Repartir" o "Parcial X%" en la tabla de facturas.
   - Automáticamente después de crear una factura (si tiene proyecto).
   - User presiona "Rehacerlo" en modal de reparto.

2. **Métodos de reparto**:
   - **Directo**: Especifica 1 sola unidad (ej: "A-1"). Todo el costo va a esa casa.
   - **Equitativo**: Especifica varias unidades (ej: "A-1/A-2/A-3"). Se divide equis partes.
   - **Indiviso**: Nada especificado. Se reparte por `indiviso_pct` de cada unidad (% de área común asignada a cada una).
   - **Custom**: Especifica cada unidad + % (ej: "A-1:60/A-2:40"). Control total.
   - **Custom Mixto**: Usa código especial "INDIVISO" o "AMENIDADES" para mezclar (ej: "101:20/INDIVISO:80" = 20% a casa 101, 80% por indiviso).

3. **Interfaz del repartidor**:
   - Input de método + unidades.
   - Vista previa: tabla con unidad, pct, monto ($).
   - Botones de acción: "Repartir", "Repartir resto" (para custom), "Repartir resto indiviso" (mixto), "Borrar reparto".
   - Muestra restante por repartir en tiempo real.

4. **Generación de `costo_asignaciones`**:
   - Para cada unidad+pct: crea una fila con:
     - `factura_id` = la factura.
     - `unidad_id` = la casa.
     - `monto_asignado` = factura.monto_total * pct%.
     - `factor` = pct / 100.
     - `metodo` = el seleccionado.
     - `partida_override` / `sub_partida_override` = del formulario (si aplica).
   - Borra repartos previos de esa factura antes de insertar nuevos.

5. **Guardado**:
   - Guarda `costo_asignaciones` (tabla completa o por fila).
   - Refleja en pantalla: botón cambia de "⚠ Repartir" a "Reparto ✓" si completo, o "Parcial X%" si incompleto.

---

## Estatus y Saldos

### Reglas de Estatus de Pago (`estatus_factura`)

**Son DERIVADOS de `monto_total` y `monto_pagado`, nunca pueden quedar inconsistentes**:

- **"pendiente"**: monto_pagado ≤ 0. Usuario no ha aplicado pagos aún.
- **"parcial"**: 0 < monto_pagado < monto_total. Hay pagos, pero falta más.
- **"pagada"**: monto_pagado ≥ monto_total (después de redondeo). Factura completamente pagada. Si se recalcula saldo y queda ≤ 0, fecha_pago_total se llena con hoy.
- **"cancelada"**: Solo si la factura NUNCA ha tenido pagos (monto_pagado = 0) y el usuario lo marca manualmente en el menú. Una vez que tiene pagos, el estatus lo dicta el saldo.

**Recálculo automático** (`recalcularSaldoEstatus`):
```
saldo_pendiente = max(0, monto_total - monto_pagado)
if (monto_pagado <= 0) estatus = "pendiente"
else if (saldo <= 0) estatus = "pagada" (y fecha_pago_total = hoy si vacía)
else estatus = "parcial"
```

Se llama en: guardar factura, vincular pago, eliminar pago, editar factura (si ya tenía pagos).

### Vencimiento y Alertas

- **Cálculo**: días desde hoy hasta `fecha_vencimiento`.
- **Badges**:
  - Rojo "Vencida XdX" si días < 0 (pasado).
  - Naranja "Vence XdX" si 0 ≤ días ≤ 7 (urgente).
  - Muted si días > 7 o sin vencimiento.
- **Panel de Estadísticas** (en la pestaña Facturas):
  - Vencidas: count + monto pendiente.
  - Vencen en 7 d: count + monto pendiente.
  - Pendientes (total): count + monto.
  - Al corriente (sin urgencia): count.

### Saldo Restante de Pago

Para evitar sobrepagar una factura y permitir multi-factura:

```
restante_pago = pago.importe - SUM(factura_pago.monto_aplicado WHERE pago_id = pago.id)
```

Al vincular, el usuario ve este restante y elige cuánto aplicar. Tope automático = min(saldo_factura, restante_pago).

---

## Notas de Crédito

### Concepto

Una **nota de crédito (NC)** es un comprobante fiscal que reduce lo que se debe pagar. DEHUR acumula todas las NC de una factura en dos campos:
- `nc_subtotal`: monto de la(s) NC.
- `nc_iva`: IVA de la(s) NC (16% del monto).

### Efecto en el Total

**Total neto = Subtotal − Descuento + IVA − Ret.IVA − Ret.ISR − NC_Subtotal − NC_IVA**

Es decir, la NC **resta directamente del total a pagar**. Así:
- Si factura original = $1000 y NC = $100, el nuevo total = $900.
- El `monto_total` guardado es ya el NETO.
- El `saldo_pendiente` refleja ese neto.
- El reparto de costo (devengado) se hace sobre el neto.

### Captura

En el modal de factura:
- Input "Nota de crédito (monto, baja el total)": captura `nc_subtotal`.
- Input "IVA de la nota de crédito": **autocalcula al 16%** si no se toca (mismo "touched" flag que IVA principal). Si user edita manualmente, lo respeta.

### Información

En la tabla de facturas, si hay NC, se muestra:
```
$900 (neto)
orig. $1000 · NC −$100
```

En detalle (doble click), muestra línea roja "Nota de crédito −$100".

---

## Importancia para Roles y Permisos

### Roles que interactúan

- **Gonzalo (rol 'facturas')**: 
  - Captura facturas manual.
  - Importa Excel de facturas.
  - Edita datos fiscales (UUID, RFC, estado SAT, tipo comprobante).
  - Repartidor de costos (devengado).
  - **NO puede borrar** (solo si rol 'admin' también).

- **Admin**:
  - Todo (CRUD completo).
  - Borra facturas (limpia cascada: factura_pagos, asignaciones de costo, desvincula pagos del historial).

- **Contador / Ericka (rol solo lectura)**:
  - Ve detalle de facturas (doble click).
  - Ve pagos ligados a cada factura.
  - No edita.

- **Tesorería**:
  - Confirma pagos (liga a facturas si corresponde).
  - Vincula pago a factura (durante historial).

---

## Cascadas y Borrado

### Al eliminar una factura

Se ejecuta `eliminarFactura()`:

1. **Desvincula pagos**: Elimina todas las filas de `factura_pagos` de esta factura. Los pagos en el `historial` se conservan, pero limpia su `factura_id` (o lo apunta a otra factura si el pago se aplicó a varias).
2. **Limpia devengado**: Borra todas las `costo_asignaciones` de esa factura.
3. **Elimina factura**: Borra la fila de `facturas`.
4. **Guarda**: Actualiza Sheets + Supabase.
5. **Refresca**: Renders de facturas, factura_pagos, historial, costos.

### Al eliminar un pago de factura (factura_pago)

Se ejecuta `eliminarPagoFactura()`:

1. **Actualiza factura padre**: Decrementa `monto_pagado`, recalcula saldo/estatus.
2. **Desliga del historial**: Si el pago no tiene NINGUNA otra factura ligada, limpia su `factura_id`. Si le quedan facturas, apunta a una de ellas (para que siga siendo visible en reports).
3. **Borra fila**: Elimina el `factura_pago`.
4. **Guarda cascada**: Factura (por fila), pago (por fila), factura_pago (borrado).
5. **Refresca**: Todas las tablas.

---

## Reporte y Exportación

### Pestaña "Pagos a Facturas"

Tabla **solo lectura** mostrando cada `factura_pago`:
- ID (truncado).
- Factura ID.
- Proveedor.
- Monto aplicado (en verde).
- Saldo de la factura (en accent si > 0).
- Fecha del pago.
- Estatus.
- Observaciones.
- Botón ✕ para eliminar (usuario con permisos).

Filtros: ID numérico, factura específica, rango de fechas.

### Exportación de Facturas

Botón "Exportar a Excel" en la tabla de facturas. Genera `.xlsx` con:
- Columnas: ID, Folio, UUID, Proveedor, Razón social, RFC emisor, Fecha, Vencimiento, Subtotal, Descuento, IVA, Ret.IVA, Ret.ISR, NC monto, NC IVA, Total neto, Pagado, Saldo, Estatus pago, Estado SAT, Tipo comprobante, Proyecto, Empresa, Observaciones.
- Montos como números (para que Excel los sume).
- Incluye lo filtrado en pantalla.
- Respeta orden: pendiente/parcial (por vencimiento asc), pagada/cancelada (por fecha desc).

---

## Integración con Otros Subsistemas

### Historial (Pagos)

- Un pago (`historial.id`) se puede ligar a una factura (`historial.factura_id`).
- Si está ligado, su costo NO se reparte por `costo_asignaciones` (devengado lo aporta la factura).
- Si no está ligado, su costo SÍ se reparte.

### Costo-Asignaciones (Devengado)

- Cada factura repartida genera N asignaciones (una por unidad).
- El total repartido se muestra en la tabla (botón "Reparto ✓" o "Parcial X%").
- Se puede rehacerse sin perder data (borra previo, inserta nuevo).

### Solicitudes (Si aplica)

- Importación de solicitudes de pago puede crear facturas automáticamente (en flujo futuro).

### Costos Fiscales / Reportes

- Usa `costo_asignaciones` (factura_id + unidad_id + monto) para sumas por proyecto/unidad.

---

## Invariantes y Validaciones

1. **UUID único**: No hay 2 facturas con el mismo UUID en la BD.
2. **Saldo ≥ 0**: El saldo se clampea; nunca puede ser negativo (sobrepago imposible).
3. **Estatus coherente**: Si monto_pagado > 0, nunca es "pendiente". Si saldo ≤ 0, nunca es "parcial".
4. **Anti-duplicados**: Al guardar, verifica UUID (bloquea), folio+proveedor (aviso), monto+fecha+proveedor (aviso).
5. **Reparto consistente**: Suma de `factor` de asignaciones de una factura ≤ 1.0. Suma de `monto_asignado` ≈ monto_total (puede haber redondeo).
6. **Multi-factura segura**: Un pago se puede aplicar a varias facturas; se evita duplicar aplicación a la misma factura (verifica `factura_pagos` antes de ligar).

---

## Limitaciones y Consideraciones Futuras

- **Fase 1 actual**: La relación pago→factura es 1:1 o N:1 (un pago a muchas facturas). Pero un pago solo marca su `factura_id` con la PRIMERA factura (las demás quedan en detalle de `factura_pagos`). Reports pueden requerir buscar `factura_pagos` para ver todo.
- **Nota de Crédito**: Se acumula en dos campos (`nc_subtotal`, `nc_iva`). Si hay múltiples NCs, se suman aquí. No hay registro individual de cada NC.
- **Devengado en fase diferida**: Si se crea factura sin reparto y se reparte después, el devengado es manual. Auto-repartir solo aplica a facturas nuevas (por crear) o al importar Excel con reparto.

---

## Ejemplo Completo de Flujo

1. **Gonzalo importa 5 facturas de Excel**:
   - Factura 1: $10,000 a Proveedor A, Proyecto X, reparto equitativo entre casas 101/102/103.
   - 3 facturas más sin reparto.
   - 1 factura con error de reparto → carga se bloquea, Gonzalo corrige, reintenta.

2. **Tesorería confirma pago**:
   - Pago de $3,500 a Proveedor A llegó al banco.
   - Usuario marca como confirmado y especifica "Factura 1".
   - Sistema valida (existe, no cancelada, proveedor OK) y crea `factura_pago`.
   - Factura 1: monto_pagado = $3,500, saldo = $6,500, estatus = "parcial".

3. **Gonzalo repartió costo**:
   - Si no estaba, repartidor abrió automáticamente.
   - 3 asignaciones creadas: 101 = $3,333.33, 102 = $3,333.33, 103 = $3,333.34.
   - Botón refleja "Reparto ✓".

4. **Tesorería vincula otro pago manualmente**:
   - Pago de $5,000 a Proveedor A en historial (sin factura).
   - Abre Factura 1, presiona "Vincular pago".
   - El pago aparece con badge "monto similar" (cercano a saldo).
   - Aplica $5,000 a Factura 1.
   - Factura 1: monto_pagado = $8,500, saldo = $1,500, estatus = "parcial".

5. **Pago final**:
   - Último pago de $1,500 llega. Tesorería lo confirma sin factura (pago libre).
   - Manual: Gonzalo va a Factura 1, vincula este pago.
   - Factura 1: monto_pagado = $10,000, saldo = $0, estatus = "pagada", fecha_pago_total = hoy.
   - Contador verifica en detalle: ve 3 pagos aplicados, tabla de asignaciones.

6. **NC llega**:
   - Proveedor A emite NC por $500 (descuento por volumen).
   - Gonzalo edita Factura 1: nc_subtotal = $500, nc_iva = $80 (auto).
   - Total neto cae a $9,420.
   - Saldo = $9,420 − $10,000 = −$580 → clampeado a 0.
   - Factura 1 está SOBREPAGADA por $580 (de un pago anterior que era "parcial" al momento de aplicarse).
   - Costo de devengado se actualiza (se recalcula por factor, bajando proporcionalmente).

---

## Resumen de Datos

| Entidad | Propósito | Estado |
|---------|----------|--------|
| Facturas | Registro de obligaciones de pago por proveedor | PK: factura_id |
| Factura-Pagos | Liga cada pago a factura, con monto aplicado | PK: factura_pago_id, FK: factura_id, pago_id |
| Historial | Todos los pagos/movimientos procesados | Incluye factura_id (si se ligó) |
| Costo-Asignaciones | Reparto de factura/pago a casas (devengado) | Incluye factura_id (si es devengado) |

### Conceptos clave de esta seccion
- Una factura es una obligación de pago con datos fiscales CFDI (UUID, RFC, retenciones, IVA); estado_sat (fiscal) ≠ estatus_factura (pago)
- El saldo_pendiente y estatus_factura se DERIVAN siempre de monto_total y monto_pagado; nunca quedan inconsistentes
- Un pago se puede repartir entre VARIAS facturas (multi-factura); cada aplicación es un factura_pago con monto_aplicado topado al saldo
- Devengado = reparto de costo de factura a casas; si un pago se liga a factura, su costo va por devengado (no por reparto libre)
- Nota de crédito resta del total neto; el monto_total guardado es ya el NETO a pagar (no requiere cálculo en runtime)
- Anti-duplicados: UUID único (bloquea), folio+proveedor (aviso), monto+fecha+proveedor (aviso) previene doble pago
- Borrado de factura limpia cascada: factura_pagos, costo_asignaciones, desvincula del historial; los pagos se conservan
- Control de caja y conciliación: la vista factura_pagos es el justificante de quién debo, cuánto pagué, qué saldo hay

---

# Subsistema C: Costos Fiscales por Unidad, Presupuestos y Resumen Ejecutivo

# Subsistema C: Costos Fiscales por Unidad, Presupuestos y Resumen Ejecutivo

## ¿QUÉ ES? (Visión del negocio)

Este subsistema responde la pregunta crítica de cualquier constructor: **¿cuánto cuesta realmente cada casa?**

En un proyecto de vivienda, el costo de una casa no es solo lo que se pagó directamente por ella, sino también su **parte proporcional de los costos compartidos** (terreno, servicios, amenidades, administración). El sistema calcula automáticamente cuánto de cada pago o factura corresponde a cada unidad, considerando:

- **Costos directos**: pagos/facturas asignados específicamente a una casa
- **Costos indirectos (área común/indiviso)**: los pagos se reparten entre todas las casas según su porcentaje de participación (% indiviso)
- **Costos de apertura (saldo inicial)**: lo que ya se había gastado en cada partida ANTES de usar el sistema (para proyectos que ya estaban en marcha)

El resultado es el **costo real por unidad**, que permite:
- **Saber la rentabilidad real** de cada casa (presupuesto vs. costo real)
- **Controlar el presupuesto** (alerta si una casa se va en costos)
- **Cumplimiento fiscal** (desglose de costos por partida para auditoría)
- **Tomar decisiones**: qué casas son más rentables, dónde se están desviando más recursos

---

## ARQUITECTURA: Dos modelos de costo

### Modelo 1: DEVENGADO (Costo facturado)
Cuando llega una **factura (CFDI fiscal mexicano)**, se "**reparte**" (devengado) a las casas. El costo fiscal se reconoce cuando el proveedor emite la factura, **sin necesidad de que se haya pagado**.

**Clave**: Una factura está en "devengado" si:
- Tiene `estado_sat` ≠ 'Cancelada' (no fue invalidada)
- Ha sido repartida (tiene al menos una asignación en `costoAsignaciones` con `factura_id` lleno)

### Modelo 2: PAGADO SIN FACTURA (Costo en efectivo)
Cuando se registra un **pago sin factura**, se asigna a las casas. Es costo real de caja, no fiscal.

**Clave**: Un pago cuenta como "pagado sin factura" si:
- Tiene `tipo_registro='Pago'` y se le ha asignado a casas
- **NO** está cubierto por una factura ya repartida (evita doble conteo)

### Regla de no duplicidad (crítica)
**Si un pago tiene una factura ligada a él Y esa factura ya está repartida (y no cancelada)**: el pago se OCULTA de la sumatoria de costo. De lo contrario, contaríamos la misma cosa dos veces:
- 1. Como devengado (por la factura)
- 2. Como pagado (por el pago)

El sistema **prefiere nunca duplicar** (mejor subcontar temporalmente mientras se reparte cada factura, que sobrecontar).

---

## FLUJO DE TRABAJO PASO A PASO

### FASE 1: SETUP INICIAL — Crear unidades (casas)

**Pantalla**: Pestaña "🏠 Unidades" → sub-pestaña "Costos Fiscales"

**Qué hace**:
1. El usuario selecciona un proyecto activo
2. Crea las unidades del proyecto (casa, oficina, etc.)
3. Para cada unidad captura:
   - **Nombre** (ej. "Casa 1", "Local A")
   - **Tipo** (ej. "Residencial", "Comercial")
   - **% Indiviso** (participación en costos comunes; la suma de todas debe ser ~100%)
   - **Superficie** (m²; para referencia)
   - **Estatus** (En obra / Terminada / Entregada / Vendida)
   - **Fecha de terminación** (cuándo salió del pool de indiviso; CRÍTICO)

**Por qué importa la fecha de terminación**: Si una casa termina el 2024-06-15, no recibe costo asignado por facturas de DESPUÉS de esa fecha (no es lógico cargar amenidades futuras a una casa ya entregada). El sistema respeta fechas automáticamente en el reparto por indiviso.

**Captura en lote**: Crear 10, 20 o 100 casas de una vez con nombres automáticos (Casa 1, Casa 2...) y % indiviso distribuido uniformemente.

---

### FASE 2: PRESUPUESTOS — Capturar el plan de gastos por casa

**Pantalla**: Pestaña "📋 Presupuestos"

**Qué hace**:
1. Selecciona una unidad específica
2. Captura (o importa en Excel) el presupuesto por partida de obra:
   - **Partida** (ej. "Cimentación", "Estructura", "Acabados")
   - **Monto presupuestado** (lo que DEBERÍA costar)
   - **Costo inicial** (lo que YA costó ANTES de usar el sistema; 0 para proyectos nuevos)

**Captura masiva**: 
- Descargar plantilla Excel (auto-genera filas para todas las unidades × partidas)
- Llenar los montos en Excel
- Subir el archivo → el sistema hace **merge inteligente**:
  - Si la partida ya existe en esa casa, actualiza
  - Si es nueva, la agrega
  - Detecta partidas del catálogo vs. partidas legacy (no rompe, solo avisa)

**Por qué importa**:
- Sin presupuesto, no hay control → no sabes si un gasto es anómalo
- El presupuesto es la **línea base** para calcular % de avance (costo real / presupuesto)
- El costo inicial permite que proyectos "semi-iniciados" tenga el costo correcto desde el primer día

---

### FASE 3A: ASIGNAR PAGOS DIRECTOS (sin factura)

**Pantalla**: Pestaña "🔗 Asignar Pagos"

**Qué hace**:
1. Lista todos los pagos del proyecto que **aún no están asignados** a ninguna casa
2. El usuario elige un pago y abre el modal de reparto
3. Selecciona el **método de asignación**:

#### Métodos de reparto

**a) Directo**: El 100% del pago va a UNA casa
- Caso: Pago por hormigón a la casa 5 específicamente

**b) Equitativo**: El pago se divide en partes iguales entre N casas seleccionadas
- Caso: Pago de mano de obra general → divide entre 3 casas que estaban en obra ese mes

**c) Personalizado (% o $)**: El usuario define manualmente qué % o $ va a cada casa
- Modo 1: Por porcentaje (Casa 1: 40%, Casa 2: 30%, Casa 3: 30% = 100%)
- Modo 2: Por monto (Casa 1: $50k, Casa 2: $30k, Casa 3: $20k = total del pago)
- Botones auxiliares: "Repartir resto entre vacías" o "Repartir resto por indiviso" (para mezcla directa + área común)

**d) Indiviso (Área común)**: El pago se reparte automáticamente según % indiviso de CADA CASA **respetando la fecha del pago**
- Caso: Pago de servicios comunes (agua, luz, seguridad) del 2024-06-15 → solo lo reciben las casas que seguían en obra ESA fecha
- Lógica: Una casa terminada antes de esa fecha NO recibe esos costos

**Preview antes de guardar**: Muestra el desglose exacto de montos por casa (con % entre paréntesis) para verificar antes de confirmar.

---

### FASE 3B: REPARTIR FACTURAS (devengado)

**Pantalla**: Desde "📄 Facturas" (módulo aparte) → botón "🧾 Repartir costo" en cada factura

**Qué hace**:
1. El usuario abre una factura que tiene `monto_total > 0`
2. El sistema calcula cuánto ya está repartido (si se reparte en partes/sub-partidas)
3. El usuario elige el **método de reparto** (igual que arriba: directo, equitativo, personalizado, indiviso)
4. **OBLIGATORIO**: Selecciona la **partida** (y sub-partida si aplica) a la que corresponde esa factura

**Reparto por PARTES (multi-sub-partida)**:
- Una factura de hormigón puede ser:
  - Parte 1: Cimentación ($10k) → a la casa 5
  - Parte 2: Estructura ($8k) → repartida por indiviso
  - Parte 3: Acabados ($2k) → a la casa 7
- El usuario rellena cada parte de la factura, el sistema suma y no permite pasar del `monto_total`
- Una vez 100% repartida, la factura está completa

**Partida y sub-partida**:
- La **partida** es el nivel principal (ej. "Cimentación")
- La **sub-partida** (si existe) es un desglose (ej. "Cimentación / Excavación")
- Se usan para auditoría fiscal y reportes detallados

---

### FASE 4: VERIFICACIÓN — Pagos asignados y huérfanas

**Pantalla**: Pestaña "✅ Pagos Asignados"

**Qué hace**:
1. Lista todos los pagos del proyecto YA repartidos a casas
2. Muestra el método usado (Directo, Equitativo, etc.) y desglose de montos
3. **Asignaciones huérfanas**: Si un pago o factura fue eliminado después de asignarlo, la asignación queda "huérfana" (ya no tiene padre)
   - No cuenta en los cálculos de costo (no la cuenta)
   - Botón "🗑 Limpiar" para eliminarlas

---

### FASE 5: REPORTES Y CONTROL — Ver costo real por unidad

**Pantalla**: Pestaña "📊 Costo por Unidad"

**Qué hace**:
1. Muestra tabla con cada unidad y sus costos:
   - **Presupuesto**: Lo que debería costar (suma de presupuestos por partida)
   - **Devengado**: Lo reconocido fiscalmente (facturas repartidas)
   - **Pagado s/fact**: Lo pagado en efectivo (pagos sin factura asignados)
   - **Costo real**: Devengado + Pagado s/fact + Costo inicial
   - **Variación**: Presupuesto - Costo real (negativo = sobrepasar presupuesto)
   - **% Avance**: (Costo real / Presupuesto) × 100
     - Verde: ≤90% (bajo control)
     - Naranja: 90–100% (alerta)
     - Rojo: >100% (en rojo, se pasó presupuesto)

2. **Desglose por partida**: Al hacer clic en una casa, expande:
   - Tabla con partidas vs. presupuesto/real
   - Gráfico donut mostrando composición de gastos

3. **KPIs consolidadas**:
   - Presupuesto total (todas las casas)
   - Devengado total, Pagado total, Costo real total

---

### FASE 6 OPCIONAL: VISUAL — Plano interactivo

**Pantalla**: Pestaña "🗺️ Plano"

**Qué hace**:
1. Carga una imagen del plano del desarrollo
2. **Modo vista**: Colorea cada unidad según:
   - **% Avance**: Verde (bien), Naranja (alerta), Rojo (sobre presupuesto)
   - **Estatus**: Color por estatus de la obra (En obra, Terminada, etc.)
3. **Modo edición**:
   - Sub-modo **Pines**: Clic en el plano ubica cada casa con un pin (para casas pequeñas/oficinas)
   - Sub-modo **Zonas**: Drag-to-draw rectángulos para definir la zona de cada casa (para casas grandes)
   - Permite mover pines, redimensionar zonas, quitar ubicaciones
4. Hover muestra tooltip con nombre de casa; clic abre desglose de costos

**Por qué importa**: Visual rápido de dónde están los problemas (casas en rojo). Muy usado por supervisores de obra.

---

## RESUMEN EJECUTIVO (módulo aparte)

**Pantalla**: Pestaña "📈 Resumen Ejecutivo"

**Qué hace** (análisis de PAGOS, no de costos por unidad):
1. Filtra por rango de fechas, proyecto y partida
2. Muestra **KPIs por período**:
   - Egresos del período
   - Número de operaciones de pago
   - Variación vs. período anterior (% y monto)
   - Ticket promedio por operación
3. **Gráficos**:
   - Línea: Tendencia últimos 6 meses completos
   - Dona: Distribución por proyecto
   - Barras: Top 8 partidas
4. **Top 5 beneficiarios** (proveedores/empleados más pagados)
5. **Sub-partidas** (si están capturadas): desglose adicional
6. **Saldos netos de préstamos** entre proyectos (deudas vivas)
7. **Observaciones automáticas**: Texto que resume lo más relevante
8. **Exportar CSV**: Descarga los datos en Excel para análisis
9. **Reporte Juan Pablo**: Genera Excel pivote (partidas × meses) con dato de qué cuenta:
   - Pagos ✓, Aportaciones ✓, Intereses de crédito ✓
   - Traspasos ✗, Préstamos ✗, Pago de deuda ✗
   - (exclusión especial de ciertos movimientos por norma financiera)

---

## DATOS MANEJADOS (Tablas Supabase)

### 1. `unidades` (viviendas/casas)
```
unidad_id (PK)
proyecto (FK → proyectos.nombre)
nombre (ej. "Casa 1")
tipo (ej. "Residencial")
indiviso_pct (% de participación en costos comunes; suma ~100%)
superficie_m2 (tamaño)
estatus (En obra / Terminada / Entregada / Vendida)
fecha_termino (YYYY-MM-DD; cuándo salió del pool de indiviso)
plano_x, plano_y (posición en % del plano visual)
plano_w, plano_h (dimensiones en % si es zona; null si es pin)
orden (número de orden para sorting)
activo (bool; inactiva = no se ve)
```

### 2. `presupuesto_unidad` (presupuestos por casa/partida)
```
presupuesto_id (PK)
unidad_id (FK → unidades)
partida (ej. "Cimentación")
sub_partida (ej. "Excavación"; puede estar vacía)
monto_presupuestado (lo que DEBERÍA costar)
costo_inicial (lo que YA costó antes del sistema)
notas (libre)
```

### 3. `costo_asignaciones` (reparto de pagos/facturas a casas)
```
asignacion_id (PK)
pago_id (FK → historial.id si es pago; "" si no)
factura_id (FK → facturas.factura_id si es factura; "" si no)
unidad_id (FK → unidades)
proyecto
metodo (directo / equitativo / indiviso / custom)
monto_asignado (cuánto de ese pago/factura va a esta casa)
factor (% del pago; para recalc. si varía)
fecha_asignacion (cuándo se repartió)
partida_override (si es factura: partida elegida)
sub_partida_override (si es factura: sub-partida elegida)
```

### 4. Tablas relacionadas (del módulo de Pagos/Facturas)
- `historial`: Pagos, aportaciones, créditos, traspasos
- `facturas`: Facturas CFDI (con estado_sat, monto_total, etc.)
- `factura_pagos`: Relación M:M entre facturas y pagos (una factura puede cobrarse en varios pagos)

---

## LÓGICA CRÍTICA DEL COSTO REAL

```
COSTO REAL DE UNA CASA = 
  + Costo Inicial (presupuestado)
  + Devengado (facturas repartidas no canceladas)
  + Pagado sin factura (pagos repartidos cuya factura NO está repartida)
```

**Evitar doble conteo**:
- Un pago solo cuenta como "pagado sin factura" si su factura (si existe) NO está repartida O está cancelada
- Si la factura ya está repartida: el pago se OCULTA, el costo ya vino por la factura

**Estimado por indiviso** (SOLO VISUAL):
- Pagos sin asignar + sin factura → se reparten por indiviso simuladamente, sin crear asignaciones reales
- Muestra "Estimado por asignar: $X" para que el usuario vea qué pasaría si no asignara nada
- NO afecta el costo real; es solo para visualizar

---

## IMPORTANCIA PARA EL NEGOCIO

### 1. **Rentabilidad por casa**
- Saber exactamente cuánto costó cada casa permite fijar precio de venta correcto
- Identifica casas "problema" (sobre presupuesto) para tomar acción temprano

### 2. **Control presupuestario en tiempo real**
- Alertas visuales (rojo = pasado de presupuesto)
- Decisiones: frenar obra, renegociar con proveedores, cambiar materiales

### 3. **Cumplimiento fiscal mexicano**
- Facturas (CFDI) repartidas por partida de obra
- Trazabilidad: cada peso facturado está ligado a una casa y una partida
- Auditoría: "¿Por cuánto se pagó la estructura de la casa 5?" → respuesta inmediata

### 4. **Cierre y contabilidad**
- Costeo correcto por proyecto: suma de todas las casas = costo total del proyecto
- No se pierden costos ni se duplican
- Base para reconocimiento contable mensual

### 5. **Toma de decisiones ejecutiva**
- ¿Qué proyecto es más rentable? (Resumen Ejecutivo)
- ¿Dónde se están desviando recursos? (Top partidas, Top beneficiarios)
- ¿Hay préstamos vivos entre proyectos? (Saldos netos)

---

## ARCHIVOS CLAVE

- **`src/modules/costos-fiscales.js`** (2027 líneas): Motor central del sistema
  - Todas las tabs: Unidades, Asignar, Presupuestos, Reportes, Plano
  - Lógica de reparto (directo, equitativo, indiviso, personalizado)
  - Cálculos de costo real, devengado, pagado
  - Gestión de huérfanas, preview, validación
  
- **`src/config/costos-fiscales.js`**: Catálogos y helpers
  - Estatus de unidades, métodos de asignación
  - Función `unidadEnIndivisoAFecha()` (crítica para respetar fechas)
  
- **`src/modules/resumen-costos.js`**: Análisis de pagos por período
  - KPIs, tendencia, top beneficiarios, distribuciones
  - Reporte Juan Pablo (Excel pivote)
  
- **`src/modules/resumen-ejecutivo.js`**: Dashboard ejecutivo
  - Indicadores clave, gráficos, observaciones automáticas
  - Exporta CSV
  
- **`src/modules/presupuesto-bulk.js`**: Captura masiva de presupuestos
  - Genera plantilla Excel
  - Procesa subida con merge inteligente
  
- **`styles/costos-fiscales.css`**: Estilos de tabs, modales, picker, plano
- **`styles/resumen-ejecutivo.css`**: Estilos de dashboard

---

## FLUJOS AVANZADOS

### Factura con múltiples sub-partidas
1. Factura de hormigón: $20k total
2. Usuario abre "Repartir costo"
3. Rellena "Monto de esta parte: $10k" (cimentación)
4. Elige método y casas → guarda → sistema suma $10k a esa parte
5. Reabre factura → "Restante: $10k" (estructura)
6. Rellena otra parte → repite
7. Al alcanzar 100%, factura queda completa (botón "Limpiar reparto" deshabilitado)

### Pago aplicado a múltiples facturas
- Una factura de hormigón ($10k) se reparte a Casa 1 (devengado)
- Ese mismo pago también pagó una factura de estructura ($8k) ya repartida
- Sistema reconoce: el pago está cubierto por sus facturas → NO lo cuenta NUEVAMENTE como pagado
- Costo real NO sube doble

### Proyecto con casas que terminan en fechas diferentes
- Casa 1: terminó 2024-06-15
- Casa 2: terminó 2024-08-20
- Pago de servicios: 2024-07-01
- Reparto por indiviso del pago: SOLO Casa 2 lo recibe (Casa 1 ya estaba fuera)
- Si la fecha de Casa 1 es vacía (sigue en obra): ambas lo reciben

---

## SEGURIDAD Y VALIDACIÓN

- **Permisos**: Solo usuarios con rol "editor" pueden asignar/crear/editar (via `puedeEditar()`)
- **No deletar, solo marcar**: Asignaciones nunca se borran a mano; si su factura/pago es eliminado, quedan huérfanas → se limpian con botón
- **Redondeo**: Todos los cálculos usan `r2()` (redondea a 2 decimales) para evitar errores de precisión flotante
- **Campos obligatorios**: Partida y sub-partida obligatorias en reparto de factura
- **Validación de suma**: En modo personalizado con %, valida que sume 100% (o muy cerca)

---

## PRÓXIMOS PASOS TÍPICOS (UX)

1. **Crear proyecto** (en "Proyectos")
2. **Crear unidades** (Costos Fiscales → Unidades)
3. **Capturar presupuestos** (Costos Fiscales → Presupuestos)
4. **Registrar pagos** (en "Pagos / Historial"; módulo aparte)
5. **Asignar pagos a casas** (Costos Fiscales → Asignar Pagos)
6. **Registrar facturas** (en "Facturas"; módulo aparte)
7. **Repartir facturas a casas** (desde Facturas)
8. **Revisar reportes** (Costos Fiscales → Reportes o Resumen Ejecutivo)
9. **Exportar a Excel** (via botones de reportes)

### Conceptos clave de esta seccion
- Costo real = Inicial + Devengado + Pagado sin factura
- Devengado = factura repartida no cancelada; Pagado = pago sin factura pero no duplicado
- % Indiviso determina participación en costos comunes; respeta fecha de terminación
- Métodos de reparto: Directo (1 casa), Equitativo (partes iguales), Indiviso (por %), Personalizado (libre)
- Factura multipart: se reparte en sub-partidas acumulativamente hasta 100%
- Presupuesto vs Real = Control de desviaciones y alerta en % Avance
- Plano visual: colorea casas por Avance (% sobre presupuesto) o Estatus
- No duplicidad: si un pago tiene factura repartida, el pago NO se cuenta nuevamente
- Resumen Ejecutivo: análisis de pagos (no costos) por período, con gráficos y reportes

---

# Subsistema D — Catálogos y Finanzas Auxiliares

# Subsistema D — Catálogos y Finanzas Auxiliares

## ¿Qué es este subsistema?

El Subsistema D es el **corazón administrativo-contable** de Dehur Pagos. Mientras que el subsistema anterior maneja los pagos diarios a proveedores y empleados, este subsistema gestiona la **estructura organizacional y financiera** sobre la que se cimientan esos pagos: quiénes somos nosotros (proyectos y cuentas), de dónde sale el dinero (saldos de cuentas), a dónde va (traspasos y préstamos entre proyectos), y cuánta deuda tenemos (créditos y pagarés).

Sin los catálogos y controles que define este subsistema, los pagos serían caóticos. No sabrías dónde está el dinero, a qué proyecto asignar un gasto, cómo reconciliar saldos, ni cómo controlar la deuda bancaria.

---

## Los catálogos (Maestros de Datos)

### 1. PROVEEDORES (Base de Proveedores)
**Archivo:** `src/modules/proveedores.js`  
**Tabla Supabase:** `public.proveedores`  
**Para el negocio:** Registro de todos los terceros a quienes la empresa compra bienes o servicios (constructores, corredores, consultores, acopiadores, etc.)

#### Qué almacena:
- **ID numérico** (generado por la app)
- **Nombre y RFC** (identificación fiscal)
- **Banco y cuenta:** CLABE de 18 dígitos o número de cuenta BBVA de 10
- **Tipo de cuenta:** CLABE o Cuenta (determina cómo se dispersa el dinero)
- **Categoría y subcategoría:** "Proveedor" + tipo (Construcción, Consultoría, etc.), "Empleado", "Otros"
- **Proyectos asociados:** En cuáles proyectos trabaja ese proveedor
- **Alias:** Nombres alternativos para búsqueda fuzzy
- **Activo/Bloqueado:** Si puede recibir pagos o está congelado

#### Por qué importa:
- **Sin registro correcto, no hay dispersión bancaria:** Si el CLABE es incorrecto, el pago falla en el banco.
- **Trazabilidad legal:** El RFC es obligatorio para auditoría y CFDI (factura electrónica).
- **Organización por proyecto:** Permite filtrar "¿a quién le pagamos en Paraíso?" vs. "¿en Entorno?".
- **Prevención de fraude:** Activar/bloquear proveedores impide pagos accidentales o maliciosos.

#### Operaciones:
- Importar/exportar desde Excel (para migración de datos)
- Crear/editar/eliminar proveedores
- Búsqueda por nombre, RFC, banco, cuenta, categoría
- Estadísticas: cuántos tienen CLABE, cuántos BBVA, cuántos están en cola de pago

---

### 2. EMPLEADOS (Nómina)
**Archivo:** `src/modules/nomina.js`  
**Tabla Supabase:** `public.empleados`  
**Para el negocio:** Registro de personal de la constructora que recibe nómina periódica

#### Qué almacena:
- **ID numérico**
- **Nombre, puesto, empresa** (ej. "DEHUR TERRITORIAL SA DE CV")
- **Banco, tipo de cuenta, cuenta/CLABE**
- **RFC** (para el recibo de nómina fiscal)
- **Activo/Inactivo**

#### Por qué importa:
- **Nómina automatizada:** Cada quincena o mes se dispersa dinero a las cuentas almacenadas aquí sin tener que re-ingresar datos.
- **Cumplimiento fiscal:** Los datos de banco y RFC se replican en los recibos (CFDI) de nómina.
- **Separación contable:** Los empleados están separados de proveedores en la UI y en los filtros, aunque ambos sean entidades que reciben pagos.

#### Operaciones:
- Crear/editar/eliminar empleados
- Búsqueda por nombre, puesto, banco, cuenta
- Filtrar por tipo de cuenta (CLABE vs. BBVA)
- Pago rápido directo desde la tabla

---

### 3. CUENTAS PROPIAS (Tesorería Interna)
**Archivo:** `src/modules/cuentas-propias.js`  
**Tabla Supabase:** `public.cuentas_propias`  
**Para el negocio:** Registro de las cuentas bancarias que la empresa controla (además de las cuentas de los proyectos)

#### Estructura de cuentas:
La app reconoce dos tipos de cuentas bancarias:

1. **Cuentas de Proyecto (de Dispersión):** Cada proyecto tiene una cuenta BBVA principal donde se concentra dinero:
   - **Paraíso:** Cuenta 0124913019, CLABE 012180001249130198
   - **Entorno:** Cuenta 0111221051, CLABE 012180001112210514
   - **Concentradora DT:** Cuenta 0122903652, CLABE 012180001229036526
   
   Estas son **solo lectura** en la UI (aparecen siempre, no se pueden borrar). Se editan desde el modal "Editar Proyecto".

2. **Cuentas Adicionales:** Líneas de crédito, cuentas de ahorro, cobranza, etc., que se registran manualmente aquí.

#### Qué almacena (para cuentas adicionales):
- **ID numérico**
- **Nombre** (ej. "LOC BBVA 2024", "Ahorro Paraíso")
- **Tipo:** Dispersión, Cobranza, Ahorro, Pagos, General
- **Banco** y **CLABE/número de cuenta**
- **Proyecto asociado** (opcional)
- **Saldo actual** y **fecha de última actualización**

#### Por qué importa:
- **Control de liquidez centralizado:** La header bar muestra en tiempo real el saldo de TODAS las cuentas activas.
- **Traspasos entre cuentas:** Sin un registro de todas las cuentas, no sabrías entre qué podrías mover dinero.
- **Reconciliación bancaria:** Cada saldo se actualiza manualmente (hoy) o automáticamente (futuro), y aquí queda el histórico.

#### Operaciones:
- Crear/editar/eliminar cuentas adicionales
- Actualizar saldo manual
- Asignar a proyecto
- Ver historial de actualizaciones (último movimiento en esa cuenta)

---

### 4. PROYECTOS (Estructura Organizacional)
**Archivo:** `src/config/proyectos.js`  
**Tabla Supabase:** `public.proyectos`  
**Para el negocio:** Registro de cada proyecto de construcción/desarrollo inmobiliario que la empresa ejecuta

#### Datos clave:
- **ID de texto** (ej. "paraiso", "entorno", "dt")
- **Nombre largo** (ej. "Privada del Paraíso")
- **Empresa responsable** (ej. "Desarrollo de Hogares Urbanos SA de CV")
- **Cuenta BBVA y CLABE** donde se concentra el dinero de este proyecto
- **Color de UI** (para visual en badges)
- **Saldo actual y fecha última actualización**
- **Es Concentradora:** Bandera especial para el proyecto "Concentradora DT" que es el fondo central

#### Por qué importa:
- **Segregación de costos:** Todo pago se asigna a un proyecto. Permite saber "¿cuánto gastamos en Paraíso hasta hoy?".
- **Traspasos entre proyectos:** La concentradora redistribuye dinero a los proyectos según cashflow.
- **Cálculo de costo por unidad:** El costo de cada casa depende de qué proyecto es y qué gastos se le asignaron.
- **Restricciones de dispersión:** Los usuarios solo pueden pagar desde las cuentas de proyectos a los que tienen acceso (RLS en Supabase).

#### Operaciones:
- Editar nombre, empresa, cuentas, color (no borrar)
- Ver saldo actual en header badges
- Usar como origen/destino en traspasos
- Filtrar pagos, facturas, historial por proyecto

---

### 5. PARTIDAS (Catálogo de Gastos / Clasificación Contable)
**Archivo:** `src/modules/config-partidas.js`, `src/config/sub-partidas.js`  
**Tabla Supabase:** `public.partidas_catalogo`  
**Para el negocio:** Estructura jerárquica de clasificación de gastos para el análisis de costos (contable y fiscal)

#### Jerarquía:
```
Partida (Encabezado)
  └─ Sub-Partida (Detalle)
     Ejemplo: CONSTRUCCIÓN
       ├─ Preliminares
       ├─ Cimentación
       ├─ Estructura
       ├─ Acabados
       └─ ... (24 más)
```

#### Qué almacena:
- **ID único** (generado: "p_construccion_1234567")
- **Nombre de partida** (CONSTRUCCIÓN, HONORARIOS, IMPUESTOS, etc.)
- **Array de subpartidas** (para CONSTRUCCIÓN: Preliminares, Estructura, Acabados, etc.)
- **Orden** (para ordenar en dropdowns)
- **Activa/Inactiva** (para ocultar sin borrar)

#### Por qué importa:
- **Devengo de costos:** Cada pago a un proveedor se etiqueta con una partida, y eso determina a cuáles unidades/casas se asigna ese costo.
- **Inteligencia de negocio:** Permite analizar "¿cuánto invertimos en estructura vs. en acabados?".
- **Validación:** Ciertos flujos (ej. Aportaciones en traspasos) **requieren** que selecciones una partida válida.
- **Legacy:** Si una partida se inactiva, los pagos antiguos con esa partida siguen siendo válidos (se marca como "legacy").

#### Operaciones (admin only):
- Crear partida con sus subpartidas
- Editar subpartidas (reordenar, agregar, eliminar)
- Activar/inactivar partidas
- Eliminar (si no se usa en historial)

---

### 6. PARTIDAS DE OBRA (Mapeo Local de Gastos)
**Archivo:** `src/modules/config-partidas-obra.js`  
**Tabla Supabase:** `public.partidas_obra`  
**Para el negocio:** Catálogo flexible de líneas de gasto específicas de cada proyecto, mapeadas a las partidas administrativas centrales

#### Estructura:
Cada partida de obra:
- Tiene un **nombre descriptivo** (ej. "Acero de refuerzo Entorno")
- Se mapea a una **partida-admin + subpartida-admin** del catálogo central (ej. → CONSTRUCCIÓN / Estructura)
- Puede ser **global (maestro)** o **específica de un proyecto**
- Está **activa o inactiva**

#### Por qué importa:
- **Flexibilidad operativa:** Permite que cada proyecto tenga sus propias líneas de gasto sin romper la clasificación central.
- **Sin mapeo = alerta:** Si una partida de obra no tiene mapeo, aparece una advertencia ⚠ (previene errores de costeamiento).
- **Trazabilidad:** "¿A qué partida-admin va este gasto de Acero de Entorno?" → CONSTRUCCIÓN / Estructura.

#### Operaciones:
- Crear/editar partidas de obra (admin)
- Mapear a partida-admin + subpartida
- Filtrar por proyecto o maestro
- Activar/inactivar

---

## Movimientos Entre Cuentas

### 1. TRASPASOS y PRÉSTAMOS
**Archivo:** `src/modules/traspasos.js`  
**Tabla Supabase:** `public.traspasos`  
**Para el negocio:** Registro de movimientos internos de dinero entre cuentas propias (proyectos) de la empresa

#### Tipos de traspasos (detectados automáticamente):

1. **TRASPASO:** Dinero entre cuentas del **mismo proyecto** (ej. de Paraíso LOC a Paraíso BBVA)
   - Operación puramente técnica, **sin costo contable**
   - No genera entrada en historial (solo movimiento interno)

2. **PRÉSTAMO:** Dinero entre cuentas de **distintos proyectos** (ej. de Paraíso a Entorno)
   - Movimiento interno **sin costo** (ambas son cuentas de la empresa)
   - Permite que un proyecto cobre dinero de otro temporalmente
   - Registra deuda neta entre proyectos en el Resumen de TCP y Préstamos

3. **APORTACIÓN:** Dinero hacia la **Concentradora DT** (o desde ella)
   - Movimiento con **costo contable** (genera historial + devengo)
   - Se asigna automáticamente a partida (etiqueta de gasto)
   - El monto se reparte entre todas las unidades del proyecto (indiviso)
   - Ejemplo: "Aportación de Paraíso para gastos administrativos centrales" → $10M → se divide entre todas las casas de Paraíso

#### Qué almacena:
- **ID numérico** (traspaso_id)
- **Tipo** (Traspaso, Préstamo, Aportación)
- **Cuenta origen/destino:** ID, tipo (proyecto/cuenta), nombre
- **Proyecto origen/destino** (para matching)
- **Monto, fecha, concepto, referencia**
- **Estatus:** Pendiente, Completado, Cancelado
- **Partida** (solo obligatorio para Aportación)
- **Fecha de registro** (auditoría)

#### Por qué importa:
- **Cashflow dinámico:** La concentradora recibe aportaciones de proyectos en ejecución y redistribuye dinero de un proyecto a otro según necesidad.
- **Ajuste de saldos:** Cuando se marca como "Completado", baja el saldo de la cuenta origen y sube el de destino (refleja la realidad bancaria).
- **Costo por unidad:** Las Aportaciones se asignan automáticamente a todas las casas del proyecto (método "indiviso"), impactando el costo de construcción de cada una.
- **Deuda entre proyectos:** Los Préstamos quedan registrados y se pueden consultar en "Resumen de TCP y Préstamos" para saber quién debe a quién.

#### Operaciones:
- Crear nuevo traspaso/préstamo/aportación con selects de cuentas
- El tipo se detecta automáticamente según origen/destino
- Editar (excepto fecha_registro, que es inmutable)
- Eliminar (revierten saldos si estaban completados)
- Filtrar por tipo, proyecto, estatus, fecha
- Sincronizar aportaciones históricas (backfill de datos importados por plantilla)

---

### 2. MOVIMIENTOS INTERNOS
**Archivo:** Persistidos en `src/modules/traspasos.js`  
**Tabla Supabase:** `public.movimientos_internos`  
**Para el negocio:** Registro auxiliar de traspasos que NO generan historial

#### Qué almacena:
- **ID numérico**
- **Fecha, tipo, origen, destino, monto, concepto, referencia**

#### Por qué importa:
- **Separación contable:** Los Traspasos y Préstamos (sin costo) se registran aquí, no en historial.
- **Auditoría:** Queda un rastro de todo movimiento interno sin importancia contable.

---

### 3. RESUMEN DE TRASPASOS Y PRÉSTAMOS
**Archivo:** `src/modules/resumen-traspasos.js`  
**Para el negocio:** Vista consolidada de todos los traspasos, con enfoque en deuda neta entre proyectos

#### Operaciones:
- Filtrar por tipo (Traspaso, Préstamo, Aportación), proyecto, estatus, rango de fechas
- Ver **Saldos Netos de Préstamos:** "Paraíso le debe a Entorno $5M" (suma neta de todos los préstamos en ambas direcciones)
- Tabla detallada de cada traspaso con concepto, referencia, fecha de registro

#### Por qué importa:
- **Reconciliación:** Auditor puede verificar que todos los traspasos quedaron registrados.
- **Gestión de deuda interna:** "¿Paraíso está muy endeudado con Concentradora?" → ve aquí el neto.

---

## Créditos y Pagarés (Deuda Bancaria)

### 1. CRÉDITOS (Líneas de Crédito)
**Archivo:** `src/modules/creditos.js`  
**Tabla Supabase:** `public.creditos`  
**Para el negocio:** Registro de todas las líneas de crédito que la empresa tiene negociadas con bancos

#### Qué almacena:
- **ID numérico** (credito_id)
- **Nombre** (ej. "LOC BBVA 2024", "Crédito Puente 2Q2024")
- **Banco** (BBVA, Scotiabank, etc.)
- **Tipo de crédito** (Puente, Revolvente, Hipotecario, etc.)
- **Monto autorizado** (límite disponible)
- **Tasa base** (% de interés anual)
- **Proyecto asociado** (a cuál proyecto financia)
- **Cuenta de pago** (dónde se desembolsa)
- **Estatus** (Activo, Cancelado)

#### Por qué importa:
- **Control de deuda:** Sabes cuánta línea tienes disponible y cuánta ya usaste.
- **Cálculo de intereses:** La tasa base sirve para estimar costos financieros.
- **Segregación por proyecto:** Un crédito financia a "Paraíso" y otro a "Entorno".

#### Operaciones:
- Crear/editar/borrar créditos
- Ver estado de disponible vs. dispuesto
- Seleccionar el crédito activo con tabs

---

### 2. PAGARÉS (Disposiciones de Crédito)
**Archivo:** `src/modules/creditos.js`  
**Tabla Supabase:** `public.pagares`  
**Para el negocio:** Registro de cada disposición (desembolso) que se hace de una línea de crédito

#### Estructura:
Cada pagaré pertenece a un crédito y representa un dinero que el banco nos transfirió. Dentro de cada pagaré pueden haber múltiples "fechas de pago de intereses" (ej. pagos mensuales de interés).

#### Qué almacena:
- **ID numérico** (pagare_id)
- **Crédito asociado** (credito_id)
- **Número de pagaré** (documento legal del banco, ej. "PG-202406-001")
- **Monto** (dinero dispuesto)
- **Fecha de disposición** (cuándo llegó el dinero)
- **Fecha de vencimiento** (cuándo caduca el pagaré)
- **Tasa** (% específico para este pagaré)
- **Estatus** (Vigente, Pagado)

#### Por qué importa:
- **Deuda temporal:** Cada pagaré es una deuda específica con fecha vencimiento.
- **Intereses acumulados:** Bajo cada pagaré se registran las fechas de pago de intereses (ver abajo).
- **Auditoría bancaria:** Cada pagaré corresponde a un documento legal del banco.

#### Operaciones:
- Crear nueva disposición (pagaré) desde el tab de crédito
- Expandir pagaré para ver sus fechas de pago
- Editar número, monto, tasa, vencimiento
- Marcar como pagado
- Agregar fechas de pago de intereses

---

### 3. PAGOS DE PAGARÉ (Fechas de Pago de Intereses)
**Archivo:** `src/modules/creditos.js`  
**Tabla Supabase:** `public.pagos_pagare`  
**Para el negocio:** Registro de cada pago de intereses que se hace sobre un pagaré

#### Estructura:
Dentro de cada pagaré hay un sub-registro de "fechas de pago":

```
CRÉDITO "LOC BBVA 2024" (tasa base 4%)
  └─ PAGARÉ PG-202406-001 ($10M, vence 2025-06-30, tasa 4%)
     ├─ Pago 2024-07-31: $33,000 (intereses) [Estado: Pagado ✓]
     ├─ Pago 2024-08-31: $33,000 (intereses) [Estado: Pendiente ⏳]
     └─ Pago 2024-09-30: $33,000 (intereses) [Estado: Pendiente ⏳]
```

#### Qué almacena:
- **ID numérico** (pago_id)
- **Pagaré asociado** (pagare_id)
- **Crédito asociado** (credito_id, redundante pero útil)
- **Fecha de pago** (cuándo vence este pago de intereses)
- **Monto de intereses** (ej. $33,000)
- **Concepto** (descripción, ej. "Intereses julio")
- **Estatus** (Pendiente, Pagado)
- **Fecha real de pago** (si ya se pagó)

#### Por qué importa:
- **Obligaciones de efectivo:** Sabes qué fechas hay que pagar intereses (próximas obligaciones de tesorería).
- **Historial de pagos:** Queda registro de qué intereses se pagaron y cuándo.
- **Impacto en flujo:** Cuando se marca como "Pagado", se registra en Historial y se baja el saldo de la cuenta de pago.

#### Operaciones:
- Agregar fecha de pago a un pagaré (hoy o futuro)
- Editar fecha, monto, concepto, estatus
- Marcar como pagado (genera automáticamente entry en Historial, actualiza saldo de cuenta)
- Eliminar (revierten saldos si estaban pagados)

---

## Por qué importa este Subsistema para el Negocio

### 1. **Control de Liquidez en Tiempo Real**
La header bar de la app muestra el saldo de **todas** las cuentas y proyectos activos. Sin este subsistema no sabrías cuánta plata hay en cada cuenta. Los tesoreros usan esto para decidir si pueden pagar hoy o si tienen que traspasar dinero de la concentradora.

### 2. **Cumplimiento Fiscal y Bancario**
- Los **RFC de proveedores y empleados** son obligatorios para CFDI (factura electrónica).
- Los **CLABE correctos** son críticos: un dígito mal y el pago rebota.
- Las **cuentas registradas** deben coincidir con los registros del banco (RUC del BBVA).
- Los **créditos y pagarés** se auditan vs. los contratos reales con el banco.

### 3. **Segregación de Costos por Proyecto**
Cada pago se etiqueta con un proyecto. Sin estos catálogos, no podrías saber "¿cuánto costó hacer Paraíso?" vs. "¿cuánto Entorno?". Esto es crítico para:
- Valuar proyectos (¿a qué precio vendo la casa?).
- Análisis de rentabilidad (¿ganamos dinero en Paraíso o perdimos?).
- Reporte al dueño del proyecto.

### 4. **Inteligencia de Costos de Construcción**
Las **partidas** (CONSTRUCCIÓN, ACABADOS, etc.) permiten responder:
- "¿Cuánto invertimos en estructura vs. acabados?"
- "¿Qué partida es más cara en Paraíso vs. Entorno?"
- "¿Somos eficientes en losa comparado con la industria?"

Las **asignaciones de costo** (indiviso, equitativo, directo) distribuyen cada pago entre unidades. Esto retroalimenta:
- Costo por metro cuadrado de cada casa.
- Indicadores de productividad ($/m2 de estructura en 3 meses).
- Presupuesto vs. real (¿gastamos más o menos que lo planeado?).

### 5. **Gestión de Tesorería y Deuda**
- **Traspasos y préstamos** coordinan el dinero entre proyectos en ejecución.
- **Créditos y pagarés** registran obligaciones con bancos (vencimientos, tasas, intereses).
- El **Resumen de TCP** muestra deuda neta entre proyectos (¿Paraíso debe a Entorno?).
- Esto permite a la CFO: "¿Cuánta deuda total tenemos? ¿A quién le debemos? ¿Cuándo vence?"

### 6. **Auditoría y Compliance**
Cada transacción está relacionada a:
- Un proyecto (segregación).
- Una partida (clasificación).
- Una unidad/casa (trazabilidad).
- Un proveedor/empleado (identidad).
- Una cuenta bancaria (origen/destino).

Sin estos catálogos, no hay forma de auditar un pago de $1M: "¿A quién fue? ¿De qué cuenta? ¿Por qué partida? ¿A qué proyecto?"

### 7. **Prevención de Errores y Fraude**
- Bloquear proveedores impide pagos accidentales o maliciosos.
- Validación de CLABE evita transferencias a cuentas incorrectas.
- RLS en Supabase (por proyecto) impide que un usuario pague desde una cuenta de otro proyecto.
- Auditoría de movimientos (fecha_registro inmutable) rastrea quién hizo qué y cuándo.

---

## Integración con Otros Subsistemas

```
SUBSISTEMA D (Catálogos y Finanzas)
    ├─→ Alimenta SUBSISTEMA A (Pagos)
    │   - Un pago se debe asignar a un proveedor/empleado (del catálogo).
    │   - Se dispersa desde una cuenta (del catálogo).
    │   - Se asigna a un proyecto (del catálogo).
    │   - Se etiqueta con partida (del catálogo).
    │
    ├─→ Alimenta SUBSISTEMA B (Dispersión)
    │   - Los CLABE/cuentas vienen de Proveedores.
    │   - Las cuentas de origen vienen de Cuentas Propias.
    │   - El archivo de dispersión usa IDs de proyectos.
    │
    ├─→ Alimenta SUBSISTEMA C (Facturas)
    │   - Las facturas se asignan a proveedores (del catálogo).
    │   - Los pagos a facturas se deducen de saldos de cuentas (del catálogo).
    │
    └─→ Es alimentado por:
        - Historial (devengo de costos pasa a costo_asignaciones)
        - Traspasos de dinero actualiza saldos de proyectos/cuentas
        - Pagos de pagaré bajan saldos
```

---

## Diagrama de Flujo: Del Traspaso al Costo de Unidad

```
Tesorero crea TRASPASO/APORTACIÓN
  ↓
Tipo = "Aportación" (detectado: origen != Concentradora, destino = Concentradora)
  ↓
Monto + Partida obligatorios
  ↓
Se genera HISTORIAL entry (Aportación a Proyecto X, $10M, Partida=CONSTRUCCIÓN)
  ↓
Se llama aplicarAutoIndiviso()
  ↓
Para cada unidad ACTIVA del Proyecto X:
  - Se crea COSTO_ASIGNACIÓN (monto * % indiviso / N unidades)
  ↓
Resultado en UI:
  - Saldo de Proyecto baja en $10M
  - Costo por unidad de Proyecto sube en ($10M / 100% indiviso / N casas)
  - En "Costos por Unidad" aparece: Casa 1: +$100k, Casa 2: +$100k, ...
```

---

## Conclusión

El Subsistema D es la **red nerviosa contable** de Dehur Pagos. Define:
- **Quiénes somos** (proyectos, empresas).
- **Dónde está el dinero** (cuentas, saldos).
- **Cómo clasificamos gastos** (partidas, subpartidas).
- **Cómo se mueve dinero internamente** (traspasos, préstamos).
- **Cuánta deuda tenemos** (créditos, pagarés, intereses).

Un negocio sin catálogos claros es como construir una casa sin planos. Todo es confusión, errores y fraude. Este subsistema es donde se establecen esos planos: las reglas de cómo fluye dinero, se clasifica, se asigna y se rastrea.

### Conceptos clave de esta seccion
- Proveedores y Empleados son los maestros de identidad de terceros que reciben pagos
- Cuentas Propias + Proyectos: estructura dual de tesorería (física vs. contable)
- Traspasos/Préstamos/Aportaciones: movimientos internos con impacto diferente en historial y costos
- Créditos + Pagarés: registro de deuda bancaria con fechas y tasas
- Partidas: taxonomía de gastos que determina cómo se asignan costos a unidades/casas
- Saldos en tiempo real en header: foundation para decisiones de tesorería (¿hay plata para pagar hoy?)

---

# Subsistema E: Arquitectura Técnica, Modelo de Datos, Seguridad y Operación

# Subsistema E: Arquitectura Técnica, Modelo de Datos, Seguridad y Operación

## Por Qué Importa Este Subsistema

Este es el **corazón técnico invisible** del sistema de pagos. Sin él, la app perdería datos, varios usuarios se pisarían entre sí (mismos IDs, ediciones simultáneas), y habría agujeros de seguridad. **En finanzas de construcción, perder un pago o un registro es catastrófico**: afecta al flujo de caja, a la auditoría fiscal (CFDI en México), y a la confianza de proveedores. Este subsistema:

1. **Garantiza que NUNCA se pierda un pago**, incluso si se cae internet o dos usuarios guardan al mismo tiempo.
2. **Aísla cada empresa** (multi-tenant): datos de Dehur no se mezclan con futuras constructoras en la misma base de datos.
3. **Controla quién puede hacer qué** (roles y permisos): un capturista no puede confirmar pagos, ni un lector eliminar facturas.
4. **Sincroniza en TIEMPO REAL**: si un gerente aprueba un pago en su laptop y el contador abre Supabase desde el móvil, ve el cambio sin apretar "Refrescar".

Sin esto, el sistema sería un papel mojado. Con esto, la app es resiliente, escalable y auditoria.

---

## Arquitectura General: Tres Capas

```
┌─────────────────────────────────────────────────────────┐
│  SPA en navegador (JavaScript vanilla, ES modules)     │
│  • index.html (todas las pestañas)                     │
│  • src/modules/* (cada feature: pagos, facturas, etc.)  │
│  • src/state.js (memoria compartida de la app)         │
└──────────────────────────┬──────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼─────┐    ┌─────▼──────┐    ┌────▼────────┐
    │  Google  │    │  Supabase  │    │   Realtime  │
    │  Sheets  │    │  (Postgres)│    │  (WebSocket)│
    │ Respaldo │    │Fuente 2026 │    │   Tiempo    │
    │ Legacy   │    │            │    │   Real      │
    └────┬─────┘    └─────┬──────┘    └────┬────────┘
         │                │                 │
    Guardado         Guardado por      Cambios
    por tabla        fila (UUID)     entre usuarios
```

### Capa 1: Frontend (SPA Vanilla)
- **index.html**: Envoltorio único que carga los módulos según la pestaña activa.
- **src/state.js**: Objeto global que vive en memoria todo lo que la app necesita: proveedores, empleados, historial de pagos, facturas, etc.
- **src/modules/***: ~25 módulos (cada uno una pantalla o feature: pagos, solicitudes, facturas, costos por unidad, etc.).
- **src/services/***: Servicios reutilizables (autenticación, persistencia, tiempo real, validación).
- **src/ui/***: Utilidades de renderización, notificaciones, badges de saldos.
- **Frameworks**: XLSX (importar/exportar Excel), Chart.js (gráficos), Supabase JS SDK (cliente).

**Ventaja**: Cero dependencias build, se corre directo en el navegador. Seguro por RLS del lado servidor.

### Capa 2: Backend (Supabase con Postgres)
- **Supabase Auth**: Maneja login/logout con email + contraseña. JWT con `tenant_id` y `role` incrustados.
- **Postgres (Supabase)**: Base de datos relacional multi-tenant. Tablas: `tenants`, `tenant_users`, `proveedores`, `empleados`, `historial`, `facturas`, `factura_pagos`, `proyectos`, `creditos`, `traspasos`, `unidades`, `costo_asignaciones`, etc. — 15+ tablas.
- **Row Level Security (RLS)**: Cada tabla tiene policies que filtran AUTOMÁTICAMENTE por `tenant_id` del usuario. Un usuario de Dehur NUNCA ve datos de otro tenant.
- **Realtime (PostgreSQL Logical Decoding)**: Supabase intercepta cambios en la BD (INSERT/UPDATE/DELETE) y los envía por WebSocket a navegadores suscritos. Así, si un usuario inserta un pago, todos los demás lo ven SIN apretar "Refrescar".

### Capa 3: Google Sheets (Respaldo Legacy)
- **Sheets como respaldo**: Toda la información se guarda también en un Google Sheet con pestañas (Proveedores, Empleados, Historial, Facturas, etc.). Es un **espejo redundante**: si Supabase cae, los datos siguen en Sheets.
- **Lectura y escritura**: La app puede leer de Sheets (carga inicial, fallback) y escribir (guardado dual-write).
- **Reversibilidad**: Si se quiere revertir a Sheets, es tan fácil como cambiar `FUENTE_LECTURA = 'sheets'` en el código.

---

## Flujo de Datos: Cómo se Mueve la Información

### 1. Arranque (Login)
```
Usuario abre app
        │
        ▼
¿Hay sesión Supabase válida?
        │
        ├─ SÍ → fetchCurrentTenantInfo() → lee tenant_users + tenants
        │       → state.session = { userId, email, tenantId, role }
        │       → bootstrap (cargar datos)
        │
        └─ NO → mostrar login (auth-screen)
```

### 2. Bootstrap (Carga de Datos)
```
Usuario se autentica
        │
        ▼
¿FUENTE_LECTURA = 'supabase'?
        │
        ├─ SÍ → sbLoadAll()
        │       • Lee TODAS las tablas de Supabase (con paginación de 1000 filas)
        │       • Filtra por tenant_id (RLS hace el trabajo duro)
        │       • Mapea a state.proveedores, state.historial, etc.
        │       • Fallback: si Supabase falla → intenta Sheets (gsLoadAll)
        │
        └─ NO ('sheets') → gsLoadAll()
                • Lee Google Sheets directamente
                • Solo si FUENTE_LECTURA = 'sheets' (reversible)
                
        ▼
finalizarCarga()
  • Ordena historial por fecha (desc)
  • Recalibra contadores (nextId, nextUnidadId, etc.)
  • Detecta asignaciones de costo huérfanas (aviso, sin borrar)
  • Re-renderiza toda la UI (todos los módulos se redibujan)
  
        ▼
REALTIME_ON = true?
  ├─ SÍ → iniciarRealtime()
  │       • Abre canales WebSocket para las tablas en ENTIDADES_REALTIME
  │       • Se suscribe a cambios (INSERT/UPDATE/DELETE)
  │       • Filtra por tenant_id (seguridad)
  │
  └─ NO → sin tiempo real (modo lectura ocasional)
```

### 3. Guardado (Dos Estrategias Simultáneas)

#### Estrategia A: Guardado por TABLA (Legacy)
**Cuándo**: Entidades NO en `ENTIDADES_POR_FILA` (ej: `pendientes_confirmacion`, historial sin realtime).

```
Usuario edita un proveedor en UI
        │
        ▼
gsSaveProveedores()
  1. Chequear permisos (¿puedeEditar()?)
  2. Chequear blindaje: ¿se cargó OK esta sesión? (state.cargado['proveedores'])
  3. Confirmar: ¿no va a quedar vacía? (guardarPermitido)
        │
        ├─ Guardar a Google Sheets (gsClearAndWrite)
        │  • BORRA todas las filas del proveedor en Sheets
        │  • INSERTA las nuevas filas (state.proveedores completo)
        │
        └─ Dual-write: sbEspejar('proveedores')
           • Llama sbReplaceTable (borra tenant_id + inserta nuevo)
           • Degrado suave: si falla, avisa pero NO rompe el guardado a Sheets
```

#### Estrategia B: Guardado por FILA (Moderno + Realtime)
**Cuándo**: Entidades EN `ENTIDADES_POR_FILA` (ej: `proveedores`, `empleados`, `historial`, `facturas`, `facturaPagos`).

```
Usuario edita un NOMBRE de proveedor
        │
        ▼
cambiarProveedor(id, { nombre: 'Nuevo Nombre' })
  1. Actualiza state.proveedores[] localmente (en memoria)
  2. Re-renderiza esa fila en la UI (instantáneo)
        │
        ├─ Guardar a Google Sheets (gsSaveProveedores)
        │  • SOLO DIFERENCIAS (diff): ¿qué cambió desde la última carga?
        │
        └─ sbGuardarFila('proveedores', proveedor)
           • sbUpsertRow(tabla='proveedores', idCol='id', { id: ..., nombre: ... })
           • Upsert en Supabase: (tenant_id, id) = PK
             → Si ya existe → UPDATE
             → Si no existe → INSERT
           • Realtime dispara: otros usuarios reciben el cambio por WebSocket
           • Llaman aplicarCambio() → state.proveedores se actualiza → UI se redibuja
           • TODO AUTOMÁTICO: el usuario ve TODOS los cambios sin apretar "Refrescar"
```

**Por qué el guardado por fila es mejor**:
- **Sin colisiones**: Si dos usuarios editan DIFERENTES proveedores al mismo tiempo, ambos guardados llegan. Con guardado por tabla, el segundo sobrescribía al primero.
- **Realtime**: El cambio viaja por WebSocket, no necesita polling.
- **UUIDs para asignaciones**: `costoAsignaciones` y `facturaPagos` usan UUIDs (no contadores), así dos usuarios nunca generan el MISMO ID.

---

## Modelo de Datos (Entidades Principales)

### Estructura Multi-Tenant
```
tenants (una fila = una empresa)
  ├─ id (UUID)
  ├─ nombre (ej: "Dehur Territorial")
  ├─ slug (ej: "dehur")
  ├─ mantenimiento (flag de banner)
  └─ updated_at (timestamp)

tenant_users (pertenencia + roles)
  ├─ tenant_id (FK → tenants)
  ├─ user_id (FK → auth.users)
  ├─ role (enum: 'admin', 'capturista', 'contabilidad', 'lector', 'aprobador', 'facturas', 'obra', 'solo_lectura')
  ├─ activo (boolean)
  └─ unique(tenant_id, user_id)
```

### Datos de Negocio
```
proveedores (entidades que reciben dinero)
  ├─ tenant_id, id (PK compuesta)
  ├─ nombre, rfc, banco, tipo_cuenta, cuenta, clabe
  ├─ categoria, subcategoria, proyectos (JSON array)
  ├─ activo, bloqueada_para_pago
  └─ aliases (JSON array de nombres alternativos)

empleados (nómina)
  ├─ tenant_id, id
  ├─ nombre, puesto, empresa, banco, cuenta, clabe, rfc
  ├─ activo

proyectos (construcciones)
  ├─ tenant_id, id (texto: ej: "paraiso", "entorno")
  ├─ nombre, empresa, cuenta, clabe, color
  ├─ activo, saldo (numeric), ultima_act_saldo (timestamp)
  └─ es_concentradora (boolean: si es cuenta receptora de traspasos)

cuentas_propias (cuentas bancarias de Dehur)
  ├─ tenant_id, cuenta_id
  ├─ nombre, banco, clabe, numero_cuenta
  ├─ proyecto (asignación), tipo (ej: 'General', 'Dispersión')
  ├─ saldo, activo

historial (REGISTRO INMUTABLE de TODOS los pagos realizados)
  ├─ tenant_id, id (texto: secuencial estable)
  ├─ proveedor_id, factura_id, fecha, nombre, banco, tipo
  ├─ concepto, importe, proyecto, cuenta_origen
  ├─ tipo_registro ('Pago', 'Traspaso', 'Movimiento Interno', etc.)
  ├─ partida, sub_partida (para costos fiscales)
  └─ readonly después de confirmación (no se borra, se marca; nunca se edita)
```

### Facturas (CFDI Fiscal Mexicano)
```
facturas (comprobantes de ingresos)
  ├─ tenant_id, factura_id (PK)
  ├─ numero_factura, razon_social, proveedor_id, nombre_proveedor
  ├─ fecha_factura, fecha_vencimiento, fecha_pago_total
  ├─ monto_total, monto_pagado, saldo_pendiente
  ├─ estatus_factura ('pendiente', 'parcialmente_pagada', 'pagada')
  ├─ proyecto, observaciones, uuid (para trazabilidad)
  ├─ --- CFDI Fiscal (campos de impuestos) ---
  ├─ subtotal, descuento, iva_trasladado (IVA a cargo del proveedor)
  ├─ retencion_iva, retencion_isr (retenciones)
  ├─ nc_subtotal, nc_iva (nota de crédito: si aplica)
  ├─ rfc_emisor, estado_sat, tipo_comprobante

factura_pagos (enlace N:N pago ↔ factura)
  ├─ tenant_id, factura_pago_id (UUID: anti-colisión)
  ├─ factura_id, pago_id (FK a historial.id)
  ├─ proveedor_id, monto_aplicado, fecha_pago
  └─ estatus, observaciones

costoAsignaciones (reparto de FACTURAS y PAGOS a unidades/casas)
  ├─ tenant_id, asignacion_id (UUID)
  ├─ pago_id (FK a historial.id) O factura_id (FK a facturas.factura_id)
  ├─ unidad_id, proyecto, metodo ('directo' o 'indiviso')
  ├─ monto_asignado, factor (%)
  ├─ partida_override, sub_partida_override (si difiere del historial)
  └─ fecha_asignacion
```

### Créditos y Pagarés
```
creditos (créditos puente)
  ├─ tenant_id, credito_id
  ├─ nombre, banco, tipo_credito, monto_autorizado, tasa_base
  ├─ proyecto, cuenta_pago, estatus ('Activo', 'Cancelado'), activo

pagares (documentos contra crédito)
  ├─ tenant_id, pagare_id
  ├─ credito_id, numero_pagare, monto, fecha_disposicion, fecha_vencimiento
  ├─ tasa, estatus

pagos_pagare (abonos a pagarés)
  ├─ tenant_id, pago_id
  ├─ pagare_id, credito_id, fecha_pago, monto_intereses
  ├─ concepto, estatus ('Pendiente', 'Realizado')
```

### Traspasos (Movimientos entre Cuentas)
```
traspasos (dinero de proyecto A → proyecto B)
  ├─ tenant_id, traspaso_id
  ├─ tipo, cuenta_origen_id, cuenta_origen_tipo, proyecto_origen
  ├─ cuenta_destino_id, cuenta_destino_tipo, proyecto_destino
  ├─ monto, fecha, concepto, referencia
  ├─ estatus ('pendiente', 'completado', 'cancelado')

movimientos_internos (tesorería: traslados entre cuentas propias)
  ├─ tenant_id, id
  ├─ fecha, tipo, origen, destino, monto, concepto, referencia
```

### Costos Fiscales por Unidad
```
unidades (casas, lotes, departamentos del proyecto)
  ├─ tenant_id, unidad_id
  ├─ proyecto, nombre, tipo, indiviso_pct (% de costo compartido)
  ├─ superficie_m2, estatus ('En obra', 'Terminada'), orden
  ├─ plano_x, plano_y, plano_w, plano_h (coordenadas en plano)
  ├─ fecha_termino, activo

presupuesto_unidad (presupuesto por unidad)
  ├─ tenant_id, presupuesto_id
  ├─ unidad_id, partida, sub_partida, monto_presupuestado, costo_inicial

partidas_catalogo (catálogo de partidas de Admin)
  ├─ tenant_id, partida_id
  ├─ partida (ej: 'CONSTRUCCION'), subpartidas (JSON array)
  ├─ orden, activa

partidas_obra (catálogo detallado de Obra, por proyecto)
  ├─ tenant_id, partida_obra_id
  ├─ nombre, proyecto ('' = aplica a todos), partidaAdmin, subPartidaAdmin
  ├─ orden, activa
```

### Cola de Confirmación
```
pendientes_confirmacion (pagos por confirmar antes de dispersión)
  ├─ tenant_id, id (UUID)
  ├─ proveedor_id, factura_id, nombre, cuenta, banco
  ├─ tipo, concepto, importe, proyecto, partida, cuenta_cargo
  ├─ fechaGen, confirmado, sub_partida, partidaObra
  ├─ asignaciones_planificadas (JSON: { a: [...], m: metodo })
```

### Diagrama de Relaciones (Textual)
```
tenant (1) ─┬─ N ─ tenant_users (many users per tenant)
            ├─ N ─ proveedores (suppliers to this tenant)
            ├─ N ─ empleados (employees to this tenant)
            ├─ N ─ proyectos (projects/constructions)
            │       ├─ N ─ unidades (houses in project)
            │       │       └─ N ─ costoAsignaciones (costs assigned to unit)
            │       └─ N ─ cuentas_propias (bank accounts for project)
            ├─ N ─ historial (payment history for this tenant)
            │       ├─ N ─ factura_pagos (link to invoices)
            │       └─ N ─ costoAsignaciones (reparto: which units get paid)
            ├─ N ─ facturas (invoices from suppliers)
            │       ├─ factura_pagos (many payments per invoice)
            │       └─ costoAsignaciones (if allocated to units)
            ├─ N ─ traspasos (transfers between projects)
            ├─ N ─ movimientos_internos (internal movements)
            ├─ N ─ creditos (credit lines)
            │       └─ N ─ pagares (promissory notes)
            │           └─ N ─ pagos_pagare (payments of notes)
            ├─ N ─ pendientes_confirmacion (queue to confirm payments)
            ├─ N ─ partidas_catalogo (admin chart of accounts)
            └─ N ─ partidas_obra (project-specific cost lines)

KEY CONSTRAINTS:
  • PK: (tenant_id, local_id) — tenant isolation + local ID stability
  • FK: References use (tenant_id, local_id) to avoid cross-tenant leaks
  • Immutability: historial.* never deleted, only archival marked
  • UUID: asignacion_id, factura_pago_id (anti-collision in concurrent edits)
```

---

## Seguridad: Multi-Tenant + Row Level Security (RLS) + Roles

### 1. Autenticación (Supabase Auth)
```
Flujo:
  1. Usuario tipea email + password en login
  2. Supabase.auth.signInWithPassword(email, password)
  3. Si OK → JWT con claims: user_id, email, ... (NO incluye tenant_id aquí)
  4. Frontend guarda el JWT en localStorage (persistSession: true)
  5. Todo request a Postgres incluye el JWT en el header
  6. Supabase valida el JWT y extrae auth.uid()
  
RLS Helpers (en Supabase):
  • current_tenant_id(): busca en tenant_users donde user_id=auth.uid() → devuelve tenant_id
  • current_user_role(): ídem pero devuelve role
  • is_admin(): devuelve true si role='admin'
```

### 2. Row Level Security (RLS)
```
Cada tabla de Supabase tiene policies. Ejemplo: proveedores

POLICY: "proveedores_select_tenant"
  SELECT: tenant_id = current_tenant_id()
  → Un usuario de Dehur solo ve filas donde tenant_id=Dehur.id
  
POLICY: "proveedores_insert_tenant"
  INSERT: tenant_id = current_tenant_id()
  → No se puede meter un proveedor a otro tenant

POLICY: "proveedores_update_tenant"
  UPDATE: tenant_id = current_tenant_id()
  → Solo puedes editar tus propios proveedores

POLICY: "proveedores_delete_tenant"
  DELETE: tenant_id = current_tenant_id()
  → Solo puedes borrar tus propios proveedores
```

**Por qué esto es seguro**:
- La BD **rechaza** automáticamente cualquier insert/update que intente meter un `tenant_id` distinto.
- Aunque la app tenga un bug (ej: hace INSERT malamente), Postgres lo bloquea.
- El JWT del usuario es imposible de falsificar (Supabase lo firma con su clave privada).

### 3. Realtime + Seguridad
```
Cuando el cliente abre un canal:
  1. Crea subscription: client.channel('rt-proveedores')
     .on('postgres_changes', { table: 'proveedores', filter: `tenant_id=eq.${tid}` })
     .subscribe()
  
  2. Supabase verifica:
     • ¿Tiene el cliente un JWT válido? (via setAuth(access_token))
     • ¿Ese user está en ese tenant? (query a tenant_users)
     • ¿Tiene acceso a la tabla? (RLS policy de SELECT)
  
  3. Solo después de validar → abre el canal
  
  4. Cambios que llegan: filtrados por tenant_id ANTES de enviar al cliente
     (El filter= en la subscription refuerza esto en el servidor)
```

### 4. Roles y Control de Acceso
```
Rol               Puede                                      No puede
────────────────────────────────────────────────────────────────────────
admin             • Capturar + Editar + Borrar TODO         (ninguna restricción)
                  • Confirmar pagos
                  • Crear/editar facturas (+ Gonzalo)
                  • Gestionar usuarios
                  • Respaldar a Sheets
                  • Prende/apaga aviso mantenimiento

capturista        • Capturar pagos                          • Confirmar pagos
                  • Editar datos (proveedores, etc.)        • Borrar facturas
                  • Linkear pagos a facturas                • Crear usuarios
                  • Ver costos fiscales

facturas          • Crear/editar/borrar facturas            • Capturar pagos (no ve input)
 (Gonzalo)        • Linkear pagos a facturas                • Confirmar pagos
                  • Ver historial

contabilidad      • VER TODO (historial, facturas, etc.)    • Nada (solo lectura)
 (Ericka)         • Hacer reportes

aprobador         • Ver TODO                                • Capturar
                  • Confirmar pagos                         • Editar

lector            • Ver TODO (historial, facturas, etc.)    • Nada (solo lectura)
 (auditoría)

obra              • Ver proyectos, unidades, costos          • Capturar pagos
                  • Crear/editar partidas de obra            • Ver facturas (excepto CFDI)

solo_lectura      • Ver TODO                                • NADA (100% readonly)
 (default)        • (default si no carga el rol)            • Puerta de atrás de seguridad
```

**Gating en Cliente**:
```javascript
// En state.js
export function puedeEditar() {
  const r = rol();
  return r === 'admin' || r === 'capturista';
}

export function puedeFacturas() {
  const r = rol();
  return r === 'admin' || r === 'capturista' || r === 'facturas';
}

// En los módulos
if (!puedeEditar()) return; // Silenciosamente ignora si no tiene rol
```

**Gating en Servidor (Supabase RLS)**:
```sql
-- Admin-only: editar tenants
CREATE POLICY "tenants_update_admin"
  ON tenants FOR UPDATE
  USING (id = current_tenant_id() AND is_admin());

-- Capturista: insertar en proveedores, historial
CREATE POLICY "proveedores_insert_tenant"
  ON proveedores FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
  -- (El control fino por rol NO está en RLS; va en la app)
```

**Defensa en Profundidad**:
1. **Cliente**: Botones grayed-out si no tienes rol (UX).
2. **API**: Roles y `guardarPermitido()` cheques ANTES de enviar a Supabase.
3. **BD**: RLS bloquea automáticamente cualquier INSERT/UPDATE/DELETE inválido.

---

## Persistencia: Dual-Write y Fallback

### Fase 1 (Legacy): Google Sheets como Fuente
```
Configuración: FUENTE_LECTURA = 'sheets'
                MODO_GUARDADO = 'tabla'
                REALTIME_ON = false

Lectura:
  gsLoadAll() → lee Google Sheets
  
Guardado:
  gsSaveX() → borra + inserta a Sheets (toda la entidad)
  
Fallo:
  Si Sheets cae → app sin datos (fallback manual)
```

### Fase 2 (Hoy): Supabase como Fuente de Verdad
```
Configuración: FUENTE_LECTURA = 'supabase'
                MODO_GUARDADO = 'tabla'
                REALTIME_ON = false (opcional)

Lectura:
  sbLoadAll() → lee Supabase
  Si Supabase falla → fallback automático a gsLoadAll() (Sheets)
  
Guardado (dual-write):
  1. gsSaveX() → Sheets (fuente de verdad legacy)
  2. sbEspejar() → Supabase (espejo, degradación suave)
  
Resiliencia:
  • Si falla Supabase: los datos siguen guardados en Sheets, app sigue funcionando
  • Si falla Sheets: basta con reconectar Google (todo está en Supabase)
```

### Fase 3 (Moderno): Guardado por Fila + Tiempo Real
```
Configuración: FUENTE_LECTURA = 'supabase'
                MODO_GUARDADO = 'fila'
                REALTIME_ON = true
                ENTIDADES_POR_FILA = { proveedores, empleados, historial, ... }
                ENTIDADES_REALTIME = { proveedores, empleados, ..., pendientes_confirmacion }

Lectura:
  sbLoadAll() → Supabase (con fallback a Sheets)
  
Guardado (por fila + tiempo real):
  1. gsSaveX() → Sheets (por las filas que cambiaron: diff)
  2. sbGuardarFila() → Supabase (INSERT/UPDATE en (tenant_id, id))
  3. Realtime activa → otros usuarios ven el cambio por WebSocket
  
Ventajas:
  • Sin sobrescrituras: dos usuarios editando distintos items no se pisan
  • Realtime: todos ven los cambios sin apretar "Refrescar"
  • Reversible: si algo sale mal, apagar y volver a Fase 2 (cambiar flags y push)
```

### Blindajes contra Pérdida de Datos

#### 1. Banner de Carga
```javascript
// Muestra un banner si alguna entidad no cargó OK
actualizarBannerCarga();
// "⚠ No se cargaron correctamente: Proveedores, Historial..."

// Boton Guardar está DESHABILITADO para esas entidades
function guardarPermitido(entidad, arr) {
  if (state.cargado[entidad] !== true) {
    notify('Guardado bloqueado: "X" no se cargó correctamente...');
    return false;
  }
  // ... confirmación extra si la tabla quedaría vacía
}
```

**Impacto**: Si la app carga pero Sheets + Supabase fallan a mitad, el usuario VE el banner y NO puede guardar accidentalmente (pisando los datos cargados).

#### 2. Confirmación si la Tabla Quedaría Vacía
```javascript
if (!arr || arr.length === 0) {
  return confirm(`Vas a guardar "X" SIN NINGÚN registro.\n¿Continuar?`);
}
```

**Impacto**: Evita un `gsClearAndWrite([])` accidental que borra todo el Sheet.

#### 3. IDs Estables + Backfill
```javascript
// historial.id: secuencial estable dentro de la sesión
// Si no tienen ID al cargar, se les asigna uno y se guarda UNA sola vez
function ensureHistorialIds() {
  let changed = false;
  state.historial.forEach(h => {
    if (!h.id) { h.id = String(state.histSeq++); changed = true; }
  });
  return changed; // Si true, el caller hace gsSaveHistorial()
}
```

**Impacto**: Si un registro entra al sistema sin ID (error en el Sheet), se lo fija. Los costos fiscales pueden referenciar el ID con confianza.

#### 4. Detección de Asignaciones Huérfanas
```javascript
// Tras cargar, chequea si algún costoAsignaciones apunta a un pago que NO existe
const huerfanas = state.costoAsignaciones.filter(a => 
  a.factura_id ? (factOk && !idsFact.has(String(a.factura_id)))
               : (histOk && !idsHist.has(String(a.pago_id)))
);
if (huerfanas.length) {
  notify(`⚠ ${huerfanas.length} asignación(es) parecen huérfanas...`);
  // NO borra nada automáticamente: requiere click del usuario en "Limpiar huérfanas"
}
```

**Impacto**: Aviso de inconsistencia SIN borrar datos. El admin decide si limpiar.

#### 5. UUIDs para IDs Únicos Globales
```javascript
// costoAsignaciones.asignacion_id y facturaPagos.factura_pago_id usan UUID
export function nuevoAsignacionId() {
  try { return crypto.randomUUID(); }  // Browser native
  catch (_) {
    // Fallback: sal por sesión + secuencia monotona
    if (!_asigSalt) _asigSalt = Math.random().toString(36).slice(2) + Date.now();
    return 'a-' + _asigSalt + '-' + (_asigSeq++).toString(36);
  }
}
```

**Impacto**: Si dos navegadores/usuarios asignan un pago al mismo time, generan IDs distintos (no colisionan). El upsert de Supabase los guarda a ambos.

---

## Operación: Deploy y Mantenimiento

### 1. GitHub Pages (Frontend)
```
Estructura:
  • Código fuente en src/
  • Compilado: index.html + CSS + JS (módulos ES)
  • Publicado en: gh-pages branch (automático o manual)

Deploy:
  1. git add .
  2. git commit -m "mensaje"
  3. git push origin main
     (o: npm run deploy si hay script)
  4. GitHub Pages reconstruye el site en ~2-5 min
  5. Usuario hace Ctrl+Shift+R (hard refresh) para ver cambios
     (caches HTTP pueden retardar, de ahí el banner de versión)
```

### 2. Supabase SQL (Backend)
```
Cambios de schema:
  1. Editar archivo en supabase/schema/NN_*.sql
  2. Abrir Supabase Dashboard → SQL Editor
  3. Copiar el contenido, pegar, Click "Run"
  4. Si es idempotente (create if not exists, drop policy if exists):
     → Puedes correr varias veces sin romper nada
  5. Git commit el SQL para versionado

Orden crítico:
  • 01_tenants_and_roles.sql (cimientos)
  • 02_seed_admin_user.sql (usuario)
  • 03_grants_authenticated.sql (permisos)
  • 04_seed_team_users.sql (equipo)
  • 05-07_datos (tablas de datos)
  • 08_pendientes.sql (cola)
  • 09_mantenimiento.sql (flag de aviso)
  • 10-17_realtime (WebSocket)
  • 18-19_replica_identity (arregla UPDATE/DELETE en realtime)
```

### 3. Versionado y Banner de Actualización
```javascript
// app-version (en código)
export const APP_VERSION = '2026.07.06-151624';

// /version.json (estático, mismo valor)
{ "v": "2026.07.06-151624" }

// Al arrancar (8s después, cada 5 min, o al volver a la pestaña)
hayVersionNueva() → si version.json.v !== APP_VERSION
  → mostrar banner "🔄 Hay una versión nueva"
     Botón "Actualizar" → location.reload()
     Botón "Después" → descartar
```

**Impacto**: Sin Ctrl+Shift+R. El banner avisa y deja que el usuario elija cuándo recargar.

### 4. Aviso de Mantenimiento (Self-Serve por Admin)
```javascript
// En Supabase, tabla tenants:
// ALTER TABLE tenants ADD mantenimiento boolean DEFAULT false;
// ALTER TABLE tenants ADD mantenimiento_msg text DEFAULT '';

// Admin puede prender/apagar:
await setMantenimiento(tenantId, true, '⚠️ Mantenimiento: volvemos en 2h');

// Todos los usuarios ven el banner automáticamente:
// (se chequea al cargar + cada 5 min en realtime)
```

**Impacto**: Comunicar downtime SIN tener que hacer un deploy.

---

## Reversibilidad: Cómo Deshacer Cambios

### Escenario 1: Realtime Causó un Problema
```
Si REALTIME_ON = true causa issues:

1. Editar google-sync.js:
   export const REALTIME_ON = false;  // ← cambiar a false
   
2. git commit + push
3. Usuarios hacen hard-refresh (Ctrl+Shift+R)
4. Ya no se abre canales WebSocket
5. App sigue funcionando, pero sin tiempo real (como antes)

Costo: 2 líneas cambiadas + 1 push. Reversible en 5 min.
```

### Escenario 2: Guardado por Fila Rompió Algo
```
Si MODO_GUARDADO = 'fila' causa issues:

1. Editar google-sync.js:
   export const MODO_GUARDADO = 'tabla';  // ← volver a 'tabla'
   
2. git commit + push
3. Usuarios hacen hard-refresh
4. Ya no se envía sbGuardarFila(); se vuelve a gsSaveX() (tabla completa)

Costo: 1 línea + 1 push. Reversible en 5 min.
```

### Escenario 3: Revertir Lectura a Sheets
```
Si FUENTE_LECTURA = 'supabase' causa issues:

1. Editar google-sync.js:
   export const FUENTE_LECTURA = 'sheets';  // ← volver a 'sheets'
   
2. git commit + push
3. Usuarios hacen hard-refresh
4. Ya no se intenta sbLoadAll(); se va directo a gsLoadAll() (Sheets)

Costo: 1 línea + 1 push. TODOS los datos siguen en Sheets (respaldo vivo).
```

---

## Resumen de Ventajas del Diseño

| Aspecto | Ventaja |
|---------|---------|
| **Multi-tenant** | Datos de Dehur nunca se mezclan con otros clientes futuros. RLS lo garantiza en la BD. |
| **Dual-write** | Si un backend falla (Sheets o Supabase), el otro lo respaldo. |
| **Guardado por fila** | Dos usuarios editan items distintos sin pisarse. UUIDs evitan colisiones de IDs. |
| **Realtime** | Gerente ve cambios sin apretar "Refrescar". Todos ven la MISMA versión del dato. |
| **Blindajes** | Banners, confirmaciones, backfill de IDs, detección de huérfanas. Nunca se borra accidentalmente. |
| **Reversibilidad** | Si algo sale mal, 1 línea + 1 push vuelve al estado anterior en 5 min. |
| **UX Fluido** | La app maneja pagos/facturas/costos sin tener que explicar al usuario dónde se guardan. |
| **Auditoría** | historial es INMUTABLE: todo pago queda registrado; nunca se borra. |
| **Roles Granulares** | Capturista no puede confirmar; facturas (Gonzalo) no captura; contabilidad solo ve. |

---

## El Problema que Resuelve

**Sin este subsistema**, la app sería caótica:
- Un pago se guarda en Sheets, otro en local, y el tercero se pierde.
- Dos usuarios guardan al mismo tiempo → el segundo sobrescribe al primero (pago perdido).
- Un proveedor ve datos de otro (sin aislamiento multi-tenant).
- Cada usuario tiene que apretar "Refrescar" cada 30s para ver qué pasó.
- No hay auditoría: se borra accidentalmente y no hay historia.

**Con este subsistema**:
- Supabase es la fuente de verdad; Sheets es el respaldo.
- Guardado por fila + UUIDs → nunca se pisan entre usuarios.
- RLS + Roles → datos aislados por empresa y acción.
- Realtime → todos ven en vivo.
- Blindajes + historial inmutable → imposible perder un pago.

Esto es lo que hace que **el contador, el capturista, el gerente y el admin puedan trabajar a la vez sin romper nada**.

---

## Diagrama: Flujo de Datos Completo

```
         ┌─ USUARIO ──────────────────────┐
         │                                │
    ┌────▼─────┐                   ┌─────▼────┐
    │  LOGIN   │                   │  LOGOUT  │
    └────┬─────┘                   └─────▲────┘
         │ (email + password)             │
         │                                │
    ┌────▼──────────────────────────────┐│
    │ Supabase Auth                      ││
    │ • signInWithPassword()             ││
    │ • JWT → localStorage               ││
    │ • onAuthStateChange                ││
    └────┬──────────────────────────────┘│
         │                                │
    ┌────▼──────────────────┐             │
    │ fetchCurrentTenantInfo│             │
    │ • tenant_users query  │             │
    │ • tenants query       │             │
    │ • state.session =     │             │
    │   { userId, role,     │             │
    │     tenantId }        │             │
    └────┬──────────────────┘             │
         │                                │
    ┌────▼────────────┐                   │
    │ BOOTSTRAP       │                   │
    │ Cargar datos    │                   │
    │ (fila 1, 2)     │                   │
    └────┬────────────┘                   │
         │                                │
    ┌────▼──────────────────────────────┐│
    │ ¿FUENTE_LECTURA?                  ││
    │ ├─ 'supabase' → sbLoadAll()       ││
    │ │  (fallback: gsLoadAll)          ││
    │ └─ 'sheets' → gsLoadAll()         ││
    └────┬──────────────────────────────┘│
         │                                │
    ┌────▼───────────────────────────────┐
    │ state.* poblado (proveedores,       │
    │ empleados, historial, facturas, etc.)
    │ + state.cargado (flags de éxito)    │
    └────┬───────────────────────────────┘
         │
    ┌────▼──────────┐
    │ ¿REALTIME_ON? │
    ├─ true → iniciarRealtime()
    │  (abre WebSockets a Supabase)
    └─ false → skip
         │
    ┌────▼──────────────────────────────┐
    │ UI RENDERIZA (user ve las pantallas)
    │ • Proveedores, Facturas, etc.      │
    │ • Botones según rol                │
    │ • Badges de saldos                 │
    └────┬──────────────────────────────┘
         │
    ┌────▼───────────────────────────────┐
    │ USUARIO EDITA                       │
    │ • Captura pago                      │
    │ • Linkea factura                    │
    │ • Crea proveedor                    │
    │ • etc.                              │
    └────┬───────────────────────────────┘
         │
    ┌────▼──────────────────────────────┐
    │ gsSaveX / sbGuardarFila             │
    │ 1. Chequear rol                    │
    │ 2. Chequear blindajes              │
    │ 3. Guardar a Sheets                │
    │ 4. Guardar a Supabase (dual-write) │
    │ 5. Si realtime → otros usuarios    │
    │    ven el cambio automáticamente   │
    └────┬──────────────────────────────┘
         │
    ┌────▼───────────────────────────────┐
    │ REALTIME (si activo)                │
    │ • Supabase envía WebSocket          │
    │ • aplicarCambio()                   │
    │ • state.* se actualiza              │
    │ • def.rerender() redibuja UI        │
    │ • Otros usuarios ven el cambio      │
    └────┬───────────────────────────────┘
         │
    ┌────▼────────────────────────────┐
    │ TODO SINCRONIZADO EN VIVO        │
    │ Contador, capturista, admin      │
    │ todos ven lo MISMO sin            │
    │ apretar "Refrescar"              │
    └────────────────────────────────┘
```

---

## Conclusión

Este subsistema es el **backbone invisible** que hace que el sistema sea **resiliente, seguro, escalable y auditoria**. Sin él, sería un script que pierde datos. Con él, es una plataforma en la que **múltiples usuarios pueden trabajar simultáneamente sin romper nada**, los datos están **protegidos por multi-tenant**, y cada usuario ve su **información sensible** sin contaminar a otros.

La arquitectura es **graduable**: empezó en Sheets (Fase 1), migró a Supabase (Fase 2), y ahora está entrando a Tiempo Real (Fase 3). En cada fase, es **reversible**: si algo sale mal, se apaga en el código y en 1 push vuelve atrás.

**Eso es seguridad + operación de la que depende el negocio.**

### Conceptos clave de esta seccion
- Multi-tenant aislado por RLS (Row Level Security) en Postgres
- Supabase es fuente de verdad, Google Sheets es respaldo dual-write
- Guardado por FILA con UUIDs para evitar colisiones en edición simultánea
- Realtime (WebSocket) sincroniza cambios entre usuarios sin polling
- 8 roles con control granular (admin, capturista, facturas, contabilidad, aprobador, obra, lector, solo_lectura)
- Blindajes contra pérdida de datos: banner de carga, confirmaciones, backfill de IDs, detección de huérfanas
- Reversibilidad: cambiar FUENTE_LECTURA, MODO_GUARDADO o REALTIME_ON en 1 línea
- Historial inmutable: todos los pagos registrados, nunca se borran
- PK compuesta (tenant_id, local_id) garantiza aislamiento + estabilidad de IDs
- Deploy: GitHub Pages (frontend) + SQL manual en Supabase (backend) + banner de versión para evitar caché

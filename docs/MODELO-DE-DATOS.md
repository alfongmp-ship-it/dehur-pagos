# Modelo de datos y lógica de DEHUR-PAGOS

> Documento de auditoría previo a la migración Google Sheets → Supabase (Etapa B).
> Escrito en español llano. Su propósito es dejar por escrito **cómo funcionan hoy los datos
> y la lógica** para migrar con seguridad. Nada de esto cambia con la migración: Supabase será
> un espejo que guarda lo mismo; toda la lógica sigue viviendo en el código JavaScript.

---

## 1. Cómo guarda y carga datos la app HOY

- Todo vive en un **Google Sheet de 20 pestañas** (una pestaña por tipo de dato).
- Al abrir la app, `gsLoadAll()` ([src/services/google-sync.js](../src/services/google-sync.js))
  **lee las 20 pestañas** y llena la memoria de la app (`state`).
- Cada vez que guardas algo, el módulo correspondiente llama a una función `gsSaveX()` que
  **escribe esa pestaña** (la mayoría reescribe la pestaña completa; algunas solo agregan filas).
- **No hay guardado automático periódico.** Se guarda justo después de cada acción tuya, y se
  recarga manualmente con el botón "🔄 Recargar".

**Mecanismos de seguridad que ya existen (hay que respetarlos en la migración):**

- `guardarPermitido()`: bloquea guardar una pestaña que no se cargó bien esta sesión, o avisa si
  vas a dejarla vacía. Evita borrar datos por accidente.
- **Anti-sobrescritura del historial**: antes de reescribir el historial, lee lo que hay en Sheets;
  si el Sheets tiene muchas más filas que la app, te pide confirmación (alguien editó el Sheet aparte).
- **Auto-limpieza de huérfanas**: al cargar, si un pago fue borrado pero quedaron asignaciones de
  costo apuntando a él, las elimina solas.
- `ensureHistorialIds()`: asigna un ID estable a cada pago que no tenga, sin pisar los existentes.

---

## 2. Las 21 entidades: cuáles se migran y cuáles no

Clasificación clave para la migración:

| Entidad | Pestaña | Tipo | ¿Migrar? |
|---|---|---|---|
| Proveedores | `proveedores` | **Fuente** | Sí |
| Empleados / Nómina | `empleados` | **Fuente** | Sí |
| Historial de pagos | `historial_pagos` | **Fuente** | Sí (es la base de todo) |
| Proyectos (cuentas BBVA) | `proyectos` | **Fuente** | Sí |
| Cuentas propias | `cuentas_propias` | **Fuente** | Sí |
| Facturas | `facturas` | **Fuente** | Sí |
| Pagos a facturas | `factura_pagos` | **Fuente** | Sí |
| Traspasos | `traspasos` | **Fuente** | Sí |
| Movimientos internos | `movimientos_internos` | **Fuente** | Sí |
| Créditos | `creditos` | **Fuente** | Sí |
| Pagarés | `pagares` | **Fuente** | Sí |
| Pagos de pagaré | `pagos_pagare` | **Fuente** | Sí |
| Unidades (costos fiscales) | `unidades` | **Fuente** | Sí |
| Presupuesto por unidad | `presupuesto_unidad` | **Fuente** | Sí |
| Partidas de obra | `partidas_obra` | **Fuente** | Sí |
| Asignaciones de costo | `costo_asignaciones` | **Derivada** | Sí (no perder tu trabajo) |
| Catálogo de partidas | `partidas_catalogo` | **Derivada** | Sí (se auto-puebla si falta) |
| Historial de saldos | `historial_saldos` | **Derivada** | Sí (es bitácora de respaldo) |
| Alias de proveedores | `aliases` | **Derivada** | Sí |
| Cola de pagos | (en memoria) | **Transitoria** | No (temporal) |
| Pendientes de confirmación | `pendientes_confirmacion` | **Transitoria** | Se mantiene mientras no confirmas |

- **Fuente** = la capturas tú; no se puede reconstruir → se migra siempre.
- **Derivada** = se calcula o se auto-genera a partir de las fuentes → se migra para no perder
  trabajo, pero en teoría se podría reconstruir.
- **Transitoria** = pasos intermedios de un flujo; no son estado permanente.

---

## 3. Campos de cada entidad (resumen)

> Detalle pensado para construir las tablas de Postgres. Los tipos son aproximados.

**Proveedores** — `id` (entero, generado por la app), nombre, rfc, banco, tipo_cuenta
(CLABE / Cuenta BBVA / Tarjeta / Cuenta), cuenta, clabe, categoria, subcategoria,
proyectos (lista), activo, bloqueada_para_pago, aliases (lista).

**Empleados** — `id` (entero), nombre, puesto, empresa, banco, tipo_cuenta, cuenta, clabe, rfc, activo.

**Historial de pagos** — `id` (texto secuencial estable), fecha, proveedor_id, factura_id, nombre
(beneficiario), banco, tipo, concepto, importe, proyecto, cuenta_origen, cuenta_destino,
tipo_registro (Pago / Crédito / Traspaso / Interno), partida, sub_partida.

**Proyectos** — `id` (texto: paraiso/entorno/dt…), nombre, empresa, cuenta, clabe, color, activo,
**saldo**, **ultima_act_saldo** (fecha), es_concentradora.

**Cuentas propias** — `cuenta_id` (entero), nombre, banco, clabe, numero_cuenta, proyecto, tipo,
**saldo**, **ultima_actualizacion** (fecha), activo.

**Facturas** — `factura_id` (entero), numero_factura, razon_social, proveedor_id, nombre_proveedor,
fecha_factura, fecha_vencimiento, fecha_pago_total, monto_total, monto_pagado, saldo_pendiente,
estatus_factura (pendiente/parcial/pagada/cancelada), proyecto, observaciones, activo, uuid.

**Pagos a facturas** — `factura_pago_id`, factura_id, pago_id, proveedor_id, monto_aplicado,
fecha_pago, estatus, observaciones.

**Traspasos** — `traspaso_id`, tipo (Préstamo/Traspaso/Aportación), cuenta_origen_id,
cuenta_origen_tipo (proyecto/propia), cuenta_origen_nombre, proyecto_origen, cuenta_destino_id,
cuenta_destino_tipo, cuenta_destino_nombre, proyecto_destino, monto, fecha, concepto, partida
(solo Aportación), referencia, estatus, fecha_registro.

**Movimientos internos** — `id`, fecha, tipo, origen, destino, monto, concepto, referencia.

**Créditos** — `credito_id`, nombre, banco, tipo_credito, monto_autorizado, tasa_base, proyecto,
cuenta_pago, estatus, activo.

**Pagarés** — `pagare_id`, credito_id, numero_pagare, monto, fecha_disposicion, fecha_vencimiento,
tasa, estatus, activo.

**Pagos de pagaré** — `pago_id`, pagare_id, credito_id, fecha_pago, monto_intereses, concepto,
estatus, fecha_real_pago.

**Unidades** — `unidad_id`, proyecto, nombre, tipo, indiviso_pct, superficie_m2, estatus, orden,
activo, plano_x, plano_y, plano_w, plano_h.

**Presupuesto por unidad** — `presupuesto_id`, unidad_id, partida, sub_partida,
monto_presupuestado, costo_inicial, notas.

**Asignaciones de costo** — `asignacion_id`, pago_id, unidad_id, proyecto, metodo, monto_asignado,
factor, fecha_asignacion, partida_override.

**Catálogo de partidas** — `partida_id`, partida, subpartidas (lista), orden, activa.

**Partidas de obra** — `partida_obra_id`, nombre, proyecto, partida_admin, sub_partida_admin,
orden, activa.

**Historial de saldos** — fecha, cuenta_id, cuenta_nombre, cuenta_tipo, saldo, saldo_total.

---

## 4. Cómo se relacionan (las "llaves" entre tablas)

```
historial.proveedor_id      → proveedores.id
historial.id                → costo_asignaciones.pago_id   (qué pago se asignó a una unidad)
historial.id                → factura_pagos.pago_id        (qué pago liquidó una factura)
factura_pagos.factura_id    → facturas.factura_id
facturas.proveedor_id       → proveedores.id
traspasos.cuenta_origen/destino → proyectos.id  o  cuentas_propias.cuenta_id
pagares.credito_id          → creditos.credito_id
pagos_pagare.pagare_id      → pagares.pagare_id
unidades.proyecto           → proyectos.nombre
presupuesto_unidad.unidad_id → unidades.unidad_id
costo_asignaciones.unidad_id → unidades.unidad_id
```

> **Ojo:** muchas relaciones son **por nombre** (proyecto, cuenta), no por número de ID. Por eso
> en la migración los IDs y los nombres deben quedar **idénticos** a los de hoy, o se rompen estos
> enlaces.

---

## 5. Los flujos importantes (efectos en cadena)

Aquí está lo más delicado: **una sola acción tuya toca varias pestañas a la vez**. Migrar mal
cualquiera de estos pasos descuadra saldos o deja datos colgando.

### 5.1 Pago por cola (el flujo principal de dispersión)

1. **Agregas a la cola** un pago (proveedor, importe, proyecto, partida…). Vive solo en memoria.
2. **Generas el archivo**: la cola pasa a "pendientes de confirmación" y se guarda en
   `pendientes_confirmacion`. La cola se vacía.
3. **Confirmas los pagos**. Aquí ocurre TODO esto de un jalón:
   - Se **inserta** cada pago en `historial_pagos` (con su ID estable).
   - Se crean **asignaciones de costo** si el pago traía reparto a unidades (o por auto-indiviso).
   - Si el pago liquidaba una **factura**, se actualiza la factura (monto pagado, saldo, estatus)
     y se registra en `factura_pagos`.
   - Se **descuenta el saldo** de la cuenta de origen (proyecto o cuenta propia).
   - Se **vacían** los pendientes confirmados.
   - En total se guardan hasta **7 pestañas**: historial_pagos, costo_asignaciones, facturas,
     factura_pagos, proyectos, cuentas_propias, pendientes_confirmacion.

### 5.2 Pago directo (cuentas que no son BBVA)

No pasa por la cola: crea el registro en `historial_pagos` de inmediato (agrega una sola fila),
aplica auto-indiviso si toca, y **descuenta el saldo** de la cuenta de origen al instante.

### 5.3 Traspaso (3 tipos, se comportan distinto)

- Siempre: guarda en `traspasos` y, si está "completado", **ajusta saldos** (origen −monto,
  destino +monto).
- **Aportación** → además **inserta una fila en `historial_pagos`** (cuenta como costo).
- **Préstamo / Traspaso** → además crean fila en `movimientos_internos` (NO es costo, solo registro).

### 5.4 Pagaré: marcar un pago de intereses como "pagado"

Inserta el pago en `historial_pagos` (tipo Crédito) y **descuenta el saldo** de la cuenta de pago
del crédito.

### 5.5 Actualizar el saldo de una cuenta a mano

Cambia el `saldo` y la fecha de actualización de la cuenta, y **agrega una foto** a
`historial_saldos` (incluye el total global de todas las cuentas en ese momento).

### 5.6 Flujo de salida

Es **solo lectura / reportes**: arma una tabla cruzada (cuenta × proyecto) leyendo del historial y
de movimientos internos. No modifica nada.

---

## 6. La regla de oro de los SALDOS (lo más importante para no romper nada)

- Los saldos **NO se recalculan** sumando el historial. Se guardan tal cual y la app los va
  **descontando o sumando a mano** en cada acción:
  - Pago → `saldo -= importe`
  - Borrar un pago → `saldo += importe` (lo revierte)
  - Traspaso → origen `-monto`, destino `+monto`
- Hay una validación de fechas: la app **solo ajusta el saldo si el pago es de hoy o más reciente
  que la última vez que actualizaste ese saldo a mano**. Así no descuenta sobre un saldo viejo.

> **Por esto Supabase NO debe tener lógica propia de saldos.** Si Postgres también descontara, se
> descontaría **doble**. Supabase solo guarda el número de saldo que la app le manda.

---

## 7. IDs: cómo se generan hoy

- La app genera los IDs en memoria: la mayoría como **el mayor existente + 1**
  (`nextId`, `nextUnidadId`, `nextPresupuestoId`, `nextAsignacionId`); el historial usa una
  secuencia de texto (`histSeq`) vía `ensureHistorialIds()`.
- Cada vez que carga datos, **recalibra** esos contadores leyendo el máximo actual, para que los
  IDs nuevos no choquen con los viejos.

> **En la migración:** se conservan los IDs **idénticos**. NO se usan los IDs automáticos de
> Postgres, porque las tablas se enlazan entre sí justo por esos valores.

---

## 8. Cómo borras/corriges datos (hoy y después)

Hoy a veces editas el Google Sheet directo para dos cosas. Así quedan cubiertas:

- **Meter un mes completo de golpe (backfill):** ya existe el **importador de Excel del Historial**
  (plantilla, arrastrar archivo, vista previa, detección de duplicados). Importa pagos históricos
  **sin descontar saldos** (correcto: son movimientos que ya pasaron). Reemplaza el pegar filas en
  el Sheet.
- **Borrar pagos malos/duplicados:** hoy la app borra **de uno en uno** (y revierte el saldo solo).
  Se le agregará **borrado en bloque** (seleccionar varios y eliminar de un jalón).
- **Mientras migramos (Fase 1):** puedes seguir editando el Sheet a mano; un botón
  **"Re-sincronizar a Supabase"** pone al día la copia de Supabase tras tu edición.

---

## 9. Resumen para la migración

1. Supabase es un **espejo "tonto"**: guarda lo mismo que el Sheet, con los **mismos IDs**. La
   lógica (saldos, asignaciones, orden) se queda 100% en el código.
2. **Fase 1:** la app sigue **leyendo del Sheet** y además **escribe a Supabase** (espejo). Tus
   correcciones manuales siguen valiendo.
3. **Fase 2:** cuando todo esté espejado y verificado, y la app tenga el borrado en bloque, se
   cambia la lectura a Supabase. Sheets queda como respaldo. Reversible al instante.
4. Se hace **entidad por entidad**, empezando por **proveedores** como prueba.

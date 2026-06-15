-- ============================================================================
-- Bloque 18: Tiempo Real (Fase 3) — REPLICA IDENTITY FULL (arreglo de EDICIONES)
-- ============================================================================
-- Problema: las EDICIONES (UPDATE) y BORRADOS (DELETE) no se reflejaban en otras
-- pestañas, aunque las cosas NUEVAS (INSERT) sí. Causa: nuestras suscripciones de
-- Realtime usan un filtro por tenant (filter: tenant_id=eq.<tid>). Por defecto,
-- Postgres solo manda las columnas de la PK en el evento de UPDATE/DELETE, así que
-- Supabase no puede evaluar el filtro y NO entrega esos eventos. (Los INSERT sí,
-- porque el registro nuevo viaja completo.)
--
-- Arreglo (estándar Supabase): poner REPLICA IDENTITY FULL en las tablas de
-- realtime, para que el evento lleve la fila completa y el filtro funcione.
--
-- REPLICA IDENTITY FULL es idempotente (volver a setearlo es no-op).
-- Requiere haber corrido antes los bloques 10–17 (que agregan las tablas a la
-- publicación supabase_realtime).
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'proveedores', 'empleados', 'partidas_catalogo', 'partidas_obra',
    'creditos', 'pagares', 'unidades', 'facturas', 'factura_pagos',
    'traspasos', 'movimientos_internos', 'pendientes_confirmacion',
    'proyectos', 'cuentas_propias', 'pagos_pagare', 'historial'
  ]
  loop
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- ---------- Verificación -----------------------------------------------------
-- Las tablas con relreplident = 'f' tienen REPLICA IDENTITY FULL:
-- select relname, relreplident from pg_class
--   where relname in ('historial','proveedores','proyectos','cuentas_propias')
--   order by relname;

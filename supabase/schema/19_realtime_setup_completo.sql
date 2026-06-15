-- ============================================================================
-- Bloque 19: SETUP COMPLETO de Tiempo Real (Fase 3) — TODO EN UNO
-- ============================================================================
-- Este ÚNICO bloque hace todo el setup de tiempo real de golpe, para las 16
-- tablas de Fase 3. Reemplaza correr los bloques 10–18 uno por uno: corre SOLO
-- este y queda todo listo.
--
-- Para cada tabla hace 2 cosas:
--   1) La agrega a la publicación `supabase_realtime` → Supabase empieza a emitir
--      los cambios (insert/update/delete) de esa tabla.
--   2) Le pone REPLICA IDENTITY FULL → el evento lleva la fila completa, para que
--      las EDICIONES y BORRADOS también se entreguen (no solo las altas), aun con
--      el filtro por tenant en la suscripción.
--
-- IDEMPOTENTE: puedes correrlo las veces que quieras, no rompe nada.
-- (El otro requisito, autenticar la conexión de realtime con setAuth, ya está en
--  el código del front — commit 415c2b8.)
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
    -- 1) Agregar a la publicación si no está ya
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    -- 2) Replica identity full (para que UPDATE/DELETE también se entreguen)
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- ---------- Verificación -----------------------------------------------------
-- Debe devolver 16 filas (las 16 tablas publicando):
-- select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and schemaname = 'public'
--   order by tablename;

-- ============================================================================
-- Bloque 31: TIEMPO REAL para ESTRATEGIA (config + marcas de unidad)
-- ============================================================================
-- Habilita realtime de las 2 tablas de Estrategia, igual que el 29 hizo con las
-- de Ingresos. Para cada tabla:
--   1) La agrega a la publicación `supabase_realtime` → Supabase emite sus cambios.
--   2) REPLICA IDENTITY FULL → el evento lleva la fila completa (para que UPDATE y
--      DELETE también se entreguen, aun con el filtro por tenant en la suscripción).
--      En estrategia_config la PK es (tenant_id, clave); FULL asegura que el DELETE
--      traiga la 'clave' para poder quitar la fila del state.
--
-- Requisito previo: haber corrido el bloque 30 (crea las tablas).
-- IDEMPOTENTE: se puede correr las veces que quieras, no rompe nada.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['estrategia_config', 'estrategia_flags_unidad']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- ---------- Verificación -----------------------------------------------------
-- Debe listar las 2 tablas de Estrategia publicando:
-- select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and schemaname = 'public'
--     and tablename in ('estrategia_config', 'estrategia_flags_unidad')
--   order by tablename;

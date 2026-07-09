-- ============================================================================
-- Bloque 29: TIEMPO REAL para INGRESOS (clientes, ventas, cobros)
-- ============================================================================
-- Habilita realtime de las 3 tablas de Ingresos, igual que el bloque 19 hizo con
-- las 16 tablas de Pagos. Para cada tabla:
--   1) La agrega a la publicación `supabase_realtime` → Supabase emite sus cambios.
--   2) REPLICA IDENTITY FULL → el evento lleva la fila completa (para que UPDATE y
--      DELETE también se entreguen, aun con el filtro por tenant en la suscripción).
--
-- Requisito previo: haber corrido el bloque 28 (crea las tablas).
-- IDEMPOTENTE: se puede correr las veces que quieras, no rompe nada.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['clientes', 'ventas', 'cobros']
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
-- Debe listar las 3 tablas de Ingresos publicando:
-- select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and schemaname = 'public'
--     and tablename in ('clientes', 'ventas', 'cobros')
--   order by tablename;

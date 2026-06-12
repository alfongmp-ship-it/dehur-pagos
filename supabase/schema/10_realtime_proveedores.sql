-- ============================================================================
-- Bloque 10: Habilitar Tiempo Real (Fase 3) en `proveedores` — PILOTO
-- ============================================================================
-- Agrega la tabla `proveedores` a la publicación `supabase_realtime` para que
-- la app reciba en vivo los INSERT/UPDATE/DELETE de otros usuarios/pestañas.
--
-- Seguridad: la RLS de `proveedores` (bloque 05) ya filtra por tenant en el
-- SELECT, y el cliente además filtra por tenant_id en la suscripción → cada
-- quien solo recibe lo de su empresa.
--
-- IDEMPOTENTE: solo agrega la tabla si no está ya en la publicación.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'proveedores'
  ) then
    alter publication supabase_realtime add table public.proveedores;
  end if;
end $$;

-- ---------- Verificación -----------------------------------------------------
-- select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'proveedores';

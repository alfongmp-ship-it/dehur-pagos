-- ============================================================================
-- Bloque 11: Tiempo Real (Fase 3) — lote catálogos: empleados + partidas
-- ============================================================================
-- Agrega empleados, partidas_catalogo y partidas_obra a la publicación
-- `supabase_realtime` (segundo lote del despliegue de Fase 3, tras el piloto de
-- proveedores en el bloque 10). Cada tabla ya tiene RLS por tenant; el cliente
-- además filtra por tenant_id en la suscripción.
--
-- Estas entidades son catálogos/nómina SIN cascada de saldos → bajo riesgo.
--
-- IDEMPOTENTE: solo agrega cada tabla si no está ya en la publicación.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['empleados', 'partidas_catalogo', 'partidas_obra']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- Verificación -----------------------------------------------------
-- select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime'
--     and tablename in ('proveedores','empleados','partidas_catalogo','partidas_obra')
--   order by tablename;

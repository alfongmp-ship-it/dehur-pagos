-- ============================================================================
-- Bloque 12: Tiempo Real (Fase 3) — lote créditos/pagarés/unidades
-- ============================================================================
-- Agrega creditos, pagares y unidades a la publicación `supabase_realtime`
-- (tercer lote del despliegue de Fase 3). Entidades auto-contenidas, sin
-- cascadas hacia saldos ni hacia otras tablas. Cada tabla ya tiene RLS por
-- tenant; el cliente filtra por tenant_id en la suscripción.
--
-- IDEMPOTENTE: solo agrega cada tabla si no está ya en la publicación.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['creditos', 'pagares', 'unidades']
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
--     and tablename in ('proveedores','empleados','partidas_catalogo','partidas_obra','creditos','pagares','unidades')
--   order by tablename;

-- ============================================================================
-- Bloque 14: Tiempo Real (Fase 3) — pendientes_confirmacion (cola compartida)
-- ============================================================================
-- Agrega pendientes_confirmacion a la publicación `supabase_realtime` para que
-- dos admins vean la MISMA cola de pagos por confirmar en vivo (p.ej. cuando uno
-- genera una dispersión, el otro la ve sin recargar).
--
-- Esta entidad va SOLO en realtime (NO en guardado por fila): es una tabla chica
-- y se sigue guardando whole-table. La RLS por tenant ya existe.
--
-- IDEMPOTENTE.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pendientes_confirmacion'
  ) then
    alter publication supabase_realtime add table public.pendientes_confirmacion;
  end if;
end $$;

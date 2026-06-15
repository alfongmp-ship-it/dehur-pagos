-- ============================================================================
-- Bloque 17: Tiempo Real (Fase 3) — historial (la entidad central de pagos)
-- ============================================================================
-- Agrega historial a la publicación `supabase_realtime`. Es la tabla más grande,
-- por eso va por FILA (no whole-table): confirmar pagos, borrar (individual y en
-- bloque), cambiar partida y aportaciones/pagos directos escriben/borran solo la
-- fila que cambió. El importador masivo de Excel se queda whole-table (raro).
--
-- NOTA concurrencia: los id de pago se generan en el cliente (histSeq local). Con
-- captura simultánea de dos usuarios podría colisionar un id (gana el último).
-- Riesgo bajo con pocos capturando; mejorable a futuro con ids únicos (UUID).
--
-- IDEMPOTENTE.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'historial'
  ) then
    alter publication supabase_realtime add table public.historial;
  end if;
end $$;

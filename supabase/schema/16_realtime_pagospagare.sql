-- ============================================================================
-- Bloque 16: Tiempo Real (Fase 3) — pagos_pagare
-- ============================================================================
-- Agrega pagos_pagare a la publicación `supabase_realtime`. Entidad
-- auto-contenida en creditos.js (sus cascadas a historial/saldos siguen
-- whole-table / su propia vía). RLS por tenant ya existe.
--
-- IDEMPOTENTE.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pagos_pagare'
  ) then
    alter publication supabase_realtime add table public.pagos_pagare;
  end if;
end $$;

-- ============================================================================
-- Bloque 13: Tiempo Real (Fase 3) — lote facturas/traspasos
-- ============================================================================
-- Agrega facturas, factura_pagos, traspasos y movimientos_internos a la
-- publicación `supabase_realtime` (cuarto lote del despliegue de Fase 3).
--
-- Nota: el guardado por fila de estas entidades se engancha en sus módulos
-- propios (facturas.js, traspasos.js). Las cascadas en confirmar-pagos.js e
-- historial.js siguen espejando tabla completa (fallback seguro, sin pérdida).
--
-- IDEMPOTENTE: solo agrega cada tabla si no está ya en la publicación.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['facturas', 'factura_pagos', 'traspasos', 'movimientos_internos']
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
--     and tablename in ('facturas','factura_pagos','traspasos','movimientos_internos')
--   order by tablename;

-- ============================================================================
-- Bloque 15: Tiempo Real (Fase 3) — proyectos + cuentas_propias (saldos)
-- ============================================================================
-- Agrega proyectos y cuentas_propias a la publicación `supabase_realtime`.
-- Son tablas chicas: sus ediciones de CONFIG (nombre/cuenta/saldo a mano) van
-- por fila; los cambios de saldo por pagos (confirmar/traspasos/borrados) siguen
-- whole-table (espejo trivial por ser pocas filas). En ambos casos los saldos se
-- ven en vivo. RLS por tenant ya existe.
--
-- IDEMPOTENTE.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['proyectos', 'cuentas_propias']
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

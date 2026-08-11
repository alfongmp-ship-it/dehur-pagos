-- ============================================================================
-- 38_realtime_repartos.sql — Tiempo real para los REPARTOS (costo_asignaciones)
-- ============================================================================
-- Al repartir una factura o pago, el costo aparece en las casas de TODOS los
-- usuarios conectados al instante (antes: solo al recargar). El cliente ya trae
-- los blindajes verificados (snapshot incremental — un guardado local jamás
-- re-escribe filas ajenas ni fabrica filas fantasma) y el freno de repintados.
--
-- 1) Publica la tabla en supabase_realtime.
-- 2) REPLICA IDENTITY FULL: SIN esto los DELETE no viajan completos y las casas
--    seguirían mostrando dinero de repartos ya borrados. Obligatorio.
--
-- ⚠️ NOTA DE ESQUEMA: monto_asignado y factor deben seguir siendo `numeric` SIN
--    precisión/escala. Un cambio a numeric(p,s) redondearía en el servidor y
--    rompería el guardado por diff del cliente (re-upserteo eterno).
--
-- ADITIVO e IDEMPOTENTE. ⚠️ Se corre A MANO en el SQL Editor de Supabase.
-- (El código ya desplegado tolera que no se haya corrido: simplemente no llegan
--  eventos y todo sigue como hoy — se ve al recargar.)
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'costo_asignaciones'
  ) then
    execute 'alter publication supabase_realtime add table public.costo_asignaciones';
  end if;
  execute 'alter table public.costo_asignaciones replica identity full';
end $$;

-- ---------- Verificación (correr ANTES y DESPUÉS; deben ser idénticos) ------
-- select count(*) as filas, round(sum(monto_asignado)::numeric, 2) as total
--   from public.costo_asignaciones;
--
-- La tabla debe aparecer publicando:
-- select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'costo_asignaciones';
--
-- replica identity debe ser 'f' (full):
-- select relreplident from pg_class where oid = 'public.costo_asignaciones'::regclass;

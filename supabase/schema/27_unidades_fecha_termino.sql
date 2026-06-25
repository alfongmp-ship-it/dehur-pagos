-- ============================================================================
-- 27_unidades_fecha_termino.sql — Fecha de terminación por casa (indiviso por fecha)
-- ============================================================================
-- Agrega la columna `fecha_termino` a `unidades`: la fecha (ISO 'YYYY-MM-DD') en que la
-- casa se terminó y SALIÓ del pool de indiviso. Vacío = sigue en obra (siempre en el pool).
-- Con esto, una factura/pago con fecha D reparte el indiviso SOLO entre las casas que
-- seguían en obra a la fecha D (las terminadas antes de D ya no absorben ese costo común).
--
-- Inerte mientras ninguna casa tenga fecha_termino → comportamiento idéntico al actual.
-- Aditivo e idempotente. Corre esto una vez en el SQL editor de Supabase, ANTES de guardar
-- unidades en la versión nueva.
-- ============================================================================

alter table public.unidades add column if not exists fecha_termino text not null default '';

-- ============================================================================
-- 37_partida_visible_obra.sql — Checkbox "Visible para obra" por partida
-- ============================================================================
-- Las partidas del catálogo admin ganan una marca: las que NO sean visibles
-- para obra se ocultan por completo a los roles acotados (obra = Gustavo,
-- facturas_obra = Anahi) en TODO Costos por Unidad: matriz y totales de
-- Control de Obra, detalle por casa, plano "Por partida" y el grid de
-- Presupuestos. Admin/capturista/facturas ven todo igual que siempre.
--
-- Default TRUE: nada cambia hasta que el admin desmarque partidas en
-- Configuración → Partidas.
--
-- ADITIVO e IDEMPOTENTE. ⚠️ Se corre A MANO en el SQL Editor de Supabase.
-- (El código tolera que la columna no exista; solo el checkbox de Configuración
--  necesita la columna para persistir.)
-- ============================================================================

alter table public.partidas_catalogo
  add column if not exists visible_obra boolean not null default true;

-- ---------- Verificación ----------
-- select partida, activa, visible_obra from public.partidas_catalogo order by orden;

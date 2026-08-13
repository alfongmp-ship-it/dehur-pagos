-- ============================================================================
-- 40_partidas_cuenta_costos.sql — Partidas que NO cuentan para Costos por Unidad
-- ============================================================================
-- Agrega al catálogo de partidas el flag cuenta_costos (default true). El admin
-- lo apaga por partida en Configuración → Partidas ("No cuenta para Costos por
-- Unidad"): los pagos de esa partida dejan de aparecer como pendientes de
-- reparto Y sus repartos existentes dejan de sumar en las vistas de Costos por
-- Unidad / Control de Obra / Avance. Es SOLO de vista (capa post-filtro en el
-- cliente): ninguna asignación se borra y desmarcar la partida vuelve a contar
-- todo al centavo. Fiscal y Reporte JP no cambian.
--
-- ADITIVO e IDEMPOTENTE. ⚠️ Se corre A MANO en el SQL Editor de Supabase.
-- Correrlo ANTES de usar el checkbox (sin la columna, guardar una partida con
-- el flag fallaría en Supabase). Sin RLS nuevo: aplican las policies existentes
-- de partidas_catalogo.
-- ============================================================================

alter table public.partidas_catalogo
  add column if not exists cuenta_costos boolean not null default true;

-- ---------- Verificación ----------
-- select partida, activa, visible_obra, cuenta_costos
--   from public.partidas_catalogo order by orden;

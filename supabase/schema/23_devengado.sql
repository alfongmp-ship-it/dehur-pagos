-- ============================================================================
-- 23_devengado.sql — Costo DEVENGADO en facturas (Fase A)
-- ============================================================================
-- Agrega a `costo_asignaciones` la posibilidad de que un reparto pertenezca a una
-- FACTURA (devengado) en vez de a un pago. Una fila pertenece a UNA factura
-- (factura_id lleno, pago_id vacío) O a UN pago (pago_id lleno, factura_id vacío).
-- `sub_partida_override` guarda la sub-partida del reparto de factura (cuando la
-- partida es "construcción").
--
-- ADITIVO e IDEMPOTENTE. Las filas viejas (todas de pagos sin factura) quedan con
-- factura_id='' → siguen contando como "pagado sin factura". Cero migración.
--
-- ⚠️ Se corre A MANO en el SQL Editor de Supabase, ANTES de subir el código.
-- ============================================================================

alter table public.costo_asignaciones add column if not exists factura_id           text not null default '';
alter table public.costo_asignaciones add column if not exists sub_partida_override text not null default '';

-- Índice para el reporte de devengado (filtra por factura).
create index if not exists idx_ca_factura
  on public.costo_asignaciones (tenant_id, factura_id) where factura_id <> '';

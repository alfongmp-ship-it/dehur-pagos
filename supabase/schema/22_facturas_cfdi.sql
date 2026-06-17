-- ============================================================================
-- 22_facturas_cfdi.sql — Campos fiscales (CFDI) en facturas (Fase 2)
-- ============================================================================
-- Agrega a la tabla `facturas` los datos fiscales del CFDI que captura Gonzalo
-- (rol 'facturas'). Es ADITIVO e IDEMPOTENTE: las facturas viejas toman los
-- defaults y conservan su `monto_total` actual.
--
-- ⚠️ Se corre A MANO en el SQL Editor de Supabase (los .sql NO se auto-aplican).
-- ⚠️ Correr ESTO ANTES de subir el código nuevo: si la app guarda columnas que
--    todavía no existen, el upsert por fila falla.
--
-- No toca RLS, triggers, PK ni `monto_total` (que sigue siendo el "Total").
-- No se crea `nombre_emisor` (se reutiliza `razon_social`) ni `partida` (fase futura).
-- ============================================================================

alter table if exists public.facturas add column if not exists subtotal         numeric not null default 0;
alter table if exists public.facturas add column if not exists descuento        numeric not null default 0;
alter table if exists public.facturas add column if not exists iva_trasladado   numeric not null default 0;
alter table if exists public.facturas add column if not exists retencion_iva    numeric not null default 0;
alter table if exists public.facturas add column if not exists retencion_isr    numeric not null default 0;
alter table if exists public.facturas add column if not exists rfc_emisor       text    not null default '';
alter table if exists public.facturas add column if not exists estado_sat       text    not null default 'Vigente';
alter table if exists public.facturas add column if not exists tipo_comprobante text    not null default 'Factura';

-- ===== Verificación (opcional) =====
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'facturas'
--  order by ordinal_position;

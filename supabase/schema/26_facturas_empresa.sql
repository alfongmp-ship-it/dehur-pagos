-- ============================================================================
-- 26_facturas_empresa.sql — Empresa facturada (receptor del CFDI) por factura
-- ============================================================================
-- Agrega la columna `empresa` a `facturas` para registrar a NOMBRE DE QUÉ empresa
-- propia se emitió la factura (a veces facturan a Dehur, a veces a Dehur Territorial).
-- Texto libre (en el cliente se elige de una lista corta). Aditivo e idempotente.
-- Corre esto una vez en el SQL editor de Supabase.
-- ============================================================================

alter table public.facturas add column if not exists empresa text not null default '';

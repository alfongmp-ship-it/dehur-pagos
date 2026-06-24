-- ============================================================================
-- 25_facturas_nota_credito.sql — Nota de crédito (acumulada) por factura
-- ============================================================================
-- Agrega 2 columnas a `facturas` para registrar la(s) nota(s) de crédito del
-- proveedor (monto + IVA, acumulados). Reducen el monto_total NETO a pagar y, al
-- bajar la base, el IVA. El cliente recalcula el total restándolas, así que el
-- saldo y el costo por casa (devengado) se ajustan solos.
--
-- Idempotente y aditivo. Corre esto una vez en el SQL editor de Supabase.
-- ============================================================================

alter table public.facturas add column if not exists nc_subtotal numeric not null default 0;
alter table public.facturas add column if not exists nc_iva      numeric not null default 0;

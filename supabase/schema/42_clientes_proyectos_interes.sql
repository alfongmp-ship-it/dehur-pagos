-- ============================================================================
-- 42_clientes_proyectos_interes.sql — Proyectos de INTERÉS del cliente
-- ============================================================================
-- Muchos prospectos nunca llegan a venta, pero la relación comercial importa:
-- "este cliente estuvo interesado en Entorno" sirve para recontactarlo cuando
-- salga un producto similar. El proyecto DERIVADO de sus ventas cubre a quien
-- compró (o canceló); este campo capturado cubre al prospecto puro — y además
-- conserva la relación cuando una venta caída se BORRA (la app la degrada a
-- interés en vez de perderla).
--
-- Mismo patrón que proveedores.proyectos: jsonb con lista de nombres.
--
-- ADITIVO e IDEMPOTENTE. ⚠️ Se corre A MANO en el SQL Editor de Supabase.
-- Correrlo ANTES de usar los checkboxes de interés (sin la columna, guardar un
-- cliente con intereses rebotaría en Supabase). Sin RLS nuevo.
-- ============================================================================

alter table public.clientes
  add column if not exists proyectos_interes jsonb not null default '[]'::jsonb;

-- ---------- Verificación ----------
-- select nombre, proyectos_interes from public.clientes limit 10;
